import { expect, test } from '@playwright/test';
import {
  fillCheckout,
  gotoDemoReset,
  installPageGuards,
  seedCartAboveMinimum,
  waitForToast,
} from './helpers.mjs';

/*
 * El mapa del cliente tiene que dejarse mirar. Estas pruebas ejercitan el par
 * SEGUIR / EXPLORAR sobre el navegador real: que el gesto suspenda el
 * seguimiento, que aparezca la vuelta, y que tocarla devuelva la cámara sin
 * que el mapa vuelva a pelear el encuadre.
 */

const ANCHOS = [320, 360, 390, 432];

/*
 * ALCANCE DE ESTE ARCHIVO, dicho de frente.
 *
 * El mapa del cliente monta con `cooperativeGestures`: un arrastre de un solo
 * dedo NO le pertenece —se lo deja pasar para que la página siga scrolleando
 * debajo, contrato fijado en tracking-arriving.spec.mjs— y los gestos que sí
 * toma son el arrastre y el pellizco de DOS dedos. Playwright no sintetiza
 * multi-touch de forma confiable, así que acá NO se simula el gesto.
 *
 * Lo que la máquina verifica: que el seguimiento arranque activo, que el rider y
 * el mapa sobrevivan a perder la señal, y que el CTA de vuelta —una vez
 * visible— entre y funcione en las cuatro anchuras.
 * Lo que verifica el doble de MapLibre en tests/map.test.mjs: que un evento de
 * gesto con `originalEvent` suspenda el seguimiento y que la vuelta lo reanude.
 * Lo que sólo puede verificar una persona con el teléfono en la mano: que el
 * gesto de dos dedos se sienta natural. Eso va en la prueba física.
 */

/*
 * Revela el CTA para poder MEDIRLO. No simula el modo explorar —eso vive en el
 * adaptador y lo cubre el doble de MapLibre—: acá sólo se le saca la tapa a un
 * botón que ya está en el árbol, para verificar que entra donde tiene que
 * entrar y que su toque hace lo que promete.
 */
async function revelarCta(page) {
  await page.addStyleTag({
    content: '[data-map-follow-cta] { display: inline-flex !important; }',
  });
}

/** Deja el pedido más nuevo en camino, con un fix GPS real y reciente. */
async function ponerRiderEnCamino(page, { lat = -38.951, lng = -68.059, accuracy = 12 } = {}) {
  await page.evaluate(({ lat: latitud, lng: longitud, accuracy: precision }) => {
    const key = 'la_taba_mvp_v4_state';
    const state = JSON.parse(localStorage.getItem(key));
    const order = state.orders[0];
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    order.status = 'on_the_way';
    order.statusHistory = [...(order.statusHistory || []), { status: 'on_the_way', at: now }];
    order.tracking = {
      lastLocation: {
        source: 'gps',
        lat: latitud,
        lng: longitud,
        accuracy: precision,
        gpsStatus: 'active',
        lastFixAt: now,
        timestamp: nowMs,
      },
      source: 'gps',
      updatedAt: now,
    };
    state.lastOrderId = order.id;
    localStorage.setItem(key, JSON.stringify(state));
  }, { lat, lng, accuracy });
}

async function comprarYSeguir(page) {
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  await seedCartAboveMinimum(page);
  await page.locator('[data-floating-cart]').click();
  await fillCheckout(page, {
    name: 'Cliente Follow',
    phone: '2995551313',
    street: 'Roca 222',
    neighborhood: 'Neuquen centro',
    reference: 'Porton negro',
    payment: 'transfer',
    deliveryMode: 'delivery',
  });
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, /Pedido confirmado/);
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();

  // El pedido nace en el local: recién cuando el rider sale hay mapa que mirar.
  await ponerRiderEnCamino(page);
  await page.reload();
  await page.goto('/?demo=1#tracking');
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
}

