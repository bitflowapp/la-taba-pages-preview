/*
 * Estados de la tienda que sólo se ven cuando algo NO está bien: sin conexión,
 * el local cerrado, un catálogo que no contesta, un producto que no se puede
 * comprar. Y dos gestos que tienen que dejar a la persona donde estaba: agregar
 * desde la home y cerrar una ficha con «atrás».
 *
 * La tienda corre en modo producción con las 46 fichas reales servidas por un
 * backend en memoria (`catalog-runtime-fixture.mjs`). Cada caso nació de un
 * defecto medido en un navegador; el número que lo delató está en el comentario
 * del código que lo corrige.
 */
import { expect, test } from '@playwright/test';
import { GRID, clickCatalogCategory, openRuntimeCatalog } from './catalog-runtime-fixture.mjs';

test.use({ viewport: { width: 390, height: 844 } });

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const availability = (changes = {}) => ({
  business_id: BUSINESS_ID, channel: 'delivery', ordering_ready: true, is_open: true,
  hours_enforced: false, coverage_enforced: false, next_open_at: null, hours: [], areas: [],
  delivery: { eligible: true, reason: 'ok', zone_name: '', delivery_fee: 0, minimum_subtotal: null },
  ...changes,
});

const box = (page, selector) => page.locator(selector).first().evaluate((node) => {
  const rect = node.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
});

const goHome = async (page) => {
  await page.locator('[data-nav-view="home"]:visible').first().click();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
};

// ─── Sin conexión ─────────────────────────────────────────────────────────────

