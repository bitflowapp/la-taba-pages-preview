-- P0 payment recovery: human-readable operator state, safe requeue and
-- sanitized support context. All mutations still run through the existing
-- locked RPCs and the payment worker; the browser never creates an order.

create or replace function public.sanitize_payment_diagnostic(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select nullif(left(regexp_replace(
    regexp_replace(
      coalesce(p_value, ''),
      '(?i)(authorization|access[_ -]?token|api[_ -]?key|secret|card|cvv|raw[_ -]?payload)[[:space:]]*[:=][^[:space:],;]+',
      '[oculto]',
      'g'
    ),
    '[[:space:]]+', ' ', 'g'
  ), 200), '');
$$;

create unique index if not exists payment_outbox_reconciliation_active_key
  on public.payment_outbox (payment_intent_id, topic)
  where topic = 'payment_reconcile' and status in ('pending', 'claimed', 'processing', 'retry_wait');

create or replace function public.enqueue_payment_reconciliation(p_payment_intent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_intent public.payment_intents%rowtype;
  v_job uuid;
begin
  select * into v_intent
    from public.payment_intents pi
   where pi.id = p_payment_intent_id
   for update;
  if not found or v_actor is null
    or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'reconciliacion no autorizada' using errcode = '42501';
  end if;
  if v_intent.internal_status in ('completed', 'refunded', 'partially_refunded', 'charged_back') then
    return jsonb_build_object(
      'queued', false,
      'terminal', true,
      'idempotent', true,
      'internal_status', v_intent.internal_status,
      'order_id', v_intent.order_id
    );
  end if;
  if v_intent.provider_payment_id is null then
    raise exception 'pago aun sin identificador de proveedor' using errcode = '55000';
  end if;
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
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_intent public.payment_intents%rowtype;
  v_refund public.payment_refunds%rowtype;
  v_remaining numeric(12, 2);
  v_amount numeric(12, 2);
  v_refundable_without_order boolean;
begin
  if v_actor is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  select * into v_intent
    from public.payment_intents pi
   where pi.id = p_payment_intent_id
   for update;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'reembolso no autorizado' using errcode = '42501';
  end if;
  v_refundable_without_order := v_intent.order_id is null
    and v_intent.internal_status = 'security_review_required'
    and v_intent.security_review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation');
  if v_intent.provider_payment_id is null
    or (
      not v_refundable_without_order
      and (v_intent.order_id is null or v_intent.internal_status not in ('completed', 'partially_refunded'))
    )
    or (v_refundable_without_order is false and v_intent.internal_status not in ('completed', 'partially_refunded')) then
    raise exception 'pago no reembolsable en su estado actual' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.payment_disputes d
     where d.payment_intent_id = v_intent.id
       and d.dispute_type = 'chargeback'
       and d.resolved_at is null
  ) then
    raise exception 'reembolso bloqueado por contracargo abierto' using errcode = '55000';
  end if;
  select * into v_refund
    from public.payment_refunds r
   where r.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_refund.payment_intent_id <> v_intent.id then
      raise exception 'idempotency key pertenece a otro reembolso' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'refund_id', v_refund.id,
      'provider_payment_id', v_intent.provider_payment_id,
      'amount', v_refund.amount,
      'idempotency_key', v_refund.idempotency_key,
      'idempotent', true,
      'reconciliation_required', v_refund.status = 'ambiguous'
    );
  end if;
  -- Never replace an ambiguous outbound financial request with a new UUID.
  select * into v_refund
    from public.payment_refunds r
   where r.payment_intent_id = v_intent.id
     and r.status in ('requested', 'processing', 'ambiguous')
   order by r.requested_at asc
   limit 1
   for update;
  if found then
    return jsonb_build_object(
      'refund_id', v_refund.id,
      'provider_payment_id', v_intent.provider_payment_id,
      'amount', v_refund.amount,
      'idempotency_key', v_refund.idempotency_key,
      'idempotent', true,
      'reconciliation_required', true
    );
  end if;
  v_remaining := coalesce(v_intent.paid_amount, v_intent.expected_amount) - v_intent.refunded_amount;
  v_amount := coalesce(p_amount, v_remaining);
  if v_amount <= 0 or v_amount > v_remaining then
    raise exception 'importe de reembolso invalido' using errcode = '22023';
  end if;
  insert into public.payment_refunds (
    payment_intent_id, order_id, idempotency_key, amount, requested_by, reason
  ) values (
    v_intent.id, v_intent.order_id, p_idempotency_key, v_amount, v_actor,
    nullif(left(btrim(coalesce(p_reason, '')), 300), '')
  ) returning * into v_refund;
  return jsonb_build_object(
    'refund_id', v_refund.id,
    'provider_payment_id', v_intent.provider_payment_id,
    'amount', v_refund.amount,
    'idempotency_key', v_refund.idempotency_key,
    'full_refund', v_refund.amount = coalesce(v_intent.paid_amount, v_intent.expected_amount),
    'idempotent', false
  );
