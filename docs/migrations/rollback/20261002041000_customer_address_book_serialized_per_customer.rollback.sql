-- REVERSIÓN de 20261002041000_customer_address_book_serialized_per_customer.sql
--
-- Devuelve `upsert_current_customer_address`, `set_current_customer_default_address` y
-- `archive_current_customer_address` a su cuerpo anterior (capturado con pg_get_functiondef
-- sobre la base sin esta migración; no se reescribió a mano). El de la primera se guarda con
-- fin de línea LF; el original lo tenía CRLF. Es el mismo texto.
--
-- Qué vuelve a quedar abierto: dos llamadas simultáneas del mismo cliente vuelven a no
-- verse. El mismo guardado repetido deja filas iguales o devuelve el 23505 crudo del índice
-- de la principal; dos pedidos de principal, lo mismo; archivar contra marcar como principal
-- termina en deadlock.
--
-- No pierde datos: la migración no creó tablas, columnas ni filas.
--
-- Se niega a correr si alguna de las tres funciones ya no tiene ni el cuerpo que dejó la
-- migración ni el anterior: otra migración la redefinió después y revertir ésta la pisaría.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261002041000
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261002041000', 0)
);

do $guard$
declare
  v_row record;
  v_actual text;
begin
  for v_row in
    select * from (values
      ('public.upsert_current_customer_address(jsonb)', '512cbf1504768b7753ceef5fbe50e4f9', '4f6218dc52d93f722fdd7a0853710778'),
      ('public.set_current_customer_default_address(uuid)', 'f82bbad6891d4fd0874e94390927bd8b', '2d06e567089671dfa6f66df72483c5e2'),
      ('public.archive_current_customer_address(uuid)', 'f996c156de8bab66c34fe977974eb987', '24083395fc2b7ab8ecaedfb33c0f34d3')
    ) as t(signature, applied, previous)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into v_actual
      from pg_proc p where p.oid = to_regprocedure(v_row.signature);
    if v_actual is null or v_actual not in (v_row.applied, v_row.previous) then
      raise exception 'ROLLBACK_BLOCKED: % no tiene el cuerpo de 20261002041000 ni el anterior; otra migracion la redefinio despues: revertir esa primero', v_row.signature
        using errcode = 'P0001';
    end if;
  end loop;
end
$guard$;

