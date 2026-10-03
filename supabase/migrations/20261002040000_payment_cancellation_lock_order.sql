-- TABA · LOS ASIENTOS DE LA CANCELACIÓN DE UN COBRO TOMAN SUS CANDADOS EN EL ORDEN DE TODOS
--
-- ORDEN DE CANDADOS DE LAS FILAS DE UN COBRO (canónico; vale para toda función nueva)
--
--   1. la sesión de checkout          public.checkout_sessions
--   2. el cobro                       public.payment_intents
--   3. la fila hija                   public.payment_cancellations, public.payment_refunds,
--                                     public.payment_attempts
--
--   Quien necesita dos de esas filas las toma en ese orden; quien no necesita la sesión
--   empieza por el cobro. El inventario (productos por id, después las reservas de la
--   sesión) va siempre detrás de la sesión o del cobro. Es el orden que ya seguían el
--   asiento de un pago (`record_mercadopago_payment_snapshot`), la finalización, el
--   rearmado, la preferencia, el barrido de vencidos, `prepare_payment_cancellation` y los
--   asientos del reembolso. Cuando la llamada llega con el id de la fila hija, el id del
--   cobro y el de la sesión se leen SIN candado, se toman los candados en orden y se vuelve
--   a comprobar con las filas tomadas que esos ids no cambiaron (el mismo recurso del
--   snapshot y de `record_payment_refund_response_v2`).
--
-- QUÉ ESTABA ROTO (medido el 2026-10-02 y otra vez el 2026-10-03 sobre las 190 migraciones
-- anteriores, PostgreSQL 17 local con las dependencias de la plataforma simuladas, con
-- conexiones reales, una por llamada)
--
--   `record_payment_cancellation_response` tomaba solicitud -> cobro -> sesión (la sesión,
--   adentro de `release_checkout_session_inventory`) y `mark_payment_cancellation_ambiguous`
--   solicitud -> cobro. Con las llegadas en orden (una conexión retiene el cobro, las dos
--   llamadas llegan y recién entonces se suelta) el deadlock es seguro, 3 de 3:
--
--     · el dueño toca dos veces «cancelar» (`prepare_payment_cancellation`, cobro ->
--       solicitud) mientras se asienta la respuesta del proveedor: 40P01 al segundo, y
--       Postgres cortó a la respuesta. La solicitud quedó `requested`;
--     · la respuesta del proveedor contra el aviso de pago del mismo cobro
--       (`record_mercadopago_payment_snapshot`, sesión -> cobro): 40P01, cortó al aviso;
--     · el segundo toque del dueño contra la marca «dudosa»: 40P01, cortó a la marca. La
--       solicitud quedó `requested` y sin trabajo de conciliación.
--
--   Sin fijar las llegadas, cinco rondas de «respuesta de cancelación contra aviso de
--   aprobado» dieron entre 1 y 5 deadlocks por corrida.
--
--   Los datos quedan bien después de un reintento. El problema es quién reintenta: la
--   Edge Function `mercadopago-cancel-payment` contesta «no disponible» si no puede asentar
--   la respuesta, y no mira si pudo marcar la solicitud como dudosa. En los dos casos la
--   solicitud queda `requested` con el pago ya cancelado en Mercado Pago, y nada la concilia.
--
-- QUÉ CAMBIA
--
--   · `record_payment_cancellation_response`: sesión -> cobro -> solicitud.
--   · `mark_payment_cancellation_ambiguous`: cobro -> solicitud (no usa la sesión).
--   · Si entre la lectura sin candado y los candados la solicitud apuntara a otro cobro, o
--     el cobro a otra sesión, se rechaza con PT409 y no se escribe nada. Hoy ninguna función
--     cambia esas dos columnas: es la comprobación que hace válido leer sin candado.
--   Medido después: las tres sondas sin deadlock y la carrera completa con `DEADLOCKS: 0`.
--
-- QUÉ NO CAMBIA
--
--   Ninguna respuesta, ningún error, ningún efecto: los cuerpos son los vigentes
--   (20261001205000) letra por letra, generados de la definición viva, con ese único bloque
--   reemplazado en cada uno. Firma, SECURITY DEFINER, `search_path` y permisos (sólo
--   `service_role`). `prepare_payment_cancellation` y `release_checkout_session_inventory`
--   no se tocan. Una respuesta que no libera stock (`rejected`, `ambiguous`, `failed`)
--   ahora también espera a quien tenga tomada la sesión (el barrido, la preferencia, el
--   aviso de pago); casi todos ellos toman además el cobro, al que ya esperaba.
--
-- QUÉ QUEDA AFUERA (medido e informado; no son funciones de este paquete)
--
--   · La Edge Function sigue contestando «no disponible»: con el orden corregido deja de
--     perder contra un deadlock, pero un corte de red al asentar todavía deja la solicitud
--     `requested`. El cambio que le falta está descrito en el informe del paquete.
--   · `record_mercadopago_preference_uncertain` toma intento -> cobro, al revés que la
--     preferencia (sesión -> cobro -> intento): cruzada con volver a pedir o con asentar la
--     preferencia del mismo intento, 40P01.
--   · Las dos versiones legadas que el contrato A1-A4 retira
--     (`record_mercadopago_preference_created`, `record_payment_refund_response`) conservan
--     su orden viejo (intento -> cobro -> sesión; reembolso -> cobro) donde sigan vivas.
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261002040000_payment_cancellation_lock_order.rollback.sql

