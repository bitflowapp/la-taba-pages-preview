-- TABA · `release_or_reassign_delivery` NO ES UNA PUERTA DE CLIENTE
--
-- La función cambia el repartidor de un pedido sin dejar evento y sin clave de
-- idempotencia. Ningún cliente la usa, pero cualquier sesión del comercio podía
-- llamarla directo. Acá se prueba que ningún rol de cliente la ejecuta y que la puerta
-- que sí usa el Panel —`assign_order_rider`, que deja su evento— sigue abierta.
--
-- Se prueba por el GRANT, que es donde vive la respuesta: sin EXECUTE el cuerpo
-- nunca llega a evaluarse.

begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select function_privs_are(
  'public', 'release_or_reassign_delivery', array['uuid', 'bigint', 'uuid'],
  'authenticated', array[]::text[],
  'un operador autenticado ya no puede ejecutar release_or_reassign_delivery');
select function_privs_are(
  'public', 'release_or_reassign_delivery', array['uuid', 'bigint', 'uuid'],
  'anon', array[]::text[],
  'anon tampoco');
select ok(
  has_function_privilege('authenticated', 'public.assign_order_rider(uuid, text, uuid, uuid)', 'EXECUTE'),
  'la reasignacion del Panel sigue por assign_order_rider, que si deja evento');

select * from finish();
rollback;
