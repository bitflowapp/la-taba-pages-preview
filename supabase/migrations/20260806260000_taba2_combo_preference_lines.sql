-- TABA2 · La preferencia de Mercado Pago muestra el combo, no sus partes.
--
-- Medido sobre staging: una compra de combo no llegaba a Checkout Pro. El
-- `payment_attempt` quedaba `ambiguous` con `network_or_timeout`, que es el
-- catch-all del Edge Function para cualquier excepcion, no solo para un fallo
-- de red. La excepcion real era del armador de la preferencia:
--
--   itemsTotal = 4 x 2925 = 11700   (componentes a precio de lista)
--   total autoritativo    = 10650   (11700 - 1200 de combo + 150 de envio)
--   surcharge = 10650 - 11700 = -1050  ->  "Preference items exceed the
--                                           server-side checkout total"
--
-- El guard estaba bien: hasta hoy el total nunca podia quedar por debajo de la
-- suma de los items, porque no existia ningun descuento. Lo que faltaba era que
-- la preferencia supiera que un combo se RESERVA por componentes y se COBRA
-- como combo.
--
-- Con esta correccion la suma de los items vuelve a ser `subtotal - descuento`
-- y el unico excedente es el envio, que es lo que el guard espera. De paso el
-- comprador ve en Checkout Pro la misma linea que eligio —"Cuatro para
-- arrancar $ 10.500"— y no cuatro latas a precio de lista que suman otra cosa.

