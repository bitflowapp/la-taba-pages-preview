begin;

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('10000000-0000-4000-8000-00000000aa01','authenticated','authenticated','bola-owner-a@example.invalid','',now(),'{}','{}',now(),now()),
('10000000-0000-4000-8000-00000000aa02','authenticated','authenticated','bola-admin-a@example.invalid','',now(),'{}','{}',now(),now()),
('10000000-0000-4000-8000-00000000aa03','authenticated','authenticated','bola-staff-a@example.invalid','',now(),'{}','{}',now(),now()),
('10000000-0000-4000-8000-00000000aa04','authenticated','authenticated','bola-rider-a@example.invalid','',now(),'{}','{}',now(),now()),
('10000000-0000-4000-8000-00000000aa05','authenticated','authenticated','bola-customer-a@example.invalid','',now(),'{}','{}',now(),now()),
('10000000-0000-4000-8000-00000000bb01','authenticated','authenticated','bola-owner-b@example.invalid','',now(),'{}','{}',now(),now()),
('10000000-0000-4000-8000-00000000bb02','authenticated','authenticated','bola-admin-b@example.invalid','',now(),'{}','{}',now(),now()),
('10000000-0000-4000-8000-00000000bb03','authenticated','authenticated','bola-staff-b@example.invalid','',now(),'{}','{}',now(),now()),
('10000000-0000-4000-8000-00000000bb04','authenticated','authenticated','bola-rider-b@example.invalid','',now(),'{}','{}',now(),now()),
('10000000-0000-4000-8000-00000000bb05','authenticated','authenticated','bola-customer-b@example.invalid','',now(),'{}','{}',now(),now());

insert into public.businesses(id,name,status,slug,is_active,ordering_enabled,ordering_verified,delivery_enabled,pickup_enabled,alcohol_sales_enabled,whatsapp_verified,hours_enforced,delivery_zone_enforced,alcohol_hours_enforced,operating_timezone) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','BOLA Business A','open','bola-business-a',true,false,false,true,true,false,false,false,false,false,'America/Argentina/Buenos_Aires'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','BOLA Business B','open','bola-business-b',true,false,false,true,true,false,false,false,false,false,'America/Argentina/Buenos_Aires');

insert into public.business_members(business_id,user_id,role,is_active) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','10000000-0000-4000-8000-00000000aa01','owner',true),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','10000000-0000-4000-8000-00000000aa02','admin',true),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','10000000-0000-4000-8000-00000000aa03','staff',true),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','10000000-0000-4000-8000-00000000aa04','rider',true),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','10000000-0000-4000-8000-00000000bb01','owner',true),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','10000000-0000-4000-8000-00000000bb02','admin',true),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','10000000-0000-4000-8000-00000000bb03','staff',true),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','10000000-0000-4000-8000-00000000bb04','rider',true);
insert into public.identity_user_security(business_id,user_id) select business_id,user_id from public.business_members;
insert into public.riders(id,business_id,name,phone,status) values
('70000000-0000-4000-8000-00000000aa01','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Rider A','2994000001','available'),
('70000000-0000-4000-8000-00000000bb01','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Rider B','2994000002','available');
insert into public.business_service_hours(id,business_id,channel,weekday,opens_at,closes_at) values
('90000000-0000-4000-8000-00000000aa01','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','delivery',1,'09:00','18:00'),
('90000000-0000-4000-8000-00000000bb01','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','delivery',1,'09:00','18:00');
insert into public.customers(id,name,phone) values
('10000000-0000-4000-8000-00000000aa05','Customer A','2994000011'),
('10000000-0000-4000-8000-00000000bb05','Customer B','2994000012');
insert into public.products(id,business_id,name,description,category,price,image_url,is_active,brand,subcategory,presentation,capacity,packaging_type,stock,available,is_alcoholic,tags,is_verified,verified_at,verified_by,external_id,variant,capacity_value,capacity_unit,catalog_origin,units_per_pack,price_status) values
('30000000-0000-4000-8000-00000000aa01','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','Product A','BOLA private product A','Gaseosas',100,'https://example.invalid/a.webp',true,'Marca A','Cola','Botella','1 l','botella',10,false,false,'{}',false,null,null,'bola-product-a','Original',1,'l','test_only',1,'confirmed'),
('30000000-0000-4000-8000-00000000bb01','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','Product B','BOLA private product B','Gaseosas',100,'https://example.invalid/b.webp',true,'Marca B','Cola','Botella','1 l','botella',10,false,false,'{}',false,null,null,'bola-product-b','Original',1,'l','test_only',1,'confirmed');

