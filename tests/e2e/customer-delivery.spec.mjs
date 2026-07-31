import { expect, test } from '@playwright/test';
import {
  buildCheckoutAddresses,
  fillCheckout,
  selectCheckoutAddress,
  seedCheckoutProfile,
  SANDBOX_PROFILE_STORAGE_PREFIX,
  waitForToast,
} from './helpers.mjs';

const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001';
const PROFILE_REGRESSION_PRODUCT_ID = '30000000-0000-4000-8000-000000000001';
// Holgura muy por encima del intervalo de sondeo de Playwright y muy por debajo
// del timeout de `expect`, para que el estado de carga sea observable sin
// volver lenta la prueba.
const PROFILE_RELOAD_HOLD_MS = 750;

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
            { id: '20000000-0000-4000-8000-000000000001', label: 'Casa', formattedAddress: 'Roca 123, Neuquén', street: 'Roca', streetNumber: '123', city: 'Neuquén', reference: 'Portón negro', isDefault: true, source: 'manual' },
            { id: '20000000-0000-4000-8000-000000000002', label: 'Trabajo', formattedAddress: 'Mitre 456, Neuquén', street: 'Mitre', streetNumber: '456', city: 'Neuquén', isDefault: false, source: 'manual' },
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
  await expect(checkout.locator('[data-profile-summary]')).toHaveCount(1);
  await expect(checkout.locator('[data-profile-name]')).toHaveText('Cliente QA');
  await expect(checkout.locator('[data-profile-phone]')).toHaveText('299 555 0000');
  await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
    'data-customer-address-id',
    '20000000-0000-4000-8000-000000000001',
  );
  await expect(checkout).toHaveAttribute('data-address-source', 'profile_default');
  expect(await page.evaluate(() => window.__customerGpsCalls)).toBe(0);

  await expect(addresses.locator('[data-customer-address-action="use-location"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__customerGpsCalls)).toBe(0);

  await addresses
    .locator('[data-customer-address-id="20000000-0000-4000-8000-000000000002"] [data-customer-address-action="select"]')
    .last()
    .evaluate((button) => button.click());
  await expect(checkout).toHaveAttribute('data-address-source', /profile_default|saved_address_selected/);
  await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
    'data-customer-address-id',
    '20000000-0000-4000-8000-000000000002',
  );
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

test('checkout actualiza sólo el default automático y preserva una selección explícita', async ({ page }) => {
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

  // `loadCustomerDeliveryProfile` marca `state.loading`, renderiza y recién ahí
  // espera al repositorio, así que el anuncio `aria-live` de carga dura
  // exactamente lo que tarde la respuesta. Con el stub respondiendo dentro del
  // mismo frame, observarlo depende de la velocidad de la máquina. Retener las
  // recargas posteriores a la carga inicial mantiene la aserción del estado
  // transitorio, pero deja de depender del temporizado del runner.
  let profileFetches = 0;
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
      profileFetches += 1;
      if (profileFetches > 1) {
        await new Promise((resolve) => { setTimeout(resolve, PROFILE_RELOAD_HOLD_MS); });
      }
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

  await page.goto('/#catalog');
  const addProduct = page.locator(`[data-product-grid] [data-add-product="${PROFILE_REGRESSION_PRODUCT_ID}"]`);
  await expect(addProduct).toBeVisible();
  await addProduct.click();
  await page.evaluate(() => { window.location.hash = '#cart'; });
  await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  const checkout = page.locator('[data-checkout-form]');
  const savedAddresses = page.locator('[data-customer-addresses]');
  const savedAddressStatus = savedAddresses.locator('.saved-address-status');
  await expect(checkout).toBeVisible();
  await expect(checkout).toHaveAttribute('data-address-source', 'profile_default');
  await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
    'data-customer-address-id',
    addresses[0].id,
  );
  await expect(checkout).toHaveAttribute('data-address-source', 'profile_default');

  addresses[0].isDefault = false;
  addresses[1].isDefault = true;
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('taba:customer-profile-updated', {
      detail: { source: 'profile' },
    }));
  });
  await expect(savedAddressStatus).toContainText('Cargando');
  await expect(savedAddressStatus).toHaveText('');
  await expect(checkout).toHaveAttribute('data-address-source', 'profile_default');
  await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
    'data-customer-address-id',
    addresses[1].id,
  );

  await savedAddresses
    .locator(`[data-customer-address-id="${addresses[0].id}"] [data-customer-address-action="select"]`)
    .last()
    .click();
  await expect(checkout).toHaveAttribute('data-address-source', 'saved_address_selected');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('taba:customer-profile-updated', {
      detail: { source: 'profile' },
    }));
  });
  await expect(savedAddressStatus).toContainText('Cargando');
  await expect(savedAddressStatus).toHaveText('');
  await expect(checkout).toHaveAttribute('data-address-source', /profile_default|saved_address_selected/);
  await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
    'data-customer-address-id',
    addresses[0].id,
  );

  addresses[0].label = 'Casa actualizada';
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('taba:customer-profile-updated', {
      detail: { source: 'profile' },
    }));
  });
  await expect(savedAddressStatus).toContainText('Cargando');
  await expect(savedAddressStatus).toHaveText('');
  await expect(checkout).toHaveAttribute('data-address-source', /profile_default|saved_address_selected/);
  await expect(checkout).toHaveAttribute('data-address-form-dirty', 'false');

  await page.evaluate(() => { window.location.hash = '#home'; });
  await expect(page.locator('body')).toHaveAttribute('data-active-view', 'home');
  await page.evaluate(() => { window.location.hash = '#cart'; });
  await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
    'data-customer-address-id',
    addresses[1].id,
  );
  await expect(checkout).toHaveAttribute('data-address-source', 'profile_default');
});

