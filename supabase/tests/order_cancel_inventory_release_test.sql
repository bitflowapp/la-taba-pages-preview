-- TABA · CANCELAR UN PEDIDO DEVUELVE EL STOCK Y VUELVE A OFRECER EL PRODUCTO
--
-- Vender la última unidad despublica el producto (`available = false`). Cancelar o
-- rechazar ese pedido devolvía el stock y dejaba el producto fuera de la tienda
-- hasta que un dueño lo republicara a mano. Acá se prueba la devolución única
-- (`private.release_order_inventory`) que ahora usa `change_order_status`:
--
--   · cancelar y rechazar devuelven el stock y vuelven a ofrecer el producto;
--   · lo que el comercio ocultó sigue oculto; lo que no se puede ofrecer (precio
--     pendiente, producto inactivo) no se ofrece;
--   · la devolución ocurre exactamente una vez;
--   · cancelar después del retiro sigue sin devolver stock;
--   · una regla de publicación que no deja republicar no traba la cancelación;
--   · la revisión avanza una sola vez y el evento de estado lo cuenta.
--
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table liberar_ids (name text primary key, id uuid not null) on commit drop;

do $fixture$
declare
  v_business uuid := 'b9100000-0000-4000-8000-0000000000a1';
  v_cp uuid := 'e7850ad2-a447-402c-8375-3fd74e9466ba';
  v_owner uuid := 'a9100000-0000-4000-8000-0000000000ff';
  v_names text[] := array['ultima', 'rechazo', 'oculto', 'precio', 'inactivo', 'muchos', 'retirado', 'repuesto', 'varios'];
  v_stock integer[] := array[2, 1, 2, 2, 2, 50, 5, 1, 2];
  i integer;
  v_id uuid;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_owner,'authenticated','authenticated','liberar-owner@example.invalid','',now(),'{}','{}',now(),now());
  for i in 1..9 loop
    v_id := ('a9100000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
    values (v_id,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());
    insert into liberar_ids values ('c' || i, v_id);
  end loop;

  -- El guardián de admisión no es lo que se prueba acá.
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode
  ) values
    (v_business, 'TABA devolucion de stock', 'taba-devolucion-de-stock', 'open', true, true, true,
     clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off'),
    -- El comercio real: es el único alcanzado por `cp_published_requires_approved_image`.
    (v_cp, 'CP devolucion fixture', 'cp-devolucion-fixture', 'closed', true, false, false,
     null, null, 'ARS', true, false, 0.00, 0.00, 'off');
  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_business, v_owner, 'owner', true), (v_cp, v_owner, 'owner', true);
  insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
  values ('e9100000-0000-4000-8000-0000000000a1', v_owner, v_business, 'owner', 'panel_web'),
         ('e9100000-0000-4000-8000-0000000000a2', v_owner, v_cp, 'owner', 'panel_web');

  for i in 1..array_length(v_names, 1) loop
    v_id := ('c9100000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
      variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
      stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
      external_id,sku,catalog_origin,units_per_pack)
    values (v_id,v_business,'Lata ' || v_names[i],'Gaseosas','Cola',1000,'confirmed',true,'Marca',
      'Lata','Lata',473,'ml','473 ml','lata',
      v_stock[i],true,true,false,'{}',true,now(),v_owner,'liberar-' || v_names[i],'liberar-' || v_names[i],'commercial',1);
    insert into liberar_ids values (v_names[i], v_id);
  end loop;

  -- Producto del comercio real: verificado, SIN foto, vendido hasta agotarse.
  v_id := 'c9100000-0000-4000-8000-0000000000c1';
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_id,v_cp,'Lata sin foto','Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    0,false,true,false,'{}',true,now(),v_owner,'liberar-cp-sin-foto','liberar-cp-sin-foto','commercial',1);
  insert into liberar_ids values ('cp_sin_foto', v_id), ('business', v_business), ('cp', v_cp), ('owner', v_owner);
end
$fixture$;

create function pg_temp.id(p_name text) returns uuid language sql as $$
  select id from liberar_ids where name = p_name;
