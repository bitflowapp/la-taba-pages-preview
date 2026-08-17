-- TABA2 · El guard de membresias deja borrar una cuenta.
--
-- Defecto encontrado en el smoke sintetico contra produccion alojada. Es
-- anterior a esta mision y se venia arrastrando desde 20260812080000; aparecio
-- ahora porque este es el primer circuito que crea una persona, la hace miembro
-- y despues intenta borrarla.
--
-- Sintoma: `DELETE /auth/v1/admin/users/{id}` sobre alguien con membresia
-- contesta 500 `Database error deleting user`. El mismo DELETE por conexion
-- directa funciona. O sea: la cuenta de cualquier integrante de un comercio NO
-- se podia borrar por la via de Auth, que es la unica via que tiene el tablero
-- de Supabase y la unica que tendria un pedido de baja de datos personales.
--
-- Causa. `business_members.user_id` declara `on delete cascade`, asi que borrar
-- la persona dispara un DELETE sobre business_members. Ese DELETE lo hace el
-- motor, pero el trigger `identity_guard_membership_write` no distingue quien lo
-- dispara: mira si la transaccion trae la marca `taba.identity_write`, si
-- `current_user` es service_role, o si `session_user` es postgres/supabase_admin
-- o superusuario. GoTrue borra con su propio rol —`supabase_auth_admin`—, que no
-- es ninguno de esos, asi que el guard levantaba insufficient_privilege y se
-- llevaba puesto el borrado entero. Por conexion directa funcionaba porque
-- `session_user` ahi SI es postgres, que es una de las vias de escape.
--
-- La correccion NO es agregar `supabase_auth_admin` a la lista de roles de
-- confianza: eso abriria una via de escritura por rol, que es exactamente lo
-- que el guard existe para no tener.
--
-- Lo que se agrega es una condicion sobre el HECHO, no sobre quien llama: se
-- permite el DELETE cuando la fila referenciada ya no existe. Si la persona o el
-- comercio ya desaparecieron, quitar su membresia no es un acto administrativo
-- que haya que auditar: es la limpieza de una referencia que quedo apuntando a
-- la nada. Y no abre nada, porque para llegar a esa situacion hay que haber
-- podido borrar antes la persona o el comercio, que tienen sus propios permisos.
--
-- Un cliente que intente borrar la membresia de alguien que SI existe sigue
-- recibiendo el mismo rechazo que antes. Hay una prueba para las dos mitades.
--
-- Aplicar despues de 20260817030000_reviewer_identity_can_be_deleted.sql.

create or replace function public.identity_guard_membership_write()
returns trigger
language plpgsql
-- SIN security definer, a proposito: con definer, current_user es el duenio de
-- la funcion y no el que llama, y la comprobacion de service_role es letra
-- muerta. Ver el encabezado de 20260812080000.
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_is_local_admin boolean;
begin
  -- Las RPC de identidad marcan la transaccion antes de escribir.
  if coalesce(current_setting('taba.identity_write', true), '') = 'on' then
    return coalesce(new, old);
  end if;

  -- Limpieza de una referencia huerfana. Se mira el hecho, no el rol: si la
  -- persona o el comercio ya no estan, esta fila no describe a nadie.
  if tg_op = 'DELETE' and old is not null then
    if not exists (select 1 from auth.users u where u.id = old.user_id)
       or not exists (select 1 from public.businesses b where b.id = old.business_id) then
      return old;
    end if;
  end if;

  -- Tareas de plataforma con clave de servicio.
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

comment on function public.identity_guard_membership_write() is
  'Guard de business_members. Deja pasar las RPC de identidad, la clave de servicio, '
  'las conexiones directas de migracion, y la limpieza de una membresia cuya persona '
  'o cuyo comercio ya no existen. Todo lo demas se administra por RPC.';

select pg_notify('pgrst', 'reload schema');
