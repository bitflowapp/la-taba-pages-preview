-- TABA · EL GUARDIÁN DE ADMISIÓN DE PEDIDOS
--
-- El pedido en efectivo no tenía ningún límite: una identidad anónima podía crear
-- pedidos sin tope y cada uno descuenta stock al nacer. Acá se prueba el guardián
-- que ahora consultan las dos puertas (pedido manual y sesión de checkout):
--
--   · un pedido normal y varios pedidos razonables pasan;
--   · un reintento idempotente no se cuenta ni se frena;
--   · rotar `client_request_id` no esquiva nada;
--   · topes por cliente (pendientes y ventana), por origen de red y por negocio;
--   · el origen sale de `cf-connecting-ip`; un `x-forwarded-for` elegido por el
--     cliente no cambia el resultado;
--   · un freno por PostgREST queda ANOTADO (la transacción se confirma con 429);
--   · quien sigue golpeando entra en enfriamiento;
--   · modo `monitor` anota y deja pasar; modo `off` no evalúa;
--   · si el guardián falla, el pedido sigue (falla abierta);
--   · los dos canales salen del mismo cupo.
--
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(62);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table guard_ids (name text primary key, id uuid not null) on commit drop;

do $fixture$
declare
  v_business uuid := 'b7000000-0000-4000-8000-0000000000a1';
  v_product uuid := 'c7000000-0000-4000-8000-0000000000a1';
  v_owner uuid := 'a7000000-0000-4000-8000-0000000000ff';
  i integer;
  v_user uuid;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_owner,'authenticated','authenticated','guardia-owner@example.invalid','',now(),'{}','{}',now(),now());
  for i in 1..40 loop
    v_user := ('a7000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
    values (v_user,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());
    insert into guard_ids values ('c' || i, v_user);
  end loop;

  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal
  ) values (
    v_business, 'TABA guardia de admision', 'taba-guardia-de-admision', 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00
  );
  insert into public.business_members (business_id, user_id, role, is_active) values (v_business, v_owner, 'owner', true);

  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_product,v_business,'Lata Guardia','Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    100000,true,true,false,'{}',true,now(),v_owner,'guardia-sku','guardia-sku','commercial',1);
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'collector-guardia', 'app-guardia', clock_timestamp(), clock_timestamp());
  insert into guard_ids values ('business', v_business), ('product', v_product);
end
$fixture$;

-- Un pedido de retiro en efectivo por el contrato del cliente. Devuelve lo que
-- devolvió la función, o el error con su SQLSTATE y su detalle.
create function pg_temp.pedir(p_customer text, p_key text, p_quantity integer default 1, p_extra jsonb default '{}'::jsonb)
returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
  v_detail text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from guard_ids where name = p_customer), 'role', 'authenticated')::text, true);
  begin
    v_result := public.create_order_with_items(jsonb_build_object(
      'business_id', (select id from guard_ids where name = 'business'),
      'client_request_id', p_key,
      'tracking_token', md5(p_key) || md5(p_key || 'guardia'),
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', (select id from guard_ids where name = 'product'), 'quantity', p_quantity)),
      'customer_name', 'Cliente Guardia',
      'customer_phone', '2996209137',
      'delivery_mode', 'pickup',
      'payment_method', 'cash'
    ) || p_extra);
    return jsonb_build_object('ok', v_result ? 'id', 'id', v_result ->> 'id', 'body', v_result - 'order_items');
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return jsonb_build_object('ok', false, 'sqlstate', sqlstate, 'message', sqlerrm, 'detail', v_detail);
  end;
end;
$$;

create function pg_temp.checkout(p_customer text, p_key text, p_quantity integer default 1)
returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
  v_detail text;
begin
  begin
    v_result := public.create_checkout_session((select id from guard_ids where name = p_customer), jsonb_build_object(
      'business_id', (select id from guard_ids where name = 'business'),
      'client_request_id', p_key,
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', (select id from guard_ids where name = 'product'), 'quantity', p_quantity)),
      'fulfillment_type', 'pickup',
      'contact', jsonb_build_object('name', 'Cliente Guardia', 'phone', '5492990000000'),
      'age_confirmed', false, 'payment_method', 'mercadopago'));
    return jsonb_build_object('ok', v_result ? 'checkout_session_id', 'id', v_result ->> 'checkout_session_id', 'body', v_result - 'items');
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return jsonb_build_object('ok', false, 'sqlstate', sqlstate, 'message', sqlerrm, 'detail', v_detail);
  end;
