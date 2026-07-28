-- Persistent customer profiles and delivery addresses.
--
-- Customer identity is always auth.uid(); neither the browser nor an RPC caller
-- may choose a customer_id. Addresses stay editable, while every order retains
-- its own immutable delivery snapshot.

create table if not exists public.customers (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text not null,
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint customers_phone_length check (char_length(btrim(phone)) between 6 and 40)
);

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text not null,
  formatted_address text not null,
  street text not null,
  street_number text,
  floor text,
  apartment text,
  reference text,
  city text not null,
  province text,
  postal_code text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  geolocation_accuracy numeric(10, 2),
  source text not null default 'manual',
  normalized_address text not null,
  is_default boolean not null default false,
  last_used_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_addresses_label_length check (char_length(btrim(label)) between 1 and 60),
  constraint customer_addresses_formatted_length check (char_length(btrim(formatted_address)) between 1 and 180),
  constraint customer_addresses_street_length check (char_length(btrim(street)) between 1 and 120),
  constraint customer_addresses_city_length check (char_length(btrim(city)) between 1 and 100),
  constraint customer_addresses_source_check check (source in ('manual', 'gps', 'geocoder', 'previous_order')),
  constraint customer_addresses_coordinates_pair check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  ),
  constraint customer_addresses_accuracy_nonnegative check (geolocation_accuracy is null or geolocation_accuracy >= 0)
);

create index if not exists customers_last_order_idx
on public.customers(last_order_at desc nulls last);

create index if not exists customer_addresses_customer_active_idx
on public.customer_addresses(customer_id, updated_at desc)
where deleted_at is null;

create index if not exists customer_addresses_normalized_idx
on public.customer_addresses(customer_id, normalized_address)
where deleted_at is null;

create unique index if not exists customer_addresses_one_default_idx
on public.customer_addresses(customer_id)
where is_default and deleted_at is null;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

drop trigger if exists customer_addresses_set_updated_at on public.customer_addresses;
create trigger customer_addresses_set_updated_at
before update on public.customer_addresses
for each row execute function public.set_updated_at();

alter table public.orders add column if not exists customer_address_id uuid references public.customer_addresses(id) on delete set null;
alter table public.orders add column if not exists delivery_address_formatted text;
alter table public.orders add column if not exists delivery_street text;
alter table public.orders add column if not exists delivery_street_number text;
alter table public.orders add column if not exists delivery_floor text;
alter table public.orders add column if not exists delivery_apartment text;
alter table public.orders add column if not exists delivery_reference text;
alter table public.orders add column if not exists delivery_city text;
alter table public.orders add column if not exists delivery_province text;
alter table public.orders add column if not exists delivery_postal_code text;
alter table public.orders add column if not exists delivery_latitude numeric(9, 6);
alter table public.orders add column if not exists delivery_longitude numeric(9, 6);
alter table public.orders add column if not exists delivery_geolocation_accuracy numeric(10, 2);
alter table public.orders add column if not exists delivery_address_source text;

alter table public.orders drop constraint if exists orders_delivery_snapshot_coordinates_pair;
alter table public.orders add constraint orders_delivery_snapshot_coordinates_pair check (
  (delivery_latitude is null and delivery_longitude is null)
  or (delivery_latitude between -90 and 90 and delivery_longitude between -180 and 180)
);

alter table public.orders drop constraint if exists orders_delivery_snapshot_source_check;
alter table public.orders add constraint orders_delivery_snapshot_source_check check (
  delivery_address_source is null
  or delivery_address_source in ('manual', 'gps', 'geocoder', 'previous_order')
);

create index if not exists orders_customer_address_idx
on public.orders(customer_address_id)
where customer_address_id is not null;

create or replace function public.normalize_customer_address_text(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(translate(coalesce(p_value, ''), 'áéíóúüñ', 'aeiouun')),
        '\m(av\.?|avda\.?)\M',
        'avenida',
        'g'
      ),
      '\m(dpto\.?|depto\.?)\M',
      'departamento',
      'g'
    ),
    '[^a-z0-9]+',
    ' ',
    'g'
  )
$$;

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
    'isDefault', p_address.is_default,
    'lastUsedAt', p_address.last_used_at,
    'createdAt', p_address.created_at,
    'updatedAt', p_address.updated_at
  )
$$;

