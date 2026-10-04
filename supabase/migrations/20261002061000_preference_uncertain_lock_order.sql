-- TABA · LA MARCA DE «ENVÍO DUDOSO» DE LA PREFERENCIA TOMA LOS CANDADOS EN EL MISMO ORDEN QUE EL RESTO
--
-- QUÉ PASABA (medido en PG17 local con la llegada fijada, sobre el repo con 20261002060000)
--
--   record_mercadopago_preference_uncertain actualizaba el intento (payment_attempts) y después el cobro
--   (payment_intents). Volver a pedir la preferencia (prepare_mercadopago_preference_v2) y asentarla
--   (record_mercadopago_preference_created_v2) toman sesión → cobro → intento. Con las dos llegando a la vez:
--     X1  volver a pedir la preferencia contra la marca  → 40P01, Postgres cortó prepare_..._v2
--     X2  asentar la preferencia creada contra la marca  → 40P01, Postgres cortó la marca
--   (IDEM-08 del registro; sondas de wp18, repro-5).
--
-- QUÉ CAMBIA
--
--   Lee sin candado el cobro del intento, toma el cobro (FOR NO KEY UPDATE, el mismo nivel que tomaba el UPDATE)
--   y recién después actualiza el intento, exigiendo que siga siendo de ese cobro. Cobro → intento, como el resto.
--   Mismas respuestas: 22023 con un hash inválido, P0002 si el intento no existe, true si marcó.
--
-- QUÉ NO CAMBIA
--
--   Firma, SECURITY DEFINER, search_path y permisos (sólo service_role). Lo que escribe.
--
-- Generada de la definición viva con un reemplazo que coincide una sola vez.
-- Prueba: supabase/tests/preference_uncertain_lock_order_test.sql
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261002061000_preference_uncertain_lock_order.rollback.sql

CREATE OR REPLACE FUNCTION public.record_mercadopago_preference_uncertain(p_payment_attempt_id uuid, p_request_hash text, p_error_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_intent_id uuid;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  -- Mismo orden de candados que el resto de la preferencia (sesión → cobro → intento,
  -- prepare/record_mercadopago_preference_*_v2): primero el cobro, después el intento.
  -- Antes actualizaba el intento y después el cobro, y con la llegada fijada se trababa
  -- (40P01) contra volver a pedir o asentar la preferencia (20261002061000).
  select pa.payment_intent_id into v_intent_id
    from public.payment_attempts pa where pa.id = p_payment_attempt_id;
  if v_intent_id is null then raise exception 'attempt inexistente' using errcode = 'P0002'; end if;
  perform 1 from public.payment_intents where id = v_intent_id for no key update;
  update public.payment_attempts set status = 'ambiguous', request_hash = p_request_hash,
    last_error_code = left(coalesce(p_error_code, 'network_or_timeout'), 120)
   where id = p_payment_attempt_id and payment_intent_id = v_intent_id;
  if not found then raise exception 'attempt inexistente' using errcode = 'P0002'; end if;
  update public.payment_intents set internal_status = case when internal_status = 'preference_creating' then 'ambiguous' else internal_status end where id = v_intent_id;
  return true;
end;
$function$;

revoke all on function public.record_mercadopago_preference_uncertain(uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_mercadopago_preference_uncertain(uuid,text,text) to service_role;
