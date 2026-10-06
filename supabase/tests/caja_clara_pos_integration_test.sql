-- TABA · CAJA CLARA COMO TERMINAL OPERATIVA DEL LOCAL
--
-- Lo que esta suite tiene que demostrar:
--
--   1. identidad: Caja Clara entra como owner/admin/staff con sesión registrada
--      («caja_clara_windows») atada al hash de su DeviceId; un rider no puede,
--      y las RPC pos_* rechazan sesiones del Panel, de otra PC, revocadas o de
--      otro comercio;
--   2. un solo inventario: disponible (products.stock), reservado (pedidos que
--      no salieron + checkouts vivos) y físico = disponible + reservado;
--   3. movimientos idempotentes: el reintento no descuenta dos veces, una clave
--      reusada con otro contenido se rechaza, un SKU que no coincide también;
--   4. el conflicto: stock 3, la tienda reserva 2, la caja vende 3 sin
--      conexión → nunca −2: se aplica hasta 0, se abre un conflicto con el
--      faltante y los pedidos que retienen reserva, el producto queda retenido
--      (ni una cancelación lo vuelve a ofrecer) y sólo un conteo de owner/admin
--      lo cierra;
--   5. pedidos minimizados: sin código de entrega ni GPS; teléfono y dirección
--      sólo mientras el pedido está activo;
--   6. el estado de Mercado Pago llega como una palabra, nunca con tokens.
--
-- anon se verifica con has_*_privilege (ver local_print_agent_test).
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a8000000-0000-4000-8000-000000000001','authenticated','authenticated','cc-owner-a@example.invalid','',now(),'{}','{"display_name":"Duenia A"}',now(),now()),
  ('a8000000-0000-4000-8000-000000000002','authenticated','authenticated','cc-staff-a@example.invalid','',now(),'{}','{"display_name":"Cajero A"}',now(),now()),
  ('a8000000-0000-4000-8000-000000000003','authenticated','authenticated','cc-rider-a@example.invalid','',now(),'{}','{"display_name":"Rider Norte"}',now(),now()),
  ('a8000000-0000-4000-8000-000000000004','authenticated','authenticated','cc-owner-b@example.invalid','',now(),'{}','{"display_name":"Duenio B"}',now(),now());

insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
values
  ('b8000000-0000-4000-8000-000000000001','CAJA CLARA A','open','caja-clara-a',true,'America/Argentina/Buenos_Aires'),
  ('b8000000-0000-4000-8000-000000000002','CAJA CLARA B','open','caja-clara-b',true,'America/Argentina/Buenos_Aires');

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('b8000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','owner',true),
  ('b8000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000002','staff',true),
  ('b8000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000003','rider',true),
  ('b8000000-0000-4000-8000-000000000002','a8000000-0000-4000-8000-000000000004','owner',true);

-- H1 = sha256('caja-1'), H2 = sha256('caja-2'): dos PCs distintas.
create temporary table t_ctx(k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;
insert into t_ctx values
  ('h1', encode(extensions.digest('caja-1', 'sha256'), 'hex')),
  ('h2', encode(extensions.digest('caja-2', 'sha256'), 'hex'));
create or replace function pg_temp.ctx(p_key text) returns text language sql as $$ select v from t_ctx where k = p_key $$;
create or replace function pg_temp.put(p_key text, p_value text) returns text language sql as $$
  insert into t_ctx values (p_key, p_value) on conflict (k) do update set v = excluded.v returning v $$;
create or replace function pg_temp.as_user(p_user uuid, p_session uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void;
$$;
create or replace function pg_temp.sin_sesion() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)::void;
$$;

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client,device_key_hash,revoked_at,revoked_reason)
values
  ('c8000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000001','owner','caja_clara_windows',pg_temp.ctx('h1'),null,null),
  ('c8000000-0000-4000-8000-000000000002','a8000000-0000-4000-8000-000000000002','b8000000-0000-4000-8000-000000000001','staff','caja_clara_windows',pg_temp.ctx('h1'),null,null),
  ('c8000000-0000-4000-8000-000000000003','a8000000-0000-4000-8000-000000000002','b8000000-0000-4000-8000-000000000001','staff','panel_web',null,null,null),
  ('c8000000-0000-4000-8000-000000000004','a8000000-0000-4000-8000-000000000003','b8000000-0000-4000-8000-000000000001','rider','rider_android',null,null,null),
  ('c8000000-0000-4000-8000-000000000005','a8000000-0000-4000-8000-000000000004','b8000000-0000-4000-8000-000000000002','owner','caja_clara_windows',pg_temp.ctx('h2'),null,null),
  ('c8000000-0000-4000-8000-000000000006','a8000000-0000-4000-8000-000000000002','b8000000-0000-4000-8000-000000000001','staff','caja_clara_windows',pg_temp.ctx('h2'),null,null),
  ('c8000000-0000-4000-8000-000000000007','a8000000-0000-4000-8000-000000000002','b8000000-0000-4000-8000-000000000001','staff','caja_clara_windows',pg_temp.ctx('h1'),now(),'owner_revoked');

insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
  variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
  stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
  external_id,sku,catalog_origin,units_per_pack)
values
  ('d8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000001','Agua 1,5 L','Aguas','Sin gas',1200,'confirmed',true,'Marca',
   'Botella','Botella',1.5,'l','1.5 l','botella',3,true,true,false,'{}',true,now(),'a8000000-0000-4000-8000-000000000001','cc-agua','cc-agua','commercial',1),
  ('d8000000-0000-4000-8000-000000000002','b8000000-0000-4000-8000-000000000001','Gaseosa 2 L','Gaseosas','Cola',2500,'confirmed',true,'Marca',
   'Botella','Botella',2,'l','2 l','botella',null,false,true,false,'{}',false,null,null,'cc-gaseosa','cc-gaseosa','commercial',1),
  ('d8000000-0000-4000-8000-000000000003','b8000000-0000-4000-8000-000000000001','Jugo 1 L','Jugos','Naranja',1800,'confirmed',true,'Marca',
   'Caja','Caja',1,'l','1 l','caja',5,false,false,false,'{}',true,now(),'a8000000-0000-4000-8000-000000000001','cc-jugo','cc-jugo','commercial',1),
  ('d8000000-0000-4000-8000-000000000004','b8000000-0000-4000-8000-000000000001','Galletitas','Almacén','Dulces',900,'confirmed',true,'Marca',
   'Paquete','Paquete',300,'g','300 g','paquete',0,false,true,false,'{}',true,now(),'a8000000-0000-4000-8000-000000000001','cc-galletitas','cc-galletitas','commercial',1),
  ('d8000000-0000-4000-8000-000000000009','b8000000-0000-4000-8000-000000000002','Producto B','Almacén','Varios',700,'confirmed',true,'Marca',
   'Unidad','Unidad',1,'unidad','1 unidad','unidad',10,true,true,false,'{}',true,now(),'a8000000-0000-4000-8000-000000000004','cc-b','cc-b','commercial',1);

-- O1: retiro aceptado que reserva 2 de Agua (el pedido online ya descontó el
-- disponible: 3 → 1). O2: envío listo, sin rider. O9: pedido del comercio B.
insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,customer_neighborhood,customer_street_address,
  customer_phone,payment_method,subtotal,delivery_fee,total,customer_notes,delivery_address_formatted
) values
  ('e8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000001','CC-1','CC-1','accepted','pickup','pickup',
   'cc-request-1','Ana','Centro','Mendoza 1','+5429900000001','cash',2400,0,2400,'sin bolsa',null),
  ('e8000000-0000-4000-8000-000000000002','b8000000-0000-4000-8000-000000000001','CC-2','CC-2','ready','delivery','delivery',
   'cc-request-2','Beto','Centro','Mendoza 2','+5429900000002','cash',1800,300,2100,'timbre roto','Mendoza 2, Neuquén'),
  ('e8000000-0000-4000-8000-000000000009','b8000000-0000-4000-8000-000000000002','CC-9','CC-9','submitted','pickup','pickup',
   'cc-request-9','Otro','Centro','Otra 9','+5429900000009','cash',700,0,700,null,null);
insert into public.order_items(order_id,product_id,name,quantity,unit,unit_price,subtotal,product_uuid) values
  ('e8000000-0000-4000-8000-000000000001','cc-agua','Agua 1,5 L',2,'u',1200,2400,'d8000000-0000-4000-8000-000000000001'),
  ('e8000000-0000-4000-8000-000000000002','cc-jugo','Jugo 1 L',1,'u',1800,1800,'d8000000-0000-4000-8000-000000000003'),
  ('e8000000-0000-4000-8000-000000000009','cc-b','Producto B',1,'u',700,700,'d8000000-0000-4000-8000-000000000009');
