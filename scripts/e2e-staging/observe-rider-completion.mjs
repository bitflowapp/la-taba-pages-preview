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
if (key?.usuario !== ref || !credentials?.usuario || !credentials?.secreto) throw Error('STAGING_QA_CREDENTIALS_REQUIRED');
const staff = createClient(`https://${ref}.supabase.co`, key.secreto,
  { auth: { persistSession: false, autoRefreshToken: false } });
const auth = await staff.auth.signInWithPassword({ email: credentials.usuario, password: credentials.secreto });
if (auth.error || !auth.data.session) throw Error('STAGING_STAFF_LOGIN_REQUIRED');
const session = await staff.rpc('identity_register_session', {
  p_business_id: business, p_client: 'panel_web', p_device_label: 'Pilot terminal observer',
  p_device_key_hash: null, p_app_version: 'pilot-qa',
});
if (session.error || session.data?.ok !== true) throw Error('STAGING_STAFF_SESSION_REQUIRED');

const browser = await chromium.launch({ headless: true });
const report = { timestamp: new Date().toISOString(), project: ref, stagingOnly: true,
  panelFinal: false, customerDelivered: false, backendDelivered: false };
try {
  const panelContext = await browser.newContext({ serviceWorkers: 'block' });
  await panelContext.addInitScript(({ ref, session }) =>
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session)),
  { ref, session: auth.data.session });
  const panel = await panelContext.newPage();
  await panel.goto('http://127.0.0.1:39092/#business', { waitUntil: 'domcontentloaded' });
  await panel.locator('[data-production-orders-view]:visible').first().click();
  const card = panel.locator(`[data-order-card="${run.publicCode}"]`);
  await card.waitFor({ timeout: 45_000 });
  const finished = panel.locator('[data-tray-finished] .tray-pulse-n');
  await expect(finished).toHaveText(/^\d+$/);
  const baseline = Number(await finished.textContent());

  const customerContext = await browser.newContext({ serviceWorkers: 'block' });
  await customerContext.addInitScript(({ business, access }) => {
    sessionStorage.setItem(`taba-order-access-v1:${business}:last`, JSON.stringify(access));
  }, { business, access: { orderId: run.orderId, publicCode: run.publicCode, trackingToken: run.tracking } });
  const customer = await customerContext.newPage();
  await customer.goto('http://127.0.0.1:39092/#tracking', { waitUntil: 'domcontentloaded' });
  await customer.locator('[data-tracking-status="arriving"]').waitFor({ timeout: 45_000 });
  console.log('RIDER_TERMINAL_OBSERVER_READY');

  await customer.locator('[data-tracking-status="delivered"]').waitFor({ timeout: 180_000 });
  await expect(customer.locator('[data-tracking-title]')).toHaveText('Pedido entregado');
  report.customerDelivered = true;
  await card.waitFor({ state: 'detached', timeout: 45_000 });
  await expect.poll(async () => Number(await finished.textContent()), { timeout: 45_000 })
    .toBeGreaterThanOrEqual(baseline + 1);
  report.panelFinal = true;
  const order = await staff.from('orders').select('status,delivered_at').eq('id', run.orderId).single();
  report.backendDelivered = !order.error && order.data?.status === 'delivered' && Boolean(order.data?.delivered_at);
  await customerContext.close();
  await panelContext.close();
} finally {
  await browser.close();
  writeFileSync('artifacts/rider-pilot-final-observation.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
if (!report.panelFinal || !report.customerDelivered || !report.backendDelivered) process.exitCode = 1;
