-- TABA · EL RASTRO DEL CATÁLOGO Y LA REVERSIÓN DE UN LOTE (20261001210000)
--
-- Lo que esta suite tiene que demostrar:
--
--   1. cada lote comercial deja un rastro: quién, con qué sesión, qué pidió, y la
--      imagen de antes y de después de cada producto (precio, estado del precio,
--      stock, disponible, intención del comercio, verificado);
--   2. el rastro lo lee owner/admin del comercio y nadie más; no lo escribe ni lo
--      corrige ningún rol, tampoco service_role, y un lote que falla no deja rastro;
--   3. el plan (altas + modificaciones) queda bajo UN lote, y publicar, ocultar y
--      volver a borrador también dejan el suyo;
--   4. la reversión devuelve precio y publicación sólo donde nadie cambió nada
--      desde el lote; lo cambiado se informa `skipped_changed` y no se pisa;
--   5. el stock nunca se restaura a ciegas: sólo si nada se movió desde el lote
--      (disponible, reservado y libro iguales, sin conteos posteriores), y nunca
--      contra un conflicto de stock abierto;
--   5b. si el conteo del lote había CERRADO un conflicto, revertirlo vuelve a retener
--      el producto: una recepción de mercadería posterior no lo reofrece con unidades
--      que ya estaban debidas a pedidos;
--   5c. una fila que DECIDIÓ la publicación (`publish` en la planilla) se deshace
--      aunque el stock no se pueda devolver: el producto que el lote puso a la venta
--      vuelve a quedar fuera de la venta y se informa `restored`, no `skipped_changed`;
--   5d. un conteo de Caja Clara posterior al lote manda aunque su recibo lleve la hora
--      de una transacción que empezó antes: se compara por cantidad de conteos, no
--      por relojes;
--   6. la reversión nunca verifica una ficha que no está verificada, no borra altas,
--      escribe su propio lote y es idempotente;
--   7. un producto sin precio confirmado mayor que cero queda sin poder venderse
--      después de revertir.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(138);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a5200000-0000-4000-8000-000000000001','authenticated','authenticated','ccr-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('a5200000-0000-4000-8000-000000000002','authenticated','authenticated','ccr-staff@example.invalid','',now(),'{}','{}',now(),now()),
  ('a5200000-0000-4000-8000-000000000003','authenticated','authenticated','ccr-otro@example.invalid','',now(),'{}','{}',now(),now()),
  ('a5200000-0000-4000-8000-000000000004','authenticated','authenticated','ccr-admin@example.invalid','',now(),'{}','{}',now(),now());

insert into public.businesses(id,name,status,slug,is_active,operating_timezone,currency_code,alcohol_sales_enabled)
values
  ('b5200000-0000-4000-8000-000000000001','RASTRO A','open','ccr-rastro-a',true,'America/Argentina/Buenos_Aires','ARS',false),
  ('b5200000-0000-4000-8000-000000000002','RASTRO B','open','ccr-rastro-b',true,'America/Argentina/Buenos_Aires','ARS',false);

insert into public.business_members(business_id,user_id,role,is_active) values
  ('b5200000-0000-4000-8000-000000000001','a5200000-0000-4000-8000-000000000001','owner',true),
  ('b5200000-0000-4000-8000-000000000001','a5200000-0000-4000-8000-000000000002','staff',true),
  ('b5200000-0000-4000-8000-000000000001','a5200000-0000-4000-8000-000000000004','admin',true),
  ('b5200000-0000-4000-8000-000000000002','a5200000-0000-4000-8000-000000000003','owner',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values
  ('c5200000-0000-4000-8000-000000000001','a5200000-0000-4000-8000-000000000001','b5200000-0000-4000-8000-000000000001','owner','panel_web'),
  ('c5200000-0000-4000-8000-000000000002','a5200000-0000-4000-8000-000000000002','b5200000-0000-4000-8000-000000000001','staff','panel_web'),
  ('c5200000-0000-4000-8000-000000000003','a5200000-0000-4000-8000-000000000003','b5200000-0000-4000-8000-000000000002','owner','panel_web'),
  ('c5200000-0000-4000-8000-000000000004','a5200000-0000-4000-8000-000000000004','b5200000-0000-4000-8000-000000000001','admin','panel_web');

insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
  variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
  stock,available,merchant_available,is_alcoholic,minimum_age,tags,is_verified,verified_at,verified_by,
  external_id,sku,catalog_origin,units_per_pack)
