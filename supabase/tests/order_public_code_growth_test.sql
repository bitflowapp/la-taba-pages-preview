-- TABA · EL CÓDIGO PÚBLICO DEL PEDIDO NO SE TERMINA EN LT-9999
--
-- `next_order_public_code()` usaba `lpad(..., 4, '0')`, que además de rellenar
-- RECORTA: el pedido 10.000 salía como `LT-1000`, repetido, y el alta buscaba un
-- código libre en un lazo sin tope. Acá se prueba que:
--
--   · hasta 9999 el código es exactamente el de siempre (cuatro dígitos);
--   · desde 10000 crece y no se repite;
--   · dos pedidos seguidos por la RPC pública, con la secuencia pasada de 9999,
--     reciben `LT-10000` y `LT-10001` y gastan un solo valor de secuencia cada uno;
--   · el trigger de valores por defecto usa el mismo generador.
--
-- La secuencia se mueve con ALTER SEQUENCE ... RESTART, que —a diferencia de
-- setval— es transaccional: el rollback final la deja donde estaba.

begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('a9500000-0000-4000-8000-0000000000ff','authenticated','authenticated','codigo-owner@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
values
  ('a9500000-0000-4000-8000-000000000001','authenticated','authenticated',null,'',null,'{}','{}',true,now(),now()),
  ('a9500000-0000-4000-8000-000000000002','authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());

-- El guardián de admisión no es lo que se prueba acá.
insert into public.businesses (
  id, name, slug, status, is_active, ordering_enabled, ordering_verified,
  ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
  delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode
) values (
  'b9500000-0000-4000-8000-0000000000a1', 'TABA codigo largo', 'taba-codigo-largo', 'open', true, true, true,
  clock_timestamp(), 'a9500000-0000-4000-8000-0000000000ff', 'ARS', true, false, 0.00, 0.00, 'off');

insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
  variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
  stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
  external_id,sku,catalog_origin,units_per_pack)
values ('c9500000-0000-4000-8000-000000000001','b9500000-0000-4000-8000-0000000000a1','Lata codigo','Gaseosas','Cola',1000,'confirmed',true,'Marca',
  'Lata','Lata',473,'ml','473 ml','lata',
  100,true,true,false,'{}',true,now(),'a9500000-0000-4000-8000-0000000000ff','codigo-sku','codigo-sku','commercial',1);

-- Un pedido de retiro en efectivo por la RPC pública. Devuelve el código.
create function pg_temp.pedir(p_customer uuid, p_key text) returns text language plpgsql as $$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_customer, 'role', 'authenticated')::text, true);
  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', 'b9500000-0000-4000-8000-0000000000a1',
    'client_request_id', p_key,
    'tracking_token', md5(p_key) || md5(p_key || 'codigo'),
    'items', jsonb_build_array(jsonb_build_object('product_id', 'c9500000-0000-4000-8000-000000000001', 'quantity', 1)),
    'customer_name', 'Cliente Codigo',
    'customer_phone', '2996209137',
    'delivery_mode', 'pickup',
    'payment_method', 'cash'));
  return v_result ->> 'code';
end;
$$;

-- ══ 1 · PERMISOS ════════════════════════════════════════════════════════════
select ok(
  not has_function_privilege('authenticated', 'public.next_order_public_code()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.next_order_public_code()', 'EXECUTE'),
  'el generador sigue fuera del alcance de los roles de cliente');

-- ══ 2 · HASTA 9999, LO DE SIEMPRE ═══════════════════════════════════════════
alter sequence public.order_public_code_seq restart with 41;
select is(public.next_order_public_code(), 'LT-0041', 'un numero chico sigue saliendo con cuatro digitos');
select is(public.next_order_public_code(), 'LT-0042', 'y el siguiente, consecutivo');

alter sequence public.order_public_code_seq restart with 9999;
select is(public.next_order_public_code(), 'LT-9999', 'el 9999 es el ultimo de cuatro digitos');

-- ══ 3 · DESDE 10000, CRECE ══════════════════════════════════════════════════
select is(public.next_order_public_code(), 'LT-10000', 'el 10000 ya no se recorta a LT-1000');
select is(public.next_order_public_code(), 'LT-10001', 'el 10001 tampoco: no repite el anterior');

alter sequence public.order_public_code_seq restart with 1234567;
select is(public.next_order_public_code(), 'LT-1234567', 'y sigue creciendo sin tope de digitos');

-- ══ 4 · DOS PEDIDOS POR LA RPC PÚBLICA CON LA SECUENCIA PASADA DE 9999 ══════
alter sequence public.order_public_code_seq restart with 10000;

select is(pg_temp.pedir('a9500000-0000-4000-8000-000000000001', 'codigo-pedido-0001'), 'LT-10000',
  'el primer pedido despues del 9999 es el LT-10000');
select is(pg_temp.pedir('a9500000-0000-4000-8000-000000000002', 'codigo-pedido-0002'), 'LT-10001',
  'y el segundo es el LT-10001');
select is(
  (select last_value from public.order_public_code_seq), 10001::bigint,
  'cada alta gasto un solo valor de secuencia: no hubo que buscar un codigo libre');
select is(
  (select array_agg(code || '=' || public_code order by created_at, code) from public.orders
    where business_id = 'b9500000-0000-4000-8000-0000000000a1'),
  array['LT-10000=LT-10000', 'LT-10001=LT-10001'],
  'los dos pedidos existen, con codigos distintos, y code coincide con public_code');
select is(
  pg_temp.pedir('a9500000-0000-4000-8000-000000000001', 'codigo-pedido-0001'), 'LT-10000',
  'reintentar el primer pedido devuelve su mismo codigo');
select is(
  (select last_value from public.order_public_code_seq), 10001::bigint,
  'y el reintento no gasta secuencia');

-- ══ 5 · EL TRIGGER DE VALORES POR DEFECTO USA EL MISMO GENERADOR ════════════
select set_config('request.jwt.claims', '', true);
select lives_ok($$
insert into public.orders(
  id,business_id,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,customer_phone,payment_method,subtotal,delivery_fee,total,code,public_code)
values ('d9500000-0000-4000-8000-000000000001', 'b9500000-0000-4000-8000-0000000000a1', 'received', 'pickup', 'pickup',
  'codigo-directo-0003', 'CLIENTE_SINTETICO_NO_CACHEAR', '+540000000000', 'cash', 1000, 0, 1000, '', '')
$$, 'un pedido insertado sin codigo no choca con un codigo ya emitido');
select is(
  (select code || '=' || public_code from public.orders where id = 'd9500000-0000-4000-8000-000000000001'),
  'LT-10002=LT-10002', 'un pedido insertado sin codigo recibe el siguiente, tambien de cinco digitos');

select * from finish();
rollback;
