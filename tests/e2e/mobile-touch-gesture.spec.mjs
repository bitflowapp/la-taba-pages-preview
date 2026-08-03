import { devices, expect, test } from '@playwright/test';
import { fillCheckout, installBrowserStubs, installPageGuards } from './helpers.mjs';

const CHECKOUT_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];
const MOBILE_PROBE = devices['iPhone 13'];

const createMobileContext = async (browser, viewport) => {
  const options = { ...MOBILE_PROBE, viewport };
  if (browser.browserType().name() === 'firefox') delete options.isMobile;
  return browser.newContext(options);
};

async function openCheckoutFlow(page) {
  await page.goto('/?reset=1&demo=1#catalog');
  await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  const firstAdd = page.locator('[data-product-grid] [data-add-product]:not([disabled])').first();
  await expect(firstAdd).toBeVisible();
  await firstAdd.click();
  await expect(page.locator('[data-floating-cart]')).toBeVisible();
  await page.locator('[data-floating-cart]').click();
}

test('formularios de checkout mantienen inputs a 16px efectivos en mobile', async ({ browser }) => {
  test.setTimeout(90_000);
  for (const viewport of CHECKOUT_VIEWPORTS) {
    const context = await createMobileContext(browser, viewport);
    const page = await context.newPage();
    const guards = installPageGuards(page);
    await installBrowserStubs(page);

    await openCheckoutFlow(page);
    await fillCheckout(page, {
      name: 'Cliente Touch',
      phone: '2995550000',
      street: 'Roca 123',
      neighborhood: 'Neuquén Capital',
      reference: 'Portón negro',
      notes: '',
      payment: 'cash',
      deliveryMode: 'delivery',
    });

    const fields = await page.evaluate(() => {
      return [...document.querySelectorAll('input, select, textarea')].map((field) => {
        const style = getComputedStyle(field);
        const rect = field.getBoundingClientRect();
        return {
          name: field.getAttribute('name') || field.getAttribute('aria-label') || field.tagName.toLowerCase(),
          tag: field.tagName.toLowerCase(),
          type: field.getAttribute('type') || '',
          fontSize: parseFloat(style.fontSize),
          visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
        };
      });
    });

    const small = fields.filter((field) => field.visible && field.fontSize > 0 && field.fontSize < 16);
    expect(small, `viewport ${viewport.width}x${viewport.height} inputs < 16px`).toHaveLength(0);
    await guards.assertClean();
    await context.close();
  }
});

test('botones y acciones críticas de checkout respetan touch-action: manipulation', async ({ browser }) => {
  const context = await createMobileContext(browser, { width: 390, height: 844 });
  const page = await context.newPage();
  const guards = installPageGuards(page);
  await installBrowserStubs(page);

  await openCheckoutFlow(page);
  await fillCheckout(page, {
    name: 'Cliente Touch',
    phone: '2995550000',
    street: 'Roca 123',
    neighborhood: 'Neuquén Capital',
    reference: 'Portón negro',
    notes: '',
    payment: 'cash',
    deliveryMode: 'delivery',
  });

  const touchAction = await page.evaluate(() => {
    const candidates = [
      { name: 'plus', selector: '[data-cart-inc]' },
      { name: 'minus', selector: '[data-cart-dec]' },
      { name: 'floatingCart', selector: '[data-floating-cart]' },
      { name: 'openCart', selector: '[data-open-cart]' },
      { name: 'mobileNav', selector: '.mobile-nav [data-nav-view="tracking"]' },
      { name: 'productCard', selector: '.product-card' },
    ];
    return candidates.map(({ name, selector }) => {
      const node = document.querySelector(selector);
      return { name, exists: Boolean(node), touchAction: node ? getComputedStyle(node).touchAction : null };
    });
  });
  const touchPolicy = await page.evaluate(
    () => window.matchMedia('(hover: none)').matches || window.matchMedia('(pointer: coarse)').matches,
  );
  const invalid = touchAction.filter((item) => item.exists && item.touchAction !== 'manipulation');
  if (touchPolicy) {
    expect(
      invalid,
      `touch-action esperado en elementos interactivos (390x844): ${JSON.stringify(invalid)}`,
    ).toEqual([]);
  }

  await guards.assertClean();
  await context.close();
});