end;
$$;

-- El comercio atiende lo pendiente: deja de contar como «sin atender».
create function pg_temp.atender_todo() returns void language sql as $$
  update public.orders set status = 'accepted'
   where business_id = (select id from guard_ids where name = 'business') and status in ('received', 'submitted');
$$;

create function pg_temp.limites(p_patch jsonb) returns void language plpgsql as $$
begin
  update public.businesses b
     set order_intake_guard_mode = coalesce(p_patch ->> 'mode', 'enforce'),
         order_rate_limit_per_10_minutes = (p_patch ->> 'customer_rate')::integer,
         max_pending_orders_per_customer = (p_patch ->> 'customer_pending')::integer,
         order_ip_rate_limit_per_10_minutes = (p_patch ->> 'ip_rate')::integer,
         max_pending_orders_per_ip = (p_patch ->> 'ip_pending')::integer,
         order_business_rate_limit_per_10_minutes = (p_patch ->> 'business_rate')::integer,
         max_units_per_unpaid_order = (p_patch ->> 'units')::integer
   where b.id = (select id from guard_ids where name = 'business');
end;
$$;

create function pg_temp.frenos() returns integer language sql as $$
  select coalesce(sum(blocked_count), 0)::integer from private.order_intake_blocks
   where business_id = (select id from guard_ids where name = 'business');
$$;

-- ══ 1 · CONTRATO Y PRIVILEGIOS ══════════════════════════════════════════════
select ok(
  has_function_privilege('authenticated', 'public.create_order_with_items(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_order_with_items(jsonb)', 'EXECUTE'),
  'el alta de pedido la ejecuta un cliente autenticado y nunca anon');

select ok(
  not has_function_privilege('authenticated', 'public.create_order_with_items_confirmed_location(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_order_with_items_confirmed_location(jsonb)', 'EXECUTE'),
  'la capa anterior del alta deja de ser alcanzable por un cliente: no hay camino que saltee al guardian');

select ok(
  not has_function_privilege('authenticated', 'public.create_checkout_session(uuid, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.create_checkout_session_reserving(uuid, jsonb)', 'EXECUTE'),
  'el alta de checkout sigue siendo solo del servicio, en sus dos capas');

select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname like 'order\_intake\_%'
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'ninguna funcion del guardian es ejecutable por roles de cliente');

select ok(
  not has_table_privilege('authenticated', 'private.order_intake_log', 'SELECT')
  and not has_table_privilege('authenticated', 'private.order_intake_blocks', 'SELECT')
  and not has_table_privilege('authenticated', 'private.order_intake_secret', 'SELECT'),
  'el rastro, los frenos y la sal no son legibles por un cliente');

select ok(
  not has_column_privilege('authenticated', 'public.businesses', 'order_intake_guard_mode', 'UPDATE')
  and has_column_privilege('authenticated', 'public.businesses', 'max_units_per_unpaid_order', 'UPDATE'),
  'el dueno afina los limites, pero apagar el guardian es de la plataforma');

-- ══ 2 · UN PEDIDO NORMAL Y VARIOS RAZONABLES ════════════════════════════════
select ok((pg_temp.pedir('c1', 'guardia-normal-0001') ->> 'ok')::boolean, 'un pedido normal entra');

select is(
  (select count(*)::integer from private.order_intake_log l
    where l.business_id = (select id from guard_ids where name = 'business') and l.channel = 'manual' and l.order_id is not null),
  1, 'y deja una fila de admision atada a su pedido');

select is(
  (select count(*)::integer from generate_series(2, 6) g
    where (pg_temp.pedir('c' || g, 'guardia-razonable-' || lpad(g::text, 4, '0')) ->> 'ok')::boolean),
  5, 'cinco pedidos razonables de cinco clientes entran los cinco');

select is(pg_temp.frenos(), 0, 'y nadie fue frenado');

