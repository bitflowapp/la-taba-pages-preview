# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ios-blank-screen.spec.mjs >> clean sandbox paints the customer surface and hides recovery after bootstrap
- Location: tests\e2e\ios-blank-screen.spec.mjs:10:1

# Error details

```
Error: page.goto: Could not connect to server
Call log:
  - navigating to "http://127.0.0.1:38202/?demo=1#home", waiting until "load"

```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | import { gotoDemoReset, installPageGuards } from './helpers.mjs';
  3  | import { products as catalogProducts } from '../../js/approved-beverage-demo-data.js';
  4  | 
  5  | const totalCatalogProducts = catalogProducts.length;
  6  | const visibleCatalogProducts = catalogProducts.filter((product) => !product.archived).length;
  7  | 
  8  | const stateKey = 'la_taba_mvp_v4_state';
  9  | 
  10 | test('clean sandbox paints the customer surface and hides recovery after bootstrap', async ({ page }) => {
  11 |   const guards = installPageGuards(page);
  12 |   await page.addInitScript(() => {
  13 |     localStorage.clear();
  14 |     sessionStorage.clear();
  15 |   });
> 16 |   await page.goto('/?demo=1#home');
     |              ^ Error: page.goto: Could not connect to server
  17 | 
  18 |   await expect(page.locator('[data-view="home"] [data-search-jump]')).toBeVisible();
  19 |   await expect(page.locator('[data-app-recovery]')).toBeHidden();
  20 |   await expect.poll(() => page.evaluate(async () => {
  21 |     const { getState } = await import('/js/state.js');
  22 |     return getState().products.length;
  23 |   })).toBe(totalCatalogProducts);
  24 |   await guards.assertClean();
  25 | });
  26 | 
  27 | test('an old or empty local catalog is rebuilt without losing the first render', async ({ page }) => {
  28 |   await page.addInitScript((key) => {
  29 |     localStorage.setItem(key, JSON.stringify({
  30 |       schemaVersion: 5,
  31 |       dataVersion: 'la-taba-runtime-v3',
  32 |       appMode: 'demo',
  33 |       products: [],
  34 |       cart: [],
  35 |       orders: [],
  36 |       lastOrderId: null,
  37 |       activeCategory: 'all',
  38 |     }));
  39 |   }, stateKey);
  40 |   await page.goto('/?demo=1#catalog');
  41 | 
  42 |   // El estado recupera el catálogo base completo, pero el storefront unitario
  43 |   // oculta el pack Heineken rechazado y mantiene los SKU sin precio visibles.
  44 |   await expect(page.locator('[data-catalog-count]')).toContainText(`${visibleCatalogProducts} productos`);
  45 |   await expect(page.locator('[data-app-recovery]')).toBeHidden();
  46 | });
  47 | 
  48 | test('reset query renders first, removes itself, and does not loop', async ({ page }) => {
  49 |   await gotoDemoReset(page, '/?reset=1&demo=1#home');
  50 |   await expect(page.locator('[data-view="home"] [data-search-jump]')).toBeVisible();
  51 |   await expect(page.url()).not.toContain('reset=1');
  52 |   await expect(page.locator('[data-app-recovery]')).toBeHidden();
  53 | });
  54 | 
  55 | test('a rejected IndexedDB still leaves a usable in-memory sandbox without blocking first paint', async ({ page }) => {
  56 |   const guards = installPageGuards(page);
  57 |   await page.addInitScript(() => {
  58 |     Object.defineProperty(window, 'indexedDB', {
  59 |       configurable: true,
  60 |       value: { open() { throw new Error('IndexedDB rejected by browser'); } },
  61 |     });
  62 |   });
  63 |   await page.goto('/?demo=1#home');
  64 | 
  65 |   await expect(page.locator('[data-view="home"] [data-search-jump]')).toBeVisible();
  66 |   await expect(page.locator('[data-app-recovery]')).toBeHidden();
  67 |   await guards.assertClean();
  68 | });
  69 | 
  70 | test('a failed application module leaves an actionable recovery shell instead of a blank main', async ({ page }) => {
  71 |   await page.route('**/js/app.js?v=37', (route) => route.fulfill({
  72 |     status: 503,
  73 |     contentType: 'text/javascript',
  74 |     body: '/* unavailable for recovery test */',
  75 |   }));
  76 |   await page.goto('/?demo=1#home');
  77 | 
  78 |   await expect(page.locator('[data-app-recovery]')).toBeVisible();
  79 |   await expect(page.locator('[data-app-recovery]')).toContainText('No pudimos cargar TABA');
  80 |   await expect(page.locator('[data-app-recovery-retry]')).toBeVisible();
  81 |   await expect(page.locator('[data-app-recovery-reset]')).toBeVisible();
  82 |   await expect(page.locator('[data-view="home"] [data-search-jump]')).toBeHidden();
  83 | });
  84 | 
  85 | test('production without demo remains fail-closed and never selects the sandbox repository', async ({ page }) => {
  86 |   await page.goto('/#home');
  87 |   await expect(page.locator('[data-sandbox-tools]')).toHaveCount(0);
  88 |   await expect(page.locator('[data-production-catalog-gate]').first()).toBeVisible();
  89 |   const mode = await page.evaluate(async () => {
  90 |     const { getOrderRepository } = await import('/js/repositories/repository_factory.js');
  91 |     return getOrderRepository().mode;
  92 |   });
  93 |   expect(mode).not.toBe('sandbox');
  94 | });
  95 | 
```