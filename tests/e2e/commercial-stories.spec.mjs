// Canal comercial de historias, de punta a punta: el local lo administra desde
// Marketing → Historias y la clientela lo ve en la vidriera.
//
// Lo que este spec protege NO es el pixel: es el CONTRATO. Que una historia
// programada no se vea antes de tiempo, que una vencida desaparezca sola, que
// una CTA abra contenido REAL del catálogo, que el +18 del catálogo no se pueda
// apagar desde el formulario, y que el visor se maneje con el pulgar y con el
// teclado por igual.
import { expect, test } from '@playwright/test';
import {
  gotoDemoReset,
  installBrowserStubs,
  installPageGuards,
  openBusinessSection,
} from './helpers.mjs';

const PHONE = { width: 390, height: 844 };
// Arte real del repositorio. El marcador de posición del borrador
// (`beverage-placeholder.svg`) NO sirve acá a propósito: una historia no se
// puede activar con él, y ese contrato se prueba en `tests/story-store.test.mjs`.
const ARTE = 'assets/promos/cervezas-patagonia.jpg';

async function openPanel(page) {
  await gotoDemoReset(page, '/?reset=1&demo=1#business');
  await page.getByRole('button', { name: /Ingresar codigo|Ingresar código/i }).click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await openBusinessSection(page, '[data-business-view="marketing"]');
  await expect(page.locator('[data-stories-manager]')).toBeVisible();
}

/** Rellena el formulario abierto. `ctaType`/`ctaTarget` re-pintan el formulario. */
async function fillStoryForm(page, {
  title, body = '', mediaUrl = ARTE, ctaType = '', ctaTarget = '',
  startsAt = '', expiresAt = '', enabled = false,
}) {
  const form = page.locator('[data-story-form]');
  await expect(form).toBeVisible();
  await form.locator('[name="title"]').fill(title);
  if (body) await form.locator('[name="body"]').fill(body);
  await form.locator('[name="mediaUrl"]').fill(mediaUrl);
  if (ctaType) {
    await form.locator('[name="ctaType"]').selectOption(ctaType);
    // El cambio de acción vuelve a pintar el formulario con los destinos reales
    // de ese tipo; hay que volver a tomar el nodo.
    await expect(page.locator('[data-story-form] [name="ctaTarget"]')).toBeEnabled();
    if (ctaTarget) await page.locator('[data-story-form] [name="ctaTarget"]').selectOption(ctaTarget);
  }
  if (startsAt) await page.locator('[data-story-form] [name="startsAt"]').fill(startsAt);
  if (expiresAt) await page.locator('[data-story-form] [name="expiresAt"]').fill(expiresAt);
  const enabledBox = page.locator('[data-story-form] [name="enabled"]');
  if (enabled) await enabledBox.check();
  else await enabledBox.uncheck();
}