end;
$$;

create or replace function public.record_payment_refund_response(
  p_refund_id uuid, p_provider_refund_id text, p_status text, p_amount numeric, p_response_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_refund public.payment_refunds%rowtype;
  v_intent public.payment_intents%rowtype;
  v_total numeric(12, 2);
begin
  if p_response_hash !~ '^[a-f0-9]{64}$'
    or p_status not in ('approved', 'rejected', 'ambiguous', 'failed')
    or p_amount is null or p_amount <= 0 then
    raise exception 'respuesta de reembolso invalida' using errcode = '22023';
  end if;
  select * into v_refund from public.payment_refunds r where r.id = p_refund_id for update;
  if not found then raise exception 'reembolso inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_refund.payment_intent_id for update;
  if p_amount <> v_refund.amount then
    update public.payment_intents
       set internal_status = 'security_review_required', security_review_reason = 'refund_amount_mismatch'
     where id = v_intent.id;
    raise exception 'importe de reembolso no coincide' using errcode = '22023';
  end if;
  update public.payment_refunds
     set provider_refund_id = nullif(left(btrim(coalesce(p_provider_refund_id, '')), 200)),
         status = p_status,
         raw_response_hash = p_response_hash,
         completed_at = case when p_status in ('approved', 'rejected') then clock_timestamp() else completed_at end
   where id = v_refund.id;
  if p_status = 'approved' then
    select coalesce(sum(r.amount), 0) into v_total
      from public.payment_refunds r
     where r.payment_intent_id = v_intent.id and r.status = 'approved';
    -- A payment that was held for stock review remains visibly held for review;
    -- the approved refund is exposed through the refund state without allowing
    -- the monotonic payment state trigger to erase the security hold.
    if v_intent.internal_status = 'security_review_required' then
      update public.payment_intents set refunded_amount = v_total where id = v_intent.id;
    else
      update public.payment_intents
         set refunded_amount = v_total,
             internal_status = case
               when v_total >= coalesce(v_intent.paid_amount, v_intent.expected_amount) then 'refunded'
               else 'partially_refunded'
             end
       where id = v_intent.id;
    end if;
  end if;
  insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash)
  values (v_intent.id, 'payment.refund_' || p_status, jsonb_build_object('refund_id', v_refund.id, 'amount', p_amount), p_response_hash);
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id);
end;
$$;