$$;
create function pg_temp.operador(p_session text default 'e9100000-0000-4000-8000-0000000000a1') returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id('owner'), 'role', 'authenticated', 'session_id', p_session)::text, true)::void;
$$;
-- Un pedido de retiro en efectivo por la RPC pública. Devuelve el id.
create function pg_temp.pedir(p_customer text, p_key text, p_items jsonb) returns uuid language plpgsql as $$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(p_customer), 'role', 'authenticated')::text, true);
  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', pg_temp.id('business'),
    'client_request_id', p_key,
    'tracking_token', md5(p_key) || md5(p_key || 'liberar'),
    'items', p_items,
    'customer_name', 'Cliente Liberar',
    'customer_phone', '2996209137',
    'delivery_mode', 'pickup',
    'payment_method', 'cash'));
  insert into liberar_ids values (p_key, (v_result ->> 'id')::uuid);
  return (v_result ->> 'id')::uuid;
end;
$$;
create function pg_temp.linea(p_product text, p_quantity integer) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('product_id', pg_temp.id(p_product), 'quantity', p_quantity));
$$;
-- stock/available/merchant_available de un producto, en una sola lectura.
create function pg_temp.gondola(p_product text) returns text language sql as $$
  select format('%s/%s/%s', stock, available::text, merchant_available::text) from public.products where id = pg_temp.id(p_product);
$$;
create function pg_temp.revision(p_key text) returns bigint language sql as $$
  select revision from public.orders where id = pg_temp.id(p_key);
$$;
-- El comercio cancela o rechaza por la RPC del Panel.
create function pg_temp.cerrar(p_key text, p_status text) returns text language plpgsql as $$
begin
  perform pg_temp.operador();
  return public.transition_order(pg_temp.id(p_key), pg_temp.revision(p_key), p_status, 'liberar-' || p_status || '-' || right(p_key, 4)) ->> 'status';
end;
$$;

-- La devolucion llamada directo. Va por SQL dinamico para que, en una base sin la
-- migracion, la suite marque sus aserciones en rojo en lugar de no compilar.
create function pg_temp.devolver(p_order uuid) returns integer language plpgsql as $f$
declare
  v_touched integer;
begin
  execute 'select private.release_order_inventory($1)' into v_touched using p_order;
  return v_touched;
exception
  when undefined_function then return null;
end;
$f$;

-- ══ 1 · PRIVILEGIOS ═════════════════════════════════════════════════════════
select ok(
  to_regprocedure('private.release_order_inventory(uuid)') is not null
  and not has_function_privilege('anon', 'private.release_order_inventory(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.release_order_inventory(uuid)', 'EXECUTE'),
  'la devolucion de stock existe y no es ejecutable por roles de cliente');

select ok(
  not has_function_privilege('anon', 'public.change_order_status(uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.change_order_status(uuid, text, text)', 'EXECUTE'),
  'change_order_status sigue fuera del alcance de los roles de cliente');

-- ══ 2 · CANCELAR VUELVE A OFRECER LA ÚLTIMA UNIDAD ══════════════════════════
select lives_ok($$select pg_temp.pedir('c1', 'liberar-ultima-0001', pg_temp.linea('ultima', 2))$$,
  'un cliente se lleva las dos ultimas unidades en efectivo');
select is(pg_temp.gondola('ultima'), '0/false/true', 'el alta deja el producto sin stock y despublicado');

-- Lo que ve un cliente en la tienda, con RLS. El id va literal: con el rol del
-- cliente no se lee la tabla temporal del fixture.
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('c9'), 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::integer from public.products where id = 'c9100000-0000-4000-8000-000000000001'), 0,
  'la tienda ya no lo muestra');
reset role;

select is(pg_temp.revision('liberar-ultima-0001'), 3::bigint, 'el pedido de retiro nace en revision 3');
select pg_temp.operador();
select is(
  public.cancel_order(pg_temp.id('liberar-ultima-0001'), 3, 'cliente no retira', 'liberar-cancel-0001') ->> 'status',
  'cancelled', 'el comercio cancela el pedido');
select is(pg_temp.gondola('ultima'), '2/true/true',
  'cancelar devuelve las dos unidades Y vuelve a ofrecer el producto');

select set_config('request.jwt.claims', json_build_object('sub', pg_temp.id('c9'), 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::integer from public.products where id = 'c9100000-0000-4000-8000-000000000001'), 1,
  'y la tienda lo vuelve a mostrar sin que nadie lo republique a mano');
reset role;

select is(pg_temp.revision('liberar-ultima-0001'), 4::bigint,
  'la cancelacion avanza la revision una sola vez');
select ok(
  (select inventory_released_at is not null and cancelled_at is not null from public.orders where id = pg_temp.id('liberar-ultima-0001')),
  'el pedido queda marcado con el stock devuelto');