function localStamp(offsetMinutes) {
  const date = new Date(Date.now() + offsetMinutes * 60_000);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const stateOf = (page, id) => page.locator(`[data-story-row="${id}"] .stories-admin-state`);

test('el ciclo completo: crear como borrador, activar, ver en la vidriera y eliminar', async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await openPanel(page);

  // La demo se estrena con las historias de ejemplo, no con una pantalla vacía.
  await expect(page.locator('[data-story-row]')).toHaveCount(4);

  await page.locator('[data-story-new]').click();
  await fillStoryForm(page, {
    title: 'Novedad QA',
    body: 'Texto breve de la novedad.',
    enabled: false,
  });
  await page.locator('[data-story-save]').click();

  // Guardada apagada = BORRADOR, y un borrador NO se ve.
  const row = page.locator('[data-story-row]').filter({ hasText: 'Novedad QA' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.stories-admin-state')).toHaveText('BORRADOR');

  const storyId = await row.getAttribute('data-story-row');
  await page.evaluate(() => { window.location.hash = '#home'; });
  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await page.locator('[data-stories-slot] .brand-logo-action').first().click();
  await expect(page.locator('[data-stories-modal]')).toBeVisible();
  await expect(page.locator('[data-stories-modal] h2')).not.toHaveText('Novedad QA');
  await page.locator('[data-close-stories]').click();

  // Activar desde la lista: pasa a ACTIVA y aparece en la vidriera.
  await page.evaluate(() => { window.location.hash = '#business'; });
  await page.locator(`[data-story-toggle="${storyId}"]`).click();
  await expect(stateOf(page, storyId)).toHaveText('ACTIVA');

  await page.evaluate(() => { window.location.hash = '#home'; });
  await page.locator('[data-stories-slot] .brand-logo-action').first().click();
  const modal = page.locator('[data-stories-modal]');
  await expect(modal).toBeVisible();
  // El visor abre en la primera SIN VER, así que lo que se fija es el total.
  await expect(modal.locator('.stories-position')).toHaveText(/de 5$/);
  await page.locator('[data-close-stories]').click();

  // Eliminar es de dos pasos: el primer toque arma la confirmación.
  await page.evaluate(() => { window.location.hash = '#business'; });
  await page.locator(`[data-story-delete="${storyId}"]`).click();
  await expect(page.locator(`[data-story-delete-confirm="${storyId}"]`)).toBeVisible();
  await page.locator('[data-story-delete-cancel]').click();
  await expect(page.locator(`[data-story-row="${storyId}"]`)).toHaveCount(1);

  await page.locator(`[data-story-delete="${storyId}"]`).click();
  await page.locator(`[data-story-delete-confirm="${storyId}"]`).click();
  await expect(page.locator(`[data-story-row="${storyId}"]`)).toHaveCount(0);
  await expect(page.locator('[data-story-row]')).toHaveCount(4);

  await guards.assertClean();
  await context.close();
});

test('programar y expirar: la ventana la maneja el reloj, no una persona', async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  await installBrowserStubs(page);
  await openPanel(page);

  await page.locator('[data-story-new]').click();
  await fillStoryForm(page, {
    title: 'Programada QA',
    startsAt: localStamp(60),
    expiresAt: localStamp(240),
    enabled: true,
  });
  await page.locator('[data-story-save]').click();

  const programada = page.locator('[data-story-row]').filter({ hasText: 'Programada QA' });
  await expect(programada.locator('.stories-admin-state')).toHaveText('PROGRAMADA');
  await expect(programada).toContainText('Empieza sola en la fecha de inicio');

  // Activa pero fuera de ventana: la vidriera sigue mostrando cuatro.
  await page.evaluate(() => { window.location.hash = '#home'; });
  await page.locator('[data-stories-slot] .brand-logo-action').first().click();
  await expect(page.locator('[data-stories-modal] .stories-position')).toHaveText(/de 4$/);
  await page.locator('[data-close-stories]').click();

  // Una vencida se apaga sola: no hay ningún botón que apretar.
  await page.evaluate(() => { window.location.hash = '#business'; });
  await page.locator('[data-story-new]').click();
  await fillStoryForm(page, {
    title: 'Vencida QA',
    startsAt: localStamp(-240),
    expiresAt: localStamp(-60),
    enabled: true,
  });
  await page.locator('[data-story-save]').click();

  const vencida = page.locator('[data-story-row]').filter({ hasText: 'Vencida QA' });
  await expect(vencida.locator('.stories-admin-state')).toHaveText('FINALIZADA');
  await expect(vencida).toContainText('Venció y se apagó sola');

  await page.evaluate(() => { window.location.hash = '#home'; });
  await page.locator('[data-stories-slot] .brand-logo-action').first().click();
  await expect(page.locator('[data-stories-modal] .stories-position')).toHaveText(/de 4$/);

  await context.close();
});

test('ordenar cambia el orden de la vidriera, con botones y no arrastrando', async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  await installBrowserStubs(page);
  await openPanel(page);

  const first = page.locator('[data-story-row]').first();
  const firstId = await first.getAttribute('data-story-row');
  const secondId = await page.locator('[data-story-row]').nth(1).getAttribute('data-story-row');

  // La primera no puede subir y la última no puede bajar: los extremos se
  // deshabilitan en vez de no hacer nada al tocarlos.
  await expect(page.locator(`[data-story-row="${firstId}"] [data-story-move="-1"]`)).toBeDisabled();
  await expect(page.locator('[data-story-row]').last().locator('[data-story-move="1"]')).toBeDisabled();

  await page.locator(`[data-story-row="${secondId}"] [data-story-move="-1"]`).click();
  await expect(page.locator('[data-story-row]').first()).toHaveAttribute('data-story-row', secondId);
  await expect(page.locator(`[data-story-row="${secondId}"] .stories-admin-position`)).toHaveText('1/4');

  await page.evaluate(() => { window.location.hash = '#home'; });
  await page.locator('[data-stories-slot] .brand-logo-action').first().click();
  await expect(page.locator('.stories-card')).toHaveAttribute('data-story-id', secondId);

  await context.close();
});

