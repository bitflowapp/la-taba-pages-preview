import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { leerSecreto, guardarSecreto, borrarSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { loadStagingKeys } from './qa-staging-keys.mjs';

const ref = 'ucbtjcurawxjwjdvvcvj';
const url = `https://${ref}.supabase.co`;
const business = 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const runName = 'RIDER PILOT FULL UI QA ACTIVE';
if (leerSecreto(runName)) throw Error('QA_RUN_EXISTS_REVIEW_BEFORE_RETRY');
const { secret, publishable } = await loadStagingKeys();
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, options);
const actor = async (name) => {
  const qa = leerSecreto(name);
  if (!qa?.usuario || !qa?.secreto) throw Error('QA_CREDENTIAL_UNAVAILABLE');
  const client = createClient(url, publishable, options);
  const { data, error } = await client.auth.signInWithPassword({ email: qa.usuario, password: qa.secreto });
  if (error || !data.session) throw Error(`QA_LOGIN_UNAVAILABLE:${error?.code || 'NO_SESSION'}`);
  return { client, session: data.session, userId: data.user.id };
};
const customer = await actor('STAGING CUSTOMER QA 20260920');
const staff = await actor('STAGING BUSINESS QA 20260920');
const previous = JSON.parse(leerSecreto('RIDER CANONICAL QA RUN 20260922')?.secreto || '{}');
if (!previous.riderId) throw Error('QA_RIDER_ID_REQUIRED');
const register = await staff.client.rpc('identity_register_session', {
  p_business_id: business, p_client: 'panel_web', p_device_label: 'Pilot full UI E2E',
  p_device_key_hash: null, p_app_version: 'pilot-qa',
});
if (register.error || register.data?.ok !== true) throw Error('QA_STAFF_SESSION_REQUIRED');
const read = async (query) => {
  const { data, error } = await query;
  if (error) throw Error(`QA_READ:${error.code}`);
  return data;
};
const rpc = async (client, name, args) => {
  const { data, error } = await client.rpc(name, args);
  if (error || data?.ok === false) throw Error(`QA_RPC:${name}:${error?.code || data?.code || 'NOT_CONFIRMED'}`);
  return data;
};
const address = (await read(customer.client.from('customer_addresses')
  .select('id,neighborhood,latitude,longitude,location_confirmed_at').is('deleted_at', null)))
  .find((row) => row.location_confirmed_at && row.latitude && row.longitude);
if (!address) throw Error('CONFIRMED_QA_ADDRESS_REQUIRED');
const businessRow = await read(staff.client.from('businesses').select('minimum_delivery_subtotal').eq('id', business).single());
const availability = await rpc(staff.client, 'commerce_availability',
  { p_business_id: business, p_channel: 'delivery', p_context: {} });
const area = availability.areas?.find((row) => row.name === address.neighborhood) || availability.areas?.[0];
if (!area) throw Error('QA_DELIVERY_AREA_REQUIRED');
const minimum = Number(area.minimum_subtotal ?? businessRow.minimum_delivery_subtotal ?? 0);
const products = await read(staff.client.from('products').select('id,price,stock')
  .eq('business_id', business).eq('is_active', true).eq('available', true)
  .eq('is_verified', true).eq('is_alcoholic', false).gt('stock', 0)
  .order('price', { ascending: false }));
const candidate = products.map((product) => ({ product,
  quantity: Math.max(1, Math.ceil((minimum + 1) / Number(product.price))) }))
  .find(({ product, quantity }) => product.price > 0 && product.stock >= quantity);
if (!candidate) throw Error('QA_PRODUCT_REQUIRED');
const { product, quantity } = candidate;
const stockBefore = Number(product.stock);
const startedAt = new Date().toISOString();
const browser = await chromium.launch({ headless: true });
let customerContext;
let panelContext;
let order;
let run;
const report = { timestamp: startedAt, project: ref, stagingOnly: true,
  customerUiOrder: false, panelUiReady: false, panelUiOffer: false,
  signedRiderAssigned: false, gpsAndCustomerTracking: false, customerGpsMarkerVisible: false,
  panelFinal: false, customerDelivered: false, backendDelivered: false,
  qaClassified: false, stockRestored: false };