test('sin conexión: el aviso no tapa la barra de abajo y se puede ir al carrito', async ({ page, context }) => {
  await openRuntimeCatalog(page);
  await page.locator(`${GRID} .product-card [data-add-product]`).first().click();
  await expect(page.locator('[data-floating-cart]')).toBeVisible();

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const banner = page.locator('[data-pwa-offline-banner]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Sin conexión');

  const aviso = await box(page, '[data-pwa-offline-banner]');
  const barra = await box(page, '.mobile-nav');
  const carrito = await box(page, '[data-floating-cart]');
  expect(aviso.bottom, 'el aviso cae encima de la barra de navegación').toBeLessThanOrEqual(barra.top);
  expect(aviso.bottom, 'el aviso cae encima de la barra del carrito').toBeLessThanOrEqual(carrito.top);
  expect(aviso.left).toBeGreaterThanOrEqual(0);
  expect(aviso.right).toBeLessThanOrEqual(390);
  // No tiene nada que tocar, así que no se queda con ningún toque.
  expect(await banner.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');

  // Un toque normal —con todas las comprobaciones de Playwright— llega a la barra.
  await page.locator('.mobile-nav [data-nav-view="cart"]').click();
  await expect(page.locator('[data-view="cart"]')).toBeVisible();
  await expect(page.locator('[data-view="cart"] .cart-item')).toHaveCount(1);

  // Confirmar sin red lo dice con esas palabras, no con un error genérico.
  await page.locator('[data-view="cart"] [data-checkout-form]').evaluate((form) => form.requestSubmit());
  await expect(page.locator('[data-checkout-warning]')).toContainText('Sin conexión');

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(banner).toBeHidden();
});

// ─── La home ──────────────────────────────────────────────────────────────────

test('home: al agregar, el selector de cantidad queda donde estaba el botón', async ({ page }) => {
  await openRuntimeCatalog(page, { view: 'home' });
  const card = page.locator('[data-view="home"] .home-best-card').first();
  await expect(card).toBeVisible();
  const measure = () => card.evaluate((node) => {
    const origin = node.getBoundingClientRect();
    const rect = (selector) => {
      const target = node.querySelector(selector).getBoundingClientRect();
      return { top: Math.round(target.top - origin.top), width: Math.round(target.width) };
    };
    return { control: rect('.home-card-control'), copy: rect('.home-best-copy'), media: rect('.home-best-media') };
  });
  const before = await measure();
  await card.locator('[data-add-product]').click();
  await expect(card.locator('.qty-stepper')).toBeVisible();
  const after = await measure();

  expect(Math.abs(after.control.top - before.control.top), 'el control saltó de lugar').toBeLessThanOrEqual(1);
  expect(Math.abs(after.control.width - before.control.width), 'el control cambió de ancho').toBeLessThanOrEqual(1);
  expect(Math.abs(after.copy.top - before.copy.top), 'el nombre y el precio se corrieron').toBeLessThanOrEqual(1);
  // El orden que se lee: foto, texto, control.
  expect(after.media.top).toBeLessThan(after.copy.top);
  expect(after.copy.top).toBeLessThan(after.control.top);
  // Y el segundo toque en el mismo lugar suma, no cae en el precio.
  await card.locator('[data-cart-inc]').click();
  await expect(card.locator('.qty-stepper strong')).toHaveText('2');
});

test('home: el nombre y el estado comparten renglón; el rubro va debajo', async ({ page }) => {
  await openRuntimeCatalog(page, { view: 'home' });
  // La fila vive en el contenido que espera al catálogo: medirla antes da ceros.
  await expect(page.locator('#home-title')).toBeVisible({ timeout: 20_000 });
  const title = await box(page, '#home-title');
  const state = await box(page, '.brand-hero-state');
  const place = await box(page, '[data-home-business-place]');
  expect(state.top, 'el estado bajó a un renglón propio').toBeLessThan(title.bottom);
  expect(place.top).toBeGreaterThanOrEqual(title.bottom - 1);
});

test('home: con el horario exigido y el local cerrado, lo dice y dice cuándo abre', async ({ page }) => {
  const abre = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
  await openRuntimeCatalog(page, {
    view: 'home',
    availability: availability({ is_open: false, hours_enforced: true, next_open_at: abre }),
  });
  const chip = page.locator('[data-open-status]').first();
  await expect(chip).toHaveText(/^Cerrado · Abrimos (hoy|mañana) a las \d{2}:\d{2}$/);
  await expect(chip).toHaveClass(/is-closed/);
  // Cerrado no vacía ni bloquea la góndola: el carrito se arma igual.
  const add = page.locator('[data-view="home"] .home-best-card [data-add-product]').first();
  await expect(add).toBeEnabled();
});

test('home: abierto, o sin una respuesta válida sobre el horario, no dice «cerrado»', async ({ page, browser }) => {
  await openRuntimeCatalog(page, { view: 'home', availability: availability() });
  await expect(page.locator('[data-open-status]').first()).toHaveText('Estamos tomando pedidos');
  await expect(page.locator('[data-open-status]').first()).not.toHaveClass(/is-closed/);

  // Un «cerrado» sin horario exigido no existe en el backend: es una respuesta
  // vacía o mal formada, y la home no afirma nada sobre eso.
  const otra = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await openRuntimeCatalog(otra, { view: 'home', availability: availability({ is_open: false, hours_enforced: false }) });
  await expect(otra.locator('[data-open-status]').first()).toHaveText('Estamos tomando pedidos');
  await otra.close();
});

test('home: no abre diciendo «no estamos tomando pedidos» mientras todavía llega el contacto del local', async ({ page }) => {
  // El contacto público es un segundo viaje al backend. Mientras no contestaba,
  // la home abría con la configuración por omisión: rótulo en rojo y las dos
  // modalidades de entrega ocultas, sobre una tienda que sí vende.
  let soltar;
  const retenido = new Promise((resolve) => { soltar = resolve; });
  let contestado = false;
  await openRuntimeCatalog(page, {
    view: 'home',
    beforeGoto: (target) => target.route('**/rest/v1/rpc/get_public_business_contact*', async (route) => {
      await retenido;
      contestado = true;
      await route.fallback();
    }),
  });
  await expect(page.locator('[data-view="home"] .home-best-card').first()).toBeVisible({ timeout: 20_000 });
  const chip = page.locator('[data-open-status]').first();
  const modalidades = () => page.evaluate(() => [...document.querySelectorAll('[data-fulfillment-option]')]
    .map((node) => `${node.dataset.fulfillmentOption}:${node.hidden ? 'oculta' : 'visible'}`).sort().join(','));
  expect(contestado, 'la prueba no llegó a mirar la ventana que protege').toBe(false);
  await expect(chip).toHaveText('Estamos tomando pedidos');
  await expect(chip).not.toHaveClass(/is-closed/);
  expect(await modalidades()).toBe('delivery:visible,pickup:visible');

  soltar();
  await expect.poll(() => contestado).toBe(true);
  await expect(chip).toHaveText('Estamos tomando pedidos');
  expect(await modalidades()).toBe('delivery:visible,pickup:visible');
});

test('home: lo que el backend contesta al volver a la pestaña se dibuja, sin esperar a otro render', async ({ page }) => {
  let abierto = true;
  const abre = new Date(Date.now() + 5 * 3600 * 1000).toISOString();
  const backend = await openRuntimeCatalog(page, {
    view: 'home',
    availability: () => (abierto ? availability({ hours_enforced: true }) : availability({ is_open: false, hours_enforced: true, next_open_at: abre })),
  });
  const chip = page.locator('[data-open-status]').first();
  await expect(chip).toHaveText('Estamos tomando pedidos');
  // El arranque pregunta más de una vez (comercio, dirección activa): se espera
  // a que la red quede quieta antes de cambiar la respuesta, así ninguna
  // consulta en vuelo del arranque se lleva el mérito.
  const redQuieta = async () => {
    let preguntas = -1;
    await expect.poll(async () => {
      const antes = preguntas;
      preguntas = backend.counters.availability;
      return preguntas === antes;
    }, { intervals: [700], timeout: 15_000 }).toBe(true);
    return preguntas;
  };
  const alArrancar = await redQuieta();

  // El local cerró con la pestaña abierta. Volver a ella reconcilia contra el
  // servidor —eso ya pasaba— y ahora la respuesta se dibuja: antes quedaba
  // guardada y la tienda seguía afirmando que tomaba pedidos.
  abierto = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(chip).toHaveText(/^Cerrado · Abrimos/);
  await expect(chip).toHaveClass(/is-closed/);
  expect(await redQuieta(), 'la vuelta no consultó al servidor').toBeGreaterThan(alArrancar);

  // Y al revés: abrió mientras la pestaña decía «Cerrado».
  abierto = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(chip).toHaveText('Estamos tomando pedidos');
  await expect(chip).not.toHaveClass(/is-closed/);
});

// ─── Lo que no se puede comprar ───────────────────────────────────────────────

test('alcohol en vidriera: la lista, la tarjeta y la ficha dicen lo mismo, y ninguna habla de precio', async ({ page }) => {
  await openRuntimeCatalog(page, {
    mapRow: (row) => (row.category === 'Cervezas' ? { ...row, available: false } : row),
  });
  await clickCatalogCategory(page, 'cervezas');
  const cards = page.locator(`${GRID} .product-card`);
  await expect(cards).toHaveCount(8);

  // Arriba: la causa real. Las ocho tarjetas tienen el precio a la vista.
  await expect(page.locator('[data-catalog-count]')).toHaveText('8 productos en Cervezas · todavía no están a la venta');
  await expect(page.locator(`${GRID} .catalog-none-buyable strong`)).toHaveText('Ninguno de estos 8 está a la venta todavía.');
  await expect(page.locator('[data-view="catalog"]')).not.toContainText('precio publicado');
  await expect(cards.first().locator('.price')).toContainText('2.500');

  // La tarjeta: la pastilla, el botón y la voz dicen «Próximamente».
  const first = cards.first();
  await expect(first.locator('.stock-pill')).toHaveText('Próximamente');
  await expect(first.locator('[data-add-product]')).toBeDisabled();
  await expect(first.locator('[data-add-product]')).toHaveText('Próximamente');
  await expect(first.locator('[data-product-detail]')).toHaveAttribute('aria-label', /^Ver .+\. Próximamente$/);
  const cardButton = await first.locator('[data-add-product]').evaluate((node) => ({
    background: getComputedStyle(node).backgroundImage,
    opacity: getComputedStyle(node).opacity,
  }));
  expect(cardButton.background, 'lo que no se compra lleva el degradado rojo de comprar').toBe('none');
  expect(cardButton.opacity).toBe('1');

  // La ficha: sin el sufijo «al pedido» y sin el rojo de comprar.
  await first.locator('[data-product-detail]').click();
  const modal = page.locator('[data-product-modal]');
  await expect(modal).toBeVisible();
  const cta = modal.locator('.modal-cart-control[data-add-product]');
  await expect(cta).toBeDisabled();
  await expect(cta).toHaveText('Próximamente');
  const sheet = await cta.evaluate((node) => ({
    suffix: getComputedStyle(node.querySelector('.add-text'), '::after').content,
    background: getComputedStyle(node).backgroundColor,
  }));
  expect(sheet.suffix, 'la ficha dice «Próximamente al pedido»').toBe('none');
  expect(sheet.background).not.toBe('rgb(208, 0, 13)');
  await expect(modal).toContainText('Todavía no está a la venta');

  // Y donde sí se puede comprar el sufijo sigue estando.
  await modal.locator('[data-close-modal]').click();
  await clickCatalogCategory(page, 'gaseosas');
  await page.locator(`${GRID} [data-product-detail]`).first().click();
  const comprable = modal.locator('.modal-cart-control[data-add-product]');
  await expect(comprable).toBeEnabled();
  expect(await comprable.evaluate((node) => getComputedStyle(node.querySelector('.add-text'), '::after').content)).toBe('" al pedido"');
});

test('un agotado se dice agotado: en la lista, en la pastilla y en voz alta', async ({ page }) => {
  await openRuntimeCatalog(page, {
    mapRow: (row) => (row.sku === 'fanta-naranja-2250ml' ? { ...row, stock: 0, available: false } : row),
  });
  const search = page.locator('[data-view="catalog"] [data-search-input]');
  await search.fill('fanta');
  const card = page.locator(`${GRID} .product-card`).first();
  await expect(card).toBeVisible();
  await expect(card.locator('.stock-pill')).toHaveText('Agotado');
  await expect(card.locator('[data-product-detail]')).toHaveAttribute('aria-label', /\. Agotado$/);
  await expect(page.locator('[data-catalog-count]')).toContainText('sin disponibilidad por ahora');
  await expect(page.locator(`${GRID} .catalog-none-buyable strong`)).toHaveText('Este producto no está disponible por ahora.');
});

// ─── El carrito ───────────────────────────────────────────────────────────────

test('carrito: la línea se llama como la tarjeta y dice la presentación una sola vez', async ({ page }) => {
  await openRuntimeCatalog(page);
  await clickCatalogCategory(page, 'gaseosas');
  const card = page.locator(`${GRID} .product-card`).first();
  const titulo = (await card.locator('h3').textContent()).trim();
  const presentacion = (await card.locator('.product-body > p').textContent()).trim();
  expect(presentacion.length).toBeGreaterThan(0);
  await card.locator('[data-add-product]').click();
  await page.locator('.mobile-nav [data-nav-view="cart"]').click();
  const linea = page.locator('[data-view="cart"] .cart-item').first();
  await expect(linea.locator('.cart-title')).toHaveText(titulo);
  await expect(linea.locator('.cart-meta')).toHaveText(presentacion);
  const texto = await linea.locator('.cart-item-info').textContent();
  expect(texto.split(presentacion).length - 1, `«${presentacion}» aparece más de una vez en la línea`).toBe(1);
  // El selector de cantidad se anuncia con su producto.
  await expect(linea.locator('.quantity-control')).toHaveAttribute('role', 'group');
});

test('carrito vacío: un aviso se ve y se anuncia', async ({ page }) => {
  await openRuntimeCatalog(page);
  await page.locator(`${GRID} .product-card [data-add-product]`).first().click();
  const toast = page.locator('[data-toast]');
  // El aviso de «agregado» tiene que haberse ido: lo que se mide es el que
  // emite vaciar el carrito, no uno anterior que siguiera vivo.
  await expect(toast).toHaveClass(/hidden/, { timeout: 10_000 });
  await page.locator('.mobile-nav [data-nav-view="cart"]').click();
  await page.locator('[data-view="cart"] [data-clear-cart]').click();
  await page.locator('[data-clear-cart-confirm]').click();
  await expect(page.locator('[data-view="cart"] .cart-empty-state')).toBeVisible();
  // Con productos, el aviso vive en la banda del carrito; sin productos esa
  // banda no existe y antes «Carrito vaciado» no salía por ningún lado.
  await expect(page.locator('[data-cart-notice]')).toBeHidden();
  await expect(toast).toBeVisible();
  await expect(toast).toHaveText('Carrito vaciado.');
});

// ─── La ficha ─────────────────────────────────────────────────────────────────

test('ficha: «atrás» la cierra sin mover el catálogo, y cerrarla a mano no deja un «atrás» de más', async ({ page }) => {
  await openRuntimeCatalog(page, { view: 'home' });
  await page.locator('[data-nav-view="catalog"]:visible').first().click();
  await expect(page.locator(`${GRID} .product-card`)).toHaveCount(46);
  const state = () => page.evaluate(() => ({
    view: document.querySelector('.app-view.is-active')?.dataset.view,
    scrollY: Math.round(window.scrollY),
    sheet: Boolean(document.querySelector('[data-product-modal]')?.open),
    entries: window.history.length,
    sheetEntry: window.history.state?.sheet || '',
  }));

  const trigger = page.locator(`${GRID} [data-product-detail]`).nth(8);
  await trigger.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const antes = await state();
  expect(antes.scrollY).toBeGreaterThan(200);

  await trigger.click();
  const modal = page.locator('[data-product-modal]');
  await expect(modal).toBeVisible();
  // Con la ficha abierta el fondo no se desplaza.
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).toBe('hidden');

  await page.goBack();
  await expect(modal).toBeHidden();
  const trasAtras = await state();
  expect(trasAtras.view, '«atrás» se llevó la vista de abajo').toBe('catalog');
  expect(Math.abs(trasAtras.scrollY - antes.scrollY), 'el catálogo perdió su posición').toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe('hidden');
  await expect(trigger).toBeFocused();

  // Cerrar con ✕, con Escape o agregando consume la entrada de la ficha.
  for (const cerrar of [
    () => modal.locator('[data-close-modal]').click(),
    () => page.keyboard.press('Escape'),
    () => modal.locator('.modal-cart-control[data-add-product]').click(),
  ]) {
    await trigger.click();
    await expect(modal).toBeVisible();
    expect((await state()).sheetEntry).toBe('detail');
    await cerrar();
    await expect(modal).toBeHidden();
    await expect.poll(async () => (await state()).sheetEntry).toBe('');
    const despues = await state();
    expect(despues.entries, 'cerrar la ficha dejó una entrada de historial').toBe(trasAtras.entries);
    expect(despues.view).toBe('catalog');
  }

  // Entonces un solo «atrás» sale del catálogo, como siempre.
  await page.goBack();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
});

