/*
 * El service worker con el worker REALMENTE ACTIVO, contra un borde que
 * contesta mal de todas las formas en que un borde contesta mal.
 *
 * El gate corre con `serviceWorkers: 'block'` casi entero, y por eso nadie veía
 * el P1 del retorno desde Mercado Pago: el worker es quien decide qué recibe el
 * documento, y el worker no estaba. Estas pruebas lo encienden y lo ejercen.
 *
 * Lo que se cubre acá y no cubría la suite del retorno, que mira UN camino:
 *   - la matriz entera de fallas, incluidas las dos que no se pueden ver con el
 *     `content-type` (el tipo mentido y el cuerpo cortado) y la que no tiene ni
 *     error ni estado (la red colgada);
 *   - los módulos, no sólo las hojas de estilo;
 *   - la primera visita sobre un portal cautivo, que es cuando se ESCRIBE la
 *     caché: hasta el arreglo, ahí se guardaba la página del portal como
 *     `styles.css` y la defensa de lectura quedaba defendiendo basura;
 *   - el cliente recurrente y la pestaña reabierta;
 *   - dos pestañas contra el mismo worker.
 *
 * Los `fetch` de un worker NO pasan por `page.route()`: por eso el borde se
 * degrada del lado del servidor, con `/__edge-fault` del relay de pruebas.
 */
import { expect, test } from '@playwright/test';
import { esperarExperienciaComercial, medirExperienciaComercial } from './helpers.mjs';

test.use({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
test.describe.configure({ timeout: 120_000 });

const ESTILOS = 'styles.css?v=54';

async function degradarBorde(request, modo) {
  const respuesta = await request.get(`/__edge-fault?mode=${modo}`);
  expect(respuesta.ok()).toBe(true);
  expect((await respuesta.json()).mode).toBe(modo);
}

/** Cliente recurrente de verdad: worker instalado, activo y precache terminado. */
async function abrirTiendaConWorkerCaliente(page) {
  await page.goto('/?demo=1#home', { waitUntil: 'load' });
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached' });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  await page.waitForFunction(async () => {
    const claves = await caches.keys();
    if (!claves.length) return false;
    const cache = await caches.open(claves[0]);
    return (await cache.keys()).length > 100;
  }, null, { timeout: 40_000 });
}

/** Qué guardó realmente el worker para una URL, sin creerle a nadie. */
async function loGuardado(page, url) {
  return page.evaluate(async (recurso) => {
    const guardada = await caches.match(new URL(recurso, location.href).href);
    if (!guardada) return null;
    const cuerpo = await guardada.clone().text();
    return {
      status: guardada.status,
      tipo: guardada.headers.get('content-type') || '',
      arranque: cuerpo.trimStart().slice(0, 40),
      largo: cuerpo.length,
    };
  }, url);
}

test.afterEach(async ({ request }) => {
  await request.get('/__edge-fault?mode=off').catch(() => undefined);
});

/*
 * 1. La matriz. Cliente recurrente —caché caliente—, el borde se cae MIENTRAS
 *    está afuera, y vuelve. En todos los casos hay copia buena guardada, así
 *    que en todos los casos la tienda tiene que llegar entera.
 */
for (const modo of [
  'css-503', 'css-404', 'css-429', 'css-captive', 'css-mime-lie', 'css-hang',
  'js-503', 'js-404', 'js-captive', 'js-mime-lie', 'js-hang',
  'all-503', 'all-hang',
]) {
  test(`con la caché caliente y el borde en ${modo}, la tienda llega entera`, async ({ page, request }) => {
    await abrirTiendaConWorkerCaliente(page);
    esperarExperienciaComercial(await medirExperienciaComercial(page), `antes de degradar (${modo})`);

    await degradarBorde(request, modo);
    await page.reload({ waitUntil: 'commit' });
    await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 45_000 });
    // El primer fotograma puede llegar antes que la cadena de @import.
    await page.waitForTimeout(2_000);

    esperarExperienciaComercial(
      await medirExperienciaComercial(page),
      `después de recargar con el borde en ${modo}`,
    );
  });
}

/*
 * La asimetría que queda, medida y con su consecuencia a la vista.
 *
 * El contraste del cuerpo cuesta, y el costo se paga en la visita FRÍA: mirar
 * el cuerpo de los ~90 módulos siempre llevaba la primera visita de 167 a 182
 * pedidos y de 1993 a 2576 KB transferidos. Pero en la visita fría la caché
 * está vacía, o sea que mirar el cuerpo NO PUEDE servir de nada: no hay con qué
 * reemplazar la respuesta mala.
 *
 * Por eso el módulo se contrasta sólo cuando hay copia guardada. Esta prueba
 * fija la otra mitad: el cliente nuevo sobre un borde que miente el tipo de los
 * `.js` se queda sin tienda, y no hay arreglo posible del lado del cliente
 * —`startup-recovery.js` es un script clásico y llega roto igual que el resto—.
 * Lo que sí se exige es que ese cliente no arrastre la mentira: nada de eso
 * puede quedar guardado para la próxima visita.
 */
