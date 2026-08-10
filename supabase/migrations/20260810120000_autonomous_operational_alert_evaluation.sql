-- ============================================================================
--  Que un fallo de cobros, pedidos o worker no espere a que alguien abra el Panel.
-- ============================================================================
--
--  MEDIDO sobre el arbol de release/taba2-pilot-rc1 (f4588f9):
--
--    public.get_production_operation_center(business)   <- unico llamador
--      └─ perform public.refresh_operational_alerts(business)
--           └─ if not public.has_business_role(...) then raise 42501
--
--    `refresh_operational_alerts` es el UNICO lugar donde se calculan las
--    alertas operativas, exige un operador con sesion iniciada, y su unico
--    invocador es la pantalla del Centro de operacion. Consecuencia exacta:
--    un pago aprobado sin pedido, una cola de cobros trabada o un Rider sin
--    señal existen en la base desde el minuto cero y NADIE los mira hasta que
--    una persona abre el Panel. De noche, eso son horas.
--
--    No es una hipotesis: el cierre de la sesion anterior registra que las dos
--    alertas de reconciliacion pendientes "pasaron a resolved POR EL PROPIO
--    SISTEMA al recalcular AL ABRIR EL PANEL".
--
--  QUE HACE ESTA MIGRACION
--  -----------------------
--  1. Separa el CALCULO de la AUTORIZACION. El cuerpo entero se muda a
--     `reconcile_operational_alerts_for_business`, que no pregunta por sesion
--     porque no la tiene: la corre el planificador. `refresh_operational_alerts`
--     queda como envoltorio con el mismo nombre, la misma firma, los mismos
--     permisos y la misma verificacion de rol de siempre, asi que el Panel no
--     cambia en nada.
--  2. Programa `taba-operational-alerts-sweep` cada minuto con pg_cron, que es
--     el mecanismo mas simple que este proyecto YA usa (tres jobs desde
--     20260803120000) y el unico que no depende de red, secretos ni Edge.
--  3. Agrega las condiciones que hoy no tienen quien las mire aunque el Panel
--     este abierto: el procesador de cobros sin actividad, un job del
--     planificador fallando o parado, y pedidos que nadie acepto o que se
--     quedaron sin avanzar.
--  4. Deja registro de cada evaluacion en `operational_sweep_runs`, para que
--     "hace cuanto que esto se evalua" sea un dato y no una creencia.
--
--  LO QUE NO HACE, A PROPOSITO
--  ---------------------------
--  * No inventa alertas nuevas para condiciones que ya tienen uno: el dinero
--    cobrado sin pedido sigue siendo PAYMENT_APPROVED_WITHOUT_ORDER y no se
--    duplica desde `checkout_sessions`.
--  * No alerta por firma de webhook rechazada: en TEST la notificacion de
--    Checkout Pro viene firmada por la aplicacion de prueba y NUNCA valida
--    (documentado en 20260809180000). Prenderla seria una alarma permanente
--    que enseña a ignorar el tablero.
--  * No toca ninguna alerta existente, ni su texto, ni su ventana, ni su
--    severidad. Las cinco condiciones nuevas se agregan; las once anteriores se
--    reproducen sin un solo cambio.
--  * No automatiza ninguna accion economica. Detecta y dice que hacer.
-- ============================================================================

create extension if not exists pg_cron with schema pg_catalog;

