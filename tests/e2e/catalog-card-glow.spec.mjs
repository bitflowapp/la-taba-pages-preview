/*
 * El brillo de la góndola, medido en un navegador de verdad.
 *
 * Lo que las pruebas unitarias no pueden decir: que el alfa efectivamente
 * interpole con el scroll en los dos motores, que vuelva al subir, que la
 * preferencia de movimiento reducido lo deje quieto, y —lo más importante— que
 * un adorno no se lleve puesta la legibilidad.
 */
import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards } from './helpers.mjs';

async function irAlCatalogo(page) {
  await page.locator('[data-nav-view="catalog"] >> visible=true').first().click();
  await page.locator('body[data-active-view="catalog"]').waitFor({ state: 'attached' });
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
}

/*
 * Los alfas rojos que el navegador terminó pintando, no el valor del token. Es
 * la diferencia entre comprobar la intención y comprobar el resultado: si
 * `calc(var(--card-glow) * N%)` no estuviera soportado, el token seguiría
 * teniendo el número correcto y la tarjeta no tendría brillo ninguno.
 */
function alfasRojos(page) {
  return page.locator('[data-product-grid] .product-card').first().evaluate((nodo) => (
    (getComputedStyle(nodo).boxShadow.match(/rgba\(208,\s*0,\s*13,\s*([0-9.]+)\)/g) || [])
      .map((capa) => Number(/([0-9.]+)\)$/.exec(capa)[1]))
  ));
}

async function scrollear(page, y) {
  await page.evaluate((destino) => window.scrollTo(0, destino), y);
  // Dos cuadros: el módulo escribe el valor dentro de un `requestAnimationFrame`.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(120);
}

test('el brillo está encendido arriba de la góndola, se apaga al bajar y vuelve al subir', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await irAlCatalogo(page);

  const arriba = await alfasRojos(page);
  expect(arriba).toHaveLength(2);
  arriba.forEach((alfa) => expect(alfa).toBeGreaterThan(0));

  // Muy suave: es un acento, no un neón. El techo lo fija la unitaria; acá se
  // comprueba sobre el valor PINTADO.
  expect(Math.max(...arriba)).toBeLessThanOrEqual(0.3);

  await scrollear(page, 400);
  const medio = await alfasRojos(page);
  expect(Math.max(...medio)).toBeLessThan(Math.max(...arriba));

  await scrollear(page, 2000);
  const abajo = await alfasRojos(page);
  expect(Math.max(...abajo)).toBe(0);

  // Y vuelve: el efecto sigue al scroll en las dos direcciones.
  await scrollear(page, 0);
  expect(await alfasRojos(page)).toEqual(arriba);

  await guards.assertClean();
});

test('el brillo no toca ni el fondo ni la tinta de la tarjeta', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await irAlCatalogo(page);

  const superficie = () => page.locator('[data-product-grid] .product-card').first().evaluate((nodo) => {
    const cs = getComputedStyle(nodo);
    const titulo = nodo.querySelector('h3, .product-title, strong');
    return {
      fondo: cs.backgroundColor,
      borde: cs.borderTopColor,
      tinta: titulo ? getComputedStyle(titulo).color : null,
    };
  });

  const conBrillo = await superficie();
  await scrollear(page, 2000);
  const sinBrillo = await superficie();

  // Una sombra no puede cambiar el contraste del texto. Si estos tres valores
  // son iguales con brillo y sin brillo, la legibilidad es literalmente la
  // misma y no hay nada que remedir.
  expect(conBrillo).toEqual(sinBrillo);
});

test('con movimiento reducido el brillo queda quieto y la góndola no desborda', async ({ page }) => {
  const guards = installPageGuards(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await irAlCatalogo(page);

  const fijado = () => page.evaluate(() => (
    document.querySelector('[data-view="catalog"]')?.style.getPropertyValue('--card-glow') || ''
  ));

  // El módulo no escribe: el token conserva su valor por defecto, que es lo
  // mismo que se ve cuando JavaScript no corre.
  expect(await fijado()).toBe('');
  const antes = await alfasRojos(page);
  antes.forEach((alfa) => expect(alfa).toBeGreaterThan(0));

  await scrollear(page, 1600);
  expect(await fijado()).toBe('');
  expect(await alfasRojos(page)).toEqual(antes);

  const geo = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(geo.scrollWidth).toBeLessThanOrEqual(geo.innerWidth);

  await guards.assertClean();
});

test('el brillo vive sólo en la grilla del catálogo', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');

  // En la home, con la misma tarjeta de producto en los rails, no hay brillo.
  const enHome = await page.locator('.home-best-card').first().evaluate((nodo) => (
    (getComputedStyle(nodo).boxShadow.match(/rgba\(208,\s*0,\s*13,/g) || []).length
  ));
  expect(enHome).toBe(0);

  await irAlCatalogo(page);
  expect(await alfasRojos(page)).toHaveLength(2);
});
