-- ============================================================================
--  Caja Clara (POS nativo de Windows) como cliente operativo de La Taba.
-- ============================================================================
--
--  Caja Clara es el centro operativo del local: vende en el mostrador (su
--  SQLite local manda sobre sus ventas y sigue vendiendo sin Internet) y opera
--  los pedidos online de La Taba. El backend de La Taba sigue siendo la única
--  autoridad de pedidos, disponibilidad online, riders y cobros online. El
--  Panel web no cambia: todo lo que hace Caja Clara pasa por las mismas RPC o
--  por las de esta migración, así que el Panel lo ve igual y al revés.
--
--  IDENTIDAD (sin service_role en la PC)
--    Caja Clara entra como un miembro del equipo del comercio (owner, admin o
--    staff) con una sesión GoTrue registrada por identity_register_session con
--    client = 'caja_clara_windows' y el SHA-256 de su DeviceId. Es el mismo
--    camino del Panel y del Rider: membresía activa, sesión registrada y no
--    revocada, sessions_valid_from. Las RPC pos_* exigen además que la sesión
--    sea de Caja Clara y esté atada a ESE dispositivo (device_key_hash): una
--    sesión del Panel o de otra PC no puede mover stock en su nombre.
--
--  STOCK: UN SOLO INVENTARIO
--    products.stock sigue significando lo que ya significaba: el DISPONIBLE
--    para la tienda online. El pedido online lo descuenta al nacer (reserva) y
--    la cancelación previa al despacho lo devuelve (change_order_status).
--      reservado = reservas de checkout activas
--                + ítems de pedidos que todavía NO salieron del local
--                  (submitted/received, accepted, preparing, ready, assigned)
--                  sin inventory_released_at
--      físico    = disponible + reservado
--    Caja Clara cuenta el físico. Manda MOVIMIENTOS (deltas) idempotentes:
--    venta de mostrador, anulación, devolución, compra, ajuste, merma. Los
--    deltas conmutan, así que una caja que vuelve de estar sin conexión no pisa
--    nada. El único valor absoluto es el conteo físico explícito
--    (pos_apply_stock_count), que se traduce a disponible = conteo − reservado.
--
--  CONFLICTO: NUNCA UN NEGATIVO SILENCIOSO, NUNCA «GANA EL ÚLTIMO»
--    Caja sin conexión cree que hay 3; mientras tanto la tienda reserva 2 (el
--    disponible queda en 1); la caja vende 3. Al reconectar el delta −3 dejaría
--    el disponible en −2. En vez de eso:
--      · se aplica hasta cero (el disponible no puede ser negativo);
--      · se registra pos_stock_conflicts (open) con el faltante, lo reservado y
--        los pedidos que retienen reserva de ese producto;
--      · el producto queda RETENIDO: no se puede vender online (available se
--        fuerza a false por trigger, incluso si una cancelación devuelve stock)
--        hasta que una persona cuente el físico (pos_apply_stock_count con el
--        conflicto). Si el conteo sigue por debajo de lo reservado, el
--        conflicto sigue abierto y dice qué pedidos hay que resolver.
--
--  PEDIDOS
--    pos_list_orders devuelve un DTO versionado y minimizado (sin GPS, sin
--    código de entrega, teléfono y dirección sólo mientras el pedido está
--    activo) con cursor por updated_at. Las transiciones se hacen con las RPC
--    de siempre (transition_order, cancel_order, confirm_manual_order_payment,
--    offer_order_to_rider, confirm_business_delivery_code): el código de entrega
--    lo valida siempre el servidor.
--
--  Rollback: docs/migrations/rollback/20260929120000_caja_clara_pos_integration.rollback.sql
-- ============================================================================

-- ── Sesiones: Caja Clara es un cliente conocido ─────────────────────────────
alter table public.identity_sessions drop constraint if exists identity_sessions_client_check;
alter table public.identity_sessions add constraint identity_sessions_client_check
  check (client in ('rider_android', 'panel_web', 'caja_clara_windows', 'unknown'));