test('checkout permite editar Perfil y volver al pedido conservando selecciÃ³n', async ({ page }) => {
  await page.goto('/?demo=1#catalog');
  await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(page.locator('[data-view="cart"]')).toBeVisible();

  const addresses = buildCheckoutAddresses(1, 'return-checkout');
  await fillCheckout(page, {
    name: 'Cliente demo inicial',
    phone: '2995550001',
    addresses,
    payment: 'cash',
    deliveryMode: 'delivery',
  });

  const selectedAddressId = addresses[0].id;
  const checkout = page.locator('[data-checkout-form]');
  await expect(checkout.locator('[data-profile-name]')).toHaveText('Cliente demo inicial');
  await expect(checkout.locator('[data-profile-phone]')).toHaveText('299 555 0001');
  await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
    'data-customer-address-id',
    selectedAddressId,
  );

  await checkout.locator('[data-profile-checkout-action="edit-profile"]').click();
  const profile = page.locator('[data-customer-profile]');
  await expect(profile).toHaveAttribute('data-customer-profile-state', 'ready');
  await expect(profile.locator('[data-profile-action="return-to-checkout"]')).toBeVisible();
  await profile.locator('[data-profile-action="edit-personal"]').click();
  await profile.locator('[name="profileFullName"]').fill('Cliente checkout editado');
  await profile.locator('[name="profilePhone"]').fill('2995551111');
  await profile.locator('[data-profile-action="save-personal"]').click();

  await expect(page.locator('[data-profile-name]')).toHaveText('Cliente checkout editado');
  await expect(page.locator('[data-profile-phone]')).toHaveText('299 555 1111');
  await profile.locator('[data-profile-action="return-to-checkout"]').click();

  await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  await expect(page.locator('[data-checkout-form]')).toHaveAttribute('data-address-source', /profile_default|saved_address_selected/);
  await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
    'data-customer-address-id',
    selectedAddressId,
  );
  await expect(checkout.locator('[data-profile-name]')).toHaveText('Cliente checkout editado');
  await expect(checkout.locator('[data-profile-phone]')).toHaveText('299 555 1111');
  await expect(page.locator('input[value="delivery"][name="deliveryMode"]')).toBeChecked();
});

