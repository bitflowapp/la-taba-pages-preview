-- Cobertura completa de alertas operativas del piloto.
--
-- `refresh_operational_alerts` (20260802180000) cubría nueve condiciones, todas
-- de pagos, fiscal e impresión. Le faltaban las que se rompen todos los días en
-- una operación de reparto —un pedido que nadie acepta, uno listo que ningún
-- rider toma, una entrega que se pasó del tiempo, stock que se agota, una
-- reserva que no se liberó, un importe que no coincide, un aviso con firma
-- inválida— y, sobre todo, no distinguía QA de producción.
--
-- Eso último no es un detalle. Medido el 2026-08-07 sobre el escenario
-- sintético: tres alertas CRITICAL de "pago aprobado sin pedido", y una era un
-- checkout QA. Una alerta crítica falsa por cada dos verdaderas entrena al
-- operador a ignorar el tablero, que es peor que no tenerlo.
--
-- Anti-spam, por construcción:
--   * la huella dedupe por (negocio, código, sujeto); repetir la detección
--     actualiza la evidencia, no crea una alerta nueva;
--   * las condiciones que afectan a muchas filas —stock bajo, reservas
--     vencidas, avisos con firma inválida— emiten UNA alerta agregada con la
--     lista adentro, no una por fila;
--   * una alerta reconocida sigue reconocida mientras la condición persista:
--     no vuelve a gritar hasta que se resuelve y reaparece;
--   * el evento de auditoría sólo se escribe al cambiar de estado o tras
--     quince minutos, no en cada lectura del Panel.

