-- CONTROLLED_PRODUCTION · VENTANA QA CON VENCIMIENTO Y COLUMNAS PRIVADAS DE PRODUCTO
--
-- Dos hallazgos verificados en vivo con la clave publicable (2026-09-25):
--
--   1. El negocio QA de control quedó abierto de forma permanente en la base de
--      producción controlada: la política pública de `products` exponía sus
--      productos QA y los RPC de pedidos aceptaban pedidos anónimos para él.
--      Cerrarlo desde el harness en `finally` no alcanza: si el runner muere
--      (SIGKILL, corte de red, runner perdido) el `finally` no corre. Acá el
--      servidor hace cumplir la ventana:
--        - `businesses.qa_fixture` marca los tenants QA (no los edita nadie
--          desde la API: sólo estas funciones y el operador con clave de servicio);
--        - `open_qa_window` los abre con vencimiento (máx. 60 min);
--        - la política pública NO muestra productos de un tenant QA fuera de
--          su ventana, aunque siga `open` (falla cerrado aunque el cron no corra);
--        - `taba-qa-window-expiry` cierra cada minuto las ventanas vencidas.
--
--   2. `anon` y cualquier cliente leían TODAS las columnas de un producto
--      publicado, incluidas `unit_cost` (el costo del comercio) y `verified_by`
--      (el usuario del personal que lo verificó). Hoy `unit_cost` está en NULL,
--      pero el Panel permite cargarlo: el día que el dueño cargue costos, su
--      margen quedaba público. Ahora esas dos columnas no se pueden leer con
--      `anon` ni con `authenticated`; el Panel las escribe por RPC (SECURITY
--      DEFINER) y ninguna consulta directa del frontend las lee.
--
-- Forward-only. No toca filas de pedidos ni de productos.
--
-- REVERSIÓN (sólo si hiciera falta): `select cron.unschedule('taba-qa-window-expiry');`,
-- `grant select on table public.products to anon, authenticated;` y recrear las
-- dos políticas de `products` sin la condición `qa_fixture` (texto en
-- 20260725030000 y 20260826140000). Las columnas nuevas pueden quedar.

-- ===== 1. Marca de tenant QA y vencimiento de su ventana =====
alter table public.businesses add column if not exists qa_fixture boolean not null default false;
alter table public.businesses add column if not exists qa_window_until timestamptz;

comment on column public.businesses.qa_fixture is
  'Tenant QA dentro de una base real. Sólo se abre con open_qa_window y con vencimiento; fuera de esa ventana su catálogo no es público.';
comment on column public.businesses.qa_window_until is
  'Fin de la ventana QA abierta con open_qa_window. NULL = sin ventana.';

-- Los tenants QA de CONTROLLED_PRODUCTION (tkanbadcglszlcyfjvpv), creados por
-- scripts/controlled-production/seed-businesses.mjs. En otra base no hay filas
-- con estos ids y el update no hace nada.
update public.businesses
   set qa_fixture = true
 where id in ('e1d2c342-da14-421e-884f-ff38bb55f642', 'dd515bdd-33bc-4a72-9e70-72d2ab8ae1f0')
   and not qa_fixture;

-- Ni la marca ni la ventana se cambian con un UPDATE directo desde la API:
-- el dueño de un tenant QA no puede desmarcarlo ni estirar su ventana, y el
-- dueño de un negocio real no puede esconder su catálogo marcándolo QA.
create or replace function public.guard_business_qa_columns()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $guard_business_qa_columns$
begin
  if current_user in ('anon', 'authenticated')
     and (new.qa_fixture is distinct from old.qa_fixture
          or new.qa_window_until is distinct from old.qa_window_until) then
    raise exception 'qa_fixture y qa_window_until sólo cambian por open_qa_window/close_qa_window'
      using errcode = '42501';
  end if;
  return new;
end;
$guard_business_qa_columns$;

drop trigger if exists businesses_guard_qa_columns on public.businesses;
create trigger businesses_guard_qa_columns
  before update of qa_fixture, qa_window_until on public.businesses
  for each row execute function public.guard_business_qa_columns();

