import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { deliveryRestorable, expectedVerificationRefusal } from '../scripts/controlled-production/delivery-restorable.mjs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const zones = (status) => ({ configuration: [{ code: 'OWNER', status: 'CONFIGURED' }, { code: 'DELIVERY_ZONES', status }] });

test('a verified QA business with delivery on and no coverage cannot get its delivery back', () => {
  assert.deepEqual(deliveryRestorable({ delivery_enabled: true, ordering_verified: true }, zones('MISSING')),
    { ok: false, reason: 'DELIVERY_COVERAGE' });
  assert.deepEqual(deliveryRestorable({ delivery_enabled: true, ordering_verified: true }, zones('CONFIGURED')),
    { ok: true, reason: 'coverage_ready' });
});

test('nothing to restore, an unverified business and an older backend are safe to toggle', () => {
  assert.equal(deliveryRestorable({ delivery_enabled: false, ordering_verified: true }, zones('MISSING')).reason, 'delivery_was_off');
  assert.equal(deliveryRestorable({ delivery_enabled: true, ordering_verified: false }, zones('MISSING')).reason, 'not_verified');
  // A backend without the rule does not answer `configuration`.
  assert.equal(deliveryRestorable({ delivery_enabled: true, ordering_verified: true }, { items: [] }).reason, 'backend_without_rule');
  // The order certification reads the row without knowing whether it is verified: it is treated as verified.
  assert.equal(deliveryRestorable({ delivery_enabled: true }, zones('MISSING')).ok, false);
});

test('the expected refusal is the list the backend announces, or the old derivation without it', () => {
  const pending = ['CATALOG_PUBLISHED', 'PLATFORM_VERIFICATION'];
  assert.deepEqual(expectedVerificationRefusal({ verification_blockers: ['BUSINESS_OWNER', 'SERVICE_HOURS', 'CATALOG_PUBLISHED'] }, pending),
    ['BUSINESS_OWNER', 'SERVICE_HOURS', 'CATALOG_PUBLISHED']);
  assert.deepEqual(expectedVerificationRefusal({}, pending), ['CATALOG_PUBLISHED']);
});

test('both certifications decide before they switch the QA delivery off', () => {
  for (const file of ['opening-cert.mjs', 'opening-orders-cert.mjs']) {
    const source = read(`../scripts/controlled-production/${file}`);
    const guard = source.indexOf('QA_DELIVERY_NOT_RESTORABLE');
    const firstOff = source.indexOf('p_delivery_enabled: false');
    assert.ok(guard > 0 && firstOff > guard, `${file}: the guard comes before the first switch-off`);
  }
  assert.match(read('../scripts/controlled-production/opening-cert.mjs'),
    /premature\.error\?\.details === expectedVerificationRefusal\(real\.data, realPending\)\.join\(','\)/);
});

test('the migration refuses with the code the Panel already shows as a message, and names the gate', () => {
  const sql = read('../supabase/migrations/20261001216000_verified_business_delivery_needs_coverage.sql');
  assert.match(sql, /errcode = '22023'/);
  assert.match(sql, /detail = 'DELIVERY_COVERAGE: '/);
  assert.match(sql, /when \(new\.ordering_verified and new\.delivery_enabled and old\.delivery_enabled is not true\)/);
});
