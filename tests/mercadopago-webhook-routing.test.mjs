import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSellerWebhookBusiness } from '../supabase/functions/_shared/seller-webhook-routing.ts';

const input = {signatureValid: true, eventType: 'payment', resourceId: '987', sellerId: 123, applicationId: '456', environment: 'test'};
function scenario(overrides = {}) {
  const calls = [];
  return {calls, dependencies: {
    connectionForSeller: async sellerId => {
      calls.push(['connection', sellerId]);
      return {business_id: 'business-a', seller_id: '123', application_id: '456', environment: 'test', status: 'connected', ...overrides.connection};
    },
    paymentForBusiness: async (paymentId, businessId) => {
      calls.push(['provider', paymentId, businessId]);
      return {id: 987, collector_id: 123, live_mode: false, external_reference: 'server-reference', ...overrides.payment};
    },
    intentForReference: async reference => {
      calls.push(['intent', reference]);
      return {business_id: 'business-a', environment: 'test', ...overrides.intent};
    },
  }};
}
test('seller webhook resolves the stored business through a verified provider payment', async () => {
  const {dependencies, calls} = scenario();
  assert.equal(await resolveSellerWebhookBusiness(input, dependencies), 'business-a');
  assert.deepEqual(calls, [['connection', '123'], ['provider', '987', 'business-a'], ['intent', 'server-reference']]);
});
test('distinct sellers route to distinct businesses without URL parameters', async () => {
  const {dependencies} = scenario({connection: {seller_id: '321', business_id: 'business-b'}, payment: {collector_id: 321}, intent: {business_id: 'business-b'}});
  assert.equal(await resolveSellerWebhookBusiness({...input, sellerId: 321, business_id: 'attacker-business'}, dependencies), 'business-b');
});
for (const invalid of [{signatureValid: false}, {eventType: 'merchant_order'}, {resourceId: 'https://invalid'}, {sellerId: null}]) {
  test('rejects invalid routing input before any lookup: '+JSON.stringify(invalid), async () => {
    const {dependencies, calls} = scenario();
    await assert.rejects(resolveSellerWebhookBusiness({...input, ...invalid}, dependencies));
    assert.equal(calls.length, 0);
  });
}
for (const connection of [{status: 'disconnected'}, {environment: 'production'}, {application_id: 'other-app'}, {seller_id: '999'}]) {
  test('rejects an incompatible OAuth connection: '+JSON.stringify(connection), async () => {
    const {dependencies, calls} = scenario({connection});
    await assert.rejects(resolveSellerWebhookBusiness(input, dependencies));
    assert.equal(calls.length, 1);
  });
}
for (const payment of [{id: 999}, {collector_id: 999}, {live_mode: true}, {external_reference: ''}]) {
  test('rejects spoofed seller or mismatched provider payment: '+JSON.stringify(payment), async () => {
    const {dependencies, calls} = scenario({payment});
    await assert.rejects(resolveSellerWebhookBusiness(input, dependencies));
    assert.equal(calls.length, 2);
  });
}
for (const intent of [{business_id: 'business-b'}, {environment: 'production'}]) {
  test('rejects payment references crossing businesses or environments: '+JSON.stringify(intent), async () => {
    const {dependencies} = scenario({intent});
    await assert.rejects(resolveSellerWebhookBusiness(input, dependencies));
  });
}
test('provider failures propagate and cannot produce a routed receipt', async () => {
  const {dependencies} = scenario();
  dependencies.paymentForBusiness = async () => { throw new Error('provider unavailable'); };
  await assert.rejects(resolveSellerWebhookBusiness(input, dependencies), /provider unavailable/);
});
