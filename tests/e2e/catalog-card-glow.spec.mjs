/*
 * El brillo de la góndola, medido en un navegador de verdad.
 *
 * El contrato es el mismo en los dos estantes y en los dos tamaños: al llegar,
 * las primeras tarjetas de producto tienen capas rojas con alfa > 0; bajando lo
 * suficiente el alfa llega a 0; volviendo arriba reaparece.
 *
 * Se mide el `box-shadow` COMPUTADO y no el valor del token: si
 * `calc(var(--card-glow) * N%)` no estuviera soportado, el token seguiría
 * teniendo el número correcto y la tarjeta no tendría brillo ninguno.
 */
import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards } from './helpers.mjs';

const DESTACADOS = '[data-glow-shelf] .home-best-card:not(.out-of-stock)';
const CATALOGO = '[data-glow-shelf] .product-card:not(.out-of-stock)';

function alfasRojos(page, selector) {
  return page.locator(selector).first().evaluate((nodo) => (
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

async function irAlCatalogo(page) {
  await page.locator('[data-nav-view="catalog"] >> visible=true').first().click();
  await page.locator('body[data-active-view="catalog"]').waitFor({ state: 'attached' });
  await expect(page.locator(CATALOGO).first()).toBeVisible();
}

/*
 * El contrato completo sobre un estante: encendido al llegar, apagado abajo,
 * encendido de nuevo al volver. `hastaApagar` depende de qué tan abajo empieza
 * el estante; se calcula desde su propia posición en vez de fijar un número.
 */
async function contratoDelEstante(page, selector, etiqueta) {
  const alLlegar = await alfasRojos(page, selector);
  expect(alLlegar, `${etiqueta}: faltan las dos capas rojas`).toHaveLength(2);
  alLlegar.forEach((alfa) => expect(alfa, `${etiqueta}: el brillo no está encendido al llegar`).toBeGreaterThan(0));
  // Muy suave: es un acento, no un neón.
  expect(Math.max(...alLlegar), `${etiqueta}: el brillo se fue de escala`).toBeLessThanOrEqual(0.3);

  // Lo JUSTO para cruzar el umbral, no un número redondo grande: el brillo
  // llega a 0 cuando el borde superior del estante queda una pantalla por
  // encima del viewport. Scrollear de más en la home obliga a WebKit a decodificar
  // las imágenes de todos los rails intermedios, y esta prueba pasaba de 42 s
  // contra un timeout de 45.
  const bajar = await page.locator(selector).first().evaluate((nodo) => (
    Math.round(nodo.getBoundingClientRect().top + window.scrollY + window.innerHeight + 24)
  ));
  await scrollear(page, bajar);
  const abajo = await alfasRojos(page, selector);
  expect(Math.max(...abajo), `${etiqueta}: el brillo no se apagó al bajar`).toBe(0);

  await scrollear(page, 0);
  const devuelta = await alfasRojos(page, selector);
  devuelta.forEach((alfa) => expect(alfa, `${etiqueta}: el brillo no volvió al subir`).toBeGreaterThan(0));
  expect(devuelta).toEqual(alLlegar);
}

test('HOME · el rail Destacados llega con brillo, se apaga al bajar y vuelve', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');

  // Es la primera góndola que ve un cliente: si acá no hay brillo, el efecto no
  // existe donde importa, por más que exista en el catálogo.
  await expect(page.locator(DESTACADOS).first()).toBeVisible();
  await contratoDelEstante(page, DESTACADOS, 'Destacados');

  await guards.assertClean();
});

test('CATÁLOGO · la grilla llega con brillo, se apaga al bajar y vuelve', async ({ page }) => {
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await irAlCatalogo(page);

  await contratoDelEstante(page, CATALOGO, 'catálogo');

  await guards.assertClean();
});

test('el brillo no toca ni el fondo ni la tinta de la tarjeta', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await irAlCatalogo(page);

  const superficie = () => page.locator(CATALOGO).first().evaluate((nodo) => {
    const cs = getComputedStyle(nodo);
    const titulo = nodo.querySelector('h3, .product-title, strong');
    return {
      fondo: cs.backgroundColor,
      borde: cs.borderTopColor,
      tinta: titulo ? getComputedStyle(titulo).color : null,
    };
  });

  const conBrillo = await superficie();
  await scrollear(page, 3000);
  const sinBrillo = await superficie();

  // Una sombra no puede cambiar el contraste del texto. Si estos tres valores
  // son iguales con brillo y sin brillo, la legibilidad es literalmente la
  // misma y no hay nada que remedir.
  expect(conBrillo).toEqual(sinBrillo);
});

test('lo agotado nunca brilla, en ninguno de los dos estantes', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');

  const sinBrilloEn = (selector) => page.evaluate((sel) => {
    const nodos = [...document.querySelectorAll(sel)];
    if (!nodos.length) return 'no hay tarjetas agotadas en esta vista';
    const alfas = nodos.flatMap((nodo) => (
      (getComputedStyle(nodo).boxShadow.match(/rgba\(208,\s*0,\s*13,\s*([0-9.]+)\)/g) || [])
        .map((capa) => Number(/([0-9.]+)\)$/.exec(capa)[1]))
    ));
    return alfas.every((a) => a === 0) ? 'todas en cero' : `hay alfa > 0: ${alfas.join(', ')}`;
  }, selector);

  const enHome = await sinBrilloEn('[data-glow-shelf] .home-best-card.out-of-stock');
  expect(enHome, `Destacados: ${enHome}`).not.toContain('alfa > 0');

  await irAlCatalogo(page);
  const enCatalogo = await sinBrilloEn('[data-glow-shelf] .product-card.out-of-stock');
  expect(enCatalogo, `catálogo: ${enCatalogo}`).not.toContain('alfa > 0');
});