values
  -- COLA: publicada. El lote le tipea 390 en vez de 3900.
  ('d5200000-0000-4000-8000-000000000001','b5200000-0000-4000-8000-000000000001','Cola 1,5 L','Gaseosas','Cola',1500,'confirmed',true,'Marca',
   'Botella','Botella',1.5,'l','1.5 l','botella',10,true,true,false,null,'{}',true,now(),'a5200000-0000-4000-8000-000000000001','ccr-cola','ccr-cola','commercial',1),
  -- AGUA: publicada, 8 disponibles + 2 reservadas. El lote la cuenta.
  ('d5200000-0000-4000-8000-000000000002','b5200000-0000-4000-8000-000000000001','Agua 1,5 L','Aguas','Sin gas',900,'confirmed',true,'Marca',
   'Botella','Botella',1.5,'l','1.5 l','botella',8,true,true,false,null,'{}',true,now(),'a5200000-0000-4000-8000-000000000001','ccr-agua','ccr-agua','commercial',1),
  -- JUGO: verificado, oculto por el comercio. El lote lo publica.
  ('d5200000-0000-4000-8000-000000000003','b5200000-0000-4000-8000-000000000001','Jugo 1 L','Jugos','Naranja',1200,'confirmed',true,'Marca',
   'Caja','Caja',1,'l','1 l','caja',5,false,false,false,null,'{}',true,now(),'a5200000-0000-4000-8000-000000000001','ccr-jugo','ccr-jugo','commercial',1),
  -- SNACK: borrador sin precio y sin contar. El lote le carga precio y stock.
  ('d5200000-0000-4000-8000-000000000004','b5200000-0000-4000-8000-000000000001','Snack 100 g','Snacks','Papas',0,'pending',true,'Marca',
   'Bolsa','Bolsa',100,'g','100 g','bolsa',null,false,true,false,null,'{}',false,null,null,'ccr-snack','ccr-snack','commercial',1),
  -- MANÍ: publicado. Después del lote alguien le vuelve a cambiar el precio.
  ('d5200000-0000-4000-8000-000000000005','b5200000-0000-4000-8000-000000000001','Maní 200 g','Snacks','Maní',700,'confirmed',true,'Marca',
   'Bolsa','Bolsa',200,'g','200 g','bolsa',6,true,true,false,null,'{}',true,now(),'a5200000-0000-4000-8000-000000000001','ccr-mani','ccr-mani','commercial',1),
  -- GOMITAS: publicadas. Después del lote se vende una.
  ('d5200000-0000-4000-8000-000000000006','b5200000-0000-4000-8000-000000000001','Gomitas 80 g','Golosinas','Gomitas',500,'confirmed',true,'Marca',
   'Bolsa','Bolsa',80,'g','80 g','bolsa',3,true,true,false,null,'{}',true,now(),'a5200000-0000-4000-8000-000000000001','ccr-gomitas','ccr-gomitas','commercial',1),
  -- HIELO: borrador con la ficha completa. Un lote lo verifica y lo publica.
  ('d5200000-0000-4000-8000-000000000007','b5200000-0000-4000-8000-000000000001','Hielo 2 kg','Hielo','Rolito',800,'confirmed',true,'Marca',
   'Bolsa','Bolsa',2,'kg','2 kg','bolsa',5,false,false,false,null,'{}',false,null,null,'ccr-hielo','ccr-hielo','commercial',1),
  -- TÓNICA: publicada. Un lote le cambia el precio y la oculta (queda sin verificar).
  ('d5200000-0000-4000-8000-000000000008','b5200000-0000-4000-8000-000000000001','Tónica 500 ml','Mixers','Tónica',1100,'confirmed',true,'Marca',
   'Botella','Botella',500,'ml','500 ml','botella',7,true,true,false,null,'{}',true,now(),'a5200000-0000-4000-8000-000000000001','ccr-tonica','ccr-tonica','commercial',1),
  -- PAN: verificado y agotado, con la intención del comercio encendida. Una planilla lo
  -- repone (no republica) y otra, equivocada, lo publica.
  ('d5200000-0000-4000-8000-00000000000a','b5200000-0000-4000-8000-000000000001','Pan lactal 500 g','Almacén','Panificados',1300,'confirmed',true,'Marca',
   'Bolsa','Bolsa',500,'g','500 g','bolsa',0,false,true,false,null,'{}',true,now(),'a5200000-0000-4000-8000-000000000001','ccr-pan','ccr-pan','commercial',1),
  -- FLAN: publicado, queda 1. Se vende, y una planilla equivocada lo cuenta y lo publica.
  ('d5200000-0000-4000-8000-00000000000b','b5200000-0000-4000-8000-000000000001','Flan 120 g','Almacén','Postres',600,'confirmed',true,'Marca',
   'Pote','Pote',120,'g','120 g','pote',1,true,true,false,null,'{}',true,now(),'a5200000-0000-4000-8000-000000000001','ccr-flan','ccr-flan','commercial',1),
  -- Un producto del otro comercio.
  ('d5200000-0000-4000-8000-000000000009','b5200000-0000-4000-8000-000000000002','Producto B','Almacén','Varios',700,'confirmed',true,'Marca',
   'Unidad','Unidad',1,'unidad','1 unidad','unidad',10,true,true,false,null,'{}',true,now(),'a5200000-0000-4000-8000-000000000003','ccr-b','ccr-b','commercial',1);

insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,customer_name,
  customer_neighborhood,customer_street_address,customer_phone,payment_method,subtotal,delivery_fee,total)
values ('e5200000-0000-4000-8000-000000000001','b5200000-0000-4000-8000-000000000001','CCR-1','CCR-1','accepted','pickup','pickup',
  'ccr-request-1','Ana','Centro','Mendoza 1','+5429900000001','cash',1800,0,1800);
insert into public.order_items(order_id,product_id,name,quantity,unit,unit_price,subtotal,product_uuid)
values ('e5200000-0000-4000-8000-000000000001','ccr-agua','Agua 1,5 L',2,'u',900,1800,'d5200000-0000-4000-8000-000000000002');

