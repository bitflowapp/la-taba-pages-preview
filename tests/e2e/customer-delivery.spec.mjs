import { expect, test } from '@playwright/test';

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';
const PROFILE_REGRESSION_PRODUCT_ID = '30000000-0000-4000-8000-000000000001';

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

test('checkout reemplaza la precarga automática cuando cambia la dirección predeterminada remota', async ({ page }) => {
  const addresses = [
    {
      id: '20000000-0000-4000-8000-000000000001',
      label: 'Casa',
      formattedAddress: 'Roca 123, Neuquén',
      street: 'Roca',
      streetNumber: '123',
      city: 'Neuquén',
      isDefault: true,
      source: 'manual',
    },
    {
      id: '20000000-0000-4000-8000-000000000002',
      label: 'Trabajo',
      formattedAddress: 'Mitre 456, Neuquén',
      street: 'Mitre',
      streetNumber: '456',
      city: 'Neuquén',
      isDefault: false,
      source: 'manual',
    },
  ];

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
          profile: { id: CUSTOMER_ID, name: 'Cliente QA', phone: '2995550000' },
          addresses,
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
  await page.addInitScript(({ businessId, persistedSession }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase',
        supabaseUrl: 'https://taba-customer-profile-test.supabase.co',
        publishableKey: 'sb_publishable_test_key',
        businessId,
      },
    };
    localStorage.setItem('sb-taba-customer-profile-test-auth-token', JSON.stringify(persistedSession));
  }, { businessId: BUSINESS_ID, persistedSession: authSession() });

  await page.goto('/#cart');
  const checkout = page.locator('[data-checkout-form]');
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
  await expect(checkout.locator('[name="customerAddressId"]')).toHaveValue(addresses[0].id);
  await expect(checkout.locator('[name="customerStreetAddress"]')).toHaveValue('Roca 123');

  addresses[0].isDefault = false;
  addresses[1].isDefault = true;
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('taba:customer-profile-updated', {
      detail: { source: 'profile' },
    }));
  });

  await expect(checkout.locator('[name="customerAddressId"]')).toHaveValue(addresses[1].id);
  await expect(checkout.locator('[name="customerStreetAddress"]')).toHaveValue('Mitre 456');
});

test('una respuesta tardía no pisa una dirección elegida ni una entrada manual posterior', async ({ page }) => {
  const remote = {
    profile: { id: CUSTOMER_ID, name: 'Cliente QA', phone: '2995550000' },
    addresses: regressionAddresses(),
  };
  let holdNextProfile = false;
  let profileRequestWaiting = false;
  let releaseProfileRequest = () => {};
  await installProfileScenario(page, remote, async () => {
    if (!holdNextProfile) return;
    holdNextProfile = false;
    profileRequestWaiting = true;
    await new Promise((resolve) => {
      releaseProfileRequest = resolve;
    });
    profileRequestWaiting = false;
  });

  const checkout = await openCheckoutForRegression(page);
  const savedAddresses = page.locator('[data-customer-addresses]');
  await expect(checkout.locator('[name="customerAddressId"]')).toHaveValue(remote.addresses[0].id);

  holdNextProfile = true;
  await dispatchProfileUpdated(page);
  await expect.poll(() => profileRequestWaiting).toBe(true);
  await savedAddresses
    .locator(`[data-customer-address-id="${remote.addresses[1].id}"] [data-customer-address-action="select"]`)
    .last()
    .evaluate((button) => button.click());
  releaseProfileRequest();
  await expect.poll(() => profileRequestWaiting).toBe(false);
  await expect(checkout.locator('[name="customerAddressId"]')).toHaveValue(remote.addresses[1].id);
  await expect(checkout).toHaveAttribute('data-address-source', 'saved_address_selected');

  await page.evaluate(() => {
    window.location.hash = '#home';
  });
  await expect(page.locator('body')).toHaveAttribute('data-active-view', 'home');
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  await expect(checkout.locator('[name="customerAddressId"]')).toHaveValue(remote.addresses[0].id);
  await expect(checkout).toHaveAttribute('data-address-source', 'profile_default');

  holdNextProfile = true;
  await dispatchProfileUpdated(page);
  await expect.poll(() => profileRequestWaiting).toBe(true);
  await setCheckoutInput(checkout, 'customerStreetAddress', 'Calle Manual 999');
  await setCheckoutInput(checkout, 'customerNeighborhood', 'Ciudad Manual');
  releaseProfileRequest();
  await expect.poll(() => profileRequestWaiting).toBe(false);
  await expect(checkout.locator('[name="customerStreetAddress"]')).toHaveValue('Calle Manual 999');
  await expect(checkout.locator('[name="customerAddressId"]')).toHaveValue('');
  await expect(checkout).toHaveAttribute('data-address-source', 'manual_entry');
  await expect(checkout).toHaveAttribute('data-address-form-dirty', 'true');
});

test('una dirección archivada deja de seleccionarse y cae al default activo o a entrada manual', async ({ page }) => {
  const remote = {
    profile: { id: CUSTOMER_ID, name: 'Cliente QA', phone: '2995550000' },
    addresses: regressionAddresses(),
  };
  await installProfileScenario(page, remote);
  const checkout = await openCheckoutForRegression(page);
  const savedAddresses = page.locator('[data-customer-addresses]');

  await savedAddresses
    .locator(`[data-customer-address-id="${remote.addresses[1].id}"] [data-customer-address-action="select"]`)
    .last()
    .evaluate((button) => button.click());
  await expect(checkout.locator('[name="customerAddressId"]')).toHaveValue(remote.addresses[1].id);

  remote.addresses.splice(1, 1);
  await dispatchProfileUpdated(page);
  await expect(checkout.locator('[name="customerAddressId"]')).toHaveValue(remote.addresses[0].id);
  await expect(checkout).toHaveAttribute('data-address-source', 'profile_default');

  remote.addresses.splice(0, 1);
  await dispatchProfileUpdated(page);
  await expect(checkout.locator('[name="customerAddressId"]')).toHaveValue('');
  await expect(checkout).toHaveAttribute('data-address-source', 'manual_entry');
  await expect(checkout.locator('[name="customerStreetAddress"]')).toHaveValue('Roca 123');
});

