-- REVERSIÓN de 20261001205000_cancellation_recorders_terminal_and_dead_release.sql
--
-- Devuelve a su cuerpo anterior, exacto, los dos asientos de la cancelación
-- (`mark_payment_cancellation_ambiguous`, `record_payment_cancellation_response`)
-- y vuelve a poner en `prepare_mercadopago_preference_v2` (y en la versión
-- anterior, si la migración la había tocado) la llamada que se quitó, en el mismo
-- lugar y con el mismo texto.
--
-- Ojo con lo que vuelve a quedar abierto: una marca «dudosa» tardía vuelve a
-- degradar una cancelación confirmada y a encolar trabajos, y una respuesta
-- contradictoria la vuelve a pisar. La llamada de la preferencia vuelve a no
-- hacer nada (la deshace su propia excepción): no cambia ningún comportamiento.
--
-- No pierde datos: la migración no creó tablas ni columnas.
--
-- Los dos cuerpos de abajo son los de `pg_get_functiondef` sobre la base anterior
-- a la migración: no se reescribieron a mano.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001205000
begin;

CREATE OR REPLACE FUNCTION public.mark_payment_cancellation_ambiguous(p_cancellation_id uuid, p_request_hash text, p_error_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_cancellation public.payment_cancellations%rowtype; v_intent public.payment_intents%rowtype;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  select * into v_cancellation from public.payment_cancellations c where c.id = p_cancellation_id for update;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_cancellation.payment_intent_id for share;
  update public.payment_cancellations set status = 'ambiguous', raw_response_hash = p_request_hash where id = v_cancellation.id;
  insert into public.payment_outbox (payment_intent_id, cancellation_id, topic, resource_id, last_error)
  values (v_cancellation.payment_intent_id, v_cancellation.id, 'cancellation_reconcile', v_intent.provider_payment_id, left(coalesce(p_error_code, 'network_or_timeout'), 160));
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_payment_cancellation_response(p_cancellation_id uuid, p_status text, p_response_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_cancellation public.payment_cancellations%rowtype; v_intent public.payment_intents%rowtype;
begin
  if p_status not in ('cancelled', 'rejected', 'ambiguous', 'failed') or p_response_hash !~ '^[a-f0-9]{64}$' then raise exception 'respuesta de cancelacion invalida' using errcode = '22023'; end if;
  select * into v_cancellation from public.payment_cancellations c where c.id = p_cancellation_id for update;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_cancellation.payment_intent_id for update;
  update public.payment_cancellations set status = p_status, raw_response_hash = p_response_hash,
    completed_at = case when p_status in ('cancelled', 'rejected') then clock_timestamp() else completed_at end where id = v_cancellation.id;
  if p_status = 'cancelled' then
    update public.payment_intents set internal_status = case when public.payment_internal_status_rank(internal_status) < public.payment_internal_status_rank('cancelled') then 'cancelled' else internal_status end where id = v_intent.id;
    perform public.release_checkout_session_inventory(v_intent.checkout_session_id, 'owner_cancelled_payment', 'cancelled');
  end if;
  insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash) values (v_intent.id, 'payment.cancellation_' || p_status, jsonb_build_object('cancellation_id', v_cancellation.id), p_response_hash);
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id);
end;
$function$;

revoke all on function public.mark_payment_cancellation_ambiguous(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_payment_cancellation_ambiguous(uuid, text, text) to service_role;
revoke all on function public.record_payment_cancellation_response(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_payment_cancellation_response(uuid, text, text) to service_role;

-- La misma operación que la migración, al revés: sobre la definición viva, sin
-- copiar la función. Donde la nota no está (versión retirada, o nunca se tocó)
-- no hace nada.
do $dead_release$
declare
  c_dead constant text :=
    E'    perform public.release_checkout_session_inventory(v_session.id, ''preference_expired'', ''expired'');\n';
  c_note constant text :=
    E'    -- Sin liberacion aca: la excepcion de abajo la deshacia. El stock de un\n'
    || E'    -- checkout vencido lo devuelve el barrido (taba-checkout-expiry-sweep).\n';
  v_signature text;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.prepare_mercadopago_preference_v2(uuid,uuid,boolean)',
    'public.prepare_mercadopago_preference(uuid,uuid,boolean)'
  ] loop
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    if position(c_note in v_definition) > 0 then
      execute replace(v_definition, c_note, c_dead);
    end if;
  end loop;
end
$dead_release$;

commit;