test('el cliente nuevo sobre un borde que miente el tipo de los módulos no guarda nada de eso', async ({ page, request }) => {
  await degradarBorde(request, 'js-mime-lie');
  await page.goto('/?demo=1#home', { waitUntil: 'commit' });
  await page.waitForTimeout(6_000);

  const guardado = await page.evaluate(async () => {
    const nombres = await caches.keys();
    if (!nombres.length) return { cacheados: 0, conHtml: 0 };
    const cache = await caches.open(nombres[0]);
    const claves = (await cache.keys()).filter((r) => /\.m?js(\?|$)/.test(r.url));
    let conHtml = 0;
    for (const clave of claves) {
      const guardada = await cache.match(clave);
      const cuerpo = await guardada.clone().text();
      if (cuerpo.trimStart().toLowerCase().startsWith('<!doctype html')) conHtml += 1;
    }
    return { cacheados: claves.length, conHtml };
  });

  expect(guardado.conHtml, `quedaron ${guardado.conHtml} módulos con HTML adentro`).toBe(0);
});

/*
 * 2. La ESCRITURA de la caché. Es la mitad que el P1 no había mirado.
 */
test('la primera visita sobre un portal cautivo no deja su página guardada como hoja de estilos', async ({ page, request }) => {
  await degradarBorde(request, 'css-captive');
  await page.goto('/?demo=1#home', { waitUntil: 'load' });
  // Se le da tiempo al `install` a recorrer la lista y fallar. Un primer
  // precache contaminado NO se activa ni deja una caché parcial: el worker
  // anterior seguiría controlando si existiera; en este contexto nuevo no hay
  // ninguno y eso es exactamente lo seguro.
  await page.waitForTimeout(4_000);

  const fallida = await page.evaluate(async () => ({
    controlado: Boolean(navigator.serviceWorker.controller),
    cachesTaba: (await caches.keys()).filter((key) => key.startsWith('la-taba-runtime-')),
  }));
  expect(fallida.controlado).toBe(false);
  expect(fallida.cachesTaba).toEqual([]);

  const guardado = await loGuardado(page, ESTILOS);
  expect(
    guardado && guardado.arranque.toLowerCase().startsWith('<!doctype html'),
    `quedó guardada la página del portal como styles.css: ${JSON.stringify(guardado)}`,
  ).toBeFalsy();

  // Una visita sana posterior vuelve a registrar, instala el lote entero y
  // recién entonces toma control. No "cura" bytes parciales: construye una
  // caché nueva y atómica.
  await degradarBorde(request, 'off');
  await page.reload({ waitUntil: 'load' });
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached' });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  await expect.poll(async () => (await loGuardado(page, ESTILOS))?.tipo || '', { timeout: 20_000 })
    .toContain('text/css');
  esperarExperienciaComercial(await medirExperienciaComercial(page), 'tras instalar el precache atómico');
});

test('un módulo servido como HTML tampoco entra a la caché', async ({ page, request }) => {
  await abrirTiendaConWorkerCaliente(page);
  const antes = await loGuardado(page, 'js/state.js');
  expect(antes?.tipo).toContain('javascript');

  await degradarBorde(request, 'js-captive');
  await page.reload({ waitUntil: 'commit' });
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 45_000 });
  await page.waitForTimeout(1_500);

  const despues = await loGuardado(page, 'js/state.js');
  expect(despues?.tipo, 'la caché quedó con HTML donde vivía un módulo').toContain('javascript');
  expect(despues?.arranque.toLowerCase().startsWith('<!doctype')).toBeFalsy();
});

/*
 * 3. El cliente que vuelve. El worker ya está instalado y activo desde otra
 *    sesión: la pestaña nueva no instala nada, sólo consume lo guardado.
 */
test('la pestaña reabierta contra un worker ya activo sobrevive al borde caído', async ({ page, context, request }) => {
  await abrirTiendaConWorkerCaliente(page);
  await page.close();

  await degradarBorde(request, 'all-503');
  const nueva = await context.newPage();
  await nueva.goto('/?demo=1#catalog', { waitUntil: 'commit' });
  await nueva.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 45_000 });
  await nueva.waitForTimeout(2_000);

  esperarExperienciaComercial(await medirExperienciaComercial(nueva), 'pestaña reabierta con el borde en all-503');
  expect(await nueva.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
});

test('dos pestañas contra el mismo worker degradado siguen las dos enteras', async ({ page, context, request }) => {
  await abrirTiendaConWorkerCaliente(page);
  await degradarBorde(request, 'css-503');

  const segunda = await context.newPage();
  await segunda.goto('/?demo=1#cart', { waitUntil: 'commit' });
  await segunda.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 45_000 });
  await page.reload({ waitUntil: 'commit' });
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 45_000 });
  await page.waitForTimeout(2_000);

  esperarExperienciaComercial(await medirExperienciaComercial(page), 'pestaña 1 con el borde en css-503');
  esperarExperienciaComercial(await medirExperienciaComercial(segunda), 'pestaña 2 con el borde en css-503');
  await segunda.close();
});

/*
 * 4. El carrito no depende del borde. Un 503 de la red no es «la persona vació
 *    su carrito», y volver con la caché tampoco puede inventarle productos.
 */
test('el carrito sobrevive intacto a una recarga con el borde caído', async ({ page, request }) => {
  await abrirTiendaConWorkerCaliente(page);
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  const agregar = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  await agregar.waitFor({ state: 'visible' });
  const productId = await agregar.getAttribute('data-add-product');
  await agregar.click();
  await page.locator(`[data-cart-inc="${productId}"] >> visible=true`).first().click();

  const antes = await page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().cart.map((i) => `${i.productId}:${i.quantity}`).sort();
  });
  expect(antes).not.toEqual([]);

  await degradarBorde(request, 'all-503');
  await page.reload({ waitUntil: 'commit' });
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 45_000 });
  await page.waitForTimeout(2_000);

  expect(await page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().cart.map((i) => `${i.productId}:${i.quantity}`).sort();
  })).toEqual(antes);
});