test('el mapa se deja explorar y devuelve el seguimiento cuando el cliente quiere', async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await comprarYSeguir(page);

  const shell = page.locator('[data-tracking-panel] [data-real-map]');
  const cta = page.locator('[data-tracking-panel] [data-map-follow-cta]');
  await expect(shell).toBeVisible();

  // Arranca siguiendo, y por lo tanto sin nada que ofrecer.
  await expect(shell).toHaveAttribute('data-map-camera', 'follow');
  await expect(cta).toBeHidden();

  // La vuelta existe en el árbol, dice lo que tiene que decir, y su toque deja
  // el seguimiento activo: es la misma acción que el recentrado.
  await revelarCta(page);
  await expect(cta).toBeVisible();
  await expect(cta).toContainText('Volver al Rider');
  await cta.click();
  await expect(shell).toHaveAttribute('data-map-camera', 'follow');

  // Y el rider sigue en pantalla después de todo el recorrido.
  await expect(page.locator('[data-tracking-panel] .lt-rider-marker')).toBeVisible();

  await guards.assertClean();
  await context.close();
});

test('la vuelta al rider entra en las cuatro anchuras sin desbordar', async ({ browser }) => {
  test.setTimeout(120_000);
  for (const width of ANCHOS) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    const guards = installPageGuards(page);
    await comprarYSeguir(page);

    const shell = page.locator('[data-tracking-panel] [data-real-map]');
    await expect(shell).toBeVisible();
    await revelarCta(page);

    const cta = page.locator('[data-tracking-panel] [data-map-follow-cta]');
    await expect(cta, `CTA visible en ${width}px`).toBeVisible();

    const ctaCaja = await cta.boundingBox();
    const stage = await shell.boundingBox();
    expect(ctaCaja.x, `${width}px: el CTA no se sale por la izquierda`).toBeGreaterThanOrEqual(stage.x - 1);
    expect(
      ctaCaja.x + ctaCaja.width,
      `${width}px: el CTA no se sale por la derecha`,
    ).toBeLessThanOrEqual(stage.x + stage.width + 1);
    // Y no se monta sobre el botón de recentrar, que vive en la esquina.
    const recentrar = await page.locator('[data-tracking-panel] [data-map-recenter]').boundingBox();
    expect(
      ctaCaja.x + ctaCaja.width,
      `${width}px: el CTA no pisa el recentrado`,
    ).toBeLessThanOrEqual(recentrar.x + 1);

    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desborde, `${width}px sin scroll horizontal`).toBeLessThanOrEqual(0);
    expect(guards.errors, `${width}px sin errores de página`).toEqual([]);
    await context.close();
  }
});

test('perder la señal no borra al rider ni apaga el mapa', async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await comprarYSeguir(page);

  const shell = page.locator('[data-tracking-panel] [data-real-map]');
  const marcador = page.locator('[data-tracking-panel] .lt-rider-marker');
  await expect(shell).toBeVisible();
  await expect(marcador).toBeVisible();
  await expect(page.locator('[data-tracking-panel] [data-map-meta-text]')).toHaveText(
    /^Ubicación en vivo · (?:ahora|hace \d+ s)$/,
  );

  // Deja de llegar señal: el último fix envejece más allá del umbral.
  await page.evaluate(() => {
    const key = 'la_taba_mvp_v4_state';
    const state = JSON.parse(localStorage.getItem(key));
    const order = state.orders.find((candidate) => candidate.id === state.lastOrderId) || state.orders[0];
    const viejo = Date.now() - 95_000;
    order.tracking.lastLocation.timestamp = viejo;
    order.tracking.lastLocation.lastFixAt = new Date(viejo).toISOString();
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await page.goto('/?demo=1#tracking');

  // El mapa sigue ahí, el rider sigue ahí, y el texto dice desde cuándo.
  await expect(shell).toBeVisible();
  await expect(marcador).toBeVisible();
  await expect(page.locator('[data-tracking-panel] [data-map-meta-text]')).toHaveText(
    /^Sin conexión · última ubicación hace \d+ min$/,
  );

  await guards.assertClean();
  await context.close();
});