insert into public.checkout_sessions(id,business_id,customer_id,client_request_id,normalized_intent_hash,fulfillment_type,contact_snapshot,subtotal,total,expires_at,origin,origin_reason) values
('40000000-0000-4000-8000-00000000aa01','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','10000000-0000-4000-8000-00000000aa05','bola-checkout-a','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','pickup','{"name":"Customer A"}',100,100,now()+interval '1 hour','qa','multitenant bola'),
('40000000-0000-4000-8000-00000000bb01','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','10000000-0000-4000-8000-00000000bb05','bola-checkout-b','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','pickup','{"name":"Customer B"}',100,100,now()+interval '1 hour','qa','multitenant bola');
insert into public.checkout_session_items(checkout_session_id,product_id,product_snapshot,quantity,unit_price,subtotal) values
('40000000-0000-4000-8000-00000000aa01','30000000-0000-4000-8000-00000000aa01','{"name":"Product A"}',1,100,100),
('40000000-0000-4000-8000-00000000bb01','30000000-0000-4000-8000-00000000bb01','{"name":"Product B"}',1,100,100);
insert into public.payment_intents(id,checkout_session_id,business_id,provider,environment,idempotency_key,external_reference,internal_status,expected_amount,correlation_id) values
('50000000-0000-4000-8000-00000000aa01','40000000-0000-4000-8000-00000000aa01','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','mercadopago','test','51000000-0000-4000-8000-00000000aa01','taba2:checkout:40000000-0000-4000-8000-00000000aa01','created',100,'52000000-0000-4000-8000-00000000aa01'),
('50000000-0000-4000-8000-00000000bb01','40000000-0000-4000-8000-00000000bb01','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','mercadopago','test','51000000-0000-4000-8000-00000000bb01','taba2:checkout:40000000-0000-4000-8000-00000000bb01','created',100,'52000000-0000-4000-8000-00000000bb01');
insert into public.payment_attempts(id,payment_intent_id,attempt_number,attempt_type,idempotency_key,status) values
('53000000-0000-4000-8000-00000000aa01','50000000-0000-4000-8000-00000000aa01',1,'preference','54000000-0000-4000-8000-00000000aa01','created'),
('53000000-0000-4000-8000-00000000bb01','50000000-0000-4000-8000-00000000bb01',1,'preference','54000000-0000-4000-8000-00000000bb01','created');

