import { expect, test } from '@playwright/test';
import { installBrowserStubs, installPageGuards } from './helpers.mjs';

/*
 * LA GÓNDOLA DE ALCOHOL EN UN TELÉFONO.
 *
 * Se mide en los tres anchos que este proyecto usa como contrato —320, 390 y
 * 430— sobre el catálogo FILTRADO a «Con alcohol», que es lo que ve alguien que
 * entra a buscar una bebida con alcohol. No se mira «que se vea lindo»: se
 * miden cuatro cosas que se pueden romper sin que nadie se entere.
 *
 *   1. NADA DESBORDA. Un nombre largo como «Patagonia Amber Lager» en 320 px es
 *      el caso que rompe una grilla, y el síntoma aparece en el documento, no
 *      en la tarjeta.
 *   2. EL +18 ESTÁ EN LA TARJETA, no sólo dentro del detalle. Una góndola de
 *      alcohol donde hay que abrir el producto para enterarse de que lleva
 *      alcohol no avisa: esconde.
 *   3. EL PRECIO SE LEE. Por debajo de 12 px un precio es una decoración.
 *   4. EL CTA SE PUEDE TOCAR. 44 px es el mínimo del contrato táctil, y hay que
 *      medirlo con el botón VISIBLE: un control dentro de un `<details>` cerrado
 *      mide cualquier cosa, y esa medición ya reportó un falso rojo antes.
 *
 * POR QUÉ CONTRA LA DEMO Y NO CONTRA PRODUCCIÓN
 * ---------------------------------------------
 * Los 27 alcohólicos de producción están con `available = false` detrás de la
 * compuerta de licencia, y `loadCatalog()` consulta con `.eq('available', true)`:
 * el cliente NO LOS DESCARGA. La góndola de alcohol productiva está vacía por
 * diseño, así que la demo —que sí publica alcohol— es la única superficie donde
 * esta grilla se puede medir hoy. El día que la licencia se acredite, esta
 * misma prueba es la que dice si la categoría entra presentable.
 */
const ANCHOS = [320, 390, 430];
const MIN_TACTIL = 44;

async function abrirConAlcohol(browser, ancho) {
  const context = await browser.newContext({ viewport: { width: ancho, height: 900 } });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);
  await page.goto('/?demo=1#catalog');
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();

  /*
   * El filtro de alcohol vive dentro del `<details>` de Filtros, que en
   * teléfono es un bottom sheet y arranca CERRADO. Hay que abrirlo, y hay que
   * hacerlo con el resumen, como una persona: un `<select>` dentro de un
   * `<details>` cerrado existe en el DOM, responde a `selectOption` y mide
   * cualquier cosa. Esa distinción ya fabricó un falso rojo en este proyecto.
   */
  const panel = page.locator('[data-catalog-filters]');
  await panel.locator('summary').click();
  await expect(panel).toHaveAttribute('open', '');

  const filtro = page.locator('[data-catalog-filter="alcohol"]');
  await expect(filtro).toBeVisible();
  await filtro.selectOption('with');

  // Cerrar el panel para medir la GRILLA, no el sheet abierto encima de ella.
  await panel.locator('summary').click();
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  return { context, page, guards };
}

for (const ancho of ANCHOS) {
  test(`la góndola de alcohol se sostiene en ${ancho} px`, async ({ browser }) => {
    const { context, page, guards } = await abrirConAlcohol(browser, ancho);

    const tarjetas = page.locator('[data-product-grid] .product-card');
    expect(
      await tarjetas.count(),
      'la demo tiene que publicar alcohol para que esto mida algo',
    ).toBeGreaterThan(0);

    // 1. Nada desborda.
    const ancho_doc = await page.evaluate(() => ({
      documento: document.documentElement.scrollWidth,
      ventana: window.innerWidth,
    }));
    expect(
      ancho_doc.documento,
      `scroll horizontal en ${ancho} px: el documento mide ${ancho_doc.documento} y la ventana ${ancho_doc.ventana}`,
    ).toBeLessThanOrEqual(ancho_doc.ventana + 1);

    // 2. Cada tarjeta filtrada por «Con alcohol» avisa que lo lleva.
    const sinAviso = await tarjetas.evaluateAll((nodos) => nodos
      .filter((nodo) => !/\+\s*18|mayor(es)? de/i.test(nodo.textContent || ''))
      .map((nodo) => (nodo.textContent || '').replace(/\s+/g, ' ').slice(0, 60)));
    expect(sinAviso, 'toda tarjeta con alcohol tiene que decirlo sin abrir el detalle').toEqual([]);

    // 3. El precio se lee.
    const preciosChicos = await page
      .locator('[data-product-grid] .product-card .price-amounts strong')
      .evaluateAll((nodos) => nodos
        .map((nodo) => ({ px: Number.parseFloat(getComputedStyle(nodo).fontSize), texto: nodo.textContent?.trim() }))
        .filter((m) => Number.isFinite(m.px) && m.px < 12));
    expect(preciosChicos, 'un precio por debajo de 12 px no es un precio').toEqual([]);

    // 4. El CTA se puede tocar. Sólo los VISIBLES: medir uno oculto miente.
    const ctasChicos = await page
      .locator('[data-product-grid] [data-add-product]')
      .evaluateAll((nodos, minimo) => nodos
        .filter((nodo) => nodo.getClientRects().length > 0)
        .map((nodo) => {
          const r = nodo.getBoundingClientRect();
          return { alto: Math.round(r.height), ancho: Math.round(r.width), texto: nodo.textContent?.trim() };
        })
        .filter((m) => m.alto < minimo), MIN_TACTIL);
    expect(ctasChicos, `el CTA de agregar tiene que medir ${MIN_TACTIL} px de alto`).toEqual([]);

    await guards.assertClean();
    await context.close();
  });
}
