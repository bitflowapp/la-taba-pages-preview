-- TABA · UN PEDIDO EN EFECTIVO QUE NADIE ATIENDE DEJA DE RETENER STOCK
--
-- El pedido manual descuenta stock al nacer y nada lo cerraba si el comercio no lo
-- atendía. Acá se prueba `expire_unattended_manual_orders`, agendada cada minuto:
--
--   · vence sólo lo que cumple TODO: recibido, efectivo o a coordinar, cobro
--     pendiente, sin acuse, sin intento de pago, y más viejo que el umbral del negocio;
--   · un negocio sin `abandoned_order_minutes` no activó el vencimiento: no vence nada;
--   · el pedido queda `cancelled` (nunca `canceled`), con el stock devuelto y el
--     producto otra vez en la tienda, y con dos eventos de actor `system`;
--   · un pedido que falla no aborta el lote, queda anotado con su error y se
--     reintenta con espera creciente;
--   · una tanda de pedidos que no se pueden cerrar no les quita el turno a los sanos;
--   · correrlo de nuevo no hace nada;
--   · `release_expired_stock_reservations` es ahora un alias de lo mismo.
--
-- Los pedidos se envejecen moviendo `created_at` respecto del reloj: la suite no
-- depende de la hora en que corre. Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(62);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table vencer_ids (name text primary key, id uuid not null) on commit drop;

do $fixture$
declare
  v_business uuid := 'b9300000-0000-4000-8000-0000000000a1';
  v_sin_umbral uuid := 'b9300000-0000-4000-8000-0000000000a2';
  v_owner uuid := 'a9300000-0000-4000-8000-0000000000ff';
  v_names text[] := array['ultima', 'coordina', 'joven', 'acuse', 'aceptado', 'cobrado', 'veneno', 'intento', 'tanda', 'ajeno'];
  v_stock integer[] := array[2, 3, 4, 5, 6, 7, 8, 9, 30, 2];
  i integer;
  v_id uuid;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_owner,'authenticated','authenticated','vencer-owner@example.invalid','',now(),'{}','{}',now(),now());
  for i in 1..18 loop
    v_id := ('a9300000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
    values (v_id,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());
    insert into vencer_ids values ('c' || i, v_id);
  end loop;

  -- El primero activó el vencimiento a los 30 minutos; el segundo no cargó nada.
  -- El guardián de admisión no es lo que se prueba acá.
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode, abandoned_order_minutes
  ) values
    (v_business, 'TABA vence pedidos', 'taba-vence-pedidos', 'open', true, true, true,
     clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off', 30),
    (v_sin_umbral, 'TABA sin umbral', 'taba-sin-umbral', 'open', true, true, true,
     clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off', null);
  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_business, v_owner, 'owner', true), (v_sin_umbral, v_owner, 'owner', true);
  insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
  values ('e9300000-0000-4000-8000-0000000000a1', v_owner, v_business, 'owner', 'panel_web');

  for i in 1..array_length(v_names, 1) loop
    v_id := ('c9300000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
      variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
      stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
      external_id,sku,catalog_origin,units_per_pack)
    values (v_id, case when v_names[i] = 'ajeno' then v_sin_umbral else v_business end,
      'Lata ' || v_names[i],'Gaseosas','Cola',1000,'confirmed',true,'Marca',
      'Lata','Lata',473,'ml','473 ml','lata',
      v_stock[i],true,true,false,'{}',true,now(),v_owner,'vencer-' || v_names[i],'vencer-' || v_names[i],'commercial',1);
    insert into vencer_ids values (v_names[i], v_id);
  end loop;
  insert into vencer_ids values ('business', v_business), ('sin_umbral', v_sin_umbral), ('owner', v_owner);
end
$fixture$;

create function pg_temp.id(p_name text) returns uuid language sql as $$
  select id from vencer_ids where name = p_name;
$$;
create function pg_temp.operador() returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id('owner'), 'role', 'authenticated', 'session_id', 'e9300000-0000-4000-8000-0000000000a1')::text, true)::void;
$$;
-- El barrido corre desde pg_cron: sin sesión.
create function pg_temp.sin_sesion() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)::void;
$$;
-- Un pedido de retiro por la RPC pública, del producto del mismo nombre que la clave.
create function pg_temp.pedir(p_customer text, p_name text, p_quantity integer,
  p_product text default null, p_payment text default 'cash', p_business text default 'business')
