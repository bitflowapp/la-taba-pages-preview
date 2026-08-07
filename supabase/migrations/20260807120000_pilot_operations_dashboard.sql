-- La superficie operativa del piloto: una sola lectura contesta si el negocio
-- está sano, qué necesita atención y cómo rindió el día.
--
-- `get_production_operation_center` (20260802180000) ya devolvía trece
-- contadores, pero tiene dos huecos que el piloto no tolera:
--
-- 1. Cuenta pedidos QA como operación real. Se escribió antes de que existiera
--    `orders.origin` (20260806160000), así que LT-0033/34/35 —fixtures de
--    prueba con productos sintéticos— entran en "pedidos nuevos" igual que la
--    compra de un cliente. Cualquier número comercial que salga de ahí miente.
-- 2. No tiene dinero. No hay ventas del día, ni ticket promedio, ni pagos
--    aprobados sin pedido, ni stock a reponer, ni reservas vencidas. Para saber
--    si el negocio facturó había que abrir la consola.
--
-- Esta lectura no reemplaza a la anterior: la deja para las excepciones fiscales
-- y de impresión, y agrega la capa comercial y de circuito que faltaba. Todo lo
-- comercial excluye `origin = 'qa'` y lo dice en el propio payload, para que
-- nadie confunda "no aparece" con "se perdió".

