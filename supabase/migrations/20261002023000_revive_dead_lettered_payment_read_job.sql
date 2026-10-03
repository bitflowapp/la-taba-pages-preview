-- TABA · UN TRABAJO DE LECTURA DE PAGOS QUE AGOTÓ SUS INTENTOS SE PUEDE VOLVER A PONER EN MARCHA
--
-- QUÉ ESTABA ROTO (auditoría, PAY-06; reproducido el 2026-10-02 sobre las 190
-- migraciones de la rama)
--
--   Un trabajo de la cola de pagos reintenta con espera creciente y al octavo fallo
--   queda en `dead_letter`: alrededor de una hora con Mercado Pago caído o con la
--   credencial rechazada. Desde ahí no había camino de vuelta:
--     · ninguna función saca un trabajo de `dead_letter`;
--     · `claim_payment_outbox_v2` no lo vuelve a tomar;
--     · la reentrega del mismo aviso contesta `duplicate` y no encola nada;
--     · «consultar al proveedor» (`enqueue_payment_reconciliation`) contesta
--       `terminal` sobre un cobro que ya tiene pedido.
--   El caso que duele: el aviso de un reembolso o de un contracargo sobre un pedido ya
--   cobrado. Si ese trabajo muere, el cobro queda `completed` para siempre con el
--   dinero devuelto, y nada lo vuelve a leer.
--
-- QUÉ CAMBIA
--
--   · `revive_payment_outbox_job(trabajo, motivo)`, para el dueño o el encargado del
--     comercio de ese trabajo (la misma autoridad que `resolve_stuck_payment_refund`).
--     Vuelve a poner en la cola un trabajo en `dead_letter` de los que sólo LEEN al
--     proveedor: el aviso de un pago, de un contracargo o de un reclamo, y la consulta
--     de un pago. Lo deja para UN intento más: conserva la cuenta de intentos, así
--     que si vuelve a fallar vuelve a `dead_letter` sin otra ronda de reintentos.
--     Repetir la llamada mientras el trabajo está en la cola no hace nada.
--   · Los trabajos de conciliación de un reembolso o de una cancelación no se reaniman
--     por acá: asientan el resultado de una operación de dinero que pidió una persona.
--     La respuesta (`topic_not_revivable`) dice por dónde seguir: para el reembolso,
--     `resolve_stuck_payment_refund`, que vuelve a encolar su conciliación con sus
--     propias comprobaciones; para la cancelación, consultar el pago
--     (`enqueue_payment_reconciliation`), que deja el cobro en su estado real. La
--     solicitud de cancelación dudosa no tiene hoy otra salida: queda para soporte.
--   · `payment_outbox_revivals`: una fila por reanimación, con quién, cuándo, por qué
--     y cómo estaba el trabajo (intentos y último error). El motivo es de la
--     operación: no admite un correo ni un teléfono. Si el cobro se conoce, queda
--     además el evento `payment.outbox_job_revived` en su historia.
--   · `list_business_payments` suma dos datos a cada cobro: `dead_letter_job_id` (el
--     trabajo de lectura de ese cobro que está en `dead_letter`, si hay) y
--     `can_revive_job`. Sin eso el dueño no tenía de dónde sacar el id. El resto de la
--     función es su definición vigente, generada de la definición viva con dos
--     inserciones, contadas.
--   · Un índice parcial sobre los trabajos en `dead_letter`: son pocos, y la lista del
--     Panel los busca por cada cobro.
--
-- QUÉ NO CAMBIA
--
--   · Las funciones de la cola (`claim_payment_outbox_v2`, `start_`, `complete_`,
--     `fail_payment_outbox_job`) y el asiento del pago: el trabajo reanimado corre por
--     el camino de siempre, que relee al proveedor y no escribe un snapshot repetido.
--   · Nada se relee solo: la reanimación la pide una persona, trabajo por trabajo.
--     Releer según un cronograma los cobros ya completados sigue sin hacerse (decisión
--     del dueño: cambia cuánto se consulta al proveedor).
--   · Con una entrega en pausa (`TABA_RELEASE_QUIESCED`) la reanimación falla, como
--     toda escritura sobre la cola.
--   · No toca filas.
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261002023000_revive_dead_lettered_payment_read_job.rollback.sql

-- ── 1. El rastro de cada reanimación ────────────────────────────────────────
create table if not exists public.payment_outbox_revivals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.payment_outbox(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete restrict,
  payment_intent_id uuid references public.payment_intents(id) on delete cascade,
  topic text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  reason text not null,
  previous_status text not null,
  previous_attempts integer not null,
  previous_last_error text,
  revived_at timestamptz not null default clock_timestamp(),
  constraint payment_outbox_revivals_reason_size check (char_length(reason) between 3 and 200),
  constraint payment_outbox_revivals_previous_status_check check (previous_status in ('dead_letter', 'failed')),
  constraint payment_outbox_revivals_previous_attempts_check check (previous_attempts >= 0)
);

create index if not exists payment_outbox_revivals_job_idx
  on public.payment_outbox_revivals (job_id, revived_at desc);
