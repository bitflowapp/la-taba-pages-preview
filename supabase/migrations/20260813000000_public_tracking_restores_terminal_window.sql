-- ═══════════════════════════════════════════════════════════════════════════
-- EL PEDIDO ENTREGADO VUELVE A PODER VERSE
--
-- ESTADO: PREPARADA, NO APLICADA. No se ejecutó contra ningún entorno.
--
-- QUÉ ESTABA MAL
-- --------------
-- `get_public_order_tracking` dejó de emitir `terminal_visible_until`. La
-- versión que lo devolvía (20260729203000) quedó pisada por DOS
-- `create or replace` posteriores —20260802100000 y 20260811020000— que
-- reescribieron la función entera sin esa clave.
--
-- Del lado del cliente esa ausencia no se lee como «falta un dato»: se lee como
-- ACCESO REVOCADO. `customer_tracking_poll.startTerminalVisibility` llamaba a
-- `onUnavailable`, que es `markTrackingUnavailable`: borra el acceso de
-- sessionStorage, saca el pedido del estado si venía por enlace público y
-- suprime el fallback. Resultado: en el momento exacto de la entrega, la
-- pantalla de Seguir caía al estado vacío «Cuando hagas una compra vas a poder
-- seguir el recorrido del Rider desde acá».
--
-- Y no volvía: `recoverCustomerTrackingAccess` descarta los pedidos terminales
-- y `unavailableTrackingOrderId` bloquea el reintento. Ni recargando.
--
-- POR QUÉ NO SE REVIERTE A LA VERSIÓN VIEJA
-- -----------------------------------------
-- La definición del 29/07 no conoce `captured_at`, ni las 4 decimales, ni el
-- orden por captura, que son las correcciones del 11/08 —las que arreglaron que
-- el marcador del rider caminara hacia atrás—. Así que la base de esta migración
-- es la definición VIGENTE y se le reponen tres cosas, verificado con diff:
--
--   1. la declaración de `v_terminal_visible_until`;
--   2. la condición terminal en el WHERE, para que la ventana vuelva a ACOTAR
--      el acceso: entregado se ve mientras dure, y deja de verse al vencer;
--   3. la lectura del token y la clave en el objeto de salida.
--
-- No se toca nada del rider_location, ni del ETA, ni de los grants.
--
-- ESTA MIGRACIÓN NO ES SUFICIENTE POR SÍ SOLA, Y ES A PROPÓSITO
-- ------------------------------------------------------------
-- El cliente se endureció en el mismo commit para que una ausencia futura de
-- esta clave DEGRADE en vez de borrar: ahora hace `stop()`, como con el resto
-- de los estados terminales, y `onUnavailable` queda reservado para lo que de
-- verdad significa (token revocado o vencido). Si esta migración nunca se
-- aplicara, el defecto visible ya no ocurre; lo que falta sin ella es la ventana
-- de visibilidad acotada del lado del servidor.
--
-- CÓMO SE REVIERTE
-- ----------------
-- Volver a aplicar la definición de 20260811020000. No hay cambio de esquema:
-- `order_public_tokens.terminal_visible_until` existe desde 20260729203000.
--
-- CÓMO SE COMPRUEBA QUE SIRVIÓ
-- ----------------------------
-- Con un pedido entregado y su token vigente, `get_public_order_tracking` tiene
-- que devolver `terminal_visible_until`; pasada esa marca, tiene que devolver
-- null (el pedido deja de ser visible), y antes de ella el cliente tiene que
-- seguir viendo su confirmación de entrega.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.get_public_order_tracking(p_public_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $tracking$
declare
  v_token_hash bytea := public.request_order_token_hash();
  v_order public.orders%rowtype;
  v_location jsonb;
  v_reliable_eta boolean := false;
  v_terminal_visible_until timestamptz;
begin
  if v_token_hash is null or btrim(coalesce(p_public_id, '')) = '' then return null; end if;
  select o.* into v_order
    from public.orders o join public.order_public_tokens opt on opt.order_id = o.id
   where (o.id::text = btrim(p_public_id) or o.public_code = btrim(p_public_id))
     and opt.token_hash = v_token_hash and opt.revoked_at is null and opt.expires_at > clock_timestamp()
     -- La ventana terminal vuelve a acotar el acceso: un pedido entregado o
     -- cancelado se sigue viendo mientras dure, y deja de verse cuando vence.
     and (
       o.status not in ('delivered', 'canceled', 'cancelled', 'rejected')
       or (opt.terminal_visible_until is not null and opt.terminal_visible_until > clock_timestamp())
     )
   limit 1;
  if not found then return null; end if;

  select opt.terminal_visible_until
    into v_terminal_visible_until
    from public.order_public_tokens opt
   where opt.order_id = v_order.id and opt.token_hash = v_token_hash
   limit 1;
  v_reliable_eta :=
    v_order.status not in ('delivered', 'canceled', 'cancelled', 'rejected')
    and v_order.estimated_arrival_source in ('business', 'routing')
    and v_order.estimated_arrival_updated_at >= clock_timestamp() - interval '15 minutes'
    and v_order.estimated_arrival_updated_at <= clock_timestamp() + interval '30 seconds'
    and v_order.estimated_arrival_at > clock_timestamp();
  if v_order.status in ('picked_up', 'on_the_way', 'arrived')
    and v_order.delivery_mode = 'delivery'
    and v_order.assigned_rider_user_id is not null then
    select jsonb_build_object(
        'lat', round(rl.lat::numeric, 4),
        'lng', round(rl.lng::numeric, 4),
        'accuracy', greatest(100, ceil(rl.accuracy))::integer,
        'source', 'gps',
        'created_at', rl.created_at,
        'captured_at', coalesce(rl.captured_at, rl.created_at))
      into v_location from public.rider_locations rl
     where rl.order_id = v_order.id and rl.rider_user_id = v_order.assigned_rider_user_id and rl.source = 'gps'
       and rl.accuracy between 0 and 250
       and coalesce(rl.captured_at, rl.created_at) >= clock_timestamp() - interval '3 minutes'
     order by coalesce(rl.captured_at, rl.created_at) desc, rl.receipt_sequence desc limit 1;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'public_code', v_order.public_code, 'delivery_mode', v_order.delivery_mode,
    'status', v_order.status, 'revision', v_order.revision,
    'created_at', v_order.created_at, 'updated_at', v_order.updated_at,
    'accepted_at', v_order.accepted_at, 'preparing_at', v_order.preparing_at,
    'ready_at', v_order.ready_at, 'dispatched_at', coalesce(v_order.dispatched_at, v_order.picked_up_at),
    'arrived_at', v_order.arrived_at, 'delivered_at', v_order.delivered_at,
    'cancelled_at', coalesce(v_order.cancelled_at, v_order.canceled_at),
    'rejected_at', v_order.rejected_at, 'is_delivered', v_order.status = 'delivered',
    -- La clave que el cliente necesita para saber CUÁNTO tiempo más puede ver
    -- su pedido entregado. Sin ella, el poll lo interpretaba como acceso
    -- revocado y le borraba la pantalla en el momento de la entrega.
    'terminal_visible_until', case
      when v_order.status in ('delivered', 'canceled', 'cancelled', 'rejected')
        then v_terminal_visible_until
      else null
    end,
    'estimated_arrival_at', case when v_reliable_eta then v_order.estimated_arrival_at else null end,
    'estimated_arrival_source', case when v_reliable_eta then v_order.estimated_arrival_source else null end,
    'estimated_arrival_updated_at', case when v_reliable_eta then v_order.estimated_arrival_updated_at else null end,
    'estimated_minutes', case when v_reliable_eta then greatest(1, ceil(extract(epoch from (v_order.estimated_arrival_at - clock_timestamp())) / 60.0))::integer else null end,
    'rider_location', v_location
  ));
end;
$tracking$;

revoke all on function public.get_public_order_tracking(text) from public;
grant execute on function public.get_public_order_tracking(text) to anon, authenticated;
