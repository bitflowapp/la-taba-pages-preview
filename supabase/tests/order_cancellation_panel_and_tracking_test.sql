-- TABA · CADA PUERTA DE CANCELACIÓN, VISTA DESDE EL PANEL Y DESDE EL SEGUIMIENTO DEL CLIENTE
--
-- El estado del pedido, el stock y los eventos de cada cancelación ya tienen su
-- prueba (cancel_order_idempotent, order_cancel_inventory_release,
-- customer_cancel_own_order, unattended_order_expiry). Lo que estaba «sin prueba del
-- caso» era qué ven, después de cada puerta, las dos personas que miran:
--
--   · el Panel, que lee `orders` por tabla bajo RLS con el rol del equipo, y cuenta
--     los cerrados del día con `get_business_finished_today`;
--   · el cliente, que sigue su pedido con `get_public_order_tracking` y su token.
--
-- Cinco pedidos de un mismo comercio, uno por puerta:
--   1  el cliente cancela el suyo (`cancel_own_order`)
--   2  el comercio lo cancela con motivo (`cancel_order`)
--   3  el comercio lo rechaza (`transition_order` a `rejected`)
--   4  vence sin atender (`expire_unattended_manual_orders`)
--   5  cobrado en efectivo: no se cancela hasta registrar la devolución
--      (`reverse_manual_order_payment`), y recién ahí sí
--
-- La base del gate no está vacía: cada valor único lleva el nombre de este archivo y
-- ningún conteo mira una tabla entera.
-- No depende de la hora: la ventana terminal del seguimiento se mueve en la fila, el
-- vencimiento se provoca envejeciendo el pedido, y la fecha de cierre de los cinco se
-- lleva al comienzo de la transacción antes de contar «los cerrados de hoy».
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table persona (n text primary key, id uuid not null) on commit drop;
create temporary table pedido (n text primary key, id uuid not null, token text not null) on commit drop;
create temporary table dato (k text primary key, v jsonb) on commit drop;

create function pg_temp.guardar(p_k text, p_v jsonb) returns void language sql as $$
  insert into dato values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function pg_temp.d(p_k text) returns jsonb language sql stable as $$ select v from dato where k = p_k $$;
create function pg_temp.usuario(p_n text, p_anonimo boolean default false) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values (v_id,'authenticated','authenticated',
    case when p_anonimo then null else 'order_cancellation_panel_and_tracking_test-' || p_n || '-' || replace(v_id::text,'-','') || '@example.invalid' end,
    '', case when p_anonimo then null else now() end, '{}','{}', p_anonimo, now(), now());
  insert into persona values (p_n, v_id);
  return v_id;
end $$;
create function pg_temp.p(p_n text) returns uuid language sql stable as $$ select id from persona where n = p_n $$;

create temporary table comercio (id uuid, ajeno uuid, product_id uuid) on commit drop;
do $fixture$
declare
  v_business uuid := gen_random_uuid();
  v_ajeno uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_owner uuid := pg_temp.usuario('owner');
  v_staff uuid := pg_temp.usuario('staff');
  v_otro uuid := pg_temp.usuario('owner-ajeno');
  n integer;
begin
  for n in 1..5 loop perform pg_temp.usuario('cliente-' || n, true); end loop;
  -- El guardián de admisión se apaga: acá no es lo que se prueba. El vencimiento sí:
  -- el comercio cargó treinta minutos.
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode,
    abandoned_order_minutes, operating_timezone
  ) values
    (v_business, 'TABA puertas de cancelacion', 'order-cancellation-panel-and-tracking-test-' || right(replace(v_business::text,'-',''), 8),
     'open', true, true, true, clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off', 30, 'America/Argentina/Buenos_Aires'),
    (v_ajeno, 'TABA puertas de cancelacion (ajeno)', 'order-cancellation-panel-and-tracking-test-ajeno-' || right(replace(v_ajeno::text,'-',''), 8),
     'open', true, true, true, clock_timestamp(), v_otro, 'ARS', true, false, 0.00, 0.00, 'off', null, 'America/Argentina/Buenos_Aires');
  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_business, v_owner, 'owner', true), (v_business, v_staff, 'staff', true), (v_ajeno, v_otro, 'owner', true);
  insert into public.identity_sessions(session_id, user_id, business_id, role_at_login, client)
  values (v_owner, v_owner, v_business, 'owner', 'panel_web'), (v_staff, v_staff, v_business, 'staff', 'panel_web'),
         (v_otro, v_otro, v_ajeno, 'owner', 'panel_web');
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_product,v_business,'Lata puertas','Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    20,true,true,false,'{}',true,now(),v_owner,
    'order_cancellation_panel_and_tracking_test-lata','order_cancellation_panel_and_tracking_test-lata','commercial',1);
  insert into comercio values (v_business, v_ajeno, v_product);