create or replace function public.get_pilot_operations_dashboard(
  p_business_id uuid,
  p_timezone text default 'America/Argentina/Buenos_Aires'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $get_pilot_operations_dashboard$
declare
  v_now timestamptz := clock_timestamp();
  v_tz text := coalesce(nullif(btrim(p_timezone), ''), 'America/Argentina/Buenos_Aires');
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_thresholds jsonb;
  v_low_stock integer;
  v_accept_sla integer;
  v_rider_sla integer;
  v_delivery_sla integer;
  v_gps_sla integer;
  v_today jsonb;
  v_orders jsonb;
  v_payments jsonb;
  v_attention jsonb;
  v_queues jsonb;
  v_stock jsonb;
  v_alerts jsonb;
  v_activity jsonb;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    raise exception 'zona horaria invalida' using errcode = '22023';
  end if;

  -- El día del negocio, no el del servidor: un pedido de las 21:30 en Buenos
  -- Aires pertenece a ese día aunque en UTC ya sea el siguiente.
  v_day_start := (date_trunc('day', v_now at time zone v_tz)) at time zone v_tz;
  v_day_end := v_day_start + interval '1 day';

  -- La reconciliación de alertas corre acá para que el tablero nunca muestre
  -- una alerta que ya no existe ni omita una que acaba de aparecer.
  perform public.refresh_operational_alerts(p_business_id);

  v_thresholds := public.pilot_ops_thresholds(p_business_id);
  v_low_stock := (v_thresholds #>> '{low_stock_units,value}')::integer;
  v_accept_sla := (v_thresholds #>> '{order_acceptance_minutes,value}')::integer;
  v_rider_sla := (v_thresholds #>> '{rider_assignment_minutes,value}')::integer;
  v_delivery_sla := (v_thresholds #>> '{delivery_minutes,value}')::integer;
  v_gps_sla := (v_thresholds #>> '{rider_signal_stale_minutes,value}')::integer;

  -- ===== Hoy: pedidos y plata =====
  -- `revenue_booked` es lo vendido y no anulado; `revenue_delivered` es lo que
  -- efectivamente llegó al cliente. El ticket promedio se calcula sobre lo
  -- vendido y no anulado, y es null si no hubo ninguno: dividir por cero da un
  -- número y no dividir da la verdad.
  with day_orders as (
    select o.*
      from public.orders o
     where o.business_id = p_business_id
       and o.origin = 'production'
       and o.created_at >= v_day_start
       and o.created_at < v_day_end
  ),
  live as (
    select
      count(*) as total,
      count(*) filter (where public.order_pipeline_state(status) not in ('cancelled', 'rejected')) as billable,
      coalesce(sum(total) filter (where public.order_pipeline_state(status) not in ('cancelled', 'rejected')), 0) as revenue_booked,
      coalesce(sum(total) filter (where public.order_pipeline_state(status) = 'delivered'), 0) as revenue_delivered,
      count(*) filter (where public.order_pipeline_state(status) = 'delivered') as delivered,
      count(*) filter (where public.order_pipeline_state(status) = 'cancelled') as cancelled,
      count(*) filter (where public.order_pipeline_state(status) = 'rejected') as rejected
    from day_orders
  )
  select jsonb_build_object(
    'orders', live.total,
    'billable_orders', live.billable,
    'revenue_booked', live.revenue_booked,
    'revenue_delivered', live.revenue_delivered,
    'ticket_average', case when live.billable > 0 then round(live.revenue_booked / live.billable, 2) else null end,
    'delivered', live.delivered,
    'cancelled', live.cancelled,
    'rejected', live.rejected,
    'counter_sales', jsonb_build_object(
      'count', (select count(*) from public.pos_sales ps
                 where ps.business_id = p_business_id and ps.state = 'completed'
                   and ps.completed_at >= v_day_start and ps.completed_at < v_day_end),
      'total', (select coalesce(sum(ps.total), 0) from public.pos_sales ps
                 where ps.business_id = p_business_id and ps.state = 'completed'
                   and ps.completed_at >= v_day_start and ps.completed_at < v_day_end)
    ),
    'qa_orders_excluded', (select count(*) from public.orders o
                            where o.business_id = p_business_id and o.origin = 'qa'
                              and o.created_at >= v_day_start and o.created_at < v_day_end)
  ) into v_today from live;

  -- ===== Pedidos por estado =====
  select jsonb_build_object(
    'open_total', coalesce((
      select count(*) from public.orders o
       where o.business_id = p_business_id and o.origin = 'production'
         and public.order_pipeline_state(o.status) not in ('delivered', 'cancelled', 'rejected')
    ), 0),
    'open_by_state', coalesce((
      select jsonb_object_agg(state, quantity)
        from (
          select public.order_pipeline_state(o.status) as state, count(*) as quantity
            from public.orders o
           where o.business_id = p_business_id and o.origin = 'production'
             and public.order_pipeline_state(o.status) not in ('delivered', 'cancelled', 'rejected')
           group by 1
        ) grouped
    ), '{}'::jsonb),
    'today_by_state', coalesce((
      select jsonb_object_agg(state, quantity)
        from (
          select public.order_pipeline_state(o.status) as state, count(*) as quantity
            from public.orders o
           where o.business_id = p_business_id and o.origin = 'production'
             and o.created_at >= v_day_start and o.created_at < v_day_end
           group by 1
        ) grouped
    ), '{}'::jsonb),
    -- Un checkout que todavía no es pedido también es operación: si se paga y
    -- no aparece, el dinero entró sin que nadie prepare nada.
    'checkouts_open', coalesce((
      select jsonb_object_agg(state, quantity)
        from (
          select public.checkout_pipeline_state(s.status, s.expires_at) as state, count(*) as quantity
            from public.checkout_sessions s
           where s.business_id = p_business_id and s.origin = 'production'
             and s.completed_order_id is null
             and s.created_at >= v_now - interval '24 hours'
           group by 1
        ) grouped
    ), '{}'::jsonb)
  ) into v_orders;

  -- ===== Pagos =====
  select jsonb_build_object(
    'approved_today', jsonb_build_object(
      'count', count(*) filter (where pi.approved_at >= v_day_start and pi.approved_at < v_day_end),
      'amount', coalesce(sum(pi.paid_amount) filter (where pi.approved_at >= v_day_start and pi.approved_at < v_day_end), 0)
    ),
    'pending', jsonb_build_object(
      'count', count(*) filter (where pi.internal_status in (
        'created', 'preference_creating', 'preference_created', 'redirected', 'pending', 'in_process'
      )),
      'oldest_minutes', coalesce(round(extract(epoch from (v_now - min(pi.updated_at) filter (where pi.internal_status in (
        'created', 'preference_creating', 'preference_created', 'redirected', 'pending', 'in_process'
      )))) / 60.0), 0)
    ),
    'failed_today', jsonb_build_object(
      'count', count(*) filter (
        where pi.internal_status in ('rejected', 'failed', 'cancelled', 'expired', 'charged_back')
          and coalesce(pi.rejected_at, pi.updated_at) >= v_day_start
          and coalesce(pi.rejected_at, pi.updated_at) < v_day_end
      )
    ),
    'in_review', jsonb_build_object(
      'count', count(*) filter (where pi.internal_status in ('ambiguous', 'security_review_required'))
    ),
    -- Dinero cobrado sin operación. Es la excepción más cara del circuito y por
    -- eso viaja con su antigüedad: a los cinco minutos ya no es un reintento.
    'approved_without_order', jsonb_build_object(
      'count', count(*) filter (where pi.internal_status in ('approved', 'approved_order_pending') and pi.order_id is null),
      'amount', coalesce(sum(coalesce(pi.paid_amount, pi.expected_amount)) filter (
        where pi.internal_status in ('approved', 'approved_order_pending') and pi.order_id is null), 0),
      'oldest_minutes', coalesce(round(extract(epoch from (v_now - min(pi.updated_at) filter (
        where pi.internal_status in ('approved', 'approved_order_pending') and pi.order_id is null))) / 60.0), 0)
    ),
    -- Lo mismo visto desde el importe: lo que el proveedor cobró y lo que el
    -- pedido dice que vale tienen que coincidir.
    'amount_mismatch', jsonb_build_object(
      'count', count(*) filter (
        where pi.paid_amount is not null
          and pi.internal_status in ('approved', 'approved_order_pending', 'completed')
          and pi.paid_amount <> pi.expected_amount
      )
    )
  ) into v_payments
  from public.payment_intents pi
  join public.checkout_sessions s on s.id = pi.checkout_session_id
  where pi.business_id = p_business_id and s.origin = 'production';

  -- Un checkout pago sin pedido no siempre tiene payment_intent ligado: se
  -- cuenta aparte y con el mismo margen de reintento del worker.
  v_payments := v_payments || jsonb_build_object(
    'paid_checkouts_without_order', (
      select jsonb_build_object(
        'count', count(*),
        'amount', coalesce(sum(s.total), 0),
        'oldest_minutes', coalesce(round(extract(epoch from (v_now - min(s.updated_at))) / 60.0), 0)
      )
      from public.checkout_sessions s
      where s.business_id = p_business_id
        and s.origin = 'production'
        and s.completed_order_id is null
        and s.status in ('payment_approved', 'finalizing_order')
        and s.updated_at < v_now - interval '3 minutes'
    )
  );

  -- ===== Qué necesita atención ahora =====
  select jsonb_build_object(
    'unaccepted_orders', (
      select jsonb_build_object(
        'count', count(*),
        'threshold_minutes', v_accept_sla,
        'oldest_minutes', coalesce(round(extract(epoch from (v_now - min(o.created_at))) / 60.0), 0)
      )
      from public.orders o
      where o.business_id = p_business_id and o.origin = 'production'
        and public.order_pipeline_state(o.status) = 'received'
        and o.created_at < v_now - make_interval(mins => v_accept_sla)
    ),
    'ready_without_rider', (
      select jsonb_build_object(
        'count', count(*),
        'threshold_minutes', v_rider_sla,
        'oldest_minutes', coalesce(round(extract(epoch from (v_now - min(coalesce(o.ready_at, o.updated_at)))) / 60.0), 0)
      )
      from public.orders o
      where o.business_id = p_business_id and o.origin = 'production'
        and o.delivery_mode = 'delivery'
        and public.order_pipeline_state(o.status) = 'ready'
        and o.assigned_rider_user_id is null
        and coalesce(o.ready_at, o.updated_at) < v_now - make_interval(mins => v_rider_sla)
    ),
    'delayed_deliveries', (
      select jsonb_build_object(
        'count', count(*),
        'threshold_minutes', v_delivery_sla,
        'oldest_minutes', coalesce(round(extract(epoch from (v_now - min(coalesce(o.ready_at, o.accepted_at, o.created_at)))) / 60.0), 0)
      )
      from public.orders o
      where o.business_id = p_business_id and o.origin = 'production'
        and public.order_pipeline_state(o.status) in ('assigned', 'picked_up', 'on_the_way', 'arrived')
        and coalesce(o.ready_at, o.accepted_at, o.created_at) < v_now - make_interval(mins => v_delivery_sla)
    ),
    -- Sin señal no hay entrega observable: puede estar todo bien y no hay forma
    -- de saberlo, que es exactamente lo que hay que mostrar.
    'riders_without_signal', (
      select jsonb_build_object(
        'count', count(*),
        'threshold_minutes', v_gps_sla
      )
      from public.orders o
      left join lateral (
        select max(rl.created_at) as last_seen
          from public.rider_locations rl where rl.order_id = o.id
      ) signal on true
      where o.business_id = p_business_id and o.origin = 'production'
        and public.order_pipeline_state(o.status) in ('assigned', 'picked_up', 'on_the_way', 'arrived')
        and coalesce(signal.last_seen, o.updated_at) < v_now - make_interval(mins => v_gps_sla)
    ),
    'manual_review_checkouts', (
      select count(*) from public.checkout_sessions s
       where s.business_id = p_business_id and s.origin = 'production'
         and s.status = 'manual_review_required'
    )
  ) into v_attention;

  -- ===== Colas: reintentos y trabajo abandonado =====
  select jsonb_build_object(
    'payments', (
      select jsonb_build_object(
        'pending', count(*) filter (where po.status in ('pending', 'retry_wait')),
        'retrying', count(*) filter (where po.attempts > 0 and po.status in ('pending', 'retry_wait', 'claimed', 'processing')),
        'overdue', count(*) filter (where po.status in ('pending', 'retry_wait') and po.next_attempt_at < v_now - interval '10 minutes'),
        'expired_leases', count(*) filter (where po.status in ('claimed', 'processing') and po.lease_expires_at < v_now),
        'failed', count(*) filter (where po.status = 'failed'),
        'dead_letter', count(*) filter (where po.status = 'dead_letter'),
        'max_attempts', coalesce(max(po.attempts) filter (where po.status <> 'completed'), 0)
      )
      from public.payment_outbox po
      left join public.payment_intents pi on pi.id = po.payment_intent_id
      -- El trabajo que todavía no se ligó a un intento —un aviso del proveedor
      -- recién recibido— no tiene negocio asignado. Se cuenta igual: esconder
      -- trabajo trabado porque no se sabe de quién es sería exactamente el
      -- silencio que este tablero existe para romper.
      where pi.business_id is null or pi.business_id = p_business_id
    ),
    'fiscal', (
      select jsonb_build_object(
        'pending', count(*) filter (where fo.state in ('pending', 'retry_wait')),
        'retrying', count(*) filter (where fo.attempt_count > 0 and fo.state in ('pending', 'retry_wait', 'leased')),
        'overdue', count(*) filter (where fo.state in ('pending', 'retry_wait') and fo.next_attempt_at < v_now - interval '15 minutes'),
        'expired_leases', count(*) filter (where fo.state = 'leased' and fo.lease_deadline < v_now),
        'dead_letter', count(*) filter (where fo.state = 'dead_letter')
      )
      from public.fiscal_outbox fo
      join public.fiscal_documents fd on fd.id = fo.fiscal_document_id
      where fd.business_id = p_business_id
    ),
    'fiscal_artifacts', (
      select jsonb_build_object(
        'pending', count(*) filter (where fao.state in ('pending', 'retry_wait')),
        'dead_letter', count(*) filter (where fao.state = 'dead_letter')
      )
      from public.fiscal_artifact_outbox fao
      join public.fiscal_documents fd on fd.id = fao.fiscal_document_id
      where fd.business_id = p_business_id
    ),
    'notifications', (
      select jsonb_build_object(
        'pending', count(*) filter (where n.state = 'pending'),
        'retrying', count(*) filter (where n.attempt_count > 0 and n.state in ('pending', 'processing')),
        'failed', count(*) filter (where n.state = 'failed'),
        'dead_letter', count(*) filter (where n.state = 'dead_letter')
      )
      from public.notification_outbox n
      where n.business_id = p_business_id
    ),
    'deliveries', (
      select jsonb_build_object(
        'undispatched', count(*) filter (where d.dispatched_at is null),
        'stale', count(*) filter (where d.dispatched_at is null and d.created_at < v_now - interval '15 minutes')
      )
      from public.delivery_outbox d
      where d.business_id = p_business_id
    ),
    'webhooks', (
      select jsonb_build_object(
        'received_24h', count(*) filter (where r.received_at > v_now - interval '24 hours'),
        'rejected_signature_24h', count(*) filter (where r.received_at > v_now - interval '24 hours' and r.processing_status = 'rejected_signature'),
        'duplicate_24h', count(*) filter (where r.received_at > v_now - interval '24 hours' and r.processing_status = 'duplicate'),
        'failed_24h', count(*) filter (where r.received_at > v_now - interval '24 hours' and r.processing_status in ('failed', 'dead_letter')),
        'retrying', count(*) filter (where r.processing_status = 'retry_wait')
      )
      from public.payment_webhook_receipts r
    )
  ) into v_queues;

  -- ===== Stock =====
  -- Se mira sobre lo publicado: un producto sin publicar no le falta al
  -- cliente. `unknown` existe porque un stock nulo no es cero, es no saber.
  select jsonb_build_object(
    'threshold_units', v_low_stock,
    'low', jsonb_build_object(
      'count', count(*) filter (where p.stock is not null and p.stock > 0 and p.stock <= v_low_stock),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('product_id', low.id, 'name', low.name, 'stock', low.stock) order by low.stock, low.name)
          from (
            select p2.id, p2.name, p2.stock
              from public.products p2
             where p2.business_id = p_business_id and p2.is_active and p2.is_verified
               and p2.stock is not null and p2.stock > 0 and p2.stock <= v_low_stock
             order by p2.stock, p2.name
             limit 20
          ) low
      ), '[]'::jsonb)
    ),
    'out_of_stock', jsonb_build_object(
      'count', count(*) filter (where p.stock is not null and p.stock <= 0),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('product_id', empty.id, 'name', empty.name) order by empty.name)
          from (
            select p3.id, p3.name
              from public.products p3
             where p3.business_id = p_business_id and p3.is_active and p3.is_verified
               and p3.stock is not null and p3.stock <= 0
             order by p3.name
             limit 20
          ) empty
      ), '[]'::jsonb)
    ),
    'unknown_stock', count(*) filter (where p.stock is null),
    'published_total', count(*)
  ) into v_stock
  from public.products p
  where p.business_id = p_business_id and p.is_active and p.is_verified;

  -- Una reserva vencida y no liberada es stock que el negocio cree tener
  -- comprometido y en realidad nadie compró.
  v_stock := v_stock || jsonb_build_object(
    'expired_reservations', (
      select jsonb_build_object(
        'count', count(*),
        'units', coalesce(sum(r.quantity), 0),
        'oldest_minutes', coalesce(round(extract(epoch from (v_now - min(r.expires_at))) / 60.0), 0)
      )
      from public.inventory_reservations r
      join public.checkout_sessions s on s.id = r.checkout_session_id
      where s.business_id = p_business_id
        and r.status = 'active'
        and r.expires_at < v_now - interval '5 minutes'
    )
  );

  -- ===== Alertas =====
  select jsonb_build_object(
    'open', count(*) filter (where a.status = 'open'),
    'acknowledged', count(*) filter (where a.status = 'acknowledged'),
    'by_severity', coalesce((
      select jsonb_object_agg(severity, quantity)
        from (
          select a2.severity, count(*) as quantity
            from public.operational_alerts a2
           where a2.business_id = p_business_id and a2.status <> 'resolved'
           group by 1
        ) grouped
    ), '{}'::jsonb),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', top.id, 'severity', top.severity, 'code', top.alert_code, 'status', top.status,
        'summary', top.summary, 'required_action', top.required_action,
        'subject_type', top.subject_type, 'subject_id', top.subject_id,
        'correlation_id', top.correlation_id, 'first_seen_at', top.first_seen_at,
        'last_seen_at', top.last_seen_at, 'occurrence_count', top.occurrence_count
      ) order by top.rank, top.last_seen_at desc)
      from (
        select a3.*, case a3.severity
          when 'CRITICAL' then 1 when 'ACTION_REQUIRED' then 2 when 'WARNING' then 3 else 4 end as rank
          from public.operational_alerts a3
         where a3.business_id = p_business_id and a3.status <> 'resolved'
         order by rank, a3.last_seen_at desc
         limit 12
      ) top
    ), '[]'::jsonb)
  ) into v_alerts
  from public.operational_alerts a
  where a.business_id = p_business_id and a.status <> 'resolved';

  -- ===== Última actividad =====
  -- Sirve para una pregunta concreta: ¿está pasando algo o el silencio es una
  -- falla? Un tablero en cero con actividad de hace un minuto es un día flojo;
  -- en cero con actividad de hace seis horas es un incidente.
  select jsonb_build_object(
    'last_order_at', (select max(o.created_at) from public.orders o
                       where o.business_id = p_business_id and o.origin = 'production'),
    'last_order_event_at', (select max(e.created_at) from public.order_events e
                             where e.business_id = p_business_id),
    'last_checkout_at', (select max(s.created_at) from public.checkout_sessions s
                          where s.business_id = p_business_id and s.origin = 'production'),
    'last_payment_approved_at', (select max(pi.approved_at) from public.payment_intents pi
                                  where pi.business_id = p_business_id),
    'last_webhook_at', (select max(r.received_at) from public.payment_webhook_receipts r
                         where exists (
                           select 1 from public.payment_intents pi
                            where pi.business_id = p_business_id
                              and (pi.provider_payment_id = r.resource_id
                                   or pi.provider_merchant_order_id = r.resource_id))),
    'last_panel_command_at', (select max(c.created_at) from public.business_command_receipts c
                               where c.business_id = p_business_id),
    'last_rider_signal_at', (select max(rl.created_at) from public.rider_locations rl
                              where rl.business_id = p_business_id),
    'last_delivery_at', (select max(o.delivered_at) from public.orders o
                          where o.business_id = p_business_id and o.origin = 'production'),
    'last_counter_sale_at', (select max(ps.completed_at) from public.pos_sales ps
                              where ps.business_id = p_business_id and ps.state = 'completed')
  ) into v_activity;

  return jsonb_build_object(
    'generated_at', v_now,
    'business_id', p_business_id,
    'timezone', v_tz,
    'business_day', jsonb_build_object('start', v_day_start, 'end', v_day_end),
    'commercial_scope', jsonb_build_object(
      'includes', 'production',
      'excludes', 'qa',
      'note', 'Los pedidos de prueba se conservan como evidencia y quedan fuera de todo número comercial.'
    ),
    'thresholds', v_thresholds,
    'today', v_today,
    'orders', v_orders,
    'payments', v_payments,
    'attention', v_attention,
    'queues', v_queues,
    'stock', v_stock,
    'alerts', v_alerts,
    'last_activity', v_activity,
    'health', public.get_pilot_service_health(p_business_id)
  );
end;
$get_pilot_operations_dashboard$;

revoke execute on function public.get_pilot_operations_dashboard(uuid, text) from public, anon;
grant execute on function public.get_pilot_operations_dashboard(uuid, text) to authenticated;

comment on function public.get_pilot_operations_dashboard(uuid, text) is
  'Superficie operativa del piloto en una sola lectura: día comercial, pagos, excepciones, colas, stock, alertas, última actividad y salud. Excluye pedidos QA de todo número comercial.';