insert into public.orders(id,business_id,code,status,fulfillment_type,customer_name,customer_phone,address_label,payment_method,subtotal,delivery_fee,total,public_code,delivery_mode,assigned_rider_id,assigned_rider_user_id,customer_user_id,client_request_id,origin,origin_reason,origin_classified_at,discount_total,correlation_id,revision,delivery_code_required) values
('60000000-0000-4000-8000-00000000aa01','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','BOLA-A-0001','received','pickup','Customer A','2994000011','Pickup A','qa_no_charge',100,0,100,'BOLA-PUBLIC-A','pickup','70000000-0000-4000-8000-00000000aa01','10000000-0000-4000-8000-00000000aa04','10000000-0000-4000-8000-00000000aa05','bola-order-a','qa','multitenant bola',now(),0,'61000000-0000-4000-8000-00000000aa01',1,false),
('60000000-0000-4000-8000-00000000bb01','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','BOLA-B-0001','received','pickup','Customer B','2994000012','Pickup B','qa_no_charge',100,0,100,'BOLA-PUBLIC-B','pickup','70000000-0000-4000-8000-00000000bb01','10000000-0000-4000-8000-00000000bb04','10000000-0000-4000-8000-00000000bb05','bola-order-b','qa','multitenant bola',now(),0,'61000000-0000-4000-8000-00000000bb01',1,false);
insert into public.order_items(order_id,name,quantity,unit_price,subtotal,product_uuid) values
('60000000-0000-4000-8000-00000000aa01','Product A',1,100,100,'30000000-0000-4000-8000-00000000aa01'),
('60000000-0000-4000-8000-00000000bb01','Product B',1,100,100,'30000000-0000-4000-8000-00000000bb01');
insert into public.order_events(order_id,business_id,type,event_type,payload,metadata,actor_role) values
('60000000-0000-4000-8000-00000000aa01','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','created','created','{"private":"A"}','{"tenant":"A"}','business'),
('60000000-0000-4000-8000-00000000bb01','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','created','created','{"private":"B"}','{"tenant":"B"}','business');
update public.payment_intents set order_id='60000000-0000-4000-8000-00000000aa01' where id='50000000-0000-4000-8000-00000000aa01';
update public.payment_intents set order_id='60000000-0000-4000-8000-00000000bb01' where id='50000000-0000-4000-8000-00000000bb01';
insert into public.rider_locations(order_id,rider_id,business_id,rider_user_id,lat,lng,accuracy,source,order_revision) values
('60000000-0000-4000-8000-00000000aa01','70000000-0000-4000-8000-00000000aa01','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','10000000-0000-4000-8000-00000000aa04',-38.95,-68.06,12,'gps',1),
('60000000-0000-4000-8000-00000000bb01','70000000-0000-4000-8000-00000000bb01','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','10000000-0000-4000-8000-00000000bb04',-38.96,-68.07,12,'gps',1);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client,device_label,app_version,first_seen_at,last_seen_at) values
('20000000-0000-4000-8000-00000000aa01','10000000-0000-4000-8000-00000000aa01','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','owner','panel_web','A owner','candidate',now(),now()),
('20000000-0000-4000-8000-00000000aa02','10000000-0000-4000-8000-00000000aa02','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','admin','panel_web','A admin','candidate',now(),now()),
('20000000-0000-4000-8000-00000000aa03','10000000-0000-4000-8000-00000000aa03','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','staff','panel_web','A staff','candidate',now(),now()),
('20000000-0000-4000-8000-00000000aa04','10000000-0000-4000-8000-00000000aa04','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','rider','rider_android','A rider','candidate',now(),now()),
('20000000-0000-4000-8000-00000000bb01','10000000-0000-4000-8000-00000000bb01','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','owner','panel_web','B owner','candidate',now(),now()),
('20000000-0000-4000-8000-00000000bb02','10000000-0000-4000-8000-00000000bb02','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','admin','panel_web','B admin','candidate',now(),now()),
('20000000-0000-4000-8000-00000000bb03','10000000-0000-4000-8000-00000000bb03','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','staff','panel_web','B staff','candidate',now(),now()),
('20000000-0000-4000-8000-00000000bb04','10000000-0000-4000-8000-00000000bb04','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','rider','rider_android','B rider','candidate',now(),now());
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client,device_label,app_version,first_seen_at,last_seen_at,revoked_at,revoked_by,revoked_reason) values
('20000000-0000-4000-8000-00000000aa09','10000000-0000-4000-8000-00000000aa01','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','owner','panel_web','A revoked','candidate',now(),now(),now(),'10000000-0000-4000-8000-00000000aa01','owner_revoked');

commit;
