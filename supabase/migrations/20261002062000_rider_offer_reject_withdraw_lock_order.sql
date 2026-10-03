-- TABA · RECHAZAR O RETIRAR UNA OFERTA DE REPARTO TOMA EL PEDIDO ANTES QUE LA OFERTA
--
-- QUÉ PASABA (IDEM-07; medido en PG17 local con la llegada fijada, sondas repro-4 P4 y P5 de wp18)
--
--   offer_order_to_rider toma pedido → oferta (FOR UPDATE las dos). reject_rider_order_offer tomaba la oferta
--   FOR UPDATE y, al escribir order_events (clave foránea), el pedido; withdraw_rider_order_offer actualizaba la
--   oferta y después escribía el evento. Ofrecer el pedido a otro repartidor contra rechazar (P4) o contra retirar
--   (P5) la oferta, llegando a la vez: 40P01.
--
-- QUÉ CAMBIA
--
--   Las dos toman primero el pedido (FOR NO KEY UPDATE) y después la oferta, como ofrecerla y como aceptarla
--   (20261002043000). reject lee sin candado el pedido de la oferta y, si la oferta cambiara de pedido entre
--   las dos lecturas, contesta PT409. Mismas respuestas, mismos permisos (authenticated), mismo SECURITY DEFINER
--   y search_path. ACL previo: withdraw_rider_order_offer(uuid) {postgres=X/postgres,authenticated=X/postgres}; reject_rider_order_offer(uuid,bigint,text,text) {postgres=X/postgres,authenticated=X/postgres}.
--
-- Generada de las definiciones vivas con reemplazos que coinciden una sola vez.
-- Prueba: supabase/tests/rider_offer_reject_withdraw_lock_order_test.sql
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261002062000_rider_offer_reject_withdraw_lock_order.rollback.sql

CREATE OR REPLACE FUNCTION public.reject_rider_order_offer(p_offer_id uuid, p_expected_version bigint, p_reason_code text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_offer public.rider_order_offers%rowtype;
  v_order_id uuid;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_reason text := nullif(lower(btrim(coalesce(p_reason_code, ''))), '');
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_offer_id is null or p_expected_version is null or p_expected_version < 1 then
    raise exception 'reject invalido' using errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if v_reason is not null
    and v_reason not in ('too_far', 'vehicle_problem', 'load_too_big', 'ending_shift', 'other') then
    raise exception 'motivo de rechazo invalido' using errcode = '22023';
  end if;

  -- Mismo orden de candados que ofrecer el pedido (offer_order_to_rider: pedido → oferta) y que aceptar la
  -- oferta (20261002043000): primero el pedido, después la oferta. Antes tomaba la oferta y, al escribir el
  -- evento, el pedido: con la llegada fijada se trababa (40P01) contra ofrecer el pedido a otro repartidor
  -- (20261002062000).
  select f.order_id into v_order_id from public.rider_order_offers f where f.id = p_offer_id;
  if v_order_id is null then
    raise exception 'oferta inexistente' using errcode = 'P0002';
  end if;
  perform 1 from public.orders where id = v_order_id for no key update;
  select f.* into v_offer from public.rider_order_offers f where f.id = p_offer_id for update;
  if not found or v_offer.rider_user_id <> auth.uid() then
    raise exception 'oferta inexistente' using errcode = 'P0002';
  end if;
  if v_offer.order_id is distinct from v_order_id then
    raise exception 'la oferta cambio de pedido' using errcode = 'PT409';
  end if;

  perform public.rider_require_active_membership(v_offer.business_id);

  select result into v_result
    from public.rider_delivery_operations
   where order_id = v_offer.order_id and rider_user_id = auth.uid()
     and operation = 'reject_offer' and idempotency_key = v_key
   for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;

  if v_offer.status = 'rejected' then
    return jsonb_build_object('ok', true, 'code', 'already_rejected', 'idempotent_no_op', true);
  end if;
  if v_offer.status = 'accepted' then
    return jsonb_build_object('ok', false, 'code', 'already_accepted');
  end if;
  if v_offer.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'offer_not_available', 'offer_status', v_offer.status);
  end if;
  if v_offer.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'stale_version', 'version', v_offer.version);
  end if;

  update public.rider_order_offers
     set status = 'rejected', responded_at = v_now, response_reason = v_reason, version = version + 1
   where id = v_offer.id and status = 'pending'
  returning * into v_offer;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'offer_not_available');
  end if;

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_offer.order_id, v_offer.business_id, auth.uid(), 'rider', 'rider', auth.uid(),
    'order.rider_rejected_offer', 'order.rider_rejected_offer', 'El rider rechazo la entrega',
    jsonb_build_object('offer_id', v_offer.id, 'reason_code', v_reason),
    jsonb_build_object('offer_id', v_offer.id, 'reason_code', v_reason)
  );

  v_result := jsonb_build_object('ok', true, 'code', 'rejected', 'idempotent_no_op', false);

  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (
    v_offer.order_id, auth.uid(), 'reject_offer', v_key,
    digest(jsonb_build_object('offer_id', v_offer.id, 'version', p_expected_version)::text, 'sha256'),
    v_result
  );

  return v_result;
end;
$function$;

revoke all on function public.reject_rider_order_offer(uuid,bigint,text,text) from public, anon, authenticated, service_role;
grant execute on function public.reject_rider_order_offer(uuid,bigint,text,text) to authenticated;

CREATE OR REPLACE FUNCTION public.withdraw_rider_order_offer(p_offer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_offer public.rider_order_offers%rowtype;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  select f.* into v_offer from public.rider_order_offers f where f.id = p_offer_id;
  if not found then
    raise exception 'oferta inexistente' using errcode = 'P0002';
  end if;
  if not public.has_business_role(v_offer.business_id, array['owner', 'admin', 'staff']) then
    raise exception 'rol de negocio requerido' using errcode = '42501';
  end if;
  -- Primero el pedido, después la oferta, como ofrecerla (offer_order_to_rider) y aceptarla: antes la
  -- actualización tomaba la oferta y el evento el pedido, y se trababa (40P01) contra ofrecer el pedido a
  -- otro repartidor (20261002062000).
  perform 1 from public.orders where id = v_offer.order_id for no key update;

  update public.rider_order_offers
     set status = 'withdrawn', responded_at = clock_timestamp(), version = version + 1
   where id = p_offer_id and status = 'pending'
  returning * into v_offer;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'offer_not_pending');
  end if;

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_offer.order_id, v_offer.business_id, auth.uid(), 'business', 'business', auth.uid(),
    'order.rider_offer_withdrawn', 'order.rider_offer_withdrawn', 'Oferta retirada por el negocio',
    jsonb_build_object('offer_id', v_offer.id, 'rider_user_id', v_offer.rider_user_id),
    jsonb_build_object('offer_id', v_offer.id, 'rider_user_id', v_offer.rider_user_id)
  );

  return jsonb_build_object('ok', true, 'code', 'withdrawn', 'offer_id', v_offer.id);
end;
$function$;

revoke all on function public.withdraw_rider_order_offer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.withdraw_rider_order_offer(uuid) to authenticated;
