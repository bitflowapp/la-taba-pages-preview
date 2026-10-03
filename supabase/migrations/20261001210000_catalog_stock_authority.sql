-- El catálogo tiene una sola autoridad de stock y deja rastro de cada cambio comercial.
--
-- QUÉ ESTABA ABIERTO (medido el 2026-10-01 en PG17, primero sobre las 159 migraciones
-- hasta 20261001180000 y otra vez sobre las 173 que hoy la preceden: ninguna de las que
-- se sumaron toca las siete funciones que acá se redefinen ni los permisos de `products`)
--
--   1. El número de stock que carga el Panel o la planilla es un CONTEO FÍSICO («Stock
--      contado»), y `apply_commercial_catalog_batch` lo escribía tal cual en
--      `products.stock`, que es el DISPONIBLE. Con 3 disponibles y 2 reservadas por un
--      pedido aceptado, contar 5 dejaba 5 disponibles: 7 unidades comprometidas contra
--      5 en la góndola. Sin fila en `inventory_movements`. `complete_scanned_product`
--      hacía lo mismo.
--   2. Una pantalla vieja pisaba el stock: veía 5, se vendieron 2, escribió 11 y
--      quedaron 11 en vez de 9. Nada lo frenaba.
--   3. Una fila «precio nuevo + publicar» sobre un producto verificado y agotado
--      devolvía una fila sin error y dejaba el producto OCULTO Y SIN VERIFICAR
--      (el disparador de dato maestro despublica al cambiar el precio y el bloque de
--      republicación sólo miraba lo que ya estaba publicado). Repetir la misma
--      planilla lo publicaba: no era idempotente.
--   4. `apply_inventory_movement` no mantenía `available`: registrar la rotura de la
--      última unidad de un producto publicado fallaba con un 23514 crudo
--      (`products_available_requires_verification`) y el producto seguía a la venta.
--   5. `authenticated` conservaba `UPDATE (stock, available, is_active)` directo sobre
--      `products` (20260725110000). Medido con una sesión de STAFF: `stock = 99` entró
--      sin fila de libro, y `available = true` publicó una cerveza con la licencia de
--      alcohol cerrada. Ningún cliente del repositorio usa ese permiso.
--   6. Ningún cambio de precio, stock o publicación dejaba rastro: un lote mal cargado
--      no se podía ni reconstruir ni revertir.
--   7. `complete_scanned_product` sobre un producto verificado que el comercio había
--      ocultado fallaba con el mismo 23514 crudo.
--   8. Un producto dado de alta por la planilla no podía llegar a publicarse: faltaba
--      una puerta para cargarle envase y subfamilia, y el intento de publicarlo
--      abortaba el lote entero con un 23514 que no decía qué faltaba.
--
-- QUÉ QUEDA
--
--   · CONTEO → DISPONIBLE. El stock que llega por el lote comercial y por
--     `complete_scanned_product` se traduce igual que `pos_apply_stock_count`:
--         disponible = max(conteo − reservado, 0)
--     con `reservado = private.pos_reserved_quantity` (pedidos que todavía no salieron
--     + reservas de checkout vivas). Deja una fila `stock_count` en
--     `inventory_movements` (anterior, resultante, operador). Si el conteo no alcanza
--     a cubrir lo reservado, el disponible queda en 0 y se abre el mismo conflicto
--     `count_below_reserved` que abre Caja Clara; un conteo que sí alcanza lo cierra.
--     Las unidades reservadas nunca vuelven a la venta.
--   · GUARDA OPTIMISTA OPCIONAL. Una fila puede traer `expected_stock`: el disponible
--     que el cliente tenía a la vista. Si no coincide con el actual, el lote se rechaza
--     con PT409 (PostgREST responde 409) y no escribe nada. Sin la clave, todo sigue
--     como antes: el cliente web no cambia en esta entrega.
--   · PUBLICAR ES PUBLICAR. Una fila con `publish = true` que pasó todas las
--     compuertas termina publicada o el lote entero falla diciendo por qué. Nunca
--     más una fila «aplicada» que dejó el producto escondido.
--   · `apply_inventory_movement` apaga `available` cuando el disponible llega a 0 y,
--     cuando vuelve a haber, reofrece con `private.pos_try_reoffer`: sólo si el
--     comercio lo quería a la venta y se cumplen TODAS las compuertas (verificado,
--     activo, precio confirmado, imagen válida, licencia de alcohol, sin conflicto).
--   · CONTEO DEL ESCÁNER. El «Conteo físico» del escáner del Panel manda a
--     `apply_inventory_movement` la diferencia contra el disponible, no lo contado: acá
--     no se puede traducir. Mientras el producto tenga unidades apartadas, ese
--     movimiento (`stock_count` con el código escaneado) se rechaza con 22023 /
--     STOCK_COUNT_HAS_RESERVED, sin escribir nada, y manda a contar por Catálogo, que sí
--     descuenta lo apartado. Sin unidades apartadas funciona como antes, y un ajuste
--     sin código escaneado (las restituciones de los scripts de certificación) no cambia.
--   · `authenticated` pierde `UPDATE (stock, available, is_active)` sobre `products`.
--     Conserva `sort_order`. El stock se mueve por las RPC con libro; la publicación,
--     por las RPC con compuertas.
--   · RASTRO Y REVERSIÓN. `catalog_change_batches` + `catalog_change_items` guardan,
--     por cada cambio comercial, quién, cuándo, qué pidió y la imagen de antes y de
--     después de cada producto (precio, estado del precio, stock, disponible,
--     intención del comercio, verificado). `rollback_commercial_catalog_batch`
--     devuelve un lote a su imagen anterior, producto por producto, sólo donde nadie
--     cambió nada desde entonces. Lo que el lote PUBLICÓ por pedido de la planilla
--     vuelve a quedar fuera de la venta aunque su stock ya no se pueda devolver.
--   · `complete_scanned_product` acepta `packaging_type` y `subcategory` (opcionales):
--     es el paso que le faltaba al alta de planilla para poder verificarse. El lote
--     dice qué dato falta en vez de devolver el nombre de una restricción. Sobre un
--     producto ya contado, `stock` pasa a ser opcional: sin la clave no se cuenta.
--     Quien reenviaba el disponible que leyó como si fuera un conteo (los scripts de
--     certificación lo hacen) perdía lo reservado en cada llamada.
--
-- LO QUE NO CAMBIA
--
--   · Las firmas y los tipos de retorno de las siete funciones que se redefinen. Las
--     columnas que devuelve el lote son las mismas; `apply_commercial_catalog_plan`
--     AGREGA `batch_id` y `update_rows` a su JSON y conserva `ok`, `created`,
--     `updated` y `rows`.
--   · «Publicar nunca es un efecto secundario» del lote: reponer stock por la
--     planilla NO republica (se publica a mano, como dice el runbook). La única
--     excepción es la retención por conflicto de stock: si ESTE conteo cierra el
--     conflicto, el producto vuelve como estaba, igual que con Caja Clara.
--   · Ninguna restricción ni disparador de `products`. Ninguna función `pos_*`: se
--     llaman, no se redefinen.
--   · Un producto sin precio confirmado mayor que cero sigue sin poder venderse,
--     antes y después de cualquiera de estas operaciones.
--
-- Forward-only. Reversión: docs/migrations/rollback/20261001210000_catalog_stock_authority.rollback.sql

-- ── 1. Rastro de cambios del catálogo ────────────────────────────────────────
create table if not exists public.catalog_change_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  source text not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid,
  request jsonb not null default '{}'::jsonb,
  request_sha256 text not null,
  reverts_batch_id uuid references public.catalog_change_batches(id) on delete restrict,
  rolled_back_at timestamptz,
  rolled_back_by uuid references auth.users(id) on delete restrict,
  rollback_batch_id uuid references public.catalog_change_batches(id) on delete restrict,
  result jsonb,
  created_xact xid8 not null default pg_current_xact_id(),
  created_at timestamptz not null default clock_timestamp(),
  constraint catalog_change_batches_source_check check (source in (
    'commercial_batch', 'commercial_plan', 'publication', 'unpublish', 'verification', 'scanned_product', 'rollback')),
  constraint catalog_change_batches_request_sha256_check check (request_sha256 ~ '^[a-f0-9]{64}$'),
  constraint catalog_change_batches_reverts_only_rollback check ((source = 'rollback') = (reverts_batch_id is not null)),
  constraint catalog_change_batches_rollback_consistent check (
    (rolled_back_at is null) = (rollback_batch_id is null)
    and (rolled_back_at is null) = (rolled_back_by is null))
);

create index if not exists catalog_change_batches_business_idx
  on public.catalog_change_batches (business_id, created_at desc);
-- Un lote se revierte una sola vez: es lo que hace idempotente a la reversión
-- incluso si dos sesiones la piden a la vez.
create unique index if not exists catalog_change_batches_one_rollback
  on public.catalog_change_batches (reverts_batch_id) where reverts_batch_id is not null;

