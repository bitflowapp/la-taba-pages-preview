import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  fillCheckout,
  gotoDemoReset,
  installPageGuards,
  seedCartAboveMinimum,
  waitForToast,
} from './helpers.mjs';

/*
 * REGRESIÓN CRUZADA de la candidata integrada.
 *
 * CÓMO SE CORRE: copiar este archivo a `tests/e2e/` del worktree
 *   D:\1212\worktrees\taba2-customer-experience  y ejecutar
 *   TABA_E2E_HTTP_PORT=8099 TABA_E2E_RELAY_PORT=18799 \
 *     npx playwright test zz-regresion-cruzada --project=chromium
 * NO se commitea en la rama: es el arnés de la integración, no producto.
 *
 * Las suites de cada rama ya prueban su propio trabajo. Lo que ninguna de las
 * dos podía probar es lo que esta candidata inventa: que las dos cosas ocurran
 * en la MISMA sesión, sobre el mismo estado, en el mismo navegador. Un cliente
 * no usa "la home del catálogo" y "el mapa del tracking": usa un producto.
 *
 * Recorrido A — home → historia → categoría → producto → carrito → recarga
 * Recorrido B — pedido activo → tracking → pan/zoom → follow → señal caída y vuelta
 * Y el cierre: volver al catálogo, para que si el mapa dejó el estado roto se vea.
 */

const ANCHOS = [320, 360, 390, 432];
const SALIDA = 'D:/1212/artifacts/taba2-customer-experience-integration/capturas';
fs.mkdirSync(SALIDA, { recursive: true });

/*
 * Las historias salen del backend. En demo se declara el origen a mano, igual
 * que hace la suite de la home: sin esto el recorrido "home → historia" no
 * existiría y estaríamos probando una home sin la pieza que se quiere probar.
 */
const HISTORIAS = [
  {
    id: 'story-combo', business_id: 'la-taba-2', title: 'Combo de la semana',
    media_type: 'image', media_url: 'assets/products/beverage-placeholder.svg',
    thumbnail_url: 'assets/products/beverage-placeholder.svg',
    starts_at: null, expires_at: null, priority: 10,
    cta_type: 'category', cta_target: 'cervezas', is_highlight: true, published: true,
  },
  {
    id: 'story-frio', business_id: 'la-taba-2', title: 'Siempre frío',
    media_type: 'image', media_url: 'assets/products/beverage-placeholder.svg',
    thumbnail_url: 'assets/products/beverage-placeholder.svg',
    starts_at: null, expires_at: null, priority: 1,
    cta_type: 'category', cta_target: 'energizantes', is_highlight: false, published: true,
  },
];

const registro = [];

async function captura(page, nombre) {
  await page.screenshot({ path: path.join(SALIDA, `${nombre}.png`), fullPage: false });
}