create temporary table t_ctx(k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;
create function pg_temp.ctx(p_key text) returns text language sql as $$ select v from t_ctx where k = p_key $$;
create function pg_temp.put(p_key text, p_value text) returns text language sql as $$
  insert into t_ctx values (p_key, p_value) on conflict (k) do update set v = excluded.v returning v $$;
create function pg_temp.as_user(p_user uuid, p_session uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void;
$$;
create function pg_temp.owner() returns void language sql as $$
  select pg_temp.as_user('a5200000-0000-4000-8000-000000000001','c5200000-0000-4000-8000-000000000001') $$;
create function pg_temp.staff() returns void language sql as $$
  select pg_temp.as_user('a5200000-0000-4000-8000-000000000002','c5200000-0000-4000-8000-000000000002') $$;
create function pg_temp.otro() returns void language sql as $$
  select pg_temp.as_user('a5200000-0000-4000-8000-000000000003','c5200000-0000-4000-8000-000000000003') $$;
create function pg_temp.admin() returns void language sql as $$
  select pg_temp.as_user('a5200000-0000-4000-8000-000000000004','c5200000-0000-4000-8000-000000000004') $$;
create function pg_temp.st(p_id uuid) returns text language sql stable security definer as $$
  select format('price=%s/%s stock=%s available=%s merchant=%s verified=%s', price::text, price_status,
                coalesce(stock::text, 'null'), available::text, merchant_available::text, is_verified::text)
    from public.products where id = p_id $$;
create function pg_temp.batches(p_source text) returns integer language sql stable security definer as $$
  select count(*)::integer from public.catalog_change_batches
   where business_id = 'b5200000-0000-4000-8000-000000000001' and source = p_source $$;
create function pg_temp.last_batch(p_source text) returns uuid language sql stable security definer as $$
  select id from public.catalog_change_batches
   where business_id = 'b5200000-0000-4000-8000-000000000001' and source = p_source
   order by created_at desc limit 1 $$;
create function pg_temp.item(p_batch uuid, p_sku text) returns public.catalog_change_items language sql stable security definer as $$
  select i from public.catalog_change_items i where i.batch_id = p_batch and i.sku = p_sku $$;
create function pg_temp.has_move(p_id uuid, p_previous integer, p_delta integer, p_result integer) returns boolean
language sql stable security definer as $$
  select exists (select 1 from public.inventory_movements m
    where m.product_id = p_id and m.movement_type = 'stock_count' and m.previous_stock = p_previous
      and m.quantity_delta = p_delta and m.resulting_stock = p_result) $$;
create function pg_temp.conflict_open(p_id uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.pos_stock_conflicts c where c.product_id = p_id and c.status = 'open') $$;
create function pg_temp.conflict(p_id uuid) returns text language sql stable security definer as $$
  select coalesce((select format('%s %s shortfall=%s reserved=%s', c.status, c.kind, c.shortfall, c.reserved_at_detection)
    from public.pos_stock_conflicts c where c.product_id = p_id order by (c.status = 'open') desc, c.detected_at desc limit 1), 'none') $$;
create function pg_temp.open_conflict_id(p_id uuid) returns text language sql stable security definer as $$
  select c.id::text from public.pos_stock_conflicts c where c.product_id = p_id and c.status = 'open' $$;
create function pg_temp.outcome(p_result jsonb, p_sku text) returns jsonb language sql immutable as $$
  select i from jsonb_array_elements(p_result -> 'items') i where i ->> 'sku' = p_sku $$;
-- Corre una consulta con el rol y la sesión vigentes y devuelve su valor como texto,
-- o el SQLSTATE si falla.
create function pg_temp.q(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute 'select (' || p_sql || ')::text' into v;
  return v;
exception when others then
  return 'ERROR ' || sqlstate;
end $$;

set local role authenticated;
select pg_temp.owner();

-- ══ 1 · EL LOTE DEJA RASTRO (CAT-04) ═════════════════════════════════════════
select is(pg_temp.q($q$select count(*) from public.apply_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001',
  '[{"sku":"ccr-cola","price":"390"},
    {"sku":"ccr-agua","stock":20},
    {"sku":"ccr-jugo","publish":true},
    {"sku":"ccr-snack","price":"1000","stock":5},
    {"sku":"ccr-mani","price":"70"},
    {"sku":"ccr-gomitas","price":"50","stock":9}]')$q$), '6', 'el lote de seis filas se aplica');
select is(pg_temp.batches('commercial_batch'), 1, 'y deja exactamente un lote en el rastro');
select pg_temp.put('b1', pg_temp.last_batch('commercial_batch')::text) is not null as lote_1;

select is((select format('%s %s %s', b.actor_id, b.session_id, jsonb_array_length(b.request))
  from public.catalog_change_batches b where b.id = pg_temp.ctx('b1')::uuid),
  'a5200000-0000-4000-8000-000000000001 c5200000-0000-4000-8000-000000000001 6',
  'el dueño lo lee: operador, sesión y las seis filas pedidas');
select ok((select b.request_sha256 = encode(sha256(convert_to(b.request::text, 'UTF8')), 'hex')
  from public.catalog_change_batches b where b.id = pg_temp.ctx('b1')::uuid),
  'con la huella de lo que se pidió');
select is((select count(*)::integer from public.catalog_change_items i where i.batch_id = pg_temp.ctx('b1')::uuid), 6,
  'un ítem por producto');
select is((select (i.before - 'stock')::text || ' -> ' || (i.after - 'stock')::text
  from public.catalog_change_items i where i.batch_id = pg_temp.ctx('b1')::uuid and i.sku = 'ccr-cola'),
  '{"price": 1500.00, "available": true, "is_verified": true, "price_status": "confirmed", "merchant_available": true}'
  || ' -> ' ||
  '{"price": 390.00, "available": true, "is_verified": true, "price_status": "confirmed", "merchant_available": true}',
  'la imagen de antes y de después de la cola: precio 1500 → 390, sigue publicada');
select is((select array_agg(k order by k)::text from public.catalog_change_items i, jsonb_object_keys(i.after) k
  where i.batch_id = pg_temp.ctx('b1')::uuid and i.sku = 'ccr-cola'),
  '{available,is_verified,merchant_available,price,price_status,stock}',
  'la imagen guarda los seis campos comerciales y ninguno más');
select is((select format('%s %s %s %s', i.before ->> 'stock', i.after ->> 'stock', i.stock_count, i.reserved_at_count)
  from public.catalog_change_items i where i.batch_id = pg_temp.ctx('b1')::uuid and i.sku = 'ccr-agua'),
  '8 18 20 2', 'el conteo del agua queda con lo contado (20), lo reservado (2) y el disponible resultante (18)');
select ok((select i.inventory_movement_id is not null
  from public.catalog_change_items i where i.batch_id = pg_temp.ctx('b1')::uuid and i.sku = 'ccr-agua'),
  'y con su fila del libro');
select is((select format('%s|%s -> %s|%s', i.before ->> 'available', i.before ->> 'merchant_available',
                         i.after ->> 'available', i.after ->> 'merchant_available')
  from public.catalog_change_items i where i.batch_id = pg_temp.ctx('b1')::uuid and i.sku = 'ccr-jugo'),
  'false|false -> true|true', 'la publicación del jugo queda escrita: oculto → publicado');
select is((select format('%s/%s/%s -> %s/%s/%s', i.before ->> 'price', i.before ->> 'price_status', coalesce(i.before ->> 'stock', 'null'),
                         i.after ->> 'price', i.after ->> 'price_status', i.after ->> 'stock')
  from public.catalog_change_items i where i.batch_id = pg_temp.ctx('b1')::uuid and i.sku = 'ccr-snack'),
  '0.00/pending/null -> 1000.00/confirmed/5', 'y el borrador que recibió precio y stock');

-- ══ 2 · QUIÉN LEE Y QUIÉN ESCRIBE EL RASTRO ══════════════════════════════════
select pg_temp.admin();
select is((select count(*)::integer from public.catalog_change_items i where i.batch_id = pg_temp.ctx('b1')::uuid), 6,
  'un admin del comercio también lo lee');
select pg_temp.staff();
select is((select count(*)::integer from public.catalog_change_batches), 0, 'staff no lee lotes');
select is((select count(*)::integer from public.catalog_change_items), 0, 'ni ítems');
select pg_temp.otro();
select is((select count(*)::integer from public.catalog_change_batches), 0, 'el dueño de otro comercio no ve nada');
select is((select count(*)::integer from public.catalog_change_items), 0, 'tampoco los ítems');
select ok(
  not has_table_privilege('anon', 'public.catalog_change_batches', 'SELECT')
  and not has_table_privilege('anon', 'public.catalog_change_items', 'SELECT'),
  'anon no lee el rastro');
select ok(not exists (
  select 1 from unnest(array['catalog_change_batches','catalog_change_items']) t,
                unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p,
                unnest(array['anon','authenticated','service_role']) r
   where has_table_privilege(r, 'public.' || t, p)),
  'ningún rol escribe el rastro directo, tampoco service_role');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('catalog_change_batches','catalog_change_items') and c.relrowsecurity), 2,
  'las dos tablas tienen RLS');
select ok(
  not has_function_privilege('anon', 'public.rollback_commercial_catalog_batch(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.rollback_commercial_catalog_batch(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.rollback_commercial_catalog_batch(uuid,uuid)', 'EXECUTE'),
  'la reversión es de una sesión autenticada: ni anon ni service_role la ejecutan');
reset role;
select throws_ok($$update public.catalog_change_items set after = '{}'::jsonb$$, '55000', null,
  'ni el dueño de la base corrige un ítem: el rastro es inmutable');
select throws_ok($$delete from public.catalog_change_items$$, '55000', null, 'ni lo borra');
select throws_ok($$update public.catalog_change_batches set request = '[]'::jsonb$$, '55000', null,
  'ni reescribe lo que pidió un lote');
select throws_ok($$delete from public.catalog_change_batches$$, '55000', null, 'ni borra un lote');
set local role authenticated;

-- Un lote que falla no deja rastro.
select pg_temp.owner();
select throws_ok($$select * from public.apply_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001',
  '[{"sku":"ccr-cola","price":"400"},{"sku":"no-existe","price":"1"}]')$$, 'P0001', null,
  'un lote con una fila inválida se rechaza entero');
select is(pg_temp.batches('commercial_batch'), 1, 'y no deja un lote a medias en el rastro');

-- ══ 3 · EL PLAN Y LAS PUERTAS DE PUBLICACIÓN ═════════════════════════════════
select pg_temp.put('plan', public.apply_commercial_catalog_plan('b5200000-0000-4000-8000-000000000001',
  '[{"sku":"ccr-nuevo-250g","name":"Galletas 250 g","category":"Almacén","subcategory":"Galletas","is_alcoholic":false,"price":"650","stock":4}]'::jsonb,
  '[{"sku":"ccr-hielo","price":"850"}]'::jsonb)::text) is not null as plan_aplicado;
select is(pg_temp.ctx('plan')::jsonb ->> 'created' || ' ' || (pg_temp.ctx('plan')::jsonb ->> 'updated'), '1 1',
  'el plan conserva su contrato: una alta y una modificación');
select is(pg_temp.batches('commercial_plan'), 1, 'altas y modificaciones quedan bajo UN lote');
select is(pg_temp.batches('commercial_batch'), 1, 'la delegación en el lote no abre otro');
select is(pg_temp.ctx('plan')::jsonb ->> 'batch_id', pg_temp.last_batch('commercial_plan')::text,
  'el plan devuelve el id del lote con el que se revierte');
select is((select string_agg(i.sku || ':' || i.action, ' ' order by i.id)
  from public.catalog_change_items i where i.batch_id = (pg_temp.ctx('plan')::jsonb ->> 'batch_id')::uuid),
  'ccr-nuevo-250g:created ccr-hielo:updated', 'con el alta (sin imagen previa) y la modificación');
select is(pg_temp.ctx('plan')::jsonb -> 'update_rows' -> 0 ->> 'applied_sku', 'ccr-hielo',
  'y devuelve cómo quedó cada modificación, no sólo la cuenta');

select lives_ok($$select * from public.set_commercial_product_publication('b5200000-0000-4000-8000-000000000001','ccr-tonica',false)$$,
  'ocultar desde el Panel');
select lives_ok($$select * from public.set_commercial_product_publication('b5200000-0000-4000-8000-000000000001','ccr-tonica',true)$$,
  'y volver a publicar');
select is(pg_temp.batches('publication'), 2, 'publicar y ocultar dejan cada uno su rastro');
select is((select format('%s -> %s', i.before ->> 'available', i.after ->> 'available')
  from public.catalog_change_items i join public.catalog_change_batches b on b.id = i.batch_id
  where b.source = 'publication' and i.sku = 'ccr-tonica' order by i.id limit 1), 'true -> false',
  'con la imagen de antes y de después');
select throws_ok(format($$select public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', %L)$$,
  pg_temp.last_batch('publication')), '22023', null, 'una publicación suelta no es un lote que se revierta');

-- ══ 4 · LO QUE PASA DESPUÉS DEL LOTE ═════════════════════════════════════════
-- Alguien corrige el maní a mano; se vende una bolsa de gomitas.
select lives_ok($$select * from public.apply_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001',
  '[{"sku":"ccr-mani","price":"75"}]')$$, 'después del lote, el maní vuelve a cambiar de precio');