update public.products set stock = 1 where id = 'd8000000-0000-4000-8000-000000000001';
-- O2 ya reservó 1 Jugo: 5 es lo que quedó disponible.

-- Un checkout vivo de Mercado Pago retiene 1 Galletita más (sin stock hoy).
insert into public.checkout_sessions(id,business_id,customer_id,client_request_id,normalized_intent_hash,fulfillment_type,currency,subtotal,total,status,expires_at)
values ('f8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001',
        'cc-checkout-01',repeat('a',64),'pickup','ARS',900,900,'created',now()+interval '1 hour');
insert into public.inventory_reservations(checkout_session_id,product_id,quantity,status,expires_at)
values ('f8000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000004',1,'active',now()+interval '1 hour');

create or replace function pg_temp.stock(p uuid) returns integer language sql as $$ select stock from public.products where id = p $$;
create or replace function pg_temp.avail(p uuid) returns boolean language sql as $$ select available from public.products where id = p $$;
create or replace function pg_temp.mv(p_key text, p_product uuid, p_sku text, p_kind text, p_delta integer, p_device text default null)
returns jsonb language sql as $$
  select (public.pos_apply_stock_movements('b8000000-0000-4000-8000-000000000001', coalesce(p_device, pg_temp.ctx('h1')),
    jsonb_build_array(jsonb_build_object('key', p_key, 'product_id', p_product, 'sku', p_sku, 'kind', p_kind, 'delta', p_delta,
      'occurred_at', '2026-09-29T03:00:00Z'))) -> 'results' -> 0);
$$;
create or replace function pg_temp.catalog_row(p uuid) returns jsonb language sql as $$
  select r from jsonb_array_elements(public.pos_get_catalog_state('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1')) -> 'products') r
   where r ->> 'id' = p::text $$;

-- ══ 0 · SUPERFICIE Y MENOR PRIVILEGIO ════════════════════════════════════════
select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relrowsecurity and c.relname in ('pos_stock_conflicts','pos_stock_receipts')),
  2, 'las 2 tablas de Caja Clara tienen RLS');
select ok(not exists (
  select 1 from unnest(array['pos_stock_conflicts','pos_stock_receipts']) t, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
   where has_table_privilege('anon', 'public.' || t, p)), 'anon no toca las tablas de Caja Clara');
select ok(not exists (
  select 1 from unnest(array['pos_stock_conflicts','pos_stock_receipts']) t, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
   where has_table_privilege('authenticated', 'public.' || t, p)), 'authenticated tampoco: se leen y escriben sólo por RPC');
select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'pos\_%' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'ninguna RPC pos_* es ejecutable por anon');
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('pos_get_catalog_state','pos_apply_stock_movements','pos_apply_stock_count','pos_list_orders','pos_get_store_overview')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE') and p.prosecdef),
  5, 'las 5 RPC de Caja Clara son SECURITY DEFINER y ejecutables por el equipo autenticado');
select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname like 'pos\_%'
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))),
  'los helpers private.pos_* no se ejecutan desde afuera');

-- ══ 1 · IDENTIDAD DE LA TERMINAL ═════════════════════════════════════════════
select pg_temp.as_user('a8000000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000008');
select is(
  public.identity_register_session('b8000000-0000-4000-8000-000000000001', 'caja_clara_windows', 'Caja 1', pg_temp.ctx('h1'), '1.1.0') ->> 'role',
  'staff', 'un cajero registra su sesión de Caja Clara con el hash de la PC');
select ok(exists (
  select 1 from public.identity_sessions where session_id = 'c8000000-0000-4000-8000-000000000008'
     and client = 'caja_clara_windows' and device_key_hash = pg_temp.ctx('h1')),
  'la sesión queda como caja_clara_windows y atada al dispositivo');
select pg_temp.as_user('a8000000-0000-4000-8000-000000000003', 'c8000000-0000-4000-8000-000000000009');
select is(
  public.identity_register_session('b8000000-0000-4000-8000-000000000001', 'caja_clara_windows', 'Caja rider', pg_temp.ctx('h1'), '1.1.0') ->> 'code',
  'not_authorized', 'un rider no abre una sesión de Caja Clara');
