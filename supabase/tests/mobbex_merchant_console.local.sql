-- Mobbex merchant console: contract of 20261105010000_mobbex_merchant_console.sql against the REAL schema.
-- The runner (scripts/mobbex/run-mobbex-db-tests.mjs) prepends the helpers of mobbex_ledger.local.sql
-- (pg_temp.check / raises / as_user / as_service / as_admin / make_tenant / new_checkout / snap / intent_of),
-- applies the Mobbex migrations in order, runs this inside a transaction and rolls everything back.

select pg_temp.as_admin();

do $$
declare
  t jsonb; t2 jsonb; c jsonb; s uuid; i uuid; i2 uuid; r jsonb; ref text; row jsonb; rows_count integer;
  v_biz uuid; v_biz2 uuid; v_owner uuid; v_owner2 uuid; v_staff uuid;
begin
  t := pg_temp.make_tenant('m1', 20);
  t2 := pg_temp.make_tenant('m2', 20);
  v_biz := (t ->> 'business')::uuid; v_biz2 := (t2 ->> 'business')::uuid;
  v_owner := (t ->> 'owner')::uuid; v_owner2 := (t2 ->> 'owner')::uuid;
  perform public.configure_mobbex_business(v_biz, true, 'test', 'not_requested', null, 'qa-runner');
  perform public.configure_mobbex_business(v_biz2, true, 'test', 'not_requested', null, 'qa-runner');

  -- ═══ 0. Nobody but the signed-in members of THAT business can read ═══
  perform pg_temp.check(not exists (select 1 from information_schema.role_routine_grants
      where routine_name in ('mobbex_list_business_payments', 'mobbex_request_business_reconcile') and grantee in ('anon', 'PUBLIC')),
    'neither console function is callable by anon or PUBLIC');
  perform pg_temp.as_admin();
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.raises(format($q$select * from public.mobbex_list_business_payments(%L)$q$, v_biz), 'no autorizados', 'no session: the list is refused');

  -- A paid, completed order (2 x 1250) in business 1 and a pending checkout in business 2.
  perform pg_temp.as_admin();
  c := pg_temp.new_checkout(t, 2, 'mbxconsole00001');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s); ref := c ->> 'reference';
  perform public.mobbex_prepare_checkout(s, (t ->> 'buyer')::uuid);
  perform public.mobbex_record_checkout_created(i, 'CHK:CONSOLE1', 'https://mobbex.com/p/checkout/v2/CHK:CONSOLE1', repeat('a', 64));
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'approved', '200', 'OP-CONSOLE-1', '2500.00', 0, '1'), 'webhook');
  perform pg_temp.check((r ->> 'finalized')::boolean, 'fixture: a paid order exists');
  c := pg_temp.new_checkout(t2, 1, 'mbxconsole00002');
  i2 := pg_temp.intent_of((c ->> 'checkout_session_id')::uuid);

  -- ═══ 1. Isolation between businesses ═══
  perform pg_temp.as_user(v_owner);
  select count(*) into rows_count from public.mobbex_list_business_payments(v_biz);
  perform pg_temp.check(rows_count = 1, 'the owner sees the payments of their business');
  perform pg_temp.check(not exists (select 1 from public.mobbex_list_business_payments(v_biz) x where (x ->> 'payment_intent_id')::uuid = i2),
    'the owner never sees another business''s payment');
  perform pg_temp.raises(format($q$select * from public.mobbex_list_business_payments(%L)$q$, v_biz2), 'no autorizados', 'an owner cannot list another business');
  perform pg_temp.raises(format($q$select public.mobbex_request_business_reconcile(%L)$q$, i2), 'no autorizada', 'an owner cannot ask a re-read of another business''s payment');
  perform pg_temp.as_user((t ->> 'buyer')::uuid);
  perform pg_temp.raises(format($q$select * from public.mobbex_list_business_payments(%L)$q$, v_biz), 'no autorizados', 'a customer cannot list the merchant''s payments');
  perform pg_temp.raises(format($q$select public.mobbex_request_business_reconcile(%L)$q$, i), 'no autorizada', 'a customer cannot ask a re-read');

  -- ═══ 2. What the owner sees: money, no secrets, honest flags ═══
  perform pg_temp.as_user(v_owner);
  select x into row from public.mobbex_list_business_payments(v_biz) x limit 1;
  perform pg_temp.check((row ->> 'internal_status') = 'completed' and (row ->> 'paid_amount')::numeric = 2500 and (row ->> 'refundable_amount')::numeric = 2500,
    'a completed payment shows what was paid and what can still be returned');
  perform pg_temp.check((row ->> 'can_refund')::boolean and (row ->> 'can_operate')::boolean and (row ->> 'can_reconcile')::boolean,
    'completed + owner + same environment: refundable, and re-readable (the merchant may have refunded from the Mobbex panel)');
  perform pg_temp.check(row ->> 'order_public_code' is not null and (row ->> 'payment_id_short') = right('OP-CONSOLE-1', 6),
    'the order code is shown and the operation id is only its last 6 characters');
  perform pg_temp.check(row::text !~* '(access.?token|api.?key|secret|checkout_url|raw_response_hash|mobbex\.com/p/)' and not (row ? 'checkout_url') and not (row ? 'raw_response_hash'),
    'the row carries no credential, checkout URL or response hash');
  perform pg_temp.check(not (row ->> 'refund_in_flight')::boolean and jsonb_array_length(row -> 'refunds') = 0, 'no refund yet');
  perform pg_temp.check(jsonb_array_length(row -> 'events') > 0, 'the event timeline is there (type, code, time only)');
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(row -> 'events') e where e ? 'details'), 'event details are never exposed');

  -- ═══ 3. A refund in flight blocks a second one and is visible; settled partial refunds leave the remainder ═══
  r := public.mobbex_prepare_refund(i, 500, '00000000-0000-4000-8000-0000000000c1', 'cliente devolvio un producto');
  select x into row from public.mobbex_list_business_payments(v_biz) x limit 1;
  perform pg_temp.check((row ->> 'refund_in_flight')::boolean and not (row ->> 'can_refund')::boolean, 'a refund in flight: visible, and a second one is not offered');
  perform pg_temp.check((row -> 'refunds' -> 0 ->> 'status') = 'requested' and (row -> 'refunds' -> 0 ->> 'amount')::numeric = 500
    and (row -> 'refunds' -> 0 ->> 'reason') = 'cliente devolvio un producto', 'the refund list shows status, amount and reason');
  perform pg_temp.as_service();
  perform public.mobbex_mark_refund_sent((r ->> 'refund_id')::uuid);
  perform public.mobbex_record_refund_result((r ->> 'refund_id')::uuid, 'ambiguous', repeat('7', 64));
  perform pg_temp.as_user(v_owner);
  select x into row from public.mobbex_list_business_payments(v_biz) x limit 1;
  perform pg_temp.check((row ->> 'can_reconcile')::boolean and (row ->> 'refund_in_flight')::boolean and (row ->> 'latest_refund_status') = 'ambiguous',
    'an ambiguous refund keeps the payment re-readable and is shown as ambiguous');
  perform pg_temp.as_service();
  perform public.mobbex_record_refund_result((r ->> 'refund_id')::uuid, 'approved', repeat('6', 64));
  perform pg_temp.as_user(v_owner);
  select x into row from public.mobbex_list_business_payments(v_biz) x limit 1;
  perform pg_temp.check((row ->> 'internal_status') = 'partially_refunded' and (row ->> 'refunded_amount')::numeric = 500 and (row ->> 'refundable_amount')::numeric = 2000
    and (row ->> 'can_refund')::boolean, 'after a settled partial refund 2000 remains refundable');

  -- ═══ 4. Environment: a payment from another environment is never offered for refund ═══
  perform pg_temp.as_admin();
  update public.mobbex_payment_intents set environment = 'production' where id = i;
  perform pg_temp.as_user(v_owner);
  select x into row from public.mobbex_list_business_payments(v_biz) x limit 1;
  perform pg_temp.check((row ->> 'environment') = 'production' and (row ->> 'current_environment') = 'test' and not (row ->> 'can_refund')::boolean,
    'a payment of another environment is not refundable from the panel');
  perform pg_temp.as_admin();
  update public.mobbex_payment_intents set environment = 'test' where id = i;

  -- ═══ 5. Re-read request: only owner/admin, never changes a state, deduplicated, audited ═══
  perform pg_temp.as_admin();
  v_staff := gen_random_uuid();
  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_staff, 'authenticated', 'authenticated', 'm1-staff@example.invalid', '', '{}', '{}', clock_timestamp(), clock_timestamp());
  insert into public.business_members (business_id, user_id, role) values (v_biz, v_staff, 'staff');
  insert into public.identity_sessions (session_id, user_id, business_id, role_at_login, client)
  values (md5('mbx-session-' || v_staff::text)::uuid, v_staff, v_biz, 'staff', 'panel_web');
  perform pg_temp.as_user(v_staff);
  select x into row from public.mobbex_list_business_payments(v_biz) x limit 1;
  perform pg_temp.check(row is not null and not (row ->> 'can_operate')::boolean and not (row ->> 'can_refund')::boolean and not (row ->> 'can_reconcile')::boolean,
    'staff can read the list but gets no action flags');
  perform pg_temp.raises(format($q$select public.mobbex_prepare_refund(%L, 100, gen_random_uuid(), 'staff intenta')$q$, i), 'no autorizado', 'staff cannot refund even by calling the RPC');
  perform pg_temp.raises(format($q$select public.mobbex_request_business_reconcile(%L)$q$, i), 'no autorizada', 'staff cannot request a re-read');

  perform pg_temp.as_admin();
  c := pg_temp.new_checkout(t, 1, 'mbxconsole00003');
  i2 := pg_temp.intent_of((c ->> 'checkout_session_id')::uuid);
  perform public.mobbex_prepare_checkout((c ->> 'checkout_session_id')::uuid, (t ->> 'buyer')::uuid);
  perform public.mobbex_record_checkout_created(i2, 'CHK:CONSOLE3', 'https://mobbex.com/p/checkout/v2/CHK:CONSOLE3', repeat('b', 64));
  delete from public.mobbex_jobs where payment_intent_id = i2;
  perform pg_temp.as_user(v_owner);
  select x into row from public.mobbex_list_business_payments(v_biz) x where (x ->> 'payment_intent_id')::uuid = i2;
  perform pg_temp.check((row ->> 'can_reconcile')::boolean and not (row ->> 'can_refund')::boolean, 'an open checkout can be re-read and is not refundable');
  r := public.mobbex_request_business_reconcile(i2);
  perform pg_temp.check((r ->> 'queued')::boolean, 'the owner queues a re-read');
  r := public.mobbex_request_business_reconcile(i2);
  perform pg_temp.as_admin();
  perform pg_temp.check((select count(*) from public.mobbex_jobs where payment_intent_id = i2 and status in ('pending', 'claimed', 'retry_wait')) = 1,
    'asking twice leaves a single open job (no stampede on the provider)');
  perform pg_temp.check((select internal_status from public.mobbex_payment_intents where id = i2) = 'checkout_created',
    'asking for a re-read changed no payment state');
  perform pg_temp.check(exists (select 1 from public.mobbex_payment_events where payment_intent_id = i2 and event_type = 'merchant.reconcile_requested'),
    'the request is in the audit trail');
  perform pg_temp.as_user(v_owner);
  r := public.mobbex_request_business_reconcile(i);
  perform pg_temp.check((r ->> 'queued')::boolean, 'a completed payment CAN be re-read: a refund made in the Mobbex panel is then reflected here');
  perform pg_temp.as_admin();
  update public.mobbex_payment_intents set internal_status = 'refunded', refunded_amount = paid_amount where id = i;
  perform pg_temp.as_user(v_owner);
  perform pg_temp.check(not (public.mobbex_request_business_reconcile(i) ->> 'queued')::boolean, 'a fully refunded payment has nothing left to re-read');
  perform pg_temp.as_admin();
  update public.mobbex_payment_intents set internal_status = 'partially_refunded', refunded_amount = 500 where id = i;
  perform pg_temp.as_user(v_owner);

  -- ═══ 6. A paid order that is stuck after a worker failure is shown as stuck ═══
  perform pg_temp.as_admin();
  update public.mobbex_jobs set status = 'dead_letter' where payment_intent_id = i2;
  insert into public.mobbex_jobs (payment_intent_id, reason, status, failures, last_error) values (i2, 'webhook', 'dead_letter', 12, 'auth:401') on conflict do nothing;
  perform pg_temp.as_user(v_owner);
  select x into row from public.mobbex_list_business_payments(v_biz) x where (x ->> 'payment_intent_id')::uuid = i2;
  perform pg_temp.check((row ->> 'processing_state') in ('stuck', 'checking'), 'a payment whose job died is not shown as normal');
  perform pg_temp.as_admin();
  delete from public.mobbex_jobs where payment_intent_id = i2;
  insert into public.mobbex_jobs (payment_intent_id, reason, status, failures, last_error) values (i2, 'webhook', 'dead_letter', 12, 'auth:401');
  perform pg_temp.as_user(v_owner);
  select x into row from public.mobbex_list_business_payments(v_biz) x where (x ->> 'payment_intent_id')::uuid = i2;
  perform pg_temp.check((row ->> 'processing_state') = 'stuck', 'an exhausted job is shown as stuck, with no error text');
  perform pg_temp.check(row::text !~ 'auth:401', 'the worker error text never reaches the browser');

  -- ═══ 7. A money-in/no-order case offers recovery and refund, nothing else ═══
  perform pg_temp.as_admin();
  update public.mobbex_payment_intents set internal_status = 'security_review_required', review_reason = 'approved_after_reservation_expired',
         provider_payment_id = 'OP-NOORDER', paid_amount = expected_amount, order_id = null where id = i2;
  perform pg_temp.as_user(v_owner);
  select x into row from public.mobbex_list_business_payments(v_biz) x where (x ->> 'payment_intent_id')::uuid = i2;
  perform pg_temp.check((row ->> 'can_recover_order')::boolean and (row ->> 'can_refund')::boolean, 'paid without an order: recover the order or refund');
  perform pg_temp.as_admin();
  update public.mobbex_payment_intents set review_reason = 'amount_mismatch' where id = i2;
  perform pg_temp.as_user(v_owner);
  select x into row from public.mobbex_list_business_payments(v_biz) x where (x ->> 'payment_intent_id')::uuid = i2;
  perform pg_temp.check(not (row ->> 'can_recover_order')::boolean and not (row ->> 'can_refund')::boolean,
    'an amount mismatch is neither recoverable nor refundable from the panel: it needs a person with the provider''s evidence');

  -- ═══ 8. The list is bounded ═══
  perform pg_temp.check((select count(*) from public.mobbex_list_business_payments(v_biz, 1)) = 1, 'p_limit bounds the list');
  perform pg_temp.check((select count(*) from public.mobbex_list_business_payments(v_biz, -5)) = 1, 'a nonsensical limit is clamped to 1, not an error');

  -- ═══ 9. What needs a person comes FIRST (an old doubtful payment is never behind a "load more"), pagination is stable ═══
  perform pg_temp.as_admin();
  delete from public.mobbex_jobs where payment_intent_id = i2;
  update public.mobbex_payment_intents set internal_status = 'pending', review_reason = null, paid_amount = null, provider_payment_id = null where id = i2;
  alter table public.mobbex_payment_intents disable trigger mobbex_intents_touch;
  update public.mobbex_payment_intents set attention_reason = 'duplicate_approved_payment', created_at = clock_timestamp() - interval '40 days' where id = i;
  alter table public.mobbex_payment_intents enable trigger mobbex_intents_touch;
  perform pg_temp.as_user(v_owner);
  select count(*) into rows_count from public.mobbex_list_business_payments(v_biz);
  perform pg_temp.check(rows_count >= 2, 'fixture: at least two payments to order');
  perform pg_temp.check((select (x ->> 'payment_intent_id')::uuid from public.mobbex_list_business_payments(v_biz) x limit 1) = i,
    'a 40-day-old payment that needs a person is listed BEFORE newer healthy ones');
  perform pg_temp.check(not exists (select 1 from public.mobbex_list_business_payments(v_biz) x where x -> 'needs_attention' = 'null'::jsonb or (x ->> 'needs_attention') is null),
    'needs_attention is always true or false, never NULL (a payment without a job must not sort as urgent)');
  perform pg_temp.check((select bool_and((x ->> 'attention_total')::integer = 1) from public.mobbex_list_business_payments(v_biz) x),
    'every row carries the total that needs attention, whatever page it is on');
  -- Un cobro en revisión SIN motivo escrito (review_reason NULL) no puede dejar banderas en null.
  perform pg_temp.as_admin();
  update public.mobbex_payment_intents set internal_status = 'security_review_required', review_reason = null, order_id = null, paid_amount = expected_amount, provider_payment_id = 'OP-NOREASON' where id = i2;
  perform pg_temp.as_user(v_owner);
  perform pg_temp.check(not exists (select 1 from public.mobbex_list_business_payments(v_biz) x
      where jsonb_typeof(x -> 'can_refund') <> 'boolean' or jsonb_typeof(x -> 'can_recover_order') <> 'boolean' or jsonb_typeof(x -> 'can_reconcile') <> 'boolean' or jsonb_typeof(x -> 'can_operate') <> 'boolean'),
    'every action flag is a real boolean, even for a review without a written reason');
  perform pg_temp.as_admin();
  update public.mobbex_payment_intents set internal_status = 'pending', review_reason = null, paid_amount = null, provider_payment_id = null where id = i2;
  perform pg_temp.as_user(v_owner);
  perform pg_temp.check((select (x ->> 'payment_intent_id')::uuid from public.mobbex_list_business_payments(v_biz, 1, 1) x) <> i,
    'offset 1 skips the attention row and returns the next one');
  perform pg_temp.check((select count(*) from public.mobbex_list_business_payments(v_biz, 50, 10000)) = 0, 'an offset past the end is an empty page, not an error');
  perform pg_temp.check((select count(*) from public.mobbex_list_business_payments(v_biz, 50, -3)) = rows_count, 'a negative offset is clamped to 0');

  -- ═══ 10. A refund row that never left TABA is not "money in flight" for long (audit session 9) ═══
  perform pg_temp.as_admin();
  update public.mobbex_payment_intents set internal_status = 'completed', order_id = (select id from public.orders where business_id = v_biz limit 1),
         paid_amount = expected_amount, provider_payment_id = 'OP-REQ-STALE', refunded_amount = 0, review_reason = null, attention_reason = null where id = i;
  insert into public.mobbex_refunds (payment_intent_id, idempotency_key, amount, status, requested_at) values (i, gen_random_uuid(), 100, 'requested', clock_timestamp());
  perform pg_temp.as_user(v_owner);
  select x into row from public.mobbex_list_business_payments(v_biz) x where (x ->> 'payment_intent_id')::uuid = i;
  perform pg_temp.check((row ->> 'refund_in_flight')::boolean and not (row ->> 'can_refund')::boolean, 'a refund requested seconds ago is in flight: no second one is offered');
  perform pg_temp.as_admin();
  update public.mobbex_refunds set requested_at = clock_timestamp() - interval '5 minutes' where payment_intent_id = i and status = 'requested';
  perform pg_temp.as_user(v_owner);
  select x into row from public.mobbex_list_business_payments(v_biz) x where (x ->> 'payment_intent_id')::uuid = i;
  perform pg_temp.check(not (row ->> 'refund_in_flight')::boolean and (row ->> 'can_refund')::boolean, 'a requested row older than 2 minutes never left TABA: not in flight, refund offered again');

  raise notice 'MOBBEX_MERCHANT_CONSOLE_ALL_PASS';
end $$;