create table if not exists public.catalog_change_items (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.catalog_change_batches(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  sku text,
  action text not null,
  before jsonb,
  after jsonb not null,
  stock_count integer,
  reserved_at_count integer,
  ledger_rows integer,
  count_receipts integer,
  inventory_movement_id uuid references public.inventory_movements(id) on delete restrict,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint catalog_change_items_action_check check (action in (
    'created', 'updated', 'unchanged', 'restored', 'skipped_changed', 'skipped_created')),
  constraint catalog_change_items_images_are_objects check (
    jsonb_typeof(after) = 'object' and (before is null or jsonb_typeof(before) = 'object')),
  constraint catalog_change_items_created_has_no_before check ((action = 'created') = (before is null)),
  constraint catalog_change_items_count_has_reserved check (
    (stock_count is null) = (reserved_at_count is null) and (stock_count is null) = (ledger_rows is null)
    and (stock_count is null) = (count_receipts is null)),
  constraint catalog_change_items_count_ranges check (
    (stock_count is null or stock_count >= 0)
    and (reserved_at_count is null or reserved_at_count >= 0)
    and (ledger_rows is null or ledger_rows >= 0)
    and (count_receipts is null or count_receipts >= 0)),
  constraint catalog_change_items_detail_is_object check (jsonb_typeof(detail) = 'object')
);

create index if not exists catalog_change_items_batch_idx on public.catalog_change_items (batch_id, id);
create index if not exists catalog_change_items_product_idx on public.catalog_change_items (product_id, created_at desc);

comment on table public.catalog_change_batches is
  'Un cambio comercial del catalogo (lote del Panel o de la planilla, publicacion, verificacion, alta escaneada o reversion): quien, cuando y que pidio. Solo lo escriben las RPC del catalogo.';
comment on table public.catalog_change_items is
  'Imagen de antes y de despues de cada producto que toco un cambio del catalogo: precio, estado del precio, stock disponible, disponible, intencion del comercio y verificado. Inmutable.';
comment on column public.catalog_change_items.stock_count is
  'Conteo fisico recibido, cuando la fila traia stock. El disponible que quedo esta en after.stock.';
comment on column public.catalog_change_items.reserved_at_count is
  'Unidades reservadas (pedidos sin despachar + checkouts vivos) en el momento del conteo.';
comment on column public.catalog_change_items.ledger_rows is
  'Cuantas filas tenia el libro (inventory_movements) de este producto apenas aplicado el conteo. La reversion compara contra este numero para saber si hubo movimientos despues.';
comment on column public.catalog_change_items.count_receipts is
  'Cuantos conteos de Caja Clara (pos_stock_receipts de tipo count) tenia este producto al aplicar el conteo. La reversion compara contra este numero para saber si Caja Clara volvio a contarlo despues.';

alter table public.catalog_change_batches enable row level security;
alter table public.catalog_change_items enable row level security;

drop policy if exists "business owners read catalog change batches" on public.catalog_change_batches;
create policy "business owners read catalog change batches"
  on public.catalog_change_batches for select to authenticated
  using (public.has_business_role(business_id, array['owner', 'admin']));

drop policy if exists "business owners read catalog change items" on public.catalog_change_items;
create policy "business owners read catalog change items"
  on public.catalog_change_items for select to authenticated
  using (public.has_business_role(business_id, array['owner', 'admin']));

-- Lectura para el dueño y para la operación; escritura para nadie: sólo las
-- funciones de esta migración, que corren como su dueño.
revoke all on table public.catalog_change_batches, public.catalog_change_items
  from public, anon, authenticated, service_role;
grant select on table public.catalog_change_batches, public.catalog_change_items
  to authenticated, service_role;
-- La secuencia del ítem la usa sólo el dueño de las funciones; donde los permisos por
-- defecto del esquema se la dan a los roles de cliente, se la quita.
revoke all on sequence public.catalog_change_items_id_seq from public, anon, authenticated, service_role;

-- El rastro no se corrige: se agrega. Una imagen de antes que se puede editar no
-- sirve ni para auditar ni para revertir.
create or replace function private.catalog_change_item_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'catalog_change_items es inmutable: el rastro del catalogo no se corrige' using errcode = '55000';
end;
$$;
revoke all on function private.catalog_change_item_immutable() from public, anon, authenticated;

drop trigger if exists catalog_change_items_immutable on public.catalog_change_items;
create trigger catalog_change_items_immutable
  before update or delete on public.catalog_change_items
  for each row execute function private.catalog_change_item_immutable();

-- De un lote sólo puede cambiar, y una sola vez, la marca de que fue revertido y el
-- resultado de la reversión.
create or replace function private.catalog_change_batch_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'catalog_change_batches no se borra: es el rastro del catalogo' using errcode = '55000';
  end if;
  if new.id is distinct from old.id
     or new.business_id is distinct from old.business_id
     or new.source is distinct from old.source
     or new.actor_id is distinct from old.actor_id
     or new.session_id is distinct from old.session_id
     or new.request is distinct from old.request
     or new.request_sha256 is distinct from old.request_sha256
     or new.reverts_batch_id is distinct from old.reverts_batch_id
     or new.created_xact is distinct from old.created_xact
     or new.created_at is distinct from old.created_at
     or (old.rolled_back_at is not null and (
           new.rolled_back_at is distinct from old.rolled_back_at
           or new.rolled_back_by is distinct from old.rolled_back_by
           or new.rollback_batch_id is distinct from old.rollback_batch_id))
     or (old.result is not null and new.result is distinct from old.result) then
    raise exception 'catalog_change_batches es inmutable salvo la marca de reversion' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.catalog_change_batch_guard() from public, anon, authenticated;

drop trigger if exists catalog_change_batches_guard on public.catalog_change_batches;
create trigger catalog_change_batches_guard
  before update or delete on public.catalog_change_batches
  for each row execute function private.catalog_change_batch_guard();

-- ── 2. Piezas privadas ───────────────────────────────────────────────────────
-- Corren dentro de las RPC del catálogo (SECURITY DEFINER), con el rol de su dueño.
-- Ningún rol de cliente tiene USAGE sobre `private`.

-- Los seis campos que el comercio decide y que un lote puede cambiar. A propósito
-- no entra ninguna columna que `authenticated` no pueda leer en `products`
-- (unit_cost, verified_by): el rastro lo lee el dueño por PostgREST.
create or replace function private.catalog_change_image(p_product public.products)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'price', p_product.price,
    'price_status', p_product.price_status,
    'stock', p_product.stock,
    'available', p_product.available,
    'merchant_available', p_product.merchant_available,
    'is_verified', p_product.is_verified);
$$;
revoke all on function private.catalog_change_image(public.products) from public, anon, authenticated;

-- Abre el lote de un cambio. `apply_commercial_catalog_plan` abre el suyo y delega
-- las modificaciones en `apply_commercial_catalog_batch`: para que altas y
-- modificaciones queden bajo UN lote, el plan deja el id en una variable local a la
-- transacción y el lote la adopta sólo si es del mismo negocio, del mismo operador y
-- de ESTA transacción. Un id que no cumpla las tres cosas se ignora.
create or replace function private.catalog_change_begin(p_business_id uuid, p_source text, p_request jsonb)
returns uuid
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_outer text := nullif(current_setting('taba.catalog_change_batch', true), '');
  v_request jsonb := coalesce(p_request, '{}'::jsonb);
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'A catalog change needs an authenticated operator.' using errcode = '42501';
  end if;
  if v_outer is not null then
    select b.id into v_id
      from public.catalog_change_batches b
     where b.id::text = v_outer
       and b.business_id = p_business_id
       and b.actor_id = auth.uid()
       and b.created_xact = pg_current_xact_id();
    if found then
      return v_id;
    end if;
  end if;
  insert into public.catalog_change_batches (business_id, source, actor_id, session_id, request, request_sha256)
  values (p_business_id, p_source, auth.uid(), public.identity_session_id(), v_request,
          encode(sha256(convert_to(v_request::text, 'UTF8')), 'hex'))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.catalog_change_begin(uuid, text, jsonb) from public, anon, authenticated;

create or replace function private.catalog_change_log_item(
  p_batch_id uuid,
  p_action text,
  p_before public.products,
  p_after public.products,
  p_stock_count integer,
  p_reserved integer,
  p_movement_id uuid,
  p_detail jsonb
)
returns void
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_before jsonb := case when p_before.id is null then null else private.catalog_change_image(p_before) end;
  v_after jsonb := private.catalog_change_image(p_after);
  v_action text := p_action;
  v_ledger_rows integer;
  v_count_receipts integer;
begin
  -- Una fila que no movió ninguno de los seis campos queda escrita igual (alguien
  -- la pidió), pero no se confunde con un cambio.
  if v_action = 'updated' and v_before = v_after then
    v_action := 'unchanged';
  end if;
  -- Con un conteo se guarda además cuántas filas tiene el libro del producto, ya
  -- incluida la del propio conteo, y cuántos conteos de Caja Clara lleva. La fila del
  -- producto está bloqueada (Caja Clara también la bloquea antes de contar) y ninguna
  -- de las dos tablas se borra: comparar esos números más tarde dice, sin depender de
  -- relojes, si hubo algún movimiento o algún conteo después. El recibo de Caja Clara
  -- se fecha con la hora en que EMPEZÓ su transacción: comparado por fecha, un conteo
  -- hecho después del lote dentro de una transacción abierta antes pasaba por anterior.
  if p_stock_count is not null then
    select count(*)::integer into v_ledger_rows
      from public.inventory_movements m where m.product_id = p_after.id;
    select count(*)::integer into v_count_receipts
      from public.pos_stock_receipts r where r.product_id = p_after.id and r.kind = 'count';
  end if;
  insert into public.catalog_change_items (
    batch_id, business_id, product_id, sku, action, before, after,
    stock_count, reserved_at_count, ledger_rows, count_receipts, inventory_movement_id, detail)
  values (
    p_batch_id, p_after.business_id, p_after.id, p_after.sku, v_action, v_before, v_after,
    p_stock_count, case when p_stock_count is null then null else coalesce(p_reserved, 0) end,
    v_ledger_rows, v_count_receipts, p_movement_id, jsonb_strip_nulls(coalesce(p_detail, '{}'::jsonb)));
end;
$$;
revoke all on function private.catalog_change_log_item(uuid, text, public.products, public.products, integer, integer, uuid, jsonb)
  from public, anon, authenticated;

-- Un cambio de un solo producto (publicar, ocultar, verificar, completar la ficha):
-- un lote con un ítem. `p_before` es la fila que la RPC bloqueó antes de escribir.
create or replace function private.catalog_change_record_single(
  p_source text,
  p_before public.products,
  p_request jsonb,
  p_stock_count integer default null,
  p_reserved integer default null,
  p_movement_id uuid default null,
  p_detail jsonb default null
)
returns uuid
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_after public.products%rowtype;
  v_batch uuid;
begin
  select * into v_after from public.products p where p.id = p_before.id;
  v_batch := private.catalog_change_begin(p_before.business_id, p_source, p_request);
  perform private.catalog_change_log_item(v_batch, 'updated', p_before, v_after, p_stock_count, p_reserved, p_movement_id, p_detail);
  return v_batch;
end;
$$;
revoke all on function private.catalog_change_record_single(text, public.products, jsonb, integer, integer, uuid, jsonb)
  from public, anon, authenticated;

-- Lo que sigue a un conteo físico una vez escrito el disponible, con la misma
-- semántica que `pos_apply_stock_count`: fila de libro si hubo diferencia; conflicto
-- `count_below_reserved` si el conteo no cubre lo reservado; y si lo cubre, cierre del
-- conflicto abierto (decisión de owner/admin: las RPC que llaman acá ya lo exigen).
-- `p_reoffer` reofrece SÓLO cuando este conteo cerró un conflicto: la retención la
-- puso el sistema, no el comercio, y contar es la forma documentada de levantarla.
create or replace function private.catalog_stock_count_settle(
  p_business_id uuid,
  p_product_id uuid,
  p_previous_stock integer,
  p_new_stock integer,
  p_count integer,
  p_reserved integer,
  p_reason text,
  p_reference_type text,
  p_reference_id uuid,
  p_idempotency_key text,
  p_reoffer boolean
)
returns jsonb
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_previous integer := coalesce(p_previous_stock, 0);
  v_shortfall integer := greatest(coalesce(p_reserved, 0) - p_count, 0);
  v_reason text := left(btrim(coalesce(p_reason, '')), 300);
  v_movement uuid;
  v_conflict uuid;
  v_resolved uuid;
  v_reoffered boolean := false;
begin
  if p_new_stock - v_previous <> 0 then
    insert into public.inventory_movements (
      business_id, product_id, barcode_id, movement_type, quantity_delta, previous_stock, resulting_stock,
      unit_factor, reference_type, reference_id, reason, operator_id, idempotency_key)
    values (
      p_business_id, p_product_id, null, 'stock_count', p_new_stock - v_previous, v_previous, p_new_stock,
      1, p_reference_type, p_reference_id, v_reason, auth.uid(), p_idempotency_key)
    returning id into v_movement;
  end if;

  if v_shortfall > 0 then
    v_conflict := private.pos_record_conflict(p_business_id, p_product_id, 'count_below_reserved',
      p_new_stock - v_previous, p_new_stock - v_previous, v_shortfall, coalesce(p_reserved, 0));
  else
    update public.pos_stock_conflicts c
       set status = 'resolved', resolved_at = clock_timestamp(), resolved_by = auth.uid(),
           resolution = 'recounted', resolution_note = v_reason
     where c.product_id = p_product_id and c.status = 'open'
    returning c.id into v_resolved;
    if v_resolved is not null and coalesce(p_reoffer, false) and p_new_stock > 0 then
      v_reoffered := private.pos_try_reoffer(p_product_id);
    end if;
  end if;

  return jsonb_build_object(
    'movement_id', v_movement,
    'shortfall', v_shortfall,
    'conflict_id', coalesce(v_conflict, v_resolved),
    'conflict_resolved', v_resolved is not null,
    'reoffered', v_reoffered);
end;
$$;
revoke all on function private.catalog_stock_count_settle(uuid, uuid, integer, integer, integer, integer, text, text, uuid, text, boolean)
  from public, anon, authenticated;