select pg_temp.as_user('a8000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-00000000000a');
select is(
  public.identity_register_session('b8000000-0000-4000-8000-000000000001', 'caja_clara_windows', 'Caja sin hash', null, '1.1.0') ->> 'code',
  'not_authorized', 'una sesión de Caja Clara sin identidad de dispositivo se rechaza');
select pg_temp.as_user('a8000000-0000-4000-8000-000000000004', 'c8000000-0000-4000-8000-00000000000b');
select is(
  public.identity_register_session('b8000000-0000-4000-8000-000000000002', 'panel_web', 'Panel', null, '1.0.0') ->> 'code',
  'registered', 'el Panel sigue registrando sesiones como siempre');

-- ══ 2 · LA TERMINAL ESTÁ ATADA A SU SESIÓN Y A SU PC ═════════════════════════
select pg_temp.as_user('a8000000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000003');
select throws_ok($$ select public.pos_get_catalog_state('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1')) $$,
  '42501', null, 'una sesión del Panel no usa el contrato de Caja Clara');
select pg_temp.as_user('a8000000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000006');
select throws_ok($$ select public.pos_get_catalog_state('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1')) $$,
  '42501', null, 'la sesión de otra PC no puede presentarse como la caja 1');
select pg_temp.as_user('a8000000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000007');
select throws_ok($$ select public.pos_get_catalog_state('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1')) $$,
  '42501', null, 'una sesión revocada queda afuera');
select pg_temp.as_user('a8000000-0000-4000-8000-000000000004', 'c8000000-0000-4000-8000-000000000005');
select throws_ok($$ select public.pos_get_catalog_state('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h2')) $$,
  '42501', null, 'la caja del comercio B no lee el comercio A');
select pg_temp.as_user('a8000000-0000-4000-8000-000000000003', 'c8000000-0000-4000-8000-000000000004');
select throws_ok($$ select public.pos_list_orders('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1'), null, 50) $$,
  '42501', null, 'un rider no lee la bandeja de la caja');
select pg_temp.sin_sesion();
select throws_ok($$ select public.pos_list_orders('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1'), null, 50) $$,
  '42501', null, 'sin sesión no hay nada');

-- ══ 3 · UN SOLO INVENTARIO: DISPONIBLE, RESERVADO, FÍSICO ════════════════════
select pg_temp.as_user('a8000000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000002');
select is(
  (select jsonb_build_array(r -> 'stock', r -> 'reserved', r -> 'physical') from pg_temp.catalog_row('d8000000-0000-4000-8000-000000000001') r),
  '[1, 2, 3]'::jsonb, 'Agua: disponible 1, reservado 2 (retiro aceptado), físico 3');
select is(
  (select jsonb_build_array(r -> 'stock', r -> 'reserved', r -> 'physical') from pg_temp.catalog_row('d8000000-0000-4000-8000-000000000004') r),
  '[0, 1, 1]'::jsonb, 'un checkout vivo también reserva: Galletitas disponible 0, reservado 1, físico 1');
select is(
  (select r -> 'physical' from pg_temp.catalog_row('d8000000-0000-4000-8000-000000000002') r),
  'null'::jsonb, 'sin stock contado el físico es desconocido, nunca cero');
select ok(
  (select s ->> 'contract' = 'caja-clara-taba/1' and s::text not like '%unit_cost%'
     from public.pos_get_catalog_state('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1')) s),
  'el catálogo es el contrato caja-clara-taba/1 y no expone el costo');

-- ══ 4 · MOVIMIENTOS IDEMPOTENTES ═════════════════════════════════════════════
select is(pg_temp.mv('cc:mv:0001', 'd8000000-0000-4000-8000-000000000004', 'cc-galletitas', 'purchase', 5) ->> 'status',
  'applied', 'una compra de 5 Galletitas se aplica');
select ok(pg_temp.stock('d8000000-0000-4000-8000-000000000004') = 5 and pg_temp.avail('d8000000-0000-4000-8000-000000000004'),
  'con stock y publicado por el comercio, vuelve a ofrecerse online');
