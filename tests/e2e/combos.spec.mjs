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

  // Y el combo declara que todavía no se cobra a precio de combo.
  await expect(ficha.locator('.combo-modal-pending')).toContainText('aprueba');
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
