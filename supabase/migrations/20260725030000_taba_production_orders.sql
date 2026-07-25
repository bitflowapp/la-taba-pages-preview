-- TABA production orders foundation
--
-- This migration intentionally does not seed products, prices, stock, delivery
-- fees, or commercial configuration. Existing rows are fail-closed until an
-- owner verifies the catalog and explicitly enables ordering.

create extension if not exists pgcrypto;

-- ===== Auth roles =====
--
-- The operational migration predates the admin role. Owners remain the only
-- members allowed to manage owner/admin memberships; admins receive operational
-- owner permissions and may manage staff/rider memberships.

alter table public.business_members
  drop constraint if exists business_members_role_check;

alter table public.business_members
  add constraint business_members_role_check
  check (role in ('owner', 'admin', 'staff', 'rider'));

-- ===== Master beverage catalog (no invented catalog data) =====

alter table public.products add column if not exists brand text;
alter table public.products add column if not exists subcategory text;
alter table public.products add column if not exists presentation text;
alter table public.products add column if not exists capacity text;
alter table public.products add column if not exists packaging_type text;
alter table public.products add column if not exists stock integer;
alter table public.products add column if not exists available boolean not null default false;
alter table public.products add column if not exists is_alcoholic boolean;
alter table public.products add column if not exists minimum_age integer;
alter table public.products add column if not exists tags text[] not null default '{}'::text[];
alter table public.products add column if not exists is_verified boolean not null default false;
alter table public.products add column if not exists verified_at timestamptz;
alter table public.products add column if not exists verified_by uuid references auth.users(id) on delete set null;

-- Existing records may contain demo or stale data. Preserve the values but do
-- not expose or sell them until a human verifies every required attribute.
update public.products
   set available = false,
       is_verified = false,
       verified_at = null,
       verified_by = null;

alter table public.products drop constraint if exists products_stock_nonnegative;
alter table public.products add constraint products_stock_nonnegative
check (stock is null or stock >= 0);

alter table public.products drop constraint if exists products_verified_master_data;
alter table public.products add constraint products_verified_master_data check (
  not is_verified
  or (
    btrim(name) <> ''
    and brand is not null and btrim(brand) <> ''
    and category is not null and btrim(category) <> ''
    and subcategory is not null and btrim(subcategory) <> ''
    and presentation is not null and btrim(presentation) <> ''
    and capacity is not null and btrim(capacity) <> ''
    and packaging_type is not null and btrim(packaging_type) <> ''
    and price > 0
    and stock is not null
    and is_alcoholic is not null
    and image_url is not null and btrim(image_url) <> ''
    and verified_at is not null
    and verified_by is not null
  )
);

alter table public.products drop constraint if exists products_available_requires_verification;
alter table public.products add constraint products_available_requires_verification check (
  not available
  or (
    is_verified
    and is_active
    and stock is not null
    and stock > 0
  )
);

-- ===== Business ordering configuration (fail-closed) =====

alter table public.businesses add column if not exists ordering_enabled boolean not null default false;
alter table public.businesses add column if not exists ordering_verified boolean not null default false;
alter table public.businesses add column if not exists ordering_verified_at timestamptz;
alter table public.businesses add column if not exists ordering_verified_by uuid references auth.users(id) on delete set null;
alter table public.businesses add column if not exists currency_code text;
alter table public.businesses add column if not exists delivery_enabled boolean not null default false;
alter table public.businesses add column if not exists pickup_enabled boolean not null default false;
alter table public.businesses add column if not exists delivery_fee numeric(12, 2);
alter table public.businesses add column if not exists minimum_delivery_subtotal numeric(12, 2);
alter table public.businesses add column if not exists alcohol_sales_enabled boolean not null default false;
alter table public.businesses add column if not exists alcohol_minimum_age integer;
alter table public.businesses add column if not exists alcohol_sales_start time;
alter table public.businesses add column if not exists alcohol_sales_end time;
alter table public.businesses add column if not exists alcohol_timezone text;

update public.businesses
   set ordering_enabled = false,
       ordering_verified = false,
       ordering_verified_at = null,
       ordering_verified_by = null;

alter table public.businesses drop constraint if exists businesses_delivery_fee_nonnegative;
alter table public.businesses add constraint businesses_delivery_fee_nonnegative
check (delivery_fee is null or delivery_fee >= 0);

alter table public.businesses drop constraint if exists businesses_minimum_delivery_nonnegative;
alter table public.businesses add constraint businesses_minimum_delivery_nonnegative
check (minimum_delivery_subtotal is null or minimum_delivery_subtotal >= 0);

alter table public.businesses drop constraint if exists businesses_ordering_verified_configuration;
alter table public.businesses add constraint businesses_ordering_verified_configuration check (
  not ordering_verified
  or (
    ordering_verified_at is not null
    and ordering_verified_by is not null
    and currency_code is not null
    and currency_code ~ '^[A-Z]{3}$'
    and (delivery_enabled or pickup_enabled)
    and (
      not delivery_enabled
      or (
        delivery_fee is not null
        and minimum_delivery_subtotal is not null
      )
    )
  )
);

alter table public.businesses drop constraint if exists businesses_ordering_enabled_requires_verification;
alter table public.businesses add constraint businesses_ordering_enabled_requires_verification check (
  not ordering_enabled
  or (
    ordering_verified
    and is_active
    and status = 'open'
  )
);

-- ===== Order ownership and idempotency =====

