-- TABA · CANCELAR UN PEDIDO SIGUE EL CATÁLOGO DE PERMISOS
--
-- QUÉ ESTABA ABIERTO (auditoría, AUTHZ-04; reproducido en PG17 local)
--
--   El catálogo de permisos (`identity_role_permissions`) dice qué puede hacer cada rol
--   y es lo que el Panel recibe por `identity_current_context`. El permiso
--   `orders.cancel` («Cancelar un pedido») lo tienen el dueño y el encargado; el
--   empleado (`staff`) no.
--
--   Las dos puertas por las que el comercio cancela no miraban el catálogo: miraban una
--   lista de roles escrita en la función, `owner`, `admin` y `staff`. Medido con la
--   sesión de un empleado al que `identity_has_permission(..., 'orders.cancel')` le
--   contesta `false`:
--
--     cancel_order(...)                         -> cancelled
--     transition_order(..., 'cancelled', ...)   -> cancelled
--     transition_order(..., 'rejected', ...)    -> rejected
--
--   Los tres pedidos quedaron cerrados y su stock devuelto.
--
-- LA DECISIÓN (del dueño, 2026-10-02)
--
--   Cancela un pedido del comercio quien tiene el permiso `orders.cancel`: el dueño y
--   el encargado. Un empleado, sólo si el catálogo le da ese permiso.
--
-- QUÉ CAMBIA
--
--   · `cancel_order` y `transition_order` (la de cuatro argumentos, la única que un
--     cliente puede llamar) preguntan `identity_has_permission(comercio, 'orders.cancel')`
--     antes de cancelar. No se agrega otra lista de roles: si el catálogo le da el
--     permiso a otro rol del equipo, las dos puertas lo siguen sin otra migración.
--   · Rechazar un pedido (`transition_order` a `rejected`) pide el mismo permiso. El
--     catálogo no tiene uno propio para rechazar, y es el mismo acto: cerrar un pedido
--     que el comercio no va a entregar, devolviendo su stock.
--   · La negativa es 42501 (la API contesta 403) con el detalle
--     `PERMISSION_REQUIRED: orders.cancel`, para que el cliente la distinga de «no sos
--     del comercio». Sale antes de mirar el cobro, la clave de idempotencia o la
--     revisión, y antes de escribir nada.
--
-- QUÉ NO CAMBIA
--
--   · Quien no es del equipo del comercio recibe lo mismo que antes y en el mismo
--     orden: «pedido inexistente» (P0002) si el pedido no existe, «operador no
--     autorizado» (42501) si existe y es de otro comercio. Esa línea no se tocó, y
--     sigue siendo la que decide quién es del equipo: un repartidor no pasa por estas
--     puertas aunque el catálogo le diera el permiso.
--   · Las demás transiciones (aceptar, preparar, dejar listo, despachar, entregar un
--     retiro): las sigue haciendo el empleado.
--   · El cliente que cancela su propio pedido sin atender (`cancel_own_order`) y el
--     vencimiento automático de los pedidos sin atender: no pasan por estas puertas.
--   · `change_order_status` y la `transition_order` de tres argumentos no se redefinen;
--     ningún cliente puede ejecutarlas.
--   · Firma, SECURITY DEFINER, `search_path` y permisos de las dos funciones.
--   · El catálogo de permisos: esta migración no escribe ninguna fila.
--
--   Las dos funciones son su definición vigente (20261001190500 la primera, 20260807090000
--   la segunda), letra por letra, con una inserción cada una: se generaron de la
--   definición viva, con el punto de inserción contado.
--
-- LO QUE HAY QUE SABER ANTES DE APLICARLA
--
--   · El Panel hoy le muestra «Cancelar» a todo el equipo: recibe los permisos de cada
--     persona pero no los usa para esconder el botón. Hasta que lo haga, un empleado
--     que lo toque recibe la negativa y el pedido no cambia.
--   · Caja Clara opera los pedidos por estas mismas dos puertas, con la sesión de quien
--     atiende la caja: si es un empleado, recibe la misma negativa.
--   · El catálogo da permisos por rol, no por persona. Para que UN empleado pueda
--     cancelar haría falta una tabla nueva, que esta migración no crea.
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261002050000_order_cancel_follows_permission_catalog.rollback.sql

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_expected_revision bigint, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then raise exception 'motivo de cancelacion requerido' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  -- Cancelar pide el permiso `orders.cancel` del catálogo (`identity_role_permissions`),
  -- no un rol de una lista: el catálogo es lo que el Panel le muestra a cada persona y
  -- tiene que ser lo mismo que el servidor hace valer. Va acá, antes de mirar el cobro,
  -- la clave de idempotencia o la revisión: quien no puede cancelar no se entera de
  -- nada más del pedido.
  if not public.identity_has_permission(v_order.business_id, 'orders.cancel') then
    raise exception 'operador sin permiso para cancelar o rechazar pedidos'
      using errcode = '42501', detail = 'PERMISSION_REQUIRED: orders.cancel';
  end if;

  if lower(btrim(coalesce(v_order.payment_method, ''))) = 'mercadopago'
     or exists (
       select 1 from public.payment_intents pi
        where pi.order_id = v_order.id
          and pi.internal_status in (
            'approved', 'approved_order_pending', 'completed',
            'partially_refunded', 'refunded', 'security_review_required'
          )
     ) then
    if not public.order_payment_is_financially_reversed(v_order.id) then
    raise exception 'pedido cobrado por Mercado Pago: gestionar reembolso antes de cancelar'
      using errcode = '55000';
    end if;
  end if;

  v_hash := public.business_command_request_hash('cancel_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'reason', btrim(p_reason)));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  v_result := public.transition_order(p_order_id, p_expected_revision, 'canceled');
  -- Ya estaba cancelado: esta llamada no canceló nada, así que no deja motivo ni
  -- recibo. El motivo que queda en el historial es el de quien sí canceló.
  if coalesce((v_result ->> 'idempotent_no_op')::boolean, false) then
    return v_result || jsonb_build_object('idempotent_replay', false);
  end if;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'business_cancel_reason', 'business_cancel_reason', 'Cancelacion registrada.', jsonb_build_object('reason', btrim(p_reason)));
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'cancel_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$function$;

