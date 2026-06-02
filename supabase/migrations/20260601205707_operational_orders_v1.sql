-- La Taba - Backend Operativo DB v1
--
-- Objetivo:
-- - dejar una base operativa real para pedidos, comercio, rider y GPS;
-- - mantener compatibilidad con las migraciones piloto existentes;
-- - no depender de secretos ni de configuracion de frontend;
-- - no activar nada remoto por si sola: esta migracion queda versionada para aplicar
--   cuando haya confirmacion explicita.

create extension if not exists pgcrypto;

-- ===== Negocios =====
alter table public.businesses add column if not exists slug text;
alter table public.businesses add column if not exists address text;
alter table public.businesses add column if not exists whatsapp_phone text;
alter table public.businesses add column if not exists is_active boolean not null default true;

update public.businesses
   set slug = 'business-' || replace(id::text, '-', '')
 where slug is null or btrim(slug) = '';

alter table public.businesses alter column slug set not null;
create unique index if not exists businesses_slug_key on public.businesses(slug);

-- La migracion piloto usaba whatsapp; el modelo operativo expone whatsapp_phone.
update public.businesses
   set whatsapp_phone = coalesce(whatsapp_phone, whatsapp)
 where whatsapp_phone is null;

-- ===== Membresias y productos =====
create table if not exists public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'staff', 'rider')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  category text,
  price numeric(12, 2) not null check (price >= 0),
  image_url text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== Pedidos: completar el modelo operativo sin romper columnas piloto =====
create sequence if not exists public.order_public_code_seq start with 1 increment by 1;

alter table public.orders add column if not exists public_code text;
alter table public.orders add column if not exists customer_street_address text;
alter table public.orders add column if not exists customer_neighborhood text;
alter table public.orders add column if not exists customer_reference text;
alter table public.orders add column if not exists customer_notes text;
alter table public.orders add column if not exists delivery_mode text;
alter table public.orders add column if not exists assigned_rider_user_id uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists preparing_at timestamptz;
alter table public.orders add column if not exists dispatched_at timestamptz;
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists rejected_at timestamptz;

update public.orders
   set public_code = coalesce(public_code, code)
 where public_code is null;

update public.orders
   set delivery_mode = coalesce(delivery_mode, fulfillment_type)
 where delivery_mode is null;

update public.orders
   set customer_street_address = coalesce(customer_street_address, address_label)
 where customer_street_address is null;

update public.orders
   set customer_notes = coalesce(customer_notes, notes)
 where customer_notes is null;

alter table public.orders alter column public_code set not null;
alter table public.orders alter column delivery_mode set not null;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (
  status in (
    -- operativo v1
    'received', 'accepted', 'preparing', 'ready', 'on_the_way',
    'delivered', 'cancelled', 'rejected',
    -- compatibilidad con phase1 adapter
    'draft', 'submitted', 'assigned', 'picked_up', 'arrived', 'arriving', 'canceled'
  )
);

alter table public.orders drop constraint if exists orders_delivery_mode_check;
alter table public.orders add constraint orders_delivery_mode_check check (delivery_mode in ('delivery', 'pickup'));

alter table public.orders drop constraint if exists orders_total_not_below_subtotal;
alter table public.orders add constraint orders_total_not_below_subtotal check (total >= subtotal);

create unique index if not exists orders_business_public_code_key on public.orders(business_id, public_code);

-- ===== Items =====
alter table public.order_items alter column product_id drop not null;

alter table public.order_items
  drop constraint if exists order_items_product_id_fkey;

alter table public.order_items
  add column if not exists product_uuid uuid references public.products(id) on delete set null;

-- ===== Eventos =====
alter table public.order_events add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.order_events add column if not exists actor_user_id uuid references auth.users(id) on delete set null;
alter table public.order_events add column if not exists actor_role text check (actor_role in ('customer', 'business', 'rider', 'system'));
alter table public.order_events add column if not exists event_type text;
alter table public.order_events add column if not exists message text;
alter table public.order_events add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.order_events e
   set business_id = o.business_id
  from public.orders o
 where e.order_id = o.id
   and e.business_id is null;

