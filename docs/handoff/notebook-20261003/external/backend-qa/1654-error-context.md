# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mobile-touch-gesture.spec.mjs >> formularios de checkout mantienen inputs a 16px efectivos en mobile
- Location: tests\e2e\mobile-touch-gesture.spec.mjs:26:1

# Error details

```
Error: browser.newContext: options.isMobile is not supported in Firefox
```

# Test source

```ts
  1   | import { devices, expect, test } from '@playwright/test';
  2   | import { fillCheckout, installBrowserStubs, installPageGuards } from './helpers.mjs';
  3   | 
  4   | const CHECKOUT_VIEWPORTS = [
  5   |   { width: 320, height: 568 },
  6   |   { width: 390, height: 844 },
  7   |   { width: 430, height: 932 },
  8   | ];
  9   | const MOBILE_PROBE = devices['iPhone 13'];
  10  | 
  11  | const createMobileContext = async (browser, viewport) => browser.newContext({
  12  |   ...MOBILE_PROBE,
  13  |   viewport,
  14  | });
  15  | 
  16  | async function openCheckoutFlow(page) {
  17  |   await page.goto('/?reset=1&demo=1#catalog');
  18  |   await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  19  |   const firstAdd = page.locator('[data-product-grid] [data-add-product]:not([disabled])').first();
  20  |   await expect(firstAdd).toBeVisible();
  21  |   await firstAdd.click();
  22  |   await expect(page.locator('[data-floating-cart]')).toBeVisible();
  23  |   await page.locator('[data-floating-cart]').click();
  24  | }
  25  | 
  26  | test('formularios de checkout mantienen inputs a 16px efectivos en mobile', async ({ browser }) => {
  27  |   test.setTimeout(90_000);
  28  |   for (const viewport of CHECKOUT_VIEWPORTS) {
> 29  |     const context = await createMobileContext(browser, viewport);
      |                     ^ Error: browser.newContext: options.isMobile is not supported in Firefox
  30  |     const page = await context.newPage();
  31  |     const guards = installPageGuards(page);
  32  |     await installBrowserStubs(page);
  33  | 
  34  |     await openCheckoutFlow(page);
  35  |     await fillCheckout(page, {
  36  |       name: 'Cliente Touch',
  37  |       phone: '2995550000',
  38  |       street: 'Roca 123',
  39  |       neighborhood: 'Neuquén Capital',
  40  |       reference: 'Portón negro',
  41  |       notes: '',
  42  |       payment: 'cash',
  43  |       deliveryMode: 'delivery',
  44  |     });
  45  | 
  46  |     const fields = await page.evaluate(() => {
  47  |       return [...document.querySelectorAll('input, select, textarea')].map((field) => {
  48  |         const style = getComputedStyle(field);
  49  |         const rect = field.getBoundingClientRect();
  50  |         return {
  51  |           name: field.getAttribute('name') || field.getAttribute('aria-label') || field.tagName.toLowerCase(),
  52  |           tag: field.tagName.toLowerCase(),
  53  |           type: field.getAttribute('type') || '',
  54  |           fontSize: parseFloat(style.fontSize),
  55  |           visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
  56  |         };
  57  |       });
  58  |     });
  59  | 
  60  |     const small = fields.filter((field) => field.visible && field.fontSize > 0 && field.fontSize < 16);
  61  |     expect(small, `viewport ${viewport.width}x${viewport.height} inputs < 16px`).toHaveLength(0);
  62  |     await guards.assertClean();
  63  |     await context.close();
  64  |   }
  65  | });
  66  | 
  67  | test('botones y acciones críticas de checkout respetan touch-action: manipulation', async ({ browser }) => {
  68  |   const context = await createMobileContext(browser, { width: 390, height: 844 });
  69  |   const page = await context.newPage();
  70  |   const guards = installPageGuards(page);
  71  |   await installBrowserStubs(page);
  72  | 
  73  |   await openCheckoutFlow(page);
  74  |   await fillCheckout(page, {
  75  |     name: 'Cliente Touch',
  76  |     phone: '2995550000',
  77  |     street: 'Roca 123',
  78  |     neighborhood: 'Neuquén Capital',
  79  |     reference: 'Portón negro',
  80  |     notes: '',
  81  |     payment: 'cash',
  82  |     deliveryMode: 'delivery',
  83  |   });
  84  | 
  85  |   const touchAction = await page.evaluate(() => {
  86  |     const candidates = [
  87  |       { name: 'plus', selector: '[data-cart-inc]' },
  88  |       { name: 'minus', selector: '[data-cart-dec]' },
  89  |       { name: 'floatingCart', selector: '[data-floating-cart]' },
  90  |       { name: 'openCart', selector: '[data-open-cart]' },
  91  |       { name: 'mobileNav', selector: '.mobile-nav [data-nav-view="tracking"]' },
  92  |       { name: 'productCard', selector: '.product-card' },
  93  |     ];
  94  |     return candidates.map(({ name, selector }) => {
  95  |       const node = document.querySelector(selector);
  96  |       return { name, exists: Boolean(node), touchAction: node ? getComputedStyle(node).touchAction : null };
  97  |     });
  98  |   });
  99  |   const touchPolicy = await page.evaluate(
  100 |     () => window.matchMedia('(hover: none)').matches || window.matchMedia('(pointer: coarse)').matches,
  101 |   );
  102 |   const invalid = touchAction.filter((item) => item.exists && item.touchAction !== 'manipulation');
  103 |   if (touchPolicy) {
  104 |     expect(
  105 |       invalid,
  106 |       `touch-action esperado en elementos interactivos (390x844): ${JSON.stringify(invalid)}`,
  107 |     ).toEqual([]);
  108 |   }
  109 | 
  110 |   await guards.assertClean();
  111 |   await context.close();
  112 | });
  113 | 
```