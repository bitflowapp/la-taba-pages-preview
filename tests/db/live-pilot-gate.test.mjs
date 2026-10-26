// Closed-pilot gate (20261027010000): real-money payments are limited to ONE written, exact purchase until the business
// is deliberately opened to the public. The gate lives in the database, inside the checkout-session transaction, so a
// rejected purchase also gives its stock back and no Edge Function or storefront bug can bypass it.
//
// The fixture business is a test-environment business; the lock is switched on with set_live_payment_scope(..., 'pilot')
// (production is locked by default, which the first test proves on the production environment itself).
import test from 'node:test';
import assert from 'node:assert/strict';
import { psqlRaw, psqlAsync } from '../../scripts/local-db/lib.mjs';
import { runScenario, committedFixtureSql, EXPIRE, FIXTURE_IDS } from './harness.mjs';

const SELLER = '400000001';
const OTHER_CUSTOMER = '10000000-0000-4000-8000-0000000000fb';

// A business whose seller is connected, in closed-pilot mode, with the fixture's own checkout released.
const setup = (environment = 'test') => `${EXPIRE}
  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('${OTHER_CUSTOMER}', 'authenticated', 'authenticated', 'otro-comprador@example.invalid', '', '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());
  update public.business_payment_settings set collector_id='${SELLER}', application_id='7677852968049976'${environment === 'production' ? ", environment='production', production_review_status='approved'" : ''} where business_id=v_business;
  insert into public.mp_seller_connections(business_id, environment, seller_id, application_id, status, protected_tokens, expires_at, connected_at)
  values (v_business, '${environment}', '${SELLER}', '7677852968049976', 'connected', 'sealed-fixture', clock_timestamp()+interval '2 days', clock_timestamp());
  ${environment === 'test' ? "perform public.set_live_payment_scope(v_business, 'test', 'pilot', 'gate test');" : ''}`;

const authorize = ({ environment = 'test', customer = 'v_user', qty = 2, amount = 2500, seller = SELLER, buyer = 'comprador-prueba@example.invalid', minutes = 60, into = 'v_extra' } = {}) =>
  `begin ${into} := public.authorize_live_pilot_payment(v_business, '${environment}', ${customer},
     jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', ${qty})), ${amount},
     'Prueba de cobro controlada', '${seller}', 'Titular de prueba', '${buyer}', 'seller', 'seller_panel',
     'Abortar si el importe mostrado no coincide o si el pago va a otra cuenta', 'Responsable de prueba', repeat('a', 64), ${minutes});
   exception when others then ${into} := jsonb_build_object('rejected', true, 'state', sqlstate, 'message', sqlerrm); end;`;

// One purchase attempt; its outcome is appended to v_before as {ok|message}.
const buy = (tag, { customer = 'v_user', qty = 2 } = {}) => `begin
  v_result := public.create_checkout_session(${customer}, jsonb_build_object('business_id', v_business,
    'client_request_id', 'pilotgate${tag}00001',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', ${qty})),
    'fulfillment_type', 'pickup', 'contact', jsonb_build_object('name', 'Cliente Piloto', 'phone', '5491100000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'));
  v_extra2 := jsonb_build_object('tag', '${tag}', 'ok', true, 'session', v_result->>'checkout_session_id');
exception when others then v_extra2 := jsonb_build_object('tag', '${tag}', 'ok', false, 'message', sqlerrm, 'state', sqlstate); end;
v_before := coalesce(v_before, '[]'::jsonb) || jsonb_build_array(v_extra2);`;

// Cambiar el precio quita la verificación y la disponibilidad del producto; se restituyen por separado, como lo haría el catálogo.
const setPrice = price => `update public.products set price = ${price} where id = v_product;
  update public.products set is_verified = true, verified_at = clock_timestamp(), verified_by = v_user, available = true where id = v_product;`;
const auths = `(select coalesce(jsonb_agg(jsonb_build_object('status', status, 'consumed_by', consumed_by_intent_id is not null) order by created_at), '[]'::jsonb)
                   from public.payment_live_pilot_authorizations where business_id = v_business)`;
