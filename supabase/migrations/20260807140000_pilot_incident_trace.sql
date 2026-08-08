-- "¿Dónde se rompió LT-0086?" contestado en una consulta y sin PII.
--
-- El correlation_id existe desde 20260802180000 y atraviesa checkout, pago,
-- pedido, packing y fiscal. Lo que no existía era la lectura: para seguir un
-- pedido roto había que abrir seis tablas a mano, y quien lo hacía terminaba
-- mirando `customer_name`, `delivery_street` y el hash del correo del pagador
-- para orientarse. Un diagnóstico no necesita saber quién es el cliente.
--
-- Esta función recorre las ocho etapas del circuito en orden y dice cuál fue la
-- primera que no ocurrió o que quedó trabada. Devuelve estados, instantes y
-- contadores. No devuelve nombre, teléfono, dirección, coordenadas, correo,
-- hash del pagador, token de seguimiento, código de entrega ni texto libre del
-- proveedor.
--
-- Acepta lo que el operador tiene a mano: el código público (LT-0086), el
-- correlation_id, el id del pedido o el de la sesión de checkout.

create or replace function public.trace_pilot_order(
  p_business_id uuid,
  p_reference text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $trace_pilot_order$
declare
  v_now timestamptz := clock_timestamp();
  v_reference text := btrim(coalesce(p_reference, ''));
  v_uuid uuid;
  v_order public.orders%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_correlation uuid;
  v_resolved text := 'not_found';
  v_stages jsonb := '[]'::jsonb;
  v_break jsonb := null;
  v_expects_online_payment boolean;
  v_notice record;
  v_panel record;
  v_rider record;
  v_status text;
  v_thresholds jsonb;
  v_accept_sla integer;
  v_rider_sla integer;
  v_delivery_sla integer;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  -- Las mismas ventanas que usan el tablero y las alertas: una etapa "esperando"
  -- pasado el umbral es una etapa trabada, y las tres superficies coinciden.
  v_thresholds := public.pilot_ops_thresholds(p_business_id);
  v_accept_sla := (v_thresholds #>> '{order_acceptance_minutes,value}')::integer;
  v_rider_sla := (v_thresholds #>> '{rider_assignment_minutes,value}')::integer;
  v_delivery_sla := (v_thresholds #>> '{delivery_minutes,value}')::integer;
  if v_reference = '' or char_length(v_reference) > 128 then
    raise exception 'referencia invalida' using errcode = '22023';
  end if;

  begin
    v_uuid := v_reference::uuid;
  exception when others then
    v_uuid := null;
  end;

  -- ===== Resolución de la referencia =====
  if v_uuid is not null then
    select * into v_order from public.orders o
     where o.business_id = p_business_id and (o.id = v_uuid or o.correlation_id = v_uuid) limit 1;
    if not found then
      select * into v_session from public.checkout_sessions s
       where s.business_id = p_business_id and (s.id = v_uuid or s.correlation_id = v_uuid) limit 1;
    end if;
  else
    select * into v_order from public.orders o
     where o.business_id = p_business_id
       and (upper(o.public_code) = upper(v_reference) or upper(o.code) = upper(v_reference))
     limit 1;
    if not found then
      select * into v_session from public.checkout_sessions s
       where s.business_id = p_business_id and s.client_request_id = v_reference limit 1;
    end if;
  end if;

  if v_order.id is not null then
    v_resolved := 'order';
    v_correlation := v_order.correlation_id;
    select * into v_session from public.checkout_sessions s
     where s.completed_order_id = v_order.id or s.correlation_id = v_order.correlation_id limit 1;
  elsif v_session.id is not null then
    v_resolved := 'checkout';
    v_correlation := v_session.correlation_id;
    select * into v_order from public.orders o
     where o.business_id = p_business_id and o.correlation_id = v_session.correlation_id limit 1;
  else
    return jsonb_build_object(
      'generated_at', v_now,
      'business_id', p_business_id,
      'resolved_as', 'not_found',
      'reason', 'No hay pedido ni checkout de este negocio con esa referencia.',
      'privacy', jsonb_build_object('pii_included', false)
    );
  end if;

  if v_session.id is not null then
    select * into v_intent from public.payment_intents pi where pi.checkout_session_id = v_session.id limit 1;
  end if;
  if v_intent.id is null and v_correlation is not null then
    select * into v_intent from public.payment_intents pi
     where pi.business_id = p_business_id and pi.correlation_id = v_correlation limit 1;
  end if;

  -- Un pedido de efectivo o coordinado no pasa por el proveedor: sus etapas de
  -- pago no son un hueco, son otro camino.
  v_expects_online_payment := coalesce(v_order.payment_method, 'mercadopago') = 'mercadopago'
    or v_session.id is not null;

  -- ===== 1. Storefront =====
  if v_session.id is not null then
    v_stages := v_stages || jsonb_build_object(
      'stage', 'storefront', 'label', 'Carrito y datos',
      'status', 'ok', 'at', v_session.created_at,
      'detail', 'El cliente armó el pedido y llegó al checkout.',
      'evidence', jsonb_build_object('items', (
        select count(*) from public.checkout_session_items i where i.checkout_session_id = v_session.id
      ))
    );
  elsif v_expects_online_payment then
    v_stages := v_stages || jsonb_build_object(
      'stage', 'storefront', 'label', 'Carrito y datos',
      'status', 'missing', 'at', null,
      'detail', 'No hay sesión de checkout ligada a este pedido.',
      'evidence', '{}'::jsonb
    );
  else
    v_stages := v_stages || jsonb_build_object(
      'stage', 'storefront', 'label', 'Carrito y datos',
      'status', 'not_applicable', 'at', null,
      'detail', 'El pedido no nació en la web.', 'evidence', '{}'::jsonb
    );
  end if;

  -- ===== 2. Checkout =====
  if v_session.id is not null then
    v_status := case
      when v_session.status in ('completed', 'payment_approved', 'finalizing_order') then 'ok'
      when v_session.status = 'manual_review_required' then 'stalled'
      when v_session.status in ('cancelled', 'expired') then 'failed'
      when v_session.expires_at <= v_now then 'stalled'
      else 'in_progress'
    end;
    v_stages := v_stages || jsonb_build_object(
      'stage', 'checkout', 'label', 'Checkout',
      'status', v_status, 'at', v_session.updated_at,
      'detail', case v_session.status
        when 'manual_review_required' then 'El checkout quedó marcado para revisión manual.'
        when 'expired' then 'El checkout venció antes de completarse.'
        when 'cancelled' then 'El checkout se canceló.'
        else 'Estado del checkout: ' || v_session.status || '.'
      end,
      'evidence', jsonb_build_object(
        'state', public.checkout_pipeline_state(v_session.status, v_session.expires_at),
        'raw_status', v_session.status,
        'total', v_session.total,
        'expires_at', v_session.expires_at,
        'reservations_active', (
          select count(*) from public.inventory_reservations r
           where r.checkout_session_id = v_session.id and r.status = 'active'
        ),
        'manual_review_reason', v_session.manual_review_reason
      )
    );
  else
    v_stages := v_stages || jsonb_build_object(
      'stage', 'checkout', 'label', 'Checkout',
      'status', case when v_expects_online_payment then 'missing' else 'not_applicable' end,
      'at', null, 'detail', 'Sin sesión de checkout.', 'evidence', '{}'::jsonb
    );
  end if;

  -- ===== 3. Pago con el proveedor =====
  if v_intent.id is not null then
    v_status := case
      when v_intent.internal_status in ('approved', 'approved_order_pending', 'completed') then 'ok'
      when v_intent.internal_status in ('ambiguous', 'security_review_required') then 'stalled'
      when v_intent.internal_status in ('rejected', 'cancelled', 'expired', 'failed', 'charged_back') then 'failed'
      when v_intent.internal_status in ('refunded', 'partially_refunded') then 'reversed'
      else 'in_progress'
    end;
    v_stages := v_stages || jsonb_build_object(
      'stage', 'payment', 'label', 'Pago',
      'status', v_status,
      'at', coalesce(v_intent.approved_at, v_intent.rejected_at, v_intent.updated_at),
      'detail', 'Estado interno del pago: ' || v_intent.internal_status || '.',
      'evidence', jsonb_build_object(
        'internal_status', v_intent.internal_status,
        'provider_status', v_intent.provider_status,
        'provider_payment_id', v_intent.provider_payment_id,
        'expected_amount', v_intent.expected_amount,
        'paid_amount', v_intent.paid_amount,
        'refunded_amount', v_intent.refunded_amount,
        'amount_matches', coalesce(v_intent.paid_amount is null or v_intent.paid_amount = v_intent.expected_amount, true),
        'security_review_reason', v_intent.security_review_reason,
        'linked_order', v_intent.order_id is not null
      )
    );
  else
    v_stages := v_stages || jsonb_build_object(
      'stage', 'payment', 'label', 'Pago',
      'status', case when v_expects_online_payment then 'missing' else 'not_applicable' end,
      'at', null,
      'detail', case when v_expects_online_payment
        then 'No se creó ningún intento de pago para este checkout.'
        else 'El pedido no se cobra por el proveedor.' end,
      'evidence', jsonb_build_object('payment_method', v_order.payment_method)
    );
  end if;

  -- ===== 4. Aviso del proveedor =====
  select
    count(*) as total,
    count(*) filter (where r.processing_status = 'completed') as completed,
    count(*) filter (where r.processing_status = 'rejected_signature') as rejected,
    count(*) filter (where r.processing_status in ('failed', 'dead_letter')) as failed,
    max(r.received_at) as last_at
    into v_notice
    from public.payment_webhook_receipts r
   where v_intent.id is not null
     and (
       (v_intent.provider_payment_id is not null and r.resource_id = v_intent.provider_payment_id)
       or (v_intent.provider_merchant_order_id is not null and r.resource_id = v_intent.provider_merchant_order_id)
     );

  v_status := case
    when v_intent.id is null then case when v_expects_online_payment then 'missing' else 'not_applicable' end
    when coalesce(v_notice.failed, 0) > 0 then 'failed'
    when coalesce(v_notice.rejected, 0) > 0 then 'stalled'
    when coalesce(v_notice.completed, 0) > 0 then 'ok'
    when coalesce(v_notice.total, 0) > 0 then 'in_progress'
    when v_intent.internal_status in ('created', 'preference_creating', 'preference_created') then 'not_reached'
    else 'missing'
  end;
  v_stages := v_stages || jsonb_build_object(
    'stage', 'provider_notice', 'label', 'Aviso del proveedor',
    'status', v_status, 'at', v_notice.last_at,
    'detail', case v_status
      when 'missing' then 'El proveedor nunca avisó de este pago.'
      when 'stalled' then 'Llegaron avisos con firma inválida.'
      when 'failed' then 'Hubo avisos que no se pudieron procesar.'
      when 'not_reached' then 'Todavía no correspondía un aviso.'
      when 'not_applicable' then 'El pedido no se cobra por el proveedor.'
      when 'in_progress' then 'Llegó un aviso y todavía se está procesando.'
      else 'Los avisos llegaron y se procesaron.'
    end,
    'evidence', jsonb_build_object(
      'received', coalesce(v_notice.total, 0),
      'completed', coalesce(v_notice.completed, 0),
      'rejected_signature', coalesce(v_notice.rejected, 0),
      'failed', coalesce(v_notice.failed, 0)
    )
  );

  -- ===== 5. Pedido =====
  if v_order.id is not null then
    v_stages := v_stages || jsonb_build_object(
      'stage', 'order', 'label', 'Pedido',
      'status', case
        when public.order_pipeline_state(v_order.status) in ('cancelled', 'rejected') then 'failed'
        else 'ok' end,
      'at', v_order.created_at,
      'detail', 'El pedido existe con estado ' || public.order_pipeline_state(v_order.status) || '.',
      'evidence', jsonb_build_object(
        'public_code', v_order.public_code,
        'state', public.order_pipeline_state(v_order.status),
        'origin', v_order.origin,
        'delivery_mode', v_order.delivery_mode,
        'payment_method', v_order.payment_method,
        'total', v_order.total,
        'revision', v_order.revision,
        'items', (select count(*) from public.order_items i where i.order_id = v_order.id)
      )
    );
  else
    v_stages := v_stages || jsonb_build_object(
      'stage', 'order', 'label', 'Pedido',
      'status', 'missing', 'at', null,
      'detail', 'El pedido nunca se creó.',
      'evidence', '{}'::jsonb
    );
  end if;

  -- ===== 6. Panel =====
  select
    count(*) as commands,
    max(c.created_at) as last_at
    into v_panel
    from public.business_command_receipts c
   where v_order.id is not null and c.order_id = v_order.id;

  v_status := case
    when v_order.id is null then 'not_reached'
    when v_order.acknowledged_at is not null or coalesce(v_panel.commands, 0) > 0 then 'ok'
    when public.order_pipeline_state(v_order.status) = 'received'
      and v_order.created_at < v_now - make_interval(mins => v_accept_sla) then 'stalled'
    when public.order_pipeline_state(v_order.status) = 'received' then 'pending'
    else 'unknown'
  end;
  v_stages := v_stages || jsonb_build_object(
    'stage', 'panel', 'label', 'Panel del negocio',
    'status', v_status, 'at', coalesce(v_order.acknowledged_at, v_panel.last_at),
    'detail', case v_status
      when 'pending' then 'El negocio todavía no tocó este pedido.'
      when 'stalled' then 'El pedido lleva más de ' || v_accept_sla || ' minuto(s) sin que el negocio lo acepte.'
      when 'not_reached' then 'Sin pedido no hay nada que operar.'
      when 'unknown' then 'El pedido avanzó sin dejar comando del Panel.'
      else 'El negocio operó este pedido.'
    end,
    'evidence', jsonb_build_object(
      'acknowledged', v_order.acknowledged_at is not null,
      'panel_commands', coalesce(v_panel.commands, 0),
      'accepted_at', v_order.accepted_at,
      'ready_at', v_order.ready_at
    )
  );

  -- ===== 7. Rider =====
  select
    count(*) as signals,
    max(rl.created_at) as last_at
    into v_rider
    from public.rider_locations rl
   where v_order.id is not null and rl.order_id = v_order.id;

  v_status := case
    when v_order.id is null then 'not_reached'
    when v_order.delivery_mode <> 'delivery' then 'not_applicable'
    when v_order.assigned_rider_user_id is not null then 'ok'
    when public.order_pipeline_state(v_order.status) = 'ready'
      and coalesce(v_order.ready_at, v_order.updated_at) < v_now - make_interval(mins => v_rider_sla) then 'stalled'
    when public.order_pipeline_state(v_order.status) = 'ready' then 'pending'
    when public.order_pipeline_state(v_order.status) in ('delivered') then 'unknown'
    else 'not_reached'
  end;
  v_stages := v_stages || jsonb_build_object(
    'stage', 'rider', 'label', 'Rider',
    'status', v_status, 'at', coalesce(v_rider.last_at, v_order.picked_up_at),
    'detail', case v_status
      when 'pending' then 'El pedido está listo y ningún rider lo tomó.'
      when 'stalled' then 'El pedido está listo hace más de ' || v_rider_sla || ' minuto(s) y ningún rider lo tomó.'
      when 'not_applicable' then 'El pedido es para retirar.'
      when 'unknown' then 'Se entregó sin rider asignado registrado.'
      when 'not_reached' then 'Todavía no corresponde un rider.'
      else 'Hay un rider asignado.'
    end,
    'evidence', jsonb_build_object(
      'rider_assigned', v_order.assigned_rider_user_id is not null,
      'location_signals', coalesce(v_rider.signals, 0),
      'picked_up_at', v_order.picked_up_at,
      'arrived_at', v_order.arrived_at
    )
  );

  -- ===== 8. Entrega =====
  v_status := case
    when v_order.id is null then 'not_reached'
    when v_order.delivered_at is not null then 'ok'
    when public.order_pipeline_state(v_order.status) in ('cancelled', 'rejected') then 'failed'
    when public.order_pipeline_state(v_order.status) in ('assigned', 'picked_up', 'on_the_way', 'arrived')
      and coalesce(v_order.ready_at, v_order.accepted_at, v_order.created_at)
          < v_now - make_interval(mins => v_delivery_sla) then 'stalled'
    when public.order_pipeline_state(v_order.status) = 'arrived' then 'pending'
    else 'not_reached'
  end;
  v_stages := v_stages || jsonb_build_object(
    'stage', 'delivery', 'label', 'Entrega',
    'status', v_status, 'at', v_order.delivered_at,
    'detail', case v_status
      when 'ok' then 'El pedido se entregó con el código del cliente.'
      when 'failed' then 'El pedido se cerró sin entregar.'
      when 'pending' then 'El rider llegó y todavía no confirmó la entrega.'
      when 'stalled' then 'La entrega pasó los ' || v_delivery_sla || ' minuto(s) esperados y sigue abierta.'
      else 'La entrega todavía no ocurrió.'
    end,
    'evidence', jsonb_build_object(
      'delivered_at', v_order.delivered_at,
      'cancelled_at', coalesce(v_order.cancelled_at, v_order.canceled_at),
      'rejected_at', v_order.rejected_at,
      'confirmations', (
        select count(*) from public.rider_delivery_operations op
         where v_order.id is not null and op.order_id = v_order.id
      )
    )
  );

  -- ===== Punto de ruptura =====
  -- La primera etapa fallada o trabada manda. Si ninguna falló pero una que
  -- debía ocurrir no ocurrió, ésa es la ruptura. Un circuito sano no devuelve
  -- ninguna: mejor decir "no encontré dónde" que señalar cualquier cosa.
  select jsonb_build_object(
    'stage', stage_row.value ->> 'stage',
    'label', stage_row.value ->> 'label',
    'status', stage_row.value ->> 'status',
    'reason', stage_row.value ->> 'detail'
  ) into v_break
  from jsonb_array_elements(v_stages) with ordinality as stage_row(value, position)
  where stage_row.value ->> 'status' in ('failed', 'stalled', 'missing')
  order by
    case stage_row.value ->> 'status' when 'failed' then 1 when 'stalled' then 2 else 3 end,
    stage_row.position
  limit 1;

  return jsonb_build_object(
    'generated_at', v_now,
    'business_id', p_business_id,
    'reference', v_reference,
    'resolved_as', v_resolved,
    'correlation_id', v_correlation,
    'public_code', v_order.public_code,
    'stages', v_stages,
    'break_point', v_break,
    -- Cronología saneada: qué pasó y cuándo, nunca quién ni dónde.
    'timeline', coalesce((
      select jsonb_agg(entry order by entry ->> 'at')
      from (
        select jsonb_build_object(
          'source', 'order',
          'type', coalesce(e.event_type, e.type),
          'actor_role', e.actor_role,
          'at', e.created_at
        ) as entry
        from public.order_events e
        where v_order.id is not null and e.order_id = v_order.id
        union all
        select jsonb_build_object(
          'source', 'payment',
          'type', pe.event_type,
          'actor_role', 'system',
          'at', pe.server_recorded_at
        )
        from public.payment_events pe
        where v_intent.id is not null and pe.payment_intent_id = v_intent.id
      ) entries
    ), '[]'::jsonb),
    'privacy', jsonb_build_object(
      'pii_included', false,
      'note', 'Sin nombre, teléfono, dirección, coordenadas, correo, token de seguimiento ni código de entrega.'
    )
  );
end;
$trace_pilot_order$;

revoke execute on function public.trace_pilot_order(uuid, text) from public, anon;
grant execute on function public.trace_pilot_order(uuid, text) to authenticated;

comment on function public.trace_pilot_order(uuid, text) is
  'Recorre storefront, checkout, pago, aviso, pedido, Panel, rider y entrega para un pedido y señala la primera etapa rota. No expone PII ni secretos.';
