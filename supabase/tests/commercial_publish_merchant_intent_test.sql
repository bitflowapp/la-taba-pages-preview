-- LA PRIMERA PUBLICACIÓN DE UN BORRADOR DE CP · intención del comercio
--
-- Los borradores del comercio real nacen con merchant_available = false. La
-- planilla y el botón «Verificar ficha y publicar» tienen que poder publicarlos,
-- ocultar tiene que apagar la intención (para que ninguna reserva vencida los
-- vuelva a mostrar) y el CHECK products_available_requires_verification sigue
-- en pie: el arreglo está en la función, no en una restricción más floja.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('cc000000-0000-4000-8000-0000000000a1','authenticated','authenticated','owner@intent.invalid','',now(),'{}','{}',now(),now());
insert into public.businesses(id,name,status,slug,is_active,operating_timezone,currency_code,hours_enforced,
  delivery_zone_enforced,rider_presence_required)
values ('cc000000-0000-4000-8000-0000000000b1','Intención','closed','intent-merchant',true,'America/Argentina/Buenos_Aires','ARS',
  true,false,false);
insert into public.business_members(business_id,user_id,role,is_active)
values ('cc000000-0000-4000-8000-0000000000b1','cc000000-0000-4000-8000-0000000000a1','owner',true);
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values ('cc000000-0000-4000-8000-0000000000c1','cc000000-0000-4000-8000-0000000000a1','cc000000-0000-4000-8000-0000000000b1',
  'owner','panel_web');

-- La forma exacta de los 46 borradores de CP (20260927004347): sin precio, sin
-- stock, sin foto, sin verificar y con la intención del comercio apagada.
insert into public.products(id,business_id,name,category,price,price_status,is_active,brand,subcategory,presentation,capacity,
  packaging_type,stock,available,merchant_available,is_alcoholic,minimum_age,tags,is_verified,external_id,sku,variant,
  capacity_value,capacity_unit,catalog_origin,units_per_pack)
values
  ('cc000000-0000-4000-8000-0000000000d1','cc000000-0000-4000-8000-0000000000b1','Cola 1 L','Gaseosas',0,'pending',true,
    'Marca','Cola','Botella','1 l','botella',null,false,false,false,null,'{}',false,'in-cola-1l','in-cola-1l','Botella',1,'l',
    'commercial',1),
  ('cc000000-0000-4000-8000-0000000000d2','cc000000-0000-4000-8000-0000000000b1','Agua 1 L','Aguas',0,'pending',true,
    'Marca','Sin gas','Botella','1 l','botella',null,false,false,false,null,'{}',false,'in-agua-1l','in-agua-1l','Botella',1,'l',
    'commercial',1);

create function pg_temp.state(p_id uuid) returns text language sql stable as $$
  select format('available=%s merchant=%s verified=%s', available::text, merchant_available::text, is_verified::text)
    from public.products where id = p_id
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"cc000000-0000-4000-8000-0000000000a1","role":"authenticated","session_id":"cc000000-0000-4000-8000-0000000000c1"}';

-- ── 1 · Primera publicación de un borrador de CP ────────────────────────────
select lives_ok($$select * from public.apply_commercial_catalog_batch('cc000000-0000-4000-8000-0000000000b1',
  '[{"sku":"in-cola-1l","price":"1500","stock":"10","publish":true}]')$$,
  'la primera publicación de un borrador de CP ya no choca el CHECK de disponibilidad');
select is(pg_temp.state('cc000000-0000-4000-8000-0000000000d1'), 'available=true merchant=true verified=true',
  'publicar verifica la ficha y enciende la intención del comercio');

-- ── 2 · Agotado y reposición: el stock no cambia la intención ───────────────
select lives_ok($$select * from public.apply_commercial_catalog_batch('cc000000-0000-4000-8000-0000000000b1',
  '[{"sku":"in-cola-1l","stock":"0"}]')$$, 'cargar stock 0 se acepta');
select is(pg_temp.state('cc000000-0000-4000-8000-0000000000d1'), 'available=false merchant=true verified=true',
  'agotado: deja de estar disponible y conserva la intención');
select lives_ok($$select * from public.apply_commercial_catalog_batch('cc000000-0000-4000-8000-0000000000b1',
  '[{"sku":"in-cola-1l","stock":"5"}]')$$, 'reponer se acepta');
