-- Un checkout en revisión manual no pierde stock, no lo descuenta dos veces y no se arma sobre dinero devuelto.
--
-- QUÉ ESTABA ROTO (medido el 2026-10-01 sobre las 158 migraciones anteriores más
-- el guardián de admisión; cada caso es una transacción real, sin tocar funciones)
--
--   Una sesión llega a `manual_review_required` con su reserva todavía `active`
--   cuando el cobro se aprueba entre `expires_at` y el siguiente minuto del barrido
--   (`approved_after_reservation_expired`), o cuando el cobro se aprobó a tiempo y
--   `finalize_paid_checkout_session` corrió tarde (`finalization_without_active_reservation`).
--   Desde ahí:
--
--   1. Nadie la liberaba. El barrido no mira ese estado y
--      `release_checkout_session_inventory` lo saltea a propósito. Stock 10, compra de 3:
--      la reserva seguía `active` y vencida, el stock en 7, para siempre.
--   2. «Armar el pedido» descontaba otra vez. `recover_paid_checkout_order` sólo
--      reconocía una reserva si además no estaba vencida; si no, restaba de nuevo y
--      abría una segunda generación, y `finalize` convertía las dos:
--        stock 10, compra de 3  ->  stock 4, dos generaciones `converted`, UN pedido de 3.
--   3. Si el comprador se había llevado las últimas unidades, el rearmado contestaba
--      `stock_insuficiente` («hay 0, hacen falta 4») aunque esas 4 las retenía esa
--      misma sesión, y mandaba a devolver el dinero.
--   4. Devolver el dinero no devolvía las unidades: reembolso total aprobado, stock
--      en 7 y reserva `active` dos horas después.
--   5. Con el reembolso ya aprobado (total o parcial), pedido (`requested`) o dudoso
--      (`ambiguous`), `can_recover_paid_checkout` seguía en `true` y el rearmado
--      creaba un pedido `received` por el total: mercadería por plata devuelta.
--      El reembolso de un cobro en revisión no cambia `internal_status`, y eso era
--      lo único que el rearmado miraba.
--   6. `list_stock_reservation_alerts` avisaba de esas reservas y recetaba correr
--      el barrido, que no las puede liberar.
--   7. Un reembolso propio pisaba lo que el proveedor ya había informado
--      (devolución hecha en Mercado Pago por 500, reembolso del Panel por 300:
--      `refunded_amount` bajaba de 500 a 300), y si el proveedor ya informaba el
--      total devuelto, asentar la aprobación propia fallaba con
--      `payment intent status regression: refunded -> partially_refunded` y el
--      reembolso quedaba sin resolver.
--
-- QUÉ QUEDA
--
--   · `recover_paid_checkout_order` trata CUALQUIER reserva `active` de la sesión
--     como stock ya retenido, esté vencida o no: la extiende junto con la sesión y
--     finaliza sin descontar. Sólo vuelve a reservar lo que no tiene reserva activa,
--     todo o nada como antes. Y se niega (55000) si el cobro tiene dinero devuelto
--     o un reembolso en curso.
--   · `can_recover_paid_checkout` dice lo mismo, así el Panel no ofrece el botón.
--   · `record_payment_refund_response_v2`: cuando el reembolso aprobado completa el
--     total de un cobro SIN pedido, libera las reservas activas de esa sesión una
--     sola vez y devuelve stock y disponibilidad con la misma expresión que
--     `release_checkout_session_inventory`. Además nunca baja `refunded_amount` ni
--     retrocede el estado del cobro.
--   · `release_manual_review_checkout_inventory` es esa liberación. También la puede
--     correr el servicio para un cobro cuyo dinero salió por otro camino (devolución
--     hecha en Mercado Pago, contracargo, pago que el proveedor terminó rechazando).
--   · `list_stock_reservation_alerts` receta, por estado, algo que funciona.
--
-- QUÉ NO CAMBIA
--
--   · El barrido, `release_checkout_session_inventory` y `expire_checkout_sessions`
--     siguen salteando `manual_review_required`: liberar ahí sin saber qué pasó con
--     el dinero sería regalar las unidades de alguien que pagó.
--   · Un reembolso PARCIAL no toca stock. Un reembolso de un cobro CON pedido
--     tampoco: ese stock lo decide la cancelación del pedido.
--   · Firmas, dueños, `search_path`, privilegios y códigos de error de todas las
--     funciones redefinidas. El rearmado suma dos motivos de rechazo, los dos 55000
--     como el que ya existía («el dinero de este cobro ya se movio»).
--   · `record_payment_refund_response` (la versión anterior, sin Edge Function que
--     la llame y retirada por el contrato V5) no se toca: redefinirla la resucitaría
--     donde ya está retirada.
--   · No toca filas. Las sesiones que hoy ya están en este estado se resuelven con
--     las mismas acciones (rearmar, reembolsar o la liberación del servicio).
--
-- Forward-only. Reversión: docs/migrations/rollback/20261001203000_manual_review_checkout_keeps_stock_exact.rollback.sql

