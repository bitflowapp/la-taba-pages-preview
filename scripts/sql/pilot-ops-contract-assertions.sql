-- Contrato de la superficie operativa del piloto, comprobado contra números
-- conocidos del fixture sintético.
--
-- Cada aserción existe porque su ausencia tendría una consecuencia concreta en
-- la operación, no porque el JSON tenga esa clave. Si algo no coincide, aborta:
-- un tablero que muestra un número distinto del que el escenario produjo no es
-- un tablero, es una opinión.

create temporary table if not exists pilot_assert_log (
  name text not null,
  checked_at timestamptz not null default clock_timestamp()
);
delete from pilot_assert_log;

create or replace function pg_temp.expect(p_name text, p_actual text, p_expected text)
returns void
language plpgsql
as $expect$
begin
  if p_actual is distinct from p_expected then
    raise exception '% : se esperaba "%" y llegó "%"', p_name, p_expected, coalesce(p_actual, '<null>');
  end if;
  insert into pilot_assert_log (name) values (p_name);
end;
$expect$;

create or replace function pg_temp.expect_count(p_name text, p_actual bigint, p_expected bigint)
returns void
language plpgsql
as $expect_count$
begin
  perform pg_temp.expect(p_name, p_actual::text, p_expected::text);
end;
$expect_count$;

create or replace function pg_temp.checks()
returns bigint
language sql
as $checks$
  select count(*) from pilot_assert_log;
$checks$;

