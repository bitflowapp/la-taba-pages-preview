-- TABA2 · El precio de un combo lo decide el backend.
--
-- Cierra el bloqueante #1 del storefront comercial: los siete combos existian
-- como propuesta, con su ahorro derivado del catalogo vivo, pero **nadie
-- aplicaba el descuento al total**. La ficha no ofrecia "Agregar combo" porque
-- hacerlo habria cobrado la suma de los precios de lista y el ahorro anunciado
-- habria sido mentira.
--
-- A partir de aca:
--   * el navegador manda `{combo_id, quantity}`, nunca un precio;
--   * el backend valida componentes y cantidades contra su propia definicion;
--   * el precio de lista sale de los precios BLOQUEADOS en la misma transaccion;
--   * el descuento sale de la definicion aprobada, no del pedido;
--   * el total final lo decide el backend y es el que espera el payment_intent;
--   * el stock disponible es el del componente limitante, porque las cantidades
--     se consolidan por producto antes de reservar;
--   * la reserva de todos los componentes es atomica: una sola transaccion, y
--     si falta uno se revierte el checkout entero;
--   * el +18 se propaga desde cualquier componente alcoholico;
--   * el pedido conserva el snapshot del combo y de sus componentes;
--   * repetir el mismo carrito devuelve la misma sesion (hash de intencion).

-- ===== El pedido necesita poder registrar un descuento =====
--
-- Hasta hoy `orders` no tenia donde anotar un descuento y la unica invariante de
-- dinero era `total >= subtotal`. Con un combo eso deja de ser cierto: el total
-- puede quedar por debajo del subtotal de lista, que es exactamente el ahorro.
-- La invariante se vuelve explicita en vez de desaparecer.

alter table public.orders
  add column if not exists discount_total numeric(12, 2) not null default 0;

alter table public.orders drop constraint if exists orders_discount_total_check;
alter table public.orders
  add constraint orders_discount_total_check
  check (discount_total >= 0 and discount_total <= subtotal);

alter table public.orders drop constraint if exists orders_total_not_below_subtotal;
alter table public.orders
  add constraint orders_total_not_below_subtotal
  check (total >= subtotal - discount_total);

comment on column public.orders.discount_total is
  'Descuento decidido por el backend (hoy: combos). El total nunca lo dicta el navegador.';

-- ===== Snapshots =====
--
-- El combo se congela dos veces: al reservar (sesion) y al cobrar (pedido). El
-- snapshot guarda el precio de lista, el promocional y la composicion exacta con
-- los precios del momento, para que el Panel pueda explicar seis meses despues
-- por que ese pedido cobro lo que cobro.

create table if not exists public.checkout_session_combos (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete cascade,
  combo_uuid uuid not null references public.product_combos(id) on delete restrict,
  combo_id text not null,
  name text not null,
  quantity integer not null,
  discount_percentage numeric(5, 2) not null,
  list_price numeric(12, 2) not null,
  promotional_price numeric(12, 2) not null,
  discount_amount numeric(12, 2) not null,
  combo_snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint checkout_session_combos_quantity_check check (quantity between 1 and 100),
  constraint checkout_session_combos_price_check check (
    list_price > 0
    and promotional_price > 0
    and promotional_price <= list_price
    and discount_amount = (list_price - promotional_price) * quantity
  ),
  unique (checkout_session_id, combo_id)
);

create index if not exists checkout_session_combos_session_idx
  on public.checkout_session_combos (checkout_session_id, combo_id);

create table if not exists public.order_combos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  combo_uuid uuid references public.product_combos(id) on delete set null,
  combo_id text not null,
  name text not null,
  quantity integer not null,
  discount_percentage numeric(5, 2) not null,
  list_price numeric(12, 2) not null,
  promotional_price numeric(12, 2) not null,
  discount_amount numeric(12, 2) not null,
  combo_snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint order_combos_quantity_check check (quantity between 1 and 100),
  constraint order_combos_price_check check (
    list_price > 0
    and promotional_price > 0
    and promotional_price <= list_price
    and discount_amount = (list_price - promotional_price) * quantity
  ),
  unique (order_id, combo_id)
);

