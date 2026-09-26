-- =============================================================================
-- Migration: 20260918010000_merchant_availability_separate_from_stock.sql
-- Description: Separate merchant publication intent from stock-derived availability.
--
-- Problem:
--   `products.available` overloaded two distinct concepts:
--   1) Merchant publication intent (whether Walter chose to offer the product).
--   2) Instantaneous inventory availability (stock > 0 and price confirmed).
--   When a merchant explicitly hid a product (`available = false` via
--   `set_commercial_product_publication`), and a checkout reservation or order
--   subsequently expired or was cancelled, the restoration RPCs
--   (`release_checkout_session_inventory` / `release_expired_stock_reservations`)
--   recomputed `available = is_active and is_verified and stock > 0`, unconditionally
--   setting `available = true` and overriding the merchant's explicit intent.
--
-- Solution:
--   1) Introduce explicit column `merchant_available boolean not null default true`.
--   2) Backfill `merchant_available = available`.
--   3) Update check constraint `products_available_requires_verification` to require
--      `merchant_available` whenever `available = true`.
--   4) Update `set_commercial_product_publication`: toggle `merchant_available` and `available`.
--   5) Update `unpublish_catalog_product`: clear `merchant_available = false`.
--   6) Update `release_checkout_session_inventory` & `release_expired_stock_reservations`:
--      restore `available` only if `merchant_available` is true.
--
-- Forward-only. Safe for production and staging.
-- =============================================================================

-- 1. Add column merchant_available
alter table public.products
  add column if not exists merchant_available boolean not null default true;

comment on column public.products.merchant_available is
  'Authoritative merchant intent to publish/sell this product. Independent of momentary zero-stock or active checkout reservations.';

-- 2. Backfill existing rows: preserve current visibility intent
update public.products
   set merchant_available = available;

-- 3. Update CHECK constraint to require merchant_available when available is true
alter table public.products
  drop constraint if exists products_available_requires_verification;

alter table public.products
  add constraint products_available_requires_verification check (
    not available
    or (
      merchant_available
      and is_verified
      and is_active
      and stock is not null
      and stock > 0
      and price_status = 'confirmed'
      and price > 0
    )
  );

comment on constraint products_available_requires_verification on public.products is
  'A purchasable product has merchant intent (merchant_available), is verified, active, has known stock above zero, a confirmed price state and a price above zero.';

-- 4. Update set_commercial_product_publication
create or replace function public.set_commercial_product_publication(
  p_business_id uuid,
  p_sku text,
  p_publish boolean
)
returns table (
  applied_sku text,
  applied_available boolean,
  applied_is_verified boolean,
  applied_price numeric(12, 2),
  applied_stock integer,
  applied_price_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
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
end;
$$;

revoke all on function public.set_commercial_product_publication(uuid, text, boolean)
from public, anon, authenticated;
grant execute on function public.set_commercial_product_publication(uuid, text, boolean)
to authenticated;

comment on function public.set_commercial_product_publication(uuid, text, boolean) is
  'Toggle available and merchant_available for ONE already-verified commercial product (owner/admin only).';

-- 5. Update unpublish_catalog_product
create or replace function public.unpublish_catalog_product(
  p_business_id uuid,
  p_external_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_updated integer;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can unpublish catalog products.';
  end if;
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
  return v_updated = 1;
end;
$$;

revoke all on function public.unpublish_catalog_product(uuid, text) from public, anon;
grant execute on function public.unpublish_catalog_product(uuid, text) to authenticated;

-- 6. Update release_checkout_session_inventory
create or replace function public.release_checkout_session_inventory(
  p_checkout_session_id uuid,
  p_reason text,
  p_terminal_status text default 'cancelled'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_session public.checkout_sessions%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_released integer := 0;
  v_status text := lower(btrim(coalesce(p_terminal_status, 'cancelled')));
begin
  if v_status not in ('cancelled', 'expired') then
    raise exception 'estado terminal de reserva invalido' using errcode = '22023';
  end if;
  select * into v_session
    from public.checkout_sessions s
   where s.id = p_checkout_session_id
   for update;
  if not found then
    raise exception 'checkout inexistente' using errcode = 'P0002';
  end if;
  if v_session.status in ('completed', 'payment_approved', 'finalizing_order', 'manual_review_required') then
    return jsonb_build_object('released', 0, 'skipped', true, 'status', v_session.status);
  end if;

  -- Products are locked in deterministic order before stock is restored.
  perform 1
    from public.products p
    join public.inventory_reservations r on r.product_id = p.id
   where r.checkout_session_id = v_session.id and r.status = 'active'
   order by p.id
   for update;
  for v_reservation in
    select * from public.inventory_reservations r
     where r.checkout_session_id = v_session.id and r.status = 'active'
     order by r.product_id, r.reservation_generation
     for update
  loop
    update public.products p
       set stock = p.stock + v_reservation.quantity,
           available = p.merchant_available
                       and p.is_active
                       and p.is_verified
                       and (p.stock + v_reservation.quantity) > 0
                       and p.price_status = 'confirmed'
                       and p.price > 0
     where p.id = v_reservation.product_id;
    update public.inventory_reservations
       set status = 'released', released_at = clock_timestamp(),
           release_reason = left(coalesce(p_reason, 'terminal'), 120)
     where id = v_reservation.id and status = 'active';
    v_released := v_released + 1;
  end loop;
  update public.checkout_sessions
     set status = v_status
   where id = v_session.id
     and status not in ('completed', 'payment_approved', 'finalizing_order', 'manual_review_required');
  update public.payment_intents
     set internal_status = case
       when public.payment_internal_status_rank(internal_status) < public.payment_internal_status_rank(v_status)
         then v_status else internal_status end
   where checkout_session_id = v_session.id;
  return jsonb_build_object('released', v_released, 'status', v_status);
end;
$$;

revoke all on function public.release_checkout_session_inventory(uuid, text, text) from public, anon, authenticated;
comment on function public.release_checkout_session_inventory(uuid, text, text) is
  'Release reserved stock for a cancelled or expired checkout session. Restores available only if product is merchant_available, active, verified, has positive stock and confirmed price.';

-- 7. Update release_expired_stock_reservations
create or replace function public.release_expired_stock_reservations(p_limit integer default 100)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_count integer := 0;
begin
  for v_order in
    select *
      from public.orders
     where reservation_expires_at < clock_timestamp()
       and inventory_released_at is null
       and status in ('received', 'submitted')
     order by reservation_expires_at
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    update public.products p
       set stock = p.stock + oi.quantity::integer,
           available = p.merchant_available
                       and p.is_verified
                       and p.is_active
                       and (p.stock + oi.quantity::integer) > 0
                       and p.price_status = 'confirmed'
                       and p.price > 0
      from public.order_items oi
     where oi.order_id = v_order.id
       and oi.product_uuid = p.id;

    update public.orders
       set status = 'canceled',
           canceled_at = clock_timestamp(),
           inventory_released_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where id = v_order.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.release_expired_stock_reservations(integer) from public, anon, authenticated;
comment on function public.release_expired_stock_reservations(integer) is
  'Trusted scheduled cleanup for expired stock reservations. Restores available only when merchant_available is true.';
