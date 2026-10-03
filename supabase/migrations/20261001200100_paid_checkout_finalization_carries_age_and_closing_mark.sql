-- El pedido pagado por Mercado Pago lleva la confirmación de edad y dice si entró con
-- el comercio cerrado.
--
-- QUÉ SE MIDIÓ (2026-10-01, base limpia con las 159 migraciones anteriores)
--
--   1. Una cerveza pagada por Mercado Pago nacía con `orders.age_confirmed_at` y
--      `orders.age_confirmation_policy` en NULL, aunque la sesión los tenía (18).
--      `list_available_rider_orders` arma la instrucción «Verificar mayoría de edad
--      al entregar» a partir del PEDIDO, así que el rider no la veía, y
--      `rider_order_rpc_payload` no traía `age_confirmation_policy`. La misma canasta
--      en efectivo sí los llevaba. El INSERT de la finalización nunca listó esas dos
--      columnas.
--   2. La guarda de pago comparaba con `<>`: con `provider_status` o `paid_amount`
--      en NULL la condición daba NULL, el IF no disparaba y la finalización creaba el
--      pedido sin verificar el importe. Los escritores de hoy no dejan esas columnas
--      en NULL con el intent aprobado; cualquier reparación manual sí puede.
--   3. Un cobro que llega con el comercio en pausa, cerrado o fuera del horario del
--      canal crea el pedido igual -es deliberado: el cliente pagó mientras la sesión
--      valía (20260812220000)- pero nada lo distinguía de un pedido normal.
--
-- QUÉ CAMBIA
--
--   `finalize_paid_checkout_session`
--     · Copia `age_confirmed_at` y `age_confirmation_policy` de la sesión al pedido.
--       Sólo cuando la sesión tiene alcohol y el par está completo y en rango: un
--       par incompleto escrito a mano violaría `orders_age_confirmation_complete` y
--       abortaría una finalización con el dinero ya cobrado.
--     · La guarda de pago usa `is distinct from`.
--     · Después de crear el pedido, si el comercio no está `open`, está inactivo,
--       tiene los pedidos apagados o sin verificar, el canal está deshabilitado o
--       fuera de horario, o -con alcohol en la sesión- la venta de alcohol está
--       fuera de ventana, agrega UNA fila en `order_events` de tipo
--       `order.created_after_closing` con el canal y los motivos. Sin datos del
--       cliente. Se usan las mismas compuertas que `create_checkout_session`; no
--       se inventa ningún horario. Se evalúa en el momento en que nace el pedido
--       (no en el del cobro): la marca lleva `payment_approved_at` para ver la
--       diferencia. La marca nunca aborta: si no se puede evaluar, el pedido se
--       crea igual y queda un WARNING en el log.
--       Ninguna pantalla muestra todavía este tipo de evento: el Panel ignora los
--       tipos que no conoce. Mostrarlo es trabajo del frontend.
--
-- QUÉ NO CAMBIA
--
--   Firma, SECURITY DEFINER, `search_path`, EXECUTE (sólo `service_role`), el orden
--   de locks (sesión, intent, reservas), las dos derivaciones a revisión manual, el
--   contenido del pedido y de sus renglones, y la forma del resultado. El pedido
--   NO se bloquea ni se reembolsa por llegar fuera de hora. No toca filas
--   existentes: el relleno de pedidos anteriores va en 20261001200300.
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261001200100_paid_checkout_finalization_carries_age_and_closing_mark.rollback.sql