create or replace function public.prepare_mercadopago_preference(
  p_checkout_session_id uuid,
  p_customer_id uuid,
  p_new_attempt boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_number integer;
  v_items jsonb;
begin
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found or v_session.customer_id <> p_customer_id then
    raise exception 'checkout no autorizado' using errcode = '42501';
  end if;
  if v_session.expires_at <= clock_timestamp() then
    perform public.release_checkout_session_inventory(v_session.id, 'preference_expired', 'expired');
    raise exception 'checkout vencido' using errcode = '55000';
  end if;
  select * into v_intent from public.payment_intents pi where pi.checkout_session_id = v_session.id for update;
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  select * into v_settings from public.business_payment_settings s
   where s.business_id = v_session.business_id and s.provider = 'mercadopago' for share;
  if not found or not v_settings.enabled or not v_settings.reserve_stock
    or v_settings.checkout_mode <> 'checkout_pro' or v_settings.currency <> 'ARS'
    or (v_settings.environment = 'production' and v_settings.production_review_status <> 'approved') then
    raise exception 'Mercado Pago no esta habilitado' using errcode = '55000';
  end if;
  if v_session.status in ('completed', 'payment_approved', 'finalizing_order', 'manual_review_required') then
    raise exception 'checkout no admite otra preferencia' using errcode = '55000';
  end if;
  -- Los items de la preferencia tienen que ser lo que se VENDE, no lo que se
  -- reserva. Un combo se reserva como sus componentes —el mostrador arma latas,
  -- no combos— pero se cobra como combo. Listar los componentes a precio de
  -- lista hacia que la suma de los items superara el total autoritativo, y el
  -- armador de la preferencia lanzaba
  -- `Preference items exceed the server-side checkout total`, que el Edge
  -- Function clasificaba como `network_or_timeout`. Ademas el comprador veria
  -- en Checkout Pro un total distinto del que su pedido cobra.
  select coalesce(jsonb_agg(lineas.linea order by lineas.linea ->> 'id'), '[]'::jsonb)
    into v_items
    from (
      select jsonb_build_object(
        'id', c.combo_id,
        'title', c.name,
        'description', 'Combo',
        'quantity', c.quantity,
        'currency_id', 'ARS',
        'unit_price', c.promotional_price
      ) as linea
        from public.checkout_session_combos c
       where c.checkout_session_id = v_session.id
      union all
      -- De cada producto queda lo que NO consume ningun combo: quien suma dos
      -- latas sueltas ademas del combo las paga aparte, a precio de lista.
      select jsonb_build_object(
        'id', i.product_id::text,
        'title', coalesce(i.product_snapshot ->> 'name', 'Producto TABA2'),
        'description', nullif(i.product_snapshot ->> 'presentation', ''),
        'quantity', suelto.quantity,
        'currency_id', 'ARS',
        'unit_price', i.unit_price
      )
        from public.checkout_session_items i
        cross join lateral (
          select i.quantity - coalesce((
            select sum(cc.quantity * c.quantity)
              from public.checkout_session_combos c
              join public.product_combo_components cc on cc.combo_id = c.combo_uuid
             where c.checkout_session_id = v_session.id
               and cc.product_id = i.product_id
          ), 0) as quantity
        ) as suelto
       where i.checkout_session_id = v_session.id
         and suelto.quantity > 0
    ) as lineas;
  select * into v_attempt from public.payment_attempts pa
   where pa.payment_intent_id = v_intent.id and pa.attempt_type = 'preference'
   order by pa.attempt_number desc limit 1 for update;
  if found and not p_new_attempt and v_attempt.status in ('prepared', 'request_sent', 'created', 'ambiguous') then
    return jsonb_build_object(
      'checkout_session_id', v_session.id, 'payment_intent_id', v_intent.id,
      'payment_attempt_id', v_attempt.id, 'attempt_status', v_attempt.status,
      'attempt_number', v_attempt.attempt_number, 'idempotency_key', v_attempt.idempotency_key,
      'preference_id', v_attempt.preference_id, 'init_point', v_attempt.init_point,
      'sandbox_init_point', v_attempt.sandbox_init_point, 'external_reference', v_intent.external_reference,
      'environment', v_intent.environment, 'currency', 'ARS', 'total', v_intent.expected_amount,
      'expires_at', v_session.expires_at, 'items', v_items,
      'allow_offline_payment_methods', v_settings.allow_offline_payment_methods,
      'installments_limit', v_settings.installments_limit
    );
  end if;
  if p_new_attempt then
    if v_intent.internal_status not in ('rejected', 'cancelled', 'expired', 'failed') then
      raise exception 'el pago actual no admite un nuevo intento controlado' using errcode = '55000';
    end if;
    if v_session.status in ('cancelled', 'expired', 'retrying') then
      perform public.reacquire_checkout_session_inventory(v_session.id, 'payment_retry');
      select * into v_session from public.checkout_sessions s where s.id = v_session.id for update;
    end if;
  elsif found and v_attempt.status in ('failed', 'cancelled') then
    raise exception 'solicita un nuevo intento de pago' using errcode = '55000';
  end if;
  if not exists (select 1 from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' and r.expires_at > clock_timestamp()) then
    raise exception 'reserva de stock no valida' using errcode = '55000';
  end if;
  select coalesce(max(pa.attempt_number), 0) + 1 into v_number
    from public.payment_attempts pa where pa.payment_intent_id = v_intent.id and pa.attempt_type = 'preference';
  insert into public.payment_attempts (payment_intent_id, attempt_number, attempt_type, status)
  values (v_intent.id, v_number, 'preference', 'prepared') returning * into v_attempt;
  update public.payment_intents
     set internal_status = case when internal_status in ('created', 'ambiguous', 'preference_creating', 'preference_created', 'redirected')
                                then 'preference_creating' else internal_status end
   where id = v_intent.id;
  return jsonb_build_object(
    'checkout_session_id', v_session.id, 'payment_intent_id', v_intent.id,
    'payment_attempt_id', v_attempt.id, 'attempt_status', v_attempt.status,
    'attempt_number', v_attempt.attempt_number, 'idempotency_key', v_attempt.idempotency_key,
    'preference_id', null, 'init_point', null, 'sandbox_init_point', null,
    'external_reference', v_intent.external_reference, 'environment', v_intent.environment,
    'currency', 'ARS', 'total', v_intent.expected_amount, 'expires_at', v_session.expires_at,
    'items', v_items, 'allow_offline_payment_methods', v_settings.allow_offline_payment_methods,
    'installments_limit', v_settings.installments_limit
  );
end;
$$;