create index if not exists payment_outbox_revivals_business_idx
  on public.payment_outbox_revivals (business_id, revived_at desc);

comment on table public.payment_outbox_revivals is
  'Una fila por cada vez que una persona volvio a poner en la cola un trabajo de lectura de pagos que estaba en dead_letter: quien, cuando, por que y como estaba el trabajo. Solo la escribe revive_payment_outbox_job.';
comment on column public.payment_outbox_revivals.reason is
  'Motivo operativo que escribio quien reanimo el trabajo. No admite correos ni telefonos.';
comment on column public.payment_outbox_revivals.previous_attempts is
  'Intentos que llevaba el trabajo al reanimarlo. La cuenta no se reinicia.';

-- Sin políticas, a propósito: ningún rol de cliente la lee ni la escribe. La escribe
-- la función de abajo, que corre como su dueño, y la lee la clave de servicio.
alter table public.payment_outbox_revivals enable row level security;
revoke all on table public.payment_outbox_revivals from public, anon, authenticated, service_role;
grant select on table public.payment_outbox_revivals to service_role;

-- Los trabajos en `dead_letter` son pocos; sin este índice, buscarlos por cobro
-- recorre toda la cola.
create index if not exists payment_outbox_dead_letter_idx
  on public.payment_outbox (created_at desc)
  where status in ('dead_letter', 'failed');

