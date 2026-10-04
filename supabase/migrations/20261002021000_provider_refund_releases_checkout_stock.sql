-- TABA · SI EL PROVEEDOR INFORMA EL DINERO DEVUELTO Y NO HAY PEDIDO, EL STOCK VUELVE SOLO
--
-- QUÉ ESTABA ROTO (medido el 2026-10-02 sobre las 190 migraciones de la rama; stock
-- 10, compra de 3, cobro aprobado y sin pedido)
--
--   1. Cobro en revisión manual, y la devolución se hace en Mercado Pago (o llega un
--      contracargo). El aviso se asienta —`refunded`, 3000 devueltos— y el stock
--      queda en 7 con la reserva `active`. Desde ahí el comercio no tiene salida:
--      rearmar el pedido se niega (55000, «no tiene un cobro aprobado y
--      verificado»), el reembolso del Panel se niega (22023, no queda saldo) y la
--      alerta receta
--      `release_manual_review_checkout_inventory`, que sólo ejecuta la clave de
--      servicio. Cuando el reembolso lo aprueba el Panel, en cambio, esa misma
--      liberación corre sola (20261001203000).
--   2. Cobro aprobado a tiempo que todavía no se finalizó (sesión `payment_approved`)
--      y el proveedor informa el dinero devuelto. La finalización se niega («pago no
--      aprobado verificadamente»), el barrido saltea ese estado, la liberación de
--      revisión contesta `not_in_manual_review` aun con la clave de servicio, y la
--      alerta receta rearmar un pedido que ya no se puede rearmar. Stock 7, para
--      siempre, sin ninguna salida. Es el camino natural de quien atiende la alerta
--      «pago aprobado sin pedido» devolviendo el dinero desde Mercado Pago.
--
-- QUÉ CAMBIA
--
--   Un bloque al final de `record_mercadopago_payment_snapshot`. Cuando un snapshot
--   VÁLIDO del pago de este cobro dice que TODO el importe volvió (`refunded`,
--   `charged_back`, o `approved` con lo devuelto igual al total), no hay pedido, y la
--   sesión está en revisión manual o pagada sin finalizar:
--     · la sesión pagada sin finalizar pasa a revisión manual con el motivo
--       `money_returned_before_order` (ya no puede terminar en un pedido, y ese
--       estado es el que impide pedir otra preferencia sobre dinero devuelto);
--     · se llama a `release_manual_review_checkout_inventory`, la misma función del
--       reembolso propio. Ella decide si corresponde (sin pedido, en revisión, dinero
--       afuera), devuelve stock y disponibilidad con la expresión de siempre, deja un
--       solo evento `payment.manual_review_stock_released` y no libera dos veces.
--   El resto de la función es su definición vigente (20261001200000), generada de la
--   definición viva con esa única inserción, contada.
--
-- QUÉ NO CAMBIA
--
--   · Una devolución PARCIAL no libera nada. Un cobro CON pedido tampoco: ese stock
--     lo decide la cancelación del pedido.
--   · Un pago que el proveedor cerró sin haberlo aprobado nunca (rechazado,
--     cancelado o vencido) sobre una sesión en revisión NO libera solo: de ese cobro
--     no hay importe que haya vuelto, y la revisión pudo nacer de OTRO pago que no se
--     pudo validar. Sigue siendo de soporte, con la liberación del servicio.
--   · Un pago que estuvo aprobado y después figura cancelado, sin importe devuelto,
--     tampoco: la base no da ese dinero por devuelto (ni acá ni en la liberación del
--     servicio, que para eso pide la atestación de soporte).
--   · Un snapshot que no pasa las verificaciones (otro importe, otra cuenta, otra
--     referencia) sale antes y no libera nada, diga lo que diga del dinero.
--   · Un segundo pago sobre un cobro que ya tiene el suyo sale antes, como siempre.
--   · `release_manual_review_checkout_inventory`, el orden de los candados (sesión,
--     cobro, productos), la firma, SECURITY DEFINER, `search_path` y los permisos.
--   · No toca filas. Una sesión en revisión que ya esté en ese estado se libera con
--     el próximo aviso de ese pago o con la liberación del servicio. Una sesión
--     pagada sin finalizar cuyo dinero ya figure devuelto ANTES de aplicar esto sólo
--     sale con un aviso nuevo de ese pago: la consulta que las lista está en las
--     notas del paquete (hoy no hay ninguna: ningún pago aprobado pasó todavía por
--     esta arquitectura).
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261002021000_provider_refund_releases_checkout_stock.rollback.sql