create or replace function public.identity_register_session(
  p_business_id uuid,
  p_client text default 'unknown',
  p_device_label text default null,
  p_device_key_hash text default null,
  p_app_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_session uuid := public.identity_session_id();
  v_client text := coalesce(nullif(btrim(p_client), ''), 'unknown');
  v_inserted boolean := false;
  v_valid_from timestamptz;
  v_disabled timestamptz;
  v_issued timestamptz;
begin
  if v_user is null or p_business_id is null or public.identity_is_anonymous() or v_session is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select bm.role into v_role
    from public.business_members bm
   where bm.business_id = p_business_id
     and bm.user_id = v_user
     and bm.is_active = true;
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select s.sessions_valid_from, s.disabled_at
    into v_valid_from, v_disabled
    from public.identity_user_security s
   where s.business_id = p_business_id
     and s.user_id = v_user;
  if v_disabled is not null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  v_valid_from := coalesce(v_valid_from, '-infinity'::timestamptz);
  if v_valid_from > '-infinity'::timestamptz then
    v_issued := public.identity_token_issued_at();
    if v_issued is null or v_issued < v_valid_from then
      return jsonb_build_object('ok', false, 'code', 'not_authorized');
    end if;
  end if;

  if v_client not in ('rider_android', 'panel_web', 'caja_clara_windows', 'unknown') then
    v_client := 'unknown';
  end if;
  -- Caja Clara opera la caja y los pedidos: un rider no la usa, y su
  -- dispositivo tiene que quedar identificado para las RPC pos_*.
  if v_client = 'caja_clara_windows' and (
       v_role not in ('owner', 'admin', 'staff')
       or coalesce(lower(btrim(p_device_key_hash)), '') !~ '^[0-9a-f]{64}$') then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  insert into public.identity_sessions as ise (
    session_id, user_id, business_id, role_at_login, client,
    device_label, device_key_hash, app_version
  ) values (
    v_session, v_user, p_business_id, v_role, v_client,
    nullif(btrim(p_device_label), ''),
    lower(nullif(btrim(p_device_key_hash), '')),
    nullif(btrim(p_app_version), '')
  )
  on conflict (session_id) do update
     set last_seen_at = now(),
         role_at_login = excluded.role_at_login,
         device_label = coalesce(excluded.device_label, ise.device_label),
         device_key_hash = coalesce(excluded.device_key_hash, ise.device_key_hash),
         app_version = coalesce(excluded.app_version, ise.app_version)
   where ise.user_id = excluded.user_id
     and ise.business_id = excluded.business_id
     and ise.revoked_at is null
  returning (xmax = 0) into v_inserted;

  if v_inserted is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  if v_inserted then
    perform public.identity_record_audit_event(
      p_event_type => 'session_opened',
      p_business_id => p_business_id,
      p_actor_user_id => v_user,
      p_actor_role => v_role,
      p_subject_user_id => v_user,
      p_session_id => v_session,
      p_metadata => jsonb_build_object('client', v_client, 'app_version', nullif(btrim(p_app_version), ''))
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'registered',
    'role', v_role,
    'session_id', v_session,
    'new_session', v_inserted
  );
end;
$$;

revoke execute on function public.identity_register_session(uuid, text, text, text, text) from public, anon;
grant execute on function public.identity_register_session(uuid, text, text, text, text) to authenticated;

-- ── Tablas ─────────────────────────────────────────────────────────────────
create table if not exists public.pos_stock_conflicts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  kind text not null check (kind in ('oversold_offline', 'count_below_reserved')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  requested_delta integer not null,
  applied_delta integer not null,
  shortfall integer not null check (shortfall > 0),
  reserved_at_detection integer not null check (reserved_at_detection >= 0),
  holding_orders jsonb not null default '[]'::jsonb check (jsonb_typeof(holding_orders) = 'array'),
  occurrences integer not null default 1 check (occurrences >= 1),
  detected_by uuid references auth.users(id) on delete set null,
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution text check (resolution is null or resolution in ('recounted')),
  resolution_note text check (resolution_note is null or char_length(btrim(resolution_note)) between 3 and 300),
  constraint pos_stock_conflicts_resolved_consistent check ((status = 'resolved') = (resolved_at is not null)),
  constraint pos_stock_conflicts_resolution_consistent check ((status = 'resolved') = (resolution is not null))
);

create unique index if not exists pos_stock_conflicts_one_open_per_product
  on public.pos_stock_conflicts(product_id) where status = 'open';
create index if not exists pos_stock_conflicts_business_idx
  on public.pos_stock_conflicts(business_id, status, detected_at desc);

create table if not exists public.pos_stock_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9:_-]{8,128}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{32}$'),
  product_id uuid not null references public.products(id) on delete restrict,
  kind text not null check (kind in (
    'sale', 'sale_void', 'return', 'purchase', 'adjustment', 'waste', 'supplier_return', 'count'
  )),
  requested_delta integer not null,
  applied_delta integer not null,
  shortfall integer not null default 0 check (shortfall >= 0),
  stock_after integer not null check (stock_after >= 0),
  reserved_after integer not null check (reserved_after >= 0),
  conflict_id uuid references public.pos_stock_conflicts(id) on delete restrict,
  inventory_movement_id uuid references public.inventory_movements(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null,
  device_key_hash text not null check (device_key_hash ~ '^[0-9a-f]{64}$'),
  local_occurred_at timestamptz,
  received_at timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

create index if not exists pos_stock_receipts_product_idx on public.pos_stock_receipts(product_id, received_at desc);

alter table public.pos_stock_conflicts enable row level security;
alter table public.pos_stock_receipts enable row level security;
revoke all on table public.pos_stock_conflicts, public.pos_stock_receipts from public, anon, authenticated;
grant all on table public.pos_stock_conflicts, public.pos_stock_receipts to service_role;

-- ── Retención: un producto con conflicto abierto no se vende online ────────
create or replace function private.pos_hold_conflicted_product()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $pos_hold$
begin
  if new.available and exists (
    select 1 from public.pos_stock_conflicts c where c.product_id = new.id and c.status = 'open'
  ) then
    new.available := false;
  end if;
  return new;
end;
$pos_hold$;

revoke all on function private.pos_hold_conflicted_product() from public, anon, authenticated;

drop trigger if exists products_pos_conflict_hold on public.products;
create trigger products_pos_conflict_hold
before insert or update of available on public.products
for each row execute function private.pos_hold_conflicted_product();

-- ── Helpers privados ───────────────────────────────────────────────────────

-- Sesión de Caja Clara, de este comercio, atada a este dispositivo. Devuelve
-- el session_id; cualquier otra cosa es 42501 sin detalle.
create or replace function private.pos_require_terminal(p_business_id uuid, p_device_key_hash text)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $pos_require_terminal$
declare
  v_session uuid := public.identity_session_id();
begin
  if auth.uid() is null or p_business_id is null or v_session is null
     or not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'terminal no autorizada' using errcode = '42501';
  end if;
  if coalesce(lower(btrim(p_device_key_hash)), '') !~ '^[0-9a-f]{64}$' or not exists (
    select 1 from public.identity_sessions s
     where s.session_id = v_session
       and s.user_id = auth.uid()
       and s.business_id = p_business_id
       and s.client = 'caja_clara_windows'
       and s.device_key_hash = lower(btrim(p_device_key_hash))
       and s.revoked_at is null
  ) then
    raise exception 'terminal no autorizada' using errcode = '42501';
  end if;
  return v_session;
end;
$pos_require_terminal$;

-- Lo que retienen los pedidos que no salieron del local y los checkouts vivos.
create or replace function private.pos_reserved_quantity(p_product_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $pos_reserved_quantity$
  select (
    coalesce((
      select sum(oi.quantity)::integer
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
       where oi.product_uuid = p_product_id
         and o.status in ('received', 'submitted', 'accepted', 'preparing', 'ready', 'assigned')
         and o.inventory_released_at is null
    ), 0)
    + coalesce((
      select sum(r.quantity)::integer
        from public.inventory_reservations r
       where r.product_id = p_product_id
         and r.status = 'active'
    ), 0)
  )::integer;
$pos_reserved_quantity$;

create or replace function private.pos_holding_orders(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $pos_holding_orders$
  select coalesce(jsonb_agg(jsonb_build_object(
           'order_id', h.id, 'public_code', h.public_code, 'status', h.status, 'quantity', h.quantity)
           order by h.created_at, h.id), '[]'::jsonb)
    from (
      select o.id, coalesce(o.public_code, o.code) as public_code,
             public.normalize_order_status_vocabulary(o.status) as status,
             sum(oi.quantity)::integer as quantity, o.created_at
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
       where oi.product_uuid = p_product_id
         and o.status in ('received', 'submitted', 'accepted', 'preparing', 'ready', 'assigned')
         and o.inventory_released_at is null
       group by o.id, o.public_code, o.code, o.status, o.created_at
       limit 50
    ) h;
$pos_holding_orders$;

-- Vuelve a ofrecer online un producto que el comercio quiere publicado
-- (merchant_available) y cumple TODAS las compuertas del catálogo. Si alguna
-- restricción de la tabla lo impide (foto, verificación, precio, alcohol en
-- CONTROLLED_PRODUCTION...), queda como estaba: nunca se fuerza.
create or replace function private.pos_try_reoffer(p_product_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $pos_try_reoffer$
declare
  v_product public.products%rowtype;
  v_alcohol_open boolean;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found or v_product.available or not v_product.merchant_available
     or not v_product.is_active or not v_product.is_verified
     or coalesce(v_product.stock, 0) <= 0
     or v_product.price_status <> 'confirmed' or coalesce(v_product.price, 0) <= 0
     or not public.product_commercial_image_valid(v_product)
     or exists (select 1 from public.pos_stock_conflicts c where c.product_id = p_product_id and c.status = 'open') then
    return false;
  end if;
  if v_product.is_alcoholic then
    select coalesce(b.alcohol_sales_enabled, false) into v_alcohol_open
      from public.businesses b where b.id = v_product.business_id;
    if not coalesce(v_alcohol_open, false) then
      return false;
    end if;
  end if;
  begin
    update public.products set available = true, updated_at = statement_timestamp()
     where id = p_product_id and not available;
  exception when check_violation then
    return false;
  end;
  return true;
end;
$pos_try_reoffer$;

-- Abre (o suma a) el conflicto del producto. Un producto tiene como máximo un
-- conflicto abierto: el faltante se acumula.
create or replace function private.pos_record_conflict(
  p_business_id uuid, p_product_id uuid, p_kind text,
  p_requested integer, p_applied integer, p_shortfall integer, p_reserved integer
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $pos_record_conflict$
declare
  v_id uuid;
begin
  update public.pos_stock_conflicts c
     set shortfall = case when p_kind = 'count_below_reserved' then p_shortfall else c.shortfall + p_shortfall end,
         kind = p_kind,
         requested_delta = p_requested,
         applied_delta = p_applied,
         reserved_at_detection = p_reserved,
         holding_orders = private.pos_holding_orders(p_product_id),
         occurrences = c.occurrences + 1,
         last_seen_at = clock_timestamp()
   where c.product_id = p_product_id and c.status = 'open'
  returning c.id into v_id;
  if v_id is null then
    insert into public.pos_stock_conflicts(
      business_id, product_id, kind, requested_delta, applied_delta, shortfall,
      reserved_at_detection, holding_orders, detected_by)
    values (
      p_business_id, p_product_id, p_kind, p_requested, p_applied, p_shortfall,
      p_reserved, private.pos_holding_orders(p_product_id), auth.uid())
    returning id into v_id;
  end if;
  -- Retener en el acto (el trigger también lo sostiene de acá en adelante).
  update public.products set available = false, updated_at = statement_timestamp()
   where id = p_product_id and available;
  return v_id;
end;
$pos_record_conflict$;

create or replace function private.pos_inventory_type(p_kind text, p_delta integer)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $pos_inventory_type$
  select case p_kind
    when 'sale' then case when p_delta < 0 then 'sale' else 'cancellation_return' end
    when 'sale_void' then 'cancellation_return'
    when 'return' then 'cancellation_return'
    when 'purchase' then 'purchase_receipt'
    when 'waste' then 'damage'
    when 'supplier_return' then 'supplier_return'
    when 'count' then 'stock_count'
    else 'manual_adjustment'
  end;
$pos_inventory_type$;

revoke all on function
  private.pos_require_terminal(uuid, text),
  private.pos_reserved_quantity(uuid),
  private.pos_holding_orders(uuid),
  private.pos_try_reoffer(uuid),
  private.pos_record_conflict(uuid, uuid, text, integer, integer, integer, integer),
  private.pos_inventory_type(text, integer)
from public, anon, authenticated;

-- Fila de producto del contrato caja-clara-taba/1.
create or replace function private.pos_product_row(p_product public.products)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $pos_product_row$
  select jsonb_build_object(
    'id', p_product.id,
    'sku', p_product.sku,
    'name', p_product.name,
    'brand', p_product.brand,
    'presentation', coalesce(nullif(btrim(p_product.presentation), ''), nullif(btrim(p_product.capacity), '')),
    'category', p_product.category,
    'price', p_product.price,
    'price_status', p_product.price_status,
    'stock', p_product.stock,
    'reserved', r.reserved,
    'physical', case when p_product.stock is null then null else p_product.stock + r.reserved end,
    'available', p_product.available,
    'merchant_available', p_product.merchant_available,
    'is_verified', p_product.is_verified,
    'is_active', p_product.is_active,
    'is_alcoholic', coalesce(p_product.is_alcoholic, false),
    'image_url', coalesce(p_product.image_thumbnail_url, p_product.image_url),
    'commercial_state', public.product_commercial_state(
      p_product.price_status, p_product.price, p_product.stock,
      p_product.is_active, p_product.is_verified, p_product.available),
    'on_hold', exists (select 1 from public.pos_stock_conflicts c where c.product_id = p_product.id and c.status = 'open'),
    'updated_at', p_product.updated_at
  )
  from (select private.pos_reserved_quantity(p_product.id) as reserved) r;
$pos_product_row$;

revoke all on function private.pos_product_row(public.products) from public, anon, authenticated;

-- ── API de Caja Clara ──────────────────────────────────────────────────────

-- Catálogo online con disponible, reservado y físico, más los conflictos
-- abiertos. Caja Clara lo usa para vincular productos y reconciliar.
create or replace function public.pos_get_catalog_state(p_business_id uuid, p_device_key_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $pos_get_catalog_state$
declare
  v_products jsonb;
  v_conflicts jsonb;
begin
  perform private.pos_require_terminal(p_business_id, p_device_key_hash);

  select coalesce(jsonb_agg(private.pos_product_row(p) order by p.name, p.id), '[]'::jsonb)
    into v_products
    from (select * from public.products where business_id = p_business_id and is_active order by name, id limit 3000) p;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'product_id', c.product_id, 'sku', p.sku, 'product_name', p.name,
           'kind', c.kind, 'shortfall', c.shortfall, 'reserved_at_detection', c.reserved_at_detection,
           'holding_orders', c.holding_orders, 'occurrences', c.occurrences,
           'detected_at', c.detected_at, 'last_seen_at', c.last_seen_at)
           order by c.detected_at), '[]'::jsonb)
    into v_conflicts
    from public.pos_stock_conflicts c
    join public.products p on p.id = c.product_id
   where c.business_id = p_business_id and c.status = 'open';

  return jsonb_build_object(
    'contract', 'caja-clara-taba/1',
    'server_time', clock_timestamp(),
    'business_id', p_business_id,
    'products', v_products,
    'open_conflicts', v_conflicts
  );
end;
$pos_get_catalog_state$;

-- Movimientos de stock del mostrador. Cada movimiento es independiente e
-- idempotente por su clave; un lote reintentado entero no descuenta dos veces.
create or replace function public.pos_apply_stock_movements(
  p_business_id uuid,
  p_device_key_hash text,
  p_movements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $pos_apply_stock_movements$
declare
  v_session uuid;
  v_device text := lower(btrim(coalesce(p_device_key_hash, '')));
  v_item jsonb;
  v_key text;
  v_kind text;
  v_delta integer;
  v_product_id uuid;
  v_sku text;
  v_reason text;
  v_occurred timestamptz;
  v_hash text;
  v_existing public.pos_stock_receipts%rowtype;
  v_product public.products%rowtype;
  v_new integer;
  v_applied integer;
  v_shortfall integer;
  v_reserved integer;
  v_conflict uuid;
  v_movement uuid;
  v_type text;
  v_results jsonb := '[]'::jsonb;
begin
  v_session := private.pos_require_terminal(p_business_id, v_device);
  if p_movements is null or jsonb_typeof(p_movements) <> 'array'
     or jsonb_array_length(p_movements) < 1 or jsonb_array_length(p_movements) > 100 then
    raise exception 'lote de movimientos invalido' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_movements)
  loop
    v_key := v_item ->> 'key';
    v_kind := v_item ->> 'kind';
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_key, '') !~ '^[A-Za-z0-9:_-]{8,128}$'
       or coalesce(v_kind, '') not in ('sale', 'sale_void', 'return', 'purchase', 'adjustment', 'waste', 'supplier_return')
       or jsonb_typeof(v_item -> 'delta') <> 'number'
       or (v_item ->> 'delta') !~ '^-?[0-9]{1,6}$'
       or coalesce(v_item ->> 'product_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_results := v_results || jsonb_build_object('key', left(coalesce(v_key, ''), 128), 'status', 'rejected', 'code', 'INVALID_MOVEMENT');
      continue;
    end if;
    v_delta := (v_item ->> 'delta')::integer;
    if v_delta = 0 then
      v_results := v_results || jsonb_build_object('key', v_key, 'status', 'rejected', 'code', 'INVALID_MOVEMENT');
      continue;
    end if;
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_sku := nullif(btrim(coalesce(v_item ->> 'sku', '')), '');
    v_reason := nullif(left(btrim(coalesce(v_item ->> 'reason', '')), 300), '');
    begin
      v_occurred := nullif(v_item ->> 'occurred_at', '')::timestamptz;
    exception when others then
      v_occurred := null;
    end;
    v_hash := md5(jsonb_build_object('product_id', v_product_id, 'kind', v_kind, 'delta', v_delta)::text);

    select * into v_existing from public.pos_stock_receipts r
     where r.business_id = p_business_id and r.idempotency_key = v_key;
    if found then
      if v_existing.request_hash <> v_hash then
        v_results := v_results || jsonb_build_object('key', v_key, 'status', 'rejected', 'code', 'IDEMPOTENCY_KEY_REUSED');
      else
        v_results := v_results || jsonb_build_object(
          'key', v_key, 'status', 'applied', 'replay', true, 'product_id', v_existing.product_id,
          'applied_delta', v_existing.applied_delta, 'shortfall', v_existing.shortfall,
          'stock_after', v_existing.stock_after, 'reserved_after', v_existing.reserved_after,
          'conflict_id', v_existing.conflict_id);
      end if;
      continue;
    end if;

    select * into v_product from public.products p
     where p.id = v_product_id and p.business_id = p_business_id
     for update;
    if not found then
      v_results := v_results || jsonb_build_object('key', v_key, 'status', 'rejected', 'code', 'PRODUCT_NOT_FOUND');
      continue;
    end if;
    if v_sku is not null and v_sku is distinct from v_product.sku then
      v_results := v_results || jsonb_build_object('key', v_key, 'status', 'rejected', 'code', 'SKU_MISMATCH');
      continue;
    end if;
    if v_product.stock is null then
      v_results := v_results || jsonb_build_object('key', v_key, 'status', 'rejected', 'code', 'STOCK_NOT_INITIALIZED');
      continue;
    end if;

    v_new := v_product.stock + v_delta;
    v_shortfall := 0;
    v_conflict := null;
    if v_new < 0 then
      v_shortfall := -v_new;
      v_new := 0;
    end if;
    v_applied := v_new - v_product.stock;

    if v_applied <> 0 then
      update public.products
         set stock = v_new,
             available = case when v_new = 0 then false else available end,
             updated_at = statement_timestamp()
       where id = v_product.id;
    end if;
    v_reserved := private.pos_reserved_quantity(v_product.id);
    if v_shortfall > 0 then
      v_conflict := private.pos_record_conflict(p_business_id, v_product.id, 'oversold_offline',
        v_delta, v_applied, v_shortfall, v_reserved);
    elsif v_applied > 0 then
      perform private.pos_try_reoffer(v_product.id);
    end if;

    v_movement := null;
    if v_applied <> 0 then
      v_type := private.pos_inventory_type(v_kind, v_applied);
      insert into public.inventory_movements(
        business_id, product_id, barcode_id, movement_type, quantity_delta, previous_stock, resulting_stock,
        unit_factor, reference_type, reference_id, reason, operator_id, idempotency_key)
      values (
        p_business_id, v_product.id, null, v_type, v_applied, v_product.stock, v_new, 1, 'caja_clara', null,
        case when v_type in ('manual_adjustment', 'stock_count', 'damage', 'loss', 'expiration', 'supplier_return')
             then coalesce(case when char_length(v_reason) >= 3 then v_reason end, 'Movimiento de Caja Clara')
             else v_reason end,
        auth.uid(), 'cc_' || md5(p_business_id::text || ':' || v_key))
      returning id into v_movement;
    end if;

    insert into public.pos_stock_receipts(
      business_id, idempotency_key, request_hash, product_id, kind, requested_delta, applied_delta, shortfall,
      stock_after, reserved_after, conflict_id, inventory_movement_id, actor_user_id, session_id, device_key_hash,
      local_occurred_at)
    values (
      p_business_id, v_key, v_hash, v_product.id, v_kind, v_delta, v_applied, v_shortfall,
      v_new, v_reserved, v_conflict, v_movement, auth.uid(), v_session, v_device, v_occurred);

    v_results := v_results || jsonb_build_object(
      'key', v_key, 'status', case when v_shortfall > 0 then 'needs_review' else 'applied' end, 'replay', false,
      'product_id', v_product.id, 'applied_delta', v_applied, 'shortfall', v_shortfall,
      'stock_after', v_new, 'reserved_after', v_reserved, 'conflict_id', v_conflict);
  end loop;

  return jsonb_build_object('contract', 'caja-clara-taba/1', 'server_time', clock_timestamp(), 'results', v_results);
end;
$pos_apply_stock_movements$;

-- Conteo físico explícito: disponible = conteo − reservado. Es también la
-- única forma de cerrar un conflicto de stock.
create or replace function public.pos_apply_stock_count(
  p_business_id uuid,
  p_device_key_hash text,
  p_product_id uuid,
  p_sku text,
  p_physical_count integer,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $pos_apply_stock_count$
declare
  v_session uuid;
  v_device text := lower(btrim(coalesce(p_device_key_hash, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_hash text;
  v_existing public.pos_stock_receipts%rowtype;
  v_product public.products%rowtype;
  v_reserved integer;
  v_target integer;
  v_new integer;
  v_shortfall integer := 0;
  v_conflict uuid;
  v_resolved uuid;
  v_movement uuid;
  v_previous integer;
begin
  v_session := private.pos_require_terminal(p_business_id, v_device);
  if coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9:_-]{8,128}$'
     or p_product_id is null or p_physical_count is null or p_physical_count < 0 or p_physical_count > 999999
     or char_length(v_reason) not between 3 and 300 then
    raise exception 'conteo invalido' using errcode = '22023';
  end if;
  v_hash := md5(jsonb_build_object('product_id', p_product_id, 'kind', 'count', 'count', p_physical_count)::text);

  select * into v_existing from public.pos_stock_receipts r
   where r.business_id = p_business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'idempotency_key reutilizada con otro conteo' using errcode = '23505';
    end if;
    return jsonb_build_object('contract', 'caja-clara-taba/1', 'status',
      case when v_existing.shortfall > 0 then 'needs_review' else 'applied' end, 'replay', true,
      'product_id', v_existing.product_id, 'stock_after', v_existing.stock_after,
      'reserved_after', v_existing.reserved_after, 'shortfall', v_existing.shortfall,
      'conflict_id', v_existing.conflict_id);
  end if;

  select * into v_product from public.products p
   where p.id = p_product_id and p.business_id = p_business_id
   for update;
  if not found then
    raise exception 'producto inexistente' using errcode = 'P0002';
  end if;
  if p_sku is not null and btrim(p_sku) <> '' and btrim(p_sku) is distinct from v_product.sku then
    raise exception 'el sku no corresponde al producto' using errcode = '22023';
  end if;
  -- Cerrar un conflicto es decisión de owner o admin.
  if exists (select 1 from public.pos_stock_conflicts c where c.product_id = v_product.id and c.status = 'open')
     and not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'resolver un conflicto de stock requiere owner o admin' using errcode = '42501';
  end if;

  v_previous := coalesce(v_product.stock, 0);
  v_reserved := private.pos_reserved_quantity(v_product.id);
  v_target := p_physical_count - v_reserved;
  v_new := greatest(v_target, 0);
  if v_target < 0 then
    v_shortfall := -v_target;
  end if;

  if v_product.stock is distinct from v_new then
    update public.products
       set stock = v_new,
           available = case when v_new = 0 then false else available end,
           updated_at = statement_timestamp()
     where id = v_product.id;
  end if;

  if v_new - v_previous <> 0 then
    insert into public.inventory_movements(
      business_id, product_id, barcode_id, movement_type, quantity_delta, previous_stock, resulting_stock,
      unit_factor, reference_type, reference_id, reason, operator_id, idempotency_key)
    values (
      p_business_id, v_product.id, null, 'stock_count', v_new - v_previous, v_previous, v_new, 1, 'caja_clara', null,
      v_reason, auth.uid(), 'cc_' || md5(p_business_id::text || ':' || p_idempotency_key))
    returning id into v_movement;
  end if;

  if v_shortfall > 0 then
    v_conflict := private.pos_record_conflict(p_business_id, v_product.id, 'count_below_reserved',
      v_new - v_previous, v_new - v_previous, v_shortfall, v_reserved);
  else
    update public.pos_stock_conflicts c
       set status = 'resolved', resolved_at = clock_timestamp(), resolved_by = auth.uid(),
           resolution = 'recounted', resolution_note = v_reason
     where c.product_id = v_product.id and c.status = 'open'
    returning c.id into v_resolved;
    if v_new > 0 then
      perform private.pos_try_reoffer(v_product.id);
    end if;
  end if;

  insert into public.pos_stock_receipts(
    business_id, idempotency_key, request_hash, product_id, kind, requested_delta, applied_delta, shortfall,
    stock_after, reserved_after, conflict_id, inventory_movement_id, actor_user_id, session_id, device_key_hash)
  values (
    p_business_id, p_idempotency_key, v_hash, v_product.id, 'count', v_new - v_previous, v_new - v_previous,
    v_shortfall, v_new, v_reserved, coalesce(v_conflict, v_resolved), v_movement, auth.uid(), v_session, v_device);

  return jsonb_build_object('contract', 'caja-clara-taba/1',
    'status', case when v_shortfall > 0 then 'needs_review' else 'applied' end, 'replay', false,
    'product_id', v_product.id, 'stock_after', v_new, 'reserved_after', v_reserved,
    'physical', p_physical_count, 'shortfall', v_shortfall,
    'conflict_id', coalesce(v_conflict, v_resolved), 'conflict_resolved', v_resolved is not null,
    'holding_orders', case when v_shortfall > 0 then private.pos_holding_orders(v_product.id) else '[]'::jsonb end);
end;
$pos_apply_stock_count$;

-- Pedidos para la bandeja de Caja Clara (contrato caja-clara-taba/1).
--   · activos siempre; terminados sólo si cambiaron después del cursor (o en
--     las últimas 24 h sin cursor);
--   · sin GPS, sin código de entrega; teléfono y dirección sólo mientras el
--     pedido está activo;
--   · allowed_actions es una ayuda de pantalla: la autoridad sigue siendo
--     change_order_status.
create or replace function public.pos_list_orders(
  p_business_id uuid,
  p_device_key_hash text,
  p_updated_since timestamptz default null,
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $pos_list_orders$
declare
  v_since timestamptz := coalesce(p_updated_since, clock_timestamp() - interval '24 hours');
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_orders jsonb;
  v_count integer;
  v_cursor timestamptz;
begin
  perform private.pos_require_terminal(p_business_id, p_device_key_hash);

  with picked as (
    select o.*
      from public.orders o
     where o.business_id = p_business_id
       and o.status <> 'draft'
       and (
         o.status not in ('delivered', 'cancelled', 'canceled', 'rejected')
         or o.updated_at > v_since
       )
       and o.created_at > clock_timestamp() - interval '14 days'
     order by o.updated_at, o.id
     limit v_limit
  ), shaped as (
    select o.updated_at, o.id, jsonb_build_object(
      'id', o.id,
      'public_code', coalesce(o.public_code, o.code),
      'status', public.normalize_order_status_vocabulary(o.status),
      'revision', o.revision,
      'origin', o.origin,
      'created_at', o.created_at,
      'updated_at', o.updated_at,
      'fulfillment', o.delivery_mode,
      'customer_name', left(coalesce(nullif(btrim(o.customer_name), ''), 'Cliente'), 80),
      'customer_phone', case when t.active then o.customer_phone end,
      'notes', left(nullif(btrim(coalesce(o.customer_notes, o.notes, '')), ''), 300),
      'delivery', case when o.delivery_mode = 'delivery' and t.active then jsonb_build_object(
          'address', coalesce(nullif(btrim(o.delivery_address_formatted), ''), nullif(btrim(o.customer_street_address), '')),
          'neighborhood', coalesce(nullif(btrim(o.customer_neighborhood), ''), nullif(btrim(o.delivery_area_declared), '')),
          'floor', o.delivery_floor,
          'apartment', o.delivery_apartment,
          'reference', coalesce(nullif(btrim(o.delivery_reference), ''), nullif(btrim(o.customer_reference), '')),
          'zone', o.delivery_zone_name)
        end,
      'items', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'product_id', oi.product_uuid, 'sku', p.sku, 'name', oi.name,
                   'quantity', oi.quantity, 'unit_price', oi.unit_price, 'subtotal', oi.subtotal)
                   order by oi.created_at, oi.id)
            from public.order_items oi
            left join public.products p on p.id = oi.product_uuid
           where oi.order_id = o.id), '[]'::jsonb),
      'combos', coalesce((
          select jsonb_agg(jsonb_build_object('name', oc.name, 'quantity', oc.quantity,
                   'price', coalesce(oc.promotional_price, oc.list_price)) order by oc.created_at, oc.id)
            from public.order_combos oc where oc.order_id = o.id), '[]'::jsonb),
      'subtotal', o.subtotal,
      'delivery_fee', o.delivery_fee,
      'discount_total', o.discount_total,
      'total', o.total,
      'currency', coalesce(o.currency_code, 'ARS'),
      'payment', jsonb_build_object(
        'method', o.payment_method,
        'manual_method', o.manual_payment_method,
        'state', case
          when o.payment_method = 'qa_no_charge' then 'not_applicable'
          when o.payment_method = 'mercadopago' then
            case when public.order_payment_is_financially_reversed(o.id) then 'needs_review' else 'approved' end
          when o.manual_payment_status = 'confirmed' then 'approved'
          when o.manual_payment_status = 'reversed' then 'needs_review'
          else 'pending'
        end),
      'rider', case when o.assigned_rider_user_id is not null then jsonb_build_object(
          'user_id', o.assigned_rider_user_id,
          'name', left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
                                nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                                'Rider ' || upper(right(o.assigned_rider_user_id::text, 8))), 80))
        end,
      'pending_offer', (
          select jsonb_build_object('rider_user_id', f.rider_user_id, 'created_at', f.created_at)
            from public.rider_order_offers f
           where f.order_id = o.id and f.status = 'pending'
           order by f.created_at desc limit 1),
      'preparation_estimate_minutes', o.preparation_estimate_minutes,
      'timestamps', jsonb_build_object(
        'accepted_at', o.accepted_at, 'preparing_at', o.preparing_at, 'ready_at', o.ready_at,
        'dispatched_at', coalesce(o.dispatched_at, o.picked_up_at), 'delivered_at', o.delivered_at,
        'cancelled_at', coalesce(o.cancelled_at, o.canceled_at, o.rejected_at)),
      'stock_left_store', public.normalize_order_status_vocabulary(o.status) in ('picked_up', 'on_the_way', 'arrived', 'delivered'),
      'allowed_actions', to_jsonb(array_remove(array[
          case when t.s in ('submitted') then 'accept' end,
          case when t.s in ('submitted') then 'reject' end,
          case when t.s = 'accepted' then 'prepare' end,
          case when t.s = 'preparing' then 'ready' end,
          case when t.s = 'ready' and o.delivery_mode = 'pickup' then 'hand_over' end,
          case when t.s = 'ready' and o.delivery_mode = 'delivery' and o.assigned_rider_user_id is null then 'offer_rider' end,
          case when t.s = 'ready' and o.delivery_mode = 'delivery' and o.assigned_rider_user_id is null then 'self_dispatch' end,
          case when t.s = 'on_the_way' and o.delivery_mode = 'delivery' and o.assigned_rider_user_id is null then 'confirm_delivery_code' end,
          case when t.active and o.payment_method in ('cash', 'coordinate') and coalesce(o.manual_payment_status, 'pending') = 'pending' then 'confirm_payment' end,
          case when t.active then 'cancel' end
        ], null))
    ) as dto
      from picked o
      cross join lateral (
        select public.normalize_order_status_vocabulary(o.status) as s,
               public.normalize_order_status_vocabulary(o.status) not in ('delivered', 'cancelled', 'rejected') as active
      ) t
      left join auth.users u on u.id = o.assigned_rider_user_id
  )
  select coalesce(jsonb_agg(dto order by updated_at, id), '[]'::jsonb), count(*)::integer, max(updated_at)
    into v_orders, v_count, v_cursor
    from shaped;

  return jsonb_build_object(
    'contract', 'caja-clara-taba/1',
    'server_time', clock_timestamp(),
    'orders', v_orders,
    'count', v_count,
    'truncated', v_count >= v_limit,
    'next_cursor', coalesce(v_cursor, p_updated_since)
  );
end;
$pos_list_orders$;

-- Estado del comercio para la pantalla «Tienda y reparto»: abierto/cerrado/
-- pausado, horarios, retiro/envío, zonas, Mercado Pago (sólo si está
-- conectado, nunca tokens) y repartidores.
create or replace function public.pos_get_store_overview(p_business_id uuid, p_device_key_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $pos_get_store_overview$
declare
  v_business public.businesses%rowtype;
  v_mp text;
  v_hours jsonb;
  v_zones jsonb;
  v_riders jsonb;
  v_now timestamptz := clock_timestamp();
begin
  perform private.pos_require_terminal(p_business_id, p_device_key_hash);
  select * into v_business from public.businesses where id = p_business_id;
  if not found then
    raise exception 'negocio inexistente' using errcode = 'P0002';
  end if;

  select case
      when exists (select 1 from public.mp_seller_connections m
                    where m.business_id = p_business_id and m.status = 'connected') then 'connected'
      when exists (select 1 from public.mp_seller_connections m
                    where m.business_id = p_business_id and m.status = 'requires_reauthorization') then 'needs_attention'
      else 'not_connected'
    end into v_mp;

  select coalesce(jsonb_agg(jsonb_build_object('channel', h.channel, 'weekday', h.weekday,
           'opens_at', h.opens_at, 'closes_at', h.closes_at) order by h.channel, h.weekday, h.opens_at), '[]'::jsonb)
    into v_hours
    from public.business_service_hours h where h.business_id = p_business_id;

  select coalesce(jsonb_agg(jsonb_build_object('name', z.name, 'active', z.is_active,
           'delivery_fee', z.delivery_fee, 'minimum_subtotal', z.minimum_subtotal) order by z.priority, z.name), '[]'::jsonb)
    into v_zones
    from public.delivery_zones z where z.business_id = p_business_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'rider_user_id', bm.user_id,
           'name', left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
                                 nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
                                 'Rider ' || upper(right(bm.user_id::text, 8))), 80),
           'available', case when v_business.rider_presence_required
                             then public.rider_availability_effective(p_business_id, bm.user_id) else true end,
           'last_seen_at', ra.last_seen_at,
           'active_orders', public.count_rider_active_orders(p_business_id, bm.user_id, null))
           order by bm.user_id), '[]'::jsonb)
    into v_riders
    from public.business_members bm
    left join auth.users u on u.id = bm.user_id
    left join public.rider_availability ra on ra.business_id = bm.business_id and ra.rider_user_id = bm.user_id
   where bm.business_id = p_business_id and bm.role = 'rider' and bm.is_active;

  return jsonb_build_object(
    'contract', 'caja-clara-taba/1',
    'server_time', v_now,
    'business', jsonb_build_object(
      'id', v_business.id,
      'name', v_business.name,
      'status', v_business.status,
      'ordering_enabled', coalesce(v_business.ordering_enabled, false),
      'ordering_verified', coalesce(v_business.ordering_verified, false),
      'hours_enforced', coalesce(v_business.hours_enforced, false),
      'timezone', v_business.operating_timezone,
      'open_now', jsonb_build_object(
        'delivery', public.business_is_open(p_business_id, 'delivery', v_now),
        'pickup', public.business_is_open(p_business_id, 'pickup', v_now)),
      'next_open_at', jsonb_build_object(
        'delivery', public.business_next_open_at(p_business_id, 'delivery', v_now),
        'pickup', public.business_next_open_at(p_business_id, 'pickup', v_now))),
    'fulfillment', jsonb_build_object(
      'pickup_enabled', coalesce(v_business.pickup_enabled, false),
      'delivery_enabled', coalesce(v_business.delivery_enabled, false),
      'delivery_fee', v_business.delivery_fee,
      'minimum_delivery_subtotal', v_business.minimum_delivery_subtotal,
      'zones', v_zones),
    'hours', v_hours,
    'mercadopago', jsonb_build_object('state', v_mp),
    'riders', jsonb_build_object('presence_required', coalesce(v_business.rider_presence_required, false), 'list', v_riders)
  );
