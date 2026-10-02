-- TABA · LO QUE UN PEDIDO COBRÓ NO SE REESCRIBE
--
-- El importe de un pedido era inmutable sólo por permisos. La clave de servicio, una
-- migración o una función SECURITY DEFINER nueva podían cambiar `orders.total`, la
-- moneda, el precio de un renglón o borrar el renglón, sin ningún evento.
--
-- Acá se prueba:
--   · que los tres caminos por los que NACE un pedido siguen funcionando con los
--     triggers puestos (retiro en efectivo, delivery en efectivo —que actualiza el
--     pedido recién creado— y Mercado Pago con un combo);
--   · que la operación de todos los días sobre el pedido sigue funcionando;
--   · que después de creado no cambian importe, moneda, renglones ni combos, para la
--     clave de servicio, para el dueño de la base y para una función SECURITY DEFINER;
--   · que las dos excepciones que la base necesita siguen andando: borrar un producto
--     o un combo ya vendidos (FK SET NULL) y borrar el pedido entero (cascada).
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

create temporary table snap (k text primary key, v text) on commit drop;
grant select on snap to authenticated, service_role;

-- ── Fixture ────────────────────────────────────────────────────────────────
do $fixture$
declare
  v_owner uuid := 'a7300000-0000-4000-8000-0000000000a1';
  v_staff uuid := 'a7300000-0000-4000-8000-0000000000a2';
  v_c1 uuid := 'a7300000-0000-4000-8000-0000000000c1';
  v_c2 uuid := 'a7300000-0000-4000-8000-0000000000c2';
  v_c3 uuid := 'a7300000-0000-4000-8000-0000000000c3';
  v_business uuid := 'b7300000-0000-4000-8000-0000000000a1';
  v_lata uuid := 'c7300000-0000-4000-8000-0000000000a1';
  v_agua uuid := 'c7300000-0000-4000-8000-0000000000a2';
  v_suelto uuid := 'c7300000-0000-4000-8000-0000000000a3';
  v_combo uuid := 'e7300000-0000-4000-8000-0000000000a1';
  v_result jsonb;
  v_address uuid;
  v_session uuid;
  v_intent uuid;
  v_prepare jsonb;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values
    (v_owner,'authenticated','authenticated','importe-owner@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_staff,'authenticated','authenticated','importe-staff@example.invalid','',now(),'{}','{}',false,now(),now()),
    (v_c1,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now()),
    (v_c2,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now()),
    (v_c3,'authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());

  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified, ordering_verified_at, ordering_verified_by,
    currency_code, pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal
  ) values (
    v_business, 'TABA importe inmutable', 'taba-importe-inmutable', 'open', true, true, true, clock_timestamp(), v_owner,
    'ARS', true, true, 500.00, 0.00
  );
  insert into public.business_members(business_id,user_id,role,is_active)
  values (v_business, v_owner, 'owner', true), (v_business, v_staff, 'staff', true);
  insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
  values ('f7300000-0000-4000-8000-0000000000a2', v_staff, v_business, 'staff', 'panel_web');

  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values
    (v_lata,v_business,'Lata Importe','Gaseosas','Cola',1000,'confirmed',true,'Marca',
     'Lata','Lata',473,'ml','473 ml','lata',500,true,true,false,'{}',true,now(),v_owner,'importe-lata','importe-lata','commercial',1),
    (v_agua,v_business,'Agua Importe','Aguas','Sin gas',500,'confirmed',true,'Marca',
     'Botella','Botella',500,'ml','500 ml','botella',500,true,true,false,'{}',true,now(),v_owner,'importe-agua','importe-agua','commercial',1),
    (v_suelto,v_business,'Producto que se va a borrar','Gaseosas','Cola',700,'confirmed',true,'Marca',
     'Lata','Lata',473,'ml','473 ml','lata',50,true,true,false,'{}',true,now(),v_owner,'importe-suelto','importe-suelto','commercial',1);

  insert into public.product_combos(id,business_id,combo_id,name,discount_percentage,approval_status,approved_at,is_active)
  values (v_combo, v_business, 'combo-importe', 'Combo Importe', 10, 'APROBADO_COMERCIAL', now(), true);
  insert into public.product_combo_components(combo_id,product_id,quantity,sort_order)
  values (v_combo, v_lata, 1, 1), (v_combo, v_agua, 1, 2);

  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'collector-importe', 'app-importe', clock_timestamp(), clock_timestamp());

  -- A · retiro en efectivo, por el contrato del cliente.
  perform set_config('request.jwt.claims', json_build_object('sub', v_c1, 'role', 'authenticated')::text, true);
  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'importe-retiro-0001',
    'tracking_token', md5('importe-retiro') || md5('importe-retiro-b'),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_lata, 'quantity', 2)),
    'customer_name', 'Cliente Retiro', 'customer_phone', '2996209137',
    'delivery_mode', 'pickup', 'payment_method', 'cash'));
  insert into snap values ('retiro', v_result ->> 'id');

  -- B · delivery en efectivo: las capas de alta ACTUALIZAN el pedido recién creado
  -- (dirección y punto de entrega) en la misma transacción.
  perform set_config('request.jwt.claims', json_build_object('sub', v_c2, 'role', 'authenticated')::text, true);
  perform public.upsert_current_customer_profile('Cliente Delivery', '2996209138');
  v_address := (public.upsert_current_customer_address(jsonb_build_object(
    'label', 'Casa', 'street', 'Calle Importe', 'streetNumber', '100', 'city', 'Neuquen', 'province', 'Neuquen',
    'neighborhood', 'Centro', 'latitude', -38.9516, 'longitude', -68.0591, 'geolocationAccuracy', 10,
    'source', 'gps', 'locationSource', 'map_pin', 'locationConfirmedAt', clock_timestamp(), 'isDefault', true
  )) -> 'address' ->> 'id')::uuid;
  v_result := public.create_order_with_items(jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'importe-delivery-0001',
    'tracking_token', md5('importe-delivery') || md5('importe-delivery-b'),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_lata, 'quantity', 1)),
    'customer_name', 'Cliente Delivery', 'customer_phone', '2996209138',
    'delivery_mode', 'delivery', 'payment_method', 'cash',
    'customer_address_id', v_address));
  insert into snap values ('delivery', v_result ->> 'id');

  -- C · Mercado Pago: sesión, pago aprobado y pedido que nace del pago. Un producto
  -- suelto y un combo, para que nazcan renglones y combo.
  perform set_config('request.jwt.claims', '', true);
  v_result := public.create_checkout_session(v_c3, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'importe-pago-0001',
    'items', jsonb_build_array(
      jsonb_build_object('product_id', v_lata, 'quantity', 1),
      jsonb_build_object('combo_id', 'combo-importe', 'quantity', 1)),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Cliente Pago', 'phone', '5492990000000'),
    'age_confirmed', false, 'payment_method', 'mercadopago'));
  v_session := (v_result ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference(v_session, v_c3, false);
  perform public.record_mercadopago_preference_created(
    (v_prepare ->> 'payment_attempt_id')::uuid, 'PREF-IMPORTE-0001',
    'https://www.mercadopago.com/r/importe', 'https://sandbox.mercadopago.com/r/importe',
    encode(extensions.gen_random_bytes(32), 'hex'), 'req-importe');
  select id into v_intent from public.payment_intents where checkout_session_id = v_session;
  perform public.record_mercadopago_payment_snapshot(v_intent, (
    select jsonb_build_object(
      'provider_payment_id', 'PAY-IMPORTE-0001',
      'external_reference', 'taba2:checkout:' || v_session::text,
      'preference_id', pi.preference_id,
      'merchant_order_id', 'MO-IMPORTE', 'collector_id', ps.collector_id, 'currency', 'ARS',
      'transaction_amount', cs.total::text, 'status', 'approved',
      'status_detail', 'accredited', 'payment_method', 'visa', 'live_mode', false,
      'provider_occurred_at', clock_timestamp()::text, 'refunded_amount', '0.00',
      'payer_email_hash', encode(extensions.gen_random_bytes(32), 'hex'),
      'raw_response_hash', encode(extensions.gen_random_bytes(32), 'hex'))
    from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.provider = 'mercadopago'
    where pi.id = v_intent), 'reconciliation', null);
  v_result := public.finalize_paid_checkout_session(v_session);
  insert into snap values ('pago', v_result ->> 'order_id'), ('pago_sesion', v_session::text);

  -- D · un pedido viejo sin moneda y con un producto que después se borra. Se
  -- inserta directo, como lo dejaría una versión anterior del alta.
  insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,
    customer_name,customer_phone,payment_method,subtotal,delivery_fee,total,currency_code,customer_user_id,discount_total)
  values ('d7300000-0000-4000-8000-0000000000d1', v_business, 'IMP-VIEJO', 'IMP-VIEJO', 'delivered', 'pickup', 'pickup',
    'importe-viejo-0001', 'Cliente Viejo', '2996209139', 'cash', 700, 0, 600, null, v_c1, 100);
  insert into public.order_items(id,order_id,product_id,product_uuid,name,quantity,unit,unit_price,subtotal)
  values ('d7300000-0000-4000-8000-0000000000e1', 'd7300000-0000-4000-8000-0000000000d1', v_suelto::text, v_suelto,
    'Producto que se va a borrar', 1, 'unidad', 700, 700);
  -- Una definición de combo que sólo referencia ese pedido viejo (la del pedido pago
  -- la retiene su sesión de checkout).
  insert into public.product_combos(id,business_id,combo_id,name,discount_percentage,approval_status,approved_at,is_active)
  values ('e7300000-0000-4000-8000-0000000000a2', v_business, 'combo-viejo', 'Combo Viejo', 10, 'APROBADO_COMERCIAL', now(), false);
  insert into public.order_combos(id,order_id,combo_uuid,combo_id,name,quantity,discount_percentage,list_price,promotional_price,discount_amount,combo_snapshot)
  values ('d7300000-0000-4000-8000-0000000000f1', 'd7300000-0000-4000-8000-0000000000d1', 'e7300000-0000-4000-8000-0000000000a2',
    'combo-viejo', 'Combo Viejo', 1, 10, 700, 600, 100, '{"components": []}'::jsonb);
  insert into snap values ('viejo', 'd7300000-0000-4000-8000-0000000000d1');
