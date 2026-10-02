-- TABA · EL CATÁLOGO TIENE UNA SOLA AUTORIDAD DE STOCK (20261001210000)
--
-- Lo que esta suite tiene que demostrar:
--
--   1. el stock que carga el Panel o la planilla es un CONTEO FÍSICO: se traduce a
--      disponible = conteo − reservado, deja fila en el libro y nunca vuelve a poner
--      en venta unidades reservadas (pedidos sin despachar y checkouts vivos);
--   2. un conteo que no cubre lo reservado deja el disponible en 0 y abre el mismo
--      conflicto que Caja Clara; uno que sí lo cubre lo cierra y devuelve el producto;
--   3. `expected_stock` (opcional) frena una pantalla vieja con PT409 sin escribir;
--   4. «precio nuevo + publicar» sobre un verificado agotado termina PUBLICADO, y
--      repetir la fila no cambia nada; un cambio de precio sobre un producto que
--      estaba a la venta (o retenido por un conflicto) nunca lo deja sin verificar
--      sin aviso, aunque el conteo de la misma fila lo deje sin disponible;
--   5. registrar la rotura de la última unidad funciona y saca el producto de la
--      venta; reponer lo reofrece sólo si el comercio lo quería y la licencia lo deja;
--   6. nadie escribe `stock`, `available` ni `is_active` directo sobre `products`;
--   7. completar la ficha nunca publica, y un producto oculto por el comercio no
--      choca más contra la restricción de disponibilidad;
--   8. un alta de planilla puede completarse y publicarse por un camino del dueño, y
--      el intento prematuro dice qué dato falta.
--
-- Los estados se leen con funciones SECURITY DEFINER de pg_temp: las tablas de
-- conflicto y el reservado no son legibles para `authenticated`.
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(113);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a5100000-0000-4000-8000-000000000001','authenticated','authenticated','csa-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('a5100000-0000-4000-8000-000000000002','authenticated','authenticated','csa-staff@example.invalid','',now(),'{}','{}',now(),now());

insert into public.businesses(id,name,status,slug,is_active,operating_timezone,currency_code,alcohol_sales_enabled)
values ('b5100000-0000-4000-8000-000000000001','STOCK AUTORIDAD','open','csa-stock-autoridad',true,'America/Argentina/Buenos_Aires','ARS',false);

insert into public.business_members(business_id,user_id,role,is_active) values
  ('b5100000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001','owner',true),
  ('b5100000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000002','staff',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values
  ('c5100000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001','b5100000-0000-4000-8000-000000000001','owner','panel_web'),
  ('c5100000-0000-4000-8000-000000000002','a5100000-0000-4000-8000-000000000002','b5100000-0000-4000-8000-000000000001','staff','panel_web');

-- Un asset con derechos en regla, para el producto que se verifica por la puerta
-- técnica (publish_catalog_product exige imagen ligada).
insert into public.catalog_assets(
  business_id, external_id, sku, safe_sku, catalog_origin,
  rights_status, rights_reference, approved_at, approved_by,
  source_url, source_sha256, identity_sha256,
  master_path, master_sha256, master_binding_sha256,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256)
select
  'b5100000-0000-4000-8000-000000000001', x.sku, x.sku, x.sku, 'commercial',
  'PROPIO','foto propia del comercio',now(),'a5100000-0000-4000-8000-000000000001',
  'https://ejemplo.invalid/' || x.sku || '.jpg', s.src, i.ident,
  public.catalog_asset_path(x.sku, i.ident, 'master', s.mas), s.mas,
  public.catalog_asset_binding_sha256(i.ident,'master',s.src,s.mas,1000,1000,public.catalog_asset_path(x.sku,i.ident,'master',s.mas)),
  public.catalog_asset_path(x.sku, i.ident, 'thumbnail', s.thu), s.thu,
  public.catalog_asset_binding_sha256(i.ident,'thumbnail',s.src,s.thu,400,400,public.catalog_asset_path(x.sku,i.ident,'thumbnail',s.thu))
from (values ('csa-vino'), ('csa-tonica')) x(sku),
     (select repeat('ab',32) as src, repeat('cd',32) as mas, repeat('ef',32) as thu) s,
     lateral (select public.catalog_image_identity_sha256(x.sku, x.sku, s.src) as ident) i;

insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
  variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
  stock,available,merchant_available,is_alcoholic,minimum_age,tags,is_verified,verified_at,verified_by,
  external_id,sku,catalog_origin,units_per_pack)
