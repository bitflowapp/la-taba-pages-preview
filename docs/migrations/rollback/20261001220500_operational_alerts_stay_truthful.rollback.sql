-- REVERSIÓN de 20261001220500_operational_alerts_stay_truthful.sql
--
-- Devuelve las cuatro funciones a su definición anterior, tal como estaban en la
-- base antes de la migración (los cuerpos de abajo son esos, sin tocar):
--
--   check_scheduler_watchdog                   (20260810150000)
--   reconcile_operational_alerts_for_business  (20260925220000)
--   evaluate_operational_alerts_sweep          (20260810120000)
--   build_operational_health                   (20260810130000)
--
-- Ojo con lo que vuelve a quedar abierto:
--   · abrir el Panel vuelve a cerrar SCHEDULER_WATCHDOG_STALE con el planificador
--     muerto;
--   · ORDER_NOT_ACCEPTED y ORDER_STALLED vuelven a cerrarse solas a las 24 horas;
--   · `anon` vuelve a poder guardar 40 caracteres propios en la evidencia de una
--     alerta;
--   · la salud de un negocio vuelve a mostrar los fallos de barrido de los demás;
--   · una tarea horaria o diaria vuelve a figurar detenida a los 15 minutos.
--
-- No borra nada: no hay tablas ni filas propias de esta migración. Las alertas que
-- estén abiertas siguen abiertas y las evalúa la función restaurada en la corrida
-- siguiente.
--
-- ORDEN: revertir ésta ANTES que 20261001220000 (esa reversión borra las funciones
-- privadas que estas definiciones nuevas usan).
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001220500
begin;

