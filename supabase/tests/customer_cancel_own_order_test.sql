-- TABA · EL CLIENTE CANCELA SU PROPIO PEDIDO MIENTRAS EL COMERCIO NO LO TOMÓ
--
-- La regla existía en `change_order_status` pero ninguna puerta llegaba a ella. Acá
-- se prueba `cancel_own_order`, la única RPC de cancelación para el cliente:
--
--   · cancela lo propio mientras está recibido, en efectivo o a coordinar y sin
--     cobro registrado; el stock vuelve una vez y el producto vuelve a la tienda;
--   · deja un evento con actor cliente y no escribe recibos del comercio;
--   · repetir la llamada es un no-op, con la misma clave o con otra;
--   · un pedido ajeno responde EXACTAMENTE igual que uno inexistente;
--   · un pedido ya tomado, cobrado, cerrado o de Mercado Pago se rechaza con 55000
--     y un `detail` estable;
--   · cancelar libera el cupo de pedidos sin atender del guardián de admisión.
--
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table propio_ids (name text primary key, id uuid not null) on commit drop;

do $fixture$
declare
  v_business uuid := 'b9400000-0000-4000-8000-0000000000a1';
  v_cupo uuid := 'b9400000-0000-4000-8000-0000000000a2';
  v_owner uuid := 'a9400000-0000-4000-8000-0000000000ff';
  v_names text[] := array['ultima', 'gondola', 'cupo'];
  v_stock integer[] := array[2, 100, 100];
  i integer;
  v_id uuid;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_owner,'authenticated','authenticated','propio-owner@example.invalid','',now(),'{}','{}',now(),now());
  for i in 1..12 loop
    v_id := ('a9400000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
    values (v_id,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());
    insert into propio_ids values ('c' || i, v_id);
  end loop;

  -- El primero con el guardián de admisión apagado (no es lo que se prueba en la
  -- mayoría de los casos); el segundo con el guardián activo y UN pedido sin
  -- atender por cliente, para probar que cancelar libera el cupo.
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode, max_pending_orders_per_customer
  ) values
    (v_business, 'TABA cancela el cliente', 'taba-cancela-el-cliente', 'open', true, true, true,
     clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off', null),
    (v_cupo, 'TABA cupo del cliente', 'taba-cupo-del-cliente', 'open', true, true, true,
     clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'enforce', 1);
  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_business, v_owner, 'owner', true), (v_cupo, v_owner, 'owner', true);
  insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
  values ('e9400000-0000-4000-8000-0000000000a1', v_owner, v_business, 'owner', 'panel_web');

  for i in 1..array_length(v_names, 1) loop
    v_id := ('c9400000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
      variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
      stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
      external_id,sku,catalog_origin,units_per_pack)
    values (v_id, case when v_names[i] = 'cupo' then v_cupo else v_business end,
      'Lata ' || v_names[i],'Gaseosas','Cola',1000,'confirmed',true,'Marca',
      'Lata','Lata',473,'ml','473 ml','lata',
      v_stock[i],true,true,false,'{}',true,now(),v_owner,'propio-' || v_names[i],'propio-' || v_names[i],'commercial',1);
    insert into propio_ids values (v_names[i], v_id);
  end loop;
  insert into propio_ids values ('business', v_business), ('negocio_cupo', v_cupo), ('owner', v_owner);
end
$fixture$;

create function pg_temp.id(p_name text) returns uuid language sql as $$
  select id from propio_ids where name = p_name;
$$;
create function pg_temp.cliente(p_customer text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(p_customer), 'role', 'authenticated')::text, true)::void;
$$;
create function pg_temp.operador() returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id('owner'), 'role', 'authenticated', 'session_id', 'e9400000-0000-4000-8000-0000000000a1')::text, true)::void;
$$;
create function pg_temp.sin_sesion() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)::void;
$$;
-- Un pedido de retiro por la RPC pública. Devuelve el id, o NULL si no entró.
create function pg_temp.pedir(p_customer text, p_name text, p_quantity integer default 1,
  p_product text default 'gondola', p_payment text default 'cash', p_business text default 'business')
returns uuid language plpgsql as $$
declare
  v_result jsonb;
