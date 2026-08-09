-- ============================================================================
--  El botón de reconciliar estaba apagado justo en el caso que importa.
-- ============================================================================
--
--  MEDIDO (bloque C8 del drill de intake): cuando el comprador paga en Mercado
--  Pago y no vuelve, este lado nunca se entera del pago, así que
--  `payment_intents.provider_payment_id` queda en NULL. Y tanto la bandera que
--  la UI usa para habilitar la acción —`can_reconcile` en
--  `list_business_payments`— como la acción misma —`enqueue_payment_reconciliation`—
--  exigían que ese identificador existiera:
--
--    can_reconcile ... `pi.provider_payment_id is not null and ...`
--    enqueue ......... raise 'pago aun sin identificador de proveedor'
--
--  O sea: el operador podía reconciliar los pagos que ya conocíamos, y no podía
--  reconciliar los únicos que hacía falta ir a buscar. Es la definición de una
--  herramienta que sirve cuando no se necesita.
--
--  Ahora alcanza con la referencia externa, que existe desde que se crea el
--  intent y es lo que Mercado Pago indexa. El worker resuelve el pago por esa
--  referencia (mercadopago-payment-worker) y lo pasa por la verificación de
--  siempre. No se relaja ninguna assertion comercial: sólo deja de exigirse un
--  dato que, por definición del problema, todavía no tenemos.
--
--  Los estados terminales de dinero siguen cerrados: un pago completado,
--  reembolsado o con contracargo no se vuelve a consultar.
-- ============================================================================

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
  -- Basta la referencia externa: el worker resuelve el pago por ella cuando
  -- todavía no conocemos el identificador del proveedor.
  if v_intent.provider_payment_id is null
    and nullif(btrim(coalesce(v_intent.external_reference, '')), '') is null then
    raise exception 'pago sin referencia consultable' using errcode = '55000';
  end if;
  insert into public.payment_outbox (payment_intent_id, topic, resource_id)
  values (v_intent.id, 'payment_reconcile', v_intent.provider_payment_id)
  returning id into v_job;
  return jsonb_build_object('queued', true, 'job_id', v_job, 'idempotent', false);
exception when unique_violation then
  return jsonb_build_object('queued', true, 'idempotent', true);
end;
$$;

-- Un cobro aprobado que nunca llegó a ser pedido se puede rearmar desde el
-- Panel (`recover_paid_checkout_order`, 20260809210000). Esta es la bandera que
-- decide si el botón se ofrece; vive acá para que la consulta de pagos tenga una
-- sola definición.
create or replace function public.can_recover_paid_checkout(p_payment_intent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where pi.id = p_payment_intent_id
       and pi.order_id is null
       and cs.completed_order_id is null
       and pi.provider_status = 'approved'
       and pi.paid_amount is not distinct from cs.total
       and pi.internal_status not in ('refunded', 'partially_refunded', 'charged_back', 'completed')
  );
$$;

revoke all on function public.can_recover_paid_checkout(uuid) from public, anon;
grant execute on function public.can_recover_paid_checkout(uuid) to authenticated, service_role;

comment on function public.can_recover_paid_checkout(uuid) is
  'Verdadero cuando hay un cobro aprobado sin pedido que se puede rearmar desde el Panel.';

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
    -- Alcanza con poder preguntarle al proveedor. Se habilita también sobre
    -- `expired` y `security_review_required`, que son exactamente los estados
    -- donde hace falta ir a mirar si hubo un cobro.
    'can_reconcile', v_can_operate
      and (pi.provider_payment_id is not null or nullif(btrim(coalesce(pi.external_reference, '')), '') is not null)
      and pi.internal_status not in ('completed', 'refunded', 'partially_refunded', 'charged_back'),
    'can_refund', v_can_operate and pi.provider_payment_id is not null and (
      (pi.order_id is not null and pi.internal_status in ('completed', 'partially_refunded'))
      or (pi.order_id is null and pi.internal_status = 'security_review_required' and pi.security_review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation'))
    ) and dispute.id is null,
    'can_cancel', v_can_operate and pi.provider_payment_id is not null and pi.internal_status in ('pending', 'in_process'),
    -- Rearmar el pedido de un cobro que entró: la salida que faltaba cuando la
    -- reserva venció y la única alternativa era devolver el dinero.
    'can_recover_order', v_can_operate and public.can_recover_paid_checkout(pi.id)
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

grant execute on function public.enqueue_payment_reconciliation(uuid) to authenticated;
grant execute on function public.list_business_payments(uuid) to authenticated;

comment on function public.enqueue_payment_reconciliation(uuid) is
  'Owner/admin-only exactly-once requeue. Alcanza con la referencia externa; los estados terminales de dinero siguen cerrados.';
comment on function public.list_business_payments(uuid) is
  'Consulta de pagos con estados humanos. can_reconcile se habilita también sobre expired y revisión de seguridad.';
