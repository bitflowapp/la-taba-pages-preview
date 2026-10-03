-- Fase «ANTES» del despliegue de la candidata comercial en staging.
-- SÓLO LECTURA: ni un insert, ni un update, ni un delete. Se puede correr las
-- veces que haga falta sin cambiar nada.
--
--   supabase db query --linked -f antes-snapshot-y-medicion.sql
--
-- Hace dos cosas:
--   1. El snapshot de integridad que el encargo pide como precondición.
--   2. La MEDICIÓN EN SECO de lo que remediaría 20260809060000, con la misma
--      condición exacta de la migración, para saber ANTES de aplicarla a
--      cuántas filas apagaría. Si devuelve filas, hay que mirarlas con el
--      negocio antes de seguir: sobre esta misma base hay una prueba humana
--      pendiente y vaciar la góndola la haría imposible.

\echo '=== 1 · CATÁLOGO ==='
select
  count(*)                                              as productos,
  count(*) filter (where available)                     as disponibles,
  count(*) filter (where is_active)                     as activos,
  count(*) filter (where is_verified)                   as verificados,
  count(*) filter (where price_status = 'confirmed')    as precio_confirmado,
  count(*) filter (where price_status = 'pending')      as precio_pendiente,
  count(*) filter (where coalesce(price, 0) <= 0)       as precio_en_cero,
  count(*) filter (where stock is null)                 as stock_sin_contar,
  count(*) filter (where stock = 0)                     as agotados
  from public.products;

\echo '=== 2 · CADA PRODUCTO, COMO ESTÁ HOY ==='
select sku, name, price, price_status, stock, available, is_active, is_verified
  from public.products
 order by sku;

\echo '=== 3 · MEDICIÓN EN SECO: lo que 20260809060000 APAGARÍA ==='
-- Misma condición, palabra por palabra, que la migración.
select
  p.sku,
  p.name,
  p.price     as precio_actual,
  p.price_status,
  p.stock,
  case
    when p.price_status is distinct from 'confirmed' then 'available with price_status <> confirmed'
    else 'available with price <= 0'
  end as motivo
  from public.products p
 where p.available
   and (p.price_status is distinct from 'confirmed' or coalesce(p.price, 0) <= 0)
 order by p.sku;

\echo '=== 3b · CUÁNTAS SON (0 = el catálogo ya era coherente) ==='
select count(*) as filas_que_se_apagarian
  from public.products p
 where p.available
   and (p.price_status is distinct from 'confirmed' or coalesce(p.price, 0) <= 0);

\echo '=== 3c · Y CUÁNTAS QUEDARÍAN COMPRABLES DESPUÉS ==='
-- Si esto da 0, la góndola queda vacía y NO hay que desplegar.
select count(*) as comprables_despues
  from public.products p
 where p.available
   and p.is_active
   and p.is_verified
   and p.price_status = 'confirmed'
   and coalesce(p.price, 0) > 0
   and p.stock is not null
   and p.stock > 0;

\echo '=== 4 · PEDIDOS Y RESERVAS ==='
select
  count(*)                                                                 as pedidos_totales,
  count(*) filter (where status not in ('delivered', 'cancelled', 'rejected')) as vivos,
  count(*) filter (where origin = 'production')                            as de_produccion,
  max(created_at)                                                          as ultimo
  from public.orders;

\echo '=== 5 · LT-0030, QUE NO SE TOCA (debe quedar arrived r11 $550) ==='
select code, status, revision, total, updated_at
  from public.orders
 where code = 'LT-0030';

\echo '=== 6 · ARCA APAGADO (los tres deben dar 0) ==='
select
  (select count(*) from public.fiscal_documents) as documentos_fiscales,
  (select count(*) from public.pos_sales)        as ventas_pos,
  (select count(*) from public.fiscal_outbox)    as cola_fiscal;

\echo '=== 7 · MIGRACIONES YA APLICADAS (las últimas diez) ==='
select version
  from supabase_migrations.schema_migrations
 order by version desc
 limit 10;

\echo '=== 8 · ¿YA ESTÁN LAS TRES DE LA CANDIDATA? (esperado: ninguna) ==='
select version
  from supabase_migrations.schema_migrations
 where version in ('20260809050000', '20260809060000', '20260809070000')
 order by version;
