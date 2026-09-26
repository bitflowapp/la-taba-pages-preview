begin;
create extension if not exists pgtap with schema extensions;
select plan(5);
insert into public.businesses(id,name,slug,status,is_active,operating_timezone)
values('98000000-0000-4000-8000-000000000001','Isolation fixture','payment-isolation-fixture','open',true,'America/Argentina/Buenos_Aires');
insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,
  customer_name,customer_neighborhood,customer_street_address,customer_phone,payment_method,subtotal,delivery_fee,total)
values
  ('98000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000001','ISO-MP','ISO-MP','received','pickup','pickup',
   'mp_isolation_fixture','Cliente MP','Centro','Mendoza 1','+542990000001','mercadopago',1800,0,1800),
  ('98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000001','ISO-CASH','ISO-CASH','received','pickup','pickup',
   'cash_isolation_fixture','Cliente efectivo','Centro','Mendoza 2','+542990000002','cash',1800,0,1800);

select is((select manual_payment_status from public.orders where id='98000000-0000-4000-8000-000000000002'),null,
  'a Mercado Pago order never carries a manual collection state');
select throws_ok($$update public.orders set manual_payment_status='confirmed',manual_payment_method='cash',manual_payment_confirmed_at=now()
  where id='98000000-0000-4000-8000-000000000002'$$,'23514',null,
  'a Mercado Pago order cannot be marked as collected by hand, even by a direct write');
select is((select manual_payment_status from public.orders where id='98000000-0000-4000-8000-000000000003'),'pending',
  'a cash order starts waiting for its manual collection');
select is((select count(*)::int from public.payment_intents where order_id='98000000-0000-4000-8000-000000000003'),0,
  'a manual order has no Mercado Pago payment to refund or to wait a webhook for');
select ok(position('payment_method not in (''cash'',''coordinate'')' in
  pg_get_functiondef('public.confirm_manual_order_payment(uuid,bigint,text,text)'::regprocedure)) > 0,
  'the manual collection command refuses every order that is not cash or to-coordinate');
select * from finish();
rollback;