values
  -- AGUA: publicada, 3 disponibles + 2 reservadas por un pedido aceptado (físico 5).
  ('d5100000-0000-4000-8000-000000000001','b5100000-0000-4000-8000-000000000001','Agua 1,5 L','Aguas','Sin gas',1500,'confirmed',true,'Marca',
   'Botella','Botella',1.5,'l','1.5 l','botella',3,true,true,false,null,'{}',true,now(),'a5100000-0000-4000-8000-000000000001','csa-agua','csa-agua','commercial',1),
  -- JUGO: verificado y agotado, con la intención del comercio encendida.
  ('d5100000-0000-4000-8000-000000000002','b5100000-0000-4000-8000-000000000001','Jugo 1 L','Jugos','Naranja',1500,'confirmed',true,'Marca',
   'Caja','Caja',1,'l','1 l','caja',0,false,true,false,null,'{}',true,now(),'a5100000-0000-4000-8000-000000000001','csa-jugo','csa-jugo','commercial',1),
  -- GALLETITAS: publicadas, queda 1.
  ('d5100000-0000-4000-8000-000000000003','b5100000-0000-4000-8000-000000000001','Galletitas','Almacén','Dulces',900,'confirmed',true,'Marca',
   'Paquete','Paquete',300,'g','300 g','paquete',1,true,true,false,null,'{}',true,now(),'a5100000-0000-4000-8000-000000000001','csa-galle','csa-galle','commercial',1),
  -- CERVEZA: verificada, agotada, el comercio la quiere vender, licencia cerrada.
  ('d5100000-0000-4000-8000-000000000004','b5100000-0000-4000-8000-000000000001','Cerveza 1 L','Cervezas','Rubia',2500,'confirmed',true,'Marca',
   'Botella','Botella',1,'l','1 l','botella',0,false,true,true,18,'{}',true,now(),'a5100000-0000-4000-8000-000000000001','csa-birra','csa-birra','commercial',1),
  -- SODA: verificada, OCULTA por el comercio, con stock.
  ('d5100000-0000-4000-8000-000000000005','b5100000-0000-4000-8000-000000000001','Soda 1 L','Aguas','Con gas',800,'confirmed',true,'Marca',
   'Botella','Botella',1,'l','1 l','botella',4,false,false,false,null,'{}',true,now(),'a5100000-0000-4000-8000-000000000001','csa-soda','csa-soda','commercial',1),
  -- MIXER: publicado, 4 disponibles + 1 retenida por un checkout vivo.
  ('d5100000-0000-4000-8000-000000000006','b5100000-0000-4000-8000-000000000001','Mixer 500 ml','Mixers','Pomelo',700,'confirmed',true,'Marca',
   'Botella','Botella',500,'ml','500 ml','botella',4,true,true,false,null,'{}',true,now(),'a5100000-0000-4000-8000-000000000001','csa-mixer','csa-mixer','commercial',1),
  -- HIELO: borrador sin contar.
  ('d5100000-0000-4000-8000-000000000007','b5100000-0000-4000-8000-000000000001','Hielo 2 kg','Hielo','Rolito',1200,'confirmed',true,'Marca',
   'Bolsa','Bolsa',2,'kg','2 kg','bolsa',null,false,true,false,null,'{}',false,null,null,'csa-hielo','csa-hielo','commercial',1),
  -- ISOTÓNICA: verificada, oculta por el comercio, con stock: para el conflicto retenido.
  ('d5100000-0000-4000-8000-000000000008','b5100000-0000-4000-8000-000000000001','Isotónica 500 ml','Isotónicas','Naranja',1100,'confirmed',true,'Marca',
   'Botella','Botella',500,'ml','500 ml','botella',6,false,false,false,null,'{}',true,now(),'a5100000-0000-4000-8000-000000000001','csa-iso','csa-iso','commercial',1);

-- Dos productos con imagen ligada a un asset aprobado (puerta técnica).
insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
  variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
  stock,available,merchant_available,is_alcoholic,minimum_age,tags,is_verified,
  external_id,sku,catalog_origin,units_per_pack,
  catalog_asset_id,image_url,image_sha256,image_thumbnail_url,image_thumbnail_sha256,source_image_sha256)
select x.id,'b5100000-0000-4000-8000-000000000001',x.name,x.category,x.subcategory,x.price,'confirmed',true,'Marca',
  'Botella','Botella',750,'ml','750 ml','botella',
  5,false,x.merchant,x.alcoholic,x.age,'{}',false,
  x.sku,x.sku,'commercial',1,
  ca.id,ca.master_path,ca.master_sha256,ca.thumbnail_path,ca.thumbnail_sha256,ca.source_sha256
from (values
  ('d5100000-0000-4000-8000-000000000009'::uuid,'csa-vino','Vino 750 ml','Vinos','Malbec',5200::numeric,true,true,18),
  ('d5100000-0000-4000-8000-00000000000a'::uuid,'csa-tonica','Tónica 750 ml','Mixers','Tónica',1300::numeric,false,false,null::integer)
) x(id,sku,name,category,subcategory,price,merchant,alcoholic,age)
join public.catalog_assets ca on ca.business_id = 'b5100000-0000-4000-8000-000000000001' and ca.sku = x.sku;

insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,customer_name,
  customer_neighborhood,customer_street_address,customer_phone,payment_method,subtotal,delivery_fee,total)
values ('e5100000-0000-4000-8000-000000000001','b5100000-0000-4000-8000-000000000001','CSA-1','CSA-1','accepted','pickup','pickup',
  'csa-request-1','Ana','Centro','Mendoza 1','+5429900000001','cash',3000,0,3000);
insert into public.order_items(order_id,product_id,name,quantity,unit,unit_price,subtotal,product_uuid)
values ('e5100000-0000-4000-8000-000000000001','csa-agua','Agua 1,5 L',2,'u',1500,3000,'d5100000-0000-4000-8000-000000000001');

insert into public.checkout_sessions(id,business_id,customer_id,client_request_id,normalized_intent_hash,fulfillment_type,currency,subtotal,total,status,expires_at)
values ('f5100000-0000-4000-8000-000000000001','b5100000-0000-4000-8000-000000000001','a5100000-0000-4000-8000-000000000001',
        'csa-checkout-01',repeat('a',64),'pickup','ARS',700,700,'created','2099-01-01T00:00:00Z');
