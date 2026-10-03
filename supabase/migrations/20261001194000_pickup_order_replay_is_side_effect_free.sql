-- Reintentar un pedido de retiro no vuelve a escribir el pedido.
--
-- QUÉ ESTABA ABIERTO (medido el 2026-10-01 en una base PG17 local con las
-- migraciones anteriores)
--
--   El alta de pedidos es idempotente por `client_request_id`: el mismo envío dos
--   veces devuelve el mismo pedido. Pero para un RETIRO el reintento no era gratis.
--   `create_order_with_items_profile_v1_city_legacy` completa la instantánea de la
--   dirección con un UPDATE protegido por `delivery_address_formatted is null`. Un
--   retiro no tiene dirección, esa columna queda en NULL para siempre, y el UPDATE
--   volvía a correr en cada reintento:
--
--     pedido de retiro creado, una hora después ......... revisión 4
--     5 reintentos idénticos ............................ revisión 5, updated_at movido
--     reintento con delivery_latitude/longitude,
--       delivery_geolocation_accuracy y
--       delivery_address_source = 'gps' ................. revisión 6, y esas cuatro
--                                                         columnas REESCRITAS
--     operador acepta con la revisión que había leído ... PT409 revision desactualizada
--
--   (en transacciones separadas cada reintento suma una revisión: `updated_at`
--   cambia y el trigger de revisión lo cuenta como un cambio).
--
--   Esas cuatro claves se quitan del payload antes de calcular la huella de
--   idempotencia, así que el reintento podía traer valores distintos y se
--   guardaban, incluso con el pedido ya aceptado. Y como los comandos del comercio
--   (`transition_order`, `cancel_order`, `acknowledge_order`) exigen la revisión
--   vigente, un cliente que reintenta su propio pedido en un lazo hace fallar con
--   PT409 la aceptación o la cancelación de ese pedido. Un reintento legítimo por
--   red también movía la revisión de un pedido que el operador tenía abierto.
--
--   Un pedido con envío no tenía el problema: su `delivery_address_formatted`
--   queda escrito en el alta.
--
-- QUÉ CAMBIA
--
--   · El UPDATE de la instantánea exige además `delivery_snapshot_created_at is
--     null`. La capa `profile_v2` sella esa columna apenas nace el pedido, después
--     de esta función: en el alta el UPDATE corre igual que antes; en un reintento
--     ya no coincide con ninguna fila.
--   · `customers.last_order_at` sólo se mueve cuando la instantánea se escribió: un
--     reintento no es un pedido nuevo.
--
-- QUÉ NO CAMBIA
--
--   · El alta: un retiro nace con la misma revisión y las mismas columnas que antes.
--   · Las validaciones, la huella de idempotencia y la respuesta.
--   · `bump_order_revision`: el trigger estaba bien; lo que sobraba era el UPDATE.
--   · Un pedido viejo sin `delivery_snapshot_created_at` recibe una última escritura
--     en su primer reintento (cuando `profile_v2` lo sella) y queda estable.
--   · SECURITY DEFINER, search_path y permisos: ningún rol de cliente la ejecuta.
--
-- Forward-only. No toca filas.
-- Reversión: docs/migrations/rollback/20261001194000_pickup_order_replay_is_side_effect_free.rollback.sql

