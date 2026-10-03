-- TABA · EL REINTENTO DE UN CÓDIGO EQUIVOCADO NO GASTA OTRO INTENTO EN EL CIERRE DEL COMERCIO
--
-- QUÉ ESTABA ROTO (medido el 2026-10-02 y otra vez el 2026-10-03 sobre las 190 migraciones
-- anteriores, PostgreSQL 17 local con las dependencias de la plataforma simuladas; no
-- necesita concurrencia)
--
--   `confirm_business_delivery_code` es la puerta con la que el comercio cierra su propio
--   reparto con el código del cliente. Guarda el recibo del comando sólo cuando la entrega
--   se confirma. Un código equivocado no deja recibo, y cada copia del MISMO envío (misma
--   clave de idempotencia, mismo código) contaba un intento fallido:
--
--       confirm_business_delivery_code(pedido, rev, '0000', K)  ->  incorrect_code, quedan 4
--       confirm_business_delivery_code(pedido, rev, '0000', K)  ->  incorrect_code, quedan 3
--       order_delivery_handoffs.failed_attempts                 ->  2 (tenía que ser 1)
--
--   Con tres copias a la vez: 3 intentos. Un código mal tipeado más cuatro reintentos de
--   red son cinco intentos: demora de 5 minutos sin que el operador haya visto una sola
--   respuesta. Falla hacia el lado seguro (bloquea de más), pero bloquea al que no hizo
--   nada. El comentario de la función decía que un reintento «devuelve el recibo en vez de
--   gastar un intento del código»: para un código equivocado no era cierto.
--   La puerta del repartidor (`confirm_delivery_code`) no tiene el problema: guarda el
--   resultado de cada clave, también el del código equivocado.
--
-- POR QUÉ NO ALCANZA CON GUARDAR EL RECIBO DEL FALLO POR CLAVE
--
--   El Panel arma la clave con comando + pedido + revisión + destino, SIN el código, y un
--   código equivocado no cambia la revisión: el operador que corrige el código manda la
--   MISMA clave. Guardar el fallo por clave le devolvería «código equivocado» al código
--   bueno.
--
-- QUÉ CAMBIA
--
--   · Un intento equivocado se identifica por la clave MÁS una huella del código tipeado.
--     Si ese intento ya está anotado para ese operador, la función contesta
--     `incorrect_code` con los intentos que quedan AHORA y `idempotent_replay: true`, y no
--     cuenta nada. Otro código equivocado con la misma clave es un intento nuevo.
--   · La huella es un HMAC del código tipeado con el hash del código vigente como clave,
--     recortado a 16 caracteres. Nunca se guarda el código, ni una huella que se pueda
--     revertir probando los diez mil códigos sin tener ese hash.
--   · De paso cada código equivocado distinto deja su propia fila en
--     `delivery_confirmation_attempts` (antes las fundía por clave un `on conflict`).
--   · El comentario de la función y el de adentro dicen lo que pasa.
--
-- CON LA DEMORA ACTIVA
--
--   No cambia: mientras dura la demora cualquier envío, repetido o no, recibe
--   `temporarily_locked` con los segundos que faltan y no cuenta intento. Pasada la
--   demora, la repetición de un envío ya contado recibe `incorrect_code` con 0 intentos
--   restantes y `idempotent_replay: true`, y no vuelve a activar la demora; un código
--   equivocado NUEVO sí la activa otra vez, como siempre.
--
-- QUÉ NO CAMBIA
--
--   La primera respuesta a un código equivocado (mismos campos, mismos valores), el recibo
--   del cierre confirmado, el formato inválido, el código vencido, la revisión, los
--   permisos (`authenticated`), SECURITY DEFINER y `search_path`. La puerta del repartidor
--   y la fila compartida del código (`order_delivery_handoffs`): ni una columna nueva. El
--   resto del cuerpo es el vigente letra por letra, generado de la definición viva.
--   Un intento equivocado anotado ANTES de esta migración (con la clave sola) no se
--   reconoce como repetición: su primer reintento cuenta una vez más y desde ahí ya no.
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261002042000_business_delivery_wrong_code_replay.rollback.sql