end
$fixture$;

-- Lo que el COMMIT de las altas habría verificado.
set constraints all immediate;
set constraints all deferred;

create function pg_temp.pedido(p_key text) returns uuid language sql as $$
  select v::uuid from snap where k = p_key;
$$;
create function pg_temp.foto(p_key text) returns text language sql as $$
  select concat_ws('|', o.subtotal, o.discount_total, o.delivery_fee, o.total, coalesce(o.currency_code, 'NULL'),
           (select string_agg(concat_ws(':', i.name, i.quantity, i.unit_price, i.subtotal), ',' order by i.name, i.unit_price)
              from public.order_items i where i.order_id = o.id),
           (select string_agg(concat_ws(':', c.combo_id, c.quantity, c.list_price, c.promotional_price, c.discount_amount), ',' order by c.combo_id)
              from public.order_combos c where c.order_id = o.id))
    from public.orders o where o.id = pg_temp.pedido(p_key);
$$;
-- Ejecuta una sentencia con un rol y devuelve 'ok' o el SQLSTATE. 'dueno' es el rol con
-- que corre la prueba (el dueño de las tablas): no cambia de rol.
create function pg_temp.intento(p_role text, p_sql text) returns text language plpgsql as $$
declare v_out text;
begin
  begin
    if p_role <> 'dueno' then
      execute format('set local role %I', p_role);
    end if;
    execute p_sql;
    v_out := 'ok';
  exception when others then
    v_out := sqlstate;
  end;
  execute 'reset role';
  return v_out;