const stockNow = '(select stock from public.products where id = v_product)';

test('production is closed by default: with no authorization nothing can be bought and the stock stays whole', () => {
  const s = runScenario(`${setup('production')}
    ${buy('prod')} v_extra := jsonb_build_object('stock', ${stockNow}, 'sessions', (select count(*) from public.checkout_sessions where business_id = v_business and status = 'ready_for_payment'),
      'status', public.get_live_pilot_status(v_business, 'production'));`);
  assert.equal(s.before[0].ok, false);
  assert.match(s.before[0].message, /LIVE_PILOT_NOT_AUTHORIZED/);
  assert.equal(s.extra.sessions, 0, 'the rejected checkout left a session behind');
  assert.equal(s.extra.stock, 10, 'the rejected checkout kept its reservation');
  assert.equal(s.extra.status.pilot_lock_applies, true);
  assert.equal(s.extra.status.scope, 'pilot (default)');
});

test('the exact authorized purchase goes through once and consumes the authorization; a second purchase is refused', () => {
  const s = runScenario(`${setup()} ${authorize()}
    ${buy('one')} ${buy('two')}
    v_extra2 := jsonb_build_object('auths', ${auths}, 'stock', ${stockNow});`);
  assert.equal(s.extra.status, 'authorized');
  assert.equal(s.before[0].ok, true, JSON.stringify(s.before[0]));
  assert.equal(s.before[1].ok, false);
  assert.match(s.before[1].message, /LIVE_PILOT_NOT_AUTHORIZED/);
  assert.deepEqual(s.extra2.auths, [{ status: 'consumed', consumed_by: true }]);
  assert.equal(s.extra2.stock, 8, 'exactly one purchase reserved stock');
});

test('every deviation from the written authorization is refused and leaves it open', () => {
  const s = runScenario(`${setup()} ${authorize()}
    ${buy('cust', { customer: `'${OTHER_CUSTOMER}'` })}
    ${buy('qty1', { qty: 1 })}
    ${setPrice(2500)}
    ${buy('items', { qty: 1 })}
    ${setPrice(1250)}
    update public.business_payment_settings set collector_id = '400000002' where business_id = v_business;
    ${buy('seller')}
    update public.business_payment_settings set collector_id = '${SELLER}' where business_id = v_business;
    v_extra2 := jsonb_build_object('auths', ${auths}, 'stock', ${stockNow}, 'sessions', (select count(*) from public.checkout_sessions where business_id = v_business and status = 'ready_for_payment'));`);
  const by = Object.fromEntries(s.before.map(x => [x.tag, x]));
  assert.match(by.cust.message, /LIVE_PILOT_CUSTOMER_NOT_AUTHORIZED/);
  assert.match(by.qty1.message, /LIVE_PILOT_AMOUNT_MISMATCH/);
  assert.match(by.items.message, /LIVE_PILOT_ITEMS_MISMATCH/, 'same total, different items');
  assert.match(by.seller.message, /LIVE_PILOT_SELLER_MISMATCH/);
  assert.deepEqual(s.extra2.auths, [{ status: 'authorized', consumed_by: false }], 'a refused purchase must not consume the authorization');
  assert.equal(s.extra2.stock, 10);
  assert.equal(s.extra2.sessions, 0);
});

test('an expired authorization buys nothing', () => {
  const s = runScenario(`${setup()} ${authorize()}
    set local session_replication_role = replica;
    update public.payment_live_pilot_authorizations set created_at = created_at - interval '2 hours', expires_at = clock_timestamp() - interval '1 minute' where business_id = v_business;
    set local session_replication_role = origin;
    ${buy('late')} v_extra2 := jsonb_build_object('status', public.get_live_pilot_status(v_business, 'test'));`);
  assert.match(s.before[0].message, /LIVE_PILOT_AUTHORIZATION_EXPIRED/);
  assert.equal(s.extra2.status.authorizations[0].status, 'expired', 'the status view must not show a lapsed authorization as open');
});

