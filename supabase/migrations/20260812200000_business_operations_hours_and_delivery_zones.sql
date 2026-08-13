-- ============================================================================
--  Configuración operativa real: horarios de atención y zonas de entrega
-- ============================================================================
--
--  QUÉ FALTABA
--  -----------
--  El esquema no tenía dónde poner el horario de atención ni la cobertura de
--  delivery. No es que nadie los cargó: no existía la columna. Hasta hoy el
--  comercio abría cuando `ordering_enabled` estaba en true, y entregaba en
--  cualquier lado con una tarifa única.
--
--  LAS CUATRO DECISIONES
--  ---------------------
--  1 · HORARIOS EN TABLA, NO EN COLUMNAS. Un `opens_at`/`closes_at` en
--      `businesses` no representa un sábado distinto ni un corte al mediodía.
--      Una fila por (canal, día, franja) sí, y admite turno partido —08:00–14:00
--      y 17:30–22:30— sin tocar el esquema.
--
--  2 · LA COBERTURA ES UNA LISTA BLANCA, NO UN RADIO. Un radio desde el local
--      cruza el río y mete Cipolletti adentro. Acá una dirección entra sólo si
--      cae en una zona declarada y activa. Hay dos formas de caer, las dos son
--      lista blanca:
--        · `polygon`       — el punto confirmado cae dentro del borde cargado.
--        · `declared_area` — el barrio que la persona eligió de la lista
--                            publicada coincide con una zona activa.
--      `delivery_max_radius_meters` existe, pero SÓLO PUEDE NEGAR: es un tope
--      duro opcional que descarta un punto absurdo. Nunca habilita nada. Ningún
--      camino de este archivo concede cobertura por distancia.
--
--  3 · ENVÍO Y MÍNIMO PUEDEN VARIAR POR ZONA, con caída al valor del negocio
--      cuando la zona no define el suyo. Un solo lugar decide: el backend.
--
--  4 · NADA CAMBIA HASTA QUE ALGUIEN LO ENCIENDA. `hours_enforced` y
--      `delivery_zone_enforced` arrancan en false. El día que esta migración se
--      aplique, el comportamiento es idéntico al de hoy. Empieza a exigir recién
--      cuando hay datos cargados y una persona lo activa a propósito. Apagar la
--      bandera revierte sin desplegar nada.
--
--  QUIÉN ESCRIBE
--  -------------
--  Nadie escribe estas tablas directamente. No hay grant de insert/update/delete
--  para `authenticated`: el único camino son las RPC del Panel, que autorizan,
--  validan y auditan en la misma transacción. RLS deja LEER a quien pertenece al
--  comercio; el cliente no lee nada de acá, pregunta por RPC.
--
--  ESTE ARCHIVO NO CARGA UN SOLO DATO COMERCIAL. Ni un horario, ni un barrio, ni
--  una tarifa. Todo eso entra por el Panel o por un seed aparte y aprobado.
-- ============================================================================

-- ── Helpers deterministas ────────────────────────────────────────────────────

-- Cruce de medianoche en un solo lugar, con intervalo SEMIABIERTO [desde, hasta).
-- 08:00–14:00 abre a las 08:00:00 y cierra a las 14:00:00 en punto: a las 14:00
-- ya no se toma un pedido. La ventana de alcohol histórica usa `between`
-- (cerrada en los dos extremos) y NO se toca: son dos contratos distintos y
-- mezclarlos cambiaría el comportamiento vigente.
create or replace function public.time_in_window(p_at time, p_from time, p_to time)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when p_at is null or p_from is null or p_to is null then false
    when p_from = p_to then false          -- ventana de cero, no de un día entero
    when p_from < p_to then p_at >= p_from and p_at < p_to
    else p_at >= p_from or p_at < p_to     -- cruza la medianoche
  end;
$$;

comment on function public.time_in_window(time, time, time) is
  'Pertenencia a una franja horaria [desde, hasta), con cruce de medianoche. Una franja de ancho cero no contiene nada.';

