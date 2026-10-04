-- REVERSIÓN de 20261001203000_manual_review_checkout_keeps_stock_exact.sql
--
-- Devuelve a su cuerpo anterior, exacto, las cuatro funciones que la migración
-- redefinió y quita las dos que agregó:
--
--   recover_paid_checkout_order, can_recover_paid_checkout,
--   record_payment_refund_response_v2, list_stock_reservation_alerts   (restauradas)
--   release_manual_review_checkout_inventory,
--   private.checkout_payment_money_is_out                              (eliminadas)
--
-- Ojo con lo que vuelve a quedar abierto: una sesión en revisión manual con su
-- reserva activa vuelve a descontar el stock dos veces al rearmar el pedido, el
-- reembolso total sin pedido deja de devolver las unidades, y se puede rearmar un
-- pedido sobre un cobro reembolsado o con un reembolso en curso. Sólo usar para
-- volver atrás un despliegue.
--
-- No pierde datos: la migración no creó tablas ni columnas. Las reservas que ya se
-- liberaron por un reembolso quedan `released`, un estado que el código anterior
-- entiende. Los eventos `payment.manual_review_stock_released` quedan como historia.
--
-- Orden: si también se revierten 20261001205000 y 20261001204000, van ANTES que
-- ésta (de la más nueva a la más vieja). Ninguna depende de las funciones de acá,
-- pero es el orden en que se probó.
--
-- Los cuerpos de abajo son los de `pg_get_functiondef` sobre la base anterior a la
-- migración: no se reescribieron a mano.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261001203000
begin;

CREATE OR REPLACE FUNCTION public.recover_paid_checkout_order(p_checkout_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_generation integer;
  v_expires timestamptz;
  v_faltantes jsonb := '[]'::jsonb;
  v_resultado jsonb;
begin
  select * into v_session
    from public.checkout_sessions s
   where s.id = p_checkout_session_id
   for update;
  if not found then
    raise exception 'checkout inexistente' using errcode = 'P0002';
  end if;
  if v_actor is null
    or not public.has_business_role(v_session.business_id, array['owner', 'admin']) then
    raise exception 'recuperacion no autorizada' using errcode = '42501';
  end if;

  -- Tocar dos veces no puede crear dos pedidos.
  if v_session.completed_order_id is not null then
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'order_id', v_session.completed_order_id
    );
  end if;

  select * into v_intent
    from public.payment_intents pi
   where pi.checkout_session_id = v_session.id
   for update;
  if not found
    or v_intent.provider_status <> 'approved'
    or v_intent.paid_amount is distinct from v_session.total
    or v_intent.currency <> 'ARS' then
    raise exception 'este checkout no tiene un cobro aprobado y verificado' using errcode = '55000';
  end if;
  if v_intent.order_id is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'order_id', v_intent.order_id);
  end if;
  if v_intent.internal_status in ('refunded', 'partially_refunded', 'charged_back') then
    raise exception 'el dinero de este cobro ya se movio' using errcode = '55000';
  end if;

  -- Si la reserva sigue viva no hace falta nada de esto: el camino normal
  -- alcanza y es el que tiene que correr.
  if exists (
    select 1 from public.inventory_reservations r
     where r.checkout_session_id = v_session.id
       and r.status = 'active'
       and r.expires_at > clock_timestamp()
  ) then
    update public.payment_intents
       set internal_status = 'approved_order_pending', security_review_reason = null
     where id = v_intent.id
       and internal_status = 'security_review_required';
    update public.checkout_sessions
       set status = 'payment_approved', manual_review_reason = null
     where id = v_session.id;
    return public.finalize_paid_checkout_session(v_session.id) || jsonb_build_object('reused_reservation', true);
  end if;

  -- Se mira TODO el pedido antes de descontar nada: media recuperación deja el
  -- stock movido y el pedido igual de inexistente.
  for v_item in
    select i.product_id, i.quantity, i.product_snapshot
      from public.checkout_session_items i
     where i.checkout_session_id = v_session.id
     order by i.product_id
  loop
    select * into v_product
      from public.products p
     where p.id = v_item.product_id
     for update;
    if not found or not v_product.is_active or v_product.stock is null
      or v_product.stock < v_item.quantity then
      v_faltantes := v_faltantes || jsonb_build_object(
        'product_id', v_item.product_id,
        'name', coalesce(v_item.product_snapshot ->> 'name', 'Producto'),
        'necesarias', v_item.quantity,
        'disponibles', coalesce(v_product.stock, 0)
      );
    end if;
  end loop;

  if jsonb_array_length(v_faltantes) > 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'stock_insuficiente',
      'missing', v_faltantes,
      'action', 'devolver_el_dinero_desde_el_panel'
    );
  end if;

  v_expires := clock_timestamp() + interval '10 minutes';
  select coalesce(max(r.reservation_generation), 0) + 1
    into v_generation
    from public.inventory_reservations r
   where r.checkout_session_id = v_session.id;

  for v_item in
    select i.product_id, i.quantity
      from public.checkout_session_items i
     where i.checkout_session_id = v_session.id
     order by i.product_id
  loop
    update public.products p
       set stock = p.stock - v_item.quantity,
           available = case when p.stock - v_item.quantity > 0 then p.available else false end
     where p.id = v_item.product_id;
    insert into public.inventory_reservations (
      checkout_session_id, product_id, quantity, expires_at, reservation_generation
    ) values (
      v_session.id, v_item.product_id, v_item.quantity, v_expires, v_generation
    );
  end loop;

  update public.checkout_sessions
     set expires_at = v_expires,
         status = 'payment_approved',
         manual_review_reason = null
   where id = v_session.id;
  update public.payment_intents
     set internal_status = 'approved_order_pending',
         security_review_reason = null
   where id = v_intent.id;
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (
    v_intent.id,
    'payment.order_recovered_by_operator',
    jsonb_build_object('actor_user_id', v_actor, 'reservation_generation', v_generation)
  );

  v_resultado := public.finalize_paid_checkout_session(v_session.id);
  return v_resultado || jsonb_build_object('recovered', true, 'reservation_generation', v_generation);
