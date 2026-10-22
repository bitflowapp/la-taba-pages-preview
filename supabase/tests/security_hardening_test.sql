-- TABA · ENDURECIMIENTO DE SEGURIDAD (migración 20261021235000)
--
-- Positivo y negativo:
--   1. admisión de pedidos: límite de pendientes y de ritmo por cliente y
--      comercio, qué checkouts cuentan y cuáles no, el pedido de un pago ya
--      aprobado nunca se rechaza, y el reintento idempotente del RPC real
--      devuelve el mismo pedido aunque el cliente esté en el límite;
--   2. la ventana QA cierra pedidos y checkouts aunque el tenant siga `open`;
--   3. las purgas de retención borran sólo lo vencido que nada referencia;
--   4. privilegios: combos sólo para service_role, stock sin UPDATE directo,
--      purgas sin API pública, stubs privados con search_path y watchdog que
--      sólo registra un origen con forma de slug.
--
-- Todo transaccional: termina en rollback y no deja una fila. Cada aserción
-- empieza al comienzo de la línea y no lleva «;» adentro, así
-- scripts/recovery/verify-hosted-sql.mjs puede contarlas en el proyecto alojado.

begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('e7000000-0000-4000-8000-0000000000a1','authenticated','authenticated','sh-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('e7000000-0000-4000-8000-0000000000c1','authenticated','authenticated','sh-cliente-1@example.invalid','',now(),'{}','{}',now(),now()),
  ('e7000000-0000-4000-8000-0000000000c2','authenticated','authenticated','sh-cliente-2@example.invalid','',now(),'{}','{}',now(),now()),
  ('e7000000-0000-4000-8000-0000000000c3','authenticated','authenticated','sh-cliente-3@example.invalid','',now(),'{}','{}',now(),now()),
  ('e7000000-0000-4000-8000-0000000000c4','authenticated','authenticated','sh-cliente-4@example.invalid','',now(),'{}','{}',now(),now());

-- L: hasta 2 pendientes. R: hasta 3 por 10 minutos. F: sin límites (como hoy).
-- Q: tenant QA abierto con la ventana vencida. P: el RPC real con 1 pendiente.
insert into public.businesses(id,name,status,slug,is_active,operating_timezone,ordering_enabled,ordering_verified,
  ordering_verified_at,ordering_verified_by,currency_code,pickup_enabled,qa_fixture,qa_window_until,
  max_pending_orders_per_customer,order_rate_limit_per_10_minutes)
values
  ('e7000000-0000-4000-8000-0000000000b1','SH pendientes','open','sh-pendientes',true,'America/Argentina/Buenos_Aires',true,true,
    now(),'e7000000-0000-4000-8000-0000000000a1','ARS',true,false,null,2,null),
  ('e7000000-0000-4000-8000-0000000000b2','SH ritmo','open','sh-ritmo',true,'America/Argentina/Buenos_Aires',true,true,
    now(),'e7000000-0000-4000-8000-0000000000a1','ARS',true,false,null,null,3),
  ('e7000000-0000-4000-8000-0000000000b3','SH sin limites','open','sh-sin-limites',true,'America/Argentina/Buenos_Aires',true,true,
    now(),'e7000000-0000-4000-8000-0000000000a1','ARS',true,false,null,null,null),
  ('e7000000-0000-4000-8000-0000000000b4','SH QA vencido','open','sh-qa-vencido',true,'America/Argentina/Buenos_Aires',true,true,
    now(),'e7000000-0000-4000-8000-0000000000a1','ARS',true,true,now() - interval '1 minute',null,null),
  ('e7000000-0000-4000-8000-0000000000b5','SH idempotencia','open','sh-idempotencia',true,'America/Argentina/Buenos_Aires',true,true,
    now(),'e7000000-0000-4000-8000-0000000000a1','ARS',true,false,null,1,null);

-- Mismo producto comercial verificado sin imagen que usan los tenants QA
-- (scripts/recovery/provision-qa.mjs) y caja_clara_pos_integration_test.
insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
  variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
  stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
  external_id,sku,catalog_origin,units_per_pack)
values
  ('e7000000-0000-4000-8000-0000000000d1','e7000000-0000-4000-8000-0000000000b5','Agua SH 1,5 L','Aguas','Sin gas',1200,'confirmed',true,'Marca',
   'Botella','Botella',1.5,'l','1.5 l','botella',10,true,true,false,'{}',true,now(),'e7000000-0000-4000-8000-0000000000a1','sh-agua','sh-agua','commercial',1);