begin
  perform pg_temp.cliente(p_customer);
  begin
    v_result := public.create_order_with_items(jsonb_build_object(
      'business_id', pg_temp.id(p_business),
      'client_request_id', 'propio-' || p_name,
      'tracking_token', md5(p_name) || md5(p_name || 'propio'),
      'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.id(p_product), 'quantity', p_quantity)),
      'customer_name', 'Cliente Propio',
      'customer_phone', '2996209137',
      'delivery_mode', 'pickup',
      'payment_method', p_payment));
  exception when others then
    return null;
  end;
  insert into propio_ids values ('pedido-' || p_name, (v_result ->> 'id')::uuid);
  return (v_result ->> 'id')::uuid;
end;
$$;
create function pg_temp.pedido(p_name text) returns uuid language sql as $$
  select pg_temp.id('pedido-' || p_name);
$$;
-- La RPC del cliente. Devuelve el cuerpo, o el error con SQLSTATE, mensaje y detalle.
-- Por SQL dinámico: en una base sin la migración la suite marca sus aserciones en
-- rojo en lugar de no compilar.
create function pg_temp.cancelar(p_customer text, p_order uuid, p_key text, p_reason text default null)
returns jsonb language plpgsql as $f$
declare
  v_result jsonb;
  v_detail text;
begin
  if p_customer is null then perform pg_temp.sin_sesion(); else perform pg_temp.cliente(p_customer); end if;
  begin
    execute 'select public.cancel_own_order($1, $2, $3)' into v_result using p_order, p_key, p_reason;
    return jsonb_build_object('ok', true, 'status', v_result ->> 'status', 'no_op', v_result -> 'idempotent_no_op',
      'replay', v_result -> 'idempotent_replay', 'by_customer', v_result -> 'cancelled_by_customer',
      'items', jsonb_array_length(v_result -> 'order_items'));
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return jsonb_build_object('ok', false, 'sqlstate', sqlstate, 'message', sqlerrm, 'detail', v_detail);
  end;
end;
$f$;
create function pg_temp.estado(p_name text) returns text language sql as $$
  select status from public.orders where id = pg_temp.pedido(p_name);
$$;
create function pg_temp.revision(p_name text) returns bigint language sql as $$
  select revision from public.orders where id = pg_temp.pedido(p_name);
$$;
create function pg_temp.eventos(p_name text) returns integer language sql as $$
  select count(*)::integer from public.order_events where order_id = pg_temp.pedido(p_name);
$$;
create function pg_temp.gondola(p_product text) returns text language sql as $$
  select format('%s/%s', stock, available::text) from public.products where id = pg_temp.id(p_product);
$$;

-- ══ 1 · PERMISOS ════════════════════════════════════════════════════════════
select ok(
  to_regprocedure('public.cancel_own_order(uuid, text, text)') is not null
  and has_function_privilege('authenticated', 'public.cancel_own_order(uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.cancel_own_order(uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.cancel_own_order(uuid, text, text)', 'EXECUTE'),
  'la cancelacion del cliente existe y solo la ejecuta un cliente autenticado');

select ok(
  not has_function_privilege('authenticated', 'public.change_order_status(uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.transition_order(uuid, bigint, text)', 'EXECUTE'),
  'las transiciones internas siguen fuera del alcance del cliente');

-- ══ 2 · CANCELA LO SUYO ═════════════════════════════════════════════════════
select pg_temp.pedir('c1', 'ultima', 2, 'ultima');
select is(pg_temp.gondola('ultima') || ' rev ' || pg_temp.revision('ultima'), '0/false rev 3',
  'el cliente se lleva las dos ultimas unidades');

select is(
  pg_temp.cancelar('c1', pg_temp.pedido('ultima'), 'propio-clave-0001', E'me equivoque\nde producto'),
  '{"ok": true, "status": "cancelled", "no_op": false, "replay": false, "by_customer": true, "items": 1}'::jsonb,
  'el cliente cancela su pedido recien hecho');
select is(pg_temp.estado('ultima') || ' rev ' || pg_temp.revision('ultima'), 'cancelled rev 4',
  'el pedido queda cancelado y la revision avanza una sola vez');
select is(pg_temp.gondola('ultima'), '2/true', 'las dos unidades vuelven y el producto vuelve a la tienda');
select ok(
  (select inventory_released_at is not null and cancelled_at is not null from public.orders where id = pg_temp.pedido('ultima')),
  'con la marca de stock devuelto');

select is(
  (select array_agg(e.event_type || ':' || e.actor_role order by e.sequence) from public.order_events e
    where e.order_id = pg_temp.pedido('ultima') and e.event_type <> 'order.received'),
  array['order.status_changed:customer', 'order.cancelled_by_customer:customer'],
  'quedan el cambio de estado y la cancelacion, los dos con actor cliente');