select pg_temp.staff();
select lives_ok($$select public.apply_inventory_movement('b5200000-0000-4000-8000-000000000001','d5200000-0000-4000-8000-000000000006',
  null,'sale',1,-1,null,null,null,'ccr-sale-0001')$$, 'y se vende una bolsa de gomitas');

-- ══ 5 · QUIÉN PUEDE REVERTIR ═════════════════════════════════════════════════
select throws_ok(format($$select public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', %L)$$, pg_temp.ctx('b1')),
  '42501', null, 'staff no revierte un lote');
select pg_temp.otro();
select throws_ok(format($$select public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', %L)$$, pg_temp.ctx('b1')),
  '42501', null, 'el dueño de otro comercio tampoco');
select throws_ok(format($$select public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000002', %L)$$, pg_temp.ctx('b1')),
  'P0002', null, 'ni pidiéndolo como si fuera de su comercio');
select pg_temp.owner();
select throws_ok($$select public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000000')$$,
  'P0002', null, 'un lote que no existe no se revierte');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000001'), 'price=390.00/confirmed stock=10 available=true merchant=true verified=true',
  'antes de revertir: la cola está a la venta con el precio mal tipeado');

-- ══ 6 · LA REVERSIÓN ═════════════════════════════════════════════════════════
select pg_temp.put('r1', public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', pg_temp.ctx('b1')::uuid)::text)
  is not null as revertido;
select is(format('%s %s %s %s', pg_temp.ctx('r1')::jsonb ->> 'restored', pg_temp.ctx('r1')::jsonb ->> 'skipped_changed',
                 pg_temp.ctx('r1')::jsonb ->> 'skipped_created', pg_temp.ctx('r1')::jsonb ->> 'replay'),
  '5 1 0 false', 'la reversión informa: cinco productos restaurados y uno salteado por haber cambiado');

select is(pg_temp.st('d5200000-0000-4000-8000-000000000001'), 'price=1500.00/confirmed stock=10 available=true merchant=true verified=true',
  'la cola vuelve a 1500 y sigue publicada y verificada');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000002'), 'price=900.00/confirmed stock=8 available=true merchant=true verified=true',
  'el agua vuelve a 8 disponibles: nada se había movido desde el conteo');
select ok(pg_temp.has_move('d5200000-0000-4000-8000-000000000002', 18, -10, 8),
  'y el stock vuelve por el libro, con su fila de conteo');
select is(pg_temp.outcome(pg_temp.ctx('r1')::jsonb, 'ccr-agua') ->> 'stock', 'restored', 'la reversión lo informa');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000003'), 'price=1200.00/confirmed stock=5 available=false merchant=false verified=true',
  'el jugo vuelve a estar oculto por el comercio');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000004'), 'price=0.00/pending stock=null available=false merchant=true verified=false',
  'el borrador vuelve a precio pendiente y sin contar: sigue sin poder venderse');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000005'), 'price=75.00/confirmed stock=6 available=true merchant=true verified=true',
  'el maní NO se pisa: alguien lo cambió después del lote');
select is(pg_temp.outcome(pg_temp.ctx('r1')::jsonb, 'ccr-mani') ->> 'outcome' || ' ' || (pg_temp.outcome(pg_temp.ctx('r1')::jsonb, 'ccr-mani') -> 'changed_fields')::text,
  'skipped_changed ["price"]', 'y se informa como skipped_changed, con el campo que cambió');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000006'), 'price=500.00/confirmed stock=8 available=true merchant=true verified=true',
  'las gomitas recuperan el precio, y el stock NO se restaura: se vendió una desde el lote');
select is(pg_temp.outcome(pg_temp.ctx('r1')::jsonb, 'ccr-gomitas') ->> 'stock', 'kept_moved_since', 'informado como stock que se movió');