insert into public.inventory_reservations(checkout_session_id,product_id,quantity,status,expires_at)
values ('f5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000006',1,'active','2099-01-01T00:00:00Z');

create function pg_temp.as_user(p_user uuid, p_session uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void;
$$;
create function pg_temp.owner() returns void language sql as $$
  select pg_temp.as_user('a5100000-0000-4000-8000-000000000001','c5100000-0000-4000-8000-000000000001') $$;
create function pg_temp.staff() returns void language sql as $$
  select pg_temp.as_user('a5100000-0000-4000-8000-000000000002','c5100000-0000-4000-8000-000000000002') $$;
create function pg_temp.st(p_id uuid) returns text language sql stable security definer as $$
  select format('stock=%s available=%s merchant=%s verified=%s', coalesce(stock::text, 'null'),
                available::text, merchant_available::text, is_verified::text)
    from public.products where id = p_id $$;
create function pg_temp.reserved(p_id uuid) returns integer language sql stable security definer as $$
  select private.pos_reserved_quantity(p_id) $$;
create function pg_temp.ledger_rows(p_id uuid) returns integer language sql stable security definer as $$
  select count(*)::integer from public.inventory_movements where product_id = p_id $$;
create function pg_temp.has_move(p_id uuid, p_type text, p_previous integer, p_delta integer, p_result integer) returns boolean
language sql stable security definer as $$
  select exists (select 1 from public.inventory_movements m
    where m.product_id = p_id and m.movement_type = p_type and m.previous_stock = p_previous
      and m.quantity_delta = p_delta and m.resulting_stock = p_result) $$;
create function pg_temp.conflict(p_id uuid) returns text language sql stable security definer as $$
  select coalesce((select format('%s %s shortfall=%s reserved=%s', c.status, c.kind, c.shortfall, c.reserved_at_detection)
    from public.pos_stock_conflicts c where c.product_id = p_id order by (c.status = 'open') desc, c.detected_at desc limit 1), 'none') $$;
-- Corre una consulta con el rol y la sesión vigentes y devuelve su valor como texto,
-- o el SQLSTATE si falla: así una función que todavía no hace lo que se espera se ve
-- como una aserción en rojo y no como un archivo que no termina.
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

-- ══ 1 · CONTEO FÍSICO → DISPONIBLE (STK-02 / CAT-05) ═════════════════════════
select is(pg_temp.reserved('d5100000-0000-4000-8000-000000000001'), 2, 'fixture: el pedido aceptado reserva 2 aguas');
select is(pg_temp.q($q$select applied_stock from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"csa-agua","stock":5}]')$q$), '3',
  'contar 5 con 2 reservadas deja 3 disponibles: las reservadas no vuelven a la venta');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000001'), 'stock=3 available=true merchant=true verified=true',
  'el producto sigue publicado con su disponible intacto');
select is(pg_temp.ledger_rows('d5100000-0000-4000-8000-000000000001'), 0,
  'un conteo que coincide no escribe una fila de libro con diferencia cero');

select is(pg_temp.q($q$select applied_stock from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"csa-agua","stock":"11"}]')$q$), '9', 'contar 11 con 2 reservadas deja 9 disponibles');
select ok(pg_temp.has_move('d5100000-0000-4000-8000-000000000001', 'stock_count', 3, 6, 9),
  'el conteo deja su fila stock_count: anterior 3, diferencia +6, resultante 9');
select is((select m.operator_id::text || ' ' || m.reference_type from public.inventory_movements m
            where m.product_id = 'd5100000-0000-4000-8000-000000000001' and m.resulting_stock = 9),
  'a5100000-0000-4000-8000-000000000001 catalog_change_batch', 'con el operador y la referencia al lote');

-- Un checkout vivo también cuenta como reservado.
select is(pg_temp.reserved('d5100000-0000-4000-8000-000000000006'), 1, 'fixture: un checkout vivo retiene 1 mixer');
select is(pg_temp.q($q$select applied_stock from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"csa-mixer","stock":7}]')$q$), '6', 'contar 7 con 1 retenida por un checkout deja 6 disponibles');

-- Una fila sin stock no toca stock ni libro.
select lives_ok($$select * from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"csa-mixer","price":"750"}]')$$, 'una fila sólo de precio se acepta');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000006'), 'stock=6 available=true merchant=true verified=true',
  'y no mueve el stock (sigue publicada: el cambio de precio la republica)');
select is(pg_temp.ledger_rows('d5100000-0000-4000-8000-000000000006'), 1, 'ni agrega filas al libro');

-- Primer conteo de un producto sin contar.
select is(pg_temp.q($q$select applied_stock from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"csa-hielo","stock":4,"expected_stock":null}]')$q$), '4', 'el primer conteo de un producto sin contar entra');
select ok(pg_temp.has_move('d5100000-0000-4000-8000-000000000007', 'stock_count', 0, 4, 4),
  'y queda en el libro contra un anterior de cero');

-- ══ 2 · GUARDA OPTIMISTA (expected_stock) ════════════════════════════════════
select throws_ok($$select * from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"csa-mixer","price":"760"},{"sku":"csa-agua","stock":14,"expected_stock":3}]')$$,
  'PT409', null, 'una pantalla vieja (veía 3, hay 9) se rechaza con PT409');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000001'), 'stock=9 available=true merchant=true verified=true',
  'y no pisa el stock');
