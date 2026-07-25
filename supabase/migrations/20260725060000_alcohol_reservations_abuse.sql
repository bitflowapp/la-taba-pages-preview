-- Configurable alcohol policy, reservation expiry and anti-abuse foundation.
-- Values are intentionally NULL/fail-closed until the business and legal owner
-- approve local rules.

alter table public.products add column if not exists minimum_age integer;
alter table public.products add column if not exists chilled boolean not null default false;
alter table public.products add column if not exists units_per_pack integer not null default 1;
alter table public.products add column if not exists external_id text;
alter table public.products add column if not exists sku text;

alter table public.products drop constraint if exists products_alcohol_requires_age;
alter table public.products add constraint products_alcohol_requires_age check (
  is_alcoholic is distinct from true
  or (minimum_age is not null and minimum_age >= 18 and minimum_age <= 99)
);
alter table public.products add constraint products_units_per_pack_positive
check (units_per_pack > 0);
create unique index if not exists products_business_external_id_key
on public.products(business_id, external_id) where external_id is not null;
create unique index if not exists products_business_sku_key
on public.products(business_id, sku) where sku is not null;

alter table public.businesses add column if not exists alcohol_sales_enabled boolean not null default false;
alter table public.businesses add column if not exists alcohol_minimum_age integer;
alter table public.businesses add column if not exists alcohol_sales_start time;
alter table public.businesses add column if not exists alcohol_sales_end time;
alter table public.businesses add column if not exists alcohol_timezone text;
alter table public.businesses add column if not exists order_rate_limit_per_10_minutes integer;
alter table public.businesses add column if not exists max_pending_orders_per_customer integer;
alter table public.businesses add column if not exists stock_reservation_minutes integer;
alter table public.businesses add column if not exists abandoned_order_minutes integer;
alter table public.businesses add column if not exists captcha_required boolean;

alter table public.businesses add constraint businesses_alcohol_policy_complete check (
  not alcohol_sales_enabled
  or (
    alcohol_minimum_age between 18 and 99
    and alcohol_sales_start is not null
    and alcohol_sales_end is not null
    and alcohol_timezone is not null
    and btrim(alcohol_timezone) <> ''
  )
);
alter table public.businesses add constraint businesses_abuse_limits_positive check (
  (order_rate_limit_per_10_minutes is null or order_rate_limit_per_10_minutes > 0)
  and (max_pending_orders_per_customer is null or max_pending_orders_per_customer > 0)
  and (stock_reservation_minutes is null or stock_reservation_minutes between 5 and 1440)
  and (abandoned_order_minutes is null or abandoned_order_minutes between 5 and 10080)
);

alter table public.orders add column if not exists age_confirmed_at timestamptz;
alter table public.orders add column if not exists age_confirmation_policy integer;
alter table public.orders add column if not exists reservation_expires_at timestamptz;
alter table public.orders add column if not exists abuse_fingerprint_hash bytea;

-- No documents, document numbers or document images are stored.
alter table public.orders add constraint orders_age_confirmation_complete check (
  (age_confirmed_at is null and age_confirmation_policy is null)
  or (age_confirmed_at is not null and age_confirmation_policy between 18 and 99)
);

create table if not exists public.order_abuse_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_user_id uuid references auth.users(id) on delete set null,
  fingerprint_hash bytea,
  event_type text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint order_abuse_events_no_raw_fingerprint check (
    fingerprint_hash is null or octet_length(fingerprint_hash) = 32
  )
);
alter table public.order_abuse_events enable row level security;
revoke all privileges on table public.order_abuse_events from public, anon, authenticated;
grant select on table public.order_abuse_events to authenticated;
create policy "authorized team reads abuse events"
on public.order_abuse_events for select to authenticated
using (public.has_business_role(business_id, array['owner', 'admin']));

-- Intended for a trusted scheduler/database owner, never the browser. It
-- returns expired submitted/received orders to canceled and releases exactly
-- the stock reserved by the authoritative creation RPC.
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
           available = p.is_verified and p.is_active
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
  'Trusted scheduled cleanup for expired stock reservations; never expose to browser roles.';