select is(
  (select jsonb_build_object('actor', e.actor_user_id, 'metadata', e.metadata) from public.order_events e
    where e.order_id = pg_temp.pedido('ultima') and e.event_type = 'order.cancelled_by_customer'),
  jsonb_build_object('actor', pg_temp.id('c1'), 'metadata', jsonb_build_object(
    'reason', 'me equivoque de producto', 'previous_status', 'received', 'idempotency_key', 'propio-clave-0001')),
  'el evento guarda quien, el motivo sin caracteres de control y la clave');
select is(
  (select count(*)::integer from public.business_command_receipts r where r.order_id = pg_temp.pedido('ultima')),
  0, 'el cliente no escribe en los recibos de comandos del comercio');

-- ══ 3 · REPETIR ES UN NO-OP ═════════════════════════════════════════════════
select is(
  pg_temp.cancelar('c1', pg_temp.pedido('ultima'), 'propio-clave-0001', 'me equivoque de producto'),
  '{"ok": true, "status": "cancelled", "no_op": true, "replay": true, "by_customer": true, "items": 1}'::jsonb,
  'la misma llamada otra vez devuelve el pedido actual como no-op y se reconoce como repeticion');
select is(
  pg_temp.cancelar('c1', pg_temp.pedido('ultima'), 'propio-clave-0002', 'otro motivo'),
  '{"ok": true, "status": "cancelled", "no_op": true, "replay": false, "by_customer": true, "items": 1}'::jsonb,
  'con otra clave tambien es un no-op');
select is(
  pg_temp.eventos('ultima') || ' eventos, rev ' || pg_temp.revision('ultima') || ', ' || pg_temp.gondola('ultima'),
  '3 eventos, rev 4, 2/true', 'ninguna repeticion agrega eventos, mueve la revision ni devuelve stock de nuevo');

-- ══ 4 · UN PEDIDO AJENO ES UN PEDIDO QUE NO EXISTE ══════════════════════════
select pg_temp.pedir('c2', 'ajeno');
select is(
  pg_temp.cancelar('c3', pg_temp.pedido('ajeno'), 'propio-clave-0003'),
  pg_temp.cancelar('c3', '00000000-0000-4000-8000-00000000dead', 'propio-clave-0003'),
  'otro cliente recibe por un pedido ajeno EXACTAMENTE lo mismo que por un id inventado');
select is(
  pg_temp.cancelar('c3', pg_temp.pedido('ajeno'), 'propio-clave-0003'),
  '{"ok": false, "sqlstate": "P0002", "message": "pedido inexistente", "detail": ""}'::jsonb,
  'y eso es «pedido inexistente»');
select is(pg_temp.estado('ajeno') || ' ' || pg_temp.eventos('ajeno'), 'received 1', 'el pedido ajeno no se toco');

select is(
  (pg_temp.cancelar(null, pg_temp.pedido('ajeno'), 'propio-clave-0004')) ->> 'sqlstate',
  '42501', 'sin sesion no hay cancelacion');

-- El operador del comercio no es el cliente: su puerta es cancel_order.
create function pg_temp.cancelar_como_operador(p_order uuid) returns text language plpgsql as $f$
declare
  v_result jsonb;
begin
  perform pg_temp.operador();
  execute 'select public.cancel_own_order($1, $2, null)' into v_result using p_order, 'propio-clave-0005';
  return v_result ->> 'status';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$f$;
select is(pg_temp.cancelar_como_operador(pg_temp.pedido('ajeno')), 'P0002 pedido inexistente',
  'un operador del comercio tampoco cancela por la puerta del cliente');

-- ══ 5 · ENTRADAS INVÁLIDAS ══════════════════════════════════════════════════
select is(
  (pg_temp.cancelar('c2', pg_temp.pedido('ajeno'), 'corta') ->> 'sqlstate') || ' ' ||
  (pg_temp.cancelar('c2', pg_temp.pedido('ajeno'), 'con espacios 0001') ->> 'sqlstate'),
  '22023 22023', 'la clave de idempotencia tiene el formato de los demas comandos');
select is(
  (pg_temp.cancelar('c2', pg_temp.pedido('ajeno'), 'propio-clave-0006', repeat('x', 301))) ->> 'sqlstate',
  '22023', 'un motivo de mas de 300 caracteres se rechaza');
