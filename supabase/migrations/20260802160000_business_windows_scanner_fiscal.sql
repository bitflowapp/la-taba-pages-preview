-- TABA Negocio Windows: scanner, inventory, packing, POS and fiscal outbox.
-- Production fiscal operation remains disabled by default and cannot be
-- activated by a browser preference. All critical writes are RPC-only.

create extension if not exists pgcrypto;

-- ===== Order command authority and idempotency =====

alter table public.orders add column if not exists acknowledged_at timestamptz;
alter table public.orders add column if not exists acknowledged_by uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists preparation_estimate_minutes integer;

alter table public.orders drop constraint if exists orders_preparation_estimate_range;
alter table public.orders add constraint orders_preparation_estimate_range
check (preparation_estimate_minutes is null or preparation_estimate_minutes between 1 and 240);

create table if not exists public.business_command_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  command_type text not null,
  idempotency_key text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

create index if not exists business_command_receipts_order_created_idx
on public.business_command_receipts(order_id, created_at desc);

create or replace function public.business_command_request_hash(
  p_command_type text,
  p_order_id uuid,
  p_payload jsonb
)
returns text
language sql
immutable
set search_path = pg_catalog, public, extensions, pg_temp
as $hash$
  select encode(digest(
    coalesce(p_command_type, '') || chr(10)
    || coalesce(p_order_id::text, '') || chr(10)
    || coalesce(p_payload, '{}'::jsonb)::text,
    'sha256'
  ), 'hex');
$hash$;

create or replace function public.acknowledge_order(
  p_order_id uuid,
  p_expected_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $ack$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision < 1 then raise exception 'expected_revision requerido' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;

  v_hash := public.business_command_request_hash('acknowledge_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision));
  select r.* into v_existing from public.business_command_receipts r
   where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  if v_order.revision <> p_expected_revision then raise exception 'revision desactualizada' using errcode = '40001'; end if;
  if public.normalize_order_status_vocabulary(v_order.status) not in ('submitted', 'accepted', 'preparing') then raise exception 'pedido no reconocible en estado actual' using errcode = 'P0001'; end if;

  update public.orders set acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid()) where id = p_order_id;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'business_acknowledged', 'Pedido reconocido por el negocio.', '{}'::jsonb);
  select to_jsonb(o) into v_result from public.orders o where o.id = p_order_id;
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'acknowledge_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$ack$;

create or replace function public.transition_order(
  p_order_id uuid,
  p_expected_revision bigint,
  p_new_status text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $transition_idempotent$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  v_hash := public.business_command_request_hash('transition_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'new_status', public.normalize_order_status_vocabulary(p_new_status)));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  v_result := public.transition_order(p_order_id, p_expected_revision, p_new_status);
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'transition_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$transition_idempotent$;

create or replace function public.set_preparation_estimate(
  p_order_id uuid,
  p_expected_revision bigint,
  p_minutes integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $estimate$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if p_minutes not between 1 and 240 then raise exception 'minutos fuera de rango' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  v_hash := public.business_command_request_hash('set_preparation_estimate', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'minutes', p_minutes));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  if v_order.revision <> p_expected_revision then raise exception 'revision desactualizada' using errcode = '40001'; end if;
  if public.normalize_order_status_vocabulary(v_order.status) not in ('submitted', 'accepted', 'preparing') then raise exception 'estado no permite estimacion' using errcode = 'P0001'; end if;
  update public.orders set preparation_estimate_minutes = p_minutes where id = p_order_id;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'preparation_estimate_set', 'Tiempo de preparacion actualizado.', jsonb_build_object('minutes', p_minutes));
  select to_jsonb(o) into v_result from public.orders o where o.id = p_order_id;
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'set_preparation_estimate', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$estimate$;

create or replace function public.cancel_order(
  p_order_id uuid,
  p_expected_revision bigint,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $cancel$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then raise exception 'motivo de cancelacion requerido' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  v_hash := public.business_command_request_hash('cancel_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'reason', btrim(p_reason)));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  v_result := public.transition_order(p_order_id, p_expected_revision, 'canceled');
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'business_cancel_reason', 'Cancelacion registrada.', jsonb_build_object('reason', btrim(p_reason)));
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'cancel_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$cancel$;

-- ===== Barcodes and assisted catalog drafts =====

create or replace function public.gtin_check_digit_valid(p_gtin text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $gtin$
declare
  v_sum integer := 0;
  v_weight integer := 3;
  v_index integer;
  v_expected integer;
begin
  if p_gtin !~ '^[0-9]+$' or length(p_gtin) not in (8,12,13,14) then return false; end if;
  for v_index in reverse length(p_gtin)-1..1 loop
    v_sum := v_sum + substr(p_gtin,v_index,1)::integer * v_weight;
    v_weight := case when v_weight=3 then 1 else 3 end;
  end loop;
  v_expected := (10-(v_sum%10))%10;
  return substr(p_gtin,length(p_gtin),1)::integer=v_expected;
end;
$gtin$;

create table if not exists public.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  gtin text not null,
  barcode_type text not null check (barcode_type in ('EAN-8', 'UPC-A', 'EAN-13', 'GTIN-14', 'INTERNAL')),
  package_type text not null default 'unit' check (package_type in ('unit', 'pack', 'case', 'internal')),
  unit_factor integer not null default 1 check (unit_factor > 0),
  is_primary boolean not null default false,
  is_active boolean not null default true,
  source text not null default 'manual' check (source in ('manual', 'taba_catalog', 'gs1_authorized', 'migration')),
  verified_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, gtin),
  constraint product_barcodes_gtin_format check (
    (barcode_type = 'EAN-8' and gtin ~ '^[0-9]{8}$' and public.gtin_check_digit_valid(gtin))
    or (barcode_type = 'UPC-A' and gtin ~ '^[0-9]{12}$' and public.gtin_check_digit_valid(gtin))
    or (barcode_type = 'EAN-13' and gtin ~ '^[0-9]{13}$' and public.gtin_check_digit_valid(gtin))
    or (barcode_type = 'GTIN-14' and gtin ~ '^[0-9]{14}$' and public.gtin_check_digit_valid(gtin))
    or (barcode_type = 'INTERNAL' and gtin ~ '^[A-Z0-9][A-Z0-9._-]{2,31}$')
  )
);

create unique index if not exists product_barcodes_one_primary_per_product
on public.product_barcodes(product_id) where is_primary and is_active;
create index if not exists product_barcodes_product_active_idx on public.product_barcodes(product_id) where is_active;

create table if not exists public.catalog_product_drafts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  scanned_gtin text not null,
  suggested_name text,
  suggested_brand text,
  suggested_presentation text,
  suggested_category text,
  suggested_image text,
  source text not null,
  idempotency_key text not null,
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'merged')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  product_id uuid references public.products(id) on delete restrict,
  unique(business_id,idempotency_key)
);

create unique index if not exists catalog_product_drafts_pending_gtin_key
on public.catalog_product_drafts(business_id, scanned_gtin) where status = 'pending_review';