-- ── 2. Reanimar un trabajo ──────────────────────────────────────────────────
create or replace function public.revive_payment_outbox_job(p_job_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(regexp_replace(coalesce(p_reason, ''), '[[:space:]]+', ' ', 'g'));
  v_job public.payment_outbox%rowtype;
  v_job_found boolean;
  v_receipt public.payment_webhook_receipts%rowtype;
  v_business_id uuid;
  v_intent_id uuid;
  v_intent_business uuid;
  v_other_job uuid;
  v_revival_id uuid;
begin
  if v_actor is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 3 and 200 then
    raise exception 'motivo requerido (3 a 200 caracteres)' using errcode = '22023';
  end if;
  -- El motivo queda escrito para siempre. Lo que se parece a un correo o a un
  -- teléfono no entra: es rastro de la operación, no del cliente.
  if v_reason ~ '@' or v_reason ~ '[0-9]{7,}' then
    raise exception 'el motivo no puede llevar datos de contacto' using errcode = '22023';
  end if;

  select * into v_job from public.payment_outbox o where o.id = p_job_id for update;
  v_job_found := found;
  if v_job_found then
    if v_job.payment_intent_id is not null then
      select pi.id, pi.business_id into v_intent_id, v_business_id
        from public.payment_intents pi
       where pi.id = v_job.payment_intent_id;
    elsif v_job.webhook_receipt_id is not null then
      -- El trabajo de un aviso nace sin cobro. El comercio es el que confirmó la
      -- lectura del pago al recibirlo; con credencial directa ese dato no existe y
      -- se usa el del cobro que tiene guardado ese pago, si hay uno.
      select * into v_receipt
        from public.payment_webhook_receipts r
       where r.id = v_job.webhook_receipt_id;
      if v_job.topic = 'payment' and v_job.resource_id is not null then
        select pi.id, pi.business_id into v_intent_id, v_intent_business
          from public.payment_intents pi
         where pi.provider = 'mercadopago'
           and pi.environment = v_receipt.environment
           and pi.provider_payment_id = v_job.resource_id;
      end if;
      v_business_id := coalesce(v_receipt.seller_business_id, v_intent_business);
      if v_intent_business is distinct from v_business_id then
        v_intent_id := null;
      end if;
    end if;
  end if;
  -- Una sola respuesta para «no existe», «no se sabe de quién es» y «no es tuyo».
  if not v_job_found or v_business_id is null
    or not public.has_business_role(v_business_id, array['owner', 'admin']) then
    raise exception 'reanimacion no autorizada' using errcode = '42501';
  end if;

  -- Sólo lo que relee al proveedor. Un reembolso o una cancelación a medias tienen
  -- su propia salida, con sus propias comprobaciones.
  if v_job.topic not in ('payment', 'chargeback', 'claim', 'payment_reconcile') then
    return jsonb_build_object(
      'ok', false, 'reason', 'topic_not_revivable', 'job_id', v_job.id, 'topic', v_job.topic,
      'action', case v_job.topic
        when 'refund_reconcile' then 'resolve_stuck_payment_refund'
        when 'cancellation_reconcile' then 'enqueue_payment_reconciliation'
        else 'resolver_con_soporte'
      end
    );
  end if;
  if v_job.status in ('pending', 'retry_wait', 'claimed', 'processing') then
    return jsonb_build_object(
      'ok', true, 'action', 'already_active', 'idempotent', true,
      'job_id', v_job.id, 'status', v_job.status
    );
  end if;
  if v_job.status not in ('dead_letter', 'failed') then
    return jsonb_build_object(
      'ok', false, 'reason', 'job_not_dead_lettered', 'job_id', v_job.id, 'status', v_job.status
    );
  end if;
  -- Una consulta de pago por cobro, como mucho, activa a la vez (índice único). Si
  -- ya hay otra en la cola, esa es la lectura que hace falta.
  if v_job.topic = 'payment_reconcile' then
    select o.id into v_other_job
      from public.payment_outbox o
     where o.payment_intent_id = v_job.payment_intent_id
       and o.topic = 'payment_reconcile'
       and o.status in ('pending', 'claimed', 'processing', 'retry_wait')
       and o.id <> v_job.id
     limit 1;
    if found then
      return jsonb_build_object(
        'ok', true, 'action', 'already_active', 'idempotent', true,
        'job_id', v_other_job, 'superseded_job_id', v_job.id
      );
    end if;
  end if;

  -- Un intento más, no una ronda nueva: con la cuenta en ocho o más, el próximo
  -- fallo lo devuelve a `dead_letter`. Un trabajo que falla siempre no puede quedar
  -- reintentando solo.
  begin
    update public.payment_outbox
       set status = 'pending', owner = null, lease_expires_at = null,
           next_attempt_at = clock_timestamp(),
           attempts = greatest(attempts, 8)
     where id = v_job.id;
  exception when unique_violation then
    -- Otra consulta del mismo cobro se encoló recién.
    return jsonb_build_object(
      'ok', true, 'action', 'already_active', 'idempotent', true, 'superseded_job_id', v_job.id
    );
  end;
  if v_job.webhook_receipt_id is not null then
    update public.payment_webhook_receipts
       set processing_status = 'queued'
     where id = v_job.webhook_receipt_id;
  end if;
  insert into public.payment_outbox_revivals (
    job_id, business_id, payment_intent_id, topic, actor_user_id, reason,
    previous_status, previous_attempts, previous_last_error
  ) values (
    v_job.id, v_business_id, v_intent_id, v_job.topic, v_actor, v_reason,
    v_job.status, v_job.attempts, left(v_job.last_error, 160)
  ) returning id into v_revival_id;
  if v_intent_id is not null then
    insert into public.payment_events (payment_intent_id, event_type, details)
    values (
      v_intent_id,
      'payment.outbox_job_revived',
      jsonb_build_object(
        'job_id', v_job.id, 'topic', v_job.topic, 'revival_id', v_revival_id,
        'actor_user_id', v_actor, 'previous_attempts', v_job.attempts
      )
    );
  end if;
  return jsonb_build_object(
    'ok', true, 'action', 'revived', 'idempotent', false,
    'job_id', v_job.id, 'topic', v_job.topic, 'revival_id', v_revival_id,
    'attempts', greatest(v_job.attempts, 8)
  );
end;
$$;

-- También fuera de la clave de servicio, explícito: sin identidad la función se niega
-- igual, y así el permiso es el mismo en cualquier stack, con o sin privilegios por
-- defecto sobre funciones.
revoke all on function public.revive_payment_outbox_job(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.revive_payment_outbox_job(uuid, text) to authenticated;

comment on function public.revive_payment_outbox_job(uuid, text) is
  'Dueno o encargado: vuelve a poner en la cola, para UN intento mas, un trabajo de lectura de pagos que quedo en dead_letter (aviso de pago, de contracargo o de reclamo, o consulta de un pago). Deja una fila en payment_outbox_revivals. No reanima la conciliacion de un reembolso ni de una cancelacion.';

-- ── 3. La lista de pagos del Panel dice qué trabajo se puede reanimar ───────
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
    'can_recover_order', v_can_operate and public.can_recover_paid_checkout(pi.id),
    -- El trabajo de lectura de este cobro que agotó sus intentos, si hay uno: es
    -- lo que `revive_payment_outbox_job` necesita para volver a ponerlo en marcha.
    'dead_letter_job_id', dead_job.id,
    'can_revive_job', v_can_operate and dead_job.id is not null
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
  -- Un trabajo de aviso nace sin cobro: se reconoce por el pago que lee, que es el
  -- que este cobro tiene guardado, y por el comercio que confirmó esa lectura.
  left join lateral (
    select po.id
      from public.payment_outbox po
      left join public.payment_webhook_receipts wr on wr.id = po.webhook_receipt_id
     where po.status in ('dead_letter', 'failed')
       and po.topic in ('payment', 'chargeback', 'claim', 'payment_reconcile')
       and (
         po.payment_intent_id = pi.id
         or (po.payment_intent_id is null
           and po.topic = 'payment'
           and wr.id is not null
           and pi.provider_payment_id is not null
           and po.resource_id = pi.provider_payment_id
           and wr.environment = pi.environment
           and (wr.seller_business_id is null or wr.seller_business_id = pi.business_id))
       )
     order by po.created_at desc
     limit 1
  ) dead_job on true
  where pi.business_id = p_business_id
  order by pi.created_at desc
  limit 200;
end;
$function$;

revoke all on function public.list_business_payments(uuid) from public, anon, authenticated;
grant execute on function public.list_business_payments(uuid) to authenticated;
