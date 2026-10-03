-- TABA · LA ALERTA «PAGO APROBADO SIN PEDIDO» NO SE CIERRA SOLA
--
-- QUÉ ESTABA ROTO (encontrado al escribir la prueba de invariantes del checkout, ejecutado)
--
--   `reconcile_operational_alerts_for_business` abre PAYMENT_APPROVED_WITHOUT_ORDER
--   (crítica) cuando un cobro lleva más de cinco minutos aprobado y sin pedido. Los
--   cinco minutos se medían desde `payment_intents.updated_at`.
--
--   Cualquier relectura del MISMO pago aprobado que trae otro cuerpo de respuesta (la
--   pantalla de estado, la sonda, un reintento del webhook) reescribe el intent y
--   reinicia ese reloj: la reconciliación siguiente daba la alerta por RESUELTA con el
--   pedido todavía sin crear, y recién la reabría cinco minutos después de la última
--   relectura. Con relecturas cada minuto la alerta podía no quedar abierta nunca.
--
-- QUÉ CAMBIA
--
--   Una línea: los cinco minutos se miden desde `approved_at`, que el asiento del pago
--   escribe una sola vez, la primera vez que lo ve aprobado. Si faltara, vale la regla
--   anterior. El resto de la función es su definición vigente (20261001220500), letra
--   por letra: se generó de la definición viva con ese único reemplazo, contado.
--
-- QUÉ NO CAMBIA
--
--   Firma, SECURITY, `search_path` y permisos de la función (CREATE OR REPLACE los
--   conserva). Las demás alertas. `list_unfinalized_paid_checkouts` ya medía desde la
--   sesión y no tenía el problema.
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261001222000_paid_without_order_alert_measures_from_approval.rollback.sql

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
  -- Lo mismo que mira la sonda externa: ¿el barrido corrió en los últimos 10 minutos?
  v_scheduler_alive boolean := coalesce((public.scheduler_heartbeat() ->> 'healthy')::boolean, false);
begin
  for v_finding in
    -- El planificador se lee UNA vez por reconciliación: lo consultan tres cláusulas
    -- y cada referencia a la función era otra lectura completa del historial.
    with scheduler as materialized (
      select * from public.list_scheduler_health()
    )
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
        -- Desde que el cobro se aprobó, no desde la última escritura del intent: una
        -- relectura del mismo pago reescribe `updated_at` y no puede cerrar la alerta.
        and coalesce(pi.approved_at, pi.updated_at) < clock_timestamp() - interval '5 minutes'

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
      from scheduler sh
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
      from scheduler sh
      where sh.active
        -- El silencio tolerado sale de la programación de cada tarea (15 minutos para
        -- las de cada minuto, como siempre): una tarea horaria no está detenida a los
        -- 16 minutos de haber corrido.
        and coalesce(sh.last_success_at, '-infinity'::timestamptz)
            < clock_timestamp() - private.scheduler_job_stale_after(sh.schedule)
        -- ===== LA CORRECCIÓN =====
        -- Detenida exige haber estado en marcha alguna vez: o hubo un éxito, o
        -- lleva más de quince minutos arrancada sin terminar nunca —una tarea
        -- colgada, que sí hay que decir—. Una tarea que arrancó hace segundos y
        -- todavía no terminó no es ninguna de las dos: es una tarea nueva.
        and (
          sh.last_success_at is not null
          -- Una tarea del inventario que todavía no corrió nunca se mide desde que se
          -- la espera, no desde siempre: recién desplegada no es una tarea detenida.
          or coalesce(
               sh.last_start,
               (select e.expected_since from private.scheduler_expected_jobs e where e.job_name = sh.job_name),
               '-infinity'::timestamptz
             ) < clock_timestamp() - private.scheduler_job_stale_after(sh.schedule)
        )
        and sh.failures_since_success < 3
        and exists (
          select 1 from scheduler alive
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
        -- Sin horizonte de 24 horas: mientras el pedido siga abierto sigue reteniendo
        -- stock y alguien tiene que resolverlo. La alerta no vence sola; la cierra
        -- atender, cancelar o vencer el pedido.

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
        -- Sin horizonte de 24 horas: mientras el pedido siga abierto sigue reteniendo
        -- stock y alguien tiene que resolverlo. La alerta no vence sola; la cierra
        -- atender, cancelar o vencer el pedido.

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
    and not (fingerprint = any(v_seen))
    -- SCHEDULER_WATCHDOG_STALE no la produce esta función: la escribe la sonda, y
    -- por eso nunca está entre lo visto. Mientras el barrido siga sin correr no es
    -- una «condición ausente»: se deja como está. Cuando vuelve, la cierran la
    -- sonda, el propio barrido o esta misma línea en la corrida siguiente.
    and not (alert_code = 'SCHEDULER_WATCHDOG_STALE' and not v_scheduler_alive);

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
