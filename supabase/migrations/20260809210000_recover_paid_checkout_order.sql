-- ============================================================================
--  Armar el pedido de un cobro que entró y se quedó sin reserva.
-- ============================================================================
--
--  EL ÚNICO CASO QUE TODAVÍA EXIGÍA UNA PERSONA TÉCNICA
--  ----------------------------------------------------
--  El pago se aprueba y la reserva ya venció. `finalize_paid_checkout_session`
--  se niega —con razón: no puede crear un pedido sobre stock que ya se le
--  prometió a otro— y deja la sesión en `manual_review_required`.
--
--  Desde ahí el Panel ofrecía UNA salida: devolver el dinero. Si el producto
--  estaba disponible igual, la única forma de darle a esa persona lo que compró
--  era reponer el stock y crear el pedido a mano, contra la base. Es la
--  definición de «depende de que alguien mire SQL».
--
--  QUÉ HACE
--  --------
--  Vuelve a tomar el stock —con los mismos locks por producto, en el mismo
--  orden de UUID que `create_checkout_session`— y delega la creación del pedido
--  en `finalize_paid_checkout_session`, que es el camino ya certificado. No
--  duplica ni una línea de la lógica de alta: si algo no cierra, se niega ahí.
--
--  LO QUE NO HACE, QUE ES LO IMPORTANTE
--  ------------------------------------
--  Si el stock NO alcanza, no inventa un pedido que el negocio no puede cumplir:
--  devuelve qué falta y de cuánto, para que el operador devuelva el dinero
--  sabiendo por qué. Prometer una entrega imposible es peor que reembolsar.
--
--  Y no relaja ninguna verificación de dinero: exige pago aprobado por el
--  proveedor, importe idéntico al total de la sesión y moneda ARS. Un checkout
--  sin cobro confirmado no se puede «recuperar».
-- ============================================================================

create or replace function public.recover_paid_checkout_order(p_checkout_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
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
$$;

revoke all on function public.recover_paid_checkout_order(uuid) from public, anon;
grant execute on function public.recover_paid_checkout_order(uuid) to authenticated;

comment on function public.recover_paid_checkout_order(uuid) is
  'Owner/admin: rearma el pedido de un cobro aprobado cuya reserva vencio. Si el stock no alcanza no inventa el pedido: dice que falta para que el operador reembolse.';

-- La bandera que enciende el botón en el Panel —`can_recover_order` dentro de
-- `list_business_payments`— vive en 20260809200000, junto al resto de la
-- consulta, para no dejar dos definiciones completas de la misma función.
