-- Mobbex attention acknowledgement: contract of 20261105010000 (acknowledge RPC) + 20261105020000 (readers) against the REAL schema.
-- The runner prepends the helpers of mobbex_ledger.local.sql, applies foundation + alert + console + readers, runs this inside a
-- transaction and rolls everything back.

select pg_temp.as_admin();

do $$
declare
  t jsonb; t2 jsonb; c jsonb; s uuid; i uuid; i2 uuid; r jsonb; ref text; row jsonb; v_biz uuid; v_biz2 uuid; v_owner uuid; v_owner2 uuid;
  v_before text;
begin
  t := pg_temp.make_tenant('k1', 20);
  t2 := pg_temp.make_tenant('k2', 20);
  v_biz := (t ->> 'business')::uuid; v_biz2 := (t2 ->> 'business')::uuid;
  v_owner := (t ->> 'owner')::uuid; v_owner2 := (t2 ->> 'owner')::uuid;
  perform public.configure_mobbex_business(v_biz, true, 'test', 'not_requested', null, 'qa-runner');
  perform public.configure_mobbex_business(v_biz2, true, 'test', 'not_requested', null, 'qa-runner');
  perform public.set_mobbex_health_alert(v_biz, true);

  -- A paid, completed order that later shows a duplicate approved operation: money came in twice, the order is fine.
  c := pg_temp.new_checkout(t, 1, 'mbxack000001');
  s := (c ->> 'checkout_session_id')::uuid; i := pg_temp.intent_of(s); ref := c ->> 'reference';
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'approved', '200', 'OP-ACK-1', '1250.00', 0, '1'), 'webhook');
  perform pg_temp.check((r ->> 'finalized')::boolean, 'fixture: paid order');
  r := public.mobbex_record_provider_snapshot(i, pg_temp.snap(ref, 'approved', '200', 'OP-ACK-2', '1250.00', 1, '2'), 'reconciliation');
  perform pg_temp.check((select attention_reason from public.mobbex_payment_intents where id = i) = 'duplicate_approved_payment', 'fixture: duplicate payment flagged');

  -- ═══ 1. Before any acknowledgement the health, the alert and the panel all ask for a person ═══
  perform pg_temp.check((public.mobbex_pipeline_health() ->> 'needs_attention')::boolean and (public.mobbex_pipeline_health() ->> 'concerns_open')::integer = 1,
    'health asks for attention and counts one open concern');
  perform pg_temp.check((select count(*) from public.list_mobbex_operational_alerts(v_biz) where alert_code = 'MOBBEX_PAYMENT_NEEDS_REVIEW') = 1, 'the alert is raised');
  perform pg_temp.as_user(v_owner);
  select x into row from public.mobbex_list_business_payments(v_biz) x limit 1;
  perform pg_temp.check((row ->> 'concern_open')::boolean and (row ->> 'can_acknowledge')::boolean and not (row ->> 'attention_acknowledged')::boolean,
    'the owner is offered "acknowledge" for a duplicate payment');

  -- ═══ 2. Who may, and with what ═══
  perform pg_temp.raises(format($q$select public.mobbex_acknowledge_attention(%L, 'corto')$q$, i), 'motivo requerido', 'a written reason of at least 10 characters is required');
  perform pg_temp.as_user((t2 ->> 'owner')::uuid);
  perform pg_temp.raises(format($q$select public.mobbex_acknowledge_attention(%L, 'devuelto desde el panel de Mobbex')$q$, i), 'no autorizado', 'another business''s owner cannot acknowledge');
  perform pg_temp.as_user((t ->> 'buyer')::uuid);
  perform pg_temp.raises(format($q$select public.mobbex_acknowledge_attention(%L, 'devuelto desde el panel de Mobbex')$q$, i), 'no autorizado', 'a customer cannot acknowledge');
  perform pg_temp.as_admin();
  perform pg_temp.check(not exists (select 1 from information_schema.role_routine_grants where routine_name = 'mobbex_acknowledge_attention' and grantee in ('anon', 'PUBLIC')),
    'not callable by anon or PUBLIC');
  perform pg_temp.check(not has_table_privilege('authenticated', 'public.mobbex_attention_acks', 'select'), 'the acknowledgement table is closed to the browser');

  -- ═══ 3. With a refund in flight nothing is hidden ═══
  perform pg_temp.as_user(v_owner);
  r := public.mobbex_prepare_refund(i, 100, gen_random_uuid(), 'devolver un cobro repetido');
  perform pg_temp.raises(format($q$select public.mobbex_acknowledge_attention(%L, 'devuelto desde el panel de Mobbex')$q$, i), 'devolucion en curso', 'a refund in flight blocks the acknowledgement');
  perform pg_temp.as_admin();
  update public.mobbex_refunds set status = 'failed', completed_at = clock_timestamp() where id = (r ->> 'refund_id')::uuid;

  -- ═══ 4. Acknowledge: the alarm stops, the payment does not change ═══
  select internal_status || '/' || coalesce(attention_reason, '') || '/' || refunded_amount into v_before from (select internal_status, attention_reason, refunded_amount from public.mobbex_payment_intents where id = i) z;
  perform pg_temp.as_user(v_owner);
  r := public.mobbex_acknowledge_attention(i, 'Verificado en el panel de Mobbex: el cobro repetido ya se devolvio');
  perform pg_temp.check((r ->> 'acknowledged')::boolean and (r ->> 'valid_days')::integer = 14, 'the owner acknowledges with a written reason');
  perform pg_temp.as_admin();
  perform pg_temp.check(not (public.mobbex_pipeline_health() ->> 'needs_attention')::boolean and (public.mobbex_pipeline_health() ->> 'concerns_open')::integer = 0,
    'health no longer asks for attention');
  perform pg_temp.check((public.mobbex_pipeline_health() ->> 'intents_with_attention')::integer = 1, 'the RAW counter still shows the payment (nothing is hidden from the record)');
  perform pg_temp.check(not exists (select 1 from public.list_mobbex_operational_alerts(v_biz) where alert_code = 'MOBBEX_PAYMENT_NEEDS_REVIEW'), 'the alert closes');
  perform pg_temp.check((select internal_status || '/' || coalesce(attention_reason, '') || '/' || refunded_amount from public.mobbex_payment_intents where id = i) = v_before,
    'the payment itself is untouched: same status, same reason, same refunded amount');
  perform pg_temp.check(exists (select 1 from public.mobbex_payment_events where payment_intent_id = i and event_type = 'merchant.attention_acknowledged'), 'the event ledger records it');
  perform pg_temp.check((select acknowledged_by from public.mobbex_attention_acks where payment_intent_id = i limit 1) = v_owner, 'and who did it');
  perform pg_temp.as_user(v_owner);
  select x into row from public.mobbex_list_business_payments(v_biz) x limit 1;
  perform pg_temp.check(not (row ->> 'concern_open')::boolean and (row ->> 'attention_acknowledged')::boolean and not (row ->> 'can_acknowledge')::boolean and not (row ->> 'needs_attention')::boolean,
    'the panel row shows "acknowledged" and offers nothing more');

  -- ═══ 5. It resurfaces: a different cause, or fourteen days ═══
  perform pg_temp.as_admin();
  update public.mobbex_payment_intents set attention_reason = 'multiple_approved_operations' where id = i;
  perform pg_temp.check((public.mobbex_pipeline_health() ->> 'needs_attention')::boolean, 'a DIFFERENT cause alarms again');
  update public.mobbex_payment_intents set attention_reason = 'duplicate_approved_payment' where id = i;
  perform pg_temp.check(not (public.mobbex_pipeline_health() ->> 'needs_attention')::boolean, 'the same cause is still acknowledged');
  update public.mobbex_attention_acks set acknowledged_at = clock_timestamp() - interval '15 days' where payment_intent_id = i;
  perform pg_temp.check((public.mobbex_pipeline_health() ->> 'needs_attention')::boolean and exists (select 1 from public.list_mobbex_operational_alerts(v_biz) where alert_code = 'MOBBEX_PAYMENT_NEEDS_REVIEW'),
    'after 14 days an unresolved concern comes back by itself (alarm and health)');
  perform pg_temp.as_user(v_owner);
  r := public.mobbex_acknowledge_attention(i, 'Sigue pendiente de devolver; reconocido otra vez');
  perform pg_temp.as_admin();
  perform pg_temp.check((select count(*) from public.mobbex_attention_acks where payment_intent_id = i and concern = 'attention:duplicate_approved_payment') = 1, 'one row per concern');

  -- ═══ 6. Money without an order is never hidden ═══
  update public.mobbex_payment_intents set attention_reason = null, internal_status = 'security_review_required', review_reason = 'approved_after_reservation_expired', order_id = null where id = i;
  alter table public.mobbex_payment_intents disable trigger all;
  update public.mobbex_payment_intents set order_id = null where id = i;
  alter table public.mobbex_payment_intents enable trigger all;
  perform pg_temp.as_user(v_owner);
  perform pg_temp.raises(format($q$select public.mobbex_acknowledge_attention(%L, 'no corresponde esconder un cobro sin pedido')$q$, i), 'cobro sin pedido', 'a paid purchase without an order cannot be acknowledged: build the order or refund');
  select x into row from public.mobbex_list_business_payments(v_biz) x where (x ->> 'payment_intent_id')::uuid = i;
  perform pg_temp.check(not (row ->> 'can_acknowledge')::boolean and (row ->> 'can_recover_order')::boolean, 'the panel offers recover/refund instead of "acknowledge"');

  -- ═══ 7. A review with no money recorded (e.g. a mismatching read) can be acknowledged; nothing to acknowledge is an error ═══
  perform pg_temp.as_admin();
  c := pg_temp.new_checkout(t, 1, 'mbxack000002');
  i2 := pg_temp.intent_of((c ->> 'checkout_session_id')::uuid);
  perform pg_temp.as_user(v_owner);
  perform pg_temp.raises(format($q$select public.mobbex_acknowledge_attention(%L, 'no hay nada que reconocer aca')$q$, i2), 'nada para reconocer', 'a healthy payment has nothing to acknowledge');
  perform pg_temp.as_admin();
  r := public.mobbex_record_provider_snapshot(i2, pg_temp.snap(c ->> 'reference', 'approved', '200', 'OP-ACK-3', '1.00', 0, '3'), 'reconciliation');
  perform pg_temp.check((select internal_status from public.mobbex_payment_intents where id = i2) = 'security_review_required' and (select paid_amount from public.mobbex_payment_intents where id = i2) is null,
    'fixture: a mismatching amount goes to review with no money recorded locally');
  perform pg_temp.as_user(v_owner);
  r := public.mobbex_acknowledge_attention(i2, 'Importe distinto verificado en Mobbex: ya se resolvio con el cliente');
  perform pg_temp.as_admin();
  perform pg_temp.check((select internal_status from public.mobbex_payment_intents where id = i2) = 'security_review_required', 'the status stays security_review_required: no order, no delivery');
  perform pg_temp.check(not private.mobbex_concern_open((select pi from public.mobbex_payment_intents pi where pi.id = i2)), 'but the concern is acknowledged');

  raise notice 'MOBBEX_ATTENTION_ACK_ALL_PASS';
end $$;
