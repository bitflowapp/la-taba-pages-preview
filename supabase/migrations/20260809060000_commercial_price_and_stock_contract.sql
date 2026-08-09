-- ─────────────────────────────────────────────────────────────────────────────
-- CONTRATO CANÓNICO DE PRECIO Y STOCK
--
-- QUÉ PROBLEMA CIERRA
-- -------------------
-- El estado explícito del precio YA EXISTÍA: `products.price_status` es
-- `not null` con `check (price_status in ('confirmed','pending'))` desde
-- 20260802090000, y los caminos de reserva y de pago lo respetan —ninguno deja
-- reservar con `price_status <> 'confirmed'`—.
--
-- Lo que faltaba es que la TABLA lo impusiera. `products_available_requires_
-- verification` exigía verificación, actividad y stock, pero no decía nada del
-- precio. Es decir: una fila podía quedar `available = true` con
-- `price_status = 'pending'` y `price = 0`, y la única razón por la que no se
-- vendía era que las RPC de checkout lo frenaban más adelante. Un camino nuevo
-- que escribiera `available` directamente —el grant lo permite— publicaba un
-- producto a cero pesos sin que nada del motor se opusiera.
--
-- Esta migración hace tres cosas y ninguna más:
--
--   1. MIDE y REMEDIA. Antes de endurecer, apaga `available` en las filas que
--      hoy están en ese estado incoherente y deja constancia de cuántas eran.
--      No es pérdida de dato: es el estado que esas filas debían tener, y el
--      que el checkout ya les imponía.
--   2. ENDURECE la restricción de disponibilidad con las dos condiciones que
--      faltaban: precio confirmado y precio mayor a cero.
--   3. NOMBRA el estado. `product_commercial_state()` devuelve una palabra por
--      fila para que el Panel, los reportes y las pruebas dejen de rederivarlo
--      cada uno a su manera.
--
-- LO QUE NO HACE, A PROPÓSITO
-- ---------------------------
-- No convierte `price` en nullable. Seria la representación más limpia de
-- «sin precio», pero es una migración de riesgo alto —toca una columna
-- `not null` que leen catorce RPC, la app del Rider y el Panel— a cambio de
-- cero beneficio funcional: `price_status` ya distingue el estado, y ahora la
-- restricción impide que un cero se venda. El día que se haga, esta migración
-- deja el terreno preparado; hoy no hay ninguna ambigüedad que sólo el nullable
-- resuelva.
--
-- No agrega `stock_status`. `stock` es nullable y ya distingue los tres estados
-- sin ambigüedad posible: NULL es «nadie lo contó», 0 es «se agotó» y N es N.
-- Una columna de estado paralela sería una segunda fuente de verdad que puede
-- desincronizarse de la primera.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. MEDIR Y REMEDIAR ──────────────────────────────────────────────────────
-- La tabla queda como constancia de qué se apagó y por qué. Si el conteo es
-- cero —lo esperable— la tabla queda vacía y la migración es un no-op.
create table if not exists public.commercial_contract_remediation (
  id uuid primary key default gen_random_uuid(),
  migration text not null,
  product_id uuid not null,
  business_id uuid not null,
  sku text,
  reason text not null,
  previous_price numeric(12, 2),
  previous_price_status text,
  previous_stock integer,
  remediated_at timestamptz not null default statement_timestamp()
);

comment on table public.commercial_contract_remediation is
  'Audit trail of rows switched to available=false when the commercial price contract was hardened. Empty means the catalog was already coherent.';

insert into public.commercial_contract_remediation
  (migration, product_id, business_id, sku, reason, previous_price, previous_price_status, previous_stock)
select
  '20260809060000_commercial_price_and_stock_contract',
  p.id,
  p.business_id,
  p.sku,
  case
    when p.price_status is distinct from 'confirmed' then 'available with price_status <> confirmed'
    else 'available with price <= 0'
  end,
  p.price,
  p.price_status,
  p.stock
  from public.products p
 where p.available
   and (p.price_status is distinct from 'confirmed' or coalesce(p.price, 0) <= 0);

update public.products p
   set available = false,
       updated_at = statement_timestamp()
 where p.available
   and (p.price_status is distinct from 'confirmed' or coalesce(p.price, 0) <= 0);

-- ── 2. ENDURECER ─────────────────────────────────────────────────────────────
alter table public.products
  drop constraint if exists products_available_requires_verification;
alter table public.products
  add constraint products_available_requires_verification check (
    not available
    or (
      is_verified
      and is_active
      and stock is not null
      and stock > 0
      -- Las dos condiciones nuevas. Un producto comprable tiene precio
      -- confirmado y ese precio es mayor a cero: nada se vende gratis por
      -- omisión, aunque la interfaz falle o alguien escriba `available`
      -- directamente sobre la tabla.
      and price_status = 'confirmed'
      and price > 0
    )
  );

comment on constraint products_available_requires_verification on public.products is
  'A purchasable product is verified, active, has known stock above zero, a confirmed price state and a price above zero.';

-- ── 3. NOMBRAR EL ESTADO ─────────────────────────────────────────────────────
-- Una sola palabra por fila, para que nadie vuelva a derivarla a mano. El orden
-- de las ramas no es alfabético: es el orden en que hay que resolver los
-- faltantes. Sin precio no se vende aunque sobre stock.
create or replace function public.product_commercial_state(
  p_price_status text,
  p_price numeric,
  p_stock integer,
  p_is_active boolean,
  p_is_verified boolean,
  p_available boolean
)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when p_price_status is distinct from 'confirmed' or coalesce(p_price, 0) <= 0
      then 'precio_pendiente'
    when p_stock is null then 'stock_pendiente'
    when p_stock <= 0 then 'agotado'
    when not coalesce(p_is_active, false) or not coalesce(p_is_verified, false)
      then 'no_publicado'
    when not coalesce(p_available, false) then 'publicable_no_publicado'
    else 'comprable'
  end
$$;

comment on function public.product_commercial_state(text, numeric, integer, boolean, boolean, boolean) is
  'Single authority for the commercial state of a catalog row: precio_pendiente, stock_pendiente, agotado, no_publicado, publicable_no_publicado or comprable.';

revoke all on function public.product_commercial_state(text, numeric, integer, boolean, boolean, boolean)
from public, anon;
grant execute on function public.product_commercial_state(text, numeric, integer, boolean, boolean, boolean)
to authenticated;