select pg_temp.mv('cc:mv:0002', 'd8000000-0000-4000-8000-000000000003', 'cc-jugo', 'purchase', 2);
select ok(pg_temp.stock('d8000000-0000-4000-8000-000000000003') = 7 and not pg_temp.avail('d8000000-0000-4000-8000-000000000003'),
  'reponer lo que el comercio ocultó no lo publica: la intención del comercio manda');
select ok((pg_temp.mv('cc:mv:0001', 'd8000000-0000-4000-8000-000000000004', 'cc-galletitas', 'purchase', 5) ->> 'replay')::boolean
  and pg_temp.stock('d8000000-0000-4000-8000-000000000004') = 5, 'el reintento de la misma compra no suma dos veces');
select ok(pg_temp.mv('cc:mv:0001', 'd8000000-0000-4000-8000-000000000004', 'cc-galletitas', 'purchase', 9) ->> 'code' = 'IDEMPOTENCY_KEY_REUSED'
  and pg_temp.stock('d8000000-0000-4000-8000-000000000004') = 5, 'la misma clave con otro contenido se rechaza sin tocar el stock');
select is(pg_temp.mv('cc:mv:0003', 'd8000000-0000-4000-8000-000000000004', 'cc-otro-sku', 'sale', -1) ->> 'code',
  'SKU_MISMATCH', 'un vínculo con SKU que no coincide se rechaza');
select is(pg_temp.mv('cc:mv:0004', 'd8000000-0000-4000-8000-000000000009', 'cc-b', 'sale', -1) ->> 'code',
  'PRODUCT_NOT_FOUND', 'un producto de otro comercio no existe para esta caja');
select is(pg_temp.mv('cc:mv:0005', 'd8000000-0000-4000-8000-000000000002', 'cc-gaseosa', 'sale', -1) ->> 'code',
  'STOCK_NOT_INITIALIZED', 'sin stock contado en La Taba no se aplican deltas: primero un conteo');
select ok(pg_temp.mv('cc:mv:0006', 'd8000000-0000-4000-8000-000000000004', 'cc-galletitas', 'inventar', -1) ->> 'code' = 'INVALID_MOVEMENT'
  and pg_temp.mv('cc:mv:0007', 'd8000000-0000-4000-8000-000000000004', 'cc-galletitas', 'sale', 0) ->> 'code' = 'INVALID_MOVEMENT',
  'tipo desconocido o delta cero son movimientos inválidos');
select ok(exists (
  select 1 from public.inventory_movements m
   where m.product_id = 'd8000000-0000-4000-8000-000000000004' and m.movement_type = 'purchase_receipt'
     and m.quantity_delta = 5 and m.reference_type = 'caja_clara' and m.operator_id = 'a8000000-0000-4000-8000-000000000002'),
  'la compra queda en el ledger inmutable con el operador');
select pg_temp.mv('cc:mv:0008', 'd8000000-0000-4000-8000-000000000004', 'cc-galletitas', 'sale', -1);
select ok(pg_temp.stock('d8000000-0000-4000-8000-000000000004') = 4 and exists (
  select 1 from public.inventory_movements m where m.product_id = 'd8000000-0000-4000-8000-000000000004'
     and m.movement_type = 'sale' and m.quantity_delta = -1), 'una venta de mostrador baja el disponible y queda como venta');

-- ══ 5 · EL CONFLICTO: STOCK 3, RESERVA 2, VENTA SIN CONEXIÓN DE 3 ════════════
select pg_temp.put('conflict', pg_temp.mv('cc:mv:0010', 'd8000000-0000-4000-8000-000000000001', 'cc-agua', 'sale', -3)::text);
select ok(pg_temp.ctx('conflict')::jsonb @> '{"status": "needs_review", "applied_delta": -1, "shortfall": 2, "stock_after": 0}'
  and (pg_temp.mv('cc:mv:0010', 'd8000000-0000-4000-8000-000000000001', 'cc-agua', 'sale', -3) ->> 'replay')::boolean,
  'vender 3 con 1 disponible y 2 reservados: se aplica 1, faltan 2, a revisión (y el reintento es replay)');
select is(pg_temp.stock('d8000000-0000-4000-8000-000000000001'), 0, 'nunca −2: el disponible queda en 0');
select ok(exists (
  select 1 from public.pos_stock_conflicts c
   where c.product_id = 'd8000000-0000-4000-8000-000000000001' and c.status = 'open' and c.kind = 'oversold_offline'
     and c.shortfall = 2 and c.reserved_at_detection = 2 and c.holding_orders @> '[{"public_code": "CC-1", "quantity": 2}]'),
  'se abre un conflicto con el faltante 2 y el pedido CC-1 que retiene la reserva');
