# Diseño · horarios, zona de entrega, envío y mínimo

**Sin desplegar.** El SQL vive dentro de este documento y **no** en
`supabase/migrations/`, a propósito: así ningún `supabase db push` lo aplica por
accidente. Cuando se apruebe, se copia a un archivo numerado.

**Sin datos de Walter.** No hay un solo horario, barrio, radio ni precio en este
diseño. Todo se carga después, desde el Panel.

---

## 1 · De qué parte

Lo que ya existe y funciona —y por eso el diseño lo extiende en vez de
reemplazarlo:

| Pieza | Estado |
|---|---|
| `businesses.delivery_fee` y `minimum_delivery_subtotal` | existen, **el backend ya los impone** en el checkout; el navegador no manda plata |
| Ventana horaria del alcohol | ya resuelve **cruce de medianoche** (`20:00–06:00`) con zona horaria propia |
| `has_business_role(business_id, roles[])` | autorización estándar del Panel, `42501` si no |
| `ordering_verified` / `_at` / `_by` | patrón de auditoría de un cambio con responsable |
| `scanned_product_audit` | patrón de tabla de auditoría con `actor_id` y `detail jsonb` |

Lo que **no** existe: horarios de atención y zona de entrega. No hay columna
donde ponerlos.

---

## 2 · Las cuatro decisiones de diseño

**1 · Horarios en tabla, no en columnas.** Un `opens_at`/`closes_at` en
`businesses` no representa ni un sábado distinto ni un corte al mediodía. Una
fila por (canal, día, tramo) sí, y permite turnos partidos sin tocar el esquema.

**2 · La zona es una lista, no un radio.** Un radio desde Mendoza 827 cruza el
río y mete Cipolletti adentro. Se resuelve por **barrio declarado**, con radio
disponible como criterio alternativo por zona, y un radio máximo del negocio como
tope duro opcional.

**3 · Envío y mínimo pueden variar por zona.** Con caída al valor del negocio
cuando la zona no define el suyo. Un solo lugar decide: el backend.

**4 · Nada cambia hasta que Walter lo encienda.** Dos banderas
(`hours_enforced`, `delivery_zone_enforced`) arrancan en `false`. Con eso la
migración **no altera el comportamiento actual**; empieza a exigir recién cuando
hay datos cargados y alguien lo activa a propósito.

---

## 3 · Esquema propuesto

```sql
-- ── banderas y contexto en businesses ────────────────────────────────────────
alter table public.businesses
  add column if not exists operating_timezone text,
  add column if not exists hours_enforced boolean not null default false,
  add column if not exists delivery_zone_enforced boolean not null default false,
  add column if not exists delivery_max_radius_meters integer;

alter table public.businesses drop constraint if exists businesses_max_radius_positive;
alter table public.businesses add constraint businesses_max_radius_positive
  check (delivery_max_radius_meters is null or delivery_max_radius_meters > 0);

-- No se puede exigir horarios sin decir en qué huso. Falla cerrado.
alter table public.businesses drop constraint if exists businesses_hours_need_timezone;
alter table public.businesses add constraint businesses_hours_need_timezone
  check (not hours_enforced or operating_timezone is not null);

-- ── horarios recurrentes ─────────────────────────────────────────────────────
create table if not exists public.business_service_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel text not null check (channel in ('delivery', 'pickup')),
  weekday smallint not null check (weekday between 0 and 6),  -- 0 = domingo
  opens_at time not null,
  closes_at time not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  -- Igual convención que la ventana de alcohol: closes_at < opens_at cruza
  -- la medianoche. Iguales sería una ventana de cero y no se admite.
  constraint business_service_hours_not_empty check (opens_at <> closes_at),
  constraint business_service_hours_unique unique (business_id, channel, weekday, opens_at)
);

create index if not exists business_service_hours_lookup_idx
  on public.business_service_hours (business_id, channel, weekday);

-- ── excepciones puntuales (feriados, cortes) ─────────────────────────────────
create table if not exists public.business_service_exceptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel text not null check (channel in ('delivery', 'pickup', 'all')),
  on_date date not null,
  is_closed boolean not null default true,
  opens_at time,
  closes_at time,
  note text,
  created_at timestamptz not null default clock_timestamp(),
  constraint business_service_exceptions_window check (
    is_closed or (opens_at is not null and closes_at is not null and opens_at <> closes_at)
  ),
  constraint business_service_exceptions_unique unique (business_id, channel, on_date)
);

-- ── zonas de entrega ─────────────────────────────────────────────────────────
create table if not exists public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  match_kind text not null check (match_kind in ('neighborhood', 'radius')),
  neighborhood_normalized text,
  center_lat double precision,
  center_lng double precision,
  radius_meters integer,
  delivery_fee numeric(12, 2),        -- null = usa el del negocio
  minimum_subtotal numeric(12, 2),    -- null = usa el del negocio
  priority integer not null default 100,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint delivery_zones_fee_nonnegative
    check (delivery_fee is null or delivery_fee >= 0),
  constraint delivery_zones_minimum_nonnegative
    check (minimum_subtotal is null or minimum_subtotal >= 0),
  -- Cada tipo exige exactamente sus campos. Sin mezclas a medias.
  constraint delivery_zones_shape check (
    (match_kind = 'neighborhood'
      and neighborhood_normalized is not null and btrim(neighborhood_normalized) <> ''
      and center_lat is null and center_lng is null and radius_meters is null)
    or
    (match_kind = 'radius'
      and center_lat is not null and center_lng is not null
      and radius_meters is not null and radius_meters > 0
      and neighborhood_normalized is null)
  ),
  constraint delivery_zones_unique_name unique (business_id, name)
);

create index if not exists delivery_zones_lookup_idx
  on public.delivery_zones (business_id, is_active, priority);

-- ── auditoría: hoy NO existe para configuración del negocio ──────────────────
create table if not exists public.business_config_audit (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  scope text not null check (scope in ('hours', 'exception', 'zone', 'delivery_pricing', 'enforcement')),
  action text not null check (action in ('created', 'updated', 'deleted', 'enabled', 'disabled')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists business_config_audit_business_idx
  on public.business_config_audit (business_id, created_at desc);
```

