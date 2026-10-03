-- REVERSIÓN de 20261001200000_mercadopago_snapshot_keeps_reservation_and_pins_payment.sql
--
-- Devuelve `record_mercadopago_payment_snapshot` y `enqueue_checkout_provider_probes`
-- a sus cuerpos anteriores, copiados tal cual de la base con las 159 migraciones
-- previas (`pg_get_functiondef`).
--
-- Ojo con lo que vuelve a quedar abierto: un rechazo del proveedor libera la reserva
-- y cancela la sesión (el reintento aprobado en la misma preferencia cae en revisión
-- manual), un segundo pago pisa la identidad del intent, un snapshot inválido reabre
-- un checkout completado, reintentar un trabajo de webhook viola `payment_events`,
-- y el snapshot vuelve a tomar los locks en el orden que se abraza con la
-- finalización. Sólo usar para volver atrás un despliegue.
--
-- Se conserva: las filas de `payment_events` con los tipos nuevos
-- (`payment.duplicate_approved`, `payment.secondary_payment`,
-- `payment.post_completion_anomaly`) quedan como historia; ninguna función anterior
-- las lee. No se pierde ningún dato.
--
-- ORDEN: revertir ANTES 20261001200200. Con el trigger de sesión completada puesto,
-- el snapshot anterior fallaría al intentar reabrir una sesión con pedido y el
-- trabajo del webhook reintentaría hasta `dead_letter`. El bloque de abajo lo exige.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001200000
begin;

do $guard$
begin
  if exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.checkout_sessions'::regclass
       and t.tgname = 'checkout_sessions_guard_completed_terminal'
       and not t.tgisinternal
  ) then
    raise exception 'ROLLBACK_BLOCKED: revertir primero 20261001200200 (el trigger checkout_sessions_guard_completed_terminal sigue activo y el snapshot anterior chocaria contra el)';
  end if;