select is((select price from public.products where id = 'd5100000-0000-4000-8000-000000000006'), 750::numeric,
  'ni aplica las otras filas del lote: es atómico');
select throws_like($$select * from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"csa-agua","stock":14,"expected_stock":3}]')$$,
  '%Agua 1,5 L (csa-agua)%mostraba 3 y ahora hay 9%', 'el mensaje nombra el producto, lo que se veía y lo que hay');
select throws_ok($$select * from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"csa-agua","stock":14,"expected_stock":null}]')$$,
  'PT409', null, 'esperar «sin contar» sobre un producto ya contado también es conflicto');
select is(pg_temp.q($q$select applied_stock from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"csa-agua","stock":12,"expected_stock":9}]')$q$), '10', 'con el stock esperado correcto el conteo entra');
select throws_ok($$select * from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"csa-agua","stock":12,"expected_stock":"muchos"}]')$$,
  'P0001', null, 'un expected_stock que no es un entero se rechaza');

-- ══ 3 · CONTEO POR DEBAJO DE LO RESERVADO → CONFLICTO ════════════════════════
select is(pg_temp.q($q$select applied_stock || ' ' || applied_available from public.apply_commercial_catalog_batch(
  'b5100000-0000-4000-8000-000000000001', '[{"sku":"csa-agua","stock":1}]')$q$), '0 false',
  'contar 1 con 2 reservadas deja el disponible en 0 y fuera de la venta');
select is(pg_temp.conflict('d5100000-0000-4000-8000-000000000001'), 'open count_below_reserved shortfall=1 reserved=2',
  'y abre el conflicto con el faltante y lo reservado');
select ok(pg_temp.has_move('d5100000-0000-4000-8000-000000000001', 'stock_count', 10, -10, 0),
  'la baja a cero queda en el libro');
select throws_like($$select * from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"csa-agua","stock":2,"publish":true}]')$$,
  '%without stock: the 2 counted units are all reserved%',
  'publicar con un conteo que sólo cubre lo reservado se rechaza diciendo por qué');
select is(pg_temp.conflict('d5100000-0000-4000-8000-000000000001'), 'open count_below_reserved shortfall=1 reserved=2',
  'el lote rechazado no tocó el conflicto');
select is(pg_temp.q($q$select applied_stock || ' ' || applied_available from public.apply_commercial_catalog_batch(
  'b5100000-0000-4000-8000-000000000001', '[{"sku":"csa-agua","stock":6}]')$q$), '4 true',
  'un conteo que cubre lo reservado deja 4 disponibles y devuelve el producto a la venta');
select is(pg_temp.conflict('d5100000-0000-4000-8000-000000000001'), 'resolved count_below_reserved shortfall=1 reserved=2',
  'y cierra el conflicto');

-- Un producto retenido por un conflicto no se publica de costado.
reset role;
insert into public.pos_stock_conflicts(business_id, product_id, kind, requested_delta, applied_delta, shortfall, reserved_at_detection)
values ('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000008','oversold_offline',-3,-1,2,0);
set local role authenticated;
select throws_like($$select * from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"csa-iso","publish":true}]')$$,
  '%held by an open stock conflict%', 'publicar un producto retenido falla y dice que hay que contarlo');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000008'), 'stock=6 available=false merchant=false verified=true',
  'y no deja la intención encendida a medias');
select is(pg_temp.q($q$select applied_available from public.apply_commercial_catalog_batch(
  'b5100000-0000-4000-8000-000000000001', '[{"sku":"csa-iso","stock":6,"publish":true}]')$q$), 'true',
  'contar y publicar en la misma fila cierra el conflicto y publica');
select is(pg_temp.conflict('d5100000-0000-4000-8000-000000000008'), 'resolved oversold_offline shortfall=2 reserved=0',
  'el conflicto queda resuelto por el conteo');

-- ══ 4 · PUBLICAR ES PUBLICAR (CAT-03) ════════════════════════════════════════
select is(pg_temp.q($q$select format('%s %s %s', applied_available, applied_is_verified, applied_republished)
  from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
    '[{"sku":"csa-jugo","price":"1800","stock":"24","publish":true}]')$q$), 't t t',
  'precio nuevo + stock + publicar sobre un verificado agotado termina publicado y verificado');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000002'), 'stock=24 available=true merchant=true verified=true',
  'queda en la tienda');
select is(pg_temp.q($q$select format('%s %s %s', applied_available, applied_is_verified, applied_republished)
  from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
    '[{"sku":"csa-jugo","price":"1800","stock":"24","publish":true}]')$q$), 't t f',
  'repetir la misma fila no cambia nada: la planilla es idempotente');
select is(pg_temp.ledger_rows('d5100000-0000-4000-8000-000000000002'), 1, 'y no duplica el movimiento de stock');

-- Precio nuevo + un conteo que queda todo reservado, sobre un producto publicado: sale
-- de la venta por falta de disponible, pero NO pierde la verificación.
select is(pg_temp.q($q$select format('%s %s %s %s', applied_stock, applied_available, applied_is_verified, applied_republished)
  from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
    '[{"sku":"csa-agua","price":"1600","stock":2}]')$q$), '0 f t f',
  'precio nuevo + contar 2 con 2 reservadas: 0 disponibles, fuera de la venta y TODAVÍA verificado');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000001'), 'stock=0 available=false merchant=true verified=true',
  'conserva la verificación y la intención del comercio');