-- ===== 2. Abrir y cerrar la ventana QA =====
create or replace function public.open_qa_window(p_business_id uuid, p_minutes integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $open_qa_window$
declare
  v_business public.businesses%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'abrir una ventana QA requiere owner o admin' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 60 then
    raise exception 'la ventana QA dura entre 1 y 60 minutos' using errcode = '22023';
  end if;
  select * into v_business from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'negocio inexistente' using errcode = 'P0002';
  end if;
  if not v_business.qa_fixture then
    raise exception 'sólo un tenant QA abre ventana QA' using errcode = '42501';
  end if;
  update public.businesses
     set status = 'open', qa_window_until = clock_timestamp() + make_interval(mins => p_minutes),
         updated_at = now()
   where id = p_business_id
  returning * into v_business;
  return jsonb_build_object('ok', true, 'status', v_business.status, 'qa_window_until', v_business.qa_window_until);
end;
$open_qa_window$;

create or replace function public.close_qa_window(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $close_qa_window$
declare
  v_business public.businesses%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'cerrar una ventana QA requiere owner o admin' using errcode = '42501';
  end if;
  update public.businesses
     set status = 'closed', qa_window_until = null, updated_at = now()
   where id = p_business_id and qa_fixture
  returning * into v_business;
  if not found then
    raise exception 'sólo un tenant QA cierra ventana QA' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true, 'status', v_business.status);
end;
$close_qa_window$;

-- El barrido: cierra todo tenant QA abierto sin ventana vigente (incluido uno
-- abierto con set_business_open_state o por un runner que murió).
create or replace function public.close_expired_qa_windows()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $close_expired_qa_windows$
declare
  v_closed integer;
begin
  update public.businesses
     set status = 'closed', qa_window_until = null, updated_at = now()
   where qa_fixture
     and status <> 'closed'
     and (qa_window_until is null or qa_window_until <= clock_timestamp());
  get diagnostics v_closed = row_count;
  return v_closed;
end;
$close_expired_qa_windows$;

revoke all on function public.open_qa_window(uuid, integer) from public, anon;
revoke all on function public.close_qa_window(uuid) from public, anon;
revoke all on function public.close_expired_qa_windows() from public, anon, authenticated;
revoke all on function public.guard_business_qa_columns() from public, anon, authenticated;
grant execute on function public.open_qa_window(uuid, integer) to authenticated, service_role;
grant execute on function public.close_qa_window(uuid) to authenticated, service_role;
grant execute on function public.close_expired_qa_windows() to service_role;

do $schedule_qa_window_expiry$
begin
  perform cron.schedule(
    'taba-qa-window-expiry',
    '* * * * *',
    'select public.close_expired_qa_windows();'
  );
end;
$schedule_qa_window_expiry$;

-- Un tenant QA que hoy esté abierto sin ventana se cierra ya, sin esperar al cron.
select public.close_expired_qa_windows();

-- ===== 3. Políticas públicas: un tenant QA sólo dentro de su ventana =====
-- `businesses` se lee por columna (20260725120000) y la política de `products`
-- evalúa estas dos columnas con el rol del que consulta. Sólo lectura: no hay
-- UPDATE otorgado sobre ellas (además del trigger de arriba).
grant select (qa_fixture, qa_window_until) on public.businesses to anon, authenticated;

-- Mismo texto que 20260725030000 y 20260826140000 más la condición QA.
drop policy if exists "production verified products are public" on public.products;
create policy "production verified products are public"
on public.products for select
to anon, authenticated
using (
  is_active
  and is_verified
  and available
  and stock is not null
  and stock > 0
  and exists (
    select 1
      from public.businesses b
     where b.id = business_id
       and b.is_active
       and b.status = 'open'
       and b.ordering_verified
       and b.ordering_enabled
       and (not b.qa_fixture or b.qa_window_until > now())
  )
);

drop policy if exists "alcohol verificado con foto se puede mirar" on public.products;
create policy "alcohol verificado con foto se puede mirar"
  on public.products
  for select
  to anon, authenticated
  using (
    is_active
    and is_verified
    and is_alcoholic is true
    and available is false
    and image_url is not null
    and catalog_asset_id is not null
    and exists (
      select 1
      from public.businesses b
      where b.id = products.business_id
        and b.is_active
        and b.status = 'open'
        and b.ordering_verified
        and b.ordering_enabled
        and (not b.qa_fixture or b.qa_window_until > now())
    )
  );

comment on policy "alcohol verificado con foto se puede mirar" on public.products is
  'Vidriera: deja MIRAR el alcohol verificado que ya tiene packshot real y todavía no está a la venta. No habilita comprarlo: available sigue en false, el CHECK products_available_requires_verification impide que deje de estarlo sin stock ni precio confirmado, y create_order rechaza cualquier pedido con alcohol mientras la política del comercio esté incompleta. Un tenant QA sólo se ve dentro de su ventana.';

-- ===== 4. Columnas privadas de producto =====
-- SELECT por columna: todas menos unit_cost y verified_by. Una columna nueva
-- queda sin leer hasta que su migración la otorgue (falla cerrado).
do $product_public_columns$
declare
  v_columns text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_columns
    from pg_attribute a
   where a.attrelid = 'public.products'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname not in ('unit_cost', 'verified_by');
  execute 'revoke select on table public.products from anon, authenticated';
  execute format('grant select (%s) on table public.products to anon, authenticated', v_columns);
end;
$product_public_columns$;