end;
$function$;

CREATE OR REPLACE FUNCTION public.can_recover_paid_checkout(p_payment_intent_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where pi.id = p_payment_intent_id
       and pi.order_id is null
       and cs.completed_order_id is null
       and pi.provider_status = 'approved'
       and pi.paid_amount is not distinct from cs.total
       and pi.internal_status not in ('refunded', 'partially_refunded', 'charged_back', 'completed')
  );
$function$;

CREATE OR REPLACE FUNCTION public.record_payment_refund_response_v2(p_refund_id uuid, p_provider_refund_id text, p_status text, p_amount numeric, p_response_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_refund public.payment_refunds%rowtype;
  v_intent public.payment_intents%rowtype;
  v_intent_id uuid;
  v_total numeric(12,2);
  v_provider_id text := nullif(btrim(coalesce(p_provider_refund_id,'')),'');
begin
  if p_response_hash is null or p_response_hash !~ '^[a-f0-9]{64}$'
    or p_status is null or p_status not in ('approved','rejected','ambiguous','failed')
    or p_amount is null or p_amount<=0 then
    raise exception 'respuesta de reembolso invalida' using errcode='22023';
  end if;
  select payment_intent_id into v_intent_id from public.payment_refunds where id=p_refund_id;
  if not found then raise exception 'reembolso inexistente' using errcode='P0002'; end if;
  select * into v_intent from public.payment_intents where id=v_intent_id for update;
  select * into v_refund from public.payment_refunds where id=p_refund_id for update;
  if not found or v_refund.payment_intent_id is distinct from v_intent_id then
    raise exception 'solicitud de reembolso cambio' using errcode='22023';
  end if;
  if p_amount is distinct from v_refund.amount then
    raise exception 'importe de reembolso no coincide' using errcode='22023';
  end if;
  if v_provider_id is distinct from v_refund.provider_refund_id
    or (p_status='approved' and v_provider_id is null) then
    raise exception 'identidad de reembolso no confirmada' using errcode='23505';
  end if;
  if v_refund.status in ('approved','rejected') then
    if v_refund.status<>p_status then
      raise exception 'resultado de reembolso ya confirmado' using errcode='55000';
    end if;
    return jsonb_build_object('ok',true,'payment_intent_id',v_intent_id,'idempotent',true);
  end if;
  if v_refund.status=p_status and v_refund.raw_response_hash=p_response_hash then
    return jsonb_build_object('ok',true,'payment_intent_id',v_intent_id,'idempotent',true);
  end if;
  update public.payment_refunds set status=p_status, raw_response_hash=p_response_hash,
    completed_at=case when p_status in ('approved','rejected') then clock_timestamp() else completed_at end
    where id=p_refund_id;
  if p_status='approved' then
    select coalesce(sum(amount),0) into v_total from public.payment_refunds
      where payment_intent_id=v_intent_id and status='approved';
    if v_intent.internal_status='security_review_required' then
      update public.payment_intents set refunded_amount=v_total where id=v_intent_id;
    else
      update public.payment_intents set refunded_amount=v_total,
        internal_status=case when v_total>=coalesce(paid_amount,expected_amount) then 'refunded' else 'partially_refunded' end
        where id=v_intent_id;
    end if;
  end if;
  insert into public.payment_events(payment_intent_id,event_type,details,raw_response_hash)
    values(v_intent_id,'payment.refund_'||p_status,jsonb_build_object('refund_id',p_refund_id,'amount',p_amount),p_response_hash);
  return jsonb_build_object('ok',true,'payment_intent_id',v_intent_id,'idempotent',false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_stock_reservation_alerts()
 RETURNS TABLE(severity text, checkout_session_id uuid, product_id uuid, quantity integer, expired_for interval, state text, action text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select
    case when r.expires_at < clock_timestamp() - interval '30 minutes' then 'critical' else 'warning' end,
    r.checkout_session_id,
    r.product_id,
    r.quantity,
    clock_timestamp() - r.expires_at,
    'stock_reservation_not_released',
    'verify_taba_checkout_expiry_sweep_cron_then_run_sweep_expired_checkout_sessions'
  from public.inventory_reservations r
  where r.status = 'active'
    and r.expires_at < clock_timestamp() - interval '5 minutes'
  order by r.expires_at;
$function$;

revoke all on function public.recover_paid_checkout_order(uuid) from public, anon;
grant execute on function public.recover_paid_checkout_order(uuid) to authenticated;
revoke all on function public.can_recover_paid_checkout(uuid) from public, anon;
grant execute on function public.can_recover_paid_checkout(uuid) to authenticated, service_role;
revoke all on function public.record_payment_refund_response_v2(uuid, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.record_payment_refund_response_v2(uuid, text, text, numeric, text) to service_role;
revoke all on function public.list_stock_reservation_alerts() from public, anon, authenticated;
grant execute on function public.list_stock_reservation_alerts() to service_role;

comment on function public.list_stock_reservation_alerts() is
  'Reservas de stock vencidas y no liberadas: señal de que el barrido no está corriendo.';

drop function public.release_manual_review_checkout_inventory(uuid, text, boolean);
drop function private.checkout_payment_money_is_out(public.payment_intents);

commit;
