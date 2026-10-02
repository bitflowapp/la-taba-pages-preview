-- TABA · EL PRECIO, EL TOTAL, EL DESCUENTO, EL ENVÍO Y EL STOCK LOS DECIDE EL SERVIDOR
--
-- El requisito del dueño: el navegador nunca decide precio, descuento, envío, total,
-- stock ni promociones. El mecanismo existía; lo que no existía era una prueba que lo
-- EJECUTARA. Acá se ejecuta, por las dos puertas por las que entra una compra y con el
-- rol y los datos de quien las llama de verdad:
--
--   PUERTA MANUAL   · `create_order_with_items(jsonb)`: el pedido en efectivo. La llama
--                     el cliente (rol `authenticated`, sesión anónima).
--   PUERTA CHECKOUT · `create_checkout_session(uuid, jsonb)`: la sesión de Mercado
--                     Pago. La llama la función Edge (rol `service_role`).
--
-- En las descripciones, «manual ·» y «checkout ·» dicen por qué puerta entró el caso.
--
-- Los once casos pedidos, cada uno por las dos puertas:
--
--    1  precio alterado        claves de dinero en el renglón
--    2  total alterado         claves de dinero en el pedido, una por una
--    3  descuento alterado     claves de descuento, y las promociones (combos: sólo
--                              existen en la puerta checkout; la manual los rechaza)
--    4  cantidad negativa
--    5  cantidad cero
--    6  cantidad enorme        el límite por renglón y el tope del guardián: cuál contesta
--    7  cantidad decimal       1.5, 1.0, "2" (texto), 1e2, y el null de PRICE-05
--    8  producto de otro comercio (y producto inexistente o mal formado)
--    9  producto oculto        cada bandera por separado, y el comercio cerrado o sin verificar
--   10  producto sin precio    precio pendiente y precio cero
--   11  producto sin stock     stock 0, stock sin cargar y las últimas unidades
--
-- y al final se cambia el precio del catálogo: lo nuevo se cobra al precio nuevo y lo
-- que ya estaba pedido conserva el suyo.
--
-- Cómo se lee cada aserción. Las dos ayudas `pg_temp.manual` y `pg_temp.checkout`
-- devuelven una sola línea:
--   · compra aceptada:  `ok ` + lo que la BASE guardó (subtotal|descuento|envío|total|
--     moneda|renglones), leído de las tablas y no de la respuesta;
--   · compra rechazada: `SQLSTATE mensaje / nada escrito`. «nada escrito» sale de
--     comparar, antes y después de la llamada, pedidos, renglones, sesiones, reservas,
--     intenciones de pago, frenos del guardián y el stock de todos los productos.
-- Después de la llamada se corren los resguardos diferidos, como haría el COMMIT.
--
-- Lo que esta prueba deja FIJADO como defecto (no se corrige acá) está marcado con
-- `-- DEFECTO:`.
--
-- Ningún caso depende de la hora: ningún comercio exige horario ni vende alcohol.
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(230);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table precio_ids (clave text primary key, id uuid not null) on commit drop;
insert into precio_ids values
  ('owner',  'a9100000-0000-4000-8000-0000000000a1'),
  ('c1',     'a9100000-0000-4000-8000-0000000000c1'),   -- cliente de la puerta manual
  ('c2',     'a9100000-0000-4000-8000-0000000000c2'),   -- cliente de la puerta checkout
  ('c3',     'a9100000-0000-4000-8000-0000000000c3'),   -- cliente del comercio con guardian
  -- comercios
  ('A',      'b9100000-0000-4000-8000-0000000000a1'),   -- abierto y verificado: retiro y delivery con zona
  ('B',      'b9100000-0000-4000-8000-0000000000a2'),   -- OTRO comercio, abierto y verificado
  ('C',      'b9100000-0000-4000-8000-0000000000a3'),   -- cerrado
  ('P',      'b9100000-0000-4000-8000-0000000000a4'),   -- en pausa
  ('D',      'b9100000-0000-4000-8000-0000000000a5'),   -- verificado, con los pedidos apagados
  ('U',      'b9100000-0000-4000-8000-0000000000a6'),   -- sin verificar
  ('I',      'b9100000-0000-4000-8000-0000000000a7'),   -- dado de baja
  ('G',      'b9100000-0000-4000-8000-0000000000a8'),   -- abierto, con el guardian de admision encendido
  ('X',      'b9100000-0000-4000-8000-0000000000ff'),   -- no existe
  -- productos de A
  ('lata',             'c9100000-0000-4000-8000-000000000001'),
  ('agua',             'c9100000-0000-4000-8000-000000000002'),
  ('granel',           'c9100000-0000-4000-8000-000000000003'),
  ('no_disponible',    'c9100000-0000-4000-8000-000000000004'),
  ('pausado',          'c9100000-0000-4000-8000-000000000005'),
  ('sin_verificar',    'c9100000-0000-4000-8000-000000000006'),
  ('inactivo',         'c9100000-0000-4000-8000-000000000007'),
  ('precio_pendiente', 'c9100000-0000-4000-8000-000000000008'),
  ('precio_cero',      'c9100000-0000-4000-8000-000000000009'),
  ('sin_stock',        'c9100000-0000-4000-8000-000000000010'),
  ('stock_nulo',       'c9100000-0000-4000-8000-000000000011'),
  ('ultimas',          'c9100000-0000-4000-8000-000000000012'),
  ('ultimas_mp',       'c9100000-0000-4000-8000-000000000013'),
  ('cambia',           'c9100000-0000-4000-8000-000000000014'),
  -- un producto en cada uno de los otros comercios
  ('de_B',             'c9100000-0000-4000-8000-0000000000b2'),
  ('de_C',             'c9100000-0000-4000-8000-0000000000b3'),
  ('de_P',             'c9100000-0000-4000-8000-0000000000b4'),
  ('de_D',             'c9100000-0000-4000-8000-0000000000b5'),
  ('de_U',             'c9100000-0000-4000-8000-0000000000b6'),
  ('de_I',             'c9100000-0000-4000-8000-0000000000b7'),
  ('de_G',             'c9100000-0000-4000-8000-0000000000b8'),
  ('inexistente',      'c9100000-0000-4000-8000-0000000000ff');
create function pg_temp.id(p_clave text) returns uuid language sql stable as $$
  select id from precio_ids where clave = p_clave
