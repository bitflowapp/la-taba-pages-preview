-- Rollback de 20261002050000: devuelve `cancel_order` y `transition_order` (la de cuatro
-- argumentos) a su definición anterior (20261001190500 y 20260807090000, capturadas con
-- pg_get_functiondef) y les quita el comentario, que antes no tenían.
--
-- Qué vuelve a quedar abierto: un empleado (`staff`) vuelve a cancelar y a rechazar
-- pedidos aunque el catálogo de permisos no le dé `orders.cancel`.
--
-- No toca ninguna fila ni el catálogo de permisos: no hay dato durable que se pierda.
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261002050000
begin;


-- Se niega a correr si otra migración redefinió alguna de estas funciones después de
-- 20261002050000: su cuerpo vivo tiene que ser el que dejó esa migración o el anterior
-- (el anterior permite correr la reversión dos veces).
do $redefinition_guard$
declare
  v_row record;
  v_actual text;
begin
  for v_row in
    select * from (values
      ('public.cancel_order(uuid,bigint,text,text)', '78d5d6b6fb66947e5458d00849e9e05e', '98db39bf382187e89d1046b2bfc1dfd8'),
      ('public.transition_order(uuid,bigint,text,text)', '089f6626cd93450dd634c73c3ab4d4f5', '3a9ca2d974d279f633bcd7e70607bf14')
    ) as t(signature, applied, previous)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into v_actual
      from pg_proc p where p.oid = to_regprocedure(v_row.signature);
    if v_actual is null or v_actual not in (v_row.applied, v_row.previous) then
      raise exception 'ROLLBACK_BLOCKED: % no tiene el cuerpo de 20261002050000 ni el anterior; otra migracion la redefinio despues: revertir esa primero', v_row.signature
        using errcode = 'P0001';
    end if;
  end loop;
end
$redefinition_guard$;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261002050000', 0)
);

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_expected_revision bigint, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then raise exception 'motivo de cancelacion requerido' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;

  if lower(btrim(coalesce(v_order.payment_method, ''))) = 'mercadopago'
     or exists (
       select 1 from public.payment_intents pi
        where pi.order_id = v_order.id
          and pi.internal_status in (
            'approved', 'approved_order_pending', 'completed',
            'partially_refunded', 'refunded', 'security_review_required'
          )
     ) then
    if not public.order_payment_is_financially_reversed(v_order.id) then
    raise exception 'pedido cobrado por Mercado Pago: gestionar reembolso antes de cancelar'
      using errcode = '55000';
    end if;
  end if;

  v_hash := public.business_command_request_hash('cancel_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'reason', btrim(p_reason)));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  v_result := public.transition_order(p_order_id, p_expected_revision, 'canceled');
  -- Ya estaba cancelado: esta llamada no canceló nada, así que no deja motivo ni
  -- recibo. El motivo que queda en el historial es el de quien sí canceló.
  if coalesce((v_result ->> 'idempotent_no_op')::boolean, false) then
    return v_result || jsonb_build_object('idempotent_replay', false);
  end if;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'business_cancel_reason', 'business_cancel_reason', 'Cancelacion registrada.', jsonb_build_object('reason', btrim(p_reason)));
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'cancel_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$function$;

revoke all on function public.cancel_order(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.cancel_order(uuid, bigint, text, text) to authenticated;

comment on function public.cancel_order(uuid, bigint, text, text) is null;

CREATE OR REPLACE FUNCTION public.transition_order(p_order_id uuid, p_expected_revision bigint, p_new_status text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  v_hash := public.business_command_request_hash('transition_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'new_status', public.normalize_order_status_vocabulary(p_new_status)));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  v_result := public.transition_order(p_order_id, p_expected_revision, p_new_status);
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'transition_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$function$;

revoke all on function public.transition_order(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.transition_order(uuid, bigint, text, text) to authenticated;

comment on function public.transition_order(uuid, bigint, text, text) is null;

commit;