-- ── 3. El lote comercial ─────────────────────────────────────────────────────
create or replace function public.apply_commercial_catalog_batch(p_business_id uuid, p_rows jsonb)
returns table (
  applied_sku text,
  applied_price numeric,
  applied_stock integer,
  applied_available boolean,
  applied_is_verified boolean,
  applied_republished boolean,
  applied_price_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_row jsonb;
  v_sku text;
  v_product public.products%rowtype;
  v_price numeric(12, 2);
  v_stock integer;
  v_publish boolean;
  v_price_pending boolean;
  v_next_price numeric(12, 2);
  v_next_stock integer;
  v_next_available boolean;
  v_next_verified boolean;
  v_next_price_status text;
  v_was_published boolean;
  v_was_held boolean;
  v_asset_ok boolean;
  v_alcohol_open boolean;
  v_seen text[] := '{}';
  v_batch_id uuid;
  v_expected_stock integer;
  v_reserved integer;
  v_missing text;
  v_settled jsonb;
  v_after public.products%rowtype;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can apply commercial catalog values.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Commercial rows must be a non-null JSON array.';
  end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Commercial rows must be a JSON array with 1 to 500 entries.';
  end if;

  -- La compuerta de licencia es la misma que usa set_commercial_product_publication.
  select coalesce(b.alcohol_sales_enabled, false) into v_alcohol_open
    from public.businesses b where b.id = p_business_id;
  v_alcohol_open := coalesce(v_alcohol_open, false);

  -- El rastro nace con el lote y muere con él: si una fila falla, la excepción se
  -- lleva las dos cosas. No existe un lote aplicado sin rastro ni al revés.
  v_batch_id := private.catalog_change_begin(p_business_id, 'commercial_batch', p_rows);

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_sku := btrim(coalesce(v_row ->> 'sku', ''));
    if v_sku = '' then
      raise exception 'Commercial row without sku.';
    end if;
    if v_sku = any (v_seen) then
      raise exception 'Duplicated sku % in the same batch.', v_sku;
    end if;
    v_seen := v_seen || v_sku;

    if v_sku ~* '(-staging-only$)|(^qa[-_])|(\yqa\y)|(\y(test|prueba|sintetica|sintetico|synthetic|fixture|dummy)\y)' then
      raise exception 'Refusing a QA-looking sku in the commercial catalog: %.', v_sku;
    end if;

    select * into v_product
      from public.products p
     where p.business_id = p_business_id
       and p.sku = v_sku
     for update;
    if not found then
      raise exception 'Unknown sku % for this business. Commercial import never creates products.', v_sku;
    end if;

    -- ── precio ────────────────────────────────────────────────────────────────
    if nullif(btrim(coalesce(v_row ->> 'price', '')), '') is null then
      v_price := null;
    elsif coalesce(v_row ->> 'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'Invalid price format for sku %.', v_sku;
    else
      v_price := (v_row ->> 'price')::numeric;
      if v_price <= 0 or v_price > 9999999999.99 then
        raise exception 'Invalid price value for sku %: must be greater than zero.', v_sku;
      end if;
    end if;

    -- ── volver a pendiente ────────────────────────────────────────────────────
    if v_row -> 'price_pending' is null or jsonb_typeof(v_row -> 'price_pending') = 'null' then
      v_price_pending := null;
    elsif jsonb_typeof(v_row -> 'price_pending') is distinct from 'boolean' then
      raise exception 'Invalid price_pending flag for sku %.', v_sku;
    else
      v_price_pending := (v_row ->> 'price_pending')::boolean;
    end if;
    if coalesce(v_price_pending, false) and v_price is not null then
      raise exception 'Row for sku % sets a price and marks it pending at the same time.', v_sku;
    end if;

    -- ── stock ─────────────────────────────────────────────────────────────────
    if nullif(btrim(coalesce(v_row ->> 'stock', '')), '') is null then
      v_stock := null;
    elsif coalesce(v_row ->> 'stock', '') !~ '^[0-9]+$' then
      raise exception 'Invalid stock format for sku %.', v_sku;
    else
      if (v_row ->> 'stock')::numeric > 2147483647 then
        raise exception 'Invalid stock range for sku %.', v_sku;
      end if;
      v_stock := (v_row ->> 'stock')::integer;
    end if;

    -- ── stock que el cliente tenía a la vista (opcional) ──────────────────────
    -- La fila ya está bloqueada: lo que se compara es el disponible de ESTE
    -- instante. `null` o vacío quiere decir «lo vi sin contar». El mensaje va en
    -- castellano y sin jerga porque el Panel lo muestra tal cual.
    if v_row ? 'expected_stock' then
      if jsonb_typeof(v_row -> 'expected_stock') = 'null' or btrim(v_row ->> 'expected_stock') = '' then
        v_expected_stock := null;
      elsif (v_row ->> 'expected_stock') !~ '^[0-9]+$' or (v_row ->> 'expected_stock')::numeric > 2147483647 then
        raise exception 'Invalid expected_stock format for sku %.', v_sku;
      else
        v_expected_stock := (v_row ->> 'expected_stock')::integer;
      end if;
      if v_product.stock is distinct from v_expected_stock then
        raise exception 'El stock de % (%) cambió mientras lo editabas: la pantalla mostraba % y ahora hay %. Actualizá el catálogo y volvé a contar; no se guardó ningún cambio del lote.',
          v_product.name, v_sku,
          coalesce(v_expected_stock::text, 'sin contar'), coalesce(v_product.stock::text, 'sin contar')
          using errcode = 'PT409';
      end if;
    end if;

    -- ── publicación ───────────────────────────────────────────────────────────
    if v_row -> 'publish' is null or jsonb_typeof(v_row -> 'publish') = 'null' then
      v_publish := null;
    elsif jsonb_typeof(v_row -> 'publish') is distinct from 'boolean' then
      raise exception 'Invalid publish flag for sku %.', v_sku;
    else
      v_publish := (v_row ->> 'publish')::boolean;
    end if;

    if v_price is null and v_stock is null and v_publish is null and v_price_pending is null then
      raise exception 'Commercial row for sku % does not decide anything.', v_sku;
    end if;

    -- Cargar un precio ES confirmarlo. Marcarlo pendiente lo devuelve al otro
    -- estado. Sin ninguna de las dos cosas, el estado no se toca.
    v_next_price_status := case
      when v_price is not null then 'confirmed'
      when coalesce(v_price_pending, false) then 'pending'
      else v_product.price_status
    end;
    v_next_price := coalesce(v_price, v_product.price);
    -- El stock de la fila es un CONTEO FÍSICO. `products.stock` es el disponible:
    -- lo que hay en la góndola menos lo que ya está comprometido con pedidos que
    -- todavía no salieron y con checkouts vivos. Escribir el conteo tal cual volvía
    -- a poner en venta unidades reservadas.
    if v_stock is null then
      v_reserved := null;
      v_next_stock := v_product.stock;
    else
      v_reserved := private.pos_reserved_quantity(v_product.id);
      v_next_stock := greatest(v_stock - v_reserved, 0);
    end if;
    v_next_verified := v_product.is_verified;
    v_was_published := v_product.is_verified and v_product.available;
    -- Retenido por el sistema: verificado, el comercio lo quiere a la venta, y lo
    -- único que lo tiene afuera es un conflicto de stock abierto.
    v_was_held := v_product.is_verified and v_product.merchant_available and not v_product.available
      and exists (select 1 from public.pos_stock_conflicts c
                   where c.product_id = v_product.id and c.status = 'open');

    -- Un producto sin precio confirmado no puede quedar disponible, pase lo que
    -- pase con el resto de la fila.
    if v_next_price_status <> 'confirmed' or coalesce(v_next_price, 0) <= 0 then
      v_next_available := false;
    else
      v_next_available := coalesce(v_publish, v_product.available);
    end if;

    -- La autoridad de imagen de la 108, invocada — no recalculada acá.
    v_asset_ok := public.product_commercial_image_valid(v_product);

    if coalesce(v_publish, false) then
      if v_next_price_status <> 'confirmed' then
        raise exception 'Refusing to publish sku % without a confirmed price state.', v_sku;
      end if;
      if v_next_price is null or v_next_price <= 0 then
        raise exception 'Refusing to publish sku % without a price.', v_sku;
      end if;
      if coalesce(v_next_stock, 0) <= 0 then
        if coalesce(v_stock, 0) > 0 then
          raise exception 'Refusing to publish sku % without stock: the % counted units are all reserved by open orders (% reserved).',
            v_sku, v_stock, v_reserved;
        end if;
        raise exception 'Refusing to publish sku % without stock.', v_sku;
      end if;
      if not v_product.is_active then
        raise exception 'Refusing to publish inactive sku %.', v_sku;
      end if;
      if not v_asset_ok then
        raise exception 'Refusing to publish sku %: it must have no image at all, or a complete image bound to an approved commercial asset — no partial or mismatched image state.', v_sku;
      end if;
      if coalesce(v_product.is_alcoholic, false) and not v_alcohol_open then
        raise exception 'Refusing to publish sku %: alcohol sales are not enabled for this business (license gate).', v_sku;
      end if;
      -- Publicar verifica la ficha. Si a la ficha le falta un dato, la base lo
      -- rechaza con el nombre de una restricción; acá se dice cuál, antes.
      if v_product.catalog_origin = 'commercial' then
        v_missing := concat_ws(', ',
          case when nullif(btrim(coalesce(v_product.brand, '')), '') is null then 'brand' end,
          case when nullif(btrim(coalesce(v_product.category, '')), '') is null then 'category' end,
          case when nullif(btrim(coalesce(v_product.subcategory, '')), '') is null then 'subcategory' end,
          case when nullif(btrim(coalesce(v_product.variant, '')), '') is null
                 or v_product.presentation is distinct from v_product.variant then 'variant' end,
          case when coalesce(v_product.capacity_value, 0) <= 0
                 or v_product.capacity_unit is null
                 or v_product.capacity_unit not in ('ml', 'l', 'g', 'kg', 'unidad')
                 or v_product.capacity is distinct from (v_product.capacity_value::text || ' ' || v_product.capacity_unit)
               then 'capacity' end,
          case when nullif(btrim(coalesce(v_product.packaging_type, '')), '') is null then 'packaging_type' end,
          case when nullif(btrim(coalesce(v_product.external_id, '')), '') is null then 'external_id' end,
          case when v_product.is_alcoholic is null then 'is_alcoholic' end);
        if v_missing <> '' then
          raise exception 'Refusing to publish sku %: its product data is incomplete (missing: %). Complete the product before publishing.',
            v_sku, v_missing;
        end if;
      end if;
      v_next_verified := true;
    end if;

    update public.products p
       set price = v_next_price,
           price_status = v_next_price_status,
           stock = v_next_stock,
           available = v_next_available
             and p.is_active
             and coalesce(v_next_stock, 0) > 0
             and v_next_price_status = 'confirmed'
             and coalesce(v_next_price, 0) > 0,
           -- La intención del comercio: publicar la enciende, ocultar la apaga y
           -- una fila que no decide publicación la deja como estaba. Sin esto,
           -- un borrador de CP (merchant_available = false) no se publicaba nunca.
           merchant_available = coalesce(v_publish, p.merchant_available),
           is_verified = v_next_verified,
           verified_at = case
             when v_next_verified and not v_product.is_verified then statement_timestamp()
             else p.verified_at
           end,
           verified_by = case
             when v_next_verified and not v_product.is_verified then auth.uid()
             else p.verified_by
           end,
           updated_at = statement_timestamp()
     where p.id = v_product.id
    returning p.sku, p.price, p.stock, p.available, p.is_verified, p.price_status
      into applied_sku, applied_price, applied_stock, applied_available,
           applied_is_verified, applied_price_status;

    -- ── REPUBLICACIÓN EXPLÍCITA ───────────────────────────────────────────────
    -- `products_fail_close_master_change` cuenta el precio como dato maestro y
    -- despublica al cambiarlo. El disparador está bien y no se toca; acá se
    -- vuelve a publicar lo que YA estaba publicado y lo que ESTA fila pidió
    -- publicar, siempre que siga cumpliendo TODAS las compuertas, incluida la de
    -- imagen y la de licencia de alcohol. Antes sólo se miraba lo ya publicado:
    -- «precio nuevo + publicar» sobre un producto verificado y agotado terminaba
    -- oculto y sin verificar, sin error.
    applied_republished := false;
    -- Una fila que pide OCULTAR no se republica aunque el precio haya cambiado.
    if (v_was_published or v_was_held or coalesce(v_publish, false)) and not applied_is_verified and v_publish is distinct from false then
      if applied_price_status = 'confirmed'
         and applied_price > 0
         and v_product.is_active
         and v_asset_ok
         and (not coalesce(v_product.is_alcoholic, false) or v_alcohol_open) then
        if coalesce(applied_stock, 0) > 0 and (v_was_published or coalesce(v_publish, false)) then
          update public.products p
             set is_verified = true,
                 available = true,
                 merchant_available = true,
                 verified_at = statement_timestamp(),
                 verified_by = auth.uid(),
                 updated_at = statement_timestamp()
           where p.id = v_product.id
          returning p.price, p.stock, p.available, p.is_verified, p.price_status
            into applied_price, applied_stock, applied_available,
                 applied_is_verified, applied_price_status;
          applied_republished := true;
        else
          -- No puede quedar a la venta en este paso: el conteo de la fila no dejó
          -- disponible (todo lo contado está reservado), o lo retiene un conflicto.
          -- Pero estaba verificado y a la venta, y el precio lo cambió el dueño por
          -- esta misma puerta: conserva la verificación. Medido antes: quedaba SIN
          -- VERIFICAR sin aviso, y no volvía cuando se liberaban los pedidos, se
          -- recibía mercadería o un conteo cerraba el conflicto. Acá no se enciende
          -- `available`: eso lo hace quien devuelva el stock o cierre el conflicto.
          update public.products p
             set is_verified = true,
                 verified_at = statement_timestamp(),
                 verified_by = auth.uid(),
                 updated_at = statement_timestamp()
           where p.id = v_product.id
          returning p.price, p.stock, p.available, p.is_verified, p.price_status
            into applied_price, applied_stock, applied_available,
                 applied_is_verified, applied_price_status;
        end if;
      end if;
    end if;

    -- ── CONTEO: libro y conflicto ─────────────────────────────────────────────
    v_settled := null;
    if v_stock is not null then
      v_settled := private.catalog_stock_count_settle(
        p_business_id, v_product.id, v_product.stock, v_next_stock, v_stock, v_reserved,
        format('Conteo físico desde el catálogo comercial: contado %s, reservado %s', v_stock, v_reserved),
        'catalog_change_batch', v_batch_id,
        'ccb_' || md5(v_batch_id::text || ':' || v_product.id::text),
        v_publish is distinct from false);
    end if;

    select * into v_after from public.products p where p.id = v_product.id;
    applied_price := v_after.price;
    applied_stock := v_after.stock;
    applied_available := v_after.available;
    applied_is_verified := v_after.is_verified;
    applied_price_status := v_after.price_status;

    -- Publicar es publicar: una fila que lo pidió y pasó las compuertas no puede
    -- volver «aplicada» con el producto escondido.
    if coalesce(v_publish, false) and not v_after.available then
      if exists (select 1 from public.pos_stock_conflicts c where c.product_id = v_product.id and c.status = 'open') then
        raise exception 'Refusing to publish sku %: it is held by an open stock conflict. Count its physical stock first.', v_sku;
      end if;
      raise exception 'Refusing to publish sku %: it passed the gates but did not end available. Nothing was applied.', v_sku;
    end if;

    perform private.catalog_change_log_item(
      v_batch_id, 'updated', v_product, v_after, v_stock, v_reserved,
      (v_settled ->> 'movement_id')::uuid,
      jsonb_build_object(
        -- Si la fila decidió la publicación (`publish` true o false). La reversión lo
        -- necesita: `available` también lo mueve el sistema, y por la imagen sola no
        -- se distingue «la planilla lo publicó» de «un conteo lo reofreció».
        'publish', v_publish,
        'republished', applied_republished,
        'shortfall', nullif((v_settled ->> 'shortfall')::integer, 0),
        'conflict_id', v_settled ->> 'conflict_id',
        'conflict_resolved', case when (v_settled ->> 'conflict_resolved')::boolean then true end,
        'reoffered', case when (v_settled ->> 'reoffered')::boolean then true end));
    return next;
  end loop;
end;
$function$;

revoke all on function public.apply_commercial_catalog_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_commercial_catalog_batch(uuid, jsonb) to authenticated;

-- ── 4. El plan: altas + modificaciones bajo un solo lote ─────────────────────
create or replace function public.apply_commercial_catalog_plan(
  p_business_id uuid,
  p_creates jsonb default '[]'::jsonb,
  p_updates jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_row jsonb;
  v_sku text;
  v_name text;
  v_category text;
  v_subcategory text;
  v_alcoholic boolean;
  v_minimum_age integer;
  v_price numeric(12, 2);
  v_stock integer;
  v_seen text[] := '{}';
  v_created integer := 0;
  v_updated integer := 0;
  v_creadas jsonb := '[]'::jsonb;
  v_batch_id uuid;
  v_new public.products%rowtype;
  v_update_rows jsonb := '[]'::jsonb;
  v_settled jsonb;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can apply a commercial catalog plan.'
      using errcode = '42501';
  end if;
  if p_creates is null or jsonb_typeof(p_creates) is distinct from 'array'
     or p_updates is null or jsonb_typeof(p_updates) is distinct from 'array' then
    raise exception 'Both creates and updates must be JSON arrays.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_creates) > 500 then
    raise exception 'A plan proposes at most 500 new products.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_creates) = 0 and jsonb_array_length(p_updates) = 0 then
    raise exception 'A plan that decides nothing is not applied.' using errcode = '22023';
  end if;

  v_batch_id := private.catalog_change_begin(p_business_id, 'commercial_plan',
    jsonb_build_object('creates', p_creates, 'updates', p_updates));

  -- ── ALTAS ──────────────────────────────────────────────────────────────────
  for v_row in select value from jsonb_array_elements(p_creates)
  loop
    v_sku := btrim(coalesce(v_row ->> 'sku', ''));
    if v_sku !~ '^[a-z0-9][a-z0-9-]{2,79}$' then
      raise exception 'Unstable sku for a new product: %. Use lowercase letters, digits and dashes.', v_sku
        using errcode = '22023';
    end if;
    if v_sku = any (v_seen) then
      raise exception 'Duplicated new sku % in the same plan.', v_sku using errcode = '22023';
    end if;
    v_seen := v_seen || v_sku;

    -- Un fixture de QA nunca entra al catálogo comercial. Es la misma regla que
    -- ya aplica el lote de modificaciones, con el mismo patrón.
    if v_sku ~* '(-staging-only$)|(^qa[-_])|(\yqa\y)|(\y(test|prueba|sintetica|sintetico|synthetic|fixture|dummy)\y)' then
      raise exception 'Refusing a QA-looking sku in the commercial catalog: %.', v_sku
        using errcode = '22023';
    end if;
    -- El pack con el que el local se surte no es un producto de góndola.
    if v_sku ~* '-(pack|bulto|caja)-[0-9]+$' then
      raise exception 'Sku % looks like a procurement pack, not a shelf product.', v_sku
        using errcode = '22023';
    end if;

    if exists (select 1 from public.products p
                where p.business_id = p_business_id and p.sku = v_sku) then
      raise exception 'Sku % already exists for this business. A plan never overwrites by creating.', v_sku
        using errcode = '23505';
    end if;

    v_name := btrim(coalesce(v_row ->> 'name', ''));
    if char_length(v_name) not between 2 and 160 then
      raise exception 'Invalid name for new sku %.', v_sku using errcode = '22023';
    end if;
    -- El importador mira SKU y nombre juntos; el servidor miraba sólo el SKU, así
    -- que una llamada directa podía dar de alta «coca-500» con nombre «QA TEST».
    if v_name ~* '(\yqa\y)|(\y(test|prueba|sintetica|sintetico|synthetic|fixture|dummy)\y)' then
      raise exception 'Refusing a QA-looking name in the commercial catalog for new sku %.', v_sku
        using errcode = '22023';
    end if;

    v_category := btrim(coalesce(v_row ->> 'category', ''));
    if v_category not in (
      'Gaseosas', 'Jugos', 'Mixers', 'Energizantes', 'Aguas', 'Aguas saborizadas', 'Isotónicas', 'Hielo',
      'Cervezas', 'Fernet', 'Aperitivos', 'Vinos', 'Espumantes', 'Destilados',
      'Snacks', 'Golosinas', 'Almacén', 'Limpieza', 'Higiene personal', 'Hogar', 'Mascotas', 'Otros'
    ) then
      raise exception 'Unknown category % for new sku %.', v_category, v_sku using errcode = '22023';
    end if;

    if jsonb_typeof(v_row -> 'is_alcoholic') is distinct from 'boolean' then
      raise exception 'New sku % must declare is_alcoholic explicitly as a boolean.', v_sku
        using errcode = '22023';
    end if;
    v_alcoholic := (v_row ->> 'is_alcoholic')::boolean;

    -- La góndola y la bandera tienen que decir lo mismo: es la misma partición
    -- que exige `products_verified_alcohol_coherence`, adelantada al alta para
    -- que el producto no nazca imposible de verificar.
    if v_alcoholic <> (v_category in ('Cervezas', 'Fernet', 'Aperitivos', 'Vinos', 'Espumantes', 'Destilados')) then
      raise exception 'Category % and is_alcoholic=% disagree for new sku %.', v_category, v_alcoholic, v_sku
        using errcode = '22023';
    end if;

    if v_alcoholic then
      v_minimum_age := coalesce(nullif(btrim(coalesce(v_row ->> 'minimum_age', '')), '')::integer, 18);
      if v_minimum_age not between 18 and 99 then
        raise exception 'Invalid minimum_age for new sku %.', v_sku using errcode = '22023';
      end if;
    else
      v_minimum_age := null;
      if nullif(btrim(coalesce(v_row ->> 'minimum_age', '')), '') is not null then
        raise exception 'New sku % is not alcoholic and cannot carry a minimum age.', v_sku
          using errcode = '22023';
      end if;
    end if;

    if nullif(btrim(coalesce(v_row ->> 'price', '')), '') is null then
      v_price := null;
    elsif coalesce(v_row ->> 'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'Invalid price format for new sku %.', v_sku using errcode = '22023';
    else
      v_price := (v_row ->> 'price')::numeric;
      if v_price <= 0 or v_price > 9999999999.99 then
        raise exception 'Invalid price value for new sku %.', v_sku using errcode = '22023';
      end if;
    end if;

    v_stock := public.commercial_catalog_parse_stock(v_row);

    -- Publicar no viaja en un alta. Si alguien lo manda igual, se dice por qué
    -- no, en vez de ignorar la clave en silencio.
    if coalesce((v_row ->> 'publish')::text, 'false') not in ('false', '') then
      raise exception 'A newly proposed product is always created hidden: publish sku % in a second pass.', v_sku
        using errcode = '22023';
    end if;

    v_subcategory := nullif(btrim(coalesce(v_row ->> 'subcategory', '')), '');
    if v_subcategory is not null and char_length(v_subcategory) > 80 then
      raise exception 'Invalid subcategory for new sku %.', v_sku using errcode = '22023';
    end if;

    insert into public.products (
      business_id, sku, external_id, name, category, subcategory,
      price, price_status, stock,
      -- Nace ACTIVO pero NO disponible y NO verificado: existe para el Panel,
      -- no existe para la góndola. `available` es lo que decide si se puede
      -- comprar, y sólo lo enciende la segunda pasada con sus compuertas.
      is_active, available, is_verified,
      is_alcoholic, minimum_age, catalog_origin
    ) values (
      p_business_id, v_sku, v_sku, v_name, v_category, v_subcategory,
      coalesce(v_price, 0),
      case when v_price is null then 'pending' else 'confirmed' end,
      v_stock,
      true, false, false,
      v_alcoholic, v_minimum_age, 'commercial'
    )
    returning * into v_new;

    -- Un producto que nace no tiene imagen de antes ni reservas: su stock es el
    -- primer conteo, sin nada que restar. Deja su fila en el libro como cualquier
    -- otro conteo, para que el libro del producto arranque en cero y encadene.
    v_settled := null;
    if v_stock is not null then
      v_settled := private.catalog_stock_count_settle(
        p_business_id, v_new.id, 0, v_stock, v_stock, 0,
        format('Primer conteo al dar de alta el producto: contado %s', v_stock),
        'catalog_change_batch', v_batch_id,
        'cca_' || md5(v_batch_id::text || ':' || v_new.id::text),
        false);
    end if;
    perform private.catalog_change_log_item(
      v_batch_id, 'created', null::public.products, v_new, v_stock, 0,
      (v_settled ->> 'movement_id')::uuid, null);

    v_created := v_created + 1;
    v_creadas := v_creadas || jsonb_build_array(jsonb_build_object(
      'sku', v_sku, 'name', v_name, 'category', v_category,
      'is_alcoholic', v_alcoholic, 'available', false, 'is_verified', false
    ));
  end loop;

  -- ── MODIFICACIONES ─────────────────────────────────────────────────────────
  -- Se delegan tal cual. La misma transacción, las mismas compuertas. El lote
  -- adopta el rastro de este plan (ver private.catalog_change_begin) y la variable
  -- se limpia enseguida para que no la herede otra llamada de la misma transacción.
  if jsonb_array_length(p_updates) > 0 then
    perform set_config('taba.catalog_change_batch', v_batch_id::text, true);
    select count(*), coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      into v_updated, v_update_rows
      from public.apply_commercial_catalog_batch(p_business_id, p_updates) r;
    perform set_config('taba.catalog_change_batch', '', true);
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'updated', v_updated,
    'rows', v_creadas,
    -- Nuevo, aditivo: con qué id se revierte este plan y cómo quedó cada
    -- modificación. Antes el plan tiraba ese resultado y devolvía sólo la cuenta.
    'batch_id', v_batch_id,
    'update_rows', v_update_rows
  );
end;
$function$;

revoke all on function public.apply_commercial_catalog_plan(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_commercial_catalog_plan(uuid, jsonb, jsonb) to authenticated;

-- ── 5. Completar la ficha de un producto ─────────────────────────────────────
create or replace function public.complete_scanned_product(p_product_id uuid, p_details jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_product public.products%rowtype;
  v_allowed text[] := array['name', 'brand', 'category', 'variant', 'capacity_value', 'capacity_unit', 'units_per_pack', 'price', 'price_pending', 'unit_cost', 'stock',
    'subcategory', 'packaging_type', 'expected_stock'];
  v_price numeric(12, 2);
  v_price_pending boolean;
  v_stock integer;
  v_units integer;
  v_capacity_value numeric;
  v_capacity_unit text;
  v_before public.products%rowtype;
  v_expected_stock integer;
  v_reserved integer;
  v_new_stock integer;
  v_settled jsonb;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'producto inexistente' using errcode = 'P0002';
  end if;
  if not public.has_business_role(v_product.business_id, array['owner', 'admin']) then
    raise exception 'completar el producto requiere owner o admin' using errcode = '42501';
  end if;
  if coalesce(p_details, '{}'::jsonb) - v_allowed <> '{}'::jsonb then
    raise exception 'payload no permitido' using errcode = '22023';
  end if;
  v_before := v_product;

  v_price_pending := coalesce((p_details->>'price_pending')::boolean, false);
  v_price := case when v_price_pending then 0 else round(coalesce((p_details->>'price')::numeric, -1), 2) end;
  -- Sin la clave `stock` (o con null) la ficha no trae conteo. Sobre un producto ya
  -- contado eso quiere decir «no toqué el stock»: antes era obligatorio reenviarlo, y
  -- reenviar el DISPONIBLE como si fuera un conteo le resta lo reservado cada vez.
  v_stock := (p_details->>'stock')::integer;
  v_units := coalesce((p_details->>'units_per_pack')::integer, 0);
  v_capacity_value := coalesce((p_details->>'capacity_value')::numeric, 0);
  v_capacity_unit := btrim(coalesce(p_details->>'capacity_unit', ''));

  if char_length(btrim(coalesce(p_details->>'name', ''))) not between 2 and 160
     or char_length(btrim(coalesce(p_details->>'brand', ''))) not between 2 and 80
     or char_length(btrim(coalesce(p_details->>'category', ''))) not between 2 and 80
     or char_length(btrim(coalesce(p_details->>'variant', ''))) not between 1 and 80 then
    raise exception 'faltan datos obligatorios del producto' using errcode = '22023';
  end if;
  -- Envase y subfamilia son opcionales acá (el alta escaneada no los manda), pero
  -- sin ellos la ficha no se puede verificar. Antes sólo los escribía el import
  -- técnico: un alta de planilla no tenía por dónde completarlos.
  if (p_details ? 'subcategory' and char_length(btrim(coalesce(p_details->>'subcategory', ''))) not between 1 and 80)
     or (p_details ? 'packaging_type' and char_length(btrim(coalesce(p_details->>'packaging_type', ''))) not between 1 and 80) then
    raise exception 'envase o subfamilia invalidos' using errcode = '22023';
  end if;
  if v_capacity_value <= 0 or v_capacity_unit not in ('ml', 'l', 'g', 'kg', 'unidad') then
    raise exception 'presentacion invalida' using errcode = '22023';
  end if;
  if v_units < 1 then
    raise exception 'unidades por pack invalidas' using errcode = '22023';
  end if;
  if v_stock < 0 or (v_stock is null and v_product.stock is null) then
    raise exception 'stock invalido' using errcode = '22023';
  end if;
  if not v_price_pending and v_price <= 0 then
    raise exception 'precio invalido' using errcode = '22023';
  end if;

  -- La misma guarda optimista del lote comercial, opcional.
  if p_details ? 'expected_stock' then
    if jsonb_typeof(p_details -> 'expected_stock') = 'null' or btrim(p_details ->> 'expected_stock') = '' then
      v_expected_stock := null;
    elsif (p_details ->> 'expected_stock') !~ '^[0-9]+$' or (p_details ->> 'expected_stock')::numeric > 2147483647 then
      raise exception 'stock esperado invalido' using errcode = '22023';
    else
      v_expected_stock := (p_details ->> 'expected_stock')::integer;
    end if;
    if v_product.stock is distinct from v_expected_stock then
      raise exception 'El stock de % cambió mientras lo editabas: la pantalla mostraba % y ahora hay %. Actualizá el producto y volvé a contar; no se guardó nada.',
        v_product.name, coalesce(v_expected_stock::text, 'sin contar'), coalesce(v_product.stock::text, 'sin contar')
        using errcode = 'PT409';
    end if;
  end if;

  -- El stock de la ficha es un conteo físico: se traduce a disponible igual que
  -- en el lote comercial y en Caja Clara.
  if v_stock is null then
    v_reserved := null;
    v_new_stock := v_product.stock;
  else
    v_reserved := private.pos_reserved_quantity(v_product.id);
    v_new_stock := greatest(v_stock - v_reserved, 0);
  end if;

  update public.products set
    name = btrim(p_details->>'name'),
    brand = btrim(p_details->>'brand'),
    category = btrim(p_details->>'category'),
    subcategory = case when p_details ? 'subcategory' then btrim(p_details->>'subcategory') else subcategory end,
    variant = btrim(p_details->>'variant'),
    presentation = btrim(p_details->>'variant'),
    capacity_value = v_capacity_value,
    capacity_unit = v_capacity_unit,
    capacity = v_capacity_value::text || ' ' || v_capacity_unit,
    packaging_type = case when p_details ? 'packaging_type' then btrim(p_details->>'packaging_type') else packaging_type end,
    units_per_pack = v_units,
    price = v_price,
    price_status = case when v_price_pending then 'pending' else 'confirmed' end,
    unit_cost = nullif(p_details->>'unit_cost', '')::numeric,
    stock = v_new_stock,
    -- Completar la ficha nunca publica: sólo conserva lo que ya estaba a la venta
    -- y lo apaga si deja de poder venderse. Antes escribía `true` sin mirar la
    -- intención del comercio, y sobre un producto verificado que el comercio
    -- había ocultado fallaba con un 23514 crudo.
    available = available and (not v_price_pending) and v_new_stock > 0 and is_verified,
    updated_at = now()
  where id = v_product.id
  returning * into v_product;

  if v_stock is not null then
    v_settled := private.catalog_stock_count_settle(
      v_product.business_id, v_product.id, v_before.stock, v_new_stock, v_stock, v_reserved,
      format('Conteo físico al completar la ficha: contado %s, reservado %s', v_stock, v_reserved),
      'scanned_product', v_product.id,
      'csp_' || md5(v_product.id::text || ':' || txid_current()::text || ':' || clock_timestamp()::text),
      true);
    select * into v_product from public.products where id = v_product.id;
  end if;

  insert into public.scanned_product_audit (business_id, product_id, gtin, action, actor_id, detail)
  values (
    v_product.business_id,
    v_product.id,
    coalesce((select pb.gtin from public.product_barcodes pb where pb.product_id = v_product.id and pb.is_primary limit 1), ''),
    case when v_price_pending then 'completed' else 'price_confirmed' end,
    auth.uid(),
    jsonb_build_object('price_status', v_product.price_status, 'stock', v_product.stock)
  );

  perform private.catalog_change_record_single(
    'scanned_product', v_before, coalesce(p_details, '{}'::jsonb) - 'unit_cost',
    v_stock, v_reserved, (v_settled ->> 'movement_id')::uuid,
    jsonb_build_object(
      'shortfall', nullif((v_settled ->> 'shortfall')::integer, 0),
      'conflict_id', v_settled ->> 'conflict_id',
      'conflict_resolved', case when (v_settled ->> 'conflict_resolved')::boolean then true end,
      'reoffered', case when (v_settled ->> 'reoffered')::boolean then true end));

  return public.get_scanned_product_readiness(v_product.id);
end;
$function$;

revoke all on function public.complete_scanned_product(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_scanned_product(uuid, jsonb) to authenticated;

-- ── 6. Movimientos de inventario: el disponible manda sobre la publicación ───
create or replace function public.apply_inventory_movement(
  p_business_id uuid,
  p_product_id uuid,
  p_barcode_id uuid,
  p_movement_type text,
  p_package_quantity integer,
  p_direction integer,
  p_reference_type text,
  p_reference_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns public.inventory_movements
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_product public.products%rowtype;
  v_barcode public.product_barcodes%rowtype;
  v_existing public.inventory_movements%rowtype;
  v_result public.inventory_movements%rowtype;
  v_factor integer := 1;
  v_delta integer;
  v_new integer;
  v_reserved integer;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if p_movement_type not in ('purchase_receipt','manual_adjustment','stock_count','sale','online_order_reservation','online_order_release','cancellation_return','damage','loss','expiration','supplier_return') then raise exception 'tipo de movimiento invalido' using errcode = '22023'; end if;
  if p_package_quantity < 1 or p_direction not in (-1, 1) then raise exception 'cantidad o direccion invalida' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select m.* into v_existing from public.inventory_movements m where m.business_id = p_business_id and m.idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;
  select p.* into v_product from public.products p where p.id = p_product_id and p.business_id = p_business_id for update;
  if not found then raise exception 'producto inexistente' using errcode = 'P0002'; end if;
  if p_barcode_id is not null then
    select b.* into v_barcode from public.product_barcodes b where b.id = p_barcode_id and b.business_id = p_business_id and b.product_id = p_product_id and b.is_active;
    if not found then raise exception 'barcode no corresponde al producto' using errcode = '22023'; end if;
    v_factor := v_barcode.unit_factor;
  end if;
  v_delta := p_package_quantity * v_factor * p_direction;
  -- El conteo del escáner del Panel (el único que llega con el código escaneado) manda
  -- la diferencia entre lo que la persona contó en la góndola y el DISPONIBLE. Lo que
  -- contó incluye las unidades apartadas para pedidos y checkouts abiertos, y acá no
  -- llega el conteo sino la diferencia: aplicarla volvería a poner a la venta lo
  -- apartado (3 disponibles + 2 apartadas, cuenta 5, quedaban 5 disponibles). Mientras
  -- haya unidades apartadas se rechaza, sin escribir nada, y se dice por dónde se cuenta
  -- bien. Un ajuste sin código escaneado (una restitución, un script) no cambia.
  if p_movement_type = 'stock_count' and p_barcode_id is not null then
    v_reserved := private.pos_reserved_quantity(p_product_id);
    if v_reserved > 0 then
      raise exception 'Este producto tiene % unidades apartadas para pedidos abiertos y el conteo del escáner las volvería a poner a la venta. Cargá el conteo desde Catálogo (Stock contado), que las descuenta, o contá de nuevo cuando esos pedidos se entreguen.', v_reserved
        using errcode = '22023', detail = 'STOCK_COUNT_HAS_RESERVED';
    end if;
  end if;
  if coalesce(v_product.stock, 0) + v_delta < 0 then raise exception 'stock negativo bloqueado' using errcode = '23514'; end if;
  if p_movement_type in ('manual_adjustment','stock_count','damage','loss','expiration','supplier_return') and char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then raise exception 'motivo requerido' using errcode = '22023'; end if;
  v_new := coalesce(v_product.stock, 0) + v_delta;
  -- Llevar a 0 un producto publicado lo saca de la venta en el mismo UPDATE (la
  -- restricción de disponibilidad exige stock > 0; antes esto era un 23514 crudo y
  -- la última unidad rota seguía ofrecida). Este UPDATE sólo puede apagar.
  update public.products set stock = v_new, available = available and v_new > 0 where id = p_product_id;
  insert into public.inventory_movements(business_id, product_id, barcode_id, movement_type, quantity_delta, previous_stock, resulting_stock, unit_factor, reference_type, reference_id, reason, operator_id, idempotency_key)
  values (p_business_id, p_product_id, p_barcode_id, p_movement_type, v_delta, coalesce(v_product.stock,0), coalesce(v_product.stock,0)+v_delta, v_factor, nullif(btrim(coalesce(p_reference_type,'')),''), p_reference_id, nullif(btrim(coalesce(p_reason,'')),''), auth.uid(), p_idempotency_key)
  returning * into v_result;
  -- Cuando vuelve a haber disponible se reofrece con la misma regla que usan los
  -- movimientos de Caja Clara: sólo si el comercio lo quería a la venta y se
  -- cumplen todas las compuertas (verificado, activo, precio confirmado, imagen
  -- válida, licencia de alcohol, sin conflicto de stock abierto).
  if coalesce(v_product.stock, 0) <= 0 and v_new > 0 then
    perform private.pos_try_reoffer(p_product_id);
  end if;
  return v_result;
end;
$function$;

revoke all on function public.apply_inventory_movement(uuid, uuid, uuid, text, integer, integer, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_inventory_movement(uuid, uuid, uuid, text, integer, integer, text, uuid, text, text)
  to authenticated;

-- ── 7. Publicar, ocultar y verificar dejan rastro ────────────────────────────
create or replace function public.set_commercial_product_publication(p_business_id uuid, p_sku text, p_publish boolean)
returns table (
  applied_sku text,
  applied_available boolean,
  applied_is_verified boolean,
  applied_price numeric,
  applied_stock integer,
  applied_price_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_sku text := btrim(coalesce(p_sku, ''));
  v_product public.products%rowtype;
  v_business public.businesses%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can publish or hide a commercial product.'
      using errcode = '42501';
  end if;
  if v_sku = '' then
    raise exception 'Missing sku.' using errcode = '22023';
  end if;
  if p_publish is null then
    raise exception 'p_publish must be true or false.' using errcode = '22023';
  end if;

  select * into v_product
    from public.products p
   where p.business_id = p_business_id
     and p.sku = v_sku
   for update;
  if not found then
    raise exception 'Unknown sku % for this business.', v_sku using errcode = 'P0002';
  end if;

  -- ── ocultar: siempre permitido para owner/admin, marca tanto available como merchant_available ──
  if not p_publish then
    return query
      update public.products p
         set available = false,
             merchant_available = false,
             updated_at = statement_timestamp()
       where p.id = v_product.id
      returning p.sku, p.available, p.is_verified, p.price, p.stock, p.price_status;
    perform private.catalog_change_record_single('publication', v_product,
      jsonb_build_object('sku', v_sku, 'publish', false));
    return;
  end if;

  -- La publicación desde el Panel sólo opera sobre la autoridad comercial.
  if coalesce(v_product.catalog_origin, '') <> 'commercial' then
    raise exception 'Refusing to publish non-commercial sku %.', v_sku;
  end if;

  -- ── publicar: producto YA verificado, nunca se verifica acá por primera vez ─
  if not v_product.is_verified then
    raise exception 'Sku % is not verified yet. Verify its master data first (commercial import), then publish.', v_sku;
  end if;
  if not v_product.is_active then
    raise exception 'Refusing to publish inactive sku %.', v_sku;
  end if;
  if v_product.price_status <> 'confirmed' or coalesce(v_product.price, 0) <= 0 then
    raise exception 'Refusing to publish sku % without a confirmed price.', v_sku;
  end if;
  if coalesce(v_product.stock, 0) <= 0 then
    raise exception 'Refusing to publish sku % without stock.', v_sku;
  end if;
  if not public.product_commercial_image_valid(v_product) then
    raise exception 'Refusing to publish sku %: it must have no image at all, or a complete image bound to an approved commercial asset.', v_sku;
  end if;
  if v_product.is_alcoholic then
    select * into v_business from public.businesses b where b.id = p_business_id;
    if not found or coalesce(v_business.alcohol_sales_enabled, false) is not true then
      raise exception 'Refusing to publish sku %: alcohol sales are not enabled for this business (license gate).', v_sku;
    end if;
  end if;

  return query
    update public.products p
       set available = true,
           merchant_available = true,
           updated_at = statement_timestamp()
     where p.id = v_product.id
    returning p.sku, p.available, p.is_verified, p.price, p.stock, p.price_status;
  perform private.catalog_change_record_single('publication', v_product,
    jsonb_build_object('sku', v_sku, 'publish', true));
end;
$function$;

revoke all on function public.set_commercial_product_publication(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.set_commercial_product_publication(uuid, text, boolean) to authenticated;

create or replace function public.publish_catalog_product(
  p_business_id uuid,
  p_external_id text,
  p_available boolean default false
)
returns table (
  product_id uuid,
  published_external_id text,
  published_sku text,
  published_is_verified boolean,
  published_available boolean,
  published_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_product public.products%rowtype;
  v_asset public.catalog_assets%rowtype;
  v_alcohol_open boolean;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can publish catalog products.';
  end if;

  select *
    into v_product
    from public.products p
   where p.business_id = p_business_id
     and p.external_id = btrim(p_external_id)
   for update;
  if not found then raise exception 'Catalog product not found.'; end if;

  if btrim(coalesce(v_product.variant, '')) = ''
     or v_product.capacity_value is null
     or v_product.capacity_value <= 0
     or v_product.capacity_unit not in ('ml', 'l', 'g', 'kg', 'unidad')
     or v_product.presentation is distinct from v_product.variant
     or v_product.capacity is distinct from (
       v_product.capacity_value::text || ' ' || v_product.capacity_unit
     ) then
    raise exception 'Catalog product has invalid structured presentation or capacity.';
  end if;

  select *
    into v_asset
    from public.catalog_assets ca
   where ca.id = v_product.catalog_asset_id
     and ca.business_id = p_business_id
     and ca.external_id = v_product.external_id
     and ca.sku = v_product.sku;
  if not found
     or v_product.image_url is distinct from v_asset.master_path
     or v_product.image_sha256 is distinct from v_asset.master_sha256
     or v_product.image_thumbnail_url is distinct from v_asset.thumbnail_path
     or v_product.image_thumbnail_sha256 is distinct from v_asset.thumbnail_sha256
     or v_product.source_image_sha256 is distinct from v_asset.source_sha256
     then
    raise exception 'Catalog product asset authority does not match.';
  end if;

  select coalesce(b.alcohol_sales_enabled, false) into v_alcohol_open
    from public.businesses b where b.id = p_business_id;
  v_alcohol_open := coalesce(v_alcohol_open, false);

  update public.products p
     set is_verified = true,
         verified_at = statement_timestamp(),
         verified_by = auth.uid(),
         -- Verificar no es vender: queda disponible sólo si además se puede vender
         -- (precio confirmado, licencia de alcohol). Sin esas dos condiciones un
         -- precio pendiente daba un 23514 crudo y un alcohólico quedaba ofrecido
         -- con la licencia cerrada.
         available = coalesce(p_available, false) and p.is_active and coalesce(p.stock, 0) > 0
           and p.price_status = 'confirmed' and p.price > 0
           and (not coalesce(p.is_alcoholic, false) or v_alcohol_open),
         -- Pedir que quede disponible ES la intención del comercio, y sacar de la
         -- venta algo que hoy se vende también (si no, la próxima reserva vencida lo
         -- volvía a ofrecer). Sobre un producto que ya no estaba a la venta,
         -- `p_available = false` no toca la intención: esta puerta también se usa para
         -- volver a verificar sin decidir qué se vende.
         merchant_available = case
           when coalesce(p_available, false) then true
           when p.available then false
           else p.merchant_available
         end,
         updated_at = statement_timestamp()
   where p.id = v_product.id
  returning
    p.id,
    p.external_id,
    p.sku,
    p.is_verified,
    p.available,
    p.verified_at
  into
    product_id,
    published_external_id,
    published_sku,
    published_is_verified,
    published_available,
    published_at;
  perform private.catalog_change_record_single('verification', v_product,
    jsonb_build_object('external_id', btrim(p_external_id), 'available', coalesce(p_available, false)));
  return next;
end;
$function$;

revoke all on function public.publish_catalog_product(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.publish_catalog_product(uuid, text, boolean) to authenticated;

create or replace function public.unpublish_catalog_product(p_business_id uuid, p_external_id text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_updated integer;
  v_product public.products%rowtype;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can unpublish catalog products.';
  end if;
  -- La fila se lee bloqueada antes de escribir para poder guardar su imagen previa.
  select * into v_product
    from public.products p
   where p.business_id = p_business_id
     and p.external_id = btrim(p_external_id)
   for update;
  update public.products p
     set available = false,
         merchant_available = false,
         is_verified = false,
         verified_at = null,
         verified_by = null,
         updated_at = statement_timestamp()
   where p.business_id = p_business_id
     and p.external_id = btrim(p_external_id);
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    perform private.catalog_change_record_single('unpublish', v_product,
      jsonb_build_object('external_id', btrim(p_external_id)));
  end if;
  return v_updated = 1;
end;
$function$;

revoke all on function public.unpublish_catalog_product(uuid, text) from public, anon, authenticated;
grant execute on function public.unpublish_catalog_product(uuid, text) to authenticated;

-- ── 8. Reversión de un lote comercial ────────────────────────────────────────
-- REGLAS (todas por producto; un producto nunca se pisa):
--
--   precio y publicación   Se restauran sólo si precio, estado del precio, intención
--                          del comercio y verificado siguen IGUALES a como los dejó
--                          el lote. Si alguno cambió, el producto se informa como
--                          `skipped_changed` y no se toca. `available` no entra en
--                          esa comparación porque lo mueve el sistema (se agota, se
--                          reofrece, se retiene por conflicto).
--   disponible             Si el lote cambió la publicación, vuelve a la de antes; si
--                          no, queda como está hoy. En los dos casos sólo si el
--                          producto se puede vender AHORA (activo, stock, precio
--                          confirmado, imagen válida, licencia de alcohol).
--                          Vale también cuando lo ÚNICO que cambió la fila fue el
--                          disponible (`publish = true` sobre un producto verificado
--                          cuya intención ya estaba encendida) y cuando el stock de
--                          esa fila ya no se puede devolver: la planilla lo puso a la
--                          venta y la reversión lo saca. Medido antes de esta regla:
--                          esa fila se informaba `skipped_changed ["stock"]` y el
--                          producto seguía a la venta.
--   verificado             La reversión nunca verifica una ficha que hoy no está
--                          verificada: verificar es un acto explícito (publicar).
--                          Sí conserva verificada la que ya lo está cuando el
--                          disparador de dato maestro la baja por restaurar el precio.
--   stock                  Nunca a ciegas. Se restaura sólo si el lote lo cambió y
--                          NADA se movió desde entonces: el disponible es el que dejó
--                          el lote, lo reservado es lo mismo que en el conteo, el
--                          libro del producto tiene las mismas filas que al contar,
--                          nadie volvió a contarlo (ni otro lote, ni la ficha, ni Caja
--                          Clara: se compara la CANTIDAD de conteos, no sus fechas) y
--                          no hay conflicto de stock abierto. Si no, el stock queda
--                          como está y se informa
--                          (`kept_open_conflict`, `kept_recounted_since`,
--                          `kept_moved_since`).
--   retención              Si el conteo del lote había CERRADO un conflicto de stock,
--                          deshacer ese conteo deshace también el cierre: la reversión
--                          vuelve a abrir la retención con el mismo tipo y el mismo
--                          faltante (`private.pos_record_conflict`) y el producto
--                          queda fuera de la venta hasta un conteo real. Vale también
--                          cuando el stock NO se restaura: el conteo que levantó la
--                          retención es justamente el que se está dando por malo.
--                          No se reabre si ya hay un conflicto abierto ni si alguien
--                          volvió a contar el producto después del lote (ese conteo
--                          manda, y entonces tampoco se restaura el stock).
--                          Medido antes de esta regla: la reversión devolvía el
--                          disponible anterior (0) y dejaba el conflicto cerrado; la
--                          primera recepción de mercadería reofrecía el producto con
--                          unidades que ya estaban debidas a pedidos (3 disponibles +
--                          2 reservadas contra 4 en la góndola).
--   altas                  Un producto creado por el plan no se borra: nació oculto
--                          y sin verificar, y así queda (`skipped_created`).
--
-- `skipped_changed` quiere decir que la reversión no escribió precio, estado del
-- precio, intención, verificado, disponible ni stock de ese producto. La retención es
-- aparte: es del sistema, no del comercio, y se informa en `hold`.
--
-- La imagen de antes es la del producto, no una promesa sobre el futuro: un producto
-- que vuelve a «verificado, con stock, intención encendida y fuera de la venta» puede
-- ser reofrecido por el sistema cuando se libere una reserva o se cancele un pedido
-- tomados mientras estuvo publicado, igual que antes del lote. Medido: el checkout de
-- un cliente vence después de la reversión y el producto vuelve a la
-- venta. La reversión no apaga una intención que el lote no tocó; lo AVISA: el ítem
-- sale con `publication = off_sale_intent_on` y el resultado los cuenta. Para sacarlo
-- de la venta sin vuelta se oculta (`set_commercial_product_publication`).
--
-- Escribe su propio lote (`source = 'rollback'`) con la imagen de antes y de después
-- de cada producto, y es idempotente: la segunda llamada devuelve el resultado de la
-- primera sin tocar nada.
create or replace function public.rollback_commercial_catalog_batch(p_business_id uuid, p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_batch public.catalog_change_batches%rowtype;
  v_rollback_id uuid;
  v_item public.catalog_change_items%rowtype;
  v_product public.products%rowtype;
  v_now public.products%rowtype;
  v_alcohol_open boolean;
  v_result jsonb;
  v_items jsonb := '[]'::jsonb;
  v_changed text[];
  v_outcome text;
  v_stock_outcome text;
  v_publication text;
  v_t_price numeric(12, 2);
  v_t_price_status text;
  v_t_merchant boolean;
  v_t_verified boolean;
  v_t_stock integer;
  v_want_available boolean;
  v_publication_changed boolean;
  v_restore_stock boolean;
  v_reserved integer;
  v_movement uuid;
  v_can_sell boolean;
  v_had_open boolean;
  v_recounted boolean;
  v_ledger_rows integer;
  v_count_receipts integer;
  v_publication_decided boolean;
  v_hold text;
  v_closed public.pos_stock_conflicts%rowtype;
  v_new_conflict uuid;
  v_restored integer := 0;
  v_skipped_changed integer := 0;
  v_skipped_created integer := 0;
  v_unchanged integer := 0;
  v_holds_reopened integer := 0;
  v_off_sale_intent_on integer := 0;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can roll back a commercial catalog batch.'
      using errcode = '42501';
  end if;
  if p_batch_id is null then
    raise exception 'Missing batch id.' using errcode = '22023';
  end if;

  select * into v_batch
    from public.catalog_change_batches b
   where b.id = p_batch_id
     and b.business_id = p_business_id
   for update;
  if not found then
    raise exception 'Unknown catalog batch for this business.' using errcode = 'P0002';
  end if;
  if v_batch.source not in ('commercial_batch', 'commercial_plan') then
    raise exception 'Only a commercial batch or plan can be rolled back (this one is %).', v_batch.source
      using errcode = '22023';
  end if;

  -- Idempotente: el lote ya fue revertido. Se devuelve aquel resultado.
  if v_batch.rollback_batch_id is not null then
    select b.result into v_result
      from public.catalog_change_batches b where b.id = v_batch.rollback_batch_id;
    return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('replay', true);
  end if;

  select coalesce(b.alcohol_sales_enabled, false) into v_alcohol_open
    from public.businesses b where b.id = p_business_id;
  v_alcohol_open := coalesce(v_alcohol_open, false);

  insert into public.catalog_change_batches (
    business_id, source, actor_id, session_id, request, request_sha256, reverts_batch_id)
  values (
    p_business_id, 'rollback', auth.uid(), public.identity_session_id(),
    jsonb_build_object('batch_id', p_batch_id),
    encode(sha256(convert_to(jsonb_build_object('batch_id', p_batch_id)::text, 'UTF8')), 'hex'),
    p_batch_id)
  returning id into v_rollback_id;

  -- Los productos se bloquean en orden determinista antes de mirar nada.
  perform 1
    from public.products p
   where p.id in (select i.product_id from public.catalog_change_items i where i.batch_id = p_batch_id)
   order by p.id
   for update;

  for v_item in
    select * from public.catalog_change_items i
     where i.batch_id = p_batch_id
     order by i.id desc
  loop
    select * into v_product from public.products p where p.id = v_item.product_id;
    v_changed := '{}';
    v_stock_outcome := null;
    v_publication := null;
    v_movement := null;
    v_hold := null;
    v_new_conflict := null;
    v_had_open := false;
    v_recounted := false;
    v_reserved := null;

    if v_item.action <> 'created' then
      v_reserved := private.pos_reserved_quantity(v_product.id);
      v_had_open := exists (
        select 1 from public.pos_stock_conflicts c where c.product_id = v_product.id and c.status = 'open');
      -- ¿Alguien volvió a contar este producto después del lote? Otro lote, la ficha
      -- o Caja Clara. Un conteo posterior es la última palabra sobre el stock, aunque
      -- haya dado el mismo número y no haya dejado fila en el libro. Los conteos de
      -- Caja Clara se comparan por cantidad contra los que había al contar: su recibo
      -- lleva la hora de inicio de SU transacción, que puede ser anterior a la del lote
      -- aunque el conteo haya sido posterior. Cualquier diferencia cuenta como
      -- recuento (falla cerrada: el stock no se devuelve).
      select count(*)::integer into v_count_receipts
        from public.pos_stock_receipts r where r.product_id = v_product.id and r.kind = 'count';
      v_recounted := exists (
          select 1 from public.catalog_change_items i2
           where i2.product_id = v_product.id and i2.id > v_item.id and i2.stock_count is not null)
        or (v_item.stock_count is not null and v_count_receipts is distinct from v_item.count_receipts);

      -- ── retención: el conteo del lote había cerrado un conflicto ──
      if coalesce((v_item.detail ->> 'conflict_resolved')::boolean, false) then
        if v_had_open then
          v_hold := 'already_held';
        elsif v_recounted then
          v_hold := 'kept_recounted_since';
        else
          select * into v_closed
            from public.pos_stock_conflicts c
           where c.id = (v_item.detail ->> 'conflict_id')::uuid
             and c.product_id = v_product.id;
          if found then
            v_new_conflict := private.pos_record_conflict(
              p_business_id, v_product.id, v_closed.kind,
              v_closed.requested_delta, v_closed.applied_delta, v_closed.shortfall, v_reserved);
            v_hold := 'reopened';
            v_holds_reopened := v_holds_reopened + 1;
          else
            -- Sin el conflicto original no hay con qué reabrirlo. Falla cerrada: el
            -- stock de ese conteo no se devuelve.
            v_hold := 'conflict_record_missing';
          end if;
        end if;
      end if;
    end if;

    if v_item.action = 'created' then
      v_outcome := 'skipped_created';
      v_skipped_created := v_skipped_created + 1;
    elsif v_item.before = v_item.after then
      v_outcome := 'unchanged';
      v_unchanged := v_unchanged + 1;
    else
      if v_product.price is distinct from (v_item.after ->> 'price')::numeric then v_changed := array_append(v_changed, 'price'); end if;
      if v_product.price_status is distinct from (v_item.after ->> 'price_status') then v_changed := array_append(v_changed, 'price_status'); end if;
      if v_product.merchant_available is distinct from (v_item.after ->> 'merchant_available')::boolean then v_changed := array_append(v_changed, 'merchant_available'); end if;
      if v_product.is_verified is distinct from (v_item.after ->> 'is_verified')::boolean then v_changed := array_append(v_changed, 'is_verified'); end if;

      -- ── stock: qué se puede hacer con él ──
      v_t_stock := v_product.stock;
      v_restore_stock := false;
      if cardinality(v_changed) = 0 then
        if (v_item.before -> 'stock') is distinct from (v_item.after -> 'stock') then
          -- El libro no se borra y todos los que lo escriben bloquean antes la fila
          -- del producto: si tiene las mismas filas que al contar, no hubo movimientos.
          select count(*)::integer into v_ledger_rows
            from public.inventory_movements m where m.product_id = v_product.id;
          if v_had_open then
            v_stock_outcome := 'kept_open_conflict';
          elsif v_hold = 'conflict_record_missing' then
            v_stock_outcome := 'kept_conflict_closed_by_batch';
          elsif v_recounted then
            v_stock_outcome := 'kept_recounted_since';
          elsif v_product.stock is distinct from (v_item.after ->> 'stock')::integer
             or v_reserved is distinct from v_item.reserved_at_count
             or v_ledger_rows is distinct from v_item.ledger_rows then
            v_stock_outcome := 'kept_moved_since';
          else
            v_stock_outcome := 'restored';
            v_restore_stock := true;
            v_t_stock := (v_item.before ->> 'stock')::integer;
          end if;
        else
          v_stock_outcome := 'not_changed_by_batch';
        end if;
        -- ¿La fila decidió la publicación y la cambió? Sólo cuenta lo que pidió la
        -- planilla (`publish`): el disponible que movió el sistema (un conteo que
        -- agota, o que cierra un conflicto y reofrece) no es una decisión del lote, y
        -- deshacerlo sacaría de la venta lo que un conteo posterior reofreció bien.
        v_publication_decided := (v_item.detail ? 'publish')
          and (v_item.before -> 'available') is distinct from (v_item.after -> 'available');
        -- Una fila que sólo contó stock, y cuyo stock ya se movió, no tiene nada
        -- que devolver: se informa como cambiada y no se toca. No vale para la fila
        -- que decidió la publicación: esa decisión se deshace igual.
        if not v_restore_stock
           and not v_publication_decided
           and (v_item.before -> 'price') is not distinct from (v_item.after -> 'price')
           and (v_item.before -> 'price_status') is not distinct from (v_item.after -> 'price_status')
           and (v_item.before -> 'merchant_available') is not distinct from (v_item.after -> 'merchant_available')
           and (v_item.before -> 'is_verified') is not distinct from (v_item.after -> 'is_verified') then
          v_changed := array['stock'];
        end if;
      end if;

      if cardinality(v_changed) > 0 then
        v_outcome := 'skipped_changed';
        v_skipped_changed := v_skipped_changed + 1;
      else
        v_outcome := 'restored';
        v_restored := v_restored + 1;

        v_t_price := (v_item.before ->> 'price')::numeric;
        v_t_price_status := v_item.before ->> 'price_status';
        v_t_merchant := (v_item.before ->> 'merchant_available')::boolean;
        v_t_verified := (v_item.before ->> 'is_verified')::boolean and v_product.is_verified;
        v_publication_changed :=
          (v_item.before -> 'available') is distinct from (v_item.after -> 'available')
          or (v_item.before -> 'merchant_available') is distinct from (v_item.after -> 'merchant_available')
          or (v_item.before -> 'is_verified') is distinct from (v_item.after -> 'is_verified');
        v_want_available := case when v_publication_changed
          then (v_item.before ->> 'available')::boolean else v_product.available end;

        update public.products p
           set price = v_t_price,
               price_status = v_t_price_status,
               stock = v_t_stock,
               merchant_available = v_t_merchant,
               is_verified = v_t_verified,
               verified_at = case when v_t_verified then p.verified_at else null end,
               verified_by = case when v_t_verified then p.verified_by else null end,
               -- Este UPDATE sólo puede apagar. Encender es el paso siguiente, con
               -- todas las compuertas.
               available = p.available and v_want_available and v_t_verified and v_t_merchant
                 and p.is_active and coalesce(v_t_stock, 0) > 0
                 and v_t_price_status = 'confirmed' and coalesce(v_t_price, 0) > 0,
               updated_at = statement_timestamp()
         where p.id = v_product.id;

        if v_restore_stock and coalesce(v_t_stock, 0) - coalesce(v_product.stock, 0) <> 0 then
          insert into public.inventory_movements (
            business_id, product_id, barcode_id, movement_type, quantity_delta, previous_stock, resulting_stock,
            unit_factor, reference_type, reference_id, reason, operator_id, idempotency_key)
          values (
            p_business_id, v_product.id, null, 'stock_count',
            coalesce(v_t_stock, 0) - coalesce(v_product.stock, 0), coalesce(v_product.stock, 0), coalesce(v_t_stock, 0),
            1, 'catalog_change_batch', v_rollback_id,
            format('Reversión del lote comercial %s: el stock vuelve al valor anterior', p_batch_id),
            auth.uid(), 'ccr_' || md5(v_rollback_id::text || ':' || v_product.id::text))
          returning id into v_movement;
        end if;

        -- ── publicación ──
        select * into v_now from public.products p where p.id = v_product.id;
        v_can_sell := v_now.is_active
          and coalesce(v_now.stock, 0) > 0
          and v_now.price_status = 'confirmed'
          and v_now.price > 0
          and v_now.merchant_available
          and public.product_commercial_image_valid(v_now)
          and (not coalesce(v_now.is_alcoholic, false) or v_alcohol_open)
          -- Retenido por un conflicto (el que ya había o el que esta reversión acaba
          -- de reabrir): no se ofrece. El disparador de retención lo impediría igual;
          -- acá se decide a propósito, no por rebote.
          and not v_had_open
          and v_hold is distinct from 'reopened';
        begin
          if v_t_verified and not v_now.is_verified then
            -- El disparador de dato maestro la bajó por restaurar el precio. Estaba
            -- verificada al entrar: se conserva verificada si la imagen sigue en regla.
            if public.product_commercial_image_valid(v_now) then
              update public.products p
                 set is_verified = true,
                     verified_at = statement_timestamp(),
                     verified_by = auth.uid(),
                     available = v_want_available and v_can_sell,
                     updated_at = statement_timestamp()
               where p.id = v_product.id;
            else
              v_publication := 'left_unverified_image_state';
            end if;
          elsif v_t_verified and v_want_available and not v_now.available and v_can_sell then
            update public.products p
               set available = true, updated_at = statement_timestamp()
             where p.id = v_product.id;
          end if;
        exception when check_violation then
          -- Una restricción (por ejemplo la foto obligatoria de un comercio) no deja
          -- volver a ofrecerlo: queda oculto y se informa. Falla cerrada.
          v_publication := 'left_hidden_by_constraint';
        end;
        if v_publication is null
           and (v_item.before ->> 'is_verified')::boolean and not v_product.is_verified then
          v_publication := 'left_unverified';
        end if;
      end if;
    end if;
    if v_publication is null and v_hold = 'reopened' then
      v_publication := 'held_by_stock_conflict';
    end if;

    select * into v_now from public.products p where p.id = v_product.id;
    -- Esta reversión lo sacó de la venta y el comercio lo sigue queriendo vender: es la
    -- misma condición con la que el sistema reofrece al liberar una reserva, cancelar
    -- un pedido o recibir mercadería. No se le apaga la intención (el lote no la tocó);
    -- se avisa, para que quien revierte decida si además lo oculta.
    if v_outcome = 'restored' and v_publication is null
       and v_product.available and not v_now.available
       and v_now.merchant_available and v_now.is_active and v_now.is_verified
       and coalesce(v_now.stock, 0) > 0
       and v_now.price_status = 'confirmed' and v_now.price > 0 then
      v_publication := 'off_sale_intent_on';
      v_off_sale_intent_on := v_off_sale_intent_on + 1;
    end if;
    perform private.catalog_change_log_item(
      v_rollback_id, case when v_outcome = 'skipped_created' then 'skipped_created'
                          when v_outcome = 'restored' then 'restored'
                          when v_outcome = 'skipped_changed' then 'skipped_changed'
                          else 'unchanged' end,
      v_product, v_now, null, null, v_movement,
      jsonb_build_object(
        'reverts_item', v_item.id,
        'changed_fields', case when cardinality(v_changed) > 0 then to_jsonb(v_changed) end,
        'stock', v_stock_outcome,
        'publication', v_publication,
        'hold', v_hold,
        'conflict_id', v_new_conflict,
        'reverts_conflict_id', case when v_hold is not null then v_item.detail ->> 'conflict_id' end));
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'sku', v_now.sku,
      'product_id', v_now.id,
      'outcome', v_outcome,
      'changed_fields', case when cardinality(v_changed) > 0 then to_jsonb(v_changed) end,
      'stock', v_stock_outcome,
      'publication', v_publication,
      'hold', v_hold,
      'conflict_id', v_new_conflict,
      'price', v_now.price,
      'price_status', v_now.price_status,
      'available_stock', v_now.stock,
      'available', v_now.available,
      'is_verified', v_now.is_verified)));
  end loop;

  v_result := jsonb_build_object(
    'ok', true,
    'batch_id', v_rollback_id,
    'reverts_batch_id', p_batch_id,
    'replay', false,
    'restored', v_restored,
    'skipped_changed', v_skipped_changed,
    'skipped_created', v_skipped_created,
    'unchanged', v_unchanged,
    'holds_reopened', v_holds_reopened,
    'off_sale_intent_on', v_off_sale_intent_on,
    'items', v_items);

  update public.catalog_change_batches b
     set result = v_result
   where b.id = v_rollback_id;
  update public.catalog_change_batches b
     set rolled_back_at = clock_timestamp(),
         rolled_back_by = auth.uid(),
         rollback_batch_id = v_rollback_id
   where b.id = p_batch_id;

  return v_result;
end;
$function$;

revoke all on function public.rollback_commercial_catalog_batch(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.rollback_commercial_catalog_batch(uuid, uuid) to authenticated;

comment on function public.rollback_commercial_catalog_batch(uuid, uuid) is
  'Owner/admin. Devuelve un lote comercial a su imagen anterior producto por producto, solo donde nadie cambio precio, estado del precio, intencion o verificacion desde entonces. Nunca restaura stock a ciegas, y si el conteo del lote habia cerrado un conflicto de stock vuelve a retener el producto. Idempotente.';

-- ── 9. El stock y la publicación ya no se escriben directo ───────────────────
-- Medido antes de revocar: ningún cliente del repositorio escribe `products` con una
-- sesión (`js/`, `apps/rider-android`, `src-tauri`, `supabase/functions`, `scripts/`,
-- `tests/`); los únicos `update` directos son controles negativos sobre `price`.
-- `sort_order` se conserva: ordenar la góndola no mueve stock ni publica.
-- `is_active` entra en toda regla de publicación (la restricción de disponibilidad,
-- las liberaciones de reserva y el reofrecimiento la leen): dejarlo escribible era
-- dejar una palanca de publicación sin compuertas ni rastro.
revoke update (stock, available, is_active) on table public.products from authenticated;

do $catalog_stock_authority$
begin
  if has_column_privilege('authenticated', 'public.products', 'stock', 'UPDATE')
     or has_column_privilege('authenticated', 'public.products', 'available', 'UPDATE')
     or has_column_privilege('authenticated', 'public.products', 'is_active', 'UPDATE')
     or has_column_privilege('anon', 'public.products', 'stock', 'UPDATE')
     or has_column_privilege('anon', 'public.products', 'available', 'UPDATE') then
    raise exception 'direct stock/availability writes on public.products are still granted to a client role';
  end if;
end
$catalog_stock_authority$;