test('ficha: abrir otra mientras se cierra la primera no la cierra sola ni la deja sin su «atrás»', async ({ page }) => {
  await openRuntimeCatalog(page, { view: 'home' });
  await page.locator('[data-nav-view="catalog"]:visible').first().click();
  await expect(page.locator(`${GRID} .product-card`)).toHaveCount(46);
  const state = () => page.evaluate(() => ({
    view: document.querySelector('.app-view.is-active')?.dataset.view,
    entries: window.history.length,
    sheetEntry: window.history.state?.sheet || '',
  }));
  const modal = page.locator('[data-product-modal]');
  const trigger = page.locator(`${GRID} [data-product-detail]`).nth(8);
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(modal).toBeVisible();
  const conFicha = await state();
  expect(conFicha.sheetEntry).toBe('detail');

  // Un segundo toque rápido: se cierra una ficha y se abre otra en el mismo
  // turno, antes de que el historial termine de consumir la entrada de la
  // primera. La segunda no puede cerrarse sola ni quedarse sin su entrada.
  await trigger.click();
  await expect(modal).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('[data-product-modal] [data-close-modal]').click();
    document.querySelectorAll('[data-product-grid] [data-product-detail]')[9].click();
  });
  await expect(modal).toBeVisible();
  await expect.poll(async () => (await state()).sheetEntry).toBe('detail');
  await page.waitForTimeout(500);
  await expect(modal, 'la ficha recién abierta se cerró sola').toBeVisible();
  // La entrada de la segunda ocupa el lugar de la primera: ni una de más.
  expect((await state()).entries).toBe(trasAtras.entries);
  await page.goBack();
  await expect(modal).toBeHidden();
  expect((await state()).view).toBe('catalog');

  // Entonces un solo «atrás» sale del catálogo, como siempre.
  await page.goBack();
  await expect(page.locator('[data-view="home"]')).toBeVisible();
});

