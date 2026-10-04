-- REVERSIÓN de 20261002023000_revive_dead_lettered_payment_read_job.sql
--
-- Quita `revive_payment_outbox_job`, devuelve `list_business_payments` a su cuerpo
-- anterior, exacto (el de `pg_get_functiondef` sobre la base previa a esta
-- migración, es decir el que deja 20261002020000: no se reescribió a mano), y quita
-- el índice parcial de los trabajos en `dead_letter`.
--
-- Qué vuelve a quedar abierto: un trabajo de lectura de pagos en `dead_letter` no
-- tiene cómo volver a la cola (PAY-06).
--
-- `payment_outbox_revivals` es el registro de quién volvió a poner en marcha cada
-- trabajo y por qué. Si tiene filas, la reversión se niega: exportar la tabla y
-- vaciarla antes. Vacía, se la lleva.
--
-- Orden: se revierte ANTES que 20261002020000 (las dos redefinen
-- `list_business_payments`).
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261002023000
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261002023000', 0)
);

-- Se niega a correr si otra migración redefinió alguna de estas funciones después de
-- 20261002023000: su cuerpo vivo tiene que ser el que dejó esa migración o el anterior
-- (el anterior permite correr la reversión dos veces).
do $redefinition_guard$
declare
  v_row record;
  v_actual text;
begin
  for v_row in
    select * from (values
      ('public.list_business_payments(uuid)', '281f609e8eacf7fc0de89f641f7d530f', '101808b1ef9847bfc161b7f441f9df92')
    ) as t(signature, applied, previous)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into v_actual
      from pg_proc p where p.oid = to_regprocedure(v_row.signature);
    if v_actual is null or v_actual not in (v_row.applied, v_row.previous) then
      raise exception 'ROLLBACK_BLOCKED: % no tiene el cuerpo de 20261002023000 ni el anterior; otra migracion la redefinio despues: revertir esa primero', v_row.signature
        using errcode = 'P0001';
    end if;
  end loop;
end
$redefinition_guard$;

do $guard$
declare
  v_rows integer := 0;
begin
  -- Si la tabla ya no está (la reversión se corrió dos veces) no hay nada que cuidar.
  if to_regclass('public.payment_outbox_revivals') is not null then
    execute 'select count(*) from public.payment_outbox_revivals' into v_rows;
  end if;
  if v_rows > 0 then
    raise exception 'ROLLBACK_BLOCKED: payment_outbox_revivals tiene % fila(s) de auditoria; exportarlas y vaciar la tabla antes de revertir', v_rows;
  end if;
end
$guard$;

drop function if exists public.revive_payment_outbox_job(uuid, text);

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

drop index if exists public.payment_outbox_dead_letter_idx;
drop table if exists public.payment_outbox_revivals;

commit;