$$;
create temporary table precio_out (k text primary key, v text) on commit drop;

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
values
  (pg_temp.id('owner'),'authenticated','authenticated','precio-owner@example.invalid','',now(),'{}','{}',false,now(),now()),
  (pg_temp.id('c1'),'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now()),
  (pg_temp.id('c2'),'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now()),
  (pg_temp.id('c3'),'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());

-- Ningun comercio exige horario (`hours_enforced` queda en false): la hora no importa.
-- A reparte desde el INSERT; el envio general del comercio es 500.
insert into public.businesses(id,name,slug,status,is_active,currency_code,address,pickup_enabled,delivery_enabled,delivery_fee,minimum_delivery_subtotal,
  delivery_zone_enforced,ordering_verified,ordering_verified_at,ordering_verified_by,ordering_enabled,order_intake_guard_mode)
select pg_temp.id(n.clave), 'Precio ' || n.clave, 'taba-precio-' || lower(n.clave), n.status, n.activo, 'ARS', 'Mendoza 827, Neuquen',
       true, n.clave = 'A', case when n.clave = 'A' then 500 else 0 end, 0, n.clave = 'A',
       n.verificado, case when n.verificado then now() end, case when n.verificado then pg_temp.id('owner') end, n.pedidos, n.guardian
  from (values
    -- clave status   activo verificado pedidos guardian
    ('A', 'open',   true,  true,  true,  'off'),
    ('B', 'open',   true,  true,  true,  'off'),
    ('C', 'closed', true,  true,  true,  'off'),
    ('P', 'paused', true,  true,  true,  'off'),
    ('D', 'open',   true,  true,  false, 'off'),
    ('U', 'open',   true,  false, false, 'off'),
    ('I', 'open',   false, true,  false, 'off'),
    ('G', 'open',   true,  true,  true,  'enforce')
  ) n(clave, status, activo, verificado, pedidos, guardian);

-- A exige cobertura: la zona Centro cobra 800. Ni los 500 del comercio ni lo que mande el cliente.
insert into public.delivery_zones(id,business_id,name,is_active,match_kind,area_normalized,boundary,delivery_fee,minimum_subtotal,priority)
values ('d9100000-0000-4000-8000-0000000000f1', pg_temp.id('A'), 'Centro', true, 'declared_area', 'centro', null, 800, 0, 10);

-- Todos tienen Mercado Pago configurado: si la puerta checkout rechaza, no es por esto.
insert into public.business_payment_settings(business_id, enabled, environment, checkout_mode, currency, reserve_stock,
  collector_id, application_id, configured_at, verified_at)
select pg_temp.id(c), true, 'test', 'checkout_pro', 'ARS', true, 'collector-precio-' || lower(c), 'app-precio-' || lower(c), clock_timestamp(), clock_timestamp()
  from unnest(array['A','B','C','P','D','U','I','G']) c;
-- El vendedor conectado por OAuth: sin el la autoridad V2 no deja asentar la preferencia.
insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
select pg_temp.id(c), 'test', 'collector-precio-' || lower(c), 'app-precio-' || lower(c), 'connected', 'ciphertext-only-local-fixture', now() + interval '2 days'
  from unnest(array['A','B','C','P','D','U','I','G']) c;

-- Productos. Las filas «ocultas» nacen con available = false: el CHECK
-- `products_available_requires_verification` no deja publicar ninguna (se prueba abajo).
insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
select pg_temp.id(p.clave), pg_temp.id(p.negocio), p.nombre, 'Gaseosas', 'Cola', p.precio, p.estado_precio, p.activo, 'Marca',
    'Lata', 'Lata', 473, 'ml', '473 ml', 'lata',
    p.stock, p.disponible, p.lo_ofrece, false, '{}', p.verificado,
    case when p.verificado then now() end, case when p.verificado then pg_temp.id('owner') end,
    'precio-' || p.clave, 'precio-' || p.clave, 'commercial', 1
  from (values
    -- clave             negocio nombre                    precio   precio_status activo stock  available merchant_available verificado
    ('lata',             'A', 'Lata Precio',               1000.00, 'confirmed',  true,  500,   true,     true,              true),
    ('agua',             'A', 'Agua Precio',                500.00, 'confirmed',  true,  500,   true,     true,              true),
    ('granel',           'A', 'Caramelo Precio',             10.00, 'confirmed',  true,  5000,  true,     true,              true),
    ('no_disponible',    'A', 'No disponible',             1000.00, 'confirmed',  true,  10,    false,    true,              true),
    ('pausado',          'A', 'Pausado por el comercio',   1000.00, 'confirmed',  true,  10,    false,    false,             true),
    ('sin_verificar',    'A', 'Sin verificar',             1000.00, 'confirmed',  true,  10,    false,    true,              false),
    ('inactivo',         'A', 'Inactivo',                  1000.00, 'confirmed',  false, 10,    false,    true,              true),
    ('precio_pendiente', 'A', 'Precio pendiente',          1000.00, 'pending',    true,  10,    false,    true,              true),
    ('precio_cero',      'A', 'Precio cero',                  0.00, 'confirmed',  true,  10,    false,    true,              false),
    ('sin_stock',        'A', 'Sin stock',                 1000.00, 'confirmed',  true,  0,     false,    true,              true),
    ('stock_nulo',       'A', 'Stock sin cargar',          1000.00, 'confirmed',  true,  null,  false,    true,              false),
    ('ultimas',          'A', 'Ultimas unidades',          1000.00, 'confirmed',  true,  3,     true,     true,              true),
    ('ultimas_mp',       'A', 'Ultimas unidades MP',       1000.00, 'confirmed',  true,  3,     true,     true,              true),
    ('cambia',           'A', 'Cambia de precio',          1000.00, 'confirmed',  true,  100,   true,     true,              true),
    ('de_B',             'B', 'Producto de B',             1000.00, 'confirmed',  true,  50,    true,     true,              true),
    ('de_C',             'C', 'Producto de C',             1000.00, 'confirmed',  true,  50,    true,     true,              true),
    ('de_P',             'P', 'Producto de P',             1000.00, 'confirmed',  true,  50,    true,     true,              true),
    ('de_D',             'D', 'Producto de D',             1000.00, 'confirmed',  true,  50,    true,     true,              true),
    ('de_U',             'U', 'Producto de U',             1000.00, 'confirmed',  true,  50,    true,     true,              true),
    ('de_I',             'I', 'Producto de I',             1000.00, 'confirmed',  true,  50,    true,     true,              true),
    ('de_G',             'G', 'Producto de G',               10.00, 'confirmed',  true,  5000,  true,     true,              true)
  ) p(clave, negocio, nombre, precio, estado_precio, activo, stock, disponible, lo_ofrece, verificado);

-- Combos. `combo-precio` de A: 1 lata + 1 agua al 10 %, redondeado a 100.
--   lista 1500 · 10 % daria 1350 · redondeo hacia abajo a 1300 · ahorro 200.
-- B tiene un combo con el MISMO identificador al 90 %, y otro que solo existe en B.
insert into public.product_combos(id,business_id,combo_id,name,discount_percentage,price_rounding,approval_status,approved_at,is_active) values
  ('e9100000-0000-4000-8000-0000000000e1', pg_temp.id('A'), 'combo-precio',     'Combo Precio',     10, 100, 'APROBADO_COMERCIAL', now(), true),
  ('e9100000-0000-4000-8000-0000000000e2', pg_temp.id('A'), 'combo-pendiente',  'Combo Pendiente',  10, 100, 'PENDIENTE_APROBACION_COMERCIAL', null, true),
  ('e9100000-0000-4000-8000-0000000000e3', pg_temp.id('A'), 'combo-suspendido', 'Combo Suspendido', 10, 100, 'SUSPENDIDO', null, true),
  ('e9100000-0000-4000-8000-0000000000e4', pg_temp.id('A'), 'combo-inactivo',   'Combo Inactivo',   10, 100, 'APROBADO_COMERCIAL', now(), false),
  ('e9100000-0000-4000-8000-0000000000e5', pg_temp.id('A'), 'combo-vacio',      'Combo Vacio',      10, 100, 'APROBADO_COMERCIAL', now(), true),
  ('e9100000-0000-4000-8000-0000000000e6', pg_temp.id('A'), 'combo-con-oculto', 'Combo con oculto', 10, 100, 'APROBADO_COMERCIAL', now(), true),
  ('e9100000-0000-4000-8000-0000000000e7', pg_temp.id('A'), 'combo-con-ajeno',  'Combo con ajeno',  10, 100, 'APROBADO_COMERCIAL', now(), true),
  ('e9100000-0000-4000-8000-0000000000e8', pg_temp.id('B'), 'combo-precio',     'Combo Precio de B', 90, 100, 'APROBADO_COMERCIAL', now(), true),
  ('e9100000-0000-4000-8000-0000000000e9', pg_temp.id('B'), 'combo-de-b',       'Combo de B',       50, 100, 'APROBADO_COMERCIAL', now(), true);
insert into public.product_combo_components(combo_id,product_id,quantity,sort_order) values
  ('e9100000-0000-4000-8000-0000000000e1', pg_temp.id('lata'), 1, 1),
  ('e9100000-0000-4000-8000-0000000000e1', pg_temp.id('agua'), 1, 2),
  ('e9100000-0000-4000-8000-0000000000e2', pg_temp.id('lata'), 1, 1),
  ('e9100000-0000-4000-8000-0000000000e3', pg_temp.id('lata'), 1, 1),
  ('e9100000-0000-4000-8000-0000000000e4', pg_temp.id('lata'), 1, 1),
  ('e9100000-0000-4000-8000-0000000000e6', pg_temp.id('lata'), 1, 1),
  ('e9100000-0000-4000-8000-0000000000e6', pg_temp.id('no_disponible'), 1, 2),
  ('e9100000-0000-4000-8000-0000000000e7', pg_temp.id('lata'), 1, 1),
  ('e9100000-0000-4000-8000-0000000000e7', pg_temp.id('de_B'), 1, 2),
  ('e9100000-0000-4000-8000-0000000000e8', pg_temp.id('de_B'), 1, 1),
  ('e9100000-0000-4000-8000-0000000000e9', pg_temp.id('de_B'), 2, 1);

-- ── Ayudas ─────────────────────────────────────────────────────────────────
-- Todo lo que una compra puede escribir, en una linea. Si dos lecturas son iguales,
-- entre ellas no nacio un pedido, ni una sesion, ni una reserva, ni se movio el stock.
create function pg_temp.estado() returns text language sql as $$
  select concat_ws(' ',
    'pedidos=' || (select count(*) from public.orders),
    'renglones=' || (select count(*) from public.order_items),
    'combos=' || (select count(*) from public.order_combos),
    'eventos=' || (select count(*) from public.order_events),
    'tokens=' || (select count(*) from public.order_public_tokens),
    'sesiones=' || (select count(*) from public.checkout_sessions),
    'items_sesion=' || (select count(*) from public.checkout_session_items),
    'combos_sesion=' || (select count(*) from public.checkout_session_combos),
    'reservas=' || (select count(*) from public.inventory_reservations),
    'intents=' || (select count(*) from public.payment_intents),
    'eventos_pago=' || (select count(*) from public.payment_events),
    'frenos=' || (select coalesce(sum(blocked_count), 0) from private.order_intake_blocks),
    'stock=' || (select md5(string_agg(concat_ws(':', p.id, p.stock, p.available), ',' order by p.id)) from public.products p))
$$;

-- Lo que la base guardo de un pedido: subtotal|descuento|envio|total|moneda|renglones|combos.
--   renglon = nombre:cantidad:precio unitario:subtotal
--   combo   = id:cantidad:porcentaje:lista:promocional:descuento
create function pg_temp.foto_pedido(p_order uuid) returns text language sql as $$
  select concat_ws('|', o.subtotal, o.discount_total, o.delivery_fee, o.total, o.currency_code,
           (select string_agg(concat_ws(':', i.name, i.quantity, i.unit_price, i.subtotal), ',' order by i.name)
              from public.order_items i where i.order_id = o.id),
           (select string_agg(concat_ws(':', c.combo_id, c.quantity, c.discount_percentage, c.list_price, c.promotional_price, c.discount_amount), ',' order by c.combo_id)
              from public.order_combos c where c.order_id = o.id))
    from public.orders o where o.id = p_order
$$;
-- Lo mismo de una sesion de pago, con su estado y con lo que se le va a pedir a Mercado Pago.
create function pg_temp.foto_sesion(p_session uuid) returns text language sql as $$
  select concat_ws('|', s.subtotal, s.discount_total, s.delivery_fee, s.total, s.currency, s.status,
           'cobrar=' || (select pi.expected_amount from public.payment_intents pi where pi.checkout_session_id = s.id),
           (select string_agg(concat_ws(':', i.product_snapshot ->> 'name', i.quantity, i.unit_price, i.subtotal), ',' order by i.product_snapshot ->> 'name')
              from public.checkout_session_items i where i.checkout_session_id = s.id),
           (select string_agg(concat_ws(':', c.combo_id, c.quantity, c.discount_percentage, c.list_price, c.promotional_price, c.discount_amount), ',' order by c.combo_id)
              from public.checkout_session_combos c where c.checkout_session_id = s.id))
    from public.checkout_sessions s where s.id = p_session
$$;

-- Un rechazo en una linea. Los errores con codigo propio (ORDER_TOO_LARGE) llevan su detalle.
create function pg_temp.rechazo(p_sqlstate text, p_message text, p_detail text) returns text language sql immutable as $$
  select p_sqlstate || ' ' || p_message
         || case when p_message ~ '^[A-Z][A-Z_]+$' and coalesce(p_detail, '') <> '' then ' (' || p_detail || ')' else '' end
$$;

-- Los renglones de una compra: {"p": clave, "q": cantidad} es un producto del fixture
-- (cualquier otra clave del objeto viaja tal cual); lo que no trae "p" viaja tal cual.
create function pg_temp.items(variadic p_lineas jsonb[]) returns jsonb language sql stable as $$
  select jsonb_agg(
    case when l ? 'p'
         then (l - 'p' - 'q') || jsonb_build_object('product_id', pg_temp.id(l ->> 'p'), 'quantity', l -> 'q')
         else l end
    order by n)
    from unnest(p_lineas) with ordinality as t(l, n)
$$;

-- PUERTA MANUAL · el pedido en efectivo, llamado por el cliente: rol `authenticated` y el
-- id de su sesion anonima en `request.jwt.claims`.
create function pg_temp.manual(p_key text, p_items jsonb, p_extra jsonb default '{}'::jsonb,
  p_negocio text default 'A', p_cliente text default 'c1') returns text
language plpgsql as $$
declare
  v_payload jsonb := jsonb_build_object(
      'business_id', pg_temp.id(p_negocio),
      'client_request_id', 'precio-' || p_key,
      'tracking_token', md5(p_key) || md5(p_key || 'precio'),
      'items', p_items,
      'customer_name', 'Cliente Precio',
      'customer_phone', '2996209137',
      'delivery_mode', 'pickup',
      'payment_method', 'cash') || p_extra;
  v_cliente uuid := pg_temp.id(p_cliente);
  v_antes text := pg_temp.estado();
  v_result jsonb;
  v_detail text;
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_cliente, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    v_result := public.create_order_with_items(v_payload);
    -- Lo que el COMMIT de la llamada habria verificado (modalidad de pago, punto de entrega).
    set constraints all immediate;
    set constraints all deferred;
    reset role;
    v_out := 'ok ' || coalesce(pg_temp.foto_pedido((v_result ->> 'id')::uuid), 'SIN PEDIDO: ' || v_result::text);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    v_out := pg_temp.rechazo(sqlstate, sqlerrm, v_detail);
  end;
  reset role;
  set constraints all deferred;
  perform set_config('request.jwt.claims', '', true);
  if v_out not like 'ok %' then
    v_out := v_out || case when pg_temp.estado() = v_antes then ' / nada escrito' else ' / ESCRIBIO: ' || pg_temp.estado() || ' (antes: ' || v_antes || ')' end;
  end if;
  return v_out;
end $$;

-- PUERTA CHECKOUT · la sesion de Mercado Pago, llamada como la llama la funcion Edge: rol
-- `service_role`, con el cliente ya autenticado como primer argumento.
create function pg_temp.checkout(p_key text, p_items jsonb, p_extra jsonb default '{}'::jsonb,
  p_negocio text default 'A', p_cliente text default 'c2') returns text
language plpgsql as $$
declare
  v_payload jsonb := jsonb_build_object(
      'business_id', pg_temp.id(p_negocio),
      'client_request_id', 'precio-' || p_key,
      'items', p_items,
      'fulfillment_type', 'pickup',
      'contact', jsonb_build_object('name', 'Cliente Precio', 'phone', '5492990000000'),
      'age_confirmed', false,
      'payment_method', 'mercadopago') || p_extra;
  v_cliente uuid := pg_temp.id(p_cliente);
  v_antes text := pg_temp.estado();
  v_result jsonb;
  v_detail text;
  v_out text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    set local role service_role;
    v_result := public.create_checkout_session(v_cliente, v_payload);
    set constraints all immediate;
    set constraints all deferred;
    reset role;
    v_out := 'ok ' || coalesce(pg_temp.foto_sesion((v_result ->> 'checkout_session_id')::uuid), 'SIN SESION: ' || v_result::text);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    v_out := pg_temp.rechazo(sqlstate, sqlerrm, v_detail);
  end;
  reset role;
  set constraints all deferred;
  perform set_config('request.jwt.claims', '', true);
  if v_out not like 'ok %' then
    v_out := v_out || case when pg_temp.estado() = v_antes then ' / nada escrito' else ' / ESCRIBIO: ' || pg_temp.estado() || ' (antes: ' || v_antes || ')' end;
  end if;
  return v_out;
end $$;

-- La misma compra por una u otra puerta. Para las tablas de casos.
create function pg_temp.comprar(p_puerta text, p_key text, p_items jsonb, p_extra jsonb default '{}'::jsonb,
  p_negocio text default 'A') returns text
language plpgsql as $$
begin
  if p_puerta = 'manual' then
    return pg_temp.manual(p_key, p_items, p_extra, p_negocio);
  end if;
  return pg_temp.checkout(p_key, p_items, p_extra, p_negocio);
end $$;
-- El rechazo de un renglon mal formado, que cada puerta dice con sus palabras.
create function pg_temp.renglon_invalido(p_puerta text) returns text language sql immutable as $$
  select case p_puerta
    when 'manual' then '22023 cada item acepta solo product_id UUID y quantity entero'
    else '22023 cada item acepta product_id UUID o combo_id, con quantity entero' end
$$;
-- El rechazo de un producto que no se puede comprar.
create function pg_temp.no_se_vende(p_puerta text, p_clave text) returns text language sql stable as $$
  select case p_puerta
    when 'manual' then '55000 producto no disponible: '
    else '55000 producto no disponible para pago: ' end || pg_temp.id(p_clave)
$$;

-- Los casos que DEBEN rechazarse, por puerta. La asercion agrega « / nada escrito».
create temporary table precio_casos (
  n serial primary key, seccion text not null, puerta text not null, clave text not null,
  negocio text not null default 'A', items jsonb not null, extra jsonb not null default '{}'::jsonb,
  esperado text not null, que text not null, unique (puerta, clave)
) on commit drop;
create temporary table precio_puertas (puerta text primary key) on commit drop;
insert into precio_puertas values ('manual'), ('checkout');

-- Paga una sesion por el camino V2 (el de la funcion Edge), registra el pago aprobado
-- por el importe de la sesion y la finaliza. Devuelve el pedido que nacio y lo cobrado.
-- Guarda en `precio_out` las lineas que se le piden cobrar a Mercado Pago.
create function pg_temp.pagar(p_key text, p_negocio text default 'A', p_cliente text default 'c2') returns text
language plpgsql as $$
declare
  v_cliente uuid := pg_temp.id(p_cliente);
  v_business uuid := pg_temp.id(p_negocio);
  v_session uuid;
  v_prepare jsonb;
  v_intent uuid;
  v_result jsonb;
begin
  select s.id into v_session from public.checkout_sessions s
   where s.business_id = v_business and s.customer_id = v_cliente and s.client_request_id = 'precio-' || p_key;
  begin
    v_prepare := public.prepare_mercadopago_preference_v2(v_session, v_cliente, false);
    insert into precio_out values ('preferencia:' || p_key, (
      select string_agg(concat_ws(':', l ->> 'title', l ->> 'quantity', l ->> 'unit_price'), ',' order by l ->> 'title')
             || ' suma=' || sum((l ->> 'quantity')::numeric * (l ->> 'unit_price')::numeric)
             || ' total=' || (v_prepare ->> 'total')
        from jsonb_array_elements(v_prepare -> 'items') l));
    perform public.record_mercadopago_preference_created_v2(
      v_business, 'test', v_session, v_cliente, (v_prepare ->> 'payment_attempt_id')::uuid,
      public.get_mercadopago_payment_authority_v2(v_business, 'test', v_session, v_cliente,
        (v_prepare ->> 'payment_attempt_id')::uuid) ->> 'authority_version',
      'PREF-PRECIO-' || p_key,
      'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=' || p_key,
      'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=' || p_key,
      encode(digest('pref-' || p_key, 'sha256'), 'hex'), 'req-' || p_key);
    select pi.id into v_intent from public.payment_intents pi where pi.checkout_session_id = v_session;
    perform public.record_mercadopago_payment_snapshot(v_intent, (
      select jsonb_build_object(
        'provider_payment_id', 'PAY-PRECIO-' || p_key,
        'external_reference', pi.external_reference,
        'preference_id', pi.preference_id,
        'merchant_order_id', 'MO-PRECIO-' || p_key,
        'collector_id', ps.collector_id,
        'currency', 'ARS',
        'transaction_amount', cs.total::text,
        'status', 'approved',
        'status_detail', 'accredited',
        'payment_method', 'visa',
        'live_mode', false,
        'provider_occurred_at', clock_timestamp()::text,
        'refunded_amount', '0.00',
        'payer_email_hash', repeat('e', 64),
        'raw_response_hash', encode(digest('pago-' || p_key, 'sha256'), 'hex'))
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
      join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.provider = 'mercadopago'
      where pi.id = v_intent), 'reconciliation', null);
    v_result := public.finalize_paid_checkout_session(v_session);
    -- Lo que haria el COMMIT del worker: los resguardos diferidos de `orders`.
    set constraints all immediate;
    set constraints all deferred;
    return 'ok ' || coalesce(pg_temp.foto_pedido((v_result ->> 'order_id')::uuid), 'SIN PEDIDO: ' || v_result::text)
           || ' cobrado=' || (select pi.paid_amount from public.payment_intents pi where pi.id = v_intent);
  exception when others then
    return sqlstate || ' ' || sqlerrm;
  end;
end $$;

-- Lo que la tienda le muestra a una persona anonima cuando cotiza un combo.
create function pg_temp.cotizar(p_combo text, p_negocio text default 'A') returns text
language plpgsql as $$
declare
  v_business uuid := pg_temp.id(p_negocio);
  v jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  v := public.resolve_business_combo(v_business, p_combo, 1);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if not (v ->> 'exists')::boolean then
    return 'no existe';
  end if;
  return concat_ws('|', 'lista=' || (v ->> 'list_price'), 'promo=' || (v ->> 'promotional_price'),
                   'ahorro=' || (v ->> 'savings'), 'comprable=' || (v ->> 'purchasable'));
end $$;

-- Una sentencia ejecutada por el cliente (rol `authenticated`): 'ok' o el error.
create function pg_temp.como_cliente(p_sql text) returns text language plpgsql as $$
declare
  v_cliente uuid := pg_temp.id('c1');
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_cliente, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    execute p_sql;
    v_out := 'ok';
  exception when others then
    v_out := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end $$;

-- Una escritura del catalogo hecha por el dueño de la base: 'ok', o el SQLSTATE con la
-- restriccion (o la columna) que la rechazo. Es la fila que NO puede existir.
create function pg_temp.catalogo(p_sql text) returns text language plpgsql as $$
declare
  v_constraint text;
  v_column text;
begin
  begin
    execute p_sql;
    return 'ok';
  exception when others then
    get stacked diagnostics v_constraint = constraint_name, v_column = column_name;
    return sqlstate || ' ' || coalesce(nullif(v_constraint, ''), nullif(v_column, ''), sqlerrm);
  end;
end $$;

create function pg_temp.stock(p_clave text) returns text language sql as $$
  select concat_ws(' ', coalesce(p.stock::text, 'sin cargar'), case when p.available then 'publicado' else 'oculto' end)
    from public.products p where p.id = pg_temp.id(p_clave)
$$;
create function pg_temp.pedidos(p_negocio text) returns integer language sql as $$
  select count(*)::integer from public.orders o where o.business_id = pg_temp.id(p_negocio)
$$;
create function pg_temp.sesiones(p_negocio text) returns integer language sql as $$
  select count(*)::integer from public.checkout_sessions s where s.business_id = pg_temp.id(p_negocio)
$$;
-- El pedido en efectivo (o la sesion, o el pedido pagado que nacio de ella) de una clave.
create function pg_temp.pedido_de(p_key text, p_negocio text default 'A') returns text language sql as $$
  select pg_temp.foto_pedido(o.id) from public.orders o
   where o.business_id = pg_temp.id(p_negocio) and o.client_request_id = 'precio-' || p_key
$$;
create function pg_temp.sesion_de(p_key text, p_negocio text default 'A') returns text language sql as $$
  select pg_temp.foto_sesion(s.id) from public.checkout_sessions s
   where s.business_id = pg_temp.id(p_negocio) and s.client_request_id = 'precio-' || p_key
$$;
create function pg_temp.pedido_pagado_de(p_key text, p_negocio text default 'A') returns text language sql as $$
  select pg_temp.foto_pedido(s.completed_order_id) from public.checkout_sessions s
   where s.business_id = pg_temp.id(p_negocio) and s.client_request_id = 'precio-' || p_key
$$;
-- La direccion de un pedido de delivery con su punto confirmado, para cada puerta.
create function pg_temp.envio() returns jsonb language sql as $$
  select jsonb_build_object(
    'delivery_mode', 'delivery',
    'customer_street_address', 'Rio Senguer 1234',
    'customer_neighborhood', 'Centro',
    'delivery_latitude', '-38.9540', 'delivery_longitude', '-68.0600',
    'delivery_location_source', 'map_pin', 'delivery_location_confirmed_at', clock_timestamp()::text)
$$;
create function pg_temp.envio_mp() returns jsonb language sql as $$
  select jsonb_build_object(
    'fulfillment_type', 'delivery',
    'address', jsonb_build_object(
      'street', 'Rio Senguer', 'street_number', '1234', 'city', 'Neuquen', 'neighborhood', 'Centro',
      'latitude', '-38.9540', 'longitude', '-68.0600',
      'location_source', 'map_pin', 'location_confirmed_at', clock_timestamp()::text))
$$;

-- ══ 1 · LAS PUERTAS: QUIÉN PUEDE LLAMAR QUÉ ═════════════════════════════════
select ok(
  has_function_privilege('authenticated', 'public.create_order_with_items(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_order_with_items(jsonb)', 'EXECUTE'),
  'puerta manual: el pedido en efectivo lo ejecuta un cliente autenticado y nunca anon');
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_order_with_items_core', 'create_order_with_items_legacy', 'create_order_with_items_profile_v1',
                        'create_order_with_items_profile_v1_city_legacy', 'create_order_with_items_profile_v2',
                        'create_order_with_items_confirmed_location')
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'puerta manual: ninguna de sus seis capas de adentro es alcanzable por un cliente');
select ok(
  has_function_privilege('service_role', 'public.create_checkout_session(uuid, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.create_checkout_session(uuid, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_checkout_session(uuid, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.create_checkout_session_reserving(uuid, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_checkout_session_reserving(uuid, jsonb)', 'EXECUTE'),
  'puerta checkout: la sesion de pago la crea solo el servicio (la funcion Edge), en sus dos capas');

-- Por afuera de las dos puertas no hay camino: el cliente no escribe precio, stock,
-- descuento ni pedido por las tablas, ni llama a las capas de adentro.
select is(pg_temp.como_cliente(d.sentencia), d.esperado, d.que)
  from (values
    (1, format('update public.products set price = 1 where id = %L', pg_temp.id('lata')),
        '42501 permission denied for table products', 'un cliente no cambia un precio por la tabla'),
    (2, format('update public.products set stock = 999999 where id = %L', pg_temp.id('lata')),
        '42501 permission denied for table products', 'ni el stock'),
    (3, $$update public.product_combos set discount_percentage = 90 where combo_id = 'combo-precio'$$,
        '42501 permission denied for table product_combos', 'ni el descuento de un combo'),
    (4, format($$insert into public.orders(business_id,code,public_code,client_request_id,payment_method,delivery_mode,subtotal,total)
                 values (%L,'PRECIO-X','PRECIO-X','precio-directo-0001','cash','pickup',1,1)$$, pg_temp.id('A')),
        '42501 permission denied for table orders', 'ni inserta un pedido con el total que quiera'),
    (5, $$select public.create_order_with_items_core('{}'::jsonb)$$,
        '42501 permission denied for function create_order_with_items_core', 'ni llama al nucleo del alta saltando las capas de afuera'),
    (6, format($$select public.create_checkout_session(%L, '{}'::jsonb)$$, pg_temp.id('c1')),
        '42501 permission denied for function create_checkout_session', 'ni crea una sesion de pago sin pasar por la funcion Edge')
  ) d(n, sentencia, esperado, que)
 order by d.n;

-- Si mañana aparece otra funcion al alcance de un cliente que escriba pedidos, sesiones o
-- reservas, esta asercion obliga a decidir si es una tercera puerta y a probarla como a
-- estas dos. La unica que hay hoy no recibe renglones ni importes: vuelve a reservar y
-- finaliza un checkout YA PAGADO, con lo que la sesion congelo, y exige ser dueño o encargado.
select is(
  (select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f'
      and p.prosrc ~* 'insert\s+into\s+(public\.)?(orders|order_items|order_combos|checkout_sessions|checkout_session_items|checkout_session_combos|inventory_reservations)\M'
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  'recover_paid_checkout_order(p_checkout_session_id uuid)',
  'fuera de las dos puertas, la unica funcion que un cliente puede ejecutar y que escribe pedidos, sesiones o reservas es la recuperacion de un checkout ya pagado');

-- Las dos puertas deciden si un producto se vende mirando `available`. La puerta manual
-- no mira `merchant_available` ni `price_status` por su cuenta, y la de checkout no mira
-- `merchant_available`: lo que impide vender esas filas es este CHECK, que no deja que
-- `available` sea true si falta algo. Por eso se prueba que existe y, en la seccion 7,
-- que rechaza cada caso.
select ok(
  (select c.convalidated from pg_constraint c
    where c.conrelid = 'public.products'::regclass and c.conname = 'products_available_requires_verification'),
  'el CHECK que impide publicar un producto incompleto existe y esta validado: las dos puertas se apoyan en el');

-- ══ 2 · CONTROL: UNA COMPRA VÁLIDA POR CADA PUERTA ══════════════════════════
-- Si esto no pasa, ningun rechazo de mas abajo prueba nada.
insert into precio_out values ('estado_inicial', pg_temp.estado());

select is(pg_temp.manual('control-retiro', pg_temp.items('{"p":"cambia","q":2}')),
  'ok 2000.00|0.00|0.00|2000.00|ARS|Cambia de precio:2.000:1000.00:2000.00',
  'manual · retiro: 2 unidades a 1000 del catalogo = subtotal 2000, sin descuento, sin envio, total 2000 en ARS');
select isnt(pg_temp.estado(), (select v from precio_out where k = 'estado_inicial'),
  'y la foto del estado cambia cuando un pedido nace: el «nada escrito» de mas abajo no es ciego');
select is(pg_temp.checkout('control-retiro', pg_temp.items('{"p":"cambia","q":2}')),
  'ok 2000.00|0.00|0.00|2000.00|ARS|ready_for_payment|cobrar=2000.00|Cambia de precio:2:1000.00:2000.00',
  'checkout · retiro: la sesion queda lista para pagar por 2000 y eso es lo que se le va a pedir a Mercado Pago');
select is(pg_temp.stock('cambia'), '96 publicado', 'las dos puertas descontaron del mismo stock: 100 - 2 - 2');

select is(pg_temp.manual('control-envio', pg_temp.items('{"p":"lata","q":2}'), pg_temp.envio()),
  'ok 2000.00|0.00|800.00|2800.00|ARS|Lata Precio:2.000:1000.00:2000.00',
  'manual · delivery: el envio es el de la zona que resolvio el servidor (800), no los 500 del comercio; total 2800');
select is(pg_temp.checkout('control-envio', pg_temp.items('{"p":"lata","q":2}'), pg_temp.envio_mp()),
  'ok 2000.00|0.00|800.00|2800.00|ARS|ready_for_payment|cobrar=2800.00|Lata Precio:2:1000.00:2000.00',
  'checkout · delivery: mismo envio y mismo total; se van a cobrar 2800');
select is(pg_temp.stock('lata'), '496 publicado', 'stock de la lata: 500 - 2 - 2');
select is(
  (select string_agg(r.quantity::text || ' ' || r.status, ',' order by r.product_id) from public.inventory_reservations r),
  '2 active,2 active', 'cada sesion reservo exactamente lo que va a cobrar');
select is(pg_temp.pedidos('A') || ' pedidos, ' || pg_temp.sesiones('A') || ' sesiones', '2 pedidos, 2 sesiones',
  'punto de partida de A: dos pedidos en efectivo y dos sesiones de pago');

-- ══ 3 · PRECIO, TOTAL, DESCUENTO, ENVÍO Y MONEDA MANDADOS POR EL CLIENTE ════
-- Ninguna de las dos puertas tiene un lugar donde poner dinero. No se ignora: se rechaza.
-- (a) claves de dinero adentro del renglon
insert into precio_casos (seccion, puerta, clave, items, esperado, que)
select 'precio', d.puerta, 'renglon-' || k.clave,
       pg_temp.items(jsonb_build_object('p', 'lata', 'q', 2, k.clave, k.valor)),
       pg_temp.renglon_invalido(d.puerta),
       'un renglon que trae «' || k.clave || '» se rechaza: el renglon solo lleva producto y cantidad'
  from (values (1, 'price', 1), (2, 'unit_price', 1), (3, 'subtotal', 1), (4, 'discount', 1999), (5, 'total', 1)) k(n, clave, valor)
 cross join precio_puertas d
 order by k.n, d.puerta desc;
-- (b) claves de dinero en el pedido, una por una, para que cada asercion diga cual
insert into precio_casos (seccion, puerta, clave, items, extra, esperado, que)
select 'precio', d.puerta, 'pedido-' || k.clave,
       pg_temp.items('{"p":"lata","q":2}'), jsonb_build_object(k.clave, k.valor),
       '22023 campo no permitido en ' || case d.puerta when 'manual' then 'pedido' else 'checkout' end || ': ' || k.clave,
       'un pedido que trae «' || k.clave || '» = ' || k.valor::text || ' se rechaza nombrando la clave'
  from (values
    (1, 'total', '1'::jsonb), (2, 'subtotal', '1'::jsonb), (3, 'delivery_fee', '0'::jsonb),
    (4, 'discount', '1999'::jsonb), (5, 'discount_total', '1999'::jsonb), (6, 'discount_percentage', '99'::jsonb),
    (7, 'currency', '"USD"'::jsonb), (8, 'currency_code', '"USD"'::jsonb)) k(n, clave, valor)
 cross join precio_puertas d
 order by k.n, d.puerta desc;
-- (c) el mismo intento escondido adentro del contacto y de la direccion (solo la puerta checkout los tiene)
insert into precio_casos (seccion, puerta, clave, items, extra, esperado, que) values
  ('precio', 'checkout', 'contacto-discount', pg_temp.items('{"p":"lata","q":2}'),
   '{"contact": {"name": "Cliente Precio", "phone": "5492990000000", "discount": 1999}}',
   '22023 campo de contacto no permitido', 'un descuento escondido adentro de «contact» se rechaza'),
  ('precio', 'checkout', 'direccion-delivery-fee', pg_temp.items('{"p":"lata","q":2}'),
   pg_temp.envio_mp() || jsonb_build_object('address', (pg_temp.envio_mp() -> 'address') || '{"delivery_fee": 0}'),
   '22023 campo de direccion no permitido', 'un envio gratis escondido adentro de «address» se rechaza');

select is(pg_temp.comprar(c.puerta, c.clave, c.items, c.extra, c.negocio), c.esperado || ' / nada escrito', c.puerta || ' · ' || c.que)
  from precio_casos c where c.seccion = 'precio' order by c.n;

-- El envio en un pedido de delivery: mandarlo en 0 no lo abarata, lo rechaza.
select is(pg_temp.manual('envio-gratis', pg_temp.items('{"p":"lata","q":2}'), pg_temp.envio() || '{"delivery_fee": 0}'),
  '22023 campo no permitido en pedido: delivery_fee / nada escrito',
  'manual · un delivery que trae delivery_fee = 0 se rechaza: no hay envio gratis elegido por el cliente');
select is(pg_temp.checkout('envio-gratis', pg_temp.items('{"p":"lata","q":2}'), pg_temp.envio_mp() || '{"delivery_fee": 0}'),
  '22023 campo no permitido en checkout: delivery_fee / nada escrito',
  'checkout · lo mismo en la sesion de pago');

-- El medio de pago tampoco convierte un pedido en «ya pagado».
select is(
  regexp_replace(pg_temp.manual('pago-declarado', pg_temp.items('{"p":"lata","q":2}'), '{"payment_method": "mercadopago"}'),
                 'pedido \S+ declara', 'pedido <codigo> declara'),
  '23514 pedido <codigo> declara pago Mercado Pago sin intent verificado y completado / nada escrito',
  'manual · un pedido en efectivo que se declara pagado por Mercado Pago no sobrevive al COMMIT');
select is(pg_temp.manual('pago-de-prueba', pg_temp.items('{"p":"lata","q":2}'), '{"payment_method": "qa_no_charge"}'),
  '23514 new row for relation "orders" violates check constraint "orders_qa_payment_method_requires_qa_origin" / nada escrito',
  'manual · ni uno que se declara «sin cobro»: ese medio es solo de los pedidos de QA');
select is(pg_temp.checkout('pago-efectivo', pg_temp.items('{"p":"lata","q":2}'), '{"payment_method": "cash"}'),
  '22023 medio de pago invalido para Checkout Pro / nada escrito',
  'checkout · y la sesion de pago solo acepta Mercado Pago');

select is(pg_temp.stock('lata'), '496 publicado', 'ninguno de esos intentos toco el stock');
select is(pg_temp.pedidos('A') || ' pedidos, ' || pg_temp.sesiones('A') || ' sesiones', '2 pedidos, 2 sesiones',
  'ni dejo un pedido o una sesion de mas');

-- ══ 4 · DESCUENTOS Y PROMOCIONES: EL COMBO LO COTIZA Y LO COBRA EL SERVIDOR ═
-- El unico descuento que existe es el del combo, y solo en la puerta checkout.
select is(pg_temp.cotizar('combo-precio'), 'lista=1500.00|promo=1300.00|ahorro=200.00|comprable=true',
  'lo que la tienda le muestra a una persona anonima: lista 1500, promocional 1300, ahorro 200');
select is(pg_temp.checkout('combo-doble', '[{"combo_id": "combo-precio", "quantity": 2}]'),
  'ok 3000.00|400.00|0.00|2600.00|ARS|ready_for_payment|cobrar=2600.00|Agua Precio:2:500.00:1000.00,Lata Precio:2:1000.00:2000.00|combo-precio:2:10.00:1500.00:1300.00:400.00',
  'checkout · dos combos: el descuento guardado es el del catalogo (10 %, redondeado: 200 por combo) y el total 2600');
select is(pg_temp.checkout('combo-y-lata', pg_temp.items('{"combo_id": "combo-precio", "quantity": 1}', '{"p":"lata","q":1}')),
  'ok 2500.00|200.00|0.00|2300.00|ARS|ready_for_payment|cobrar=2300.00|Agua Precio:1:500.00:500.00,Lata Precio:2:1000.00:2000.00|combo-precio:1:10.00:1500.00:1300.00:200.00',
  'checkout · un combo y una lata suelta: el descuento alcanza solo al combo; la lata suelta va a precio de lista');
select is(pg_temp.pagar('combo-y-lata'),
  'ok 2500.00|200.00|0.00|2300.00|ARS|Agua Precio:1.000:500.00:500.00,Lata Precio:2.000:1000.00:2000.00|combo-precio:1:10.00:1500.00:1300.00:200.00 cobrado=2300.00',
  'pagada esa sesion, el pedido nace con el mismo subtotal, el mismo descuento y el mismo total, y es lo cobrado');
select is((select v from precio_out where k = 'preferencia:combo-y-lata'),
  'Combo Precio:1:1300.00,Lata Precio:1:1000.00 suma=2300.00 total=2300.00',
  'y las lineas que se le piden cobrar a Mercado Pago suman el total del servidor: el combo a 1300 y la lata suelta a 1000');

-- El mismo identificador en otro comercio, con otro descuento, no contamina.
select is(pg_temp.checkout('combo-de-b-mismo-id', '[{"combo_id": "combo-precio", "quantity": 1}]', '{}', 'B'),
  'ok 1000.00|900.00|0.00|100.00|ARS|ready_for_payment|cobrar=100.00|Producto de B:1:1000.00:1000.00|combo-precio:1:90.00:1000.00:100.00:900.00',
  'checkout · «combo-precio» comprado en el comercio B usa el 90 % de B; en A siempre fue el 10 % de A');
select is(pg_temp.checkout('combo-propio-de-b', '[{"combo_id": "combo-de-b", "quantity": 1}]', '{}', 'B'),
  'ok 2000.00|1000.00|0.00|1000.00|ARS|ready_for_payment|cobrar=1000.00|Producto de B:2:1000.00:2000.00|combo-de-b:1:50.00:2000.00:1000.00:1000.00',
  'checkout · control: «combo-de-b» se compra en su comercio (el rechazo de abajo es por el comercio, no por el combo)');

-- Combos que no se pueden comprar.
insert into precio_casos (seccion, puerta, clave, items, esperado, que)
select 'combo', 'checkout', k.combo, jsonb_build_array(jsonb_build_object('combo_id', k.combo, 'quantity', 1)), k.esperado, k.que
  from (values
    (1, 'combo-pendiente',  '55000 combo sin aprobacion comercial: combo-pendiente',  'un combo pendiente de aprobacion comercial no se compra'),
    (2, 'combo-suspendido', '55000 combo sin aprobacion comercial: combo-suspendido', 'un combo suspendido no se compra'),
    (3, 'combo-inactivo',   '55000 combo no disponible: combo-inactivo',              'un combo aprobado pero desactivado no se compra'),
    (4, 'combo-de-b',       '55000 combo no disponible: combo-de-b',                  'el combo de OTRO comercio no se compra en A'),
    (5, 'combo-inventado',  '55000 combo no disponible: combo-inventado',             'un combo que no existe contesta igual que el de otro comercio'),
    (6, 'combo-vacio',      '55000 combo sin componentes: combo-vacio',               'un combo sin componentes no se compra'),
    (7, 'combo-con-oculto', '55000 producto no disponible para pago: ' || pg_temp.id('no_disponible'),
                                                                                      'un combo con un componente sin publicar no se compra'),
    (8, 'combo-con-ajeno',  '55000 producto no disponible para pago: ' || pg_temp.id('de_B'),
                                                                                      'un combo de A que declara un componente de otro comercio no se compra')
  ) k(n, combo, esperado, que)
 order by k.n;
-- El cliente no manda su propio descuento ni su propio precio para un combo.
insert into precio_casos (seccion, puerta, clave, items, esperado, que)
select 'combo', 'checkout', 'combo-con-' || k.clave,
       jsonb_build_array(jsonb_build_object('combo_id', 'combo-precio', 'quantity', 1, k.clave, k.valor)),
       pg_temp.renglon_invalido('checkout'),
       'un combo que trae «' || k.clave || '» se rechaza: el combo viaja solo con su identificador y su cantidad'
  from (values (1, 'discount_percentage', 90), (2, 'promotional_price', 1), (3, 'discount_amount', 1499), (4, 'list_price', 1), (5, 'price', 1)) k(n, clave, valor)
 order by k.n;
insert into precio_casos (seccion, puerta, clave, items, esperado, que) values
  ('combo', 'checkout', 'combo-y-producto-juntos',
   jsonb_build_array(jsonb_build_object('combo_id', 'combo-precio', 'quantity', 1, 'product_id', pg_temp.id('lata'))),
   pg_temp.renglon_invalido('checkout'), 'un renglon es de producto o de combo, nunca las dos cosas'),
  ('combo', 'checkout', 'combo-cantidad-cero', '[{"combo_id": "combo-precio", "quantity": 0}]',
   pg_temp.renglon_invalido('checkout'), 'cero combos: rechazado'),
  ('combo', 'checkout', 'combo-cantidad-negativa', '[{"combo_id": "combo-precio", "quantity": -1}]',
   pg_temp.renglon_invalido('checkout'), 'una cantidad negativa de combos: rechazada'),
  ('combo', 'checkout', 'combo-cantidad-decimal', '[{"combo_id": "combo-precio", "quantity": 1.5}]',
   pg_temp.renglon_invalido('checkout'), 'un combo y medio: rechazado'),
  ('combo', 'checkout', 'combo-cantidad-101', '[{"combo_id": "combo-precio", "quantity": 101}]',
   pg_temp.renglon_invalido('checkout'), 'mas de 100 combos en un renglon: contesta el limite por renglon'),
  ('combo', 'checkout', 'combo-cantidad-sumada', '[{"combo_id": "combo-precio", "quantity": 60}, {"combo_id": "combo-precio", "quantity": 60}]',
   '22023 quantity total demasiado alta para combo', 'dos renglones del mismo combo que suman 120: contesta el limite por combo sumado'),
  -- La puerta manual no vende promociones: ahi no existe ningun descuento.
  ('combo', 'manual', 'combo-por-efectivo', '[{"combo_id": "combo-precio", "quantity": 1}]',
   pg_temp.renglon_invalido('manual'), 'un combo no se puede pedir por el pedido en efectivo'),
  ('combo', 'manual', 'combo-y-producto-por-efectivo',
   jsonb_build_array(jsonb_build_object('combo_id', 'combo-precio', 'quantity', 1, 'product_id', pg_temp.id('lata'))),
   pg_temp.renglon_invalido('manual'), 'ni colgandolo de un renglon de producto');

select is(pg_temp.comprar(c.puerta, c.clave, c.items, c.extra, c.negocio), c.esperado || ' / nada escrito', c.puerta || ' · ' || c.que)
  from precio_casos c where c.seccion = 'combo' order by c.n;

select is(pg_temp.cotizar('combo-pendiente'), 'no existe', 'para la tienda, un combo sin aprobar no existe');
select is(pg_temp.cotizar('combo-de-b'), 'no existe', 'ni el combo de otro comercio');
select is(pg_temp.stock('lata') || ' / ' || pg_temp.stock('agua'), '492 publicado / 497 publicado',
  'el stock solo lo movieron los combos aceptados: lata 496 - 2 - 2, agua 500 - 2 - 1');
select is(pg_temp.pedidos('A') || ' pedidos, ' || pg_temp.sesiones('A') || ' sesiones', '3 pedidos, 4 sesiones',
  'A: el pedido pagado del combo y las dos sesiones de combo, nada mas');

-- ══ 5 · CANTIDAD: NEGATIVA, CERO, DECIMAL, ENORME Y NULL ════════════════════
-- Producto de la prueba: un caramelo de 10, con stock 5000.
insert into precio_casos (seccion, puerta, clave, items, esperado, que)
select 'cantidad', d.puerta, 'cantidad-' || k.clave,
       pg_temp.items(jsonb_build_object('p', 'granel', 'q', k.cantidad)),
       pg_temp.renglon_invalido(d.puerta),
       'cantidad ' || k.cantidad::text || ': ' || k.que
  from (values
    (1,  'negativa',        '-1'::jsonb,                    'negativa, rechazada'),
    (2,  'cero',            '0'::jsonb,                     'cero, rechazada'),
    (3,  'decimal',         '1.5'::jsonb,                   'decimal, rechazada'),
    (4,  'uno-punto-cero',  '1.0'::jsonb,                   'un entero escrito con decimales tambien se rechaza'),
    (5,  'decimal-texto',   '"1.5"'::jsonb,                 'un decimal como texto, rechazado'),
    (6,  'exponente-texto', '"1e2"'::jsonb,                 'notacion cientifica como TEXTO, rechazada'),
    (7,  'con-espacio',     '" 2"'::jsonb,                  'un entero con un espacio adelante, rechazado'),
    (8,  'booleano',        'true'::jsonb,                  'un booleano no es una cantidad'),
    (9,  'mil-uno',         '1001'::jsonb,                  'mas de 1000 por renglon: contesta el limite por renglon'),
    (10, 'veinte-digitos',  '99999999999999999999'::jsonb,  'un numero que no entra en un entero: contesta el mismo limite, sin desbordar')
  ) k(n, clave, cantidad, que)
 cross join precio_puertas d
 order by k.n, d.puerta desc;
insert into precio_casos (seccion, puerta, clave, items, esperado, que)
select 'cantidad', d.puerta, 'cantidad-' || k.clave, k.items, k.esperado, k.que
  from precio_puertas d
 cross join lateral (values
    (1, 'ausente', jsonb_build_array(jsonb_build_object('product_id', pg_temp.id('granel'))),
        pg_temp.renglon_invalido(d.puerta), 'un renglon sin cantidad se rechaza'),
    (2, 'sumada', pg_temp.items('{"p":"granel","q":600}', '{"p":"granel","q":600}'),
        case d.puerta when 'manual' then '22023 quantity total demasiado alta para producto: ' || pg_temp.id('granel')
                      else '22023 quantity total demasiado alta para producto' end,
        'dos renglones del mismo producto que suman 1200: contesta el limite por producto sumado'),
    (3, 'carrito-vacio', '[]'::jsonb,
        '22023 items debe contener entre 1 y 100 productos', 'un carrito vacio se rechaza'),
    (4, 'ciento-un-renglones',
        (select jsonb_agg(jsonb_build_object('product_id', pg_temp.id('granel'), 'quantity', 1)) from generate_series(1, 101)),
        '22023 items debe contener entre 1 y 100 productos', 'un carrito de 101 renglones se rechaza')
  ) k(n, clave, items, esperado, que)
 order by d.puerta desc, k.n;

select is(pg_temp.comprar(c.puerta, c.clave, c.items, c.extra, c.negocio), c.esperado || ' / nada escrito', c.puerta || ' · ' || c.que)
  from precio_casos c where c.seccion = 'cantidad' order by c.n;
select is(pg_temp.stock('granel'), '5000 publicado', 'ninguna de esas cantidades toco el stock');

-- Lo que SI entra, y a cuanto se cobra.
select is(pg_temp.manual('cantidad-texto', pg_temp.items('{"p":"granel","q":"2"}')),
  'ok 20.00|0.00|0.00|20.00|ARS|Caramelo Precio:2.000:10.00:20.00',
  'manual · "2" como texto JSON se acepta como 2 unidades y se cobran 2');
select is(pg_temp.checkout('cantidad-texto', pg_temp.items('{"p":"granel","q":"2"}')),
  'ok 20.00|0.00|0.00|20.00|ARS|ready_for_payment|cobrar=20.00|Caramelo Precio:2:10.00:20.00',
  'checkout · igual');
select is(pg_temp.manual('cantidad-exponente', pg_temp.items('{"p":"granel","q":1e2}')),
  'ok 1000.00|0.00|0.00|1000.00|ARS|Caramelo Precio:100.000:10.00:1000.00',
  'manual · 1e2 como NUMERO JSON es el entero 100: se aceptan 100 unidades y se cobran 100');
select is(pg_temp.checkout('cantidad-exponente', pg_temp.items('{"p":"granel","q":1e2}')),
  'ok 1000.00|0.00|0.00|1000.00|ARS|ready_for_payment|cobrar=1000.00|Caramelo Precio:100:10.00:1000.00',
  'checkout · igual');
select is(pg_temp.manual('cantidad-mil', pg_temp.items('{"p":"granel","q":1000}')),
  'ok 10000.00|0.00|0.00|10000.00|ARS|Caramelo Precio:1000.000:10.00:10000.00',
  'manual · 1000 unidades es el maximo por renglon y entra (con el guardian apagado no hay otro tope)');
select is(pg_temp.checkout('cantidad-mil', pg_temp.items('{"p":"granel","q":1000}')),
  'ok 10000.00|0.00|0.00|10000.00|ARS|ready_for_payment|cobrar=10000.00|Caramelo Precio:1000:10.00:10000.00',
  'checkout · igual');

-- DEFECTO: PRICE-05 (P3). Una `quantity` JSON null NO la atrapa el validador de
-- renglones en ninguna de las dos puertas. Lo esperado es el mismo rechazo que las
-- demas cantidades invalidas (22023 «cada item acepta ...»). Lo que pasa hoy:
--   · sola en su producto, la frena recien una restriccion NOT NULL de la tabla, con
--     el mensaje crudo de PostgreSQL (nombra la tabla y la columna);
--   · junto a otro renglon valido del MISMO producto, se ignora en silencio: la
--     compra se acepta por la cantidad del otro renglon.
-- No hay efecto sobre el dinero: nunca se cobra de menos ni se entrega de mas.
select is(pg_temp.manual('cantidad-null', pg_temp.items('{"p":"granel","q":null}')),
  '23502 null value in column "subtotal" of relation "orders" violates not-null constraint / nada escrito',
  'DEFECTO PRICE-05 · manual · cantidad null: no la rechaza el validador sino el NOT NULL de orders.subtotal');
select is(pg_temp.checkout('cantidad-null', pg_temp.items('{"p":"granel","q":null}')),
  '23502 null value in column "quantity" of relation "checkout_session_items" violates not-null constraint / nada escrito',
  'DEFECTO PRICE-05 · checkout · cantidad null: no la rechaza el validador sino el NOT NULL de checkout_session_items.quantity');
select is(pg_temp.checkout('cantidad-null-combo', '[{"combo_id": "combo-precio", "quantity": null}]'),
  '23502 null value in column "quantity" of relation "checkout_session_items" violates not-null constraint / nada escrito',
  'DEFECTO PRICE-05 · checkout · un combo con cantidad null: mismo rechazo crudo');
select is(pg_temp.manual('cantidad-null-y-dos', pg_temp.items('{"p":"granel","q":null}', '{"p":"granel","q":2}')),
  'ok 20.00|0.00|0.00|20.00|ARS|Caramelo Precio:2.000:10.00:20.00',
  'DEFECTO PRICE-05 · manual · un renglon con cantidad null junto a otro valido del mismo producto se ignora: se aceptan y se cobran 2');
select is(pg_temp.checkout('cantidad-null-y-dos', pg_temp.items('{"p":"granel","q":null}', '{"p":"granel","q":2}')),
  'ok 20.00|0.00|0.00|20.00|ARS|ready_for_payment|cobrar=20.00|Caramelo Precio:2:10.00:20.00',
  'DEFECTO PRICE-05 · checkout · igual');
select is(pg_temp.stock('granel'), '2792 publicado',
  'el stock bajo exactamente lo aceptado: 5000 - 2 x (2 + 100 + 1000 + 2)');

-- Cantidad enorme con el guardian de admision ENCENDIDO (comercio G, tope por
-- defecto de 120 unidades por pedido sin cobrar). El guardian corre antes que el
-- validador de renglones: es el quien contesta mientras pueda contar las unidades.
select is(pg_temp.manual('guardian-121', pg_temp.items('{"p":"de_G","q":121}'), '{}', 'G', 'c3'),
  '22023 ORDER_TOO_LARGE (un pedido sin cobrar acepta hasta 120 unidades) / nada escrito',
  'manual · 121 unidades con el guardian encendido: contesta el tope de unidades del comercio');
select is(pg_temp.manual('guardian-1001', pg_temp.items('{"p":"de_G","q":1001}'), '{}', 'G', 'c3'),
  '22023 ORDER_TOO_LARGE (un pedido sin cobrar acepta hasta 120 unidades) / nada escrito',
  'manual · 1001 unidades: contesta el tope del guardian, antes que el limite de 1000 por renglon');
select is(pg_temp.manual('guardian-veinte-digitos', pg_temp.items('{"p":"de_G","q":99999999999999999999}'), '{}', 'G', 'c3'),
  '22023 cada item acepta solo product_id UUID y quantity entero / nada escrito',
  'manual · un numero de veinte digitos el guardian no lo cuenta: contesta el validador de renglones');
select is(pg_temp.manual('guardian-120', pg_temp.items('{"p":"de_G","q":120}'), '{}', 'G', 'c3'),
  'ok 1200.00|0.00|0.00|1200.00|ARS|Producto de G:120.000:10.00:1200.00',
  'manual · 120 unidades entran: el tope es inclusivo');
select is(pg_temp.checkout('guardian-121', pg_temp.items('{"p":"de_G","q":121}'), '{}', 'G', 'c3'),
  '22023 ORDER_TOO_LARGE (un pedido sin cobrar acepta hasta 120 unidades) / nada escrito',
  'checkout · 121 unidades: el mismo tope');
select is(pg_temp.checkout('guardian-1001', pg_temp.items('{"p":"de_G","q":1001}'), '{}', 'G', 'c3'),
  '22023 ORDER_TOO_LARGE (un pedido sin cobrar acepta hasta 120 unidades) / nada escrito',
  'checkout · 1001 unidades: contesta el tope del guardian');
select is(pg_temp.checkout('guardian-120', pg_temp.items('{"p":"de_G","q":120}'), '{}', 'G', 'c3'),
  'ok 1200.00|0.00|0.00|1200.00|ARS|ready_for_payment|cobrar=1200.00|Producto de G:120:10.00:1200.00',
  'checkout · 120 unidades entran');
update public.businesses set max_units_per_unpaid_order = 10 where id = pg_temp.id('G');
select is(pg_temp.manual('guardian-11', pg_temp.items('{"p":"de_G","q":11}'), '{}', 'G', 'c3'),
  '22023 ORDER_TOO_LARGE (un pedido sin cobrar acepta hasta 10 unidades) / nada escrito',
  'manual · con el tope del comercio en 10, un pedido de 11 se rechaza');
select is(pg_temp.checkout('guardian-11', pg_temp.items('{"p":"de_G","q":11}'), '{}', 'G', 'c3'),
  '22023 ORDER_TOO_LARGE (un pedido sin cobrar acepta hasta 10 unidades) / nada escrito',
  'checkout · igual');
select is(pg_temp.stock('de_G'), '4760 publicado', 'G: solo salieron las 120 + 120 aceptadas');
select is((select coalesce(sum(blocked_count), 0)::integer from private.order_intake_blocks), 0,
  'y un pedido demasiado grande no queda anotado como abuso: es una validacion');

-- ══ 6 · PRODUCTO DE OTRO COMERCIO, INEXISTENTE O MAL FORMADO ════════════════
insert into precio_casos (seccion, puerta, clave, items, esperado, que) values
  ('ajeno', 'manual', 'ajeno-de-otro', pg_temp.items('{"p":"de_B","q":1}'),
   '23503 producto inexistente para el negocio: ' || pg_temp.id('de_B'),
   'el producto de OTRO comercio no existe para este: no se compra, y no se dice que existe en otro lado'),
  ('ajeno', 'manual', 'ajeno-inventado', pg_temp.items('{"p":"inexistente","q":1}'),
   '23503 producto inexistente para el negocio: ' || pg_temp.id('inexistente'),
   'un identificador que no existe contesta exactamente igual'),
  ('ajeno', 'manual', 'ajeno-mal-formado', '[{"product_id": "no-es-un-uuid", "quantity": 1}]',
   '22P02 invalid input syntax for type uuid: "no-es-un-uuid"',
   'un identificador mal formado lo rechaza la conversion a uuid (el validador de esta puerta no mira el formato)'),
  ('ajeno', 'manual', 'ajeno-numero', '[{"product_id": 5, "quantity": 1}]',
   '22P02 invalid input syntax for type uuid: "5"', 'un numero en lugar del identificador, igual'),
  ('ajeno', 'manual', 'ajeno-null', '[{"product_id": null, "quantity": 1}]',
   '23503 producto inexistente para el negocio: <NULL>', 'un identificador null se rechaza como producto inexistente'),
  ('ajeno', 'manual', 'ajeno-mezclado', pg_temp.items('{"p":"lata","q":1}', '{"p":"de_B","q":1}'),
   '23503 producto inexistente para el negocio: ' || pg_temp.id('de_B'),
   'un carrito con un producto propio y uno ajeno se rechaza entero: la lata no queda descontada'),
  ('ajeno', 'manual', 'ajeno-comercio-inexistente', pg_temp.items('{"p":"lata","q":1}'),
   '23503 business_id inexistente', 'un comercio que no existe'),
  ('ajeno', 'checkout', 'ajeno-de-otro', pg_temp.items('{"p":"de_B","q":1}'),
   '55000 producto no disponible para pago: ' || pg_temp.id('de_B'),
   'el producto de OTRO comercio no se puede pagar en este'),
  ('ajeno', 'checkout', 'ajeno-inventado', pg_temp.items('{"p":"inexistente","q":1}'),
   '55000 producto no disponible para pago: ' || pg_temp.id('inexistente'),
   'un identificador que no existe contesta exactamente igual'),
  ('ajeno', 'checkout', 'ajeno-mal-formado', '[{"product_id": "no-es-un-uuid", "quantity": 1}]',
   pg_temp.renglon_invalido('checkout'), 'un identificador mal formado lo rechaza el validador de renglones'),
  ('ajeno', 'checkout', 'ajeno-numero', '[{"product_id": 5, "quantity": 1}]',
   pg_temp.renglon_invalido('checkout'), 'un numero en lugar del identificador, igual'),
  ('ajeno', 'checkout', 'ajeno-null', '[{"product_id": null, "quantity": 1}]',
   '55000 producto no disponible para pago: <NULL>', 'un identificador null pasa el validador y se rechaza como producto no disponible'),
  ('ajeno', 'checkout', 'ajeno-mezclado', pg_temp.items('{"p":"lata","q":1}', '{"p":"de_B","q":1}'),
   '55000 producto no disponible para pago: ' || pg_temp.id('de_B'),
   'un carrito con un producto propio y uno ajeno se rechaza entero: la lata no queda reservada'),
  ('ajeno', 'checkout', 'ajeno-comercio-inexistente', pg_temp.items('{"p":"lata","q":1}'),
   '55000 negocio no habilitado para pagos online', 'un comercio que no existe');
update precio_casos set negocio = 'X' where clave = 'ajeno-comercio-inexistente';

select is(pg_temp.comprar(c.puerta, c.clave, c.items, c.extra, c.negocio), c.esperado || ' / nada escrito', c.puerta || ' · ' || c.que)
  from precio_casos c where c.seccion = 'ajeno' order by c.n;

-- Control: ese mismo producto SI se compra en su comercio.
select is(pg_temp.manual('ajeno-en-su-casa', pg_temp.items('{"p":"de_B","q":1}'), '{}', 'B'),
  'ok 1000.00|0.00|0.00|1000.00|ARS|Producto de B:1.000:1000.00:1000.00',
  'manual · control: el producto de B se pide en B (el rechazo era por el comercio, no por el producto)');
select is(pg_temp.checkout('ajeno-en-su-casa', pg_temp.items('{"p":"de_B","q":1}'), '{}', 'B'),
  'ok 1000.00|0.00|0.00|1000.00|ARS|ready_for_payment|cobrar=1000.00|Producto de B:1:1000.00:1000.00',
  'checkout · control: y se paga en B');
select is(pg_temp.stock('lata') || ' / ' || pg_temp.stock('de_B'), '492 publicado / 45 publicado',
  'la lata de A no se movio; de B salieron solo sus propias ventas (50 - 1 - 2 de sus combos - 1 - 1)');

-- ══ 7 · PRODUCTO OCULTO, SIN PRECIO O SIN STOCK ═════════════════════════════
-- Una bandera por producto. Primero, que la fila «publicada pero incompleta» no puede
-- existir: las puertas miran `available`, y el CHECK no deja ponerlo en true si falta algo.
select is(pg_temp.catalogo(format('update public.products set available = true where id = %L', pg_temp.id(k.clave))),
          '23514 products_available_requires_verification',
          'no se puede publicar un producto ' || k.que)
  from (values
    (1, 'pausado',          'que el comercio dejo de ofrecer (merchant_available = false)'),
    (2, 'sin_verificar',    'sin verificar (is_verified = false)'),
    (3, 'inactivo',         'inactivo (is_active = false)'),
    (4, 'precio_pendiente', 'con el precio pendiente de confirmar (price_status = pending)'),
    (5, 'precio_cero',      'con precio cero'),
    (6, 'sin_stock',        'con stock 0'),
    (7, 'stock_nulo',       'con el stock sin cargar')
  ) k(n, clave, que)
 order by k.n;
select is(pg_temp.catalogo(format('update public.products set price = null where id = %L', pg_temp.id('precio_cero'))),
  '23502 price', 'y un producto no puede quedar sin precio: la columna no admite NULL');
select is(pg_temp.catalogo(format('update public.products set price = -1 where id = %L', pg_temp.id('precio_cero'))),
  '23514 products_price_check', 'ni con un precio negativo');
select is(pg_temp.catalogo(format('update public.products set stock = -1 where id = %L', pg_temp.id('sin_stock'))),
  '23514 products_stock_nonnegative', 'ni con stock negativo');

insert into precio_casos (seccion, puerta, clave, items, esperado, que)
select 'oculto', d.puerta, 'oculto-' || replace(k.clave, '_', '-'),
       pg_temp.items(jsonb_build_object('p', k.clave, 'q', 1)),
       pg_temp.no_se_vende(d.puerta, k.clave), k.que
  from (values
    (1, 'no_disponible',    'producto oculto (available = false): no se compra'),
    (2, 'pausado',          'producto que el comercio dejo de ofrecer (merchant_available = false): no se compra'),
    (3, 'sin_verificar',    'producto sin verificar (is_verified = false): no se compra'),
    (4, 'inactivo',         'producto inactivo (is_active = false): no se compra'),
    (5, 'precio_pendiente', 'producto SIN PRECIO confirmado (price_status = pending): no se compra'),
    (6, 'precio_cero',      'producto con PRECIO CERO: no se compra (no existe la compra gratis)'),
    (7, 'sin_stock',        'producto SIN STOCK (stock 0): no se compra'),
    (8, 'stock_nulo',       'producto con el stock sin cargar: no se compra')
  ) k(n, clave, que)
 cross join precio_puertas d
 order by k.n, d.puerta desc;
insert into precio_casos (seccion, puerta, clave, items, esperado, que)
select 'oculto', d.puerta, 'oculto-mezclado', pg_temp.items('{"p":"lata","q":1}', '{"p":"no_disponible","q":1}'),
       pg_temp.no_se_vende(d.puerta, 'no_disponible'),
       'un carrito con un producto visible y uno oculto se rechaza entero'
  from precio_puertas d
 order by d.puerta desc;
-- El producto esta bien; lo que no recibe pedidos es su comercio.
insert into precio_casos (seccion, puerta, clave, negocio, items, esperado, que)
select 'oculto', d.puerta, 'comercio-' || lower(k.negocio), k.negocio,
       pg_temp.items(jsonb_build_object('p', 'de_' || k.negocio, 'q', 1)),
       case d.puerta when 'manual' then '55000 el negocio no esta habilitado para recibir pedidos'
                     else '55000 negocio no habilitado para pagos online' end,
       'producto publicado de un comercio ' || k.que || ': no se compra'
  from (values
    (1, 'C', 'CERRADO (status = closed)'),
    (2, 'P', 'en pausa (status = paused)'),
    (3, 'D', 'con los pedidos apagados (ordering_enabled = false)'),
    (4, 'U', 'SIN VERIFICAR (ordering_verified = false)'),
    (5, 'I', 'dado de baja (is_active = false)')
  ) k(n, negocio, que)
 cross join precio_puertas d
 order by k.n, d.puerta desc;

select is(pg_temp.comprar(c.puerta, c.clave, c.items, c.extra, c.negocio), c.esperado || ' / nada escrito', c.puerta || ' · ' || c.que)
  from precio_casos c where c.seccion = 'oculto' order by c.n;

-- Control: abierto el comercio C, el mismo producto se compra por las dos puertas.
update public.businesses set status = 'open' where id = pg_temp.id('C');
select is(pg_temp.manual('comercio-c-abierto', pg_temp.items('{"p":"de_C","q":1}'), '{}', 'C'),
  'ok 1000.00|0.00|0.00|1000.00|ARS|Producto de C:1.000:1000.00:1000.00',
  'manual · control: con el comercio C abierto el pedido entra (lo unico que lo frenaba era el estado del comercio)');
select is(pg_temp.checkout('comercio-c-abierto', pg_temp.items('{"p":"de_C","q":1}'), '{}', 'C'),
  'ok 1000.00|0.00|0.00|1000.00|ARS|ready_for_payment|cobrar=1000.00|Producto de C:1:1000.00:1000.00',
  'checkout · control: y la sesion de pago tambien');
select is(
  (select string_agg(concat_ws(' ', k, pg_temp.stock(k)), ', ' order by n)
     from unnest(array['no_disponible', 'pausado', 'sin_verificar', 'inactivo', 'precio_pendiente', 'precio_cero', 'sin_stock', 'stock_nulo', 'lata'])
          with ordinality as t(k, n)),
  'no_disponible 10 oculto, pausado 10 oculto, sin_verificar 10 oculto, inactivo 10 oculto, precio_pendiente 10 oculto, '
  || 'precio_cero 10 oculto, sin_stock 0 oculto, stock_nulo sin cargar oculto, lata 492 publicado',
  'ningun producto oculto, sin precio o sin stock se movio, ni la lata de los carritos mezclados');

-- ══ 8 · LAS ÚLTIMAS UNIDADES ════════════════════════════════════════════════
-- Un producto con 3 en stock para cada puerta.
select is(pg_temp.manual('ultimas-de-mas', pg_temp.items('{"p":"ultimas","q":4}')),
  '23514 stock insuficiente para producto: ' || pg_temp.id('ultimas') || ' / nada escrito',
  'manual · pedir 4 habiendo 3: stock insuficiente');
select is(pg_temp.manual('ultimas-sumadas', pg_temp.items('{"p":"ultimas","q":2}', '{"p":"ultimas","q":2}')),
  '23514 stock insuficiente para producto: ' || pg_temp.id('ultimas') || ' / nada escrito',
  'manual · dos renglones de 2 habiendo 3: se suman antes de mirar el stock');
select is(pg_temp.manual('ultimas-justas', pg_temp.items('{"p":"ultimas","q":3}')),
  'ok 3000.00|0.00|0.00|3000.00|ARS|Ultimas unidades:3.000:1000.00:3000.00',
  'manual · pedir las 3 que quedan: entra');
select is(pg_temp.stock('ultimas'), '0 oculto', 'manual · el stock queda exactamente en 0 y el producto sale de la tienda');
select is(pg_temp.manual('ultimas-una-mas', pg_temp.items('{"p":"ultimas","q":1}')),
  '55000 producto no disponible: ' || pg_temp.id('ultimas') || ' / nada escrito',
  'manual · el pedido siguiente, de una sola unidad, se rechaza');

select is(pg_temp.checkout('ultimas-de-mas', pg_temp.items('{"p":"ultimas_mp","q":4}')),
  '23514 stock insuficiente para producto: ' || pg_temp.id('ultimas_mp') || ' / nada escrito',
  'checkout · pagar 4 habiendo 3: stock insuficiente');
select is(pg_temp.checkout('ultimas-sumadas', pg_temp.items('{"p":"ultimas_mp","q":2}', '{"p":"ultimas_mp","q":2}')),
  '23514 stock insuficiente para producto: ' || pg_temp.id('ultimas_mp') || ' / nada escrito',
  'checkout · dos renglones de 2 habiendo 3: se suman antes de mirar el stock');
select is(pg_temp.checkout('ultimas-justas', pg_temp.items('{"p":"ultimas_mp","q":3}')),
  'ok 3000.00|0.00|0.00|3000.00|ARS|ready_for_payment|cobrar=3000.00|Ultimas unidades MP:3:1000.00:3000.00',
  'checkout · reservar las 3 que quedan: entra');
select is(pg_temp.stock('ultimas_mp'), '0 oculto', 'checkout · el stock queda exactamente en 0 y el producto sale de la tienda');
select is(pg_temp.checkout('ultimas-una-mas', pg_temp.items('{"p":"ultimas_mp","q":1}')),
  '55000 producto no disponible para pago: ' || pg_temp.id('ultimas_mp') || ' / nada escrito',
  'checkout · la sesion siguiente, de una sola unidad, se rechaza');
select is(pg_temp.manual('ultimas-reservadas', pg_temp.items('{"p":"ultimas_mp","q":1}')),
  '55000 producto no disponible: ' || pg_temp.id('ultimas_mp') || ' / nada escrito',
  'manual · y lo reservado por una sesion de pago tampoco se puede pedir en efectivo: las dos puertas comparten el stock');

-- ══ 9 · EL PRECIO DEL CATÁLOGO CAMBIA ═══════════════════════════════════════
-- «Cambia de precio» valia 1000 en las dos compras de control. Pasa a 1500.
update public.products set price = 1500 where id = pg_temp.id('cambia');
select is(
  (select concat_ws(' ', p.price, case when p.is_verified then 'verificado' else 'sin verificar' end, pg_temp.stock('cambia'))
     from public.products p where p.id = pg_temp.id('cambia')),
  '1500.00 sin verificar 96 oculto',
  'cambiar el precio de un producto verificado lo despublica hasta que alguien lo vuelva a verificar');
select is(pg_temp.manual('cambio-sin-verificar', pg_temp.items('{"p":"cambia","q":2}')),
  '55000 producto no disponible: ' || pg_temp.id('cambia') || ' / nada escrito',
  'manual · mientras tanto no se vende: ni al precio viejo ni al nuevo');
select is(pg_temp.checkout('cambio-sin-verificar', pg_temp.items('{"p":"cambia","q":2}')),
  '55000 producto no disponible para pago: ' || pg_temp.id('cambia') || ' / nada escrito',
  'checkout · igual');

update public.products set is_verified = true, verified_at = now(), verified_by = pg_temp.id('owner'), available = true
 where id = pg_temp.id('cambia');
select is(pg_temp.manual('cambio-nuevo', pg_temp.items('{"p":"cambia","q":2}')),
  'ok 3000.00|0.00|0.00|3000.00|ARS|Cambia de precio:2.000:1500.00:3000.00',
  'manual · verificado otra vez, un pedido NUEVO usa el precio nuevo: 2 x 1500 = 3000');
select is(pg_temp.checkout('cambio-nuevo', pg_temp.items('{"p":"cambia","q":2}')),
  'ok 3000.00|0.00|0.00|3000.00|ARS|ready_for_payment|cobrar=3000.00|Cambia de precio:2:1500.00:3000.00',
  'checkout · y una sesion nueva tambien');

-- Lo que ya estaba pedido conserva su precio.
select is(pg_temp.pedido_de('control-retiro'), '2000.00|0.00|0.00|2000.00|ARS|Cambia de precio:2.000:1000.00:2000.00',
  'manual · el primer pedido sigue en 1000 por unidad (leido de orders y order_items)');
select is(pg_temp.sesion_de('control-retiro'),
  '2000.00|0.00|0.00|2000.00|ARS|ready_for_payment|cobrar=2000.00|Cambia de precio:2:1000.00:2000.00',
  'checkout · la primera sesion tambien, y lo que se va a cobrar sigue siendo 2000');
select is(pg_temp.manual('control-retiro', pg_temp.items('{"p":"cambia","q":2}')),
  'ok 2000.00|0.00|0.00|2000.00|ARS|Cambia de precio:2.000:1000.00:2000.00',
  'manual · reenviar el MISMO pedido despues del cambio devuelve el original: no lo recalcula al precio nuevo');
select is(pg_temp.checkout('control-retiro', pg_temp.items('{"p":"cambia","q":2}')),
  'ok 2000.00|0.00|0.00|2000.00|ARS|ready_for_payment|cobrar=2000.00|Cambia de precio:2:1000.00:2000.00',
  'checkout · reenviar la misma sesion, igual');
select is(pg_temp.stock('cambia'), '92 publicado', 'y los dos reenvios no descontaron nada: 96 - 2 - 2 de las compras nuevas');
select is(pg_temp.manual('control-retiro', pg_temp.items('{"p":"cambia","q":3}')),
  '23505 client_request_id reutilizado con un payload diferente / nada escrito',
  'manual · reusar la clave del primer pedido con otra cantidad se rechaza: no hay forma de reescribirlo');
select is(pg_temp.checkout('control-retiro', pg_temp.items('{"p":"cambia","q":3}')),
  '23505 client_request_id reutilizado con un checkout diferente / nada escrito',
  'checkout · igual con la sesion');

-- La sesion creada ANTES del cambio se paga DESPUES: se cobra y nace con el precio que la persona vio.
select is(pg_temp.pagar('control-retiro'),
  'ok 2000.00|0.00|0.00|2000.00|ARS|Cambia de precio:2.000:1000.00:2000.00 cobrado=2000.00',
  'checkout · la sesion vieja, pagada despues del cambio, nace como pedido a 1000 por unidad y se cobran 2000');
select is(pg_temp.pagar('cambio-nuevo'),
  'ok 3000.00|0.00|0.00|3000.00|ARS|Cambia de precio:2.000:1500.00:3000.00 cobrado=3000.00',
  'checkout · la sesion nueva nace como pedido a 1500 por unidad y se cobran 3000');

-- La promocion tambien se congela. El combo pasa del 10 % al 20 %.
update public.product_combos set discount_percentage = 20 where id = 'e9100000-0000-4000-8000-0000000000e1';
select is(pg_temp.cotizar('combo-precio'), 'lista=1500.00|promo=1200.00|ahorro=300.00|comprable=true',
  'la tienda cotiza el combo con el descuento nuevo: 20 % de 1500');
select is(pg_temp.checkout('combo-nuevo', '[{"combo_id": "combo-precio", "quantity": 1}]'),
  'ok 1500.00|300.00|0.00|1200.00|ARS|ready_for_payment|cobrar=1200.00|Agua Precio:1:500.00:500.00,Lata Precio:1:1000.00:1000.00|combo-precio:1:20.00:1500.00:1200.00:300.00',
  'checkout · una sesion nueva guarda el descuento nuevo: 300');
select is(pg_temp.pedido_pagado_de('combo-y-lata'),
  '2500.00|200.00|0.00|2300.00|ARS|Agua Precio:1.000:500.00:500.00,Lata Precio:2.000:1000.00:2000.00|combo-precio:1:10.00:1500.00:1300.00:200.00',
  'el pedido que ya se habia pagado con el combo al 10 % conserva sus 200 de descuento');
select is(pg_temp.pagar('combo-doble'),
  'ok 3000.00|400.00|0.00|2600.00|ARS|Agua Precio:2.000:500.00:1000.00,Lata Precio:2.000:1000.00:2000.00|combo-precio:2:10.00:1500.00:1300.00:400.00 cobrado=2600.00',
  'y la sesion de dos combos creada al 10 %, pagada ahora, nace con el descuento que la persona vio: 400');

-- Al final, la cuenta cierra en todo lo que se creo.
select is(
  (select string_agg(n.clave || '=' || pg_temp.pedidos(n.clave), ' ' order by n.clave)
     from unnest(array['A', 'B', 'C', 'G']) n(clave)),
  'A=12 B=1 C=1 G=1', 'pedidos que existen al final, por comercio');
select is(
  (select count(*)::integer from public.orders o
    where o.business_id in (select id from precio_ids)
      and (o.subtotal is distinct from (select sum(i.subtotal) from public.order_items i where i.order_id = o.id)
        or o.discount_total is distinct from coalesce((select sum(c.discount_amount) from public.order_combos c where c.order_id = o.id), 0)
        or o.total is distinct from o.subtotal - o.discount_total + o.delivery_fee
        or o.currency_code is distinct from 'ARS'
        or exists (select 1 from public.order_items i
                    where i.order_id = o.id and i.subtotal is distinct from i.quantity * i.unit_price))),
  0, 'en todos: subtotal = suma de renglones, descuento = suma de combos, total = subtotal - descuento + envio, moneda del comercio');
select is(
  (select count(*)::integer from public.checkout_sessions s
    where s.business_id in (select id from precio_ids)
      and (s.subtotal is distinct from (select sum(i.subtotal) from public.checkout_session_items i where i.checkout_session_id = s.id)
        or s.discount_total is distinct from coalesce((select sum(c.discount_amount) from public.checkout_session_combos c where c.checkout_session_id = s.id), 0)
        or s.total is distinct from s.subtotal - s.discount_total + s.delivery_fee
        or s.total is distinct from (select pi.expected_amount from public.payment_intents pi where pi.checkout_session_id = s.id))),
  0, 'y en todas las sesiones de pago, ademas de que lo que se pide cobrar es el total de la sesion');

-- Lo que el COMMIT verificaria con todo lo anterior hecho.
select lives_ok($$set constraints all immediate$$, 'los resguardos diferidos aceptan todo lo que quedo creado');

select * from finish();
rollback;
