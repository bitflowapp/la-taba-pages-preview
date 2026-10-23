-- Rollback of 20261023210000_financial_core_review_fixes.sql: restores the five functions it replaced to the exact
-- definitions that were deployed before it (captured with pg_get_functiondef on a database built from the repository's
-- migrations up to 20261022233526). Privileges are kept by CREATE OR REPLACE.
--
-- Effects of rolling back: a payment reported as `in_mediation` is again judged an unknown status (the purchase goes to
-- security review); the stuck-purchase sweep again fulfils approved purchases of any age; the reference lookup stops
-- returning `business_id` (the worker treats that as «cannot tell» and applies its previous behaviour); a refund id
-- resolved by hand is no longer checked against the provider's list. Findings of kind `payment_in_mediation` that were
-- opened remain as data and can be resolved by hand.

-- private_provider_payment_status_rank
CREATE OR REPLACE FUNCTION private.provider_payment_status_rank(p_status text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case lower(btrim(coalesce(p_status, '')))
    when 'pending' then 10
    when 'in_process' then 20
    when 'authorized' then 20
    when 'rejected' then 30
    when 'cancelled' then 30
    when 'canceled' then 30
    when 'expired' then 30
    when 'approved' then 40
    when 'refunded' then 50
    when 'charged_back' then 60
    else 0
  end $function$

;

-- public_record_mercadopago_payment_snapshot
CREATE OR REPLACE FUNCTION public.record_mercadopago_payment_snapshot(p_payment_intent_id uuid, p_snapshot jsonb, p_source text, p_webhook_receipt_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_intent public.payment_intents%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_pay public.payment_provider_payments%rowtype;
  v_other public.payment_provider_payments%rowtype;
  v_status text;
  v_next text;
  v_effective text;
  v_amount numeric(12, 2);
  v_refunded numeric(12, 2);
  v_total_refunded numeric(12, 2);
  v_currency text;
  v_provider_time timestamptz;
  v_valid boolean := true;
  v_reason text;
  v_finalize boolean := false;
  v_pid text;
  v_seller text;
  v_money boolean;
  v_apply boolean := false;
  v_pay_found boolean;
  v_foreign boolean;
  v_hold text;
  v_res jsonb;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
    or coalesce(p_snapshot ->> 'raw_response_hash', '') !~ '^[a-f0-9]{64}$' then
    raise exception 'snapshot de pago invalido' using errcode = '22023';
  end if;
  -- I6: intent first, then session.
  select * into v_intent from public.payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  select * into v_session from public.checkout_sessions s where s.id = v_intent.checkout_session_id for update;
  select * into v_settings from public.business_payment_settings ps
   where ps.business_id = v_intent.business_id and ps.provider = 'mercadopago' for share;
  v_status := lower(btrim(coalesce(p_snapshot ->> 'status', '')));
  v_currency := upper(btrim(coalesce(p_snapshot ->> 'currency', '')));
  v_amount := nullif(p_snapshot ->> 'transaction_amount', '')::numeric(12, 2);
  v_refunded := coalesce(nullif(p_snapshot ->> 'refunded_amount', '')::numeric(12, 2), 0);
  v_pid := nullif(btrim(coalesce(p_snapshot ->> 'provider_payment_id', '')), '');
  v_seller := coalesce(nullif(btrim(coalesce(p_snapshot ->> 'collector_id', '')), ''), v_settings.collector_id, 'unknown');
  begin
    v_provider_time := coalesce(nullif(p_snapshot ->> 'provider_occurred_at', '')::timestamptz, clock_timestamp());
  exception when others then
    v_provider_time := clock_timestamp();
  end;
  v_money := v_status in ('approved', 'refunded', 'charged_back');

  if v_pid is null then
    v_valid := false; v_reason := 'payment_id_missing';
  elsif p_snapshot ->> 'external_reference' is distinct from v_intent.external_reference then
    v_valid := false; v_reason := 'external_reference_mismatch';
  -- An EMPTY preference is "not verified yet" (the provider lookup that carries it may be down), handled below as a
  -- retry. Only a different, non-empty preference proves the payment belongs to another checkout.
  elsif nullif(btrim(coalesce(v_intent.preference_id, '')), '') is not null
    and nullif(btrim(coalesce(p_snapshot ->> 'preference_id', '')), '') is not null
    and btrim(p_snapshot ->> 'preference_id') is distinct from v_intent.preference_id then
    v_valid := false; v_reason := 'preference_mismatch';
  elsif v_settings.collector_id is null or p_snapshot ->> 'collector_id' is distinct from v_settings.collector_id then
    v_valid := false; v_reason := 'collector_mismatch';
  elsif nullif(btrim(coalesce(p_snapshot ->> 'application_id', '')), '') is not null
    and p_snapshot ->> 'application_id' is distinct from coalesce(v_settings.application_id, '') then
    v_valid := false; v_reason := 'application_mismatch';
  elsif v_currency <> 'ARS' or v_currency <> v_intent.currency then
    v_valid := false; v_reason := 'currency_mismatch';
  elsif v_amount is null or v_amount <> v_intent.expected_amount then
    v_valid := false; v_reason := 'amount_mismatch';
  elsif v_intent.environment = 'production'
    and coalesce((p_snapshot ->> 'live_mode')::boolean, false) is not true then
    v_valid := false; v_reason := 'live_mode_mismatch';
  elsif v_status not in ('approved', 'pending', 'in_process', 'authorized', 'rejected', 'cancelled', 'canceled', 'expired', 'refunded', 'charged_back') then
    v_valid := false; v_reason := 'unknown_provider_status';
  elsif exists (select 1 from public.payment_provider_payments x
                 where x.provider = 'mercadopago' and x.environment = v_intent.environment
                   and x.seller_id = v_seller and x.provider_payment_id = v_pid
                   and x.payment_intent_id <> v_intent.id) then
    v_valid := false; v_reason := 'payment_bound_to_other_checkout';
  end if;

  if not v_valid then
    -- A defective payment that is NOT the one funding this intent must not poison a healthy purchase.
    v_foreign := v_intent.provider_payment_id is not null and v_pid is distinct from v_intent.provider_payment_id
                 and (v_intent.order_id is not null or v_intent.paid_amount is not null);
    if v_pid is not null and v_reason <> 'payment_bound_to_other_checkout' then
      insert into public.payment_provider_payments (payment_intent_id, environment, seller_id, provider_payment_id, status,
        amount, currency, provider_event_at, raw_response_hash, validation_error)
      values (v_intent.id, v_intent.environment, v_seller, v_pid, coalesce(nullif(v_status, ''), 'unknown'),
        v_amount, v_currency, v_provider_time, p_snapshot ->> 'raw_response_hash', v_reason)
      on conflict (provider, environment, seller_id, provider_payment_id) do update
        set last_seen_at = clock_timestamp(), validation_error = excluded.validation_error;
    end if;
    -- A defective payment foreign to a purchase that is already funded must be visible, but it cannot hold the
    -- legitimate payment's order hostage.
    perform private.open_payment_discrepancy(v_intent.business_id, v_intent.id, v_session.id, 'provider_payment_inconsistent',
      'critical', not v_foreign, v_pid, jsonb_build_object('reason', v_reason, 'source', p_source, 'status', v_status,
        'amount', v_amount, 'currency', v_currency, 'foreign_to_intent_payment', v_foreign),
      'inconsistent:' || v_intent.id::text || ':' || coalesce(v_pid, 'none') || ':' || v_reason,
      null, v_seller, v_intent.environment);
    if v_foreign then
      return jsonb_build_object('ok', false, 'manual_review_required', false, 'discrepancy', true, 'reason', v_reason, 'finalize_required', false);
    end if;
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = v_reason,
      raw_response_hash = p_snapshot ->> 'raw_response_hash' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = v_reason where id = v_session.id;
    insert into public.payment_events (payment_intent_id, webhook_receipt_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
    values (v_intent.id, p_webhook_receipt_id, 'payment.security_review_required', v_status,
      nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, p_snapshot ->> 'raw_response_hash', jsonb_build_object('reason', v_reason, 'source', p_source));
    return jsonb_build_object('ok', false, 'manual_review_required', true, 'reason', v_reason, 'finalize_required', false);
  end if;

  if nullif(btrim(coalesce(v_intent.preference_id, '')), '') is not null
     and nullif(btrim(coalesce(p_snapshot ->> 'preference_id', '')), '') is null then
    -- Transient by definition: the same facts will validate on the next read. Nothing is changed and nothing is blocked.
    insert into public.payment_events (payment_intent_id, webhook_receipt_id, event_type, provider_status, provider_occurred_at, raw_response_hash, details)
    values (v_intent.id, p_webhook_receipt_id, 'payment.preference_unverified', v_status, v_provider_time,
      p_snapshot ->> 'raw_response_hash', jsonb_build_object('source', p_source, 'payment_id', v_pid));
    return jsonb_build_object('ok', false, 'retryable', true, 'reason', 'preference_unverified',
      'manual_review_required', false, 'finalize_required', false);
  end if;

  -- Store this payment resource on its own row; versions of the SAME resource only move forward.
  select * into v_pay from public.payment_provider_payments x
   where x.provider = 'mercadopago' and x.environment = v_intent.environment
     and x.seller_id = v_seller and x.provider_payment_id = v_pid for update;
  v_pay_found := found;
  if not v_pay_found then
    insert into public.payment_provider_payments (payment_intent_id, environment, seller_id, provider_payment_id, status,
      status_detail, amount, currency, refunded_amount, provider_event_at, raw_response_hash)
    values (v_intent.id, v_intent.environment, v_seller, v_pid, v_status, nullif(p_snapshot ->> 'status_detail', ''),
      v_amount, v_currency, v_refunded, v_provider_time, p_snapshot ->> 'raw_response_hash')
    returning * into v_pay;
  elsif private.provider_payment_status_rank(v_status) > private.provider_payment_status_rank(v_pay.status)
     or (private.provider_payment_status_rank(v_status) = private.provider_payment_status_rank(v_pay.status)
         and v_provider_time >= coalesce(v_pay.provider_event_at, '-infinity'::timestamptz)) then
    update public.payment_provider_payments
       set status = v_status, status_detail = nullif(p_snapshot ->> 'status_detail', ''), amount = v_amount,
           currency = v_currency, refunded_amount = greatest(refunded_amount, v_refunded),
           provider_event_at = greatest(coalesce(provider_event_at, '-infinity'::timestamptz), v_provider_time),
           last_seen_at = clock_timestamp(), raw_response_hash = p_snapshot ->> 'raw_response_hash', validation_error = null
     where id = v_pay.id
     returning * into v_pay;
  else
    update public.payment_provider_payments set last_seen_at = clock_timestamp() where id = v_pay.id;
    insert into public.payment_events (payment_intent_id, webhook_receipt_id, provider_event_id, event_type, provider_status, provider_occurred_at, raw_response_hash, details)
    values (v_intent.id, p_webhook_receipt_id, v_pid, 'payment.stale_snapshot_ignored', v_status, v_provider_time,
      p_snapshot ->> 'raw_response_hash', jsonb_build_object('stored_status', v_pay.status, 'source', p_source));
    return jsonb_build_object('ok', true, 'stale', true, 'payment_intent_id', v_intent.id,
      'internal_status', v_intent.internal_status, 'manual_review_required', false,
      'finalize_required', v_intent.internal_status = 'approved_order_pending' and v_session.status = 'payment_approved');
  end if;

  -- Which payment speaks for the intent? What it is decides (money moved), not when it arrived.
  if v_intent.provider_payment_id is null or v_intent.provider_payment_id = v_pid then
    v_apply := true;
  else
    select * into v_other from public.payment_provider_payments x
     where x.payment_intent_id = v_intent.id and x.provider_payment_id = v_intent.provider_payment_id
     order by x.first_seen_at limit 1;
    if coalesce(v_other.is_financing, false) then
      v_apply := false;
      if v_money then
        -- Critical and visible, but the first payment still funds its order: the surplus is refunded by an operator.
        perform private.open_payment_discrepancy(v_intent.business_id, v_intent.id, v_session.id, 'multiple_approved_payments',
          'critical', false, v_pid, jsonb_build_object('financing_payment_id', v_intent.provider_payment_id, 'other_payment_id', v_pid,
            'other_status', v_status, 'amount', v_amount, 'source', p_source),
          'multiple_money:' || v_intent.id::text || ':' || v_pid, null, v_seller, v_intent.environment);
      end if;
    elsif v_money then
      v_apply := true;
    else
      v_apply := v_provider_time >= coalesce(v_intent.provider_event_at, '-infinity'::timestamptz);
    end if;
  end if;

  if not v_apply then
    insert into public.payment_events (payment_intent_id, webhook_receipt_id, provider_event_id, event_type, provider_status, provider_occurred_at, raw_response_hash, details)
    values (v_intent.id, p_webhook_receipt_id, v_pid, 'payment.' || v_status, v_status, v_provider_time,
      p_snapshot ->> 'raw_response_hash', jsonb_build_object('source', p_source, 'applied_to_intent', false));
    return jsonb_build_object('ok', true, 'ignored_for_intent', true, 'payment_intent_id', v_intent.id,
      'internal_status', v_intent.internal_status, 'manual_review_required', false, 'finalize_required', false);
  end if;

  if v_money then
    update public.payment_provider_payments set is_financing = false
     where payment_intent_id = v_intent.id and is_financing and id <> v_pay.id;
    update public.payment_provider_payments set is_financing = true where id = v_pay.id and not is_financing;
    v_total_refunded := private.reconcile_payment_refunds(v_intent.id, v_status, v_amount, v_refunded, p_snapshot -> 'refunds', v_provider_time);
  else
    v_total_refunded := v_intent.refunded_amount;
  end if;

  v_next := case v_status
    when 'approved' then case when v_total_refunded >= v_amount then 'refunded' when v_total_refunded > 0 then 'partially_refunded' else 'approved_order_pending' end
    when 'pending' then 'pending'
    when 'in_process' then 'in_process'
    when 'authorized' then 'in_process'
    when 'rejected' then 'rejected'
    when 'cancelled' then 'cancelled'
    when 'canceled' then 'cancelled'
    when 'expired' then 'expired'
    when 'refunded' then 'refunded'
    when 'charged_back' then 'charged_back'
    else 'ambiguous'
  end;
  v_effective := case when public.payment_internal_status_rank(v_next) >= public.payment_internal_status_rank(v_intent.internal_status)
    then v_next else v_intent.internal_status end;

  update public.payment_intents set
    provider_payment_id = v_pid,
    provider_merchant_order_id = coalesce(nullif(p_snapshot ->> 'merchant_order_id', ''), provider_merchant_order_id),
    provider_status = v_status,
    provider_status_detail = nullif(p_snapshot ->> 'status_detail', ''),
    provider_payment_method = coalesce(nullif(p_snapshot ->> 'payment_method', ''), provider_payment_method),
    provider_event_at = greatest(coalesce(provider_event_at, '-infinity'::timestamptz), v_provider_time),
    paid_amount = case when v_money then v_amount else paid_amount end,
    payer_email_hash = nullif(p_snapshot ->> 'payer_email_hash', ''), live_mode = (p_snapshot ->> 'live_mode')::boolean,
    approved_at = case when v_money then coalesce(approved_at, v_provider_time) else approved_at end,
    rejected_at = case when v_status in ('rejected', 'cancelled', 'canceled', 'expired') then coalesce(rejected_at, v_provider_time) else rejected_at end,
    internal_status = v_effective,
    raw_response_hash = p_snapshot ->> 'raw_response_hash'
  where id = v_intent.id;
  insert into public.payment_events (payment_intent_id, webhook_receipt_id, provider_event_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
  values (v_intent.id, p_webhook_receipt_id, v_pid, 'payment.' || v_status,
    v_status, nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, p_snapshot ->> 'raw_response_hash', jsonb_build_object('source', p_source));

  if v_status = 'approved' and v_effective = 'approved_order_pending' then
    v_hold := private.payment_financial_hold(v_intent.id);
    if v_hold is not null then
      update public.checkout_sessions
         set status = 'manual_review_required', manual_review_reason = left('financial_hold:' || v_hold, 120)
       where id = v_session.id;
      perform private.open_payment_discrepancy(v_intent.business_id, v_intent.id, v_session.id, 'paid_without_order', 'high',
        false, v_pid, jsonb_build_object('hold', v_hold, 'stage', 'snapshot'), 'paid_without_order:' || v_intent.id::text);
      return jsonb_build_object('ok', true, 'manual_review_required', true, 'hold', v_hold, 'finalize_required', false);
    end if;
    -- Stock is still held (reservation active even if its clock ran out) or can be re-taken in this very transaction.
    v_res := private.reserve_for_paid_session(v_session.id);
    if not coalesce((v_res ->> 'ok')::boolean, false) then
      update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'approved_after_reservation_expired' where id = v_intent.id;
      update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'approved_after_reservation_expired' where id = v_session.id;
      insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash)
      values (v_intent.id, 'payment.manual_review_required',
        jsonb_build_object('reason', 'approved_after_reservation_expired', 'detail', v_res), p_snapshot ->> 'raw_response_hash');
      perform private.open_payment_discrepancy(v_intent.business_id, v_intent.id, v_session.id, 'paid_without_order', 'high',
        false, v_pid, jsonb_build_object('reason', 'stock_insuficiente', 'missing', v_res -> 'missing', 'stage', 'snapshot'),
        'paid_without_order:' || v_intent.id::text);
      return jsonb_build_object('ok', true, 'manual_review_required', true, 'finalize_required', false);
    end if;
    update public.checkout_sessions
       set status = 'payment_approved', manual_review_reason = null,
           expires_at = greatest(expires_at, clock_timestamp() + interval '10 minutes')
     where id = v_session.id;
    v_finalize := true;
  elsif v_status in ('pending', 'in_process', 'authorized') then
    update public.checkout_sessions set status = case when status in ('ready_for_payment', 'redirected') then 'payment_pending' else status end where id = v_session.id;
  elsif v_status = 'expired' then
    perform public.release_checkout_session_inventory(v_session.id, 'provider_expired', 'expired');
  elsif v_status = 'rejected' and v_session.expires_at > clock_timestamp() then
    update public.checkout_sessions
       set status = case when status in ('ready_for_payment', 'redirected') then 'payment_pending' else status end
     where id = v_session.id;
  elsif v_status in ('rejected', 'cancelled', 'canceled') then
    perform public.release_checkout_session_inventory(v_session.id, 'provider_' || v_status, 'cancelled');
  end if;
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'internal_status', v_effective,
    'manual_review_required', false, 'finalize_required', v_finalize);
end $function$

;

-- public_retry_stuck_paid_checkouts
CREATE OR REPLACE FUNCTION public.retry_stuck_paid_checkouts(p_limit integer DEFAULT 25)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_row record;
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_done integer := 0;
  v_res jsonb;
begin
  for v_row in
    select pi.id as intent_id, pi.checkout_session_id
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where pi.order_id is null and cs.completed_order_id is null
       and pi.provider_status = 'approved' and pi.paid_amount is not distinct from cs.total
       and (pi.internal_status = 'approved_order_pending'
            or (pi.internal_status = 'security_review_required'
                and pi.security_review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation')))
       and cs.status in ('payment_approved', 'manual_review_required', 'finalizing_order')
       and pi.updated_at < clock_timestamp() - interval '45 seconds'
     order by pi.updated_at
     limit greatest(1, least(coalesce(p_limit, 25), 100))
  loop
    begin
      select * into v_intent from public.payment_intents where id = v_row.intent_id for update skip locked;
      if not found then continue; end if;
      select * into v_session from public.checkout_sessions where id = v_row.checkout_session_id for update skip locked;
      if not found or v_session.completed_order_id is not null then continue; end if;
      if private.payment_financial_hold(v_intent.id) is not null then continue; end if;
      v_res := private.advance_paid_checkout(v_session.id, null, 'sweep');
      if coalesce((v_res ->> 'order_id') is not null, false) then v_done := v_done + 1; end if;
    exception when others then
      -- One bad row must not hide the others. The discrepancy / alert layer shows rows that stay stuck.
      insert into public.payment_events (payment_intent_id, event_type, details)
      values (v_row.intent_id, 'payment.auto_recovery_failed', jsonb_build_object('sqlstate', sqlstate, 'message', left(sqlerrm, 200)));
    end;
  end loop;
  return v_done;
end $function$

;

-- public_find_payment_intent_by_external_reference
CREATE OR REPLACE FUNCTION public.find_payment_intent_by_external_reference(p_environment text, p_external_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_intent public.payment_intents%rowtype;
begin
  select * into v_intent from public.payment_intents pi
   where pi.environment = lower(btrim(coalesce(p_environment, '')))
     and pi.external_reference = btrim(coalesce(p_external_reference, ''))
   for share;
  if not found then raise exception 'referencia de pago desconocida' using errcode = 'P0002'; end if;
  return jsonb_build_object('payment_intent_id', v_intent.id, 'checkout_session_id', v_intent.checkout_session_id);
end;
$function$

;

-- public_resolve_ambiguous_refund
CREATE OR REPLACE FUNCTION public.resolve_ambiguous_refund(p_refund_id uuid, p_outcome text, p_provider_refund_id text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_r public.payment_refunds%rowtype;
  v_i public.payment_intents%rowtype;
  v_id text := nullif(btrim(coalesce(p_provider_refund_id, '')), '');
  v_total numeric(12, 2);
begin
  select * into v_r from public.payment_refunds where id = p_refund_id;
  if not found then raise exception 'reembolso inexistente' using errcode = 'P0002'; end if;
  select * into v_i from public.payment_intents where id = v_r.payment_intent_id for update;
  select * into v_r from public.payment_refunds where id = p_refund_id for update;
  if v_actor is null or not public.has_business_role(v_i.business_id, array['owner', 'admin']) then
    raise exception 'resolucion no autorizada' using errcode = '42501';
  end if;
  if v_r.status <> 'ambiguous' then raise exception 'el reembolso no esta pendiente de aclaracion' using errcode = '55000'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'la nota de evidencia es obligatoria (10+ caracteres)' using errcode = '22023';
  end if;
  if p_outcome = 'executed' then
    if v_id is null or v_id !~ '^[1-9][0-9]{0,31}$' then
      raise exception 'identidad de reembolso invalida' using errcode = '22023';
    end if;
    if exists (select 1 from public.payment_refunds x where x.provider_refund_id = v_id and x.id <> p_refund_id and x.origin <> 'external') then
      raise exception 'esa identidad ya pertenece a otro reembolso' using errcode = '23505';
    end if;
    delete from public.payment_refunds where provider_refund_id = v_id and origin = 'external' and payment_intent_id = v_i.id;
    update public.payment_refunds
       set provider_refund_id = v_id, status = 'approved', completed_at = clock_timestamp(),
           reason = left(coalesce(reason, '') || ' | resolved: ' || btrim(p_note), 300)
     where id = p_refund_id;
    v_total := private.refresh_refund_totals(v_i.id, null, null, v_r.requested_at);
    if v_i.internal_status <> 'security_review_required' then
      update public.payment_intents
         set internal_status = case when v_total >= coalesce(paid_amount, expected_amount) then 'refunded' else 'partially_refunded' end
       where id = v_i.id;
    end if;
  elsif p_outcome = 'not_executed' then
    update public.payment_refunds
       set status = 'failed', completed_at = clock_timestamp(),
           reason = left(coalesce(reason, '') || ' | not executed: ' || btrim(p_note), 300)
     where id = p_refund_id;
  else
    raise exception 'resultado invalido' using errcode = '22023';
  end if;
  update public.payment_outbox set status = 'completed', completed_at = clock_timestamp()
   where refund_id = p_refund_id and topic = 'refund_reconcile' and status in ('pending', 'claimed', 'processing', 'retry_wait', 'failed', 'dead_letter');
  update public.payment_discrepancies
     set status = 'resolved', resolved_at = clock_timestamp(), resolved_by = v_actor,
         resolution = case p_outcome when 'executed' then 'refunded_in_provider' else 'not_executed_in_provider' end,
         resolution_note = left(btrim(p_note), 500)
   where refund_id = p_refund_id and kind = 'refund_identity_unknown' and status <> 'resolved';
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (v_i.id, 'payment.refund_ambiguity_resolved',
    jsonb_build_object('refund_id', p_refund_id, 'outcome', p_outcome, 'actor_user_id', v_actor));
  return jsonb_build_object('ok', true, 'refund_id', p_refund_id, 'outcome', p_outcome);
end $function$

;
