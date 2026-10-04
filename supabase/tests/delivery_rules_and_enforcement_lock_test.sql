-- TABA · COBERTURA, ENVÍO Y MÍNIMO: LOS DECIDE LA BASE, Y UN COMERCIO VERIFICADO NO SE QUEDA SIN REGLAS
--
-- `resolve_delivery_zone` decide si una dirección tiene cobertura y cuánto cuesta el
-- envío; `set_service_enforcement` enciende y apaga la exigencia de horarios y de zonas.
-- Ninguna de las dos tenía una prueba en la base. Acá se fija, llamando a la función y
-- también por la RPC pública del pedido (`create_order_with_items`):
--
--   · dirección dentro de una zona, fuera de toda zona, zona desactivada;
--   · nombres al borde: mayúsculas, tildes, espacios y puntuación coinciden; un barrio
--     parecido no coincide;
--   · lo que la tienda publica (el nombre de la zona) se puede elegir, y se cobra el
--     renglón que la persona vio;
--   · el polígono pesa más que el barrio declarado;
--   · el tope de distancia sólo niega, vale con la cobertura exigida o sin exigir, y
--     declarar un barrio no lo esquiva;
--   · retiro con el retiro apagado, delivery con el delivery apagado, pedido bajo el
--     mínimo, y el envío siempre lo decide el servidor: un pedido que trae `delivery_fee`
--     se rechaza;
--   · ningún rechazo toca el stock;
--   · en `set_service_enforcement`, NULL es «dejar como está»;
--   · con el comercio verificado nadie apaga la exigencia de horarios ni la de cobertura,
--     y ninguna persona tiene UPDATE directo sobre esas columnas.
--
-- Ningún caso depende de la hora: los comercios que reciben pedidos no exigen horario.
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(106);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
values
  ('d6500000-0000-4000-8000-0000000000a1','authenticated','authenticated','reparto-owner@example.invalid','',now(),'{}','{}',false,now(),now()),
  ('d6500000-0000-4000-8000-0000000000a2','authenticated','authenticated','reparto-admin@example.invalid','',now(),'{}','{}',false,now(),now()),
  ('d6500000-0000-4000-8000-0000000000a3','authenticated','authenticated','reparto-delegado@example.invalid','',now(),'{}','{}',false,now(),now()),
  ('d6500000-0000-4000-8000-0000000000a4','authenticated','authenticated','reparto-equipo@example.invalid','',now(),'{}','{}',false,now(),now()),
  ('d6500000-0000-4000-8000-0000000000a5','authenticated','authenticated','reparto-plataforma@example.invalid','',now(),'{}','{}',false,now(),now()),
  ('d6500000-0000-4000-8000-0000000000a9','authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());

create temporary table reparto_ids (clave text primary key, id uuid not null) on commit drop;
insert into reparto_ids values
  ('D', 'd6500000-0000-4000-8000-0000000000b1'),   -- verificado y abierto: cobertura exigida, zonas con distinto precio
  ('N', 'd6500000-0000-4000-8000-0000000000b2'),   -- verificado y abierto: cobertura SIN exigir
  ('U', 'd6500000-0000-4000-8000-0000000000b3'),   -- sin verificar y sin envio cargado
  ('V', 'd6500000-0000-4000-8000-0000000000b4'),   -- verificado: horario y cobertura exigidos
  ('W', 'd6500000-0000-4000-8000-0000000000b5'),   -- sin verificar: horario exigido, cobertura no
  ('X', 'd6500000-0000-4000-8000-0000000000ff');   -- no existe
create function pg_temp.id(p_clave text) returns uuid language sql stable as $$
  select id from reparto_ids where clave = p_clave
$$;

insert into public.businesses(id,name,slug,status,is_active,currency_code,address,pickup_enabled,delivery_enabled,delivery_fee,minimum_delivery_subtotal,
  operating_timezone,hours_enforced,delivery_zone_enforced,ordering_verified,ordering_verified_at,ordering_verified_by,ordering_enabled,order_intake_guard_mode)
values
  (pg_temp.id('D'),'Reparto D','reparto-d','open',true,'ARS','Mendoza 827, Neuquen',true,true,1500,8000,
    'America/Argentina/Buenos_Aires',false,true,true,now(),'d6500000-0000-4000-8000-0000000000a5',true,'off'),
  (pg_temp.id('N'),'Reparto N','reparto-n','open',true,'ARS','Mendoza 827, Neuquen',true,true,1500,0,
    'America/Argentina/Buenos_Aires',false,false,true,now(),'d6500000-0000-4000-8000-0000000000a5',true,'off'),
  (pg_temp.id('U'),'Reparto U','reparto-u','closed',true,'ARS','Mendoza 827, Neuquen',true,true,null,null,
    'America/Argentina/Buenos_Aires',false,true,false,null,null,false,'off'),
  (pg_temp.id('V'),'Reparto V','reparto-v','closed',true,'ARS','Mendoza 827, Neuquen',true,true,1500,0,
    'America/Argentina/Buenos_Aires',true,true,true,now(),'d6500000-0000-4000-8000-0000000000a5',true,'off'),
  (pg_temp.id('W'),'Reparto W','reparto-w','closed',true,'ARS','Mendoza 827, Neuquen',true,true,1500,0,
    'America/Argentina/Buenos_Aires',true,false,false,null,null,false,'off');

-- Zonas de D. El local esta en (-38.9516, -68.0591).
--   Centro        barrio declarado          800 / 5000
--   Confluencia   barrio declarado         2500 / 12000
--   Zona 1        nombre publicado ≠ barrio («barrio norte»)   900 / el minimo del comercio
--   Alta Barda    barrio declarado, DESACTIVADA
--   Ribera        poligono sobre (-38.98..-38.97, -68.04..-68.03)   3000 / 0
--   Sur           barrio «villa sur», prioridad 1     1100 / 0
--   Villa Sur     barrio «sur lejano», prioridad 90   4000 / 0   (su NOMBRE es el barrio de la otra)
insert into public.delivery_zones(id,business_id,name,is_active,match_kind,area_normalized,boundary,delivery_fee,minimum_subtotal,priority) values
  ('d6500000-0000-4000-8000-0000000000f1',pg_temp.id('D'),'Centro',true,'declared_area','centro',null,800,5000,10),
  ('d6500000-0000-4000-8000-0000000000f2',pg_temp.id('D'),'Confluencia',true,'declared_area','confluencia',null,2500,12000,20),
  ('d6500000-0000-4000-8000-0000000000f3',pg_temp.id('D'),'Zona 1',true,'declared_area','barrio norte',null,900,null,30),
  ('d6500000-0000-4000-8000-0000000000f4',pg_temp.id('D'),'Alta Barda',false,'declared_area','alta barda',null,700,0,5),
  ('d6500000-0000-4000-8000-0000000000f5',pg_temp.id('D'),'Ribera',true,'polygon',null,
    '((-68.04,-38.98),(-68.03,-38.98),(-68.03,-38.97),(-68.04,-38.97))'::polygon,3000,0,40),
  ('d6500000-0000-4000-8000-0000000000f6',pg_temp.id('D'),'Sur',true,'declared_area','villa sur',null,1100,0,1),
  ('d6500000-0000-4000-8000-0000000000f7',pg_temp.id('D'),'Villa Sur',true,'declared_area','sur lejano',null,4000,0,90),
  ('d6500000-0000-4000-8000-0000000000f8',pg_temp.id('U'),'Centro',true,'declared_area','centro',null,null,null,10),
  ('d6500000-0000-4000-8000-0000000000f9',pg_temp.id('V'),'Centro',true,'declared_area','centro',null,800,0,10),
  ('d6500000-0000-4000-8000-0000000000fa',pg_temp.id('W'),'Centro',true,'declared_area','centro',null,800,0,10);

insert into public.business_service_hours(business_id,channel,weekday,opens_at,closes_at)
select pg_temp.id(c), canal, d, '09:00', '21:00'
  from unnest(array['V','W']) c, unnest(array['delivery','pickup']) canal, generate_series(0,6) d;

-- Equipo de V: dueño, encargado, integrante con la delegacion comercial e integrante sin ella. W: el dueño.
insert into public.business_members(business_id,user_id,role,is_active) values
  (pg_temp.id('V'),'d6500000-0000-4000-8000-0000000000a1','owner',true),
  (pg_temp.id('V'),'d6500000-0000-4000-8000-0000000000a2','admin',true),
  (pg_temp.id('V'),'d6500000-0000-4000-8000-0000000000a3','staff',true),
  (pg_temp.id('V'),'d6500000-0000-4000-8000-0000000000a4','staff',true),
  (pg_temp.id('W'),'d6500000-0000-4000-8000-0000000000a1','owner',true);
insert into public.business_commercial_managers(business_id,user_id,granted_by)
values (pg_temp.id('V'),'d6500000-0000-4000-8000-0000000000a3','d6500000-0000-4000-8000-0000000000a1');
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values
  ('d6500000-0000-4000-8000-0000000000e1','d6500000-0000-4000-8000-0000000000a1',pg_temp.id('V'),'owner','panel_web'),
  ('d6500000-0000-4000-8000-0000000000e2','d6500000-0000-4000-8000-0000000000a2',pg_temp.id('V'),'admin','panel_web'),
  ('d6500000-0000-4000-8000-0000000000e3','d6500000-0000-4000-8000-0000000000a3',pg_temp.id('V'),'staff','panel_web'),
  ('d6500000-0000-4000-8000-0000000000e4','d6500000-0000-4000-8000-0000000000a4',pg_temp.id('V'),'staff','panel_web'),
  ('d6500000-0000-4000-8000-0000000000e5','d6500000-0000-4000-8000-0000000000a1',pg_temp.id('W'),'owner','panel_web');

-- Un producto de 1000 en D y otro en N.
insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
select p.id, pg_temp.id(p.clave), 'Lata Reparto ' || p.clave, 'Gaseosas', 'Cola', 1000, 'confirmed', true, 'Marca',
    'Lata', 'Lata', 473, 'ml', '473 ml', 'lata',
    500, true, true, false, '{}', true, now(), 'd6500000-0000-4000-8000-0000000000a1',
    'reparto-' || lower(p.clave), 'reparto-' || lower(p.clave), 'commercial', 1
  from (values ('D', 'd6500000-0000-4000-8000-0000000000c1'::uuid), ('N', 'd6500000-0000-4000-8000-0000000000c2'::uuid)) p(clave, id);

-- La respuesta del motor en una linea: detalle | zona | envio | minimo.
create function pg_temp.zona(p_clave text, p_lat double precision, p_lng double precision, p_barrio text) returns text
language plpgsql stable as $$
declare
  z jsonb := public.resolve_delivery_zone(pg_temp.id(p_clave), p_lat, p_lng, p_barrio);
begin
  return concat_ws(' | ', z ->> 'detail', coalesce(z ->> 'zone_name', '-'),
                   coalesce(trim_scale((z ->> 'delivery_fee')::numeric)::text, '-'),
                   coalesce(trim_scale((z ->> 'minimum_subtotal')::numeric)::text, '-'));
end $$;

-- Un pedido en efectivo por la RPC publica, como cliente. Devuelve el pedido o el error.
create function pg_temp.pedir(p_clave text, p_key text, p_cantidad integer, p_extra jsonb) returns jsonb
language plpgsql as $$
declare
  v_result jsonb;
  v_detail text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'd6500000-0000-4000-8000-0000000000a9', 'role', 'authenticated')::text, true);
  begin
    v_result := public.create_order_with_items(jsonb_build_object(
      'business_id', pg_temp.id(p_clave),
      'client_request_id', 'reparto-' || p_key,
      'tracking_token', md5(p_key) || md5(p_key || 'reparto'),
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', (select p.id from public.products p where p.business_id = pg_temp.id(p_clave)), 'quantity', p_cantidad)),
      'customer_name', 'Cliente Reparto',
      'customer_phone', '2996209137',
      'payment_method', 'cash') || p_extra);
    return (select jsonb_build_object('ok', true, 'delivery_fee', o.delivery_fee, 'subtotal', o.subtotal, 'total', o.total,
                                      'zone', o.delivery_zone_name, 'mode', o.delivery_mode)
              from public.orders o where o.id = (v_result ->> 'id')::uuid);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return jsonb_build_object('ok', false, 'sqlstate', sqlstate, 'message', sqlerrm, 'detail', v_detail);
  end;