-- Un pedido en efectivo (o el estado/medio que se pida) insertado directo: el
-- trigger corre en el INSERT, igual que cuando lo inserta el núcleo.
create or replace function pg_temp.pedido(p_business uuid, p_customer uuid, p_status text,
  p_payment text default 'cash', p_created timestamptz default now())
returns uuid language sql as $$
  insert into public.orders(business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,
    customer_user_id,customer_name,customer_phone,payment_method,subtotal,delivery_fee,total,created_at)
  select p_business, c.code, c.code, p_status, 'pickup', 'pickup', 'sh-' || c.code,
         p_customer, 'Cliente Seguridad', '2995550812', p_payment, 100, 0, 100, p_created
    from (select 'SH' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) as code) c
  returning id
$$;

create or replace function pg_temp.sesion(p_business uuid, p_customer uuid, p_status text,
  p_created timestamptz default clock_timestamp(),
  p_expires timestamptz default clock_timestamp() + interval '30 minutes')
returns uuid language sql as $$
  insert into public.checkout_sessions(business_id,customer_id,client_request_id,normalized_intent_hash,fulfillment_type,
    currency,subtotal,total,status,created_at,expires_at)
  values (p_business, p_customer, 'sh-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), repeat('a', 64),
    'pickup', 'ARS', 900, 900, p_status, p_created, p_expires)
  returning id
$$;

-- El payload que manda el storefront para un retiro en efectivo
-- (scripts/recovery/verify-order-realtime.mjs), con la clave del intento.
create or replace function pg_temp.pedido_rpc(p_request text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'business_id', 'e7000000-0000-4000-8000-0000000000b5',
    'client_request_id', p_request,
    'tracking_token', 'shtracking-' || p_request || repeat('x', 32),
    'items', jsonb_build_array(jsonb_build_object('product_id', 'e7000000-0000-4000-8000-0000000000d1', 'quantity', 1)),
    'customer_name', 'Cliente Seguridad',
    'customer_phone', '2995550812',
    'delivery_mode', 'pickup',
    'payment_method', 'cash',
    'age_confirmed', true,
    'customer_notes', 'prueba de limite, no entregar')
$$;

-- ══════════════════════════════════════════════════════════════════════════
--  1 · ADMISIÓN: pendientes por cliente (L, máximo 2)
-- ══════════════════════════════════════════════════════════════════════════
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000c1', 'received')$$,
  'L: primer pedido pendiente entra');
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000c1', 'accepted')$$,
  'L: segundo pedido pendiente entra');
select throws_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000c1', 'received')$$,
  '54000', 'demasiados pedidos sin terminar en este comercio', 'L: el tercero choca con el límite de pendientes');
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000c1', 'received', 'mercadopago')$$,
  'L: el pedido de un pago ya aprobado nunca se rechaza, aunque el cliente esté en el límite');
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000c3', 'received')$$,
  'L: el límite es por cliente: otra persona pide igual');

-- Lo terminado no cuenta.
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000c2', s)
  from unnest(array['delivered', 'cancelled', 'canceled', 'rejected']) s$$,
  'L: cuatro pedidos terminados del mismo cliente entran');
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000c2', 'preparing')$$,
  'L: con cuatro terminados, el primero pendiente entra');
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000c2', 'ready')$$,
  'L: los terminados no cuentan: el segundo pendiente entra');

-- Checkouts: cuenta el que sigue pagable; no el vencido ni el completado.
select lives_ok($$select pg_temp.sesion('e7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000c4', 'redirected')$$,
  'L: un checkout pagable entra');
select lives_ok($$select pg_temp.sesion('e7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000c4', 'payment_pending',
  clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour')$$,
  'L: un checkout vencido entra');
select lives_ok($$select pg_temp.sesion('e7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000c4', 'completed')$$,
  'L: un checkout completado entra');
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000c4', 'received')$$,
  'L: con un checkout pagable (el vencido y el completado no cuentan), el pedido entra');
select throws_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000c4', 'received')$$,
  '54000', 'demasiados pedidos sin terminar en este comercio', 'L: checkout pagable + pedido = 2: el siguiente pedido no entra');
select throws_ok($$select pg_temp.sesion('e7000000-0000-4000-8000-0000000000b1', 'e7000000-0000-4000-8000-0000000000c4', 'validating')$$,
  '54000', 'demasiados pedidos sin terminar en este comercio', 'L: y un checkout nuevo tampoco');