CREATE OR REPLACE FUNCTION public.confirm_business_delivery_code(p_order_id uuid, p_expected_revision bigint, p_delivery_code text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_order public.orders%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_code text := regexp_replace(coalesce(p_delivery_code, ''), '[^0-9]', '', 'g');
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
  v_retry_seconds integer;
  v_result jsonb;
  v_attempt_key text;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if v_order.delivery_mode <> 'delivery' then
    raise exception 'este cierre es para pedidos con envio' using errcode = '42501';
  end if;
  -- Con repartidor asignado el pedido es suyo: lo cierra el, por su camino.
  if v_order.assigned_rider_user_id is not null then
    raise exception 'la entrega la confirma el repartidor asignado' using errcode = '42501';
  end if;

  -- La idempotencia del Panel: la misma tabla y la misma huella que el resto de
  -- sus comandos. El recibo se guarda cuando la entrega se confirma: el reintento
  -- de un cierre ya hecho devuelve ese recibo. Un codigo equivocado no deja
  -- recibo; su reintento se reconoce mas abajo, por clave y codigo tipeado.
  v_hash := public.business_command_request_hash(
    'confirm_business_delivery_code', p_order_id,
    jsonb_build_object('expected_revision', p_expected_revision));
  select r.* into v_existing from public.business_command_receipts r
   where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  -- Doble toque sobre un pedido ya entregado: exito, sin tocar nada.
  if public.normalize_order_status_vocabulary(v_order.status) = 'delivered' then
    select to_jsonb(o) into v_result from public.orders o where o.id = v_order.id;
    return v_result || jsonb_build_object('ok', true, 'outcome', 'already_delivered', 'idempotent_replay', false);
  end if;

  if p_expected_revision is null
    or v_order.revision is distinct from p_expected_revision then
    raise exception 'revision desactualizada: esperada %, actual %',
      p_expected_revision, v_order.revision using errcode = 'PT409';
  end if;
  if public.normalize_order_status_vocabulary(v_order.status) <> 'on_the_way' then
    raise exception 'el pedido tiene que estar en reparto para cerrarlo' using errcode = '23514';
  end if;

  if v_order.delivery_code_required then
    if v_code !~ '^[0-9]{4}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_format', 'revision', v_order.revision);
    end if;

    select h.* into v_handoff from public.order_delivery_handoffs h
     where h.order_id = v_order.id for update;
    if not found or v_handoff.expires_at <= v_now then
      return jsonb_build_object('ok', false, 'code', 'code_unavailable', 'revision', v_order.revision);
    end if;

    -- La demora vive en la fila del pedido, no en el actor: un intento fallido
    -- del Rider deja esperando tambien al mostrador, y al reves. Una segunda
    -- ventana de intentos por entrar por otra puerta seria justamente el agujero.
    if v_handoff.locked_until is not null and v_handoff.locked_until > v_now then
      v_retry_seconds := greatest(1, ceil(extract(epoch from (v_handoff.locked_until - v_now)))::integer);
      insert into public.delivery_confirmation_attempts(
        business_id, order_id, rider_id, request_id, result, lock_level, retry_after_seconds)
      values (v_order.business_id, v_order.id, auth.uid(), left(regexp_replace(p_idempotency_key, '[^A-Za-z0-9_-]', '-', 'g'), 128),
              'temporarily_locked', greatest(1, v_handoff.failed_attempts - 4), v_retry_seconds)
      on conflict do nothing;
      return jsonb_build_object('ok', false, 'code', 'temporarily_locked',
                                'retry_after_seconds', v_retry_seconds, 'revision', v_order.revision);
    end if;

    if crypt(v_code, v_handoff.code_hash) <> v_handoff.code_hash then
      -- La clave del Panel no lleva el codigo (el mismo comando admite corregirlo),
      -- asi que un intento es la clave MAS el codigo tipeado. El mismo envio repetido
      -- -reintento de red, doble toque, outbox- ya conto el suyo: se contesta con lo
      -- que queda ahora y no gasta otro. Otro codigo equivocado con la misma clave si
      -- es un intento nuevo. Del codigo tipeado se guarda una huella con clave (el
      -- hash del codigo vigente), nunca el codigo: cuatro digitos se adivinan
      -- probando, y una huella sin clave seria el codigo con otro nombre.
      v_attempt_key := left(regexp_replace(p_idempotency_key, '[^A-Za-z0-9_-]', '-', 'g'), 111)
        || '-' || substr(encode(hmac(p_idempotency_key || ':' || v_code, v_handoff.code_hash, 'sha256'), 'hex'), 1, 16);
      if exists (
        select 1 from public.delivery_confirmation_attempts a
         where a.order_id = v_order.id and a.rider_id = auth.uid() and a.request_id = v_attempt_key
      ) then
        return jsonb_build_object('ok', false, 'code', 'incorrect_code',
          'remaining_attempts', greatest(0, 5 - v_handoff.failed_attempts),
          'retry_after_seconds', null, 'revision', v_order.revision, 'idempotent_replay', true);
      end if;
      v_attempts := least(20, v_handoff.failed_attempts + 1);
      v_retry_seconds := case when v_attempts < 5 then null
                              else least(86400, 300 * power(2, least(8, v_attempts - 5))::integer) end;
      update public.order_delivery_handoffs
         set failed_attempts = v_attempts,
             locked_until = case when v_retry_seconds is null then null
                                 else v_now + make_interval(secs => v_retry_seconds) end
       where order_id = v_order.id;
      insert into public.delivery_confirmation_attempts(
        business_id, order_id, rider_id, request_id, result, lock_level, retry_after_seconds)
      values (v_order.business_id, v_order.id, auth.uid(), v_attempt_key,
              case when v_retry_seconds is null then 'incorrect_code' else 'temporarily_locked' end,
              greatest(0, v_attempts - 4), v_retry_seconds)
      on conflict do nothing;
      return jsonb_build_object('ok', false,
        'code', case when v_retry_seconds is null then 'incorrect_code' else 'temporarily_locked' end,
        'remaining_attempts', greatest(0, 5 - v_attempts),
        'retry_after_seconds', v_retry_seconds, 'revision', v_order.revision);
    end if;

    -- El codigo es el bueno. Se marca ANTES del update: `prevent_unverified_delivery`
    -- mira esta fila, no una variable de sesion.
    update public.order_delivery_handoffs
       set confirmed_at = v_now, confirmed_by_user_id = auth.uid(),
           failed_attempts = 0, locked_until = null
     where order_id = v_order.id;
    insert into public.delivery_confirmation_attempts(
      business_id, order_id, rider_id, request_id, result)
    values (v_order.business_id, v_order.id, auth.uid(),
            left(regexp_replace(p_idempotency_key, '[^A-Za-z0-9_-]', '-', 'g'), 128), 'confirmed')
    on conflict do nothing;
  end if;

  perform set_config('taba.delivery_code_confirmed', 'true', true);
  update public.orders set status = 'delivered' where id = v_order.id and status = v_order.status;
  perform set_config('taba.delivery_code_confirmed', '', true);

  select to_jsonb(o) into v_result from public.orders o where o.id = v_order.id;
  v_result := v_result || jsonb_build_object(
    'ok', true, 'outcome', 'confirmed',
    'code_verified', v_order.delivery_code_required,
    'idempotent_replay', false);

  insert into public.business_command_receipts(
    business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'confirm_business_delivery_code',
          p_idempotency_key, v_hash, v_result);

  return v_result;
end;
$function$;

revoke all on function public.confirm_business_delivery_code(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.confirm_business_delivery_code(uuid, bigint, text, text) to authenticated;

comment on function public.confirm_business_delivery_code(uuid, bigint, text, text) is
  'El comercio cierra su propio reparto con el codigo del cliente. Comparte la fila de handoff -y su demora- con el camino del Rider; nunca toca un pedido con repartidor asignado. El reintento del mismo envio (misma clave y mismo codigo equivocado) no gasta otro intento.';