CREATE OR REPLACE FUNCTION public.check_scheduler_watchdog(p_source text DEFAULT 'external'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_beat jsonb;
  v_healthy boolean;
  v_age numeric;
  v_last timestamptz;
  v_source text := left(coalesce(nullif(btrim(p_source), ''), 'external'), 40);
  v_business record;
  v_alert public.operational_alerts;
  v_fingerprint text;
  v_alert_id uuid;
  v_subject uuid := md5('scheduler_watchdog')::uuid;
  v_action text := 'ninguna';
  v_touched integer := 0;
begin
  v_beat := public.scheduler_heartbeat();
  v_healthy := coalesce((v_beat ->> 'healthy')::boolean, false);
  v_age := nullif(v_beat ->> 'age_seconds', '')::numeric;
  v_last := nullif(v_beat ->> 'last_run_at', '')::timestamptz;

  -- Dos sondas al mismo tiempo no tienen nada que agregar la una a la otra.
  if not pg_try_advisory_xact_lock(hashtext('taba:scheduler_watchdog')) then
    return v_beat || jsonb_build_object('action', 'omitida', 'reason', 'otra comprobación en curso');
  end if;

  for v_business in
    select b.id from public.businesses b where b.status <> 'closed' order by b.id
  loop
    v_fingerprint := encode(digest(
      v_business.id::text || ':SCHEDULER_WATCHDOG_STALE:' || v_subject::text, 'sha256'
    ), 'hex');

    select * into v_alert from public.operational_alerts
     where business_id = v_business.id and fingerprint = v_fingerprint
     for update;

    if v_healthy then
      -- Vuelve sola, sin esperar a que el barrido reviva.
      if v_alert.id is not null and v_alert.status <> 'resolved' then
        update public.operational_alerts
           set status = 'resolved', resolved_at = clock_timestamp(),
               resolution_note = 'El barrido volvió a correr; la sonda externa lo confirmó.',
               updated_at = clock_timestamp()
         where id = v_alert.id;
        insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
        values (v_business.id, v_alert.id, 'resolved',
          jsonb_build_object('resolution', 'scheduler_recovered', 'source', v_source));
        v_action := 'resuelta';
        v_touched := v_touched + 1;
      end if;
      continue;
    end if;

    -- No sano. Se escribe como mucho una vez por minuto, la llamen las veces
    -- que la llamen: la alerta ya abierta y reciente no se vuelve a tocar.
    if v_alert.id is not null and v_alert.status <> 'resolved'
      and v_alert.last_seen_at > clock_timestamp() - interval '60 seconds' then
      v_action := 'sin cambios';
      continue;
    end if;

    insert into public.operational_alerts(
      business_id, fingerprint, severity, alert_code, subject_type, subject_id,
      status, summary, required_action, evidence
    ) values (
      v_business.id, v_fingerprint, 'CRITICAL', 'SCHEDULER_WATCHDOG_STALE',
      'service_health', v_subject, 'open',
      'La vigilancia automática dejó de correr.',
      'El sistema ya no se está revisando solo: mirá el Panel hasta que vuelva y avisá a soporte.',
      jsonb_build_object(
        'last_run_at', v_last,
        'age_seconds', v_age,
        'stale_after_seconds', 600,
        'observed_by', v_source
      )
    )
    on conflict (business_id, fingerprint) do update set
      severity = 'CRITICAL',
      status = case when operational_alerts.status = 'resolved' then 'open' else operational_alerts.status end,
      summary = excluded.summary,
      required_action = excluded.required_action,
      evidence = excluded.evidence,
      last_seen_at = clock_timestamp(),
      occurrence_count = operational_alerts.occurrence_count + case
        when operational_alerts.last_seen_at < clock_timestamp() - interval '1 minute' then 1 else 0 end,
      resolved_by = null, resolved_at = null, resolution_note = null,
      acknowledged_by = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_by end,
      acknowledged_at = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_at end,
      updated_at = clock_timestamp()
    returning id into v_alert_id;

    -- Un evento por episodio, no por comprobación.
    if v_alert.id is null or v_alert.status = 'resolved' then
      insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
      values (
        v_business.id, v_alert_id,
        case when v_alert.id is null then 'detected' else 'reopened' end,
        jsonb_build_object('alert_code', 'SCHEDULER_WATCHDOG_STALE', 'source', v_source)
      );
    end if;
    v_action := 'abierta';
    v_touched := v_touched + 1;
  end loop;

  return v_beat || jsonb_build_object('action', v_action, 'businesses_touched', v_touched, 'source', v_source);
end;
$function$;

revoke all on function public.check_scheduler_watchdog(text) from public, anon, authenticated;
grant execute on function public.check_scheduler_watchdog(text) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reconcile_operational_alerts_for_business(p_business_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_finding record;
  v_alert_id uuid;
  v_previous_status text;
  v_previous_seen timestamptz;
  v_fingerprint text;
  v_seen text[] := '{}'::text[];
  v_count integer := 0;
begin
  for v_finding in
    select * from (
      select
        'CRITICAL'::text as severity,
        'PAYMENT_APPROVED_WITHOUT_ORDER'::text as alert_code,
        'payment_intent'::text as subject_type,
        pi.id as subject_id,
        pi.correlation_id,
        'Pago aprobado sin pedido operativo.'::text as summary,
        'Reconciliar el pago y finalizar el pedido; no cobrar nuevamente.'::text as required_action,
        jsonb_build_object('payment_intent_id', pi.id, 'status', pi.internal_status) as evidence
      from public.payment_intents pi
      where pi.business_id = p_business_id
        and pi.internal_status in ('approved','approved_order_pending')
        and pi.order_id is null
        and pi.updated_at < clock_timestamp() - interval '5 minutes'

      union all

      select
        'ACTION_REQUIRED', 'PAYMENT_RECONCILIATION_REQUIRED', 'payment_intent',
        pi.id, pi.correlation_id,
        'Pago con resultado ambiguo o revisión de seguridad.',
        'Consultar el proveedor y comparar importe, moneda y referencia antes de continuar.',
        jsonb_build_object('payment_intent_id', pi.id, 'status', pi.internal_status)
      from public.payment_intents pi
      where pi.business_id = p_business_id
        and pi.internal_status in ('ambiguous','security_review_required')

      union all

      select
        'CRITICAL', 'CHECKOUT_PROVIDER_UNVERIFIED', 'payment_intent',
        pi.id, pi.correlation_id,
        'Checkout que llegó a Mercado Pago y venció sin confirmación del proveedor.',
        'Buscar el pago en Mercado Pago por la referencia externa; si existe, reembolsar o materializar el pedido.',
        jsonb_build_object(
          'payment_intent_id', pi.id,
          'checkout_session_id', pi.checkout_session_id,
          'external_reference', pi.external_reference,
          'status', pi.internal_status,
          'empty_probes', (
            select count(*) from public.payment_events pe
             where pe.payment_intent_id = pi.id
               and pe.event_type = 'payment.provider_probe_empty'
          )
        )
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
      where pi.business_id = p_business_id
        and pi.order_id is null
        and cs.completed_order_id is null
        and nullif(btrim(coalesce(pi.preference_id, '')), '') is not null
        and pi.provider_payment_id is null
        and pi.internal_status in ('expired','redirected','pending','in_process','preference_created')
        and cs.expires_at < clock_timestamp() - interval '20 minutes'
        and cs.created_at > clock_timestamp() - interval '48 hours'
        and not exists (
          select 1 from public.payment_events pe
           where pe.payment_intent_id = pi.id
             and pe.event_type = 'payment.provider_probe_empty'
        )

      union all

      select
        'ACTION_REQUIRED', 'ORDER_READY_WITHOUT_RIDER', 'order',
        o.id, o.correlation_id,
        'Pedido listo para entregar y sin Rider asignado.',
        'Asignar un Rider desde el Panel o avisar al cliente si la entrega se demora.',
        jsonb_build_object('order_id', o.id, 'public_code', o.public_code, 'ready_since', coalesce(o.ready_at, o.updated_at))
      from public.orders o
      where o.business_id = p_business_id
        and o.status = 'ready'
        and coalesce(o.fulfillment_type, o.delivery_mode) = 'delivery'
        and o.assigned_rider_user_id is null
        and coalesce(o.ready_at, o.updated_at) < clock_timestamp() - interval '15 minutes'

      union all

      select
        'ACTION_REQUIRED', 'STOCK_RESERVATION_STUCK', 'checkout_session',
        cs.id, cs.correlation_id,
        'Hay stock reservado por un checkout vencido que no se liberó.',
        'Verificar el barrido de expiración; el stock retenido no se puede vender.',
        jsonb_build_object('checkout_session_id', cs.id, 'expired_for', clock_timestamp() - cs.expires_at)
      from public.checkout_sessions cs
      where cs.business_id = p_business_id
        and exists (
          select 1 from public.inventory_reservations r
           where r.checkout_session_id = cs.id
             and r.status = 'active'
             and r.expires_at < clock_timestamp() - interval '5 minutes'
        )

      union all

      select
        'CRITICAL', 'FISCAL_AUTHORIZATION_AMBIGUOUS', 'fiscal_document',
        fd.id, fd.correlation_id,
        'La autorización fiscal es ambigua.',
        'Consultar ARCA por tipo, punto de venta y número; no volver a emitir a ciegas.',
        jsonb_build_object('fiscal_document_id', fd.id, 'state', fd.state)
      from public.fiscal_documents fd
      where fd.business_id = p_business_id and fd.state = 'ambiguous'

      union all

      select
        case when fo.state = 'dead_letter' then 'CRITICAL' else 'ACTION_REQUIRED' end,
        'FISCAL_OUTBOX_STALLED', 'fiscal_document',
        fd.id, fd.correlation_id,
        'La cola fiscal no progresa.',
        'Revisar conectividad y worker; conservar número e idempotencia antes de reintentar.',
        jsonb_build_object('fiscal_document_id', fd.id, 'outbox_state', fo.state, 'attempts', fo.attempt_count)
      from public.fiscal_outbox fo
      join public.fiscal_documents fd on fd.id = fo.fiscal_document_id
      where fd.business_id = p_business_id
        and (
          fo.state = 'dead_letter'
          or (fo.state in ('pending','retry_wait') and fo.next_attempt_at < clock_timestamp() - interval '15 minutes')
          or (fo.state = 'leased' and fo.lease_deadline < clock_timestamp())
        )

      union all

      select
        case when po.status = 'dead_letter' then 'CRITICAL' else 'ACTION_REQUIRED' end,
        'PAYMENT_OUTBOX_STALLED', 'payment_intent',
        pi.id, pi.correlation_id,
        'La cola de pagos no progresa.',
        'Revisar el worker y reconciliar con Mercado Pago usando la misma referencia.',
        jsonb_build_object('payment_intent_id', pi.id, 'outbox_status', po.status, 'attempts', po.attempts)
      from public.payment_outbox po
      join public.payment_intents pi on pi.id = po.payment_intent_id
      where pi.business_id = p_business_id
        and (
          po.status in ('failed','dead_letter')
          or (po.status in ('pending','retry_wait') and po.next_attempt_at < clock_timestamp() - interval '15 minutes')
          or (po.status in ('claimed','processing') and po.lease_expires_at < clock_timestamp())
        )

      union all

      select
        'ACTION_REQUIRED', 'FISCAL_ARTIFACT_STALLED', 'fiscal_document',
        fd.id, fd.correlation_id,
        'El PDF fiscal no está disponible.',
        'Revisar Storage y el worker de artefactos; no modificar el CAE autorizado.',
        jsonb_build_object('fiscal_document_id', fd.id, 'artifact_state', fd.artifact_state, 'outbox_state', fao.state)
      from public.fiscal_documents fd
      left join public.fiscal_artifact_outbox fao on fao.fiscal_document_id = fd.id
      where fd.business_id = p_business_id
        and fd.state = 'authorized'
        and fd.artifact_state in ('artifact_failed','artifact_pending','artifact_generating')
        and coalesce(fao.created_at, fd.authorized_at, fd.created_at) < clock_timestamp() - interval '10 minutes'

      union all

      select
        'ACTION_REQUIRED', 'PRINT_JOB_FAILED', 'print_job',
        pj.id, pj.correlation_id,
        'Una impresión fiscal falló o no pudo verificarse.',
        'Comprobar impresora y papel, abrir la vista previa y reimprimir sólo si corresponde.',
        jsonb_build_object('print_job_id', pj.id, 'status', pj.status, 'error_code', pj.error_code)
      from public.fiscal_print_jobs pj
      where pj.business_id = p_business_id and pj.status in ('failed','unknown')

      union all

      select
        'WARNING', 'RIDER_SIGNAL_STALE', 'order',
        o.id, o.correlation_id,
        'Rider sin señal reciente durante una entrega activa.',
        'Contactar al Rider y verificar el estado sin inventar una ubicación.',
        jsonb_build_object('order_id', o.id, 'status', o.status)
      from public.orders o
      left join lateral (
        select rl.created_at
        from public.rider_locations rl
        where rl.order_id = o.id
        order by rl.created_at desc
        limit 1
      ) last_location on true
      where o.business_id = p_business_id
        and o.status in ('assigned','picked_up','on_the_way','arrived')
        and coalesce(last_location.created_at, o.updated_at) < clock_timestamp() - interval '5 minutes'

      union all

      select
        shs.severity, shs.signal_code, 'service_health', shs.id,
        shs.correlation_id,
        'Un servicio operativo reportó estado degradado.',
        'Abrir diagnóstico y ejecutar el runbook indicado para el servicio.',
        jsonb_build_object('signal_id', shs.id, 'service', shs.service, 'status', shs.status)
      from public.service_health_signals shs
      where shs.business_id = p_business_id
        and shs.expires_at > clock_timestamp()
        and shs.status <> 'healthy'

      union all

      select
        'CRITICAL', 'PAYMENT_WORKER_IDLE', 'service_health',
        md5('payment_worker_idle')::uuid, null::uuid,
        'La cola de cobros tiene trabajo vencido y nadie lo está tomando.',
        'Confirmar cada pago en Mercado Pago antes de entregar; el procesamiento automático no está corriendo.',
        jsonb_build_object(
          'due_jobs', q.due_jobs,
          'oldest_due_minutes', round(q.oldest_due_minutes),
          'last_progress_at', q.last_touch
        )
      from (
        select
          count(*) as due_jobs,
          max(po.updated_at) as last_touch,
          extract(epoch from (
            clock_timestamp() - min(coalesce(po.next_attempt_at, po.lease_expires_at))
          )) / 60 as oldest_due_minutes
        from public.payment_outbox po
        join public.payment_intents pi on pi.id = po.payment_intent_id
        where pi.business_id = p_business_id
          and (
            (po.status in ('pending','retry_wait') and po.next_attempt_at < clock_timestamp() - interval '5 minutes')
            or (po.status in ('claimed','processing') and po.lease_expires_at < clock_timestamp() - interval '5 minutes')
          )
      ) q
      where q.due_jobs > 0
        and q.last_touch < clock_timestamp() - interval '5 minutes'

      union all

      select
        'CRITICAL', 'SCHEDULER_JOB_FAILING', 'service_health',
        md5(sh.job_name)::uuid, null::uuid,
        'Una tarea automática del sistema viene fallando.',
        'Revisar la configuración del servicio; mientras falle, los cobros y el stock dependen de que alguien mire el Panel.',
        jsonb_build_object(
          'job', sh.job_name,
          'schedule', sh.schedule,
          'failures_since_success', sh.failures_since_success,
          'last_success_at', sh.last_success_at
        )
      from public.list_scheduler_health() sh
      where sh.active
        and sh.failures_since_success >= 3

      union all

      select
        'CRITICAL', 'SCHEDULER_JOB_STALLED', 'service_health',
        md5(sh.job_name || ':stalled')::uuid, null::uuid,
        'Una tarea automática del sistema dejó de ejecutarse.',
        'Revisar el estado del servicio; el stock reservado y los cobros pendientes no se están destrabando solos.',
        jsonb_build_object(
          'job', sh.job_name,
          'schedule', sh.schedule,
          'last_success_at', sh.last_success_at,
          'last_start', sh.last_start
        )
      from public.list_scheduler_health() sh
      where sh.active
        and coalesce(sh.last_success_at, '-infinity'::timestamptz) < clock_timestamp() - interval '15 minutes'
        -- ===== LA CORRECCIÓN =====
        -- Detenida exige haber estado en marcha alguna vez: o hubo un éxito, o
        -- lleva más de quince minutos arrancada sin terminar nunca —una tarea
        -- colgada, que sí hay que decir—. Una tarea que arrancó hace segundos y
        -- todavía no terminó no es ninguna de las dos: es una tarea nueva.
        and (
          sh.last_success_at is not null
          or coalesce(sh.last_start, '-infinity'::timestamptz) < clock_timestamp() - interval '15 minutes'
        )
        and sh.failures_since_success < 3
        and exists (
          select 1 from public.list_scheduler_health() alive
           where alive.last_success_at > clock_timestamp() - interval '5 minutes'
        )

      union all

      select
        'ACTION_REQUIRED', 'ORDER_NOT_ACCEPTED', 'order',
        o.id, o.correlation_id,
        'Entró un pedido y todavía nadie lo aceptó.',
        'Abrí Pedidos y aceptalo o cancelalo; el cliente está esperando una respuesta.',
        jsonb_build_object(
          'order_id', o.id,
          'public_code', o.public_code,
          'waiting_minutes', round(extract(epoch from (clock_timestamp() - o.created_at)) / 60)
        )
      from public.orders o
      where o.business_id = p_business_id
        and o.status in ('submitted','received')
        and coalesce(o.origin, 'production') <> 'qa'
        and o.acknowledged_at is null
        and o.created_at < clock_timestamp() - interval '10 minutes'
        and o.created_at > clock_timestamp() - interval '24 hours'

      union all

      select
        'ACTION_REQUIRED', 'ORDER_STALLED', 'order',
        o.id, o.correlation_id,
        'Un pedido aceptado dejó de avanzar.',
        'Abrí Pedidos y movelo o avisale al cliente; pasó bastante del tiempo que le prometiste.',
        jsonb_build_object(
          'order_id', o.id,
          'public_code', o.public_code,
          'status', o.status,
          'promised_minutes', coalesce(o.preparation_estimate_minutes, 30),
          'stalled_minutes', round(extract(epoch from (
            clock_timestamp() - coalesce(o.acknowledged_at, o.created_at)
          )) / 60)
        )
      from public.orders o
      where o.business_id = p_business_id
        and o.status in ('accepted','preparing')
        and coalesce(o.origin, 'production') <> 'qa'
        and coalesce(o.acknowledged_at, o.created_at)
            + make_interval(mins => coalesce(o.preparation_estimate_minutes, 30) + 30)
            < clock_timestamp()
        and o.created_at > clock_timestamp() - interval '24 hours'

      -- ======================================================================
      --  NUEVO · Mercado Pago encendido y la cuenta vinculada no puede cobrar.
      -- ======================================================================
      --  El checkout ya lo retira solo: get_mercadopago_checkout_availability
      --  exige una conexión que pueda cobrar. Por eso mismo el cliente no ve
      --  nada roto y el local no se entera: «Mercado Pago» desaparece del
      --  checkout sin que nadie sepa por qué. Una sola alerta por negocio y
      --  entorno; la evidencia dice el estado de la conexión, nunca la cuenta
      --  ni una credencial.
      union all

      select
        'ACTION_REQUIRED', 'MERCADOPAGO_SELLER_CANNOT_CHARGE', 'service_health',
        md5('mercadopago_seller:' || s.business_id::text || ':' || s.environment)::uuid, null::uuid,
        'Mercado Pago está habilitado pero la cuenta vinculada no puede cobrar.',
        'Reconectá Mercado Pago desde el Panel. Mientras tanto el checkout no lo ofrece y el cobro manual sigue disponible.',
        jsonb_build_object(
          'environment', s.environment,
          'connection_status', case
            when c.business_id is null then 'missing'
            when c.status <> 'connected' then c.status
            when c.protected_tokens is null then 'without_credentials'
            else 'account_mismatch'
          end
        )
      from public.business_payment_settings s
      left join public.mp_seller_connections c
        on c.business_id = s.business_id
       and c.environment = s.environment
      where s.business_id = p_business_id
        and s.provider = 'mercadopago'
        and s.enabled
        and (
          c.business_id is null
          or c.status <> 'connected'
          or c.protected_tokens is null
          or c.seller_id is distinct from s.collector_id
          or c.application_id is distinct from s.application_id
        )
    ) findings
  loop
    v_fingerprint := encode(digest(
      p_business_id::text || ':' || v_finding.alert_code || ':' || coalesce(v_finding.subject_id::text, 'none'),
      'sha256'
    ), 'hex');
    v_seen := array_append(v_seen, v_fingerprint);
    select status,last_seen_at into v_previous_status,v_previous_seen
    from public.operational_alerts
    where business_id = p_business_id and fingerprint = v_fingerprint
    for update;

    insert into public.operational_alerts(
      business_id, fingerprint, severity, alert_code, subject_type, subject_id,
      correlation_id, status, summary, required_action, evidence
    ) values (
      p_business_id, v_fingerprint, v_finding.severity,
      v_finding.alert_code, v_finding.subject_type, v_finding.subject_id,
      v_finding.correlation_id, 'open', v_finding.summary,
      v_finding.required_action, v_finding.evidence
    )
    on conflict (business_id, fingerprint) do update set
      severity = excluded.severity,
      correlation_id = excluded.correlation_id,
      status = case when operational_alerts.status = 'resolved' then 'open' else operational_alerts.status end,
      summary = excluded.summary,
      required_action = excluded.required_action,
      evidence = excluded.evidence,
      last_seen_at = clock_timestamp(),
      occurrence_count = operational_alerts.occurrence_count + case
        when operational_alerts.last_seen_at < clock_timestamp() - interval '1 minute' then 1 else 0 end,
      resolved_by = case when operational_alerts.status = 'resolved' then null else operational_alerts.resolved_by end,
      resolved_at = case when operational_alerts.status = 'resolved' then null else operational_alerts.resolved_at end,
      resolution_note = case when operational_alerts.status = 'resolved' then null else operational_alerts.resolution_note end,
      acknowledged_by = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_by end,
      acknowledged_at = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_at end,
      updated_at = clock_timestamp()
    returning id into v_alert_id;

    if v_previous_status is null or v_previous_status = 'resolved'
      or v_previous_seen < clock_timestamp() - interval '15 minutes' then
      insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
      values (
        p_business_id,
        v_alert_id,
        case when v_previous_status is null then 'detected' when v_previous_status = 'resolved' then 'reopened' else 'redetected' end,
        jsonb_build_object('alert_code', v_finding.alert_code)
      );
    end if;
    v_count := v_count + 1;
  end loop;

  update public.operational_alerts
  set status = 'resolved', resolved_at = clock_timestamp(), resolution_note = 'Condición ausente en la reconciliación automática.', updated_at = clock_timestamp()
  where business_id = p_business_id
    and status <> 'resolved'
    and not (fingerprint = any(v_seen));

  insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
  select p_business_id, a.id, 'resolved', jsonb_build_object('resolution', 'automatic_condition_cleared')
  from public.operational_alerts a
  where a.business_id = p_business_id
    and a.status = 'resolved'
    and a.resolved_at >= transaction_timestamp()
    and a.resolved_by is null;

  return v_count;
end;
$function$;

revoke all on function public.reconcile_operational_alerts_for_business(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_operational_alerts_for_business(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.evaluate_operational_alerts_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_started timestamptz := clock_timestamp();
  v_business record;
  v_found integer;
  v_findings integer := 0;
  v_evaluated integer := 0;
  v_failures jsonb := '[]'::jsonb;
  v_open integer := 0;
  v_critical integer := 0;
  v_status text;
begin
  -- Dos barridos a la vez escribirian las mismas filas y se pisarian los
  -- `for update`. El que llega segundo se va: el primero ya esta haciendo su
  -- trabajo y correrlo de nuevo no agrega informacion.
  if not pg_try_advisory_xact_lock(hashtext('taba:operational_alerts_sweep')) then
    return jsonb_build_object('status', 'skipped', 'reason', 'ya hay una evaluación en curso');
  end if;

  for v_business in
    select b.id
    from public.businesses b
    where b.status <> 'closed'
       -- Un negocio cerrado con alertas abiertas se sigue evaluando: es la
       -- unica forma de que esas alertas lleguen a resolverse solas.
       or exists (
         select 1 from public.operational_alerts a
          where a.business_id = b.id and a.status <> 'resolved'
       )
    order by b.id
  loop
    begin
      v_found := public.reconcile_operational_alerts_for_business(v_business.id);
      v_findings := v_findings + coalesce(v_found, 0);
      v_evaluated := v_evaluated + 1;
    exception when others then
      -- Un negocio que falla no puede dejar a los demas sin evaluar.
      v_failures := v_failures || jsonb_build_array(jsonb_build_object(
        'business_id', v_business.id,
        'error', left(sqlerrm, 180)
      ));
    end;
  end loop;

  select
    count(*) filter (where a.status <> 'resolved'),
    count(*) filter (where a.status <> 'resolved' and a.severity = 'CRITICAL')
  into v_open, v_critical
  from public.operational_alerts a;

  v_status := case
    when jsonb_array_length(v_failures) = 0 then 'ok'
    when v_evaluated > 0 then 'partial'
    else 'failed'
  end;

  insert into public.operational_sweep_runs(
    scope, status, started_at, finished_at, businesses_evaluated,
    findings, open_alerts, critical_alerts, failures
  ) values (
    'operational_alerts', v_status, v_started, clock_timestamp(), v_evaluated,
    v_findings, v_open, v_critical, v_failures
  );

  -- Una fila por minuto: sin poda, en un mes son cuarenta mil filas que nadie
  -- va a leer. Una semana alcanza para reconstruir cualquier noche.
  delete from public.operational_sweep_runs
  where started_at < clock_timestamp() - interval '7 days';

  return jsonb_build_object(
    'status', v_status,
    'businesses_evaluated', v_evaluated,
    'findings', v_findings,
    'open_alerts', v_open,
    'critical_alerts', v_critical,
    'failures', v_failures
  );
end;
$function$;

revoke all on function public.evaluate_operational_alerts_sweep() from public, anon, authenticated;
grant execute on function public.evaluate_operational_alerts_sweep() to service_role;

CREATE OR REPLACE FUNCTION public.build_operational_health(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_sweep record;
  v_result jsonb;
begin
  select r.status, r.started_at, r.finished_at, r.businesses_evaluated,
         r.findings, r.open_alerts, r.critical_alerts, r.failures
    into v_sweep
    from public.operational_sweep_runs r
   where r.scope = 'operational_alerts'
   order by r.started_at desc
   limit 1;

  select jsonb_build_object(
    'generated_at', v_now,
    'business_id', p_business_id,

    -- ¿Se está evaluando solo? Es la pregunta que ordena todo el resto.
    'autonomous_evaluation', jsonb_build_object(
      'expected_every_seconds', 60,
      'last_run_at', v_sweep.started_at,
      'seconds_since_last_run', case when v_sweep.started_at is null then null
        else round(extract(epoch from (v_now - v_sweep.started_at))) end,
      'last_status', v_sweep.status,
      'businesses_evaluated', v_sweep.businesses_evaluated,
      'findings', v_sweep.findings,
      'failures', coalesce(v_sweep.failures, '[]'::jsonb),
      'state', case
        when v_sweep.started_at is null then 'desconocido'
        when v_sweep.started_at < v_now - interval '5 minutes' then 'detenido'
        when v_sweep.status = 'failed' then 'fallando'
        when v_sweep.status = 'partial' then 'degradado'
        else 'al día'
      end
    ),

    -- El planificador, job por job. Sin fila, sin afirmación.
    'scheduler', coalesce((
      select jsonb_agg(jsonb_build_object(
        'job', sh.job_name,
        'schedule', sh.schedule,
        'active', sh.active,
        'last_start', sh.last_start,
        'last_success_at', sh.last_success_at,
        'seconds_since_success', case when sh.last_success_at is null then null
          else round(extract(epoch from (v_now - sh.last_success_at))) end,
        'failures_since_success', sh.failures_since_success,
        'state', case
          when not sh.active then 'apagado'
          when sh.last_success_at is null then 'sin ninguna corrida exitosa'
          when sh.last_success_at < v_now - interval '15 minutes' then 'detenido'
          when sh.failures_since_success >= 3 then 'fallando'
          when sh.failures_since_success > 0 then 'con fallos recientes'
          else 'al día'
        end
      ) order by sh.job_name)
      from public.list_scheduler_health() sh
    ), '[]'::jsonb),

    -- Cobros: la cola, el procesador y la reconciliación con el proveedor.
    'payments', jsonb_build_object(
      'outbox', (
        select jsonb_build_object(
          'pending', count(*) filter (where po.status = 'pending'),
          'retry_wait', count(*) filter (where po.status = 'retry_wait'),
          'in_flight', count(*) filter (where po.status in ('claimed','processing')),
          'failed', count(*) filter (where po.status = 'failed'),
          'dead_letter', count(*) filter (where po.status = 'dead_letter'),
          'due_now', count(*) filter (where
            (po.status in ('pending','retry_wait') and po.next_attempt_at <= v_now)
            or (po.status in ('claimed','processing') and po.lease_expires_at < v_now)),
          'oldest_due_seconds', coalesce(round(extract(epoch from (v_now - min(po.next_attempt_at) filter (where
            po.status in ('pending','retry_wait') and po.next_attempt_at <= v_now)))), 0)
        )
        from public.payment_outbox po
        join public.payment_intents pi on pi.id = po.payment_intent_id
        where pi.business_id = p_business_id
      ),
      'worker', (
        select jsonb_build_object(
          'last_success_at', max(po.completed_at),
          'seconds_since_success', case when max(po.completed_at) is null then null
            else round(extract(epoch from (v_now - max(po.completed_at)))) end,
          'completed_last_hour', count(*) filter (where po.completed_at > v_now - interval '1 hour'),
          'last_failure_at', max(po.updated_at) filter (where po.status in ('failed','dead_letter')),
          'failed_last_hour', count(*) filter (
            where po.status in ('failed','dead_letter') and po.updated_at > v_now - interval '1 hour'),
          'state', case
            when count(*) filter (where
              (po.status in ('pending','retry_wait') and po.next_attempt_at < v_now - interval '5 minutes')
              or (po.status in ('claimed','processing') and po.lease_expires_at < v_now - interval '5 minutes')) > 0
              then 'no está tomando trabajo'
            when count(*) filter (where po.status in ('dead_letter')) > 0 then 'con trabajos abandonados'
            when max(po.completed_at) is null then 'sin trabajo procesado todavía'
            else 'al día'
          end
        )
        from public.payment_outbox po
        join public.payment_intents pi on pi.id = po.payment_intent_id
        where pi.business_id = p_business_id
      ),
      'reconciliation', jsonb_build_object(
        -- Dinero adentro y ningún pedido: la definición del peor caso, contada
        -- por la misma función que ya es autoridad de eso.
        'paid_without_order', (
          select count(*)
          from public.list_unfinalized_paid_checkouts() u
          join public.checkout_sessions cs on cs.id = u.checkout_session_id
          where cs.business_id = p_business_id
        ),
        'probes_last_hour', (
          select count(*)
          from public.payment_events pe
          join public.payment_intents pi on pi.id = pe.payment_intent_id
          where pi.business_id = p_business_id
            and pe.event_type = 'payment.provider_probe_empty'
            and pe.server_recorded_at > v_now - interval '1 hour'
        ),
        'provider_answers_last_hour', (
          select count(*)
          from public.payment_events pe
          join public.payment_intents pi on pi.id = pe.payment_intent_id
          where pi.business_id = p_business_id
            and pe.server_recorded_at > v_now - interval '1 hour'
        ),
        'in_review', (
          select count(*) from public.payment_intents pi
          where pi.business_id = p_business_id
            and pi.internal_status in ('ambiguous','security_review_required','approved_order_pending')
        )
      )
    ),

    -- Pedidos que necesitan una persona, con el mismo criterio que las alertas.
    'orders_needing_attention', (
      select jsonb_build_object(
        'not_accepted', count(*) filter (
          where o.status in ('submitted','received')
            and o.acknowledged_at is null
            and o.created_at < v_now - interval '10 minutes'),
        'stalled', count(*) filter (
          where o.status in ('accepted','preparing')
            and coalesce(o.acknowledged_at, o.created_at)
                + make_interval(mins => coalesce(o.preparation_estimate_minutes, 30) + 30) < v_now),
        'ready_without_rider', count(*) filter (
          where o.status = 'ready'
            and coalesce(o.fulfillment_type, o.delivery_mode) = 'delivery'
            and o.assigned_rider_user_id is null
            and coalesce(o.ready_at, o.updated_at) < v_now - interval '15 minutes'),
        'active_deliveries', count(*) filter (
          where o.status in ('assigned','picked_up','on_the_way','arrived'))
      )
      from public.orders o
      where o.business_id = p_business_id
        and coalesce(o.origin, 'production') <> 'qa'
        and o.status not in ('delivered','canceled','cancelled','rejected','draft')
    ),

    'riders_without_signal', (
      select count(*) from public.operational_alerts a
      where a.business_id = p_business_id
        and a.alert_code = 'RIDER_SIGNAL_STALE'
        and a.status <> 'resolved'
    ),

    -- Stock retenido por checkouts que ya vencieron: se vacía la góndola sin
    -- haber vendido nada.
    'reservations', (
      select jsonb_build_object(
        'active', count(*) filter (where r.status = 'active'),
        'expired_still_held', count(*) filter (
          where r.status = 'active' and r.expires_at < v_now - interval '5 minutes'),
        'oldest_expired_minutes', coalesce(round(extract(epoch from (
          v_now - min(r.expires_at) filter (where r.status = 'active' and r.expires_at < v_now)
        )) / 60), 0)
      )
      from public.inventory_reservations r
      join public.checkout_sessions cs on cs.id = r.checkout_session_id
      where cs.business_id = p_business_id
    ),

    'alerts', (
      select jsonb_build_object(
        'open', count(*) filter (where a.status <> 'resolved'),
        'critical', count(*) filter (where a.status <> 'resolved' and a.severity = 'CRITICAL'),
        'action_required', count(*) filter (where a.status <> 'resolved' and a.severity = 'ACTION_REQUIRED'),
        'warning', count(*) filter (where a.status <> 'resolved' and a.severity = 'WARNING'),
        'acknowledged', count(*) filter (where a.status = 'acknowledged'),
        'oldest_open_at', min(a.first_seen_at) filter (where a.status <> 'resolved'),
        'detected_by_system_last_hour', (
          select count(*) from public.operational_alert_events e
          where e.business_id = p_business_id
            and e.event_type in ('detected','reopened')
            and e.actor_id is null
            and e.created_at > v_now - interval '1 hour'
        )
      )
      from public.operational_alerts a
      where a.business_id = p_business_id
    ),

    'secrets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', s.name, 'configured', s.configured, 'detail', s.detail
      ) order by s.name)
      from public.list_operational_secret_status() s
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.build_operational_health(uuid) from public, anon, authenticated;
grant execute on function public.build_operational_health(uuid) to service_role;

commit;