end $$;
-- La direccion de un pedido de delivery con su punto confirmado.
create function pg_temp.envio(p_barrio text, p_lat text default '-38.9540', p_lng text default '-68.0600') returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'delivery_mode', 'delivery',
    'customer_street_address', 'Rio Senguer 1234',
    'customer_neighborhood', p_barrio,
    'delivery_latitude', p_lat, 'delivery_longitude', p_lng,
    'delivery_location_source', 'map_pin', 'delivery_location_confirmed_at', clock_timestamp()::text)
$$;
create function pg_temp.stock(p_clave text) returns integer language sql stable as $$
  select p.stock from public.products p where p.business_id = pg_temp.id(p_clave)
$$;

-- Una llamada del Panel a `set_service_enforcement`, con la sesion de esa persona.
create function pg_temp.exigir(p_sesion text, p_clave text, p_horario boolean, p_cobertura boolean,
  p_alcohol boolean default null, p_huso text default null) returns text
language plpgsql as $$
declare
  v_result jsonb;
  v_user uuid;
begin
  select s.user_id into v_user from public.identity_sessions s where s.session_id = ('d6500000-0000-4000-8000-0000000000' || p_sesion)::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated',
    'session_id', 'd6500000-0000-4000-8000-0000000000' || p_sesion)::text, true);
  begin
    v_result := public.set_service_enforcement(pg_temp.id(p_clave), p_horario, p_cobertura, p_alcohol, p_huso);
    return concat_ws(' ', 'ok', 'horario=' || (v_result ->> 'hours_enforced'), 'cobertura=' || (v_result ->> 'delivery_zone_enforced'),
                     'alcohol=' || (v_result ->> 'alcohol_hours_enforced'), 'huso=' || (v_result ->> 'operating_timezone'));
  exception when others then
    return sqlstate || ' ' || sqlerrm;
  end;