CREATE OR REPLACE FUNCTION public.record_mercadopago_payment_snapshot(p_payment_intent_id uuid, p_snapshot jsonb, p_source text, p_webhook_receipt_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_intent public.payment_intents%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_session_id uuid;
  v_status text;
  v_next text;
  v_effective text;
  v_amount numeric(12,2);
  v_refunded numeric(12,2);
  v_currency text;
  v_provider_time timestamptz;
  v_valid boolean := true;
  v_reason text;
  v_finalize boolean := false;
  v_payment_id text;
  v_hash text;
  v_other_payment boolean := false;
  v_pinned boolean := false;
  v_takeover boolean := false;
  v_replay boolean := false;
  v_receipt_types text[] := '{}'::text[];
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
    or coalesce(p_snapshot ->> 'raw_response_hash', '') !~ '^[a-f0-9]{64}$' then
    raise exception 'snapshot de pago invalido' using errcode = '22023';
  end if;
  -- Sesion primero, intent despues: el mismo orden que finalize, recover, prepare
  -- y el barrido. El id de la sesion se lee sin lock porque un intent no cambia
  -- de checkout; si alguna vez cambiara entre las dos lecturas, se rechaza.
  select pi.checkout_session_id into v_session_id from public.payment_intents pi where pi.id = p_payment_intent_id;
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  select * into v_session from public.checkout_sessions s where s.id = v_session_id for update;
  select * into v_intent from public.payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  if v_intent.checkout_session_id is distinct from v_session.id then
    raise exception 'el payment intent cambio de checkout durante el snapshot' using errcode = 'PT409';
  end if;
  select * into v_settings from public.business_payment_settings ps where ps.business_id = v_intent.business_id and ps.provider = 'mercadopago' for share;
  -- Tipos de evento que este recibo ya dejo en este intent. La clave unica es
  -- (intent, recibo, tipo): el recibo se ata al primer evento de cada tipo y lo
  -- que el mismo recibo traiga despues se escribe sin recibo. Con DO NOTHING a
  -- secas ese segundo evento se perdia, y sin su fila el mismo snapshot no se
  -- reconocia como ya registrado en el reintento siguiente.
  if p_webhook_receipt_id is not null then
    select coalesce(array_agg(pe.event_type), '{}'::text[]) into v_receipt_types
      from public.payment_events pe
     where pe.payment_intent_id = v_intent.id and pe.webhook_receipt_id = p_webhook_receipt_id;
  end if;
  v_status := lower(btrim(coalesce(p_snapshot ->> 'status', '')));
  v_currency := upper(btrim(coalesce(p_snapshot ->> 'currency', '')));
  v_amount := nullif(p_snapshot ->> 'transaction_amount', '')::numeric(12,2);
  v_refunded := coalesce(nullif(p_snapshot ->> 'refunded_amount', '')::numeric(12,2), 0);
  v_payment_id := p_snapshot ->> 'provider_payment_id';
  v_hash := p_snapshot ->> 'raw_response_hash';
  begin
    v_provider_time := coalesce(nullif(p_snapshot ->> 'provider_occurred_at', '')::timestamptz, clock_timestamp());
  exception when others then
    v_provider_time := clock_timestamp();
  end;
  if nullif(btrim(coalesce(p_snapshot ->> 'provider_payment_id', '')), '') is null then
    v_valid := false; v_reason := 'payment_id_missing';
  elsif p_snapshot ->> 'external_reference' is distinct from v_intent.external_reference then
    v_valid := false; v_reason := 'external_reference_mismatch';
  -- La preferencia de un intento anterior de ESTE intent tambien es nuestra: la
  -- creo el backend para este mismo checkout y este mismo importe. Sin esto, el
  -- pago rechazado del primer intento -que el proveedor sigue devolviendo-
  -- mandaba a revision el reintento que el cliente acababa de pedir.
  elsif nullif(btrim(coalesce(v_intent.preference_id, '')), '') is not null
    and nullif(btrim(coalesce(p_snapshot ->> 'preference_id', '')), '') is distinct from v_intent.preference_id
    and not exists (
      select 1 from public.payment_attempts pa
       where pa.payment_intent_id = v_intent.id
         and pa.attempt_type = 'preference'
         and pa.preference_id = nullif(btrim(coalesce(p_snapshot ->> 'preference_id', '')), '')
    ) then
    v_valid := false; v_reason := 'preference_mismatch';
  elsif v_settings.collector_id is null or p_snapshot ->> 'collector_id' is distinct from v_settings.collector_id then
    v_valid := false; v_reason := 'collector_mismatch';
  -- Mercado Pago exposes no application_id on payments or merchant orders, so
  -- the assertion runs only when the provider actually supplies one. collector_id
  -- stays mandatory and is what pins a payment to the configured account.
  elsif nullif(btrim(coalesce(p_snapshot ->> 'application_id', '')), '') is not null
    and p_snapshot ->> 'application_id' is distinct from coalesce(v_settings.application_id, '') then
    v_valid := false; v_reason := 'application_mismatch';
  elsif v_currency <> 'ARS' or v_currency <> v_intent.currency then
    v_valid := false; v_reason := 'currency_mismatch';
  elsif v_amount is null or v_amount <> v_intent.expected_amount then
    v_valid := false; v_reason := 'amount_mismatch';
  -- Checkout Pro test credentials are a Mercado Pago sandbox test user whose
  -- payments report live_mode = true, so equality with the environment can only
  -- be demanded in production. In test the collector_id assertion above already
  -- pins the payment to the sandbox user, which cannot move real money.
  elsif v_intent.environment = 'production'
    and coalesce((p_snapshot ->> 'live_mode')::boolean, false) is not true then
    v_valid := false; v_reason := 'live_mode_mismatch';
  elsif v_status not in ('approved', 'pending', 'in_process', 'authorized', 'rejected', 'cancelled', 'canceled', 'expired', 'refunded', 'charged_back') then
    v_valid := false; v_reason := 'unknown_provider_status';
  end if;
  if not v_valid then
    -- `completed` es terminal. Con el pedido ya creado, un snapshot que no pasa la
    -- validacion no puede reabrir nada: bajaria el pago del pedido a «pendiente» y
    -- cerraria el reembolso y la cancelacion justo cuando hacen falta. Queda el
    -- evento, que es la senal para operaciones.
    if v_session.status = 'completed' or v_session.completed_order_id is not null or v_intent.order_id is not null then
      insert into public.payment_events (payment_intent_id, webhook_receipt_id, provider_event_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
      select v_intent.id, case when 'payment.post_completion_anomaly' = any(v_receipt_types) then null else p_webhook_receipt_id end,
        nullif(btrim(coalesce(v_payment_id, '')), ''), 'payment.post_completion_anomaly', v_status,
        nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, v_hash,
        jsonb_build_object('reason', v_reason, 'source', p_source, 'operational_review_required', true)
       where not exists (
         select 1 from public.payment_events pe
          where pe.payment_intent_id = v_intent.id
            and pe.event_type = 'payment.post_completion_anomaly'
            and pe.raw_response_hash = v_hash
            and pe.details ->> 'reason' = v_reason
       )
      on conflict (payment_intent_id, webhook_receipt_id, event_type) do nothing;
      return jsonb_build_object('ok', false, 'manual_review_required', false, 'reason', v_reason, 'finalize_required', false,
        'post_completion', true, 'operational_review_required', true);
    end if;
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = v_reason,
      raw_response_hash = p_snapshot ->> 'raw_response_hash' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = v_reason where id = v_session.id and status <> 'completed';
    insert into public.payment_events (payment_intent_id, webhook_receipt_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
    values (v_intent.id, p_webhook_receipt_id, 'payment.security_review_required', v_status,
      nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, p_snapshot ->> 'raw_response_hash', jsonb_build_object('reason', v_reason, 'source', p_source))
    on conflict (payment_intent_id, webhook_receipt_id, event_type) do nothing;
    return jsonb_build_object('ok', false, 'manual_review_required', true, 'reason', v_reason, 'finalize_required', false);
  end if;
  v_next := case v_status
    when 'approved' then case when v_refunded >= v_amount then 'refunded' when v_refunded > 0 then 'partially_refunded' else 'approved_order_pending' end
    when 'pending' then 'pending'
    when 'in_process' then 'in_process'
    when 'authorized' then 'in_process'
    when 'rejected' then 'rejected'
    when 'cancelled' then 'cancelled'
    when 'canceled' then 'cancelled'
    when 'expired' then 'expired'
    when 'refunded' then 'refunded'
    when 'charged_back' then 'charged_back'
    else 'ambiguous'
  end;
  -- Identidad del pago. El intent guarda UN pago del proveedor.
  --   v_other_payment  el snapshot habla de un pago distinto del guardado
  --   v_pinned         el intent ya tiene un pago aprobado: su identidad no se pisa
  --   v_replay         este mismo pago, estado y respuesta ya quedaron registrados
  -- El pago guardado tiene que ser el que cobro (`approved`, o lo que le sigue:
  -- `refunded`, `charged_back`). Una fila anterior a esta migracion puede haber
  -- quedado apuntando a un rechazado posterior; esa no se fija, y el proximo
  -- snapshot del pago real vuelve a tomar la identidad como siempre.
  v_other_payment := v_intent.provider_payment_id is not null and v_intent.provider_payment_id <> v_payment_id;
  v_pinned := coalesce(
    (v_intent.approved_at is not null
      or v_intent.internal_status in ('approved', 'approved_order_pending', 'completed', 'partially_refunded', 'refunded', 'charged_back'))
    and v_intent.provider_status in ('approved', 'refunded', 'charged_back'),
    false);
  v_replay := exists (
    select 1 from public.payment_events pe
     where pe.payment_intent_id = v_intent.id
       and pe.provider_event_id = v_payment_id
       and pe.provider_status = v_status
       and pe.raw_response_hash = v_hash
       and pe.event_type in ('payment.' || v_status, 'payment.duplicate_approved', 'payment.secondary_payment')
  );
  if v_other_payment and v_pinned then
    -- Otro pago sobre un intent que ya cobro. Si esta aprobado es un cobro
    -- duplicado: el dinero entro dos veces y alguien tiene que devolverlo. No se
    -- fusiona ni se pisa nada; el pago original sigue siendo el del pedido.
    if not v_replay then
      insert into public.payment_events (payment_intent_id, webhook_receipt_id, provider_event_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
      values (v_intent.id,
        case when (case when v_status = 'approved' then 'payment.duplicate_approved' else 'payment.secondary_payment' end) = any(v_receipt_types)
          then null else p_webhook_receipt_id end,
        v_payment_id,
        case when v_status = 'approved' then 'payment.duplicate_approved' else 'payment.secondary_payment' end,
        v_status, nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, v_hash,
        -- Lo que falta devolver es lo que hay que revisar: un duplicado que ya
        -- llega devuelto entero queda en la traza sin pedir otra devolucion.
        jsonb_build_object('source', p_source, 'pinned_provider_payment_id', v_intent.provider_payment_id,
          'amount', v_amount, 'refunded_amount', v_refunded,
          'refund_review_required', v_status = 'approved' and v_refunded < v_amount))
      on conflict (payment_intent_id, webhook_receipt_id, event_type) do nothing;
    end if;
    return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'internal_status', v_intent.internal_status,
      'manual_review_required', false, 'finalize_required', false,
      'secondary_payment', true, 'duplicate_approved', v_status = 'approved',
      'refund_review_required', v_status = 'approved' and v_refunded < v_amount);
  end if;
  -- Sin pago aprobado todavia, el primer `approved` se queda con la identidad
  -- aunque su fecha sea anterior a la del pago guardado (un rechazado o un
  -- pendiente mas nuevo no puede dejar el estado del proveedor en otra cosa).
  v_takeover := v_other_payment and v_status = 'approved';
  v_effective := case
    when v_replay then v_intent.internal_status
    when public.payment_internal_status_rank(v_next) >= public.payment_internal_status_rank(v_intent.internal_status) then v_next
    else v_intent.internal_status end;
  if not v_replay then
    update public.payment_intents set
      provider_payment_id = case when v_takeover or provider_event_at is null or v_provider_time >= provider_event_at then p_snapshot ->> 'provider_payment_id' else provider_payment_id end,
      provider_merchant_order_id = case when v_takeover or provider_event_at is null or v_provider_time >= provider_event_at then nullif(p_snapshot ->> 'merchant_order_id', '') else provider_merchant_order_id end,
      provider_status = case when v_takeover or provider_event_at is null or v_provider_time >= provider_event_at then v_status else provider_status end,
      provider_status_detail = case when v_takeover or provider_event_at is null or v_provider_time >= provider_event_at then nullif(p_snapshot ->> 'status_detail', '') else provider_status_detail end,
      provider_payment_method = case when v_takeover or provider_event_at is null or v_provider_time >= provider_event_at then nullif(p_snapshot ->> 'payment_method', '') else provider_payment_method end,
      provider_event_at = case when v_takeover then v_provider_time else greatest(coalesce(provider_event_at, '-infinity'::timestamptz), v_provider_time) end,
      paid_amount = case when v_status = 'approved' then v_amount else paid_amount end,
      payer_email_hash = nullif(p_snapshot ->> 'payer_email_hash', ''), live_mode = (p_snapshot ->> 'live_mode')::boolean,
      approved_at = case when v_status = 'approved' then coalesce(approved_at, v_provider_time) else approved_at end,
      rejected_at = case when v_status in ('rejected', 'cancelled', 'canceled', 'expired') then coalesce(rejected_at, v_provider_time) else rejected_at end,
      refunded_amount = greatest(refunded_amount, v_refunded), internal_status = v_effective,
      raw_response_hash = p_snapshot ->> 'raw_response_hash'
    where id = v_intent.id;
    insert into public.payment_events (payment_intent_id, webhook_receipt_id, provider_event_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
    values (v_intent.id, case when ('payment.' || v_status) = any(v_receipt_types) then null else p_webhook_receipt_id end,
      p_snapshot ->> 'provider_payment_id', 'payment.' || v_status,
      v_status, nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, p_snapshot ->> 'raw_response_hash', jsonb_build_object('source', p_source))
    on conflict (payment_intent_id, webhook_receipt_id, event_type) do nothing;
  end if;
  if v_status = 'approved' and v_effective = 'approved_order_pending' then
    if v_session.expires_at <= clock_timestamp() or not exists (
      select 1 from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' and r.expires_at > clock_timestamp()
    ) then
      update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'approved_after_reservation_expired' where id = v_intent.id;
      update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'approved_after_reservation_expired' where id = v_session.id and status <> 'completed';
      insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash)
      values (v_intent.id, 'payment.manual_review_required', jsonb_build_object('reason', 'approved_after_reservation_expired'), p_snapshot ->> 'raw_response_hash');
      return jsonb_build_object('ok', true, 'manual_review_required', true, 'finalize_required', false);
    end if;
    update public.checkout_sessions set status = 'payment_approved' where id = v_session.id and status <> 'payment_approved';
    v_finalize := true;
  elsif v_status in ('pending', 'in_process', 'authorized') then
    update public.checkout_sessions set status = 'payment_pending' where id = v_session.id and status in ('ready_for_payment', 'redirected');
  elsif v_status = 'expired' then
    perform public.release_checkout_session_inventory(v_session.id, 'provider_expired', 'expired');
  elsif v_status in ('rejected', 'cancelled', 'canceled') and p_source = 'cancellation' then
    -- Solo nuestra propia cancelacion libera. Un rechazo del proveedor deja la
    -- reserva: el comprador sigue en Checkout Pro y puede pagar con otro medio en
    -- la misma preferencia. El stock vuelve cuando vence la sesion.
    perform public.release_checkout_session_inventory(v_session.id, 'provider_' || v_status, 'cancelled');
  end if;
  -- El proveedor informa devuelto TODO el dinero de este cobro (reembolso hecho en
  -- Mercado Pago, o contracargo) y no hay pedido: las unidades que la sesión retiene
  -- ya no pueden terminar en un pedido —la finalización y el rearmado se niegan
  -- sobre dinero devuelto— y nadie del comercio las puede soltar. Una sesión pagada
  -- que no llegó a finalizarse pasa primero a revisión: es el estado en el que la
  -- liberación actúa, y el que impide pedir otra preferencia sobre ese checkout.
  -- La liberación es la del reembolso propio: decide sola si corresponde (sin
  -- pedido, en revisión, dinero afuera) y no libera dos veces. Un pago que el
  -- proveedor cerró sin haberlo aprobado nunca no entra acá: de ese no volvió
  -- ningún importe, y lo sigue atendiendo soporte.
  if v_next in ('refunded', 'charged_back')
    and v_intent.order_id is null and v_session.completed_order_id is null
    and v_session.status in ('manual_review_required', 'payment_approved', 'finalizing_order') then
    update public.checkout_sessions
       set status = 'manual_review_required', manual_review_reason = 'money_returned_before_order'
     where id = v_session.id and status in ('payment_approved', 'finalizing_order');
    perform public.release_manual_review_checkout_inventory(v_intent.id, 'provider_' || v_next || '_without_order', false);
  end if;
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'internal_status', v_effective,
    'manual_review_required', false, 'finalize_required', v_finalize);
end;
$function$;

revoke all on function public.record_mercadopago_payment_snapshot(uuid, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.record_mercadopago_payment_snapshot(uuid, jsonb, text, uuid) to service_role;