create or replace function public.create_order_with_items_profile_v1_city_legacy(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_customer_id uuid := auth.uid();
  v_address_id uuid;
  v_address public.customer_addresses%rowtype;
  v_base_payload jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_street text;
  v_city text;
  v_reference text;
  v_formatted text;
  v_latitude numeric(9, 6);
  v_longitude numeric(9, 6);
  v_accuracy numeric(10, 2);
  v_source text := 'manual';
  v_snapshot_written boolean := false;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload invalido' using errcode = '22023';
  end if;

  if nullif(payload->>'customer_address_id', '') is not null then
    if (payload->>'customer_address_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'identificador de direccion invalido' using errcode = '22023';
    end if;
    v_address_id := (payload->>'customer_address_id')::uuid;
    select * into v_address
      from public.customer_addresses a
     where a.id = v_address_id
       and a.customer_id = v_customer_id
       and a.deleted_at is null;
    if not found then
      raise exception 'direccion guardada no encontrada' using errcode = '42501';
    end if;
    v_street := concat_ws(' ', v_address.street, v_address.street_number);
    v_city := v_address.city;
    v_reference := v_address.reference;
    v_formatted := v_address.formatted_address;
    v_latitude := v_address.latitude;
    v_longitude := v_address.longitude;
    v_accuracy := v_address.geolocation_accuracy;
    v_source := v_address.source;
  else
    v_street := nullif(btrim(coalesce(payload->>'customer_street_address', payload->>'address_label', '')), '');
    v_city := nullif(btrim(coalesce(payload->>'customer_neighborhood', '')), '');
    v_reference := nullif(btrim(coalesce(payload->>'customer_reference', '')), '');
    v_formatted := nullif(btrim(coalesce(payload->>'address_label', concat_ws(', ', v_street, v_city))), '');
    v_source := lower(coalesce(nullif(payload->>'delivery_address_source', ''), 'manual'));
    if v_source not in ('manual', 'gps', 'geocoder', 'previous_order') then
      raise exception 'origen de direccion invalido' using errcode = '22023';
    end if;
    if nullif(payload->>'delivery_latitude', '') is not null or nullif(payload->>'delivery_longitude', '') is not null then
      if (payload->>'delivery_latitude') !~ '^-?[0-9]+(\.[0-9]+)?$'
        or (payload->>'delivery_longitude') !~ '^-?[0-9]+(\.[0-9]+)?$' then
        raise exception 'coordenadas invalidas' using errcode = '22023';
      end if;
      v_latitude := (payload->>'delivery_latitude')::numeric(9, 6);
      v_longitude := (payload->>'delivery_longitude')::numeric(9, 6);
      if v_latitude not between -90 and 90 or v_longitude not between -180 and 180 then
        raise exception 'coordenadas fuera de rango' using errcode = '22023';
      end if;
    end if;
    if nullif(payload->>'delivery_geolocation_accuracy', '') is not null then
      if (payload->>'delivery_geolocation_accuracy') !~ '^[0-9]+(\.[0-9]+)?$' then
        raise exception 'precision GPS invalida' using errcode = '22023';
      end if;
      v_accuracy := (payload->>'delivery_geolocation_accuracy')::numeric(10, 2);
    end if;
    if (v_latitude is null) <> (v_longitude is null) then
      raise exception 'las coordenadas deben incluir latitud y longitud' using errcode = '22023';
    end if;
    if v_source in ('gps', 'geocoder') and v_latitude is null then
      raise exception 'la ubicacion debe confirmarse antes de usarla' using errcode = '22023';
    end if;
  end if;

  v_base_payload := (payload - array[
    'customer_address_id', 'delivery_latitude', 'delivery_longitude',
    'delivery_geolocation_accuracy', 'delivery_address_source'
  ]) || jsonb_build_object(
    'customer_street_address', v_street,
    'customer_neighborhood', v_city,
    'customer_reference', v_reference,
    'address_label', v_formatted
  );

  v_result := public.create_order_with_items_legacy(v_base_payload);
  v_order_id := nullif(v_result->>'id', '')::uuid;
  if v_order_id is null then
    raise exception 'el pedido no devolvio un identificador valido' using errcode = '22023';
  end if;

  -- Never replace a snapshot returned by an idempotent retry or an old order.
  update public.orders
     set customer_address_id = v_address_id,
         delivery_address_formatted = v_formatted,
         delivery_street = case when v_address_id is not null then v_address.street else v_street end,
         delivery_street_number = case when v_address_id is not null then v_address.street_number else null end,
         delivery_floor = case when v_address_id is not null then v_address.floor else null end,
         delivery_apartment = case when v_address_id is not null then v_address.apartment else null end,
         delivery_reference = case when v_address_id is not null then v_address.reference else v_reference end,
         delivery_city = case when v_address_id is not null then v_address.city else v_city end,
         delivery_province = case when v_address_id is not null then v_address.province else null end,
         delivery_postal_code = case when v_address_id is not null then v_address.postal_code else null end,
         delivery_latitude = v_latitude,
         delivery_longitude = v_longitude,
         delivery_geolocation_accuracy = v_accuracy,
         delivery_address_source = v_source
   where id = v_order_id
     and delivery_address_formatted is null
     -- Un retiro sin direccion deja delivery_address_formatted en NULL para siempre:
     -- sola, esa condicion volvia a escribir el pedido en cada reintento. La capa
     -- profile_v2 sella delivery_snapshot_created_at apenas nace el pedido.
     and delivery_snapshot_created_at is null;
  v_snapshot_written := found;

  if v_snapshot_written and v_address_id is not null then
    update public.customer_addresses set last_used_at = now() where id = v_address_id;
  end if;
  -- Un reintento no es un pedido nuevo: no mueve la fecha del ultimo pedido.
  if v_snapshot_written then
    update public.customers set last_order_at = now() where id = v_customer_id;
  end if;

  select v_result || to_jsonb(o) into v_result
    from public.orders o
   where o.id = v_order_id;
  return v_result;
end;
$$;

revoke all on function public.create_order_with_items_profile_v1_city_legacy(jsonb)
  from public, anon, authenticated;
