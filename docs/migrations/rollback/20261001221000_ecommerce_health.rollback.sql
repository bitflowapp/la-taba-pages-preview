-- REVERSIÓN de 20261001221000_ecommerce_health.sql
--
-- Retira `public.get_ecommerce_health()`.
--
-- Ojo con lo que vuelve a quedar abierto: no queda ninguna lectura de la salud de
-- la plataforma (base, Auth, checkout, pedidos, cobros, avisos, planificador). Las
-- firmas rechazadas, los avisos abandonados sin intento de pago y una tarea de
-- pg_cron borrada vuelven a no figurar en ninguna parte. Si algún monitor externo
-- ya llama a la función, va a recibir un 404 de PostgREST: apagarlo antes.
--
-- No se pierde nada durable: es una función de lectura, sin tablas propias.
--
-- ORDEN: ésta se revierte ANTES que 20261001220000 (usa su inventario de tareas).
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001221000
begin;

drop function if exists public.get_ecommerce_health();

commit;