-- El rastro de la reversión.
select is(pg_temp.batches('rollback'), 1, 'la reversión escribe su propio lote');
select is((select format('%s %s', b.reverts_batch_id, b.actor_id) from public.catalog_change_batches b
  where b.id = (pg_temp.ctx('r1')::jsonb ->> 'batch_id')::uuid),
  pg_temp.ctx('b1') || ' a5200000-0000-4000-8000-000000000001', 'que dice qué lote revierte y quién lo pidió');
select is((select string_agg(i.sku || ':' || i.action, ' ' order by i.sku) from public.catalog_change_items i
  where i.batch_id = (pg_temp.ctx('r1')::jsonb ->> 'batch_id')::uuid),
  'ccr-agua:restored ccr-cola:restored ccr-gomitas:restored ccr-jugo:restored ccr-mani:skipped_changed ccr-snack:restored',
  'con un ítem por producto y lo que pasó con cada uno');
select is((select format('%s -> %s', i.before ->> 'price', i.after ->> 'price') from public.catalog_change_items i
  where i.batch_id = (pg_temp.ctx('r1')::jsonb ->> 'batch_id')::uuid and i.sku = 'ccr-cola'), '390.00 -> 1500.00',
  'y su propia imagen de antes y de después');
select is((select format('%s %s', b.rollback_batch_id, b.rolled_back_by) from public.catalog_change_batches b
  where b.id = pg_temp.ctx('b1')::uuid),
  (pg_temp.ctx('r1')::jsonb ->> 'batch_id') || ' a5200000-0000-4000-8000-000000000001',
  'el lote original queda marcado como revertido');

-- Idempotente.
select pg_temp.put('r1b', public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', pg_temp.ctx('b1')::uuid)::text)
  is not null as revertido_otra_vez;
select is(format('%s %s', pg_temp.ctx('r1b')::jsonb ->> 'replay', pg_temp.ctx('r1b')::jsonb ->> 'batch_id'),
  'true ' || (pg_temp.ctx('r1')::jsonb ->> 'batch_id'), 'revertir de nuevo devuelve el mismo resultado, marcado como repetición');
select is(pg_temp.batches('rollback'), 1, 'sin escribir otro lote');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000001'), 'price=1500.00/confirmed stock=10 available=true merchant=true verified=true',
  'ni tocar un producto');
select throws_ok(format($$select public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', %L)$$,
  pg_temp.ctx('r1')::jsonb ->> 'batch_id'), '22023', null, 'una reversión no se revierte');

-- ══ 7 · LA REVERSIÓN NO VERIFICA NI PUBLICA DE MÁS ═══════════════════════════
-- Un lote que verificó y publicó un borrador: revertirlo lo devuelve a borrador.
select is(pg_temp.q($q$select format('%s %s', applied_available, applied_is_verified)
  from public.apply_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-hielo","publish":true}]')$q$),
  't t', 'un lote verifica y publica el hielo');
select pg_temp.put('b2', pg_temp.last_batch('commercial_batch')::text) is not null as lote_2;
select is(public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', pg_temp.ctx('b2')::uuid) ->> 'restored', '1',
  'revertirlo');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000007'), 'price=850.00/confirmed stock=5 available=false merchant=false verified=false',
  'lo devuelve a borrador: oculto, sin verificar y con la intención apagada');

-- Un lote que cambió el precio y ocultó (la ficha queda sin verificar): revertirlo
-- devuelve el precio y la intención, pero NO verifica ni publica por su cuenta.
select lives_ok($$select * from public.apply_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001',
  '[{"sku":"ccr-tonica","price":"110","publish":false}]')$$, 'un lote cambia el precio de la tónica y la oculta');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000008'), 'price=110.00/confirmed stock=7 available=false merchant=false verified=false',
  'queda oculta y sin verificar (así lo deja el disparador de dato maestro)');
select pg_temp.put('b3', pg_temp.last_batch('commercial_batch')::text) is not null as lote_3;
select pg_temp.put('r3', public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', pg_temp.ctx('b3')::uuid)::text)
  is not null as revertido_3;
select is(pg_temp.st('d5200000-0000-4000-8000-000000000008'), 'price=1100.00/confirmed stock=7 available=false merchant=true verified=false',
  'la reversión devuelve precio e intención y deja la ficha SIN verificar: verificar es un acto explícito');
select is(pg_temp.outcome(pg_temp.ctx('r3')::jsonb, 'ccr-tonica') ->> 'publication', 'left_unverified', 'y lo dice');
select is(pg_temp.q($q$select format('%s %s', applied_available, applied_is_verified)
  from public.apply_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-tonica","publish":true}]')$q$),
  't t', 'el dueño la vuelve a publicar con la puerta de siempre');

-- Un plan con altas: la reversión no borra el producto creado.
select pg_temp.put('rp', public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001',
  (pg_temp.ctx('plan')::jsonb ->> 'batch_id')::uuid)::text) is not null as plan_revertido;
select is(format('%s %s', pg_temp.ctx('rp')::jsonb ->> 'skipped_created', pg_temp.ctx('rp')::jsonb ->> 'restored'), '1 1',
  'el alta no se borra; la modificación del plan sí se revierte');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000007'), 'price=800.00/confirmed stock=5 available=false merchant=false verified=false',
  'el hielo vuelve al precio anterior al plan y sigue siendo un borrador');
select is((select format('%s %s %s', available, is_verified, is_active) from public.products
  where business_id = 'b5200000-0000-4000-8000-000000000001' and sku = 'ccr-nuevo-250g'), 'f f t',
  'el producto dado de alta sigue existiendo, oculto y sin verificar');

-- ══ 8 · EL STOCK NUNCA SE RESTAURA CONTRA UN CONFLICTO ═══════════════════════
select is(pg_temp.q($q$select applied_stock || ' ' || applied_available from public.apply_commercial_catalog_batch(
  'b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-agua","stock":1}]')$q$), '0 false',
  'un conteo por debajo de lo reservado deja el agua en 0 y retenida');
select ok(pg_temp.conflict_open('d5200000-0000-4000-8000-000000000002'), 'con su conflicto abierto');
select pg_temp.put('b4', pg_temp.last_batch('commercial_batch')::text) is not null as lote_4;
select pg_temp.put('r4', public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', pg_temp.ctx('b4')::uuid)::text)
  is not null as revertido_4;
select is(pg_temp.outcome(pg_temp.ctx('r4')::jsonb, 'ccr-agua') ->> 'outcome' || ' ' || (pg_temp.outcome(pg_temp.ctx('r4')::jsonb, 'ccr-agua') ->> 'stock'),
  'skipped_changed kept_open_conflict', 'revertir ese conteo no devuelve el stock: hay un conflicto abierto');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000002'), 'price=900.00/confirmed stock=0 available=false merchant=true verified=true',
  'el agua sigue en 0 y fuera de la venta');
select ok(pg_temp.conflict_open('d5200000-0000-4000-8000-000000000002'), 'y el conflicto sigue abierto: lo cierra un conteo, no una reversión');