CREATE OR REPLACE FUNCTION public.upsert_current_customer_address(p_address jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_customer_id uuid := auth.uid();
  v_address_id uuid;
  v_existing public.customer_addresses%rowtype;
  v_duplicate public.customer_addresses%rowtype;
  v_label text;
  v_formatted text;
  v_street text;
  v_street_number text;
  v_floor text;
  v_apartment text;
  v_reference text;
  v_city text;
  v_neighborhood text;
  v_province text;
  v_postal_code text;
  v_latitude numeric(9, 6);
  v_longitude numeric(9, 6);
  v_accuracy numeric(10, 2);
  v_source text;
  v_location_source text;
  v_confirmed_at timestamptz;
  v_fingerprint text;
  v_normalized text;
  v_make_default boolean;
  v_allow_duplicate boolean := false;
  v_unexpected_key text;
  v_result public.customer_addresses%rowtype;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers c where c.id = v_customer_id) then
    raise exception 'guardá primero tu nombre y telefono' using errcode = '22023';
  end if;
  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    raise exception 'direccion invalida' using errcode = '22023';
  end if;

  select key into v_unexpected_key
    from jsonb_object_keys(p_address) as keys(key)
   where key not in (
     'id', 'label', 'formattedAddress', 'street', 'streetNumber', 'floor',
     'apartment', 'reference', 'city', 'neighborhood', 'province', 'postalCode', 'latitude',
     'longitude', 'geolocationAccuracy', 'source', 'isDefault', 'allowDuplicate',
     'locationSource', 'locationConfirmedAt', 'locationConfirmedAddress'
   )
   limit 1;
  if v_unexpected_key is not null then
    raise exception 'campo no permitido en direccion: %', v_unexpected_key using errcode = '22023';
  end if;

  if nullif(p_address->>'id', '') is not null then
    if (p_address->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'identificador de direccion invalido' using errcode = '22023';
    end if;
    v_address_id := (p_address->>'id')::uuid;
    select * into v_existing
      from public.customer_addresses a
     where a.id = v_address_id
       and a.customer_id = v_customer_id
       and a.deleted_at is null
     for update;
    if not found then
      raise exception 'direccion no encontrada' using errcode = '42501';
    end if;
  end if;

  v_label := nullif(btrim(coalesce(p_address->>'label', '')), '');
  v_street := nullif(btrim(coalesce(p_address->>'street', '')), '');
  v_street_number := nullif(btrim(coalesce(p_address->>'streetNumber', '')), '');
  v_floor := nullif(btrim(coalesce(p_address->>'floor', '')), '');
  v_apartment := nullif(btrim(coalesce(p_address->>'apartment', '')), '');
  v_reference := nullif(btrim(coalesce(p_address->>'reference', '')), '');
  v_city := nullif(btrim(coalesce(p_address->>'city', '')), '');
  v_neighborhood := nullif(btrim(coalesce(p_address->>'neighborhood', '')), '');
  v_province := nullif(btrim(coalesce(p_address->>'province', '')), '');
  v_postal_code := nullif(btrim(coalesce(p_address->>'postalCode', '')), '');
  v_formatted := nullif(btrim(coalesce(p_address->>'formattedAddress', '')), '');
  v_source := lower(coalesce(nullif(p_address->>'source', ''), 'manual'));
  v_location_source := lower(nullif(btrim(coalesce(p_address->>'locationSource', '')), ''));
  v_allow_duplicate := coalesce((p_address->>'allowDuplicate')::boolean, false);

  if v_label is null or char_length(v_label) > 60
    or v_street is null or char_length(v_street) > 120
    or v_city is null or char_length(v_city) > 100
    or char_length(coalesce(v_neighborhood, '')) > 100
    or char_length(coalesce(v_street_number, '')) > 24
    or char_length(coalesce(v_floor, '')) > 24
    or char_length(coalesce(v_apartment, '')) > 24
    or char_length(coalesce(v_reference, '')) > 180
    or char_length(coalesce(v_province, '')) > 100
    or char_length(coalesce(v_postal_code, '')) > 20 then
    raise exception 'direccion incompleta o demasiado larga' using errcode = '22023';
  end if;
  v_formatted := coalesce(v_formatted, concat_ws(', ', concat_ws(' ', v_street, v_street_number), v_city));
  if char_length(v_formatted) > 180 then
    raise exception 'direccion demasiado larga' using errcode = '22023';
  end if;
  if v_source not in ('manual', 'gps', 'geocoder', 'previous_order') then
    raise exception 'origen de direccion invalido' using errcode = '22023';
  end if;
  if v_location_source is not null
    and v_location_source not in ('gps', 'map_pin', 'geocoded_confirmed') then
    raise exception 'origen de ubicacion invalido' using errcode = '22023';
  end if;

  if nullif(p_address->>'latitude', '') is not null or nullif(p_address->>'longitude', '') is not null then
    if (p_address->>'latitude') !~ '^-?[0-9]+(\.[0-9]+)?$'
      or (p_address->>'longitude') !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception 'coordenadas invalidas' using errcode = '22023';
    end if;
    v_latitude := (p_address->>'latitude')::numeric(9, 6);
    v_longitude := (p_address->>'longitude')::numeric(9, 6);
    if v_latitude not between -90 and 90 or v_longitude not between -180 and 180 then
      raise exception 'coordenadas fuera de rango' using errcode = '22023';
    end if;
  end if;
  if nullif(p_address->>'geolocationAccuracy', '') is not null then
    if (p_address->>'geolocationAccuracy') !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'precision GPS invalida' using errcode = '22023';
    end if;
    v_accuracy := (p_address->>'geolocationAccuracy')::numeric(10, 2);
  end if;
  if (v_latitude is null) <> (v_longitude is null) then
    raise exception 'las coordenadas deben incluir latitud y longitud' using errcode = '22023';
  end if;
  if nullif(p_address->>'locationConfirmedAt', '') is not null then
    begin
      v_confirmed_at := (p_address->>'locationConfirmedAt')::timestamptz;
    exception when others then
      raise exception 'momento de confirmacion invalido' using errcode = '22023';
    end;
    if v_confirmed_at > clock_timestamp() + interval '5 minutes' then
      raise exception 'momento de confirmacion en el futuro' using errcode = '22023';
    end if;
  end if;

  -- Una confirmación necesita las cuatro piezas. Faltando cualquiera, la
  -- dirección se guarda SIN confirmar en vez de mentir a medias.
  if v_confirmed_at is null or v_location_source is null or v_latitude is null then
    v_confirmed_at := null;
    v_location_source := null;
  end if;

  v_fingerprint := public.delivery_location_address_fingerprint(
    v_street, v_street_number, v_city, v_province, v_postal_code
  );

  -- Editar el texto sin volver a marcar el pin invalida la confirmación. Se
  -- detecta porque el cliente reenvía LA MISMA confirmación de antes mientras la
  -- huella del texto cambió: ese pin ya no describe esta puerta.
  if v_address_id is not null
    and v_confirmed_at is not null
    and v_existing.location_confirmed_at is not null
    and v_confirmed_at = v_existing.location_confirmed_at
    and coalesce(v_existing.location_confirmed_address, '') <> v_fingerprint then
    v_confirmed_at := null;
    v_location_source := null;
    v_latitude := null;
    v_longitude := null;
    v_accuracy := null;
  end if;

  -- El origen del contrato manda sobre la columna histórica, que conserva su
  -- vocabulario porque un consumidor remoto la restringe.
  if v_confirmed_at is not null then
    v_source := case v_location_source
      when 'gps' then 'gps'
      when 'geocoded_confirmed' then 'geocoder'
      else 'manual'
    end;
  elsif v_source in ('gps', 'geocoder') and v_latitude is null then
    raise exception 'la fuente de ubicacion requiere coordenadas confirmadas' using errcode = '22023';
  end if;

  v_normalized := public.normalize_customer_address_text(concat_ws(' ', v_street, v_street_number, v_floor, v_apartment, v_city, v_province, v_postal_code));
  if v_normalized = '' then
    raise exception 'direccion invalida' using errcode = '22023';
  end if;

  select * into v_duplicate
    from public.customer_addresses a
   where a.customer_id = v_customer_id
     and a.deleted_at is null
     and (v_address_id is null or a.id <> v_address_id)
     and (
       a.normalized_address = v_normalized
       or (
         v_latitude is not null
         and a.latitude is not null
         and 6371000 * 2 * asin(sqrt(
           power(sin(radians(a.latitude - v_latitude) / 2), 2)
           + cos(radians(v_latitude)) * cos(radians(a.latitude))
             * power(sin(radians(a.longitude - v_longitude) / 2), 2)
         )) <= greatest(55, coalesce(v_accuracy, 0) + coalesce(a.geolocation_accuracy, 0) + 30)
       )
     )
   order by a.is_default desc, a.updated_at desc
   limit 1;

  if found and not v_allow_duplicate then
    return jsonb_build_object(
      'ok', false,
      'code', 'duplicate',
      'address', public.customer_address_json(v_duplicate)
    );
  end if;

  v_make_default := coalesce(
    (p_address->>'isDefault')::boolean,
    case when v_address_id is not null then v_existing.is_default else null end,
    not exists (
      select 1 from public.customer_addresses a
      where a.customer_id = v_customer_id and a.deleted_at is null
    )
  );
  if v_make_default then
    update public.customer_addresses
       set is_default = false
     where customer_id = v_customer_id
       and deleted_at is null
       and (v_address_id is null or id <> v_address_id)
       and is_default;
  end if;

  if v_address_id is null then
    insert into public.customer_addresses (
      customer_id, label, formatted_address, street, street_number, floor, apartment,
      reference, city, neighborhood, province, postal_code, latitude, longitude, geolocation_accuracy,
      source, location_source, location_confirmed_at, location_confirmed_address,
      normalized_address, is_default
    ) values (
      v_customer_id, v_label, v_formatted, v_street, v_street_number, v_floor, v_apartment,
      v_reference, v_city, v_neighborhood, v_province, v_postal_code, v_latitude, v_longitude, v_accuracy,
      v_source, v_location_source, v_confirmed_at,
      case when v_confirmed_at is not null then v_fingerprint end,
      v_normalized, v_make_default
    ) returning * into v_result;
  else
    update public.customer_addresses
       set label = v_label,
           formatted_address = v_formatted,
           street = v_street,
           street_number = v_street_number,
           floor = v_floor,
           apartment = v_apartment,
           reference = v_reference,
           city = v_city,
           neighborhood = v_neighborhood,
           province = v_province,
           postal_code = v_postal_code,
           latitude = v_latitude,
           longitude = v_longitude,
           geolocation_accuracy = v_accuracy,
           source = v_source,
           location_source = v_location_source,
           location_confirmed_at = v_confirmed_at,
           location_confirmed_address = case when v_confirmed_at is not null then v_fingerprint end,
           normalized_address = v_normalized,
           is_default = v_make_default
     where id = v_address_id
     returning * into v_result;
  end if;

  return jsonb_build_object('ok', true, 'address', public.customer_address_json(v_result));
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_current_customer_default_address(p_address_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_customer_id uuid := auth.uid();
  v_address public.customer_addresses%rowtype;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  select * into v_address
    from public.customer_addresses a
   where a.id = p_address_id and a.customer_id = v_customer_id and a.deleted_at is null
   for update;
  if not found then
    raise exception 'direccion no encontrada' using errcode = '42501';
  end if;
  update public.customer_addresses set is_default = false
   where customer_id = v_customer_id and deleted_at is null and is_default;
  update public.customer_addresses set is_default = true
   where id = v_address.id
   returning * into v_address;
  return public.customer_address_json(v_address);
end;
$function$;

CREATE OR REPLACE FUNCTION public.archive_current_customer_address(p_address_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_customer_id uuid := auth.uid();
  v_address public.customer_addresses%rowtype;
  v_replacement_id uuid;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  select * into v_address
    from public.customer_addresses a
   where a.id = p_address_id and a.customer_id = v_customer_id and a.deleted_at is null
   for update;
  if not found then
    raise exception 'direccion no encontrada' using errcode = '42501';
  end if;
  update public.customer_addresses
     set deleted_at = now(), is_default = false
   where id = v_address.id;
  if v_address.is_default then
    select a.id into v_replacement_id
      from public.customer_addresses a
     where a.customer_id = v_customer_id and a.deleted_at is null
     order by a.last_used_at desc nulls last, a.updated_at desc, a.id
     limit 1
     for update;
    if v_replacement_id is not null then
      update public.customer_addresses set is_default = true where id = v_replacement_id;
    end if;
  end if;
  return jsonb_build_object('id', v_address.id, 'archived', true, 'replacementId', v_replacement_id);
end;
$function$;

revoke all on function public.upsert_current_customer_address(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_current_customer_address(jsonb) to authenticated;
revoke all on function public.set_current_customer_default_address(uuid) from public, anon, authenticated;
grant execute on function public.set_current_customer_default_address(uuid) to authenticated;
revoke all on function public.archive_current_customer_address(uuid) from public, anon, authenticated;
grant execute on function public.archive_current_customer_address(uuid) to authenticated;

commit;
