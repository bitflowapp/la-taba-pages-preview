import { expect, test } from '@playwright/test';

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';

test('checkout productivo recupera direcciones y solicita GPS sólo después del toque', async ({ page }) => {
  const consoleMessages = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  await page.route('https://taba-customer-profile-test.supabase.co/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/auth/v1/token')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(authSession()),
      });
      return;
    }
    if (url.pathname.includes('/rest/v1/rpc/get_current_customer_profile')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profile: { id: CUSTOMER_ID, name: 'Cliente QA', phone: '299 555 0000' },
          addresses: [
            { id: '20000000-0000-4000-8000-000000000001', label: 'Casa', formattedAddress: 'Roca 123, Neuquén', street: 'Roca 123', city: 'Neuquén', reference: 'Portón negro', isDefault: true, source: 'manual' },
            { id: '20000000-0000-4000-8000-000000000002', label: 'Trabajo', formattedAddress: 'Mitre 456, Neuquén', street: 'Mitre 456', city: 'Neuquén', isDefault: false, source: 'manual' },
          ],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': '0-0/0' },
      body: '[]',
    });
  });
  const session = authSession();
  await page.addInitScript(({ businessId, session: persistedSession }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase',
        supabaseUrl: 'https://taba-customer-profile-test.supabase.co',
        publishableKey: 'sb_publishable_test_key',
        businessId,
      },
    };
    window.__customerGpsCalls = 0;
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success) {
          window.__customerGpsCalls += 1;
          success({ coords: { latitude: -38.9516, longitude: -68.0591, accuracy: 18 } });
        },
      },
    });
    localStorage.setItem('sb-taba-customer-profile-test-auth-token', JSON.stringify(persistedSession));
  }, { businessId: BUSINESS_ID, session });

  await page.goto('/#cart');
  const checkout = page.locator('[data-checkout-form]');
  const addresses = page.locator('[data-customer-addresses]');
  await expect(addresses).toContainText('Casa');
  await checkout.evaluate((node) => {
    node.hidden = false;
    const view = node.closest('[data-view]');
    if (view) {
      view.hidden = false;
      view.setAttribute('aria-hidden', 'false');
      view.classList.add('is-active');
      view.style.display = 'block';
    }
  });
  await expect(addresses).toContainText('Casa');
  await expect(addresses).toContainText('Trabajo');
  await expect(checkout.locator('[name="customerName"]')).toHaveValue('Cliente QA');
  await expect(checkout.locator('[name="customerStreetAddress"]')).toHaveValue('Roca 123');
  expect(await page.evaluate(() => window.__customerGpsCalls)).toBe(0);

  await addresses.locator('[data-customer-address-action="use-location"]').evaluate((button) => button.click());
  await expect(addresses).toContainText('No hay un geocodificador configurado');
  await expect(addresses).toContainText('Ubicación aproximada recibida');
  expect(await page.evaluate(() => window.__customerGpsCalls)).toBe(1);

  await addresses.locator('[data-customer-address-action="confirm-location"]').evaluate((button) => button.click());
  await expect(addresses).toContainText('Ubicación confirmada para esta entrega');
  await expect(checkout.locator('[name="deliveryLatitude"]')).toHaveValue('-38.9516');

  await addresses
    .locator('[data-customer-address-id="20000000-0000-4000-8000-000000000002"] [data-customer-address-action="select"]')
    .last()
    .evaluate((button) => button.click());
  await expect(checkout.locator('[name="customerStreetAddress"]')).toHaveValue('Mitre 456');
  await expect(checkout.locator('[name="customerAddressId"]')).toHaveValue('20000000-0000-4000-8000-000000000002');
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 393, height: 852 },
    { width: 430, height: 932 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(consoleMessages.join('\n')).not.toContain('Cliente QA');
  expect(consoleMessages.join('\n')).not.toContain('299 555 0000');
});

function authSession() {
  const token = fakeJwt({ sub: CUSTOMER_ID, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' });
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'refresh-token-for-e2e-only',
    user: { id: CUSTOMER_ID, aud: 'authenticated', role: 'authenticated', is_anonymous: true, user_metadata: { taba_actor: 'customer' } },
  };
}

function fakeJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.signature`;
}
