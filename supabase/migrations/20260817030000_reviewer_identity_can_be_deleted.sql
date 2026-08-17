-- TABA2 · Alta por solicitud: el revisor puede irse.
--
-- Defecto encontrado en el smoke sintetico contra produccion alojada, no en el
-- laboratorio: borrar la cuenta de quien habia aprobado una solicitud fallaba
-- con
--
--   23514: new row for relation "business_access_requests" violates check
--          constraint "business_access_requests_reviewer_follows_decision"
--   CONTEXT: SQL statement "UPDATE ONLY public.business_access_requests
--            SET decided_by = NULL WHERE ..."
--
-- Es el mismo error de razonamiento que ya se habia cometido una vez en esta
-- base, en la auditoria de identidad (migracion 20260812070000), y vale la pena
-- dejarlo escrito dos veces porque es facil de repetir.
--
-- Por separado, las dos piezas estaban bien:
--
--   * `decided_by` declara `on delete set null`, porque una solicitud decidida
--     tiene que sobrevivir a que la cuenta de quien la decidio desaparezca.
--   * El CHECK decia `(decided_at is null) = (decided_by is null)`, que parecia
--     la forma prolija de exigir "si hay decision, hay revisor".
--
-- Juntas producian una consecuencia que nadie eligio: en cuanto una persona
-- aprobaba o rechazaba una sola solicitud, su cuenta ya NO se podia borrar. El
-- UPDATE que rompe el CHECK no lo hace un cliente: lo hace el motor al aplicar
-- la cascada. Habria aparecido el dia que alguien pidiera que le borren la
-- cuenta, o simplemente al dar de baja a un encargado.
--
-- La correccion es escribir el invariante en la direccion que de verdad
-- importaba. Lo que no puede pasar es un revisor SIN decision: eso seria una
-- fila a medio sellar. Una decision sin revisor, en cambio, es un hecho normal
-- y esperable —la persona ya no esta— y el `decided_at`, el `granted_role` y la
-- auditoria siguen contando toda la historia.
--
-- Aplicar despues de 20260817020000_access_request_review_contract.sql.

alter table public.business_access_requests
  drop constraint if exists business_access_requests_reviewer_follows_decision;

alter table public.business_access_requests
  add constraint business_access_requests_reviewer_follows_decision
  check (decided_by is null or decided_at is not null);

comment on column public.business_access_requests.decided_by is
  'Quien decidio, si su cuenta todavia existe. Se pone en null al borrarla, y la '
  'decision sigue en pie: decided_at y granted_role son los que sellan la fila.';

select pg_notify('pgrst', 'reload schema');
