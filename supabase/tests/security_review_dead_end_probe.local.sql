-- SONDA: ¿se puede salir de `security_review_required`?
-- Solo observa. No corrige nada.

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  r150 integer := public.payment_internal_status_rank('security_review_required');
begin
  raise notice '';
  raise notice '########## RANGOS ##########';
  raise notice 'security_review_required .. %', r150;
  raise notice 'completed ................. %', public.payment_internal_status_rank('completed');
  raise notice 'refunded .................. %', public.payment_internal_status_rank('refunded');
  raise notice 'partially_refunded ........ %', public.payment_internal_status_rank('partially_refunded');
  raise notice 'approved_order_pending .... %', public.payment_internal_status_rank('approved_order_pending');
  raise notice '';
  raise notice 'El trigger prevent_payment_intent_status_regression rechaza cualquier';
  raise notice 'destino con rango MENOR. Con 150, TODOS los destinos son menores.';
end $$;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_business uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_intent uuid := gen_random_uuid();
  v_bloqueado text;
begin
  raise notice '';
  raise notice '########## PRUEBA DIRECTA SOBRE UNA FILA REAL ##########';
  insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_owner, 'authenticated', 'authenticated', 'probe-' || replace(v_owner::text,'-','') || '@example.invalid', '', '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());
  insert into public.businesses (id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal)
  values (v_business, 'Probe', 'probe-' || right(replace(v_business::text,'-',''),8), 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, true, 500.00, 0.00);
  insert into public.checkout_sessions (id, business_id, customer_id, client_request_id, normalized_intent_hash,
    fulfillment_type, address_snapshot, contact_snapshot, currency, subtotal, discount_total, delivery_fee, total,
    status, expires_at)
  values (v_session, v_business, v_owner, 'probe0001', repeat('a', 64), 'pickup', '{}'::jsonb,
    jsonb_build_object('name','Probe'), 'ARS', 1000, 0, 0, 1000, 'manual_review_required', clock_timestamp() + interval '1 hour');
  insert into public.payment_intents (id, business_id, checkout_session_id, environment, currency,
    expected_amount, paid_amount, external_reference, internal_status, provider_status, security_review_reason)
  values (v_intent, v_business, v_session, 'test', 'ARS', 1000, 1000,
    'taba2:checkout:' || v_session::text, 'security_review_required', 'approved', 'approved_after_reservation_expired');

  foreach v_bloqueado in array array['refunded', 'partially_refunded', 'completed', 'approved_order_pending'] loop
    begin
      update public.payment_intents set internal_status = v_bloqueado where id = v_intent;
      raise notice '  -> % : PERMITIDO', rpad(v_bloqueado, 24, '.');
      update public.payment_intents set internal_status = 'security_review_required' where id = v_intent;
    exception when others then
      raise notice '  -> % : BLOQUEADO (%)', rpad(v_bloqueado, 24, '.'), left(sqlerrm, 60);
    end;
  end loop;

  raise notice '';
  raise notice 'CONSECUENCIA: record_payment_refund_response (linea 827 de la migracion';
  raise notice '20260802093000) hace exactamente ese UPDATE a `refunded`. Si esta';
  raise notice 'bloqueado, el reembolso se ejecuta en Mercado Pago y NO se puede';
  raise notice 'registrar de este lado: el trabajo del outbox falla y reintenta hasta';
  raise notice 'dead_letter, con el dinero ya devuelto y la fila diciendo otra cosa.';
end $$;