select is(
  (select array_agg(metadata ->> 'inventory_released' order by sequence) from public.order_events
    where order_id = pg_temp.id('liberar-ultima-0001') and event_type = 'order.status_changed'),
  array['true'], 'un solo evento de estado, y dice que el stock se devolvio');

-- ══ 3 · RECHAZAR TAMBIÉN ════════════════════════════════════════════════════
select pg_temp.pedir('c2', 'liberar-rechazo-0002', pg_temp.linea('rechazo', 1));
select is(pg_temp.gondola('rechazo'), '0/false/true', 'otra ultima unidad vendida');
select is(pg_temp.cerrar('liberar-rechazo-0002', 'rejected'), 'rejected', 'el comercio rechaza el pedido');
select is(pg_temp.gondola('rechazo'), '1/true/true', 'rechazar tambien devuelve y vuelve a ofrecer');

-- Lo que importa de verdad: la unidad devuelta se puede volver a vender.
select lives_ok($$select pg_temp.pedir('c9', 'liberar-recompra-0002', pg_temp.linea('rechazo', 1))$$,
  'otro cliente puede pedir la unidad que volvio');
select is(pg_temp.gondola('rechazo'), '0/false/true', 'y se la lleva');

-- ══ 4 · LA DEVOLUCIÓN NO DECIDE POR EL COMERCIO ═════════════════════════════
select pg_temp.pedir('c3', 'liberar-oculto-0003', pg_temp.linea('oculto', 2));
update public.products set merchant_available = false where id = pg_temp.id('oculto');
select pg_temp.cerrar('liberar-oculto-0003', 'cancelled');
select is(pg_temp.gondola('oculto'), '2/false/false',
  'un producto que el comercio oculto recupera el stock y sigue oculto');

select pg_temp.pedir('c4', 'liberar-precio-0004', pg_temp.linea('precio', 2));
update public.products set price_status = 'pending' where id = pg_temp.id('precio');
select pg_temp.cerrar('liberar-precio-0004', 'rejected');
select is(pg_temp.gondola('precio'), '2/false/true',
  'un producto con el precio pendiente recupera el stock y no se ofrece');

select pg_temp.pedir('c5', 'liberar-inactivo-0005', pg_temp.linea('inactivo', 2));
update public.products set is_active = false where id = pg_temp.id('inactivo');
select pg_temp.cerrar('liberar-inactivo-0005', 'cancelled');
select is(pg_temp.gondola('inactivo'), '2/false/true',
  'un producto dado de baja recupera el stock y no se ofrece');

-- ══ 5 · LO QUE SEGUÍA PUBLICADO SIGUE PUBLICADO ═════════════════════════════
select pg_temp.pedir('c6', 'liberar-muchos-0006', pg_temp.linea('muchos', 3));
select is(pg_temp.gondola('muchos'), '47/true/true', 'un pedido chico no despublica un producto con stock');
select pg_temp.cerrar('liberar-muchos-0006', 'cancelled');
select is(pg_temp.gondola('muchos'), '50/true/true', 'y cancelarlo devuelve exactamente lo que se llevo');

-- El comercio repuso y republicó mientras el pedido seguía abierto.
select pg_temp.pedir('c7', 'liberar-repuesto-0007', pg_temp.linea('repuesto', 1));
update public.products set stock = 5, available = true where id = pg_temp.id('repuesto');
select pg_temp.cerrar('liberar-repuesto-0007', 'cancelled');
select is(pg_temp.gondola('repuesto'), '6/true/true',
  'si el comercio ya habia repuesto, la devolucion suma y no despublica');

-- ══ 6 · VARIOS PRODUCTOS, UNA SOLA VEZ ══════════════════════════════════════
select pg_temp.pedir('c8', 'liberar-varios-0008', jsonb_build_array(
  jsonb_build_object('product_id', pg_temp.id('varios'), 'quantity', 2),
  jsonb_build_object('product_id', pg_temp.id('muchos'), 'quantity', 10)));
select is(pg_temp.gondola('varios') || ' ' || pg_temp.gondola('muchos'), '0/false/true 40/true/true',
  'un pedido de dos productos agota uno y descuenta el otro');
select pg_temp.cerrar('liberar-varios-0008', 'cancelled');
select is(pg_temp.gondola('varios') || ' ' || pg_temp.gondola('muchos'), '2/true/true 50/true/true',
  'cancelarlo devuelve los dos');