end;
$pos_get_store_overview$;

-- ── Permisos: sólo el equipo autenticado; anon no gana ninguna función ────
revoke all on function
  public.pos_get_catalog_state(uuid, text),
  public.pos_apply_stock_movements(uuid, text, jsonb),
  public.pos_apply_stock_count(uuid, text, uuid, text, integer, text, text),
  public.pos_list_orders(uuid, text, timestamptz, integer),
  public.pos_get_store_overview(uuid, text)
from public, anon;

grant execute on function
  public.pos_get_catalog_state(uuid, text),
  public.pos_apply_stock_movements(uuid, text, jsonb),
  public.pos_apply_stock_count(uuid, text, uuid, text, integer, text, text),
  public.pos_list_orders(uuid, text, timestamptz, integer),
  public.pos_get_store_overview(uuid, text)
to authenticated, service_role;

comment on table public.pos_stock_conflicts is
  'Faltantes detectados al aplicar movimientos de Caja Clara (venta sin conexión de lo que la tienda reservó) o un conteo por debajo de lo reservado. Mientras esté abierto, el producto no se vende online.';
comment on table public.pos_stock_receipts is
  'Recibo idempotente de cada movimiento o conteo de Caja Clara: qué se pidió, qué se aplicó y con qué sesión y dispositivo.';
comment on function public.pos_apply_stock_movements(uuid, text, jsonb) is
  'Caja Clara: aplica deltas de stock idempotentes. Nunca deja el disponible negativo: aplica hasta cero, abre pos_stock_conflicts y retiene el producto.';
comment on function public.pos_apply_stock_count(uuid, text, uuid, text, integer, text, text) is
  'Caja Clara: conteo físico explícito; disponible = conteo − reservado. Cierra el conflicto si alcanza.';
comment on function public.pos_list_orders(uuid, text, timestamptz, integer) is
  'Caja Clara: pedidos del comercio (contrato caja-clara-taba/1) minimizados y con cursor por updated_at.';

select pg_notify('pgrst', 'reload schema');