-- ── 1. Cuándo el dinero de un cobro ya no está ──────────────────────────────
-- Una sola definición para la liberación y para la alerta: si cada una llevara su
-- copia, la alerta terminaría recetando una liberación que la función rechaza.
create or replace function private.checkout_payment_money_is_out(p_intent public.payment_intents)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    p_intent.internal_status in ('refunded', 'charged_back')
    or p_intent.provider_status in ('refunded', 'charged_back')
    or p_intent.refunded_amount >= coalesce(p_intent.paid_amount, p_intent.expected_amount)
    -- Nunca hubo cobro aprobado y el proveedor ya lo cerró sin cobrar.
    or (p_intent.approved_at is null
        and p_intent.provider_status in ('rejected', 'cancelled', 'canceled', 'expired')),
    false
  );
$$;

revoke all on function private.checkout_payment_money_is_out(public.payment_intents)
  from public, anon, authenticated, service_role;

comment on function private.checkout_payment_money_is_out(public.payment_intents) is
  'El dinero de este cobro ya no esta: devuelto por completo, contracargado, o el proveedor lo cerro sin haberlo aprobado nunca.';

-- ── 2. Liberar el stock de una sesión en revisión cuyo dinero ya salió ──────
create or replace function public.release_manual_review_checkout_inventory(
  p_payment_intent_id uuid,
  p_reason text default 'money_returned_without_order',
  p_money_verified_out boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_intent public.payment_intents%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_released integer := 0;
begin
  -- El candado es el del COBRO, no el de la sesión. Quien llama desde el asiento
  -- de un reembolso ya lo tiene; tomar además el de la sesión invertiría el orden
  -- de `recover_paid_checkout_order` y `finalize_paid_checkout_session`
  -- (sesión -> cobro) y un rearmado simultáneo terminaría en deadlock. Alcanza:
  -- los únicos que tocan las reservas de una sesión en revisión son esas dos
  -- funciones y el asiento de un snapshot, y las tres toman este candado antes.
  select * into v_intent
    from public.payment_intents pi
   where pi.id = p_payment_intent_id
   for update;
  if not found then
    raise exception 'payment intent inexistente' using errcode = 'P0002';
  end if;
  select * into v_session
    from public.checkout_sessions s
   where s.id = v_intent.checkout_session_id;

  if v_intent.order_id is not null or v_session.completed_order_id is not null then
    return jsonb_build_object('released', 0, 'skipped', true, 'reason', 'order_exists');
  end if;
  if v_session.status <> 'manual_review_required' then
    return jsonb_build_object('released', 0, 'skipped', true, 'reason', 'not_in_manual_review',
      'status', v_session.status);
  end if;
  if not private.checkout_payment_money_is_out(v_intent) then
    -- Lo que la base no puede saber sola: un cobro que nunca pudo validarse
    -- (importe o cuenta que no coinciden) y que alguien devolvió desde Mercado
    -- Pago. Soporte lo atestigua, pero sólo si acá no figura un cobro aprobado
    -- (ese se reembolsa desde el Panel y se libera solo) y la reserva ya venció.
    if not coalesce(p_money_verified_out, false)
      or v_intent.provider_status is not distinct from 'approved'
      or v_session.expires_at > clock_timestamp() then
      return jsonb_build_object('released', 0, 'skipped', true, 'reason', 'money_not_returned');
    end if;
  end if;

  -- Mismo orden de candados por producto que el resto del inventario.
  perform 1
    from public.products p
    join public.inventory_reservations r on r.product_id = p.id
   where r.checkout_session_id = v_session.id and r.status = 'active'
   order by p.id
   for update of p;
  for v_reservation in
    select * from public.inventory_reservations r
     where r.checkout_session_id = v_session.id and r.status = 'active'
     order by r.product_id, r.reservation_generation
     for update
  loop
    update public.products p
       set stock = p.stock + v_reservation.quantity,
           available = p.merchant_available
                       and p.is_active
                       and p.is_verified
                       and (p.stock + v_reservation.quantity) > 0
                       and p.price_status = 'confirmed'
                       and p.price > 0
     where p.id = v_reservation.product_id;
    update public.inventory_reservations
       set status = 'released', released_at = clock_timestamp(),
           release_reason = left(coalesce(nullif(btrim(p_reason), ''), 'money_returned_without_order'), 120)
     where id = v_reservation.id and status = 'active';
    v_released := v_released + 1;
  end loop;

  if v_released > 0 then
    insert into public.payment_events (payment_intent_id, event_type, details)
    values (
      v_intent.id,
      'payment.manual_review_stock_released',
      jsonb_build_object(
        'released', v_released,
        'reason', left(coalesce(nullif(btrim(p_reason), ''), 'money_returned_without_order'), 120),
        'attested_by_support', not private.checkout_payment_money_is_out(v_intent)
      )
    );
  end if;
  -- La sesión queda en `manual_review_required`: es lo que impide pedir otra
  -- preferencia de pago sobre un checkout cuyo dinero ya se devolvió.
  return jsonb_build_object('released', v_released, 'skipped', false);
end;
$$;

revoke all on function public.release_manual_review_checkout_inventory(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.release_manual_review_checkout_inventory(uuid, text, boolean)
  to service_role;

comment on function public.release_manual_review_checkout_inventory(uuid, text, boolean) is
  'Devuelve una sola vez el stock retenido por un checkout en revision manual, sin pedido, cuyo dinero ya salio. Con p_money_verified_out soporte atestigua una devolucion que la base no puede ver.';

-- ── 3. Rearmar el pedido: una reserva activa es stock retenido, venza o no ──
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
  v_rereservados integer := 0;
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
  -- El reembolso de un cobro en revisión no cambia `internal_status`: hay que
  -- mirar el importe y las solicitudes. Todos los que escriben `payment_refunds`
  -- toman antes el candado del cobro que esta función ya tiene, así que la
  -- consulta no corre contra un reembolso que se está creando.
  if coalesce(v_intent.refunded_amount, 0) > 0 or exists (
    select 1 from public.payment_refunds r
     where r.payment_intent_id = v_intent.id and r.status = 'approved'
  ) then
    raise exception 'este cobro ya tiene dinero devuelto' using
      errcode = '55000', detail = 'PAYMENT_REFUND_RECORDED';
  end if;
  if exists (
    select 1 from public.payment_refunds r
     where r.payment_intent_id = v_intent.id
       and r.status in ('requested', 'processing', 'ambiguous')
  ) then
    raise exception 'este cobro tiene un reembolso en curso' using
      errcode = '55000', detail = 'PAYMENT_REFUND_IN_FLIGHT';
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
  -- Una reserva `active` de esta sesión es stock que ya se descontó para ella,
  -- aunque esté vencida: mientras nadie la libere, esas unidades no volvieron al
  -- producto. Sólo se pide al stock lo que no tiene reserva activa (`pendientes`).
  for v_item in
    select i.product_id, i.quantity, i.product_snapshot,
           greatest(i.quantity - coalesce((
             select sum(r.quantity)
               from public.inventory_reservations r
              where r.checkout_session_id = v_session.id
                and r.product_id = i.product_id
                and r.status = 'active'
           ), 0), 0)::integer as pendientes
      from public.checkout_session_items i
     where i.checkout_session_id = v_session.id
     order by i.product_id
  loop
    select * into v_product
      from public.products p
     where p.id = v_item.product_id
     for update;
    if v_item.pendientes > 0 and (
      not found or not v_product.is_active or v_product.stock is null
      or v_product.stock < v_item.pendientes
    ) then
      v_faltantes := v_faltantes || jsonb_build_object(
        'product_id', v_item.product_id,
        'name', coalesce(v_item.product_snapshot ->> 'name', 'Producto'),
        'necesarias', v_item.pendientes,
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
    select i.product_id,
           greatest(i.quantity - coalesce((
             select sum(r.quantity)
               from public.inventory_reservations r
              where r.checkout_session_id = v_session.id
                and r.product_id = i.product_id
                and r.status = 'active'
           ), 0), 0)::integer as pendientes
      from public.checkout_session_items i
     where i.checkout_session_id = v_session.id
     order by i.product_id
  loop
    continue when v_item.pendientes = 0;
    update public.products p
       set stock = p.stock - v_item.pendientes,
           available = case when p.stock - v_item.pendientes > 0 then p.available else false end
     where p.id = v_item.product_id;
    insert into public.inventory_reservations (
      checkout_session_id, product_id, quantity, expires_at, reservation_generation
    ) values (
      v_session.id, v_item.product_id, v_item.pendientes, v_expires, v_generation
    );
    v_rereservados := v_rereservados + 1;
  end loop;

  -- `finalize_paid_checkout_session` exige sesión y reserva sin vencer: lo que
  -- ya estaba retenido se extiende en lugar de volver a descontarse.
  update public.inventory_reservations r
     set expires_at = v_expires
   where r.checkout_session_id = v_session.id
     and r.status = 'active'
     and r.expires_at < v_expires;

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
    jsonb_build_object(
      'actor_user_id', v_actor,
      'reservation_generation', case when v_rereservados > 0 then v_generation else v_generation - 1 end,
      'reused_reservation', v_rereservados = 0
    )
  );

  v_resultado := public.finalize_paid_checkout_session(v_session.id);
  return v_resultado || jsonb_build_object(
    'recovered', true,
    'reservation_generation', case when v_rereservados > 0 then v_generation else v_generation - 1 end,
    'reused_reservation', v_rereservados = 0
  );
end;
$$;

revoke all on function public.recover_paid_checkout_order(uuid) from public, anon, authenticated;
grant execute on function public.recover_paid_checkout_order(uuid) to authenticated;

-- ── 4. El Panel ofrece rearmar sólo cuando el rearmado va a aceptar ─────────
create or replace function public.can_recover_paid_checkout(p_payment_intent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
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
       and coalesce(pi.refunded_amount, 0) = 0
       and not exists (
         select 1 from public.payment_refunds r
          where r.payment_intent_id = pi.id
            and r.status in ('requested', 'processing', 'ambiguous', 'approved')
       )
  );
$$;

revoke all on function public.can_recover_paid_checkout(uuid) from public, anon, authenticated;
grant execute on function public.can_recover_paid_checkout(uuid) to authenticated, service_role;

-- ── 5. Asentar la respuesta de un reembolso ─────────────────────────────────
create or replace function public.record_payment_refund_response_v2(
  p_refund_id uuid,
  p_provider_refund_id text,
  p_status text,
  p_amount numeric,
  p_response_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_refund public.payment_refunds%rowtype;
  v_intent public.payment_intents%rowtype;
  v_intent_id uuid;
  v_total numeric(12,2);
  v_next text;
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
    -- Lo que el proveedor ya informó (devoluciones hechas en Mercado Pago, o el
    -- aviso de este mismo reembolso que llegó antes que su respuesta) no se pisa
    -- con la suma local, que puede ser menor.
    v_total := greatest(v_total, v_intent.refunded_amount);
    if v_intent.internal_status='security_review_required' then
      update public.payment_intents set refunded_amount=v_total where id=v_intent_id;
    else
      -- El estado sólo avanza: un cobro que el proveedor ya dio por devuelto o
      -- contracargado no retrocede por asentar un reembolso propio.
      v_next := case when v_total>=coalesce(v_intent.paid_amount,v_intent.expected_amount) then 'refunded' else 'partially_refunded' end;
      update public.payment_intents set refunded_amount=v_total,
        internal_status=case
          when public.payment_internal_status_rank(v_next)>public.payment_internal_status_rank(internal_status) then v_next
          else internal_status end
        where id=v_intent_id;
    end if;
    -- Dinero devuelto por completo y ningún pedido: las unidades que esa sesión
    -- retenía en revisión vuelven al producto. La función decide sola si aplica
    -- (sesión en revisión, sin pedido) y no libera dos veces.
    if v_intent.order_id is null
      and v_total>=coalesce(v_intent.paid_amount,v_intent.expected_amount) then
      perform public.release_manual_review_checkout_inventory(v_intent_id,'refund_approved_without_order',false);
    end if;
  end if;
  insert into public.payment_events(payment_intent_id,event_type,details,raw_response_hash)
    values(v_intent_id,'payment.refund_'||p_status,jsonb_build_object('refund_id',p_refund_id,'amount',p_amount),p_response_hash);
  return jsonb_build_object('ok',true,'payment_intent_id',v_intent_id,'idempotent',false);
end;
$$;

revoke all on function public.record_payment_refund_response_v2(uuid, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.record_payment_refund_response_v2(uuid, text, text, numeric, text)
  to service_role;

-- ── 6. La alerta receta algo que funciona en cada estado ────────────────────
create or replace function public.list_stock_reservation_alerts()
returns table (
  severity text,
  checkout_session_id uuid,
  product_id uuid,
  quantity integer,
  expired_for interval,
  state text,
  action text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    case when r.expires_at < clock_timestamp() - interval '30 minutes' then 'critical' else 'warning' end,
    r.checkout_session_id,
    r.product_id,
    r.quantity,
    clock_timestamp() - r.expires_at,
    case
      when cs.status = 'manual_review_required' then 'stock_held_by_checkout_in_manual_review'
      when cs.status in ('payment_approved', 'finalizing_order') then 'stock_held_by_paid_checkout_without_order'
      else 'stock_reservation_not_released'
    end,
    case
      -- El barrido no toca estos estados: recetarlo era mandar a alguien a
      -- correr algo que devuelve 0.
      when cs.status = 'manual_review_required' and pi.id is not null
        and private.checkout_payment_money_is_out(pi)
        then 'run_release_manual_review_checkout_inventory_for_the_payment_intent'
      -- Con un reembolso a medias ni rearmar ni reembolsar avanzan: primero hay
      -- que resolver esa solicitud.
      when cs.status = 'manual_review_required' and exists (
        select 1 from public.payment_refunds pr
         where pr.payment_intent_id = pi.id
           and pr.status in ('requested', 'processing', 'ambiguous')
      ) then 'resolve_refund_in_flight_from_panel_then_recover_order_or_refund'
      when cs.status = 'manual_review_required' and pi.provider_status = 'approved'
        then 'recover_order_or_refund_payment_from_panel'
      when cs.status = 'manual_review_required'
        then 'reconcile_payment_from_panel_then_recover_order_or_refund_or_release_with_support_attestation'
      when cs.status in ('payment_approved', 'finalizing_order')
        then 'verify_payment_worker_then_recover_order_from_panel'
      else 'verify_taba_checkout_expiry_sweep_cron_then_run_sweep_expired_checkout_sessions'
    end
  from public.inventory_reservations r
  join public.checkout_sessions cs on cs.id = r.checkout_session_id
  left join public.payment_intents pi on pi.checkout_session_id = cs.id
  where r.status = 'active'
    and r.expires_at < clock_timestamp() - interval '5 minutes'
  order by r.expires_at;
$$;

revoke all on function public.list_stock_reservation_alerts() from public, anon, authenticated;
grant execute on function public.list_stock_reservation_alerts() to service_role;

comment on function public.list_stock_reservation_alerts() is
  'Reservas de stock vencidas y no liberadas, con el estado de su checkout y la accion que las resuelve: el barrido para un checkout sin pagar, el Panel o la liberacion del servicio para uno en revision manual.';
