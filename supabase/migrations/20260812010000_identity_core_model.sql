-- TABA2 · Capa de identidad, parte 1: modelo y permisos explicitos.
--
-- Antes de esta migracion la unica identidad operativa era
-- public.business_members(business_id, user_id, role, is_active), con el rol
-- restringido por CHECK a ('owner','staff','rider'). Sin embargo la migracion
-- 20260725030000 creo tres politicas que otorgan poderes al rol 'admin'
-- ("production admins add/update/remove staff and riders") y el cliente web
-- declara TEAM_ROLES = owner|admin|staff|rider. Ese rol era inalcanzable: el
-- CHECK impedia insertarlo, asi que las tres politicas nunca podian evaluarse
-- a verdadero. Esta migracion convierte 'admin' en un rol real y le da a cada
-- rol un conjunto de permisos declarado, en vez de repartir autoridad por
-- coincidencia de cadenas en cada politica.
--
-- Aplicar despues de 20260811020000_public_tracking_canonical_capture_order.sql.

-- ===========================================================================
-- 1. El rol admin deja de ser un fantasma
-- ===========================================================================

alter table public.business_members
  drop constraint if exists business_members_role_check;

alter table public.business_members
  add constraint business_members_role_check
  check (role in ('owner', 'admin', 'staff', 'rider'));

-- ===========================================================================
-- 2. Perfiles separados de staff y de Rider
-- ===========================================================================
-- Un perfil no otorga permisos: los permisos viven en la membresia. El perfil
-- guarda la identidad operativa (como se llama la persona, como contactarla) y
-- su estado propio, para que dar de baja a alguien no obligue a borrar el
-- historial de sus pedidos.

create table if not exists public.staff_profiles (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  contact_phone text check (contact_phone is null or contact_phone ~ '^[0-9+][0-9 +().-]{5,29}$'),
  job_title text check (job_title is null or length(btrim(job_title)) between 2 and 60),
  status text not null default 'active' check (status in ('active', 'suspended')),
  onboarded_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (business_id, user_id),
  constraint staff_profiles_membership_fkey
    foreign key (business_id, user_id)
    references public.business_members(business_id, user_id) on delete cascade
);