end;
$$;

-- ══ 1 · LOS RESGUARDOS ESTÁN PUESTOS ════════════════════════════════════════
select is(
  (select string_agg(t.tgname, ',' order by t.tgname) from pg_trigger t
    where not t.tgisinternal and t.tgname in (
      'orders_zzz_money_snapshot_immutable', 'order_items_snapshot_immutable', 'order_items_snapshot_no_delete',
      'order_combos_snapshot_immutable', 'order_combos_snapshot_no_delete')),
  'order_combos_snapshot_immutable,order_combos_snapshot_no_delete,order_items_snapshot_immutable,order_items_snapshot_no_delete,orders_zzz_money_snapshot_immutable',
  'PRICE-03: los cinco triggers de inmutabilidad existen');
select is(
  (select t.tgname::text from pg_trigger t
    where t.tgrelid = 'public.orders'::regclass and not t.tgisinternal
      and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16
    order by t.tgname desc limit 1),
  'orders_zzz_money_snapshot_immutable',
  'el de la cabecera es el ultimo BEFORE UPDATE: ve lo que haya cambiado cualquier otro trigger');
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('orders_money_snapshot_immutable', 'order_lines_snapshot_immutable')
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'sus funciones no son ejecutables por un cliente');
select ok(
  (select p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'order_lines_snapshot_immutable'),
  'el resguardo de los renglones corre como su dueno y con search_path fijado: no depende de quien borra');