Las cuatro tablas con `enable row level security` y policies por
`has_business_role`, como el resto del esquema. `delivery_zones` y
`business_service_hours` además con `grant select` a `anon` **sólo** si el
storefront necesita mostrar la cobertura; si no, se quedan cerradas.

---

## 4 · Las dos funciones que deciden

```sql
-- ¿Está abierto ESTE canal en ESTE momento? Fuente única de verdad.
create or replace function public.business_is_open(
  p_business_id uuid,
  p_channel text,
  p_at timestamptz default now()
) returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $business_is_open$
declare
  v_business public.businesses%rowtype;
  v_local timestamp;
  v_time time;
  v_weekday smallint;
  v_exception public.business_service_exceptions%rowtype;
begin
  select * into v_business from public.businesses where id = p_business_id;
  if not found then return false; end if;

  -- Mientras no se exija, se comporta como hoy: siempre abierto.
  if not v_business.hours_enforced then return true; end if;

  -- Exigir sin huso configurado es imposible de evaluar: cerrado.
  if v_business.operating_timezone is null then return false; end if;

  v_local := p_at at time zone v_business.operating_timezone;
  v_time := v_local::time;
  v_weekday := extract(dow from v_local)::smallint;

  -- La excepción del día manda sobre el horario recurrente.
  select * into v_exception
    from public.business_service_exceptions
   where business_id = p_business_id
     and on_date = v_local::date
     and channel in (p_channel, 'all')
   order by case when channel = p_channel then 0 else 1 end
   limit 1;

  if found then
    if v_exception.is_closed then return false; end if;
    return public.time_in_window(v_time, v_exception.opens_at, v_exception.closes_at);
  end if;

  return exists (
    select 1 from public.business_service_hours h
     where h.business_id = p_business_id
       and h.channel = p_channel
       and h.weekday = v_weekday
       and public.time_in_window(v_time, h.opens_at, h.closes_at)
  );
end;
$business_is_open$;

-- Cruce de medianoche, en un solo lugar. Misma convención que el alcohol.
create or replace function public.time_in_window(p_t time, p_from time, p_to time)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case when p_from <= p_to
              then p_t >= p_from and p_t < p_to
              else p_t >= p_from or p_t < p_to
         end;
$$;
```

```sql
-- ¿Llegamos ahí? ¿Y con qué envío y qué mínimo?
-- Devuelve null si no hay cobertura. El navegador no decide nada de esto.
create or replace function public.resolve_delivery_zone(
  p_business_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_neighborhood text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $resolve_delivery_zone$
declare
  v_business public.businesses%rowtype;
  v_zone public.delivery_zones%rowtype;
  v_norm text := public.normalize_zone_name(p_neighborhood);
  v_distance double precision;
begin
  select * into v_business from public.businesses where id = p_business_id;
  if not found then return null; end if;

  -- Sin exigencia de zona: se comporta como hoy, con los valores del negocio.
  if not v_business.delivery_zone_enforced then
    return jsonb_build_object(
      'zone_id', null, 'zone_name', null,
      'delivery_fee', v_business.delivery_fee,
      'minimum_subtotal', v_business.minimum_delivery_subtotal,
      'enforced', false);
  end if;

  -- Tope duro opcional: fuera del radio máximo no se sigue buscando.
  if v_business.delivery_max_radius_meters is not null
     and p_lat is not null and p_lng is not null then
    v_distance := public.distance_meters(
      p_lat, p_lng, v_business.latitude, v_business.longitude);
    if v_distance is null or v_distance > v_business.delivery_max_radius_meters then
      return null;
    end if;
  end if;

  select * into v_zone
    from public.delivery_zones z
   where z.business_id = p_business_id
     and z.is_active
     and (
       (z.match_kind = 'neighborhood' and v_norm is not null
        and z.neighborhood_normalized = v_norm)
       or
       (z.match_kind = 'radius' and p_lat is not null and p_lng is not null
        and public.distance_meters(p_lat, p_lng, z.center_lat, z.center_lng)
            <= z.radius_meters)
     )
   order by z.priority, z.name
   limit 1;

  if not found then return null; end if;   -- sin cobertura: falla cerrado

  return jsonb_build_object(
    'zone_id', v_zone.id,
    'zone_name', v_zone.name,
    'delivery_fee', coalesce(v_zone.delivery_fee, v_business.delivery_fee),
    'minimum_subtotal', coalesce(v_zone.minimum_subtotal, v_business.minimum_delivery_subtotal),
    'enforced', true);
end;
$resolve_delivery_zone$;
```

