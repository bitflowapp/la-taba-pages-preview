-- Complete the customer profile contract without rewriting applied migrations.
--
-- Rollback strategy:
--   1. drop public.create_order_with_items(jsonb);
--   2. rename public.create_order_with_items_profile_v1(jsonb) back to
--      public.create_order_with_items(jsonb);
--   3. restore the previous profile RPC from migration 20260728090000;
--   4. drop the two snapshot columns only after confirming no consumer needs
--      them. Existing orders, customers and addresses never need to be deleted.

alter table public.orders
  add column if not exists delivery_address_label text;

alter table public.orders
  add column if not exists delivery_snapshot_created_at timestamptz;

alter table public.orders
  drop constraint if exists orders_delivery_address_label_length;
alter table public.orders
  add constraint orders_delivery_address_label_length
  check (
    delivery_address_label is null
    or char_length(btrim(delivery_address_label)) between 1 and 60
  ) not valid;

-- A prior snapshot already has a trustworthy server-side creation timestamp:
-- the order creation time. Rows without a delivery snapshot remain untouched.
update public.orders
   set delivery_snapshot_created_at = created_at
 where delivery_snapshot_created_at is null
   and delivery_address_formatted is not null;

alter table public.customers drop constraint if exists customers_name_length;
alter table public.customers
  add constraint customers_name_length
  check (
    char_length(btrim(name)) between 2 and 80
    and name ~ '[[:alpha:]]'
  ) not valid;

alter table public.customers drop constraint if exists customers_phone_length;
alter table public.customers
  add constraint customers_phone_length
  check (
    phone ~ '^[0-9]{10,13}$'
    and phone !~ '^([0-9])\1+$'
  ) not valid;

