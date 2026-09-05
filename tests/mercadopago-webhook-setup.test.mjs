import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { configureWebhookSecret } from '../scripts/mercadopago/configurar-webhook-staging.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const fixture = 'fixture_webhook_signature_only';
const configured = () => [
  ...['MERCADOPAGO_CLIENT_ID', 'MERCADOPAGO_CLIENT_SECRET', 'MERCADOPAGO_TOKEN_ENCRYPTION_KEY'].map(name => ({name, value: 'existing-hash'})),
  ...Object.entries({TABA_DEPLOYMENT_ENV: 'staging', MERCADOPAGO_ENVIRONMENT: 'test', MERCADOPAGO_OAUTH_PROJECT_REF: 'ukxqbgswjlibmnjemrzd'})
    .map(([name, value]) => ({name, value: hash(value)})),
];
test('webhook setup writes only its secret and verifies the saved hash', async () => {
  const calls = [];
  await configureWebhookSecret(fixture, {
    withToken: task => task('fixture-management-auth'),
    request: async (url, options) => {
      calls.push({url, options});
      return Response.json(calls.length === 3 ? [...configured(), {name: 'MERCADOPAGO_OAUTH_WEBHOOK_SECRET', value: hash(fixture)}] : configured());
    },
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.url === 'https://api.supabase.com/v1/projects/ukxqbgswjlibmnjemrzd/secrets'));
  assert.deepEqual(JSON.parse(calls[1].options.body), [{name: 'MERCADOPAGO_OAUTH_WEBHOOK_SECRET', value: fixture}]);
});
test('webhook setup refuses a production environment before writing', async () => {
  let calls = 0;
  await assert.rejects(configureWebhookSecret(fixture, {
    withToken: task => task('fixture-management-auth'),
    request: async () => {
      calls++;
      return Response.json(configured().map(item => item.name === 'MERCADOPAGO_ENVIRONMENT' ? {...item, value: hash('production')} : item));
    },
  }), /No se modifico nada/);
  assert.equal(calls, 1);
});
test('webhook setup refuses a truncated signature before obtaining management credentials', async () => {
  await assert.rejects(configureWebhookSecret('abc1234...', {
    withToken: () => assert.fail('must not read credentials'),
  }), /No se modifico staging/);
});