select is(pg_temp.estado('ajeno'), 'received', 'y nada de eso cancelo el pedido');

-- ══ 6 · LO QUE EL CLIENTE YA NO PUEDE CANCELAR ══════════════════════════════
-- Aceptado por el comercio.
select pg_temp.pedir('c4', 'aceptado');
select pg_temp.operador();
select public.transition_order(pg_temp.pedido('aceptado'), pg_temp.revision('aceptado'), 'accepted', 'propio-acepta-0001');
select is(
  pg_temp.cancelar('c4', pg_temp.pedido('aceptado'), 'propio-clave-0007') - 'message',
  '{"ok": false, "sqlstate": "55000", "detail": "ORDER_ALREADY_TAKEN"}'::jsonb,
  'un pedido que el comercio ya acepto no lo cancela el cliente');
select is(pg_temp.estado('aceptado') || ' ' || pg_temp.gondola('gondola'), 'accepted 98/true',
  'sigue aceptado y con su stock tomado');

-- Con el cobro manual ya confirmado.
select pg_temp.pedir('c5', 'cobrado');
select pg_temp.operador();
select public.confirm_manual_order_payment(pg_temp.pedido('cobrado'), pg_temp.revision('cobrado'), 'cash', 'propio-cobro-0001');
select is(
  pg_temp.cancelar('c5', pg_temp.pedido('cobrado'), 'propio-clave-0008') - 'message',
  '{"ok": false, "sqlstate": "55000", "detail": "MANUAL_PAYMENT_RECORDED"}'::jsonb,
  'un pedido con el cobro registrado tampoco');

-- Rechazado y entregado.
select pg_temp.pedir('c6', 'rechazado');
select pg_temp.operador();
select public.transition_order(pg_temp.pedido('rechazado'), pg_temp.revision('rechazado'), 'rejected', 'propio-rechaza-0001');
select is(
  pg_temp.cancelar('c6', pg_temp.pedido('rechazado'), 'propio-clave-0009') - 'message',
  '{"ok": false, "sqlstate": "55000", "detail": "ORDER_CLOSED"}'::jsonb,
  'un pedido rechazado esta cerrado');

select pg_temp.sin_sesion();
insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,customer_user_id,
  client_request_id,customer_name,customer_phone,payment_method,subtotal,delivery_fee,total)
values
  ('d9400000-0000-4000-8000-000000000001', pg_temp.id('business'), 'PROP-ENT-1', 'PROP-ENT-1', 'delivered', 'pickup', 'pickup', pg_temp.id('c7'),
   'propio-entregado', 'CLIENTE_SINTETICO_NO_CACHEAR', '+540000000000', 'cash', 1000, 0, 1000),
  -- Un pedido de Mercado Pago recién recibido.
  ('d9400000-0000-4000-8000-000000000002', pg_temp.id('business'), 'PROP-MP-1', 'PROP-MP-1', 'received', 'pickup', 'pickup', pg_temp.id('c7'),
   'propio-mercadopago', 'CLIENTE_SINTETICO_NO_CACHEAR', '+540000000000', 'mercadopago', 1000, 0, 1000);
select is(
  pg_temp.cancelar('c7', 'd9400000-0000-4000-8000-000000000001', 'propio-clave-0010') - 'message',
  '{"ok": false, "sqlstate": "55000", "detail": "ORDER_CLOSED"}'::jsonb,
  'un pedido entregado esta cerrado');
select is(
  pg_temp.cancelar('c7', 'd9400000-0000-4000-8000-000000000002', 'propio-clave-0011') - 'message',
  '{"ok": false, "sqlstate": "55000", "detail": "ORDER_PAID_ONLINE"}'::jsonb,
  'un pedido de Mercado Pago necesita el flujo de reembolso');
select is(
  (select status from public.orders where id = 'd9400000-0000-4000-8000-000000000002'), 'received',
  'y sigue recibido');

-- Un pedido en efectivo con un intento de pago atado.
select pg_temp.pedir('c8', 'intento');
select pg_temp.sin_sesion();
insert into public.checkout_sessions(
  id,business_id,customer_id,client_request_id,normalized_intent_hash,fulfillment_type,
  currency,subtotal,total,status,expires_at
) values (
  'f9400000-0000-4000-8000-000000000001', pg_temp.id('business'), pg_temp.id('c8'),
  'propio-checkout-0001', repeat('a', 64), 'pickup', 'ARS', 1000, 1000, 'payment_pending', now() + interval '1 hour');
