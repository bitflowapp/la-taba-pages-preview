-- ============================================================================
--  Ningún pedido DELIVERY sin un punto que el cliente haya confirmado
-- ============================================================================
--
--  MEDIDO SOBRE EL PRIMER PEDIDO HUMANO
--  ------------------------------------
--  El storefront permitía crear un pedido con modalidad `delivery`, dirección
--  escrita a mano y `delivery_latitude` / `delivery_longitude` NULL. Nada estaba
--  roto: el dato nunca había existido. Aguas abajo eso significa
--
--    - el Panel conoce sólo texto;
--    - el Rider no tiene destino y su mapa dice «no hay coordenadas»;
--    - el seguimiento del cliente no puede dibujar la entrega;
--    - el enlace de Google Maps queda a merced de un geocodificador, que con
--      «Mendoza 827» ya resolvió una vez en Zapala, a 175 km;
--    - no hay contra qué certificar el GPS ni la ruta.
--
--  QUÉ IMPONE ESTA MIGRACIÓN
--  -------------------------
--  Un pedido `delivery` no se crea sin las cuatro piezas juntas: latitud,
--  longitud, el origen de esa coordenada y el instante en que la persona apretó
--  «Confirmar ubicación». Se rechaza ANTES de tocar el stock, con el código
--  DELIVERY_LOCATION_REQUIRED. `pickup` no exige nada geográfico: el punto de
--  encuentro es el mostrador.
--
--  POR QUÉ UNA COLUMNA NUEVA Y NO MÁS VALORES EN `source`
--  ------------------------------------------------------
--  El contrato pide declarar el origen como gps / map_pin / geocoded_confirmed.
--  La columna histórica `delivery_address_source` NO puede recibir esos valores:
--  en staging hay un trigger fuera de este repositorio
--  (`private.capture_rider_map_order_location_snapshot`, documentado en
--  docs/migrations/remote-only/) que copia ese valor a una tabla cuyo CHECK
--  acepta sólo manual/gps/geocoder/previous_order/qa_fixture. Ampliar el
--  vocabulario haría ABORTAR el alta del pedido. Por eso el origen del contrato
--  vive en columnas propias —`delivery_location_source`, `location_source`— y la
--  columna histórica sigue recibiendo su proyección:
--
--      gps                 -> gps
--      map_pin             -> manual
--      geocoded_confirmed  -> geocoder
--
--  POR QUÉ UN TRIGGER DIFERIDO QUE RELEE LA FILA
--  ---------------------------------------------
--  El camino de pedido directo inserta el pedido y RECIÉN DESPUÉS completa el
--  bloque `delivery_*` con un UPDATE, dentro de la misma transacción. Un CHECK de
--  tabla abortaría en el INSERT. Un trigger diferido común tampoco alcanza: se
--  midió que recibe la tupla del evento —la de antes del UPDATE— y no la final.
--  Por eso el trigger RELEE la fila por id al momento de confirmar: ahí sí ve el
--  estado con el que la transacción va a quedar.
--
--  PEDIDOS Y DIRECCIONES ANTERIORES
--  --------------------------------
--  No se tocan ni se rellenan: inventar dónde vive alguien no es una migración.
--  El trigger sólo mira altas nuevas y filas que YA tenían confirmación, así que
--  ningún pedido viejo se vuelve inactualizable. Una dirección guardada sin
--  confirmar sigue existiendo; lo que no puede es sostener un pedido delivery
--  hasta que la persona confirme el pin.
--
--  PRIVACIDAD
--  ----------
--  Se guarda un punto por dirección, no un historial: la confirmación pisa a la
--  anterior. El pedido conserva su propia copia inmutable, que es lo que la
--  entrega necesita. Borrar la dirección sigue siendo del cliente y no altera
--  pedidos ya despachados.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Huella del texto de dirección
-- ---------------------------------------------------------------------------
-- Espeja `deliveryLocationAddressFingerprint` en js/core/delivery-location.js.
-- Piso y departamento quedan afuera a propósito: nombran una unidad dentro del
-- mismo edificio, no otro lugar en el mundo, y cambiarlos no mueve el pin.
--
-- `translate` se aplica DESPUÉS de `lower`, al revés que en
-- `normalize_customer_address_text`: allí una «Á» mayúscula sobrevive al
-- translate, se minusculiza después y termina borrada por el filtro final. Acá
-- las dos implementaciones tienen que coincidir carácter por carácter, porque de
-- lo contrario el servidor invalidaría confirmaciones que el navegador da por
-- buenas.
create or replace function public.delivery_location_address_fingerprint(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          translate(lower(coalesce(p_value, '')), 'áéíóúüñ', 'aeiouun'),
          '\m(av\.?|avda\.?)\M', 'avenida', 'g'
        ),
        '\m(dpto\.?|depto\.?)\M', 'departamento', 'g'
      ),
      '[^a-z0-9]+', ' ', 'g'
    )
  )
