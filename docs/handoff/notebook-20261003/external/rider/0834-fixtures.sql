-- Fixtures del gate fisico Rider multi-pedido. Base DESCARTABLE unicamente.
-- Datos sinteticos: ninguna persona real, ningun telefono real, ningun pago real.
begin;

-- Negocio QA
insert into public.businesses(id, name, status, slug, is_active)
values ('b0000000-0000-4000-8000-000000000001', 'TABA QA MULTI', 'open', 'taba-qa-multi', true);

-- Staff QA y Rider QA del Moto
insert into public.business_members(business_id, user_id, role, is_active) values
  ('b0000000-0000-4000-8000-000000000001', '108d466b-887a-4a12-99e1-59c06f4cc428', 'staff', true),
  ('b0000000-0000-4000-8000-000000000001', '1fe4d525-34f1-4727-b405-6c5da7308c5f', 'rider', true);

-- Pedidos A..E, todos listos para despachar y con datos que no se pueden confundir
insert into public.orders(
  id, business_id, code, public_code, status, fulfillment_type, delivery_mode, origin,
  client_request_id, customer_name, customer_neighborhood, customer_street_address,
  customer_phone, customer_notes, payment_method, subtotal, delivery_fee, total, origin_reason, origin_classified_at,
  delivery_code_required, address_lat, address_lng, delivery_latitude, delivery_longitude,
  delivery_location_source, delivery_location_confirmed_at,
  customer_user_id
) values
  ('0a000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','MO-A','MO-A','ready','delivery','delivery','qa',
   'gate-multi-a','CLIENTE A','Centro','TEST MULTI A','+540000000001','Pedido A del gate','cash',1000,0,1000,'fixture del gate fisico multi-pedido',clock_timestamp(),
   true,-38.9516,-68.0591,-38.9516,-68.0591,'map_pin',clock_timestamp(),null),
  ('0a000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','MO-B','MO-B','ready','delivery','delivery','qa',
   'gate-multi-b','CLIENTE B','Centro','TEST MULTI B','+540000000002','Pedido B del gate','mercadopago',2500,0,2500,'fixture del gate fisico multi-pedido',clock_timestamp(),
   true,-38.9560,-68.0630,-38.9560,-68.0630,'map_pin',clock_timestamp(),'271dd60a-7d36-46d6-ae8f-f31bff608f54'),
  ('0a000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000001','MO-C','MO-C','ready','delivery','delivery','qa',
   'gate-multi-c','CLIENTE C','Centro','TEST MULTI C','+540000000003','Pedido C del gate','cash',3000,0,3000,'fixture del gate fisico multi-pedido',clock_timestamp(),
   true,-38.9480,-68.0550,-38.9480,-68.0550,'map_pin',clock_timestamp(),null),
  ('0a000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000001','MO-D','MO-D','ready','delivery','delivery','qa',
   'gate-multi-d','CLIENTE D','Centro','TEST MULTI D','+540000000004','Pedido D del gate','cash',4000,0,4000,'fixture del gate fisico multi-pedido',clock_timestamp(),
   true,-38.9600,-68.0700,-38.9600,-68.0700,'map_pin',clock_timestamp(),null),
  ('0a000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-000000000001','MO-E','MO-E','ready','delivery','delivery','qa',
   'gate-multi-e','CLIENTE E','Centro','TEST MULTI E','+540000000005','Pedido E del gate','coordinate',5000,0,5000,'fixture del gate fisico multi-pedido',clock_timestamp(),
   true,-38.9450,-68.0500,-38.9450,-68.0500,'map_pin',clock_timestamp(),null);

-- Token publico de seguimiento, uno por pedido y distinto entre si
insert into public.order_public_tokens(order_id, token, token_hash, expires_at) values
  ('0a000000-0000-4000-8000-000000000001',null,extensions.digest('gate_token_cliente_a_000000001','sha256'),clock_timestamp()+interval '2 days'),
  ('0a000000-0000-4000-8000-000000000002',null,extensions.digest('gate_token_cliente_b_000000002','sha256'),clock_timestamp()+interval '2 days'),
  ('0a000000-0000-4000-8000-000000000003',null,extensions.digest('gate_token_cliente_c_000000003','sha256'),clock_timestamp()+interval '2 days'),
  ('0a000000-0000-4000-8000-000000000004',null,extensions.digest('gate_token_cliente_d_000000004','sha256'),clock_timestamp()+interval '2 days'),
  ('0a000000-0000-4000-8000-000000000005',null,extensions.digest('gate_token_cliente_e_000000005','sha256'),clock_timestamp()+interval '2 days');

-- PIN propio por pedido: 1111 / 2222 / 3333 / 4444 / 5555
insert into public.order_delivery_handoffs(order_id, code_hash, code_ciphertext, expires_at) values
  ('0a000000-0000-4000-8000-000000000001',extensions.crypt('1111',extensions.gen_salt('bf')),'\x00'::bytea,clock_timestamp()+interval '2 days'),
  ('0a000000-0000-4000-8000-000000000002',extensions.crypt('2222',extensions.gen_salt('bf')),'\x00'::bytea,clock_timestamp()+interval '2 days'),
  ('0a000000-0000-4000-8000-000000000003',extensions.crypt('3333',extensions.gen_salt('bf')),'\x00'::bytea,clock_timestamp()+interval '2 days'),
  ('0a000000-0000-4000-8000-000000000004',extensions.crypt('4444',extensions.gen_salt('bf')),'\x00'::bytea,clock_timestamp()+interval '2 days'),
  ('0a000000-0000-4000-8000-000000000005',extensions.crypt('5555',extensions.gen_salt('bf')),'\x00'::bytea,clock_timestamp()+interval '2 days');

-- Pago digital SIMULADO Y LOCAL del pedido B. No hay llamada a Mercado Pago:
-- son filas de fixture que satisfacen el contrato para poder medir aislamiento
-- de cobro entre pedidos. environment='test', live_mode=false.
insert into public.checkout_sessions(
  id, business_id, customer_id, client_request_id, normalized_intent_hash, fulfillment_type,
  subtotal, discount_total, delivery_fee, total, status, expires_at, completed_order_id, origin, origin_reason
) values (
  'c5000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001',
  '271dd60a-7d36-46d6-ae8f-f31bff608f54','gate-multi-b-session',
  repeat('b',64),'delivery',2500,0,0,2500,'completed',clock_timestamp()+interval '2 days',
  '0a000000-0000-4000-8000-000000000002','qa','fixture local del gate fisico multi-pedido'
);

insert into public.payment_intents(
  id, checkout_session_id, business_id, order_id, provider, environment, idempotency_key,
  external_reference, internal_status, currency, expected_amount, paid_amount, refunded_amount,
  live_mode, approved_at, revision, created_at, updated_at, correlation_id, provider_payment_id
) values (
  'c6000000-0000-4000-8000-000000000002','c5000000-0000-4000-8000-000000000002',
  'b0000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000002',
  'mercadopago','test','c7000000-0000-4000-8000-000000000002',
  'taba2:checkout:c5000000-0000-4000-8000-000000000002','completed','ARS',2500,2500,0,
  false,clock_timestamp(),1,clock_timestamp(),clock_timestamp(),gen_random_uuid(),'GATE-LOCAL-SIMULADO-B'
);

commit;