returns uuid language plpgsql as $$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.id(p_customer), 'role', 'authenticated')::text, true);
  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', pg_temp.id(p_business),
    'client_request_id', 'vencer-' || p_name,
    'tracking_token', md5(p_name) || md5(p_name || 'vencer'),
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', pg_temp.id(coalesce(p_product, p_name)), 'quantity', p_quantity)),
    'customer_name', 'Cliente Vencer',
    'customer_phone', '2996209137',
    'delivery_mode', 'pickup',
    'payment_method', p_payment));
  insert into vencer_ids values ('pedido-' || p_name, (v_result ->> 'id')::uuid);
  return (v_result ->> 'id')::uuid;
end;
$$;
create function pg_temp.pedido(p_name text) returns uuid language sql as $$
  select pg_temp.id('pedido-' || p_name);
$$;
create function pg_temp.envejecer(p_name text, p_age interval) returns void language plpgsql as $$
begin
  perform pg_temp.sin_sesion();
  update public.orders set created_at = clock_timestamp() - p_age where id = pg_temp.pedido(p_name);
end;
$$;
create function pg_temp.estado(p_name text) returns text language sql as $$
  select status from public.orders where id = pg_temp.pedido(p_name);
$$;
create function pg_temp.revision(p_name text) returns bigint language sql as $$
  select revision from public.orders where id = pg_temp.pedido(p_name);
$$;
create function pg_temp.gondola(p_product text) returns text language sql as $$
  select format('%s/%s', stock, available::text) from public.products where id = pg_temp.id(p_product);
$$;
-- El barrido, por SQL dinámico: en una base sin la migración la suite marca sus
-- aserciones en rojo en lugar de no compilar.
create function pg_temp.barrer(p_function text default 'expire_unattended_manual_orders', p_limit integer default 100)
returns integer language plpgsql as $f$
declare
  v_count integer;
begin
  perform pg_temp.sin_sesion();
  execute format('select public.%I($1)', p_function) into v_count using p_limit;
  return v_count;
exception
  when undefined_function then return null;
end;
$f$;

-- Nueve pedidos, todos viejos salvo «joven».
select pg_temp.pedir('c1', 'ultima', 2);                                   -- vence: se llevó las dos últimas
select pg_temp.pedir('c2', 'coordina', 1, null, 'coordinate');             -- vence: a coordinar
select pg_temp.pedir('c3', 'joven', 1);                                    -- no: todavía no pasó el umbral
select pg_temp.pedir('c4', 'acuse', 1);                                    -- no: el comercio acusó recibo
select pg_temp.pedir('c5', 'aceptado', 1);                                 -- no: aceptado
select pg_temp.pedir('c6', 'cobrado', 1);                                  -- no: cobro manual confirmado
select pg_temp.pedir('c7', 'veneno', 1);                                   -- falla al cancelarse
select pg_temp.pedir('c8', 'intento', 1);                                  -- no: tiene un intento de pago
select pg_temp.pedir('c9', 'ajeno', 2, null, 'cash', 'sin_umbral');        -- no: su negocio no activó el vencimiento

select pg_temp.operador();
select public.acknowledge_order(pg_temp.pedido('acuse'), pg_temp.revision('acuse'), 'vencer-acuse-0001');
select public.transition_order(pg_temp.pedido('aceptado'), pg_temp.revision('aceptado'), 'accepted', 'vencer-acepta-0001');
select public.confirm_manual_order_payment(pg_temp.pedido('cobrado'), pg_temp.revision('cobrado'), 'cash', 'vencer-cobro-0001');
select pg_temp.sin_sesion();

