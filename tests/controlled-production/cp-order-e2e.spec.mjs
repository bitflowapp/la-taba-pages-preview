// CONTROLLED_PRODUCTION end-to-end through the real UI, on the never-public
// QA control business: customer (anonymous session, confirmed address) buys in
// the storefront with manual payment -> the business registers the cash and
// moves the order to ready in the Panel -> offers it to a rider -> the rider
// runs the same RPCs as the Android app (accept, pick up, GPS, arrive) -> the
// customer sees tracking and reads the 4-digit code from the screen -> the rider
// confirms it -> customer and Panel reach the terminal state. Cleanup reverses
// the QA cash, restores stock through an audited movement and classifies QA.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { loadTargetKeys } from '../../scripts/controlled-production/target-keys.mjs';
import { readQaCredential } from '../../scripts/controlled-production/qa-credentials.mjs';
import { cleanupQaOrder } from '../../scripts/controlled-production/qa-cleanup.mjs';

const BUSINESS = 'e1d2c342-da14-421e-884f-ff38bb55f642';
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const ADDRESS = { neighborhood: 'Centro', city: 'Neuquén Capital', lat: -38.9516, lng: -68.0591 };

async function session(keys, credentialName, clientKind) {
  const stored = readQaCredential(credentialName);
  const c = createClient(keys.url, keys.publishable, OPTIONS);
  const { data, error } = await c.auth.signInWithPassword({ email: stored.usuario, password: stored.secreto });
  expect(error?.code || '').toBe('');
  const reg = await c.rpc('identity_register_session', { p_business_id: BUSINESS, p_client: clientKind,
    p_device_label: 'CP UI E2E', p_device_key_hash: null, p_app_version: 'cp-e2e' });
  expect(reg.data?.ok).toBe(true);
  return { c, session: data.session, id: data.user.id };
}

async function inject(context, keys, authSession) {
  await context.addInitScript(({ url, key, businessId, ref, stored }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = { mode: 'production', repository: { provider: 'supabase',
      deploymentEnvironment: 'pilot', supabaseUrl: url, publishableKey: key, businessId, pollMs: 1000 } };
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(stored));
  }, { url: keys.url, key: keys.publishable, businessId: BUSINESS, ref: keys.ref, stored: authSession });
}