insert into public.payment_intents(
  id,checkout_session_id,business_id,order_id,environment,external_reference,internal_status,
  currency,expected_amount
) values (
  'f9400000-0000-4000-8000-000000000002', 'f9400000-0000-4000-8000-000000000001', pg_temp.id('business'),
  pg_temp.pedido('intento'), 'test', 'taba2:checkout:f9400000-0000-4000-8000-000000000001', 'pending', 'ARS', 1000);
select is(
  pg_temp.cancelar('c8', pg_temp.pedido('intento'), 'propio-clave-0012') - 'message',
  '{"ok": false, "sqlstate": "55000", "detail": "ORDER_PAID_ONLINE"}'::jsonb,
  'un pedido con un intento de pago tampoco se cancela por aca');

-- ══ 7 · LO QUE SÍ: A COORDINAR, Y CON ACUSE DEL COMERCIO ════════════════════
select pg_temp.pedir('c9', 'coordina', 1, 'gondola', 'coordinate');
select is(
  (pg_temp.cancelar('c9', pg_temp.pedido('coordina'), 'propio-clave-0013')) ->> 'status',
  'cancelled', 'un pedido a coordinar se cancela igual que uno en efectivo');

select pg_temp.pedir('c10', 'acuse');
select pg_temp.operador();
select public.acknowledge_order(pg_temp.pedido('acuse'), pg_temp.revision('acuse'), 'propio-acuse-0001');
select is(
  (pg_temp.cancelar('c10', pg_temp.pedido('acuse'), 'propio-clave-0014')) ->> 'status',
  'cancelled', 'el acuse del comercio no es una aceptacion: el cliente todavia puede cancelar');
select is(
  (select e.metadata ->> 'reason' is null and e.metadata ? 'reason' from public.order_events e
    where e.order_id = pg_temp.pedido('acuse') and e.event_type = 'order.cancelled_by_customer'),
  true, 'sin motivo, el evento lo deja en null');

-- ══ 8 · SI YA LO CANCELÓ EL COMERCIO ════════════════════════════════════════
select pg_temp.pedir('c11', 'del-comercio');
select pg_temp.operador();
select public.cancel_order(pg_temp.pedido('del-comercio'), pg_temp.revision('del-comercio'), 'sin stock real', 'propio-cancel-0001');
create temporary table eventos_antes on commit drop as select pg_temp.eventos('del-comercio') as n;
select is(
  pg_temp.cancelar('c11', pg_temp.pedido('del-comercio'), 'propio-clave-0015'),
  '{"ok": true, "status": "cancelled", "no_op": true, "replay": false, "by_customer": false, "items": 1}'::jsonb,
  'un pedido que ya cancelo el comercio devuelve un no-op y dice que no fue el cliente');
select is(pg_temp.eventos('del-comercio'), (select n from eventos_antes), 'sin agregar eventos');

-- ══ 9 · CANCELAR LIBERA EL CUPO DEL GUARDIÁN DE ADMISIÓN ════════════════════
-- En este negocio el guardián deja UN pedido sin atender por cliente.
select ok(pg_temp.pedir('c12', 'cupo-1', 1, 'cupo', 'cash', 'negocio_cupo') is not null,
  'el primer pedido del cliente entra');
select ok(pg_temp.pedir('c12', 'cupo-2', 1, 'cupo', 'cash', 'negocio_cupo') is null,
  'el segundo lo frena el guardian: ya tiene uno sin atender');
select is(
  (pg_temp.cancelar('c12', pg_temp.pedido('cupo-1'), 'propio-clave-0016')) ->> 'status',
  'cancelled', 'el cliente cancela el primero');
select ok(pg_temp.pedir('c12', 'cupo-3', 1, 'cupo', 'cash', 'negocio_cupo') is not null,
  'y puede volver a pedir');
select is(pg_temp.gondola('cupo'), '99/true', 'con el stock exacto: un pedido abierto, uno devuelto');

-- ══ 10 · EL BALANCE DE LA GÓNDOLA ═══════════════════════════════════════════
-- De los pedidos sobre «gondola» siguen abiertos: ajeno, aceptado, cobrado, intento.
-- rechazado, coordina, acuse y del-comercio devolvieron su unidad.
select is(pg_temp.gondola('gondola'), '96/true', 'cada cancelacion devolvio su unidad exactamente una vez');

select * from finish();
rollback;