-- Un intento de pago atado a un pedido en efectivo: no es «sin cobrar».
insert into public.checkout_sessions(
  id,business_id,customer_id,client_request_id,normalized_intent_hash,fulfillment_type,
  currency,subtotal,total,status,expires_at
) values (
  'f9300000-0000-4000-8000-000000000001', pg_temp.id('business'), pg_temp.id('c8'),
  'vencer-checkout-0001', repeat('a', 64), 'pickup', 'ARS', 1000, 1000, 'payment_pending', now() + interval '1 hour');
insert into public.payment_intents(
  id,checkout_session_id,business_id,order_id,environment,external_reference,internal_status,
  currency,expected_amount
) values (
  'f9300000-0000-4000-8000-000000000002', 'f9300000-0000-4000-8000-000000000001', pg_temp.id('business'),
  pg_temp.pedido('intento'), 'test', 'taba2:checkout:f9300000-0000-4000-8000-000000000001', 'pending', 'ARS', 1000);

-- Un pedido de Mercado Pago recibido y viejo: tampoco es asunto de este barrido.
insert into public.orders(
  id,business_id,code,public_code,status,fulfillment_type,delivery_mode,
  client_request_id,customer_name,customer_phone,payment_method,subtotal,delivery_fee,total,created_at)
values ('d9300000-0000-4000-8000-000000000001', pg_temp.id('business'), 'VENC-MP-1', 'VENC-MP-1', 'received', 'pickup', 'pickup',
  'vencer-mercadopago', 'CLIENTE_SINTETICO_NO_CACHEAR', '+540000000000', 'mercadopago', 1000, 0, 1000,
  clock_timestamp() - interval '3 days');
insert into vencer_ids values ('pedido-mercadopago', 'd9300000-0000-4000-8000-000000000001');

select pg_temp.envejecer(n, interval '45 minutes')
  from unnest(array['ultima', 'coordina', 'acuse', 'aceptado', 'cobrado', 'veneno', 'intento']) as n;
select pg_temp.envejecer('joven', interval '10 minutes');
select pg_temp.envejecer('ajeno', interval '3 days');

-- El pedido «veneno» no se puede cancelar: un trigger de la suite lo impide. Es la
-- forma de probar que un pedido que falla no se lleva puesto al lote.
create function pg_temp.veneno() returns trigger language plpgsql as $$
begin
  raise exception 'pedido envenenado por la suite' using errcode = 'P0001';
end;
$$;
create trigger zz_suite_veneno before update of status on public.orders
  for each row when (old.client_request_id like 'vencer-veneno%') execute function pg_temp.veneno();

-- Lo que el barrido anotó de un pedido que no pudo cerrar. Por SQL dinámico, igual
-- que el barrido: sin la migración la aserción queda en rojo en lugar de no compilar.
create function pg_temp.fallo(p_name text) returns text language plpgsql as $f$
declare
  v_text text;
begin
  execute $q$
    select format('%s intento(s), %s, reintento a los %s min', f.attempts, f.last_sqlstate,
             round(extract(epoch from (f.retry_after - f.last_failed_at)) / 60))
      from private.unattended_order_expiry_failures f
     where f.order_id = $1$q$
    into v_text using pg_temp.pedido(p_name);
  return coalesce(v_text, 'sin fallo anotado');
exception
  when undefined_table then return null;
end;
$f$;
-- Pasa el tiempo de espera de un reintento (de uno, o de todos), sin depender del reloj.
create function pg_temp.cumplir_espera(p_name text default null) returns void language plpgsql as $f$
begin
  execute $q$
    update private.unattended_order_expiry_failures
       set retry_after = clock_timestamp() - interval '1 second'
     where $1::text is null or order_id = $2$q$
    using p_name, case when p_name is null then null else pg_temp.pedido(p_name) end;
exception
  when undefined_table then null;
end;
$f$;
create function pg_temp.fallos_pendientes() returns integer language plpgsql as $f$
declare
  v_count integer;
begin
  execute 'select count(*)::integer from private.unattended_order_expiry_failures' into v_count;
  return v_count;
exception
  when undefined_table then return null;
end;
$f$;
-- La lista que lee el servicio, para un pedido.
create function pg_temp.listado(p_name text) returns text language plpgsql as $f$
declare
  v_text text;