test('checkout con 4 direcciones renderiza compactado y permite expandir para seleccionar la cuarta', async ({ page }) => {
  await page.goto('/?demo=1#catalog');
  await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(page.locator('[data-view="cart"]')).toBeVisible();

  const addresses = buildCheckoutAddresses(4, 'e2e-compact');
  await fillCheckout(page, {
    name: 'Cliente 4',
    phone: '2995554004',
    addresses,
    payment: 'cash',
    deliveryMode: 'delivery',
  });

  const addressesRoot = page.locator('[data-customer-addresses]');
  const list = addressesRoot.locator('.profile-address-list');
  const toggle = page.locator('[data-profile-checkout-action="toggle-addresses"]');

  await expect(list).toHaveAttribute('data-address-total', '4');
  await expect(list.locator('.profile-address-card')).toHaveCount(3);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText(/Ver las 4 direcciones/);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(list).toHaveClass(/is-expanded/);
  await expect(list.locator('.profile-address-card')).toHaveCount(4);
  await expect(list.locator(`[data-customer-address-id="${addresses[3].id}"]`)).toBeVisible();

  const selected = await selectCheckoutAddress(page, { id: addresses[3].id });
  await expect(page.locator('[data-checkout-form]')).toHaveAttribute('data-address-source', 'saved_address_selected');
  await expect(selected).toHaveClass(/is-selected/);
  await expect(selected).toHaveAttribute('data-customer-address-id', addresses[3].id);
});

test('checkout con 1 dirección conserva la selección predeterminada visible', async ({ page }) => {
  await page.goto('/?demo=1#catalog');
  await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(page.locator('[data-view="cart"]')).toBeVisible();

  const addresses = buildCheckoutAddresses(1, 'e2e-single');
  await fillCheckout(page, {
    name: 'Cliente 1',
    phone: '2995554001',
    addresses,
    payment: 'cash',
    deliveryMode: 'delivery',
  });

  const checkout = page.locator('[data-checkout-form]');
  const list = checkout.locator('.profile-address-list');
  await expect(list).toHaveAttribute('data-address-total', '1');
  await expect(list.locator('.profile-address-card')).toHaveCount(1);
  await expect(checkout.locator('.profile-address-list .profile-address-card.is-selected')).toHaveAttribute(
    'data-customer-address-id',
    addresses[0].id,
  );
  await expect(checkout).toHaveAttribute('data-address-source', 'profile_default');
  await expect(page.locator('[data-profile-checkout-action="toggle-addresses"]')).toHaveCount(0);
  await expect(checkout.locator('.profile-address-list')).toBeVisible();
});

test('checkout con 10 direcciones inicia compactado y puede seleccionar una dirección oculta', async ({ page }) => {
  await page.goto('/?demo=1#catalog');
  await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(page.locator('[data-view="cart"]')).toBeVisible();

  const addresses = buildCheckoutAddresses(10, 'e2e-expanded');
  await fillCheckout(page, {
    name: 'Cliente 10',
    phone: '2995551010',
    addresses,
    payment: 'transfer',
    deliveryMode: 'delivery',
  });

  const addressesRoot = page.locator('[data-customer-addresses]');
  const list = addressesRoot.locator('.profile-address-list');
  const toggle = page.locator('[data-profile-checkout-action="toggle-addresses"]');

  await expect(list).toHaveAttribute('data-address-total', '10');
  await expect(list.locator('.profile-address-card')).toHaveCount(3);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText(/Ver las 10 direcciones/);
  await expect(toggle).toContainText(/7/);
  await expect(addressesRoot.locator('.profile-address-card')).toHaveCount(3);

  await toggle.click();
  await expect(list).toHaveClass(/is-expanded/);
  await expect(list.locator('.profile-address-card')).toHaveCount(10);
  await expect(list.locator(`[data-customer-address-id="${addresses[9].id}"]`)).toBeVisible();

  const selected = await selectCheckoutAddress(page, { id: addresses[9].id });
  await expect(page.locator('[data-checkout-form]')).toHaveAttribute('data-address-source', 'saved_address_selected');
  await expect(selected).toHaveClass(/is-selected/);
  await expect(selected).toHaveAttribute('data-customer-address-id', addresses[9].id);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(list.locator('.profile-address-card')).toHaveCount(3);
  await expect(page.locator('.profile-address-card[data-customer-address-id="' + addresses[9].id + '"]')).toBeVisible();
});