end
$fixture$;

-- Una persona del equipo lleva su sesión registrada en el token; un cliente, no.
create function pg_temp.como(p_n text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_n like 'cliente-%'
      then json_build_object('sub', pg_temp.p(p_n), 'role', 'authenticated')
      else json_build_object('sub', pg_temp.p(p_n), 'role', 'authenticated', 'session_id', pg_temp.p(p_n)) end::text, true)::void;
$$;
create function pg_temp.sin_identidad() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)::void;
$$;
-- Un pedido de retiro en efectivo de dos unidades, por la RPC pública, con su token de seguimiento.
create function pg_temp.pedir(p_n text, p_cliente text) returns void language plpgsql as $$
declare
  v_token text := encode(digest('order_cancellation_panel_and_tracking_test-token-' || p_n, 'sha256'), 'hex');
  v_result jsonb;
begin
  perform pg_temp.como(p_cliente);
  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', (select id from comercio),
    'client_request_id', 'ocpt-' || p_n || '-0001',
    'tracking_token', v_token,
    'items', jsonb_build_array(jsonb_build_object('product_id', (select product_id from comercio), 'quantity', 2)),
    'customer_name', 'Zulma Cliente',
    'customer_phone', '2996209137',
    'delivery_mode', 'pickup',
    'payment_method', 'cash'));
  perform pg_temp.sin_identidad();
  insert into pedido values (p_n, (v_result ->> 'id')::uuid, v_token);
end $$;
create function pg_temp.o(p_n text) returns public.orders language sql stable as $$
  select o from public.orders o where o.id = (select id from pedido where n = p_n)
$$;
create function pg_temp.stock() returns integer language sql stable as $$
  select p.stock from public.products p where p.id = (select product_id from comercio)
