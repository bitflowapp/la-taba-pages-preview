/*
 * LA HOJA DEL MAPA NO PUEDE DECIDIR CUÁNDO SE VE LA TIENDA.
 *
 * `maplibre-gl.css` viene de unpkg.com. Estaba declarada como hoja normal en el
 * <head>, o sea en el camino crítico de pintado, y la home no la usa para nada:
 * sus reglas son del mapa, que vive en Seguimiento.
 *
 * Medido el 2026-08-25 contra producción, en Chromium a 390 px:
 *
 *   unpkg normal ................ primer pintado    624 ms
 *   unpkg caído (falla rápido) .. primer pintado    508 ms
 *   unpkg COLGADO 15 s .......... primer pintado 15.332 ms
 *
 * Un CDN que se cae no hace daño. Uno que no contesta deja la tienda en blanco
 * todo el tiempo que tarde, y ése es el modo de falla probable de un servicio
 * gratuito un viernes a la noche.
 *
 * Estas dos pruebas fijan las dos mitades del arreglo: que la hoja NO bloquee, y
 * que igual termine aplicada —porque una hoja que no bloquea y tampoco llega es
 * un mapa sin estilo, que es peor que un pintado lento—.
 */
import { expect, test } from '@playwright/test';

const HOJA_DEL_MAPA = /maplibre-gl\.css/;

test('la hoja del mapa se declara sin bloquear el pintado', async ({ page }) => {
  await page.goto('/?demo=1#home');

  // Lo que importa es cómo viaja en el HTML servido: `media="print"` es lo que
  // hace que el navegador la baje sin retener el primer pintado. Se lee del
  // documento crudo porque el atributo vivo ya fue cambiado por el `onload`.
  const respuesta = await page.request.get('/index.html');
  expect(respuesta.ok(), `index.html contestó ${respuesta.status()}`).toBe(true);
  const html = await respuesta.text();
  // Se recortan las etiquetas <link …> enteras y se descarta la que vive dentro
  // del <noscript>, que existe para quien no ejecuta el `onload` y por lo tanto
  // SÍ tiene que ser una hoja normal.
  const sinNoscript = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
  const etiqueta = (sinNoscript.match(/<link[^>]*>/g) || [])
    .find((tag) => /maplibre-gl\.css/.test(tag));
  expect(etiqueta, 'no se encontró la etiqueta de la hoja del mapa').toBeTruthy();
  expect(etiqueta, 'la hoja del mapa volvió al camino crítico de pintado').toContain('media="print"');
  expect(etiqueta, 'sin el onload la hoja nunca se aplica').toContain("onload=\"this.media='all'\"");
  // La protección de cadena de suministro no se negocia por rendimiento.
  expect(etiqueta).toContain('integrity="sha384-');
  expect(etiqueta).toContain('crossorigin="anonymous"');
});

test('la hoja del mapa termina aplicada y el mapa la usa', async ({ page }) => {
  await page.goto('/?demo=1#home');
  await expect(page.locator('html[data-taba-startup="ready"]')).toBeAttached({ timeout: 60_000 });

  await expect.poll(async () => page.evaluate((patron) => {
    const link = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .find((l) => new RegExp(patron).test(l.href));
    return link ? link.media : 'sin la hoja';
  }, HOJA_DEL_MAPA.source), { timeout: 20_000 }).toBe('all');

  await page.evaluate(() => { window.location.hash = '#tracking'; });
  await expect(page.locator('.maplibregl-map')).toBeVisible({ timeout: 30_000 });

  // `position: relative` y `overflow: hidden` sobre `.maplibregl-map` salen de
  // la hoja del CDN. Si no se hubiera aplicado, volverían al valor por defecto.
  const contenedor = page.locator('.maplibregl-map').first();
  await expect(contenedor).toHaveCSS('position', 'relative');
  await expect(contenedor).toHaveCSS('overflow', 'hidden');
});
