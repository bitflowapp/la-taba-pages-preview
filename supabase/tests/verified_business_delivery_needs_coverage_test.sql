-- TABA · UN COMERCIO VERIFICADO NO ENCIENDE EL DELIVERY SIN COBERTURA
--
-- Cubre 20261001216000. La puerta: un comercio verificado sólo con retiro encendía
-- después el delivery sin zonas ni cobertura exigida, y entregaba a cualquier dirección
-- con la tarifa plana.
--
-- Se prueba por las dos puertas (la RPC `set_business_fulfillment` y el UPDATE directo
-- de `delivery_enabled`, con cambio real de rol) y con la clave de servicio:
--
--   · sin cobertura exigida, con la cobertura exigida y sin zona, con la zona
--     desactivada, con un tope de distancia y el punto del local sin verificar: no;
--   · con todo cargado: sí;
--   · un comercio sin verificar lo enciende como siempre;
--   · un comercio verificado que ya lo tenía encendido no se toca, y lo puede apagar;
--   · revocada la verificación, la regla deja de aplicar.
--
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
values
  ('d6600000-0000-4000-8000-0000000000a1','authenticated','authenticated','cobertura-owner@example.invalid','',now(),'{}','{}',false,now(),now()),
  ('d6600000-0000-4000-8000-0000000000a5','authenticated','authenticated','cobertura-plataforma@example.invalid','',now(),'{}','{}',false,now(),now());

create temporary table cobertura_ids (clave text primary key, id uuid not null) on commit drop;
insert into cobertura_ids values
  ('R', 'd6600000-0000-4000-8000-0000000000b1'),   -- verificado, sólo retiro: el caso de la puerta
  ('S', 'd6600000-0000-4000-8000-0000000000b2'),   -- sin verificar, sólo retiro
  ('L', 'd6600000-0000-4000-8000-0000000000b3');   -- verificado, con delivery YA encendido y sin cobertura (heredado)
create function pg_temp.id(p_clave text) returns uuid language sql stable as $$
  select id from cobertura_ids where clave = p_clave
$$;

insert into public.businesses(id,name,slug,status,is_active,currency_code,address,pickup_enabled,delivery_enabled,delivery_fee,minimum_delivery_subtotal,
  operating_timezone,hours_enforced,delivery_zone_enforced,ordering_verified,ordering_verified_at,ordering_verified_by,ordering_enabled,order_intake_guard_mode)
values
  (pg_temp.id('R'),'Cobertura R','cobertura-r','open',true,'ARS','Mendoza 827, Neuquen',true,false,1500,0,
    'America/Argentina/Buenos_Aires',false,false,true,now(),'d6600000-0000-4000-8000-0000000000a5',true,'off'),
  (pg_temp.id('S'),'Cobertura S','cobertura-s','closed',true,'ARS','Mendoza 827, Neuquen',true,false,1500,0,
    'America/Argentina/Buenos_Aires',false,false,false,null,null,false,'off'),
  (pg_temp.id('L'),'Cobertura L','cobertura-l','open',true,'ARS','Mendoza 827, Neuquen',true,true,1500,0,
    'America/Argentina/Buenos_Aires',false,false,true,now(),'d6600000-0000-4000-8000-0000000000a5',true,'off');

insert into public.business_members(business_id,user_id,role,is_active)
select pg_temp.id(c), 'd6600000-0000-4000-8000-0000000000a1', 'owner', true from unnest(array['R','S','L']) c;
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values
  ('d6600000-0000-4000-8000-0000000000e1','d6600000-0000-4000-8000-0000000000a1',pg_temp.id('R'),'owner','panel_web'),
  ('d6600000-0000-4000-8000-0000000000e2','d6600000-0000-4000-8000-0000000000a1',pg_temp.id('S'),'owner','panel_web'),
  ('d6600000-0000-4000-8000-0000000000e3','d6600000-0000-4000-8000-0000000000a1',pg_temp.id('L'),'owner','panel_web');

create function pg_temp.sesion(p_clave text) returns text language sql immutable as $$
  select 'd6600000-0000-4000-8000-0000000000e' || case p_clave when 'R' then '1' when 'S' then '2' else '3' end
$$;

