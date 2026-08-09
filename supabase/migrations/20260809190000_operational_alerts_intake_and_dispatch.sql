-- ============================================================================
--  Dos huecos del plano de control operativo, medidos.
-- ============================================================================
--
--  El Centro de operación ya detecta pago aprobado sin pedido, pagos ambiguos,
--  colas trabadas y Rider sin señal. Le faltan exactamente dos cosas que este
--  encargo midió sobre base efímera con las 63 migraciones aplicadas:
--
--  1. CHECKOUT_PROVIDER_UNVERIFIED
--     Bloque C del drill de intake: un checkout que se fue a Mercado Pago,
--     venció y nunca fue pedido queda con `internal_status = expired` y
--     `provider_payment_id = NULL`. Ninguna detección existente lo mira: la de
--     pago-sin-pedido exige `approved`, y la de revisión exige `ambiguous` o
--     `security_review_required`. Si el barrido de verdad del proveedor
--     (20260809180000) no corre —cron caído, Vault sin secreto, Edge Function
--     fuera de servicio— nadie vuelve a preguntar y el cobro queda invisible.
--     Esta alerta es la red de esa red: se dispara cuando el checkout llegó al
--     proveedor, venció hace rato y las sondas se agotaron sin respuesta.
--
--  2. ORDER_READY_WITHOUT_RIDER
--     Bloque H del drill de despacho: un pedido `ready` de delivery, cuarenta
--     minutos sin que nadie lo tome, produjo CERO alertas. Aparecía sólo en la
--     métrica `delayed_orders`, que se calcula contra la estimación de
--     preparación y no distingue «la cocina va lenta» de «está listo y no hay
--     quien lo lleve». Son dos problemas distintos y se resuelven distinto.
--
--  El resto de la función se reproduce sin un solo cambio.
-- ============================================================================

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
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;

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

      -- ===== NUEVO =====
      -- El checkout llegó a Mercado Pago, venció sin volverse pedido y las
      -- sondas al proveedor se agotaron o nunca corrieron. Puede haber un cobro
      -- del que este lado no tiene registro. No se afirma que exista: se afirma
      -- que NO SE SABE, que es justamente lo que hay que ir a mirar.
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
        -- La misma ventana que el barrido de 20260809180000, a proposito: si la
        -- alerta abarcara mas que la sonda, habria checkouts que gritan para
        -- siempre porque nadie los va a consultar nunca.
        and cs.created_at > clock_timestamp() - interval '48 hours'
        -- Y si el proveedor YA dijo que no hay pago, no hay nada que ignorar.
        -- Esto es lo que hace que la alerta se apague sola a medida que el
        -- barrido avanza, en vez de acumularse.
        and not exists (
          select 1 from public.payment_events pe
           where pe.payment_intent_id = pi.id
             and pe.event_type = 'payment.provider_probe_empty'
        )

      union all

      -- ===== NUEVO =====
      -- Listo para salir y sin nadie que lo lleve. Distinto de `delayed_orders`,
      -- que mide la preparación contra su estimación.
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
        -- Se ancla en `ready_at`, que marca cuándo quedó listo. `updated_at` lo
        -- repisa cualquier escritura sobre la fila y mediría otra cosa.
        and coalesce(o.ready_at, o.updated_at) < clock_timestamp() - interval '15 minutes'

      union all

      -- ===== NUEVO =====
      -- Reserva vencida que sigue reteniendo stock: el barrido de expiración no
      -- está corriendo y el catálogo se vacía sin haber vendido. Existía como
      -- `list_stock_reservation_alerts`, pero es service_role y el negocio no la
      -- ve; acá entra al mismo tablero que mira todos los días.
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
$refresh_operational_alerts$;

-- ===== Salud del webhook, que no pertenece a ningún negocio =====
-- `payment_webhook_receipts` no tiene business_id: es infraestructura. Si las
-- notificaciones llegan y la firma nunca valida, la vía principal de cobro está
-- muerta y el sistema se apoya entero en el barrido y en que el cliente vuelva.
-- Eso tiene que poder mirarse sin abrir la base.
create or replace function public.list_webhook_signature_alerts()
returns table (
  severity text,
  environment text,
  rejected_count bigint,
  accepted_count bigint,
  last_rejected_at timestamptz,
  state text,
  action text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    case when count(*) filter (where r.processing_status = 'rejected_signature') > 0
      and count(*) filter (where r.signature_valid) = 0 then 'critical' else 'warning' end,
    r.environment,
    count(*) filter (where r.processing_status = 'rejected_signature'),
    count(*) filter (where r.signature_valid),
    max(r.received_at) filter (where r.processing_status = 'rejected_signature'),
    'webhook_signature_rejected',
    'verificar MERCADOPAGO_WEBHOOK_SECRET contra el panel del proveedor'
  from public.payment_webhook_receipts r
  where r.received_at > clock_timestamp() - interval '24 hours'
  group by r.environment
  having count(*) filter (where r.processing_status = 'rejected_signature') > 0;
$$;

revoke all on function public.list_webhook_signature_alerts() from public, anon, authenticated;
grant execute on function public.list_webhook_signature_alerts() to service_role;

comment on function public.list_webhook_signature_alerts() is
  'Notificaciones cuya firma no valida en las ultimas 24 horas: la via principal de cobro puede estar muerta.';

-- Se preservan los permisos originales de 20260802180000: la función valida el
-- rol adentro y el Panel la alcanza a través de get_production_operation_center.
revoke execute on function public.refresh_operational_alerts(uuid) from public, anon;
grant execute on function public.refresh_operational_alerts(uuid) to authenticated;

comment on function public.refresh_operational_alerts(uuid) is
  'Reconcilia las alertas operativas del negocio. Incluye checkout sin confirmar contra el proveedor y pedido listo sin Rider.';