test('la vista previa muestra el visor real sin ensuciar métricas ni marcar como vista', async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  await installBrowserStubs(page);
  await openPanel(page);

  await page.locator('[data-story-new]').click();
  await fillStoryForm(page, { title: 'Preview QA', body: 'Sólo para mirar.', enabled: false });
  await page.locator('[data-story-form-preview]').click();

  const modal = page.locator('[data-stories-modal]');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('heading', { name: 'Preview QA' })).toBeVisible();
  await expect(modal.locator('.stories-text')).toHaveText('Sólo para mirar.');
  await page.locator('[data-close-stories]').click();

  // Ni un contador ni una vista registrada por previsualizar.
  const rastro = await page.evaluate(() => ({
    metricas: localStorage.getItem('la_taba_story_metrics_v1'),
    vistas: localStorage.getItem('la_taba_stories_seen_v1'),
  }));
  expect(rastro.metricas).toBeNull();
  expect(rastro.vistas).toBeNull();

  await context.close();
});

test('las cuatro CTA abren contenido real de TABA2', async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.waitForSelector('[data-view="home"] .home-best-card');

  // El visor abre en la primera SIN VER; `Home` lo lleva siempre al principio,
  // así que el índice de este helper es absoluto y no depende de lo ya visto.
  const abrir = async (indice) => {
    await page.locator('[data-stories-slot] .brand-logo-action').first().click();
    await expect(page.locator('[data-stories-modal]')).toBeVisible();
    await page.keyboard.press('Home');
    for (let paso = 0; paso < indice; paso += 1) await page.locator('[data-story-next]').click();
  };

  // 1 · VER PRODUCTO abre la ficha del producto real.
  await abrir(0);
  await expect(page.locator('[data-story-cta]')).toHaveText('Ver producto');
  await page.locator('[data-story-cta]').click();
  await expect(page.locator('[data-product-modal]')).toBeVisible();
  await expect(page.locator('[data-product-modal]')).toContainText('Heineken');
  await page.keyboard.press('Escape');

  // 2 · VER COMBO abre la ficha del combo, con su composición real.
  await abrir(1);
  await expect(page.locator('[data-story-cta]')).toHaveText('Ver combo');
  await page.locator('[data-story-cta]').click();
  await expect(page.locator('[data-combo-modal]')).toBeVisible();
  await expect(page.locator('.combo-component-list li').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-combo-modal]')).toBeHidden();

  // 3 · COMPRAR usa el mismo alta que la ficha: el producto entra al carrito.
  await abrir(2);
  await expect(page.locator('[data-story-cta]')).toHaveText('Comprar');
  await page.locator('[data-story-cta]').click();
  await page.evaluate(() => { window.location.hash = '#cart'; });
  await expect(page.locator('[data-cart-list] .cart-item')).toContainText('Monster');

  // 4 · VER CATEGORÍA filtra el catálogo real.
  await page.evaluate(() => { window.location.hash = '#home'; });
  await abrir(3);
  await expect(page.locator('[data-story-cta]')).toHaveText('Ver categoría');
  await page.locator('[data-story-cta]').click();
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(page.locator('[data-catalog-title]')).toHaveText('Energizantes');
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();

  await context.close();
});

test('el +18 del catálogo se conserva y no se puede apagar desde el formulario', async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.waitForSelector('[data-view="home"] .home-best-card');

  // La historia de Heineken apunta a un producto alcohólico: el visor muestra
  // el MISMO aviso que la ficha del catálogo.
  await page.locator('[data-stories-slot] .brand-logo-action').first().click();
  const modal = page.locator('[data-stories-modal]');
  await expect(modal.locator('.stories-age-chip')).toHaveText('+18');
  await expect(modal.locator('.product-alcohol-notice'))
    .toHaveText('Venta exclusiva a mayores de 18 años.');
  await page.locator('[data-close-stories]').click();

  // Y en el Panel la casilla queda trabada: la declaración no puede relajar lo
  // que impone el catálogo.
  await page.evaluate(() => { window.location.hash = '#business'; });
  await page.getByRole('button', { name: /Ingresar codigo|Ingresar código/i }).click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await openBusinessSection(page, '[data-business-view="marketing"]');

  await page.locator('[data-story-row]').filter({ hasText: 'Heineken bien fría' })
    .getByRole('button', { name: 'Editar' }).click();
  const ageBox = page.locator('[data-story-form] [name="ageRestricted"]');
  await expect(ageBox).toBeChecked();
  await expect(ageBox).toBeDisabled();
  await expect(page.locator('[data-story-form]')).toContainText('Lo impone el catálogo');

  await context.close();
});