revoke all on function public.cancel_order(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.cancel_order(uuid, bigint, text, text) to authenticated;

comment on function public.cancel_order(uuid, bigint, text, text) is
  'El comercio cancela un pedido, con motivo. Pide ser del equipo (owner, admin o staff) y tener el permiso orders.cancel del catalogo de permisos; sin el permiso contesta 42501 con el detalle PERMISSION_REQUIRED: orders.cancel, antes de mirar el cobro, la clave o la revision.';

CREATE OR REPLACE FUNCTION public.transition_order(p_order_id uuid, p_expected_revision bigint, p_new_status text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  -- Cancelar y rechazar piden el permiso `orders.cancel` del catálogo. Son el mismo
  -- acto —cerrar un pedido que el comercio no va a entregar, devolviendo su stock— y el
  -- catálogo no tiene un permiso aparte para rechazar. El destino se normaliza con la
  -- misma función que usa la transición, así `canceled` y `cancelled` son lo mismo.
  -- Las demás transiciones no piden nada nuevo.
  if public.normalize_order_status_vocabulary(p_new_status) in ('cancelled', 'rejected')
     and not public.identity_has_permission(v_order.business_id, 'orders.cancel') then
    raise exception 'operador sin permiso para cancelar o rechazar pedidos'
      using errcode = '42501', detail = 'PERMISSION_REQUIRED: orders.cancel';
  end if;
  v_hash := public.business_command_request_hash('transition_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'new_status', public.normalize_order_status_vocabulary(p_new_status)));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  v_result := public.transition_order(p_order_id, p_expected_revision, p_new_status);
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'transition_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$function$;

revoke all on function public.transition_order(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.transition_order(uuid, bigint, text, text) to authenticated;

comment on function public.transition_order(uuid, bigint, text, text) is
  'Transicion de pedido del Panel, idempotente por clave. Llevar el pedido a cancelled o rejected pide el permiso orders.cancel del catalogo de permisos (42501, detalle PERMISSION_REQUIRED: orders.cancel); las demas transiciones piden ser del equipo (owner, admin o staff).';