// ─── La búsqueda ──────────────────────────────────────────────────────────────

test('buscar en el catálogo no vuelve a dibujar la home, y los resultados son los mismos', async ({ page }) => {
  await openRuntimeCatalog(page);
  // Los chips de la home dependen de la consulta: con el render completo, la
  // primera tecla les cambiaba el chip activo aunque la home estuviera oculta.
  await page.evaluate(() => {
    window.__homeStripWrites = 0;
    new MutationObserver((records) => { window.__homeStripWrites += records.length; })
      .observe(document.querySelector('[data-home-category-strip]'), {
        childList: true, subtree: true, attributes: true, characterData: true,
      });
  });
  const search = page.locator('[data-view="catalog"] [data-search-input]');
  await search.click();
  await page.keyboard.type('heineken', { delay: 20 });
  await expect(page.locator(`${GRID} .product-card`)).toHaveCount(1);
  await expect(page.locator('[data-catalog-title]')).toHaveText('Resultados');
  await expect(page.locator('[data-catalog-count]')).toHaveText('1 producto');
  expect(await page.evaluate(() => window.__homeStripWrites), 'una tecla en el catálogo redibujó la home').toBe(0);

  // Al volver a la home, la home se entera: se dibuja entera con la consulta.
  await goHome(page);
  await expect(page.locator('[data-home-category-strip] [data-category-id="all"]')).not.toHaveClass(/active/);
  expect(await page.evaluate(() => window.__homeStripWrites)).toBeGreaterThan(0);
  await expect(page.locator('[data-view="home"] [data-search-input]')).toHaveValue('heineken');

  // Y limpiar desde el catálogo devuelve las 46.
  await page.locator('[data-nav-view="catalog"]:visible').first().click();
  await page.locator('[data-view="catalog"] .search-clear').click();
  await expect(page.locator(`${GRID} .product-card`)).toHaveCount(46);
});