-- Plegado de nombre de zona: mismo criterio que la identidad de direcciones
-- (acentos, mayúsculas y puntuación fuera), para que «Santa Genoveva» y
-- «santa  genoveva.» sean la misma zona y no dos.
create or replace function public.normalize_zone_name(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select nullif(
    btrim(regexp_replace(
      lower(translate(coalesce(p_value, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
      '[^a-z0-9]+', ' ', 'g'
    )),
    ''
  );
$$;

comment on function public.normalize_zone_name(text) is
  'Identidad estable de un nombre de zona: minúsculas, sin acentos ni puntuación, espacios colapsados. NULL si queda vacío.';

-- Haversine, la misma fórmula que ya usan los contratos del Rider para medir un
-- salto imposible. Existe para el TOPE DURO de cobertura, que sólo niega.
create or replace function public.haversine_meters(
  p_lat_a double precision, p_lng_a double precision,
  p_lat_b double precision, p_lng_b double precision
) returns double precision
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when p_lat_a is null or p_lng_a is null or p_lat_b is null or p_lng_b is null then null
    else 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat_b - p_lat_a) / 2), 2)
      + cos(radians(p_lat_a)) * cos(radians(p_lat_b))
        * power(sin(radians(p_lng_b - p_lng_a) / 2), 2)
    ))
  end;
$$;

comment on function public.haversine_meters(double precision, double precision, double precision, double precision) is
  'Distancia sobre la esfera en metros. En cobertura se usa SÓLO como tope duro que niega; nunca concede una zona.';

-- ── Contexto y banderas del negocio ──────────────────────────────────────────

alter table public.businesses
  add column if not exists operating_timezone text,
  add column if not exists hours_enforced boolean not null default false,
  add column if not exists delivery_zone_enforced boolean not null default false,
  add column if not exists alcohol_hours_enforced boolean not null default false,
  add column if not exists delivery_max_radius_meters integer;

comment on column public.businesses.operating_timezone is
  'Huso en el que se leen los horarios de atención (ej. America/Argentina/Buenos_Aires). Sin esto no se puede exigir un horario.';
comment on column public.businesses.hours_enforced is
  'Cuando es true, el checkout exige que el canal esté abierto según business_service_hours. Arranca en false: aplicar la migración no cambia nada.';
comment on column public.businesses.delivery_zone_enforced is
  'Cuando es true, una entrega necesita caer en una zona declarada y activa. Arranca en false.';
comment on column public.businesses.alcohol_hours_enforced is
  'Preparación, apagada: cuando sea true, un carrito con alcohol exigirá además el canal alcohol abierto. Este encargo NO define ninguna regla legal.';
comment on column public.businesses.delivery_max_radius_meters is
  'Tope duro opcional en metros desde el local. SÓLO NIEGA: descarta un punto absurdo. Nunca habilita una zona por distancia.';

alter table public.businesses drop constraint if exists businesses_max_radius_positive;
alter table public.businesses add constraint businesses_max_radius_positive
  check (delivery_max_radius_meters is null or delivery_max_radius_meters > 0);

-- Exigir horarios sin decir en qué huso es un estado imposible de evaluar. La
-- base lo impide en vez de resolverlo con un default silencioso.
alter table public.businesses drop constraint if exists businesses_hours_need_timezone;
alter table public.businesses add constraint businesses_hours_need_timezone
  check (
    (not hours_enforced and not alcohol_hours_enforced)
    or (operating_timezone is not null and btrim(operating_timezone) <> '')
  );

-- ── Horarios recurrentes ─────────────────────────────────────────────────────

create table if not exists public.business_service_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- `delivery` y `pickup` son los canales de venta; `alcohol` es la preparación
  -- apagada del punto 6 del encargo: una ventana que hoy no exige nada.
  channel text not null check (channel in ('delivery', 'pickup', 'alcohol')),
  weekday smallint not null check (weekday between 0 and 6),  -- 0 = domingo, igual que extract(dow)
  opens_at time not null,
  closes_at time not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  -- closes_at < opens_at cruza la medianoche. Iguales sería una franja de ancho
  -- cero: no se admite, porque «cero» y «todo el día» se escriben igual y hay
  -- que poder distinguirlos.
  constraint business_service_hours_not_empty check (opens_at <> closes_at),
  constraint business_service_hours_unique unique (business_id, channel, weekday, opens_at)
);

create index if not exists business_service_hours_lookup_idx
  on public.business_service_hours (business_id, channel, weekday);