-- ══ 8b · REVERTIR UN CONTEO QUE HABÍA CERRADO UN CONFLICTO VUELVE A RETENER ══
-- El agua está en 0, retenida, con 2 debidas a un pedido y 1 en la góndola. Llega una
-- planilla equivocada que dice 6: cierra el conflicto y la reofrece con 4.
select is(pg_temp.q($q$select applied_stock || ' ' || applied_available from public.apply_commercial_catalog_batch(
  'b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-agua","stock":6}]')$q$), '4 true',
  'una planilla equivocada cuenta 6: deja 4 disponibles y devuelve el agua a la venta');
select is(pg_temp.conflict('d5200000-0000-4000-8000-000000000002'), 'resolved count_below_reserved shortfall=1 reserved=2',
  'y cierra el conflicto que la retenía');
select pg_temp.put('b6', pg_temp.last_batch('commercial_batch')::text) is not null as lote_6;
select pg_temp.put('r6', public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', pg_temp.ctx('b6')::uuid)::text)
  is not null as revertido_r6;
select is(format('%s %s %s', pg_temp.outcome(pg_temp.ctx('r6')::jsonb, 'ccr-agua') ->> 'outcome',
  pg_temp.outcome(pg_temp.ctx('r6')::jsonb, 'ccr-agua') ->> 'stock', coalesce(pg_temp.outcome(pg_temp.ctx('r6')::jsonb, 'ccr-agua') ->> 'hold', '-')), 'restored restored reopened',
  'revertir esa planilla devuelve el stock anterior Y vuelve a abrir la retención');
select is(pg_temp.ctx('r6')::jsonb ->> 'holds_reopened', '1', 'la reversión cuenta la retención reabierta');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000002'), 'price=900.00/confirmed stock=0 available=false merchant=true verified=true',
  'el agua vuelve a 0 y queda fuera de la venta');
select is(pg_temp.conflict('d5200000-0000-4000-8000-000000000002'), 'open count_below_reserved shortfall=1 reserved=2',
  'con el conflicto abierto de nuevo: mismo tipo, mismo faltante');
select is(pg_temp.outcome(pg_temp.ctx('r6')::jsonb, 'ccr-agua') ->> 'conflict_id', pg_temp.open_conflict_id('d5200000-0000-4000-8000-000000000002'),
  'la reversión informa qué conflicto abrió');
select is((select format('%s %s', i.detail ->> 'hold', i.detail ->> 'conflict_id') from public.catalog_change_items i
  where i.batch_id = (pg_temp.ctx('r6')::jsonb ->> 'batch_id')::uuid and i.sku = 'ccr-agua'),
  'reopened ' || pg_temp.open_conflict_id('d5200000-0000-4000-8000-000000000002'), 'y queda escrito en su rastro');
select pg_temp.staff();
select lives_ok($$select public.apply_inventory_movement('b5200000-0000-4000-8000-000000000001','d5200000-0000-4000-8000-000000000002',
  null,'purchase_receipt',3,1,null,null,null,'ccr-receipt-0001')$$, 'staff recibe 3 aguas');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000002'), 'price=900.00/confirmed stock=3 available=false merchant=true verified=true',
  'la recepción NO la reofrece: hay 4 en la góndola y 2 ya están debidas');
select ok(pg_temp.conflict_open('d5200000-0000-4000-8000-000000000002'), 'sigue retenida hasta un conteo real');
select pg_temp.owner();
select is(pg_temp.q($q$select applied_stock || ' ' || applied_available from public.apply_commercial_catalog_batch(
  'b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-agua","stock":4}]')$q$), '2 true',
  'el conteo real (4 en la góndola, 2 debidas) deja 2 disponibles y la devuelve a la venta');
select ok(not pg_temp.conflict_open('d5200000-0000-4000-8000-000000000002'), 'y ese conteo sí cierra el conflicto');

-- Lo mismo cuando el stock ya se movió: no se restaura, pero la retención vuelve.
select is(pg_temp.q($q$select applied_stock || ' ' || applied_available from public.apply_commercial_catalog_batch(
  'b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-agua","stock":1}]')$q$), '0 false', 'otro conteo por debajo de lo reservado vuelve a retener el agua');
select is(pg_temp.q($q$select applied_stock || ' ' || applied_available from public.apply_commercial_catalog_batch(
  'b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-agua","stock":7}]')$q$), '5 true', 'otra planilla equivocada la reofrece con 5');
select pg_temp.put('b9', pg_temp.last_batch('commercial_batch')::text) is not null as lote_9;
select pg_temp.staff();
select lives_ok($$select public.apply_inventory_movement('b5200000-0000-4000-8000-000000000001','d5200000-0000-4000-8000-000000000002',
  null,'sale',1,-1,null,null,null,'ccr-sale-0002')$$, 'y se vende una por mostrador');
select pg_temp.owner();
select pg_temp.put('r9', public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', pg_temp.ctx('b9')::uuid)::text)
  is not null as revertido_r9;
select is(format('%s %s %s', pg_temp.outcome(pg_temp.ctx('r9')::jsonb, 'ccr-agua') ->> 'outcome',
  pg_temp.outcome(pg_temp.ctx('r9')::jsonb, 'ccr-agua') ->> 'stock', coalesce(pg_temp.outcome(pg_temp.ctx('r9')::jsonb, 'ccr-agua') ->> 'hold', '-')), 'skipped_changed kept_moved_since reopened',
  'revertirla no toca el stock (se movió) y vuelve a retener igual: el conteo que levantó la retención era el malo');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000002'), 'price=900.00/confirmed stock=4 available=false merchant=true verified=true',
  'el agua conserva su stock y sale de la venta');
select ok(pg_temp.conflict_open('d5200000-0000-4000-8000-000000000002'), 'con el conflicto abierto');

-- Si alguien volvió a contar después del lote, ese conteo manda: ni stock ni retención.
select is(pg_temp.q($q$select applied_stock || ' ' || applied_available from public.apply_commercial_catalog_batch(
  'b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-agua","stock":1}]')$q$), '0 false', 'un conteo por debajo de lo reservado');
select is(pg_temp.q($q$select applied_stock || ' ' || applied_available from public.apply_commercial_catalog_batch(
  'b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-agua","stock":9}]')$q$), '7 true', 'una planilla cuenta 9 y cierra el conflicto');
select pg_temp.put('b12', pg_temp.last_batch('commercial_batch')::text) is not null as lote_12;
select is(pg_temp.q($q$select applied_stock || ' ' || applied_available from public.apply_commercial_catalog_batch(
  'b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-agua","stock":9}]')$q$), '7 true', 'y un conteo posterior confirma el mismo número (sin fila de libro: no hubo diferencia)');