alter table public.orders add column if not exists customer_user_id uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists client_request_id text;
alter table public.orders add column if not exists client_request_fingerprint text;
alter table public.orders add column if not exists currency_code text;
alter table public.orders add column if not exists inventory_released_at timestamptz;
alter table public.orders add column if not exists age_confirmed_at timestamptz;
alter table public.orders add column if not exists age_confirmation_policy integer;

-- Orders that existed before this migration were not guaranteed to reserve
-- master-product stock through the authoritative RPC. Mark them as ineligible
-- for release so cancelling a legacy order cannot invent inventory. New orders
-- created below intentionally retain NULL until an actual release occurs.
update public.orders
   set inventory_released_at = now()
 where inventory_released_at is null;

-- Legacy rows receive a deterministic technical key; no commercial value is
-- invented and future production writes must provide their own key.
update public.orders
   set client_request_id = 'legacy-' || id::text
 where client_request_id is null or btrim(client_request_id) = '';

alter table public.orders alter column client_request_id set not null;

alter table public.orders drop constraint if exists orders_client_request_id_format;
alter table public.orders add constraint orders_client_request_id_format check (
  client_request_id ~ '^[A-Za-z0-9_-]{8,128}$'
);

create unique index if not exists orders_business_client_request_key
on public.orders(business_id, client_request_id);

create index if not exists orders_customer_created_idx
on public.orders(customer_user_id, created_at desc)
where customer_user_id is not null;

-- ===== Hashed public tracking tokens =====

alter table public.order_public_tokens add column if not exists token_hash bytea;
alter table public.order_public_tokens add column if not exists revoked_at timestamptz;

update public.order_public_tokens
   set token_hash = digest(token, 'sha256')
 where token_hash is null
   and token is not null;

update public.order_public_tokens
   set expires_at = created_at + interval '30 days'
 where expires_at is null;

alter table public.order_public_tokens alter column token drop not null;
alter table public.order_public_tokens alter column token_hash set not null;
alter table public.order_public_tokens alter column expires_at set not null;

alter table public.order_public_tokens drop constraint if exists order_public_tokens_hash_size;
alter table public.order_public_tokens add constraint order_public_tokens_hash_size
check (octet_length(token_hash) = 32);

create unique index if not exists order_public_tokens_token_hash_key
on public.order_public_tokens(token_hash);

-- Retain the legacy column only for migration compatibility; never retain raw
-- bearer secrets after their digest has been created.
update public.order_public_tokens
   set token = null
 where token is not null;

-- ===== Request/auth helpers =====

create or replace function public.request_order_token_hash()
returns bytea
language sql
stable
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select case
    when public.request_order_token() is null then null
    else digest(public.request_order_token(), 'sha256')
  end
$$;

