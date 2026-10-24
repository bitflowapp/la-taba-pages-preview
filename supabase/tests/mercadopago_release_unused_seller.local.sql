begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
create temp table fixture(label text primary key,id uuid default gen_random_uuid());
insert into fixture(label) values('wrong'),('sold'),('owner');
insert into auth.users(id,email) select id,'release-seller@example.invalid' from fixture where label='owner';
insert into public.businesses(id,name,slug) select id,label,'mp-release-test-'||label from fixture where label in ('wrong','sold');
-- «wrong»: vinculó la cuenta personal 111 antes de vender. «sold»: vinculó 333 y ya tiene un intento de pago.
select public.mp_begin_oauth((select id from fixture where label=b),(select id from fixture where label='owner'),'production','release-state-'||b,'fixture-encrypted-state') from unnest(array['wrong','sold']) b;
select public.mp_finish_oauth((select id from fixture where label='wrong'),'production',(select generation from public.mp_seller_connections where business_id=(select id from fixture where label='wrong')),'111','999999','read write offline_access','fixture-encrypted-tokens',now()+interval '1 day');
select public.mp_finish_oauth((select id from fixture where label='sold'),'production',(select generation from public.mp_seller_connections where business_id=(select id from fixture where label='sold')),'333','999999','read write offline_access','fixture-encrypted-tokens',now()+interval '1 day');
insert into public.checkout_sessions(business_id,customer_id,client_request_id,normalized_intent_hash,fulfillment_type,subtotal,total,expires_at)
values((select id from fixture where label='sold'),(select id from fixture where label='owner'),'release_test_1',repeat('b',64),'pickup',10,10,now()+interval '1 day');
insert into public.payment_intents(business_id,checkout_session_id,environment,external_reference,expected_amount,preference_id,live_mode)
select business_id,id,'production','taba2:checkout:'||id,10,'release-preference:'||id,true from public.checkout_sessions where client_request_id='release_test_1';

select ok(not has_function_privilege('authenticated','public.mp_release_unused_seller_binding(uuid,text,text)','execute'),'the panel cannot release a seller');
select ok(not has_function_privilege('anon','public.mp_release_unused_seller_binding(uuid,text,text)','execute'),'nobody anonymous can release a seller');
select ok(has_function_privilege('service_role','public.mp_release_unused_seller_binding(uuid,text,text)','execute'),'support (service_role) can');
select throws_ok($q$ select public.mp_release_unused_seller_binding((select id from fixture where label='wrong'),'production','111') $q$,'P0001','disconnect_first','a connected link is never released');
select public.mp_disconnect((select id from fixture where label=b),'production') from unnest(array['wrong','sold']) b;
select throws_ok($q$ select public.mp_release_unused_seller_binding((select id from fixture where label='wrong'),'production','222') $q$,'P0001','seller_mismatch','the seller to release has to be named exactly');
select throws_ok($q$ select public.mp_release_unused_seller_binding((select id from fixture where label='sold'),'production','333') $q$,'P0001','seller_has_payment_history','a seller with payment history stays bound');
select throws_ok($q$ select public.mp_release_unused_seller_binding((select id from fixture where label='wrong'),'test','111') $q$,'P0002','no_seller_binding','another environment has nothing to release');
select is((public.mp_release_unused_seller_binding((select id from fixture where label='wrong'),'production','111'))->>'released','true','an unused wrong link is released');
select is((select seller_id from public.mp_seller_connections where business_id=(select id from fixture where label='wrong') and environment='production'),null,'no seller remains bound');
select is((select collector_id from public.business_payment_settings where business_id=(select id from fixture where label='wrong')),null,'no collector remains configured');
select is((select enabled from public.business_payment_settings where business_id=(select id from fixture where label='wrong')),false,'payments stay off');
select is((select count(*)::int from public.business_config_audit where business_id=(select id from fixture where label='wrong') and scope='payments' and action='deleted' and before->>'seller_suffix'='111'),1,'the release is audited');
select ok(public.mp_finish_oauth((select id from fixture where label='wrong'),'production',(select generation from public.mp_seller_connections where business_id=(select id from fixture where label='wrong')),'222','999999','read write offline_access','fixture-encrypted-tokens',now()+interval '1 day'),'the right account links afterwards');
select throws_ok($q$ select public.mp_finish_oauth((select id from fixture where label='sold'),'production',(select generation from public.mp_seller_connections where business_id=(select id from fixture where label='sold')),'444','999999','read write offline_access','fixture-encrypted-tokens',now()+interval '1 day') $q$,'P0001','seller_change_requires_migration','a business with history still cannot switch seller');
select * from finish();
rollback;