-- ===== Registro de cada evaluacion automatica =====
-- Sin esto, "el sistema se vigila solo" es una afirmacion sin forma de medirla.
-- Con esto, la antiguedad de la ultima evaluacion es una consulta.
create table if not exists public.operational_sweep_runs (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'operational_alerts' check (scope ~ '^[a-z0-9_]{3,40}$'),
  status text not null check (status in ('ok','partial','failed','skipped')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  businesses_evaluated integer not null default 0 check (businesses_evaluated >= 0),
  findings integer not null default 0 check (findings >= 0),
  open_alerts integer not null default 0 check (open_alerts >= 0),
  critical_alerts integer not null default 0 check (critical_alerts >= 0),
  failures jsonb not null default '[]'::jsonb,
  constraint operational_sweep_runs_failures_size check (octet_length(failures::text) <= 4096)
);

create index if not exists operational_sweep_runs_recent_idx
  on public.operational_sweep_runs(scope, started_at desc);

alter table public.operational_sweep_runs enable row level security;
revoke all privileges on table public.operational_sweep_runs from public, anon, authenticated;

comment on table public.operational_sweep_runs is
  'Una fila por evaluacion automatica de alertas. La antiguedad de la ultima fila es la prueba de que el sistema se esta mirando solo.';

-- ===== Salud del planificador =====
-- `cron.job_run_details` es la unica fuente que sabe si un job corrio, cuando y
-- con que resultado. Se lee con SQL dinamico y detras de un `to_regclass` porque
-- una base sin pg_cron -cualquier base efimera de prueba- tiene que seguir
-- funcionando en vez de romper la evaluacion entera.
create or replace function public.list_scheduler_health()
returns table (
  job_name text,
  schedule text,
  active boolean,
  last_start timestamptz,
  last_status text,
  last_success_at timestamptz,
  failures_since_success integer,
  last_message text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $list_scheduler_health$
begin
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then
    return;
  end if;

  return query execute $dynamic$
    select
      j.jobname::text,
      j.schedule::text,
      j.active,
      r.last_start,
      r.last_status,
      r.last_success_at,
      coalesce(r.failures_since_success, 0)::integer,
      r.last_message
    from cron.job j
    left join lateral (
      select
        max(d.start_time) as last_start,
        (array_agg(d.status order by d.start_time desc))[1]::text as last_status,
        max(d.end_time) filter (where d.status = 'succeeded') as last_success_at,
        count(*) filter (
          where d.status = 'failed'
            and d.start_time > coalesce(
              (select max(s.start_time) from cron.job_run_details s
                where s.jobid = j.jobid and s.status = 'succeeded'),
              '-infinity'::timestamptz
            )
        ) as failures_since_success,
        left((array_agg(coalesce(d.return_message, '') order by d.start_time desc))[1], 200) as last_message
      from cron.job_run_details d
      where d.jobid = j.jobid
    ) r on true
    where j.jobname like 'taba-%'
    order by j.jobname
  $dynamic$;
end;
$list_scheduler_health$;

revoke all on function public.list_scheduler_health() from public, anon, authenticated;
grant execute on function public.list_scheduler_health() to service_role;

comment on function public.list_scheduler_health() is
  'Estado de los jobs propios del planificador: ultima corrida, ultimo exito y fallos acumulados desde el ultimo exito.';

-- ============================================================================
--  El calculo, sin sesion de por medio.
-- ============================================================================
--  Las once condiciones anteriores se reproducen exactamente como estaban en
--  20260809190000. Lo unico que cambia es que ya no hace falta un operador
--  autenticado para que alguien las mire.
create or replace function public.reconcile_operational_alerts_for_business(p_business_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $reconcile_operational_alerts_for_business$
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

      -- ======================================================================
      --  NUEVO 1 · El procesador de cobros dejó de tomar trabajo.
      -- ======================================================================
      --  Distinto de PAYMENT_OUTBOX_STALLED, que habla de UN cobro. Esto habla
      --  del servicio: hay trabajo vencido y hace más de cinco minutos que nadie
      --  lo toca. El despacho corre cada 30 segundos, así que cinco minutos de
      --  cola inmóvil no es carga: es que no hay quien la consuma. Una sola
      --  alerta por negocio aunque haya cuarenta trabajos parados.
      union all

      select
        'CRITICAL', 'PAYMENT_WORKER_IDLE', 'service_health',
        -- Un asunto estable y sin fila propia: el identificador sale del nombre
        -- de la condición, así la huella no cambia entre corridas.
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

      -- ======================================================================
      --  NUEVO 2 · Un job del planificador falla una y otra vez.
      -- ======================================================================
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

      -- ======================================================================
      --  NUEVO 3 · Un job del planificador dejó de correr.
      -- ======================================================================
      --  Los cuatro jobs propios corren cada minuto o cada 30 segundos. Quince
      --  minutos sin un solo éxito es una parada, no una demora. Sólo se afirma
      --  cuando el planificador SIGUE VIVO (otro job tuvo éxito hace poco): si
      --  se murió entero, esta evaluación tampoco corre y decirlo desde acá
      --  sería mentir sobre quién lo detectó.
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
        -- Si además viene fallando, ya lo dice la alerta de arriba. Un job
        -- roto tiene que producir UNA alerta, no dos.
        and sh.failures_since_success < 3
        and exists (
          select 1 from public.list_scheduler_health() alive
           where alive.last_success_at > clock_timestamp() - interval '5 minutes'
        )

      -- ======================================================================
      --  NUEVO 4 · Entró un pedido y nadie lo aceptó.
      -- ======================================================================
      --  `new_orders` ya lo cuenta en el tablero, pero contar no despierta a
      --  nadie. Diez minutos sin aceptar es el pedido que se enfría mientras el
      --  local cree que no entró nada. Los pedidos de prueba (origin `qa`) no
      --  suenan, igual que no suenan en la bandeja.
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

      -- ======================================================================
      --  NUEVO 5 · El pedido se aceptó y se quedó ahí.
      -- ======================================================================
      --  Media hora POR ENCIMA del tiempo que el propio local prometió. No es
      --  "va demorado" -eso ya es una métrica-: es que dejó de avanzar.
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
$reconcile_operational_alerts_for_business$;

revoke all on function public.reconcile_operational_alerts_for_business(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_operational_alerts_for_business(uuid) to service_role;

comment on function public.reconcile_operational_alerts_for_business(uuid) is
  'Calcula y reconcilia las alertas operativas de un negocio SIN exigir sesion: la corre el planificador. El camino humano sigue siendo refresh_operational_alerts.';

-- El Panel no cambia: mismo nombre, misma firma, mismos permisos, misma
-- verificacion de rol. Lo unico que se fue del cuerpo es el calculo.
create or replace function public.refresh_operational_alerts(p_business_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $refresh_operational_alerts$
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  return public.reconcile_operational_alerts_for_business(p_business_id);
end;
$refresh_operational_alerts$;

revoke execute on function public.refresh_operational_alerts(uuid) from public, anon;
grant execute on function public.refresh_operational_alerts(uuid) to authenticated;

comment on function public.refresh_operational_alerts(uuid) is
  'Reconcilia las alertas operativas del negocio para un operador autorizado. El calculo vive en reconcile_operational_alerts_for_business y ademas corre solo cada minuto.';

-- ============================================================================
--  El barrido: lo que hace que nada de esto dependa de una persona.
-- ============================================================================
create or replace function public.evaluate_operational_alerts_sweep()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $evaluate_operational_alerts_sweep$
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
$evaluate_operational_alerts_sweep$;

revoke all on function public.evaluate_operational_alerts_sweep() from public, anon, authenticated;
grant execute on function public.evaluate_operational_alerts_sweep() to service_role;

comment on function public.evaluate_operational_alerts_sweep() is
  'Evalua las alertas operativas de todos los negocios activos. Idempotente, con lock consultivo y registro por corrida.';

do $$
begin
  perform cron.schedule(
    'taba-operational-alerts-sweep',
    '* * * * *',
    'select public.evaluate_operational_alerts_sweep();'
  );
end;
$$;
