import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const run = JSON.parse(leerSecreto('RIDER CANONICAL QA RUN 20260922')?.secreto || '{}');
if (!run.orderId || !run.publicCode || !run.tracking) throw Error('QA_ORDER_ACCESS_REQUIRED');
const ref = 'ucbtjcurawxjwjdvvcvj';
const business = 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const key = leerSecreto('STAGING SUPABASE PUBLISHABLE KEY');
const credentials = leerSecreto('STAGING BUSINESS QA 20260920');
if (key?.usuario !== ref || !credentials?.usuario || !credentials?.secreto)
  throw Error('STAGING_QA_CREDENTIALS_REQUIRED');
const staff = createClient(`https://${ref}.supabase.co`, key.secreto,
  { auth: { persistSession: false, autoRefreshToken: false } });
const auth = await staff.auth.signInWithPassword({ email: credentials.usuario, password: credentials.secreto });
if (auth.error || !auth.data.session) throw Error('STAGING_STAFF_LOGIN_REQUIRED');
const registered = await staff.rpc('identity_register_session', {
  p_business_id: business, p_client: 'panel_web', p_device_label: 'Pilot post-delivery observer',
  p_device_key_hash: null, p_app_version: 'pilot-qa',
});
if (registered.error || registered.data?.ok !== true) throw Error('STAGING_STAFF_SESSION_REQUIRED');

const browser = await chromium.launch({ headless: true });
const report = { timestamp: new Date().toISOString(), project: ref, stagingOnly: true,
  panelExactOrderFinal: false, customerDelivered: false, backendDelivered: false };
try {
  const panelContext = await browser.newContext({ serviceWorkers: 'block' });
  await panelContext.addInitScript(({ ref, session }) =>
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session)),
  { ref, session: auth.data.session });
  const panel = await panelContext.newPage();
  await panel.goto('http://127.0.0.1:39092/#business', { waitUntil: 'domcontentloaded' });
  await panel.locator('[data-business-ops-view="payments"]:visible').first().click();
  const card = panel.locator(`[data-manual-payment-card="${run.orderId}"]`);
  await card.waitFor({ timeout: 45_000 });
  await expect(card).toContainText(run.publicCode);
  await expect(card).toContainText('Pedido: delivered');
  report.panelExactOrderFinal = true;

  const customerContext = await browser.newContext({ serviceWorkers: 'block' });
  await customerContext.addInitScript(({ business, access }) => {
    sessionStorage.setItem(`taba-order-access-v1:${business}:last`, JSON.stringify(access));
  }, { business, access: { orderId: run.orderId, publicCode: run.publicCode, trackingToken: run.tracking } });
  const customer = await customerContext.newPage();
  await customer.goto('http://127.0.0.1:39092/#tracking', { waitUntil: 'domcontentloaded' });
  await customer.locator('[data-tracking-status="delivered"]').waitFor({ timeout: 45_000 });
  await expect(customer.locator('[data-tracking-title]')).toHaveText('Pedido entregado');
  report.customerDelivered = true;
  const order = await staff.from('orders').select('status,delivered_at,assigned_rider_user_id')
    .eq('id', run.orderId).single();
  report.backendDelivered = !order.error && order.data?.status === 'delivered'
    && Boolean(order.data?.delivered_at && order.data?.assigned_rider_user_id);
  await customerContext.close();
  await panelContext.close();
} finally {
  await browser.close();
  writeFileSync('artifacts/rider-pilot-post-delivery-observation.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
if (!report.panelExactOrderFinal || !report.customerDelivered || !report.backendDelivered)
  process.exitCode = 1;
