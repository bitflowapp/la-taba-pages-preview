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

test('modo demo usa una sola insignia y mueve accesos operativos fuera de la home', async ({ page }) => {
  await installPageGuards(page);
  await page.goto('/?demo=1');

  const banner = page.locator('[data-demo-mode-banner]');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveText('Demo');
  await expect(page.locator('[data-view="home"] .role-intro')).toHaveCount(0);
  await expect(page.locator('[data-view="home"]')).not.toContainText('1234');

  await page.locator('.desktop-nav [data-nav-view="profile"]').click();
  await expect(page.getByRole('button', { name: 'Guía de demo' })).toBeVisible();
  await page.getByRole('button', { name: 'Panel del negocio' }).click();
  await page.getByLabel('Código del modo negocio').fill('1234');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('[data-business-dashboard]')).toContainText('Datos de ejemplo');
  await expect(page.locator('[data-business-dashboard]')).toContainText('Vista de operación');
});

test('runtime completo habilita modo producción sin catálogo demo ni PIN', async ({ page }) => {
  await page.route('https://taba-test.supabase.co/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/0' },
      body: '[]',
    });
  });
  await page.addInitScript(({ stateKey }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase',
        supabaseUrl: 'https://taba-test.supabase.co',
        publishableKey: 'sb_publishable_test_key',
        businessId: '00000000-0000-4000-8000-000000000001',
      },
    };
    localStorage.setItem(stateKey, JSON.stringify({
      schemaVersion: 3,
      dataVersion: 'la-taba-runtime-v2',
      appMode: 'production',
      products: [],
      cart: [],
      orders: [{
        id: 'PII-CACHED',
        customerName: 'Cliente cacheado',
        customerPhone: '2995559999',
      }],
    }));
  }, { stateKey: STATE_KEY });
  await page.goto('/#business');

  await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'production');
  await expect(page.locator('[data-view="business"]')).toBeVisible();
  await expect(page.locator('[data-production-auth-card="business"]')).toBeVisible();
  await expect(page.locator('[data-production-workspace="business"]')).toBeHidden();
  await expect(page.locator('[data-view="business"] [data-open-pin]')).toBeHidden();
  await expect(page.locator('[data-view="business"] [data-admin-unlocked]')).toBeHidden();

  await page.locator('[data-nav-view="home"]').first().click();
  await expect(page.locator('[data-view="home"] [data-production-catalog-gate]')).toBeVisible();
  await expect(page.locator('[data-view="home"] [data-catalog-dependent]')).toBeHidden();
  await expect(page.locator('[data-view="home"]')).not.toContainText(/pedido de muestra|no se envió|1234/i);
  await expect(page.locator('body')).not.toContainText('Cliente cacheado');
  expect(await page.evaluate((key) => localStorage.getItem(key), STATE_KEY)).toBeNull();
});

test('runtime productivo incompleto falla cerrado y no cae a preview/demo', async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase',
        supabaseUrl: 'http://orders.example.test',
        publishableKey: 'sb_publishable_test_key',
        businessId: '00000000-0000-4000-8000-000000000001',
      },
    };
  });
  await page.goto('/#catalog');

  await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'unavailable');
  await expect(page.locator('[data-view="catalog"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-view="catalog"] [data-production-catalog-gate]')).toBeVisible();
  await expect(page.locator('[data-view="catalog"] [data-production-catalog-message]')).toContainText('configuración productiva está incompleta');
  await expect(page.locator('[data-view="catalog"] [data-catalog-dependent]')).toBeHidden();
  await expect(page.locator('[data-admin-toggle]')).toBeHidden();
  await expect(page.locator('.topbar [data-production-only]')).toBeHidden();
});

test('checkout demo valida datos y explicita que no envía el pedido', async ({ page }) => {
  await installPageGuards(page);
  await installBrowserStubs(page);
  await page.goto('/?demo=1#catalog');
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.getByRole('button', { name: 'Ver mi pedido' }).click();

  await page.getByLabel('Nombre').fill('Cliente prueba');
  await page.getByLabel('Teléfono').fill('1');
  await page.getByLabel('Calle y número').fill('x');
  await page.getByLabel('Localidad o zona').fill('Neuquén Capital');
  const paymentMethod = page.getByLabel('Forma de pago');
  await expect(paymentMethod).toBeVisible();
  await expect(paymentMethod.locator('option')).toHaveCount(3);
  await expect(paymentMethod.locator('option[value="coordinate"]')).toHaveText('A coordinar con el local');
  await paymentMethod.selectOption('transfer');
  await expect(paymentMethod).toHaveValue('transfer');
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

test('estado legacy incompatible y perfil desactualizado se limpian sin reset manual', async ({ page }) => {
  await page.addInitScript(({ stateKey }) => {
    localStorage.setItem(stateKey, JSON.stringify({
      schemaVersion: 1,
      dataVersion: 'legacy-retail-v1',
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

  expect(persisted.state.dataVersion).toBe('la-taba-runtime-v2');
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
  const paymentMethod = page.locator('select[name="paymentMethod"]');
  await expect(paymentMethod).toHaveCount(1);
  await expect(paymentMethod.locator('option[value="coordinate"]')).toHaveCount(1);
  await expect(page.locator('input[name="paymentMethod"]')).toHaveCount(0);
  await expect(page.locator('[data-coupon-code]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('TABA10');
});

test('Moto g15: no hay overflow horizontal y los controles principales alcanzan 44 px', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 432, height: 815 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/?demo=1');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('.mobile-nav')).toBeVisible();
  await expect(page.locator('.desktop-nav')).toBeHidden();

  for (const [selector, minimumTarget] of [
    ['[data-open-cart]', 43.5],
    ['.mobile-nav button', 43.5],
    ['.rail-link', 43.5],
    ['[data-favorite-product]', 43.5],
    // La acción de una card compacta mantiene un blanco táctil mínimo de 40 px.
    ['[data-add-product]', 39.5],
  ]) {
    const locator = page.locator(selector).filter({ visible: true }).first();
    if (await locator.count()) {
      const box = await locator.boundingBox();
      expect(Math.min(box?.width || 0, box?.height || 0), selector).toBeGreaterThanOrEqual(minimumTarget);
    }
  }
  await context.close();
});