test('se puede ESCRIBIR una búsqueda de varias palabras: el espacio no se pierde', async ({ page }) => {
  await openRuntimeCatalog(page);
  const search = page.locator('[data-view="catalog"] [data-search-input]');
  const cards = page.locator(`${GRID} .product-card`);
  const escribir = async (texto) => {
    await search.fill('');
    await expect(cards).toHaveCount(46);
    await search.click();
    // Tecla por tecla, como un teclado de verdad: `fill` escribe todo junto y
    // por eso nunca vio que el campo se reescribía después de cada espacio.
    await page.keyboard.type(texto, { delay: 25 });
  };

  // Medido antes del arreglo: «coca sin azucar» quedaba en «cocasinazucar» y la
  // góndola respondía «No encontramos…» sobre un producto que el local vende.
  await escribir('coca sin azucar');
  await expect(search).toHaveValue('coca sin azucar');
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator('h3')).toHaveText('Coca-Cola Sin Azúcar');
  await expect(page.locator('[data-catalog-similar]')).toHaveCount(0);

  // Las palabras de enlace no vacían la góndola.
  await escribir('cerveza en lata');
  await expect(search).toHaveValue('cerveza en lata');
  await expect.poll(() => cards.count()).toBeGreaterThan(0);
  await expect(page.locator(`${GRID} .empty-state`)).toHaveCount(0);

  // Ni el punto que el teclado agrega solo.
  await escribir('heineken.');
  await expect(cards).toHaveCount(1);
  await expect(page.locator('[data-catalog-similar]')).toHaveCount(0);

  // Y lo que no está sigue sin estar.
  await escribir('vodka de frutilla');
  await expect(cards).toHaveCount(0);
  await expect(page.locator(`${GRID} .empty-state strong`)).toHaveText('No encontramos «vodka de frutilla»');
});