test('checkout bloquea por Perfil incompleto y permite volver desde completar Perfil', async ({ page }) => {
  const namespace = 'e2e-profile-incomplete';
  await page.goto('/?demo=1#catalog');
  await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(page.locator('[data-view="cart"]')).toBeVisible();

  await seedCheckoutProfile(page, {
    name: '',
    phone: '',
    addresses: [],
    namespace,
  });

  await expect(page.locator('[data-profile-block="incomplete"]')).toBeVisible();
  const completeAction = page.locator('[data-profile-block="incomplete"] [data-profile-checkout-action="edit-profile"]');
  await expect(completeAction).toBeVisible();
  await completeAction.click();

  const profile = page.locator('[data-customer-profile]');
  await expect(profile).toBeVisible();
  await profile.locator('[data-profile-action="return-to-checkout"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  await expect(page.locator('[data-profile-block="incomplete"]')).toBeVisible();
});

test('checkout bloquea sin direcciones y permite volver desde agregar dirección en Perfil', async ({ page }) => {
  const namespace = 'e2e-no-address';
  await page.goto('/?demo=1#catalog');
  await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(page.locator('[data-view="cart"]')).toBeVisible();

  await seedCheckoutProfile(page, {
    name: 'Cliente demo',
    phone: '2991112233',
    addresses: [],
    namespace,
  });

  await expect(page.locator('[data-profile-block="no-address"]')).toBeVisible();
  const addAddressAction = page.locator('[data-profile-block="no-address"] [data-profile-checkout-action="add-address"]');
  await expect(addAddressAction).toBeVisible();
  await addAddressAction.click();

  const profile = page.locator('[data-customer-profile]');
  await expect(profile).toBeVisible();
  await profile.locator('[data-profile-action="return-to-checkout"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  await expect(page.locator('[data-profile-block="no-address"]')).toBeVisible();
});

test('checkout permite retiro en local sin direcciones', async ({ page }) => {
  const namespace = 'e2e-pickup-no-address';
  await page.goto('/?demo=1#catalog');
  await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(page.locator('[data-view="cart"]')).toBeVisible();

  await fillCheckout(page, {
    name: 'Cliente retiro sin direcciones',
    phone: '2992223333',
    addresses: [],
    payment: 'cash',
    deliveryMode: 'pickup',
    namespace,
  });

  await expect(page.locator('[data-profile-pickup]')).toBeVisible();
  await expect(page.locator('[data-profile-summary]')).toBeVisible();
  await expect(page.locator('[data-profile-block="no-address"]')).toHaveCount(0);
  await expect(page.locator('[data-order-summary]')).toContainText('Retiro en local');

  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');
  await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  await expect(page.locator('[data-tracking-panel]')).toContainText('Retiro en local');
});

test('checkout conserva dirección seleccionada al volver desde retiro a delivery', async ({ page }) => {
  const namespace = 'e2e-pickup-return';
  const addresses = buildCheckoutAddresses(3, namespace);

  await page.goto('/?demo=1#catalog');
  await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(page.locator('[data-view="cart"]')).toBeVisible();

  await fillCheckout(page, {
    name: 'Cliente retorno',
    phone: '2994445555',
    addresses,
    payment: 'cash',
    deliveryMode: 'delivery',
    namespace,
  });

  const selectedId = addresses[1].id;
  const checkout = page.locator('[data-checkout-form]');
  const addressList = checkout.locator('.profile-address-list');
  await selectCheckoutAddress(page, { id: selectedId });
  await expect(addressList.locator('.profile-address-card')).toHaveCount(3);
  await expect(addressList).toHaveAttribute('data-address-total', '3');
  await expect(checkout).toHaveAttribute('data-address-source', 'saved_address_selected');

  await page.getByLabel('Retiro en local').check();
  await expect(page.locator('[data-profile-pickup]')).toBeVisible();
  await expect(addressList).toHaveCount(0);
  await expect(checkout).toHaveAttribute('data-address-source', 'saved_address_selected');

  await page.getByLabel('Delivery').check();
  await expect(page.locator('[data-profile-pickup]')).toBeHidden();
  await expect(addressList.locator('.profile-address-card[data-customer-address-id="' + selectedId + '"]')).toBeVisible();
  await expect(addressList.locator('.profile-address-card')).toHaveCount(3);
  await expect(addressList.locator('.profile-address-card[data-customer-address-id="' + selectedId + '"]')).toHaveClass(/is-selected/);
  await expect(checkout).toHaveAttribute('data-address-source', 'saved_address_selected');
});

test('confirmar en checkout no muta la entidad de Perfil sandbox', async ({ page }) => {
  const namespace = 'e2e-no-mutation';
  const profileKey = `${SANDBOX_PROFILE_STORAGE_PREFIX}:demo`;
  await page.goto('/?demo=1#catalog');
  await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(page.locator('[data-view="cart"]')).toBeVisible();

  await fillCheckout(page, {
    name: 'Cliente persistencia',
    phone: '2995550101',
    street: 'Roca 123',
    neighborhood: 'Neuquén centro',
    reference: 'Portón negro',
    notes: 'No guardar cambios',
    payment: 'cash',
    deliveryMode: 'delivery',
    namespace,
  });

  const before = await page.evaluate((key) => {
    const snapshot = localStorage.getItem(key);
    return snapshot ? JSON.parse(snapshot) : null;
  }, profileKey);

  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');

  const after = await page.evaluate((key) => {
    const snapshot = localStorage.getItem(key);
    return snapshot ? JSON.parse(snapshot) : null;
  }, profileKey);

  expect(after).toEqual(before);
});

test('borrar la dirección seleccionada no rompe el checkout', async ({ page }) => {
  const namespace = 'e2e-delete-selected';
  const addresses = buildCheckoutAddresses(2, namespace);

  await page.goto('/?demo=1#catalog');
  await expect(page.locator('[data-view="catalog"] [data-add-product]:not([disabled])').first()).toBeVisible();
  await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  await page.evaluate(() => {
    window.location.hash = '#cart';
  });
  await expect(page.locator('[data-view="cart"]')).toBeVisible();

  await fillCheckout(page, {
    name: 'Cliente demo',
    phone: '2991112233',
    addresses,
    payment: 'cash',
    deliveryMode: 'delivery',
    namespace,
  });

  const secondAddressId = addresses[1].id;
  await selectCheckoutAddress(page, { id: secondAddressId });
  await expect(page.locator('[data-checkout-form]')).toHaveAttribute('data-address-source', 'saved_address_selected');
  const checkout = page.locator('[data-checkout-form]');
  const selectedCard = checkout.locator(`.profile-address-list .profile-address-card[data-customer-address-id="${secondAddressId}"]`);
  await expect(selectedCard).toHaveClass(/is-selected/);

  await checkout.locator('[data-profile-checkout-action="manage-addresses"]').click();
  const profile = page.locator('[data-customer-profile]');
  const profileSelectedCard = profile.locator(`[data-profile-address-id="${secondAddressId}"]`);
  await expect(profileSelectedCard).toBeVisible();
  page.on('dialog', (dialog) => dialog.accept());
  await profileSelectedCard.locator('[data-profile-action="delete-address"]').click();
  await expect(profileSelectedCard).toHaveCount(0);
  await profile.locator('[data-profile-action="return-to-checkout"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  await expect(selectedCard).toHaveCount(0);

  const remainingCard = checkout.locator(`.profile-address-list .profile-address-card[data-customer-address-id="${addresses[0].id}"]`);
  await expect(remainingCard).toBeVisible();
  await expect(remainingCard).toHaveClass(/is-selected/);
  await expect(checkout).toHaveAttribute('data-address-source', 'profile_default');
});

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