create or replace function public.refresh_operational_alerts(p_business_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $refresh_operational_alerts$
declare
  v_finding record;
  v_alert_id uuid;
  v_previous_status text;
  v_previous_seen timestamptz;
  v_fingerprint text;
  v_seen text[] := '{}'::text[];
  v_count integer := 0;
  v_now timestamptz := clock_timestamp();
  v_thresholds jsonb;
  v_accept_sla integer;
  v_rider_sla integer;
  v_delivery_sla integer;
  v_gps_sla integer;
  v_low_stock integer;
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;

  v_thresholds := public.pilot_ops_thresholds(p_business_id);
  v_accept_sla := (v_thresholds #>> '{order_acceptance_minutes,value}')::integer;
  v_rider_sla := (v_thresholds #>> '{rider_assignment_minutes,value}')::integer;
  v_delivery_sla := (v_thresholds #>> '{delivery_minutes,value}')::integer;
  v_gps_sla := (v_thresholds #>> '{rider_signal_stale_minutes,value}')::integer;
  v_low_stock := (v_thresholds #>> '{low_stock_units,value}')::integer;

  for v_finding in
    select * from (
      -- ===== Dinero cobrado sin operación =====
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
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
      where pi.business_id = p_business_id
        and cs.origin = 'production'
        and pi.internal_status in ('approved','approved_order_pending')
        and pi.order_id is null
        and pi.updated_at < v_now - interval '5 minutes'

      union all

      -- Un checkout pago que no llegó a pedido no siempre tiene intento ligado:
      -- el dinero puede estar cobrado y el pedido no existir en ninguna tabla.
      select
        case when cs.updated_at < v_now - interval '15 minutes' then 'CRITICAL' else 'ACTION_REQUIRED' end,
        'CHECKOUT_PAID_WITHOUT_ORDER', 'checkout_session',
        cs.id, cs.correlation_id,
        'Un checkout quedó pago y sin pedido.',
        'Verificar el pago con el proveedor y finalizar la sesión; no volver a cobrar.',
        jsonb_build_object('checkout_session_id', cs.id, 'status', cs.status, 'total', cs.total)
      from public.checkout_sessions cs
      where cs.business_id = p_business_id
        and cs.origin = 'production'
        and cs.completed_order_id is null
        and cs.status in ('payment_approved','finalizing_order')
        and cs.updated_at < v_now - interval '3 minutes'

      union all

      -- El proveedor cobró un importe distinto del que el checkout autorizó.
      select
        'CRITICAL', 'PAYMENT_AMOUNT_MISMATCH', 'payment_intent',
        pi.id, pi.correlation_id,
        'El importe cobrado no coincide con el autorizado.',
        'Comparar importe, moneda y referencia con el proveedor antes de entregar o reembolsar.',
        jsonb_build_object(
          'payment_intent_id', pi.id,
          'expected_amount', pi.expected_amount,
          'paid_amount', pi.paid_amount
        )
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
      where pi.business_id = p_business_id
        and cs.origin = 'production'
        and pi.paid_amount is not null
        and pi.internal_status in ('approved','approved_order_pending','completed')
        and pi.paid_amount <> pi.expected_amount

      union all

      select
        'ACTION_REQUIRED', 'PAYMENT_RECONCILIATION_REQUIRED', 'payment_intent',
        pi.id, pi.correlation_id,
        'Pago con resultado ambiguo o revisión de seguridad.',
        'Consultar el proveedor y comparar importe, moneda y referencia antes de continuar.',
        jsonb_build_object('payment_intent_id', pi.id, 'status', pi.internal_status)
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
      where pi.business_id = p_business_id
        and cs.origin = 'production'
        and pi.internal_status in ('ambiguous','security_review_required')

      union all

      -- ===== Circuito del pedido =====
      select
        case when o.created_at < v_now - make_interval(mins => v_accept_sla * 3)
             then 'CRITICAL' else 'ACTION_REQUIRED' end,
        'ORDER_NOT_ACCEPTED', 'order',
        o.id, o.correlation_id,
        'Un pedido lleva demasiado tiempo sin que el negocio lo acepte.',
        'Abrir Pedidos y aceptarlo o rechazarlo con motivo; el cliente está esperando una respuesta.',
        jsonb_build_object(
          'order_id', o.id, 'public_code', o.public_code,
          'waiting_minutes', round(extract(epoch from (v_now - o.created_at)) / 60.0),
          'threshold_minutes', v_accept_sla
        )
      from public.orders o
      where o.business_id = p_business_id
        and o.origin = 'production'
        and public.order_pipeline_state(o.status) = 'received'
        and o.created_at < v_now - make_interval(mins => v_accept_sla)

      union all

      select
        'ACTION_REQUIRED', 'ORDER_READY_WITHOUT_RIDER', 'order',
        o.id, o.correlation_id,
        'Un pedido está listo y ningún rider lo tomó.',
        'Asignar un rider desde el Panel o avisar al cliente si no hay reparto disponible.',
        jsonb_build_object(
          'order_id', o.id, 'public_code', o.public_code,
          'waiting_minutes', round(extract(epoch from (v_now - coalesce(o.ready_at, o.updated_at))) / 60.0),
          'threshold_minutes', v_rider_sla
        )
      from public.orders o
      where o.business_id = p_business_id
        and o.origin = 'production'
        and o.delivery_mode = 'delivery'
        and public.order_pipeline_state(o.status) = 'ready'
        and o.assigned_rider_user_id is null
        and coalesce(o.ready_at, o.updated_at) < v_now - make_interval(mins => v_rider_sla)

      union all

      select
        'WARNING', 'DELIVERY_OVERDUE', 'order',
        o.id, o.correlation_id,
        'Una entrega en curso pasó el tiempo esperado.',
        'Contactar al rider y actualizar al cliente; no marcar entregado sin el código.',
        jsonb_build_object(
          'order_id', o.id, 'public_code', o.public_code, 'status', o.status,
          'elapsed_minutes', round(extract(epoch from (v_now - coalesce(o.ready_at, o.accepted_at, o.created_at))) / 60.0),
          'threshold_minutes', v_delivery_sla
        )
      from public.orders o
      where o.business_id = p_business_id
        and o.origin = 'production'
        and public.order_pipeline_state(o.status) in ('assigned','picked_up','on_the_way','arrived')
        and coalesce(o.ready_at, o.accepted_at, o.created_at) < v_now - make_interval(mins => v_delivery_sla)

      union all

      select
        'WARNING', 'RIDER_SIGNAL_STALE', 'order',
        o.id, o.correlation_id,
        'Rider sin señal reciente durante una entrega activa.',
        'Contactar al Rider y verificar el estado sin inventar una ubicación.',
        jsonb_build_object(
          'order_id', o.id, 'status', o.status,
          'threshold_minutes', v_gps_sla,
          'last_signal_at', last_location.created_at
        )
      from public.orders o
      left join lateral (
        select rl.created_at
        from public.rider_locations rl
        where rl.order_id = o.id
        order by rl.created_at desc
        limit 1
      ) last_location on true
      where o.business_id = p_business_id
        and o.origin = 'production'
        and o.status in ('assigned','picked_up','on_the_way','arrived')
        and coalesce(last_location.created_at, o.updated_at) < v_now - make_interval(mins => v_gps_sla)

      union all

      -- ===== Inventario: una alerta agregada, no una por producto =====
      select
        'ACTION_REQUIRED', 'LOW_STOCK', 'inventory',
        null::uuid, null::uuid,
        'Hay productos publicados por debajo del stock mínimo.',
        'Reponer o despublicar; un producto en góndola sin stock genera cancelaciones.',
        jsonb_build_object(
          'threshold_units', v_low_stock,
          'product_count', low.total,
          'products', low.sample
        )
      from (
        select
          count(*) as total,
          coalesce(jsonb_agg(jsonb_build_object('product_id', ranked.id, 'name', left(ranked.name, 60), 'stock', ranked.stock)
                             order by ranked.rank) filter (where ranked.rank <= 10), '[]'::jsonb) as sample
        from (
          select p.id, p.name, p.stock,
                 row_number() over (order by p.stock, p.name) as rank
          from public.products p
          where p.business_id = p_business_id
            and p.is_active and p.is_verified
            and p.stock is not null
            and p.stock <= v_low_stock
        ) ranked
      ) low
      where low.total > 0

      union all

      select
        case when expired.oldest < v_now - interval '30 minutes' then 'CRITICAL' else 'ACTION_REQUIRED' end,
        'STOCK_RESERVATION_EXPIRED', 'inventory',
        null::uuid, null::uuid,
        'Hay reservas de stock vencidas que nadie liberó.',
        'Verificar la tarea taba-checkout-expiry-sweep; el stock reservado no se puede vender.',
        jsonb_build_object(
          'reservation_count', expired.total,
          'units_held', expired.units,
          'oldest_minutes', round(extract(epoch from (v_now - expired.oldest)) / 60.0)
        )
      from (
        select count(*) as total, coalesce(sum(r.quantity), 0) as units, min(r.expires_at) as oldest
        from public.inventory_reservations r
        join public.checkout_sessions cs on cs.id = r.checkout_session_id
        where cs.business_id = p_business_id
          and r.status = 'active'
          and r.expires_at < v_now - interval '5 minutes'
      ) expired
      where expired.total > 0

      union all

      -- ===== Avisos del proveedor con comportamiento anormal =====
      select
        'CRITICAL', 'WEBHOOK_SIGNATURE_REJECTED', 'webhook',
        null::uuid, null::uuid,
        'Llegaron avisos de pago con firma inválida.',
        'Verificar el secreto del webhook y revisar si alguien está enviando avisos falsos.',
        jsonb_build_object('rejected_last_hour', rejected.total, 'last_at', rejected.last_at)
      from (
        select count(*) as total, max(r.received_at) as last_at
        from public.payment_webhook_receipts r
        where r.processing_status = 'rejected_signature'
          and r.received_at > v_now - interval '1 hour'
      ) rejected
      where rejected.total > 0

      union all

      select
        'ACTION_REQUIRED', 'WEBHOOK_PROCESSING_FAILED', 'webhook',
        null::uuid, null::uuid,
        'Hay avisos de pago que no se pudieron procesar.',
        'Revisar el worker de pagos y reprocesar; el pedido puede existir sin cobro confirmado.',
        jsonb_build_object('failed_last_day', failed.total, 'last_at', failed.last_at)
      from (
        select count(*) as total, max(r.received_at) as last_at
        from public.payment_webhook_receipts r
        where r.processing_status in ('failed','dead_letter')
          and r.received_at > v_now - interval '24 hours'
      ) failed
      where failed.total > 0

      union all

      -- ===== Colas =====
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
          or (fo.state in ('pending','retry_wait') and fo.next_attempt_at < v_now - interval '15 minutes')
          or (fo.state = 'leased' and fo.lease_deadline < v_now)
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
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
      where pi.business_id = p_business_id
        and cs.origin = 'production'
        and (
          po.status in ('failed','dead_letter')
          or (po.status in ('pending','retry_wait') and po.next_attempt_at < v_now - interval '15 minutes')
          or (po.status in ('claimed','processing') and po.lease_expires_at < v_now)
        )

      union all

      select
        case when n.state = 'dead_letter' then 'ACTION_REQUIRED' else 'WARNING' end,
        'NOTIFICATION_OUTBOX_STALLED', 'notification',
        n.id, null::uuid,
        'Un aviso al negocio no se pudo entregar.',
        'Revisar el consumidor de avisos; el pedido existe aunque la campana no haya sonado.',
        jsonb_build_object('notification_id', n.id, 'state', n.state, 'attempts', n.attempt_count)
      from public.notification_outbox n
      where n.business_id = p_business_id
        and (
          n.state in ('failed','dead_letter')
          or (n.state = 'pending' and n.next_attempt_at < v_now - interval '15 minutes')
        )

      union all

      -- ===== Fiscal =====
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
        and coalesce(fao.created_at, fd.authorized_at, fd.created_at) < v_now - interval '10 minutes'

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

      -- ===== Señales publicadas por servicios externos =====
      select
        shs.severity, shs.signal_code, 'service_health', shs.id,
        shs.correlation_id,
        'Un servicio operativo reportó estado degradado.',
        'Abrir diagnóstico y ejecutar el runbook indicado para el servicio.',
        jsonb_build_object('signal_id', shs.id, 'service', shs.service, 'status', shs.status)
      from public.service_health_signals shs
      where shs.business_id = p_business_id
        and shs.expires_at > v_now
        and shs.status <> 'healthy'
    ) findings
  loop
    v_fingerprint := encode(digest(
      p_business_id::text || ':' || v_finding.alert_code || ':' || coalesce(v_finding.subject_id::text, 'none'),
      'sha256'
    ), 'hex');
    v_seen := array_append(v_seen, v_fingerprint);
    select status, last_seen_at into v_previous_status, v_previous_seen
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
      -- Una alerta reconocida sigue reconocida mientras la condición siga:
      -- el operador ya la vio y no necesita que le grite de nuevo.
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
  set status = 'resolved', resolved_at = clock_timestamp(),
      resolution_note = 'Condición ausente en la reconciliación automática.', updated_at = clock_timestamp()
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
$refresh_operational_alerts$;

-- Las alertas viejas de pedidos QA quedaron abiertas de antes de esta cobertura.
-- Se cierran con motivo y quedan auditadas: la evidencia del fixture no se borra,
-- deja de contaminar la bandeja del operador.
with qa_alerts as (
  select a.id, a.business_id
  from public.operational_alerts a
  where a.status <> 'resolved'
    and (
      exists (
        select 1 from public.orders o
         where o.id = a.subject_id and o.origin = 'qa'
      )
      or exists (
        select 1 from public.checkout_sessions cs
         where cs.id = a.subject_id and cs.origin = 'qa'
      )
      or exists (
        select 1 from public.payment_intents pi
          join public.checkout_sessions cs on cs.id = pi.checkout_session_id
         where pi.id = a.subject_id and cs.origin = 'qa'
      )
    )
),
closed as (
  update public.operational_alerts a
     set status = 'resolved',
         resolved_at = clock_timestamp(),
         resolution_note = 'Sujeto de origen QA: queda fuera de la operación real.',
         updated_at = clock_timestamp()
    from qa_alerts
   where a.id = qa_alerts.id
  returning a.id, a.business_id
)
insert into public.operational_alert_events (business_id, alert_id, event_type, detail)
select closed.business_id, closed.id, 'resolved',
       jsonb_build_object('resolution', 'qa_subject_excluded', 'migration', '20260807130000')
from closed;

comment on function public.refresh_operational_alerts(uuid) is
  'Reconcilia dieciocho condiciones operativas contra la bandeja durable. Excluye sujetos QA, agrega las condiciones masivas en una sola alerta y respeta el reconocimiento del operador.';
