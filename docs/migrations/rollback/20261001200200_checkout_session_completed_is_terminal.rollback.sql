-- REVERSIÓN de 20261001200200_checkout_session_completed_is_terminal.sql
--
-- Quita el trigger de transición de `checkout_sessions` y su función, y devuelve
-- `checkout_pipeline_state` a IMMUTABLE (la etiqueta que tenía; el cuerpo no cambió).
--
-- Ojo con lo que vuelve a quedar abierto: cualquier UPDATE puede sacar una sesión de
-- `completed` o desvincular su pedido, y la función que llama a `clock_timestamp()`
-- vuelve a declararse inmutable. Sólo usar para volver atrás un despliegue.
--
-- No toca filas ni supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001200200
begin;

drop trigger if exists checkout_sessions_guard_completed_terminal on public.checkout_sessions;
drop function if exists public.guard_checkout_session_completed_terminal();

alter function public.checkout_pipeline_state(text, timestamptz) immutable;

commit;