test('authorizing validates the terms against the live catalog and the connected seller', () => {
  const s = runScenario(`${setup()}
    ${authorize({ amount: 1000, into: 'v_extra' })}
    ${authorize({ seller: '400000002', into: 'v_extra2' })}
    v_before := jsonb_build_array(v_extra, v_extra2);
    ${authorize({ buyer: SELLER, into: 'v_extra' })}
    v_before := v_before || jsonb_build_array(v_extra);
    ${authorize({ qty: 11, amount: 13750, into: 'v_extra' })}
    v_before := v_before || jsonb_build_array(v_extra);
    ${authorize({ minutes: 1441, into: 'v_extra' })}
    v_before := v_before || jsonb_build_array(v_extra);
    ${authorize({ amount: 60000, qty: 48, into: 'v_extra' })}
    v_before := v_before || jsonb_build_array(v_extra);
    update public.products set stock = 1 where id = v_product;
    ${authorize({ into: 'v_extra' })}
    v_before := v_before || jsonb_build_array(v_extra);
    v_extra2 := jsonb_build_object('count', (select count(*) from public.payment_live_pilot_authorizations));`);
  assert.equal(s.before.length, 7);
  for (const outcome of s.before) assert.equal(outcome.rejected, true, JSON.stringify(outcome));
  assert.match(s.before[0].message, /not the live catalog total/);
  assert.match(s.before[1].message, /seller account is not the one connected/);
  assert.match(s.before[2].message, /payment_live_pilot_buyer_not_seller_check/);
  assert.equal(s.extra2.count, 0, 'a rejected authorization left a row');
});

test('only one authorization can be open for a business, and an authorization needs no checkout in flight', () => {
  const s = runScenario(`${setup()} ${authorize({ into: 'v_extra' })}
    ${authorize({ into: 'v_extra2' })} v_before := jsonb_build_array(v_extra2);`);
  assert.ok(s.extra.authorization_id);
  assert.equal(s.before[0].rejected, true);
  assert.match(s.before[0].message, /payment_live_pilot_one_open_idx/);
  const inFlight = runScenario(`update public.business_payment_settings set collector_id='${SELLER}', application_id='7677852968049976' where business_id=v_business;
    insert into public.mp_seller_connections(business_id, environment, seller_id, application_id, status, protected_tokens, expires_at, connected_at)
    values (v_business, 'test', '${SELLER}', '7677852968049976', 'connected', 'sealed-fixture', clock_timestamp()+interval '2 days', clock_timestamp());
    perform public.set_live_payment_scope(v_business, 'test', 'pilot', 'gate test');
    ${authorize()}`);
  assert.equal(inFlight.extra.rejected, true, 'the fixture checkout is still in flight');
  assert.match(inFlight.extra.message, /checkout in flight/);
});

test('aborting closes the door; a consumed authorization is the record of a purchase and cannot be aborted', () => {
  const s = runScenario(`${setup()} ${authorize()}
    v_extra := public.abort_live_pilot_payment((v_extra->>'authorization_id')::uuid, 'se cambió el plan de prueba');
    ${buy('aborted')}
    ${authorize({ into: 'v_pay' })}
    ${buy('ok')}
    begin perform public.abort_live_pilot_payment((v_pay->>'authorization_id')::uuid, 'ya se usó'); v_extra2 := jsonb_build_object('tag', 'abort-consumed', 'aborted', true);
    exception when others then v_extra2 := jsonb_build_object('tag', 'abort-consumed', 'aborted', false, 'message', sqlerrm); end;
    v_before := v_before || jsonb_build_array(v_extra2);`);
  assert.equal(s.extra.status, 'aborted');
  assert.match(s.before[0].message, /LIVE_PILOT_NOT_AUTHORIZED/);
  assert.equal(s.before[1].ok, true);
  assert.equal(s.before[2].aborted, false);
  assert.match(s.before[2].message, /consumed/);
});