create or replace function public.get_current_customer_profile()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_customer_id uuid := auth.uid();
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'phone', c.phone,
        'lastOrderAt', c.last_order_at,
        'createdAt', c.created_at,
        'updatedAt', c.updated_at
      )
      from public.customers c
      where c.id = v_customer_id
    ),
    'addresses', coalesce((
      select jsonb_agg(public.customer_address_json(a) order by a.is_default desc, a.updated_at desc, a.id)
      from public.customer_addresses a
      where a.customer_id = v_customer_id
        and a.deleted_at is null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.upsert_current_customer_profile(p_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_customer_id uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_customer public.customers%rowtype;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) > 120 then
    raise exception 'nombre requerido o demasiado largo' using errcode = '22023';
  end if;
  if v_phone is null or char_length(v_phone) < 6 or char_length(v_phone) > 40 then
    raise exception 'telefono invalido' using errcode = '22023';
  end if;

  insert into public.customers (id, name, phone)
  values (v_customer_id, v_name, v_phone)
  on conflict (id) do update
     set name = excluded.name,
         phone = excluded.phone
  returning * into v_customer;

  return jsonb_build_object(
    'id', v_customer.id,
    'name', v_customer.name,
    'phone', v_customer.phone,
    'lastOrderAt', v_customer.last_order_at,
    'createdAt', v_customer.created_at,
    'updatedAt', v_customer.updated_at
  );
end;
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
     'longitude', 'geolocationAccuracy', 'source', 'isDefault', 'allowDuplicate'
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
  if v_source in ('gps', 'geocoder') and v_latitude is null then
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
      source, normalized_address, is_default
    ) values (
      v_customer_id, v_label, v_formatted, v_street, v_street_number, v_floor, v_apartment,
      v_reference, v_city, v_province, v_postal_code, v_latitude, v_longitude, v_accuracy,
      v_source, v_normalized, v_make_default
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
           normalized_address = v_normalized,
           is_default = v_make_default
     where id = v_address_id
     returning * into v_result;
  end if;

  return jsonb_build_object('ok', true, 'address', public.customer_address_json(v_result));
end;
$$;

create or replace function public.set_current_customer_default_address(p_address_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
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
$$;

create or replace function public.archive_current_customer_address(p_address_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
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
$$;

-- Keep the established public RPC contract. The legacy transactional function
-- remains the authority for catalogue, prices, stock and order state; this thin
-- wrapper resolves an owned saved address and writes immutable snapshots only
-- after the order was accepted.
alter function public.create_order_with_items(jsonb) rename to create_order_with_items_legacy;

create or replace function public.create_order_with_items(payload jsonb)
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
     and delivery_address_formatted is null;

  if found and v_address_id is not null then
    update public.customer_addresses set last_used_at = now() where id = v_address_id;
  end if;
  update public.customers set last_order_at = now() where id = v_customer_id;

  select v_result || to_jsonb(o) into v_result
    from public.orders o
   where o.id = v_order_id;
  return v_result;
end;
$$;

alter table public.customers enable row level security;
alter table public.customer_addresses enable row level security;

drop policy if exists "customers readable by owner" on public.customers;
create policy "customers readable by owner"
on public.customers for select
to authenticated
using (id = auth.uid());

drop policy if exists "customer addresses readable by owner" on public.customer_addresses;
create policy "customer addresses readable by owner"
on public.customer_addresses for select
to authenticated
using (customer_id = auth.uid() and deleted_at is null);

revoke all privileges on table public.customers from public, anon, authenticated;
revoke all privileges on table public.customer_addresses from public, anon, authenticated;
grant select on table public.customers to authenticated;
grant select on table public.customer_addresses to authenticated;

revoke all on function public.get_current_customer_profile() from public, anon;
revoke all on function public.upsert_current_customer_profile(text, text) from public, anon;
revoke all on function public.upsert_current_customer_address(jsonb) from public, anon;
revoke all on function public.set_current_customer_default_address(uuid) from public, anon;
revoke all on function public.archive_current_customer_address(uuid) from public, anon;
revoke all on function public.create_order_with_items_legacy(jsonb) from public, anon, authenticated;
revoke all on function public.create_order_with_items(jsonb) from public, anon;
grant execute on function public.get_current_customer_profile() to authenticated;
grant execute on function public.upsert_current_customer_profile(text, text) to authenticated;
grant execute on function public.upsert_current_customer_address(jsonb) to authenticated;
grant execute on function public.set_current_customer_default_address(uuid) to authenticated;
grant execute on function public.archive_current_customer_address(uuid) to authenticated;
grant execute on function public.create_order_with_items(jsonb) to authenticated;

comment on table public.customers is
  'One persistent customer profile per Supabase Auth user, including anonymous customer sessions.';
comment on table public.customer_addresses is
  'Customer-owned reusable delivery addresses. Soft-deleted rows remain detached from immutable order snapshots.';
comment on function public.create_order_with_items(jsonb) is
  'Authoritative order creation with an owned saved-address resolver and immutable delivery-address snapshot.';