test('el flujo invitado mantiene entrada manual y nunca intenta aplicar un perfil', async ({ page }) => {
  const remote = { profile: null, addresses: [] };
  await installProfileScenario(page, remote);
  const checkout = await openCheckoutForRegression(page, '');

  await setCheckoutInput(checkout, 'customerStreetAddress', 'Calle Invitada 321');
  await setCheckoutInput(checkout, 'customerNeighborhood', 'Ciudad Invitada');
  await dispatchProfileUpdated(page);

  await expect(checkout.locator('[name="customerStreetAddress"]')).toHaveValue('Calle Invitada 321');
  await expect(checkout.locator('[name="customerAddressId"]')).toHaveValue('');
  await expect(checkout).toHaveAttribute('data-address-source', 'guest_entry');
});

async function installProfileScenario(page, remote, beforeProfileResponse = async () => {}) {
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
      await beforeProfileResponse();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(remote),
      });
      return;
    }
    if (url.pathname.includes('/rest/v1/businesses')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(profileRegressionBusiness()),
      });
      return;
    }
    if (url.pathname.includes('/rest/v1/products')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'content-range': '0-0/1' },
        body: JSON.stringify([profileRegressionProduct()]),
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
  await page.addInitScript(({ businessId, persistedSession }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase',
        supabaseUrl: 'https://taba-customer-profile-test.supabase.co',
        publishableKey: 'sb_publishable_test_key',
        businessId,
      },
    };
    localStorage.setItem('sb-taba-customer-profile-test-auth-token', JSON.stringify(persistedSession));
  }, { businessId: BUSINESS_ID, persistedSession: authSession() });
}

async function openCheckoutForRegression(page, expectedName = 'Cliente QA') {
  await page.goto('/#catalog');
  const addProduct = page.locator(`[data-product-grid] [data-add-product="${PROFILE_REGRESSION_PRODUCT_ID}"]`);
  await expect(addProduct).toBeVisible();
  await addProduct.click();
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  const checkout = page.locator('[data-checkout-form]');
  if (expectedName) {
    await expect(page.locator('[data-customer-profile]')).toHaveAttribute('data-customer-profile-state', 'ready');
  }
  await expect(checkout).toHaveAttribute('data-profile-hydration-version', /[1-9]\d*/);
  await expect(checkout).toBeVisible();
  await expect(checkout.locator('[name="customerStreetAddress"]')).toBeVisible();
  await expect(checkout.locator('[name="customerName"]')).toHaveValue(expectedName);
  return checkout;
}

async function dispatchProfileUpdated(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('taba:customer-profile-updated', {
      detail: { source: 'profile' },
    }));
  });
}

async function setCheckoutInput(checkout, name, value) {
  await checkout.locator(`[name="${name}"]`).fill(value);
}

function profileRegressionBusiness() {
  return {
    id: BUSINESS_ID,
    name: 'TABA Perfil QA',
    address: 'Neuquén',
    currency_code: 'ARS',
    ordering_enabled: true,
    ordering_verified: true,
    delivery_enabled: true,
    pickup_enabled: true,
    delivery_fee: 0,
    minimum_delivery_subtotal: 0,
    is_active: true,
    status: 'open',
  };
}

function profileRegressionProduct() {
  return {
    id: PROFILE_REGRESSION_PRODUCT_ID,
    business_id: BUSINESS_ID,
    external_id: 'perfil-regression-soda',
    sku: 'PERFIL-REGRESSION-SODA',
    name: 'Soda Perfil QA',
    brand: 'TABA',
    description: 'Producto exclusivo del fixture de Perfil.',
    category: 'Gaseosas',
    subcategory: 'Soda',
    variant: 'Botella 500 ml',
    presentation: 'Botella 500 ml',
    capacity_value: 500,
    capacity_unit: 'ml',
    capacity: '500 ml',
    packaging_type: 'botella',
    units_per_pack: 1,
    price: 1200,
    stock: 10,
    available: true,
    chilled: false,
    is_alcoholic: false,
    minimum_age: null,
    image_url: '/assets/catalog/beverages/coca-cola-original-pet-500ml-pack-12/product.webp',
    image_thumbnail_url: '/assets/catalog/beverages/coca-cola-original-pet-500ml-pack-12/thumbnail.webp',
    image_sha256: '',
    image_thumbnail_sha256: '',
    source_image_sha256: '',
    tags: [],
    sort_order: 1,
    is_active: true,
    is_verified: true,
  };
}

function regressionAddresses() {
  return [
    {
      id: '20000000-0000-4000-8000-000000000001',
      label: 'Casa',
      formattedAddress: 'Roca 123, Neuquén',
      street: 'Roca',
      streetNumber: '123',
      city: 'Neuquén',
      isDefault: true,
      source: 'manual',
    },
    {
      id: '20000000-0000-4000-8000-000000000002',
      label: 'Trabajo',
      formattedAddress: 'Mitre 456, Neuquén',
      street: 'Mitre',
      streetNumber: '456',
      city: 'Neuquén',
      isDefault: false,
      source: 'manual',
    },
  ];
}

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