test('an authorization is append-only: its terms never change and it is never deleted or truncated', () => {
  const attempt = sql => `begin ${sql} v_pay := coalesce(v_pay, '[]'::jsonb) || jsonb_build_array('changed');
    exception when others then v_pay := coalesce(v_pay, '[]'::jsonb) || jsonb_build_array(sqlstate); end;`;
  const s = runScenario(`${setup()} ${authorize()}
    ${attempt("update public.payment_live_pilot_authorizations set amount = 1 where business_id = v_business;")}
    ${attempt("update public.payment_live_pilot_authorizations set customer_id = '" + OTHER_CUSTOMER + "' where business_id = v_business;")}
    ${attempt("delete from public.payment_live_pilot_authorizations where business_id = v_business;")}
    ${attempt("truncate public.payment_live_pilot_authorizations;")}
    ${attempt("update public.payment_live_scope_log set changed_by = 'someone else';")}
    ${attempt("delete from public.payment_live_scope_log;")}
    update public.payment_live_pilot_authorizations set status = 'aborted', aborted_at = clock_timestamp() where business_id = v_business;
    ${attempt("update public.payment_live_pilot_authorizations set status = 'authorized', aborted_at = null where business_id = v_business;")}
    v_extra2 := v_pay;`);
  assert.deepEqual(s.extra2, ['42501', '42501', '42501', '42501', '42501', '42501', '55000']);
});

test('opening to the public needs the typed confirmation, is logged, and can be undone without one', () => {
  const s = runScenario(`${setup()}
    begin perform public.set_live_payment_scope(v_business, 'test', 'public', 'operator'); v_extra := jsonb_build_object('opened', true);
    exception when others then v_extra := jsonb_build_object('opened', false, 'message', sqlerrm); end;
    ${buy('closed')}
    perform public.set_live_payment_scope(v_business, 'test', 'public', 'operator', 'I_AUTHORIZE_PUBLIC_REAL_PAYMENTS');
    ${buy('open')}
    perform public.set_live_payment_scope(v_business, 'test', 'pilot', 'operator');
    ${buy('closed-again')}
    v_extra2 := jsonb_build_object('log', (select jsonb_agg(scope order by id) from public.payment_live_scope_log where business_id = v_business));`);
  assert.equal(s.extra.opened, false);
  assert.deepEqual(s.before.map(x => x.ok), [false, true, false]);
  assert.deepEqual(s.extra2.log, ['pilot', 'public', 'pilot']);
});

test('only the service role can read or run any of it', () => {
  const rows = psqlRaw(process.env.TABA_LOCAL_DB || 'taba_local_base', `select r.rolname,
      (select string_agg(p, ',' order by p) from unnest(array[
        'public.live_pilot_applies(uuid,text)', 'public.authorize_live_pilot_payment(uuid,text,uuid,jsonb,numeric,text,text,text,text,text,text,text,text,text,integer)',
        'public.abort_live_pilot_payment(uuid,text)', 'public.set_live_payment_scope(uuid,text,text,text,text)', 'public.get_live_pilot_status(uuid,text)',
        'public.enforce_live_pilot_payment_intent()']) p where has_function_privilege(r.rolname, p, 'EXECUTE')) as can_run,
      (select string_agg(t, ',' order by t) from unnest(array['payment_live_scope', 'payment_live_scope_log', 'payment_live_pilot_authorizations']) t
        where has_table_privilege(r.rolname, 'public.' || t, 'SELECT') or has_table_privilege(r.rolname, 'public.' || t, 'INSERT')
           or has_table_privilege(r.rolname, 'public.' || t, 'UPDATE') or has_table_privilege(r.rolname, 'public.' || t, 'DELETE')) as can_touch
    from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role') order by 1`, { tuples: true }).stdout.trim().split('\n').map(l => l.split('|'));
  const by = Object.fromEntries(rows.map(([role, run, touch]) => [role, { run: run || null, touch: touch || null }]));
  assert.deepEqual(by.anon, { run: null, touch: null });
  assert.deepEqual(by.authenticated, { run: null, touch: null });
  assert.equal(by.service_role.touch, 'payment_live_pilot_authorizations,payment_live_scope,payment_live_scope_log');
  assert.ok(!by.service_role.run.includes('enforce_live_pilot_payment_intent'), 'the trigger function is not callable');
  assert.ok(by.service_role.run.includes('authorize_live_pilot_payment'));
  const writes = psqlRaw(process.env.TABA_LOCAL_DB || 'taba_local_base', `select has_table_privilege('service_role', 'public.payment_live_pilot_authorizations', 'INSERT')::text`, { tuples: true }).stdout.trim();
  assert.match(writes, /^(f|false)$/, 'even the service role writes only through the functions');
});