select is(pg_temp.conflict('d5100000-0000-4000-8000-000000000001'), 'resolved count_below_reserved shortfall=1 reserved=2',
  'sin abrir un conflicto: el conteo cubre exactamente lo reservado');
select lives_ok($$select public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000001',
  null,'purchase_receipt',3,1,null,null,null,'csa-receipt-0000')$$, 'entran 3 unidades');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000001'), 'stock=3 available=true merchant=true verified=true',
  'y vuelve sola a la venta: antes quedaba sin verificar y no volvía');
select is(pg_temp.q($q$select format('%s %s %s %s', applied_stock, applied_available, applied_is_verified, applied_republished)
  from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
    '[{"sku":"csa-agua","price":"1500","stock":6}]')$q$), '4 t t t',
  'un cambio de precio con disponible la deja publicada, como siempre');

-- Lo mismo con un producto retenido por un conflicto de stock.
reset role;
select private.pos_record_conflict('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000006','oversold_offline',-3,-1,2,1) is not null as mixer_retenido;
set local role authenticated;
select is(pg_temp.st('d5100000-0000-4000-8000-000000000006'), 'stock=6 available=false merchant=true verified=true',
  'fixture: el mixer queda retenido por un conflicto de Caja Clara');
select is(pg_temp.q($q$select format('%s %s %s %s', applied_stock, applied_available, applied_is_verified, applied_republished)
  from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
    '[{"sku":"csa-mixer","price":"770"}]')$q$), '6 f t f',
  'cambiarle el precio mientras está retenido no le saca la verificación');
select is(pg_temp.conflict('d5100000-0000-4000-8000-000000000006'), 'open oversold_offline shortfall=2 reserved=1', 'ni toca la retención');
select is(pg_temp.q($q$select format('%s %s %s %s', applied_stock, applied_available, applied_is_verified, applied_republished)
  from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
    '[{"sku":"csa-mixer","price":"780","stock":7}]')$q$), '6 t t f',
  'precio nuevo + el conteo que cierra el conflicto: vuelve a la venta verificado');
select is(pg_temp.conflict('d5100000-0000-4000-8000-000000000006'), 'resolved oversold_offline shortfall=2 reserved=1', 'y el conflicto queda resuelto');

-- ══ 5 · MOVIMIENTOS: EL DISPONIBLE MANDA SOBRE LA PUBLICACIÓN (STK-05) ═══════
select pg_temp.staff();
select lives_ok($$select public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000003',
  null,'damage',1,-1,null,null,'se rompió la última','csa-damage-0001')$$,
  'registrar la rotura de la última unidad de un producto publicado funciona');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000003'), 'stock=0 available=false merchant=true verified=true',
  'sale de la venta y conserva la intención del comercio');
select throws_ok($$select public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000003',
  null,'damage',1,-1,null,null,'no queda ninguna','csa-damage-0002')$$,
  '23514', 'stock negativo bloqueado', 'el stock negativo sigue bloqueado con su propio mensaje');
select lives_ok($$select public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000003',
  null,'purchase_receipt',5,1,null,null,null,'csa-receipt-0001')$$, 'recibir mercadería se acepta');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000003'), 'stock=5 available=true merchant=true verified=true',
  'al volver a haber stock se reofrece: el comercio lo quería a la venta');
select lives_ok($$select public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000003',
  null,'sale',2,-1,null,null,null,'csa-sale-0001')$$, 'una venta que no agota se acepta');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000003'), 'stock=3 available=true merchant=true verified=true',
  'y no toca la publicación');
select lives_ok($$select public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000004',
  null,'purchase_receipt',6,1,null,null,null,'csa-receipt-0002')$$, 'recibir cerveza con la licencia cerrada se acepta');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000004'), 'stock=6 available=false merchant=true verified=true',
  'pero no la publica: la licencia de alcohol está cerrada');
select lives_ok($$select public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000005',
  null,'purchase_receipt',3,1,null,null,null,'csa-receipt-0003')$$, 'recibir un producto oculto por el comercio se acepta');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000005'), 'stock=7 available=false merchant=false verified=true',
  'y sigue oculto: un movimiento no decide publicar');
select is(pg_temp.q($q$select (public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000003',
  null,'damage',1,-1,null,null,'se rompió la última','csa-damage-0001')).resulting_stock$q$), '0',
  'el reintento con la misma clave devuelve el movimiento original y no descuenta de nuevo');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000003'), 'stock=3 available=true merchant=true verified=true',
  'el stock no se movió con el reintento');

-- ══ 5b · EL CONTEO DEL ESCÁNER NO VUELVE A OFRECER LO APARTADO (STK-02) ══════
-- El Panel manda la diferencia entre lo contado y el disponible, con el código
-- escaneado. Lo contado incluye lo apartado: con unidades apartadas se rechaza.
reset role;
insert into public.product_barcodes(id,business_id,product_id,gtin,barcode_type,package_type,unit_factor,is_primary,source,verified_at,created_by) values
  ('95100000-0000-4000-8000-000000000006','b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000006','CSA-MIXER','INTERNAL','unit',1,true,'manual',now(),'a5100000-0000-4000-8000-000000000001'),
  ('95100000-0000-4000-8000-000000000003','b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000003','CSA-GALLE','INTERNAL','unit',1,true,'manual',now(),'a5100000-0000-4000-8000-000000000001');