-- Si mañana se agrega una columna a estas tablas, hay que decidir si es parte de lo
-- cobrado: esta prueba obliga a hacerlo.
select is(
  (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
    where a.attrelid = 'public.order_items'::regclass and a.attnum > 0 and not a.attisdropped),
  'created_at,id,name,order_id,product_id,product_uuid,quantity,subtotal,unit,unit_price',
  'order_items tiene exactamente las columnas que el resguardo conoce');
select is(
  (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
    where a.attrelid = 'public.order_combos'::regclass and a.attnum > 0 and not a.attisdropped),
  'combo_id,combo_snapshot,combo_uuid,created_at,discount_amount,discount_percentage,id,list_price,name,order_id,promotional_price,quantity',
  'order_combos tambien');
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f'
      and (p.prosrc ~* '(update|delete\s+from)\s+(only\s+)?(public\.)?(order_items|order_combos)\M'
        or p.prosrc ~* 'update\s+(only\s+)?(public\.)?orders\M[^;]*\m(subtotal|discount_total|delivery_fee|total|currency_code)\s*=')),
  0, 'ninguna funcion vigente reescribe el importe ni los renglones de un pedido: no hay a quien exceptuar');

-- ══ 2 · LOS TRES CAMINOS DE ALTA SIGUEN FUNCIONANDO ═════════════════════════
select is(pg_temp.foto('retiro'), '2000.00|0.00|0.00|2000.00|ARS|Lata Importe:2.000:1000.00:2000.00',
  'retiro en efectivo: el pedido nace con su importe y su renglon');
select is(pg_temp.foto('delivery'), '1000.00|0.00|500.00|1500.00|ARS|Lata Importe:1.000:1000.00:1000.00',
  'delivery en efectivo: nace con subtotal, envio y total');
select ok(
  (select o.delivery_location_confirmed_at is not null and o.customer_address_id is not null
          and o.delivery_latitude = -38.951600 and o.delivery_street = 'Calle Importe'
     from public.orders o where o.id = pg_temp.pedido('delivery')),
  'y las capas de alta pudieron actualizar el pedido recien creado (direccion y punto de entrega)');
select is(pg_temp.foto('pago'),
  '2500.00|200.00|0.00|2300.00|ARS|Agua Importe:1.000:500.00:500.00,Lata Importe:2.000:1000.00:2000.00|combo-importe:1:1500.00:1300.00:200.00',
  'Mercado Pago: el pedido nace del pago con sus renglones, su combo y su descuento');
select is(
  (select o.total from public.orders o where o.id = pg_temp.pedido('pago')),
  (select pi.paid_amount from public.payment_intents pi where pi.checkout_session_id = (select v::uuid from snap where k = 'pago_sesion')),
  'y su total es lo que se cobro');

-- ══ 3 · LA OPERACIÓN DE TODOS LOS DÍAS SIGUE FUNCIONANDO ════════════════════
select set_config('request.jwt.claims',
  '{"sub":"a7300000-0000-4000-8000-0000000000a2","role":"authenticated","session_id":"f7300000-0000-4000-8000-0000000000a2"}', true);
select is(
  public.transition_order(pg_temp.pedido('retiro'),
    (select revision from public.orders where id = pg_temp.pedido('retiro')), 'accepted', 'importe-aceptar-01') ->> 'status',
  'accepted', 'el Panel acepta el pedido');
select lives_ok(
  $$select public.set_preparation_estimate(pg_temp.pedido('retiro'),
      (select revision from public.orders where id = pg_temp.pedido('retiro')), 20, 'importe-estimar-01')$$,
  'le pone una estimacion');
select lives_ok(
  $$select public.confirm_manual_order_payment(pg_temp.pedido('retiro'),
      (select revision from public.orders where id = pg_temp.pedido('retiro')), 'cash', 'importe-cobrar-01')$$,
  'y confirma el cobro en efectivo');