comment on table public.business_service_hours is
  'Franjas horarias recurrentes por canal y día. Varias filas por día admiten el turno partido; closes_at < opens_at cruza la medianoche.';

-- ── Excepciones puntuales: feriados, cortes, días especiales ─────────────────

create table if not exists public.business_service_exceptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel text not null check (channel in ('delivery', 'pickup', 'alcohol', 'all')),
  on_date date not null,
  is_closed boolean not null default true,
  opens_at time,
  closes_at time,
  note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint business_service_exceptions_window check (
    (is_closed and opens_at is null and closes_at is null)
    or (not is_closed and opens_at is not null and closes_at is not null and opens_at <> closes_at)
  ),
  constraint business_service_exceptions_note_length check (note is null or char_length(note) <= 200),
  constraint business_service_exceptions_unique unique (business_id, channel, on_date)
);

create index if not exists business_service_exceptions_lookup_idx
  on public.business_service_exceptions (business_id, on_date);

comment on table public.business_service_exceptions is
  'Excepción para una fecha concreta. Manda sobre el horario recurrente. Un cierre explícito cierra TODA la fecha local, incluido lo que venía cruzando desde el día anterior.';

-- ── Zonas de entrega: la lista blanca ────────────────────────────────────────

create table if not exists public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  -- Las dos formas de estar adentro. NO hay una tercera por distancia.
  match_kind text not null check (match_kind in ('declared_area', 'polygon')),
  area_normalized text,
  -- Tipo `polygon` nativo. Los vértices se guardan como (x, y) = (lng, lat),
  -- que es el orden que espera `point(lng, lat)` en la comprobación. A la
  -- latitud de Neuquén tratar el par como plano no mueve una frontera de barrio.
  boundary polygon,
  delivery_fee numeric(12, 2),       -- null = usa el del negocio
  minimum_subtotal numeric(12, 2),   -- null = usa el del negocio; el del negocio null = sin mínimo
  priority integer not null default 100,
  notes text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint delivery_zones_name_length check (char_length(btrim(name)) between 2 and 80),
  constraint delivery_zones_notes_length check (notes is null or char_length(notes) <= 300),
  constraint delivery_zones_fee_nonnegative check (delivery_fee is null or delivery_fee >= 0),
  constraint delivery_zones_minimum_nonnegative check (minimum_subtotal is null or minimum_subtotal >= 0),
  -- Cada tipo exige exactamente sus campos. Sin mezclas a medias: una zona
  -- `polygon` sin borde, o una `declared_area` sin nombre plegado, sería una
  -- fila que aparenta cobertura y no la tiene.
  constraint delivery_zones_shape check (
    (match_kind = 'declared_area'
      and area_normalized is not null and btrim(area_normalized) <> ''
      and boundary is null)
    or
    (match_kind = 'polygon'
      and boundary is not null and npoints(boundary) >= 3
      and area_normalized is null)
  ),
  constraint delivery_zones_unique_name unique (business_id, name)
);

-- Dos zonas activas no pueden reclamar el mismo barrio declarado.
create unique index if not exists delivery_zones_area_unique
  on public.delivery_zones (business_id, area_normalized)
  where match_kind = 'declared_area';

create index if not exists delivery_zones_lookup_idx
  on public.delivery_zones (business_id, is_active, priority);

comment on table public.delivery_zones is
  'Lista blanca de cobertura. Una dirección entra sólo si cae en una zona declarada y activa. No hay cobertura por radio: delivery_max_radius_meters únicamente niega.';
comment on column public.delivery_zones.boundary is
  'Borde de la zona como polígono de vértices (lng, lat). La pertenencia se evalúa con boundary @> point(lng, lat).';
comment on column public.delivery_zones.minimum_subtotal is
  'Mínimo propio de la zona. NULL cae al del negocio; si el del negocio también es NULL, no hay mínimo.';