-- El SQLSTATE y el detalle de un rechazo, o 'ok'.
create function pg_temp.rechazo(p_sql text) returns text language plpgsql as $$
declare v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlstate || ' ' || coalesce(v_detail, '');
end $$;
set local role authenticated;
select pg_temp.staff();
select set_config('csa.mixer', pg_temp.st('d5100000-0000-4000-8000-000000000006') || ' libro=' || pg_temp.ledger_rows('d5100000-0000-4000-8000-000000000006'), true);
select is(pg_temp.reserved('d5100000-0000-4000-8000-000000000006'), 1, 'el mixer sigue con 1 unidad apartada por un checkout vivo');
select is(pg_temp.rechazo($q$select public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000006',
  '95100000-0000-4000-8000-000000000006','stock_count',1,1,null,null,'Conteo físico','csa-scan-count-0001')$q$),
  '22023 STOCK_COUNT_HAS_RESERVED', 'contar de más desde el escáner con unidades apartadas se rechaza');
select is(pg_temp.rechazo($q$select public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000006',
  '95100000-0000-4000-8000-000000000006','stock_count',1,-1,null,null,'Conteo físico','csa-scan-count-0002')$q$),
  '22023 STOCK_COUNT_HAS_RESERVED', 'y contar de menos también: la diferencia está tomada contra el disponible');
select throws_like($q$select public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000006',
  '95100000-0000-4000-8000-000000000006','stock_count',1,1,null,null,'Conteo físico','csa-scan-count-0003')$q$,
  '%1 unidades apartadas%Stock contado%', 'el mensaje dice cuántas hay apartadas y por dónde se cuenta bien');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000006') || ' libro=' || pg_temp.ledger_rows('d5100000-0000-4000-8000-000000000006'),
  current_setting('csa.mixer'), 'ningún rechazo movió el stock ni escribió el libro');
select is(pg_temp.rechazo($q$select public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000006',
  '95100000-0000-4000-8000-000000000006','purchase_receipt',2,1,null,null,null,'csa-scan-receipt-001')$q$),
  'ok', 'recibir mercadería escaneando el mismo producto no cambia: sólo el conteo se rechaza');
select is(pg_temp.rechazo($q$select public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000006',
  null,'stock_count',2,-1,'pilot_qa_return',null,'restitución','csa-noscan-count-01')$q$),
  'ok', 'un ajuste de conteo sin código escaneado (una restitución) sigue como antes');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000006') || ' libro=' || pg_temp.ledger_rows('d5100000-0000-4000-8000-000000000006'),
  split_part(current_setting('csa.mixer'), ' libro=', 1) || ' libro=' || (split_part(current_setting('csa.mixer'), ' libro=', 2)::integer + 2),
  'esos dos movimientos se compensan y dejan dos filas en el libro');
select is(pg_temp.reserved('d5100000-0000-4000-8000-000000000003'), 0, 'las galletitas no tienen unidades apartadas');
select is(pg_temp.rechazo($q$select public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000003',
  '95100000-0000-4000-8000-000000000003','stock_count',1,1,null,null,'Conteo físico','csa-scan-count-0004')$q$),
  'ok', 'sin unidades apartadas el conteo del escáner funciona');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000003'), 'stock=4 available=true merchant=true verified=true',
  'y deja lo contado');
select is(pg_temp.rechazo($q$select public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001','d5100000-0000-4000-8000-000000000003',
  '95100000-0000-4000-8000-000000000003','stock_count',1,-1,null,null,'Conteo físico','csa-scan-count-0005')$q$),
  'ok', 'también hacia abajo');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000003'), 'stock=3 available=true merchant=true verified=true',
  'y el producto queda como estaba para lo que sigue');
select pg_temp.staff();

-- ══ 6 · NADIE ESCRIBE STOCK NI PUBLICACIÓN DIRECTO (STK-03 / CAT-06 / AUTHZ-02) ══
select ok(
  not has_column_privilege('authenticated', 'public.products', 'stock', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.products', 'available', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.products', 'is_active', 'UPDATE')
  and not has_any_column_privilege('anon', 'public.products', 'UPDATE'),
  'authenticated no tiene UPDATE sobre stock, available ni is_active; anon no tiene ninguno');
select ok(has_column_privilege('authenticated', 'public.products', 'sort_order', 'UPDATE'),
  'el orden de la góndola se conserva');
select throws_ok($$update public.products set stock = 99 where id = 'd5100000-0000-4000-8000-000000000003'$$,
  '42501', null, 'STAFF no puede escribir el stock directo');
select throws_ok($$update public.products set available = true where id = 'd5100000-0000-4000-8000-000000000004'$$,
  '42501', null, 'STAFF no puede publicar una cerveza con la licencia cerrada escribiendo available');
select pg_temp.owner();
select throws_ok($$update public.products set available = false, is_active = false where id = 'd5100000-0000-4000-8000-000000000003'$$,
  '42501', null, 'tampoco el dueño: ocultar pasa por la RPC, que apaga también la intención');
select lives_ok($$update public.products set sort_order = 7 where id = 'd5100000-0000-4000-8000-000000000003'$$,
  'ordenar la góndola sigue funcionando');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000003'), 'stock=3 available=true merchant=true verified=true',
  'y nada de lo anterior movió el producto');