create or replace function public.create_catalog_product_draft(
  p_business_id uuid,
  p_gtin text,
  p_suggestion jsonb,
  p_idempotency_key text
)
returns public.catalog_product_drafts
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $draft$
declare v_result public.catalog_product_drafts%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if coalesce(p_suggestion, '{}'::jsonb) - array['name','brand','presentation','category','image','source','confidence'] <> '{}'::jsonb then raise exception 'payload no permitido' using errcode = '22023'; end if;
  if p_gtin !~ '^[0-9]{8}$|^[0-9]{12}$|^[0-9]{13}$|^[0-9]{14}$' then raise exception 'GTIN invalido' using errcode = '22023'; end if;
  if not public.gtin_check_digit_valid(p_gtin) then raise exception 'digito verificador invalido' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode='22023'; end if;
  select d.* into v_result from public.catalog_product_drafts d
   where d.business_id=p_business_id
     and (d.idempotency_key=p_idempotency_key or (d.scanned_gtin=p_gtin and d.status='pending_review'))
   order by (d.idempotency_key=p_idempotency_key) desc limit 1 for update;
  if found then return v_result; end if;
  insert into public.catalog_product_drafts(business_id, scanned_gtin, suggested_name, suggested_brand, suggested_presentation, suggested_category, suggested_image, source, idempotency_key, confidence, created_by)
  values (p_business_id, p_gtin, nullif(btrim(p_suggestion->>'name'), ''), nullif(btrim(p_suggestion->>'brand'), ''), nullif(btrim(p_suggestion->>'presentation'), ''), nullif(btrim(p_suggestion->>'category'), ''), nullif(btrim(p_suggestion->>'image'), ''), coalesce(nullif(btrim(p_suggestion->>'source'), ''), 'manual'),p_idempotency_key,least(1, greatest(0, coalesce((p_suggestion->>'confidence')::numeric, 0))), auth.uid())
  returning * into v_result;
  return v_result;
end;
$draft$;

create or replace function public.publish_catalog_product_draft(
  p_draft_id uuid,
  p_name text,
  p_category text,
  p_price numeric,
  p_package_type text,
  p_unit_factor integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $publish_draft$
declare
  v_draft public.catalog_product_drafts%rowtype;
  v_product public.products%rowtype;
  v_barcode_type text;
begin
  select d.* into v_draft from public.catalog_product_drafts d where d.id = p_draft_id for update;
  if not found then raise exception 'borrador inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_draft.business_id, array['owner', 'admin']) then raise exception 'revision owner/admin requerida' using errcode = '42501'; end if;
  if v_draft.status <> 'pending_review' then raise exception 'borrador ya revisado' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 160 or char_length(btrim(coalesce(p_category, ''))) not between 2 and 80 or p_price < 0 or p_unit_factor < 1 then raise exception 'datos de producto invalidos' using errcode = '22023'; end if;
  insert into public.products(business_id, name, category, price, stock, available, is_active, is_verified, catalog_origin)
  values (v_draft.business_id, btrim(p_name), btrim(p_category), p_price, 0, false, false, false, 'commercial')
  returning * into v_product;
  v_barcode_type := case length(v_draft.scanned_gtin) when 8 then 'EAN-8' when 12 then 'UPC-A' when 13 then 'EAN-13' else 'GTIN-14' end;
  insert into public.product_barcodes(business_id, product_id, gtin, barcode_type, package_type, unit_factor, is_primary, source, verified_at, created_by)
  values (v_draft.business_id, v_product.id, v_draft.scanned_gtin, v_barcode_type, p_package_type, p_unit_factor, true, 'manual', now(), auth.uid());
  update public.catalog_product_drafts set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), product_id = v_product.id where id = v_draft.id;
  return jsonb_build_object('draft_id', v_draft.id, 'product_id', v_product.id, 'gtin', v_draft.scanned_gtin, 'published', false, 'requires_catalog_verification', true);
end;
$publish_draft$;

-- ===== Immutable inventory ledger =====

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  barcode_id uuid references public.product_barcodes(id) on delete restrict,
  movement_type text not null check (movement_type in ('purchase_receipt','manual_adjustment','stock_count','sale','online_order_reservation','online_order_release','cancellation_return','damage','loss','expiration','supplier_return')),
  quantity_delta integer not null check (quantity_delta <> 0),
  previous_stock integer not null,
  resulting_stock integer not null,
  unit_factor integer not null check (unit_factor > 0),
  reference_type text,
  reference_id uuid,
  reason text,
  operator_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (business_id, idempotency_key),
  constraint inventory_adjustment_reason_required check (
    movement_type not in ('manual_adjustment','stock_count','damage','loss','expiration','supplier_return')
    or char_length(btrim(coalesce(reason, ''))) between 3 and 300
  )
);

create index if not exists inventory_movements_product_created_idx on public.inventory_movements(product_id, created_at desc);

create or replace function public.prevent_inventory_movement_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $immutable_ledger$
begin
  raise exception 'inventory_movements es inmutable; use un movimiento compensatorio' using errcode='55000';
end;
$immutable_ledger$;

drop trigger if exists inventory_movements_immutable on public.inventory_movements;
create trigger inventory_movements_immutable before update or delete on public.inventory_movements
for each row execute function public.prevent_inventory_movement_mutation();

create table if not exists public.inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','confirming','confirmed','cancelled')),
  supplier_reference text,
  created_by uuid not null references auth.users(id) on delete restrict,
  confirmed_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create table if not exists public.inventory_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.inventory_receipts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  barcode_id uuid references public.product_barcodes(id) on delete restrict,
  package_quantity integer not null check (package_quantity > 0),
  unit_factor integer not null check (unit_factor > 0),
  base_units integer generated always as (package_quantity * unit_factor) stored,
  unit_cost numeric(12,2),
  lot_reference text,
  expires_on date,
  unique (receipt_id, product_id, barcode_id)
);

create table if not exists public.stock_count_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  status text not null default 'in_progress' check (status in ('in_progress','review','confirmed','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create table if not exists public.stock_count_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.stock_count_sessions(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  theoretical_stock integer not null,
  physical_stock integer not null check (physical_stock >= 0),
  difference integer generated always as (physical_stock - theoretical_stock) stored,
  unique(session_id, product_id)
);

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
as $movement$
declare
  v_product public.products%rowtype;
  v_barcode public.product_barcodes%rowtype;
  v_existing public.inventory_movements%rowtype;
  v_result public.inventory_movements%rowtype;
  v_factor integer := 1;
  v_delta integer;
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
  if coalesce(v_product.stock, 0) + v_delta < 0 then raise exception 'stock negativo bloqueado' using errcode = '23514'; end if;
  if p_movement_type in ('manual_adjustment','stock_count','damage','loss','expiration','supplier_return') and char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then raise exception 'motivo requerido' using errcode = '22023'; end if;
  update public.products set stock = coalesce(stock, 0) + v_delta where id = p_product_id;
  insert into public.inventory_movements(business_id, product_id, barcode_id, movement_type, quantity_delta, previous_stock, resulting_stock, unit_factor, reference_type, reference_id, reason, operator_id, idempotency_key)
  values (p_business_id, p_product_id, p_barcode_id, p_movement_type, v_delta, coalesce(v_product.stock,0), coalesce(v_product.stock,0)+v_delta, v_factor, nullif(btrim(coalesce(p_reference_type,'')),''), p_reference_id, nullif(btrim(coalesce(p_reason,'')),''), auth.uid(), p_idempotency_key)
  returning * into v_result;
  return v_result;
end;
$movement$;

-- ===== Packing verification =====

create table if not exists public.order_packing_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  order_revision bigint not null,
  status text not null default 'in_progress' check (status in ('not_started','in_progress','complete','exception_required','confirmed','cancelled')),
  operator_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null,
  exception_reason text,
  exception_authorized_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique(business_id, idempotency_key)
);

