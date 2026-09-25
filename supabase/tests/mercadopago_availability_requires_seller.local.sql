begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
insert into auth.users(id,email) values('91000000-0000-4000-8000-0000000000a1','availability-fixture@example.invalid');
insert into public.businesses(id,name,slug,status,is_active,currency_code,pickup_enabled,delivery_enabled,
  ordering_verified,ordering_verified_at,ordering_verified_by,ordering_enabled)
values('92000000-0000-4000-8000-0000000000a1','Availability fixture','availability-fixture','open',true,'ARS',true,false,
  true,now(),'91000000-0000-4000-8000-0000000000a1',true);
create temporary view availability as
  select (public.get_mercadopago_checkout_availability('92000000-0000-4000-8000-0000000000a1')->>'available')::boolean as offered;

-- A configuration row without any seller connection is not a way to charge.
insert into public.business_payment_settings(business_id,environment,collector_id,application_id,enabled)
values('92000000-0000-4000-8000-0000000000a1','test','123456','999999',true);
select is((select offered from availability),false,'enabled settings without a connected seller are not offered');

select public.mp_begin_oauth('92000000-0000-4000-8000-0000000000a1','91000000-0000-4000-8000-0000000000a1','test','availability-state','protected-fixture');
select ok(public.mp_finish_oauth('92000000-0000-4000-8000-0000000000a1','test',
  (select generation from public.mp_seller_connections where business_id='92000000-0000-4000-8000-0000000000a1'),
  '123456','999999','read write offline_access','encrypted-fixture',now()+interval '180 days'),'seller connected by OAuth');
select is((select offered from availability),true,'the connected seller of the configured account is offered');

-- What invalidateRejectedToken persists when Mercado Pago answers 401.
update public.mp_seller_connections set status='requires_reauthorization',protected_tokens=null
 where business_id='92000000-0000-4000-8000-0000000000a1';
select is((select offered from availability),false,'a seller that needs reconnection is not offered');
select is((select enabled from public.business_payment_settings where business_id='92000000-0000-4000-8000-0000000000a1'),true,
  'the gate does not depend on someone turning the settings off');

select public.mp_begin_oauth('92000000-0000-4000-8000-0000000000a1','91000000-0000-4000-8000-0000000000a1','test','availability-state-2','protected-fixture');
select public.mp_finish_oauth('92000000-0000-4000-8000-0000000000a1','test',
  (select generation from public.mp_seller_connections where business_id='92000000-0000-4000-8000-0000000000a1'),
  '123456','999999','read write offline_access','encrypted-fixture-2',now()+interval '180 days');
select is((select offered from availability),true,'reconnecting the same seller offers Mercado Pago again');

update public.business_payment_settings set collector_id='654321' where business_id='92000000-0000-4000-8000-0000000000a1';
select is((select offered from availability),false,'a connection of another account than the configured collector is not offered');
update public.business_payment_settings set collector_id='123456' where business_id='92000000-0000-4000-8000-0000000000a1';

select public.mp_disconnect('92000000-0000-4000-8000-0000000000a1','test');
select is((select offered from availability),false,'a disconnected seller is not offered');
select ok(not has_function_privilege('anon','public.get_mercadopago_checkout_availability(uuid)','execute'),
  'anonymous callers cannot probe availability');
select * from finish();
rollback;
