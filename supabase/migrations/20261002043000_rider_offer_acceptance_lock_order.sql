-- TABA · ACEPTAR UNA OFERTA TOMA EL PEDIDO ANTES QUE LA OFERTA, COMO QUIEN LA OFRECE
--
-- QUÉ ESTABA ROTO (medido el 2026-10-02 y otra vez el 2026-10-03 sobre las 190 migraciones
-- anteriores, PostgreSQL 17 local con las dependencias de la plataforma simuladas, con
-- conexiones reales, una por llamada)
--
--   `offer_order_to_rider` toma el pedido y después la oferta pendiente de ese pedido.
--   `accept_rider_order_offer` tomaba la oferta y después el pedido. Si el comercio ofrece
--   el pedido a OTRO repartidor justo cuando el primero acepta la suya, las dos llamadas
--   quedan esperándose y Postgres corta una al segundo. Con las llegadas en orden (una
--   conexión retiene el pedido, llegan las dos, se suelta): 40P01 siempre. Unas veces cortó
--   al repartidor (la oferta sigue pendiente y tiene que volver a tocar «aceptar») y otras
--   al comercio (su oferta falla con un error en vez de contestar `offer_in_flight`).
--
-- QUÉ CAMBIA
--
--   `accept_rider_order_offer` es la envoltura que mira la presencia del repartidor y
--   delega en `accept_rider_order_offer_pre_presence`, que es la que toma los candados y
--   no tiene permisos de cliente. La envoltura ya leía la oferta sin candado. Ahora, antes
--   de delegar, toma el pedido de esa oferta y después la oferta, y comprueba con las dos
--   filas tomadas que la oferta sigue siendo de ese pedido (si no, PT409). La función de
--   adentro encuentra los dos candados ya tomados y vuelve a comprobar todo lo demás
--   (estado, versión, revisión, cupo) como siempre.
--
--   El pedido se toma FOR NO KEY UPDATE, no FOR UPDATE. Medido con la variante FOR UPDATE:
--   corrige el cruce con la oferta pero inventa dos que hoy no existen, porque rechazar y
--   retirar una oferta toman la oferta y después anotan un evento del pedido (la clave
--   foránea pide KEY SHARE sobre el pedido): «aceptar contra retirar» y «aceptar contra
--   rechazar» pasaban a terminar en deadlock. FOR NO KEY UPDATE choca con el FOR UPDATE de
--   quien ofrece -que es lo que hace falta- y no con ese KEY SHARE.
--
-- QUÉ NO CAMBIA
--
--   Ninguna respuesta de la aceptación: mismos códigos, misma repetición idempotente, mismo
--   chequeo de presencia. Firma, SECURITY DEFINER, `search_path` y permisos
--   (`authenticated`). `accept_rider_order_offer_pre_presence`, `offer_order_to_rider`,
--   `reject_rider_order_offer` y `withdraw_rider_order_offer` no se tocan. El cuerpo es el
--   vigente letra por letra, generado de la definición viva, con ese bloque agregado.
--
-- QUÉ QUEDA AFUERA (medido, informado; no son funciones de este paquete)
--
--   `reject_rider_order_offer` y `withdraw_rider_order_offer` toman la oferta y después el
--   pedido (por la clave foránea de su evento). Cruzadas con `offer_order_to_rider` del
--   mismo pedido terminan en deadlock, igual que terminaba la aceptación. La corrección es
--   la misma: tomar antes el pedido de la oferta, FOR NO KEY UPDATE.
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261002043000_rider_offer_acceptance_lock_order.rollback.sql

CREATE OR REPLACE FUNCTION public.accept_rider_order_offer(p_offer_id uuid, p_expected_version bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare v_offer public.rider_order_offers%rowtype;v_prior jsonb;
begin
  if auth.uid() is null then raise exception 'Autenticación requerida' using errcode='42501'; end if;
  perform public.lock_rider_capacity(auth.uid());
  select * into v_offer from public.rider_order_offers
   where id=p_offer_id and rider_user_id=auth.uid();
  if not found then return public.accept_rider_order_offer_pre_presence(p_offer_id,p_expected_version,p_idempotency_key); end if;
  perform public.rider_require_active_membership(v_offer.business_id);
  -- Pedido -> oferta, el orden de offer_order_to_rider. La funcion de adentro toma la
  -- oferta y despues el pedido: si en ese momento el comercio ofrecia el pedido a otro
  -- repartidor (pedido -> oferta pendiente), una de las dos llamadas terminaba en
  -- deadlock. Aca se toma primero el pedido, que se conoce por la oferta leida sin
  -- candado, y despues la oferta; adentro los dos ya estan tomados.
  -- El pedido va FOR NO KEY UPDATE y no FOR UPDATE: rechazar y retirar una oferta toman
  -- la oferta y despues anotan un evento del pedido, que pide KEY SHARE sobre el pedido;
  -- con FOR UPDATE esas dos se trabarian con esta. La oferta se comprueba ya tomada: sigue
  -- siendo de ese pedido.
  perform 1 from public.orders o where o.id=v_offer.order_id for no key update;
  perform 1 from public.rider_order_offers f where f.id=v_offer.id and f.order_id=v_offer.order_id for update;
  if not found then raise exception 'la oferta cambio de pedido mientras se aceptaba' using errcode='PT409'; end if;
  if (select b.rider_presence_required from public.businesses b where b.id=v_offer.business_id)
     and not public.rider_availability_effective(v_offer.business_id,auth.uid()) then
    select result into v_prior from public.rider_delivery_operations
    where order_id=v_offer.order_id and rider_user_id=auth.uid()
      and operation='accept_offer' and idempotency_key=p_idempotency_key;
    if found or v_offer.status <> 'pending' then
      return public.accept_rider_order_offer_pre_presence(p_offer_id,p_expected_version,p_idempotency_key);
    end if;
    return jsonb_build_object('ok',false,'code','rider_unavailable');
  end if;
  return public.accept_rider_order_offer_pre_presence(p_offer_id,p_expected_version,p_idempotency_key);
end;
$function$;

revoke all on function public.accept_rider_order_offer(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.accept_rider_order_offer(uuid, bigint, text) to authenticated;
