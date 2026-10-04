-- TABA · LO QUE NO AVISABA, AHORA AVISA: TAREAS APAGADAS, AVISOS DE PAGO SIN PROCESAR,
-- DEVOLUCIONES A MEDIAS Y COBROS PARA REVISAR
--
-- QUÉ SE MIDIÓ (2026-10-03, sobre la rama con sus 190 migraciones; cada punto se
-- reprodujo antes de tocar nada y en todos la reconciliación devolvía cero hallazgos)
--
--   1. Una tarea de pg_cron apagada o borrada (DIAG-05). Las dos alertas del
--      planificador filtran `sh.active` y la lista se arma con lo que existe en
--      `cron.job`: apagar `taba-checkout-expiry-sweep` no abría nada, y una tarea del
--      inventario sin programar tampoco.
--   2. Un aviso de Mercado Pago que la cola abandonó (DIAG-02). El trabajo nace sin
--      intento de pago y las ramas PAYMENT_OUTBOX_STALLED y PAYMENT_WORKER_IDLE lo
--      pierden en su JOIN. La salud del mismo negocio ya lo contaba (`dead_letter`: 1,
--      «no está tomando trabajo») y las alertas decían que no pasaba nada.
--   3. Una devolución que quedó `requested`: sin trabajo en la cola, 40 minutos
--      después nadie se enteraba, y bloquea cualquier otra devolución del mismo cobro.
--   4. Un segundo pago aprobado sobre el mismo checkout (`payment.duplicate_approved`),
--      un estado que el proveedor informa después de creado el pedido
--      (`payment.post_completion_anomaly`, por ejemplo un reclamo) y un contracargo:
--      quedaban como una fila de `payment_events` y nada más.
--
-- QUÉ CAMBIA
--
--   `reconcile_operational_alerts_for_business` recibe seis ramas nuevas. Se generó de
--   su definición viva con una sola inserción, contada; todo lo que ya estaba queda
--   letra por letra (el diff de las notas de la entrega no tiene ninguna línea
--   quitada).
--
--     SCHEDULER_JOB_MISSING    crítica. Una tarea de `private.scheduler_expected_jobs`
--                              que no está en `cron.job`. Se cierra cuando se la
--                              programa o se la quita del inventario.
--     SCHEDULER_JOB_DISABLED   crítica. Una tarea del inventario con `active = false`.
--                              Se cierra cuando se la enciende.
--     PAYMENT_OUTBOX_STALLED   mismos umbrales de siempre, ahora también para el
--                              aviso sin intento de pago, atribuido al negocio del
--                              vendedor que lo recibió (como `build_operational_health`
--                              desde 20261001220500). Cualquier tema de la cola.
--     PAYMENT_WORKER_IDLE      ídem, para los avisos vencidos que nadie toma.
--     REFUND_NEEDS_ATTENTION   acción requerida. Una devolución `requested`,
--                              `processing` o `ambiguous` (las tres que bloquean
--                              pedir otra) pedida hace más de 15 minutos. Se cierra
--                              cuando llega a un estado final.
--     PAYMENT_NEEDS_REVIEW     una por cobro, con sus motivos. Crítica si hay un pago
--                              duplicado sin devolver. Ningún motivo se cierra por
--                              tiempo:
--                                · el pago duplicado, sólo cuando Mercado Pago lo
--                                  informa devuelto;
--                                · la anomalía posterior al pedido, con una lectura
--                                  válida posterior de ese mismo pago;
--                                · el reclamo o el contracargo, cuando el proveedor
--                                  deja de informarlo;
--                                · y estos dos últimos también cuando el dueño o un
--                                  encargado activo da la alerta por resuelta con su
--                                  nota (un contracargo perdido no cambia nunca de
--                                  estado). Esa resolución vale hasta que el
--                                  proveedor informe algo nuevo sobre lo mismo. La de
--                                  un empleado no cuenta: no ve el cobro.
--
--   Las dos del planificador siguen la convención de SCHEDULER_JOB_FAILING y
--   SCHEDULER_JOB_STALLED: la condición es de toda la plataforma y se anota una vez
--   por negocio.
--
--   Además: `private.payment_review_findings` (la consulta de PAYMENT_NEEDS_REVIEW,
--   aparte para probarla sola) y un índice parcial sobre `payment_events` para que el
--   barrido de cada minuto encuentre esos dos asientos sin leer toda la historia.
--
-- QUÉ NO CAMBIA
--
--   · Firma, SECURITY DEFINER, `search_path` y permisos de la reconciliación (sólo
--     `service_role`).
--   · Ninguna rama existente, ningún umbral existente, ni cómo se abre, se repite o
--     se cierra una alerta.
--   · Ninguna fila: no se escribe ni se borra nada. Las alertas nuevas aparecen en la
--     primera corrida del barrido si su condición ya existe.
--   · La conciliación de caja y el cobro manual (otra línea de trabajo) y el envío de
--     alertas fuera del Panel.
--
-- QUÉ QUEDA AFUERA
--
--   · Un aviso que llegó sin vendedor (el modo anterior a la conexión por negocio) no
--     es de ningún negocio: sigue sin alerta, igual que en `build_operational_health`,
--     y lo cuenta `get_ecommerce_health()`.
--   · Un aviso con la firma rechazada: es tráfico sin autenticar y no se vuelve una
--     alerta por negocio; también lo cuenta `get_ecommerce_health()`.
--   · Una disputa abierta en `payment_disputes` (reclamos y contracargos que llegan
--     por su propio tema, sólo en el modo anterior) no abre PAYMENT_NEEDS_REVIEW por
--     sí sola. El contracargo que el proveedor informa en el pago (`charged_back`) y
--     el reclamo que llega como `in_mediation` sobre un pedido ya creado, sí.
--
-- LO QUE VA A VERSE AL DESPLEGAR
--
--   · Una tarea del inventario que hoy esté apagada o sin programar abre una alerta
--     crítica en cada negocio. Con una pausa de release en curso (todas las tareas
--     apagadas), quien abra el Panel ve una SCHEDULER_JOB_DISABLED por tarea. Es
--     cierto mientras dura la pausa, y el primer barrido después de reanudar las
--     cierra.
--   · Un aviso de Mercado Pago abandonado (`dead_letter`) queda con su alerta abierta
--     hasta que alguien resuelva ese trabajo: hoy no hay ninguna función que lo saque
--     de ahí, igual que pasa con los trabajos abandonados que sí tienen intento.
--   · El Panel todavía no tiene texto propio para los cuatro códigos nuevos: los
--     muestra con su texto genérico hasta que se agreguen a su biblioteca.
--
-- Depende de 20261001220000 (inventario de tareas) y 20261001222000 (definición
-- vigente de la reconciliación). Forward-only. Reversión:
--   docs/migrations/rollback/20261002011000_operational_alert_coverage.rollback.sql