create or replace function public.upsert_current_customer_profile(p_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_customer_id uuid := auth.uid();
  v_name text := nullif(
    regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g'),
    ''
  );
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_customer public.customers%rowtype;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if v_name is null
    or char_length(v_name) < 2
    or char_length(v_name) > 80
    or v_name !~ '[[:alpha:]]' then
    raise exception 'nombre invalido: usa entre 2 y 80 caracteres e incluye letras'
      using errcode = '22023';
  end if;
  if v_phone !~ '^[0-9]{10,13}$' or v_phone ~ '^([0-9])\1+$' then
    raise exception 'telefono argentino invalido' using errcode = '22023';
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

-- Preserve the established order RPC name while retaining the preceding
-- transactional implementation as a non-callable internal layer.
do $migration$
begin
  if to_regprocedure('public.create_order_with_items_profile_v1(jsonb)') is null then
    execute 'alter function public.create_order_with_items(jsonb) rename to create_order_with_items_profile_v1';
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
  v_address_id uuid;
  v_address public.customer_addresses%rowtype;
  v_base_payload jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_name text;
  v_phone text;
  v_label text;
  v_street text;
  v_street_number text;
  v_floor text;
  v_apartment text;
  v_city text;
  v_province text;
  v_postal_code text;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload invalido' using errcode = '22023';
  end if;

  v_name := nullif(
    regexp_replace(btrim(coalesce(payload->>'customer_name', '')), '[[:space:]]+', ' ', 'g'),
    ''
  );
  v_phone := regexp_replace(coalesce(payload->>'customer_phone', ''), '[^0-9]', '', 'g');
  if v_name is null
    or char_length(v_name) < 2
    or char_length(v_name) > 80
    or v_name !~ '[[:alpha:]]' then
    raise exception 'customer_name invalido' using errcode = '22023';
  end if;
  if v_phone !~ '^[0-9]{10,13}$' or v_phone ~ '^([0-9])\1+$' then
    raise exception 'customer_phone invalido' using errcode = '22023';
  end if;

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
    v_label := v_address.label;
    v_street := v_address.street;
    v_street_number := v_address.street_number;
    v_floor := v_address.floor;
    v_apartment := v_address.apartment;
    v_city := v_address.city;
    v_province := v_address.province;
    v_postal_code := v_address.postal_code;
  else
    v_label := nullif(btrim(coalesce(payload->>'customer_address_label', '')), '');
    v_street := nullif(btrim(coalesce(
      payload->>'delivery_street',
      payload->>'customer_street_address',
      ''
    )), '');
    v_street_number := nullif(btrim(coalesce(payload->>'delivery_street_number', '')), '');
    v_floor := nullif(btrim(coalesce(payload->>'delivery_floor', '')), '');
    v_apartment := nullif(btrim(coalesce(payload->>'delivery_apartment', '')), '');
    v_city := nullif(btrim(coalesce(
      payload->>'delivery_city',
      payload->>'customer_neighborhood',
      ''
    )), '');
    v_province := nullif(btrim(coalesce(payload->>'delivery_province', '')), '');
    v_postal_code := nullif(btrim(coalesce(payload->>'delivery_postal_code', '')), '');
  end if;

  if char_length(coalesce(v_label, '')) > 60
    or char_length(coalesce(v_street, '')) > 120
    or char_length(coalesce(v_street_number, '')) > 24
    or char_length(coalesce(v_floor, '')) > 24
    or char_length(coalesce(v_apartment, '')) > 24
    or char_length(coalesce(v_city, '')) > 100
    or char_length(coalesce(v_province, '')) > 100
    or char_length(coalesce(v_postal_code, '')) > 20 then
    raise exception 'componentes de direccion demasiado largos' using errcode = '22023';
  end if;

  v_base_payload := (
    payload - array[
      'customer_address_label',
      'delivery_street',
      'delivery_street_number',
      'delivery_floor',
      'delivery_apartment',
      'delivery_city',
      'delivery_province',
      'delivery_postal_code'
    ]
  ) || jsonb_build_object(
    'customer_name', v_name,
    'customer_phone', v_phone
  );

  v_result := public.create_order_with_items_profile_v1(v_base_payload);
  v_order_id := nullif(v_result->>'id', '')::uuid;
  if v_order_id is null then
    raise exception 'el pedido no devolvio un identificador valido' using errcode = '22023';
  end if;

  -- This predicate is the idempotency boundary. A retried request returns the
  -- original immutable snapshot instead of replacing it with current profile
  -- or address values.
  update public.orders
     set delivery_address_label = case
           when delivery_mode = 'delivery' then coalesce(v_label, 'Entrega')
           else null
         end,
         delivery_street = case
           when delivery_mode = 'delivery' then coalesce(v_street, delivery_street)
           else delivery_street
         end,
         delivery_street_number = case
           when delivery_mode = 'delivery' then coalesce(v_street_number, delivery_street_number)
           else delivery_street_number
         end,
         delivery_floor = case
           when delivery_mode = 'delivery' then coalesce(v_floor, delivery_floor)
           else delivery_floor
         end,
         delivery_apartment = case
           when delivery_mode = 'delivery' then coalesce(v_apartment, delivery_apartment)
           else delivery_apartment
         end,
         delivery_city = case
           when delivery_mode = 'delivery' then coalesce(v_city, delivery_city)
           else delivery_city
         end,
         delivery_province = case
           when delivery_mode = 'delivery' then coalesce(v_province, delivery_province)
           else delivery_province
         end,
         delivery_postal_code = case
           when delivery_mode = 'delivery' then coalesce(v_postal_code, delivery_postal_code)
           else delivery_postal_code
         end,
         delivery_snapshot_created_at = clock_timestamp()
   where id = v_order_id
     and delivery_snapshot_created_at is null;

  select v_result || to_jsonb(o) into v_result
    from public.orders o
   where o.id = v_order_id;
  return v_result;
end;
$$;

revoke all on function public.create_order_with_items_profile_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.create_order_with_items(jsonb)
  from public, anon;
grant execute on function public.create_order_with_items(jsonb)
  to authenticated;

revoke all on function public.upsert_current_customer_profile(text, text)
  from public, anon;
grant execute on function public.upsert_current_customer_profile(text, text)
  to authenticated;

comment on column public.orders.delivery_address_label is
  'Immutable customer-facing label captured for this order, such as Casa or Trabajo.';
comment on column public.orders.delivery_snapshot_created_at is
  'Server timestamp at which the immutable delivery snapshot was accepted.';
comment on function public.create_order_with_items(jsonb) is
  'Authoritative order creation with normalized recipient data and an immutable, owned delivery snapshot.';