test('afinar desde la home una búsqueda que ya existe tampoco pega las palabras', async ({ page }) => {
  await openRuntimeCatalog(page);
  const search = page.locator('[data-view="catalog"] [data-search-input]');
  const cards = page.locator(`${GRID} .product-card`);
  await search.click();
  await page.keyboard.type('coca', { delay: 25 });
  await expect(search).toHaveValue('coca');
  // La primera tecla en el buscador de la home es un espacio: todavía no
  // cambia la consulta, y aun así tiene que viajar al buscador del catálogo.
  // Si no, «coca» + « zero» terminaba en «cocazero» y cero resultados.
  await goHome(page);
  const homeSearch = page.locator('[data-view="home"] [data-search-input]');
  await expect(homeSearch).toHaveValue('coca');
  await homeSearch.focus();
  await homeSearch.evaluate((node) => node.setSelectionRange(node.value.length, node.value.length));
  await page.keyboard.type(' zero', { delay: 25 });
  await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  await expect(search).toHaveValue('coca zero');
  await expect(cards).toHaveCount(1);
});

test('una combinación de filtros sin resultados lo dice y ofrece quitar los filtros, no todo', async ({ page }) => {
  await openRuntimeCatalog(page);
  await clickCatalogCategory(page, 'cervezas');
  await expect(page.locator(`${GRID} .product-card`)).toHaveCount(8);
  const filters = page.locator('[data-catalog-filters]');
  await filters.locator('summary').click();
  await filters.locator('[data-catalog-filter="alcohol"]').selectOption('without');
  await filters.locator('[data-close-catalog-filters]').click();

  const empty = page.locator(`${GRID} .empty-state`);
  await expect(empty).toBeVisible();
  await expect(empty.locator('strong')).toHaveText('Ningún producto coincide con los filtros.');
  await expect(empty).not.toContainText('esta categoría');
  await empty.locator('[data-reset-catalog-filters]').click();
  // Se fueron los filtros; el rubro elegido sigue.
  await expect(page.locator(`${GRID} .product-card`)).toHaveCount(8);
  await expect(page.locator('[data-catalog-title]')).toHaveText('Cervezas');

  // Los filtros sólo cargan con la culpa si sin ellos habría algo: con uno
  // puesto, «Favoritos» vacío sigue siendo «todavía no guardaste favoritos».
  await filters.locator('summary').click();
  await filters.locator('[data-catalog-filter="alcohol"]').selectOption('without');
  await filters.locator('[data-close-catalog-filters]').click();
  await clickCatalogCategory(page, 'favorites');
  await expect(empty.locator('strong')).toHaveText('Todavía no guardaste favoritos.');
  await expect(empty.locator('[data-reset-catalog-filters]')).toBeVisible();
});