-- ══ 3 · EL REINTENTO IDEMPOTENTE NO ES UNA ADMISIÓN NUEVA ═══════════════════
select is(
  pg_temp.pedir('c1', 'guardia-normal-0001') ->> 'id',
  (select o.id::text from public.orders o where o.client_request_id = 'guardia-normal-0001'),
  'el mismo pedido reenviado devuelve el mismo pedido');

select is(
  (select count(*)::integer from private.order_intake_log l
    where l.order_id = (select o.id from public.orders o where o.client_request_id = 'guardia-normal-0001')),
  1, 'y no suma una segunda admision');

select pg_temp.limites('{"customer_pending": 1}');
select ok(
  (pg_temp.pedir('c1', 'guardia-normal-0001') ->> 'ok')::boolean,
  'con el cupo de pendientes ya agotado, el reintento del pedido existente igual se responde');

-- ══ 4 · PENDIENTES POR CLIENTE ══════════════════════════════════════════════
select pg_temp.limites('{"customer_pending": 3}');
select pg_temp.atender_todo();
select is(
  (select count(*)::integer from generate_series(1, 3) g
    where (pg_temp.pedir('c7', 'guardia-pendiente-' || lpad(g::text, 4, '0')) ->> 'ok')::boolean),
  3, 'un cliente puede tener tres pedidos sin atender cuando el tope es tres');

select is(
  pg_temp.pedir('c7', 'guardia-pendiente-0004') - 'ok',
  '{"sqlstate": "PT429", "message": "ORDER_RATE_LIMITED", "detail": "customer_pending"}'::jsonb,
  'el cuarto se frena con PT429 y dice por que, aunque traiga una clave nueva');

select is(
  (select stock from public.products where id = (select id from guard_ids where name = 'product')),
  100000 - 9, 'el pedido frenado no toco el stock');

select pg_temp.atender_todo();
select ok(
  (pg_temp.pedir('c7', 'guardia-pendiente-0005') ->> 'ok')::boolean,
  'cuando el comercio atiende los anteriores, el cliente vuelve a pedir');

-- ══ 5 · VENTANA POR CLIENTE ═════════════════════════════════════════════════
select pg_temp.limites('{"customer_rate": 4, "customer_pending": 1000}');
select pg_temp.atender_todo();
select is(
  (select count(*)::integer from generate_series(1, 4) g
    where (pg_temp.pedir('c8', 'guardia-ventana-' || lpad(g::text, 4, '0')) ->> 'ok')::boolean),
  4, 'cuatro pedidos en la ventana pasan cuando el tope es cuatro');

select is(
  pg_temp.pedir('c8', 'guardia-ventana-0005') ->> 'detail', 'customer_rate',
  'el quinto en la misma ventana se frena por ritmo');

select ok(
  (pg_temp.pedir('c9', 'guardia-ventana-otro-0001') ->> 'ok')::boolean,
  'el freno es de ese cliente: otro cliente sigue pidiendo');

-- ══ 6 · ORIGEN DE RED ═══════════════════════════════════════════════════════
select pg_temp.limites('{"ip_rate": 3, "customer_pending": 1000, "ip_pending": 1000}');
select set_config('request.headers', '{"cf-connecting-ip": "203.0.113.10", "x-forwarded-for": "203.0.113.10"}', true);
select is(
  (select count(*)::integer from generate_series(10, 12) g
    where (pg_temp.pedir('c' || g, 'guardia-origen-' || lpad(g::text, 4, '0')) ->> 'ok')::boolean),
  3, 'tres clientes distintos desde el mismo origen pasan cuando el tope por origen es tres');

select is(
  pg_temp.pedir('c13', 'guardia-origen-0013') ->> 'detail', 'ip_rate',
  'el cuarto cliente desde el mismo origen se frena: rotar de identidad no alcanza');

select set_config('request.headers', '{"cf-connecting-ip": "203.0.113.10", "x-forwarded-for": "198.51.100.77, 203.0.113.10", "sb-forwarded-for": "198.51.100.77"}', true);
select is(
  pg_temp.pedir('c13', 'guardia-origen-0013') ->> 'detail', 'ip_rate',
  'inventar x-forwarded-for y sb-forwarded-for no cambia el origen: solo cuenta cf-connecting-ip');