create unique index if not exists order_packing_one_open_session
on public.order_packing_sessions(order_id) where status in ('not_started','in_progress','complete','exception_required');

create table if not exists public.order_packing_scans (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.order_packing_sessions(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  barcode_id uuid not null references public.product_barcodes(id) on delete restrict,
  unit_factor integer not null check (unit_factor > 0),
  operator_id uuid not null references auth.users(id) on delete restrict,
  scan_key text not null,
  created_at timestamptz not null default now(),
  reverted_at timestamptz,
  unique(session_id, scan_key)
);

create or replace function public.record_packing_scan(
  p_session_id uuid,
  p_gtin text,
  p_scan_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $packing_scan$
declare
  v_session public.order_packing_sessions%rowtype;
  v_barcode public.product_barcodes%rowtype;
  v_item public.order_items%rowtype;
  v_scanned integer;
  v_complete boolean;
begin
  select s.* into v_session from public.order_packing_sessions s where s.id = p_session_id for update;
  if not found then raise exception 'sesion inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_session.business_id, array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if v_session.status not in ('in_progress','complete') then raise exception 'sesion cerrada' using errcode = 'P0001'; end if;
  select b.* into v_barcode from public.product_barcodes b where b.business_id = v_session.business_id and b.gtin = p_gtin and b.is_active;
  if not found then raise exception 'producto desconocido' using errcode = 'P0002'; end if;
  select oi.* into v_item from public.order_items oi where oi.order_id = v_session.order_id and oi.product_uuid = v_barcode.product_id order by oi.id limit 1;
  if not found then raise exception 'producto equivocado' using errcode = '23514'; end if;
  select coalesce(sum(s.unit_factor),0)::integer into v_scanned from public.order_packing_scans s where s.session_id = v_session.id and s.order_item_id = v_item.id and s.reverted_at is null;
  if v_scanned + v_barcode.unit_factor > v_item.quantity then raise exception 'cantidad excedida' using errcode = '23514'; end if;
  insert into public.order_packing_scans(session_id, order_item_id, product_id, barcode_id, unit_factor, operator_id, scan_key)
  values (v_session.id, v_item.id, v_barcode.product_id, v_barcode.id, v_barcode.unit_factor, auth.uid(), p_scan_key)
  on conflict(session_id, scan_key) do nothing;
  select not exists (
    select 1 from public.order_items oi
    where oi.order_id = v_session.order_id
      and coalesce((select sum(ps.unit_factor) from public.order_packing_scans ps where ps.session_id = v_session.id and ps.order_item_id = oi.id and ps.reverted_at is null),0) <> oi.quantity
  ) into v_complete;
  update public.order_packing_sessions set status = case when v_complete then 'complete' else 'in_progress' end, updated_at = now() where id = v_session.id;
  return jsonb_build_object('ok', true, 'complete', v_complete, 'product_id', v_barcode.product_id, 'unit_factor', v_barcode.unit_factor);
end;
$packing_scan$;

create or replace function public.start_packing_session(
  p_order_id uuid,
  p_expected_revision bigint,
  p_idempotency_key text
)
returns public.order_packing_sessions
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $start_packing$
declare
  v_order public.orders%rowtype;
  v_session public.order_packing_sessions%rowtype;
begin
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode='22023'; end if;
  select o.* into v_order from public.orders o where o.id=p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_order.business_id,array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode='42501'; end if;
  select s.* into v_session from public.order_packing_sessions s where s.business_id=v_order.business_id and s.idempotency_key=p_idempotency_key;
  if found then return v_session; end if;
  if v_order.revision<>p_expected_revision then raise exception 'conflicto de revision' using errcode='40001'; end if;
  if public.normalize_order_status_vocabulary(v_order.status) not in ('accepted','preparing') then raise exception 'estado no permite packing' using errcode='P0001'; end if;
  insert into public.order_packing_sessions(business_id,order_id,order_revision,status,operator_id,idempotency_key)
  values(v_order.business_id,v_order.id,v_order.revision,'in_progress',auth.uid(),p_idempotency_key)
  returning * into v_session;
  return v_session;
end;
$start_packing$;

create or replace function public.undo_last_packing_scan(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $undo_packing$
declare
  v_session public.order_packing_sessions%rowtype;
  v_scan_id uuid;
begin
  select s.* into v_session from public.order_packing_sessions s where s.id=p_session_id for update;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode='42501'; end if;
  if v_session.status not in ('in_progress','complete') then raise exception 'sesion cerrada' using errcode='P0001'; end if;
  select s.id into v_scan_id from public.order_packing_scans s where s.session_id=p_session_id and s.reverted_at is null order by s.created_at desc,s.id desc limit 1 for update;
  if not found then return jsonb_build_object('ok',false,'code','NOTHING_TO_UNDO'); end if;
  update public.order_packing_scans set reverted_at=now() where id=v_scan_id;
  update public.order_packing_sessions set status='in_progress',updated_at=now() where id=p_session_id;
  return jsonb_build_object('ok',true,'scan_id',v_scan_id);
end;
$undo_packing$;

create or replace function public.confirm_packing_session(
  p_session_id uuid,
  p_exception_reason text default null
)
returns public.order_packing_sessions
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $confirm_packing$
declare
  v_session public.order_packing_sessions%rowtype;
  v_complete boolean;
begin
  select s.* into v_session from public.order_packing_sessions s where s.id=p_session_id for update;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode='42501'; end if;
  select not exists(
    select 1 from public.order_items oi where oi.order_id=v_session.order_id
      and coalesce((select sum(ps.unit_factor) from public.order_packing_scans ps where ps.session_id=v_session.id and ps.order_item_id=oi.id and ps.reverted_at is null),0)<>oi.quantity
  ) into v_complete;
  if not v_complete and (not public.has_business_role(v_session.business_id,array['owner','admin']) or char_length(btrim(coalesce(p_exception_reason,''))) not between 3 and 300) then
    update public.order_packing_sessions set status='exception_required',updated_at=now() where id=p_session_id;
    raise exception 'faltantes requieren excepcion owner/admin con motivo' using errcode='42501';
  end if;
  update public.order_packing_sessions
  set status='confirmed',exception_reason=case when v_complete then null else btrim(p_exception_reason) end,
      exception_authorized_by=case when v_complete then null else auth.uid() end,confirmed_at=now(),updated_at=now()
  where id=p_session_id returning * into v_session;
  return v_session;
end;
$confirm_packing$;

-- ===== Atomic POS =====

create table if not exists public.pos_sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  operator_id uuid not null references auth.users(id) on delete restrict,
  state text not null default 'draft' check (state in ('draft','pricing','awaiting_payment','payment_confirmed','completed_fiscal_pending','completed','cancelled','refunded')),
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  currency text not null default 'PES',
  idempotency_key text not null,
  fiscal_document_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(business_id, idempotency_key)
);

create table if not exists public.pos_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.pos_sales(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  quantity integer not null check(quantity > 0),
  unit_price numeric(12,2) not null check(unit_price >= 0),
  tax_snapshot jsonb not null default '{}'::jsonb,
  line_total numeric(12,2) not null check(line_total >= 0)
);

create table if not exists public.pos_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.pos_sales(id) on delete restrict,
  payment_method text not null check(payment_method in ('cash','debit_card','credit_card','transfer','qr')),
  amount numeric(12,2) not null check(amount > 0),
  status text not null default 'confirmed' check(status in ('pending','confirmed','voided','refunded')),
  external_reference text,
  created_at timestamptz not null default now()
);

create or replace function public.checkout_pos_sale(
  p_business_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_idempotency_key text,
  p_request_fiscal boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $checkout_pos$
declare
  v_sale public.pos_sales%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_subtotal numeric(12,2) := 0;
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if p_payment_method not in ('cash','debit_card','credit_card','transfer','qr') then raise exception 'medio de pago invalido' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 200 then raise exception 'items invalidos' using errcode = '22023'; end if;
  if (select count(distinct value->>'productId') from jsonb_array_elements(p_items)) <> jsonb_array_length(p_items) then raise exception 'productos duplicados en payload' using errcode='22023'; end if;
  select s.* into v_sale from public.pos_sales s where s.business_id = p_business_id and s.idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('sale_id', v_sale.id, 'state', v_sale.state, 'total', v_sale.total, 'idempotent_replay', true); end if;
  insert into public.pos_sales(business_id, operator_id, state, idempotency_key) values(p_business_id, auth.uid(), 'pricing', p_idempotency_key) returning * into v_sale;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if v_item - array['productId','quantity'] <> '{}'::jsonb then raise exception 'payload de item no permitido' using errcode = '22023'; end if;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity < 1 then raise exception 'cantidad invalida' using errcode = '22023'; end if;
    select p.* into v_product from public.products p where p.id = (v_item->>'productId')::uuid and p.business_id = p_business_id and p.is_active and p.is_verified for update;
    if not found then raise exception 'producto no disponible' using errcode = 'P0002'; end if;
    if coalesce(v_product.stock,0) < v_quantity then raise exception 'stock insuficiente' using errcode = '23514'; end if;
    update public.products set stock = stock - v_quantity where id = v_product.id;
    insert into public.pos_sale_items(sale_id, product_id, product_name, quantity, unit_price, tax_snapshot, line_total)
    values(v_sale.id, v_product.id, v_product.name, v_quantity, v_product.price, jsonb_build_object('configured_by_server', true), v_quantity * v_product.price);
    insert into public.inventory_movements(business_id, product_id, movement_type, quantity_delta, previous_stock, resulting_stock, unit_factor, reference_type, reference_id, operator_id, idempotency_key)
    values(p_business_id, v_product.id, 'sale', -v_quantity, v_product.stock, v_product.stock-v_quantity, 1, 'pos_sale', v_sale.id, auth.uid(), p_idempotency_key || '-' || v_product.id::text);
    v_subtotal := v_subtotal + v_quantity * v_product.price;
  end loop;
  insert into public.pos_payments(sale_id, payment_method, amount, status) values(v_sale.id, p_payment_method, v_subtotal, 'confirmed');
  update public.pos_sales set subtotal = v_subtotal, total = v_subtotal, state = 'completed', completed_at = now() where id = v_sale.id returning * into v_sale;
  return jsonb_build_object('sale_id', v_sale.id, 'state', v_sale.state, 'total', v_sale.total, 'fiscal_requested', p_request_fiscal, 'idempotent_replay', false);
end;
$checkout_pos$;

-- ===== Fiscal profile, documents and private worker outbox =====

create table if not exists public.fiscal_profiles (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  legal_name text,
  cuit text,
  tax_condition text,
  gross_income_number text,
  business_address text,
  environment text not null default 'disabled' check(environment in ('disabled','homologation','production')),
  point_of_sale integer,
  default_currency text not null default 'PES',
  default_concept integer,
  invoice_policy text not null default 'manual' check(invoice_policy in ('manual','on_payment_confirmed','on_order_accepted','on_ready','on_delivered')),
  is_enabled boolean not null default false,
  accountant_review_status text not null default 'pending' check(accountant_review_status in ('pending','approved','rejected')),
  production_gate_status text not null default 'blocked' check(production_gate_status in ('blocked','approved')),
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_profiles_production_gate check (
    environment <> 'production'
    or (accountant_review_status = 'approved' and production_gate_status = 'approved' and verified_at is not null and verified_by is not null)
  ),
  constraint fiscal_profiles_enabled_verified check (
    not is_enabled
    or (environment <> 'disabled' and cuit ~ '^[0-9]{11}$' and point_of_sale between 1 and 99999 and legal_name is not null and tax_condition is not null)
  )
);

create table if not exists public.fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  source_type text not null check(source_type in ('pos_sale','online_order','credit_note')),
  source_id uuid not null,
  document_intent text not null check(document_intent in ('invoice','credit_note')),
  environment text not null check(environment in ('homologation','production')),
  cuit text not null check(cuit ~ '^[0-9]{11}$'),
  point_of_sale integer not null check(point_of_sale between 1 and 99999),
  document_type integer not null,
  document_number bigint,
  issue_date date,
  currency text not null default 'PES',
  recipient_type text,
  recipient_document_type integer,
  recipient_document_number text,
  net_amount numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  exempt_amount numeric(14,2) not null default 0,
  non_taxed_amount numeric(14,2) not null default 0,
  other_taxes_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null,
  state text not null default 'draft' check(state in ('draft','queued','claiming','authenticating','authorizing','authorized','observed','rejected','ambiguous','retry_wait','failed','credited')),
  result text,
  cae text check(cae is null or cae ~ '^[0-9]{14}$'),
  cae_expiration date,
  observations jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  request_hash text,
  response_hash text,
  idempotency_key text not null,
  associated_document_id uuid references public.fiscal_documents(id) on delete restrict,
  created_at timestamptz not null default now(),
  authorized_at timestamptz,
  unique(business_id, source_type, source_id, document_intent),
  unique(environment, cuit, point_of_sale, document_type, document_number),
  constraint fiscal_authorized_has_cae check(state <> 'authorized' or (cae ~ '^[0-9]{14}$' and document_number is not null and authorized_at is not null))
);

alter table public.pos_sales drop constraint if exists pos_sales_fiscal_document_id_fkey;
alter table public.pos_sales add constraint pos_sales_fiscal_document_id_fkey foreign key(fiscal_document_id) references public.fiscal_documents(id) on delete restrict;

create table if not exists public.fiscal_document_items (
  id uuid primary key default gen_random_uuid(),
  fiscal_document_id uuid not null references public.fiscal_documents(id) on delete restrict,
  description text not null,
  quantity numeric(14,3) not null check(quantity > 0),
  unit_price numeric(14,2) not null,
  net_amount numeric(14,2) not null,
  tax_amount numeric(14,2) not null default 0,
  tax_code integer
);

create table if not exists public.fiscal_events (
  id uuid primary key default gen_random_uuid(),
  fiscal_document_id uuid not null references public.fiscal_documents(id) on delete restrict,
  event_type text not null,
  actor_type text not null check(actor_type in ('operator','worker','arca','system')),
  actor_id uuid,
  request_id text,
  sanitized_detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.fiscal_outbox (
  id uuid primary key default gen_random_uuid(),
  fiscal_document_id uuid not null unique references public.fiscal_documents(id) on delete restrict,
  state text not null default 'pending' check(state in ('pending','leased','retry_wait','completed','dead_letter')),
  lease_owner text,
  lease_deadline timestamptz,
  attempt_count integer not null default 0 check(attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists fiscal_outbox_claim_idx on public.fiscal_outbox(state, next_attempt_at) where state in ('pending','retry_wait','leased');

create table if not exists public.fiscal_request_attempts (
  id uuid primary key default gen_random_uuid(),
  fiscal_document_id uuid not null references public.fiscal_documents(id) on delete restrict,
  outbox_id uuid not null references public.fiscal_outbox(id) on delete restrict,
  request_id text not null,
  operation text not null,
  result_class text,
  request_hash text,
  response_hash text,
  duration_ms integer,
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.fiscal_parameter_snapshots (
  id uuid primary key default gen_random_uuid(),
  environment text not null check(environment in ('homologation','production')),
  parameter_type text not null,
  version text not null,
  values_json jsonb not null,
  synchronized_at timestamptz not null,
  unique(environment, parameter_type, version)
);

create or replace function public.save_fiscal_parameter_snapshot(
  p_environment text,
  p_parameter_type text,
  p_version text,
  p_values_json jsonb,
  p_synchronized_at timestamptz
)
returns public.fiscal_parameter_snapshots
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $save_fiscal_parameters$
declare v_snapshot public.fiscal_parameter_snapshots%rowtype;
begin
  if p_environment not in ('homologation','production')
    or p_parameter_type not in ('document_types','recipient_document_types','vat_types','currencies','concepts','points_of_sale')
    or char_length(coalesce(p_version,'')) not between 1 and 128
    or p_values_json is null
    or p_synchronized_at is null
    or p_synchronized_at > now() + interval '5 minutes'
  then raise exception 'snapshot de parametros fiscales invalido' using errcode='22023'; end if;
  insert into public.fiscal_parameter_snapshots(environment,parameter_type,version,values_json,synchronized_at)
  values(p_environment,p_parameter_type,left(p_version,128),p_values_json,p_synchronized_at)
  on conflict(environment,parameter_type,version) do update
    set synchronized_at=greatest(public.fiscal_parameter_snapshots.synchronized_at,excluded.synchronized_at)
  returning * into v_snapshot;
  return v_snapshot;
end;
$save_fiscal_parameters$;

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  event_type text not null,
  aggregate_id uuid,
  deduplication_key text not null,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'pending' check(state in ('pending','processing','processed','failed','dead_letter')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(business_id, deduplication_key)
);

create or replace function public.enqueue_new_order_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $notify_order$
begin
  if public.normalize_order_status_vocabulary(new.status)='submitted' then
    insert into public.notification_outbox(business_id,event_type,aggregate_id,deduplication_key,payload)
    values(new.business_id,'new_order',new.id,'new-order-'||new.id::text,jsonb_build_object('order_id',new.id,'revision',new.revision))
    on conflict(business_id,deduplication_key) do nothing;
  end if;
  return new;
end;
$notify_order$;

drop trigger if exists orders_enqueue_new_order_notification on public.orders;
create trigger orders_enqueue_new_order_notification after insert on public.orders
for each row execute function public.enqueue_new_order_notification();

create or replace function public.protect_authorized_fiscal_document()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $protect_fiscal$
begin
  if tg_op='DELETE' and old.state in ('authorized','credited') then
    raise exception 'un comprobante autorizado no se elimina' using errcode='55000';
  end if;
  if tg_op='UPDATE' and old.state in ('authorized','credited') and (
    new.cae is distinct from old.cae or new.document_number is distinct from old.document_number
    or new.total_amount is distinct from old.total_amount or new.cuit is distinct from old.cuit
    or new.point_of_sale is distinct from old.point_of_sale or new.document_type is distinct from old.document_type
  ) then
    raise exception 'los datos autorizados son inmutables' using errcode='55000';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$protect_fiscal$;

drop trigger if exists fiscal_documents_protect_authorized on public.fiscal_documents;
create trigger fiscal_documents_protect_authorized before update or delete on public.fiscal_documents
for each row execute function public.protect_authorized_fiscal_document();

create or replace function public.configure_fiscal_profile(
  p_business_id uuid,
  p_profile jsonb
)
returns public.fiscal_profiles
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $configure_profile$
declare v_result public.fiscal_profiles%rowtype;
begin
  if not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'owner/admin requerido' using errcode='42501'; end if;
  if coalesce(p_profile,'{}'::jsonb)-array['legal_name','cuit','tax_condition','gross_income_number','business_address','environment','point_of_sale','default_currency','default_concept','invoice_policy','is_enabled'] <> '{}'::jsonb then raise exception 'payload fiscal no permitido' using errcode='22023'; end if;
  if coalesce(p_profile->>'environment','disabled') not in ('disabled','homologation') then raise exception 'produccion no se configura desde el panel' using errcode='42501'; end if;
  if (p_profile->>'is_enabled')::boolean and (
    coalesce(p_profile->>'environment','disabled')='disabled'
    or coalesce(p_profile->>'cuit','') !~ '^[0-9]{11}$'
    or coalesce((p_profile->>'point_of_sale')::integer,0) not between 1 and 99999
    or btrim(coalesce(p_profile->>'legal_name',''))=''
    or btrim(coalesce(p_profile->>'tax_condition',''))=''
  ) then raise exception 'perfil fiscal incompleto' using errcode='22023'; end if;
  insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,gross_income_number,business_address,environment,point_of_sale,default_currency,default_concept,invoice_policy,is_enabled,updated_at)
  values(p_business_id,nullif(btrim(p_profile->>'legal_name'),''),nullif(regexp_replace(coalesce(p_profile->>'cuit',''),'[^0-9]','','g'),''),nullif(btrim(p_profile->>'tax_condition'),''),nullif(btrim(p_profile->>'gross_income_number'),''),nullif(btrim(p_profile->>'business_address'),''),coalesce(p_profile->>'environment','disabled'),(p_profile->>'point_of_sale')::integer,coalesce(nullif(btrim(p_profile->>'default_currency'),''),'PES'),(p_profile->>'default_concept')::integer,coalesce(nullif(btrim(p_profile->>'invoice_policy'),''),'manual'),coalesce((p_profile->>'is_enabled')::boolean,false),now())
  on conflict(business_id) do update set
    legal_name=excluded.legal_name,cuit=excluded.cuit,tax_condition=excluded.tax_condition,
    gross_income_number=excluded.gross_income_number,business_address=excluded.business_address,
    environment=excluded.environment,point_of_sale=excluded.point_of_sale,
    default_currency=excluded.default_currency,default_concept=excluded.default_concept,
    invoice_policy=excluded.invoice_policy,is_enabled=excluded.is_enabled,updated_at=now()
  returning * into v_result;
  return v_result;
end;
$configure_profile$;

create or replace function public.request_fiscal_document(
  p_business_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_document_intent text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $request_fiscal$
declare
  v_profile public.fiscal_profiles%rowtype;
  v_sale public.pos_sales%rowtype;
  v_document public.fiscal_documents%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if p_source_type not in ('pos_sale','online_order') or p_document_intent <> 'invoice' then raise exception 'intencion fiscal no soportada' using errcode = '22023'; end if;
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = p_business_id for share;
  if not found or not v_profile.is_enabled or v_profile.environment = 'disabled' then raise exception 'fiscalizacion deshabilitada' using errcode = 'P0001'; end if;
  if v_profile.environment = 'production' and (v_profile.accountant_review_status <> 'approved' or v_profile.production_gate_status <> 'approved') then raise exception 'produccion fiscal bloqueada' using errcode = '42501'; end if;
  select d.* into v_document from public.fiscal_documents d where d.business_id=p_business_id and d.source_type=p_source_type and d.source_id=p_source_id and d.document_intent=p_document_intent;
  if found then return jsonb_build_object('fiscal_document_id',v_document.id,'state',v_document.state,'idempotent_replay',true); end if;
  if p_source_type = 'pos_sale' then
    select s.* into v_sale from public.pos_sales s where s.id=p_source_id and s.business_id=p_business_id and s.state in ('completed_fiscal_pending','completed') for share;
    if not found then raise exception 'venta no confirmada' using errcode='P0002'; end if;
    insert into public.fiscal_documents(business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,currency,total_amount,state,idempotency_key)
    values(p_business_id,p_source_type,p_source_id,p_document_intent,v_profile.environment,v_profile.cuit,v_profile.point_of_sale,0,v_profile.default_currency,v_sale.total,'queued',p_idempotency_key)
    returning * into v_document;
    insert into public.fiscal_document_items(fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount)
    select v_document.id,i.product_name,i.quantity,i.unit_price,i.line_total,0 from public.pos_sale_items i where i.sale_id=v_sale.id;
    update public.pos_sales set fiscal_document_id=v_document.id,state='completed_fiscal_pending' where id=v_sale.id;
  else
    raise exception 'facturacion online requiere politica fiscal validada' using errcode='P0001';
  end if;
  insert into public.fiscal_outbox(fiscal_document_id) values(v_document.id);
  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,actor_id,sanitized_detail) values(v_document.id,'queued','operator',auth.uid(),jsonb_build_object('source_type',p_source_type));
  return jsonb_build_object('fiscal_document_id',v_document.id,'state','queued','idempotent_replay',false);
end;
$request_fiscal$;

create or replace function public.request_full_credit_note(
  p_original_document_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $credit_note$
declare
  v_original public.fiscal_documents%rowtype;
  v_document public.fiscal_documents%rowtype;
begin
  select d.* into v_original from public.fiscal_documents d where d.id=p_original_document_id for update;
  if not found then raise exception 'comprobante original inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_original.business_id,array['owner','admin']) then raise exception 'owner/admin requerido' using errcode='42501'; end if;
  if v_original.state <> 'authorized' or v_original.document_intent <> 'invoice' then raise exception 'solo una factura autorizada admite nota de credito' using errcode='P0001'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 5 and 300 then raise exception 'motivo requerido' using errcode='22023'; end if;
  select d.* into v_document from public.fiscal_documents d where d.business_id=v_original.business_id and d.source_type='credit_note' and d.source_id=v_original.id and d.document_intent='credit_note';
  if found then return jsonb_build_object('fiscal_document_id',v_document.id,'state',v_document.state,'idempotent_replay',true); end if;
  insert into public.fiscal_documents(business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,currency,recipient_type,recipient_document_type,recipient_document_number,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,state,idempotency_key,associated_document_id)
  values(v_original.business_id,'credit_note',v_original.id,'credit_note',v_original.environment,v_original.cuit,v_original.point_of_sale,0,v_original.currency,v_original.recipient_type,v_original.recipient_document_type,v_original.recipient_document_number,v_original.net_amount,v_original.tax_amount,v_original.exempt_amount,v_original.non_taxed_amount,v_original.other_taxes_amount,v_original.total_amount,'queued',p_idempotency_key,v_original.id)
  returning * into v_document;
  insert into public.fiscal_document_items(fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount,tax_code)
  select v_document.id,i.description,i.quantity,i.unit_price,i.net_amount,i.tax_amount,i.tax_code from public.fiscal_document_items i where i.fiscal_document_id=v_original.id;
  insert into public.fiscal_outbox(fiscal_document_id) values(v_document.id);
  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,actor_id,sanitized_detail) values(v_document.id,'credit_note_queued','operator',auth.uid(),jsonb_build_object('reason',btrim(p_reason),'associated_document_id',v_original.id));
  return jsonb_build_object('fiscal_document_id',v_document.id,'state','queued','idempotent_replay',false);
end;
$credit_note$;

create or replace function public.claim_fiscal_outbox(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 90
)
returns setof public.fiscal_outbox
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $claim_fiscal$
begin
  if btrim(coalesce(p_worker_id,'')) !~ '^[A-Za-z0-9._-]{3,80}$' or p_limit not between 1 and 50 or p_lease_seconds not between 30 and 300 then raise exception 'parametros de lease invalidos' using errcode='22023'; end if;
  return query
  with candidates as (
    select o.id from public.fiscal_outbox o
    where ((o.state in ('pending','retry_wait') and o.next_attempt_at <= now()) or (o.state='leased' and o.lease_deadline < now()))
    order by o.next_attempt_at,o.created_at
    for update skip locked
    limit p_limit
  )
  update public.fiscal_outbox o
  set state='leased',lease_owner=p_worker_id,lease_deadline=now()+make_interval(secs=>p_lease_seconds),attempt_count=o.attempt_count+1
  from candidates c where o.id=c.id returning o.*;
end;
$claim_fiscal$;

create or replace function public.reserve_fiscal_document_number(
  p_document_id uuid,
  p_worker_id text,
  p_expected_number bigint
)
returns public.fiscal_documents
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $reserve_fiscal_number$
declare
  v_document public.fiscal_documents%rowtype;
  v_outbox public.fiscal_outbox%rowtype;
begin
  if p_expected_number < 1 then raise exception 'numero fiscal invalido' using errcode='22023'; end if;
  select d.* into v_document from public.fiscal_documents d where d.id=p_document_id for update;
  if not found then raise exception 'documento fiscal inexistente' using errcode='P0002'; end if;
  select o.* into v_outbox from public.fiscal_outbox o where o.fiscal_document_id=p_document_id for update;
  if not found or v_outbox.state<>'leased' or v_outbox.lease_owner<>p_worker_id or v_outbox.lease_deadline<=now() then raise exception 'lease fiscal invalido' using errcode='40001'; end if;
  if v_document.state in ('authorized','credited') or v_document.document_number is not null then return v_document; end if;
  if v_document.document_type < 1 then raise exception 'tipo de comprobante requiere revision fiscal' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',v_document.environment,v_document.cuit,v_document.point_of_sale,v_document.document_type),0));
  if exists(select 1 from public.fiscal_documents d where d.environment=v_document.environment and d.cuit=v_document.cuit and d.point_of_sale=v_document.point_of_sale and d.document_type=v_document.document_type and d.document_number=p_expected_number and d.id<>v_document.id) then
    raise exception 'numero fiscal ya reservado localmente' using errcode='40001';
  end if;
  update public.fiscal_documents set document_number=p_expected_number,state='authorizing' where id=p_document_id returning * into v_document;
  return v_document;
end;
$reserve_fiscal_number$;

create or replace function public.complete_fiscal_attempt(
  p_outbox_id uuid,
  p_worker_id text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $complete_fiscal$
declare
  v_outbox public.fiscal_outbox%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_class text;
  v_cae text;
begin
  select o.* into v_outbox from public.fiscal_outbox o where o.id=p_outbox_id for update;
  if not found or v_outbox.state <> 'leased' or v_outbox.lease_owner <> p_worker_id or v_outbox.lease_deadline <= now() then raise exception 'lease fiscal invalido' using errcode='40001'; end if;
  select d.* into v_document from public.fiscal_documents d where d.id=v_outbox.fiscal_document_id for update;
  v_class := p_result->>'classification';
  v_cae := regexp_replace(coalesce(p_result->>'cae',''),'[^0-9]','','g');
  insert into public.fiscal_request_attempts(fiscal_document_id,outbox_id,request_id,operation,result_class,request_hash,response_hash,duration_ms,error_code,error_message)
  values(v_document.id,v_outbox.id,left(coalesce(p_result->>'request_id',gen_random_uuid()::text),128),left(coalesce(p_result->>'operation','FECAESolicitar'),80),v_class,left(p_result->>'request_hash',128),left(p_result->>'response_hash',128),greatest(0,coalesce((p_result->>'duration_ms')::integer,0)),left(p_result->>'error_code',80),left(p_result->>'error_message',300));
  if v_class in ('authorized','authorized_with_observations') then
    if length(v_cae) <> 14 or coalesce((p_result->>'document_number')::bigint,0) < 1 then raise exception 'autorizacion sin CAE o numero valido' using errcode='22023'; end if;
    update public.fiscal_documents set state='authorized',result=v_class,cae=v_cae,cae_expiration=(p_result->>'cae_expiration')::date,document_number=(p_result->>'document_number')::bigint,issue_date=(p_result->>'issue_date')::date,observations=coalesce(p_result->'observations','[]'::jsonb),request_hash=p_result->>'request_hash',response_hash=p_result->>'response_hash',authorized_at=now() where id=v_document.id returning * into v_document;
    if v_document.document_intent='credit_note' and v_document.associated_document_id is not null then
      update public.fiscal_documents set state='credited' where id=v_document.associated_document_id and state='authorized';
    end if;
    update public.fiscal_outbox set state='completed',processed_at=now(),lease_owner=null,lease_deadline=null where id=v_outbox.id;
  elsif v_class='ambiguous' then
    update public.fiscal_documents set state='ambiguous',result='ambiguous',errors=coalesce(p_result->'errors','[]'::jsonb) where id=v_document.id;
    update public.fiscal_outbox set state='retry_wait',next_attempt_at=now()+interval '60 seconds',lease_owner=null,lease_deadline=null,last_error_code='AMBIGUOUS' where id=v_outbox.id;
  elsif v_class='rejected' then
    update public.fiscal_documents set state='rejected',result='rejected',observations=coalesce(p_result->'observations','[]'::jsonb),errors=coalesce(p_result->'errors','[]'::jsonb) where id=v_document.id;
    update public.fiscal_outbox set state='dead_letter',processed_at=now(),lease_owner=null,lease_deadline=null,last_error_code='ARCA_REJECTED' where id=v_outbox.id;
  elsif p_result->>'error_code'='REQUIRES_FISCAL_REVIEW' then
    update public.fiscal_documents set state='failed',result='configuration_error',errors=coalesce(p_result->'errors','[]'::jsonb) where id=v_document.id;
    update public.fiscal_outbox set state='dead_letter',processed_at=now(),lease_owner=null,lease_deadline=null,last_error_code='REQUIRES_FISCAL_REVIEW',last_error_message='Requiere datos fiscales o revision' where id=v_outbox.id;
  else
    update public.fiscal_documents set state='retry_wait',result=coalesce(v_class,'service_error') where id=v_document.id;
    update public.fiscal_outbox set state=case when attempt_count>=8 then 'dead_letter' else 'retry_wait' end,next_attempt_at=now()+least(interval '30 minutes',make_interval(secs=>30*(2^least(attempt_count,6)))),lease_owner=null,lease_deadline=null,last_error_code=left(coalesce(p_result->>'error_code','SERVICE_ERROR'),80),last_error_message=left(coalesce(p_result->>'error_message',''),300) where id=v_outbox.id;
  end if;
  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,sanitized_detail) values(v_document.id,coalesce(v_class,'service_error'),'worker',p_result-'token'-'sign'-'certificate'-'private_key');
  return jsonb_build_object('fiscal_document_id',v_document.id,'state',(select state from public.fiscal_documents where id=v_document.id));
end;
$complete_fiscal$;

-- ===== RLS and least privilege =====

alter table public.business_command_receipts enable row level security;
alter table public.product_barcodes enable row level security;
alter table public.catalog_product_drafts enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_receipts enable row level security;
alter table public.inventory_receipt_items enable row level security;
alter table public.stock_count_sessions enable row level security;
alter table public.stock_count_items enable row level security;
alter table public.order_packing_sessions enable row level security;
alter table public.order_packing_scans enable row level security;
alter table public.pos_sales enable row level security;
alter table public.pos_sale_items enable row level security;
alter table public.pos_payments enable row level security;
alter table public.fiscal_profiles enable row level security;
alter table public.fiscal_documents enable row level security;
alter table public.fiscal_document_items enable row level security;
alter table public.fiscal_events enable row level security;
alter table public.fiscal_outbox enable row level security;
alter table public.fiscal_request_attempts enable row level security;
alter table public.fiscal_parameter_snapshots enable row level security;
alter table public.notification_outbox enable row level security;

create policy "business reads barcode catalog" on public.product_barcodes for select to authenticated using(public.is_business_member(business_id));
create policy "business reads command audit" on public.business_command_receipts for select to authenticated using(public.is_business_member(business_id));
create policy "business reads product drafts" on public.catalog_product_drafts for select to authenticated using(public.is_business_member(business_id));
create policy "business reads inventory ledger" on public.inventory_movements for select to authenticated using(public.is_business_member(business_id));
create policy "business reads receipts" on public.inventory_receipts for select to authenticated using(public.is_business_member(business_id));
create policy "business reads receipt items" on public.inventory_receipt_items for select to authenticated using(exists(select 1 from public.inventory_receipts r where r.id=receipt_id and public.is_business_member(r.business_id)));
create policy "business reads stock counts" on public.stock_count_sessions for select to authenticated using(public.is_business_member(business_id));
create policy "business reads stock count items" on public.stock_count_items for select to authenticated using(exists(select 1 from public.stock_count_sessions s where s.id=session_id and public.is_business_member(s.business_id)));
create policy "business reads packing" on public.order_packing_sessions for select to authenticated using(public.is_business_member(business_id));
create policy "business reads packing scans" on public.order_packing_scans for select to authenticated using(exists(select 1 from public.order_packing_sessions s where s.id=session_id and public.is_business_member(s.business_id)));
create policy "business reads pos sales" on public.pos_sales for select to authenticated using(public.is_business_member(business_id));
create policy "business reads pos items" on public.pos_sale_items for select to authenticated using(exists(select 1 from public.pos_sales s where s.id=sale_id and public.is_business_member(s.business_id)));
create policy "business reads pos payments" on public.pos_payments for select to authenticated using(exists(select 1 from public.pos_sales s where s.id=sale_id and public.is_business_member(s.business_id)));
create policy "business reads fiscal profiles" on public.fiscal_profiles for select to authenticated using(public.is_business_member(business_id));
create policy "business reads fiscal documents" on public.fiscal_documents for select to authenticated using(public.is_business_member(business_id));
create policy "business reads fiscal items" on public.fiscal_document_items for select to authenticated using(exists(select 1 from public.fiscal_documents d where d.id=fiscal_document_id and public.is_business_member(d.business_id)));
create policy "business reads fiscal events" on public.fiscal_events for select to authenticated using(exists(select 1 from public.fiscal_documents d where d.id=fiscal_document_id and public.is_business_member(d.business_id)));
create policy "business reads notification status" on public.notification_outbox for select to authenticated using(public.is_business_member(business_id));

revoke all on table public.business_command_receipts, public.product_barcodes, public.catalog_product_drafts,
  public.inventory_movements, public.inventory_receipts, public.inventory_receipt_items,
  public.stock_count_sessions, public.stock_count_items, public.order_packing_sessions,
  public.order_packing_scans, public.pos_sales, public.pos_sale_items, public.pos_payments,
  public.fiscal_profiles, public.fiscal_documents, public.fiscal_document_items,
  public.fiscal_events, public.fiscal_outbox, public.fiscal_request_attempts,
  public.fiscal_parameter_snapshots, public.notification_outbox
from anon, authenticated;

grant select on public.business_command_receipts, public.product_barcodes, public.catalog_product_drafts, public.inventory_movements,
  public.inventory_receipts, public.inventory_receipt_items, public.stock_count_sessions, public.stock_count_items,
  public.order_packing_sessions, public.order_packing_scans, public.pos_sales, public.pos_sale_items, public.pos_payments,
  public.fiscal_profiles, public.fiscal_documents, public.fiscal_document_items, public.fiscal_events, public.notification_outbox
to authenticated;

revoke all on function public.business_command_request_hash(text,uuid,jsonb),
  public.acknowledge_order(uuid,bigint,text), public.transition_order(uuid,bigint,text,text),
  public.set_preparation_estimate(uuid,bigint,integer,text), public.cancel_order(uuid,bigint,text,text),
  public.create_catalog_product_draft(uuid,text,jsonb,text),
  public.publish_catalog_product_draft(uuid,text,text,numeric,text,integer),
  public.apply_inventory_movement(uuid,uuid,uuid,text,integer,integer,text,uuid,text,text),
  public.start_packing_session(uuid,bigint,text), public.record_packing_scan(uuid,text,text),
  public.undo_last_packing_scan(uuid), public.confirm_packing_session(uuid,text),
  public.checkout_pos_sale(uuid,jsonb,text,text,boolean),
  public.configure_fiscal_profile(uuid,jsonb), public.request_fiscal_document(uuid,text,uuid,text,text),
  public.request_full_credit_note(uuid,text,text)
from public, anon, authenticated;

grant execute on function public.acknowledge_order(uuid,bigint,text),
  public.transition_order(uuid,bigint,text,text), public.set_preparation_estimate(uuid,bigint,integer,text),
  public.cancel_order(uuid,bigint,text,text), public.create_catalog_product_draft(uuid,text,jsonb,text),
  public.publish_catalog_product_draft(uuid,text,text,numeric,text,integer),
  public.apply_inventory_movement(uuid,uuid,uuid,text,integer,integer,text,uuid,text,text),
  public.start_packing_session(uuid,bigint,text), public.record_packing_scan(uuid,text,text),
  public.undo_last_packing_scan(uuid), public.confirm_packing_session(uuid,text),
  public.checkout_pos_sale(uuid,jsonb,text,text,boolean),
  public.configure_fiscal_profile(uuid,jsonb), public.request_fiscal_document(uuid,text,uuid,text,text),
  public.request_full_credit_note(uuid,text,text)
to authenticated;

revoke all on function public.claim_fiscal_outbox(text,integer,integer), public.save_fiscal_parameter_snapshot(text,text,text,jsonb,timestamptz), public.complete_fiscal_attempt(uuid,text,jsonb)
from public, anon, authenticated;
revoke all on function public.reserve_fiscal_document_number(uuid,text,bigint) from public, anon, authenticated;
grant execute on function public.claim_fiscal_outbox(text,integer,integer), public.reserve_fiscal_document_number(uuid,text,bigint), public.save_fiscal_parameter_snapshot(text,text,text,jsonb,timestamptz), public.complete_fiscal_attempt(uuid,text,jsonb)
to service_role;

-- Realtime is an accelerator; snapshots/RPC remain authoritative.
do $realtime$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    begin alter publication supabase_realtime add table public.product_barcodes; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.inventory_movements; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.pos_sales; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.fiscal_documents; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.notification_outbox; exception when duplicate_object then null; end;
  end if;
end;
$realtime$;

comment on table public.inventory_movements is 'Ledger inmutable; las correcciones se realizan con movimientos compensatorios.';
comment on table public.fiscal_outbox is 'Cola fiscal privada con SKIP LOCKED, lease y dead-letter; nunca accesible al panel.';
comment on function public.claim_fiscal_outbox(text,integer,integer) is 'RPC privada para worker fiscal; reclama trabajos con FOR UPDATE SKIP LOCKED.';
comment on table public.fiscal_profiles is 'Configuracion fiscal administrativa. Produccion exige accountant_review_status approved y gate del servidor.';
