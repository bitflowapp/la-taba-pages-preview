-- REVERSIÓN de 20261002040000_payment_cancellation_lock_order.sql
--
-- Devuelve `record_payment_cancellation_response` y `mark_payment_cancellation_ambiguous` a
-- su cuerpo anterior (el de 20261001205000, capturado con pg_get_functiondef sobre la base
-- sin esta migración; no se reescribió a mano).
--
-- Qué vuelve a quedar abierto: las dos toman otra vez la solicitud antes que el cobro (y la
-- primera, la sesión al final). Cruzadas con un segundo pedido de cancelación o con el aviso
-- de pago del mismo cobro terminan en deadlock (40P01), y la solicitud puede quedar
-- `requested` sin nadie que la concilie.
--
-- No pierde datos: la migración no creó tablas, columnas ni filas.
--
-- Se niega a correr si alguna de las dos funciones ya no tiene ni el cuerpo que dejó la
-- migración ni el anterior: otra migración la redefinió después y revertir ésta la pisaría.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261002040000
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261002040000', 0)
);

do $guard$
declare
  v_row record;
  v_actual text;
begin
  for v_row in
    select * from (values
      ('public.record_payment_cancellation_response(uuid,text,text)', '38115d8d3fa7ad5e520a34b754f711e3', '6b5154afaae69c7cb58515087f7d2e7f'),
      ('public.mark_payment_cancellation_ambiguous(uuid,text,text)', 'ff91b4a55a222ec4c53ecfe7fff36122', '92c46dbc18861ec842f43fa661f6d48e')
    ) as t(signature, applied, previous)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into v_actual
      from pg_proc p where p.oid = to_regprocedure(v_row.signature);
    if v_actual is null or v_actual not in (v_row.applied, v_row.previous) then
      raise exception 'ROLLBACK_BLOCKED: % no tiene el cuerpo de 20261002040000 ni el anterior; otra migracion la redefinio despues: revertir esa primero', v_row.signature
        using errcode = 'P0001';
    end if;
  end loop;
end
$guard$;

CREATE OR REPLACE FUNCTION public.record_payment_cancellation_response(p_cancellation_id uuid, p_status text, p_response_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$;

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

revoke all on function public.record_payment_cancellation_response(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_payment_cancellation_response(uuid, text, text) to service_role;
revoke all on function public.mark_payment_cancellation_ambiguous(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_payment_cancellation_ambiguous(uuid, text, text) to service_role;

commit;
