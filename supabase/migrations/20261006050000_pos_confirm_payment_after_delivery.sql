-- ============================================================================
--  CAJA CLARA · EL EFECTIVO DE UN ENVÍO SE COBRA DESPUÉS DE ENTREGAR
-- ============================================================================
--
--  Encontrado en el primer pedido real de punta a punta (LT-0004, 2026-10-06):
--  el repartidor entrega, cobra en efectivo y vuelve con la plata. Recién ahí
--  el local registra «efectivo recibido». Pero `pos_list_orders` sólo ofrecía
--  `confirm_payment` mientras el pedido estaba ACTIVO, así que un envío en
--  efectivo ya entregado no se podía cobrar desde Caja Clara: el menú del
--  pedido sólo decía «Imprimir ticket».
--
--  La autoridad no cambia: `confirm_manual_order_payment` ya admitía un pedido
--  entregado (rechaza sólo cancelados/rechazados, cobros revertidos y la
--  revisión vieja) y sigue siendo la que decide. Esto sólo alinea la ayuda de
--  pantalla con esa regla: se puede registrar el cobro mientras esté pendiente
--  y el pedido no se haya cancelado ni rechazado.
--
--  Cuerpo tomado de la definición DESPLEGADA en producción (pg_get_functiondef),
--  no del archivo donde nació, y cambiado en una sola línea.
--
--  Reversión: volver a aplicar la definición de 20260929120000 (la línea
--  anterior era `case when t.active and ...`). No toca filas.

