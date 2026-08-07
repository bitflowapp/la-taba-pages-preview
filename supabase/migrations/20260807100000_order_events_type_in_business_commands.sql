-- La recertificación viva encontró que "Cancelar con motivo" del Panel nunca
-- pudo funcionar: `order_events.type` es NOT NULL desde la fase 1 y los tres
-- comandos de negocio de 20260802160000 que insertan eventos directos
-- (cancel_order, acknowledge_order, set_preparation_estimate) sólo llenaban
-- `event_type`. El insert violaba la constraint, la transacción entera se
-- revertía y el pedido no se movía. Nunca se vio antes porque los scripts de
-- certificación transicionan por el núcleo de transition_order (que llena las
-- dos columnas) y estos tres caminos sólo se alcanzan desde la UI.
--
-- Fuente exacta de 20260807090000; el ÚNICO cambio en cada función es que el
-- insert a order_events llena `type` con el mismo valor que `event_type`,
-- igual que hacen el resto de los emisores del producto.

create or replace function public.cancel_order(
  p_order_id uuid,
  p_expected_revision bigint,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $cancel$
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
  v_hash := public.business_command_request_hash('cancel_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'reason', btrim(p_reason)));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  v_result := public.transition_order(p_order_id, p_expected_revision, 'canceled');
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'business_cancel_reason', 'business_cancel_reason', 'Cancelacion registrada.', jsonb_build_object('reason', btrim(p_reason)));
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'cancel_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$cancel$;

create or replace function public.acknowledge_order(
  p_order_id uuid,
  p_expected_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $ack$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision < 1 then raise exception 'expected_revision requerido' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;

  v_hash := public.business_command_request_hash('acknowledge_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision));
  select r.* into v_existing from public.business_command_receipts r
   where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  if v_order.revision <> p_expected_revision then raise exception 'revision desactualizada' using errcode = '40001'; end if;
  if public.normalize_order_status_vocabulary(v_order.status) not in ('submitted', 'accepted', 'preparing') then raise exception 'pedido no reconocible en estado actual' using errcode = 'P0001'; end if;

  update public.orders set acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid()) where id = p_order_id;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'business_acknowledged', 'business_acknowledged', 'Pedido reconocido por el negocio.', '{}'::jsonb);
  select to_jsonb(o) into v_result from public.orders o where o.id = p_order_id;
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'acknowledge_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$ack$;

create or replace function public.set_preparation_estimate(
  p_order_id uuid,
  p_expected_revision bigint,
  p_minutes integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $estimate$
declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if p_minutes not between 1 and 240 then raise exception 'minutos fuera de rango' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  v_hash := public.business_command_request_hash('set_preparation_estimate', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'minutes', p_minutes));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  if v_order.revision <> p_expected_revision then raise exception 'revision desactualizada' using errcode = '40001'; end if;
  if public.normalize_order_status_vocabulary(v_order.status) not in ('submitted', 'accepted', 'preparing') then raise exception 'estado no permite estimacion' using errcode = 'P0001'; end if;
  update public.orders set preparation_estimate_minutes = p_minutes where id = p_order_id;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'preparation_estimate_set', 'preparation_estimate_set', 'Tiempo de preparacion actualizado.', jsonb_build_object('minutes', p_minutes));
  select to_jsonb(o) into v_result from public.orders o where o.id = p_order_id;
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'set_preparation_estimate', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
$estimate$;
