import { expect, test } from '@playwright/test';
import { gotoDemoReset, installPageGuards } from './helpers.mjs';
import { products as catalogProducts } from '../../js/approved-beverage-demo-data.js';
import {
  applyRetailCatalogModel,
  getCustomerCatalogProducts,
  normalizeCatalogProduct,
} from '../../js/core/catalog-store.js';

// El estado carga el catálogo pasado por el funnel minorista: los packs de
// abastecimiento siguen adentro (con su id y su historial) y se suman las
// unidades publicadas en su lugar. La góndola, en cambio, sólo cuenta lo que
// el cliente ve.
const retailCatalog = applyRetailCatalogModel(
  catalogProducts.map((product) => normalizeCatalogProduct(product)).filter(Boolean),
);
const totalCatalogProducts = retailCatalog.length;
const visibleCatalogProducts = getCustomerCatalogProducts(retailCatalog).length;

const stateKey = 'la_taba_mvp_v4_state';

test('clean sandbox paints the customer surface and hides recovery after bootstrap', async ({ page }) => {
  const guards = installPageGuards(page);
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/?demo=1#home');

  await expect(page.locator('[data-view="home"] [data-search-jump]')).toBeVisible();
  await expect(page.locator('[data-app-recovery]')).toBeHidden();
  await expect.poll(() => page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().products.length;
  })).toBe(totalCatalogProducts);
  await guards.assertClean();
});

test('an old or empty local catalog is rebuilt without losing the first render', async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({
      schemaVersion: 5,
      dataVersion: 'la-taba-runtime-v3',
      appMode: 'demo',
      products: [],
      cart: [],
      orders: [],
      lastOrderId: null,
      activeCategory: 'all',
    }));
  }, stateKey);
  await page.goto('/?demo=1#catalog');

  // El estado recupera el catálogo base completo, pero la góndola oculta los
  // packs de abastecimiento y muestra las unidades, con sus SKU sin precio
  // visibles y no comprables.
  await expect(page.locator('[data-catalog-count]')).toContainText(`${visibleCatalogProducts} productos`);
  await expect(page.locator('[data-app-recovery]')).toBeHidden();
});

test('reset query renders first, removes itself, and does not loop', async ({ page }) => {
  await gotoDemoReset(page, '/?reset=1&demo=1#home');
  await expect(page.locator('[data-view="home"] [data-search-jump]')).toBeVisible();
  await expect(page.url()).not.toContain('reset=1');
  await expect(page.locator('[data-app-recovery]')).toBeHidden();
});

test('a rejected IndexedDB still leaves a usable in-memory sandbox without blocking first paint', async ({ page }) => {
  const guards = installPageGuards(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: { open() { throw new Error('IndexedDB rejected by browser'); } },
    });
  });
  await page.goto('/?demo=1#home');

  await expect(page.locator('[data-view="home"] [data-search-jump]')).toBeVisible();
  await expect(page.locator('[data-app-recovery]')).toBeHidden();
  await guards.assertClean();
});

test('a failed application module leaves an actionable recovery shell instead of a blank main', async ({ page }) => {
  /*
   * La ruta se declara por expresión regular y no por el token exacto.
   *
   * Estaba clavada en `?v=42` y el shell ya iba por `?v=44`: la intercepción no
   * matcheaba nada, el módulo cargaba bien y la prueba medía una pantalla que
   * nunca se rompía. O sea que la red de seguridad más importante del arranque
   * —la salida cuando un módulo no carga— llevaba dos publicaciones sin
   * probarse, y contaba como cobertura. Lo encontraron por separado la góndola
   * y la instalación, cada una en su rama; acá queda una sola vez.
   *
   * La expresión pide `?v=` seguido de dígitos y termina ahí: cubre cualquier
   * bump futuro sin tragarse un `app.js.map` ni un `app.js?debug`.
   */
  await page.route(/\/js\/app\.js\?v=\d+$/, (route) => route.fulfill({
    status: 503,
    contentType: 'text/javascript',
    body: '/* unavailable for recovery test */',
  }));
  await page.goto('/?demo=1#home');

  const recovery = page.locator('[data-app-recovery]');
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText('No pudimos abrir la tienda');
  await expect(page.locator('[data-app-recovery-retry]')).toBeVisible();
  await expect(page.locator('[data-app-recovery-reset]')).toBeVisible();
  await expect(page.locator('[data-view="home"] [data-search-jump]')).toBeHidden();

  // El código técnico existe para diagnóstico, en el atributo y en la consola.
  // Lo que se PINTA no lo incluye: a quien quiere comprar no le dice nada.
  await expect(recovery).toHaveAttribute('data-app-recovery-code', 'TABA2-BOOT-01');
  await expect(recovery).not.toContainText(/TABA2?-BOOT-\d+/);
});

test('production without demo remains fail-closed and never selects the sandbox repository', async ({ page }) => {
  await page.goto('/#home');
  await expect(page.locator('[data-sandbox-tools]')).toHaveCount(0);
  await expect(page.locator('[data-production-catalog-gate]').first()).toBeVisible();
  const mode = await page.evaluate(async () => {
    const { getOrderRepository } = await import('/js/repositories/repository_factory.js');
    return getOrderRepository().mode;
  });
  expect(mode).not.toBe('sandbox');
});