select pg_temp.put('r12', public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', pg_temp.ctx('b12')::uuid)::text)
  is not null as revertido_r12;
select is(format('%s %s %s', pg_temp.outcome(pg_temp.ctx('r12')::jsonb, 'ccr-agua') ->> 'outcome',
  pg_temp.outcome(pg_temp.ctx('r12')::jsonb, 'ccr-agua') ->> 'stock', coalesce(pg_temp.outcome(pg_temp.ctx('r12')::jsonb, 'ccr-agua') ->> 'hold', '-')), 'skipped_changed kept_recounted_since kept_recounted_since',
  'revertir la primera no devuelve el stock ni reabre la retención: hubo un conteo posterior');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000002'), 'price=900.00/confirmed stock=7 available=true merchant=true verified=true',
  'el agua queda como la dejó el último conteo');
select ok(not pg_temp.conflict_open('d5200000-0000-4000-8000-000000000002'), 'y sin conflicto');

-- Movimientos que se compensan: el disponible y lo reservado quedan iguales, pero el
-- libro tiene filas nuevas. Tampoco se restaura.
select is(pg_temp.q($q$select applied_stock || ' ' || applied_available from public.apply_commercial_catalog_batch(
  'b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-mani","stock":8}]')$q$), '8 true', 'un lote cuenta 8 bolsas de maní');
select pg_temp.put('b20', pg_temp.last_batch('commercial_batch')::text) is not null as lote_20;
select pg_temp.staff();
select lives_ok($$select public.apply_inventory_movement('b5200000-0000-4000-8000-000000000001','d5200000-0000-4000-8000-000000000005',
  null,'purchase_receipt',2,1,null,null,null,'ccr-receipt-0002')$$, 'después entran 2');
select lives_ok($$select public.apply_inventory_movement('b5200000-0000-4000-8000-000000000001','d5200000-0000-4000-8000-000000000005',
  null,'damage',2,-1,null,null,'se rompieron dos','ccr-damage-0001')$$, 'y se rompen 2: el disponible vuelve a 8');
select pg_temp.owner();
select pg_temp.put('r20', public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', pg_temp.ctx('b20')::uuid)::text)
  is not null as revertido_r20;
select is(format('%s %s %s', pg_temp.outcome(pg_temp.ctx('r20')::jsonb, 'ccr-mani') ->> 'outcome',
  pg_temp.outcome(pg_temp.ctx('r20')::jsonb, 'ccr-mani') ->> 'stock', coalesce(pg_temp.outcome(pg_temp.ctx('r20')::jsonb, 'ccr-mani') ->> 'hold', '-')), 'skipped_changed kept_moved_since -',
  'revertir el conteo no restaura el stock: el libro se movió aunque el número sea el mismo');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000005'), 'price=75.00/confirmed stock=8 available=true merchant=true verified=true',
  'el maní queda como está');

-- ══ 8c · LA PUBLICACIÓN QUE DECIDIÓ EL LOTE SE DESHACE ═══════════════════════
-- A. Una fila que sólo publica, sobre un producto verificado cuya intención ya estaba
-- encendida (agotado y repuesto por planilla): lo único que cambia es `available`.
select is(pg_temp.q($q$select applied_stock || ' ' || applied_available from public.apply_commercial_catalog_batch(
  'b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-pan","stock":10}]')$q$), '10 false',
  'reponer el pan por la planilla no lo republica');
select is(pg_temp.q($q$select applied_available from public.apply_commercial_catalog_batch(
  'b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-pan","publish":true}]')$q$), 'true',
  'una planilla equivocada lo publica');
select pg_temp.put('b30', pg_temp.last_batch('commercial_batch')::text) is not null as lote_30;
select is((select format('%s -> %s | resto igual: %s | publish: %s', i.before ->> 'available', i.after ->> 'available',
                         (i.before - 'available') = (i.after - 'available'), i.detail ->> 'publish')
  from public.catalog_change_items i where i.batch_id = pg_temp.ctx('b30')::uuid and i.sku = 'ccr-pan'),
  'false -> true | resto igual: t | publish: true',
  'el rastro guarda que esa fila decidió publicar y que lo único que cambió fue el disponible');
