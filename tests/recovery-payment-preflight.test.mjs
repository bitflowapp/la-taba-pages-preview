import fs from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PAYMENT_SERVER_SECRETS, evaluatePaymentConfiguration } from '../scripts/recovery/payment-preflight.mjs';
import { recoveryEnvironment } from '../scripts/recovery/plan.mjs';

const target = JSON.parse(fs.readFileSync('deploy/recovery-free-hosted.json', 'utf8'));
const inventory = [...PAYMENT_SERVER_SECRETS.map(name => ({ name, value: 'opaque-server-digest' })),
  ...Object.entries(recoveryEnvironment(target)).map(([name,value]) => ({ name, value: createHash('sha256').update(value).digest('hex') }))];

test('server configuration alone never certifies live OAuth, a payment or commercial launch', () => {
  const result = evaluatePaymentConfiguration(target, inventory);
  assert.equal(result.serverConfigurationReady, true);
  assert.equal(result.providerPaymentVerified, false);
  assert.equal(result.oauthRedirectRegistrationVerified, false);
  assert.equal(result.commercialGo, false);
});
test('missing actual OAuth webhook secret blocks readiness', () => {
  const result = evaluatePaymentConfiguration(target, inventory.filter(item => item.name !== 'MERCADOPAGO_OAUTH_WEBHOOK_SECRET'));
  assert.equal(result.serverConfigurationReady, false);
  assert.deepEqual(result.missingSecrets, ['MERCADOPAGO_OAUTH_WEBHOOK_SECRET']);
});
test('wrong environment digest and real-payment activation markers block readiness', () => {
  const changed = inventory.map(item => item.name === 'MERCADOPAGO_ENVIRONMENT' ? { ...item, value: 'wrong' } : item);
  changed.push({ name:'MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION', value:'opaque' });
  const result = evaluatePaymentConfiguration(target, changed);
  assert.equal(result.serverConfigurationReady, false);
  assert.deepEqual(result.mismatchedConfiguration, ['MERCADOPAGO_ENVIRONMENT']);
  assert.deepEqual(result.forbiddenConfiguration, ['MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION']);
});