select set_config('request.headers', '{"cf-connecting-ip": "203.0.113.11"}', true);
select ok(
  (pg_temp.pedir('c13', 'guardia-origen-0013') ->> 'ok')::boolean,
  'desde otro origen real el mismo cliente si entra');

select set_config('request.headers', '{"x-forwarded-for": "203.0.113.10"}', true);
select ok(
  (pg_temp.pedir('c14', 'guardia-origen-0014') ->> 'ok')::boolean,
  'sin cf-connecting-ip la dimension de origen se saltea: no se usa un dato que el cliente elige');

select is(
  (select l.fingerprint_hash is null from private.order_intake_log l
    where l.order_id = (select o.id from public.orders o where o.client_request_id = 'guardia-origen-0014')),
  true, 'y esa admision queda sin huella de origen');

select ok(
  (select bool_and(octet_length(l.fingerprint_hash) = 32) and count(distinct l.fingerprint_hash) = 1
     from private.order_intake_log l
     join public.orders o on o.id = l.order_id
    where o.client_request_id in ('guardia-origen-0010', 'guardia-origen-0011', 'guardia-origen-0012')),
  'lo que se guarda del origen es un HMAC de 32 bytes, el mismo para la misma direccion');

select is(
  (select count(*)::integer from private.order_intake_log l
    where encode(l.fingerprint_hash, 'escape') like '%203.0.113%'),
  0, 'la direccion no se guarda en ningun lado');

select set_config('request.headers', '{"cf-connecting-ip": "2001:db8:aaaa:bbbb:1111:2222:3333:4444"}', true);
select set_config('taba.test_v6_a', encode(private.order_intake_client_fingerprint(), 'hex'), true);
select set_config('request.headers', '{"cf-connecting-ip": "2001:db8:aaaa:bbbb:ffff:eeee:dddd:cccc"}', true);
select is(
  encode(private.order_intake_client_fingerprint(), 'hex'), current_setting('taba.test_v6_a', true),
  'dos direcciones IPv6 del mismo /64 son el mismo origen');
select set_config('request.headers', '{"cf-connecting-ip": "2001:db8:aaaa:cccc:1111:2222:3333:4444"}', true);
select isnt(
  encode(private.order_intake_client_fingerprint(), 'hex'), current_setting('taba.test_v6_a', true),
  'y otro /64 es otro origen');
select set_config('request.headers', '{"cf-connecting-ip": "no-es-una-ip"}', true);
select is(private.order_intake_client_fingerprint(), null, 'un encabezado ilegible no rompe nada: no hay huella');
select set_config('request.headers', '', true);

-- Pendientes por origen.
select pg_temp.limites('{"ip_pending": 2, "customer_pending": 1000}');
select pg_temp.atender_todo();
select set_config('request.headers', '{"cf-connecting-ip": "203.0.113.20"}', true);
select is(
  (select count(*)::integer from generate_series(15, 16) g
    where (pg_temp.pedir('c' || g, 'guardia-origen-pend-' || lpad(g::text, 4, '0')) ->> 'ok')::boolean),
  2, 'dos pedidos sin atender desde un origen pasan cuando el tope es dos');
select is(
  pg_temp.pedir('c17', 'guardia-origen-pend-0017') ->> 'detail', 'ip_pending',
  'el tercero sin atender desde ese origen se frena');
select set_config('request.headers', '', true);

-- ══ 7 · TECHO POR NEGOCIO ═══════════════════════════════════════════════════
select pg_temp.atender_todo();
select pg_temp.limites(jsonb_build_object('customer_pending', 1000, 'business_rate',
  (select count(*) + 2 from public.orders
    where business_id = (select id from guard_ids where name = 'business'))));
select is(
  (select count(*)::integer from generate_series(18, 19) g
    where (pg_temp.pedir('c' || g, 'guardia-negocio-' || lpad(g::text, 4, '0')) ->> 'ok')::boolean),
  2, 'el negocio admite hasta su techo por ventana');
select is(
  pg_temp.pedir('c20', 'guardia-negocio-0020') ->> 'detail', 'business_rate',
  'pasado el techo se frena hasta a un cliente nuevo y sin historia');

