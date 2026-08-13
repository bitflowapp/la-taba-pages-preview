-- ═══════════════════════════════════════════════════════════════════════════
-- EL SERVIDOR DICE QUÉ TAN BUENO ES EL FIX, EN VEZ DE DEJAR QUE EL CLIENTE LO
-- ADIVINE SOBRE UN NÚMERO QUE ÉL MISMO DEGRADÓ  (F26 + F36)
--
-- ESTADO: PREPARADA, NO APLICADA.
--
-- QUÉ ESTABA MAL
-- --------------
-- `get_public_order_tracking` publica la precisión así:
--
--     'accuracy', greatest(100, ceil(rl.accuracy))::integer
--
-- Ese 100 es un PISO DE PRIVACIDAD deliberado, no una medición: el modelo de
-- amenazas (docs/security/public-tracking-threat-model.md) dice explícitamente
-- que se informa «dónde, más o menos» sin decir «con cuánta certeza lo
-- sabemos». Un fix de 8 m y uno de 95 m salen los dos como 100.
--
-- Del otro lado, `js/map/tracking_status.js` llama «Señal GPS débil» a todo lo
-- que supere `WEAK_SIGNAL_ACCURACY_METERS` = `GPS_GOOD_ACCURACY_METERS` = 80 m.
--
-- Como 100 > 80, la rama WEAK se cumple SIEMPRE. Con el contrato público real,
-- «Ubicación en vivo» es inalcanzable: ningún cliente la vio nunca. La suite no
-- lo detectaba porque cada fixture siembra `accuracy: 12`, un valor que el
-- contrato público no puede emitir jamás.
--
-- F36 comparte la raíz: la función mete en un mismo `null` tres situaciones que
-- para el cliente son distintas —no hay rider asignado, el rider todavía no
-- publicó, o el último fix envejeció— porque el filtro de frescura descarta la
-- fila antes de que nadie pueda distinguirlas.
--
-- QUÉ CAMBIA, Y NADA MÁS
-- ----------------------
-- Se agrega UNA clave al objeto de salida: `location_quality`, decidida por el
-- servidor sobre el dato ORIGINAL (la accuracy y el `captured_at` reales, antes
-- de cualquier degradado), con cuatro estados:
--
--     valid          fix fresco y con accuracy original <= 80 m
--     low_accuracy   fix fresco, pero accuracy original > 80 m
--     stale          hay fix, pero es más viejo que la ventana de 3 minutos
--     unavailable    no hay rider asignado, no es delivery, el pedido no está
--                    en una etapa con seguimiento, o no hay ningún fix usable
--
-- La clave viaja SIEMPRE (nunca null), así que `jsonb_strip_nulls` no la borra
-- y el cliente puede distinguir «no disponible» de «no lo dijo el servidor».
--
-- LO QUE NO CAMBIA, Y ES EL PUNTO
-- -------------------------------
-- Las coordenadas y la precisión públicas salen EXACTAMENTE igual que antes:
-- `round(lat,4)`, `round(lng,4)`, `greatest(100, ceil(accuracy))`, y sólo
-- cuando el fix está fresco. No se sube la resolución de nada.
--
-- POR QUÉ ESTO NO AFLOJA LA PRIVACIDAD
-- ------------------------------------
-- Hoy el cliente ya distingue dos casos por el número: si recibe 100, sabe que
-- el original era <= 100; si recibe 240, sabe que era 240. Lo único que agrega
-- `location_quality` es partir ese primer tramo en <= 80 y (80, 100]. Es un bit
-- de un balde grueso: no revela la accuracy exacta, no mueve lat/lng ni un
-- decimal, y no expone `heading`, `speed` ni `receipt_sequence`, que siguen
-- retenidos a propósito. El umbral 80 no es inventado: es la constante que la
-- app ya usaba para decidir «buena señal», ahora evaluada sobre el dato real en
-- vez de sobre el degradado.
--
-- UNA SOLA CONSULTA, Y ES EQUIVALENTE
-- -----------------------------------
-- Antes se filtraba por (accuracy en rango AND fresco) y se tomaba la primera.
-- Ahora se filtra por (accuracy en rango), se toma la primera y RECIÉN AHÍ se
-- mira la frescura. Da lo mismo: si el fix más nuevo del rango está vencido,
-- todos los anteriores lo están más, así que la versión vieja tampoco devolvía
-- fila. La diferencia es que ahora, en ese caso, podemos decir `stale` en lugar
-- de callar.
--
-- SE PRESERVA TODO LO DE F25
-- --------------------------
-- Esta migración parte de la definición VIVA de staging (la que dejó
-- 20260813030000, verificada con pg_get_functiondef antes de escribir esto), no
-- de una versión histórica. Siguen intactos: `terminal_visible_until` en la
-- ventana y en la salida, `captured_at`, el redondeo a 4 decimales, el orden
-- por captura y `receipt_sequence desc`, el contrato de rider asignado, el ETA
-- confiable y los grants.
--
-- CÓMO SE REVIERTE
-- ----------------
-- Volver a aplicar la definición de 20260813030000. No hay cambio de esquema.
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
  -- El fix ORIGINAL, sin degradar: es sobre esto que se decide la calidad.
  v_fix_accuracy double precision;
  v_fix_at timestamptz;
  v_tracking_stage boolean := false;
  v_location_quality text := 'unavailable';
  -- Un solo corte de frescura para la publicación y para la calidad, así no
  -- pueden discrepar por los microsegundos que avanza clock_timestamp().
  v_fresh_cutoff timestamptz;
  -- La misma ventana que ya gobernaba la publicación del punto.
  c_max_age constant interval := interval '3 minutes';
  -- La misma constante que la app ya llamaba «buena señal» (GPS_GOOD_ACCURACY_METERS).
  c_good_accuracy constant double precision := 80;
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

  v_tracking_stage :=
    v_order.status in ('picked_up', 'on_the_way', 'arrived')
    and v_order.delivery_mode = 'delivery'
    and v_order.assigned_rider_user_id is not null;

  if v_tracking_stage then
    v_fresh_cutoff := clock_timestamp() - c_max_age;
    -- La fila se busca SIN el filtro de frescura, a propósito: es lo que permite
    -- separar «no hay fix» de «el fix envejeció». Un fix con accuracy NULL o
    -- fuera de [0,250] sigue sin ser publicable y tampoco sostiene una
    -- afirmación de calidad, así que queda excluido acá y el estado cae en
    -- `unavailable`: falla cerrado.
    --
    -- El punto se arma en el mismo SELECT y sólo si está fresco: así las
    -- expresiones de degradado siguen siendo exactamente las de antes —mismo
    -- redondeo, mismo piso, mismo `captured_at`— y un fix `stale` informa su
    -- estado sin entregar coordenadas viejas.
    select
        case
          when coalesce(rl.captured_at, rl.created_at) >= v_fresh_cutoff
          then jsonb_build_object(
            'lat', round(rl.lat::numeric, 4),
            'lng', round(rl.lng::numeric, 4),
            'accuracy', greatest(100, ceil(rl.accuracy))::integer,
            'source', 'gps',
            'created_at', rl.created_at,
            'captured_at', coalesce(rl.captured_at, rl.created_at))
        end,
        rl.accuracy,
        coalesce(rl.captured_at, rl.created_at)
      into v_location, v_fix_accuracy, v_fix_at
      from public.rider_locations rl
     where rl.order_id = v_order.id
       and rl.rider_user_id = v_order.assigned_rider_user_id
       and rl.source = 'gps'
       and rl.accuracy between 0 and 250
     order by coalesce(rl.captured_at, rl.created_at) desc, rl.receipt_sequence desc
     limit 1;

    if found then
      if v_fix_at < v_fresh_cutoff then
        v_location_quality := 'stale';
      elsif v_fix_accuracy <= c_good_accuracy then
        v_location_quality := 'valid';
      else
        v_location_quality := 'low_accuracy';
      end if;
    end if;
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
    -- LA CLAVE NUEVA. El servidor es la autoridad sobre la calidad del fix
    -- original; el cliente ya no tiene que deducirla del número degradado.
    -- Nunca es null, así que jsonb_strip_nulls no la borra y su ausencia
    -- significa inequívocamente «servidor viejo».
    'location_quality', v_location_quality,
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

comment on function public.get_public_order_tracking(text) is
  'Seguimiento público del pedido. Publica location_quality (valid/low_accuracy/stale/unavailable) decidida sobre la accuracy y el captured_at ORIGINALES; las coordenadas siguen degradadas a 4 decimales y la precisión con piso de 100 m.';