-- Sin límites configurados no cambia nada.
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b3', 'e7000000-0000-4000-8000-0000000000c1', 'received')
  from generate_series(1, 4)$$,
  'F: sin límites, cuatro pedidos pendientes del mismo cliente entran como hoy');

-- ══════════════════════════════════════════════════════════════════════════
--  2 · ADMISIÓN: ritmo por cliente (R, máximo 3 en 10 minutos)
-- ══════════════════════════════════════════════════════════════════════════
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b2', 'e7000000-0000-4000-8000-0000000000c1', 'delivered',
  'cash', now() - interval '20 minutes')$$,
  'R: un pedido de hace 20 minutos entra');
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b2', 'e7000000-0000-4000-8000-0000000000c1', 'delivered',
  'cash', now() - interval '15 minutes')$$,
  'R: otro de hace 15 minutos entra');
select lives_ok($$select pg_temp.sesion('e7000000-0000-4000-8000-0000000000b2', 'e7000000-0000-4000-8000-0000000000c1', 'cancelled')$$,
  'R: los de más de 10 minutos no cuentan: un checkout entra');
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b2', 'e7000000-0000-4000-8000-0000000000c1', 'delivered')$$,
  'R: segundo intento reciente entra');
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b2', 'e7000000-0000-4000-8000-0000000000c1', 'delivered')$$,
  'R: tercer intento reciente entra');
select throws_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b2', 'e7000000-0000-4000-8000-0000000000c1', 'delivered')$$,
  '54000', 'demasiados pedidos en los ultimos 10 minutos', 'R: el cuarto en 10 minutos no entra (el checkout cancelado cuenta)');
select throws_ok($$select pg_temp.sesion('e7000000-0000-4000-8000-0000000000b2', 'e7000000-0000-4000-8000-0000000000c1', 'created')$$,
  '54000', 'demasiados pedidos en los ultimos 10 minutos', 'R: tampoco un checkout nuevo');
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b2', 'e7000000-0000-4000-8000-0000000000c1', 'received', 'mercadopago')$$,
  'R: el pedido de un pago aprobado entra igual');

-- ══════════════════════════════════════════════════════════════════════════
--  3 · EL RPC REAL: el reintento idempotente no choca con el límite (P, máximo 1)
-- ══════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims',
  '{"sub":"e7000000-0000-4000-8000-0000000000c4","role":"authenticated"}', true);
select lives_ok($$select public.create_order_with_items(pg_temp.pedido_rpc('sh-limit-req-0001'))$$,
  'P: el primer pedido por el RPC entra');
select throws_ok($$select public.create_order_with_items(pg_temp.pedido_rpc('sh-limit-req-0002'))$$,
  '54000', 'demasiados pedidos sin terminar en este comercio', 'P: un segundo pedido distinto choca con el límite de 1');
select is((public.create_order_with_items(pg_temp.pedido_rpc('sh-limit-req-0001'))) ->> 'id',
  (select o.id::text from public.orders o
    where o.business_id = 'e7000000-0000-4000-8000-0000000000b5' and o.client_request_id = 'sh-limit-req-0001'),
  'P: el reintento con la misma clave devuelve el mismo pedido aunque el cliente esté en el límite');
select is((select count(*)::integer from public.orders where business_id = 'e7000000-0000-4000-8000-0000000000b5'), 1,
  'P: queda un solo pedido');
select is((select stock from public.products where id = 'e7000000-0000-4000-8000-0000000000d1'), 9,
  'P: el stock se descontó una sola vez: el rechazo y el reintento no lo movieron');
select set_config('request.jwt.claims', '', true);

-- ══════════════════════════════════════════════════════════════════════════
--  4 · VENTANA QA: tenant `open` con la ventana vencida (Q)
-- ══════════════════════════════════════════════════════════════════════════
select throws_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b4', 'e7000000-0000-4000-8000-0000000000c1', 'received')$$,
  '55000', 'el negocio no esta habilitado para recibir pedidos', 'Q: ventana vencida: el pedido en efectivo no entra');