select is(pg_temp.foto('retiro'), '2000.00|0.00|0.00|2000.00|ARS|Lata Importe:2.000:1000.00:2000.00',
  'despues de operar, el importe es el mismo');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.intento('dueno', $$update public.orders set customer_notes = 'sin hielo' where id = pg_temp.pedido('delivery')$$),
  'ok', 'una columna que no es dinero se sigue pudiendo actualizar');
select is(pg_temp.intento('dueno', $$update public.orders set total = total, subtotal = subtotal where id = pg_temp.pedido('delivery')$$),
  'ok', 'reescribir el mismo importe no es un cambio');

-- ══ 4 · LA CABECERA NO CAMBIA, PARA NINGÚN ROL ══════════════════════════════
select is(pg_temp.intento('authenticated', $$update public.orders set total = 1 where id = pg_temp.pedido('pago')$$),
  '42501', 'un cliente o un operador ni llega: no tiene UPDATE sobre orders');
select is(pg_temp.intento('service_role', $$update public.orders set subtotal = 1500, total = 1300 where id = pg_temp.pedido('pago')$$),
  '55000', 'PRICE-03: la clave de servicio no puede reescribir subtotal y total de un pedido cobrado');
select is(pg_temp.intento('service_role', $$update public.orders set discount_total = 0, total = 2500 where id = pg_temp.pedido('pago')$$),
  '55000', 'ni el descuento');
select is(pg_temp.intento('service_role', $$update public.orders set delivery_fee = 0, total = 1000 where id = pg_temp.pedido('delivery')$$),
  '55000', 'ni el envio');
select is(pg_temp.intento('service_role', $$update public.orders set currency_code = 'USD' where id = pg_temp.pedido('pago')$$),
  '55000', 'PRICE-03: ni la moneda');
select is(pg_temp.intento('service_role', $$update public.orders set currency_code = 'ARS' where id = pg_temp.pedido('viejo')$$),
  '55000', 'un pedido viejo sin moneda tampoco se rotula despues');
select is(pg_temp.intento('dueno', $$update public.orders set total = 1, subtotal = 1 where id = pg_temp.pedido('retiro')$$),
  '55000', 'el dueno de la base tampoco: vale para todos los roles');
select throws_ok(
  $$update public.orders set status = 'preparing', total = 1999, subtotal = 1999 where id = pg_temp.pedido('retiro')$$,
  '55000', 'el importe de un pedido ya creado es inmutable',
  'mezclar el cambio de importe con un cambio de estado no lo esconde');

create function public.taba_test_reescribir_total(p_order uuid)
returns void language sql security definer set search_path = pg_catalog, public as $$
  update public.orders set status = 'accepted' where id = p_order and status = 'received';
  update public.orders set subtotal = 10, total = 10 where id = p_order;
$$;
select throws_ok(
  $$select public.taba_test_reescribir_total(pg_temp.pedido('pago'))$$,
  '55000', null,
  'PRICE-03: una funcion SECURITY DEFINER tampoco, aunque antes haya tocado el pedido en la misma transaccion');

select is(
  pg_temp.foto('pago'),
  '2500.00|200.00|0.00|2300.00|ARS|Agua Importe:1.000:500.00:500.00,Lata Importe:2.000:1000.00:2000.00|combo-importe:1:1500.00:1300.00:200.00',
  'despues de todos los intentos, el pedido cobrado esta intacto');

-- ══ 5 · LOS RENGLONES Y LOS COMBOS NO CAMBIAN NI SE BORRAN ══════════════════
select is(pg_temp.intento('service_role',
  $$update public.order_items set unit_price = 500, subtotal = 500 * quantity where order_id = pg_temp.pedido('retiro')$$),
  '55000', 'PRICE-03: la clave de servicio no puede cambiar el precio de un renglon');
select is(pg_temp.intento('service_role',
  $$update public.order_items set quantity = 1, subtotal = unit_price where order_id = pg_temp.pedido('retiro')$$),
  '55000', 'ni la cantidad');
select is(pg_temp.intento('service_role',
  $$update public.order_items set name = 'Otro producto' where order_id = pg_temp.pedido('retiro')$$),
  '55000', 'ni el nombre de lo vendido');
select is(pg_temp.intento('service_role',
  $$update public.order_items set order_id = pg_temp.pedido('delivery') where order_id = pg_temp.pedido('retiro')$$),
  '55000', 'ni mudar el renglon a otro pedido');
select is(pg_temp.intento('service_role',
  $$update public.order_items set product_uuid = 'c7300000-0000-4000-8000-0000000000a2' where order_id = pg_temp.pedido('retiro')$$),
  '55000', 'ni apuntarlo a otro producto');
