-- Mercado Pago Checkout Pro lifecycle: server-side preferences, durable
-- verification and exactly-once paid-order fulfillment. Provider credentials
-- never enter PostgreSQL; Edge Functions are the only API callers.

-- A retry can reacquire inventory after a terminal non-paid attempt without
-- ever reusing or converting an earlier reservation.
alter table public.inventory_reservations
  add column if not exists reservation_generation integer not null default 1;

alter table public.inventory_reservations
  drop constraint if exists inventory_reservations_checkout_session_id_product_id_key;

alter table public.inventory_reservations
  add constraint inventory_reservations_session_product_generation_key
  unique (checkout_session_id, product_id, reservation_generation);

alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_status_check;

alter table public.checkout_sessions
  add constraint checkout_sessions_status_check
  check (status in (
    'created', 'validating', 'ready_for_payment', 'redirected',
    'payment_pending', 'payment_approved', 'finalizing_order', 'completed',
    'expired', 'cancelled', 'retrying', 'manual_review_required'
  ));

create or replace function public.release_checkout_session_inventory(
  p_checkout_session_id uuid,
  p_reason text,
  p_terminal_status text default 'cancelled'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_session public.checkout_sessions%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_released integer := 0;
  v_status text := lower(btrim(coalesce(p_terminal_status, 'cancelled')));
begin
  if v_status not in ('cancelled', 'expired') then
    raise exception 'estado terminal de reserva invalido' using errcode = '22023';
  end if;
  select * into v_session
    from public.checkout_sessions s
   where s.id = p_checkout_session_id
   for update;
  if not found then
    raise exception 'checkout inexistente' using errcode = 'P0002';
  end if;
  if v_session.status in ('completed', 'payment_approved', 'finalizing_order', 'manual_review_required') then
    return jsonb_build_object('released', 0, 'skipped', true, 'status', v_session.status);
  end if;

  -- Products are locked in deterministic order before stock is restored.
  perform 1
    from public.products p
    join public.inventory_reservations r on r.product_id = p.id
   where r.checkout_session_id = v_session.id and r.status = 'active'
   order by p.id
   for update;
  for v_reservation in
    select * from public.inventory_reservations r
     where r.checkout_session_id = v_session.id and r.status = 'active'
     order by r.product_id, r.reservation_generation
     for update
  loop
    update public.products p
       set stock = p.stock + v_reservation.quantity,
           available = p.is_active and p.is_verified and (p.stock + v_reservation.quantity) > 0
     where p.id = v_reservation.product_id;
    update public.inventory_reservations
       set status = 'released', released_at = clock_timestamp(),
           release_reason = left(coalesce(p_reason, 'terminal'), 120)
     where id = v_reservation.id and status = 'active';
    v_released := v_released + 1;
  end loop;
  update public.checkout_sessions
     set status = v_status
   where id = v_session.id
     and status not in ('completed', 'payment_approved', 'finalizing_order', 'manual_review_required');
  update public.payment_intents
     set internal_status = case
       when public.payment_internal_status_rank(internal_status) < public.payment_internal_status_rank(v_status)
         then v_status else internal_status end
   where checkout_session_id = v_session.id;
  return jsonb_build_object('released', v_released, 'status', v_status);
end;
$$;

create or replace function public.expire_checkout_sessions(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_session_id uuid;
  v_count integer := 0;
begin
  for v_session_id in
    select s.id
      from public.checkout_sessions s
     where s.expires_at <= clock_timestamp()
       and s.status in ('created', 'validating', 'ready_for_payment', 'redirected', 'payment_pending')
     order by s.expires_at
     limit greatest(1, least(coalesce(p_limit, 100), 500))
     for update skip locked
  loop
    perform public.release_checkout_session_inventory(v_session_id, 'checkout_expired', 'expired');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.reacquire_checkout_session_inventory(
  p_checkout_session_id uuid,
  p_reason text default 'payment_retry'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_session public.checkout_sessions%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_generation integer;
  v_expires_at timestamptz;
begin
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found then raise exception 'checkout inexistente' using errcode = 'P0002'; end if;
  if v_session.expires_at <= clock_timestamp()
    or v_session.status not in ('cancelled', 'expired', 'retrying') then
    raise exception 'checkout no admite una nueva reserva' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.inventory_reservations r
     where r.checkout_session_id = v_session.id and r.status = 'active'
  ) then
    return jsonb_build_object('reacquired', false, 'reason', 'active_reservation_exists');
  end if;
  select * into v_settings from public.business_payment_settings s
   where s.business_id = v_session.business_id and s.provider = 'mercadopago' for share;
  if not found or not v_settings.enabled or not v_settings.reserve_stock then
    raise exception 'pagos online no configurados' using errcode = '55000';
  end if;
  v_expires_at := clock_timestamp() + make_interval(mins => v_settings.preference_expiration_minutes);
  select coalesce(max(reservation_generation), 0) + 1 into v_generation
    from public.inventory_reservations where checkout_session_id = v_session.id;
  perform 1 from public.products p
    join public.checkout_session_items i on i.product_id = p.id
   where i.checkout_session_id = v_session.id
   order by p.id for update;
  for v_item in
    select i.product_id, i.quantity from public.checkout_session_items i
     where i.checkout_session_id = v_session.id order by i.product_id
  loop
    select * into v_product from public.products p where p.id = v_item.product_id for update;
    if not found or not v_product.is_active or not v_product.is_verified or not v_product.available
      or v_product.price_status <> 'confirmed' or v_product.stock is null or v_product.stock < v_item.quantity then
      raise exception 'stock o publicacion no disponible para reintento' using errcode = '23514';
    end if;
    update public.products set stock = stock - v_item.quantity,
      available = (stock - v_item.quantity) > 0
    where id = v_item.product_id;
    insert into public.inventory_reservations (
      checkout_session_id, product_id, quantity, expires_at, reservation_generation
    ) values (v_session.id, v_item.product_id, v_item.quantity, v_expires_at, v_generation);
  end loop;
  update public.checkout_sessions
     set expires_at = v_expires_at, status = 'ready_for_payment', manual_review_reason = null
   where id = v_session.id;
  return jsonb_build_object('reacquired', true, 'expires_at', v_expires_at, 'reason', left(coalesce(p_reason, ''), 120));
end;
$$;

create or replace function public.prepare_mercadopago_preference(
  p_checkout_session_id uuid,
  p_customer_id uuid,
  p_new_attempt boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_number integer;
  v_items jsonb;
begin
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found or v_session.customer_id <> p_customer_id then
    raise exception 'checkout no autorizado' using errcode = '42501';
  end if;
  if v_session.expires_at <= clock_timestamp() then
    perform public.release_checkout_session_inventory(v_session.id, 'preference_expired', 'expired');
    raise exception 'checkout vencido' using errcode = '55000';
  end if;
  select * into v_intent from public.payment_intents pi where pi.checkout_session_id = v_session.id for update;
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  select * into v_settings from public.business_payment_settings s
   where s.business_id = v_session.business_id and s.provider = 'mercadopago' for share;
  if not found or not v_settings.enabled or not v_settings.reserve_stock
    or v_settings.checkout_mode <> 'checkout_pro' or v_settings.currency <> 'ARS'
    or (v_settings.environment = 'production' and v_settings.production_review_status <> 'approved') then
    raise exception 'Mercado Pago no esta habilitado' using errcode = '55000';
  end if;
  if v_session.status in ('completed', 'payment_approved', 'finalizing_order', 'manual_review_required') then
    raise exception 'checkout no admite otra preferencia' using errcode = '55000';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.product_id::text,
    'title', coalesce(i.product_snapshot ->> 'name', 'Producto TABA2'),
    'description', nullif(i.product_snapshot ->> 'presentation', ''),
    'quantity', i.quantity, 'currency_id', 'ARS', 'unit_price', i.unit_price
  ) order by i.product_id), '[]'::jsonb) into v_items
  from public.checkout_session_items i where i.checkout_session_id = v_session.id;
  select * into v_attempt from public.payment_attempts pa
   where pa.payment_intent_id = v_intent.id and pa.attempt_type = 'preference'
   order by pa.attempt_number desc limit 1 for update;
  if found and not p_new_attempt and v_attempt.status in ('prepared', 'request_sent', 'created', 'ambiguous') then
    return jsonb_build_object(
      'checkout_session_id', v_session.id, 'payment_intent_id', v_intent.id,
      'payment_attempt_id', v_attempt.id, 'attempt_status', v_attempt.status,
      'attempt_number', v_attempt.attempt_number, 'idempotency_key', v_attempt.idempotency_key,
      'preference_id', v_attempt.preference_id, 'init_point', v_attempt.init_point,
      'sandbox_init_point', v_attempt.sandbox_init_point, 'external_reference', v_intent.external_reference,
      'environment', v_intent.environment, 'currency', 'ARS', 'total', v_intent.expected_amount,
      'expires_at', v_session.expires_at, 'items', v_items,
      'allow_offline_payment_methods', v_settings.allow_offline_payment_methods,
      'installments_limit', v_settings.installments_limit
    );
  end if;
  if p_new_attempt then
    if v_intent.internal_status not in ('rejected', 'cancelled', 'expired', 'failed') then
      raise exception 'el pago actual no admite un nuevo intento controlado' using errcode = '55000';
    end if;
    if v_session.status in ('cancelled', 'expired', 'retrying') then
      perform public.reacquire_checkout_session_inventory(v_session.id, 'payment_retry');
      select * into v_session from public.checkout_sessions s where s.id = v_session.id for update;
    end if;
  elsif found and v_attempt.status in ('failed', 'cancelled') then
    raise exception 'solicita un nuevo intento de pago' using errcode = '55000';
  end if;
  if not exists (select 1 from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' and r.expires_at > clock_timestamp()) then
    raise exception 'reserva de stock no valida' using errcode = '55000';
  end if;
  select coalesce(max(pa.attempt_number), 0) + 1 into v_number
    from public.payment_attempts pa where pa.payment_intent_id = v_intent.id and pa.attempt_type = 'preference';
  insert into public.payment_attempts (payment_intent_id, attempt_number, attempt_type, status)
  values (v_intent.id, v_number, 'preference', 'prepared') returning * into v_attempt;
  update public.payment_intents
     set internal_status = case when internal_status in ('created', 'ambiguous', 'preference_creating', 'preference_created', 'redirected')
                                then 'preference_creating' else internal_status end
   where id = v_intent.id;
  return jsonb_build_object(
    'checkout_session_id', v_session.id, 'payment_intent_id', v_intent.id,
    'payment_attempt_id', v_attempt.id, 'attempt_status', v_attempt.status,
    'attempt_number', v_attempt.attempt_number, 'idempotency_key', v_attempt.idempotency_key,
    'preference_id', null, 'init_point', null, 'sandbox_init_point', null,
    'external_reference', v_intent.external_reference, 'environment', v_intent.environment,
    'currency', 'ARS', 'total', v_intent.expected_amount, 'expires_at', v_session.expires_at,
    'items', v_items, 'allow_offline_payment_methods', v_settings.allow_offline_payment_methods,
    'installments_limit', v_settings.installments_limit
  );
end;
$$;

create or replace function public.record_mercadopago_preference_created(
  p_payment_attempt_id uuid, p_preference_id text, p_init_point text,
  p_sandbox_init_point text, p_response_hash text, p_provider_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_attempt public.payment_attempts%rowtype; v_intent public.payment_intents%rowtype;
begin
  if p_preference_id is null or btrim(p_preference_id) = '' or p_response_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'respuesta de preferencia invalida' using errcode = '22023';
  end if;
  select * into v_attempt from public.payment_attempts pa where pa.id = p_payment_attempt_id for update;
  if not found then raise exception 'attempt inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_attempt.payment_intent_id for update;
  update public.payment_attempts set preference_id = left(btrim(p_preference_id), 200),
    init_point = nullif(left(btrim(coalesce(p_init_point, '')), 2048), ''),
    sandbox_init_point = nullif(left(btrim(coalesce(p_sandbox_init_point, '')), 2048), ''),
    provider_request_id = nullif(left(btrim(coalesce(p_provider_request_id, '')), 200), ''),
    response_hash = p_response_hash, status = 'created' where id = v_attempt.id;
  update public.payment_intents set preference_id = left(btrim(p_preference_id), 200),
    preference_created_at = coalesce(preference_created_at, clock_timestamp()), raw_response_hash = p_response_hash,
    internal_status = case when internal_status in ('created', 'ambiguous', 'preference_creating') then 'preference_created' else internal_status end
  where id = v_intent.id;
  update public.checkout_sessions set status = case when status = 'ready_for_payment' then 'redirected' else status end where id = v_intent.checkout_session_id;
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id);
end;
$$;

create or replace function public.record_mercadopago_preference_uncertain(
  p_payment_attempt_id uuid, p_request_hash text, p_error_code text
)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_intent_id uuid;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  update public.payment_attempts set status = 'ambiguous', request_hash = p_request_hash,
    last_error_code = left(coalesce(p_error_code, 'network_or_timeout'), 120)
   where id = p_payment_attempt_id returning payment_intent_id into v_intent_id;
  if v_intent_id is null then raise exception 'attempt inexistente' using errcode = 'P0002'; end if;
  update public.payment_intents set internal_status = case when internal_status = 'preference_creating' then 'ambiguous' else internal_status end where id = v_intent_id;
  return true;
end;
$$;

create or replace function public.record_mercadopago_preference_failed(
  p_payment_attempt_id uuid, p_response_hash text, p_error_code text
)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_response_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  update public.payment_attempts set status = 'failed', response_hash = p_response_hash,
    last_error_code = left(coalesce(p_error_code, 'provider_error'), 120) where id = p_payment_attempt_id;
  if not found then raise exception 'attempt inexistente' using errcode = 'P0002'; end if;
  return true;
end;
$$;

create or replace function public.record_mercadopago_webhook_receipt(
  p_environment text,
  p_webhook_event_id text,
  p_event_type text,
  p_resource_id text,
  p_signature_valid boolean,
  p_request_id text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_receipt public.payment_webhook_receipts%rowtype;
  v_topic text;
  v_job_id uuid;
begin
  if lower(btrim(coalesce(p_environment, ''))) not in ('test', 'production')
    or nullif(btrim(p_webhook_event_id), '') is null
    or nullif(btrim(p_event_type), '') is null
    or nullif(btrim(p_resource_id), '') is null
    or p_payload_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'receipt de webhook invalido' using errcode = '22023';
  end if;
  insert into public.payment_webhook_receipts (
    environment, webhook_event_id, event_type, resource_id, signature_valid,
    request_id, payload_hash, processing_status
  ) values (
    lower(btrim(p_environment)), left(btrim(p_webhook_event_id), 200),
    left(lower(btrim(p_event_type)), 120), left(btrim(p_resource_id), 200),
    p_signature_valid, nullif(left(btrim(coalesce(p_request_id, '')), 200), ''), p_payload_hash,
    case when p_signature_valid then 'received' else 'rejected_signature' end
  ) on conflict (provider, environment, webhook_event_id, event_type, resource_id) do nothing
  returning * into v_receipt;
  if not found then
    select * into v_receipt from public.payment_webhook_receipts r
     where r.provider = 'mercadopago' and r.environment = lower(btrim(p_environment))
       and r.webhook_event_id = left(btrim(p_webhook_event_id), 200)
       and r.event_type = left(lower(btrim(p_event_type)), 120)
       and r.resource_id = left(btrim(p_resource_id), 200)
     for update;
    update public.payment_webhook_receipts set attempt_count = attempt_count + 1,
      processing_status = case when processing_status = 'received' then 'duplicate' else processing_status end
    where id = v_receipt.id;
    return jsonb_build_object('receipt_id', v_receipt.id, 'duplicate', true, 'queued', false);
  end if;
  if not p_signature_valid then
    return jsonb_build_object('receipt_id', v_receipt.id, 'duplicate', false, 'queued', false);
  end if;
  v_topic := case
    when lower(p_event_type) like '%chargeback%' then 'chargeback'
    when lower(p_event_type) like '%claim%' then 'claim'
    when lower(p_event_type) like '%payment%' then 'payment'
    else null
  end;
  if v_topic is null then
    update public.payment_webhook_receipts set processing_status = 'completed', processed_at = clock_timestamp() where id = v_receipt.id;
    return jsonb_build_object('receipt_id', v_receipt.id, 'duplicate', false, 'queued', false);
  end if;
  insert into public.payment_outbox (webhook_receipt_id, topic, resource_id)
  values (v_receipt.id, v_topic, left(btrim(p_resource_id), 200))
  on conflict (webhook_receipt_id) where webhook_receipt_id is not null do nothing
  returning id into v_job_id;
  update public.payment_webhook_receipts set processing_status = 'queued' where id = v_receipt.id;
  return jsonb_build_object('receipt_id', v_receipt.id, 'duplicate', false, 'queued', v_job_id is not null);
end;
$$;

create or replace function public.claim_payment_outbox(
  p_owner text, p_limit integer default 20, p_lease_seconds integer default 90
)
returns setof public.payment_outbox
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if nullif(btrim(p_owner), '') is null then raise exception 'owner requerido' using errcode = '22023'; end if;
  return query
  with candidate as (
    select o.id
      from public.payment_outbox o
     where (
       (o.status in ('pending', 'retry_wait') and o.next_attempt_at <= clock_timestamp())
       or (o.status in ('claimed', 'processing') and coalesce(o.lease_expires_at, '-infinity'::timestamptz) < clock_timestamp())
     )
     order by o.next_attempt_at, o.created_at
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  )
  update public.payment_outbox o
     set status = 'claimed', owner = left(btrim(p_owner), 200),
         lease_expires_at = clock_timestamp() + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 90), 600))),
         attempts = o.attempts + 1
    from candidate c
   where o.id = c.id
  returning o.*;