-- ── 1. Los dos asientos raros se encuentran sin recorrer la historia ───────
-- `payment.duplicate_approved` y `payment.post_completion_anomaly` son muy pocos
-- frente al resto de `payment_events`. El barrido corre cada minuto por negocio: sin
-- este índice tendría que leer todos los asientos de todos los cobros del negocio
-- para encontrarlos.
create index if not exists payment_events_review_idx
  on public.payment_events (payment_intent_id)
  where event_type in ('payment.duplicate_approved', 'payment.post_completion_anomaly');

-- ── 2. Qué cobros necesitan que una persona los mire ───────────────────────
-- Una fila por cobro, con todos sus motivos. Lo usa SÓLO la reconciliación de
-- alertas; vive aparte para poder probarla sola y para que la función grande reciba
-- una rama corta.
--
-- Cuándo deja de figurar cada motivo (ninguno por tiempo):
--
--   · pago duplicado: cuando el ÚLTIMO asiento de ese otro pago ya no pide
--     devolución (llegó devuelto, cancelado o contracargado). Ese asiento lo trae
--     el aviso de Mercado Pago de la devolución; si el aviso no llega, sigue
--     figurando. Una persona NO lo puede dar por resuelto: es dinero del cliente y
--     lo cierra sólo lo que informe el proveedor.
--   · anomalía posterior al pedido: cuando hay una lectura VÁLIDA posterior del
--     mismo pago (la misma regla con la que `resolve_stuck_payment_refund` reconoce
--     una lectura válida: `event_type = 'payment.' || provider_status`), o cuando
--     una persona dio la alerta por resuelta DESPUÉS de esa anomalía.
--   · reclamo o contracargo: cuando el estado del proveedor guardado en el cobro
--     deja de ser `in_mediation` o `charged_back`, o cuando una persona dio la
--     alerta por resuelta DESPUÉS de la última escritura del cobro. Un contracargo
--     perdido queda `charged_back` para siempre: sin esta salida la alerta no se
--     cerraría nunca.
--
-- «Una persona la dio por resuelta» es el evento `resolved` con autor que deja
-- `transition_operational_alert` (pide una nota), y cuenta sólo si esa persona es hoy
-- dueña o encargada activa del negocio: los cobros y las devoluciones son cosa de esos
-- dos roles en todo el Panel, y el empleado, que ve la alerta pero no ve el cobro, no
-- la puede apagar (si la marca resuelta, la corrida siguiente la reabre). Si después
-- llega algo nuevo del proveedor sobre lo mismo, el motivo vuelve a figurar.
create or replace function private.payment_review_findings(p_business_id uuid)
returns table (
  payment_intent_id uuid,
  correlation_id uuid,
  order_id uuid,
  provider_payment_id text,
  duplicate_payment_ids text[],
  anomaly_reasons text[],
  anomaly_provider_statuses text[],
  dispute_provider_status text
)
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $$
  with candidate as materialized (
    -- Por el índice parcial: los cobros de cualquier negocio con alguno de los dos
    -- asientos (son pocos), filtrados después por negocio.
    select distinct pe.payment_intent_id as id
      from public.payment_events pe
     where pe.event_type in ('payment.duplicate_approved', 'payment.post_completion_anomaly')
    union
    select pi.id
      from public.payment_intents pi
     where pi.business_id = p_business_id
       and pi.provider_status in ('in_mediation', 'charged_back')
  ),
  scoped as materialized (
    select pi.id, pi.correlation_id, pi.order_id, pi.provider_payment_id, pi.provider_status, pi.updated_at,
           (select max(e.created_at)
              from public.operational_alerts a
              join public.operational_alert_events e on e.alert_id = a.id
              join public.business_members bm
                on bm.business_id = a.business_id
               and bm.user_id = e.actor_id
               and bm.role in ('owner', 'admin')
               and bm.is_active
             where a.business_id = p_business_id
               and a.alert_code = 'PAYMENT_NEEDS_REVIEW'
               and a.subject_id = pi.id
               and e.event_type = 'resolved'
               and e.actor_id is not null) as reviewed_at
      from candidate c
      join public.payment_intents pi on pi.id = c.id and pi.business_id = p_business_id
  )
  select
    s.id,
    s.correlation_id,
    s.order_id,
    left(s.provider_payment_id, 64),
    dup.ids,
    anomaly.reasons,
    anomaly.statuses,
    dispute.provider_status
  from scoped s
  left join lateral (
    -- Por cada OTRO pago que alguna vez llegó aprobado sobre este cobro, manda su
    -- último asiento: si sigue aprobado y con devolución pendiente, falta devolverlo.
    select array_agg(left(last_seen.provider_event_id, 64) order by last_seen.sequence) as ids
      from (
        select distinct on (pe.provider_event_id)
               pe.provider_event_id, pe.event_type, pe.details, pe.sequence
          from public.payment_events pe
         where pe.payment_intent_id = s.id
           and pe.event_type in ('payment.duplicate_approved', 'payment.secondary_payment')
           and pe.provider_event_id is not null
         order by pe.provider_event_id, pe.sequence desc
      ) last_seen
     where last_seen.event_type = 'payment.duplicate_approved'
       -- Todo lo que no sea un `false` explícito pide devolución: ante la duda, se avisa.
       and last_seen.details ->> 'refund_review_required' is distinct from 'false'
  ) dup on true
  left join lateral (
    select array_agg(distinct open_anomaly.reason) as reasons,
           array_agg(distinct open_anomaly.provider_status)
             filter (where open_anomaly.provider_status is not null) as statuses
      from (
        -- Lo que viene del proveedor se copia a la evidencia sólo si tiene forma de
        -- código: nunca un texto libre.
        select case when pe.details ->> 'reason' ~ '^[a-z_]{1,60}$' then pe.details ->> 'reason' else 'other' end as reason,
               case when pe.provider_status ~ '^[a-z_]{1,40}$' then pe.provider_status end as provider_status
          from public.payment_events pe
         where pe.payment_intent_id = s.id
           and pe.event_type = 'payment.post_completion_anomaly'
           and (s.reviewed_at is null or pe.server_recorded_at > s.reviewed_at)
           and not exists (
             select 1
               from public.payment_events later
              where later.payment_intent_id = pe.payment_intent_id
                and later.sequence > pe.sequence
                and later.provider_event_id = coalesce(pe.provider_event_id, s.provider_payment_id)
                and later.provider_status is not null
                and later.event_type in (
                  'payment.' || later.provider_status, 'payment.duplicate_approved', 'payment.secondary_payment')
           )
      ) open_anomaly
  ) anomaly on true
  left join lateral (
    select s.provider_status
     where s.provider_status in ('in_mediation', 'charged_back')
       and (s.reviewed_at is null or s.updated_at > s.reviewed_at)
  ) dispute on true
  where dup.ids is not null
     or anomaly.reasons is not null
     or dispute.provider_status is not null;
