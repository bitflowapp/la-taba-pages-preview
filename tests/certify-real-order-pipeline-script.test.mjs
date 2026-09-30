import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../scripts/certify-real-order-pipeline.mjs', import.meta.url), 'utf8');
const circuit = readFileSync(new URL('../scripts/certify-order-operational-circuit.mjs', import.meta.url), 'utf8');
const resources = readFileSync(new URL('../scripts/lib/staging-certification-resources.mjs', import.meta.url), 'utf8');

test('certification rejects unsafe targets before constructing a privileged client', () => {
  for (const script of [source, circuit]) {
    assert.ok(script.indexOf('assertStagingCertificationTarget(certificationTarget)')
      < script.indexOf('const service = boundedCertificationClient('));
    assert.ok(script.includes('await verifyStagingCertificationIdentity(service, certificationTarget)'));
    assert.ok(!script.includes('process.exit('));
  }
});

test('explicit fixtures are verified before actors and catalog data is never published', () => {
  assert.ok(source.indexOf('await verifyCertificationFixtures(') < source.indexOf("await createActor('customer')"));
  assert.ok(source.includes('TABA_CERTIFY_OPERATIONAL_PRODUCT_ID'));
  assert.ok(source.includes('TABA_CERTIFY_ISOLATION_PRODUCT_ID'));
  assert.doesNotMatch(source, /[.]from[(]'products'[)][\s\S]{0,120}[.](insert|update|upsert)[(]/);
  assert.doesNotMatch(source, /LT-00(?:30|33|34|35)/);
});

test('both scripts use the shared session and checked cleanup lifecycle', () => {
  for (const script of [source, circuit]) {
    assert.ok(script.includes('return createCertificationActor('));
    assert.match(script, /await (cleanup|limpieza)[.]run[(][)]/);
  }
  assert.ok(resources.includes('identity_register_session'));
  assert.ok(resources.includes('identity_close_own_session'));
});

test('the pipeline checks GPS receipts and the public tracking DTO', () => {
  assert.ok(source.includes("gpsReceipt?.ok === true && gpsReceipt?.code === 'accepted'"));
  assert.ok(source.includes("throttledReceipt?.ok === false && throttledReceipt?.code === 'throttled'"));
  assert.ok(source.includes("location_quality === 'valid'"));
  assert.ok(source.includes('terminal_visible_until'));
});

test('only the run checkout is released and external certification is never implied', () => {
  assert.ok(source.includes('await releaseCertificationCheckout('));
  assert.doesNotMatch(source, /[.]rpc[(]'(sweep_expired_checkout_sessions|expire_checkout_sessions|list_stock_reservation_alerts|list_unfinalized_paid_checkouts)'/);
  assert.ok(source.includes('GLOBAL_EXPIRY_CRON_CERTIFICATION NOT_EXERCISED'));
  assert.ok(source.includes('PAYMENT_PROVIDER_CERTIFICATION NOT_EXERCISED'));
  assert.ok(source.includes('PREEXISTING_QA_ORDER_BASELINE NOT_EXERCISED:EMPTY'));
});

test('the circuit validates an existing customer session without rotating credentials', () => {
  assert.ok(circuit.includes('TABA_CERTIFY_CUSTOMER_ACCESS_TOKEN'));
  assert.ok(circuit.includes('await verifyCertificationCustomer(customer, customerToken, pedido.customer_user_id)'));
  assert.doesNotMatch(circuit, /updateUserById|email_confirm|signInWithPassword/);
});