end
$guard$;

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
  v_status text;
  v_next text;
  v_effective text;
  v_amount numeric(12,2);
  v_refunded numeric(12,2);
  v_currency text;
  v_provider_time timestamptz;
  v_valid boolean := true;
  v_reason text;
  v_finalize boolean := false;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
    or coalesce(p_snapshot ->> 'raw_response_hash', '') !~ '^[a-f0-9]{64}$' then
    raise exception 'snapshot de pago invalido' using errcode = '22023';
  end if;
  select * into v_intent from public.payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  select * into v_session from public.checkout_sessions s where s.id = v_intent.checkout_session_id for update;
  select * into v_settings from public.business_payment_settings ps where ps.business_id = v_intent.business_id and ps.provider = 'mercadopago' for share;
  v_status := lower(btrim(coalesce(p_snapshot ->> 'status', '')));
  v_currency := upper(btrim(coalesce(p_snapshot ->> 'currency', '')));
  v_amount := nullif(p_snapshot ->> 'transaction_amount', '')::numeric(12,2);
  v_refunded := coalesce(nullif(p_snapshot ->> 'refunded_amount', '')::numeric(12,2), 0);
  begin
    v_provider_time := coalesce(nullif(p_snapshot ->> 'provider_occurred_at', '')::timestamptz, clock_timestamp());
  exception when others then
    v_provider_time := clock_timestamp();
  end;
  if nullif(btrim(coalesce(p_snapshot ->> 'provider_payment_id', '')), '') is null then
    v_valid := false; v_reason := 'payment_id_missing';
  elsif p_snapshot ->> 'external_reference' is distinct from v_intent.external_reference then
    v_valid := false; v_reason := 'external_reference_mismatch';
  elsif nullif(btrim(coalesce(v_intent.preference_id, '')), '') is not null
    and nullif(btrim(coalesce(p_snapshot ->> 'preference_id', '')), '') is distinct from v_intent.preference_id then
    v_valid := false; v_reason := 'preference_mismatch';
  elsif v_settings.collector_id is null or p_snapshot ->> 'collector_id' is distinct from v_settings.collector_id then
    v_valid := false; v_reason := 'collector_mismatch';
  -- Mercado Pago exposes no application_id on payments or merchant orders, so
  -- the assertion runs only when the provider actually supplies one. collector_id
  -- stays mandatory and is what pins a payment to the configured account.
  elsif nullif(btrim(coalesce(p_snapshot ->> 'application_id', '')), '') is not null
    and p_snapshot ->> 'application_id' is distinct from coalesce(v_settings.application_id, '') then
    v_valid := false; v_reason := 'application_mismatch';
  elsif v_currency <> 'ARS' or v_currency <> v_intent.currency then
    v_valid := false; v_reason := 'currency_mismatch';
  elsif v_amount is null or v_amount <> v_intent.expected_amount then
    v_valid := false; v_reason := 'amount_mismatch';
  -- Checkout Pro test credentials are a Mercado Pago sandbox test user whose
  -- payments report live_mode = true, so equality with the environment can only
  -- be demanded in production. In test the collector_id assertion above already
  -- pins the payment to the sandbox user, which cannot move real money.
  elsif v_intent.environment = 'production'
    and coalesce((p_snapshot ->> 'live_mode')::boolean, false) is not true then
    v_valid := false; v_reason := 'live_mode_mismatch';
  elsif v_status not in ('approved', 'pending', 'in_process', 'authorized', 'rejected', 'cancelled', 'canceled', 'expired', 'refunded', 'charged_back') then
    v_valid := false; v_reason := 'unknown_provider_status';
  end if;
  if not v_valid then
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = v_reason,
      raw_response_hash = p_snapshot ->> 'raw_response_hash' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = v_reason where id = v_session.id;
    insert into public.payment_events (payment_intent_id, webhook_receipt_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
    values (v_intent.id, p_webhook_receipt_id, 'payment.security_review_required', v_status,
      nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, p_snapshot ->> 'raw_response_hash', jsonb_build_object('reason', v_reason, 'source', p_source));
    return jsonb_build_object('ok', false, 'manual_review_required', true, 'reason', v_reason, 'finalize_required', false);
  end if;
  v_next := case v_status
    when 'approved' then case when v_refunded >= v_amount then 'refunded' when v_refunded > 0 then 'partially_refunded' else 'approved_order_pending' end
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
    provider_payment_id = case when provider_event_at is null or v_provider_time >= provider_event_at then p_snapshot ->> 'provider_payment_id' else provider_payment_id end,
    provider_merchant_order_id = case when provider_event_at is null or v_provider_time >= provider_event_at then nullif(p_snapshot ->> 'merchant_order_id', '') else provider_merchant_order_id end,
    provider_status = case when provider_event_at is null or v_provider_time >= provider_event_at then v_status else provider_status end,
    provider_status_detail = case when provider_event_at is null or v_provider_time >= provider_event_at then nullif(p_snapshot ->> 'status_detail', '') else provider_status_detail end,
    provider_payment_method = case when provider_event_at is null or v_provider_time >= provider_event_at then nullif(p_snapshot ->> 'payment_method', '') else provider_payment_method end,
    provider_event_at = greatest(coalesce(provider_event_at, '-infinity'::timestamptz), v_provider_time),
    paid_amount = case when v_status = 'approved' then v_amount else paid_amount end,
    payer_email_hash = nullif(p_snapshot ->> 'payer_email_hash', ''), live_mode = (p_snapshot ->> 'live_mode')::boolean,
    approved_at = case when v_status = 'approved' then coalesce(approved_at, v_provider_time) else approved_at end,
    rejected_at = case when v_status in ('rejected', 'cancelled', 'canceled', 'expired') then coalesce(rejected_at, v_provider_time) else rejected_at end,
    refunded_amount = greatest(refunded_amount, v_refunded), internal_status = v_effective,
    raw_response_hash = p_snapshot ->> 'raw_response_hash'
  where id = v_intent.id;
  insert into public.payment_events (payment_intent_id, webhook_receipt_id, provider_event_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
  values (v_intent.id, p_webhook_receipt_id, p_snapshot ->> 'provider_payment_id', 'payment.' || v_status,
    v_status, nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, p_snapshot ->> 'raw_response_hash', jsonb_build_object('source', p_source));
  if v_status = 'approved' and v_effective = 'approved_order_pending' then
    if v_session.expires_at <= clock_timestamp() or not exists (
      select 1 from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' and r.expires_at > clock_timestamp()
    ) then
      update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'approved_after_reservation_expired' where id = v_intent.id;
      update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'approved_after_reservation_expired' where id = v_session.id;
      insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash)
      values (v_intent.id, 'payment.manual_review_required', jsonb_build_object('reason', 'approved_after_reservation_expired'), p_snapshot ->> 'raw_response_hash');
      return jsonb_build_object('ok', true, 'manual_review_required', true, 'finalize_required', false);
    end if;
    update public.checkout_sessions set status = 'payment_approved' where id = v_session.id;
    v_finalize := true;
  elsif v_status in ('pending', 'in_process', 'authorized') then
    update public.checkout_sessions set status = case when status in ('ready_for_payment', 'redirected') then 'payment_pending' else status end where id = v_session.id;
  elsif v_status = 'expired' then
    perform public.release_checkout_session_inventory(v_session.id, 'provider_expired', 'expired');
  elsif v_status in ('rejected', 'cancelled', 'canceled') then
    perform public.release_checkout_session_inventory(v_session.id, 'provider_' || v_status, 'cancelled');
  end if;
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'internal_status', v_effective,
    'manual_review_required', false, 'finalize_required', v_finalize);
