-- PRODUCTOS · COLUMNAS INTERNAS FUERA DEL ALCANCE DEL PÚBLICO
--
-- Hallazgo verificado en vivo con la clave publicable (2026-10-05) sobre la base de
-- producción `wwcpogltfgzgkrlilbcd`: `anon` y `authenticated` tienen SELECT sobre
-- TODA la tabla `public.products`, incluidas
--
--   - `unit_cost`   el costo del comercio: su margen no es información del catálogo;
--   - `verified_by` el usuario del personal que verificó el producto.
--
-- Hoy `unit_cost` está en NULL en los 51 productos, pero el Panel lo puede cargar y
-- el día que el dueño cargue costos su margen quedaba legible por cualquiera con la
-- clave publicable (`select=*` en la API).
--
-- La misma corrección ya existía en `20260925090000_cp_qa_window_and_private_product_
-- columns.sql` (sección 4), junto con la ventana QA. Esa migración NO está aplicada en
-- producción —la base lleva 29 migraciones de atraso— y arrastra cambios que no son
-- parte de este hallazgo. Esta migración es SÓLO la corrección de columnas: autónoma,
-- idempotente y segura de aplicar antes o después de las demás.
--
-- Qué hace: SELECT por columna para `anon` y `authenticated` sobre todas las columnas
-- de `public.products` salvo `unit_cost` y `verified_by`.
--
-- Qué NO cambia:
--   - las políticas RLS (qué FILAS se ven) ni los permisos de INSERT/UPDATE: el Panel
--     sigue escribiendo `unit_cost` por RPC (`apply_commercial_catalog_batch`,
--     SECURITY DEFINER) y ninguna consulta directa del frontend lo lee;
--   - `service_role`, el dueño de la tabla y las funciones SECURITY DEFINER: el backend
--     interno, la auditoría y la importación siguen leyendo todo;
--   - los datos: no toca ninguna fila.
--
-- Efecto colateral que se acepta a propósito: `select *` sobre `products` con
-- `anon`/`authenticated` ahora falla con 42501 (permiso denegado) porque `*` incluye
-- columnas privadas; hay que pedir las columnas por nombre, como ya hace la tienda
-- (`loadCatalog`). Una columna NUEVA de `products` queda sin leer por el público hasta
-- que su migración la otorgue (falla cerrado).
--
-- Forward-only e idempotente. REVERSIÓN (sólo si hiciera falta):
--   grant select on table public.products to anon, authenticated;

-- Estrictamente RESTRICTIVA: cada rol conserva exactamente lo que ya podía leer,
-- menos las dos columnas. Con SELECT de tabla (producción hoy) eso es «todas menos
-- dos»; con SELECT por columna (una base que ya aplicó 20260925090000) es lo que
-- esa base haya otorgado, sin reabrir una columna que una migración posterior haya
-- retenido a propósito.
do $products_internal_columns_private$
declare
  v_role text;
  v_columns text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_columns
      from pg_attribute a
     where a.attrelid = 'public.products'::regclass
       and a.attnum > 0
       and not a.attisdropped
       and a.attname not in ('unit_cost', 'verified_by')
       and has_column_privilege(v_role, 'public.products'::regclass, a.attnum, 'SELECT');
    execute format('revoke select on table public.products from %I', v_role);
    if v_columns is not null then
      execute format('grant select (%s) on table public.products to %I', v_columns, v_role);
    end if;
  end loop;
end;
$products_internal_columns_private$;

comment on column public.products.unit_cost is
  'PRIVADA: costo del comercio. No es legible por anon ni authenticated (SELECT por columna); se escribe por RPC SECURITY DEFINER.';
comment on column public.products.verified_by is
  'PRIVADA: usuario del personal que verificó el producto. No es legible por anon ni authenticated.';