begin
  execute $q$
    select format('%s | %s | %s | %s', l.order_status, l.attempts, l.last_sqlstate, l.last_error)
      from public.list_unattended_order_expiry_failures() l
     where l.order_id = $1 and l.business_id = $2$q$
    into v_text using pg_temp.pedido(p_name), pg_temp.id('business');
  return v_text;
exception
  when undefined_function then return null;
end;
$f$;

create temporary table antes on commit drop as
select o.id, o.revision, (select count(*) from public.order_events e where e.order_id = o.id) as eventos
  from public.orders o where o.business_id in (pg_temp.id('business'), pg_temp.id('sin_umbral'));

-- ══ 1 · PERMISOS Y AGENDA ═══════════════════════════════════════════════════
select ok(
  to_regprocedure('public.expire_unattended_manual_orders(integer)') is not null
  and has_function_privilege('service_role', 'public.expire_unattended_manual_orders(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.expire_unattended_manual_orders(integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.expire_unattended_manual_orders(integer)', 'EXECUTE'),
  'el barrido existe y solo lo ejecuta el servicio');

select ok(
  not has_function_privilege('authenticated', 'public.release_expired_stock_reservations(integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.release_expired_stock_reservations(integer)', 'EXECUTE'),
  'la funcion vieja sigue fuera del alcance de los roles de cliente');

select is(
  (select count(*)::integer from cron.job
    where jobname = 'taba-unattended-order-expiry' and schedule = '* * * * *'
      and command = 'select public.expire_unattended_manual_orders(100);'),
  1, 'pg_cron lo corre cada minuto');

select ok(
  has_function_privilege('service_role', to_regprocedure('public.list_unattended_order_expiry_failures()'), 'EXECUTE')
  and not has_function_privilege('authenticated', to_regprocedure('public.list_unattended_order_expiry_failures()'), 'EXECUTE')
  and not has_function_privilege('anon', to_regprocedure('public.list_unattended_order_expiry_failures()'), 'EXECUTE'),
  'la lista de lo que no pudo vencer solo la lee el servicio');

select ok(
  (select c.relrowsecurity from pg_class c where c.oid = to_regclass('private.unattended_order_expiry_failures'))
  and not has_table_privilege('authenticated', to_regclass('private.unattended_order_expiry_failures'), 'SELECT')
  and not has_table_privilege('anon', to_regclass('private.unattended_order_expiry_failures'), 'SELECT'),
  'la memoria del barrido tiene RLS y ningun rol de cliente la lee');

-- ══ 2 · EL BARRIDO ══════════════════════════════════════════════════════════
select is(pg_temp.gondola('ultima'), '0/false', 'antes: el pedido viejo tiene tomadas las dos ultimas unidades');

select is(pg_temp.barrer(), 2, 'el barrido vence exactamente dos pedidos');

select is(pg_temp.estado('ultima'), 'cancelled', 'el pedido en efectivo sin atender queda cancelled, no canceled');
select is(pg_temp.estado('coordina'), 'cancelled', 'el pedido a coordinar sin atender tambien');
select ok(
  (select cancelled_at is not null and inventory_released_at is not null from public.orders where id = pg_temp.pedido('ultima')),
  'con su fecha de cancelacion y la marca de stock devuelto');
select is(pg_temp.gondola('ultima'), '2/true', 'las dos unidades vuelven y el producto vuelve a la tienda');
select is(pg_temp.gondola('coordina'), '3/true', 'el otro producto recupera su unidad');
select is(
  pg_temp.revision('ultima') - (select revision from antes where id = pg_temp.pedido('ultima')),
  1::bigint, 'la revision del pedido avanza una sola vez');

-- ══ 3 · LO QUE QUEDA ESCRITO ════════════════════════════════════════════════
select is(
  (select array_agg(e.event_type || ':' || e.actor_role || ':' || coalesce(e.actor_user_id::text, 'nadie') order by e.sequence)
     from public.order_events e
    where e.order_id = pg_temp.pedido('ultima')
      and e.sequence > (select max(x.sequence) from public.order_events x where x.order_id = pg_temp.pedido('ultima') and x.event_type = 'order.received')),
  array['order.status_changed:system:nadie', 'order.expired_unattended:system:nadie'],
  'dos eventos de actor system: el cambio de estado y el vencimiento');