do $assert$
declare
  v_biz uuid := '00000000-0000-4000-8000-000000000001';
  v_tz text := 'America/Argentina/Buenos_Aires';
  v_today date;
  v_dashboard jsonb;
  v_health jsonb;
  v_report_today jsonb;
  v_report_volume jsonb;
  v_trace jsonb;
  v_checks integer := 0;
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
  v_today := (clock_timestamp() at time zone v_tz)::date;
  v_dashboard := public.get_pilot_operations_dashboard(v_biz, v_tz);
  v_health := v_dashboard -> 'health';
  v_report_today := public.get_pilot_commercial_report(v_biz, v_today, v_today, v_tz);
  v_report_volume := public.get_pilot_commercial_report(v_biz, v_today - 1, v_today - 1, v_tz);

  -- ===== 1. Día comercial: QA afuera =====
  perform pg_temp.expect('today.orders', v_dashboard #>> '{today,orders}', '5');
  perform pg_temp.expect('today.billable_orders', v_dashboard #>> '{today,billable_orders}', '4');
  perform pg_temp.expect('today.revenue_booked', (v_dashboard #>> '{today,revenue_booked}')::numeric::text, '35000.00');
  perform pg_temp.expect('today.revenue_delivered', (v_dashboard #>> '{today,revenue_delivered}')::numeric::text, '15000.00');
  perform pg_temp.expect('today.ticket_average', (v_dashboard #>> '{today,ticket_average}')::numeric::text, '8750.00');
  perform pg_temp.expect('today.delivered', v_dashboard #>> '{today,delivered}', '1');
  perform pg_temp.expect('today.cancelled', v_dashboard #>> '{today,cancelled}', '1');
  -- El pedido QA de $99.999 existe y no movió un solo peso del tablero.
  perform pg_temp.expect('today.qa_orders_excluded', v_dashboard #>> '{today,qa_orders_excluded}', '1');

  -- ===== 2. Pedidos por estado =====
  perform pg_temp.expect('orders.open_total', v_dashboard #>> '{orders,open_total}', '3');
  perform pg_temp.expect('orders.open_by_state.received', v_dashboard #>> '{orders,open_by_state,received}', '1');
  perform pg_temp.expect('orders.open_by_state.ready', v_dashboard #>> '{orders,open_by_state,ready}', '1');
  perform pg_temp.expect('orders.open_by_state.assigned', v_dashboard #>> '{orders,open_by_state,assigned}', '1');

  -- ===== 3. Pagos =====
  perform pg_temp.expect('payments.approved_today.count', v_dashboard #>> '{payments,approved_today,count}', '3');
  perform pg_temp.expect('payments.approved_today.amount', (v_dashboard #>> '{payments,approved_today,amount}')::numeric::text, '27100.00');
  perform pg_temp.expect('payments.pending.count', v_dashboard #>> '{payments,pending,count}', '1');
  perform pg_temp.expect('payments.failed_today.count', v_dashboard #>> '{payments,failed_today,count}', '1');
  -- El intento QA aprobado sin pedido no puede contarse acá.
  perform pg_temp.expect('payments.approved_without_order.count', v_dashboard #>> '{payments,approved_without_order,count}', '1');
  perform pg_temp.expect('payments.approved_without_order.amount', (v_dashboard #>> '{payments,approved_without_order,amount}')::numeric::text, '12000.00');
  perform pg_temp.expect('payments.amount_mismatch.count', v_dashboard #>> '{payments,amount_mismatch,count}', '1');
  perform pg_temp.expect('payments.paid_checkouts_without_order.count', v_dashboard #>> '{payments,paid_checkouts_without_order,count}', '2');

  -- ===== 4. Qué necesita una persona =====
  perform pg_temp.expect('attention.unaccepted_orders.count', v_dashboard #>> '{attention,unaccepted_orders,count}', '1');
  perform pg_temp.expect('attention.ready_without_rider.count', v_dashboard #>> '{attention,ready_without_rider,count}', '1');
  perform pg_temp.expect('attention.delayed_deliveries.count', v_dashboard #>> '{attention,delayed_deliveries,count}', '1');
  perform pg_temp.expect('attention.riders_without_signal.count', v_dashboard #>> '{attention,riders_without_signal,count}', '1');

  -- ===== 5. Colas =====
  perform pg_temp.expect('queues.payments.dead_letter', v_dashboard #>> '{queues,payments,dead_letter}', '1');
  perform pg_temp.expect('queues.payments.pending', v_dashboard #>> '{queues,payments,pending}', '1');
  perform pg_temp.expect('queues.payments.overdue', v_dashboard #>> '{queues,payments,overdue}', '1');
  perform pg_temp.expect('queues.webhooks.received_24h', v_dashboard #>> '{queues,webhooks,received_24h}', '2');
  perform pg_temp.expect('queues.webhooks.rejected_signature_24h', v_dashboard #>> '{queues,webhooks,rejected_signature_24h}', '1');

  -- ===== 6. Stock =====
  perform pg_temp.expect('stock.threshold_units', v_dashboard #>> '{stock,threshold_units}', '5');
  perform pg_temp.expect('stock.low.count', v_dashboard #>> '{stock,low,count}', '1');
  perform pg_temp.expect('stock.out_of_stock.count', v_dashboard #>> '{stock,out_of_stock,count}', '1');
  -- El borrador sin publicar no cuenta: no se puede comprar.
  perform pg_temp.expect('stock.published_total', v_dashboard #>> '{stock,published_total}', '3');
  perform pg_temp.expect('stock.expired_reservations.count', v_dashboard #>> '{stock,expired_reservations,count}', '1');
  perform pg_temp.expect('stock.expired_reservations.units', v_dashboard #>> '{stock,expired_reservations,units}', '3');

  -- ===== 7. Alertas sin sujetos QA =====
  if exists (
    select 1 from public.operational_alerts a
     join public.payment_intents pi on pi.id = a.subject_id
     join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    where a.business_id = v_biz and a.status <> 'resolved' and cs.origin = 'qa'
  ) then
    raise exception 'una alerta abierta apunta a un sujeto QA';
  end if;
  v_checks := v_checks + 1;
  -- Stock bajo y reservas vencidas son UNA alerta agregada, no una por fila.
  perform pg_temp.expect_count('alerta agregada LOW_STOCK', (
    select count(*) from public.operational_alerts
     where business_id = v_biz and alert_code = 'LOW_STOCK' and status <> 'resolved'), 1);
  perform pg_temp.expect_count('alerta ORDER_NOT_ACCEPTED', (
    select count(*) from public.operational_alerts
     where business_id = v_biz and alert_code = 'ORDER_NOT_ACCEPTED' and status <> 'resolved'), 1);
  perform pg_temp.expect_count('alerta ORDER_READY_WITHOUT_RIDER', (
    select count(*) from public.operational_alerts
     where business_id = v_biz and alert_code = 'ORDER_READY_WITHOUT_RIDER' and status <> 'resolved'), 1);
  perform pg_temp.expect_count('alerta PAYMENT_AMOUNT_MISMATCH', (
    select count(*) from public.operational_alerts
     where business_id = v_biz and alert_code = 'PAYMENT_AMOUNT_MISMATCH' and status <> 'resolved'), 1);
  perform pg_temp.expect_count('alerta WEBHOOK_SIGNATURE_REJECTED', (
    select count(*) from public.operational_alerts
     where business_id = v_biz and alert_code = 'WEBHOOK_SIGNATURE_REJECTED' and status <> 'resolved'), 1);
  perform pg_temp.expect_count('alerta STOCK_RESERVATION_EXPIRED', (
    select count(*) from public.operational_alerts
     where business_id = v_biz and alert_code = 'STOCK_RESERVATION_EXPIRED' and status <> 'resolved'), 1);

  -- Reconocer es idempotente y auditado: la bandeja registra quién la vio
  -- primero, una sola vez, y repetir el gesto no reatribuye ni duplica.
  declare
    v_alert uuid;
    v_was_open boolean;
    v_first jsonb;
    v_second jsonb;
    v_actor uuid;
    v_at timestamptz;
  begin
    -- La misma comprobación corre antes del backup y sobre el proyecto
    -- recuperado. Ahí la alerta ya llega reconocida —el estado sobrevivió a la
    -- restauración, que es parte de lo que se está probando— así que la
    -- aserción se ancla en el estado previo y no lo presupone.
    select id, status = 'open' into v_alert, v_was_open
      from public.operational_alerts
     where business_id = v_biz and alert_code = 'LOW_STOCK' and status <> 'resolved' limit 1;
    v_first := public.transition_operational_alert(v_alert, 'acknowledged', null);
    perform pg_temp.expect('ack.primera', v_first ->> 'idempotent_replay', (not v_was_open)::text);
    select acknowledged_by, acknowledged_at into v_actor, v_at
      from public.operational_alerts where id = v_alert;

    v_second := public.transition_operational_alert(v_alert, 'acknowledged', null);
    perform pg_temp.expect('ack.repeticion', v_second ->> 'idempotent_replay', 'true');
    perform pg_temp.expect('ack.status', v_second ->> 'status', 'acknowledged');
    -- Un segundo evento por cada reintento convertiría la auditoría en ruido.
    perform pg_temp.expect_count('ack.eventos', (
      select count(*) from public.operational_alert_events
       where alert_id = v_alert and event_type = 'acknowledged'), 1);
    if (select acknowledged_by from public.operational_alerts where id = v_alert) is distinct from v_actor
      or (select acknowledged_at from public.operational_alerts where id = v_alert) is distinct from v_at then
      raise exception 'repetir el reconocimiento reatribuyó actor u hora';
    end if;

    -- Reconciliar de nuevo no vuelve a abrirla mientras la condición siga.
    perform public.refresh_operational_alerts(v_biz);
    perform pg_temp.expect('ack.persiste', (
      select status from public.operational_alerts where id = v_alert), 'acknowledged');
    perform pg_temp.expect_count('ack.eventos.tras.reconciliar', (
      select count(*) from public.operational_alert_events
       where alert_id = v_alert and event_type = 'acknowledged'), 1);
  end;
  v_checks := v_checks + 1;

  -- ===== 8. Salud: ocho servicios, ninguno sano sin evidencia =====
  perform pg_temp.expect_count('servicios medidos', jsonb_array_length(v_health -> 'services'), 8);
  if exists (
    select 1 from jsonb_array_elements(v_health -> 'services') as s(value)
     where s.value ->> 'status' not in ('healthy', 'degraded', 'down', 'unknown')
  ) then
    raise exception 'un servicio devolvió un estado fuera del contrato';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_health -> 'services') as s(value)
     where s.value ->> 'status' = 'healthy'
       and coalesce(s.value -> 'evidence', '{}'::jsonb) = '{}'::jsonb
  ) then
    raise exception 'un servicio se declaró sano sin evidencia';
  end if;
  perform pg_temp.expect('health.database',
    (select s.value ->> 'status' from jsonb_array_elements(v_health -> 'services') as s(value)
      where s.value ->> 'service' = 'database'), 'healthy');
  perform pg_temp.expect('health.rider_contracts',
    (select s.value ->> 'status' from jsonb_array_elements(v_health -> 'services') as s(value)
      where s.value ->> 'service' = 'rider_contracts'), 'healthy');
  v_checks := v_checks + 3;

  -- ===== 9. Traza: una etapa rota y sin PII =====
  v_trace := public.trace_pilot_order(v_biz, (
    select public_code from public.orders where business_id = v_biz and client_request_id = 'fixture-ops-o3'));
  perform pg_temp.expect('trace.o3.break', v_trace #>> '{break_point,stage}', 'panel');
  v_trace := public.trace_pilot_order(v_biz, (
    select public_code from public.orders where business_id = v_biz and client_request_id = 'fixture-ops-o4'));
  perform pg_temp.expect('trace.o4.break', v_trace #>> '{break_point,stage}', 'rider');
  v_trace := public.trace_pilot_order(v_biz, (
    select public_code from public.orders where business_id = v_biz and client_request_id = 'fixture-ops-o1'));
  if v_trace -> 'break_point' <> 'null'::jsonb then
    raise exception 'un pedido entregado no puede tener punto de ruptura';
  end if;
  perform pg_temp.expect('trace.privacy', v_trace #>> '{privacy,pii_included}', 'false');
  if v_trace::text ilike '%FIXTURE Cliente%' then
    raise exception 'la traza filtró el nombre del cliente';
  end if;
  v_trace := public.trace_pilot_order(v_biz, 'LT-NO-EXISTE');
  perform pg_temp.expect('trace.desconocido', v_trace ->> 'resolved_as', 'not_found');
  v_checks := v_checks + 3;

  -- ===== 10. Reporte comercial y guard de muestra =====
  perform pg_temp.expect('report.hoy.orders', v_report_today #>> '{orders,total}', '5');
  perform pg_temp.expect('report.hoy.qa_excluidos', v_report_today #>> '{commercial_scope,qa_orders_excluded}', '1');
  perform pg_temp.expect('report.hoy.muestra', v_report_today #>> '{products,sufficient_sample}', 'false');
  if v_report_today #> '{products,best_seller}' <> 'null'::jsonb then
    raise exception 'se declaró un más vendido con muestra insuficiente';
  end if;
  v_checks := v_checks + 1;
  perform pg_temp.expect('report.ayer.orders', v_report_volume #>> '{orders,total}', '25');
  perform pg_temp.expect('report.ayer.muestra', v_report_volume #>> '{products,sufficient_sample}', 'true');
  perform pg_temp.expect('report.ayer.best_seller', v_report_volume #>> '{products,best_seller,name}', 'FIXTURE Jugo 1 l');
  perform pg_temp.expect('report.ayer.p50_preparacion', v_report_volume #>> '{times,preparation_minutes,p50}', '10.0');
  perform pg_temp.expect('report.ayer.p50_entrega', v_report_volume #>> '{times,delivery_minutes,p50}', '18.0');
  perform pg_temp.expect('report.ayer.combos', v_report_volume #>> '{combos,units_total}', '6');

  raise notice 'CONTRATO OPERATIVO VERIFICADO: % comprobaciones', v_checks + pg_temp.checks();
end;
$assert$;