/** Scroll horizontal: a estos anchos es el defecto que más rápido se nota. */
async function desborde(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function ponerRiderEnCamino(page, { lat = -38.951, lng = -68.059 } = {}) {
  await page.evaluate(({ lat: latitud, lng: longitud }) => {
    const key = 'la_taba_mvp_v4_state';
    const state = JSON.parse(localStorage.getItem(key));
    const order = state.orders[0];
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    order.status = 'on_the_way';
    order.statusHistory = [...(order.statusHistory || []), { status: 'on_the_way', at: now }];
    order.tracking = {
      lastLocation: {
        source: 'gps', lat: latitud, lng: longitud, accuracy: 12,
        gpsStatus: 'active', lastFixAt: now, timestamp: nowMs,
      },
      source: 'gps',
      updatedAt: now,
    };
    state.lastOrderId = order.id;
    localStorage.setItem(key, JSON.stringify(state));
  }, { lat, lng });
}

async function envejecerSenal(page, ms) {
  await page.evaluate((atraso) => {
    const key = 'la_taba_mvp_v4_state';
    const state = JSON.parse(localStorage.getItem(key));
    const order = state.orders.find((c) => c.id === state.lastOrderId) || state.orders[0];
    const viejo = Date.now() - atraso;
    order.tracking.lastLocation.timestamp = viejo;
    order.tracking.lastLocation.lastFixAt = new Date(viejo).toISOString();
    localStorage.setItem(key, JSON.stringify(state));
  }, ms);
}

for (const ancho of ANCHOS) {
  test(`${ancho}px · el catálogo lleva a comprar y el mapa sigue funcionando en la misma sesión`, async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({
      viewport: { width: ancho, height: 844 },
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const guards = installPageGuards(page);
    const paso = (nombre, detalle) => registro.push({ ancho, paso: nombre, ...detalle });

    // ── RECORRIDO A ────────────────────────────────────────────────────────
    // Sin `installBrowserStubs`: ese helper limpia localStorage en CADA
    // navegación, y el recorrido B necesita que el pedido sobreviva a la
    // recarga. El reset lo hace `?reset=1` una sola vez, que es lo correcto.
    await page.addInitScript((f) => { window.TABA2_STORIES = f; }, HISTORIAS);
    await gotoDemoReset(page, '/?reset=1&demo=1');
    await page.waitForSelector('[data-view="home"] .home-best-card');
    await captura(page, `${ancho}-a1-home`);
    paso('home', { desborde: await desborde(page) });

    // La jerarquía nueva del catálogo: hero, historias y rails conviven.
    const hero = page.locator('[data-home-hero-promo], .home-hero-promo').first();
    const historias = page.locator('.brand-story-circle');
    const cuantasHistorias = await historias.count();
    paso('home-composicion', {
      heroVisible: await hero.isVisible().catch(() => false),
      historias: cuantasHistorias,
    });
    expect(cuantasHistorias, `${ancho}px: la home tiene historias`).toBeGreaterThan(0);

    // historia → su CTA lleva a la categoría que promete
    await historias.first().click();
    const modalHistoria = page.locator('[data-stories-modal]');
    await expect(modalHistoria).toBeVisible();
    await captura(page, `${ancho}-a2-historia`);
    paso('historia', { desborde: await desborde(page) });

    // categoría, entrando POR la historia
    await modalHistoria.locator('[data-story-cta]').click();
    await expect(page.locator('[data-view="catalog"]')).toBeVisible();
    await page.waitForTimeout(600);
    await captura(page, `${ancho}-a3-categoria`);
    paso('categoria', { desborde: await desborde(page), url: page.url() });

    // producto
    await page.locator('[data-product-grid] [data-product-detail] >> visible=true').first().click();
    await expect(page.locator('[data-product-modal]')).toBeVisible();
    await captura(page, `${ancho}-a4-producto`);
    paso('producto', { desborde: await desborde(page) });
    await page.locator('[data-close-modal] >> visible=true').first().click();
    await expect(page.locator('[data-product-modal]')).toBeHidden();

    // carrito
    const productId = await seedCartAboveMinimum(page);
    const contadorAntes = await page.locator('[data-cart-count]').first().textContent();
    await captura(page, `${ancho}-a5-carrito`);
    paso('carrito', { productId, contador: contadorAntes, desborde: await desborde(page) });
    expect(Number(contadorAntes), `${ancho}px: el carrito tiene items`).toBeGreaterThan(0);

    // recarga: el carrito tiene que sobrevivir
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached' });
    const contadorDespues = await page.locator('[data-cart-count]').first().textContent();
    paso('carrito-tras-recarga', { contador: contadorDespues });
    expect(contadorDespues, `${ancho}px: el carrito persiste la recarga`).toBe(contadorAntes);

    // ── RECORRIDO B, en la MISMA sesión ────────────────────────────────────
    await page.locator('[data-floating-cart] >> visible=true').first().click();
    await fillCheckout(page, {
      name: 'Cliente Integracion',
      phone: '2995551313',
      street: 'Roca 222',
      neighborhood: 'Neuquen centro',
      reference: 'Porton negro',
      payment: 'transfer',
      deliveryMode: 'delivery',
    });
    // El carrito viene de la góndola de cervezas —entramos por la historia—,
    // así que la puerta de edad aplica. Es parte del recorrido real, no un
    // estorbo del arnés.
    const edad = page.locator('[data-age-confirmation]');
    if (await edad.isVisible().catch(() => false)) {
      await edad.locator('input[type="checkbox"]').check();
      paso('puerta-de-edad', { confirmada: true });
    }
    await page.getByRole('button', { name: /Confirmar pedido/i }).click();
    await waitForToast(page, /Pedido confirmado/);
    await expect(page.locator('[data-view="tracking"]')).toBeVisible();

    await ponerRiderEnCamino(page);
    await page.reload();
    await page.goto('/?demo=1#tracking');
    await expect(page.locator('[data-view="tracking"]')).toBeVisible();

    const mapa = page.locator('[data-tracking-panel] [data-real-map]');
    const marcador = page.locator('[data-tracking-panel] .lt-rider-marker');
    await expect(mapa).toBeVisible();
    await expect(marcador).toBeVisible();
    await expect(mapa).toHaveAttribute('data-map-camera', 'follow');
    const etiquetaViva = await page.locator('[data-tracking-panel] [data-map-meta-text]').textContent();
    await captura(page, `${ancho}-b1-tracking`);
    paso('tracking', { camara: 'follow', etiqueta: etiquetaViva, desborde: await desborde(page) });
    expect(etiquetaViva).toMatch(/^Ubicación en vivo · (?:ahora|hace \d+ s)$/);

    /*
     * pan/zoom. El mapa monta con `cooperativeGestures`: el arrastre de un
     * dedo se lo deja a la página, y lo que el mapa toma es el pellizco de dos
     * dedos —que Playwright no sintetiza— o Ctrl+rueda, su equivalente de
     * escritorio. Lo que se observa NO es un número de zoom (el mapa no expone
     * ninguno) sino el estado de cámara que el propio producto publica en
     * `data-map-camera`: es la máquina que decide si sigue al rider o lo dejó
     * explorar. Si el gesto entra, tiene que pasar a `explore` SOLO.
     */
    const camaraAntes = await mapa.getAttribute('data-map-camera');
    await mapa.hover();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await page.waitForTimeout(1200);
    const camaraTrasGesto = await mapa.getAttribute('data-map-camera');
    const cta = page.locator('[data-tracking-panel] [data-map-follow-cta]');
    const ctaSolo = await cta.isVisible().catch(() => false);
    // ¿Hay MapLibre de verdad debajo? Sin tiles el producto cae a un respaldo
    // estático, y sobre un respaldo ningún gesto significaría nada: el
    // resultado del gesto sólo se puede leer sabiendo esto.
    const motor = await page.evaluate(() => ({
      canvasMapLibre: !!document.querySelector('[data-tracking-panel] .maplibregl-canvas'),
      contenedor: !!document.querySelector('[data-tracking-panel] .maplibregl-map'),
      respaldo: !!document.querySelector('[data-tracking-panel] [data-map-fallback]:not([hidden])'),
    }));
    paso('pan-zoom', {
      camaraAntes,
      camaraTrasGesto,
      gestoSuspendioElSeguimiento: camaraTrasGesto === 'explore',
      ctaAparecioSolo: ctaSolo,
      ...motor,
    });

    // Si el gesto real no alcanzó a suspender el seguimiento, se le saca la
    // tapa al CTA para poder MEDIRLO igual. Queda dicho cuál de los dos
    // caminos se usó en cada ancho, en vez de esconderlo.
    if (!ctaSolo) {
      await page.addStyleTag({ content: '[data-map-follow-cta] { display: inline-flex !important; }' });
    }
    await expect(cta).toBeVisible();
    await expect(cta).toContainText('Volver al Rider');
    const cajaCta = await cta.boundingBox();
    const cajaMapa = await mapa.boundingBox();
    await cta.click();
    await expect(mapa).toHaveAttribute('data-map-camera', 'follow');
    await captura(page, `${ancho}-b2-volver-al-rider`);
    paso('volver-al-rider', {
      dentroDelMapa: cajaCta.x >= cajaMapa.x - 1
        && cajaCta.x + cajaCta.width <= cajaMapa.x + cajaMapa.width + 1,
      alto: Math.round(cajaCta.height),
      desborde: await desborde(page),
    });
    expect(Math.round(cajaCta.height), `${ancho}px: el CTA es tocable`).toBeGreaterThanOrEqual(36);

    // señal caída
    await envejecerSenal(page, 95_000);
    await page.reload();
    await page.goto('/?demo=1#tracking');
    await expect(mapa).toBeVisible();
    await expect(marcador).toBeVisible();
    const etiquetaCaida = await page.locator('[data-tracking-panel] [data-map-meta-text]').textContent();
    await captura(page, `${ancho}-b3-sin-senal`);
    paso('sin-senal', { etiqueta: etiquetaCaida, marcadorVisible: true, desborde: await desborde(page) });
    expect(etiquetaCaida).toMatch(/^Sin conexión · última ubicación hace \d+ min$/);

    // y vuelve
    await ponerRiderEnCamino(page, { lat: -38.9505, lng: -68.0585 });
    await page.reload();
    await page.goto('/?demo=1#tracking');
    await expect(mapa).toBeVisible();
    const etiquetaVuelta = await page.locator('[data-tracking-panel] [data-map-meta-text]').textContent();
    await captura(page, `${ancho}-b4-reconectado`);
    paso('reconectado', { etiqueta: etiquetaVuelta, desborde: await desborde(page) });
    expect(etiquetaVuelta).toMatch(/^Ubicación en vivo · (?:ahora|hace \d+ s)$/);

    // ── y de vuelta al catálogo: el mapa no dejó el estado roto ────────────
    // Por el logo del encabezado, NO por la barra inferior: en la vista de
    // seguimiento esa barra se oculta a propósito para que el mapa ocupe la
    // pantalla. La regla vive en responsive.css y ya estaba en da56ce9, la base
    // común: no la trae ninguna de las dos ramas.
    await page.locator('.topbar [data-nav-view="home"]').first().click();
    await expect(page.locator('[data-view="home"]')).toBeVisible();
    await expect(page.locator('.brand-story-circle').first()).toBeVisible();
    await captura(page, `${ancho}-c1-vuelta-a-la-home`);
    paso('vuelta-a-la-home', { desborde: await desborde(page) });

    for (const entrada of registro.filter((r) => r.ancho === ancho)) {
      expect(entrada.desborde ?? 0, `${ancho}px sin scroll horizontal en ${entrada.paso}`).toBeLessThanOrEqual(0);
    }
    await guards.assertClean();
    fs.writeFileSync(
      path.join(SALIDA, '..', 'regresion-cruzada.json'),
      JSON.stringify(registro, null, 2),
    );
    await context.close();
  });
}