select is(pg_temp.intento('dueno',
  $$update public.order_items set unit_price = 1, subtotal = quantity where order_id = pg_temp.pedido('retiro')$$),
  '55000', 'el dueno de la base tampoco');
select is(pg_temp.intento('service_role',
  $$delete from public.order_items where order_id = pg_temp.pedido('pago')$$),
  '55000', 'PRICE-03: los renglones de un pedido no se borran mientras el pedido exista');
select is(pg_temp.intento('service_role',
  $$update public.order_combos set promotional_price = 1000, discount_amount = 500 where order_id = pg_temp.pedido('pago')$$),
  '55000', 'PRICE-03: el descuento de un combo vendido no cambia');
select is(pg_temp.intento('service_role',
  $$update public.order_combos set combo_snapshot = '{}'::jsonb where order_id = pg_temp.pedido('pago')$$),
  '55000', 'ni la foto de lo que el combo contenia');
select is(pg_temp.intento('service_role',
  $$delete from public.order_combos where order_id = pg_temp.pedido('pago')$$),
  '55000', 'ni se borra');
select is(pg_temp.intento('authenticated',
  $$update public.order_items set unit_price = 1 where order_id = pg_temp.pedido('pago')$$),
  '42501', 'y un cliente sigue sin tener UPDATE sobre los renglones');

-- ══ 6 · LAS EXCEPCIONES QUE LA BASE NECESITA ════════════════════════════════
-- Borrar un producto ya vendido: la clave foránea suelta el renglón.
select is(pg_temp.intento('dueno', $$delete from public.products where id = 'c7300000-0000-4000-8000-0000000000a3'$$),
  'ok', 'un producto que ya se vendio se puede borrar');
select is(
  (select concat_ws('|', i.product_uuid is null, i.product_id, i.name, i.unit_price, i.subtotal)
     from public.order_items i where i.id = 'd7300000-0000-4000-8000-0000000000e1'),
  't|c7300000-0000-4000-8000-0000000000a3|Producto que se va a borrar|700.00|700.00',
  'el renglon queda sin vinculo al producto y conserva lo que se vendio');

-- Borrar la definición de un combo ya vendido.
select is(pg_temp.intento('dueno', $$delete from public.product_combos where id = 'e7300000-0000-4000-8000-0000000000a2'$$),
  'ok', 'la definicion de un combo que ya se vendio se puede borrar');
select is(
  (select concat_ws('|', c.combo_uuid is null, c.combo_id, c.discount_amount)
     from public.order_combos c where c.order_id = pg_temp.pedido('viejo')),
  't|combo-viejo|100.00', 'el combo vendido queda sin vinculo a la definicion y conserva su descuento');
select is(pg_temp.intento('service_role',
  $$update public.order_combos set combo_uuid = gen_random_uuid() where order_id = pg_temp.pedido('pago')$$),
  '55000', 'pero no se lo puede apuntar a otra definicion');

-- Dar de baja al cliente: sus pedidos quedan como registro del comercio.
select is(pg_temp.intento('dueno', $$delete from auth.users where id = 'a7300000-0000-4000-8000-0000000000c1'$$),
  'ok', 'dar de baja a un cliente con pedidos sigue funcionando');
select is(
  (select count(*)::integer from public.orders o
    where o.id in (pg_temp.pedido('retiro'), pg_temp.pedido('viejo')) and o.customer_user_id is null),
  2, 'sus pedidos se desvinculan y se conservan');
select is(pg_temp.foto('retiro'), '2000.00|0.00|0.00|2000.00|ARS|Lata Importe:2.000:1000.00:2000.00',
  'con el importe intacto');

-- Borrar el pedido entero: la cascada se lleva sus renglones.
select is(pg_temp.intento('dueno', $$delete from public.orders where id = pg_temp.pedido('viejo')$$),
  'ok', 'borrar un pedido entero sigue funcionando');
select is(
  (select count(*)::integer from public.order_items i where i.order_id = 'd7300000-0000-4000-8000-0000000000d1'),
  0, 'y la cascada borra sus renglones');

-- Lo que el COMMIT verificaría con todo lo anterior hecho.
select lives_ok($$set constraints all immediate$$, 'los resguardos diferidos de orders aceptan el resultado');

select * from finish();
rollback;
