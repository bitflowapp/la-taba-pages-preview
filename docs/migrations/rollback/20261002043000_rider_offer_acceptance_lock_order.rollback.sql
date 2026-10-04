-- REVERSIÓN de 20261002043000_rider_offer_acceptance_lock_order.sql
--
-- Devuelve `accept_rider_order_offer` a su cuerpo anterior (capturado con
-- pg_get_functiondef sobre la base sin esta migración; no se reescribió a mano).
--
-- Qué vuelve a quedar abierto: la aceptación vuelve a tomar la oferta antes que el pedido.
-- Si el comercio ofrece el pedido a otro repartidor mientras el primero acepta, una de las
-- dos llamadas termina en deadlock (40P01).
--
-- No pierde datos: la migración no creó tablas, columnas ni filas.
--
-- Se niega a correr si la función ya no tiene ni el cuerpo que dejó la migración ni el
-- anterior: otra migración la redefinió después y revertir ésta la pisaría.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261002043000
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261002043000', 0)
);

do $guard$
declare
  v_row record;
  v_actual text;
begin
  for v_row in
    select * from (values
      ('public.accept_rider_order_offer(uuid,bigint,text)', '697ddef8d84ebca7f7bd202f69cadfb1', '29488e6e82aa44532b6a058a7ab13680')
    ) as t(signature, applied, previous)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into v_actual
      from pg_proc p where p.oid = to_regprocedure(v_row.signature);
    if v_actual is null or v_actual not in (v_row.applied, v_row.previous) then
      raise exception 'ROLLBACK_BLOCKED: % no tiene el cuerpo de 20261002043000 ni el anterior; otra migracion la redefinio despues: revertir esa primero', v_row.signature
        using errcode = 'P0001';
    end if;
  end loop;
end
$guard$;

CREATE OR REPLACE FUNCTION public.accept_rider_order_offer(p_offer_id uuid, p_expected_version bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare v_offer public.rider_order_offers%rowtype;v_prior jsonb;
begin
  if auth.uid() is null then raise exception 'Autenticación requerida' using errcode='42501'; end if;
  perform public.lock_rider_capacity(auth.uid());
  select * into v_offer from public.rider_order_offers
   where id=p_offer_id and rider_user_id=auth.uid();
  if not found then return public.accept_rider_order_offer_pre_presence(p_offer_id,p_expected_version,p_idempotency_key); end if;
  perform public.rider_require_active_membership(v_offer.business_id);
  if (select b.rider_presence_required from public.businesses b where b.id=v_offer.business_id)
     and not public.rider_availability_effective(v_offer.business_id,auth.uid()) then
    select result into v_prior from public.rider_delivery_operations
    where order_id=v_offer.order_id and rider_user_id=auth.uid()
      and operation='accept_offer' and idempotency_key=p_idempotency_key;
    if found or v_offer.status <> 'pending' then
      return public.accept_rider_order_offer_pre_presence(p_offer_id,p_expected_version,p_idempotency_key);
    end if;
    return jsonb_build_object('ok',false,'code','rider_unavailable');
  end if;
  return public.accept_rider_order_offer_pre_presence(p_offer_id,p_expected_version,p_idempotency_key);
end;
$function$;

revoke all on function public.accept_rider_order_offer(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.accept_rider_order_offer(uuid, bigint, text) to authenticated;

commit;
