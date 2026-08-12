/*
 * El P1 del retorno desde Mercado Pago.
 *
 * Flujo humano: tienda -> carrito -> checkout -> se va a Mercado Pago -> vuelve
 * con «atrás» para cambiar el medio de pago. La página volvía VISUALMENTE ROTA:
 * fondo blanco, sin la identidad negro/rojo, iconos gigantes, la barra inferior
 * despegada del borde y el catálogo sin su grilla. El HTML seguía entero, el
 * carrito también: lo que faltaba eran los estilos.
 *
 * Por qué justo ahí y no en una recarga común: medido en WebKit, esa vuelta es
 * `back_forward` con `persisted=false` —la página tiene realtime abierto, así
 * que no entra al back-forward cache—, o sea que el documento se rearma entero
 * y vuelve a pedir sus ~120 subrecursos de una sola vez, en el mismo instante
 * en que el teléfono retoma la red desde otra aplicación.
 *
 * Y lo que recibía cuando el borde contestaba mal era una página de error
 * servida como hoja de estilos, porque el respaldo en caché del service worker
 * vivía en un `catch` y un 503 no rechaza: resuelve.
 *
 * Estas pruebas corren CON service workers —el resto del gate los bloquea, y
 * por eso nadie veía esto— y miden geometría y color computados, no presencia
 * de nodos: un `<link>` presente con la hoja vacía pasa cualquier `toBeVisible`.
 */
import { expect, test } from '@playwright/test';
// El contrato visual vive en `helpers.mjs`: lo afirman esta suite y la de
// recuperación del worker, y tienen que exigir exactamente lo mismo.
import { esperarExperienciaComercial, medirExperienciaComercial } from './helpers.mjs';

/*
 * El worker es el sujeto de la prueba: sin él no hay nada que medir, y el resto
 * del gate lo bloquea.
 *
 * El ancho se fija acá porque lo que se mide es el chrome MÓVIL —la barra
 * inferior fijada al borde, el tamaño del icono, la marca— y el proyecto
 * `chromium` corre a 1280 px, donde esa barra no existe. En `mobile-webkit`
 * coincide con el iPhone 13 del proyecto, así que no cambia nada; en Chromium
 * es lo que hace que la misma medición signifique lo mismo en los dos motores.
 */
test.use({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });

const ORIGEN_EXTERNO = 'https://www.mercadopago.com.ar';
const URL_EXTERNA = `${ORIGEN_EXTERNO}/checkout/v1/redirect?pref_id=E2E-SIN-PAGO`;

/*
 * Se pide desde el proceso de la prueba y NO desde la página: en el momento en
 * que hace falta degradar el borde, la pestaña está parada en el origen externo
 * y un `fetch` relativo saldría hacia ese otro origen.
 */
async function degradarBorde(request, modo) {
  const respuesta = await request.get(`/__edge-fault?mode=${modo}`);
  expect(respuesta.ok()).toBe(true);
  expect((await respuesta.json()).mode).toBe(modo);
}

/** Cliente recurrente de verdad: worker instalado y precache terminado. */
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

/*
 * El checkout no es una vista propia: vive DENTRO de `#cart`. `#checkout` es una
 * ruta que no existe y el router la corrige al inicio a propósito, así que la
 * prueba camina por donde camina la persona.
 */
async function armarCarritoYAbrirCheckout(page) {
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  const agregar = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
  await agregar.waitFor({ state: 'visible' });
  const productId = await agregar.getAttribute('data-add-product');
  await agregar.click();
  await page.locator(`[data-cart-inc="${productId}"] >> visible=true`).first().click();
  await page.evaluate(() => { window.location.hash = '#cart'; });
  await expect(page.locator('[data-checkout-form]')).toBeVisible();
  await expect.poll(() => lineasDelCarrito(page)).not.toEqual([]);
  return lineasDelCarrito(page);
}

function lineasDelCarrito(page) {
  return page.evaluate(async () => {
    try {
      const { getState } = await import('/js/state.js');
      return getState().cart.map((i) => `${i.productId}:${i.quantity}`).sort();
    } catch (_) { return ['NO-SE-PUDO-LEER']; }
  });
}