-- ══ 7 · COMPLETAR LA FICHA NUNCA PUBLICA Y TRADUCE EL CONTEO (STK-02 · D, STK-08) ══
select lives_ok($$select public.complete_scanned_product('d5100000-0000-4000-8000-000000000005',
  '{"name":"Soda 1 L","brand":"Marca","category":"Aguas","variant":"Botella","capacity_value":1,"capacity_unit":"l","units_per_pack":1,"price":800,"stock":7}')$$,
  'completar la ficha de un producto verificado que el comercio ocultó ya no choca la restricción');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000005'), 'stock=7 available=false merchant=false verified=true',
  'y lo deja oculto: completar no decide publicar');
select lives_ok($$select public.complete_scanned_product('d5100000-0000-4000-8000-000000000001',
  '{"name":"Agua 1,5 L","brand":"Marca","category":"Aguas","variant":"Botella","capacity_value":1.5,"capacity_unit":"l","units_per_pack":1,"price":1500,"stock":9,"expected_stock":4}')$$,
  'completar la ficha con un conteo y el stock esperado correcto se acepta');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000001'), 'stock=7 available=true merchant=true verified=true',
  'contar 9 con 2 reservadas deja 7 disponibles');
select ok(pg_temp.has_move('d5100000-0000-4000-8000-000000000001', 'stock_count', 4, 3, 7),
  'y el conteo de la ficha queda en el libro');
select throws_ok($$select public.complete_scanned_product('d5100000-0000-4000-8000-000000000001',
  '{"name":"Agua 1,5 L","brand":"Marca","category":"Aguas","variant":"Botella","capacity_value":1.5,"capacity_unit":"l","units_per_pack":1,"price":1500,"stock":20,"expected_stock":4}')$$,
  'PT409', null, 'una ficha con el stock viejo a la vista se rechaza con PT409');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000001'), 'stock=7 available=true merchant=true verified=true',
  'sin pisar nada');
-- Una ficha SIN conteo sobre un producto ya contado no toca el stock: quien sólo edita
-- la ficha no tiene que reenviar el disponible (que, leído como conteo, le restaría
-- las 2 reservadas en cada llamada).
select lives_ok($$select public.complete_scanned_product('d5100000-0000-4000-8000-000000000001',
  '{"name":"Agua 1,5 L","brand":"Marca","category":"Aguas","variant":"Botella","capacity_value":1.5,"capacity_unit":"l","units_per_pack":1,"price":1500}')$$,
  'guardar la ficha sin la clave stock se acepta en un producto ya contado');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000001') || ' / ' || (select format('%s %s', i.action, coalesce(i.stock_count::text, 'sin conteo'))
    from public.catalog_change_items i where i.product_id = 'd5100000-0000-4000-8000-000000000001' order by i.id desc limit 1),
  'stock=7 available=true merchant=true verified=true / unchanged sin conteo',
  'y no cuenta: el disponible queda en 7 con las 2 reservadas intactas');

-- La puerta técnica de verificación: disponible sólo si además se puede vender.
select is(pg_temp.q($q$select format('%s %s', published_is_verified, published_available)
  from public.publish_catalog_product('b5100000-0000-4000-8000-000000000001', 'csa-vino', true)$q$), 't f',
  'verificar un vino con la licencia cerrada lo verifica y NO lo deja disponible');
select is(pg_temp.q($q$select format('%s %s', published_is_verified, published_available)
  from public.publish_catalog_product('b5100000-0000-4000-8000-000000000001', 'csa-tonica', true)$q$), 't t',
  'verificar y pedir disponible un producto que el comercio tenía oculto ya no choca la restricción');
select is(pg_temp.st('d5100000-0000-4000-8000-00000000000a'), 'stock=5 available=true merchant=true verified=true',
  'pedir que quede disponible enciende la intención del comercio');
select is(pg_temp.q($q$select format('%s %s', published_is_verified, published_available)
  from public.publish_catalog_product('b5100000-0000-4000-8000-000000000001', 'csa-tonica', false)$q$), 't f',
  'verificar sin pedir disponible saca de la venta lo que estaba a la venta');
select is(pg_temp.st('d5100000-0000-4000-8000-00000000000a'), 'stock=5 available=false merchant=false verified=true',
  'y apaga la intención: una reserva vencida no lo vuelve a ofrecer');
select is(pg_temp.q($q$select format('%s %s', published_is_verified, published_available)
  from public.publish_catalog_product('b5100000-0000-4000-8000-000000000001', 'csa-vino', false)$q$), 't f',
  'volver a verificar un producto que ya no estaba a la venta');
select is(pg_temp.st('d5100000-0000-4000-8000-000000000009'), 'stock=5 available=false merchant=true verified=true',
  'no toca su intención: esa puerta también se usa sólo para verificar');

-- ══ 8 · EL ALTA DE PLANILLA PUEDE LLEGAR A PUBLICARSE (CAT-07) ═══════════════
select is((public.apply_commercial_catalog_plan('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"papas-clasicas-150g","name":"Papas clásicas 150 g","category":"Snacks","subcategory":"Papas","is_alcoholic":false,"price":"1900","stock":12}]'::jsonb,
  '[]'::jsonb) ->> 'created')::integer, 1, 'el plan da de alta un producto oculto');
select ok(pg_temp.has_move((select id from public.products where business_id = 'b5100000-0000-4000-8000-000000000001' and sku = 'papas-clasicas-150g'),
  'stock_count', 0, 12, 12), 'y su primer conteo queda en el libro, contra un anterior de cero');