select throws_ok($$select pg_temp.sesion('e7000000-0000-4000-8000-0000000000b4', 'e7000000-0000-4000-8000-0000000000c1', 'validating')$$,
  '55000', 'el negocio no esta habilitado para recibir pedidos', 'Q: ventana vencida: el checkout no entra');
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b4', 'e7000000-0000-4000-8000-0000000000c1', 'received', 'mercadopago')$$,
  'Q: el pedido de un pago ya aprobado entra aunque la ventana haya vencido');
update public.businesses set qa_window_until = now() + interval '10 minutes' where id = 'e7000000-0000-4000-8000-0000000000b4';
select lives_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b4', 'e7000000-0000-4000-8000-0000000000c1', 'received')$$,
  'Q: dentro de la ventana el pedido entra');
update public.businesses set qa_window_until = null where id = 'e7000000-0000-4000-8000-0000000000b4';
select throws_ok($$select pg_temp.pedido('e7000000-0000-4000-8000-0000000000b4', 'e7000000-0000-4000-8000-0000000000c1', 'received')$$,
  '55000', 'el negocio no esta habilitado para recibir pedidos', 'Q: abierto sin ventana (otro camino o un runner muerto): no entra');

-- ══════════════════════════════════════════════════════════════════════════
--  5 · RETENCIÓN
-- ══════════════════════════════════════════════════════════════════════════
insert into public.payment_rate_limit_buckets(scope,subject_hash,bucket_started_at,request_count,updated_at)
values
  ('checkout_session', repeat('e', 63) || '1', clock_timestamp() - interval '2 days', 3, clock_timestamp() - interval '2 days'),
  ('checkout_session', repeat('e', 63) || '2', clock_timestamp() - interval '30 minutes', 1, clock_timestamp());
select ok(public.purge_expired_payment_rate_limit_buckets(50000) >= 1, 'purga de buckets: borra al menos el vencido');
select is((select count(*)::integer from public.payment_rate_limit_buckets where subject_hash like 'eeeeeeeeee%'), 1,
  'purga de buckets: queda sólo el de la ventana actual');
select ok(exists (select 1 from public.payment_rate_limit_buckets where subject_hash = repeat('e', 63) || '2'),
  'purga de buckets: el reciente sigue');

insert into public.payment_webhook_receipts(environment,webhook_event_id,event_type,resource_id,signature_valid,payload_hash,
  received_at,processing_status)
values
  ('test','sh-webhook-1','payment','sh-resource-1',false,repeat('f', 64),clock_timestamp() - interval '20 days','rejected_signature'),
  ('test','sh-webhook-2','payment','sh-resource-2',false,repeat('f', 64),clock_timestamp() - interval '1 day','rejected_signature'),
  ('test','sh-webhook-3','payment','sh-resource-3',true,repeat('f', 64),clock_timestamp() - interval '20 days','completed');
select ok(public.purge_rejected_webhook_receipts(50000) >= 1, 'purga de webhooks: borra al menos el inválido viejo');
select ok(not exists (select 1 from public.payment_webhook_receipts where webhook_event_id = 'sh-webhook-1'),
  'purga de webhooks: el inválido de 20 días ya no está');
select is((select count(*)::integer from public.payment_webhook_receipts where webhook_event_id in ('sh-webhook-2', 'sh-webhook-3')), 2,
  'purga de webhooks: el inválido reciente y el válido viejo siguen');

-- Anónimos: viejo sin rastro (se va), viejo con un evento propio (queda),
-- reciente (queda) y uno con correo, viejo (queda).
insert into auth.users(id,aud,role,is_anonymous,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,last_sign_in_at)
values
  ('e7000000-0000-4000-8000-0000000000e1','authenticated','authenticated',true,'{}','{}',now() - interval '40 days',now() - interval '40 days',now() - interval '40 days'),
  ('e7000000-0000-4000-8000-0000000000e2','authenticated','authenticated',true,'{}','{}',now() - interval '40 days',now() - interval '40 days',now() - interval '40 days'),
  ('e7000000-0000-4000-8000-0000000000e3','authenticated','authenticated',true,'{}','{}',now() - interval '1 day',now() - interval '1 day',now() - interval '1 day');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,last_sign_in_at)
values ('e7000000-0000-4000-8000-0000000000e4','authenticated','authenticated','sh-viejo@example.invalid','',now(),'{}','{}',
  now() - interval '40 days',now() - interval '40 days',now() - interval '40 days');
