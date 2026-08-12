-- TABA2 · Capa de identidad, parte 8: el guard de membresias tiene que ver
-- quien llama de verdad.
--
-- Defecto encontrado certificando contra staging alojado con PostgREST real,
-- no en el laboratorio: una escritura de membresia con CLAVE DE SERVICIO
-- devolvia 403.
--
-- La causa es de manual y vale la pena dejarla escrita. El guard se creo
-- `security definer`, y dentro de una funcion definer `current_user` es el
-- DUENIO de la funcion —postgres—, no el rol que hizo la llamada. La rama
--
--     if current_user = 'service_role' then return ...
--
-- por lo tanto no podia cumplirse nunca. Y la otra via de escape mira
-- `session_user`, que en PostgREST es `authenticator`, no `postgres`. Neto:
-- service_role quedaba bloqueado igual que un cliente cualquiera.
--
-- No se noto en los ensayos locales porque ahi las escrituras entran por psql,
-- donde `session_user` SI es `postgres` y la primera via de escape alcanza.
-- Hizo falta una conexion de verdad para que apareciera.
--
-- Que rompia, concretamente:
--   * scripts/identity-bootstrap-owner.mjs, que crea al primer owner de un
--     entorno nuevo con clave de servicio. Es decir: el arranque de PROD;
--   * cualquier tarea de plataforma que administre el equipo con la clave de
--     servicio.
--
-- La correccion es sacarle `security definer` al guard. Un trigger de
-- validacion no necesita privilegios prestados: solo lee GUCs de la transaccion
-- y pg_roles, que es legible por todos. Sin definer, `current_user` vuelve a
-- ser el rol real de la llamada y las tres vias de escape dicen lo que
-- pretendian decir.
--
-- Aplicar despues de 20260812070000_identity_audit_survives_deletion.sql.

create or replace function public.identity_guard_membership_write()
returns trigger
language plpgsql
-- SIN security definer, a proposito: con definer, current_user es el duenio de
-- la funcion y no el que llama, y la comprobacion de service_role es letra
-- muerta. Ver el encabezado de esta migracion.
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_is_local_admin boolean;
begin
  -- Las RPC de identidad marcan la transaccion antes de escribir.
  if coalesce(current_setting('taba.identity_write', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  -- Tareas de plataforma con clave de servicio. Ahora si se puede evaluar.
  if current_user = 'service_role' then
    return coalesce(new, old);
  end if;

  -- Migraciones, semillas y fixtures por conexion directa.
  select coalesce(bool_or(r.rolsuper), false) or session_user in ('postgres', 'supabase_admin')
    into v_is_local_admin
    from pg_catalog.pg_roles r
   where r.rolname = session_user;

  if v_is_local_admin then
    return coalesce(new, old);
  end if;

  raise exception 'identity: las membresias se administran por RPC de identidad'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function public.identity_guard_membership_write() from public, anon, authenticated;

-- PostgREST guarda en cache el esquema y los permisos. Despues de cambiar
-- grants o funciones hay que pedirle que relea, o sigue respondiendo con la
-- foto vieja hasta que algo mas lo despierte.
select pg_notify('pgrst', 'reload schema');