end $$;
create function pg_temp.banderas(p_clave text) returns text language sql stable as $$
  select concat_ws(' ', 'horario=' || b.hours_enforced, 'cobertura=' || b.delivery_zone_enforced, 'alcohol=' || b.alcohol_hours_enforced,
                   'verificado=' || b.ordering_verified)
    from public.businesses b where b.id = pg_temp.id(p_clave)
$$;

-- ══ 1 · PRIVILEGIOS ══════════════════════════════════════════════════════════
select ok(
  not has_function_privilege('anon', 'public.resolve_delivery_zone(uuid,double precision,double precision,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.resolve_delivery_zone(uuid,double precision,double precision,text)', 'EXECUTE'),
  'el motor de cobertura no lo ejecuta el navegador: llega por la cotizacion publica y por el alta');
select ok(
  not has_function_privilege('anon', 'public.set_service_enforcement(uuid,boolean,boolean,boolean,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_service_enforcement(uuid,boolean,boolean,boolean,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.set_service_enforcement(uuid,boolean,boolean,boolean,text)', 'EXECUTE'),
  'la exigencia la cambia una persona con sesion: ni anon ni la clave de servicio');
select ok(
  (select bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=pg_catalog, public, pg_temp'))
     from pg_proc p
    where p.oid in ('public.resolve_delivery_zone(uuid,double precision,double precision,text)'::regprocedure,
                    'public.set_service_enforcement(uuid,boolean,boolean,boolean,text)'::regprocedure)),
  'las dos corren como su dueño con search_path fijado');

