import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const preference = fs.readFileSync('supabase/functions/mercadopago-create-preference/index.ts', 'utf8');
const oauth = fs.readFileSync('supabase/functions/_shared/seller-oauth.ts', 'utf8');
const worker = fs.readFileSync('supabase/functions/mercadopago-payment-worker/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260908070341_astra_p2_webhook_retry_and_refund_identity.sql', 'utf8');
const runner = fs.readFileSync('scripts/run-mercadopago-webhook-tests.mjs', 'utf8');

test('stored, recovered and newly-created preference URLs all use current seller authority', () => {
  assert.match(preference, /attempt_status === 'created'[\s\S]*authorizedPreferenceResponse/);
  assert.equal((preference.match(/authorizedPreferenceResponse\(/g) || []).length, 4);
  assert.match(preference, /await assertCurrentSellerPaymentAuthority\(businessId\)[\s\S]*preferenceResponse/);
  assert.match(oauth, /requireRealPaymentSmokeAuthorization\(environment\)[\s\S]*sellerAccessToken\(businessId\)/);
  for (const field of ['business.status !== "open"', 'settings.enabled !== true', 'seller.status !== "connected"',
    'seller.seller_id !== settings.collector_id', 'seller.application_id !== config.clientId']) {
    assert.ok(oauth.includes(field), `missing current authority assertion: ${field}`);
  }
});

test('deployment contract binds project, environments, origins, callbacks and application', () => {
  for (const value of [
    'ukxqbgswjlibmnjemrzd', 'wwcpogltfgzgkrlilbcd',
    'https://taba2-staging.pages.dev/', 'https://la-taba.pages.dev/',
    '2691240967769590', '7677852968049976',
  ]) assert.ok(oauth.includes(value));
  assert.match(oauth, /if \(!binding\) throw new Error\("Unknown Mercado Pago deployment"\)/);
  assert.doesNotMatch(oauth, /isolatedConsent/);
});

test('rejected webhook promotion serializes and queues exactly once', () => {
  assert.match(migration, /select \* into v_receipt[\s\S]*for update/);
  assert.match(migration, /if v_receipt\.signature_valid or not p_signature_valid/);
  assert.match(migration, /set signature_valid = true[\s\S]*processing_status = 'received'/);
  assert.match(migration, /on conflict \(webhook_receipt_id\)[\s\S]*do nothing/);
});

test('refund reconciliation excludes owned IDs and never chooses by array order', () => {
  assert.match(worker, /providerIdsOwnedByOtherRefunds|ownedByOthers/);
  assert.match(worker, /correlateProviderRefund/);
  assert.doesNotMatch(worker, /refunds\.find/);
  assert.match(migration, /where r\.provider_refund_id = v_provider_refund_id and r\.id <> v_refund\.id/);
  assert.match(runner, /current-payment-authority\.deno\.ts/);
  assert.match(runner, /refund-correlation\.deno\.ts/);
});
