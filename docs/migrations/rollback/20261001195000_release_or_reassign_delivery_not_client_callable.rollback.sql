-- REVERSIÓN de 20261001195000_release_or_reassign_delivery_not_client_callable.sql
--
-- Le devuelve EXECUTE a `authenticated` sobre `release_or_reassign_delivery`. La
-- migración no cambió el cuerpo de la función.
--
-- Ojo con lo que vuelve: cualquier sesión del comercio puede otra vez cambiar el
-- repartidor de un pedido por PostgREST sin que quede ningún evento. Sólo usar
-- para volver atrás un despliegue.
--
-- No toca filas.
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001195000
begin;

revoke all on function public.release_or_reassign_delivery(uuid, bigint, uuid) from public, anon;
grant execute on function public.release_or_reassign_delivery(uuid, bigint, uuid) to authenticated;

commit;