select pg_temp.operador();
select is(
  public.transition_order(pg_temp.id('liberar-varios-0008'), pg_temp.revision('liberar-varios-0008'), 'cancelled', 'liberar-otra-vez-0008')
    ->> 'idempotent_no_op',
  'true', 'cancelar un pedido cancelado es un no-op');
select is(pg_temp.gondola('varios') || ' ' || pg_temp.gondola('muchos'), '2/true/true 50/true/true',
  'y no devuelve el stock por segunda vez');

select is(pg_temp.devolver(pg_temp.id('liberar-varios-0008')), 0,
  'la devolucion llamada sobre un pedido ya devuelto no toca ningun producto');
select is(pg_temp.gondola('varios') || ' ' || pg_temp.gondola('muchos'), '2/true/true 50/true/true',
  'el stock queda exactamente igual');

select throws_ok(
  $$select private.release_order_inventory('00000000-0000-4000-8000-00000000dead')$$,
  'P0002', 'pedido inexistente', 'un pedido que no existe no devuelve nada');

-- ══ 7 · DESPUÉS DEL RETIRO NO VUELVE STOCK ══════════════════════════════════
-- La mercadería salió del local: cancelar el estado no la trae de vuelta.
insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,customer_neighborhood,customer_street_address,
  customer_phone,payment_method,subtotal,delivery_fee,total,
  delivery_latitude,delivery_longitude,delivery_location_source,delivery_location_confirmed_at)
values ('d9100000-0000-4000-8000-000000000001', pg_temp.id('business'), 'LIB-RET-1', 'LIB-RET-1', 'picked_up', 'delivery', 'delivery',
  'liberar-retirado-0009', 'CLIENTE_SINTETICO_NO_CACHEAR', 'Centro', 'Mendoza 1',
  '+540000000000', 'cash', 3000, 0, 3000,
  -38.951600, -68.059100, 'map_pin', clock_timestamp());
insert into public.order_items(order_id, product_id, product_uuid, name, quantity, unit_price, subtotal)
values ('d9100000-0000-4000-8000-000000000001', pg_temp.id('retirado')::text, pg_temp.id('retirado'), 'Lata retirado', 3, 1000, 3000);
update public.products set stock = 2 where id = pg_temp.id('retirado');
insert into liberar_ids values ('liberar-retirado-0009', 'd9100000-0000-4000-8000-000000000001');

select is(pg_temp.cerrar('liberar-retirado-0009', 'cancelled'), 'cancelled',
  'el comercio puede cancelar un pedido ya retirado');
select is(pg_temp.gondola('retirado'), '2/true/true', 'pero ese stock no vuelve solo');
select ok(
  (select inventory_released_at is null from public.orders where id = pg_temp.id('liberar-retirado-0009')),
  'y el pedido no queda marcado como devuelto');

-- ══ 8 · UNA REGLA DE PUBLICACIÓN NO TRABA LA CANCELACIÓN ════════════════════
-- En el comercio real un producto sin foto aprobada no se puede publicar
-- (`cp_published_requires_approved_image`). Si la devolución intentara
-- publicarlo, el CHECK abortaría la cancelación entera.
insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,customer_phone,payment_method,subtotal,delivery_fee,total)
values ('d9100000-0000-4000-8000-000000000002', pg_temp.id('cp'), 'LIB-CP-1', 'LIB-CP-1', 'received', 'pickup', 'pickup',
  'liberar-cp-0010', 'CLIENTE_SINTETICO_NO_CACHEAR', '+540000000000', 'cash', 3000, 0, 3000);
insert into public.order_items(order_id, product_id, product_uuid, name, quantity, unit_price, subtotal)
values ('d9100000-0000-4000-8000-000000000002', pg_temp.id('cp_sin_foto')::text, pg_temp.id('cp_sin_foto'), 'Lata sin foto', 3, 1000, 3000);

select pg_temp.operador('e9100000-0000-4000-8000-0000000000a2');
select is(
  public.cancel_order('d9100000-0000-4000-8000-000000000002',
    (select revision from public.orders where id = 'd9100000-0000-4000-8000-000000000002'),
    'pedido de prueba', 'liberar-cancel-cp-0010') ->> 'status',
  'cancelled', 'la cancelacion sale aunque el producto no se pueda republicar');
select is(pg_temp.gondola('cp_sin_foto'), '3/false/true',
  'el stock vuelve y el producto queda sin publicar, como manda su regla');

select * from finish();
rollback;
