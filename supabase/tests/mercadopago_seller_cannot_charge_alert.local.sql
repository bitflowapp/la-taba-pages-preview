begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
insert into auth.users(id,email) values('91000000-0000-4000-8000-0000000000b1','seller-alert-fixture@example.invalid');
insert into public.businesses(id,name,slug,status,is_active,currency_code,pickup_enabled,delivery_enabled,
  ordering_verified,ordering_verified_at,ordering_verified_by,ordering_enabled)
values('92000000-0000-4000-8000-0000000000b1','Seller alert fixture','seller-alert-fixture','open',true,'ARS',true,false,
  true,now(),'91000000-0000-4000-8000-0000000000b1',true);
create temporary view seller_alert as
  select a.severity, a.evidence->>'connection_status' as connection_status, a.evidence
  from public.operational_alerts a
  where a.business_id='92000000-0000-4000-8000-0000000000b1'
    and a.alert_code='MERCADOPAGO_SELLER_CANNOT_CHARGE' and a.status<>'resolved';

select public.reconcile_operational_alerts_for_business('92000000-0000-4000-8000-0000000000b1');
select is((select count(*)::integer from seller_alert),0,'a business without Mercado Pago gets no seller alert');

insert into public.business_payment_settings(business_id,environment,collector_id,application_id,enabled)
values('92000000-0000-4000-8000-0000000000b1','test','123456','999999',true);
select public.reconcile_operational_alerts_for_business('92000000-0000-4000-8000-0000000000b1');
select is((select connection_status from seller_alert),'missing','Mercado Pago turned on without a seller account raises the alert');

select public.mp_begin_oauth('92000000-0000-4000-8000-0000000000b1','91000000-0000-4000-8000-0000000000b1','test','seller-alert-state','protected-fixture');
select public.mp_finish_oauth('92000000-0000-4000-8000-0000000000b1','test',
  (select generation from public.mp_seller_connections where business_id='92000000-0000-4000-8000-0000000000b1'),
  '123456','999999','read write offline_access','encrypted-fixture',now()+interval '180 days');
select public.reconcile_operational_alerts_for_business('92000000-0000-4000-8000-0000000000b1');
select is((select count(*)::integer from seller_alert),0,'a connected seller of the configured account clears it');

-- What invalidateRejectedToken persists when Mercado Pago answers 401.
update public.mp_seller_connections set status='requires_reauthorization',protected_tokens=null
 where business_id='92000000-0000-4000-8000-0000000000b1';
select public.reconcile_operational_alerts_for_business('92000000-0000-4000-8000-0000000000b1');
select is((select connection_status from seller_alert),'requires_reauthorization','a seller that needs reconnection raises it');
select is((select severity from seller_alert),'ACTION_REQUIRED','it asks the business for an action');
select ok((select not (evidence ? 'seller_id') and not (evidence ? 'collector_id') and evidence::text !~* 'token|encrypted' from seller_alert),
  'the evidence carries no account id and no credential');

-- Disconnecting from the Panel also turns Mercado Pago off (mp_disconnect):
-- nothing is left to warn about.
select public.mp_disconnect('92000000-0000-4000-8000-0000000000b1','test');
select public.reconcile_operational_alerts_for_business('92000000-0000-4000-8000-0000000000b1');
select is((select count(*)::integer from seller_alert),0,'disconnecting from the Panel turns Mercado Pago off and clears it');

-- Someone turns it back on without reconnecting the account.
update public.business_payment_settings set enabled=true where business_id='92000000-0000-4000-8000-0000000000b1';
select public.reconcile_operational_alerts_for_business('92000000-0000-4000-8000-0000000000b1');
select is((select connection_status from seller_alert),'disconnected','turned back on with a disconnected seller raises it');

update public.business_payment_settings set enabled=false where business_id='92000000-0000-4000-8000-0000000000b1';
select public.reconcile_operational_alerts_for_business('92000000-0000-4000-8000-0000000000b1');
select is((select count(*)::integer from seller_alert),0,'turning Mercado Pago off for the business resolves it');
select * from finish();
rollback;
