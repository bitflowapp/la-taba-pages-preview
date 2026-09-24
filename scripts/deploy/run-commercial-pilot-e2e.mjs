// Controlled, physical PILOT E2E. Requires deployed public PILOT, approved
// catalog, QA accounts and signed v4 on the known Moto. Never runs on QA or Prod.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { guardarSecreto, leerSecreto, borrarSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { loadPilotPreflight } from './pilot-preflight.mjs';
import { validatePilotTarget } from './smoke-commercial-pilot.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SERIAL = 'ZY32LHS6PS';
const RUN_NAME = 'PILOT COMMERCIAL E2E ACTIVE';
const option = (flag) => { const i = process.argv.indexOf(flag); return i < 0 ? '' : process.argv[i + 1] || ''; };
const options = { auth: { persistSession: false, autoRefreshToken: false } };

export function validatePilotE2eInputs({ config, plan, runtime, metadata }) {
  const origin = validatePilotTarget({ origin: config.customerUrl,
    ref: plan.projectRef, businessId: plan.businessId, runtime });
  assert.equal(metadata?.environment, 'pilot', 'PILOT_DEPLOY_METADATA_REQUIRED');
  assert.equal(metadata.backendRef, plan.projectRef, 'PILOT_DEPLOY_BACKEND_MISMATCH');
  assert.equal(metadata.businessId, plan.businessId, 'PILOT_DEPLOY_BUSINESS_MISMATCH');
  assert.deepEqual([...(metadata.approvedSkus || [])].sort(), [...plan.approvedSkus].sort(),
    'PILOT_DEPLOY_CATALOG_ALLOWLIST_MISMATCH');
  return origin;
}

function qaCredential(name) {
  const found = leerSecreto(name);
  assert.ok(found?.usuario && found?.secreto, `PILOT_QA_ACCOUNT_MISSING:${name}`);
  return found;
}

async function qaActor(name, ref, publishableKey) {
  const qa = qaCredential(name);
  const client = createClient(`https://${ref}.supabase.co`, publishableKey, options);
  const result = await client.auth.signInWithPassword({ email: qa.usuario, password: qa.secreto });
  assert.ok(!result.error && result.data?.session && result.data?.user?.id,
    `PILOT_QA_LOGIN_FAILED:${name}`);
  return { client, session: result.data.session, userId: result.data.user.id };
}

async function read(query) {
  const { data, error } = await query;
  if (error) throw Error(`PILOT_READ_FAILED:${error.code || 'UNKNOWN'}`);
  return data;
}
async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error || data?.ok === false) throw Error(`PILOT_RPC_FAILED:${name}:${error?.code || data?.code || 'UNKNOWN'}`);
  return data;
}
function adb(args, timeout = 15_000) {
  return spawnSync('adb', ['-s', SERIAL, ...args], { encoding: 'utf8', windowsHide: true, timeout });
}
async function bridge() {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'deploy', 'pilot-rider-qa-bridge.mjs')],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(Error('PILOT_BRIDGE_START_TIMEOUT')), 15_000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (!output.includes('\n')) return;
      clearTimeout(timeout);
      try {
        const state = JSON.parse(output.split('\n')[0]);
        assert.ok(state.pilotOnly && state.oneTime && state.boundToLoopback,
          'PILOT_BRIDGE_NOT_ISOLATED');
        resolve(state.bridgePort);
      } catch { reject(Error('PILOT_BRIDGE_INVALID')); }
    });
    child.on('exit', () => { clearTimeout(timeout); reject(Error('PILOT_BRIDGE_EARLY_EXIT')); });
  });
  return { child, port };
}

function instrumentation(port) {
  const args = ['-s', SERIAL, 'shell', 'am', 'instrument', '-w',
    '-e', 'qaPilot', 'true', '-e', 'qaPort', String(port), '-e', 'class',
    'com.lataba.rider.PilotReleasePhysicalTest',
    'com.lataba.rider.pilot.test/androidx.test.runner.AndroidJUnitRunner'];
  const child = spawn('adb', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => { child.kill(); reject(Error('PILOT_MOTO_TEST_TIMEOUT')); }, 360_000);
    child.stdout.on('data', (chunk) => { output += chunk.toString().slice(0, 4000); });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0 && /OK \(1 test\)/.test(output)
        && !/(FAILURES|INSTRUMENTATION_FAILED|AssumptionViolated)/.test(output)) resolve(true);
      else reject(Error('PILOT_MOTO_INSTRUMENTATION_FAILED'));
    });
  });
}

