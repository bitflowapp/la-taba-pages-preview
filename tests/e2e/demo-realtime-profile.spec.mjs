import { expect, test } from '@playwright/test';
import { confirmDeliveryLocationInProfile, gotoDemoReset, installBrowserStubs, installPageGuards, seedCartAboveMinimum, seedCheckoutProfile, selectCheckoutAddress, waitForToast } from './helpers.mjs';

const RELAY_PORT = Number.parseInt(process.env.TABA_E2E_RELAY_PORT || '18787', 10);
const RELAY_BASE = `http://127.0.0.1:${RELAY_PORT}`;
const RELAY_URL = encodeURIComponent(RELAY_BASE);
const ROOM_KEY = '8f44118c35549cd5148f92915f614168a8de9341d45ac739b99267200b3495d1';
const PROFILE_STORAGE_KEY = 'la-taba-sandbox-profile:demo';

const CUSTOMER = Object.freeze({
  name: 'Lucia Ensayo',
  phone: '2995550284',
  street: 'Los Aromos',
  streetNumber: '742',
  city: 'Neuquen Capital',
});

test('demo-realtime toma Perfil local al confirmar y sincroniza solo el pedido por relay', async ({ browser }) => {
  const clientContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const businessContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const client = await clientContext.newPage();
  const business = await businessContext.newPage();
  const clientAudit = auditPage(client);
  const businessAudit = auditPage(business);
  const room = `profile-checkout-${Date.now()}`;
  const base = `/?demo=1&relay=${RELAY_URL}&room=${room}&key=${ROOM_KEY}`;

  try {
    await installBrowserStubs(client);
    await installBrowserStubs(business);
    await gotoDemoReset(client, `${base}&reset=1#home`);

    await business.goto(`${base}#business`);
    await business.locator('[data-open-pin][data-admin-target="business"]').click();
    await business.getByLabel(/modo negocio/i).fill('1234');
    await business.locator('[data-pin-form]').press('Enter');

    await waitForRelay(client);
    await waitForRelay(business);

    await client.locator('.mobile-nav [data-nav-view="catalog"]').click();
    const clientAddButton = client.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
    const clientProductId = await clientAddButton.getAttribute('data-add-product');
    await clientAddButton.click();
    // Dos unidades: desde que la góndola es de unidades, ninguna sola llega al
    // mínimo de delivery del comercio.
    await client.locator(`[data-cart-inc="${clientProductId}"] >> visible=true`).first().click();
    await client.getByRole('button', { name: /Ver carrito/i }).click();
    await expect(client.locator('[data-cart-list] .cart-item')).toHaveCount(1);

    await client.locator('[data-profile-checkout-action="edit-profile"]').first().click();
    const profile = client.locator('[data-customer-profile]');
    await expect(profile).toBeVisible();

    await profile.locator('[data-profile-action="edit-personal"]').click();
    await profile.locator('[name="profileFullName"]').fill(CUSTOMER.name);
    await profile.locator('[name="profilePhone"]').fill(CUSTOMER.phone);
    await profile.locator('[data-profile-action="save-personal"]').click();
    await expect(profile).toContainText(CUSTOMER.name);

    await profile.locator('[data-profile-action="add-address"]').click();
    const addressForm = profile.locator('[data-profile-address-form]');
    await addressForm.locator('[name="profileAddressLabel"]').selectOption('Otra');
    await addressForm.locator('[name="profileAddressStreet"]').fill(CUSTOMER.street);
    await addressForm.locator('[name="profileAddressNumber"]').fill(CUSTOMER.streetNumber);
    await addressForm.locator('[name="profileAddressCity"]').fill(CUSTOMER.city);
    await addressForm.locator('[name="profileAddressProvince"]').fill('Neuquen');
    await addressForm.locator('[name="profileAddressDefault"]').check();
    // Una dirección de entrega no se guarda sin punto confirmado.
    await confirmDeliveryLocationInProfile(client);
    await addressForm.locator('[data-profile-action="save-address"]').click();
    await expect(profile.locator('[data-profile-address-id]', { hasText: `${CUSTOMER.street} ${CUSTOMER.streetNumber}` })).toBeVisible();

    const persistedProfile = await client.evaluate((key) => {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    }, PROFILE_STORAGE_KEY);
    expect(persistedProfile.profile.name).toBe(CUSTOMER.name);
    expect(persistedProfile.profile.phone).toBe(CUSTOMER.phone);
    expect(persistedProfile.addresses.some((address) => (
      address.street === CUSTOMER.street
      && address.streetNumber === CUSTOMER.streetNumber
    ))).toBe(true);

    const beforeConfirmation = JSON.stringify(clientAudit.relayPayloads);
    expect(beforeConfirmation).not.toContain(CUSTOMER.name);
    expect(beforeConfirmation).not.toContain(CUSTOMER.phone);
    expect(beforeConfirmation).not.toContain(CUSTOMER.street);
    assertNoStandaloneProfileMessages(clientAudit.relayPayloads);

    await profile.locator('[data-profile-action="return-to-checkout"]').click();
    await expect(client.locator('body')).toHaveAttribute('data-active-view', 'cart');
    await expect(client.locator('[data-cart-list] .cart-item')).toHaveCount(1);
    await client.getByLabel('Delivery').check();
    await selectCheckoutAddress(client, { label: `${CUSTOMER.street} ${CUSTOMER.streetNumber}` });
    await client.getByLabel('Forma de pago').selectOption('cash');

    await client.getByRole('button', { name: /Confirmar pedido/i }).click();
    await waitForToast(client, 'Pedido confirmado. Seguilo en Seguimiento.');

    const order = await client.evaluate(async () => {
      const { getState } = await import('/js/state.js');
      const state = getState();
      return state.orders.find((candidate) => candidate.id === state.lastOrderId) || null;
    });
    expect(order).toBeTruthy();
    expect(order.customerName).toBe(CUSTOMER.name);
    expect(order.customerPhone).toBe(CUSTOMER.phone);
    expect(order.address).toContain(`${CUSTOMER.street} ${CUSTOMER.streetNumber}`);
    expect(order.addressDetails.streetLine).toBe(`${CUSTOMER.street} ${CUSTOMER.streetNumber}`);
    expect(order.deliveryMode).toBe('delivery');

    const receivedOrder = business.locator(`[data-inbox-order="${order.id}"]`);
    await expect(receivedOrder).toBeVisible();
    await expect(receivedOrder).toContainText(CUSTOMER.name);
    await expect(receivedOrder).toContainText(CUSTOMER.street);

    const relayPayloads = [...clientAudit.relayPayloads, ...businessAudit.relayPayloads];
    assertNoStandaloneProfileMessages(relayPayloads);
    const relayedOrder = relayPayloads
      .filter((payload) => payload.kind === 'state')
      .flatMap((payload) => payload.orders || [])
      .find((candidate) => candidate.id === order.id);
    expect(relayedOrder?.customerName).toBe(CUSTOMER.name);
    expect(relayedOrder?.customerPhone).toBe(CUSTOMER.phone);
    expect(relayedOrder?.address).toContain(CUSTOMER.street);

    expect(clientAudit.supabaseRequests).toEqual([]);
    expect(businessAudit.supabaseRequests).toEqual([]);
    await clientAudit.guards.assertClean();
    await businessAudit.guards.assertClean();
  } finally {
    await clientContext.close();
    await businessContext.close();
  }
});