-- El dueño, con la sesión del Panel de ese comercio.
create function pg_temp.como_dueno(p_clave text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', 'd6600000-0000-4000-8000-0000000000a1',
    'role', 'authenticated', 'session_id', pg_temp.sesion(p_clave))::text, true)::void;
$$;

-- Encender (o apagar) el delivery por la RPC del Panel. Devuelve 'ok' o «SQLSTATE detalle».
create function pg_temp.por_rpc(p_clave text, p_delivery boolean) returns text language plpgsql as $$
declare v_detail text;
begin
  perform pg_temp.como_dueno(p_clave);
  begin
    perform public.set_business_fulfillment(pg_temp.id(p_clave), p_delivery, true);
    return 'ok';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return sqlstate || ' ' || coalesce(v_detail, sqlerrm);
  end;
end $$;

-- Lo mismo con un UPDATE directo de la columna, con el rol de la API.
create function pg_temp.directo(p_clave text, p_delivery boolean, p_rol text default 'authenticated') returns text
language plpgsql as $$
declare
  v_detail text; v_rows integer;
  -- Se resuelve antes de cambiar de rol: la tabla temporal de ids es de quien corre la prueba.
  v_id uuid := pg_temp.id(p_clave);
begin
  if p_rol = 'authenticated' then
    perform pg_temp.como_dueno(p_clave);
  else
    perform set_config('request.jwt.claims', json_build_object('role', p_rol)::text, true);
  end if;
  execute format('set local role %I', p_rol);
  begin
    update public.businesses set delivery_enabled = p_delivery where id = v_id;
    get diagnostics v_rows = row_count;
    reset role;
    return case when v_rows = 1 then 'ok' else 'sin filas' end;
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    reset role;
    return sqlstate || ' ' || coalesce(v_detail, sqlerrm);
  end;
end $$;

create function pg_temp.delivery(p_clave text) returns boolean language sql stable as $$
  select delivery_enabled from public.businesses where id = pg_temp.id(p_clave)
$$;

-- ══ 1 · La regla existe y nadie la llama a mano ═════════════════════════════
select is(
  (select pg_get_triggerdef(t.oid) ~ 'BEFORE UPDATE ON public.businesses'
     from pg_trigger t where t.tgrelid = 'public.businesses'::regclass and t.tgname = 'businesses_verified_delivery_needs_coverage'),
  true, 'el trigger esta sobre businesses, antes del UPDATE');
select ok(
  not has_function_privilege('anon', 'public.guard_verified_business_delivery_coverage()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.guard_verified_business_delivery_coverage()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.guard_verified_business_delivery_coverage()', 'EXECUTE'),
  'ningun rol de la API ejecuta la funcion del trigger');

-- ══ 2 · Verificado sólo con retiro: sin cobertura, el delivery no se enciende ═
select is(pg_temp.por_rpc('R', true), '22023 DELIVERY_COVERAGE: la cobertura no esta exigida',
  'por la RPC del Panel: no, y dice que falta exigir la cobertura');
select is(pg_temp.directo('R', true), '22023 DELIVERY_COVERAGE: la cobertura no esta exigida',
  'con un UPDATE directo del dueño: tampoco');
select is(pg_temp.directo('R', true, 'service_role'), '22023 DELIVERY_COVERAGE: la cobertura no esta exigida',
  'ni con la clave de servicio');
select is(pg_temp.delivery('R'), false, 'el delivery sigue apagado');

-- Exigir la cobertura sin una zona no alcanza.
update public.businesses set delivery_zone_enforced = true where id = pg_temp.id('R');
select is(pg_temp.por_rpc('R', true), '22023 DELIVERY_COVERAGE: no hay una zona de entrega activa con su costo de envio',
  'con la cobertura exigida y sin zona: no');

-- Una zona desactivada no cuenta.
insert into public.delivery_zones(id,business_id,name,is_active,match_kind,area_normalized,boundary,delivery_fee,minimum_subtotal,priority)
values ('d6600000-0000-4000-8000-0000000000f1',pg_temp.id('R'),'Centro',false,'declared_area','centro',null,800,0,10);
select is(pg_temp.directo('R', true), '22023 DELIVERY_COVERAGE: no hay una zona de entrega activa con su costo de envio',
  'con la unica zona desactivada: no');

