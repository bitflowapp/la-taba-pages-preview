-- Cómo rindió el piloto: reporte diario y semanal sobre datos reales.
--
-- Dos reglas gobiernan este reporte y las dos son sobre honestidad, no sobre
-- SQL:
--
-- 1. Sólo cuenta la operación real. Un pedido `origin = 'qa'` es evidencia de
--    una prueba, no una venta. El reporte informa cuántos excluyó para que
--    nadie confunda un número bajo con un dato perdido.
--
-- 2. No se declara un "más vendido" con cuatro pedidos. Con muestras chicas el
--    ranking es ruido: el producto que encabeza cambia con una sola compra.
--    El reporte publica igual las cantidades —son ciertas— pero se niega a
--    llamar a ninguno el más vendido hasta tener con qué. `best_seller` viaja
--    en `null` y `sufficient_sample` en `false`, y el Panel lo dice con esas
--    palabras.
--
-- Los tiempos se calculan con percentiles, no con promedios: un pedido que
-- tardó tres horas porque el negocio cerró no puede mover la medida de los
-- otros veinte.

-- El conjunto de pedidos del período, resuelto una sola vez y con el filtro
-- comercial adentro. Sacarlo a una función evita que cada agregado repita el
-- `origin = 'production'` y se olvide justo el que importa.
create or replace function public.pilot_commercial_report_orders(
  p_business_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_timezone text
)
returns table (
  id uuid,
  state text,
  total numeric,
  delivery_mode text,
  payment_method text,
  created_at timestamptz,
  accepted_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  business_date date
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $pilot_commercial_report_orders$
  select
    o.id,
    public.order_pipeline_state(o.status),
    o.total,
    o.delivery_mode,
    o.payment_method,
    o.created_at,
    o.accepted_at,
    o.ready_at,
    o.delivered_at,
    (o.created_at at time zone p_timezone)::date
  from public.orders o
  where o.business_id = p_business_id
    and o.origin = 'production'
    and o.created_at >= p_start
    and o.created_at < p_end;
$pilot_commercial_report_orders$;

create or replace function public.get_pilot_commercial_report(
  p_business_id uuid,
  p_from date,
  p_to date,
  p_timezone text default 'America/Argentina/Buenos_Aires'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $get_pilot_commercial_report$
declare
  v_now timestamptz := clock_timestamp();
  v_tz text := coalesce(nullif(btrim(p_timezone), ''), 'America/Argentina/Buenos_Aires');
  v_from date := coalesce(p_from, (v_now at time zone coalesce(nullif(btrim(p_timezone), ''), 'America/Argentina/Buenos_Aires'))::date);
  v_to date := coalesce(p_to, v_from);
  v_start timestamptz;
  v_end timestamptz;
  v_days integer;
  -- Umbrales de muestra. Debajo de acá el ranking existe pero no se corona.
  v_min_orders constant integer := 20;
  v_min_units constant integer := 10;
  v_delivery_sla integer;
  v_orders jsonb;
  v_revenue jsonb;
  v_daily jsonb;
  v_products jsonb;
  v_combos jsonb;
  v_cancellations jsonb;
  v_times jsonb;
  v_deliveries jsonb;
  v_errors jsonb;
  v_stock jsonb;
  v_period_orders integer;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    raise exception 'zona horaria invalida' using errcode = '22023';
  end if;
  if v_to < v_from then
    raise exception 'rango invertido' using errcode = '22023';
  end if;
  if v_to - v_from > 366 then
    raise exception 'rango mayor a un año' using errcode = '22023';
  end if;

  v_start := v_from::timestamp at time zone v_tz;
  v_end := (v_to + 1)::timestamp at time zone v_tz;
  v_days := (v_to - v_from) + 1;
  v_delivery_sla := (public.pilot_ops_thresholds(p_business_id) #>> '{delivery_minutes,value}')::integer;

  select count(*) into v_period_orders
    from public.pilot_commercial_report_orders(p_business_id, v_start, v_end, v_tz);

  -- ===== Pedidos y facturación =====
  select
    jsonb_build_object(
      'total', count(*),
      'billable', count(*) filter (where state not in ('cancelled', 'rejected')),
      'delivered', count(*) filter (where state = 'delivered'),
      'cancelled', count(*) filter (where state = 'cancelled'),
      'rejected', count(*) filter (where state = 'rejected'),
      'open_at_cutoff', count(*) filter (where state not in ('delivered', 'cancelled', 'rejected')),
      'by_state', coalesce((select jsonb_object_agg(g.state, g.quantity)
                              from (select r.state, count(*) as quantity
                                      from public.pilot_commercial_report_orders(p_business_id, v_start, v_end, v_tz) r
                                     group by 1) g), '{}'::jsonb)
    ),
    jsonb_build_object(
      'booked', coalesce(sum(total) filter (where state not in ('cancelled', 'rejected')), 0),
      'delivered', coalesce(sum(total) filter (where state = 'delivered'), 0),
      'lost_to_cancellation', coalesce(sum(total) filter (where state in ('cancelled', 'rejected')), 0),
      'ticket_average', case when count(*) filter (where state not in ('cancelled', 'rejected')) > 0
        then round(coalesce(sum(total) filter (where state not in ('cancelled', 'rejected')), 0)
                   / count(*) filter (where state not in ('cancelled', 'rejected')), 2)
        else null end,
      'ticket_p50', percentile_cont(0.5) within group (order by total)
        filter (where state not in ('cancelled', 'rejected')),
      'ticket_p90', percentile_cont(0.9) within group (order by total)
        filter (where state not in ('cancelled', 'rejected')),
      'daily_average', case when v_days > 0
        then round(coalesce(sum(total) filter (where state not in ('cancelled', 'rejected')), 0) / v_days, 2)
        else null end
    )
  into v_orders, v_revenue
  from public.pilot_commercial_report_orders(p_business_id, v_start, v_end, v_tz);

  -- El mostrador es otra caja: se informa aparte y nunca se mezcla con la web.
  v_revenue := v_revenue || jsonb_build_object(
    'counter', (
      select jsonb_build_object(
        'sales', count(*),
        'total', coalesce(sum(ps.total), 0)
      )
      from public.pos_sales ps
      where ps.business_id = p_business_id and ps.state = 'completed'
        and ps.completed_at >= v_start and ps.completed_at < v_end
    ),
    'refunded', (
      select coalesce(sum(pr.amount), 0)
      from public.payment_refunds pr
      join public.payment_intents pi on pi.id = pr.payment_intent_id
      where pi.business_id = p_business_id and pr.status = 'approved'
        and pr.completed_at >= v_start and pr.completed_at < v_end
    )
  );

  -- ===== Serie diaria =====
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', day.business_date,
    'orders', coalesce(stats.orders, 0),
    'billable', coalesce(stats.billable, 0),
    'delivered', coalesce(stats.delivered, 0),
    'cancelled', coalesce(stats.cancelled, 0),
    'revenue', coalesce(stats.revenue, 0),
    'ticket_average', stats.ticket_average
  ) order by day.business_date), '[]'::jsonb)
  into v_daily
  from generate_series(v_from, v_to, interval '1 day') as day(business_date)
  left join (
    select
      business_date,
      count(*) as orders,
      count(*) filter (where state not in ('cancelled', 'rejected')) as billable,
      count(*) filter (where state = 'delivered') as delivered,
      count(*) filter (where state = 'cancelled') as cancelled,
      coalesce(sum(total) filter (where state not in ('cancelled', 'rejected')), 0) as revenue,
      case when count(*) filter (where state not in ('cancelled', 'rejected')) > 0
        then round(coalesce(sum(total) filter (where state not in ('cancelled', 'rejected')), 0)
                   / count(*) filter (where state not in ('cancelled', 'rejected')), 2)
        else null end as ticket_average
    from public.pilot_commercial_report_orders(p_business_id, v_start, v_end, v_tz)
    group by business_date
  ) stats on stats.business_date = day.business_date::date;

  -- ===== Productos =====
  with sold as (
    select
      coalesce(oi.product_uuid::text, 'name:' || lower(btrim(oi.name))) as key,
      max(oi.name) as name,
      sum(oi.quantity) as units,
      sum(oi.subtotal) as revenue,
      count(distinct oi.order_id) as orders
    from public.order_items oi
    join public.pilot_commercial_report_orders(p_business_id, v_start, v_end, v_tz) o on o.id = oi.order_id
    where o.state not in ('cancelled', 'rejected')
    group by 1
  ),
  ranked as (
    select *, row_number() over (order by units desc, revenue desc, name) as position from sold
  )
  select jsonb_build_object(
    'minimum_orders_for_ranking', v_min_orders,
    'minimum_units_for_best_seller', v_min_units,
    'observed_orders', v_period_orders,
    'distinct_products', (select count(*) from sold),
    'sufficient_sample', v_period_orders >= v_min_orders
      and coalesce((select max(units) from sold), 0) >= v_min_units,
    -- Con muestra corta el ranking se publica igual —las cantidades son
    -- ciertas— pero nadie recibe la palabra "más vendido".
    'best_seller', case
      when v_period_orders >= v_min_orders and coalesce((select max(units) from sold), 0) >= v_min_units
      then (select jsonb_build_object('name', r.name, 'units', r.units, 'revenue', r.revenue)
              from ranked r where r.position = 1)
      else null end,
    'note', case
      when v_period_orders >= v_min_orders and coalesce((select max(units) from sold), 0) >= v_min_units
      then 'Muestra suficiente para ordenar por ventas.'
      else 'Muestra insuficiente: se informan las cantidades, no un más vendido.' end,
    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', r.position, 'name', r.name, 'units', r.units,
        'revenue', r.revenue, 'orders', r.orders
      ) order by r.position)
      from ranked r where r.position <= 15
    ), '[]'::jsonb)
  ) into v_products;

  -- ===== Combos =====
  with combo_sales as (
    select
      oc.combo_id,
      max(oc.name) as name,
      sum(oc.quantity) as units,
      sum(oc.promotional_price * oc.quantity) as revenue,
      sum(oc.discount_amount) as discount_given,
      count(distinct oc.order_id) as orders
    from public.order_combos oc
    join public.pilot_commercial_report_orders(p_business_id, v_start, v_end, v_tz) o on o.id = oc.order_id
    where o.state not in ('cancelled', 'rejected')
    group by 1
  )
  select jsonb_build_object(
    'sufficient_sample', v_period_orders >= v_min_orders
      and coalesce((select max(units) from combo_sales), 0) >= v_min_units,
    'distinct_combos', (select count(*) from combo_sales),
    'units_total', coalesce((select sum(units) from combo_sales), 0),
    'revenue_total', coalesce((select sum(revenue) from combo_sales), 0),
    'discount_given_total', coalesce((select sum(discount_given) from combo_sales), 0),
    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object(
        'combo_id', c.combo_id, 'name', c.name, 'units', c.units,
        'revenue', c.revenue, 'discount_given', c.discount_given, 'orders', c.orders
      ) order by c.units desc, c.revenue desc)
      from combo_sales c
    ), '[]'::jsonb)
  ) into v_combos;

  -- ===== Cancelaciones =====
  -- El motivo lo escribe una persona en texto libre: se cuenta cuántas lo
  -- llevan, no se transcribe. Un reporte comercial no es lugar para eso.
  select jsonb_build_object(
    'count', count(*) filter (where state in ('cancelled', 'rejected')),
    'rate', case when count(*) > 0
      then round(100.0 * count(*) filter (where state in ('cancelled', 'rejected')) / count(*), 2)
      else null end,
    'before_acceptance', count(*) filter (where state in ('cancelled', 'rejected') and accepted_at is null),
    'after_ready', count(*) filter (where state in ('cancelled', 'rejected') and ready_at is not null),
    'documented_reason', (
      select count(distinct e.order_id)
      from public.order_events e
      join public.pilot_commercial_report_orders(p_business_id, v_start, v_end, v_tz) o on o.id = e.order_id
      where e.event_type = 'business_cancel_reason'
    ),
    'by_actor', coalesce((
      select jsonb_object_agg(g.actor_role, g.quantity)
      from (
        select coalesce(e.actor_role, 'desconocido') as actor_role, count(distinct e.order_id) as quantity
        from public.order_events e
        join public.pilot_commercial_report_orders(p_business_id, v_start, v_end, v_tz) o on o.id = e.order_id
        where o.state in ('cancelled', 'rejected')
          and coalesce(e.event_type, e.type) in ('order.cancelled', 'order.rejected', 'business_cancel_reason')
        group by 1
      ) g
    ), '{}'::jsonb)
  ) into v_cancellations
  from public.pilot_commercial_report_orders(p_business_id, v_start, v_end, v_tz);

  -- ===== Tiempos =====
  select jsonb_build_object(
    'acceptance_minutes', jsonb_build_object(
      'sample', count(*) filter (where accepted_at is not null),
      'p50', round(percentile_cont(0.5) within group (
        order by extract(epoch from (accepted_at - created_at)) / 60.0)
        filter (where accepted_at is not null)::numeric, 1),
      'p90', round(percentile_cont(0.9) within group (
        order by extract(epoch from (accepted_at - created_at)) / 60.0)
        filter (where accepted_at is not null)::numeric, 1)
    ),
    'preparation_minutes', jsonb_build_object(
      'sample', count(*) filter (where ready_at is not null and accepted_at is not null),
      'p50', round(percentile_cont(0.5) within group (
        order by extract(epoch from (ready_at - accepted_at)) / 60.0)
        filter (where ready_at is not null and accepted_at is not null)::numeric, 1),
      'p90', round(percentile_cont(0.9) within group (
        order by extract(epoch from (ready_at - accepted_at)) / 60.0)
        filter (where ready_at is not null and accepted_at is not null)::numeric, 1)
    ),
    'delivery_minutes', jsonb_build_object(
      'sample', count(*) filter (where delivered_at is not null and ready_at is not null),
      'p50', round(percentile_cont(0.5) within group (
        order by extract(epoch from (delivered_at - ready_at)) / 60.0)
        filter (where delivered_at is not null and ready_at is not null)::numeric, 1),
      'p90', round(percentile_cont(0.9) within group (
        order by extract(epoch from (delivered_at - ready_at)) / 60.0)
        filter (where delivered_at is not null and ready_at is not null)::numeric, 1)
    ),
    'end_to_end_minutes', jsonb_build_object(
      'sample', count(*) filter (where delivered_at is not null),
      'p50', round(percentile_cont(0.5) within group (
        order by extract(epoch from (delivered_at - created_at)) / 60.0)
        filter (where delivered_at is not null)::numeric, 1),
      'p90', round(percentile_cont(0.9) within group (
        order by extract(epoch from (delivered_at - created_at)) / 60.0)
        filter (where delivered_at is not null)::numeric, 1)
    )
  ) into v_times
  from public.pilot_commercial_report_orders(p_business_id, v_start, v_end, v_tz);

  -- ===== Entregas =====
  select jsonb_build_object(
    'delivered', count(*) filter (where state = 'delivered'),
    'delivery_mode', jsonb_build_object(
      'delivery', count(*) filter (where delivery_mode = 'delivery'),
      'pickup', count(*) filter (where delivery_mode = 'pickup')
    ),
    'on_time', count(*) filter (
      where state = 'delivered' and ready_at is not null
        and delivered_at <= ready_at + make_interval(mins => v_delivery_sla)),
    'late', count(*) filter (
      where state = 'delivered' and ready_at is not null
        and delivered_at > ready_at + make_interval(mins => v_delivery_sla)),
    'unmeasurable', count(*) filter (where state = 'delivered' and ready_at is null),
    'sla_minutes', v_delivery_sla,
    'payment_mix', coalesce((
      select jsonb_object_agg(g.payment_method, g.quantity)
      from (select payment_method, count(*) as quantity from public.pilot_commercial_report_orders(p_business_id, v_start, v_end, v_tz)
             where state not in ('cancelled', 'rejected') group by 1) g
    ), '{}'::jsonb)
  ) into v_deliveries
  from public.pilot_commercial_report_orders(p_business_id, v_start, v_end, v_tz);

  -- ===== Errores del período =====
  select jsonb_build_object(
    'payments_failed', (
      select count(*) from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
      where pi.business_id = p_business_id and cs.origin = 'production'
        and pi.internal_status in ('rejected', 'failed', 'cancelled', 'expired', 'charged_back')
        and coalesce(pi.rejected_at, pi.updated_at) >= v_start
        and coalesce(pi.rejected_at, pi.updated_at) < v_end
    ),
    'payments_approved_without_order', (
      select count(*) from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
      where pi.business_id = p_business_id and cs.origin = 'production'
        and pi.internal_status in ('approved', 'approved_order_pending')
        and pi.order_id is null
        and pi.approved_at >= v_start and pi.approved_at < v_end
    ),
    'checkouts_expired', (
      select count(*) from public.checkout_sessions cs
      where cs.business_id = p_business_id and cs.origin = 'production'
        and cs.status = 'expired'
        and cs.updated_at >= v_start and cs.updated_at < v_end
    ),
    'webhook_rejected_signature', (
      select count(*) from public.payment_webhook_receipts r
      where r.processing_status = 'rejected_signature'
        and r.received_at >= v_start and r.received_at < v_end
    ),
    'webhook_failed', (
      select count(*) from public.payment_webhook_receipts r
      where r.processing_status in ('failed', 'dead_letter')
        and r.received_at >= v_start and r.received_at < v_end
    ),
    'fiscal_failed', (
      select count(*) from public.fiscal_documents fd
      where fd.business_id = p_business_id
        and fd.state in ('failed', 'ambiguous', 'rejected', 'observed')
        and fd.created_at >= v_start and fd.created_at < v_end
    ),
    'alerts_raised', (
      select count(*) from public.operational_alert_events ev
      where ev.business_id = p_business_id
        and ev.event_type in ('detected', 'reopened')
        and ev.created_at >= v_start and ev.created_at < v_end
    ),
    'alerts_critical_raised', (
      select count(*) from public.operational_alert_events ev
      join public.operational_alerts a on a.id = ev.alert_id
      where ev.business_id = p_business_id
        and ev.event_type in ('detected', 'reopened')
        and a.severity = 'CRITICAL'
        and ev.created_at >= v_start and ev.created_at < v_end
    )
  ) into v_errors;

  -- ===== Stock crítico (foto de ahora, no del período) =====
  select jsonb_build_object(
    'measured_at', v_now,
    'note', 'El stock es una foto del instante de la consulta, no del período.',
    'low', count(*) filter (where p.stock is not null and p.stock > 0
      and p.stock <= (public.pilot_ops_thresholds(p_business_id) #>> '{low_stock_units,value}')::integer),
    'out_of_stock', count(*) filter (where p.stock is not null and p.stock <= 0),
    'published_total', count(*),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.name, 'stock', c.stock) order by c.stock, c.name)
      from (
        select p2.name, p2.stock from public.products p2
         where p2.business_id = p_business_id and p2.is_active and p2.is_verified
           and p2.stock is not null
           and p2.stock <= (public.pilot_ops_thresholds(p_business_id) #>> '{low_stock_units,value}')::integer
         order by p2.stock, p2.name limit 20
      ) c
    ), '[]'::jsonb)
  ) into v_stock
  from public.products p
  where p.business_id = p_business_id and p.is_active and p.is_verified;

  return jsonb_build_object(
    'generated_at', v_now,
    'business_id', p_business_id,
    'period', jsonb_build_object(
      'from', v_from, 'to', v_to, 'days', v_days, 'timezone', v_tz,
      'window_start', v_start, 'window_end', v_end
    ),
    'commercial_scope', jsonb_build_object(
      'includes', 'production',
      'excludes', 'qa',
      'qa_orders_excluded', (
        select count(*) from public.orders o
        where o.business_id = p_business_id and o.origin = 'qa'
          and o.created_at >= v_start and o.created_at < v_end
      )
    ),
    'orders', v_orders,
    'revenue', v_revenue,
    'daily', v_daily,
    'products', v_products,
    'combos', v_combos,
    'cancellations', v_cancellations,
    'times', v_times,
    'deliveries', v_deliveries,
    'errors', v_errors,
    'critical_stock', v_stock
  );
end;
$get_pilot_commercial_report$;

revoke execute on function public.get_pilot_commercial_report(uuid, date, date, text) from public, anon;
grant execute on function public.get_pilot_commercial_report(uuid, date, date, text) to authenticated;

comment on function public.get_pilot_commercial_report(uuid, date, date, text) is
  'Reporte comercial diario o semanal sobre operación real. Excluye QA, usa percentiles para los tiempos y se niega a declarar un más vendido sin muestra suficiente.';

revoke execute on function public.pilot_commercial_report_orders(uuid, timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.pilot_commercial_report_orders(uuid, timestamptz, timestamptz, text) to service_role;

comment on function public.pilot_commercial_report_orders(uuid, timestamptz, timestamptz, text) is
  'Pedidos de operación real del período con su estado canónico; base única del reporte comercial.';