test('con movimiento reducido el brillo queda quieto y nada desborda', async ({ page }) => {
  const guards = installPageGuards(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');

  const fijado = () => page.evaluate(() => (
    [...document.querySelectorAll('[data-glow-shelf]')]
      .map((n) => n.style.getPropertyValue('--card-glow')).join('|')
  ));

  // El módulo no escribe: el token conserva su valor por defecto, que es lo
  // mismo que se ve cuando JavaScript no corre.
  expect(await fijado()).toBe('|');
  const antes = await alfasRojos(page, DESTACADOS);
  antes.forEach((alfa) => expect(alfa).toBeGreaterThan(0));

  await scrollear(page, 1600);
  expect(await fijado()).toBe('|');

  await irAlCatalogo(page);
  const geo = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(geo.scrollWidth).toBeLessThanOrEqual(geo.innerWidth);

  await guards.assertClean();
});

test('el brillo no se derrama fuera de los dos estantes', async ({ page }) => {
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');

  // El hero, el buscador y la fila de categorías no llevan brillo, y las
  // superficies del carrito y del checkout tampoco.
  const rojoEn = (sel) => page.evaluate((selector) => {
    const nodo = document.querySelector(selector);
    if (!nodo) return -1;
    return (getComputedStyle(nodo).boxShadow.match(/rgba\(208,\s*0,\s*13,/g) || []).length;
  }, sel);

  for (const sel of ['.taba-home-hero', '.taba-home-search', '[data-home-category-strip]']) {
    const capas = await rojoEn(sel);
    if (capas >= 0) expect(capas, `${sel} no debería llevar brillo`).toBe(0);
  }

  await page.locator('[data-nav-view="cart"] >> visible=true').first().click();
  await page.locator('body[data-active-view="cart"]').waitFor({ state: 'attached' });
  const enCarrito = await rojoEn('[data-view="cart"] .card');
  if (enCarrito >= 0) expect(enCarrito, 'el carrito no debería llevar brillo').toBe(0);
});