update public.order_events
   set event_type = coalesce(event_type, type)
 where event_type is null;

update public.order_events
   set metadata = coalesce(nullif(metadata, '{}'::jsonb), payload, '{}'::jsonb);

alter table public.order_events alter column event_type set not null;
alter table public.order_events alter column business_id set not null;

-- ===== Ubicaciones reales del rider =====
alter table public.rider_locations add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.rider_locations add column if not exists rider_user_id uuid references auth.users(id) on delete cascade;

update public.rider_locations rl
   set business_id = o.business_id
  from public.orders o
 where rl.order_id = o.id
   and rl.business_id is null;

alter table public.rider_locations alter column source set default 'gps';
alter table public.rider_locations alter column business_id set not null;

alter table public.rider_locations drop constraint if exists rider_locations_source_operational_check;
alter table public.rider_locations add constraint rider_locations_source_operational_check check (source = 'gps') not valid;

-- ===== Tokens publicos de tracking =====
create table if not exists public.order_public_tokens (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- ===== Funciones y triggers =====
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.next_order_public_code()
returns text
language sql
as $$
  select 'LT-' || lpad(nextval('public.order_public_code_seq')::text, 4, '0')
$$;

create or replace function public.set_order_operational_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.public_code is null or btrim(new.public_code) = '' then
    new.public_code := coalesce(nullif(new.code, ''), public.next_order_public_code());
  end if;

  if new.code is null or btrim(new.code) = '' then
    new.code := new.public_code;
  end if;

  if new.delivery_mode is null or btrim(new.delivery_mode) = '' then
    new.delivery_mode := coalesce(nullif(new.fulfillment_type, ''), 'delivery');
  end if;

  if new.fulfillment_type is null or btrim(new.fulfillment_type) = '' then
    new.fulfillment_type := new.delivery_mode;
  end if;

  if new.customer_street_address is null or btrim(new.customer_street_address) = '' then
    new.customer_street_address := new.address_label;
  end if;

  if new.customer_notes is null then
    new.customer_notes := new.notes;
  end if;

  return new;
end;
$$;

create or replace function public.set_order_status_timestamps()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status in ('accepted') and new.accepted_at is null then
      new.accepted_at := now();
    end if;
    if new.status in ('preparing') and new.preparing_at is null then
      new.preparing_at := now();
    end if;
    if new.status = 'ready' and new.ready_at is null then
      new.ready_at := now();
    end if;
    if new.status in ('on_the_way', 'picked_up') then
      new.dispatched_at := coalesce(new.dispatched_at, now());
      new.picked_up_at := coalesce(new.picked_up_at, new.dispatched_at);
    end if;
    if new.status in ('delivered') and new.delivered_at is null then
      new.delivered_at := now();
    end if;
    if new.status in ('cancelled', 'canceled') then
      new.cancelled_at := coalesce(new.cancelled_at, now());
      new.canceled_at := coalesce(new.canceled_at, new.cancelled_at);
    end if;
    if new.status = 'rejected' and new.rejected_at is null then
      new.rejected_at := now();
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.log_order_status_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.order_events (
      order_id,
      business_id,
      actor_role,
      event_type,
      type,
      message,
      metadata,
      payload
    ) values (
      new.id,
      new.business_id,
      'system',
      'order.status_changed',
      'order.status_changed',
      'Estado actualizado de ' || old.status || ' a ' || new.status,
      jsonb_build_object('previous_status', old.status, 'next_status', new.status),
      jsonb_build_object('previous_status', old.status, 'next_status', new.status)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists businesses_set_updated_at on public.businesses;
create trigger businesses_set_updated_at
before update on public.businesses
for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_operational_defaults on public.orders;
create trigger orders_set_operational_defaults
before insert or update on public.orders
for each row execute function public.set_order_operational_defaults();

drop trigger if exists orders_set_status_timestamps on public.orders;
create trigger orders_set_status_timestamps
before insert or update on public.orders
for each row execute function public.set_order_status_timestamps();

drop trigger if exists orders_log_status_event on public.orders;
create trigger orders_log_status_event
after update on public.orders
for each row execute function public.log_order_status_event();

-- ===== Indices =====
create index if not exists orders_business_created_idx on public.orders(business_id, created_at desc);
create index if not exists orders_business_status_idx on public.orders(business_id, status);
create index if not exists orders_business_public_code_idx on public.orders(business_id, public_code);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_events_order_created_idx on public.order_events(order_id, created_at desc);
create index if not exists rider_locations_order_created_idx on public.rider_locations(order_id, created_at desc);
create index if not exists rider_locations_business_rider_created_idx on public.rider_locations(business_id, rider_user_id, created_at desc);
create index if not exists business_members_user_idx on public.business_members(user_id);
create index if not exists products_business_active_idx on public.products(business_id, is_active);
create index if not exists order_public_tokens_order_idx on public.order_public_tokens(order_id);

-- ===== RLS helpers =====
create or replace function public.request_order_token()
returns text
language plpgsql
stable
as $$
declare
  headers jsonb;
begin
  headers := nullif(current_setting('request.headers', true), '')::jsonb;
  return nullif(headers->>'x-order-token', '');
exception
  when others then
    return null;
end;
$$;

create or replace function public.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.business_members bm
     where bm.business_id = target_business_id
       and bm.user_id = auth.uid()
       and bm.is_active = true
  )
$$;

create or replace function public.has_business_role(target_business_id uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.business_members bm
     where bm.business_id = target_business_id
       and bm.user_id = auth.uid()
       and bm.is_active = true
       and bm.role = any (roles)
  )
$$;

create or replace function public.is_assigned_rider(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.orders o
     where o.id = target_order_id
       and o.assigned_rider_user_id = auth.uid()
  )
$$;

create or replace function public.can_access_order(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.orders o
     where o.id = target_order_id
       and (
         public.is_business_member(o.business_id)
         or o.assigned_rider_user_id = auth.uid()
         or exists (
           select 1
             from public.order_public_tokens opt
            where opt.order_id = o.id
              and opt.token = public.request_order_token()
              and (opt.expires_at is null or opt.expires_at > now())
         )
       )
  )
$$;

-- ===== RLS =====
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.rider_locations enable row level security;
alter table public.order_public_tokens enable row level security;
alter table public.riders enable row level security;

-- Retira policies abiertas de la fase piloto. La demo publica no depende de estas.
drop policy if exists "phase1 public read orders" on public.orders;
drop policy if exists "phase1 public update orders" on public.orders;
drop policy if exists "phase1 public read order items" on public.order_items;
drop policy if exists "phase1 public read rider locations" on public.rider_locations;
drop policy if exists "phase1 public create rider locations" on public.rider_locations;
drop policy if exists "phase1 public read order events" on public.order_events;
drop policy if exists "phase1 public create order events" on public.order_events;
drop policy if exists "phase1 public read riders" on public.riders;
drop policy if exists "phase1 public update riders" on public.riders;

drop policy if exists "operational active businesses are public" on public.businesses;
create policy "operational active businesses are public"
on public.businesses for select
to anon, authenticated
using (is_active = true);

drop policy if exists "operational members read own rows" on public.business_members;
create policy "operational members read own rows"
on public.business_members for select
to authenticated
using (user_id = auth.uid() or public.has_business_role(business_id, array['owner']));

drop policy if exists "operational owners manage members" on public.business_members;
create policy "operational owners manage members"
on public.business_members for all
to authenticated
using (public.has_business_role(business_id, array['owner']))
with check (public.has_business_role(business_id, array['owner']));

drop policy if exists "operational active products are public" on public.products;
create policy "operational active products are public"
on public.products for select
to anon, authenticated
using (is_active = true);

drop policy if exists "operational staff manage products" on public.products;
create policy "operational staff manage products"
on public.products for all
to authenticated
using (public.has_business_role(business_id, array['owner', 'staff']))
with check (public.has_business_role(business_id, array['owner', 'staff']));

drop policy if exists "operational team reads legacy riders" on public.riders;
create policy "operational team reads legacy riders"
on public.riders for select
to authenticated
using (public.is_business_member(business_id));

drop policy if exists "operational orders readable by token or team" on public.orders;
create policy "operational orders readable by token or team"
on public.orders for select
to anon, authenticated
using (public.can_access_order(id));

drop policy if exists "operational team updates orders" on public.orders;
create policy "operational team updates orders"
on public.orders for update
to authenticated
using (
  public.has_business_role(business_id, array['owner', 'staff'])
  or (
    public.has_business_role(business_id, array['rider'])
    and status in ('ready', 'assigned', 'picked_up', 'on_the_way', 'arrived', 'arriving')
    and (assigned_rider_user_id is null or assigned_rider_user_id = auth.uid())
  )
)
with check (
  public.has_business_role(business_id, array['owner', 'staff'])
  or (
    public.has_business_role(business_id, array['rider'])
    and status in ('ready', 'assigned', 'picked_up', 'on_the_way', 'arrived', 'arriving', 'delivered')
    and (assigned_rider_user_id is null or assigned_rider_user_id = auth.uid())
  )
);

drop policy if exists "operational order items readable with order" on public.order_items;
create policy "operational order items readable with order"
on public.order_items for select
to anon, authenticated
using (public.can_access_order(order_id));

drop policy if exists "operational order events readable with order" on public.order_events;
create policy "operational order events readable with order"
on public.order_events for select
to anon, authenticated
using (public.can_access_order(order_id));

drop policy if exists "operational team writes order events" on public.order_events;
create policy "operational team writes order events"
on public.order_events for insert
to authenticated
with check (public.is_business_member(business_id));

drop policy if exists "operational rider locations readable with order" on public.rider_locations;
create policy "operational rider locations readable with order"
on public.rider_locations for select
to anon, authenticated
using (public.can_access_order(order_id));

drop policy if exists "operational assigned rider writes gps" on public.rider_locations;
create policy "operational assigned rider writes gps"
on public.rider_locations for insert
to authenticated
with check (
  source = 'gps'
  and rider_user_id = auth.uid()
  and public.is_assigned_rider(order_id)
);

drop policy if exists "operational token reads itself" on public.order_public_tokens;
create policy "operational token reads itself"
on public.order_public_tokens for select
to anon, authenticated
using (
  token = public.request_order_token()
  and (expires_at is null or expires_at > now())
);

drop policy if exists "operational team reads order tokens" on public.order_public_tokens;
create policy "operational team reads order tokens"
on public.order_public_tokens for select
to authenticated
using (
  exists (
    select 1
      from public.orders o
     where o.id = order_id
       and public.is_business_member(o.business_id)
  )
);

-- La creacion anonima queda por RPC validada. La funcion phase1 existente sigue
-- disponible para el adapter piloto; la integracion productiva deberia crear
-- tambien order_public_tokens en una RPC nueva antes de operar con clientes reales.
grant execute on function public.create_order_with_items(jsonb) to anon, authenticated;

-- ===== Realtime =====
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception
  when undefined_object then
    raise notice 'publication supabase_realtime no existe en este entorno';
  when duplicate_object then
    null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.order_events;
exception
  when undefined_object then
    raise notice 'publication supabase_realtime no existe en este entorno';
  when duplicate_object then
    null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.rider_locations;
exception
  when undefined_object then
    raise notice 'publication supabase_realtime no existe en este entorno';
  when duplicate_object then
    null;
end;
$$;

comment on table public.business_members is 'Membresia Auth -> negocio para owners, staff y riders.';
comment on table public.order_public_tokens is 'Token publico opaco para que un cliente anonimo lea solo su pedido.';
comment on table public.rider_locations is 'Ubicaciones GPS reales asociadas a un pedido y rider; no almacena rutas ni ETA.';
comment on function public.can_access_order(uuid) is 'Acceso a pedido por membresia, rider asignado o token publico vigente.';