test('CP: cliente → pago manual → panel → rider → GPS → código → entregado', async ({ browser, browserName }, testInfo) => {
  test.setTimeout(420_000);
  const keys = await loadTargetKeys('controlled-production');
  const admin = createClient(keys.url, keys.secret, OPTIONS);
  const owner = await session(keys, 'CP QA OWNER', 'panel_web');
  const staff = await session(keys, 'CP QA STAFF', 'panel_web');
  const rider = await session(keys, `CP QA RIDER ${testInfo.project.name === 'webkit-iphone' ? 2 : 1}`, 'rider_android');

  // Anonymous customer with a confirmed map pin, as the storefront creates it.
  const customer = createClient(keys.url, keys.publishable, OPTIONS);
  const anon = await customer.auth.signInAnonymously({ options: { data: { taba_actor: 'customer' } } });
  expect(anon.data?.session).toBeTruthy();
  expect((await customer.rpc('upsert_current_customer_profile', { p_name: 'QA E2E', p_phone: '2995550700' })).error).toBeNull();
  const saved = await customer.rpc('upsert_current_customer_address', { p_address: { label: 'Casa', street: 'Calle E2E',
    streetNumber: '700', city: ADDRESS.city, neighborhood: ADDRESS.neighborhood, latitude: ADDRESS.lat, longitude: ADDRESS.lng,
    geolocationAccuracy: 10, source: 'gps', locationSource: 'map_pin', locationConfirmedAt: new Date().toISOString(), isDefault: true } });
  expect(saved.error).toBeNull();

  const availability = (await staff.c.rpc('commerce_availability', { p_business_id: BUSINESS, p_channel: 'delivery', p_context: {} })).data;
  expect(availability.is_open && availability.ordering_ready).toBe(true);
  const minimum = Number(availability.areas.find((a) => a.name === ADDRESS.neighborhood).minimum_subtotal);
  const products = (await staff.c.from('products').select('id,name,price,stock').eq('business_id', BUSINESS)
    .eq('available', true).eq('is_active', true).eq('is_verified', true).gt('stock', 5).order('price', { ascending: false })).data;
  const product = products[testInfo.project.name === 'webkit-iphone' ? 1 : 0];
  const quantity = Math.max(1, Math.ceil((minimum + 1) / Number(product.price)));
  const stockBefore = Number(product.stock);

  const { defaultBrowserType, ...device } = testInfo.project.use; // eslint-disable-line no-unused-vars
  const customerContext = await browser.newContext({ ...device, serviceWorkers: 'block' });
  const panelContext = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
  await inject(customerContext, keys, anon.data.session);
  await inject(panelContext, keys, staff.session);
  const storefront = await customerContext.newPage();
  const panel = await panelContext.newPage();
  const startedAt = new Date(Date.now() - 5000).toISOString();
  let order = null;
  let failure = null;
  try {
    // ---- customer ----
    await storefront.goto('/#catalog');
    await expect(storefront.getByText(/Mercado Pago/)).toHaveCount(0);
    const add = storefront.locator(`[data-product-grid] [data-add-product="${product.id}"]:visible`).first();
    await expect(add).toBeVisible({ timeout: 60_000 });
    await add.click();
    const increment = storefront.locator(`[data-cart-inc="${product.id}"]:visible`).first();
    for (let i = 1; i < quantity; i += 1) await increment.click();
    await storefront.locator('[data-open-cart]:visible').first().click();
    await expect(storefront.locator('[data-checkout-form]')).toBeVisible();
    await storefront.getByLabel('Delivery').check();
    await expect(storefront.locator('[data-profile-checkout] .profile-address-card.is-selected')).toHaveCount(1);
    await storefront.getByLabel('Forma de pago').selectOption('cash');
    await expect(storefront.getByText('El cobro queda pendiente hasta que el negocio registre el dinero recibido.')).toBeVisible();
    await expect(storefront.locator('select[name="paymentMethod"] option[value="mercadopago"]')).toHaveCount(0);
    await storefront.getByRole('button', { name: /Confirmar pedido/i }).click();
    await expect(storefront.locator('[data-tracking-title]')).toHaveText('Tu pedido fue confirmado', { timeout: 45_000 });
    await expect.poll(async () => {
      const rows = (await staff.c.from('orders').select('id,public_code,status,revision,manual_payment_status,payment_method')
        .eq('business_id', BUSINESS).eq('customer_user_id', anon.data.user.id).gt('created_at', startedAt)).data || [];
      order = rows[0] || null; return order?.id || '';
    }, { timeout: 45_000 }).not.toBe('');
    expect(order).toMatchObject({ payment_method: 'cash', manual_payment_status: 'pending' });
    expect(Number((await staff.c.from('products').select('stock').eq('id', product.id).single()).data.stock)).toBe(stockBefore - quantity);

    // ---- business: register cash, then accept -> prepare -> ready ----
    await panel.goto('/#business');
    await panel.locator('[data-production-orders-view]:visible').first().click();
    const card = panel.locator(`[data-order-card="${order.public_code}"]`);
    await card.waitFor({ timeout: 60_000 });
    await expect(card.locator('[data-manual-payment-status]')).toHaveAttribute('data-manual-payment-status', 'pending');
    await panel.locator('[data-business-ops-view="payments"]:visible').first().click();
    await expect(panel.locator('[data-online-payments="disabled"]')).toBeVisible();
    await expect(panel.locator('[data-mp-connection-action]')).toHaveCount(0);
    const payment = panel.locator(`[data-manual-payment-card="${order.id}"]`);
    panel.once('dialog', (dialog) => dialog.accept());
    await payment.locator('[data-manual-payment-confirm][data-manual-payment-method="cash"]').click();
    await expect(payment.locator('[data-manual-payment-status]')).toHaveAttribute('data-manual-payment-status', 'confirmed');
    expect((await admin.from('order_events').select('id').eq('order_id', order.id).eq('event_type', 'order.manual_payment_confirmed')).data).toHaveLength(1);
    expect((await admin.from('payment_intents').select('id').eq('order_id', order.id)).data).toHaveLength(0);
    await panel.locator('[data-production-orders-view]:visible').first().click();
    for (const status of ['accepted', 'preparing', 'ready']) {
      const action = card.locator('[data-production-business-next]');
      await expect(action).toHaveAttribute('data-next-status', status, { timeout: 45_000 });
      await action.click();
      await expect.poll(async () => (await staff.c.from('orders').select('status').eq('id', order.id).single()).data.status,
        { timeout: 45_000 }).toBe(status);
    }

    // ---- rider available (app heartbeat), business offers from the Panel ----
    const board0 = (await rider.c.rpc('get_rider_delivery_board')).data;
    if (!board0.available) await rider.c.rpc('set_rider_availability', { p_business_id: BUSINESS, p_available: true,
      p_expected_version: board0.availability_version || 0, p_idempotency_key: `e2e-on-${randomUUID()}` });
    const beat = setInterval(() => { void rider.c.rpc('heartbeat_rider_availability', { p_business_id: BUSINESS }); }, 15_000);
    await rider.c.rpc('heartbeat_rider_availability', { p_business_id: BUSINESS });
    try {
      const select = card.locator('[data-production-rider-select]');
      await expect.poll(async () => select.locator(`option[value="${rider.id}"]`).count(), { timeout: 120_000 }).toBe(1);
      await select.selectOption(rider.id);
      await card.locator('[data-production-business-assign]').click();
      await expect.poll(async () => ((await rider.c.rpc('get_rider_delivery_board')).data?.offers || [])
        .find((o) => o.order_id === order.id)?.offer_id || '', { timeout: 60_000 }).not.toBe('');
      const pending = ((await rider.c.rpc('get_rider_delivery_board')).data.offers).find((o) => o.order_id === order.id);
      const accepted = await rider.c.rpc('accept_rider_order_offer', { p_offer_id: pending.offer_id, p_expected_version: pending.version,
        p_idempotency_key: `e2e-${pending.offer_id}-${pending.version}` });
      expect(accepted.data?.code).toBe('accepted');
      const step = async (name) => {
        const current = ((await rider.c.rpc('get_rider_delivery_board')).data.orders || []).find((o) => o.id === order.id);
        const r = await rider.c.rpc(name, { p_order_id: order.id, p_expected_revision: current.revision, p_idempotency_key: `e2e-${name}-${current.revision}-${order.id}` });
        expect(r.error).toBeNull();
        expect(r.data?.ok).not.toBe(false);
      };
      const gps = async (dLat) => {
        const r = await rider.c.rpc('publish_rider_location_fanout', { p_lat: ADDRESS.lat + dLat, p_lng: ADDRESS.lng, p_accuracy: 8,
          p_heading: null, p_speed: 5, p_captured_at: new Date().toISOString(), p_idempotency_key: randomUUID(), p_is_mock: false });
        expect(r.data?.ok).toBe(true);
      };
      await step('mark_delivery_picked_up');
      await step('start_rider_delivery');
      await gps(0.004);
      // Customer sees the rider moving on the map and the Panel shows it in delivery.
      await expect.poll(async () => storefront.evaluate(() => ({
        status: document.querySelector('[data-tracking-status]')?.getAttribute('data-tracking-status'),
        marker: Boolean(document.querySelector('[data-tracking-panel] .lt-rider-marker')),
      })), { timeout: 120_000 }).toEqual({ status: 'on_the_way', marker: true });
      await expect.poll(async () => card.innerText().catch(() => ''), { timeout: 60_000 }).toMatch(/en reparto|en camino/i);
      await new Promise((r) => setTimeout(r, 6000));
      await gps(0.001);
      await step('mark_rider_arrived');
      // The customer reads the code from the screen and tells the rider.
      const codeAttr = storefront.locator('[data-delivery-code]').first();
      await expect(codeAttr).toBeVisible({ timeout: 60_000 });
      const code = await codeAttr.getAttribute('data-delivery-code');
      expect(code).toMatch(/^[0-9]{4}$/);
      const current = ((await rider.c.rpc('get_rider_delivery_board')).data.orders || []).find((o) => o.id === order.id);
      const wrong = await rider.c.rpc('confirm_delivery_code', { p_order_id: order.id, p_expected_revision: current.revision,
        p_delivery_code: String((Number(code) + 1) % 10000).padStart(4, '0'), p_idempotency_key: `e2e-wrong-${order.id}` });
      expect(wrong.data?.ok === true && wrong.data?.code === 'delivered').toBe(false);
      const fresh = ((await rider.c.rpc('get_rider_delivery_board')).data.orders || []).find((o) => o.id === order.id);
      const done = await rider.c.rpc('confirm_delivery_code', { p_order_id: order.id, p_expected_revision: fresh.revision,
        p_delivery_code: code, p_idempotency_key: `e2e-code-${order.id}` });
      expect(done.error).toBeNull();
    } finally { clearInterval(beat); }
    await expect.poll(async () => (await staff.c.from('orders').select('status').eq('id', order.id).single()).data.status,
      { timeout: 60_000 }).toBe('delivered');
    await storefront.locator('[data-tracking-status="delivered"]').waitFor({ timeout: 90_000 });
    await card.waitFor({ state: 'detached', timeout: 90_000 });
    testInfo.annotations.push({ type: 'result', description: `${browserName}: delivered ${order.public_code}` });
  } catch (error) {
    failure = error;
  } finally {
    await customerContext.close();
    await panelContext.close();
    if (order) {
      await cleanupQaOrder({ admin, owner: owner.c, staff: staff.c, businessId: BUSINESS, orderId: order.id, reason: 'QA E2E controlada' });
      const stockAfter = Number((await admin.from('products').select('stock').eq('id', product.id).single()).data.stock);
      if (!failure && stockAfter !== stockBefore) failure = Error(`QA_STOCK_NOT_RESTORED:${stockAfter}!=${stockBefore}`);
    }
    const board = (await rider.c.rpc('get_rider_delivery_board')).data;
    if (board?.available) await rider.c.rpc('set_rider_availability', { p_business_id: BUSINESS, p_available: false,
      p_expected_version: board.availability_version || 0, p_idempotency_key: `e2e-off-${randomUUID()}` });
    if (failure) throw failure;
  }
});