-- Con la zona activa y un tope de distancia, falta el punto del local.
update public.delivery_zones set is_active = true where id = 'd6600000-0000-4000-8000-0000000000f1';
update public.businesses set delivery_max_radius_meters = 2500 where id = pg_temp.id('R');
select is(pg_temp.por_rpc('R', true), '22023 DELIVERY_COVERAGE: hay un tope de distancia y el punto del local no esta verificado',
  'con un tope de distancia y sin el punto del local verificado: no');
insert into private.rider_map_business_locations(business_id, latitude, longitude, source, human_verified)
values (pg_temp.id('R'), -38.9516, -68.0591, 'qa_fixture', false);
select is(pg_temp.por_rpc('R', true), '22023 DELIVERY_COVERAGE: hay un tope de distancia y el punto del local no esta verificado',
  'un punto que no verifico una persona no cuenta');
select is(pg_temp.delivery('R'), false, 'despues de todos los rechazos el delivery sigue apagado');
select is(
  (select count(*)::integer from public.business_config_audit a where a.business_id = pg_temp.id('R') and a.scope = 'fulfillment'),
  0, 'y ningun rechazo dejo una fila de auditoria de entrega');

-- ══ 3 · Con todo cargado, se enciende ═══════════════════════════════════════
update private.rider_map_business_locations set human_verified = true, source = 'business_verified' where business_id = pg_temp.id('R');
select is(pg_temp.por_rpc('R', true), 'ok', 'cobertura exigida, zona activa y punto verificado: la RPC lo enciende');
select is(pg_temp.delivery('R'), true, 'el delivery quedo encendido');
select is(pg_temp.por_rpc('R', false), 'ok', 'apagarlo siempre se puede');
select is(pg_temp.directo('R', true), 'ok', 'y el UPDATE directo tambien lo enciende con todo cargado');

-- Sin tope de distancia no hace falta el punto.
select is(pg_temp.directo('R', false), 'ok', 'se apaga de nuevo');
update public.businesses set delivery_max_radius_meters = null where id = pg_temp.id('R');
delete from private.rider_map_business_locations where business_id = pg_temp.id('R');
select is(pg_temp.por_rpc('R', true), 'ok', 'sin tope de distancia alcanza con la cobertura exigida y la zona');

-- La zona sin envio propio vale si el comercio tiene el suyo.
select is(pg_temp.por_rpc('R', false), 'ok', 'se apaga otra vez');
update public.delivery_zones set delivery_fee = null where id = 'd6600000-0000-4000-8000-0000000000f1';
select is(pg_temp.por_rpc('R', true), 'ok', 'una zona sin envio propio cuenta cuando el comercio tiene el suyo');

-- ══ 4 · Lo que no cambia ════════════════════════════════════════════════════
select is(pg_temp.por_rpc('S', true), 'ok', 'un comercio sin verificar enciende el delivery como siempre');
select is(pg_temp.directo('S', false) || '/' || pg_temp.directo('S', true), 'ok/ok', 'tambien con UPDATE directo');

-- Verificado con el delivery ya encendido y sin cobertura (anterior a la regla).
select lives_ok(
  $$update public.businesses set delivery_fee = 1800, name = 'Cobertura L bis' where id = pg_temp.id('L')$$,
  'un comercio verificado que ya tenia el delivery encendido se sigue pudiendo editar');
select is(pg_temp.por_rpc('L', false), 'ok', 'y puede apagar el delivery');
select is(pg_temp.por_rpc('L', true), '22023 DELIVERY_COVERAGE: la cobertura no esta exigida',
  'para volver a encenderlo ya necesita la cobertura');

-- ══ 5 · Revocada la verificación, la regla deja de aplicar ══════════════════
update public.businesses
   set ordering_verified = false, ordering_verified_at = null, ordering_verified_by = null, ordering_enabled = false
 where id = pg_temp.id('L');
select is(pg_temp.por_rpc('L', true), 'ok', 'sin la verificacion el comercio enciende el delivery sin cobertura');
select is(pg_temp.delivery('L'), true, 'y queda encendido: lo va a frenar la verificacion');

select * from finish();
rollback;