`normalize_zone_name` reutiliza el mismo plegado de acentos/puntuación que ya usa
la identidad del comercio. `distance_meters` es haversine, la misma fórmula que
ya vive en el cliente para las distancias aproximadas.

---

## 5 · Dónde se impone (y por qué ahí)

En el **mismo punto donde el checkout ya rechaza por mínimo** — hoy:

```sql
if v_subtotal < v_business.minimum_delivery_subtotal then
  raise exception ... ;
end if;
```

pasa a ser, en ese orden:

```sql
-- 1 · ¿está abierto este canal?
if not public.business_is_open(v_business.id, v_fulfillment) then
  raise exception 'BUSINESS_CLOSED' using errcode = '22023';
end if;

-- 2 · ¿hay cobertura? el envío y el mínimo salen de acá, no del cliente
v_zone := public.resolve_delivery_zone(
  v_business.id, v_delivery_lat, v_delivery_lng, v_neighborhood);
if v_zone is null then
  raise exception 'OUT_OF_DELIVERY_ZONE' using errcode = '22023';
end if;

v_delivery_fee := (v_zone ->> 'delivery_fee')::numeric;
v_minimum      := (v_zone ->> 'minimum_subtotal')::numeric;

-- 3 · el mínimo, ahora con el valor de la zona
if v_minimum is not null and v_subtotal < v_minimum then
  raise exception 'BELOW_MINIMUM' using errcode = '22023';
end if;
```

**El navegador sigue sin mandar un solo peso.** La autoridad no se mueve: sólo
gana dos preguntas más.

---

## 6 · RPCs del Panel

Cuatro, todas `security definer`, `search_path` fijado, autorizadas con
`has_business_role(p_business_id, array['owner','admin'])` y **cada una escribe en
`business_config_audit`** con su `actor_id`, su `before` y su `after`:

| RPC | Qué hace |
|---|---|
| `set_business_service_hours(p_business_id, p_channel, p_hours jsonb)` | reemplaza los tramos de un canal en una transacción |
| `upsert_delivery_zone(p_business_id, p_zone jsonb)` | alta/edición de una zona |
| `set_delivery_zone_active(p_business_id, p_zone_id, p_active)` | apagar una zona sin borrar su historia |
| `set_service_enforcement(p_business_id, p_hours boolean, p_zones boolean)` | las dos banderas, con `action='enabled'/'disabled'` en la auditoría |

Walter no ve SQL: ve una grilla de días y horarios, y una lista de barrios con su
envío y su mínimo.

---

## 7 · Por qué es auditable de verdad

Hoy, si alguien cambia el costo de envío, **no queda rastro de quién ni cuándo**.
`business_config_audit` cierra ese agujero para las cuatro cosas nuevas y para el
envío y el mínimo.

Cada fila guarda `before` y `after` completos en `jsonb`: se puede reconstruir la
configuración vigente en cualquier momento pasado y contestar «¿con qué envío se
tomó este pedido?» sin adivinar.

---

## 8 · Seguridad de la migración

- Todas las columnas nuevas son **nullable** o traen default que preserva el
  comportamiento de hoy.
- Las dos banderas arrancan en `false`: **el día que se aplique, nada cambia**.
- Las tablas nuevas arrancan vacías; con `enforced=false` no se consultan.
- Reversible: apagar las banderas devuelve el comportamiento anterior sin
  desplegar nada.
- El constraint `businesses_hours_need_timezone` impide el estado incoherente de
  exigir horarios sin decir en qué huso.

---

## 9 · Lo que este diseño NO decide

Ni un horario, ni un barrio, ni un radio, ni un precio de envío, ni un mínimo.
**Todo eso lo pone Walter** — está en `CHECKLIST-WALTER.md`.

Tampoco decide si la cobertura se muestra al cliente antes de comprar. Es una
decisión de producto: el modelo la soporta con un `grant select` a `anon` sobre
`delivery_zones`, pero no la toma por su cuenta.
