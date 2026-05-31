create extension if not exists pgcrypto;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'open' check (status in ('open', 'paused', 'closed')),
  phone text,
  whatsapp text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  code text not null unique,
  status text not null default 'submitted' check (
    status in ('draft', 'submitted', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'on_the_way', 'arrived', 'delivered', 'canceled')
  ),
  fulfillment_type text not null default 'delivery' check (fulfillment_type in ('delivery', 'pickup')),
  customer_name text,
  customer_phone text,
  customer_whatsapp text,
  address_label text,
  address_lat double precision check (address_lat is null or (address_lat >= -90 and address_lat <= 90)),
  address_lng double precision check (address_lng is null or (address_lng >= -180 and address_lng <= 180)),
  notes text,
  payment_method text,
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  delivery_fee numeric(12, 2) not null default 0 check (delivery_fee >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  assigned_rider_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  ready_at timestamptz,
  picked_up_at timestamptz,
  arrived_at timestamptz,
  delivered_at timestamptz,
  canceled_at timestamptz,
  constraint orders_total_matches_parts check (total = subtotal + delivery_fee)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id text not null,
  name text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit text,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  created_at timestamptz not null default now(),
  constraint order_items_subtotal_matches_parts check (subtotal = quantity * unit_price)
);

create table if not exists public.riders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  phone text,
  whatsapp text,
  status text not null default 'available' check (status in ('available', 'assigned', 'offline', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders
  drop constraint if exists orders_assigned_rider_id_fkey;

alter table public.orders
  add constraint orders_assigned_rider_id_fkey
  foreign key (assigned_rider_id) references public.riders(id) on delete set null;

create table if not exists public.rider_locations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  rider_id uuid references public.riders(id) on delete set null,
  lat double precision not null check (lat >= -90 and lat <= 90),
  lng double precision not null check (lng >= -180 and lng <= 180),
  accuracy double precision check (accuracy is null or accuracy >= 0),
  heading double precision check (heading is null or (heading >= 0 and heading < 360)),
  speed double precision check (speed is null or speed >= 0),
  source text not null check (source in ('gps', 'simulation', 'manual')),
  created_at timestamptz not null default now()
);

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  type text not null,
  actor_type text,
  actor_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists businesses_status_idx on public.businesses(status);
create index if not exists orders_business_created_idx on public.orders(business_id, created_at desc);
create index if not exists orders_business_status_idx on public.orders(business_id, status);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists riders_business_status_idx on public.riders(business_id, status);
create index if not exists rider_locations_order_created_idx on public.rider_locations(order_id, created_at desc);
create index if not exists order_events_order_created_idx on public.order_events(order_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists businesses_set_updated_at on public.businesses;
create trigger businesses_set_updated_at
before update on public.businesses
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists riders_set_updated_at on public.riders;
create trigger riders_set_updated_at
before update on public.riders
for each row execute function public.set_updated_at();

alter table public.businesses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.riders enable row level security;
alter table public.rider_locations enable row level security;
alter table public.order_events enable row level security;

drop policy if exists "phase1 public read businesses" on public.businesses;
create policy "phase1 public read businesses"
on public.businesses for select
to anon, authenticated
using (true);

drop policy if exists "phase1 public create orders" on public.orders;
create policy "phase1 public create orders"
on public.orders for insert
to anon, authenticated
with check (status in ('draft', 'submitted', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'on_the_way', 'arrived', 'delivered', 'canceled'));

drop policy if exists "phase1 public read orders" on public.orders;
create policy "phase1 public read orders"
on public.orders for select
to anon, authenticated
using (true);

drop policy if exists "phase1 public update orders" on public.orders;
create policy "phase1 public update orders"
on public.orders for update
to anon, authenticated
using (true)
with check (status in ('draft', 'submitted', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'on_the_way', 'arrived', 'delivered', 'canceled'));

drop policy if exists "phase1 public create order items" on public.order_items;
create policy "phase1 public create order items"
on public.order_items for insert
to anon, authenticated
with check (true);

drop policy if exists "phase1 public read order items" on public.order_items;
create policy "phase1 public read order items"
on public.order_items for select
to anon, authenticated
using (true);

drop policy if exists "phase1 public read riders" on public.riders;
create policy "phase1 public read riders"
on public.riders for select
to anon, authenticated
using (true);

drop policy if exists "phase1 public update riders" on public.riders;
create policy "phase1 public update riders"
on public.riders for update
to anon, authenticated
using (true)
with check (status in ('available', 'assigned', 'offline', 'paused'));

drop policy if exists "phase1 public create rider locations" on public.rider_locations;
create policy "phase1 public create rider locations"
on public.rider_locations for insert
to anon, authenticated
with check (source in ('gps', 'simulation', 'manual'));

drop policy if exists "phase1 public read rider locations" on public.rider_locations;
create policy "phase1 public read rider locations"
on public.rider_locations for select
to anon, authenticated
using (true);

drop policy if exists "phase1 public create order events" on public.order_events;
create policy "phase1 public create order events"
on public.order_events for insert
to anon, authenticated
with check (true);

drop policy if exists "phase1 public read order events" on public.order_events;
create policy "phase1 public read order events"
on public.order_events for select
to anon, authenticated
using (true);

insert into public.businesses (id, name, status, phone, whatsapp)
values ('00000000-0000-4000-8000-000000000001', 'La Taba', 'open', null, null)
on conflict (id) do update
set name = excluded.name,
    status = excluded.status,
    updated_at = now();