-- ── Auditoría de configuración comercial ─────────────────────────────────────
--
-- Hasta hoy, cambiar el costo de envío no dejaba rastro de quién ni cuándo.
-- Esta tabla cierra ese agujero para lo nuevo Y para el envío y el mínimo que ya
-- existían, por trigger: no depende de que el cambio pase por una RPC.
create table if not exists public.business_config_audit (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  scope text not null check (scope in (
    'hours', 'exception', 'zone', 'delivery_pricing', 'enforcement', 'permission'
  )),
  action text not null check (action in ('created', 'updated', 'deleted', 'enabled', 'disabled', 'replaced')),
  -- Un cambio hecho por el planificador o por un script de plataforma no tiene
  -- auth.uid(). En vez de inventarle un dueño, se dice qué clase de actor fue.
  actor_kind text not null default 'user' check (actor_kind in ('user', 'service', 'system')),
  actor_id uuid references auth.users(id) on delete restrict,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint business_config_audit_user_has_actor
    check (actor_kind <> 'user' or actor_id is not null)
);

create index if not exists business_config_audit_business_idx
  on public.business_config_audit (business_id, created_at desc);

comment on table public.business_config_audit is
  'Append-only: quién cambió qué configuración comercial, cuándo, y el estado completo antes y después. Se puede reconstruir con qué envío se tomó un pedido sin adivinar.';

-- ── Permiso explícito para staff ─────────────────────────────────────────────
--
-- El encargo pide que un staff común NO toque la configuración comercial, salvo
-- permiso explícito. `has_business_role(id, {owner, admin})` ya cubre lo
-- primero; esto hace representable lo segundo, sin inventar un rol nuevo y sin
-- que nadie quede habilitado por defecto.
-- La delegación vive en una tabla PROPIA, no en una columna de
-- `business_members`. La capa de identidad declaró que esa tabla se administra
-- exclusivamente por sus RPC —revoca el grant de escritura a `authenticated` y
-- pone un trigger que rechaza cualquier otro camino—, y tiene razón: una
-- membresía es identidad, no configuración comercial. Escribir ahí desde acá
-- obligaría a esta migración a hacerse pasar por una RPC de identidad.
--
-- Medido antes de decidirlo: con la capa de identidad puesta, un UPDATE a
-- `business_members` desde una conexión real de PostgREST muere con
-- «identity: las membresias se administran por RPC de identidad».
create table if not exists public.business_commercial_managers (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default clock_timestamp(),
  primary key (business_id, user_id)
);

comment on table public.business_commercial_managers is
  'Delegación explícita de la configuración comercial a un miembro que no es owner ni admin. Estar en esta tabla no alcanza: el miembro tiene que seguir siendo miembro vigente para la capa de autorización.';

-- Autoridad única para toda la configuración comercial. Nunca devuelve NULL:
-- una función de autorización que puede contestar NULL falla ABIERTA en la forma
-- `if not autorizado then raise`, porque `not null` no es verdadero y la
-- excepción no se levanta.
--
-- SE APOYA EN `has_business_role`, Y ESO ES LO IMPORTANTE
-- ------------------------------------------------------
-- Leer `business_members` por su cuenta parecía equivalente y no lo es: la capa
-- de autorización vigente puede tener motivos para decir que alguien YA NO es
-- del equipo —deshabilitado, sesión revocada, token anterior al corte— sin que
-- la fila de membresía cambie. Una función que mira la tabla directamente se
-- salta todo eso.
--
-- Medido: con un owner deshabilitado por la capa de identidad,
-- `has_business_role` devolvía false y la primera versión de esta función
-- devolvía TRUE. Es decir: alguien a quien le revocaron el acceso seguía
-- pudiendo cambiar tarifas, zonas y banderas. Preguntarle a `has_business_role`
-- hereda la compuerta sin depender de sus detalles, y funciona igual en un árbol
-- que no tenga esa capa.
create or replace function public.can_manage_commercial_settings(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    public.has_business_role(p_business_id, array['owner', 'admin'])
    or (
      public.has_business_role(p_business_id, array['staff'])
      and exists (
        select 1
          from public.business_commercial_managers m
         where m.business_id = p_business_id
           and m.user_id = auth.uid()
      )
    ),
    false
  );
$$;

comment on function public.can_manage_commercial_settings(uuid) is
  'Autoridad para editar configuración comercial: owner, admin, o un miembro vigente con delegación explícita. Pasa por has_business_role, así que hereda cualquier revocación que imponga la capa de autorización. Devuelve false, nunca NULL.';

-- ── El trigger que audita el envío y el mínimo pasen por donde pasen ─────────