-- CAT-01: la exigencia y lo que la acompaña no se escriben con un UPDATE de persona.
select is(
  (select array_agg(c order by c)
     from unnest(array['hours_enforced', 'delivery_zone_enforced', 'alcohol_hours_enforced', 'operating_timezone',
                       'delivery_max_radius_meters', 'ordering_verified', 'ordering_verified_at', 'ordering_verified_by']) c
    where has_column_privilege('authenticated', 'public.businesses', c, 'UPDATE')
       or has_column_privilege('anon', 'public.businesses', c, 'UPDATE')),
  null, 'ni authenticated ni anon tienen UPDATE directo sobre la exigencia, el huso, el tope o la verificacion');
select ok(
  not has_table_privilege('authenticated', 'public.delivery_zones', 'INSERT')
  and not has_table_privilege('authenticated', 'public.delivery_zones', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.delivery_zones', 'DELETE')
  and not has_table_privilege('authenticated', 'public.business_service_hours', 'INSERT')
  and not has_table_privilege('authenticated', 'public.business_service_hours', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.business_service_hours', 'DELETE'),
  'las zonas y los horarios tampoco se escriben con la tabla: solo por sus RPC');

-- ══ 2 · EL MOTOR DE COBERTURA, CASO POR CASO ═════════════════════════════════
create temporary table reparto_casos (n serial, clave text, lat double precision, lng double precision, barrio text, esperado text, que text) on commit drop;
insert into reparto_casos (clave, lat, lng, barrio, esperado, que) values
  -- adentro, afuera, desactivada
  ('D', -38.9540, -68.0600, 'Centro',        'ok | Centro | 800 | 5000',       'dentro de una zona: su envio y su minimo'),
  ('D', -38.9540, -68.0600, 'Confluencia',   'ok | Confluencia | 2500 | 12000', 'otra zona: otro envio y otro minimo'),
  ('D', -38.9540, -68.0600, 'Plottier',      'out_of_zone | - | - | -',        'un barrio que no esta en la lista: sin cobertura'),
  ('D', -38.9540, -68.0600, null,            'out_of_zone | - | - | -',        'sin barrio y fuera de todo poligono: sin cobertura (el punto solo no concede)'),
  ('D', null,     null,     null,            'out_of_zone | - | - | -',        'sin barrio y sin punto: sin cobertura'),
  ('D', -38.9540, -68.0600, 'Alta Barda',    'out_of_zone | - | - | -',        'una zona desactivada no da cobertura'),
  -- nombres al borde
  ('D', -38.9540, -68.0600, '  CÉNTRO ',     'ok | Centro | 800 | 5000',       'mayusculas, tilde y espacios: es el mismo barrio'),
  ('D', -38.9540, -68.0600, 'centro.',       'ok | Centro | 800 | 5000',       'la puntuacion no cambia el barrio'),
  ('D', -38.9540, -68.0600, 'Barrio   Norte', 'ok | Zona 1 | 900 | 8000',      'espacios repetidos: es el mismo barrio; sin minimo propio usa el del comercio'),
  ('D', -38.9540, -68.0600, 'barrio-norte',  'ok | Zona 1 | 900 | 8000',       'un guion vale como espacio'),
  ('D', -38.9540, -68.0600, 'Centro Oeste',  'out_of_zone | - | - | -',        'un barrio parecido NO coincide: no hay coincidencia parcial'),
  ('D', -38.9540, -68.0600, 'Cent',          'out_of_zone | - | - | -',        'un prefijo tampoco'),
  ('D', -38.9540, -68.0600, '   ',           'out_of_zone | - | - | -',        'un barrio en blanco es no declarar barrio'),
  ('D', -38.9540, -68.0600, '%',             'out_of_zone | - | - | -',        'un comodin no coincide con nada'),
  -- F-09: lo que la tienda publica se puede elegir
  ('D', -38.9540, -68.0600, 'Zona 1',        'ok | Zona 1 | 900 | 8000',       'F-09: el nombre publicado de la zona se puede elegir aunque su barrio sea otro'),
  ('D', -38.9540, -68.0600, 'Villa Sur',     'ok | Villa Sur | 4000 | 0',      'F-09: si el texto es el nombre de una zona y el barrio de otra, se cobra el renglon publicado'),
  ('D', -38.9540, -68.0600, 'Sur lejano',    'ok | Villa Sur | 4000 | 0',      'y el barrio interno sigue coincidiendo'),
  ('D', -38.9540, -68.0600, 'Sur',           'ok | Sur | 1100 | 0',            'cada nombre publicado lleva a su zona'),
  -- el poligono pesa mas que el barrio declarado
  ('D', -38.9770, -68.0350, 'Centro',        'ok | Ribera | 3000 | 0',         'un punto dentro de un poligono gana sobre el barrio declarado'),
  ('D', -38.9770, -68.0350, null,            'ok | Ribera | 3000 | 0',         'y no necesita barrio'),
  ('D', -38.9770, -68.0350, 'Plottier',      'ok | Ribera | 3000 | 0',         'ni lo pierde por declarar un barrio sin cobertura'),
  -- F-01 / PRICE-04: limitacion documentada. Sin poligono y sin tope, el barrio lo elige la persona.
  ('D', -34.6037, -58.3816, 'Centro',        'ok | Centro | 800 | 5000',       'LIMITACION F-01: sin tope de distancia, un punto a 1000 km declarando Centro tiene cobertura'),
  -- cobertura sin exigir
  ('N', -34.6037, -58.3816, null,            'not_enforced | - | 1500 | 0',    'sin exigir cobertura y sin tope: cualquier direccion, con el envio del comercio'),
  ('N', null,     null,     'Plottier',      'not_enforced | - | 1500 | 0',    'sin exigir cobertura el barrio no se mira'),
  -- configuracion incompleta y comercios que no reparten
  ('U', -38.9540, -68.0600, 'Centro',        'zone_fee_missing | Centro | - | -', 'una zona sin envio en ningun lado no es cobertura'),
  ('X', -38.9540, -68.0600, 'Centro',        'business_not_found | - | - | -', 'un comercio que no existe');
select is(pg_temp.zona(c.clave, c.lat, c.lng, c.barrio), c.esperado, c.clave || ' ' || coalesce(c.barrio, '(sin barrio)') || ': ' || c.que)
  from reparto_casos c order by c.n;

update public.businesses set delivery_zone_enforced = false where id = pg_temp.id('U');
select is(pg_temp.zona('U', null, null, null), 'business_fee_missing | - | - | -',
  'sin exigir cobertura y sin envio del comercio: no se entrega gratis por omision');
update public.businesses set delivery_enabled = false where id = pg_temp.id('U');
select is(pg_temp.zona('U', -38.9540, -68.0600, 'Centro'), 'delivery_disabled | - | - | -', 'con el delivery apagado no hay cobertura');

-- ══ 3 · EL TOPE DE DISTANCIA: SOLO NIEGA, Y VALE SIEMPRE QUE ESTE CARGADO ════
-- Tope de 5000 m contra un punto del local verificado por una persona.
insert into private.rider_map_business_locations(business_id, latitude, longitude, source, human_verified) values
  (pg_temp.id('D'), -38.9516, -68.0591, 'business_verified', true),
  (pg_temp.id('N'), -38.9516, -68.0591, 'business_verified', true);
update public.businesses set delivery_max_radius_meters = 5000 where id in (pg_temp.id('D'), pg_temp.id('N'));

select is(pg_temp.zona('D', -38.9540, -68.0600, 'Centro'), 'ok | Centro | 800 | 5000', 'dentro del tope: la zona decide como siempre');
select is(pg_temp.zona('D', -34.6037, -58.3816, 'Centro'), 'beyond_max_radius | - | - | -',
  'F-01: mas alla del tope no hay cobertura, se declare el barrio que se declare');
select is(pg_temp.zona('D', null, null, 'Centro'), 'max_radius_needs_point | - | - | -', 'con tope y sin punto del cliente: se niega');
select is(pg_temp.zona('D', -38.9300, -68.0591, 'Plottier'), 'out_of_zone | - | - | -', 'estar dentro del tope no concede cobertura');
select is(pg_temp.zona('D', -38.9770, -68.0350, 'Centro'), 'ok | Ribera | 3000 | 0', 'dentro del tope el poligono sigue ganando');

-- F-12: el tope se ignoraba con la cobertura sin exigir.
select is(pg_temp.zona('N', -34.6037, -58.3816, null), 'beyond_max_radius | - | - | -',
  'F-12: con la cobertura sin exigir, el tope cargado igual niega un punto a 1000 km');
select is(pg_temp.zona('N', -38.9540, -68.0600, null), 'not_enforced | - | 1500 | 0',
  'F-12: y dentro del tope todo sigue igual, con el envio del comercio');
select is(pg_temp.zona('N', null, null, null), 'max_radius_needs_point | - | - | -',
  'F-12: con tope y sin punto del cliente se niega, exigida o no la cobertura');
select is((public.resolve_delivery_zone(pg_temp.id('N'), -34.6037, -58.3816, null) ->> 'enforced')::boolean, false,
  'F-12: la respuesta sigue diciendo que la cobertura no se exige');

-- Si el punto del local deja de estar verificado, el tope niega: no se ignora.
update private.rider_map_business_locations set human_verified = false, source = 'qa_fixture' where business_id = pg_temp.id('D');
select is(pg_temp.zona('D', -38.9540, -68.0600, 'Centro'), 'max_radius_needs_point | - | - | -',
  'un tope sin punto del local verificado niega en vez de dejar pasar');
update private.rider_map_business_locations set human_verified = true, source = 'business_verified' where business_id = pg_temp.id('D');

-- ══ 4 · POR LA RPC PÚBLICA DEL PEDIDO ════════════════════════════════════════
-- D tiene tope de 5000 m. El punto por defecto esta a unos 280 m del local.
select is(pg_temp.pedir('D', 'centro-0001', 6, pg_temp.envio('Centro')),
  '{"ok": true, "delivery_fee": 800.00, "subtotal": 6000.00, "total": 6800.00, "zone": "Centro", "mode": "delivery"}'::jsonb,
  'direccion dentro de la zona: el pedido nace con el envio de la zona');
select is(pg_temp.stock('D'), 494, 'y descuenta el stock');

select is(pg_temp.pedir('D', 'tilde-0001', 5, pg_temp.envio('  CÉNTRO ')) -> 'delivery_fee', '800.00'::jsonb,
  'el barrio escrito con mayusculas y tilde es la misma zona');
select is(pg_temp.pedir('D', 'nombre-0001', 9, pg_temp.envio('Zona 1')) ->> 'zone', 'Zona 1',
  'F-09: elegir el nombre publicado de la zona crea el pedido');
select is(pg_temp.stock('D'), 480, 'tres pedidos: 6 + 5 + 9 unidades menos');

select is(pg_temp.pedir('D', 'afuera-0001', 6, pg_temp.envio('Plottier')) - 'hint',
  '{"ok": false, "sqlstate": "55000", "message": "OUT_OF_DELIVERY_ZONE", "detail": "la direccion no esta dentro de la cobertura declarada"}'::jsonb,
  'direccion fuera de toda zona: OUT_OF_DELIVERY_ZONE');
select is(pg_temp.pedir('D', 'parecido-0001', 6, pg_temp.envio('Centro Oeste')) ->> 'message', 'OUT_OF_DELIVERY_ZONE',
  'un barrio parecido a uno con cobertura: OUT_OF_DELIVERY_ZONE');
select is(pg_temp.pedir('D', 'desactivada-0001', 6, pg_temp.envio('Alta Barda')) ->> 'message', 'OUT_OF_DELIVERY_ZONE',
  'zona desactivada: OUT_OF_DELIVERY_ZONE');
select is(pg_temp.pedir('D', 'lejos-0001', 6, pg_temp.envio('Centro', '-34.6037', '-58.3816')) ->> 'message', 'OUT_OF_DELIVERY_ZONE',
  'F-01: un punto mas alla del tope declarando Centro: OUT_OF_DELIVERY_ZONE');
select is(pg_temp.pedir('D', 'minimo-0001', 4, pg_temp.envio('Centro')) - 'detail',
  '{"ok": false, "sqlstate": "23514", "message": "subtotal inferior al minimo de delivery"}'::jsonb,
  'pedido por debajo del minimo de la zona: rechazado');
select is(pg_temp.pedir('D', 'minimo-0002', 11, pg_temp.envio('Confluencia')) ->> 'message', 'subtotal inferior al minimo de delivery',
  'el minimo es el de la zona elegida: 11000 no alcanza los 12000 de Confluencia');
select is(pg_temp.pedir('D', 'minimo-0003', 12, pg_temp.envio('Confluencia')),
  '{"ok": true, "delivery_fee": 2500.00, "subtotal": 12000.00, "total": 14500.00, "zone": "Confluencia", "mode": "delivery"}'::jsonb,
  'y con 12000 nace, con el envio de Confluencia');
select is(pg_temp.pedir('D', 'poligono-0001', 1, pg_temp.envio('Centro', '-38.9770', '-68.0350')),
  '{"ok": true, "delivery_fee": 3000.00, "subtotal": 1000.00, "total": 4000.00, "zone": "Ribera", "mode": "delivery"}'::jsonb,
  'un punto dentro del poligono paga el envio del poligono aunque declare Centro');

-- El envio lo decide el servidor: ninguna clave de precio entra por el pedido.
select is(pg_temp.pedir('D', 'precio-0001', 6, pg_temp.envio('Centro') || '{"delivery_fee": 0}') ->> 'ok', 'false',
  'un pedido que trae delivery_fee se rechaza');
select matches(pg_temp.pedir('D', 'precio-0001', 6, pg_temp.envio('Centro') || '{"delivery_fee": 0}') ->> 'message', 'no permitido',
  'y dice que el campo no esta permitido');
select is(pg_temp.pedir('D', 'precio-0002', 6, pg_temp.envio('Centro') || '{"total": 1}') ->> 'ok', 'false',
  'tampoco entra un total');
select is(pg_temp.pedir('D', 'precio-0003', 6, pg_temp.envio('Centro') || '{"minimum_subtotal": 0}') ->> 'ok', 'false',
  'ni un minimo');
select is(pg_temp.pedir('D', 'precio-0004', 6, pg_temp.envio('Centro') || '{"delivery_zone_id": "d6500000-0000-4000-8000-0000000000f1"}') ->> 'ok', 'false',
  'ni la zona elegida por identificador');

select is(pg_temp.stock('D'), 467, 'ningun rechazo toco el stock (480 - 12 - 1 de los dos pedidos que si nacieron)');
select is((select count(*)::integer from public.orders where business_id = pg_temp.id('D')), 5, 'y hay exactamente cinco pedidos');

-- Retiro: sin envio, y cada canal respeta su interruptor.
select is(pg_temp.pedir('D', 'retiro-0001', 1, '{"delivery_mode": "pickup"}'),
  '{"ok": true, "delivery_fee": 0.00, "subtotal": 1000.00, "total": 1000.00, "zone": null, "mode": "pickup"}'::jsonb,
  'el retiro no paga envio ni tiene minimo de delivery');
update public.businesses set pickup_enabled = false where id = pg_temp.id('D');
select is(pg_temp.pedir('D', 'retiro-0002', 1, '{"delivery_mode": "pickup"}') - 'detail',
  '{"ok": false, "sqlstate": "55000", "message": "retiro no habilitado"}'::jsonb,
  'retiro con el retiro apagado: rechazado');
select is(pg_temp.pedir('D', 'centro-0002', 6, pg_temp.envio('Centro')) ->> 'ok', 'true', 'y el delivery sigue funcionando');
update public.businesses set pickup_enabled = true, delivery_enabled = false where id = pg_temp.id('D');
select is(pg_temp.pedir('D', 'centro-0003', 6, pg_temp.envio('Centro')) - 'detail',
  '{"ok": false, "sqlstate": "55000", "message": "delivery no habilitado"}'::jsonb,
  'delivery con el delivery apagado: rechazado');
update public.businesses set delivery_enabled = true where id = pg_temp.id('D');
select is(pg_temp.stock('D'), 460, 'los dos rechazos por canal apagado no tocaron el stock');

-- F-12 por la RPC publica: cobertura sin exigir, tope cargado.
select is(pg_temp.pedir('N', 'n-lejos-0001', 1, pg_temp.envio(null, '-34.6037', '-58.3816')) ->> 'message', 'OUT_OF_DELIVERY_ZONE',
  'F-12: sin exigir cobertura, un pedido mas alla del tope cargado se rechaza');
select is(pg_temp.stock('N'), 500, 'y no toca el stock');
select is(pg_temp.pedir('N', 'n-cerca-0001', 1, pg_temp.envio(null)),
  '{"ok": true, "delivery_fee": 1500.00, "subtotal": 1000.00, "total": 2500.00, "zone": null, "mode": "delivery"}'::jsonb,
  'F-12: dentro del tope nace con el envio del comercio');

-- ══ 5 · LA COTIZACIÓN PÚBLICA DICE LO MISMO QUE EL ALTA ══════════════════════
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(
  (public.commerce_availability('d6500000-0000-4000-8000-0000000000b1', 'delivery',
    '{"latitude":"-38.9540","longitude":"-68.0600","neighborhood":"Zona 1"}'::jsonb) -> 'delivery') - 'message',
  '{"eligible": true, "reason": "ok", "zone_name": "Zona 1", "delivery_fee": 900, "minimum_subtotal": 8000}'::jsonb,
  'F-09: anon cotiza el nombre publicado y recibe ese envio');
select is(
  (select jsonb_agg(a ->> 'name' order by a ->> 'name')
     from jsonb_array_elements(public.commerce_availability('d6500000-0000-4000-8000-0000000000b1', 'delivery', '{}'::jsonb) -> 'areas') a
    where public.commerce_availability('d6500000-0000-4000-8000-0000000000b1', 'delivery',
            jsonb_build_object('latitude', '-38.9540', 'longitude', '-68.0600', 'neighborhood', a ->> 'name')) -> 'delivery' ->> 'zone_name'
          is distinct from a ->> 'name'),
  null, 'F-09: cada barrio de la lista publicada cotiza a su propia zona');
select is(
  public.commerce_availability('d6500000-0000-4000-8000-0000000000b2', 'delivery',
    '{"latitude":"-34.6037","longitude":"-58.3816"}'::jsonb) -> 'delivery' ->> 'reason',
  'out_of_coverage', 'F-12: la cotizacion de un punto mas alla del tope dice fuera de cobertura');
reset role;

-- ══ 6 · `set_service_enforcement`: NULL ES «DEJAR COMO ESTÁ» (F-10) ══════════
-- W no esta verificado: horario exigido, cobertura sin exigir.
select is(pg_temp.banderas('W'), 'horario=true cobertura=false alcohol=false verificado=false', 'punto de partida de W');
select is(pg_temp.exigir('e5', 'W', null, true), 'ok horario=true cobertura=true alcohol=false huso=America/Argentina/Buenos_Aires',
  'F-10: encender solo la cobertura (horario NULL) NO apaga el horario');
select is(pg_temp.exigir('e5', 'W', true, null), 'ok horario=true cobertura=true alcohol=false huso=America/Argentina/Buenos_Aires',
  'F-10: tocar solo el horario (cobertura NULL) NO apaga la cobertura');
select is(pg_temp.exigir('e5', 'W', null, null), 'ok horario=true cobertura=true alcohol=false huso=America/Argentina/Buenos_Aires',
  'F-10: todo NULL no cambia nada');
select is(pg_temp.exigir('e5', 'W', null, null, true), 'ok horario=true cobertura=true alcohol=true huso=America/Argentina/Buenos_Aires',
  'la bandera de alcohol se enciende sola');
select is(pg_temp.exigir('e5', 'W', null, null, null, 'America/Argentina/Cordoba'), 'ok horario=true cobertura=true alcohol=true huso=America/Argentina/Cordoba',
  'y el huso se cambia solo');
-- Sin verificar, apagar sigue permitido y es explicito.
select is(pg_temp.exigir('e5', 'W', false, false, false), 'ok horario=false cobertura=false alcohol=false huso=America/Argentina/Cordoba',
  'un comercio sin verificar apaga las exigencias con FALSE explicito');
-- Las guardas que ya existian siguen en pie con el nuevo significado de NULL.
delete from public.business_service_hours where business_id = pg_temp.id('W');
select is(pg_temp.exigir('e5', 'W', true, null), '55000 no hay horarios cargados: exigirlos dejaria el comercio cerrado',
  'encender el horario sin una franja se sigue negando');
update public.delivery_zones set is_active = false where business_id = pg_temp.id('W');
select is(pg_temp.exigir('e5', 'W', null, true), '55000 no hay zonas activas: exigir cobertura cancelaria todos los envios',
  'encender la cobertura sin una zona activa se sigue negando');
select is(pg_temp.exigir('e5', 'W', null, null, true, 'Marte/Fobos'), '22023 huso horario desconocido',
  'un huso desconocido se sigue negando');
select is(pg_temp.banderas('W'), 'horario=false cobertura=false alcohol=false verificado=false', 'los tres rechazos no escribieron nada');

-- ══ 7 · UN COMERCIO VERIFICADO NO APAGA SUS REGLAS (CAT-01) ══════════════════
select is(pg_temp.banderas('V'), 'horario=true cobertura=true alcohol=false verificado=true', 'punto de partida de V: verificado y con reglas');
select is(pg_temp.exigir('e1', 'V', false, false), '55000 ENFORCEMENT_LOCKED', 'el dueño no apaga las dos exigencias de un comercio verificado');
select is(pg_temp.exigir('e1', 'V', false, null), '55000 ENFORCEMENT_LOCKED', 'ni solo el horario');
select is(pg_temp.exigir('e1', 'V', null, false), '55000 ENFORCEMENT_LOCKED', 'ni solo la cobertura');
select is(pg_temp.exigir('e1', 'V', true, false), '55000 ENFORCEMENT_LOCKED', 'ni la cobertura dejando el horario');
select is(pg_temp.exigir('e2', 'V', false, false), '55000 ENFORCEMENT_LOCKED', 'tampoco el encargado');
select is(pg_temp.exigir('e3', 'V', false, false), '55000 ENFORCEMENT_LOCKED', 'tampoco un integrante con la delegacion comercial');
select is(pg_temp.exigir('e4', 'V', false, false), '42501 sin autorizacion para cambiar la exigencia',
  'y un integrante sin delegacion sigue sin poder tocar nada');
select is(pg_temp.banderas('V'), 'horario=true cobertura=true alcohol=false verificado=true', 'ningun intento cambio nada');
select is((select count(*)::integer from public.business_config_audit where business_id = pg_temp.id('V') and scope = 'enforcement'), 0,
  'ni dejo una fila de auditoria: no hubo cambio');

-- Lo que sigue permitido con el comercio verificado.
select is(pg_temp.exigir('e1', 'V', true, true), 'ok horario=true cobertura=true alcohol=false huso=America/Argentina/Buenos_Aires',
  'confirmar las dos exigencias encendidas (lo que manda el Panel) no se niega');
select is(pg_temp.exigir('e1', 'V', null, null, true), 'ok horario=true cobertura=true alcohol=true huso=America/Argentina/Buenos_Aires',
  'encender la grilla de alcohol sigue permitido');
select is(pg_temp.exigir('e1', 'V', true, true, false), 'ok horario=true cobertura=true alcohol=false huso=America/Argentina/Buenos_Aires',
  'y apagarla tambien: la ventana de la politica de alcohol rige igual');
select is(pg_temp.exigir('e3', 'V', null, null, null, 'America/Argentina/Cordoba'), 'ok horario=true cobertura=true alcohol=false huso=America/Argentina/Cordoba',
  'cambiar el huso sigue permitido');

-- El mensaje dice que hacer.
do $$
declare v_detail text; v_hint text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'd6500000-0000-4000-8000-0000000000a1', 'role', 'authenticated',
    'session_id', 'd6500000-0000-4000-8000-0000000000e1')::text, true);
  perform public.set_service_enforcement('d6500000-0000-4000-8000-0000000000b4', false, false);
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  perform set_config('taba.test_lock_detail', v_detail, true);
  perform set_config('taba.test_lock_hint', v_hint, true);