select is(
  (select e.metadata from public.order_events e
    where e.order_id = pg_temp.pedido('ultima') and e.event_type = 'order.expired_unattended'),
  jsonb_build_object('reason', 'unattended_timeout', 'abandoned_order_minutes', 30,
    'previous_status', 'received', 'products_released', 1),
  'el evento dice el umbral y cuantos productos devolvio, y nada del cliente');

select is(
  (select e.metadata ->> 'inventory_released' from public.order_events e
    where e.order_id = pg_temp.pedido('ultima') and e.event_type = 'order.status_changed'
    order by e.sequence desc limit 1),
  'true', 'el evento de estado registra la devolucion de stock');

select ok(
  (select e.message !~* 'cliente vencer|2996209137' and e.payload = e.metadata from public.order_events e
    where e.order_id = pg_temp.pedido('ultima') and e.event_type = 'order.expired_unattended'),
  'el mensaje no lleva nombre ni telefono');

-- ══ 4 · LO QUE NO VENCE ═════════════════════════════════════════════════════
select is(pg_temp.estado('joven'), 'received', 'un pedido que todavia no paso el umbral sigue esperando');
select is(pg_temp.estado('acuse'), 'received', 'un pedido con acuse del comercio no vence');
select is(pg_temp.estado('aceptado'), 'accepted', 'un pedido aceptado no vence');
select is(pg_temp.estado('cobrado'), 'received', 'un pedido con el cobro confirmado no vence');
select is(pg_temp.estado('intento'), 'received', 'un pedido con un intento de pago no vence');
select is(pg_temp.estado('mercadopago'), 'received', 'un pedido de Mercado Pago no vence');
select is(pg_temp.estado('ajeno') || ' ' || pg_temp.gondola('ajeno'), 'received 0/false',
  'un negocio que no cargo el umbral no activo el vencimiento: su pedido de tres dias sigue igual');

-- ══ 5 · UN PEDIDO QUE FALLA NO ABORTA EL LOTE ═══════════════════════════════
select is(pg_temp.estado('veneno') || ' ' || pg_temp.gondola('veneno'), 'received 7/true',
  'el pedido que no se pudo cancelar sigue como estaba, con su stock tomado');
select is(
  (select count(*)::integer from public.order_events e
    where e.order_id = pg_temp.pedido('veneno') and e.event_type = 'order.expired_unattended'),
  0, 'y no quedo ningun evento a medias');
select is(pg_temp.fallo('veneno'), '1 intento(s), P0001, reintento a los 2 min',
  'el fallo queda anotado: un intento, su SQLSTATE y el reintento a los dos minutos');
select is(pg_temp.fallos_pendientes(), 1, 'y es el unico: lo que no vence por regla no es un fallo');
select is(pg_temp.listado('veneno'), 'received | 1 | P0001 | pedido envenenado por la suite',
  'la lista para el servicio dice que pedido, cuantas veces y por que');

-- ══ 6 · CORRERLO DE NUEVO NO HACE NADA ══════════════════════════════════════
create temporary table despues on commit drop as
select o.id, o.revision, (select count(*) from public.order_events e where e.order_id = o.id) as eventos
  from public.orders o where o.business_id in (pg_temp.id('business'), pg_temp.id('sin_umbral'));

select is(pg_temp.barrer(), 0, 'una segunda corrida no vence nada');
select is(
  (select count(*)::integer from despues d join public.orders o on o.id = d.id
    where o.revision <> d.revision
       or (select count(*) from public.order_events e where e.order_id = o.id) <> d.eventos),
  0, 'y no toca ningun pedido ni agrega eventos');
select is(pg_temp.gondola('ultima') || ' ' || pg_temp.gondola('coordina'), '2/true 3/true',
  'el stock no se devuelve dos veces');
select is(pg_temp.fallo('veneno'), '1 intento(s), P0001, reintento a los 2 min',
  'el pedido que fallo no se reintenta antes de su espera');