$$;
-- Lo que ejecuta una puerta como esa persona (NULL = el servicio): la respuesta, o
-- {"error": sqlstate, "message": ...}.
create function pg_temp.puerta(p_actor text, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  begin
    if p_actor is null then perform pg_temp.sin_identidad(); else perform pg_temp.como(p_actor); end if;
    execute p_sql into v;
  exception when others then
    v := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  perform pg_temp.sin_identidad();
  return v;
end $$;
-- EL PANEL: la fila del pedido como la lee esa persona, con el rol `authenticated`
-- y las políticas de RLS (el Panel no pasa por una RPC para listar pedidos):
-- estado / tiene fecha de cierre / el stock ya volvió.
create function pg_temp.panel(p_actor text, p_n text) returns text language plpgsql as $$
declare v text; v_id uuid := (select id from pedido where n = p_n);
begin
  perform pg_temp.como(p_actor);
  set local role authenticated;
  select o.status || '/' || (coalesce(o.cancelled_at, o.canceled_at, o.rejected_at) is not null) || '/' || (o.inventory_released_at is not null)
    into v from public.orders o where o.id = v_id;
  reset role;
  perform pg_temp.sin_identidad();
  return coalesce(v, 'no lo ve');
end $$;
-- EL CLIENTE: su seguimiento, con el rol `anon` y el token en el encabezado.
create function pg_temp.seguimiento(p_n text, p_token text default null) returns jsonb language plpgsql as $$
declare
  v jsonb;
  v_code text := (pg_temp.o(p_n)).public_code;
  v_token text := coalesce(p_token, (select token from pedido where n = p_n));
begin
  perform set_config('request.headers', json_build_object('x-order-token', v_token)::text, true);
  set local role anon;
  v := public.get_public_order_tracking(v_code);
  reset role;
  perform set_config('request.headers', '', true);
  return v;
end $$;
-- Lo que el seguimiento dice de un pedido cerrado: estado / trae la fecha del cierre /
-- dice hasta cuándo se ve, y son treinta minutos / no figura entregado / cuántas
-- claves trae de las que no debe (hora estimada, posición, datos del cliente, del
-- pago o el motivo).
create function pg_temp.cerrado(p_n text) returns text language sql as $$
  select coalesce(
    (s ->> 'status') || '/' || (coalesce(s ->> 'cancelled_at', s ->> 'rejected_at') is not null)
      || '/' || coalesce(((s ->> 'terminal_visible_until')::timestamptz
                  between clock_timestamp() + interval '25 minutes' and clock_timestamp() + interval '30 minutes')::text, 'sin-ventana')
      || '/' || (s ->> 'is_delivered') || '/'
      || (select count(*) from jsonb_object_keys(s) k
           where k in ('estimated_arrival_at', 'estimated_minutes', 'rider_location', 'customer_name', 'customer_phone', 'total',
                       'payment_method', 'reason', 'cancel_reason', 'manual_payment_status')),
    'vacio')
    from (select pg_temp.seguimiento(p_n) as s) x
$$;
-- Vencida la ventana terminal de ese pedido, lo que contesta el seguimiento.
create function pg_temp.despues_de_la_ventana(p_n text) returns text language plpgsql as $$
begin
  update public.order_public_tokens set terminal_visible_until = clock_timestamp() - interval '1 second'
   where order_id = (select id from pedido where n = p_n);
  return coalesce(pg_temp.seguimiento(p_n)::text, 'vacio');
end $$;

select pg_temp.pedir('cliente', 'cliente-1');
select pg_temp.pedir('comercio', 'cliente-2');
select pg_temp.pedir('rechazo', 'cliente-3');
select pg_temp.pedir('vencido', 'cliente-4');
select pg_temp.pedir('cobrado', 'cliente-5');

-- ══════════════════════════════════════════════════════════════════════════
--  0 · ANTES: CINCO PEDIDOS VIVOS
-- ══════════════════════════════════════════════════════════════════════════
select is(pg_temp.stock(), 10, '0: cinco pedidos de dos unidades: stock 20 - 10');
select is(
  (select string_agg(pg_temp.panel('owner', n), ' ' order by n) from pedido),
  'received/false/false received/false/false received/false/false received/false/false received/false/false',
  '0: el Panel ve los cinco recibidos');
select is(
  (pg_temp.seguimiento('cliente') ->> 'status') || '/' || coalesce(pg_temp.seguimiento('cliente') ->> 'terminal_visible_until', 'sin-ventana'),
  'received/sin-ventana', '0: y el cliente ve el suyo, sin ventana terminal');
select is(pg_temp.seguimiento('cliente', (select token from pedido where n = 'comercio')), null,
  '0: con el token de OTRO pedido el seguimiento no contesta nada');
select is(pg_temp.panel('owner-ajeno', 'cliente'), 'no lo ve', '0: el dueno de otro comercio no ve el pedido');

-- ══════════════════════════════════════════════════════════════════════════
--  1 · EL CLIENTE CANCELA EL SUYO
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.guardar('cliente', pg_temp.puerta('cliente-1',
  format($$select public.cancel_own_order(%L, 'ocpt-cliente-cancela-0001', 'me arrepenti de la compra')$$, (pg_temp.o('cliente')).id)));
select is(pg_temp.d('cliente') ->> 'status' || '/' || (pg_temp.d('cliente') ->> 'cancelled_by_customer'), 'cancelled/true',
  '1: el cliente cancela su pedido');
select is(pg_temp.panel('owner', 'cliente') || ' ' || pg_temp.panel('staff', 'cliente'), 'cancelled/true/true cancelled/true/true',
  '1: el Panel lo ve cancelado, con su fecha y con el stock devuelto, para el dueno y para el empleado');
select is(pg_temp.cerrado('cliente'), 'cancelled/true/true/false/0',
  '1: el seguimiento muestra el pedido cancelado, dice hasta cuando se ve (30 min) y nada mas');
select is(position('me arrepenti' in pg_temp.seguimiento('cliente')::text), 0, '1: el motivo no viaja en el seguimiento');
select is(pg_temp.stock(), 12, '1: las dos unidades volvieron');
select is(pg_temp.despues_de_la_ventana('cliente'), 'vacio', '1: vencida la ventana terminal el seguimiento contesta vacio');
select is(pg_temp.panel('owner', 'cliente'), 'cancelled/true/true', '1: el Panel lo sigue viendo: la ventana es del cliente, no del comercio');

-- ══════════════════════════════════════════════════════════════════════════
--  2 · EL COMERCIO LO CANCELA CON MOTIVO
-- ══════════════════════════════════════════════════════════════════════════
-- Cancela el dueño: cancelar pide el permiso orders.cancel del catálogo, que el dueño y el
-- encargado tienen y el empleado no (20261002050000).
select pg_temp.guardar('comercio', pg_temp.puerta('owner',
  format($$select public.cancel_order(%L, %s, 'se rompio la heladera', 'ocpt-comercio-cancela-0001')$$, (pg_temp.o('comercio')).id, (pg_temp.o('comercio')).revision)));
select is(pg_temp.d('comercio') ->> 'idempotent_no_op' || '/' || public.normalize_order_status_vocabulary((pg_temp.o('comercio')).status), 'false/cancelled',
  '2: el dueño del comercio cancela el pedido con motivo');
select is(public.normalize_order_status_vocabulary(split_part(pg_temp.panel('owner', 'comercio'), '/', 1)) || '/'
    || split_part(pg_temp.panel('owner', 'comercio'), '/', 2) || '/' || split_part(pg_temp.panel('owner', 'comercio'), '/', 3),
  'cancelled/true/true', '2: el Panel lo ve cancelado, con su fecha y con el stock devuelto');
select is(
  public.normalize_order_status_vocabulary(split_part(pg_temp.cerrado('comercio'), '/', 1)) || substr(pg_temp.cerrado('comercio'), position('/' in pg_temp.cerrado('comercio'))),
  'cancelled/true/true/false/0', '2: el seguimiento muestra el pedido cancelado, con su ventana de 30 minutos');
select is(position('heladera' in pg_temp.seguimiento('comercio')::text), 0, '2: el motivo que escribio el comercio no viaja en el seguimiento');
select is(pg_temp.stock(), 14, '2: las dos unidades volvieron');
select is(pg_temp.despues_de_la_ventana('comercio'), 'vacio', '2: vencida la ventana terminal el seguimiento contesta vacio');

-- ══════════════════════════════════════════════════════════════════════════
--  3 · EL COMERCIO LO RECHAZA
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.guardar('rechazo', pg_temp.puerta('owner',
  format($$select public.transition_order(%L, %s, 'rejected', 'ocpt-comercio-rechaza-0001')$$, (pg_temp.o('rechazo')).id, (pg_temp.o('rechazo')).revision)));
select is(pg_temp.d('rechazo') ->> 'status', 'rejected', '3: el comercio rechaza el pedido recien recibido');
select is(pg_temp.panel('owner', 'rechazo'), 'rejected/true/true', '3: el Panel lo ve rechazado, con su fecha y con el stock devuelto');
select is(pg_temp.cerrado('rechazo'), 'rejected/true/true/false/0', '3: el seguimiento muestra el pedido rechazado, con su ventana de 30 minutos');
select is(pg_temp.stock(), 16, '3: las dos unidades volvieron');
select is(pg_temp.despues_de_la_ventana('rechazo'), 'vacio', '3: vencida la ventana terminal el seguimiento contesta vacio');

-- ══════════════════════════════════════════════════════════════════════════
--  4 · VENCE SIN ATENDER
-- ══════════════════════════════════════════════════════════════════════════
update public.orders set created_at = clock_timestamp() - interval '31 minutes' where id = (pg_temp.o('vencido')).id;
-- El barrido toma de a cien, los mas viejos primero, y la base del gate trae los
-- suyos: se repite hasta que no queda ninguno por vencer.
do $$
declare n integer := 0;
begin
  loop
    exit when public.expire_unattended_manual_orders(100) = 0 or n >= 40;
    n := n + 1;
  end loop;
end $$;
select is(public.normalize_order_status_vocabulary((pg_temp.o('vencido')).status) || '/' || (pg_temp.o('cobrado')).status, 'cancelled/received',
  '4: el pedido que nadie atendio en treinta minutos vence; el que todavia no los cumplio, no');
select is(pg_temp.panel('owner', 'vencido'), 'cancelled/true/true', '4: el Panel lo ve cancelado, con su fecha y con el stock devuelto');
select is(pg_temp.cerrado('vencido'), 'cancelled/true/true/false/0', '4: el seguimiento muestra el pedido cancelado, con su ventana de 30 minutos');
select is(
  (select count(*)::integer from public.order_events e where e.order_id = (pg_temp.o('vencido')).id and e.event_type = 'order.expired_unattended'),
  1, '4: con su evento de vencimiento, uno');
select is(position('unattended' in pg_temp.seguimiento('vencido')::text), 0, '4: que tampoco viaja en el seguimiento');
select is(pg_temp.stock(), 18, '4: las dos unidades volvieron');
select is(pg_temp.despues_de_la_ventana('vencido'), 'vacio', '4: vencida la ventana terminal el seguimiento contesta vacio');

-- ══════════════════════════════════════════════════════════════════════════
--  5 · COBRADO EN EFECTIVO: PRIMERO LA DEVOLUCIÓN, DESPUÉS LA CANCELACIÓN
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.guardar('cobrado.cobro', pg_temp.puerta('staff',
  format($$select public.confirm_manual_order_payment(%L, %s, 'cash', 'ocpt-cobrado-cobro-0001')$$, (pg_temp.o('cobrado')).id, (pg_temp.o('cobrado')).revision)));
select is(pg_temp.d('cobrado.cobro') ->> 'manual_payment_status', 'confirmed', '5: control, el comercio registra el cobro en efectivo');
select pg_temp.guardar('cobrado.cancelar_1', pg_temp.puerta('owner',
  format($$select public.cancel_order(%L, %s, 'el cliente no vino', 'ocpt-cobrado-cancela-0001')$$, (pg_temp.o('cobrado')).id, (pg_temp.o('cobrado')).revision)));
select is(pg_temp.d('cobrado.cancelar_1') ->> 'error', '55000', '5: con el cobro registrado el pedido no se cancela');
select pg_temp.guardar('cobrado.cliente', pg_temp.puerta('cliente-5',
  format($$select public.cancel_own_order(%L, 'ocpt-cobrado-cliente-0001', 'me arrepenti')$$, (pg_temp.o('cobrado')).id)));
select is(pg_temp.d('cobrado.cliente') ->> 'error', '55000', '5: tampoco lo cancela el cliente');
select is(
  pg_temp.panel('owner', 'cobrado') || ' ' || (pg_temp.seguimiento('cobrado') ->> 'status') || ' ' || pg_temp.stock(),
  'received/false/false received 18', '5: el Panel y el seguimiento lo siguen mostrando recibido, y el stock no se movio');
select pg_temp.guardar('cobrado.devolucion_staff', pg_temp.puerta('staff',
  format($$select public.reverse_manual_order_payment(%L, %s, 'se devolvio el efectivo', 'ocpt-cobrado-devuelve-0001')$$, (pg_temp.o('cobrado')).id, (pg_temp.o('cobrado')).revision)));
select is(pg_temp.d('cobrado.devolucion_staff') ->> 'error', '42501', '5: registrar la devolucion es del dueno o del encargado: un empleado no');
select pg_temp.guardar('cobrado.devolucion', pg_temp.puerta('owner',
  format($$select public.reverse_manual_order_payment(%L, %s, 'se devolvio el efectivo', 'ocpt-cobrado-devuelve-0002')$$, (pg_temp.o('cobrado')).id, (pg_temp.o('cobrado')).revision)));
select is(pg_temp.d('cobrado.devolucion') ->> 'manual_payment_status', 'reversed', '5: el dueno registra la devolucion');
select is(pg_temp.stock() || ' ' || (pg_temp.o('cobrado')).status, '18 received', '5: registrar la devolucion no cancela el pedido ni devuelve stock');
select pg_temp.guardar('cobrado.cancelar_2', pg_temp.puerta('owner',
  format($$select public.cancel_order(%L, %s, 'el cliente no vino', 'ocpt-cobrado-cancela-0002')$$, (pg_temp.o('cobrado')).id, (pg_temp.o('cobrado')).revision)));
select is(pg_temp.d('cobrado.cancelar_2') ->> 'idempotent_no_op' || '/' || public.normalize_order_status_vocabulary((pg_temp.o('cobrado')).status), 'false/cancelled',
  '5: con la devolucion registrada, ahora si se cancela');
select is(public.normalize_order_status_vocabulary(split_part(pg_temp.panel('owner', 'cobrado'), '/', 1)) || '/'
    || split_part(pg_temp.panel('owner', 'cobrado'), '/', 2) || '/' || split_part(pg_temp.panel('owner', 'cobrado'), '/', 3),
  'cancelled/true/true', '5: el Panel lo ve cancelado, con su fecha y con el stock devuelto');
select is(
  public.normalize_order_status_vocabulary(split_part(pg_temp.cerrado('cobrado'), '/', 1)) || substr(pg_temp.cerrado('cobrado'), position('/' in pg_temp.cerrado('cobrado'))),
  'cancelled/true/true/false/0', '5: el seguimiento muestra el pedido cancelado, con su ventana, y no dice nada del cobro ni de la devolucion');
select is(pg_temp.despues_de_la_ventana('cobrado'), 'vacio', '5: vencida la ventana terminal el seguimiento contesta vacio');

-- ══════════════════════════════════════════════════════════════════════════
--  6 · EL BALANCE: UNA VEZ CADA UNO
-- ══════════════════════════════════════════════════════════════════════════
select is(pg_temp.stock(), 20, '6: cinco cancelaciones por cinco puertas: el stock vuelve exacto a 20, cada unidad una vez');
select is(
  (select count(*)::integer from public.orders o
    where o.business_id = (select id from comercio)
      and public.normalize_order_status_vocabulary(o.status) not in ('cancelled', 'rejected')),
  0, '6: al comercio no le queda ningun pedido vivo: la bandeja de activos queda vacia');
-- «Hoy» sale del comienzo de la transacción y la fecha de cierre, del reloj: si la
-- prueba cruzara la medianoche del comercio no coincidirían. Se igualan a mano.
update public.orders set cancelled_at = case when cancelled_at is not null then now() end,
       canceled_at = case when canceled_at is not null then now() end,
       rejected_at = case when rejected_at is not null then now() end
 where business_id = (select id from comercio);
select pg_temp.guardar('hoy', pg_temp.puerta('staff',
  format($$select public.get_business_finished_today(%L, null)$$, (select id from comercio))));
select is(pg_temp.d('hoy') ->> 'cancelled' || '/' || (pg_temp.d('hoy') ->> 'delivered'), '5/0',
  '6: y los cinco suman en los cerrados de hoy del Panel: cancelados y rechazados, ninguno entregado');
select is(
  pg_temp.puerta('owner-ajeno', format($$select public.get_business_finished_today(%L, null)$$, (select id from comercio))) ->> 'error',
  '42501', '6: que el dueno de otro comercio no puede contar');
select is(
  (select count(*)::integer from pedido p where pg_temp.seguimiento(p.n) is not null),
  0, '6: pasada la ventana, ningun cliente ve ya su pedido cancelado');

select * from finish();
rollback;
