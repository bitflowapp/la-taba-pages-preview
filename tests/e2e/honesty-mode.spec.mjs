import { expect, test } from '@playwright/test';
import { fillCheckout, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';

const STATE_KEY = 'la_taba_mvp_v4_state';

test('modo público oculta roles, PIN y datos sembrados, incluso con hash operativo', async ({ page }) => {
  await installPageGuards(page);
  await page.goto('/');

  await expect(page.locator('[data-demo-mode-banner]')).toBeHidden();
  await expect(page.locator('[data-admin-toggle]')).toBeHidden();
  await expect(page.locator('.role-intro')).toBeHidden();
  await expect(page.locator('body')).not.toContainText('1234');

  const state = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  expect(state.appMode).toBe('public');
  expect(state.orders).toHaveLength(0);

  await page.goto('/#business');
  await expect(page.locator('[data-view="home"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-view="business"]')).toBeHidden();
});

test('modo demo muestra la franja persistente y rotula los datos de ejemplo', async ({ page }) => {
  await installPageGuards(page);
  await page.goto('/?demo=1');

  const banner = page.locator('[data-demo-mode-banner]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Presentación comercial');
  await expect(banner).toContainText('escenario de ejemplo');
  await expect(page.locator('.role-intro')).toBeVisible();
  await expect(page.locator('.role-card-pin').first()).toContainText('Código de presentación');

  await page.getByRole('button', { name: 'Entrar como negocio' }).click();
  await page.getByLabel('Código del modo negocio').fill('1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('[data-business-dashboard]')).toContainText('Datos de ejemplo');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Vista de operación');
});

test('checkout público valida datos y termina en una confirmación que dice que no fue enviada', async ({ page }) => {
  await installPageGuards(page);
  await installBrowserStubs(page);
  await page.goto('/#catalog');
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.getByRole('button', { name: 'Ver mi pedido' }).click();

  await page.getByLabel('Nombre').fill('Cliente prueba');
  await page.getByLabel('Teléfono').fill('1');
  await page.getByLabel('Calle y número').fill('x');
  await page.getByLabel('Localidad o zona').selectOption('Neuquén Capital');
  await page.locator('[data-checkout-submit]').click();
  await waitForToast(page, 'Ingresá un teléfono argentino válido');

  await page.getByLabel('Teléfono').fill('2995551234');
  await page.locator('[data-checkout-submit]').click();
  await waitForToast(page, 'Ingresá una calle y número válidos');

  await page.getByLabel('Calle y número').fill('Roca 123');
  await page.locator('[data-checkout-submit]').click();
  await waitForToast(page, 'No se envió al local');

  const tracking = page.locator('[data-tracking-panel]');
  await expect(tracking).toContainText('Pedido de muestra');
  await expect(tracking).toContainText('no se envió al local ni se cobró nada');
  await expect(tracking).not.toContainText('El comercio está revisando');
  await expect(tracking.locator('[data-delivery-code]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Solicitar por WhatsApp' })).toBeHidden();
});

test('estado viejo de carnicería y perfil incompatible se limpian sin reset manual', async ({ page }) => {
  await page.addInitScript(({ stateKey }) => {
    localStorage.setItem(stateKey, JSON.stringify({
      schemaVersion: 1,
      dataVersion: 'carniceria-v1',
      appMode: 'public',
      products: [{ id: 'carne-1', name: 'Vacío premium', price: 1000 }],
      orders: [{ id: 'CARNE-1', customerName: 'Persona heredada' }],
    }));
    localStorage.setItem('la_taba_customer_profile_v1', JSON.stringify({ name: 'Cliente carnicería' }));
    localStorage.setItem('la_taba_customer_history_v1', JSON.stringify([{ id: 'CARNE-1' }]));
  }, { stateKey: STATE_KEY });

  await page.goto('/');
  const persisted = await page.evaluate((key) => ({
    state: JSON.parse(localStorage.getItem(key)),
    profile: localStorage.getItem('la_taba_customer_profile_v1'),
    history: localStorage.getItem('la_taba_customer_history_v1'),
  }), STATE_KEY);

  expect(persisted.state.dataVersion).toBe('la-taba-pizzeria-v1');
  expect(persisted.state.orders).toHaveLength(0);
  expect(persisted.state.products.some((product) => /vacío|carne/i.test(product.name))).toBe(false);
  expect(persisted.profile).toBeNull();
  expect(persisted.history).toBeNull();
  await expect(page.locator('body')).not.toContainText(/carnicería|Vacío premium|Persona heredada/i);
});

test('cambiar de demo a público invalida pedidos de ejemplo y deja medios honestos', async ({ page }) => {
  await page.goto('/?demo=1');
  const demoOrders = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).orders.length, STATE_KEY);
  expect(demoOrders).toBeGreaterThan(0);

  await page.goto('/');
  const publicState = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  expect(publicState.appMode).toBe('public');
  expect(publicState.orders).toHaveLength(0);
  await expect(page.locator('select[name="paymentMethod"]')).toHaveCount(0);
  await expect(page.locator('input[name="paymentMethod"]')).toHaveValue('coordinate');
  await expect(page.locator('[data-coupon-code]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('TABA10');
});

test('Moto g15: no hay overflow horizontal y los controles principales alcanzan 44 px', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 432, height: 815 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/?demo=1');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  for (const selector of ['[data-open-cart]', '.mobile-nav button', '.rail-link', '[data-favorite-product]', '[data-add-product]']) {
    const locator = page.locator(selector).filter({ visible: true }).first();
    if (await locator.count()) {
      const box = await locator.boundingBox();
      expect(Math.min(box?.width || 0, box?.height || 0), selector).toBeGreaterThanOrEqual(43.5);
    }
  }
  await context.close();
});