test('comprar alcohol desde una historia sigue pasando por la confirmación de edad', async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  await installBrowserStubs(page);
  await openPanel(page);

  // Una historia con COMPRAR sobre un producto alcohólico real.
  await page.locator('[data-story-new]').click();
  await fillStoryForm(page, {
    title: 'Comprar cerveza QA',
    ctaType: 'buy',
    ctaTarget: 'heineken-original-lata-473ml',
    enabled: true,
  });
  await page.locator('[data-story-save]').click();

  await page.evaluate(() => { window.location.hash = '#home'; });
  await page.locator('[data-stories-slot] .brand-logo-action').first().click();
  // Una historia nueva entra al final de la vidriera: `End` va directo a ella.
  await page.keyboard.press('End');
  await expect(page.locator('[data-stories-modal] h2')).toHaveText('Comprar cerveza QA');
  await expect(page.locator('[data-stories-modal] [data-story-cta]')).toHaveText('Comprar');
  await expect(page.locator('[data-stories-modal] .stories-age-chip')).toHaveText('+18');
  await page.locator('[data-stories-modal] [data-story-cta]').click();

  // La puerta +18 es la del carrito, la misma de siempre. La historia no abrió
  // ningún atajo.
  await page.evaluate(() => { window.location.hash = '#cart'; });
  const confirmacion = page.locator('[data-age-confirmation]');
  await expect(confirmacion).toBeVisible();
  await expect(page.locator('[data-age-confirmation-title]')).toContainText('mayor de 18');
  await expect(page.locator('[name="ageConfirmed"]')).not.toBeChecked();

  await context.close();
});

test('el visor se maneja con el pulgar y con el teclado', async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  await installBrowserStubs(page);
  // Sin animación no hay avance automático: el test mide el control manual.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.waitForSelector('[data-view="home"] .home-best-card');

  await page.locator('[data-stories-slot] .brand-logo-action').first().click();
  const modal = page.locator('[data-stories-modal]');
  await expect(modal.locator('.stories-position')).toHaveText('Historia 1 de 4');

  // Teclado: flechas y extremos.
  await page.keyboard.press('ArrowRight');
  await expect(modal.locator('.stories-position')).toHaveText('Historia 2 de 4');
  await page.keyboard.press('ArrowLeft');
  await expect(modal.locator('.stories-position')).toHaveText('Historia 1 de 4');
  await page.keyboard.press('End');
  await expect(modal.locator('.stories-position')).toHaveText('Historia 4 de 4');
  await page.keyboard.press('Home');
  await expect(modal.locator('.stories-position')).toHaveText('Historia 1 de 4');

  // El foco no se pierde al avanzar con el botón: vuelve al mismo control.
  await modal.locator('[data-story-next]').click();
  await expect(modal.locator('[data-story-next]')).toBeFocused();

  // Zona táctil: la mitad derecha avanza, la izquierda vuelve.
  const zonaDerecha = modal.locator('[data-story-zone="1"]');
  await zonaDerecha.click();
  await expect(modal.locator('.stories-position')).toHaveText('Historia 3 de 4');
  await modal.locator('[data-story-zone="-1"]').click();
  await expect(modal.locator('.stories-position')).toHaveText('Historia 2 de 4');

  // Gesto: arrastrar hacia la izquierda avanza.
  const caja = await modal.locator('[data-stories-media]').boundingBox();
  await page.mouse.move(caja.x + caja.width * 0.8, caja.y + caja.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(caja.x + caja.width * 0.15, caja.y + caja.height * 0.4, { steps: 8 });
  await page.mouse.up();
  await expect(modal.locator('.stories-position')).toHaveText('Historia 3 de 4');

  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();

  await context.close();
});