/**
 * Sale a un origen externo y vuelve con «atrás». La navegación cruzada es real
 * —es lo que decide el ciclo de vida—; el destino se responde localmente para
 * no tocar Mercado Pago ni crear ningún pago.
 */
async function salirYVolver(page) {
  await page.route(`${ORIGEN_EXTERNO}/**`, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>externo</title><h1>origen externo</h1>',
  }));
  await page.evaluate((url) => { window.location.assign(url); }, URL_EXTERNA);
  await page.waitForURL(`${ORIGEN_EXTERNO}/**`);
  return async () => {
    await page.goBack({ waitUntil: 'commit' });
    await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 30_000 });
    // El primer fotograma puede llegar antes que la cadena de @import.
    await page.waitForTimeout(1_500);
  };
}

test.afterEach(async ({ request }) => {
  await request.get('/__edge-fault?mode=off').catch(() => undefined);
});

for (const modo of ['css-503', 'css-404', 'css-captive']) {
  test(`vuelve de un origen externo con el borde en ${modo} y conserva la tienda`, async ({ page, request }) => {
    await abrirTiendaConWorkerCaliente(page);
    const carritoAntes = await armarCarritoYAbrirCheckout(page);
    esperarExperienciaComercial(await medirExperienciaComercial(page), 'antes de salir');

    const volver = await salirYVolver(page);
    // El borde se degrada mientras la persona está afuera, que es cuando pasa.
    await degradarBorde(request, modo);
    await volver();

    esperarExperienciaComercial(
      await medirExperienciaComercial(page),
      `después de volver con el borde en ${modo}`,
    );

    // Fase 5: el estado del checkout sobrevive intacto y se puede elegir otro
    // medio de pago. No se creó ningún pedido ni ningún pago.
    expect(await lineasDelCarrito(page)).toEqual(carritoAntes);
    await page.evaluate(() => { window.location.hash = '#cart'; });
    await expect(page.locator('[data-checkout-form]')).toBeVisible();
    const formaDePago = page.getByLabel('Forma de pago');
    await formaDePago.selectOption('cash');
    await expect(formaDePago).toHaveValue('cash');
  });
}

test('el «atrás» dentro de la aplicación sigue sano', async ({ page }) => {
  await abrirTiendaConWorkerCaliente(page);
  await armarCarritoYAbrirCheckout(page);
  await page.goBack();
  await page.waitForTimeout(500);
  esperarExperienciaComercial(await medirExperienciaComercial(page), 'después de un atrás interno');
});

test('volver del segundo plano con el borde degradado no rompe la tienda', async ({ page, request }) => {
  await abrirTiendaConWorkerCaliente(page);
  await armarCarritoYAbrirCheckout(page);
  await degradarBorde(request, 'css-503');

  // Segundo plano y vuelta: `pwa-update.js` revisa la publicación en `pageshow`,
  // `focus` y `visibilitychange`, y los tres disparan en este momento.
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await page.waitForTimeout(2_000);

  esperarExperienciaComercial(await medirExperienciaComercial(page), 'después de volver del segundo plano');
});

for (const [nombre, consulta] of [
  ['cancelado', '?collection_status=null&status=null'],
  ['pendiente', '?collection_status=pending&status=pending'],
  ['rechazado', '?collection_status=rejected&status=rejected'],
  ['aprobado', '?collection_status=approved&status=approved'],
]) {
  test(`la vuelta ${nombre} de Mercado Pago no desvía el router ni la tienda`, async ({ page }) => {
    await abrirTiendaConWorkerCaliente(page);
    const carritoAntes = await armarCarritoYAbrirCheckout(page);

    // Mercado Pago devuelve al comercio con sus parámetros colgados de la URL.
    // Ninguno puede cambiar la vista ni tocar el carrito por sí solo: acá no se
    // confirma nada, la autoridad del pago es el backend.
    await page.goto(`/${consulta}&demo=1#cart`, { waitUntil: 'load' });
    await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached' });
    await page.waitForTimeout(1_000);

    esperarExperienciaComercial(await medirExperienciaComercial(page), `retorno ${nombre}`);
    expect(await lineasDelCarrito(page)).toEqual(carritoAntes);
    await expect(page.locator('[data-checkout-form]')).toBeVisible();
  });
}
