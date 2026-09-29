/*
 * La tarjeta sin precio publicado, dentro de la góndola premium.
 *
 * Mirando los 42 productos reales de CP en el frontend real —todos todavía sin
 * precio— la vidriera de precios pendientes se leía rota:
 *
 *   1. «Precio próximamente» heredaba el importe de 25px/900 del bloque premium
 *      y se partía letra por letra en una columna de 37px. La tarjeta medía
 *      704px contra 383px de una con precio, y estiraba su fila entera.
 *   2. El botón «Precio pendiente» salía rojo, como un «Agregar».
 *   3. Una tarjeta no comprable que marcaba la entrada animada volvía a
 *      encenderse: de un estante apagado, cuatro tarjetas brillaban.
 *   4. En el teléfono el contador le comía el título a la categoría.
 *
 * Esa vidriera existe en la demostración, así que se mide ahí. La tienda real no
 * dibuja un producto sin precio, pero la vidriera del alcohol usa el mismo
 * apagado de la prueba 3.
 */
import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards } from './helpers.mjs';

async function abrirCatalogo(page, viewport) {
  await page.setViewportSize(viewport);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.evaluate(() => { window.location.hash = '#catalog'; });
  await page.waitForSelector('[data-view="catalog"]:not([hidden]) [data-product-grid] .product-card [data-price-pending-message]');
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`precio pendiente: aviso dorado a lo ancho, acción dorada y la fila no se estira (${viewport.width})`, async ({ page }) => {
    const guards = installPageGuards(page);
    await abrirCatalogo(page, viewport);

    const medida = await page.evaluate(() => {
      const tarjetas = [...document.querySelectorAll('[data-view="catalog"] [data-product-grid] .product-card')];
      const pendientes = tarjetas.filter((t) => t.querySelector('[data-price-pending-message]'));
      const conPrecio = tarjetas.filter((t) => !t.querySelector('[data-price-pending-message]'));
      const aviso = pendientes[0].querySelector('[data-price-pending-message] strong');
      const estilo = getComputedStyle(aviso);
      const accion = getComputedStyle(pendientes[0].querySelector('[data-add-product].is-price-pending'));
      const alto = (t) => Math.round(t.getBoundingClientRect().height);
      return {
        pendientes: pendientes.length,
        avisoAlto: aviso.getBoundingClientRect().height,
        avisoAncho: aviso.getBoundingClientRect().width,
        renglon: parseFloat(estilo.lineHeight),
        cuerpo: parseFloat(estilo.fontSize),
        color: estilo.color,
        accionFondo: accion.backgroundImage,
        accionAncho: pendientes[0].querySelector('[data-add-product]').getBoundingClientRect().width,
        pieAncho: pendientes[0].querySelector('.product-foot').getBoundingClientRect().width,
        altoPendiente: Math.max(...pendientes.map(alto)),
        altosConPrecio: [...new Set(conPrecio.map(alto))],
      };
    });

    expect(medida.pendientes).toBeGreaterThan(0);
    // No es un importe: 14px, dorado (--shelf-gold-soft), y a lo sumo dos
    // renglones en una tarjeta de teléfono; uno solo en escritorio.
    expect(medida.cuerpo).toBe(14);
    expect(medida.color).toBe('rgb(228, 180, 95)');
    expect(medida.avisoAlto).toBeLessThanOrEqual(medida.renglon * (viewport.width < 700 ? 2 : 1) + 1);
    expect(medida.avisoAncho).toBeGreaterThan(100);
    // La acción es la del estado pendiente —filete dorado, sin el degradé rojo
    // de «Agregar»— y ocupa el ancho del pie.
    expect(medida.accionFondo).toBe('none');
    expect(medida.accionAncho).toBeGreaterThan(medida.pieAncho - 2);
    // La grilla iguala el alto de cada fila, así que una tarjeta con precio al
    // lado de una pendiente se estira hasta ella. Lo que se acota es cuánto:
    // antes eran 704px contra 383px (×1,84) y la fila entera quedaba vacía.
    const natural = Math.min(...medida.altosConPrecio);
    expect(medida.altoPendiente).toBeLessThan(natural * 1.35);
    expect(Math.max(...medida.altosConPrecio)).toBeLessThan(natural * 1.35);
    await guards.assertClean();
  });
}

test('una tarjeta no comprable sigue apagada cuando la marca la entrada animada', async ({ page }) => {
  const guards = installPageGuards(page);
  await abrirCatalogo(page, { width: 1440, height: 900 });

  const medir = () => page.evaluate(() => {
    const apagadas = [...document.querySelectorAll('[data-view="catalog"] [data-product-grid] .product-card.out-of-stock:not([data-motion-reveal])')];
    const [referencia, marcada] = apagadas;
    // Exactamente lo que motion.js le pone a las cuatro primeras de cada grilla.
    marcada.style.transition = 'none';
    marcada.dataset.motionReveal = 'card';
    marcada.classList.add('is-motion-visible');
    const resultado = { referencia: getComputedStyle(referencia).opacity, marcada: getComputedStyle(marcada).opacity };
    delete marcada.dataset.motionReveal;
    marcada.classList.remove('is-motion-visible');
    marcada.style.transition = '';
    return resultado;
  });

  await expect(page.locator('body.motion-ready')).toHaveCount(1);
  const conMovimiento = await medir();
  expect(conMovimiento.referencia).toBe('0.66');
  expect(conMovimiento.marcada).toBe(conMovimiento.referencia);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const sinMovimiento = await medir();
  expect(sinMovimiento.marcada).toBe(sinMovimiento.referencia);
  await guards.assertClean();
});

for (const width of [360, 390]) {
  test(`en el teléfono el título de cada categoría se lee entero (${width})`, async ({ page }) => {
    const guards = installPageGuards(page);
    await abrirCatalogo(page, { width, height: 800 });
    const categorias = await page.evaluate(() => [...document.querySelectorAll('[data-view="catalog"] [data-category-strip] [data-category-id]')]
      .map((chip) => chip.dataset.categoryId)
      .filter((id) => id !== 'favorites'));
    expect(categorias.length).toBeGreaterThan(3);
    for (const id of categorias) {
      await page.locator(`[data-view="catalog"] [data-category-strip] [data-category-id="${id}"]`).first().click();
      const titulo = await page.evaluate(() => {
        const nodo = document.querySelector('[data-view="catalog"] [data-catalog-title]');
        return { texto: nodo.textContent, necesita: nodo.scrollWidth, tiene: nodo.clientWidth };
      });
      expect(titulo.necesita, `«${titulo.texto}» quedó cortado a ${width}px`).toBeLessThanOrEqual(titulo.tiene + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await guards.assertClean();
  });
}

test('el nombre de la tarjeta no deja la unidad sola en el último renglón', async ({ page }) => {
  const guards = installPageGuards(page);
  await abrirCatalogo(page, { width: 1440, height: 900 });
  const estilo = await page.evaluate(() => {
    const h3 = document.querySelector('[data-view="catalog"] [data-product-grid] .product-card h3');
    const cs = getComputedStyle(h3);
    return cs.textWrapStyle || cs.textWrap;
  });
  expect(estilo).toContain('pretty');
  await guards.assertClean();
});