$$;

create or replace function public.delivery_location_address_fingerprint(
  p_street text,
  p_street_number text,
  p_city text,
  p_province text,
  p_postal_code text
)
returns text
language sql
immutable
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select public.delivery_location_address_fingerprint(
    concat_ws(' ',
      nullif(btrim(coalesce(p_street, '')), ''),
      nullif(btrim(coalesce(p_street_number, '')), ''),
      nullif(btrim(coalesce(p_city, '')), ''),
      nullif(btrim(coalesce(p_province, '')), ''),
      nullif(btrim(coalesce(p_postal_code, '')), '')
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. Contrato en las direcciones del cliente
-- ---------------------------------------------------------------------------
alter table public.customer_addresses add column if not exists location_source text;
alter table public.customer_addresses add column if not exists location_confirmed_at timestamptz;
alter table public.customer_addresses add column if not exists location_confirmed_address text;

alter table public.customer_addresses
  drop constraint if exists customer_addresses_location_source_check;
alter table public.customer_addresses
  add constraint customer_addresses_location_source_check check (
    location_source is null
    or location_source in ('gps', 'map_pin', 'geocoded_confirmed')
  );

-- Una confirmación es una sola cosa: o están las cuatro piezas, o no hay
-- confirmación. No existe «confirmada a medias».
alter table public.customer_addresses
  drop constraint if exists customer_addresses_location_confirmation_complete;
alter table public.customer_addresses
  add constraint customer_addresses_location_confirmation_complete check (
    (
      location_confirmed_at is null
      and location_source is null
      and location_confirmed_address is null
    )
    or (
      location_confirmed_at is not null
      and location_source is not null
      and location_confirmed_address is not null
      and latitude is not null
      and longitude is not null
    )
  );

create index if not exists customer_addresses_confirmed_idx
on public.customer_addresses(customer_id)
where deleted_at is null and location_confirmed_at is not null;

-- ---------------------------------------------------------------------------
-- 3. Contrato en el pedido
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists delivery_location_source text;
alter table public.orders add column if not exists delivery_location_confirmed_at timestamptz;

alter table public.orders
  drop constraint if exists orders_delivery_location_source_check;
alter table public.orders
  add constraint orders_delivery_location_source_check check (
    delivery_location_source is null
    or delivery_location_source in ('gps', 'map_pin', 'geocoded_confirmed')
  );

-- `not valid`: los pedidos anteriores conservan lo que tienen. Lo nuevo no puede
-- declarar una confirmación sin el punto que la sostiene.
alter table public.orders
  drop constraint if exists orders_delivery_location_confirmation_complete;
alter table public.orders
  add constraint orders_delivery_location_confirmation_complete check (
    delivery_location_confirmed_at is null
    or (
      delivery_location_source is not null
      and delivery_latitude is not null
      and delivery_longitude is not null
    )
  ) not valid;

create or replace function public.enforce_confirmed_delivery_location()
returns trigger
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
begin
  -- Se RELEE la fila. Un trigger diferido recibe la tupla del evento, no la
  -- final, y el camino de pedido directo completa el bloque `delivery_*` con un
  -- UPDATE posterior dentro de la misma transacción.
  select * into v_order from public.orders o where o.id = new.id;
  if not found then
    return null;
  end if;
  if coalesce(v_order.fulfillment_type, v_order.delivery_mode) is distinct from 'delivery' then
    return null;
  end if;
  if v_order.delivery_latitude is null
    or v_order.delivery_longitude is null
    or v_order.delivery_location_source is null
    or v_order.delivery_location_confirmed_at is null then
    raise exception 'DELIVERY_LOCATION_REQUIRED'
      using errcode = '23514',
            detail = 'un pedido delivery necesita un punto de entrega confirmado por el cliente',
            hint = 'confirmar la ubicacion antes de crear el pedido';
  end if;
  return null;
end;
$$;

-- Altas nuevas: siempre. Filas ya existentes: sólo si YA tenían confirmación, de
-- modo que un pedido anterior a este contrato no se vuelva inactualizable por el
-- Panel ni por el Rider.
drop trigger if exists orders_require_confirmed_delivery_location on public.orders;
create constraint trigger orders_require_confirmed_delivery_location
after insert on public.orders
deferrable initially deferred
for each row execute function public.enforce_confirmed_delivery_location();

drop trigger if exists orders_keep_confirmed_delivery_location on public.orders;
create constraint trigger orders_keep_confirmed_delivery_location
after update on public.orders
deferrable initially deferred
for each row
when (old.delivery_location_confirmed_at is not null)
execute function public.enforce_confirmed_delivery_location();

-- ---------------------------------------------------------------------------
-- 3 bis. El punto tiene que estar EN EL INSERT, no en un UPDATE posterior
-- ---------------------------------------------------------------------------
--  MEDIDO
--  ------
--  El Rider no lee las columnas del pedido: lee la instantánea que toma
--  `private.capture_rider_map_order_location_snapshot` en el AFTER INSERT de
--  `public.orders`, y esa foto es inmutable por contrato. El camino de pedido
--  directo inserta el pedido y completa el bloque `delivery_*` con un UPDATE
--  posterior, así que la foto salía VACÍA aun teniendo el punto guardado al
--  lado: la app del Rider decía «no hay coordenadas autorizadas» sin que nada
--  estuviera roto en el mapa. Se comprobó en la base local con el fixture del
--  esquema remoto instalado; el pago online no comparte el defecto porque
--  inserta el pedido completo de una vez.
--
--  QUÉ HACE ESTO
--  -------------
--  La función autoritativa deja el punto ya validado en un ajuste LOCAL a la
--  transacción y este trigger BEFORE INSERT lo aplica a la fila antes de que se
--  escriba. Los triggers AFTER —incluido el remoto— ven la fila completa.
--
--  No es un canal por el que un cliente pueda inyectar coordenadas: el ajuste
--  sólo lo escribe `create_order_with_items` después de validar, dura lo que
--  dura la transacción, y el trigger jamás pisa un valor ya presente.
create or replace function public.apply_pending_delivery_location()
returns trigger
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_pending jsonb;
begin
  if coalesce(new.fulfillment_type, new.delivery_mode) is distinct from 'delivery' then
    return new;
  end if;
  if new.delivery_latitude is not null and new.delivery_location_confirmed_at is not null then
    return new;
  end if;
  v_pending := nullif(btrim(coalesce(current_setting('taba.pending_delivery_location', true), '')), '')::jsonb;
  if v_pending is null then
    return new;
  end if;
  new.delivery_latitude := coalesce(new.delivery_latitude, (v_pending ->> 'latitude')::numeric(9, 6));
  new.delivery_longitude := coalesce(new.delivery_longitude, (v_pending ->> 'longitude')::numeric(9, 6));
  new.delivery_geolocation_accuracy := coalesce(
    new.delivery_geolocation_accuracy,
    nullif(v_pending ->> 'accuracy', '')::numeric(10, 2)
  );
  new.delivery_location_source := coalesce(new.delivery_location_source, v_pending ->> 'location_source');
  new.delivery_location_confirmed_at := coalesce(
    new.delivery_location_confirmed_at,
    (v_pending ->> 'confirmed_at')::timestamptz
  );
  new.delivery_address_source := coalesce(new.delivery_address_source, v_pending ->> 'address_source');
  return new;
end;
$$;

drop trigger if exists orders_apply_pending_delivery_location on public.orders;
create trigger orders_apply_pending_delivery_location
before insert on public.orders
for each row execute function public.apply_pending_delivery_location();

-- ---------------------------------------------------------------------------
-- 4. La dirección guardada declara si está confirmada
-- ---------------------------------------------------------------------------
create or replace function public.customer_address_json(p_address public.customer_addresses)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'id', p_address.id,
    'label', p_address.label,
    'formattedAddress', p_address.formatted_address,
    'street', p_address.street,
    'streetNumber', p_address.street_number,
    'floor', p_address.floor,
    'apartment', p_address.apartment,
    'reference', p_address.reference,
    'city', p_address.city,
    'province', p_address.province,
    'postalCode', p_address.postal_code,
    'latitude', p_address.latitude,
    'longitude', p_address.longitude,
    'geolocationAccuracy', p_address.geolocation_accuracy,
    'source', p_address.source,
    'locationSource', p_address.location_source,
    'locationConfirmedAt', p_address.location_confirmed_at,
    'locationConfirmedAddress', p_address.location_confirmed_address,
    'isDefault', p_address.is_default,
    'lastUsedAt', p_address.last_used_at,
    'createdAt', p_address.created_at,
    'updatedAt', p_address.updated_at
  )
$$;

create or replace function public.upsert_current_customer_address(p_address jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
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
     'apartment', 'reference', 'city', 'province', 'postalCode', 'latitude',
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
  v_province := nullif(btrim(coalesce(p_address->>'province', '')), '');
  v_postal_code := nullif(btrim(coalesce(p_address->>'postalCode', '')), '');
  v_formatted := nullif(btrim(coalesce(p_address->>'formattedAddress', '')), '');
  v_source := lower(coalesce(nullif(p_address->>'source', ''), 'manual'));
  v_location_source := lower(nullif(btrim(coalesce(p_address->>'locationSource', '')), ''));
  v_allow_duplicate := coalesce((p_address->>'allowDuplicate')::boolean, false);

  if v_label is null or char_length(v_label) > 60
    or v_street is null or char_length(v_street) > 120
    or v_city is null or char_length(v_city) > 100
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
      reference, city, province, postal_code, latitude, longitude, geolocation_accuracy,
      source, location_source, location_confirmed_at, location_confirmed_address,
      normalized_address, is_default
    ) values (
      v_customer_id, v_label, v_formatted, v_street, v_street_number, v_floor, v_apartment,
      v_reference, v_city, v_province, v_postal_code, v_latitude, v_longitude, v_accuracy,
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
$$;

-- ---------------------------------------------------------------------------
-- 5. Pedido directo: se rechaza ANTES de reservar stock
-- ---------------------------------------------------------------------------
do $migration$
begin
  if to_regprocedure('public.create_order_with_items_profile_v2(jsonb)') is null then
    execute 'alter function public.create_order_with_items(jsonb) rename to create_order_with_items_profile_v2';
  end if;
end;
$migration$;

create or replace function public.create_order_with_items(payload jsonb)
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
  v_latitude numeric(9, 6);
  v_longitude numeric(9, 6);
  v_accuracy numeric(10, 2);
  v_location_source text;
  v_confirmed_at timestamptz;
  v_base_payload jsonb;
  v_result jsonb;
  v_order_id uuid;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload invalido' using errcode = '22023';
  end if;

  v_delivery_mode := lower(coalesce(
    nullif(payload->>'delivery_mode', ''),
    nullif(payload->>'fulfillment_type', ''),
    'delivery'
  ));

  if v_delivery_mode = 'delivery' then
    if nullif(payload->>'customer_address_id', '') is not null then
      if (payload->>'customer_address_id') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
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
      v_latitude := v_address.latitude;
      v_longitude := v_address.longitude;
      v_accuracy := v_address.geolocation_accuracy;
      v_location_source := v_address.location_source;
      v_confirmed_at := v_address.location_confirmed_at;
      -- Una dirección cuya huella dejó de describir su propio texto no sostiene
      -- un pedido: hay que volver a marcar el pin.
      if v_confirmed_at is not null
        and coalesce(v_address.location_confirmed_address, '') <> public.delivery_location_address_fingerprint(
          v_address.street, v_address.street_number, v_address.city, v_address.province, v_address.postal_code
        ) then
        v_confirmed_at := null;
      end if;
    else
      if nullif(payload->>'delivery_latitude', '') is not null
        and (payload->>'delivery_latitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
        and nullif(payload->>'delivery_longitude', '') is not null
        and (payload->>'delivery_longitude') ~ '^-?[0-9]+(\.[0-9]+)?$' then
        v_latitude := (payload->>'delivery_latitude')::numeric(9, 6);
        v_longitude := (payload->>'delivery_longitude')::numeric(9, 6);
      end if;
      if nullif(payload->>'delivery_geolocation_accuracy', '') is not null
        and (payload->>'delivery_geolocation_accuracy') ~ '^[0-9]+(\.[0-9]+)?$' then
        v_accuracy := (payload->>'delivery_geolocation_accuracy')::numeric(10, 2);
      end if;
      v_location_source := lower(nullif(btrim(coalesce(payload->>'delivery_location_source', '')), ''));
      if nullif(payload->>'delivery_location_confirmed_at', '') is not null then
        begin
          v_confirmed_at := (payload->>'delivery_location_confirmed_at')::timestamptz;
        exception when others then
          raise exception 'momento de confirmacion invalido' using errcode = '22023';
        end;
      end if;
    end if;

    if v_location_source is not null
      and v_location_source not in ('gps', 'map_pin', 'geocoded_confirmed') then
      raise exception 'origen de ubicacion invalido' using errcode = '22023';
    end if;
    if v_confirmed_at is not null and v_confirmed_at > clock_timestamp() + interval '5 minutes' then
      raise exception 'momento de confirmacion en el futuro' using errcode = '22023';
    end if;
    if v_latitude is null or v_longitude is null
      or v_location_source is null or v_confirmed_at is null then
      raise exception 'DELIVERY_LOCATION_REQUIRED'
        using errcode = '22023',
              detail = 'la entrega necesita un punto confirmado por el cliente',
              hint = 'confirmar la ubicacion en el mapa antes de pedir';
    end if;
    if v_latitude not between -90 and 90 or v_longitude not between -180 and 180 then
      raise exception 'coordenadas fuera de rango' using errcode = '22023';
    end if;
  end if;

  -- Las claves del contrato nuevo no llegan a las capas anteriores: la más
  -- profunda rechaza cualquier clave que no conozca.
  v_base_payload := payload - array[
    'delivery_location_source',
    'delivery_location_confirmed_at'
  ];

  -- El punto viaja al INSERT por un ajuste local a la transacción, para que la
  -- instantánea inmutable que lee el Rider —tomada en el AFTER INSERT— no salga
  -- vacía. Ver `apply_pending_delivery_location`.
  if v_delivery_mode = 'delivery' then
    perform set_config('taba.pending_delivery_location', jsonb_build_object(
      'latitude', v_latitude,
      'longitude', v_longitude,
      'accuracy', v_accuracy,
      'location_source', v_location_source,
      'confirmed_at', v_confirmed_at,
      'address_source', case v_location_source
        when 'gps' then 'gps'
        when 'geocoded_confirmed' then 'geocoder'
        else 'manual'
      end
    )::text, true);
  end if;

  v_result := public.create_order_with_items_profile_v2(v_base_payload);
  -- Se apaga apenas deja de hacer falta: ningún otro alta de la misma
  -- transacción debe heredar este punto.
  perform set_config('taba.pending_delivery_location', '', true);
  v_order_id := nullif(v_result->>'id', '')::uuid;
  if v_order_id is null then
    raise exception 'el pedido no devolvio un identificador valido' using errcode = '22023';
  end if;

  -- Nunca reemplaza la instantánea de un reintento idempotente ni la de un
  -- pedido anterior: sólo completa la que todavía no fue sellada.
  if v_delivery_mode = 'delivery' then
    update public.orders
       set delivery_location_source = v_location_source,
           delivery_location_confirmed_at = v_confirmed_at,
           delivery_latitude = coalesce(delivery_latitude, v_latitude),
           delivery_longitude = coalesce(delivery_longitude, v_longitude)
     where id = v_order_id
       and delivery_location_confirmed_at is null;
  end if;

  select v_result || to_jsonb(o) into v_result
    from public.orders o
   where o.id = v_order_id;
  return v_result;
end;
$$;

revoke all on function public.create_order_with_items_profile_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.create_order_with_items(jsonb) from public, anon;
grant execute on function public.create_order_with_items(jsonb) to authenticated;

revoke all on function public.upsert_current_customer_address(jsonb) from public, anon;
grant execute on function public.upsert_current_customer_address(jsonb) to authenticated;

comment on column public.customer_addresses.location_source is
  'Como se obtuvo el punto: gps, map_pin o geocoded_confirmed. NULL significa direccion sin confirmar.';
comment on column public.customer_addresses.location_confirmed_at is
  'Instante en que la persona confirmo el pin para esta direccion.';
comment on column public.customer_addresses.location_confirmed_address is
  'Huella del texto de direccion vigente al confirmar. Si el texto cambia, la confirmacion vence.';
comment on column public.orders.delivery_location_source is
  'Origen del punto de entrega del pedido: gps, map_pin o geocoded_confirmed.';
comment on column public.orders.delivery_location_confirmed_at is
  'Instante en que el cliente confirmo el punto de entrega de este pedido.';
comment on function public.enforce_confirmed_delivery_location() is
  'Red de seguridad diferida: ningun pedido delivery queda confirmado sin punto de entrega.';
