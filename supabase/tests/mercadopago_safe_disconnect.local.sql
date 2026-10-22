begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
insert into auth.users(id,email) values('91000000-0000-4000-8000-0000000000d1','disconnect-fixture@example.invalid');
insert into public.businesses(id,name,slug) values('92000000-0000-4000-8000-0000000000d1','Disconnect fixture','disconnect-fixture');
select public.mp_begin_oauth('92000000-0000-4000-8000-0000000000d1','91000000-0000-4000-8000-0000000000d1','test','disconnect-state','protected-fixture');
select public.mp_finish_oauth('92000000-0000-4000-8000-0000000000d1','test',
  (select generation from public.mp_seller_connections where business_id='92000000-0000-4000-8000-0000000000d1'),
  '7654321','2691240967769590','read write offline_access','encrypted-fixture',now()+interval '1 hour');
select ok((select enabled from public.business_payment_settings where business_id='92000000-0000-4000-8000-0000000000d1'),'test link enables test payments');

-- A payment that Mercado Pago can still approve.
insert into public.checkout_sessions(id,business_id,customer_id,client_request_id,normalized_intent_hash,fulfillment_type,subtotal,total,status,expires_at)
values('94000000-0000-4000-8000-0000000000d1','92000000-0000-4000-8000-0000000000d1','91000000-0000-4000-8000-0000000000d1',
  'fixture-disconnect-1',repeat('a',64),'pickup',100,100,'payment_pending',now()+interval '1 hour');
insert into public.payment_intents(id,checkout_session_id,business_id,environment,external_reference,expected_amount,internal_status)
values('95000000-0000-4000-8000-0000000000d1','94000000-0000-4000-8000-0000000000d1','92000000-0000-4000-8000-0000000000d1','test',
  'taba2:checkout:94000000-0000-4000-8000-0000000000d1',100,'pending');

select is((public.mp_disconnect_preflight('92000000-0000-4000-8000-0000000000d1','test')->>'open_payments')::int,1,'preflight counts the open payment');
select is((public.mp_disconnect_checked('92000000-0000-4000-8000-0000000000d1','test',true)->>'code'),'pending_operations','disconnect refused while a payment is open');
select ok(not (select enabled from public.business_payment_settings where business_id='92000000-0000-4000-8000-0000000000d1'),'new online payments are paused anyway');
select isnt((select protected_tokens from public.mp_seller_connections where business_id='92000000-0000-4000-8000-0000000000d1'),null,'the authorization survives so the open payment can still be checked');
select is((select status from public.mp_seller_connections where business_id='92000000-0000-4000-8000-0000000000d1'),'connected','still connected');

update public.payment_intents set internal_status='rejected' where id='95000000-0000-4000-8000-0000000000d1';
update public.checkout_sessions set status='cancelled' where id='94000000-0000-4000-8000-0000000000d1';
-- A rejected/cancelled checkout can still receive a payment until its preference expires (forensic finding F10), and
-- the provider ledger must have been read after the last activity: the credential is kept until both are over.
select is((public.mp_disconnect_checked('92000000-0000-4000-8000-0000000000d1','test',false)->>'code'),'pending_operations','a checkout inside its preference window still blocks the disconnect');
update public.checkout_sessions set created_at=now()-interval '40 hours', expires_at=now()-interval '30 hours' where id='94000000-0000-4000-8000-0000000000d1';
insert into public.provider_ledger_cursors(business_id,environment,watermark_at,last_completed_at)
  values ('92000000-0000-4000-8000-0000000000d1','test',now(),now()+interval '1 second');
select is((public.mp_disconnect_checked('92000000-0000-4000-8000-0000000000d1','test',false)->>'code'),'ready_to_disconnect','without execute nothing is disconnected');
select is((select status from public.mp_seller_connections where business_id='92000000-0000-4000-8000-0000000000d1'),'connected','preview leaves the link');
select ok((public.mp_disconnect_checked('92000000-0000-4000-8000-0000000000d1','test',true)->>'ok')::boolean,'disconnect allowed once nothing is pending');
select is((select status from public.mp_seller_connections where business_id='92000000-0000-4000-8000-0000000000d1'),'disconnected','disconnected');
select is((select protected_tokens from public.mp_seller_connections where business_id='92000000-0000-4000-8000-0000000000d1'),null,'token material destroyed');
select is((select count(*)::int from public.payment_intents where business_id='92000000-0000-4000-8000-0000000000d1'),1,'history is preserved');

-- A provider-confirmed revocation only downgrades.
select public.mp_begin_oauth('92000000-0000-4000-8000-0000000000d1','91000000-0000-4000-8000-0000000000d1','test','revoked-state','protected-fixture');
select public.mp_finish_oauth('92000000-0000-4000-8000-0000000000d1','test',
  (select generation from public.mp_seller_connections where business_id='92000000-0000-4000-8000-0000000000d1'),
  '7654321','2691240967769590','read write offline_access','encrypted-fixture',now()+interval '1 hour');
select ok(public.mp_mark_seller_deauthorized('92000000-0000-4000-8000-0000000000d1','test'),'revocation recorded');
select is((select status||':'||coalesce(protected_tokens,'none')||':'||(deauthorized_at is not null)::text
  from public.mp_seller_connections where business_id='92000000-0000-4000-8000-0000000000d1'),'requires_reauthorization:none:true','revoked link needs a new consent');
select ok(not (select enabled from public.business_payment_settings where business_id='92000000-0000-4000-8000-0000000000d1'),'revocation turns online payments off');

select ok(not has_function_privilege('authenticated','public.mp_disconnect_checked(uuid,text,boolean)','execute'),'browser cannot disconnect directly');
select throws_ok($$select public.pause_mercadopago_payments('92000000-0000-4000-8000-0000000000d1')$$,'42501',null,'only the owner or admin can pause');
select * from finish();
rollback;