$$;

revoke all on function private.payment_review_findings(uuid) from public, anon, authenticated, service_role;

comment on function private.payment_review_findings(uuid) is
  'Cobros de un negocio que necesitan revision de una persona: otro pago aprobado sin devolver, anomalia posterior al pedido sin una lectura valida despues, o el proveedor informando reclamo o contracargo. Los dos ultimos motivos dejan de figurar tambien cuando el dueno o un encargado activo dio la alerta por resuelta despues del hecho. Solo la usa reconcile_operational_alerts_for_business.';

-- ── 3. La reconciliación, con las ramas nuevas ──────────────────────────────
-- Generada de la definición viva con una sola inserción, contada: las ramas van al
-- final de la lista de hallazgos, antes de que el bucle las recorra.
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

      -- ======================================================================
      --  NUEVO (20261002011000) · lo que hasta acá no levantaba ninguna alerta.
      --  Todo lo de abajo son ramas agregadas; las de arriba no se tocaron.
      -- ======================================================================

      -- Una tarea del inventario que no está programada. La salud del planificador
      -- arma su lista con lo que existe en `cron.job`: una tarea borrada dejaba de
      -- figurar y nada la echaba de menos. Sin pg_cron no hay contra qué comparar:
      -- ese caso lo dicen la sonda del vigilante y `get_ecommerce_health`.
      -- Como las otras dos alertas del planificador, la condición es de toda la
      -- plataforma y se anota una vez por negocio.
      union all

      select
        'CRITICAL', 'SCHEDULER_JOB_MISSING', 'service_health',
        md5(e.job_name || ':missing')::uuid, null::uuid,
        'Una tarea automática del sistema no está programada.',
        'Volver a programar la tarea; mientras falte, lo que hace no ocurre solo y depende de que alguien mire el Panel.',
        jsonb_build_object(
          'job', e.job_name,
          'purpose', e.purpose,
          'expected_since', e.expected_since
        )
      from private.scheduler_expected_jobs e
      where to_regclass('cron.job') is not null
        and to_regclass('cron.job_run_details') is not null
        and not exists (select 1 from scheduler sh where sh.job_name = e.job_name)

      -- Una tarea del inventario que existe pero está apagada. Las dos ramas de
      -- arriba filtran `sh.active`: una tarea apagada no figuraba ni fallando ni
      -- detenida, y apagar una tarea detenida CERRABA su alerta.
      union all

      select
        'CRITICAL', 'SCHEDULER_JOB_DISABLED', 'service_health',
        md5(sh.job_name || ':disabled')::uuid, null::uuid,
        'Una tarea automática del sistema está apagada.',
        'Volver a encender la tarea; mientras esté apagada, lo que hace no ocurre solo y depende de que alguien mire el Panel.',
        jsonb_build_object(
          'job', sh.job_name,
          'schedule', sh.schedule,
          'purpose', e.purpose,
          'last_success_at', sh.last_success_at
        )
      from scheduler sh
      join private.scheduler_expected_jobs e on e.job_name = sh.job_name
      where not sh.active

      -- Un aviso de Mercado Pago se encola SIN intento de pago (todavía no se sabe de
      -- qué checkout es) y la rama PAYMENT_OUTBOX_STALLED de arriba lo pierde en su
      -- JOIN. Su negocio es el del vendedor que lo recibió, igual que en
      -- `build_operational_health`. Mismos umbrales que la rama de arriba. El sujeto
      -- es el trabajo de la cola: no hay intento al que apuntar. Si el aviso habla de
      -- un pago que algún cobro del negocio ya conoce, lleva la correlación de ese
      -- cobro (la misma regla con la que la traza del pedido une avisos y cobros).
      union all

      select
        case when po.status = 'dead_letter' then 'CRITICAL' else 'ACTION_REQUIRED' end,
        'PAYMENT_OUTBOX_STALLED', 'payment_outbox',
        po.id,
        (select known.correlation_id
           from public.payment_intents known
          where known.business_id = p_business_id
            and known.provider = wr.provider
            and known.environment = wr.environment
            and known.provider_payment_id = po.resource_id),
        'La cola de pagos no progresa.',
        'Revisar el worker y buscar el pago en Mercado Pago por su identificador: el aviso llegó y todavía no se pudo procesar.',
        jsonb_build_object(
          'payment_outbox_id', po.id,
          'topic', po.topic,
          'outbox_status', po.status,
          'attempts', po.attempts,
          'webhook_receipt_id', po.webhook_receipt_id,
          'environment', wr.environment,
          'provider_resource_id', left(po.resource_id, 64)
        )
      from public.payment_outbox po
      join public.payment_webhook_receipts wr on wr.id = po.webhook_receipt_id
      where po.payment_intent_id is null
        and wr.seller_business_id = p_business_id
        and (
          po.status in ('failed','dead_letter')
          or (po.status in ('pending','retry_wait') and po.next_attempt_at < clock_timestamp() - interval '15 minutes')
          or (po.status in ('claimed','processing') and po.lease_expires_at < clock_timestamp())
        )

      -- Lo mismo para PAYMENT_WORKER_IDLE: los avisos del vendedor vencidos que nadie
      -- toma. Va con su propio sujeto para no pisar la cuenta de la rama de arriba,
      -- que sigue contando los trabajos con intento.
      union all

      select
        'CRITICAL', 'PAYMENT_WORKER_IDLE', 'service_health',
        md5('payment_worker_idle:provider_notifications')::uuid, null::uuid,
        'Hay avisos de Mercado Pago vencidos en la cola y nadie los está tomando.',
        'Confirmar cada pago en Mercado Pago antes de entregar; el procesamiento automático no está corriendo.',
        jsonb_build_object(
          'scope', 'provider_notifications',
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
        join public.payment_webhook_receipts wr on wr.id = po.webhook_receipt_id
        where po.payment_intent_id is null
          and wr.seller_business_id = p_business_id
          and (
            (po.status in ('pending','retry_wait') and po.next_attempt_at < clock_timestamp() - interval '5 minutes')
            or (po.status in ('claimed','processing') and po.lease_expires_at < clock_timestamp() - interval '5 minutes')
          )
      ) q
      where q.due_jobs > 0
        and q.last_touch < clock_timestamp() - interval '5 minutes'

      -- Una devolución que no terminó. `requested` no deja ningún trabajo en la cola
      -- (la fila nace antes de llamar al proveedor): si la llamada muere ahí, nada la
      -- mueve y bloquea cualquier otra devolución del mismo cobro. Los 15 minutos son
      -- un umbral técnico, no una regla del comercio: el mismo que la cola de pagos de
      -- arriba le da a un trabajo antes de decir que no progresa, y más que los cinco
      -- minutos después de los cuales `resolve_stuck_payment_refund` ya deja destrabar
      -- la solicitud (la llamada al proveedor se corta a los 12 segundos): cuando la
      -- alerta se abre, el destrabe ya está disponible. Se miden desde que se pidió, no
      -- desde el último reintento: un reintento no puede cerrar la alerta. No vence
      -- sola: se cierra cuando la devolución llega a un estado final (`approved`,
      -- `rejected` o `failed`; los tres dejan pedir otra).
      union all

      select
        'ACTION_REQUIRED', 'REFUND_NEEDS_ATTENTION', 'payment_refund',
        pr.id, pi.correlation_id,
        'Una devolución de dinero quedó a medias.',
        'Revisar en Mercado Pago si la devolución salió; no pedir otra por el mismo cobro hasta resolver ésta.',
        jsonb_build_object(
          'refund_id', pr.id,
          'payment_intent_id', pi.id,
          'order_id', pr.order_id,
          'status', pr.status,
          'waiting_minutes', round(extract(epoch from (clock_timestamp() - pr.requested_at)) / 60),
          'has_provider_identity', pr.provider_refund_id is not null,
          'resolution_mode', pr.resolution_mode
        )
      from public.payment_refunds pr
      join public.payment_intents pi on pi.id = pr.payment_intent_id
      where pi.business_id = p_business_id
        and pr.status in ('requested','processing','ambiguous')
        and pr.requested_at < clock_timestamp() - interval '15 minutes'

      -- Hechos de un cobro que hasta acá eran sólo una fila de `payment_events`: otro
      -- pago aprobado sobre el mismo checkout (el cliente pagó dos veces y el Panel
      -- sólo reembolsa el pago del pedido), una anomalía informada después de creado
      -- el pedido, o el proveedor informando reclamo o contracargo. Una alerta por
      -- cobro, con todos sus motivos; es crítica cuando hay un pago duplicado sin
      -- devolver. Cuándo deja de figurar cada motivo, en
      -- `private.payment_review_findings`; ninguno por tiempo.
      union all

      select
        case when r.duplicate_payment_ids is not null then 'CRITICAL' else 'ACTION_REQUIRED' end,
        'PAYMENT_NEEDS_REVIEW', 'payment_intent',
        r.payment_intent_id, r.correlation_id,
        case when r.duplicate_payment_ids is not null
          then 'El cliente pagó dos veces la misma compra en Mercado Pago.'
          else 'Un cobro de Mercado Pago necesita que una persona lo revise.' end,
        case when r.duplicate_payment_ids is not null
          then 'Devolver el pago duplicado desde el panel de Mercado Pago: desde el Panel sólo se reembolsa el pago del pedido. Se cierra sola cuando Mercado Pago informa la devolución.'
          else 'Abrir el pago en Mercado Pago y revisar el reclamo, el contracargo o la diferencia informada; después, el dueño o un encargado da esta alerta por resuelta con una nota.' end,
        jsonb_strip_nulls(jsonb_build_object(
          'payment_intent_id', r.payment_intent_id,
          'order_id', r.order_id,
          'provider_payment_id', r.provider_payment_id,
          'reasons', array_remove(array[
            case when r.duplicate_payment_ids is not null then 'duplicate_charge' end,
            case when r.anomaly_reasons is not null then 'post_completion_anomaly' end,
            case when r.dispute_provider_status is not null then 'provider_dispute' end
          ], null),
          'duplicate_provider_payment_ids', (r.duplicate_payment_ids)[1:5],
          'duplicate_payments', cardinality(r.duplicate_payment_ids),
          'anomaly_reasons', (r.anomaly_reasons)[1:5],
          'anomaly_provider_statuses', (r.anomaly_provider_statuses)[1:5],
          'provider_status', r.dispute_provider_status
        ))
      from private.payment_review_findings(p_business_id) r
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

revoke all on function public.reconcile_operational_alerts_for_business(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_operational_alerts_for_business(uuid) to service_role;
