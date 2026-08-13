-- TABA2 · Capa de identidad, parte 7: la auditoria sobrevive a lo que audita.
--
-- Defecto encontrado aplicando 20260812020000 a staging alojado, no en el
-- laboratorio: borrar un negocio o un usuario que aparecia en la auditoria
-- fallaba con
--
--   42501: identity: la auditoria es solo de agregado (UPDATE no permitido)
--   SQL statement "UPDATE ONLY public.identity_audit_events
--                  SET business_id = NULL WHERE ..."
--
-- La causa es la combinacion de dos cosas que por separado estan bien: las
-- claves foraneas de la tabla declaraban `on delete set null`, y el trigger de
-- solo-agregado rechaza cualquier UPDATE. El UPDATE que dispara la cascada NO
-- lo hace un cliente: lo hace el motor al borrar la fila referenciada. El
-- trigger no distingue una cosa de la otra, asi que el resultado neto era que
-- **una vez auditado, un usuario o un comercio ya no se podian borrar jamas**.
-- Aparecio limpiando datos de ensayo; habria aparecido igual el dia que alguien
-- pidiera que le borren la cuenta.
--
-- La correccion no es aflojar el trigger. Es sacarle las claves foraneas a la
-- auditoria, que ademas es como debe ser: un registro de auditoria tiene que
-- sobrevivir a la desaparicion de lo que audita. Si al borrar un usuario su
-- identificador se pusiera en null, la auditoria perderia justamente el dato
-- por el que existe. Las columnas siguen siendo uuid y siguen sirviendo para
-- cruzar; lo que se va es la cascada.
--
-- Aplicar despues de 20260812060000_identity_admin_surface.sql.

alter table public.identity_audit_events
  drop constraint if exists identity_audit_events_business_id_fkey;

alter table public.identity_audit_events
  drop constraint if exists identity_audit_events_actor_user_id_fkey;

alter table public.identity_audit_events
  drop constraint if exists identity_audit_events_subject_user_id_fkey;

comment on column public.identity_audit_events.business_id is
  'Comercio al que pertenecia el evento. Sin clave foranea a proposito: la '
  'auditoria sobrevive al borrado del comercio.';

comment on column public.identity_audit_events.actor_user_id is
  'Quien hizo la accion. Sin clave foranea a proposito: la auditoria sobrevive '
  'al borrado de la cuenta.';

comment on column public.identity_audit_events.subject_user_id is
  'Sobre quien se hizo la accion. Sin clave foranea, por el mismo motivo.';

-- La sesion logica SI puede desaparecer con su persona: no es un registro
-- historico, es estado vivo. Su cascada es un DELETE, no un UPDATE, y no hay
-- trigger que lo impida. Se deja como estaba.