try {
  customerContext = await browser.newContext({ serviceWorkers: 'block' });
  panelContext = await browser.newContext({ serviceWorkers: 'block' });
  await customerContext.addInitScript(({ ref, session }) =>
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session)),
  { ref, session: customer.session });
  await panelContext.addInitScript(({ ref, session }) =>
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session)),
  { ref, session: staff.session });
  const storefront = await customerContext.newPage();
  const panel = await panelContext.newPage();

  await storefront.goto('http://127.0.0.1:39092/#catalog', { waitUntil: 'domcontentloaded' });
  const add = storefront.locator(`[data-product-grid] [data-add-product="${product.id}"]:visible`).first();
  await expect(add).toBeVisible();
  await add.click();
  const increment = storefront.locator(`[data-cart-inc="${product.id}"]:visible`).first();
  for (let i = 1; i < quantity; i += 1) await increment.click();
  await storefront.locator('[data-open-cart]:visible').first().click();
  await expect(storefront.locator('[data-checkout-form]')).toBeVisible();
  await storefront.getByLabel('Delivery').check();
  await expect(storefront.locator('[data-profile-checkout] .profile-address-card.is-selected')).toHaveCount(1);
  await storefront.getByLabel('Forma de pago').selectOption('coordinate');
  await storefront.getByRole('button', { name: /Confirmar pedido/i }).click();
  await expect(storefront.locator('[data-tracking-title]')).toHaveText('Tu pedido fue confirmado', { timeout: 35_000 });
  const rows = await read(staff.client.from('orders').select('id,public_code,status,revision')
    .eq('business_id', business).eq('customer_user_id', customer.userId)
    .gt('created_at', startedAt).order('created_at', { ascending: false }).limit(1));
  order = rows[0];
  if (!order?.id || !['received', 'pending'].includes(order.status)) throw Error('UI_ORDER_NOT_PERSISTED');
  const access = await storefront.evaluate((businessId) => {
    const key = `taba-order-access-v1:${businessId}:last`;
    return JSON.parse(sessionStorage.getItem(key) || localStorage.getItem(key) || 'null');
  }, business);
  if (access?.orderId !== order.id || !access?.trackingToken) throw Error('CUSTOMER_TRACKING_ACCESS_MISSING');
  const code = await rpc(customer.client, 'issue_order_delivery_code',
    { p_order_id: order.id, p_tracking_token: access.trackingToken });
  if (!/^\d{4}$/.test(code.delivery_code || '')) throw Error('DELIVERY_CODE_CONTRACT_MISMATCH');
  run = { orderId: order.id, publicCode: order.public_code, tracking: access.trackingToken,
    deliveryCode: code.delivery_code, productId: product.id, quantity, stockBefore, riderId: previous.riderId };
  guardarSecreto(runName, 'staging', JSON.stringify(run));
  report.customerUiOrder = true;

  await panel.goto('http://127.0.0.1:39092/#business', { waitUntil: 'domcontentloaded' });
  await panel.locator('[data-production-orders-view]:visible').first().click();
  const card = panel.locator(`[data-order-card="${order.public_code}"]`);
  await card.waitFor({ timeout: 45_000 });
  const finished = panel.locator('[data-tray-finished] .tray-pulse-n');
  await expect(finished).toHaveText(/^\d+$/);
  const finishedBefore = Number(await finished.textContent());
  for (const status of ['accepted', 'preparing', 'ready']) {
    const action = card.locator('[data-production-business-next]');
    await expect(action).toHaveAttribute('data-next-status', status, { timeout: 45_000 });
    await action.click();
    await expect.poll(async () => (await read(staff.client.from('orders').select('status')
      .eq('id', order.id).single())).status, { timeout: 45_000 }).toBe(status);
  }
  report.panelUiReady = true;
  console.log('PILOT_FULL_UI_ORDER_READY_FOR_SIGNED_RIDER');
  await panel.locator('[data-panel-region="rider-presence"] summary').waitFor({ timeout: 240_000 });
  await expect.poll(async () => panel.locator('[data-panel-region="rider-presence"] summary').innerText(),
    { timeout: 240_000 }).toContain('1 disponibles');
  const select = card.locator('[data-production-rider-select]');
  await select.waitFor({ timeout: 30_000 });
  await select.selectOption(previous.riderId);
  await card.locator('[data-production-business-assign]').click();
  // La oferta puede ser aceptada antes de que el panel pinte el estado pendiente.
  // Persistencia + rider objetivo prueban la acción aunque esa etiqueta sea fugaz.
  await expect.poll(async () => (await rpc(staff.client, 'list_rider_order_offers',
    { p_business_id: business })).find((offer) => offer.order_id === order.id)?.rider_user_id,
  { timeout: 30_000 }).toBe(previous.riderId);
  report.panelUiOffer = true;
  // El rider puede avanzar de assigned a picked_up antes del siguiente poll.
  // La identidad asignada permanece y prueba la transición sin depender de un estado efímero.
  await expect.poll(async () => (await read(staff.client.from('orders').select('assigned_rider_user_id')
    .eq('id', order.id).single())).assigned_rider_user_id, { timeout: 90_000 }).toBe(previous.riderId);
  report.signedRiderAssigned = true;
  await storefront.locator('[data-tracking-status="on_the_way"]').waitFor({ timeout: 90_000 });
  const marker = storefront.locator('[data-tracking-panel] .lt-rider-marker.source-gps').first();
  await marker.waitFor({ state: 'attached', timeout: 45_000 });
  const markerEvidence = await marker.evaluate((element) => {
    const describe = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return { className: String(node.className || '').slice(0, 160),
        display: style.display, visibility: style.visibility, opacity: style.opacity,
        width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const shell = element.closest('[data-real-map]');
    const canvas = element.closest('[data-map-canvas]');
    return { marker: describe(element), canvas: canvas ? describe(canvas) : null,
      shell: shell ? describe(shell) : null, mapStatus: shell?.dataset.mapStatus || null,
      freshness: shell?.dataset.mapFreshness || null,
      activeView: document.body.dataset.activeView || null };
  });
  writeFileSync('artifacts/rider-pilot-map-visibility.json', JSON.stringify(markerEvidence, null, 2));
  try {
    await expect.poll(() => marker.isVisible(), { timeout: 8_000 }).toBe(true);
    report.customerGpsMarkerVisible = true;
  } catch {
    report.customerGpsMarkerVisible = false;
  }
  await expect(card).toContainText(/en reparto|en camino/i, { timeout: 45_000 });
  report.gpsAndCustomerTracking = true;
  console.log('PILOT_FULL_UI_GPS_VISIBLE');
  await storefront.locator('[data-tracking-status="delivered"]').waitFor({ timeout: 180_000 });
  await expect(storefront.locator('[data-tracking-title]')).toHaveText('Pedido entregado');
  report.customerDelivered = true;
  await card.waitFor({ state: 'detached', timeout: 45_000 });
  await expect.poll(async () => Number(await finished.textContent()), { timeout: 45_000 })
    .toBeGreaterThanOrEqual(finishedBefore + 1);
  report.panelFinal = true;
  const final = await read(staff.client.from('orders').select('status,delivered_at,assigned_rider_user_id')
    .eq('id', order.id).single());
  report.backendDelivered = final.status === 'delivered'
    && Boolean(final.delivered_at && final.assigned_rider_user_id);
} finally {
  await customerContext?.close();
  await panelContext?.close();
  await browser.close();
  if (order?.id) {
    try {
      let latest = await read(staff.client.from('orders').select('status,revision,origin').eq('id', order.id).single());
      if (!['delivered', 'cancelled', 'canceled', 'rejected'].includes(latest.status)) {
        await rpc(staff.client, 'cancel_order', { p_order_id: order.id, p_expected_revision: latest.revision,
          p_reason: 'QA full UI pilot cleanup, no goods moved', p_idempotency_key: `qa_ui_cancel_${order.id.replaceAll('-', '')}` });
        latest = await read(staff.client.from('orders').select('status,revision,origin').eq('id', order.id).single());
      }
      if (latest.origin !== 'qa') await rpc(admin, 'classify_order_as_qa',
        { p_order_id: order.id, p_reason: 'signed_rider_full_ui_pilot_qa' });
      report.qaClassified = true;
      const currentStock = Number((await read(staff.client.from('products').select('stock')
        .eq('id', product.id).single())).stock);
      if (currentStock === stockBefore - quantity) {
        const movement = { p_business_id: business, p_product_id: product.id, p_barcode_id: null,
          p_movement_type: 'manual_adjustment', p_package_quantity: quantity, p_direction: 1,
          p_reference_type: 'qa_full_ui_return', p_reference_id: order.id,
          p_reason: 'QA: mercadería no salió físicamente',
          p_idempotency_key: `qa_ui_restore_${order.id.replaceAll('-', '')}` };
        await rpc(staff.client, 'apply_inventory_movement', movement);
        await rpc(staff.client, 'apply_inventory_movement', movement);
      } else if (currentStock !== stockBefore) throw Error('QA_STOCK_CHANGED_OUTSIDE_RUN');
      report.stockRestored = Number((await read(staff.client.from('products').select('stock')
        .eq('id', product.id).single())).stock) === stockBefore;
    } finally {
      if (run) {
        delete run.tracking;
        delete run.deliveryCode;
        run.sealedAt = new Date().toISOString();
        guardarSecreto(runName, 'staging', JSON.stringify(run));
      }
    }
  }
  writeFileSync('artifacts/rider-pilot-full-ui-e2e.json', JSON.stringify(report, null, 2));
  if (run && report.qaClassified && report.stockRestored) borrarSecreto(runName);
}
console.log(JSON.stringify(report));
if (!Object.entries(report).filter(([key]) => key !== 'timestamp' && key !== 'project' && key !== 'stagingOnly')
  .every(([, value]) => value === true)) process.exitCode = 1;
