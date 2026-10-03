-- Reversión de 20261002061000_preference_uncertain_lock_order.sql
--
-- Devuelve la marca de «envío dudoso» a su definición anterior, letra por letra (intento → cobro), con
-- los mismos permisos. No toca filas. Se niega si otra migración redefinió la función después (acepta el
-- cuerpo que dejó 20261002061000 o el anterior, así que correrla dos veces no falla).
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261002061000', 0)
);

do $redefinition_guard$
declare
  v_actual text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_actual
    from pg_proc p where p.oid = to_regprocedure('public.record_mercadopago_preference_uncertain(uuid,text,text)');
  if v_actual is null or v_actual not in ('92c4738db58eb59ac040c87778e2808c', '65272c1279fc3483109b5a8e96212392') then
    raise exception 'ROLLBACK_BLOCKED: % no tiene el cuerpo de 20261002061000 ni el anterior; otra migracion la redefinio despues: revertir esa primero', 'public.record_mercadopago_preference_uncertain(uuid,text,text)'
      using errcode = 'P0001';
  end if;
end
$redefinition_guard$;

CREATE OR REPLACE FUNCTION public.record_mercadopago_preference_uncertain(p_payment_attempt_id uuid, p_request_hash text, p_error_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_intent_id uuid;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  update public.payment_attempts set status = 'ambiguous', request_hash = p_request_hash,
    last_error_code = left(coalesce(p_error_code, 'network_or_timeout'), 120)
   where id = p_payment_attempt_id returning payment_intent_id into v_intent_id;
  if v_intent_id is null then raise exception 'attempt inexistente' using errcode = 'P0002'; end if;
  update public.payment_intents set internal_status = case when internal_status = 'preference_creating' then 'ambiguous' else internal_status end where id = v_intent_id;
  return true;
end;
$function$;

revoke all on function public.record_mercadopago_preference_uncertain(uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_mercadopago_preference_uncertain(uuid,text,text) to service_role;
comment on function public.record_mercadopago_preference_uncertain(uuid,text,text) is
  null;

commit;