-- ══ 8 · UN FRENO POR POSTGREST QUEDA ANOTADO ════════════════════════════════
select pg_temp.limites('{"customer_pending": 1}');
select pg_temp.atender_todo();
select ok((pg_temp.pedir('c21', 'guardia-api-0001') ->> 'ok')::boolean, 'un pedido pendiente del cliente 21');
select set_config('taba.test_frenos_antes', pg_temp.frenos()::text, true);
select set_config('request.method', 'POST', true);
select is(
  pg_temp.pedir('c21', 'guardia-api-0002') -> 'body',
  '{"code": "PT429", "message": "ORDER_RATE_LIMITED", "details": "customer_pending", "hint": "esperar a que el comercio confirme los pedidos anteriores"}'::jsonb,
  'por PostgREST el freno NO es una excepcion: devuelve el mismo cuerpo que un error');
select is(current_setting('response.status', true), '429', 'con estado HTTP 429');
select is(current_setting('response.headers', true)::jsonb, '[{"Retry-After": "120"}]'::jsonb, 'y Retry-After');
select is(pg_temp.frenos(), current_setting('taba.test_frenos_antes')::integer + 1,
  'el intento frenado queda contado: la transaccion no se deshizo');
select is(
  (select count(*)::integer from public.order_abuse_events e
    where e.business_id = (select id from guard_ids where name = 'business')
      and e.customer_user_id = (select id from guard_ids where name = 'c21')
      and e.event_type = 'order_intake_blocked:customer_pending'),
  1, 'y deja un evento que el dueno puede leer');
select pg_temp.pedir('c21', 'guardia-api-0003');
select is(
  (select count(*)::integer from public.order_abuse_events e
    where e.customer_user_id = (select id from guard_ids where name = 'c21')),
  1, 'golpear otra vez suma al contador, no escribe otro evento: mil intentos no son mil filas');
select is(
  (select count(*)::integer from public.orders o where o.client_request_id in ('guardia-api-0002', 'guardia-api-0003')),
  0, 'y ningun pedido frenado existe');

-- ══ 9 · ENFRIAMIENTO ════════════════════════════════════════════════════════
select count(*) from generate_series(1, 20) g where pg_temp.pedir('c21', 'guardia-golpe-' || lpad(g::text, 4, '0')) is not null;
select pg_temp.limites('{"customer_pending": 1000}');
select is(
  pg_temp.pedir('c21', 'guardia-golpe-final') -> 'body' ->> 'details', 'cooldown',
  'quien siguio golpeando despues de ser frenado queda en enfriamiento aunque el cupo ya alcance');
select ok(
  (pg_temp.pedir('c22', 'guardia-golpe-otro') ->> 'ok')::boolean,
  'el enfriamiento es de quien golpeo: otro cliente pide normalmente');
select set_config('request.method', '', true);
select set_config('response.status', '', true);

-- ══ 10 · MONITOR Y APAGADO ══════════════════════════════════════════════════
select pg_temp.limites('{"mode": "monitor", "customer_pending": 1}');
select pg_temp.atender_todo();
select ok(
  (pg_temp.pedir('c23', 'guardia-monitor-0001') ->> 'ok')::boolean
  and (pg_temp.pedir('c23', 'guardia-monitor-0002') ->> 'ok')::boolean,
  'en modo monitor el pedido que se habria frenado entra');
select is(
  (select count(*)::integer from public.order_abuse_events e
    where e.customer_user_id = (select id from guard_ids where name = 'c23')
      and e.event_type = 'order_intake_would_block:customer_pending'),
  1, 'y queda anotado como «se habria frenado»');

select pg_temp.limites('{"mode": "off", "customer_pending": 1}');
select set_config('taba.test_log_antes', (select count(*) from private.order_intake_log)::text, true);
select ok(
  (pg_temp.pedir('c24', 'guardia-off-0001') ->> 'ok')::boolean
  and (pg_temp.pedir('c24', 'guardia-off-0002') ->> 'ok')::boolean,
  'apagado, el guardian no frena');
select is((select count(*)::text from private.order_intake_log), current_setting('taba.test_log_antes'),
  'ni anota');

