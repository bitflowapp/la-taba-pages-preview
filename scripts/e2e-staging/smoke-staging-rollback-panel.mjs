import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const origin = 'https://taba2-staging.pages.dev';
const ref = 'ucbtjcurawxjwjdvvcvj';
const business = 'a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0';
const expectedCommit = 'bcea25fd8d3ffe088dbf6ea6f3bfa2dbc3b79852';
const versionResponse = await fetch(`${origin}/version.json`, {
  cache: 'no-store', signal: AbortSignal.timeout(12_000), redirect: 'error',
});
assert.equal(versionResponse.status, 200);
assert.equal((await versionResponse.json()).commit, expectedCommit);

const publishable = leerSecreto('STAGING SUPABASE PUBLISHABLE KEY');
const credentials = leerSecreto('STAGING BUSINESS QA 20260920');
assert.equal(publishable?.usuario, ref);
assert.ok(credentials?.usuario && credentials?.secreto, 'Staging business QA account required');
const staff = createClient(`https://${ref}.supabase.co`, publishable.secreto,
  { auth: { persistSession: false, autoRefreshToken: false } });
const { data: login, error: loginError } = await staff.auth.signInWithPassword({
  email: credentials.usuario, password: credentials.secreto,
});
assert.ok(!loginError && login?.session, 'Staging staff login failed');
const { data: registered, error: registerError } = await staff.rpc('identity_register_session', {
  p_business_id: business, p_client: 'panel_web', p_device_label: 'Staging rollback smoke',
  p_device_key_hash: null, p_app_version: 'pilot-qa',
});
assert.ok(!registerError && registered?.ok === true, 'Staging staff session unavailable');

const browser = await chromium.launch({ headless: true });
const report = { stagingCommit: expectedCommit, panelLogin: false,
  panelOrders: false, qaDeliveredOrderRead: false, customerCatalog: false };
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.addInitScript(({ ref, session }) =>
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session)),
  { ref, session: login.session });
  const panel = await context.newPage();
  await panel.goto(`${origin}/#business`, { waitUntil: 'domcontentloaded' });
  await expect(panel.locator('[data-production-orders-view]:visible').first()).toBeVisible({ timeout: 45_000 });
  await expect(panel.getByRole('heading', { name: 'Panel del negocio' })).toBeVisible();
  report.panelLogin = true;
  await panel.locator('[data-production-orders-view]:visible').first().click();
  await expect(panel.locator('[data-panel-region="rider-presence"] summary')).toBeVisible();
  report.panelOrders = true;
  const { data: order, error: orderError } = await staff.from('orders')
    .select('status,origin,delivered_at').eq('business_id', business)
    .eq('public_code', 'LT-0041').single();
  report.qaDeliveredOrderRead = !orderError && order?.status === 'delivered'
    && order?.origin === 'qa' && Boolean(order?.delivered_at);
  await context.close();

  const customerContext = await browser.newContext({ serviceWorkers: 'block' });
  const customer = await customerContext.newPage();
  await customer.goto(`${origin}/#catalog`, { waitUntil: 'domcontentloaded' });
  await expect(customer.locator('[data-product-grid] [data-add-product]:visible').first())
    .toBeVisible({ timeout: 45_000 });
  report.customerCatalog = true;
  await customerContext.close();
} finally {
  await browser.close();
}
console.log(JSON.stringify(report));
if (!Object.values(report).filter((value) => typeof value === 'boolean').every(Boolean)) process.exitCode = 1;