create or replace function public.finalize_paid_checkout_session(p_checkout_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_order public.orders%rowtype;
  v_item record;
  v_reservation public.inventory_reservations%rowtype;
  v_code text;
  v_tracking_token text;
  v_age_confirmed boolean;
  v_business public.businesses%rowtype;
  v_channel_open boolean;
  v_alcohol_open boolean;
  v_closed_reasons text[];
  v_closing_mark jsonb;
begin
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found then raise exception 'checkout inexistente' using errcode = 'P0002'; end if;
  if v_session.completed_order_id is not null or v_session.status = 'completed' then
    return jsonb_build_object('ok', true, 'order_id', v_session.completed_order_id, 'idempotent', true);
  end if;
  select * into v_intent from public.payment_intents pi where pi.checkout_session_id = v_session.id for update;
  -- `is distinct from`: un NULL en el estado o en el importe tiene que frenar,
  -- no pasar de largo.
  if not found or v_intent.internal_status not in ('approved_order_pending', 'approved')
    or v_intent.provider_status is distinct from 'approved' or v_intent.paid_amount is distinct from v_session.total
    or v_intent.currency is distinct from 'ARS' then
    raise exception 'pago no aprobado verificadamente' using errcode = '55000';
  end if;
  if v_session.expires_at <= clock_timestamp() or not exists (
    select 1 from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' and r.expires_at > clock_timestamp()
  ) then
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'finalization_without_active_reservation' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'finalization_without_active_reservation' where id = v_session.id;
    return jsonb_build_object('ok', false, 'manual_review_required', true);
  end if;
  -- El dinero ya se movio: aca no se aborta. Una sesion delivery sin punto
  -- confirmado es imposible por construccion -`create_checkout_session` la
  -- rechaza antes de reservar stock-, asi que si aparece es una anomalia y la
  -- decide una persona, no un raise que revierta el pago en loop.
  if v_session.fulfillment_type = 'delivery' and (
    nullif(v_session.address_snapshot ->> 'latitude', '') is null
    or nullif(v_session.address_snapshot ->> 'longitude', '') is null
    or nullif(v_session.address_snapshot ->> 'location_source', '') is null
    or nullif(v_session.address_snapshot ->> 'location_confirmed_at', '') is null
  ) then
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'finalization_without_confirmed_delivery_location' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'finalization_without_confirmed_delivery_location' where id = v_session.id;
    return jsonb_build_object('ok', false, 'manual_review_required', true, 'code', 'DELIVERY_LOCATION_REQUIRED');
  end if;
  update public.checkout_sessions set status = 'finalizing_order' where id = v_session.id;
  loop
    v_code := public.next_order_public_code();
    exit when not exists (select 1 from public.orders o where o.code = v_code or o.public_code = v_code);
  end loop;
  -- La confirmacion de edad viaja como par completo o no viaja: el pedido exige
  -- las dos columnas juntas, y un par a medias no puede abortar un cobro hecho.
  v_age_confirmed := v_session.contains_alcohol
    and v_session.age_confirmed_at is not null
    and coalesce(v_session.age_confirmation_policy between 18 and 99, false);
  insert into public.orders (
    business_id, code, public_code, status, fulfillment_type, delivery_mode,
    customer_user_id, client_request_id, client_request_fingerprint, currency_code,
    customer_name, customer_phone, customer_whatsapp, address_label,
    customer_street_address, customer_neighborhood, customer_reference,
    customer_address_id, delivery_address_formatted, delivery_street, delivery_street_number,
    delivery_floor, delivery_apartment, delivery_reference, delivery_city, delivery_province,
    delivery_postal_code, delivery_address_label, delivery_address_source, delivery_snapshot_created_at,
    delivery_latitude, delivery_longitude, delivery_geolocation_accuracy,
    delivery_location_source, delivery_location_confirmed_at,
    delivery_zone_id, delivery_zone_name, delivery_area_declared,
    payment_method, subtotal, discount_total, delivery_fee, total,
    customer_notes,
    age_confirmed_at, age_confirmation_policy
  ) values (
    v_session.business_id, v_code, v_code, 'received', v_session.fulfillment_type, v_session.fulfillment_type,
    v_session.customer_id, 'mp_' || replace(v_session.id::text, '-', ''), v_session.normalized_intent_hash, 'ARS',
    v_session.contact_snapshot ->> 'name', v_session.contact_snapshot ->> 'phone', v_session.contact_snapshot ->> 'phone',
    coalesce(v_session.address_snapshot ->> 'label', case when v_session.fulfillment_type = 'delivery' then 'Entrega' else null end),
    btrim(concat_ws(' ', nullif(v_session.address_snapshot ->> 'street', ''), nullif(v_session.address_snapshot ->> 'street_number', ''))),
    v_session.address_snapshot ->> 'city', v_session.address_snapshot ->> 'reference',
    nullif(v_session.address_snapshot ->> 'address_id', '')::uuid,
    case when v_session.fulfillment_type = 'delivery' then nullif(btrim(concat_ws(', ',
      nullif(btrim(concat_ws(' ', nullif(v_session.address_snapshot ->> 'street', ''), nullif(v_session.address_snapshot ->> 'street_number', ''))), ''),
      nullif(v_session.address_snapshot ->> 'city', ''),
      nullif(v_session.address_snapshot ->> 'province', ''))), '') end,
    v_session.address_snapshot ->> 'street', v_session.address_snapshot ->> 'street_number',
    v_session.address_snapshot ->> 'floor', v_session.address_snapshot ->> 'apartment',
    v_session.address_snapshot ->> 'reference', v_session.address_snapshot ->> 'city',
    v_session.address_snapshot ->> 'province', v_session.address_snapshot ->> 'postal_code',
    v_session.address_snapshot ->> 'label',
    case when v_session.fulfillment_type = 'delivery'
      then coalesce(nullif(v_session.address_snapshot ->> 'source', ''), 'checkout_session') end,
    case when v_session.fulfillment_type = 'delivery' then clock_timestamp() end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'latitude', '')::numeric(9, 6) end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'longitude', '')::numeric(9, 6) end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'geolocation_accuracy', '')::numeric(10, 2) end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'location_source', '') end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'location_confirmed_at', '')::timestamptz end,
    v_session.delivery_zone_id, v_session.delivery_zone_name,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'neighborhood', '') end,
    'mercadopago', v_session.subtotal, v_session.discount_total, v_session.delivery_fee, v_session.total,
    -- Lo que el cliente escribió llega al Panel y al rider. Antes se perdía acá.
    nullif(v_session.contact_snapshot ->> 'notes', ''),
    -- El rider arma «verificar mayoría de edad» a partir del pedido, no de la sesión.
    case when v_age_confirmed then v_session.age_confirmed_at end,
    case when v_age_confirmed then v_session.age_confirmation_policy end
  ) returning * into v_order;
  for v_item in select * from public.checkout_session_items i where i.checkout_session_id = v_session.id order by i.product_id loop
    insert into public.order_items (order_id, product_id, product_uuid, name, quantity, unit, unit_price, subtotal)
    values (v_order.id, v_item.product_id::text, v_item.product_id, coalesce(v_item.product_snapshot ->> 'name', 'Producto TABA2'),
      v_item.quantity, nullif(v_item.product_snapshot ->> 'presentation', ''), v_item.unit_price, v_item.subtotal);
  end loop;
  insert into public.order_combos (
    order_id, combo_uuid, combo_id, name, quantity, discount_percentage,
    list_price, promotional_price, discount_amount, combo_snapshot
  )
  select v_order.id, c.combo_uuid, c.combo_id, c.name, c.quantity, c.discount_percentage,
         c.list_price, c.promotional_price, c.discount_amount, c.combo_snapshot
    from public.checkout_session_combos c
   where c.checkout_session_id = v_session.id
   order by c.combo_id;
  for v_reservation in select * from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' order by r.product_id for update loop
    update public.inventory_reservations set status = 'converted', converted_at = clock_timestamp() where id = v_reservation.id and status = 'active';
  end loop;
  insert into public.order_events (order_id, business_id, actor_user_id, actor_role, actor_type, event_type, type, message, metadata, payload)
  values (v_order.id, v_session.business_id, v_session.customer_id, 'customer', 'customer', 'order.received', 'order.received',
    'Pedido recibido y pago aprobado', jsonb_build_object('source', 'mercadopago_checkout_pro', 'payment_intent_id', v_intent.id),
    jsonb_build_object('source', 'mercadopago_checkout_pro', 'payment_intent_id', v_intent.id));
  -- El pedido se crea igual: el cliente pago mientras la sesion valia. Lo que
  -- faltaba era que el Panel y la traza pudieran distinguirlo. Se lee el comercio
  -- SIN lock (`set_business_open_state` lo toma FOR UPDATE; un lock aca abriria
  -- un orden nuevo) y con las mismas compuertas que `create_checkout_session`.
  -- Todo va en su propio bloque: si el horario no se puede evaluar, el pedido
  -- pagado nace igual y sin marca.
  begin
    select * into v_business from public.businesses b where b.id = v_session.business_id;
    v_channel_open := public.business_is_open(v_session.business_id, v_session.fulfillment_type, clock_timestamp());
    if v_session.contains_alcohol then
      v_alcohol_open := coalesce(
        v_business.alcohol_sales_enabled
        and v_business.alcohol_sales_start is not null
        and v_business.alcohol_sales_end is not null
        and v_business.alcohol_timezone is not null
        and case
          when v_business.alcohol_sales_start <= v_business.alcohol_sales_end then
            (clock_timestamp() at time zone v_business.alcohol_timezone)::time
              between v_business.alcohol_sales_start and v_business.alcohol_sales_end
          else
            (clock_timestamp() at time zone v_business.alcohol_timezone)::time
              not between v_business.alcohol_sales_end and v_business.alcohol_sales_start
        end
        and (not coalesce(v_business.alcohol_hours_enforced, false)
          or public.business_is_open(v_session.business_id, 'alcohol', clock_timestamp())),
        false);
    end if;
    v_closed_reasons := array_remove(array[
      case when v_business.status is distinct from 'open' then 'business_' || coalesce(v_business.status, 'unknown') end,
      case when not coalesce(v_business.is_active, false) then 'business_inactive' end,
      case when not coalesce(v_business.ordering_enabled, false) then 'ordering_disabled' end,
      case when not coalesce(v_business.ordering_verified, false) then 'ordering_unverified' end,
      case when not coalesce(
        case v_session.fulfillment_type
          when 'delivery' then v_business.delivery_enabled
          when 'pickup' then v_business.pickup_enabled
        end, false) then 'channel_disabled' end,
      case when not coalesce(v_channel_open, false) then 'channel_closed' end,
      case when v_session.contains_alcohol and not coalesce(v_alcohol_open, false) then 'alcohol_window_closed' end
    ], null);
    if cardinality(v_closed_reasons) > 0 then
      -- La marca se evalua al crear el pedido, no al cobrar: `payment_approved_at`
      -- deja ver cuando el cobro entro antes del cierre y el pedido despues.
      v_closing_mark := jsonb_build_object(
        'source', 'mercadopago_checkout_pro',
        'channel', v_session.fulfillment_type,
        'closed_reasons', to_jsonb(v_closed_reasons),
        'business_status', v_business.status,
        'channel_open', coalesce(v_channel_open, false),
        'contains_alcohol', v_session.contains_alcohol,
        'alcohol_open', case when v_session.contains_alcohol then coalesce(v_alcohol_open, false) end,
        'payment_intent_id', v_intent.id,
        'payment_approved_at', v_intent.approved_at,
        'checkout_session_id', v_session.id,
        'checkout_created_at', v_session.created_at
      );
      insert into public.order_events (order_id, business_id, actor_user_id, actor_role, actor_type, event_type, type, message, metadata, payload)
      values (v_order.id, v_session.business_id, null, 'system', 'system', 'order.created_after_closing', 'order.created_after_closing',
        'Pedido pagado que entro con el comercio cerrado o en pausa', v_closing_mark, v_closing_mark);
    end if;
  exception when others then
    -- Sin marca, pero con rastro: el aviso queda en el log de Postgres con el
    -- pedido y el codigo de error, sin datos del cliente.
    raise warning 'order.created_after_closing: no se pudo evaluar o escribir la marca del pedido % (%)', v_order.id, sqlstate;
  end;
  v_tracking_token := encode(gen_random_bytes(32), 'hex');
  insert into public.order_public_tokens (order_id, token, token_hash, expires_at)
  values (v_order.id, null, digest(v_tracking_token, 'sha256'), clock_timestamp() + interval '30 days');
  update public.payment_intents set order_id = v_order.id, internal_status = 'completed' where id = v_intent.id;
  update public.checkout_sessions set completed_order_id = v_order.id, status = 'completed' where id = v_session.id;
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (v_intent.id, 'payment.order_completed', jsonb_build_object('order_id', v_order.id));
  return jsonb_build_object('ok', true, 'order_id', v_order.id, 'order_code', v_order.public_code, 'idempotent', false);
end;
$function$;

revoke all on function public.finalize_paid_checkout_session(uuid) from public, anon, authenticated;
grant execute on function public.finalize_paid_checkout_session(uuid) to service_role;