CREATE OR REPLACE FUNCTION public.pos_list_orders(p_business_id uuid, p_device_key_hash text, p_updated_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_since timestamptz := coalesce(p_updated_since, clock_timestamp() - interval '24 hours');
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_orders jsonb;
  v_count integer;
  v_cursor timestamptz;
begin
  perform private.pos_require_terminal(p_business_id, p_device_key_hash);

  with picked as (
    select o.*
      from public.orders o
     where o.business_id = p_business_id
       and o.status <> 'draft'
       and (
         o.status not in ('delivered', 'cancelled', 'canceled', 'rejected')
         or o.updated_at > v_since
       )
       and o.created_at > clock_timestamp() - interval '14 days'
     order by o.updated_at, o.id
     limit v_limit
  ), shaped as (
    select o.updated_at, o.id, jsonb_build_object(
      'id', o.id,
      'public_code', coalesce(o.public_code, o.code),
      'status', public.normalize_order_status_vocabulary(o.status),
      'revision', o.revision,
      'origin', o.origin,
      'created_at', o.created_at,
      'updated_at', o.updated_at,
      'fulfillment', o.delivery_mode,
      'customer_name', left(coalesce(nullif(btrim(o.customer_name), ''), 'Cliente'), 80),
      'customer_phone', case when t.active then o.customer_phone end,
      'notes', left(nullif(btrim(coalesce(o.customer_notes, o.notes, '')), ''), 300),
      'delivery', case when o.delivery_mode = 'delivery' and t.active then jsonb_build_object(
          'address', coalesce(nullif(btrim(o.delivery_address_formatted), ''), nullif(btrim(o.customer_street_address), '')),
          'neighborhood', coalesce(nullif(btrim(o.customer_neighborhood), ''), nullif(btrim(o.delivery_area_declared), '')),
          'floor', o.delivery_floor,
          'apartment', o.delivery_apartment,
          'reference', coalesce(nullif(btrim(o.delivery_reference), ''), nullif(btrim(o.customer_reference), '')),
          'zone', o.delivery_zone_name)
        end,
      'items', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'product_id', oi.product_uuid, 'sku', p.sku, 'name', oi.name,
                   'quantity', oi.quantity, 'unit_price', oi.unit_price, 'subtotal', oi.subtotal)
                   order by oi.created_at, oi.id)
            from public.order_items oi
            left join public.products p on p.id = oi.product_uuid
           where oi.order_id = o.id), '[]'::jsonb),
      'combos', coalesce((
          select jsonb_agg(jsonb_build_object('name', oc.name, 'quantity', oc.quantity,
                   'price', coalesce(oc.promotional_price, oc.list_price)) order by oc.created_at, oc.id)
            from public.order_combos oc where oc.order_id = o.id), '[]'::jsonb),
      'subtotal', o.subtotal,
      'delivery_fee', o.delivery_fee,
      'discount_total', o.discount_total,
      'total', o.total,
      'currency', coalesce(o.currency_code, 'ARS'),
      'payment', jsonb_build_object(
        'method', o.payment_method,
        'manual_method', o.manual_payment_method,
        'state', case
          when o.payment_method = 'qa_no_charge' then 'not_applicable'
          when o.payment_method = 'mercadopago' then
            case when public.order_payment_is_financially_reversed(o.id) then 'needs_review' else 'approved' end
          when o.manual_payment_status = 'confirmed' then 'approved'
          when o.manual_payment_status = 'reversed' then 'needs_review'
          else 'pending'
        end),
      'rider', case when o.assigned_rider_user_id is not null then jsonb_build_object(
          'user_id', o.assigned_rider_user_id,
          'name', left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
                                nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                                'Rider ' || upper(right(o.assigned_rider_user_id::text, 8))), 80))
        end,
      'pending_offer', (
          select jsonb_build_object('rider_user_id', f.rider_user_id, 'created_at', f.created_at)
            from public.rider_order_offers f
           where f.order_id = o.id and f.status = 'pending'
           order by f.created_at desc limit 1),
      'preparation_estimate_minutes', o.preparation_estimate_minutes,
      'timestamps', jsonb_build_object(
        'accepted_at', o.accepted_at, 'preparing_at', o.preparing_at, 'ready_at', o.ready_at,
        'dispatched_at', coalesce(o.dispatched_at, o.picked_up_at), 'delivered_at', o.delivered_at,
        'cancelled_at', coalesce(o.cancelled_at, o.canceled_at, o.rejected_at)),
      'stock_left_store', public.normalize_order_status_vocabulary(o.status) in ('picked_up', 'on_the_way', 'arrived', 'delivered'),
      'allowed_actions', to_jsonb(array_remove(array[
          case when t.s in ('submitted') then 'accept' end,
          case when t.s in ('submitted') then 'reject' end,
          case when t.s = 'accepted' then 'prepare' end,
          case when t.s = 'preparing' then 'ready' end,
          case when t.s = 'ready' and o.delivery_mode = 'pickup' then 'hand_over' end,
          case when t.s = 'ready' and o.delivery_mode = 'delivery' and o.assigned_rider_user_id is null then 'offer_rider' end,
          case when t.s = 'ready' and o.delivery_mode = 'delivery' and o.assigned_rider_user_id is null then 'self_dispatch' end,
          case when t.s = 'on_the_way' and o.delivery_mode = 'delivery' and o.assigned_rider_user_id is null then 'confirm_delivery_code' end,
          case when t.s not in ('cancelled', 'rejected') and o.payment_method in ('cash', 'coordinate') and coalesce(o.manual_payment_status, 'pending') = 'pending' then 'confirm_payment' end,
          case when t.active then 'cancel' end
        ], null))
    ) as dto
      from picked o
      cross join lateral (
        select public.normalize_order_status_vocabulary(o.status) as s,
               public.normalize_order_status_vocabulary(o.status) not in ('delivered', 'cancelled', 'rejected') as active
      ) t
      left join auth.users u on u.id = o.assigned_rider_user_id
  )
  select coalesce(jsonb_agg(dto order by updated_at, id), '[]'::jsonb), count(*)::integer, max(updated_at)
    into v_orders, v_count, v_cursor
    from shaped;

  return jsonb_build_object(
    'contract', 'caja-clara-taba/1',
    'server_time', clock_timestamp(),
    'orders', v_orders,
    'count', v_count,
    'truncated', v_count >= v_limit,
    'next_cursor', coalesce(v_cursor, p_updated_since)
  );
end;
$function$;
