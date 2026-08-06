// Contrato comercial de los combos en la góndola.
//
// Lo que protege no es el diseño sino las cuatro afirmaciones que una tarjeta
// de combo hace y que, si se despegan del catálogo, se vuelven mentira: el
// precio tachado, el ahorro, el stock y la validación +18.
import { expect, test } from '@playwright/test';
import { gotoDemoReset, installBrowserStubs, installPageGuards } from './helpers.mjs';

import { COMBO_MANIFEST } from '../../js/combos-data.js';

const PHONE = { width: 390, height: 844 };

async function abrirHome(page, viewport = PHONE) {
  await page.setViewportSize(viewport);
  await installBrowserStubs(page);
  await gotoDemoReset(page, '/?reset=1&demo=1');
  await page.waitForSelector('[data-view="home"] .home-best-card');
}

const money = (value) => `$ ${value.toLocaleString('es-AR')}`;

test('la góndola publica los combos del manifiesto que se pueden armar enteros', async ({ page }) => {
  const guards = installPageGuards(page);
  await abrirHome(page);

  const seccion = page.locator('[data-home-combos-section]');
  await expect(seccion).toBeVisible();
  expect(await page.locator('.combo-card').evaluateAll((nodes) => nodes.map((node) => node.dataset.comboCard)))
    .toEqual(COMBO_MANIFEST.map((combo) => combo.comboId));
  await guards.assertClean();
});

test('el precio tachado es la suma real de los componentes y el ahorro cierra', async ({ page }) => {
  await abrirHome(page);

  const tarjeta = page.locator('[data-combo-card="combo-previa-imperial-x6"]');
  // Seis Imperial Golden a $3.000 = $18.000; 12% con redondeo a la centena
  // inferior = $15.800; ahorro $2.200. Los tres números salen del catálogo,
  // así que si cambia el precio de la lata este test falla y avisa.
  await expect(tarjeta.locator('.combo-card-price s')).toHaveText(money(18000));
  await expect(tarjeta.locator('.combo-card-price strong')).toHaveText(money(15800));
  await expect(tarjeta.locator('.combo-save-badge')).toHaveText(`Ahorrás ${money(2200)}`);
});

test('un combo con alcohol declara +18 y uno sin alcohol no lo inventa', async ({ page }) => {
  await abrirHome(page);

  await expect(page.locator('[data-combo-card="combo-birra-y-energia"] .combo-chip.is-age')).toHaveText('+18');
  await expect(page.locator('[data-combo-card="combo-cuatro-para-arrancar"] .combo-chip.is-age')).toHaveCount(0);
});

test('el detalle abre con componentes, sustituciones y stock del limitante', async ({ page }) => {
  await abrirHome(page);

  await page.locator('[data-combo-card="combo-birra-y-energia"] [data-combo-detail]').first().click();
  const ficha = page.locator('[data-combo-modal] .combo-modal-card');
  await expect(ficha).toBeVisible();

  // Dos componentes, cada uno con su cantidad y su precio de lista.
  await expect(ficha.locator('.combo-component-list li')).toHaveCount(2);
  await expect(ficha.locator('.combo-component-list li').first()).toContainText('4×');
  await expect(ficha.locator('.combo-component-list li').first()).toContainText('Imperial Golden');
  await expect(ficha.locator('.combo-component-list li').nth(1)).toContainText('2×');

  // Las sustituciones se declaran con nombre, no con un chip mudo.
  await expect(ficha.locator('.combo-component-subs').first())
    .toContainText('Se puede cambiar por Imperial Extra Lager');

  // El stock es el del componente limitante: 4 latas por combo sobre 99 = 24.
  await expect(ficha.locator('.combo-modal-stock')).toContainText('24');
  await expect(ficha.locator('.combo-modal-stock')).toContainText('Imperial Golden');

  // Y el pie ofrece comprarlo al precio que el backend va a cobrar.
  //
  // Este contrato cambió al cerrar el bloqueante. Antes el pie decía que el
  // combo todavía no se cobraba a precio de combo, porque nadie aplicaba el
  // descuento al total. Ahora lo aplica el backend, así que ofrecer la compra
  // dejó de ser una promesa que el pedido no iba a cumplir.
  await expect(ficha.locator('.combo-modal-pending')).toHaveCount(0);
  await expect(ficha.locator('[data-add-combo="combo-birra-y-energia"]'))
    .toHaveText(`Agregar combo · ${money(15700)}`);
});