test('demo-realtime mantiene bloqueos de Perfil y permite pickup sin direccion', async ({ page }) => {
  const audit = auditPage(page);
  const room = `profile-blocks-${Date.now()}`;
  await installBrowserStubs(page);
  await gotoDemoReset(page, `/?demo=1&relay=${RELAY_URL}&room=${room}&key=${ROOM_KEY}&reset=1#catalog`);
  await waitForRelay(page);

  await seedCartAboveMinimum(page);
  await page.locator('.desktop-nav [data-nav-view="cart"]').click();

  await seedCheckoutProfile(page, {
    name: '',
    phone: '',
    addresses: [],
    namespace: 'demo',
  });
  await expect(page.locator('[data-profile-block="incomplete"]')).toBeVisible();
  const ordersBeforeBlocks = await orderCount(page);
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await expect(page.locator('[data-checkout-warning]')).toBeVisible();
  expect(await orderCount(page)).toBe(ordersBeforeBlocks);

  await seedCheckoutProfile(page, {
    name: 'Cliente Pickup Sintetico',
    phone: '2995550371',
    addresses: [],
    namespace: 'demo',
  });
  await page.getByLabel('Delivery').check();
  await expect(page.locator('[data-profile-block="no-address"]')).toBeVisible();
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await expect(page.locator('[data-checkout-warning]')).toBeVisible();
  expect(await orderCount(page)).toBe(ordersBeforeBlocks);

  await page.getByLabel('Retiro en local').check();
  await expect(page.locator('[data-profile-pickup]')).toBeVisible();
  await expect(page.locator('[data-profile-block="no-address"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Confirmar pedido/i })).toBeEnabled();
  await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');

  const order = await page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    const state = getState();
    return state.orders.find((candidate) => candidate.id === state.lastOrderId) || null;
  });
  expect(order.deliveryMode).toBe('pickup');
  assertNoStandaloneProfileMessages(audit.relayPayloads);
  expect(audit.supabaseRequests).toEqual([]);
  await audit.guards.assertClean();
});

function auditPage(page) {
  const guards = installPageGuards(page);
  const supabaseRequests = [];
  const relayPayloads = [];

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname.endsWith('.supabase.co')) supabaseRequests.push(request.url());
    if (url.origin === RELAY_BASE && url.pathname === '/publish') {
      try {
        relayPayloads.push(JSON.parse(request.postData() || '{}'));
      } catch (_) {
        relayPayloads.push({ kind: 'malformed' });
      }
    }
  });

  return { guards, supabaseRequests, relayPayloads };
}

async function waitForRelay(page) {
  await expect.poll(() => page.evaluate(async () => {
    const { getRealtimeStatus } = await import('/js/realtime.js');
    return getRealtimeStatus().relayConnected;
  })).toBe(true);
}

async function orderCount(page) {
  return page.evaluate(async () => {
    const { getState } = await import('/js/state.js');
    return getState().orders.length;
  });
}

function assertNoStandaloneProfileMessages(payloads) {
  for (const payload of payloads) {
    expect(['hello', 'state']).toContain(payload.kind);
    expect(payload).not.toHaveProperty('profile');
    expect(payload).not.toHaveProperty('addresses');
    expect(payload).not.toHaveProperty('customerProfiles');
  }
}