create index if not exists order_combos_order_idx
  on public.order_combos (order_id, combo_id);

alter table public.checkout_session_combos enable row level security;
alter table public.order_combos enable row level security;

revoke all privileges on table public.checkout_session_combos from public, anon, authenticated;
revoke all privileges on table public.order_combos from public, anon, authenticated;

grant select on table public.checkout_session_combos to authenticated;
grant select on table public.order_combos to authenticated;

drop policy if exists "session combos follow checkout session access" on public.checkout_session_combos;
create policy "session combos follow checkout session access"
on public.checkout_session_combos for select
to authenticated
using (
  exists (
    select 1
      from public.checkout_sessions s
     where s.id = checkout_session_id
       and (
         s.customer_id = auth.uid()
         or public.has_business_role(s.business_id, array['owner', 'admin'])
       )
  )
);

drop policy if exists "order combos follow order access" on public.order_combos;
create policy "order combos follow order access"
on public.order_combos for select
to authenticated
using (
  exists (
    select 1
      from public.orders o
     where o.id = order_id
       and (
         o.customer_user_id = auth.uid()
         or public.has_business_role(o.business_id, array['owner', 'admin', 'staff'])
       )
  )
);

-- ===== Checkout Pro con combos =====

create or replace function public.create_checkout_session(
  p_customer_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_business_id uuid;
  v_business public.businesses%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_client_request_id text;
  v_items jsonb;
  v_contact jsonb;
  v_address jsonb;
  v_fulfillment_type text;
  v_age_confirmed boolean := false;
  v_name text;
  v_phone text;
  v_address_id uuid;
  v_saved_address public.customer_addresses%rowtype;
  v_street text;
  v_street_number text;
  v_floor text;
  v_apartment text;
  v_reference text;
  v_city text;
  v_province text;
  v_postal_code text;
  v_address_label text;
  v_address_source text;
  v_address_snapshot jsonb;
  v_contact_snapshot jsonb;
  v_normalized_items jsonb := '[]'::jsonb;
  v_request_hash text;
  v_session public.checkout_sessions%rowtype;
  v_existing public.checkout_sessions%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_subtotal numeric(12, 2) := 0;
  v_delivery_fee numeric(12, 2) := 0;
  v_total numeric(12, 2) := 0;
  v_contains_alcohol boolean := false;
  v_expires_at timestamptz;
  v_payment_intent_id uuid;
  v_unexpected_key text;
  v_rate_count integer;
  v_normalized_products jsonb := '[]'::jsonb;
  v_normalized_combos jsonb := '[]'::jsonb;
  v_combo record;
  v_combo_row public.product_combos%rowtype;
  v_combo_components jsonb;
  v_combo_component_count integer;
  v_combo_declared_count integer;
  v_combo_list_price numeric(12, 2);
  v_combo_promotional numeric(12, 2);
  v_discount_total numeric(12, 2) := 0;
begin
  if p_customer_id is null then
    raise exception 'cliente autenticado requerido' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload de checkout invalido' using errcode = '22023';
  end if;

  select key into v_unexpected_key
    from jsonb_object_keys(p_payload) as keys(key)
   where key not in (
     'business_id', 'client_request_id', 'items', 'fulfillment_type',
     'contact', 'address', 'age_confirmed', 'payment_method'
   )
   limit 1;
  if v_unexpected_key is not null then
    raise exception 'campo no permitido en checkout: %', v_unexpected_key using errcode = '22023';
  end if;

  if coalesce(p_payload ->> 'business_id', '') !~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'business_id invalido' using errcode = '22023';
  end if;
  v_business_id := (p_payload ->> 'business_id')::uuid;
  v_client_request_id := btrim(coalesce(p_payload ->> 'client_request_id', ''));
  v_items := coalesce(p_payload -> 'items', '[]'::jsonb);
  v_contact := p_payload -> 'contact';
  v_address := coalesce(p_payload -> 'address', '{}'::jsonb);
  v_fulfillment_type := lower(btrim(coalesce(p_payload ->> 'fulfillment_type', '')));
  v_age_confirmed := coalesce((p_payload ->> 'age_confirmed')::boolean, false);

  if v_client_request_id !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'client_request_id invalido' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(p_payload ->> 'payment_method', ''))) <> 'mercadopago' then
    raise exception 'medio de pago invalido para Checkout Pro' using errcode = '22023';
  end if;
  if v_fulfillment_type not in ('delivery', 'pickup') then
    raise exception 'modalidad de entrega invalida' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array'
    or jsonb_array_length(v_items) < 1
    or jsonb_array_length(v_items) > 100 then
    raise exception 'items debe contener entre 1 y 100 productos' using errcode = '22023';
  end if;
  if jsonb_typeof(v_contact) <> 'object' then
    raise exception 'contacto requerido' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_contact) as keys(key)
     where key not in ('name', 'phone')
  ) then
    raise exception 'campo de contacto no permitido' using errcode = '22023';
  end if;
  if jsonb_typeof(v_address) <> 'object' then
    raise exception 'direccion invalida' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_address) as keys(key)
     where key not in (
       'customer_address_id', 'label', 'street', 'street_number', 'floor',
       'apartment', 'reference', 'city', 'province', 'postal_code',
       'latitude', 'longitude', 'source'
     )
  ) then
    raise exception 'campo de direccion no permitido' using errcode = '22023';
  end if;
  -- Una linea es de producto o de combo, nunca las dos. Un combo viaja por su
  -- identificador estable y NUNCA con un precio: el precio lo decide el backend.
  if exists (
    select 1
      from jsonb_array_elements(v_items) as item(value)
     where jsonb_typeof(item.value) <> 'object'
        or not (item.value ? 'quantity')
        or (item.value ->> 'quantity') !~ '^[1-9][0-9]*$'
        or (item.value ? 'product_id') = (item.value ? 'combo_id')
        or (
          (item.value ? 'product_id')
          and (
            (item.value ->> 'product_id') !~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            or (item.value ->> 'quantity')::numeric > 1000
            or exists (
              select 1 from jsonb_object_keys(item.value) as item_keys(key)
               where item_keys.key not in ('product_id', 'quantity')
            )
          )
        )
        or (
          (item.value ? 'combo_id')
          and (
            (item.value ->> 'combo_id') !~ '^[a-z0-9][a-z0-9-]{2,63}$'
            or (item.value ->> 'quantity')::numeric > 100
            or exists (
              select 1 from jsonb_object_keys(item.value) as item_keys(key)
               where item_keys.key not in ('combo_id', 'quantity')
            )
          )
        )
  ) then
    raise exception 'cada item acepta product_id UUID o combo_id, con quantity entero' using errcode = '22023';
  end if;

  v_name := nullif(regexp_replace(btrim(coalesce(v_contact ->> 'name', '')), '[[:space:]]+', ' ', 'g'), '');
  v_phone := regexp_replace(coalesce(v_contact ->> 'phone', ''), '[^0-9]', '', 'g');
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 or v_name !~ '[[:alpha:]]' then
    raise exception 'nombre de contacto invalido' using errcode = '22023';
  end if;
  if v_phone !~ '^[0-9]{10,13}$' or v_phone ~ '^([0-9])\1+$' then
    raise exception 'telefono de contacto invalido' using errcode = '22023';
  end if;

  if nullif(v_address ->> 'customer_address_id', '') is not null then
    if (v_address ->> 'customer_address_id') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'identificador de direccion invalido' using errcode = '22023';
    end if;
    v_address_id := (v_address ->> 'customer_address_id')::uuid;
    select * into v_saved_address
      from public.customer_addresses a
     where a.id = v_address_id
       and a.customer_id = p_customer_id
       and a.deleted_at is null;
    if not found then
      raise exception 'direccion guardada no encontrada' using errcode = '42501';
    end if;
    v_address_label := v_saved_address.label;
    v_street := v_saved_address.street;
    v_street_number := v_saved_address.street_number;
    v_floor := v_saved_address.floor;
    v_apartment := v_saved_address.apartment;
    v_reference := v_saved_address.reference;
    v_city := v_saved_address.city;
    v_province := v_saved_address.province;
    v_postal_code := v_saved_address.postal_code;
    v_address_source := v_saved_address.source;
  else
    v_address_label := nullif(btrim(coalesce(v_address ->> 'label', '')), '');
    v_street := nullif(btrim(coalesce(v_address ->> 'street', '')), '');
    v_street_number := nullif(btrim(coalesce(v_address ->> 'street_number', '')), '');
    v_floor := nullif(btrim(coalesce(v_address ->> 'floor', '')), '');
    v_apartment := nullif(btrim(coalesce(v_address ->> 'apartment', '')), '');
    v_reference := nullif(btrim(coalesce(v_address ->> 'reference', '')), '');
    v_city := nullif(btrim(coalesce(v_address ->> 'city', '')), '');
    v_province := nullif(btrim(coalesce(v_address ->> 'province', '')), '');
    v_postal_code := nullif(btrim(coalesce(v_address ->> 'postal_code', '')), '');
    v_address_source := nullif(btrim(coalesce(v_address ->> 'source', 'manual')), '');
  end if;

  if v_fulfillment_type = 'delivery'
    and (v_street is null or v_street_number is null or v_city is null) then
    raise exception 'direccion de delivery incompleta' using errcode = '22023';
  end if;
  if char_length(coalesce(v_address_label, '')) > 60
    or char_length(coalesce(v_street, '')) > 120
    or char_length(coalesce(v_street_number, '')) > 24
    or char_length(coalesce(v_floor, '')) > 24
    or char_length(coalesce(v_apartment, '')) > 24
    or char_length(coalesce(v_reference, '')) > 180
    or char_length(coalesce(v_city, '')) > 100
    or char_length(coalesce(v_province, '')) > 100
    or char_length(coalesce(v_postal_code, '')) > 20
    or v_address_source not in ('manual', 'gps', 'geocoder', 'previous_order') then
    raise exception 'direccion invalida' using errcode = '22023';
  end if;

  v_contact_snapshot := jsonb_build_object('name', v_name, 'phone', v_phone);
  v_address_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'address_id', v_address_id,
    'label', v_address_label,
    'street', v_street,
    'street_number', v_street_number,
    'floor', v_floor,
    'apartment', v_apartment,
    'reference', v_reference,
    'city', v_city,
    'province', v_province,
    'postal_code', v_postal_code,
    'source', v_address_source
  ));

  select coalesce(jsonb_agg(
    jsonb_build_object('product_id', normalized.product_id, 'quantity', normalized.quantity)
    order by normalized.product_id
  ), '[]'::jsonb)
    into v_normalized_products
    from (
      select (item.value ->> 'product_id')::uuid as product_id,
             sum((item.value ->> 'quantity')::integer)::integer as quantity
        from jsonb_array_elements(v_items) as item(value)
       where item.value ? 'product_id'
       group by (item.value ->> 'product_id')::uuid
    ) as normalized;

  select coalesce(jsonb_agg(
    jsonb_build_object('combo_id', normalized.combo_id, 'quantity', normalized.quantity)
    order by normalized.combo_id
  ), '[]'::jsonb)
    into v_normalized_combos
    from (
      select (item.value ->> 'combo_id') as combo_id,
             sum((item.value ->> 'quantity')::integer)::integer as quantity
        from jsonb_array_elements(v_items) as item(value)
       where item.value ? 'combo_id'
       group by (item.value ->> 'combo_id')
    ) as normalized;

  if exists (
    select 1 from jsonb_to_recordset(v_normalized_combos) as normalized(combo_id text, quantity integer)
     where quantity > 100
  ) then
    raise exception 'quantity total demasiado alta para combo' using errcode = '22023';
  end if;

  -- El hash de intencion incluye los combos: reintentar el mismo carrito
  -- devuelve la misma sesion, y reusar el client_request_id con otros combos se
  -- rechaza igual que si hubieran cambiado los productos.
  v_request_hash := encode(digest(jsonb_build_object(
    'business_id', v_business_id,
    'items', v_normalized_products,
    'combos', v_normalized_combos,
    'fulfillment_type', v_fulfillment_type,
    'contact', v_contact_snapshot,
    'address', v_address_snapshot,
    'age_confirmed', v_age_confirmed
  )::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtext(v_business_id::text), hashtext(v_client_request_id));
  select * into v_existing
    from public.checkout_sessions s
   where s.business_id = v_business_id
     and s.customer_id = p_customer_id
     and s.client_request_id = v_client_request_id
   for update;
  if found then
    if v_existing.normalized_intent_hash <> v_request_hash then
      raise exception 'client_request_id reutilizado con un checkout diferente' using errcode = '23505';
    end if;
    return public.checkout_session_customer_payload(v_existing.id, p_customer_id);
  end if;

  select b.* into v_business
    from public.businesses b
   where b.id = v_business_id
   for share;
  if not found
    or not v_business.is_active
    or v_business.status <> 'open'
    or not v_business.ordering_enabled
    or not v_business.ordering_verified
    or upper(coalesce(v_business.currency_code, '')) <> 'ARS' then
    raise exception 'negocio no habilitado para pagos online' using errcode = '55000';
  end if;
  if (v_fulfillment_type = 'delivery' and not v_business.delivery_enabled)
    or (v_fulfillment_type = 'pickup' and not v_business.pickup_enabled) then
    raise exception 'modalidad de entrega no habilitada' using errcode = '55000';
  end if;

  select s.* into v_settings
    from public.business_payment_settings s
   where s.business_id = v_business_id
     and s.provider = 'mercadopago'
   for share;
  if not found
    or not v_settings.enabled
    or not v_settings.reserve_stock
    or v_settings.checkout_mode <> 'checkout_pro'
    or v_settings.currency <> 'ARS'
    or nullif(btrim(v_settings.collector_id), '') is null
    or nullif(btrim(v_settings.application_id), '') is null
    or (v_settings.environment = 'production' and v_settings.production_review_status <> 'approved') then
    raise exception 'Mercado Pago no esta configurado para este negocio' using errcode = '55000';
  end if;

  if v_business.order_rate_limit_per_10_minutes is not null then
    select count(*) into v_rate_count
      from public.checkout_sessions s
     where s.business_id = v_business_id
       and s.customer_id = p_customer_id
       and s.created_at >= clock_timestamp() - interval '10 minutes';
    if v_rate_count >= v_business.order_rate_limit_per_10_minutes then
      raise exception 'demasiados intentos de checkout; reintenta mas tarde' using errcode = '54000';
    end if;
  end if;

  -- Los combos se expanden a componentes DESPUES de verificar que el negocio
  -- esta habilitado y ANTES de tomar los locks de producto, para que el bucle de
  -- reserva vea una sola cantidad consolidada por producto y no pueda sobrevender
  -- entre una linea suelta y la misma lata dentro de un combo.
  for v_combo in
    select * from jsonb_to_recordset(v_normalized_combos) as c(combo_id text, quantity integer)
     order by combo_id
  loop
    select * into v_combo_row
      from public.product_combos c
     where c.business_id = v_business_id
       and c.combo_id = v_combo.combo_id
     for share;
    if not found or not v_combo_row.is_active then
      raise exception 'combo no disponible: %', v_combo.combo_id using errcode = '55000';
    end if;
    if v_combo_row.approval_status <> 'APROBADO_COMERCIAL' then
      raise exception 'combo sin aprobacion comercial: %', v_combo.combo_id using errcode = '55000';
    end if;
    select count(*)::integer into v_combo_declared_count
      from public.product_combo_components cc
     where cc.combo_id = v_combo_row.id;
    if v_combo_declared_count = 0 then
      raise exception 'combo sin componentes: %', v_combo.combo_id using errcode = '55000';
    end if;
  end loop;

  select coalesce(jsonb_agg(
    jsonb_build_object('product_id', totals.product_id, 'quantity', totals.quantity)
    order by totals.product_id
  ), '[]'::jsonb)
    into v_normalized_items
    from (
      select merged.product_id, sum(merged.quantity)::integer as quantity
        from (
          select (p.value ->> 'product_id')::uuid as product_id,
                 (p.value ->> 'quantity')::integer as quantity
            from jsonb_array_elements(v_normalized_products) as p(value)
          union all
          select cc.product_id,
                 cc.quantity * (c.value ->> 'quantity')::integer
            from jsonb_array_elements(v_normalized_combos) as c(value)
            join public.product_combos pc
              on pc.business_id = v_business_id
             and pc.combo_id = (c.value ->> 'combo_id')
            join public.product_combo_components cc on cc.combo_id = pc.id
        ) as merged
       group by merged.product_id
    ) as totals;

  if jsonb_array_length(v_normalized_items) < 1 then
    raise exception 'el checkout quedo sin productos' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(v_normalized_items) as normalized(product_id uuid, quantity integer)
     where quantity > 1000
  ) then
    raise exception 'quantity total demasiado alta para producto' using errcode = '22023';
  end if;

  v_expires_at := clock_timestamp() + make_interval(mins => v_settings.preference_expiration_minutes);
  insert into public.checkout_sessions (
    business_id, customer_id, client_request_id, normalized_intent_hash,
    fulfillment_type, address_snapshot, contact_snapshot, currency,
    subtotal, discount_total, delivery_fee, total, status, expires_at
  ) values (
    v_business_id, p_customer_id, v_client_request_id, v_request_hash,
    v_fulfillment_type, v_address_snapshot, v_contact_snapshot, 'ARS',
    0, 0, 0, 0, 'validating', v_expires_at
  ) returning * into v_session;

  -- Lock products in deterministic UUID order. Reserving decrements the same
  -- authoritative stock used by the legacy direct-order RPC, so both flows see
  -- active reservations and cannot oversell each other.
  for v_item in
    select * from jsonb_to_recordset(v_normalized_items) as normalized(product_id uuid, quantity integer)
     order by product_id
  loop
    select p.* into v_product
      from public.products p
     where p.id = v_item.product_id
       and p.business_id = v_business_id
     for update;
    if not found
      or not v_product.is_active
      or not v_product.is_verified
      or not v_product.available
      or v_product.price_status <> 'confirmed'
      or v_product.stock is null
      or v_product.price is null
      or v_product.price <= 0 then
      raise exception 'producto no disponible para pago: %', v_item.product_id using errcode = '55000';
    end if;
    if v_product.stock < v_item.quantity then
      raise exception 'stock insuficiente para producto: %', v_item.product_id using errcode = '23514';
    end if;
    if v_product.is_alcoholic then
      v_contains_alcohol := true;
      if v_product.minimum_age is null then
        raise exception 'producto alcoholico sin edad minima configurada' using errcode = '55000';
      end if;
    end if;

    insert into public.checkout_session_items (
      checkout_session_id, product_id, product_snapshot, quantity, unit_price, subtotal
    ) values (
      v_session.id,
      v_product.id,
      jsonb_strip_nulls(jsonb_build_object(
        'name', v_product.name,
        'presentation', v_product.presentation,
        'category', v_product.category,
        'image_url', v_product.image_url,
        'sku', v_product.sku
      )),
      v_item.quantity,
      v_product.price,
      v_product.price * v_item.quantity
    );
    insert into public.inventory_reservations (
      checkout_session_id, product_id, quantity, expires_at
    ) values (
      v_session.id, v_product.id, v_item.quantity, v_expires_at
    );
    update public.products p
       set stock = p.stock - v_item.quantity,
           available = case when p.stock - v_item.quantity > 0 then p.available else false end
     where p.id = v_product.id;
    v_subtotal := v_subtotal + (v_product.price * v_item.quantity);
  end loop;

  -- El precio de lista del combo se calcula con los precios BLOQUEADOS recien
  -- ahora: usar el precio leido antes del lock permitiria que una actualizacion
  -- concurrente moviera el ahorro anunciado respecto del cobrado.
  for v_combo in
    select * from jsonb_to_recordset(v_normalized_combos) as c(combo_id text, quantity integer)
     order by combo_id
  loop
    select * into v_combo_row
      from public.product_combos c
     where c.business_id = v_business_id
       and c.combo_id = v_combo.combo_id;

    select
        coalesce(sum(cc.quantity * i.unit_price), 0),
        count(*)::integer,
        coalesce(jsonb_agg(jsonb_build_object(
          'product_id', cc.product_id,
          'sku', i.product_snapshot ->> 'sku',
          'name', i.product_snapshot ->> 'name',
          'quantity', cc.quantity,
          'unit_price', i.unit_price,
          'line_price', cc.quantity * i.unit_price
        ) order by cc.sort_order, cc.product_id), '[]'::jsonb)
      into v_combo_list_price, v_combo_component_count, v_combo_components
      from public.product_combo_components cc
      join public.checkout_session_items i
        on i.checkout_session_id = v_session.id
       and i.product_id = cc.product_id
     where cc.combo_id = v_combo_row.id;

    select count(*)::integer into v_combo_declared_count
      from public.product_combo_components cc
     where cc.combo_id = v_combo_row.id;

    -- Si un componente no llego a reservarse, el combo no se cobra a medias.
    if v_combo_component_count <> v_combo_declared_count or v_combo_list_price <= 0 then
      raise exception 'combo incompleto al reservar: %', v_combo.combo_id using errcode = '55000';
    end if;

    v_combo_promotional := floor(
      (v_combo_list_price * (100 - v_combo_row.discount_percentage) / 100) / v_combo_row.price_rounding
    ) * v_combo_row.price_rounding;
    if v_combo_promotional <= 0 or v_combo_promotional > v_combo_list_price then
      raise exception 'precio promocional invalido para el combo: %', v_combo.combo_id using errcode = '55000';
    end if;

    insert into public.checkout_session_combos (
      checkout_session_id, combo_uuid, combo_id, name, quantity,
      discount_percentage, list_price, promotional_price, discount_amount, combo_snapshot
    ) values (
      v_session.id, v_combo_row.id, v_combo_row.combo_id, v_combo_row.name, v_combo.quantity,
      v_combo_row.discount_percentage, v_combo_list_price, v_combo_promotional,
      (v_combo_list_price - v_combo_promotional) * v_combo.quantity,
      jsonb_build_object(
        'combo_id', v_combo_row.combo_id,
        'name', v_combo_row.name,
        'tagline', v_combo_row.tagline,
        'terms', v_combo_row.terms,
        'discount_percentage', v_combo_row.discount_percentage,
        'price_rounding', v_combo_row.price_rounding,
        'approval_status', v_combo_row.approval_status,
        'approved_at', v_combo_row.approved_at,
        'components', v_combo_components
      )
    );

    v_discount_total := v_discount_total + (v_combo_list_price - v_combo_promotional) * v_combo.quantity;
  end loop;

  if v_discount_total > v_subtotal then
    raise exception 'el descuento de combos supera el subtotal' using errcode = '23514';
  end if;

  if v_contains_alcohol then
    if not v_business.alcohol_sales_enabled
      or v_business.alcohol_minimum_age is null
      or v_business.alcohol_sales_start is null
      or v_business.alcohol_sales_end is null
      or v_business.alcohol_timezone is null
      or not v_age_confirmed then
      raise exception 'politica o confirmacion de edad incompleta' using errcode = '55000';
    end if;
    if v_business.alcohol_sales_start <= v_business.alcohol_sales_end then
      if (clock_timestamp() at time zone v_business.alcohol_timezone)::time
         not between v_business.alcohol_sales_start and v_business.alcohol_sales_end then
        raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
      end if;
    elsif (clock_timestamp() at time zone v_business.alcohol_timezone)::time
      between v_business.alcohol_sales_end and v_business.alcohol_sales_start then
      raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
    end if;
  end if;

  if v_fulfillment_type = 'delivery' then
    v_delivery_fee := v_business.delivery_fee;
    if v_delivery_fee is null or v_business.minimum_delivery_subtotal is null
      or (v_subtotal - v_discount_total) < v_business.minimum_delivery_subtotal then
      raise exception 'configuracion o minimo de delivery no valido' using errcode = '23514';
    end if;
  end if;
  v_total := v_subtotal - v_discount_total + v_delivery_fee;

  update public.checkout_sessions
     set subtotal = v_subtotal,
         discount_total = v_discount_total,
         delivery_fee = v_delivery_fee,
         total = v_total,
         contains_alcohol = v_contains_alcohol,
         age_confirmed_at = case when v_contains_alcohol then clock_timestamp() else null end,
         age_confirmation_policy = case when v_contains_alcohol then v_business.alcohol_minimum_age else null end,
         status = 'ready_for_payment'
   where id = v_session.id
   returning * into v_session;

  insert into public.payment_intents (
    checkout_session_id, business_id, provider, environment, external_reference,
    internal_status, currency, expected_amount, live_mode
  ) values (
    v_session.id, v_business_id, 'mercadopago', v_settings.environment,
    'taba2:checkout:' || v_session.id::text,
    'created', 'ARS', v_total, v_settings.environment = 'production'
  ) returning id into v_payment_intent_id;

  insert into public.payment_events (
    payment_intent_id, event_type, details
  ) values (
    v_payment_intent_id,
    'checkout.session_created',
    jsonb_build_object('checkout_session_id', v_session.id, 'reservation_expires_at', v_expires_at)
  );

  return public.checkout_session_customer_payload(v_session.id, p_customer_id);
end;
$$;

-- ===== Finalizacion: el pedido hereda descuento y snapshot =====
--
-- Se redefine sobre la version de `20260806150000` (snapshot de direccion),
-- agregando unicamente el descuento y la proyeccion de los combos. El pedido se
-- inserta ya con su `discount_total`: escribirlo despues obligaria a un update
-- que moveria la revision de un pedido recien creado.

create or replace function public.finalize_paid_checkout_session(p_checkout_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
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
    payment_method, subtotal, discount_total, delivery_fee, total
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
    'mercadopago', v_session.subtotal, v_session.discount_total, v_session.delivery_fee, v_session.total
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
$$;

revoke all on function public.create_checkout_session(uuid, jsonb) from public, anon;
revoke all on function public.finalize_paid_checkout_session(uuid) from public, anon, authenticated;

comment on function public.create_checkout_session(uuid, jsonb) is
  'Checkout Pro autoritativo. Acepta lineas de producto y de combo; el precio del combo lo decide el backend.';