insert into public.order_abuse_events(business_id,customer_user_id,event_type)
values ('e7000000-0000-4000-8000-0000000000b3','e7000000-0000-4000-8000-0000000000e2','sh_fixture');
select ok(public.purge_stale_anonymous_users(1000) >= 1, 'purga de anónimos: borra al menos el viejo sin rastro');
select ok(not exists (select 1 from auth.users where id = 'e7000000-0000-4000-8000-0000000000e1'),
  'purga de anónimos: el anónimo de 40 días sin ninguna referencia ya no está');
select is((select count(*)::integer from auth.users where id in ('e7000000-0000-4000-8000-0000000000e2',
  'e7000000-0000-4000-8000-0000000000e3', 'e7000000-0000-4000-8000-0000000000e4')), 3,
  'purga de anónimos: quedan el referenciado, el reciente y el que tiene correo');
select ok((select jsonb_typeof(r -> 'rate_limit_buckets') = 'number'
    and jsonb_typeof(r -> 'rejected_webhook_receipts') = 'number'
    and jsonb_typeof(r -> 'anonymous_users') in ('number', 'null')
  from (select public.run_security_retention_sweep() as r) sweep),
  'la tarea de retención corre y dice qué hizo');
select is((select count(*)::integer from cron.job where jobname = 'taba-security-retention-sweep'
  and schedule = '*/5 * * * *' and command = 'select public.run_security_retention_sweep();'), 1,
  'la tarea taba-security-retention-sweep existe cada 5 minutos (se crea inactiva)');

-- ══════════════════════════════════════════════════════════════════════════
--  6 · PRIVILEGIOS
-- ══════════════════════════════════════════════════════════════════════════
select ok(not has_function_privilege('anon', 'public.list_business_combos(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.list_business_combos(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.resolve_business_combo(uuid,text,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.resolve_business_combo(uuid,text,integer)', 'EXECUTE'),
  'los RPC de combos ya no se ejecutan con la clave publicable ni con una sesión');
select ok(has_function_privilege('service_role', 'public.list_business_combos(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.resolve_business_combo(uuid,text,integer)', 'EXECUTE'),
  'service_role conserva los RPC de combos (scripts/import-combos.mjs)');
select ok(not has_column_privilege('authenticated', 'public.products', 'stock', 'UPDATE'),
  'authenticated ya no escribe products.stock directo');
select ok(has_column_privilege('authenticated', 'public.products', 'available', 'UPDATE')
  and has_column_privilege('authenticated', 'public.products', 'is_active', 'UPDATE')
  and has_column_privilege('authenticated', 'public.products', 'sort_order', 'UPDATE'),
  'available, is_active y sort_order no cambian');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('enforce_customer_order_admission', 'purge_expired_payment_rate_limit_buckets',
                      'purge_rejected_webhook_receipts', 'purge_stale_anonymous_users', 'run_security_retention_sweep')
    and p.prosecdef
    and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
    and not has_function_privilege('anon', p.oid, 'EXECUTE')
    and not has_function_privilege('authenticated', p.oid, 'EXECUTE')), 5,
  'las cinco funciones nuevas fijan search_path y no son API pública');
select ok(has_function_privilege('service_role', 'public.run_security_retention_sweep()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.purge_stale_anonymous_users(integer)', 'EXECUTE'),
  'service_role puede correr las purgas a mano');
select is((select count(*)::integer from pg_trigger t
  where t.tgfoid = 'public.enforce_customer_order_admission()'::regprocedure and not t.tgisinternal
    and t.tgrelid in ('public.orders'::regclass, 'public.checkout_sessions'::regclass)), 2,
  'el trigger de admisión está en orders y en checkout_sessions');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in ('set_a1_a4_payment_dispatch_paused_v3', 'create_a1_a4_drain_attestation_v3',
                      'execute_a1_a4_legacy_contract_v3')
    and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
    and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and not has_function_privilege('service_role', p.oid, 'EXECUTE')), 3,
  'los tres stubs privados A1-A4 fijan search_path y nadie los ejecuta');
select ok(has_function_privilege('anon', 'public.check_scheduler_watchdog(text)', 'EXECUTE'),
  'el watchdog sigue siendo anónimo (lo llama el workflow con la clave publicable)');
select is((public.check_scheduler_watchdog('github_actions')) ->> 'source', 'github_actions',
  'watchdog: un origen slug se registra tal cual');
select is((public.check_scheduler_watchdog('Llamá al 0800 <b>urgente</b>')) ->> 'source', 'external',
  'watchdog: un texto arbitrario se registra como external');

select * from finish();
rollback;