-- ══ 11 · TAMAÑO DE UN PEDIDO SIN COBRAR ═════════════════════════════════════
select pg_temp.limites('{"units": 50, "customer_pending": 1000}');
select pg_temp.atender_todo();
select is(
  pg_temp.pedir('c25', 'guardia-grande-0001', 51) - 'ok',
  '{"sqlstate": "22023", "message": "ORDER_TOO_LARGE", "detail": "un pedido sin cobrar acepta hasta 50 unidades"}'::jsonb,
  'un pedido sin cobrar por encima del tope de unidades se rechaza como validacion');
select ok((pg_temp.pedir('c25', 'guardia-grande-0002', 50) ->> 'ok')::boolean, 'en el tope exacto entra');

-- ══ 12 · VALORES POR DEFECTO: NULL NO ES «SIN LÍMITE» ═══════════════════════
select pg_temp.limites('{}');
select pg_temp.atender_todo();
select is(
  (select count(*)::integer from generate_series(1, 6) g
    where (pg_temp.pedir('c26', 'guardia-defecto-' || lpad(g::text, 4, '0')) ->> 'ok')::boolean),
  5, 'con todos los limites en NULL rige el valor por defecto: cinco sin atender, el sexto no');

-- ══ 13 · LOS DOS CANALES SALEN DEL MISMO CUPO ═══════════════════════════════
select pg_temp.limites('{"customer_pending": 2}');
select pg_temp.atender_todo();
select ok(
  (pg_temp.pedir('c27', 'guardia-canal-0001') ->> 'ok')::boolean
  and (pg_temp.checkout('c27', 'guardia-canal-0002') ->> 'ok')::boolean,
  'un pedido en efectivo y un checkout de Mercado Pago: dos compromisos sin cobrar');
select is(
  pg_temp.checkout('c27', 'guardia-canal-0003') - 'ok',
  '{"sqlstate": "54000", "message": "demasiados intentos de checkout; reintenta mas tarde", "detail": "customer_pending"}'::jsonb,
  'el tercero por checkout se frena con el codigo y el mensaje que la Edge Function ya conoce');
select is(
  pg_temp.pedir('c27', 'guardia-canal-0004') ->> 'detail', 'customer_pending',
  'y por efectivo tambien: cambiar de canal no duplica el cupo');
select ok(
  (pg_temp.checkout('c27', 'guardia-canal-0002') ->> 'id') is not null,
  'el reintento idempotente del checkout existente se responde igual');

-- ══ 14 · FALLA ABIERTA ══════════════════════════════════════════════════════
select pg_temp.limites('{"customer_pending": 1000}');
alter table private.order_intake_blocks rename column blocked_count to blocked_count_roto;
select ok(
  (pg_temp.pedir('c28', 'guardia-falla-0001') ->> 'ok')::boolean,
  'con el guardian roto por dentro, el pedido entra igual: el local no deja de vender');
alter table private.order_intake_blocks rename column blocked_count_roto to blocked_count;

-- ══ 15 · HIGIENE DE ENTRADA ═════════════════════════════════════════════════
select is(
  pg_temp.pedir('c29', 'guardia-higiene-0001', 1, jsonb_build_object('address_label', repeat('x', 301))) ->> 'sqlstate',
  '22023', 'una etiqueta de direccion desmedida se rechaza');
select is(
  pg_temp.pedir('c29', 'guardia-higiene-0002', 1, jsonb_build_object('customer_notes', repeat('x', 40000))) ->> 'message',
  'payload demasiado grande', 'un cuerpo desmedido se rechaza antes de tocar nada');
select ok(
  (pg_temp.pedir('c29', 'guardia-higiene-0003', 1,
    jsonb_build_object('customer_notes', 'sin' || chr(10) || 'hielo' || chr(27) || '[2J')) ->> 'ok')::boolean,
  'un pedido con caracteres de control en las observaciones entra');
select is(
  (select o.customer_notes from public.orders o where o.client_request_id = 'guardia-higiene-0003'),
  'sin hielo [2J', 'y los caracteres de control no llegan al Panel ni a la comandera');

-- ══ 16 · RETENCIÓN ══════════════════════════════════════════════════════════
update private.order_intake_log set created_at = clock_timestamp() - interval '8 days'
 where order_id = (select o.id from public.orders o where o.client_request_id = 'guardia-normal-0001');
select ok(public.purge_order_intake_traces(7) >= 1, 'el rastro de admision con mas de siete dias se purga');

select * from finish();
rollback;