-- ── 1. Asentar la respuesta de una cancelación ──────────────────────────────
CREATE OR REPLACE FUNCTION public.record_payment_cancellation_response(p_cancellation_id uuid, p_status text, p_response_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_cancellation public.payment_cancellations%rowtype; v_intent public.payment_intents%rowtype;
  v_intent_id uuid; v_session_id uuid;
begin
  -- Sin estado no hay respuesta que asentar. Antes lo frenaba el NOT NULL de la
  -- columna; con el retorno idempotente de abajo un NULL habría pasado por confirmado.
  if p_status is null or p_status not in ('cancelled', 'rejected', 'ambiguous', 'failed') or p_response_hash !~ '^[a-f0-9]{64}$' then raise exception 'respuesta de cancelacion invalida' using errcode = '22023'; end if;
  -- Candados en el orden de todo lo que toca un cobro: sesión -> cobro -> solicitud.
  -- Antes eran solicitud -> cobro -> sesión, y esta llamada cruzada con el asiento de un
  -- pago (sesión -> cobro) o con un segundo pedido de cancelación (cobro -> solicitud)
  -- terminaba en deadlock. Los dos ids se leen sin candado, que es lo que permite tomar
  -- primero la sesión; después se comprueba, con las filas ya tomadas, que siguen siendo
  -- los de esta solicitud.
  select c.payment_intent_id into v_intent_id from public.payment_cancellations c where c.id = p_cancellation_id;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  select pi.checkout_session_id into v_session_id from public.payment_intents pi where pi.id = v_intent_id;
  perform 1 from public.checkout_sessions s where s.id = v_session_id for update;
  select * into v_intent from public.payment_intents pi where pi.id = v_intent_id for update;
  select * into v_cancellation from public.payment_cancellations c where c.id = p_cancellation_id for update;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  if v_cancellation.payment_intent_id is distinct from v_intent_id
    or v_intent.checkout_session_id is distinct from v_session_id then
    raise exception 'la cancelacion cambio de cobro o de checkout mientras se asentaba' using errcode = 'PT409';
  end if;
  if v_cancellation.status in ('cancelled', 'rejected') then
    if v_cancellation.status <> p_status then
      raise exception 'resultado de cancelacion ya confirmado' using errcode = '55000';
    end if;
    return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'idempotent', true);
  end if;
  if v_cancellation.status = p_status and v_cancellation.raw_response_hash = p_response_hash then
    return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'idempotent', true);
  end if;
  update public.payment_cancellations set status = p_status, raw_response_hash = p_response_hash,
    completed_at = case when p_status in ('cancelled', 'rejected') then clock_timestamp() else completed_at end where id = v_cancellation.id;
  if p_status = 'cancelled' then
    update public.payment_intents set internal_status = case when public.payment_internal_status_rank(internal_status) < public.payment_internal_status_rank('cancelled') then 'cancelled' else internal_status end where id = v_intent.id;
    perform public.release_checkout_session_inventory(v_intent.checkout_session_id, 'owner_cancelled_payment', 'cancelled');
  end if;
  insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash) values (v_intent.id, 'payment.cancellation_' || p_status, jsonb_build_object('cancellation_id', v_cancellation.id), p_response_hash);
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'idempotent', false);
end;
$function$;

revoke all on function public.record_payment_cancellation_response(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_payment_cancellation_response(uuid, text, text) to service_role;

-- ── 2. Marcar dudosa una cancelación ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_payment_cancellation_ambiguous(p_cancellation_id uuid, p_request_hash text, p_error_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_cancellation public.payment_cancellations%rowtype; v_intent public.payment_intents%rowtype;
  v_intent_id uuid;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  -- Cobro -> solicitud, el orden de prepare_payment_cancellation. Al revés, esta marca y
  -- un segundo pedido de cancelación del mismo cobro terminaban en deadlock. No toca la
  -- sesión, así que no la toma. El id del cobro se lee sin candado y se comprueba después.
  select c.payment_intent_id into v_intent_id from public.payment_cancellations c where c.id = p_cancellation_id;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_intent_id for share;
  select * into v_cancellation from public.payment_cancellations c where c.id = p_cancellation_id for update;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  if v_cancellation.payment_intent_id is distinct from v_intent_id then
    raise exception 'la cancelacion cambio de cobro mientras se marcaba' using errcode = 'PT409';
  end if;
  -- Lo que el proveedor ya confirmó no vuelve a estar en duda.
  if v_cancellation.status in ('cancelled', 'rejected') then return true; end if;
  update public.payment_cancellations set status = 'ambiguous', raw_response_hash = p_request_hash where id = v_cancellation.id;
  if not exists (
    select 1 from public.payment_outbox o
     where o.cancellation_id = v_cancellation.id and o.topic = 'cancellation_reconcile'
       and o.status in ('pending', 'claimed', 'processing', 'retry_wait')
  ) then
    insert into public.payment_outbox (payment_intent_id, cancellation_id, topic, resource_id, last_error)
    values (v_cancellation.payment_intent_id, v_cancellation.id, 'cancellation_reconcile', v_intent.provider_payment_id, left(coalesce(p_error_code, 'network_or_timeout'), 160));
  end if;
  return true;
end;
$function$;

revoke all on function public.mark_payment_cancellation_ambiguous(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_payment_cancellation_ambiguous(uuid, text, text) to service_role;