select pg_temp.put('r30', public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', pg_temp.ctx('b30')::uuid)::text)
  is not null as revertido_r30;
select is(format('%s %s %s', pg_temp.outcome(pg_temp.ctx('r30')::jsonb, 'ccr-pan') ->> 'outcome',
  pg_temp.outcome(pg_temp.ctx('r30')::jsonb, 'ccr-pan') ->> 'stock', coalesce((pg_temp.outcome(pg_temp.ctx('r30')::jsonb, 'ccr-pan') -> 'changed_fields')::text, '-')),
  'restored not_changed_by_batch -', 'revertirla se informa como restaurada, no como salteada por «stock»');
select is(pg_temp.st('d5200000-0000-4000-8000-00000000000a'), 'price=1300.00/confirmed stock=10 available=false merchant=true verified=true',
  'y el pan vuelve a quedar FUERA de la venta, como estaba antes del lote');
select is(format('%s %s', pg_temp.ctx('r30')::jsonb ->> 'restored', pg_temp.ctx('r30')::jsonb ->> 'skipped_changed'), '1 0',
  'la cuenta de la reversión lo dice');

-- B. Conteo + publicar en la misma fila, y después se vende una unidad: el stock no se
-- devuelve (se movió), pero la publicación que decidió el lote sí.
select pg_temp.staff();
select lives_ok($$select public.apply_inventory_movement('b5200000-0000-4000-8000-000000000001','d5200000-0000-4000-8000-00000000000b',
  null,'sale',1,-1,null,null,null,'ccr-sale-0003')$$, 'se vende el último flan');
select is(pg_temp.st('d5200000-0000-4000-8000-00000000000b'), 'price=600.00/confirmed stock=0 available=false merchant=true verified=true',
  'queda agotado y fuera de la venta');
select pg_temp.owner();
select is(pg_temp.q($q$select applied_stock || ' ' || applied_available from public.apply_commercial_catalog_batch(
  'b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-flan","stock":10,"publish":true}]')$q$), '10 true',
  'una planilla equivocada cuenta 10 y lo publica');
select pg_temp.put('b31', pg_temp.last_batch('commercial_batch')::text) is not null as lote_31;
select pg_temp.staff();
select lives_ok($$select public.apply_inventory_movement('b5200000-0000-4000-8000-000000000001','d5200000-0000-4000-8000-00000000000b',
  null,'sale',1,-1,null,null,null,'ccr-sale-0004')$$, 'y se vende uno');
select pg_temp.owner();
select pg_temp.put('r31', public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', pg_temp.ctx('b31')::uuid)::text)
  is not null as revertido_r31;
select is(format('%s %s', pg_temp.outcome(pg_temp.ctx('r31')::jsonb, 'ccr-flan') ->> 'outcome',
  pg_temp.outcome(pg_temp.ctx('r31')::jsonb, 'ccr-flan') ->> 'stock'), 'restored kept_moved_since',
  'revertirla deshace la publicación y deja el stock como está: se movió desde el lote');
select is(pg_temp.st('d5200000-0000-4000-8000-00000000000b'), 'price=600.00/confirmed stock=9 available=false merchant=true verified=true',
  'el flan conserva sus 9 y sale de la venta');

-- El borde: una fila que pidió OCULTAR algo que ya estaba oculto no decidió nada sobre
-- la publicación. Si su conteo ya se movió, no hay nada que devolver.
select is(pg_temp.q($q$select applied_stock || ' ' || applied_available from public.apply_commercial_catalog_batch(
  'b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-jugo","stock":9,"publish":false}]')$q$), '9 false',
  'una fila cuenta el jugo (ya oculto) y pide dejarlo oculto');
select pg_temp.put('b32', pg_temp.last_batch('commercial_batch')::text) is not null as lote_32;
select pg_temp.staff();
select lives_ok($$select public.apply_inventory_movement('b5200000-0000-4000-8000-000000000001','d5200000-0000-4000-8000-000000000003',
  null,'purchase_receipt',1,1,null,null,null,'ccr-receipt-0003')$$, 'después entra una caja');
select pg_temp.owner();
select pg_temp.put('r32', public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', pg_temp.ctx('b32')::uuid)::text)
  is not null as revertido_r32;
select is(format('%s %s %s', pg_temp.outcome(pg_temp.ctx('r32')::jsonb, 'ccr-jugo') ->> 'outcome',
  pg_temp.outcome(pg_temp.ctx('r32')::jsonb, 'ccr-jugo') ->> 'stock', (pg_temp.outcome(pg_temp.ctx('r32')::jsonb, 'ccr-jugo') -> 'changed_fields')::text),
  'skipped_changed kept_moved_since ["stock"]', 'revertirla no tiene nada que devolver y lo dice');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000003'), 'price=1200.00/confirmed stock=10 available=false merchant=false verified=true',
  'el jugo queda como está');

-- La reversión no apaga una intención que el lote no tocó, pero avisa: el pan y el flan
-- quedaron fuera de la venta con la intención encendida, y el sistema puede volver a
-- ofrecerlos (al liberar una reserva, cancelar un pedido o recibir mercadería).
select is(format('%s %s', pg_temp.outcome(pg_temp.ctx('r30')::jsonb, 'ccr-pan') ->> 'publication', pg_temp.ctx('r30')::jsonb ->> 'off_sale_intent_on'),
  'off_sale_intent_on 1', 'la reversión avisa que el pan salió de la venta pero el comercio lo sigue queriendo vender');
select is(format('%s %s %s', pg_temp.outcome(pg_temp.ctx('r31')::jsonb, 'ccr-flan') ->> 'publication',
  coalesce(pg_temp.outcome(pg_temp.ctx('r32')::jsonb, 'ccr-jugo') ->> 'publication', '-'), pg_temp.ctx('r1')::jsonb ->> 'off_sale_intent_on'),
  'off_sale_intent_on - 0', 'lo mismo con el flan; no lo dice de lo que el comercio tenía oculto ni cuando nada salió de la venta');

-- ══ 8d · UN CONTEO DE CAJA CLARA POSTERIOR MANDA, DIGA LO QUE DIGA SU RELOJ ═══
-- El recibo de Caja Clara lleva la hora en que EMPEZÓ su transacción. Si esa
-- transacción estaba abierta cuando el lote confirmó, el recibo queda con una hora
-- anterior a la del lote aunque el conteo sea posterior. Se simula con un recibo
-- fechado en el pasado.
select is(pg_temp.q($q$select applied_stock || ' ' || applied_available from public.apply_commercial_catalog_batch(
  'b5200000-0000-4000-8000-000000000001', '[{"sku":"ccr-gomitas","stock":12}]')$q$), '12 true', 'un lote cuenta 12 bolsas de gomitas');
select pg_temp.put('b40', pg_temp.last_batch('commercial_batch')::text) is not null as lote_40;
select is(pg_temp.q($q$select i.count_receipts from public.catalog_change_items i
  where i.batch_id = pg_temp.ctx('b40')::uuid and i.sku = 'ccr-gomitas'$q$), '0',
  'el rastro guarda cuántos conteos de Caja Clara tenía el producto al contar');
reset role;
insert into public.pos_stock_receipts(business_id, idempotency_key, request_hash, product_id, kind, requested_delta, applied_delta,
  shortfall, stock_after, reserved_after, actor_user_id, session_id, device_key_hash, received_at)
values ('b5200000-0000-4000-8000-000000000001', 'ccr-pos-count-0001', md5('ccr-pos-count-0001'), 'd5200000-0000-4000-8000-000000000006',
  'count', 0, 0, 0, 12, 0, 'a5200000-0000-4000-8000-000000000001', 'c5200000-0000-4000-8000-000000000001', repeat('ab', 32),
  '2000-01-01T00:00:00Z');
set local role authenticated;
select pg_temp.put('r40', public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', pg_temp.ctx('b40')::uuid)::text)
  is not null as revertido_r40;
select is(format('%s %s', pg_temp.outcome(pg_temp.ctx('r40')::jsonb, 'ccr-gomitas') ->> 'outcome',
  pg_temp.outcome(pg_temp.ctx('r40')::jsonb, 'ccr-gomitas') ->> 'stock'), 'skipped_changed kept_recounted_since',
  'revertir ese lote no pisa el conteo de Caja Clara, aunque su recibo tenga una hora anterior');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000006'), 'price=500.00/confirmed stock=12 available=true merchant=true verified=true',
  'las gomitas quedan con lo que confirmó Caja Clara');

-- ══ 9 · SIN PRECIO CONFIRMADO NO SE VENDE, TAMPOCO DESPUÉS DE REVERTIR ═══════
select is((select count(*)::integer from public.products
  where business_id = 'b5200000-0000-4000-8000-000000000001'
    and available and (price_status <> 'confirmed' or price <= 0)), 0,
  'ningún producto quedó disponible sin precio confirmado mayor que cero');
select lives_ok($$select * from public.apply_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001',
  '[{"sku":"ccr-cola","price_pending":true}]')$$, 'un lote devuelve el precio de la cola a pendiente');
select pg_temp.put('b5', pg_temp.last_batch('commercial_batch')::text) is not null as lote_5;
select is(pg_temp.st('d5200000-0000-4000-8000-000000000001'), 'price=1500.00/pending stock=10 available=false merchant=true verified=true',
  'queda fuera de la venta');
select is(public.rollback_commercial_catalog_batch('b5200000-0000-4000-8000-000000000001', pg_temp.ctx('b5')::uuid) ->> 'restored', '1',
  'revertirlo');
select is(pg_temp.st('d5200000-0000-4000-8000-000000000001'), 'price=1500.00/confirmed stock=10 available=true merchant=true verified=true',
  'devuelve el precio confirmado y la cola a la venta');
select is((select count(*)::integer from public.products
  where business_id = 'b5200000-0000-4000-8000-000000000001'
    and available and (price_status <> 'confirmed' or price <= 0 or not is_verified or not merchant_available or coalesce(stock, 0) <= 0)), 0,
  'y nada quedó disponible sin precio, sin verificar, sin intención o sin stock');

select * from finish();
rollback;