create or replace function public.audit_business_commercial_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_pricing_changed boolean;
  v_enforcement_changed boolean;
begin
  v_pricing_changed :=
    new.delivery_fee is distinct from old.delivery_fee
    or new.minimum_delivery_subtotal is distinct from old.minimum_delivery_subtotal
    or new.delivery_max_radius_meters is distinct from old.delivery_max_radius_meters;
  v_enforcement_changed :=
    new.hours_enforced is distinct from old.hours_enforced
    or new.delivery_zone_enforced is distinct from old.delivery_zone_enforced
    or new.alcohol_hours_enforced is distinct from old.alcohol_hours_enforced
    or new.operating_timezone is distinct from old.operating_timezone;

  if v_pricing_changed then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      new.id, 'delivery_pricing', 'updated',
      case when v_actor is null then 'service' else 'user' end, v_actor,
      jsonb_build_object(
        'delivery_fee', old.delivery_fee,
        'minimum_delivery_subtotal', old.minimum_delivery_subtotal,
        'delivery_max_radius_meters', old.delivery_max_radius_meters),
      jsonb_build_object(
        'delivery_fee', new.delivery_fee,
        'minimum_delivery_subtotal', new.minimum_delivery_subtotal,
        'delivery_max_radius_meters', new.delivery_max_radius_meters)
    );
  end if;

  if v_enforcement_changed then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      new.id, 'enforcement',
      case
        when (new.hours_enforced and not old.hours_enforced)
          or (new.delivery_zone_enforced and not old.delivery_zone_enforced)
          or (new.alcohol_hours_enforced and not old.alcohol_hours_enforced) then 'enabled'
        when (old.hours_enforced and not new.hours_enforced)
          or (old.delivery_zone_enforced and not new.delivery_zone_enforced)
          or (old.alcohol_hours_enforced and not new.alcohol_hours_enforced) then 'disabled'
        else 'updated'
      end,
      case when v_actor is null then 'service' else 'user' end, v_actor,
      jsonb_build_object(
        'hours_enforced', old.hours_enforced,
        'delivery_zone_enforced', old.delivery_zone_enforced,
        'alcohol_hours_enforced', old.alcohol_hours_enforced,
        'operating_timezone', old.operating_timezone),
      jsonb_build_object(
        'hours_enforced', new.hours_enforced,
        'delivery_zone_enforced', new.delivery_zone_enforced,
        'alcohol_hours_enforced', new.alcohol_hours_enforced,
        'operating_timezone', new.operating_timezone)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists businesses_audit_commercial_change on public.businesses;
create trigger businesses_audit_commercial_change
after update on public.businesses
for each row execute function public.audit_business_commercial_change();

comment on function public.audit_business_commercial_change() is
  'Deja rastro de todo cambio de envío, mínimo, tope y banderas de exigencia, venga de una RPC, del Panel o de un UPDATE suelto.';

-- ── RLS y permisos ───────────────────────────────────────────────────────────
--
-- Leer: quien pertenece al comercio. Escribir: NADIE por tabla. El único camino
-- son las RPC del Panel, que autorizan, validan y auditan juntas. El cliente no
-- toca estas tablas: pregunta por RPC y recibe una respuesta ya decidida.

alter table public.business_service_hours enable row level security;
alter table public.business_service_exceptions enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.business_config_audit enable row level security;

alter table public.business_service_hours force row level security;
alter table public.business_service_exceptions force row level security;
alter table public.delivery_zones force row level security;
alter table public.business_config_audit force row level security;

revoke all privileges on table public.business_service_hours from public, anon, authenticated;
revoke all privileges on table public.business_service_exceptions from public, anon, authenticated;
revoke all privileges on table public.delivery_zones from public, anon, authenticated;
revoke all privileges on table public.business_config_audit from public, anon, authenticated;

grant select on table public.business_service_hours to authenticated;
grant select on table public.business_service_exceptions to authenticated;
grant select on table public.delivery_zones to authenticated;
grant select on table public.business_config_audit to authenticated;

drop policy if exists "business team reads service hours" on public.business_service_hours;
create policy "business team reads service hours"
on public.business_service_hours for select to authenticated
using (public.has_business_role(business_id, array['owner', 'admin', 'staff']));