end $$;
select matches(current_setting('taba.test_lock_detail', true), 'verificado', 'el rechazo explica que el comercio esta verificado');
select matches(current_setting('taba.test_lock_hint', true), 'pausar o cerrar', 'y dice que para dejar de vender se pausa o se cierra');

-- Con las reglas encendidas el comercio verificado NO toma pedidos a las 04:00 ni a otra ciudad.
select is(public.business_is_open(pg_temp.id('V'), 'delivery', '2026-10-07 04:00-03'), false,
  'V a las 04:00: cerrado, porque el horario sigue exigido');
select is(pg_temp.zona('V', -34.6037, -58.3816, 'Palermo'), 'out_of_zone | - | - | -',
  'V a una direccion de otra ciudad: sin cobertura, porque la cobertura sigue exigida');

-- Quien quiere operar sin reglas pide la revocacion; despues si puede.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((public.platform_revoke_business_ordering('d6500000-0000-4000-8000-0000000000b4', 'reparto-plataforma@example.invalid',
  'reparto-v', 'operar sin reglas')) ->> 'changed', 'true', 'la plataforma revoca la verificacion');
reset role;
select is(pg_temp.exigir('e1', 'V', false, false), 'ok horario=false cobertura=false alcohol=false huso=America/Argentina/Cordoba',
  'revocada la verificacion, el dueño apaga las exigencias');
select is((select count(*)::integer from public.business_config_audit where business_id = pg_temp.id('V') and scope = 'enforcement'), 4,
  'los cuatro cambios reales quedaron auditados');

select * from finish();
rollback;
