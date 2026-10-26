// Independent review of PR #157: the preference dispatch claim.
//
// The claim elects ONE dispatcher per attempt before any provider POST. These tests attack what the claim must NOT do
// (hand out a second dispatch, move an attempt it does not own, change state when it refuses) and pin the buyer's way out
// of an attempt whose dispatcher died after the claim: the checkout expires with its reservation (15 minutes) and a new
// checkout can be started for the same cart. Nothing here unlocks an uncertain POST automatically.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, EXPIRE, LAPSE } from './harness.mjs';

const cartJson = id => `jsonb_build_object('business_id',v_business,'client_request_id','${id}','items',jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',2)),'fulfillment_type','pickup','contact',jsonb_build_object('name','Synthetic audit','phone','5491100000000'),'address','{}'::jsonb,'age_confirmed',false,'payment_method','mercadopago')`;
// v_extra = {attempt, authority}; claim(...) is the RPC under test.
const prime = `v_extra := jsonb_build_object('attempt', v_prepare->>'payment_attempt_id',
  'authority', public.get_mercadopago_payment_authority_v2((select business_id from public.payment_intents where id=v_intent),(select environment from public.payment_intents where id=v_intent), v_session, v_user, (v_prepare->>'payment_attempt_id')::uuid)->>'authority_version');`;
const claim = (customer = 'v_user', authority = `v_extra->>'authority'`) =>
  `public.claim_mercadopago_preference_dispatch((v_extra->>'attempt')::uuid, ${customer}, ${authority})`;
const attemptState = `jsonb_build_object('status',(select status from public.payment_attempts where id=(v_extra->>'attempt')::uuid),
  'revision',(select authority_revision from public.payment_attempts where id=(v_extra->>'attempt')::uuid))`;
const attempt = (sql, into = 'v_before') => `begin ${sql} ${into}:=${into}||jsonb_build_object('accepted',true); exception when others then ${into}:=${into}||jsonb_build_object('accepted',false,'code',SQLSTATE); end;`;
const fresh = body => runScenario(`${prime} ${body}`, { fresh: true });

test('exactly one caller owns the dispatch; the owner moves the attempt to request_sent and everyone else is refused', () => {
  const s = fresh(`v_before := jsonb_build_object('first', ${claim()} is not null);
    v_before := v_before || jsonb_build_object('second', ${claim()} is not null, 'third', ${claim()} is not null, 'state', ${attemptState});`);
  assert.equal(s.before.first, true);
  assert.equal(s.before.second, false);
  assert.equal(s.before.third, false);
  assert.equal(s.before.state.status, 'request_sent');
});

for (const [label, customer, authority, code] of [
  ['another customer', `'00000000-0000-4000-8000-00000000beef'::uuid`, undefined, '42501'],
  ['a stale authority version', undefined, `'stale-authority'`, '55000'],
]) {
  test(`a claim by ${label} is refused and leaves the attempt claimable by its rightful owner`, () => {
    const s = fresh(`v_before := jsonb_build_object('state0', ${attemptState});
      ${attempt(`perform ${claim(customer, authority)};`)}
      v_before := v_before || jsonb_build_object('state1', ${attemptState}, 'owner_can_claim', ${claim()} is not null);`);
    assert.equal(s.before.accepted, false);
    assert.equal(s.before.code, code);
    assert.deepEqual(s.before.state1, s.before.state0, 'a refused claim changed the attempt');
    assert.equal(s.before.owner_can_claim, true);
  });
}

test('an attempt that is not prepared (ambiguous, created, failed) is never claimed, whatever its authority says', () => {
  const s = fresh(`v_before := '{}'::jsonb;
    update public.payment_attempts set status='ambiguous' where id=(v_extra->>'attempt')::uuid;
    v_before := v_before || jsonb_build_object('ambiguous', ${claim()} is not null);
    update public.payment_attempts set status='failed' where id=(v_extra->>'attempt')::uuid;
    v_before := v_before || jsonb_build_object('failed', ${claim()} is not null, 'state', ${attemptState});`);
  assert.equal(s.before.ambiguous, false, 'an uncertain POST was re-opened for dispatch');
  assert.equal(s.before.failed, false);
  assert.equal(s.before.state.status, 'failed');
});

test('a checkout whose window lapsed but was not swept yet cannot be claimed', () => {
  const s = fresh(`${LAPSE} v_before := '{}'::jsonb;
    ${attempt(`perform ${claim()};`)}
    v_before := v_before || jsonb_build_object('state', ${attemptState});`);
  assert.equal(s.before.accepted, false);
  assert.equal(s.before.state.status, 'prepared', 'a refused claim must not leave the attempt claimed');
});

test('a dispatcher that dies after the claim never traps the buyer: the checkout expires and a new one is allowed', () => {
  const s = fresh(`v_before := jsonb_build_object('claimed', ${claim()} is not null);
    -- the buyer retries the SAME checkout: still the same attempt, still not dispatchable
    v_extra2 := public.prepare_mercadopago_preference_v2(v_session, v_user, false);
    v_before := v_before || jsonb_build_object('retry_status', v_extra2->>'attempt_status', 'retry_same_attempt', v_extra2->>'payment_attempt_id' = v_extra->>'attempt');
    ${attempt(`perform public.prepare_mercadopago_preference_v2(v_session, v_user, true);`, 'v_before')}
    v_before := v_before || jsonb_build_object('new_attempt_while_claimed_refused', not (v_before->>'accepted')::boolean);
    ${EXPIRE}
    v_before := v_before || jsonb_build_object('intent_after_expiry', (select internal_status from public.payment_intents where id=v_intent),
      'stock_after_expiry', (select stock from public.products where id=v_product));
    -- the buyer starts over with the same cart
    v_result := public.create_checkout_session(v_user, ${cartJson('reviewretry0000001')});
    v_before := v_before || jsonb_build_object('new_checkout', v_result->>'checkout_session_id' is not null and v_result->>'checkout_session_id' <> v_session::text);`);
  assert.equal(s.before.claimed, true);
  assert.equal(s.before.retry_status, 'request_sent');
  assert.equal(s.before.retry_same_attempt, true, 'a retry must never mint a second attempt for the same checkout');
  assert.equal(s.before.new_attempt_while_claimed_refused, true, 'a new attempt while the first may have been sent would allow two charges');
  assert.equal(s.before.intent_after_expiry, 'expired');
  assert.equal(s.before.new_checkout, true, 'after the 15 minute reservation the buyer can start a new checkout');
});
