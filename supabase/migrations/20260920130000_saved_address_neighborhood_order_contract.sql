-- Cierra la pérdida del barrio entre una dirección guardada y el núcleo
-- autoritativo de pedidos.
--
-- La capa histórica `create_order_with_items_profile_v1` fue creada antes de
-- que `customer_addresses.neighborhood` existiera. Cuando recibe un
-- `customer_address_id` vuelve a cargar la fila (correcto), pero envía `city`
-- como `customer_neighborhood` al núcleo (incorrecto). Con cobertura por áreas
-- declaradas, una dirección guardada como ciudad "Neuquén Capital" y barrio
-- "Centro" termina rechazada aunque la UI y la tabla tengan el barrio correcto.
--
-- Se conserva la implementación anterior con otro nombre y se intercala una
-- capa pequeña que:
--   * verifica que la dirección pertenezca a la persona autenticada;
--   * proyecta el barrio guardado, nunca un valor manipulable del navegador;
--   * quita el id antes de entrar a la capa vieja para evitar que ésta vuelva a
--     reemplazar el barrio por la ciudad;
--   * restaura la asociación customer_address_id en la orden aceptada;
--   * para reintentos ya creados, usa la instantánea inmutable de la orden, de
--     modo que un deploy no cambie el fingerprint idempotente existente.

do $migration$
begin
  if to_regprocedure('public.create_order_with_items_profile_v1_city_legacy(jsonb)') is null then
    alter function public.create_order_with_items_profile_v1(jsonb)
      rename to create_order_with_items_profile_v1_city_legacy;
  end if;
end;
$migration$;

create or replace function public.create_order_with_items_profile_v1(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_customer_id uuid := auth.uid();
  v_delivery_mode text;
  v_address_id uuid;
  v_address public.customer_addresses%rowtype;
  v_existing public.orders%rowtype;
  v_sanitized jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_street text;
  v_neighborhood text;
  v_reference text;
  v_formatted text;
  v_latitude numeric(9, 6);
  v_longitude numeric(9, 6);
  v_accuracy numeric(10, 2);
  v_source text;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload invalido' using errcode = '22023';
  end if;

  v_delivery_mode := lower(coalesce(
    nullif(payload ->> 'delivery_mode', ''),
    nullif(payload ->> 'fulfillment_type', ''),
    'delivery'
  ));
  if v_delivery_mode <> 'delivery' or nullif(payload ->> 'customer_address_id', '') is null then
    return public.create_order_with_items_profile_v1_city_legacy(payload);
  end if;

  if (payload ->> 'customer_address_id') !~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'identificador de direccion invalido' using errcode = '22023';
  end if;
  v_address_id := (payload ->> 'customer_address_id')::uuid;

  select * into v_address
    from public.customer_addresses a
   where a.id = v_address_id
     and a.customer_id = v_customer_id
     and a.deleted_at is null;
  if not found then
    raise exception 'direccion guardada no encontrada' using errcode = '42501';
  end if;

  -- Si el núcleo ya aceptó esta clave, su instantánea es la única entrada que
  -- puede reproducir el fingerprint. Esto mantiene reintentables tanto pedidos
  -- anteriores a esta migración como pedidos creados con el contrato nuevo.
  if coalesce(payload ->> 'business_id', '') ~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     and nullif(btrim(coalesce(payload ->> 'client_request_id', '')), '') is not null then
    select * into v_existing
      from public.orders o
     where o.business_id = (payload ->> 'business_id')::uuid
       and o.customer_user_id = v_customer_id
       and o.client_request_id = btrim(payload ->> 'client_request_id')
     limit 1;
  end if;

  if v_existing.id is not null then
    v_street := v_existing.customer_street_address;
    v_neighborhood := v_existing.customer_neighborhood;
    v_reference := v_existing.customer_reference;
    v_formatted := v_existing.address_label;
    v_latitude := v_existing.delivery_latitude;
    v_longitude := v_existing.delivery_longitude;
    v_accuracy := v_existing.delivery_geolocation_accuracy;
    v_source := v_existing.delivery_address_source;
  else
    v_street := concat_ws(' ', v_address.street, v_address.street_number);
    v_neighborhood := v_address.neighborhood;
    v_reference := v_address.reference;
    v_formatted := v_address.formatted_address;
    v_latitude := v_address.latitude;
    v_longitude := v_address.longitude;
    v_accuracy := v_address.geolocation_accuracy;
    v_source := v_address.source;
  end if;

  v_sanitized := (
    payload - array[
      'customer_address_id',
      'customer_street_address',
      'customer_neighborhood',
      'customer_reference',
      'address_label',
      'delivery_latitude',
      'delivery_longitude',
      'delivery_geolocation_accuracy',
      'delivery_address_source'
    ]
  ) || jsonb_strip_nulls(jsonb_build_object(
    'customer_street_address', v_street,
    'customer_neighborhood', v_neighborhood,
    'customer_reference', v_reference,
    'address_label', v_formatted,
    'delivery_latitude', v_latitude,
    'delivery_longitude', v_longitude,
    'delivery_geolocation_accuracy', v_accuracy,
    'delivery_address_source', v_source
  ));

  v_result := public.create_order_with_items_profile_v1_city_legacy(v_sanitized);
  v_order_id := nullif(v_result ->> 'id', '')::uuid;
  if v_order_id is null then
    raise exception 'el pedido no devolvio un identificador valido' using errcode = '22023';
  end if;

  update public.orders
     set customer_address_id = v_address_id
   where id = v_order_id
     and customer_user_id = v_customer_id
     and customer_address_id is null;

  select v_result || to_jsonb(o) into v_result
    from public.orders o
   where o.id = v_order_id
     and o.customer_user_id = v_customer_id;
  return v_result;
end;
$$;

revoke all on function public.create_order_with_items_profile_v1_city_legacy(jsonb)
  from public, anon, authenticated;
revoke all on function public.create_order_with_items_profile_v1(jsonb)
  from public, anon, authenticated;

comment on function public.create_order_with_items_profile_v1(jsonb) is
  'Compatibilidad interna: resuelve direcciones guardadas con su barrio declarado y conserva fingerprints de reintentos existentes.';
