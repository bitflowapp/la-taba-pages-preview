-- Una cancelación confirmada no se degrada, y la preferencia deja de prometer una liberación que no hace.
--
-- QUÉ ESTABA ROTO (medido el 2026-10-01 sobre las 158 migraciones anteriores más
-- el guardián de admisión)
--
--   1. Los dos asientos de la cancelación de un cobro no tenían estado terminal ni
--      idempotencia, a diferencia de sus hermanos del reembolso:
--        · `mark_payment_cancellation_ambiguous` sobre una cancelación ya
--          `cancelled` la pasaba a `ambiguous` y encolaba otro trabajo de
--          conciliación (uno más por cada llamada);
--        · `record_payment_cancellation_response` aceptaba `rejected` sobre una
--          cancelación ya `cancelled` (fila `rejected`, dos eventos contradictorios),
--          y cada respuesta repetida escribía un evento más.
--   2. `prepare_mercadopago_preference_v2` (y la versión anterior) hacía, sobre un
--      checkout vencido:
--          perform public.release_checkout_session_inventory(..., 'preference_expired', 'expired');
--          raise exception 'checkout vencido' using errcode = '55000';
--      La excepción deshace la transacción que acababa de liberar. Medido: después
--      del error la reserva sigue `active`, el stock sigue descontado y la sesión
--      sigue en su estado anterior; quien de verdad libera es el barrido, un minuto
--      después. La línea no hacía nada y hacía creer que sí.
--
-- QUÉ QUEDA
--
--   · Una cancelación `cancelled` o `rejected` es final. Marcarla dudosa después
--     no cambia nada ni encola; una respuesta igual es idempotente (sin evento
--     repetido) y una respuesta distinta se rechaza con 55000, igual que en
--     `record_payment_refund_response_v2`. El trabajo de conciliación no se duplica
--     mientras haya uno activo.
--   · La preferencia ya no llama a la liberación. El vencimiento lo cobra el
--     barrido (`taba-checkout-expiry-sweep`, cada minuto), que es quien siempre lo
--     hizo.
--
-- QUÉ NO CAMBIA
--
--   · El contrato de error de la preferencia: mismo mensaje («checkout vencido»),
--     mismo 55000, mismo punto. Ni una línea más de su cuerpo: se quita la llamada
--     muerta sobre la definición VIVA, sin copiar la función, para no pisar lo que
--     otra migración haya cambiado en ella y para no resucitar la versión anterior
--     donde el contrato V5 ya la retiró (si no encuentra la línea, no la toca).
--   · Firmas, privilegios y `search_path` de los dos asientos de cancelación; el
--     orden de sus candados; la liberación de stock al confirmar una cancelación.
--   · `prepare_payment_cancellation`.
--
-- Forward-only. Reversión: docs/migrations/rollback/20261001205000_cancellation_recorders_terminal_and_dead_release.rollback.sql

-- ── 1. Marcar dudosa una cancelación ────────────────────────────────────────
create or replace function public.mark_payment_cancellation_ambiguous(
  p_cancellation_id uuid,
  p_request_hash text,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_cancellation public.payment_cancellations%rowtype; v_intent public.payment_intents%rowtype;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  select * into v_cancellation from public.payment_cancellations c where c.id = p_cancellation_id for update;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_cancellation.payment_intent_id for share;
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
$$;

revoke all on function public.mark_payment_cancellation_ambiguous(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_payment_cancellation_ambiguous(uuid, text, text) to service_role;

-- ── 2. Asentar la respuesta de una cancelación ──────────────────────────────
create or replace function public.record_payment_cancellation_response(
  p_cancellation_id uuid,
  p_status text,
  p_response_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_cancellation public.payment_cancellations%rowtype; v_intent public.payment_intents%rowtype;
begin
  -- Sin estado no hay respuesta que asentar. Antes lo frenaba el NOT NULL de la
  -- columna; con el retorno idempotente de abajo un NULL habría pasado por confirmado.
  if p_status is null or p_status not in ('cancelled', 'rejected', 'ambiguous', 'failed') or p_response_hash !~ '^[a-f0-9]{64}$' then raise exception 'respuesta de cancelacion invalida' using errcode = '22023'; end if;
  select * into v_cancellation from public.payment_cancellations c where c.id = p_cancellation_id for update;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_cancellation.payment_intent_id for update;
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
$$;

revoke all on function public.record_payment_cancellation_response(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_payment_cancellation_response(uuid, text, text) to service_role;

-- ── 3. La liberación que el propio error deshacía ───────────────────────────
do $dead_release$
declare
  c_dead constant text :=
    E'    perform public.release_checkout_session_inventory(v_session.id, ''preference_expired'', ''expired'');\n';
  c_note constant text :=
    E'    -- Sin liberacion aca: la excepcion de abajo la deshacia. El stock de un\n'
    || E'    -- checkout vencido lo devuelve el barrido (taba-checkout-expiry-sweep).\n';
  v_signature text;
  v_definition text;
  v_patched integer := 0;
begin
  foreach v_signature in array array[
    'public.prepare_mercadopago_preference_v2(uuid,uuid,boolean)',
    'public.prepare_mercadopago_preference(uuid,uuid,boolean)'
  ] loop
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    if position(c_dead in v_definition) > 0 then
      -- CREATE OR REPLACE sobre la definición viva: conserva dueño, privilegios,
      -- SECURITY DEFINER y search_path, y cualquier otro cambio que ya tenga.
      execute replace(v_definition, c_dead, c_note);
      v_patched := v_patched + 1;
    end if;
  end loop;

  -- Falla cerrada. La V2 es la que usa la Edge Function: tiene que haber quedado
  -- sin la llamada y con el mismo error. La versión anterior puede estar retirada.
  if exists (
    select 1 from pg_proc p
     where p.oid in (
       'public.prepare_mercadopago_preference_v2(uuid,uuid,boolean)'::regprocedure,
       'public.prepare_mercadopago_preference(uuid,uuid,boolean)'::regprocedure)
       and position('preference_expired' in p.prosrc) > 0
  ) then
    raise exception 'la liberacion muerta de prepare_mercadopago_preference sigue presente con otra forma: revisar a mano';
  end if;
  if position('raise exception ''checkout vencido'' using errcode = ''55000''' in
    pg_get_functiondef('public.prepare_mercadopago_preference_v2(uuid,uuid,boolean)'::regprocedure)) = 0 then
    raise exception 'prepare_mercadopago_preference_v2 perdio el error de checkout vencido';
  end if;
  raise notice 'prepare_mercadopago_preference: llamada muerta quitada de % funcion(es)', v_patched;
end
$dead_release$;