select ok(not pg_temp.avail('d8000000-0000-4000-8000-000000000001'), 'el producto queda retenido: no se vende online');
update public.products set available = true, stock = 1 where id = 'd8000000-0000-4000-8000-000000000001';
select ok(not pg_temp.avail('d8000000-0000-4000-8000-000000000001'), 'ni una escritura directa lo vuelve a ofrecer mientras el conflicto siga abierto');
update public.products set stock = 0 where id = 'd8000000-0000-4000-8000-000000000001';
select throws_ok($$ select public.pos_apply_stock_count('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1'),
    'd8000000-0000-4000-8000-000000000001', 'cc-agua', 0, 'Conteo del cajero', 'cc:count:0001') $$,
  '42501', null, 'cerrar un conflicto es decisión de owner o admin, no del cajero');
select pg_temp.as_user('a8000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001');
select pg_temp.put('count2', public.pos_apply_stock_count('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1'),
  'd8000000-0000-4000-8000-000000000001', 'cc-agua', 0, 'Conteo: la góndola está vacía', 'cc:count:0002')::text);
select ok(pg_temp.ctx('count2')::jsonb @> '{"status": "needs_review", "shortfall": 2, "stock_after": 0, "holding_orders": [{"public_code": "CC-1"}]}'
  and exists (select 1 from public.pos_stock_conflicts c where c.product_id = 'd8000000-0000-4000-8000-000000000001'
                 and c.status = 'open' and c.kind = 'count_below_reserved'),
  'contar 0 con 2 reservados deja el conflicto abierto y dice qué pedido resolver');
select pg_temp.as_user('a8000000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000003');
select public.transition_order('e8000000-0000-4000-8000-000000000001',
  (select revision from public.orders where id = 'e8000000-0000-4000-8000-000000000001'), 'cancelled', 'cc-cancel-o1-0001');
select ok(pg_temp.stock('d8000000-0000-4000-8000-000000000001') = 2 and not pg_temp.avail('d8000000-0000-4000-8000-000000000001'),
  'cancelar el pedido devuelve 2 unidades que no existen, pero el producto sigue retenido');
select pg_temp.as_user('a8000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001');
select pg_temp.put('count3', public.pos_apply_stock_count('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1'),
  'd8000000-0000-4000-8000-000000000001', 'cc-agua', 0, 'Recuento tras cancelar CC-1', 'cc:count:0003')::text);
select ok(pg_temp.ctx('count3')::jsonb @> '{"status": "applied", "conflict_resolved": true, "stock_after": 0}'
  and not exists (select 1 from public.pos_stock_conflicts c where c.product_id = 'd8000000-0000-4000-8000-000000000001' and c.status = 'open'),
  'el recuento de la dueña borra las unidades fantasma y cierra el conflicto');
select pg_temp.as_user('a8000000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000002');
select pg_temp.mv('cc:mv:0011', 'd8000000-0000-4000-8000-000000000001', 'cc-agua', 'purchase', 4);
select ok(pg_temp.stock('d8000000-0000-4000-8000-000000000001') = 4 and pg_temp.avail('d8000000-0000-4000-8000-000000000001'),
  'cerrado el conflicto, reponer vuelve a ofrecerlo online');
select pg_temp.as_user('a8000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001');
select ok((public.pos_apply_stock_count('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1'),
    'd8000000-0000-4000-8000-000000000001', 'cc-agua', 0, 'Recuento tras cancelar CC-1', 'cc:count:0003') ->> 'replay')::boolean,
  'el mismo conteo reintentado es un replay');
select throws_ok($$ select public.pos_apply_stock_count('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1'),
    'd8000000-0000-4000-8000-000000000001', 'cc-agua', 7, 'Otro número con la misma clave', 'cc:count:0003') $$,
  '23505', null, 'la clave de un conteo no se reusa para otro número');