-- ══ 7 · EL TOPE DEL LOTE ════════════════════════════════════════════════════
select pg_temp.pedir('c10', 'tanda-1', 1, 'tanda');
select pg_temp.pedir('c11', 'tanda-2', 1, 'tanda');
select pg_temp.pedir('c12', 'tanda-3', 1, 'tanda');
select pg_temp.envejecer('tanda-1', interval '3 hours');
select pg_temp.envejecer('tanda-2', interval '2 hours');
select pg_temp.envejecer('tanda-3', interval '1 hour');

select is(pg_temp.barrer('expire_unattended_manual_orders', 2), 2, 'con tope 2 vence dos');
select is(pg_temp.estado('tanda-1') || ' ' || pg_temp.estado('tanda-2') || ' ' || pg_temp.estado('tanda-3'),
  'cancelled cancelled received', 'los dos mas viejos primero');
select is(pg_temp.barrer('expire_unattended_manual_orders', null), 1, 'la corrida siguiente se lleva el que faltaba');
select is(pg_temp.gondola('tanda'), '30/true', 'y el producto recupera sus tres unidades');

-- ══ 8 · EL UMBRAL ES DEL DUEÑO ══════════════════════════════════════════════
update public.businesses set abandoned_order_minutes = 60 where id = pg_temp.id('business');
select pg_temp.envejecer('joven', interval '45 minutes');
select is(pg_temp.barrer(), 0, 'con el umbral en 60 minutos, un pedido de 45 no vence');
update public.businesses set abandoned_order_minutes = 30 where id = pg_temp.id('business');
select is(pg_temp.barrer(), 1, 'con el umbral en 30, si');
select is(pg_temp.estado('joven') || ' ' || pg_temp.gondola('joven'), 'cancelled 4/true', 'y devuelve su unidad');

update public.businesses set abandoned_order_minutes = 5 where id = pg_temp.id('sin_umbral');
select is(pg_temp.barrer(), 1, 'cuando el otro negocio carga su umbral, su pedido viejo vence');
select is(pg_temp.estado('ajeno') || ' ' || pg_temp.gondola('ajeno'), 'cancelled 2/true', 'y su producto vuelve a la tienda');

-- ══ 9 · LA FUNCIÓN VIEJA ES UN ALIAS ════════════════════════════════════════
-- Antes filtraba por una columna que nadie escribe y, si llegaba a encontrar algo,
-- lo dejaba en `canceled`.
select pg_temp.pedir('c13', 'alias', 1, 'tanda');
select pg_temp.envejecer('alias', interval '2 hours');
select is(pg_temp.barrer('release_expired_stock_reservations'), 1,
  'release_expired_stock_reservations vence el pedido sin atender');
select is(pg_temp.estado('alias'), 'cancelled', 'y lo deja cancelled');

-- ══ 10 · LOS QUE NO SE PUEDEN CERRAR NO LES QUITAN EL TURNO A LOS DEMÁS ═════
-- Tres pedidos imposibles de cancelar, más viejos que dos sanos, y un tope de 2.
-- Sin memoria, cada corrida gastaba su tope en los mismos y los sanos no vencían nunca.
select pg_temp.pedir('c14', 'veneno-a', 1, 'tanda');
select pg_temp.pedir('c15', 'veneno-b', 1, 'tanda');
select pg_temp.pedir('c16', 'veneno-c', 1, 'tanda');
select pg_temp.pedir('c17', 'sano-1', 1, 'tanda');
select pg_temp.pedir('c18', 'sano-2', 1, 'tanda');
select pg_temp.envejecer('veneno-a', interval '5 hours');
select pg_temp.envejecer('veneno-b', interval '4 hours');
select pg_temp.envejecer('veneno-c', interval '3 hours');
select pg_temp.envejecer('sano-1', interval '2 hours');
select pg_temp.envejecer('sano-2', interval '1 hour');

select is(pg_temp.barrer('expire_unattended_manual_orders', 2), 0,
  'la primera corrida se topa con dos que no puede cerrar y corta');