// ─── El catálogo que no llega ─────────────────────────────────────────────────

test('un catálogo que no contesta deja de decir «abriendo» y ofrece reintentar', async ({ page }) => {
  test.setTimeout(60_000);
  let colgado = true;
  await openRuntimeCatalog(page, {
    view: 'home',
    waitForCatalog: false,
    beforeGoto: (target) => target.route('**/rest/v1/products*', (route) => {
      if (colgado) return undefined; // nunca se contesta
      return route.fallback();
    }),
  });
  const entrada = page.locator('[data-view="home"] [data-production-catalog-gate]');
  await expect(entrada.locator('[data-production-catalog-title]')).toHaveText('Abriendo la tienda…');
  await expect(entrada.locator('[data-store-entry-retry]')).toBeHidden();

  await expect(entrada.locator('[data-production-catalog-title]')).toHaveText('La tienda está tardando más de lo normal', { timeout: 25_000 });
  await expect(entrada.locator('[data-production-catalog-message]')).toHaveText('Revisá tu conexión y probá de nuevo.');
  await expect(entrada.locator('[data-store-entry-retry]')).toBeVisible();
  // Nada técnico en lo que la tarjeta DICE (la dirección del local lleva número).
  for (const parte of ['[data-production-catalog-title]', '[data-production-catalog-message]']) {
    await expect(entrada.locator(parte)).not.toContainText(/timeout|error|\b\d{3}\b/i);
  }

  // Reintentar es una recarga: con el catálogo contestando, la tienda abre.
  colgado = false;
  await entrada.locator('[data-store-entry-retry]').click();
  await expect(page.locator('[data-view="home"] .home-best-card').first()).toBeVisible({ timeout: 20_000 });
  await expect(entrada).toBeHidden();
});