create table if not exists public.rider_profiles (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  contact_phone text check (contact_phone is null or contact_phone ~ '^[0-9+][0-9 +().-]{5,29}$'),
  vehicle_kind text not null default 'motorcycle'
    check (vehicle_kind in ('motorcycle', 'bicycle', 'car', 'walking')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  onboarded_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (business_id, user_id),
  constraint rider_profiles_membership_fkey
    foreign key (business_id, user_id)
    references public.business_members(business_id, user_id) on delete cascade
);

drop trigger if exists staff_profiles_set_updated_at on public.staff_profiles;
create trigger staff_profiles_set_updated_at
before update on public.staff_profiles
for each row execute function public.set_updated_at();

drop trigger if exists rider_profiles_set_updated_at on public.rider_profiles;
create trigger rider_profiles_set_updated_at
before update on public.rider_profiles
for each row execute function public.set_updated_at();

-- Un perfil de staff no puede colgar de una membresia de Rider y viceversa.
-- El FK compuesto garantiza que la membresia existe; este trigger garantiza
-- que es de la clase correcta, incluso si alguien cambia el rol despues.
create or replace function public.identity_assert_profile_role()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_expected text := case tg_table_name
                       when 'staff_profiles' then 'staff'
                       when 'rider_profiles' then 'rider'
                     end;
  v_role text;
begin
  select bm.role into v_role
    from public.business_members bm
   where bm.business_id = new.business_id
     and bm.user_id = new.user_id;

  if v_role is null then
    raise exception 'identity: no hay membresia para el perfil'
      using errcode = 'check_violation';
  end if;

  -- owner y admin tambien operan el Panel, asi que comparten el perfil de staff.
  if v_expected = 'staff' and v_role not in ('owner', 'admin', 'staff') then
    raise exception 'identity: el perfil de staff exige un rol de Panel, no %', v_role
      using errcode = 'check_violation';
  end if;

  if v_expected = 'rider' and v_role <> 'rider' then
    raise exception 'identity: el perfil de Rider exige rol rider, no %', v_role
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists staff_profiles_assert_role on public.staff_profiles;
create trigger staff_profiles_assert_role
before insert or update on public.staff_profiles
for each row execute function public.identity_assert_profile_role();

drop trigger if exists rider_profiles_assert_role on public.rider_profiles;
create trigger rider_profiles_assert_role
before insert or update on public.rider_profiles
for each row execute function public.identity_assert_profile_role();

-- ===========================================================================
-- 3. Estado de seguridad por persona y comercio
-- ===========================================================================
-- sessions_valid_from es la palanca de "cerrar todas las sesiones": cualquier
-- token emitido antes de ese instante deja de ser aceptado, incluso si el
-- dispositivo nunca aparecio en la lista de sesiones conocidas.

create table if not exists public.identity_user_security (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sessions_valid_from timestamptz not null default '-infinity'::timestamptz,
  disabled_at timestamptz,
  disabled_by uuid references auth.users(id) on delete set null,
  disabled_reason text check (disabled_reason is null or length(btrim(disabled_reason)) between 3 and 200),
  updated_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

drop trigger if exists identity_user_security_set_updated_at on public.identity_user_security;
create trigger identity_user_security_set_updated_at
before update on public.identity_user_security
for each row execute function public.set_updated_at();

-- ===========================================================================
-- 4. Catalogo explicito de permisos
-- ===========================================================================
-- El objetivo es que "quien puede hacer que" se pueda leer en una tabla y se
-- pueda probar, en vez de deducirlo de veinte arrays de texto repartidos por
-- las politicas.

create table if not exists public.identity_permissions (
  permission text primary key check (permission ~ '^[a-z]+(\.[a-z_]+)+$'),
  description text not null
);

create table if not exists public.identity_role_permissions (
  role text not null check (role in ('owner', 'admin', 'staff', 'rider')),
  permission text not null references public.identity_permissions(permission) on delete cascade,
  primary key (role, permission)
);

insert into public.identity_permissions (permission, description) values
  ('orders.read',              'Ver pedidos del comercio'),
  ('orders.operate',           'Aceptar, preparar y marcar listo un pedido'),
  ('orders.cancel',            'Cancelar un pedido'),
  ('orders.dispatch',          'Asignar y despachar riders'),
  ('delivery.operate',         'Operar la entrega asignada al propio Rider'),
  ('catalog.read',             'Ver el catalogo interno'),
  ('catalog.write',            'Editar productos, precios y stock'),
  ('catalog.publish',          'Publicar o retirar productos del sitio'),
  ('business.settings',        'Abrir/cerrar el comercio y configurar la operacion'),
  ('payments.read',            'Ver cobros y conciliacion'),
  ('payments.reconcile',       'Reconciliar y recuperar cobros'),
  ('fiscal.read',              'Ver documentos fiscales'),
  ('fiscal.authorize',         'Autorizar homologacion fiscal'),
  ('identity.members.read',    'Ver el equipo del comercio'),
  ('identity.members.write',   'Alta y baja de staff y riders'),
  ('identity.roles.write',     'Cambiar roles, incluidos owner y admin'),
  ('identity.invite',          'Emitir invitaciones de alta'),
  ('identity.sessions.read',   'Ver sesiones y dispositivos del equipo'),
  ('identity.sessions.revoke', 'Cerrar sesiones ajenas'),
  ('audit.read',               'Leer la auditoria de identidad')
on conflict (permission) do update set description = excluded.description;

-- owner: todo.
insert into public.identity_role_permissions (role, permission)
select 'owner', permission from public.identity_permissions
on conflict do nothing;

-- admin: operacion completa y alta de staff/rider, pero no toca roles de
-- direccion ni firma actos fiscales. El limite "no puede crear owner ni admin"
-- se refuerza aparte en las RPC de identidad; aqui queda declarado.
insert into public.identity_role_permissions (role, permission)
select 'admin', permission
  from public.identity_permissions
 where permission in (
   'orders.read', 'orders.operate', 'orders.cancel', 'orders.dispatch',
   'catalog.read', 'catalog.write', 'catalog.publish',
   'business.settings',
   'payments.read', 'payments.reconcile',
   'fiscal.read',
   'identity.members.read', 'identity.members.write', 'identity.invite',
   'identity.sessions.read', 'identity.sessions.revoke',
   'audit.read'
 )
on conflict do nothing;

-- staff: mostrador y catalogo. No ve identidad ni auditoria.
insert into public.identity_role_permissions (role, permission)
select 'staff', permission
  from public.identity_permissions
 where permission in (
   'orders.read', 'orders.operate', 'orders.dispatch',
   'catalog.read', 'catalog.write',
   'payments.read'
 )
on conflict do nothing;

-- rider: solo su propia entrega. Ni catalogo, ni cobros, ni equipo.
insert into public.identity_role_permissions (role, permission)
select 'rider', permission
  from public.identity_permissions
 where permission in ('delivery.operate')
on conflict do nothing;

-- ===========================================================================
-- 5. Indices
-- ===========================================================================

create index if not exists staff_profiles_business_status_idx
  on public.staff_profiles(business_id, status);
create index if not exists rider_profiles_business_status_idx
  on public.rider_profiles(business_id, status);
create index if not exists identity_user_security_user_idx
  on public.identity_user_security(user_id);

-- ===========================================================================
-- 6. Superficie: nada es escribible directamente
-- ===========================================================================
-- Toda escritura de identidad pasa por RPC auditadas (migracion 060000). Las
-- tablas se exponen solo para lectura y bajo RLS.

alter table public.staff_profiles enable row level security;
alter table public.rider_profiles enable row level security;
alter table public.identity_user_security enable row level security;
alter table public.identity_permissions enable row level security;
alter table public.identity_role_permissions enable row level security;

revoke all privileges on table public.staff_profiles from public, anon, authenticated;
revoke all privileges on table public.rider_profiles from public, anon, authenticated;
revoke all privileges on table public.identity_user_security from public, anon, authenticated;
revoke all privileges on table public.identity_permissions from public, anon, authenticated;
revoke all privileges on table public.identity_role_permissions from public, anon, authenticated;

grant select on table public.staff_profiles to authenticated;
grant select on table public.rider_profiles to authenticated;
grant select on table public.identity_permissions to authenticated;
grant select on table public.identity_role_permissions to authenticated;

-- identity_user_security no se expone ni siquiera en lectura: contiene el
-- motivo de una baja. Se consulta por RPC.

-- Las funciones de trigger no las llama nadie a mano: las dispara el motor.
-- PostgreSQL igual les otorga EXECUTE a PUBLIC al crearlas.
revoke execute on function public.identity_assert_profile_role() from public, anon, authenticated;