-- ══ 6 · PEDIDOS MINIMIZADOS ══════════════════════════════════════════════════
select pg_temp.as_user('a8000000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000002');
select pg_temp.put('orders', public.pos_list_orders('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1'), null, 50)::text);
create or replace function pg_temp.dto(p_code text) returns jsonb language sql as $$
  select o from jsonb_array_elements(pg_temp.ctx('orders')::jsonb -> 'orders') o where o ->> 'public_code' = p_code $$;
select ok(pg_temp.dto('CC-2') -> 'delivery' ->> 'address' = 'Mendoza 2, Neuquén' and pg_temp.dto('CC-2') ->> 'customer_phone' = '+5429900000002',
  'un envío activo trae la dirección y el teléfono para operarlo');
select ok(pg_temp.ctx('orders') not like '%delivery_code%' and pg_temp.ctx('orders') not like '%latitude%'
  and pg_temp.ctx('orders') not like '%address_lat%', 'la bandeja nunca trae el código de entrega ni coordenadas');
select ok(pg_temp.dto('CC-1') ->> 'status' = 'cancelled' and pg_temp.dto('CC-1') -> 'customer_phone' = 'null'::jsonb
  and pg_temp.dto('CC-1') -> 'delivery' = 'null'::jsonb, 'terminado, el pedido ya no expone teléfono ni dirección');
select ok((pg_temp.dto('CC-2') -> 'allowed_actions') @> '["offer_rider", "self_dispatch", "cancel", "confirm_payment"]'
  and not (pg_temp.dto('CC-2') -> 'allowed_actions') ? 'accept', 'listo para enviar: ofrecer rider, reparto propio o cancelar');
select ok(pg_temp.ctx('orders')::jsonb ->> 'next_cursor' is not null
  and jsonb_array_length(public.pos_list_orders('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1'), now() + interval '1 minute', 50) -> 'orders') = 1,
  'con cursor posterior sólo vuelven los pedidos activos (CC-2), no los terminados');
select is(pg_temp.dto('CC-2') -> 'payment' ->> 'state', 'pending', 'efectivo a cobrar figura como pendiente');
select ok(pg_temp.dto('CC-9') is null, 'el pedido del comercio B no aparece');

-- El efectivo de un envío se cobra DESPUÉS de entregar (LT-0004, 2026-10-06): el repartidor vuelve con la plata y
-- recién ahí el local la registra. Fixture: CC-2 entregado sin pasar por los disparadores de transición.
set local session_replication_role = replica;
update public.orders set status = 'delivered', delivered_at = now(), updated_at = now() where public_code = 'CC-2';
set local session_replication_role = origin;
select pg_temp.put('orders', public.pos_list_orders('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1'), null, 50)::text);
select ok((pg_temp.dto('CC-2') -> 'allowed_actions') ? 'confirm_payment' and not (pg_temp.dto('CC-2') -> 'allowed_actions') ? 'cancel',
  'entregado con el efectivo pendiente: la caja puede registrar el cobro (y ya no cancelar)');
select ok(not (pg_temp.dto('CC-1') -> 'allowed_actions') ? 'confirm_payment', 'cancelado: nunca se ofrece cobrar');
set local session_replication_role = replica;
update public.orders set manual_payment_status = 'confirmed', manual_payment_method = 'cash', manual_payment_confirmed_at = now(),
  updated_at = now() where public_code = 'CC-2';
set local session_replication_role = origin;
select pg_temp.put('orders', public.pos_list_orders('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1'), null, 50)::text);
select ok(not (pg_temp.dto('CC-2') -> 'allowed_actions') ? 'confirm_payment', 'ya cobrado: no se ofrece cobrar otra vez');

-- ══ 7 · TIENDA Y REPARTO ═════════════════════════════════════════════════════
select pg_temp.put('overview', public.pos_get_store_overview('b8000000-0000-4000-8000-000000000001', pg_temp.ctx('h1'))::text);
select is(pg_temp.ctx('overview')::jsonb -> 'mercadopago', '{"state": "not_connected"}'::jsonb,
  'Mercado Pago llega como una palabra: no conectado, sin tokens ni ids');
select ok(pg_temp.ctx('overview')::jsonb -> 'riders' -> 'list' @> '[{"name": "Rider Norte"}]', 'los repartidores del comercio con su nombre');
select is(pg_temp.ctx('overview')::jsonb -> 'business' ->> 'status', 'open', 'el estado del comercio es el real');

select * from finish();
rollback;
