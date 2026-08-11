-- El seguimiento publico elegia «la ultima ubicacion» por hora de LLEGADA al
-- servidor, teniendo en la misma fila la hora de CAPTURA del dispositivo y un
-- contador monotono de recibo.
--
-- Por que importa, medido sobre un recorrido fisico real (85 fixes, 931 m):
-- la latencia de publicacion tuvo mediana 390 ms y maxima 26.683 ms, y el hueco
-- mas chico entre dos capturas fue 5.044 ms. O sea que basta una demora de 5 s
-- en una publicacion para que el fix ANTERIOR llegue despues, gane el
-- `order by created_at desc`, y se entregue al cliente como «el mas nuevo» con
-- un timestamp mas nuevo. El cliente lo acepta -su guardia de retroceso mira el
-- timestamp, y ese timestamp de verdad es mas nuevo- y el marcador se va
-- caminando hacia atras, a una posicion donde el rider ya no esta.
--
-- Esta migracion hace canonico el orden de CAPTURA y se lo cuenta al cliente:
--
--   * el `order by` pasa a ser captured_at, con receipt_sequence como desempate
--     (monotono por definicion, asi que dos capturas del mismo milisegundo
--     siguen teniendo un orden total);
--   * la ventana de frescura se mide sobre la captura, no sobre la llegada: un
--     fix capturado hace cinco minutos que recien llega NO es una ubicacion
--     actual, por mas que su fila sea nueva;
--   * el DTO agrega `captured_at`. No es una clase de dato nueva: ya viajaba
--     `created_at`, que es el mismo hecho 390 ms despues. `receipt_sequence`
--     NO se expone: es un contador global del negocio y diria cuantos fixes
--     publica, que es justo lo que el modelo de amenaza quiere callar.
--
-- Y hace una segunda cosa, esta vez con autorizacion expresa de quien tomo la
-- decision de privacidad original: la coordenada publica pasa de TRES a CUATRO
-- decimales.
--
-- Por que hacia falta, medido sobre el mismo recorrido: con tres decimales la
-- grilla es de ~111 m, y el cliente que siguio 931 m de caminata vio CUATRO
-- posiciones distintas. El marcador saltaba de a 86-141 m donde el rider habia
-- caminado 7-177 m, y volvia a una celda que ya habia dejado 80 veces. El motor
-- visual anima cada uno de esos rebotes, y eso es lo que se lee como «el rider
-- vuelve al principio y repite las calles». Ninguna regla de ordenamiento
-- arregla eso: la posicion vieja llegaba puntual y bien ordenada, sencillamente
-- estaba cuantizada.
--
--   decimales | posiciones visibles | error mediano | error maximo
--       3     |          4          |    28,0 m     |    66,0 m
--       4     |         17          |     2,4 m     |     6,2 m
--       5     |         50          |     0,4 m     |     0,7 m
--
-- Cuatro decimales dejan el error de redondeo (2,4 m) POR DEBAJO de la
-- precision real del GPS medida en ese mismo recorrido (mediana 12,1 m), asi
-- que la coordenada publica no afirma nada que el circulo de precision no
-- afirme ya. La documentacion de privacidad se actualizo en el mismo cambio:
-- docs/security/public-tracking-threat-model.md y
-- docs/final-commercial-release/tracking-security-review.md.
--
-- Lo que esta migracion NO toca, a proposito: el piso de 100 m con que se
-- informa la precision. Sigue siendo deliberado -decir «donde, mas o menos» sin
-- decir «con cuanta certeza lo sabemos»- y no estaba en el alcance autorizado.

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
begin
  if v_token_hash is null or btrim(coalesce(p_public_id, '')) = '' then return null; end if;
  select o.* into v_order
    from public.orders o join public.order_public_tokens opt on opt.order_id = o.id
   where (o.id::text = btrim(p_public_id) or o.public_code = btrim(p_public_id))
     and opt.token_hash = v_token_hash and opt.revoked_at is null and opt.expires_at > clock_timestamp()
   limit 1;
  if not found then return null; end if;
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