end;
$$;

create or replace function public.start_payment_outbox_job(p_job_id uuid, p_owner text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_receipt_id uuid;
begin
  update public.payment_outbox set status = 'processing'
   where id = p_job_id and owner = p_owner and status = 'claimed' and lease_expires_at > clock_timestamp()
   returning webhook_receipt_id into v_receipt_id;
  if not found then return false; end if;
  if v_receipt_id is not null then
    update public.payment_webhook_receipts set processing_status = 'processing', attempt_count = attempt_count + 1 where id = v_receipt_id;
  end if;
  return true;
end;
$$;

create or replace function public.complete_payment_outbox_job(p_job_id uuid, p_owner text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_receipt_id uuid;
begin
  update public.payment_outbox set status = 'completed', completed_at = clock_timestamp(), lease_expires_at = null
   where id = p_job_id and owner = p_owner and status = 'processing'
   returning webhook_receipt_id into v_receipt_id;
  if not found then return false; end if;
  if v_receipt_id is not null then
    update public.payment_webhook_receipts set processing_status = 'completed', processed_at = clock_timestamp() where id = v_receipt_id;
  end if;
  return true;
end;
$$;

create or replace function public.fail_payment_outbox_job(p_job_id uuid, p_owner text, p_error_code text)
returns text
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_job public.payment_outbox%rowtype; v_status text;
begin
  select * into v_job from public.payment_outbox o where o.id = p_job_id and o.owner = p_owner for update;
  if not found or v_job.status <> 'processing' then return null; end if;
  v_status := case when v_job.attempts >= 8 then 'dead_letter' else 'retry_wait' end;
  update public.payment_outbox set status = v_status, lease_expires_at = null,
    last_error = left(coalesce(p_error_code, 'worker_failed'), 160),
    next_attempt_at = case when v_status = 'dead_letter' then next_attempt_at
      else clock_timestamp() + make_interval(secs => least(3600, 15 * (2 ^ least(v_job.attempts, 8))::integer)) end
   where id = v_job.id;
  if v_job.webhook_receipt_id is not null then
    update public.payment_webhook_receipts set processing_status = v_status, last_error = left(coalesce(p_error_code, 'worker_failed'), 160)
     where id = v_job.webhook_receipt_id;
  end if;
  return v_status;
end;
$$;

create or replace function public.find_payment_intent_by_external_reference(
  p_environment text, p_external_reference text
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_intent public.payment_intents%rowtype;
begin
  select * into v_intent from public.payment_intents pi
   where pi.environment = lower(btrim(coalesce(p_environment, '')))
     and pi.external_reference = btrim(coalesce(p_external_reference, ''))
   for share;
  if not found then raise exception 'referencia de pago desconocida' using errcode = 'P0002'; end if;
  return jsonb_build_object('payment_intent_id', v_intent.id, 'checkout_session_id', v_intent.checkout_session_id);
end;
$$;

create or replace function public.record_mercadopago_payment_snapshot(
  p_payment_intent_id uuid,
  p_snapshot jsonb,
  p_source text,
  p_webhook_receipt_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
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
  elsif v_settings.application_id is null or p_snapshot ->> 'application_id' is distinct from v_settings.application_id then
    v_valid := false; v_reason := 'application_mismatch';
  elsif v_currency <> 'ARS' or v_currency <> v_intent.currency then
    v_valid := false; v_reason := 'currency_mismatch';
  elsif v_amount is null or v_amount <> v_intent.expected_amount then
    v_valid := false; v_reason := 'amount_mismatch';
  elsif coalesce((p_snapshot ->> 'live_mode')::boolean, false) is distinct from (v_intent.environment = 'production') then
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
$$;

create or replace function public.finalize_paid_checkout_session(p_checkout_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_order public.orders%rowtype;
  v_item record;
  v_reservation public.inventory_reservations%rowtype;
  v_code text;
  v_tracking_token text;
begin
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found then raise exception 'checkout inexistente' using errcode = 'P0002'; end if;
  if v_session.completed_order_id is not null or v_session.status = 'completed' then
    return jsonb_build_object('ok', true, 'order_id', v_session.completed_order_id, 'idempotent', true);
  end if;
  select * into v_intent from public.payment_intents pi where pi.checkout_session_id = v_session.id for update;
  if not found or v_intent.internal_status not in ('approved_order_pending', 'approved')
    or v_intent.provider_status <> 'approved' or v_intent.paid_amount <> v_session.total or v_intent.currency <> 'ARS' then
    raise exception 'pago no aprobado verificadamente' using errcode = '55000';
  end if;
  if v_session.expires_at <= clock_timestamp() or not exists (
    select 1 from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' and r.expires_at > clock_timestamp()
  ) then
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'finalization_without_active_reservation' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'finalization_without_active_reservation' where id = v_session.id;
    return jsonb_build_object('ok', false, 'manual_review_required', true);
  end if;
  update public.checkout_sessions set status = 'finalizing_order' where id = v_session.id;
  loop
    v_code := public.next_order_public_code();
    exit when not exists (select 1 from public.orders o where o.code = v_code or o.public_code = v_code);
  end loop;
  insert into public.orders (
    business_id, code, public_code, status, fulfillment_type, delivery_mode,
    customer_user_id, client_request_id, client_request_fingerprint, currency_code,
    customer_name, customer_phone, customer_whatsapp, address_label,
    customer_street_address, customer_neighborhood, customer_reference,
    payment_method, subtotal, delivery_fee, total
  ) values (
    v_session.business_id, v_code, v_code, 'received', v_session.fulfillment_type, v_session.fulfillment_type,
    v_session.customer_id, 'mp_' || replace(v_session.id::text, '-', ''), v_session.normalized_intent_hash, 'ARS',
    v_session.contact_snapshot ->> 'name', v_session.contact_snapshot ->> 'phone', v_session.contact_snapshot ->> 'phone',
    coalesce(v_session.address_snapshot ->> 'label', case when v_session.fulfillment_type = 'delivery' then 'Entrega' else null end),
    v_session.address_snapshot ->> 'street', v_session.address_snapshot ->> 'city', v_session.address_snapshot ->> 'reference',
    'mercadopago', v_session.subtotal, v_session.delivery_fee, v_session.total
  ) returning * into v_order;
  for v_item in select * from public.checkout_session_items i where i.checkout_session_id = v_session.id order by i.product_id loop
    insert into public.order_items (order_id, product_id, product_uuid, name, quantity, unit, unit_price, subtotal)
    values (v_order.id, v_item.product_id::text, v_item.product_id, coalesce(v_item.product_snapshot ->> 'name', 'Producto TABA2'),
      v_item.quantity, nullif(v_item.product_snapshot ->> 'presentation', ''), v_item.unit_price, v_item.subtotal);
  end loop;
  for v_reservation in select * from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' order by r.product_id for update loop
    update public.inventory_reservations set status = 'converted', converted_at = clock_timestamp() where id = v_reservation.id and status = 'active';
  end loop;
  insert into public.order_events (order_id, business_id, actor_user_id, actor_role, actor_type, event_type, type, message, metadata, payload)
  values (v_order.id, v_session.business_id, v_session.customer_id, 'customer', 'customer', 'order.received', 'order.received',
    'Pedido recibido y pago aprobado', jsonb_build_object('source', 'mercadopago_checkout_pro', 'payment_intent_id', v_intent.id),
    jsonb_build_object('source', 'mercadopago_checkout_pro', 'payment_intent_id', v_intent.id));
  v_tracking_token := encode(gen_random_bytes(32), 'hex');
  insert into public.order_public_tokens (order_id, token, token_hash, expires_at)
  values (v_order.id, null, digest(v_tracking_token, 'sha256'), clock_timestamp() + interval '30 days');
  update public.payment_intents set order_id = v_order.id, internal_status = 'completed' where id = v_intent.id;
  update public.checkout_sessions set completed_order_id = v_order.id, status = 'completed' where id = v_session.id;
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (v_intent.id, 'payment.order_completed', jsonb_build_object('order_id', v_order.id));
  return jsonb_build_object('ok', true, 'order_id', v_order.id, 'order_code', v_order.public_code, 'idempotent', false);
end;
$$;

create or replace function public.record_mercadopago_dispute_snapshot(
  p_payment_intent_id uuid, p_dispute_type text, p_snapshot jsonb
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_intent public.payment_intents%rowtype; v_type text := lower(btrim(coalesce(p_dispute_type, '')));
declare v_dispute public.payment_disputes%rowtype;
begin
  if v_type not in ('chargeback', 'claim') or p_snapshot is null
    or coalesce(p_snapshot ->> 'raw_response_hash', '') !~ '^[a-f0-9]{64}$'
    or nullif(btrim(coalesce(p_snapshot ->> 'provider_dispute_id', '')), '') is null then
    raise exception 'snapshot de disputa invalido' using errcode = '22023';
  end if;
  select * into v_intent from public.payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found or p_snapshot ->> 'provider_payment_id' is distinct from v_intent.provider_payment_id then
    raise exception 'disputa no coincide con el pago' using errcode = '22023';
  end if;
  insert into public.payment_disputes (
    payment_intent_id, provider_dispute_id, dispute_type, status, coverage_eligible,
    documentation_required, documentation_status, due_at, raw_response_hash, opened_at, resolved_at
  ) values (
    v_intent.id, left(btrim(p_snapshot ->> 'provider_dispute_id'), 200), v_type,
    left(lower(coalesce(p_snapshot ->> 'status', 'open')), 120),
    coalesce((p_snapshot ->> 'coverage_eligible')::boolean, false),
    coalesce((p_snapshot ->> 'documentation_required')::boolean, false),
    nullif(left(btrim(coalesce(p_snapshot ->> 'documentation_status', '')), 120), ''),
    nullif(p_snapshot ->> 'due_at', '')::timestamptz,
    p_snapshot ->> 'raw_response_hash', nullif(p_snapshot ->> 'opened_at', '')::timestamptz,
    nullif(p_snapshot ->> 'resolved_at', '')::timestamptz
  ) on conflict (provider_dispute_id, dispute_type) do update
    set status = excluded.status, coverage_eligible = excluded.coverage_eligible,
      documentation_required = excluded.documentation_required, documentation_status = excluded.documentation_status,
      due_at = excluded.due_at, raw_response_hash = excluded.raw_response_hash,
      opened_at = coalesce(public.payment_disputes.opened_at, excluded.opened_at), resolved_at = excluded.resolved_at
  returning * into v_dispute;
  if v_type = 'chargeback' and v_dispute.resolved_at is null then
    update public.payment_intents set internal_status = 'charged_back' where id = v_intent.id;
  end if;
  insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash)
  values (v_intent.id, 'payment.' || v_type, jsonb_build_object('dispute_id', v_dispute.id, 'status', v_dispute.status), p_snapshot ->> 'raw_response_hash');
  return jsonb_build_object('ok', true, 'dispute_id', v_dispute.id);
end;
$$;

create or replace function public.enqueue_payment_reconciliation(p_payment_intent_id uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_intent public.payment_intents%rowtype; v_job uuid;
begin
  select * into v_intent from public.payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found or v_actor is null or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'reconciliacion no autorizada' using errcode = '42501';
  end if;
  if v_intent.provider_payment_id is null then raise exception 'pago aun sin identificador de proveedor' using errcode = '55000'; end if;
  insert into public.payment_outbox (payment_intent_id, topic, resource_id)
  values (v_intent.id, 'payment_reconcile', v_intent.provider_payment_id)
  returning id into v_job;
  return jsonb_build_object('queued', true, 'job_id', v_job, 'idempotent', false);
exception when unique_violation then
  return jsonb_build_object('queued', true, 'idempotent', true);
end;
$$;

create or replace function public.prepare_payment_refund(
  p_payment_intent_id uuid, p_amount numeric, p_idempotency_key uuid, p_reason text
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_intent public.payment_intents%rowtype; v_refund public.payment_refunds%rowtype;
declare v_remaining numeric(12,2); v_amount numeric(12,2);
begin
  if v_actor is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then raise exception 'reembolso no autorizado' using errcode = '42501'; end if;
  if v_intent.provider_payment_id is null or v_intent.order_id is null or v_intent.internal_status not in ('completed', 'partially_refunded') then raise exception 'pago no reembolsable en su estado actual' using errcode = '55000'; end if;
  if exists (select 1 from public.payment_disputes d where d.payment_intent_id = v_intent.id and d.dispute_type = 'chargeback' and d.resolved_at is null) then raise exception 'reembolso bloqueado por contracargo abierto' using errcode = '55000'; end if;
  select * into v_refund from public.payment_refunds r where r.idempotency_key = p_idempotency_key for update;
  if found then
    if v_refund.payment_intent_id <> v_intent.id then raise exception 'idempotency key pertenece a otro reembolso' using errcode = '23505'; end if;
    return jsonb_build_object('refund_id', v_refund.id, 'provider_payment_id', v_intent.provider_payment_id, 'amount', v_refund.amount, 'idempotency_key', v_refund.idempotency_key, 'idempotent', true, 'reconciliation_required', v_refund.status = 'ambiguous');
  end if;
  -- Never replace an ambiguous outbound financial request with a new UUID.
  select * into v_refund from public.payment_refunds r where r.payment_intent_id = v_intent.id and r.status in ('requested', 'processing', 'ambiguous') order by r.requested_at asc limit 1 for update;
  if found then
    return jsonb_build_object('refund_id', v_refund.id, 'provider_payment_id', v_intent.provider_payment_id, 'amount', v_refund.amount, 'idempotency_key', v_refund.idempotency_key, 'idempotent', true, 'reconciliation_required', true);
  end if;
  v_remaining := coalesce(v_intent.paid_amount, v_intent.expected_amount) - v_intent.refunded_amount;
  v_amount := coalesce(p_amount, v_remaining);
  if v_amount <= 0 or v_amount > v_remaining then raise exception 'importe de reembolso invalido' using errcode = '22023'; end if;
  insert into public.payment_refunds (payment_intent_id, order_id, idempotency_key, amount, requested_by, reason)
  values (v_intent.id, v_intent.order_id, p_idempotency_key, v_amount, v_actor, nullif(left(btrim(coalesce(p_reason, '')), 300), '')) returning * into v_refund;
  return jsonb_build_object('refund_id', v_refund.id, 'provider_payment_id', v_intent.provider_payment_id, 'amount', v_refund.amount, 'idempotency_key', v_refund.idempotency_key, 'full_refund', v_refund.amount = coalesce(v_intent.paid_amount, v_intent.expected_amount), 'idempotent', false);
end;
$$;

create or replace function public.record_payment_refund_response(
  p_refund_id uuid, p_provider_refund_id text, p_status text, p_amount numeric, p_response_hash text
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_refund public.payment_refunds%rowtype; v_intent public.payment_intents%rowtype; v_total numeric(12,2);
begin
  if p_response_hash !~ '^[a-f0-9]{64}$' or p_status not in ('approved', 'rejected', 'ambiguous', 'failed') or p_amount is null or p_amount <= 0 then raise exception 'respuesta de reembolso invalida' using errcode = '22023'; end if;
  select * into v_refund from public.payment_refunds r where r.id = p_refund_id for update;
  if not found then raise exception 'reembolso inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_refund.payment_intent_id for update;
  if p_amount <> v_refund.amount then
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'refund_amount_mismatch' where id = v_intent.id;
    raise exception 'importe de reembolso no coincide' using errcode = '22023';
  end if;
  update public.payment_refunds set provider_refund_id = nullif(left(btrim(coalesce(p_provider_refund_id, '')), 200), ''), status = p_status,
    raw_response_hash = p_response_hash, completed_at = case when p_status in ('approved', 'rejected') then clock_timestamp() else completed_at end where id = v_refund.id;
  if p_status = 'approved' then
    select coalesce(sum(r.amount), 0) into v_total from public.payment_refunds r where r.payment_intent_id = v_intent.id and r.status = 'approved';
    update public.payment_intents set refunded_amount = v_total, internal_status = case when v_total >= coalesce(v_intent.paid_amount, v_intent.expected_amount) then 'refunded' else 'partially_refunded' end where id = v_intent.id;
  end if;
  insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash) values (v_intent.id, 'payment.refund_' || p_status, jsonb_build_object('refund_id', v_refund.id, 'amount', p_amount), p_response_hash);
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id);
end;
$$;

create or replace function public.prepare_payment_cancellation(
  p_payment_intent_id uuid, p_idempotency_key uuid
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_intent public.payment_intents%rowtype; v_cancellation public.payment_cancellations%rowtype;
begin
  if v_actor is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then raise exception 'cancelacion no autorizada' using errcode = '42501'; end if;
  if v_intent.provider_payment_id is null or v_intent.internal_status not in ('pending', 'in_process') then raise exception 'pago no cancelable en su estado actual' using errcode = '55000'; end if;
  select * into v_cancellation from public.payment_cancellations c where c.idempotency_key = p_idempotency_key for update;
  if found then
    if v_cancellation.payment_intent_id <> v_intent.id then raise exception 'idempotency key pertenece a otra cancelacion' using errcode = '23505'; end if;
    return jsonb_build_object('cancellation_id', v_cancellation.id, 'provider_payment_id', v_intent.provider_payment_id, 'idempotency_key', v_cancellation.idempotency_key, 'idempotent', true, 'reconciliation_required', v_cancellation.status = 'ambiguous');
  end if;
  select * into v_cancellation from public.payment_cancellations c where c.payment_intent_id = v_intent.id and c.status in ('requested', 'processing', 'ambiguous') order by c.requested_at asc limit 1 for update;
  if found then
    return jsonb_build_object('cancellation_id', v_cancellation.id, 'provider_payment_id', v_intent.provider_payment_id, 'idempotency_key', v_cancellation.idempotency_key, 'idempotent', true, 'reconciliation_required', true);
  end if;
  insert into public.payment_cancellations (payment_intent_id, idempotency_key, requested_by)
  values (v_intent.id, p_idempotency_key, v_actor) returning * into v_cancellation;
  return jsonb_build_object('cancellation_id', v_cancellation.id, 'provider_payment_id', v_intent.provider_payment_id, 'idempotency_key', v_cancellation.idempotency_key, 'idempotent', false);
end;
$$;

create or replace function public.record_payment_cancellation_response(
  p_cancellation_id uuid, p_status text, p_response_hash text
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_cancellation public.payment_cancellations%rowtype; v_intent public.payment_intents%rowtype;
begin
  if p_status not in ('cancelled', 'rejected', 'ambiguous', 'failed') or p_response_hash !~ '^[a-f0-9]{64}$' then raise exception 'respuesta de cancelacion invalida' using errcode = '22023'; end if;
  select * into v_cancellation from public.payment_cancellations c where c.id = p_cancellation_id for update;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_cancellation.payment_intent_id for update;
  update public.payment_cancellations set status = p_status, raw_response_hash = p_response_hash,
    completed_at = case when p_status in ('cancelled', 'rejected') then clock_timestamp() else completed_at end where id = v_cancellation.id;
  if p_status = 'cancelled' then
    update public.payment_intents set internal_status = case when public.payment_internal_status_rank(internal_status) < public.payment_internal_status_rank('cancelled') then 'cancelled' else internal_status end where id = v_intent.id;
    perform public.release_checkout_session_inventory(v_intent.checkout_session_id, 'owner_cancelled_payment', 'cancelled');
  end if;
  insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash) values (v_intent.id, 'payment.cancellation_' || p_status, jsonb_build_object('cancellation_id', v_cancellation.id), p_response_hash);
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id);
end;
$$;

create or replace function public.mark_payment_refund_ambiguous(
  p_refund_id uuid, p_request_hash text, p_error_code text
)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_refund public.payment_refunds%rowtype;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  select * into v_refund from public.payment_refunds r where r.id = p_refund_id for update;
  if not found then raise exception 'reembolso inexistente' using errcode = 'P0002'; end if;
  update public.payment_refunds set status = 'ambiguous', raw_response_hash = p_request_hash where id = v_refund.id;
  insert into public.payment_outbox (payment_intent_id, refund_id, topic, resource_id, last_error)
  values (v_refund.payment_intent_id, v_refund.id, 'refund_reconcile', null, left(coalesce(p_error_code, 'network_or_timeout'), 160));
  return true;
end;
$$;

create or replace function public.mark_payment_cancellation_ambiguous(
  p_cancellation_id uuid, p_request_hash text, p_error_code text
)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_cancellation public.payment_cancellations%rowtype; v_intent public.payment_intents%rowtype;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  select * into v_cancellation from public.payment_cancellations c where c.id = p_cancellation_id for update;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_cancellation.payment_intent_id for share;
  update public.payment_cancellations set status = 'ambiguous', raw_response_hash = p_request_hash where id = v_cancellation.id;
  insert into public.payment_outbox (payment_intent_id, cancellation_id, topic, resource_id, last_error)
  values (v_cancellation.payment_intent_id, v_cancellation.id, 'cancellation_reconcile', v_intent.provider_payment_id, left(coalesce(p_error_code, 'network_or_timeout'), 160));
  return true;
end;
$$;

create or replace function public.list_business_payments(p_business_id uuid)
returns setof jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.has_business_role(p_business_id, array['owner', 'admin']) then raise exception 'pagos no autorizados' using errcode = '42501'; end if;
  return query
  select jsonb_build_object(
    'payment_intent_id', pi.id, 'order_public_code', o.public_code,
    'amount', coalesce(pi.paid_amount, pi.expected_amount), 'currency', pi.currency,
    'method', pi.provider_payment_method, 'provider_status', pi.provider_status,
    'provider_status_detail', pi.provider_status_detail, 'internal_status', pi.internal_status,
    'created_at', pi.created_at, 'approved_at', pi.approved_at,
    'payment_id_short', case when pi.provider_payment_id is null then null else right(pi.provider_payment_id, 6) end,
    'refunded_amount', pi.refunded_amount, 'latest_refund_status', refund.status,
    'dispute_type', dispute.dispute_type, 'dispute_status', dispute.status,
    'documentation_required', coalesce(dispute.documentation_required, false),
    'can_reconcile', pi.provider_payment_id is not null and pi.internal_status not in ('completed', 'refunded', 'charged_back'),
    'can_refund', pi.order_id is not null and pi.internal_status in ('completed', 'partially_refunded') and dispute.id is null,
    'can_cancel', pi.provider_payment_id is not null and pi.internal_status in ('pending', 'in_process')
  )
  from public.payment_intents pi
  left join public.orders o on o.id = pi.order_id
  left join lateral (select r.status from public.payment_refunds r where r.payment_intent_id = pi.id order by r.requested_at desc limit 1) refund on true
  left join lateral (select d.id, d.dispute_type, d.status, d.documentation_required from public.payment_disputes d where d.payment_intent_id = pi.id and d.resolved_at is null order by d.created_at desc limit 1) dispute on true
  where pi.business_id = p_business_id order by pi.created_at desc limit 200;
end;
$$;

create unique index if not exists payment_outbox_reconciliation_active_key
  on public.payment_outbox (payment_intent_id, topic)
  where topic = 'payment_reconcile' and status in ('pending', 'claimed', 'processing', 'retry_wait');

revoke all on function public.release_checkout_session_inventory(uuid, text, text) from public, anon, authenticated;
revoke all on function public.expire_checkout_sessions(integer) from public, anon, authenticated;
revoke all on function public.reacquire_checkout_session_inventory(uuid, text) from public, anon, authenticated;
revoke all on function public.prepare_mercadopago_preference(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.record_mercadopago_preference_created(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.record_mercadopago_preference_uncertain(uuid, text, text) from public, anon, authenticated;
revoke all on function public.record_mercadopago_preference_failed(uuid, text, text) from public, anon, authenticated;
revoke all on function public.record_mercadopago_webhook_receipt(text, text, text, text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.claim_payment_outbox(text, integer, integer) from public, anon, authenticated;
revoke all on function public.start_payment_outbox_job(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_payment_outbox_job(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_payment_outbox_job(uuid, text, text) from public, anon, authenticated;
revoke all on function public.find_payment_intent_by_external_reference(text, text) from public, anon, authenticated;
revoke all on function public.record_mercadopago_payment_snapshot(uuid, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.finalize_paid_checkout_session(uuid) from public, anon, authenticated;
revoke all on function public.record_mercadopago_dispute_snapshot(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_payment_refund_response(uuid, text, text, numeric, text) from public, anon, authenticated;
revoke all on function public.record_payment_cancellation_response(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mark_payment_refund_ambiguous(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mark_payment_cancellation_ambiguous(uuid, text, text) from public, anon, authenticated;
revoke all on function public.enqueue_payment_reconciliation(uuid) from public, anon;
revoke all on function public.prepare_payment_refund(uuid, numeric, uuid, text) from public, anon;
revoke all on function public.prepare_payment_cancellation(uuid, uuid) from public, anon;
revoke all on function public.list_business_payments(uuid) from public, anon;

grant execute on function public.prepare_mercadopago_preference(uuid, uuid, boolean) to service_role;
grant execute on function public.record_mercadopago_preference_created(uuid, text, text, text, text, text) to service_role;
grant execute on function public.record_mercadopago_preference_uncertain(uuid, text, text) to service_role;
grant execute on function public.record_mercadopago_preference_failed(uuid, text, text) to service_role;
grant execute on function public.record_mercadopago_webhook_receipt(text, text, text, text, boolean, text, text) to service_role;
grant execute on function public.claim_payment_outbox(text, integer, integer) to service_role;
grant execute on function public.start_payment_outbox_job(uuid, text) to service_role;
grant execute on function public.complete_payment_outbox_job(uuid, text) to service_role;
grant execute on function public.fail_payment_outbox_job(uuid, text, text) to service_role;
grant execute on function public.find_payment_intent_by_external_reference(text, text) to service_role;
grant execute on function public.record_mercadopago_payment_snapshot(uuid, jsonb, text, uuid) to service_role;
grant execute on function public.finalize_paid_checkout_session(uuid) to service_role;
grant execute on function public.record_mercadopago_dispute_snapshot(uuid, text, jsonb) to service_role;
grant execute on function public.record_payment_refund_response(uuid, text, text, numeric, text) to service_role;
grant execute on function public.record_payment_cancellation_response(uuid, text, text) to service_role;
grant execute on function public.mark_payment_refund_ambiguous(uuid, text, text) to service_role;
grant execute on function public.mark_payment_cancellation_ambiguous(uuid, text, text) to service_role;
grant execute on function public.enqueue_payment_reconciliation(uuid) to authenticated;
grant execute on function public.prepare_payment_refund(uuid, numeric, uuid, text) to authenticated;
grant execute on function public.prepare_payment_cancellation(uuid, uuid) to authenticated;
grant execute on function public.list_business_payments(uuid) to authenticated;

comment on function public.finalize_paid_checkout_session(uuid) is
  'Exactly-once paid-order finalization: locks checkout, payment and reservation, creates one operational order and never decrements stock twice.';
comment on function public.claim_payment_outbox(text, integer, integer) is
  'Durable payment worker claim using FOR UPDATE SKIP LOCKED, bounded lease, retry backoff and dead-letter state.';