create or replace function public.list_business_payments(p_business_id uuid)
returns setof jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_can_operate boolean;
begin
  if v_actor is null or not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'pagos no autorizados' using errcode = '42501';
  end if;
  v_can_operate := public.has_business_role(p_business_id, array['owner', 'admin']);
  return query
  select jsonb_build_object(
    'payment_intent_id', pi.id,
    'checkout_session_id', pi.checkout_session_id,
    'order_id', pi.order_id,
    'order_public_code', o.public_code,
    'customer_label', case
      when nullif(btrim(coalesce(o.customer_name, cs.contact_snapshot ->> 'customer_name', '')), '') is null then null
      else left(btrim(coalesce(o.customer_name, cs.contact_snapshot ->> 'customer_name', '')), 1) || '…'
    end,
    'amount', coalesce(pi.paid_amount, pi.expected_amount),
    'currency', pi.currency,
    'method', pi.provider_payment_method,
    'provider_status', pi.provider_status,
    'provider_status_detail', public.sanitize_payment_diagnostic(pi.provider_status_detail),
    'internal_status', pi.internal_status,
    'security_review_reason', case when pi.internal_status = 'security_review_required' then pi.security_review_reason else null end,
    'created_at', pi.created_at,
    'approved_at', pi.approved_at,
    'last_update_at', greatest(pi.updated_at, coalesce(worker.updated_at, pi.updated_at), coalesce(attempts.last_attempt_at, pi.updated_at)),
    'attempt_count', coalesce(attempts.attempt_count, 0),
    'last_attempt_at', attempts.last_attempt_at,
    'payment_id_short', case when pi.provider_payment_id is null then null else right(pi.provider_payment_id, 6) end,
    'refunded_amount', pi.refunded_amount,
    'latest_refund_status', refund.status,
    'dispute_type', dispute.dispute_type,
    'dispute_status', dispute.status,
    'documentation_required', coalesce(dispute.documentation_required, false),
    'reservation_state', case
      when exists (
        select 1 from public.inventory_reservations r
         where r.checkout_session_id = pi.checkout_session_id
           and r.status = 'active' and r.expires_at > clock_timestamp()
      ) then 'active'
      when exists (
        select 1 from public.inventory_reservations r
         where r.checkout_session_id = pi.checkout_session_id
           and r.expires_at <= clock_timestamp()
      ) then 'expired'
      else 'none'
    end,
    'processing_state', case
      when pi.internal_status in ('completed', 'refunded', 'partially_refunded', 'rejected', 'cancelled', 'expired', 'charged_back') then 'Procesamiento normal'
      when worker.status in ('failed', 'dead_letter') then 'Requiere atención'
      when worker.status in ('claimed', 'processing') and coalesce(worker.lease_expires_at, '-infinity'::timestamptz) < clock_timestamp() then 'Sin progreso'
      when worker.status in ('pending', 'retry_wait') and worker.next_attempt_at > clock_timestamp() then 'Reintento programado'
      when worker.status in ('pending', 'retry_wait') then 'Procesamiento demorado'
      when pi.updated_at < clock_timestamp() - interval '15 minutes' then 'Sin progreso'
      else 'Procesamiento normal'
    end,
    'worker_status', worker.status,
    'worker_attempts', coalesce(worker.attempts, 0),
    'worker_next_attempt_at', worker.next_attempt_at,
    'worker_lease_expires_at', worker.lease_expires_at,
    'worker_last_error', public.sanitize_payment_diagnostic(worker.last_error),
    'correlation_id', 'pay_' || right(replace(pi.id::text, '-', ''), 12),
    'can_operate', v_can_operate,
    'can_reconcile', v_can_operate and pi.provider_payment_id is not null and pi.internal_status not in ('completed', 'refunded', 'partially_refunded', 'charged_back', 'security_review_required', 'rejected', 'cancelled', 'expired'),
    'can_refund', v_can_operate and pi.provider_payment_id is not null and (
      (pi.order_id is not null and pi.internal_status in ('completed', 'partially_refunded'))
      or (pi.order_id is null and pi.internal_status = 'security_review_required' and pi.security_review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation'))
    ) and dispute.id is null,
    'can_cancel', v_can_operate and pi.provider_payment_id is not null and pi.internal_status in ('pending', 'in_process')
  )
  from public.payment_intents pi
  left join public.checkout_sessions cs on cs.id = pi.checkout_session_id
  left join public.orders o on o.id = pi.order_id
  left join lateral (
    select r.status
      from public.payment_refunds r
     where r.payment_intent_id = pi.id
     order by r.requested_at desc
     limit 1
  ) refund on true
  left join lateral (
    select d.id, d.dispute_type, d.status, d.documentation_required
      from public.payment_disputes d
     where d.payment_intent_id = pi.id and d.resolved_at is null
     order by d.created_at desc
     limit 1
  ) dispute on true
  left join lateral (
    select count(*)::integer as attempt_count, max(pa.updated_at) as last_attempt_at
      from public.payment_attempts pa
     where pa.payment_intent_id = pi.id
  ) attempts on true
  left join lateral (
    select po.status, po.attempts, po.next_attempt_at, po.lease_expires_at, po.last_error, po.updated_at
      from public.payment_outbox po
     where po.payment_intent_id = pi.id and po.topic in ('payment', 'payment_reconcile')
     order by po.created_at desc
     limit 1
  ) worker on true
  where pi.business_id = p_business_id
  order by pi.created_at desc
  limit 200;
end;
$$;

revoke all on function public.sanitize_payment_diagnostic(text) from public, anon, authenticated;
grant execute on function public.enqueue_payment_reconciliation(uuid) to authenticated;
grant execute on function public.prepare_payment_refund(uuid, numeric, uuid, text) to authenticated;
grant execute on function public.record_payment_refund_response(uuid, text, text, numeric, text) to service_role;
grant execute on function public.list_business_payments(uuid) to authenticated;

comment on function public.enqueue_payment_reconciliation(uuid) is
  'Owner/admin-only exactly-once requeue. Locks the payment and refuses to enqueue terminal states.';
comment on function public.list_business_payments(uuid) is
  'Owner/admin/staff consultation view with human states, minimized customer context and sanitized technical diagnostics.';
