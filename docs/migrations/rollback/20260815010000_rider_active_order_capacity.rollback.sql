-- Reversión de 20260815010000_rider_active_order_capacity.sql
--
-- Devuelve el sistema a «un Rider = un pedido activo» tal como estaba en
-- release/taba2-production-candidate @ 317bbe9.
--
-- No lee, no escribe y no borra una sola fila de negocio: sólo saca el trigger
-- y restituye los dos cuerpos anteriores. Un Rider que en ese momento tenga 2 o
-- 3 entregas activas las CONSERVA —el rollback no las cancela ni las
-- reasigna—; lo que deja de poder es tomar una más. Si eso no es lo que se
-- quiere, hay que reasignar esas entregas ANTES de correr esto.
--
-- Aplicar DESPUÉS de 20260815020000_*.rollback.sql, que depende de estas
-- funciones.

drop trigger if exists orders_enforce_rider_active_order_capacity on public.orders;
drop function if exists public.enforce_rider_active_order_capacity();

-- `assign_order_rider` vuelve al cuerpo de 20260812110000.
create or replace function public.assign_order_rider(
  p_order_id uuid,
  p_expected_status text,
  p_expected_rider_user_id uuid,
  p_new_rider_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_order public.orders%rowtype;
  v_business_id uuid;
  v_user_id uuid := auth.uid();
  v_expected_status text := lower(btrim(coalesce(p_expected_status, '')));
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null or p_new_rider_user_id is null then
    raise exception 'order_id y rider requeridos' using errcode = '22023';
  end if;
  select o.business_id into v_business_id from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  if not public.has_business_role(v_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'rol de negocio requerido' using errcode = '42501';
  end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  if v_order.delivery_mode <> 'delivery' then
    raise exception 'los pedidos con retiro no admiten rider' using errcode = '42501';
  end if;
  perform 1
    from public.business_members bm
   where bm.business_id = v_order.business_id
     and bm.user_id = p_new_rider_user_id
     and bm.role = 'rider'
     and bm.is_active = true
   for share;
  if not found then
    raise exception 'rider activo del negocio requerido' using errcode = '42501';
  end if;
  if v_expected_status not in ('ready', 'assigned')
    or v_order.status <> v_expected_status
    or v_order.status not in ('ready', 'assigned')
    or v_order.assigned_rider_user_id is distinct from p_expected_rider_user_id then
    raise exception 'conflicto de asignacion: estado o rider esperado cambio'
      using errcode = '40001';
  end if;
  if v_order.assigned_rider_user_id = p_new_rider_user_id and v_order.status = 'assigned' then
    return public.rider_order_rpc_payload(v_order.id);
  end if;
  update public.orders
     set assigned_rider_user_id = p_new_rider_user_id, status = 'assigned'
   where id = v_order.id;
  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_order.id, v_order.business_id, v_user_id, 'business', 'business', v_user_id,
    case when v_order.assigned_rider_user_id is null then 'order.rider_assigned' else 'order.rider_reassigned' end,
    case when v_order.assigned_rider_user_id is null then 'order.rider_assigned' else 'order.rider_reassigned' end,
    case when v_order.assigned_rider_user_id is null then 'Rider asignado por el negocio' else 'Rider reasignado por el negocio' end,
    jsonb_build_object('previous_rider_user_id', v_order.assigned_rider_user_id, 'next_rider_user_id', p_new_rider_user_id),
    jsonb_build_object('previous_rider_user_id', v_order.assigned_rider_user_id, 'next_rider_user_id', p_new_rider_user_id)
  );
  return public.rider_order_rpc_payload(v_order.id);
end;
$function$;

-- `claim_delivery_order` vuelve al cuerpo de 20260806220000, con el límite de 1.
create or replace function public.claim_delivery_order(
  p_business_id uuid,
  p_public_code text,
  p_expected_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
  v_fingerprint bytea;
begin
  perform public.rider_require_active_membership(p_business_id);
  if p_expected_revision is null or p_expected_revision < 1 or btrim(coalesce(p_public_code, '')) = '' then
    raise exception 'claim invalido' using errcode = '22023';
  end if;
  select o.* into v_order
    from public.orders o
   where o.business_id = p_business_id and o.public_code = btrim(p_public_code)
   for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_available'); end if;
  if v_order.origin <> 'production' then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  select result into v_result
    from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid()
     and operation = 'claim' and idempotency_key = v_key
   for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  if exists (
    select 1 from public.orders active
    where active.assigned_rider_user_id = auth.uid()
      and active.id <> v_order.id
      and active.status in ('assigned', 'picked_up', 'on_the_way', 'arrived')
  ) then
    return jsonb_build_object('ok', false, 'code', 'active_delivery_exists');
  end if;
  if v_order.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision);
  end if;
  if v_order.delivery_mode <> 'delivery' or v_order.status <> 'ready' or v_order.assigned_rider_user_id is not null then
    return jsonb_build_object('ok', false, 'code', 'taken_by_other', 'revision', v_order.revision);
  end if;
  update public.orders
     set assigned_rider_user_id = auth.uid(), status = 'assigned'
   where id = v_order.id;
  v_result := jsonb_build_object(
    'ok', true, 'outcome', 'claimed', 'idempotent_no_op', false,
    'order', public.rider_active_delivery_payload(v_order.id)
  );
  v_fingerprint := digest(jsonb_build_object('public_code', v_order.public_code, 'revision', p_expected_revision)::text, 'sha256');
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'claim', v_key, v_fingerprint, v_result);
  return v_result;
end;
$function$;

drop function if exists public.lock_rider_capacity(uuid);
drop function if exists public.count_rider_active_orders(uuid, uuid, uuid);
drop function if exists public.rider_active_order_statuses();
drop function if exists public.rider_max_active_orders();

select pg_notify('pgrst', 'reload schema');