select throws_like($$select * from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"papas-clasicas-150g","publish":true}]')$$,
  '%incomplete (missing: brand, variant, capacity, packaging_type)%',
  'publicarlo sin completar la ficha dice qué falta, no el nombre de una restricción');
select throws_ok($$select public.complete_scanned_product(
  (select id from public.products where business_id = 'b5100000-0000-4000-8000-000000000001' and sku = 'papas-clasicas-150g'),
  '{"name":"Papas clásicas 150 g","brand":"Marca","category":"Snacks","packaging_type":"  ","variant":"Clásicas","capacity_value":150,"capacity_unit":"g","units_per_pack":1,"price":1900,"stock":12}')$$,
  '22023', null, 'un envase vacío se rechaza');
select lives_ok($$select public.complete_scanned_product(
  (select id from public.products where business_id = 'b5100000-0000-4000-8000-000000000001' and sku = 'papas-clasicas-150g'),
  '{"name":"Papas clásicas 150 g","brand":"Marca","category":"Snacks","subcategory":"Papas","packaging_type":"bolsa","variant":"Clásicas","capacity_value":150,"capacity_unit":"g","units_per_pack":1,"price":1900,"stock":12}')$$,
  'el dueño completa la ficha, envase y subfamilia incluidos');
select is((select packaging_type || ' / ' || subcategory || ' / ' || available || ' / ' || is_verified from public.products
  where business_id = 'b5100000-0000-4000-8000-000000000001' and sku = 'papas-clasicas-150g'), 'bolsa / Papas / false / false',
  'la ficha queda completa, todavía oculta y sin verificar');
select is(pg_temp.q($q$select format('%s %s', applied_available, applied_is_verified)
  from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
    '[{"sku":"papas-clasicas-150g","publish":true}]')$q$), 't t',
  'y la segunda pasada la verifica y la publica');
select throws_ok($$select public.apply_commercial_catalog_plan('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"coca-500","name":"QA TEST","category":"Gaseosas","is_alcoholic":false}]'::jsonb, '[]'::jsonb)$$,
  '22023', null, 'un alta con nombre de fixture de QA no entra aunque el SKU parezca real');
select lives_ok($$select public.apply_commercial_catalog_plan('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"mani-salado-80g","name":"Maní salado 80 g","category":"Snacks","subcategory":"Maní","is_alcoholic":false,"price":"900"}]'::jsonb, '[]'::jsonb)$$,
  'un alta sin stock queda sin contar');
select throws_ok($$select public.complete_scanned_product(
  (select id from public.products where business_id = 'b5100000-0000-4000-8000-000000000001' and sku = 'mani-salado-80g'),
  '{"name":"Maní salado 80 g","brand":"Marca","category":"Snacks","subcategory":"Maní","packaging_type":"bolsa","variant":"Salado","capacity_value":80,"capacity_unit":"g","units_per_pack":1,"price":900}')$$,
  '22023', 'stock invalido', 'completar sin conteo un producto que nunca se contó sigue rechazado');
select is((public.apply_commercial_catalog_plan('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"turron-mani-25g","name":"Turrón de maní 25 g","category":"Golosinas","subcategory":"Turrones","is_alcoholic":false,"price":"400","stock":5}]'::jsonb,
  '[{"sku":"turron-mani-25g","stock":7}]'::jsonb) ->> 'updated')::integer, 1,
  'un mismo plan puede dar de alta un producto y volver a contarlo');
select ok(
  pg_temp.has_move((select id from public.products where business_id = 'b5100000-0000-4000-8000-000000000001' and sku = 'turron-mani-25g'), 'stock_count', 0, 5, 5)
  and pg_temp.has_move((select id from public.products where business_id = 'b5100000-0000-4000-8000-000000000001' and sku = 'turron-mani-25g'), 'stock_count', 5, 2, 7),
  'y las dos filas del libro encadenan: 0 → 5 → 7');

-- Un producto sin precio confirmado mayor que cero no se vende, pase lo que pase.
select lives_ok($$select * from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"papas-clasicas-150g","price_pending":true}]')$$, 'devolver el precio a pendiente se acepta');
select is((select available::text || ' ' || price_status from public.products
  where business_id = 'b5100000-0000-4000-8000-000000000001' and sku = 'papas-clasicas-150g'), 'false pending',
  'y saca el producto de la venta');
select throws_like($$select * from public.apply_commercial_catalog_batch('b5100000-0000-4000-8000-000000000001',
  '[{"sku":"papas-clasicas-150g","stock":30,"publish":true}]')$$,
  '%without a confirmed price%', 'con el precio pendiente no se publica ni contando stock');
select lives_ok($$select public.apply_inventory_movement('b5100000-0000-4000-8000-000000000001',
  (select id from public.products where business_id = 'b5100000-0000-4000-8000-000000000001' and sku = 'papas-clasicas-150g'),
  null,'purchase_receipt',5,1,null,null,null,'csa-receipt-0004')$$, 'recibir mercadería de un producto con precio pendiente se acepta');
select is((select available::text || ' ' || stock from public.products
  where business_id = 'b5100000-0000-4000-8000-000000000001' and sku = 'papas-clasicas-150g'), 'false 17',
  'y sigue sin poder venderse');

select * from finish();
rollback;