test('la analítica cuenta seis pasos y no guarda una sola persona', async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  await installBrowserStubs(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.waitForSelector('[data-view="home"] .home-best-card');

  await page.locator('[data-stories-slot] .brand-logo-action').first().click();
  await expect(page.locator('[data-stories-modal]')).toBeVisible();
  await page.locator('[data-story-next]').click();
  await page.locator('[data-story-cta]').click();
  // La CTA abrió la ficha del combo: es un diálogo modal y bloquea el resto de
  // la página, así que se cierra antes de seguir.
  await expect(page.locator('[data-combo-modal]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-combo-modal]')).toBeHidden();

  const metricas = await page.evaluate(() => JSON.parse(localStorage.getItem('la_taba_story_metrics_v1')));
  expect(Object.keys(metricas).sort()).toEqual(['since', 'stories', 'version']);
  expect(metricas.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  const primera = metricas.stories['story-cervezas-heineken'];
  expect(primera.open).toBe(1);
  expect(primera.impression).toBe(1);
  expect(primera.advance).toBe(1);

  const segunda = metricas.stories['story-combo-heineken-x6'];
  expect(segunda.impression).toBe(1);
  expect(segunda.cta).toBe(1);
  expect(segunda.product_open).toBe(1);
  expect(segunda.add_to_cart).toBe(0);

  // Los contadores son lo único que se guarda: ni sesión, ni dispositivo, ni un
  // sello de tiempo por evento con el que reconstruir un recorrido.
  const crudo = await page.evaluate(() => localStorage.getItem('la_taba_story_metrics_v1'));
  for (const prohibido of ['session', 'user', 'device', 'agent', 'ip', 'phone', 'email', 'purchase', 'conversion']) {
    expect(crudo.toLowerCase()).not.toContain(prohibido);
  }

  // Y el Panel muestra esos números sin llamarlos conversión.
  await page.evaluate(() => { window.location.hash = '#business'; });
  await page.getByRole('button', { name: /Ingresar codigo|Ingresar código/i }).click();
  await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  await page.locator('[data-pin-form]').press('Enter');
  await openBusinessSection(page, '[data-business-view="marketing"]');

  const fila = page.locator('[data-story-row="story-cervezas-heineken"]');
  await expect(fila.locator('.stories-admin-metrics')).toContainText('Impresiones 1');
  await expect(fila.locator('.stories-admin-metrics')).toContainText('Aperturas 1');
  // El Panel dice hasta dónde llega la cadena medible y no publica ninguna
  // TASA: los seis números son conteos. Una tasa de conversión mezclaría estos
  // contadores locales con pedidos que el backend cierra sin decir de qué
  // historia vinieron.
  const panel = await page.locator('[data-stories-manager]').innerText();
  expect(panel.toLowerCase()).toContain('agregado al carrito');
  expect(panel).not.toMatch(/tasa de conversi|% de conversi|conversion rate/i);
  for (const linea of await page.locator('.stories-admin-metrics').allInnerTexts()) {
    expect(linea).not.toContain('%');
  }

  await context.close();
});

// El repositorio no versiona ningún video —el arte de la vidriera es fotografía
// curada—, así que lo que se fija acá es el CONTRATO del elemento: controles
// siempre, sin pantalla completa forzada en iOS, con póster y con la precarga
// que decide `storyVideoPreload`. Que el archivo decodifique es del navegador.
test('una historia con video declara controles, playsinline y póster', async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  await installBrowserStubs(page);
  await page.addInitScript(() => {
    window.TABA2_STORIES = [{
      id: 'story-video-qa',
      business_id: 'la-taba-2',
      title: 'Video QA',
      body: 'Una historia en video.',
      media_type: 'video',
      media_url: 'assets/promos/cervezas-patagonia.jpg',
      thumbnail_url: 'assets/promos/story-cervezas-heineken-thumb.webp',
      sort_order: 1,
      enabled: true,
    }];
  });
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.waitForSelector('[data-view="home"] .home-best-card');

  await page.locator('[data-stories-slot] .brand-logo-action').first().click();
  const video = page.locator('[data-stories-modal] [data-story-video]');
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('controls', '');
  await expect(video).toHaveAttribute('playsinline', '');
  await expect(video).toHaveAttribute('poster', 'assets/promos/story-cervezas-heineken-thumb.webp');
  await expect(video).toHaveAttribute('preload', /metadata|none/);

  // Y el avance automático NO corre sobre un video: dura lo que dura.
  await expect(page.locator('[data-stories-modal] .stories-progress span.is-active i'))
    .toHaveCount(1);

  await context.close();
});

test('una historia cuyo destino deja de ser comprable se apaga sola', async ({ browser }) => {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  await installBrowserStubs(page);
  await openPanel(page);

  // Se pausa el producto destino desde el catálogo del propio Panel: el camino
  // real, no un atajo por estado.
  await openBusinessSection(page, '[data-scroll-catalog]');
  const expandir = page.locator('[data-catalog-expand]');
  if (await expandir.count()) await expandir.click();
  await page.locator('[data-product-toggle="monster-mango-loco-lata-473ml"]').click();

  await page.evaluate(() => { window.location.hash = '#home'; });
  await page.locator('[data-stories-slot] .brand-logo-action').first().click();
  // Quedan tres: la de Monster no promete una compra que el catálogo ya no
  // puede sostener. Nadie tuvo que acordarse de apagarla.
  await expect(page.locator('[data-stories-modal] .stories-position')).toHaveText('Historia 1 de 3');

  await context.close();
});