drop policy if exists "business team reads service exceptions" on public.business_service_exceptions;
create policy "business team reads service exceptions"
on public.business_service_exceptions for select to authenticated
using (public.has_business_role(business_id, array['owner', 'admin', 'staff']));

drop policy if exists "business team reads delivery zones" on public.delivery_zones;
create policy "business team reads delivery zones"
on public.delivery_zones for select to authenticated
using (public.has_business_role(business_id, array['owner', 'admin', 'staff']));

-- La auditoría la lee quien puede cambiar la configuración. Un staff sin
-- delegación no ve quién cambió los precios.
drop policy if exists "commercial managers read config audit" on public.business_config_audit;
create policy "commercial managers read config audit"
on public.business_config_audit for select to authenticated
using (public.can_manage_commercial_settings(business_id));

revoke all on function public.can_manage_commercial_settings(uuid) from public, anon, authenticated;
grant execute on function public.can_manage_commercial_settings(uuid) to authenticated;

revoke all on function public.audit_business_commercial_change() from public, anon, authenticated;

revoke all on function public.time_in_window(time, time, time) from public, anon, authenticated;
revoke all on function public.normalize_zone_name(text) from public, anon, authenticated;
revoke all on function public.haversine_meters(double precision, double precision, double precision, double precision) from public, anon, authenticated;

-- La tabla de delegación se lee, no se escribe: la única puerta es
-- `set_commercial_settings_delegation`, que exige owner o admin y audita.
alter table public.business_commercial_managers enable row level security;
alter table public.business_commercial_managers force row level security;
revoke all privileges on table public.business_commercial_managers from public, anon, authenticated;
grant select on table public.business_commercial_managers to authenticated;

drop policy if exists "commercial managers read delegation" on public.business_commercial_managers;
create policy "commercial managers read delegation"
on public.business_commercial_managers for select to authenticated
using (public.has_business_role(business_id, array['owner', 'admin']));

-- ── Rastro de la zona en el pedido ───────────────────────────────────────────
--
-- Un pedido tiene que poder contestar «¿con qué zona y con qué envío se tomó?»
-- dentro de un año, cuando la zona ya se llame distinto o esté apagada.
alter table public.orders
  add column if not exists delivery_zone_id uuid references public.delivery_zones(id) on delete set null,
  add column if not exists delivery_zone_name text,
  add column if not exists delivery_area_declared text;

comment on column public.orders.delivery_zone_id is
  'Zona que resolvió el backend al tomar el pedido. Puede quedar en NULL si la zona se borra; el nombre permanece.';
comment on column public.orders.delivery_zone_name is
  'Nombre de la zona congelado al momento del pedido. No se actualiza si la zona se renombra después.';
comment on column public.orders.delivery_area_declared is
  'Barrio que declaró la persona, tal como lo eligió. Es la entrada de la resolución, no su resultado.';

alter table public.checkout_sessions
  add column if not exists delivery_zone_id uuid references public.delivery_zones(id) on delete set null,
  add column if not exists delivery_zone_name text,
  add column if not exists delivery_minimum_subtotal numeric(12, 2);

comment on column public.checkout_sessions.delivery_minimum_subtotal is
  'Mínimo que el backend impuso a esta sesión. Queda guardado para poder auditar por qué se aceptó o rechazó.';

-- El barrio declarado vive con la dirección, no con el pedido: se elige una vez
-- y se reusa. Nullable, porque todas las direcciones que ya existen no lo tienen
-- y ninguna deja de funcionar por eso.
alter table public.customer_addresses
  add column if not exists neighborhood text;

alter table public.customer_addresses drop constraint if exists customer_addresses_neighborhood_length;
alter table public.customer_addresses add constraint customer_addresses_neighborhood_length
  check (neighborhood is null or char_length(btrim(neighborhood)) between 1 and 100);

comment on column public.customer_addresses.neighborhood is
  'Barrio declarado por la persona, elegido de la lista publicada por el comercio. Entrada de la resolución de cobertura.';

-- `customer_addresses` no tiene grant de escritura para el navegador —se escribe
-- por `upsert_current_customer_address`— y el SELECT es de tabla, así que la
-- columna nueva queda legible por su dueño sin agregar un permiso.