test('agregar un combo lo cobra a precio de combo, no a la suma de sus partes', async ({ page }) => {
  // La afirmación cara de toda la góndola: el ahorro anunciado tiene que ser
  // el que el pedido cobra. Seis Heineken a $3.900 son $23.400 de lista; el
  // combo se cobra $21.000 y el carrito muestra los $2.400 de diferencia como
  // descuento, exactamente como los representa el backend.
  await abrirHome(page);

  await page.locator('[data-combo-card="combo-heineken-x6"] [data-combo-detail]').first().click();
  await page.locator('[data-add-combo="combo-heineken-x6"]').click();
  await expect(page.locator('[data-combo-modal]')).toBeHidden();

  await page.locator('[data-nav-view="cart"] >> visible=true').first().click();
  const linea = page.locator('[data-cart-combo="combo-heineken-x6"]');
  await expect(linea).toBeVisible();
  await expect(linea.locator('.cart-title')).toContainText('Heineken x6');
  await expect(linea.locator('.cart-meta').first()).toContainText('6× Heineken');
  await expect(linea.locator('.cart-combo-saving')).toHaveText(`Ahorrás ${money(2400)}`);

  const resumen = page.locator('[data-order-summary]');
  await expect(resumen.locator('.summary-row').first()).toContainText(money(23400));
  await expect(resumen.locator('.summary-row.discount')).toContainText(`-${money(2400)}`);
});

test('sumar y quitar el combo mueve el carrito y no deja líneas fantasma', async ({ page }) => {
  await abrirHome(page);

  await page.locator('[data-combo-card="combo-heineken-x6"] [data-combo-detail]').first().click();
  await page.locator('[data-add-combo="combo-heineken-x6"]').click();
  await page.locator('[data-nav-view="cart"] >> visible=true').first().click();

  const linea = page.locator('[data-cart-combo="combo-heineken-x6"]');
  await linea.locator('[data-combo-increment]').click();
  await expect(linea.locator('[data-combo-quantity]')).toHaveText('2');
  await expect(page.locator('[data-order-summary] .summary-row.discount')).toContainText(`-${money(4800)}`);

  await linea.locator('[data-combo-decrement]').click();
  await expect(linea.locator('[data-combo-quantity]')).toHaveText('1');

  // El carrito ignora el mismo control dos veces en menos de 120 ms: es el
  // guard contra la duplicación accidental del evento, el mismo que ya protege
  // a los productos. Un cliente que toca dos veces a propósito espera más que
  // eso; el test también, en vez de pedirle al producto que baje la guardia.
  await page.waitForTimeout(200);
  await linea.locator('[data-combo-decrement]').click();
  await expect(page.locator('[data-cart-combo="combo-heineken-x6"]')).toHaveCount(0);
});

test('desde el detalle del combo se llega a la ficha de un componente sin dejar dos hojas abiertas', async ({ page }) => {
  await abrirHome(page);

  await page.locator('[data-combo-card="combo-heineken-x6"] [data-combo-detail]').first().click();
  await expect(page.locator('[data-combo-modal] .combo-modal-card')).toBeVisible();
  await page.locator('[data-combo-open-component]').first().click();

  await expect(page.locator('[data-product-modal] .modal-card')).toBeVisible();
  await expect(page.locator('[data-combo-modal]')).not.toBeVisible();
});

for (const viewport of [
  { name: '320', width: 320, height: 700 },
  { name: '390', width: 390, height: 844 },
  { name: '432', width: 432, height: 932 },
]) {
  test(`el rail de combos no desborda a ${viewport.name}`, async ({ page }) => {
    await abrirHome(page, { width: viewport.width, height: viewport.height });
    const seccion = page.locator('[data-home-combos-section]');
    await seccion.scrollIntoViewIfNeeded();

    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desborde, `overflow horizontal a ${viewport.name}`).toBeLessThanOrEqual(0);

    // El precio del combo entra completo: es el número por el que existe la
    // tarjeta y no puede quedar cortado en el ancho más chico.
    const precio = page.locator('.combo-card').first().locator('.combo-card-price strong');
    const caja = await precio.boundingBox();
    expect(caja.width).toBeGreaterThan(40);
    expect(caja.x + caja.width).toBeLessThanOrEqual(viewport.width);
  });
}