select is(pg_temp.fallo('veneno-a') || ' / ' || pg_temp.fallo('veneno-b') || ' / ' || pg_temp.fallo('veneno-c'),
  '1 intento(s), P0001, reintento a los 2 min / 1 intento(s), P0001, reintento a los 2 min / sin fallo anotado',
  'anota los dos que intento; al tercero no llego');
select is(pg_temp.barrer('expire_unattended_manual_orders', 2), 2,
  'la corrida siguiente no vuelve sobre los mismos: vencen los dos sanos');
select is(pg_temp.estado('sano-1') || ' ' || pg_temp.estado('sano-2'), 'cancelled cancelled',
  'los pedidos sanos no quedaron detras de los que fallan');
select is(pg_temp.fallo('veneno-c'), '1 intento(s), P0001, reintento a los 2 min',
  'y el tercero que no se puede cerrar quedo anotado en esa misma corrida');

-- El reintento espera cada vez más.
select pg_temp.cumplir_espera('veneno-a');
select is(pg_temp.barrer(), 0, 'cumplida su espera, el pedido se reintenta y vuelve a fallar');
select is(pg_temp.fallo('veneno-a') || ' / ' || pg_temp.fallo('veneno-b'),
  '2 intento(s), P0001, reintento a los 4 min / 1 intento(s), P0001, reintento a los 2 min',
  'el segundo fallo duplica la espera; el que no cumplio la suya no se toco');

-- El comercio toma uno de los que fallaban: deja de ser asunto del barrido.
select pg_temp.operador();
select public.acknowledge_order(pg_temp.pedido('veneno-b'), pg_temp.revision('veneno-b'), 'vencer-acuse-0002');
select is(pg_temp.barrer(), 0, 'una corrida despues del acuse no vence nada');
select is(pg_temp.fallo('veneno-b') || ' ' || pg_temp.estado('veneno-b'), 'sin fallo anotado received',
  'el pedido que el comercio tomo deja de figurar como fallo y sigue abierto');

-- Los reintentos van al final: un pedido nuevo no espera detrás de los que ya fallaron,
-- aunque sean más viejos y ya les toque reintentar.
select pg_temp.pedir('c17', 'sano-3', 1, 'tanda');
select pg_temp.envejecer('sano-3', interval '40 minutes');
select pg_temp.cumplir_espera();
select is(pg_temp.barrer('expire_unattended_manual_orders', 1), 1,
  'con tres reintentos cumplidos y mas viejos, el tope de 1 se usa en el pedido que nunca fallo');
select is(pg_temp.estado('sano-3') || ' / ' || split_part(pg_temp.fallo('veneno-a'), ',', 1), 'cancelled / 2 intento(s)',
  'y esa corrida no gasto ningun intento en los que ya habian fallado');
select is(pg_temp.barrer(), 0, 'la corrida siguiente los reintenta, y vuelven a fallar');
select is(pg_temp.fallo('veneno') || ' / ' || pg_temp.fallo('veneno-a') || ' / ' || pg_temp.fallo('veneno-c'),
  '2 intento(s), P0001, reintento a los 4 min / 3 intento(s), P0001, reintento a los 8 min / 2 intento(s), P0001, reintento a los 4 min',
  'cada uno con una espera mas larga que la anterior');

-- Se arregla lo que impedía cerrarlos: vencen en su reintento y la memoria se vacía.
drop trigger zz_suite_veneno on public.orders;
select is(pg_temp.barrer(), 0, 'arreglado el problema, nada se reintenta antes de su espera');
select pg_temp.cumplir_espera();
select is(pg_temp.barrer(), 3, 'cumplida la espera, los tres que fallaban vencen');
select is(pg_temp.estado('veneno') || ' ' || pg_temp.estado('veneno-a') || ' ' || pg_temp.estado('veneno-c'),
  'cancelled cancelled cancelled', 'quedan cancelled como cualquier otro');
select is(pg_temp.fallos_pendientes(), 0, 'y no queda ningun fallo anotado');
select is(pg_temp.gondola('veneno') || ' ' || pg_temp.gondola('tanda'), '8/true 29/true',
  'el stock vuelve completo, salvo la unidad del pedido que el comercio tomo');

select * from finish();
rollback;
