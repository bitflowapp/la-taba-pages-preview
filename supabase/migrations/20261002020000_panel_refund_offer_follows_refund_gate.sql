-- TABA · EL PANEL OFRECE EL REEMBOLSO QUE LA BASE ACEPTA, NI MÁS NI MENOS
--
-- QUÉ ESTABA ROTO (medido el 2026-10-02 sobre las 190 migraciones de la rama: cada
-- cobro se armó por el camino real y se le preguntó lo mismo al Panel y a la base)
--
--   20261001204000 amplió lo que `prepare_payment_refund_v2` acepta reembolsar. La
--   lista de pagos del Panel (`list_business_payments.can_refund`) tenía su propia
--   copia de la regla, escrita a mano, y quedó con la anterior:
--
--     cobro                                                      Panel   la base
--     en revisión por un snapshot sin preferencia, y después
--       verificado aprobado por el importe esperado               no     acepta
--     en revisión porque la finalización no tenía el punto de
--       entrega confirmado                                        no     acepta
--     con pedido y un reclamo abierto (no un contracargo)         no     acepta
--     en revisión y ya devuelto entero                            sí     rechaza (22023)
--
--   En los tres primeros el dinero está, el pedido no, y el Panel no ofrecía
--   devolverlo aunque la base lo admite. En el último el Panel ofrecía un reembolso
--   que la base rechaza siempre.
--
-- QUÉ CAMBIA
--
--   · `private.payment_refund_refusal(cobro)`: por qué un pedido NUEVO de reembolso
--     por el saldo no sería aceptado, o NULL si lo sería. Es la regla de
--     `prepare_payment_refund_v2`, en su mismo orden: estado del cobro, contracargo
--     abierto, saldo.
--   · `list_business_payments`: `can_refund` pasa a ser «dueño o encargado, y esa
--     función no encuentra motivo». Es el único cambio: el resto de la función es su
--     definición vigente, generada de la definición viva con ese reemplazo, contado.
--
-- QUÉ NO CAMBIA
--
--   · `prepare_payment_refund_v2`, ni una letra: qué se puede reembolsar lo sigue
--     decidiendo ella. Mientras conserve su propia copia de la regla, lo que impide
--     que las dos se vuelvan a separar es la prueba
--     `payment_refund_and_reversal_chain_test.sql`, que les hace la misma pregunta a
--     las dos por cada estado de un cobro y exige la misma respuesta.
--   · Con un reembolso en curso `can_refund` sigue en verdadero, como antes: la base
--     contesta con la solicitud que ya existe y no se envía nada.
--   · El resto de la fila del Panel; la firma, SECURITY DEFINER, `search_path` y los
--     permisos de `list_business_payments`.
--   · No toca filas.
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261002020000_panel_refund_offer_follows_refund_gate.rollback.sql

-- ── 1. La regla, en un solo lugar ───────────────────────────────────────────
create or replace function private.payment_refund_refusal(p_intent public.payment_intents)
returns text
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    -- Con pedido: completo o devuelto en parte. Sin pedido: en revisión, y sólo
    -- dinero que consta (los dos motivos de siempre, o un cobro que un snapshot
    -- válido dejó aprobado por el importe esperado). El `coalesce` no es decorativo:
    -- con un motivo distinto y el estado del proveedor en NULL la expresión da NULL.
    when (p_intent).provider_payment_id is null
      or not coalesce(
        ((p_intent).order_id is not null
          and (p_intent).internal_status in ('completed', 'partially_refunded'))
        or ((p_intent).order_id is null
          and (p_intent).internal_status = 'security_review_required'
          and ((p_intent).security_review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation')
            or ((p_intent).provider_status = 'approved' and (p_intent).paid_amount = (p_intent).expected_amount))),
        false)
      then 'payment_not_refundable_in_current_state'
    when exists (
      select 1 from public.payment_disputes d
       where d.payment_intent_id = (p_intent).id
         and d.dispute_type = 'chargeback'
         and d.resolved_at is null)
      then 'open_chargeback'
    -- Con una solicitud en curso la base no crea otra: devuelve esa. Sin ninguna,
    -- un pedido por el saldo necesita que quede saldo.
    when not exists (
      select 1 from public.payment_refunds r
       where r.payment_intent_id = (p_intent).id
         and r.status in ('requested', 'processing', 'ambiguous'))
      and coalesce((p_intent).paid_amount, (p_intent).expected_amount) - (p_intent).refunded_amount <= 0
      then 'nothing_left_to_refund'
  end
$$;

revoke all on function private.payment_refund_refusal(public.payment_intents)
  from public, anon, authenticated, service_role;

comment on function private.payment_refund_refusal(public.payment_intents) is
  'Por que un pedido nuevo de reembolso por el saldo de este cobro no seria aceptado (estado, contracargo abierto, sin saldo), o NULL si lo seria. La misma regla que prepare_payment_refund_v2; la usa la lista de pagos del Panel.';

-- ── 2. La lista de pagos del Panel ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_business_payments(p_business_id uuid)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
    -- La misma regla que `prepare_payment_refund_v2`, no una copia: el Panel
    -- ofrece el reembolso exactamente cuando la base lo aceptaría.
    'can_refund', v_can_operate and private.payment_refund_refusal(pi) is null,
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
$function$;

revoke all on function public.list_business_payments(uuid) from public, anon, authenticated;
grant execute on function public.list_business_payments(uuid) to authenticated;