end;
$function$;

revoke all on function public.record_mercadopago_payment_snapshot(uuid, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.record_mercadopago_payment_snapshot(uuid, jsonb, text, uuid) to service_role;

CREATE OR REPLACE FUNCTION public.enqueue_checkout_provider_probes(p_limit integer DEFAULT 50)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_inserted integer;
begin
  with candidatos as (
    select pi.id, pi.provider_payment_id
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where cs.completed_order_id is null
       and pi.order_id is null
       -- El comprador llego a ver Mercado Pago: sin preferencia no hay nada que
       -- preguntar, porque nunca hubo donde pagar.
       and nullif(btrim(coalesce(pi.preference_id, '')), '') is not null
       and nullif(btrim(coalesce(pi.external_reference, '')), '') is not null
       and pi.internal_status not in (
         'completed', 'refunded', 'partially_refunded', 'charged_back',
         'security_review_required'
       )
       -- 48 horas, igual que la alerta CHECKOUT_PROVIDER_UNVERIFIED. Las dos
       -- ventanas tienen que coincidir: si la alerta abarcara mas que la sonda,
       -- habria checkouts marcados como «no sabemos» que nadie va a consultar.
       and cs.created_at > clock_timestamp() - interval '48 hours'
       and cs.created_at < clock_timestamp() - interval '90 seconds'
       and not exists (
         select 1 from public.payment_outbox po
          where po.payment_intent_id = pi.id
            and po.topic = 'payment_reconcile'
            and po.status in ('pending', 'claimed', 'processing', 'retry_wait')
       )
       and (
         select count(*) from public.payment_events pe
          where pe.payment_intent_id = pi.id
            and pe.event_type = 'payment.provider_probe_empty'
       ) < 8
       and not exists (
         select 1 from public.payment_events pe
          where pe.payment_intent_id = pi.id
            and pe.event_type = 'payment.provider_probe_empty'
            and pe.server_recorded_at > clock_timestamp() - interval '2 minutes'
       )
     order by cs.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  )
  insert into public.payment_outbox (payment_intent_id, topic, resource_id)
  select c.id, 'payment_reconcile', c.provider_payment_id
    from candidatos c
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return coalesce(v_inserted, 0);
end;
$function$;

revoke all on function public.enqueue_checkout_provider_probes(integer) from public, anon, authenticated;
grant execute on function public.enqueue_checkout_provider_probes(integer) to service_role;

commit;