async function main() {
  const configFile = option('--config');
  const approvalFile = option('--approval');
  assert.ok(configFile && approvalFile, 'PILOT_CONFIG_AND_APPROVAL_REQUIRED');
  assert.ok(!leerSecreto(RUN_NAME), 'PILOT_PREVIOUS_QA_RUN_REQUIRES_RECOVERY');
  const { plan, ownerCredentials } = loadPilotPreflight({
    configFile, approvalFile, phase: 'e2e',
  });
  const config = JSON.parse(readFileSync(path.resolve(configFile), 'utf8'));
  const origin = new URL(config.customerUrl).origin;
  const runtimeResponse = await fetch(`${origin}/runtime-config.js`, { cache: 'no-store',
    signal: AbortSignal.timeout(15_000) });
  assert.equal(runtimeResponse.status, 200, 'PILOT_PUBLIC_RUNTIME_UNAVAILABLE');
  const vm = await import('node:vm');
  const sandbox = { globalThis: {} };
  vm.runInNewContext(await runtimeResponse.text(), sandbox, { timeout: 1000 });
  const metadataResponse = await fetch(`${origin}/pilot-deploy-metadata.json`, { cache: 'no-store',
    signal: AbortSignal.timeout(15_000) });
  assert.equal(metadataResponse.status, 200, 'PILOT_PUBLIC_METADATA_UNAVAILABLE');
  validatePilotE2eInputs({ config, plan,
    runtime: sandbox.globalThis.__LA_TABA_RUNTIME_CONFIG__,
    metadata: await metadataResponse.json() });
  assert.equal(adb(['get-state']).status, 0, 'MOTO_G15_NOT_CONNECTED');
  const model = adb(['shell', 'getprop', 'ro.product.model']).stdout.trim();
  assert.match(model, /moto g15/i, 'ADB_DEVICE_NOT_MOTO_G15');
  const packageDump = adb(['shell', 'dumpsys', 'package', 'com.lataba.rider.pilot']).stdout;
  assert.match(packageDump, /versionCode=4\b/, 'PILOT_V4_NOT_INSTALLED');
  assert.match(packageDump, /versionName=0\.1\.3-canonical-pilot/, 'PILOT_V4_VERSION_MISMATCH');

  const ref = plan.projectRef;
  const business = plan.businessId;
  const publishableKey = ownerCredentials.publishableKey;
  const customer = await qaActor('PILOT CUSTOMER QA', ref, publishableKey);
  const staff = await qaActor('PILOT BUSINESS QA', ref, publishableKey);
  const riderQa = await qaActor('PILOT RIDER QA', ref, publishableKey);
  const adminCredential = leerSecreto('PILOT SUPABASE SECRET KEY');
  assert.ok(adminCredential?.usuario === ref && adminCredential.secreto,
    'PILOT_QA_CLEANUP_SECRET_MISSING');
  let adminJwtRole = '';
  try {
    adminJwtRole = JSON.parse(Buffer.from(adminCredential.secreto.split('.')[1] || '',
      'base64url').toString('utf8')).role;
  } catch { /* opaque sb_secret_ key */ }
  assert.ok(adminCredential.secreto.startsWith('sb_secret_') || adminJwtRole === 'service_role',
    'PILOT_QA_CLEANUP_KEY_NOT_PRIVILEGED');
  const admin = createClient(`https://${ref}.supabase.co`, adminCredential.secreto, options);
  const adminCheck = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  assert.ifError(adminCheck.error);
  const panelSession = await rpc(staff.client, 'identity_register_session', { p_business_id: business,
    p_client: 'panel_web', p_device_label: 'Commercial pilot QA E2E',
    p_device_key_hash: null, p_app_version: 'pilot-v4-qa' });
  assert.ok(panelSession?.ok === true && ['owner', 'admin'].includes(panelSession.role),
    'PILOT_BUSINESS_QA_OWNER_OR_ADMIN_REQUIRED');
  const membership = await read(staff.client.from('business_members').select('role,is_active')
    .eq('business_id', business).eq('user_id', riderQa.userId).maybeSingle());
  assert.ok(membership?.role === 'rider' && membership.is_active === true,
    'PILOT_RIDER_QA_MEMBERSHIP_REQUIRED');
  const address = (await read(customer.client.from('customer_addresses')
    .select('id,neighborhood,latitude,longitude,location_confirmed_at').is('deleted_at', null)))
    .find((row) => row.location_confirmed_at && row.latitude && row.longitude);
  assert.ok(address, 'PILOT_CONFIRMED_QA_ADDRESS_REQUIRED');
  const businessRow = await read(staff.client.from('businesses')
    .select('minimum_delivery_subtotal').eq('id', business).single());
  const availability = await rpc(staff.client, 'commerce_availability',
    { p_business_id: business, p_channel: 'delivery', p_context: {} });
  const area = availability.areas?.find((row) => row.name === address.neighborhood)
    || availability.areas?.[0];
  assert.ok(area, 'PILOT_DELIVERY_AREA_REQUIRED');
  const minimum = Number(area.minimum_subtotal ?? businessRow.minimum_delivery_subtotal ?? 0);
  const products = await read(staff.client.from('products').select('id,sku,price,stock')
    .eq('business_id', business).eq('is_active', true).eq('available', true)
    .eq('is_verified', true).eq('is_alcoholic', false).gt('stock', 0));
  assert.deepEqual(products.map((item) => item.sku).sort(), [...plan.approvedSkus].sort(),
    'PILOT_CATALOG_NOT_APPROVED_ALLOWLIST');
  const candidate = products.map((product) => ({ product,
    quantity: Math.max(1, Math.ceil((minimum + 1) / Number(product.price))) }))
    .find(({ product, quantity }) => product.price > 0 && product.stock >= quantity);
  assert.ok(candidate, 'PILOT_QA_PRODUCT_WITH_STOCK_REQUIRED');
  const { product, quantity } = candidate;
  const stockBefore = Number(product.stock);
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({ headless: true });
  let customerContext;
  let panelContext;
  let order;
  let run;
  let physicalPromise;
  const report = { projectRef: ref, pilotOnly: true, startedAt,
    customerOrder: false, manualPayment: false, panelReady: false,
    riderAccept: false, gpsTracking: false, deliveryCode: false,
    delivered: false, customerTerminal: false, panelTerminal: false,
    qaClassified: false, paymentReversed: false, stockRestored: false };
  try {
    customerContext = await browser.newContext({ serviceWorkers: 'block' });
    panelContext = await browser.newContext({ serviceWorkers: 'block' });
    await customerContext.addInitScript(({ project, session }) =>
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session)),
    { project: ref, session: customer.session });
    await panelContext.addInitScript(({ project, session }) =>
      localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify(session)),
    { project: ref, session: staff.session });
    const storefront = await customerContext.newPage();
    const panel = await panelContext.newPage();
    await storefront.goto(`${origin}/#catalog`, { waitUntil: 'domcontentloaded' });
    await expect(storefront.locator(`[data-product-grid] [data-add-product="${product.id}"]:visible`).first()).toBeVisible();
    await storefront.locator(`[data-product-grid] [data-add-product="${product.id}"]:visible`).first().click();
    for (let i = 1; i < quantity; i += 1) {
      await storefront.locator(`[data-cart-inc="${product.id}"]:visible`).first().click();
    }
    await storefront.locator('[data-open-cart]:visible').first().click();
    await expect(storefront.locator('[data-checkout-form]')).toBeVisible();
    await storefront.getByLabel('Delivery').check();
    await expect(storefront.locator('[data-profile-checkout] .profile-address-card.is-selected')).toHaveCount(1);
    await storefront.getByLabel('Forma de pago').selectOption('cash');
    await expect(storefront.getByText('El cobro queda pendiente hasta que el negocio registre el dinero recibido.')).toBeVisible();
    await storefront.getByRole('button', { name: /Confirmar pedido/i }).click();
    await expect(storefront.locator('[data-tracking-title]')).toHaveText('Tu pedido fue confirmado',
      { timeout: 35_000 });
    const rows = await read(staff.client.from('orders')
      .select('id,public_code,status,revision,manual_payment_status,payment_method')
      .eq('business_id', business).eq('customer_user_id', customer.userId)
      .gt('created_at', startedAt).order('created_at', { ascending: false }).limit(1));
    order = rows[0];
    assert.ok(order?.id && order.manual_payment_status === 'pending'
      && order.payment_method === 'cash', 'PILOT_ORDER_OR_MANUAL_PAYMENT_MISSING');
    report.customerOrder = true;
    const access = await storefront.evaluate((businessId) => {
      const key = `taba-order-access-v1:${businessId}:last`;
      return JSON.parse(sessionStorage.getItem(key) || localStorage.getItem(key) || 'null');
    }, business);
    assert.ok(access?.orderId === order.id && access.trackingToken,
      'PILOT_CUSTOMER_TRACKING_ACCESS_MISSING');
    const code = await rpc(customer.client, 'issue_order_delivery_code',
      { p_order_id: order.id, p_tracking_token: access.trackingToken });
    assert.match(code.delivery_code || '', /^\d{4}$/, 'PILOT_DELIVERY_CODE_MISSING');
    run = { projectRef: ref, businessId: business, orderId: order.id,
      publicCode: order.public_code, deliveryCode: code.delivery_code,
      productId: product.id, quantity, stockBefore };
    guardarSecreto(RUN_NAME, 'pilot', JSON.stringify(run));

    await panel.goto(`${origin}/#business`, { waitUntil: 'domcontentloaded' });
    await panel.locator('[data-production-orders-view]:visible').first().click();
    const card = panel.locator(`[data-order-card="${order.public_code}"]`);
    await card.waitFor({ timeout: 45_000 });
    await expect(card.locator('[data-manual-payment-status]'))
      .toHaveAttribute('data-manual-payment-status', 'pending');
    await panel.locator('[data-business-ops-view="payments"]:visible').first().click();
    const payment = panel.locator(`[data-manual-payment-card="${order.id}"]`);
    await expect(payment.locator('[data-manual-payment-status]'))
      .toHaveAttribute('data-manual-payment-status', 'pending');
    panel.once('dialog', (dialog) => dialog.accept());
    await payment.locator('[data-manual-payment-confirm][data-manual-payment-method="cash"]').click();
    await expect(payment.locator('[data-manual-payment-status]'))
      .toHaveAttribute('data-manual-payment-status', 'confirmed');
    const confirmed = await read(staff.client.from('orders')
      .select('manual_payment_status,manual_payment_method,manual_payment_confirmed_at')
      .eq('id', order.id).single());
    assert.ok(confirmed.manual_payment_status === 'confirmed'
      && confirmed.manual_payment_method === 'cash'
      && confirmed.manual_payment_confirmed_at, 'PILOT_MANUAL_PAYMENT_NOT_PERSISTED');
    const audit = await read(admin.from('order_events').select('id')
      .eq('order_id', order.id).eq('event_type', 'order.manual_payment_confirmed'));
    const mpIntents = await read(admin.from('payment_intents').select('id').eq('order_id', order.id));
    assert.ok(audit.length === 1 && mpIntents.length === 0,
      'PILOT_MANUAL_PAYMENT_AUDIT_OR_NO_MP_GATE_FAILED');
    report.manualPayment = true;
    await panel.locator('[data-production-orders-view]:visible').first().click();
    for (const status of ['accepted', 'preparing', 'ready']) {
      const action = card.locator('[data-production-business-next]');
      await expect(action).toHaveAttribute('data-next-status', status, { timeout: 45_000 });
      await action.click();
      await expect.poll(async () => (await read(staff.client.from('orders').select('status')
        .eq('id', order.id).single())).status, { timeout: 45_000 }).toBe(status);
    }
    report.panelReady = true;
    const riderId = riderQa.userId;
    const startedBridge = await bridge();
    physicalPromise = instrumentation(startedBridge.port);
    physicalPromise.catch(() => {}); // handled again after web assertions
    await panel.locator('[data-panel-region="rider-presence"] summary').waitFor({ timeout: 120_000 });
    await expect.poll(async () => panel.locator('[data-panel-region="rider-presence"] summary').innerText(),
      { timeout: 120_000 }).toContain('1 disponibles');
    const select = card.locator('[data-production-rider-select]');
    await select.waitFor({ timeout: 120_000 });
    await select.selectOption(riderId);
    await card.locator('[data-production-business-assign]').click();
    await expect.poll(async () => (await rpc(staff.client, 'list_rider_order_offers',
      { p_business_id: business })).find((offer) => offer.order_id === order.id)?.rider_user_id,
    { timeout: 45_000 }).toBe(riderId);
    await expect.poll(async () => (await read(staff.client.from('orders')
      .select('assigned_rider_user_id').eq('id', order.id).single())).assigned_rider_user_id,
    { timeout: 120_000 }).toBe(riderId);
    report.riderAccept = true;
    const tracker = createClient(`https://${ref}.supabase.co`, publishableKey,
      { ...options, global: { headers: { 'x-order-token': access.trackingToken } } });
    await expect.poll(async () => {
      const publicState = await tracker.rpc('get_public_order_tracking',
        { p_public_id: order.public_code });
      const ui = await storefront.evaluate(() => {
        const marker = document.querySelector('[data-tracking-panel] .lt-rider-marker.source-gps');
        const canvas = document.querySelector('[data-tracking-panel] [data-map-canvas]');
        const bounds = marker?.getBoundingClientRect();
        return {
          status: document.querySelector('[data-tracking-status]')?.getAttribute('data-tracking-status'),
          markerVisible: Boolean(bounds && bounds.width > 0 && bounds.height > 0
            && getComputedStyle(marker).visibility === 'visible'),
          mapHeight: canvas?.getBoundingClientRect().height || 0,
        };
      });
      const panelText = await card.innerText().catch(() => '');
      return publicState.data?.status === 'on_the_way'
        && Boolean(publicState.data?.rider_location)
        && ui.status === 'on_the_way' && ui.markerVisible && ui.mapHeight > 0
        && /en reparto|en camino/i.test(panelText);
    }, { timeout: 180_000 }).toBe(true);
    report.gpsTracking = true;
    await physicalPromise;
    report.deliveryCode = true;
    const final = await read(staff.client.from('orders')
      .select('status,delivered_at,assigned_rider_user_id')
      .eq('id', order.id).single());
    report.delivered = final.status === 'delivered'
      && Boolean(final.delivered_at && final.assigned_rider_user_id);
    await storefront.locator('[data-tracking-status="delivered"]').waitFor({ timeout: 90_000 });
    report.customerTerminal = true;
    await card.waitFor({ state: 'detached', timeout: 90_000 });
    report.panelTerminal = true;
  } finally {
    await physicalPromise?.catch(() => {});
    await customerContext?.close();
    await panelContext?.close();
    await browser.close();
    let cleanupError;
    if (order?.id) {
      try {
        const payment = await read(staff.client.from('orders')
          .select('revision,manual_payment_status').eq('id', order.id).single());
        if (payment.manual_payment_status === 'confirmed') {
          await rpc(staff.client, 'reverse_manual_order_payment', {
            p_order_id: order.id, p_expected_revision: payment.revision,
            p_reason: 'QA piloto: sin dinero real; reversión de certificación',
            p_idempotency_key: randomUUID(),
          });
        }
        const after = await read(staff.client.from('orders')
          .select('manual_payment_status,origin,status,revision').eq('id', order.id).single());
        report.paymentReversed = after.manual_payment_status === 'reversed';
        if (!['delivered', 'cancelled', 'canceled', 'rejected'].includes(after.status)) {
          await rpc(staff.client, 'cancel_order', { p_order_id: order.id,
            p_expected_revision: after.revision, p_reason: 'QA piloto: limpieza sin mercadería real',
            p_idempotency_key: randomUUID() });
        }
        if (after.origin !== 'qa') await rpc(admin, 'classify_order_as_qa',
          { p_order_id: order.id, p_reason: 'commercial_pilot_physical_certification' });
        report.qaClassified = true;
        const currentStock = Number((await read(staff.client.from('products')
          .select('stock').eq('id', product.id).single())).stock);
        if (currentStock === stockBefore - quantity) {
          await rpc(staff.client, 'apply_inventory_movement', {
            p_business_id: business, p_product_id: product.id, p_barcode_id: null,
            p_movement_type: 'manual_adjustment', p_package_quantity: quantity,
            p_direction: 1, p_reference_type: 'pilot_qa_return', p_reference_id: order.id,
            p_reason: 'QA piloto: mercadería no retirada físicamente',
            p_idempotency_key: `pilot_qa_restore_${order.id.replaceAll('-', '')}`,
          });
        } else if (currentStock !== stockBefore) throw Error('PILOT_QA_STOCK_UNEXPECTED');
        report.stockRestored = Number((await read(staff.client.from('products')
          .select('stock').eq('id', product.id).single())).stock) === stockBefore;
      } catch (error) {
        cleanupError = error;
      } finally {
        if (run) {
          delete run.deliveryCode;
          run.sealedAt = new Date().toISOString();
          guardarSecreto(RUN_NAME, 'pilot', JSON.stringify(run));
        }
      }
    }
    writeFileSync(path.join(ROOT, 'artifacts', 'pilot-commercial-e2e.json'),
      JSON.stringify(report, null, 2) + '\n');
    if (run && report.qaClassified && report.paymentReversed && report.stockRestored) {
      borrarSecreto(RUN_NAME);
    }
    if (cleanupError) throw cleanupError;
  }
  assert.ok(Object.entries(report).filter(([key]) => !['projectRef', 'pilotOnly', 'startedAt'].includes(key))
    .every(([, value]) => value === true), 'PILOT_E2E_INCOMPLETE');
  console.log(JSON.stringify({ pilotE2e: 'PASS', ...report }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(`PILOT_E2E_BLOCKED:${error.message}`); process.exitCode = 1; });
}