create or replace function public.can_access_order(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select exists (
    select 1
      from public.orders o
     where o.id = target_order_id
       and (
         (auth.uid() is not null and o.customer_user_id = auth.uid())
         or public.has_business_role(o.business_id, array['owner', 'admin', 'staff'])
         or (
           public.has_business_role(o.business_id, array['rider'])
           and o.delivery_mode = 'delivery'
           and o.status in ('ready', 'assigned', 'picked_up', 'on_the_way', 'arrived')
           and (
             o.assigned_rider_user_id = auth.uid()
             or (
               o.assigned_rider_user_id is null
               and o.status in ('ready', 'assigned')
             )
           )
         )
         or exists (
           select 1
             from public.order_public_tokens opt
            where opt.order_id = o.id
              and opt.token_hash = public.request_order_token_hash()
              and opt.revoked_at is null
              and (opt.expires_at is null or opt.expires_at > now())
         )
       )
  )
$$;

-- Attribute status audit events to the authenticated actor. Service-side
-- changes without a user remain explicitly attributed to the system.
create or replace function public.log_order_status_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_actor_role text := 'system';
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if v_actor_user_id is not null
      and public.has_business_role(new.business_id, array['owner', 'admin', 'staff']) then
      v_actor_role := 'business';
    elsif v_actor_user_id is not null
      and public.has_business_role(new.business_id, array['rider']) then
      v_actor_role := 'rider';
    elsif v_actor_user_id is not null and new.customer_user_id = v_actor_user_id then
      v_actor_role := 'customer';
    end if;

    insert into public.order_events (
      order_id,
      business_id,
      actor_user_id,
      actor_role,
      actor_type,
      event_type,
      type,
      message,
      metadata,
      payload
    ) values (
      new.id,
      new.business_id,
      v_actor_user_id,
      v_actor_role,
      v_actor_role,
      'order.status_changed',
      'order.status_changed',
      'Estado actualizado de ' || old.status || ' a ' || new.status,
      jsonb_build_object(
        'previous_status', old.status,
        'next_status', new.status,
        'inventory_released',
          new.inventory_released_at is distinct from old.inventory_released_at
      ),
      jsonb_build_object(
        'previous_status', old.status,
        'next_status', new.status,
        'inventory_released',
          new.inventory_released_at is distinct from old.inventory_released_at
      )
    );
  end if;

  return new;
end;
$$;

-- ===== Transactional, authoritative, idempotent order creation =====
--
-- Compatibility: the public function name and jsonb signature are preserved.
-- Security: prices, totals, status, IDs, product names, and stock are never
-- accepted from the caller.

create or replace function public.create_order_with_items(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_business_id uuid;
  v_business public.businesses%rowtype;
  v_customer_user_id uuid := auth.uid();
  v_client_request_id text;
  v_request_fingerprint text;
  v_tracking_token text;
  v_tracking_token_hash bytea;
  v_items jsonb;
  v_delivery_mode text;
  v_customer_name text;
  v_customer_phone text;
  v_street_address text;
  v_neighborhood text;
  v_reference text;
  v_customer_notes text;
  v_payment_method text;
  v_age_confirmed boolean := false;
  v_contains_alcohol boolean := false;
  v_address_label text;
  v_order_id uuid := gen_random_uuid();
  v_public_code text;
  v_subtotal numeric(12, 2) := 0;
  v_delivery_fee numeric(12, 2) := 0;
  v_total numeric(12, 2) := 0;
  v_intent_items jsonb := '[]'::jsonb;
  v_locked_items jsonb := '[]'::jsonb;
  v_item record;
  v_product public.products%rowtype;
  v_line_subtotal numeric(12, 2);
  v_existing_order public.orders%rowtype;
  v_existing_token_hash bytea;
  v_result jsonb;
  v_unexpected_key text;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload invalido' using errcode = '22023';
  end if;
  if v_customer_user_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;

  select key
    into v_unexpected_key
    from jsonb_object_keys(payload) as keys(key)
   where key not in (
     'business_id',
     'client_request_id',
     'tracking_token',
     'items',
     'customer_name',
     'customer_phone',
     'delivery_mode',
     'fulfillment_type',
     'customer_street_address',
     'address_label',
     'customer_neighborhood',
     'customer_reference',
     'customer_notes',
     'notes',
     'payment_method'
     ,'age_confirmed'
   )
   limit 1;

  if v_unexpected_key is not null then
    raise exception 'campo no permitido en pedido: %', v_unexpected_key
      using errcode = '22023';
  end if;

  v_business_id := nullif(payload->>'business_id', '')::uuid;
  v_client_request_id := btrim(coalesce(payload->>'client_request_id', ''));
  v_tracking_token := btrim(coalesce(payload->>'tracking_token', ''));
  v_items := coalesce(payload->'items', '[]'::jsonb);
  v_delivery_mode := lower(coalesce(
    nullif(payload->>'delivery_mode', ''),
    nullif(payload->>'fulfillment_type', ''),
    'delivery'
  ));
  v_customer_name := nullif(btrim(coalesce(payload->>'customer_name', '')), '');
  v_customer_phone := nullif(btrim(coalesce(payload->>'customer_phone', '')), '');
  v_street_address := nullif(btrim(coalesce(
    payload->>'customer_street_address',
    payload->>'address_label',
    ''
  )), '');
  v_neighborhood := nullif(btrim(coalesce(payload->>'customer_neighborhood', '')), '');
  v_reference := nullif(btrim(coalesce(payload->>'customer_reference', '')), '');
  v_customer_notes := nullif(btrim(coalesce(
    payload->>'customer_notes',
    payload->>'notes',
    ''
  )), '');
  v_payment_method := nullif(btrim(coalesce(payload->>'payment_method', '')), '');
  v_age_confirmed := coalesce((payload->>'age_confirmed')::boolean, false);

  if v_business_id is null then
    raise exception 'business_id requerido' using errcode = '22023';
  end if;
  if v_client_request_id !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'client_request_id invalido' using errcode = '22023';
  end if;
  if v_tracking_token !~ '^[A-Za-z0-9_-]{32,256}$' then
    raise exception 'tracking_token invalido' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array'
    or jsonb_array_length(v_items) < 1
    or jsonb_array_length(v_items) > 100 then
    raise exception 'items debe contener entre 1 y 100 productos'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(v_items) as item(value)
     where jsonb_typeof(item.value) <> 'object'
        or not (item.value ? 'product_id')
        or not (item.value ? 'quantity')
        or (item.value->>'quantity') !~ '^[1-9][0-9]*$'
        or (item.value->>'quantity')::numeric > 1000
        or exists (
          select 1
            from jsonb_object_keys(item.value) as item_keys(key)
           where item_keys.key not in ('product_id', 'quantity')
        )
  ) then
    raise exception 'cada item acepta solo product_id UUID y quantity entero'
      using errcode = '22023';
  end if;

  if v_delivery_mode not in ('delivery', 'pickup') then
    raise exception 'delivery_mode invalido' using errcode = '22023';
  end if;
  if v_customer_name is null or char_length(v_customer_name) > 120 then
    raise exception 'customer_name requerido o demasiado largo'
      using errcode = '22023';
  end if;
  if v_customer_phone is null
    or char_length(v_customer_phone) < 6
    or char_length(v_customer_phone) > 40 then
    raise exception 'customer_phone invalido' using errcode = '22023';
  end if;
  if v_delivery_mode = 'delivery' and v_street_address is null then
    raise exception 'customer_street_address requerido para delivery'
      using errcode = '22023';
  end if;
  if coalesce(char_length(v_street_address), 0) > 180
    or coalesce(char_length(v_neighborhood), 0) > 100
    or coalesce(char_length(v_reference), 0) > 180
    or coalesce(char_length(v_customer_notes), 0) > 500
    or coalesce(char_length(v_payment_method), 0) > 40 then
    raise exception 'datos del cliente demasiado largos' using errcode = '22023';
  end if;

  v_tracking_token_hash := digest(v_tracking_token, 'sha256');

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'product_id', normalized.product_id,
               'quantity', normalized.quantity
             )
             order by normalized.product_id
           ),
           '[]'::jsonb
         )
    into v_intent_items
    from (
      select
        (item.value->>'product_id')::uuid as product_id,
        sum((item.value->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(v_items) as item(value)
      group by (item.value->>'product_id')::uuid
    ) as normalized;

  -- Fingerprint the normalized intent, not raw JSON or current product prices.
  -- Equivalent retries remain equivalent even if item order or accepted legacy
  -- aliases differ.
  v_request_fingerprint := encode(
    digest(
      jsonb_build_object(
        'business_id', v_business_id,
        'items', v_intent_items,
        'customer_name', v_customer_name,
        'customer_phone', v_customer_phone,
        'delivery_mode', v_delivery_mode,
        'customer_street_address', v_street_address,
        'customer_neighborhood', v_neighborhood,
        'customer_reference', v_reference,
        'customer_notes', v_customer_notes,
        'payment_method', v_payment_method
        ,'age_confirmed', v_age_confirmed
      )::text,
      'sha256'
    ),
    'hex'
  );

  -- Serializes retries for the same business/idempotency key. Hash collisions
  -- only reduce concurrency; they cannot merge orders because the unique key
  -- and exact lookup remain authoritative.
  perform pg_advisory_xact_lock(
    hashtext(v_business_id::text),
    hashtext(v_client_request_id)
  );

  select o.*
    into v_existing_order
    from public.orders o
   where o.business_id = v_business_id
     and o.client_request_id = v_client_request_id
   for update;

  if found then
    select opt.token_hash
      into v_existing_token_hash
      from public.order_public_tokens opt
     where opt.order_id = v_existing_order.id
       and opt.revoked_at is null
     order by opt.created_at desc
     limit 1;

    if v_existing_token_hash is distinct from v_tracking_token_hash
      or v_existing_order.customer_user_id is distinct from v_customer_user_id then
      raise exception 'client_request_id ya pertenece a otro pedido'
        using errcode = '23505';
    end if;

    if v_existing_order.client_request_fingerprint is not null
      and v_existing_order.client_request_fingerprint <> v_request_fingerprint then
      raise exception 'client_request_id reutilizado con un payload diferente'
        using errcode = '23505';
    end if;

    select to_jsonb(o)
           || jsonb_build_object(
                'order_items',
                coalesce(
                  (
                    select jsonb_agg(to_jsonb(oi) order by oi.created_at, oi.id)
                      from public.order_items oi
                     where oi.order_id = o.id
                  ),
                  '[]'::jsonb
                ),
                'rider_locations', '[]'::jsonb,
                'tracking_token', v_tracking_token
              )
      into v_result
      from public.orders o
     where o.id = v_existing_order.id;

    return v_result;
  end if;

  select b.*
    into v_business
    from public.businesses b
   where b.id = v_business_id
   for share;

  if not found then
    raise exception 'business_id inexistente' using errcode = '23503';
  end if;
  if not v_business.is_active
    or v_business.status <> 'open'
    or not v_business.ordering_verified
    or not v_business.ordering_enabled then
    raise exception 'el negocio no esta habilitado para recibir pedidos'
      using errcode = '55000';
  end if;
  if v_business.currency_code is null then
    raise exception 'moneda del negocio no verificada' using errcode = '55000';
  end if;
  if v_delivery_mode = 'delivery' and not v_business.delivery_enabled then
    raise exception 'delivery no habilitado' using errcode = '55000';
  end if;
  if v_delivery_mode = 'pickup' and not v_business.pickup_enabled then
    raise exception 'retiro no habilitado' using errcode = '55000';
  end if;

  -- Lock products in deterministic UUID order to avoid deadlocks. Duplicate
  -- product lines are aggregated before checking and decrementing stock.
  for v_item in
    select
      (item.value->>'product_id')::uuid as product_id,
      sum((item.value->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(v_items) as item(value)
    group by (item.value->>'product_id')::uuid
    order by (item.value->>'product_id')::uuid
  loop
    if v_item.quantity > 1000 then
      raise exception 'quantity total demasiado alta para producto: %', v_item.product_id
        using errcode = '22023';
    end if;

    select p.*
      into v_product
      from public.products p
     where p.id = v_item.product_id
       and p.business_id = v_business_id
     for update;

    if not found then
      raise exception 'producto inexistente para el negocio: %', v_item.product_id
        using errcode = '23503';
    end if;
    if not v_product.is_active
      or not v_product.is_verified
      or not v_product.available
      or v_product.stock is null then
      raise exception 'producto no disponible: %', v_item.product_id
        using errcode = '55000';
    end if;
    if v_product.price <= 0 then
      raise exception 'precio no verificado para producto: %', v_item.product_id
        using errcode = '55000';
    end if;
    if v_product.stock < v_item.quantity then
      raise exception 'stock insuficiente para producto: %', v_item.product_id
        using errcode = '23514';
    end if;
    if v_product.is_alcoholic is true then
      v_contains_alcohol := true;
      if v_product.minimum_age is null then
        raise exception 'producto alcoholico sin edad minima configurada'
          using errcode = '55000';
      end if;
    end if;

    v_line_subtotal := v_product.price * v_item.quantity;
    v_subtotal := v_subtotal + v_line_subtotal;
    v_locked_items := v_locked_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product.id,
        'name', v_product.name,
        'quantity', v_item.quantity,
        'unit', v_product.presentation,
        'unit_price', v_product.price,
        'subtotal', v_line_subtotal
      )
    );
  end loop;

  if v_contains_alcohol then
    if not v_business.alcohol_sales_enabled
      or v_business.alcohol_minimum_age is null
      or v_business.alcohol_sales_start is null
      or v_business.alcohol_sales_end is null
      or v_business.alcohol_timezone is null then
      raise exception 'politica de alcohol no configurada' using errcode = '55000';
    end if;
    if not v_age_confirmed then
      raise exception 'confirmacion de mayoria de edad requerida' using errcode = '22023';
    end if;
    if v_business.alcohol_sales_start <= v_business.alcohol_sales_end then
      if (clock_timestamp() at time zone v_business.alcohol_timezone)::time
         not between v_business.alcohol_sales_start and v_business.alcohol_sales_end then
        raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
      end if;
    elsif (
      (clock_timestamp() at time zone v_business.alcohol_timezone)::time
      between v_business.alcohol_sales_end and v_business.alcohol_sales_start
    ) then
      raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
    end if;
  end if;

  if v_delivery_mode = 'delivery' then
    v_delivery_fee := v_business.delivery_fee;
    if v_delivery_fee is null
      or v_business.minimum_delivery_subtotal is null then
      raise exception 'configuracion de delivery no verificada'
        using errcode = '55000';
    end if;
    if v_subtotal < v_business.minimum_delivery_subtotal then
      raise exception 'subtotal inferior al minimo de delivery'
        using errcode = '23514';
    end if;
  else
    v_delivery_fee := 0;
  end if;

  v_total := v_subtotal + v_delivery_fee;
  v_address_label := v_street_address;
  if v_address_label is not null and v_neighborhood is not null then
    v_address_label := v_address_label || ', ' || v_neighborhood;
  end if;

  loop
    v_public_code := public.next_order_public_code();
    exit when not exists (
      select 1
        from public.orders o
       where o.code = v_public_code
          or (
            o.business_id = v_business_id
            and o.public_code = v_public_code
          )
    );
  end loop;

  insert into public.orders (
    id,
    business_id,
    code,
    public_code,
    status,
    fulfillment_type,
    delivery_mode,
    customer_user_id,
    client_request_id,
    client_request_fingerprint,
    currency_code,
    customer_name,
    customer_phone,
    customer_whatsapp,
    address_label,
    customer_street_address,
    customer_neighborhood,
    customer_reference,
    notes,
    customer_notes,
    payment_method,
    age_confirmed_at,
    age_confirmation_policy,
    subtotal,
    delivery_fee,
    total
  ) values (
    v_order_id,
    v_business_id,
    v_public_code,
    v_public_code,
    'received',
    v_delivery_mode,
    v_delivery_mode,
    v_customer_user_id,
    v_client_request_id,
    v_request_fingerprint,
    v_business.currency_code,
    v_customer_name,
    v_customer_phone,
    v_customer_phone,
    v_address_label,
    v_street_address,
    v_neighborhood,
    v_reference,
    v_customer_notes,
    v_customer_notes,
    v_payment_method,
    case when v_contains_alcohol then clock_timestamp() else null end,
    case when v_contains_alcohol then v_business.alcohol_minimum_age else null end,
    v_subtotal,
    v_delivery_fee,
    v_total
  );

  for v_item in
    select *
      from jsonb_to_recordset(v_locked_items) as locked_item(
        product_id uuid,
        name text,
        quantity integer,
        unit text,
        unit_price numeric,
        subtotal numeric
      )
  loop
    insert into public.order_items (
      order_id,
      product_id,
      product_uuid,
      name,
      quantity,
      unit,
      unit_price,
      subtotal
    ) values (
      v_order_id,
      v_item.product_id::text,
      v_item.product_id,
      v_item.name,
      v_item.quantity,
      v_item.unit,
      v_item.unit_price,
      v_item.subtotal
    );

    update public.products
       set stock = stock - v_item.quantity,
           available = (stock - v_item.quantity) > 0
     where id = v_item.product_id;
  end loop;

  insert into public.order_events (
    order_id,
    business_id,
    actor_user_id,
    actor_role,
    actor_type,
    event_type,
    type,
    message,
    metadata,
    payload
  ) values (
    v_order_id,
    v_business_id,
    v_customer_user_id,
    'customer',
    'customer',
    'order.received',
    'order.received',
    'Pedido recibido',
    jsonb_build_object('source', 'production_checkout'),
    jsonb_build_object('source', 'production_checkout')
  );

  insert into public.order_public_tokens (
    order_id,
    token,
    token_hash,
    expires_at
  ) values (
    v_order_id,
    null,
    v_tracking_token_hash,
    now() + interval '30 days'
  );

  select to_jsonb(o)
         || jsonb_build_object(
              'order_items',
              coalesce(
                (
                  select jsonb_agg(to_jsonb(oi) order by oi.created_at, oi.id)
                    from public.order_items oi
                   where oi.order_id = o.id
                ),
                '[]'::jsonb
              ),
              'rider_locations', '[]'::jsonb,
              'tracking_token', v_tracking_token
            )
    into v_result
    from public.orders o
   where o.id = v_order_id;

  return v_result;
end;
$$;

comment on function public.create_order_with_items(jsonb) is
  'Production RPC: idempotent order creation from product UUID/quantity; prices, totals and stock are authoritative in PostgreSQL.';

-- ===== Concurrency-safe status transition RPC =====

create or replace function public.change_order_status(
  p_order_id uuid,
  p_expected_status text,
  p_new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_user_id uuid := auth.uid();
  v_current_status text;
  v_expected_status text;
  v_new_status text;
  v_is_business boolean := false;
  v_is_rider boolean := false;
  v_is_customer boolean := false;
  v_allowed boolean := false;
  v_claim_rider boolean := false;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;

  v_expected_status := case lower(btrim(coalesce(p_expected_status, '')))
    when 'received' then 'submitted'
    when 'canceled' then 'cancelled'
    when 'arriving' then 'arrived'
    else lower(btrim(coalesce(p_expected_status, '')))
  end;
  v_new_status := case lower(btrim(coalesce(p_new_status, '')))
    when 'canceled' then 'cancelled'
    when 'arriving' then 'arrived'
    else lower(btrim(coalesce(p_new_status, '')))
  end;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  v_current_status := case v_order.status
    when 'received' then 'submitted'
    when 'canceled' then 'cancelled'
    when 'arriving' then 'arrived'
    else v_order.status
  end;

  if v_expected_status = ''
    or v_new_status = ''
    or v_current_status <> v_expected_status then
    raise exception 'conflicto de estado: esperado %, actual %',
      v_expected_status,
      v_current_status
      using errcode = '40001';
  end if;

  if v_new_status not in (
    'accepted',
    'preparing',
    'ready',
    'assigned',
    'picked_up',
    'on_the_way',
    'arrived',
    'delivered',
    'cancelled',
    'rejected'
  ) then
    raise exception 'estado destino invalido' using errcode = '22023';
  end if;

  v_is_business := public.has_business_role(
    v_order.business_id,
    array['owner', 'admin', 'staff']
  );
  v_is_rider := public.has_business_role(
    v_order.business_id,
    array['rider']
  );
  v_is_customer := v_order.customer_user_id = v_user_id;

  if v_is_business then
    v_allowed :=
      (
        v_current_status in ('received', 'submitted')
        and v_new_status in ('accepted', 'rejected', 'cancelled')
      )
      or (
        v_current_status = 'accepted'
        and v_new_status in ('preparing', 'cancelled')
      )
      or (
        v_current_status = 'preparing'
        and v_new_status in ('ready', 'cancelled')
      )
      or (
        v_current_status = 'ready'
        and v_order.delivery_mode = 'pickup'
        and v_new_status = 'delivered'
      )
      or (
        v_current_status not in ('delivered', 'cancelled', 'rejected')
        and v_new_status = 'cancelled'
      );
  -- A rider may also be the customer who placed an order. Preserve the
  -- customer's right to cancel an initial order before evaluating rider-only
  -- transitions; later states still fall through to the rider rules.
  elsif v_is_customer
    and v_current_status in ('received', 'submitted')
    and v_new_status = 'cancelled' then
    v_allowed := true;
  elsif v_is_rider then
    if v_order.delivery_mode <> 'delivery' then
      raise exception 'los pedidos con retiro no admiten operacion de rider'
        using errcode = '42501';
    end if;

    if v_order.assigned_rider_user_id is not null
      and v_order.assigned_rider_user_id <> v_user_id then
      raise exception 'pedido asignado a otro rider' using errcode = '42501';
    end if;

    v_allowed :=
      (v_current_status = 'ready' and v_new_status in ('assigned', 'on_the_way'))
      or (v_current_status = 'assigned' and v_new_status in ('picked_up', 'on_the_way'))
      or (v_current_status = 'picked_up' and v_new_status = 'on_the_way')
      or (v_current_status = 'on_the_way' and v_new_status in ('arrived', 'delivered'))
      or (v_current_status = 'arrived' and v_new_status = 'delivered');

    v_claim_rider := v_allowed and v_order.assigned_rider_user_id is null;
  elsif v_is_customer then
    v_allowed := false;
  else
    raise exception 'sin permiso para cambiar este pedido' using errcode = '42501';
  end if;

  if not v_allowed then
    raise exception 'transicion no permitida: % -> %',
      v_current_status,
      v_new_status
      using errcode = '23514';
  end if;

  -- A pre-dispatch cancellation/rejection releases the reservation exactly
  -- once. Once picked up or dispatched, a status cancellation does not mean
  -- merchandise is physically back at the store, so stock remains unchanged
  -- until a separate, human-verified inventory adjustment. Availability remains
  -- fail-closed when stock is restored.
  if v_new_status in ('cancelled', 'rejected')
    and v_current_status not in ('picked_up', 'on_the_way', 'arrived')
    and v_order.inventory_released_at is null then
    perform p.id
      from public.products p
     where p.id in (
       select distinct oi.product_uuid
         from public.order_items oi
        where oi.order_id = v_order.id
          and oi.product_uuid is not null
     )
     order by p.id
     for update;

    update public.products p
       set stock = coalesce(p.stock, 0) + released.quantity
      from (
        select
          oi.product_uuid,
          sum(oi.quantity)::integer as quantity
        from public.order_items oi
        where oi.order_id = v_order.id
          and oi.product_uuid is not null
        group by oi.product_uuid
      ) as released
     where p.id = released.product_uuid;
  end if;

  update public.orders
     set status = v_new_status,
         assigned_rider_user_id = case
           when v_claim_rider then v_user_id
           else assigned_rider_user_id
         end,
          inventory_released_at = case
            when v_new_status in ('cancelled', 'rejected')
              and v_current_status not in ('picked_up', 'on_the_way', 'arrived')
              then coalesce(inventory_released_at, now())
            else inventory_released_at
         end
   where id = v_order.id;

  select to_jsonb(o)
         || jsonb_build_object(
              'order_items',
              coalesce(
                (
                  select jsonb_agg(to_jsonb(oi) order by oi.created_at, oi.id)
                    from public.order_items oi
                   where oi.order_id = o.id
                ),
                '[]'::jsonb
              ),
              'rider_locations',
              coalesce(
                (
                  select jsonb_agg(to_jsonb(rl) order by rl.created_at desc, rl.id)
                    from public.rider_locations rl
                   where rl.order_id = o.id
                     and rl.source = 'gps'
                ),
                '[]'::jsonb
              )
            )
    into v_result
    from public.orders o
   where o.id = v_order.id;

  return v_result;
end;
$$;

comment on function public.change_order_status(uuid, text, text) is
  'Authenticated, role-aware order transition with expected-status concurrency control.';

-- Product availability must reach open customer catalogs without polling. Full
-- replica identity lets filtered subscribers also observe removals safely.
alter table public.products replica identity full;
alter table public.businesses replica identity full;

-- Keep one table per exception block. PostgreSQL rolls back every statement in
-- a PL/pgSQL exception subtransaction when any statement fails, so grouping
-- publication additions could silently undo a preceding successful addition.
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice 'publication supabase_realtime no existe en este entorno';
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.order_events;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice 'publication supabase_realtime no existe en este entorno';
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.rider_locations;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice 'publication supabase_realtime no existe en este entorno';
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.products;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice 'publication supabase_realtime no existe en este entorno';
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.businesses;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice 'publication supabase_realtime no existe en este entorno';
end;
$$;

-- ===== RLS: remove pilot bypasses and expose only production-safe paths =====

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.rider_locations enable row level security;
alter table public.order_public_tokens enable row level security;

drop policy if exists "phase1 public read businesses" on public.businesses;
drop policy if exists "operational active businesses are public" on public.businesses;
drop policy if exists "production active businesses are public" on public.businesses;
create policy "production active businesses are public"
on public.businesses for select
to anon, authenticated
using (is_active = true);

drop policy if exists "operational members read own rows" on public.business_members;
drop policy if exists "operational owners manage members" on public.business_members;
drop policy if exists "production members read permitted rows" on public.business_members;
drop policy if exists "production owners manage members" on public.business_members;
drop policy if exists "production admins add staff and riders" on public.business_members;
drop policy if exists "production admins update staff and riders" on public.business_members;
drop policy if exists "production admins remove staff and riders" on public.business_members;

create policy "production members read permitted rows"
on public.business_members for select
to authenticated
using (
  user_id = auth.uid()
  or public.has_business_role(business_id, array['owner', 'admin'])
);

create policy "production owners manage members"
on public.business_members for all
to authenticated
using (public.has_business_role(business_id, array['owner']))
with check (public.has_business_role(business_id, array['owner']));

create policy "production admins add staff and riders"
on public.business_members for insert
to authenticated
with check (
  public.has_business_role(business_id, array['admin'])
  and role in ('staff', 'rider')
);

create policy "production admins update staff and riders"
on public.business_members for update
to authenticated
using (
  public.has_business_role(business_id, array['admin'])
  and role in ('staff', 'rider')
)
with check (
  public.has_business_role(business_id, array['admin'])
  and role in ('staff', 'rider')
);

create policy "production admins remove staff and riders"
on public.business_members for delete
to authenticated
using (
  public.has_business_role(business_id, array['admin'])
  and role in ('staff', 'rider')
);

drop policy if exists "production owners update business ordering" on public.businesses;
create policy "production owners update business ordering"
on public.businesses for update
to authenticated
using (public.has_business_role(id, array['owner', 'admin']))
with check (public.has_business_role(id, array['owner', 'admin']));

drop policy if exists "operational active products are public" on public.products;
drop policy if exists "operational staff manage products" on public.products;
drop policy if exists "production verified products are public" on public.products;
create policy "production verified products are public"
on public.products for select
to anon, authenticated
using (
  is_active
  and is_verified
  and available
  and stock is not null
  and stock > 0
  and exists (
    select 1
      from public.businesses b
     where b.id = business_id
       and b.is_active
       and b.status = 'open'
       and b.ordering_verified
       and b.ordering_enabled
  )
);

drop policy if exists "production team manages products" on public.products;
drop policy if exists "production team reads products" on public.products;
drop policy if exists "production team adds products" on public.products;
drop policy if exists "production team updates products" on public.products;

create policy "production team reads products"
on public.products for select
to authenticated
using (public.has_business_role(business_id, array['owner', 'admin', 'staff']));

create policy "production team adds products"
on public.products for insert
to authenticated
with check (public.has_business_role(business_id, array['owner', 'admin', 'staff']));

create policy "production team updates products"
on public.products for update
to authenticated
using (public.has_business_role(business_id, array['owner', 'admin', 'staff']))
with check (public.has_business_role(business_id, array['owner', 'admin', 'staff']));

drop policy if exists "phase1 public read orders" on public.orders;
drop policy if exists "phase1 public create orders" on public.orders;
drop policy if exists "phase1 public update orders" on public.orders;
drop policy if exists "operational orders readable by token or team" on public.orders;
drop policy if exists "operational team updates orders" on public.orders;
drop policy if exists "production orders readable by owner" on public.orders;
create policy "production orders readable by owner"
on public.orders for select
to anon, authenticated
using (public.can_access_order(id));

drop policy if exists "phase1 public read order items" on public.order_items;
drop policy if exists "phase1 public create order items" on public.order_items;
drop policy if exists "operational order items readable with order" on public.order_items;
drop policy if exists "production order items readable with order" on public.order_items;
create policy "production order items readable with order"
on public.order_items for select
to anon, authenticated
using (public.can_access_order(order_id));

drop policy if exists "phase1 public read order events" on public.order_events;
drop policy if exists "phase1 public create order events" on public.order_events;
drop policy if exists "operational order events readable with order" on public.order_events;
drop policy if exists "operational team writes order events" on public.order_events;
drop policy if exists "production order events readable with order" on public.order_events;
create policy "production order events readable with order"
on public.order_events for select
to anon, authenticated
using (public.can_access_order(order_id));

drop policy if exists "phase1 public read rider locations" on public.rider_locations;
drop policy if exists "phase1 public create rider locations" on public.rider_locations;
drop policy if exists "operational rider locations readable with order" on public.rider_locations;
drop policy if exists "operational assigned rider writes gps" on public.rider_locations;
drop policy if exists "production rider locations readable with order" on public.rider_locations;
create policy "production rider locations readable with order"
on public.rider_locations for select
to anon, authenticated
using (source = 'gps' and public.can_access_order(order_id));

drop policy if exists "production assigned rider writes gps" on public.rider_locations;

-- `created_at` is part of the security boundary: a browser-controlled future
-- timestamp could otherwise keep a forged location looking fresh indefinitely.
create or replace function public.stamp_rider_location_server_time()
returns trigger
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
begin
  new.created_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists rider_locations_server_time on public.rider_locations;
create trigger rider_locations_server_time
before insert on public.rider_locations
for each row execute function public.stamp_rider_location_server_time();

create policy "production assigned rider writes gps"
on public.rider_locations for insert
to authenticated
with check (
  source = 'gps'
  and rider_user_id = auth.uid()
  and public.has_business_role(business_id, array['rider'])
  and exists (
    select 1
      from public.orders o
     where o.id = order_id
       and o.business_id = business_id
       and o.delivery_mode = 'delivery'
       and o.assigned_rider_user_id = auth.uid()
       and o.status in ('assigned', 'picked_up', 'on_the_way', 'arrived')
  )
);

-- Token rows are implementation details. Neither the raw token nor its digest
-- is directly selectable through PostgREST; access is evaluated by the
-- SECURITY DEFINER can_access_order helper.
drop policy if exists "operational token reads itself" on public.order_public_tokens;
drop policy if exists "operational team reads order tokens" on public.order_public_tokens;

drop policy if exists "phase1 public read riders" on public.riders;
drop policy if exists "phase1 public update riders" on public.riders;

-- ===== Explicit table privileges =====

revoke all privileges on table public.businesses from public, anon, authenticated;
revoke all privileges on table public.business_members from public, anon, authenticated;
revoke all privileges on table public.products from public, anon, authenticated;
revoke all privileges on table public.orders from public, anon, authenticated;
revoke all privileges on table public.order_items from public, anon, authenticated;
revoke all privileges on table public.order_events from public, anon, authenticated;
revoke all privileges on table public.riders from public, anon, authenticated;
revoke all privileges on table public.rider_locations from public, anon, authenticated;
revoke all privileges on table public.order_public_tokens from public, anon, authenticated;

grant select on table public.businesses to anon, authenticated;
grant update on table public.businesses to authenticated;
grant select, insert, update, delete on table public.business_members to authenticated;
grant select on table public.products to anon, authenticated;
-- Products are soft-disabled through is_active/available. Physical deletion
-- could null order_items.product_uuid and make a later stock release incomplete.
grant insert, update on table public.products to authenticated;
grant select on table public.orders to anon, authenticated;
grant select on table public.order_items to anon, authenticated;
grant select on table public.order_events to anon, authenticated;
grant select on table public.riders to authenticated;
grant select on table public.rider_locations to anon, authenticated;
grant insert on table public.rider_locations to authenticated;

revoke all privileges on sequence public.order_public_code_seq from public, anon, authenticated;

-- ===== Explicit function privileges =====

revoke execute on function public.create_order_with_items(jsonb) from public, anon, authenticated;
grant execute on function public.create_order_with_items(jsonb) to authenticated;

revoke execute on function public.change_order_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.change_order_status(uuid, text, text) to authenticated;

revoke execute on function public.request_order_token() from public, anon, authenticated;
revoke execute on function public.request_order_token_hash() from public, anon, authenticated;

revoke execute on function public.stamp_rider_location_server_time() from public, anon, authenticated;

revoke execute on function public.is_business_member(uuid) from public, anon, authenticated;
grant execute on function public.is_business_member(uuid) to authenticated;

revoke execute on function public.has_business_role(uuid, text[]) from public, anon, authenticated;
grant execute on function public.has_business_role(uuid, text[]) to authenticated;

revoke execute on function public.is_assigned_rider(uuid) from public, anon, authenticated;
grant execute on function public.is_assigned_rider(uuid) to authenticated;

revoke execute on function public.can_access_order(uuid) from public, anon, authenticated;
grant execute on function public.can_access_order(uuid) to anon, authenticated;

revoke execute on function public.next_order_public_code() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.set_order_operational_defaults() from public, anon, authenticated;
revoke execute on function public.set_order_status_timestamps() from public, anon, authenticated;
revoke execute on function public.log_order_status_event() from public, anon, authenticated;

comment on table public.products is
  'Master beverage catalog. Rows remain unavailable until commercial data and product identity are verified.';
comment on table public.business_members is
  'Auth memberships: owner controls membership; admin operates the business and may manage only staff/rider; staff and rider have scoped operational access.';
comment on column public.products.available is
  'Operational availability; can only be true for a verified, active product with positive stock.';
comment on column public.products.is_verified is
  'Human verification gate for brand, category, presentation, capacity, packaging, price, stock, alcohol flag and image.';
comment on column public.orders.client_request_id is
  'Caller-generated idempotency key, unique inside a business.';
comment on column public.order_public_tokens.token_hash is
  'SHA-256 digest of the caller-generated tracking bearer token; plaintext is never persisted.';
