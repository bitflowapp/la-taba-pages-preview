begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
insert into auth.users(id,email) values('91000000-0000-4000-8000-0000000000c1','operator-switch-fixture@example.invalid');
insert into public.businesses(id,name,slug,status,is_active,currency_code,pickup_enabled,delivery_enabled,
  ordering_verified,ordering_verified_at,ordering_verified_by,ordering_enabled)
values('92000000-0000-4000-8000-0000000000c1','Operator switch fixture','operator-switch-fixture','open',true,'ARS',true,false,
  true,now(),'91000000-0000-4000-8000-0000000000c1',true),
  ('92000000-0000-4000-8000-0000000000c2','Operator switch bystander','operator-switch-bystander','open',true,'ARS',true,false,
  true,now(),'91000000-0000-4000-8000-0000000000c1',true);
create temporary view offered as
  select (public.get_mercadopago_checkout_availability('92000000-0000-4000-8000-0000000000c1')->>'available')::boolean as yes;
create temporary view connection as
  select status, generation, protected_tokens is not null as sealed from public.mp_seller_connections
   where business_id='92000000-0000-4000-8000-0000000000c1' and environment='test';

select throws_ok($$select public.operator_set_mercadopago_for_business('92000000-0000-4000-8000-0000000000c1','test',true,'2691240967769590')$$,
  'P0001', null, 'cannot turn Mercado Pago on without a connected seller');

select public.mp_begin_oauth('92000000-0000-4000-8000-0000000000c1','91000000-0000-4000-8000-0000000000c1','test','switch-state','protected-fixture');
select public.mp_finish_oauth('92000000-0000-4000-8000-0000000000c1','test',
  (select generation from public.mp_seller_connections where business_id='92000000-0000-4000-8000-0000000000c1'),
  '3594962708','2691240967769590','read write offline_access','encrypted-fixture',now()+interval '180 days');
create temporary table generation_before as select generation from connection;

select throws_ok($$select public.operator_set_mercadopago_for_business('92000000-0000-4000-8000-0000000000c1','test',true,'7677852968049976')$$,
  'P0001', null, 'a connection of another application is refused');
select throws_ok($$select public.operator_set_mercadopago_for_business('92000000-0000-4000-8000-0000000000c1','production',true,'2691240967769590',true)$$,
  'P0001', null, 'there is no production connection to charge with');

select is((public.operator_set_mercadopago_for_business('92000000-0000-4000-8000-0000000000c1','test',true,'2691240967769590')->>'offered')::boolean,
  true, 'cutover: the connected seller of the expected application is offered');
select is((select collector_id from public.business_payment_settings where business_id='92000000-0000-4000-8000-0000000000c1'),
  '3594962708', 'the collector is the connected account, not a typed value');
select is((select count(*)::integer from public.business_payment_settings where business_id='92000000-0000-4000-8000-0000000000c2'),
  0, 'the cutover touches only that business');

-- Rollback.
select is((public.operator_set_mercadopago_for_business('92000000-0000-4000-8000-0000000000c1','test',false,null)->>'offered')::boolean,
  false, 'rollback: Mercado Pago stops being offered');
select is((select yes from offered), false, 'the checkout availability agrees');
select ok((select status='connected' and sealed from connection), 'the seller stays connected with its sealed credential');
select is((select generation from connection), (select generation from generation_before), 'the binding generation is preserved');
select is((public.operator_set_mercadopago_for_business('92000000-0000-4000-8000-0000000000c1','test',false,null)->>'changed')::boolean,
  false, 'turning off twice changes nothing');
select is((public.operator_set_mercadopago_for_business('92000000-0000-4000-8000-0000000000c1','test',true,'2691240967769590')->>'offered')::boolean,
  true, 'turning back on needs no reconnection');

select is((select string_agg(action, ',' order by id) from public.business_config_audit
            where business_id='92000000-0000-4000-8000-0000000000c1' and scope='payments'),
  'enabled,disabled,enabled', 'every change is audited, the no-op is not');
select ok((select bool_and(actor_kind='service' and after::text !~ '3594962708|encrypted|token') from public.business_config_audit
            where business_id='92000000-0000-4000-8000-0000000000c1' and scope='payments'),
  'the audit names the actor kind and carries no account id or credential');

select ok(not has_function_privilege('authenticated','public.operator_set_mercadopago_for_business(uuid,text,boolean,text,boolean)','execute'),
  'a signed-in user cannot flip the switch');
select ok(not has_function_privilege('anon','public.operator_set_mercadopago_for_business(uuid,text,boolean,text,boolean)','execute'),
  'an anonymous caller cannot flip the switch');
select * from finish();
rollback;