test('eight sessions racing for one authorization: exactly one purchase is created, the rest are refused and give the stock back', async () => {
  const template = process.env.TABA_LOCAL_DB;
  assert.match(template, /^taba_local_[a-z0-9_]+$/);
  const db = `taba_local_pilot_gate_${process.pid}`;
  psqlRaw('postgres', `create database ${db} template ${template}`);
  try {
    // Commit the fixture business, release its own checkout, connect the seller, lock it and write the authorization.
    psqlRaw(db, committedFixtureSql());
    psqlRaw(db, `update public.checkout_sessions set created_at = now() - interval '2 hours', expires_at = now() - interval '1 second' where business_id='${FIXTURE_IDS.business}';
      update public.inventory_reservations set created_at = now() - interval '2 hours', expires_at = now() - interval '1 second' where status = 'active';
      select public.sweep_expired_checkout_sessions();
      update public.business_payment_settings set collector_id='${SELLER}', application_id='7677852968049976' where business_id='${FIXTURE_IDS.business}';
      insert into public.mp_seller_connections(business_id, environment, seller_id, application_id, status, protected_tokens, expires_at, connected_at)
      values ('${FIXTURE_IDS.business}', 'test', '${SELLER}', '7677852968049976', 'connected', 'sealed-fixture', clock_timestamp()+interval '2 days', clock_timestamp());
      select public.set_live_payment_scope('${FIXTURE_IDS.business}', 'test', 'pilot', 'race test');
      select public.authorize_live_pilot_payment('${FIXTURE_IDS.business}', 'test', '${FIXTURE_IDS.user}',
        jsonb_build_array(jsonb_build_object('product_id', '${FIXTURE_IDS.product}', 'quantity', 2)), 2500,
        'Prueba de cobro controlada', '${SELLER}', 'Titular de prueba', 'comprador-prueba@example.invalid', 'seller', 'seller_panel',
        'Abortar si el importe mostrado no coincide o si el pago va a otra cuenta', 'Responsable de prueba', repeat('a', 64), 60);`);
    const sql = n => `select (public.create_checkout_session('${FIXTURE_IDS.user}', jsonb_build_object('business_id','${FIXTURE_IDS.business}',
      'client_request_id','pilotrace${n}000001','items',jsonb_build_array(jsonb_build_object('product_id','${FIXTURE_IDS.product}','quantity',2)),
      'fulfillment_type','pickup','contact',jsonb_build_object('name','Cliente Piloto','phone','5491100000000'),'address','{}'::jsonb,
      'age_confirmed',false,'payment_method','mercadopago')))->>'checkout_session_id'`;
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => psqlAsync(db, sql(i))));
    const created = results.filter(r => r.status === 0).length;
    const refused = results.filter(r => r.status !== 0 && /LIVE_PILOT_NOT_AUTHORIZED/.test(String(r.stderr))).length;
    assert.equal(created, 1, JSON.stringify(results.map(r => [r.status, String(r.stderr).slice(0, 160)])));
    assert.equal(refused, 7);
    const state = JSON.parse(psqlRaw(db, `select jsonb_build_object(
      'intents', (select count(*) from public.payment_intents where business_id='${FIXTURE_IDS.business}' and checkout_session_id in
                  (select id from public.checkout_sessions where client_request_id like 'pilotrace%')),
      'consumed', (select count(*) from public.payment_live_pilot_authorizations where status='consumed'),
      'stock', (select stock from public.products where id='${FIXTURE_IDS.product}'))`, { tuples: true }).stdout.trim());
    assert.deepEqual(state, { intents: 1, consumed: 1, stock: 8 });
  } finally { psqlRaw('postgres', `drop database ${db} with (force)`); }
});
