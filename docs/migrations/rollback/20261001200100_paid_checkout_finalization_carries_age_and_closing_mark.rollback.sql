-- REVERSIÓN de 20261001200100_paid_checkout_finalization_carries_age_and_closing_mark.sql
--
-- Devuelve `finalize_paid_checkout_session` a su cuerpo anterior, copiado tal cual de
-- la base con las 159 migraciones previas (`pg_get_functiondef`).
--
-- Ojo con lo que vuelve a quedar abierto: los pedidos de Mercado Pago con alcohol
-- nacen sin `age_confirmed_at` / `age_confirmation_policy` (el rider no ve
-- «Verificar mayoría de edad al entregar»), la guarda de pago vuelve a dejar pasar
-- un NULL, y el pedido que entra con el comercio cerrado o en pausa deja de quedar
-- marcado. Sólo usar para volver atrás un despliegue.
--
-- Se conserva: los pedidos ya creados mantienen su confirmación de edad y las filas
-- `order.created_after_closing` de `order_events` quedan como historia. No se pierde
-- ningún dato.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001200100
begin;

CREATE OR REPLACE FUNCTION public.finalize_paid_checkout_session(p_checkout_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_order public.orders%rowtype;
  v_item record;
  v_reservation public.inventory_reservations%rowtype;
  v_code text;
  v_tracking_token text;
begin
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found then raise exception 'checkout inexistente' using errcode = 'P0002'; end if;
  if v_session.completed_order_id is not null or v_session.status = 'completed' then
    return jsonb_build_object('ok', true, 'order_id', v_session.completed_order_id, 'idempotent', true);
  end if;
  select * into v_intent from public.payment_intents pi where pi.checkout_session_id = v_session.id for update;
  if not found or v_intent.internal_status not in ('approved_order_pending', 'approved')
    or v_intent.provider_status <> 'approved' or v_intent.paid_amount <> v_session.total or v_intent.currency <> 'ARS' then
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
    customer_notes
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
    nullif(v_session.contact_snapshot ->> 'notes', '')
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

commit;