select is(pg_temp.state('cc000000-0000-4000-8000-0000000000d1'), 'available=false merchant=true verified=true',
  'al reponer se vuelve a publicar a mano (así lo dice el runbook)');
select lives_ok($$select * from public.set_commercial_product_publication('cc000000-0000-4000-8000-0000000000b1','in-cola-1l',true)$$,
  '«Publicar y habilitar» después de reponer');
select is(pg_temp.state('cc000000-0000-4000-8000-0000000000d1'), 'available=true merchant=true verified=true',
  'vuelve a la tienda');

-- ── 3 · Ocultar por la planilla apaga la intención ──────────────────────────
select lives_ok($$select * from public.apply_commercial_catalog_batch('cc000000-0000-4000-8000-0000000000b1',
  '[{"sku":"in-cola-1l","publish":false}]')$$, 'publicar = no se acepta');
select is(pg_temp.state('cc000000-0000-4000-8000-0000000000d1'), 'available=false merchant=false verified=true',
  'ocultar apaga la intención: una reserva vencida no lo vuelve a mostrar');
select lives_ok($$select * from public.apply_commercial_catalog_batch('cc000000-0000-4000-8000-0000000000b1',
  '[{"sku":"in-cola-1l","publish":true}]')$$, 'publicar de nuevo por la planilla');
select is(pg_temp.state('cc000000-0000-4000-8000-0000000000d1'), 'available=true merchant=true verified=true',
  'vuelve a la tienda con la intención encendida');

-- ── 4 · Cambio de precio: republica, salvo que la fila pida ocultar ─────────
select is((select applied_republished from public.apply_commercial_catalog_batch('cc000000-0000-4000-8000-0000000000b1',
  '[{"sku":"in-cola-1l","price":"1600"}]')), true, 'un cambio de precio republica lo que ya estaba publicado');
select is(pg_temp.state('cc000000-0000-4000-8000-0000000000d1'), 'available=true merchant=true verified=true',
  'y conserva la intención');
select is((select applied_republished from public.apply_commercial_catalog_batch('cc000000-0000-4000-8000-0000000000b1',
  '[{"sku":"in-cola-1l","price":"1700","publish":false}]')), false, 'cambiar el precio Y ocultar no republica');
select is(pg_temp.state('cc000000-0000-4000-8000-0000000000d1'), 'available=false merchant=false verified=false',
  'queda oculto; para volver a publicar se verifica la ficha otra vez');

-- ── 5 · Volver a borrador (cambio de foto) y «Verificar ficha y publicar» ───
select lives_ok($$select * from public.apply_commercial_catalog_batch('cc000000-0000-4000-8000-0000000000b1',
  '[{"sku":"in-cola-1l","publish":true}]')$$, 'verificar y publicar después de ocultar');
select is(public.unpublish_catalog_product('cc000000-0000-4000-8000-0000000000b1','in-cola-1l'), true,
  'volver a borrador para cambiar la foto');
select is(pg_temp.state('cc000000-0000-4000-8000-0000000000d1'), 'available=false merchant=false verified=false',
  'es un borrador de verdad');
select lives_ok($$select * from public.apply_commercial_catalog_batch('cc000000-0000-4000-8000-0000000000b1',
  '[{"sku":"in-cola-1l","publish":true}]')$$, '«Verificar ficha y publicar» desde un borrador reabierto');
select is(pg_temp.state('cc000000-0000-4000-8000-0000000000d1'), 'available=true merchant=true verified=true',
  'vuelve a la tienda');

-- ── 6 · Cargar sin publicar no verifica ni enciende nada ────────────────────
select lives_ok($$select * from public.apply_commercial_catalog_batch('cc000000-0000-4000-8000-0000000000b1',
  '[{"sku":"in-agua-1l","price":"900","stock":"12","publish":false}]')$$, 'precio y stock con publicar = no');
select is(pg_temp.state('cc000000-0000-4000-8000-0000000000d2'), 'available=false merchant=false verified=false',
  'queda como borrador: nada se verifica sin publicar');

-- ── 7 · El CHECK sigue en pie ───────────────────────────────────────────────
reset role;
select throws_ok($$update public.products set available = true, is_verified = true
  where id = 'cc000000-0000-4000-8000-0000000000d2'$$, '23514', null,
  'disponible sin la intención del comercio sigue prohibido por la base');

select * from finish();
rollback;
