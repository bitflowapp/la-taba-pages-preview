-- ============================================================================
--  Ensayos hostiles del motor comercial: horario, cobertura, tarifa y mínimo
-- ============================================================================
--
--  Corre contra PostgreSQL real sobre una base creada VACÍA. Todo lo que hay acá
--  adentro es fixture sintético: ni un horario, ni un barrio, ni una tarifa de
--  LA TABA2 AUTOSERVICIO. Los datos reales no entran en una prueba.
--
--  Lo que se demuestra, en orden: que con las banderas apagadas NADA cambia; que
--  encendidas el turno partido y el cruce de medianoche se resuelven bien; que
--  la cobertura es una lista blanca y niega por defecto; que el envío y el
--  mínimo los decide el backend y el navegador no puede moverlos; que un staff
--  no toca la configuración; que la respuesta al cliente no revela por qué no
--  llegamos; y que todo cambio deja un rastro con nombre y apellido.
-- ============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(112);

-- ── El contrato existe ───────────────────────────────────────────────────────
select has_table('public', 'business_service_hours', 'la tabla de horarios existe');
select has_table('public', 'business_service_exceptions', 'la tabla de excepciones existe');
select has_table('public', 'delivery_zones', 'la tabla de zonas existe');
select has_table('public', 'business_config_audit', 'la tabla de auditoria existe');
select has_function('public', 'business_is_open', array['uuid', 'text', 'timestamptz'], 'business_is_open existe');
select has_function('public', 'resolve_delivery_zone', array['uuid', 'double precision', 'double precision', 'text'], 'resolve_delivery_zone existe');
select has_function('public', 'commerce_availability', array['uuid', 'text', 'jsonb'], 'commerce_availability existe');

-- Las internas NO llegan al navegador; la del cliente sí y es lo único público.
select ok(not has_function_privilege('anon', 'public.resolve_delivery_zone(uuid,double precision,double precision,text)'::regprocedure, 'execute'),
  'anon no puede llamar a la resolucion interna de zona');
select ok(not has_function_privilege('authenticated', 'public.resolve_delivery_zone(uuid,double precision,double precision,text)'::regprocedure, 'execute'),
  'un autenticado cualquiera tampoco llama a la resolucion interna');
select ok(not has_function_privilege('anon', 'public.business_is_open(uuid,text,timestamptz)'::regprocedure, 'execute'),
  'anon no puede llamar a business_is_open');
select ok(has_function_privilege('anon', 'public.commerce_availability(uuid,text,jsonb)'::regprocedure, 'execute'),
  'la respuesta comercial si es publica: la tienda la necesita sin sesion');

-- Nadie escribe las tablas de configuracion a mano.
select ok(not has_table_privilege('authenticated', 'public.delivery_zones', 'insert'), 'nadie inserta zonas por tabla');
select ok(not has_table_privilege('authenticated', 'public.delivery_zones', 'update'), 'nadie edita zonas por tabla');
select ok(not has_table_privilege('authenticated', 'public.delivery_zones', 'delete'), 'nadie borra zonas por tabla');
select ok(not has_table_privilege('authenticated', 'public.business_service_hours', 'insert'), 'nadie inserta horarios por tabla');
select ok(not has_table_privilege('authenticated', 'public.business_config_audit', 'insert'), 'nadie escribe la auditoria a mano');
select ok(not has_table_privilege('authenticated', 'public.business_config_audit', 'update'), 'la auditoria no se edita');
select ok(not has_table_privilege('authenticated', 'public.business_config_audit', 'delete'), 'la auditoria no se borra');

-- ── Fixture sintético ────────────────────────────────────────────────────────
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ops-owner@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ops-staff@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'ops-outsider@example.invalid', '', now(), '{}', '{}', now(), now());

insert into public.businesses(id, name, slug, status, is_active, currency_code, delivery_enabled, pickup_enabled,
                              delivery_fee, minimum_delivery_subtotal, ordering_enabled, ordering_verified)
values ('a2000000-0000-4000-8000-000000000001', 'Fixture operaciones', 'fixture-operaciones', 'open', true, 'ARS', true, true,
        1000, 5000, false, false);

insert into public.business_members(business_id, user_id, role, is_active) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner', true),
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'staff', true);

-- ── 1 · CON LAS BANDERAS APAGADAS, NADA CAMBIA ───────────────────────────────
select ok(public.business_is_open('a2000000-0000-4000-8000-000000000001', 'delivery', '2026-08-11 03:00-03'::timestamptz),
  'sin exigencia de horario, a las 3 de la manana esta abierto: es el comportamiento de hoy');
select is(
  (public.resolve_delivery_zone('a2000000-0000-4000-8000-000000000001', -38.95, -68.05, 'cualquier barrio') ->> 'eligible')::boolean,
  true, 'sin exigencia de cobertura, cualquier direccion entra con la tarifa del negocio');
select is(
  (public.resolve_delivery_zone('a2000000-0000-4000-8000-000000000001', null, null, null) ->> 'delivery_fee')::numeric,
  1000::numeric, 'sin exigencia, la tarifa es la columna del negocio');
select is(
  public.business_next_open_at('a2000000-0000-4000-8000-000000000001', 'delivery', now()),
  null, 'sin exigencia no hay proxima apertura: siempre esta abierto');

-- ── 2 · UN STAFF NO TOCA LA CONFIGURACIÓN ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $sql$select public.set_business_service_hours('a2000000-0000-4000-8000-000000000001','delivery','[]'::jsonb)$sql$,
  '42501', 'sin autorizacion para configurar horarios', 'un staff comun no carga horarios');
select throws_ok(
  $sql$select public.upsert_delivery_zone('a2000000-0000-4000-8000-000000000001','{"name":"Barrio del staff","match_kind":"declared_area"}'::jsonb)$sql$,
  '42501', 'sin autorizacion para configurar zonas', 'un staff comun no crea zonas');
select throws_ok(
  $sql$select public.set_delivery_pricing('a2000000-0000-4000-8000-000000000001', 0, 0)$sql$,
  '42501', 'sin autorizacion para configurar precios de envio', 'un staff comun no cambia el costo de envio');
select throws_ok(
  $sql$select public.set_service_enforcement('a2000000-0000-4000-8000-000000000001', false, false)$sql$,
  '42501', 'sin autorizacion para cambiar la exigencia', 'un staff comun no apaga la exigencia');
-- Y tampoco se auto-delega el permiso por la puerta de al lado.
select throws_ok(
  $sql$select public.set_commercial_settings_delegation('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002', true)$sql$,
  '42501', 'solo owner o admin delegan la configuracion comercial', 'un staff no se delega el permiso a si mismo');
select is((select count(*)::int from public.business_commercial_managers
            where user_id = 'a1000000-0000-4000-8000-000000000002'), 0,
  'el intento del staff no dejo el permiso encendido');
-- La delegacion NO vive en business_members: esa tabla la administra la capa de
-- identidad y rechaza cualquier escritura que no venga de sus RPC.
select hasnt_column('public', 'business_members', 'can_manage_commercial_settings',
  'este paquete no le agrega columnas a la tabla de membresias');

-- Un ajeno al comercio no lee ni la configuracion.
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $sql$select public.get_business_operations_config('a2000000-0000-4000-8000-000000000001')$sql$,
  '42501', 'sin autorizacion para leer la configuracion', 'un ajeno no lee la configuracion del comercio');
select is((select count(*)::int from public.delivery_zones), 0,
  'RLS: un ajeno no ve ninguna fila de zonas');
select is((select count(*)::int from public.business_service_hours), 0,
  'RLS: un ajeno no ve ninguna franja horaria');

-- ── 3 · EL OWNER CARGA EL TURNO PARTIDO ──────────────────────────────────────
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $sql$select public.set_business_service_hours('a2000000-0000-4000-8000-000000000001','delivery',
    '[{"weekday":0,"opens_at":"08:00","closes_at":"14:00"},{"weekday":0,"opens_at":"17:30","closes_at":"22:30"},
      {"weekday":1,"opens_at":"08:00","closes_at":"14:00"},{"weekday":1,"opens_at":"17:30","closes_at":"22:30"},
      {"weekday":2,"opens_at":"08:00","closes_at":"14:00"},{"weekday":2,"opens_at":"17:30","closes_at":"22:30"},
      {"weekday":3,"opens_at":"08:00","closes_at":"14:00"},{"weekday":3,"opens_at":"17:30","closes_at":"22:30"},
      {"weekday":4,"opens_at":"08:00","closes_at":"14:00"},{"weekday":4,"opens_at":"17:30","closes_at":"22:30"},
      {"weekday":5,"opens_at":"08:00","closes_at":"14:00"},{"weekday":5,"opens_at":"17:30","closes_at":"22:30"},
      {"weekday":6,"opens_at":"08:00","closes_at":"14:00"},{"weekday":6,"opens_at":"17:30","closes_at":"22:30"}]'::jsonb)$sql$,
  'el owner carga dos franjas por dia para los siete dias');
select is((select count(*)::int from public.business_service_hours
            where business_id = 'a2000000-0000-4000-8000-000000000001' and channel = 'delivery'), 14,
  'quedaron catorce franjas: dos por dia');

-- Solapamiento y carga absurda se rechazan con un mensaje que dice qué pasa.
select throws_ok(
  $sql$select public.set_business_service_hours('a2000000-0000-4000-8000-000000000001','pickup',
    '[{"weekday":1,"opens_at":"08:00","closes_at":"14:00"},{"weekday":1,"opens_at":"13:00","closes_at":"18:00"}]'::jsonb)$sql$,
  '22023', 'hay franjas superpuestas en el mismo dia', 'dos franjas que se pisan no se guardan');
select throws_ok(
  $sql$select public.set_business_service_hours('a2000000-0000-4000-8000-000000000001','pickup',
    '[{"weekday":1,"opens_at":"22:00","closes_at":"02:00"},{"weekday":1,"opens_at":"01:00","closes_at":"03:00"}]'::jsonb)$sql$,
  '22023', 'hay franjas superpuestas en el mismo dia', 'el solapamiento se detecta tambien cruzando la medianoche');
select throws_ok(
  $sql$select public.set_business_service_hours('a2000000-0000-4000-8000-000000000001','pickup',
    '[{"weekday":1,"opens_at":"10:00","closes_at":"10:00"}]'::jsonb)$sql$,
  '22023', 'franja invalida: se espera weekday 0-6 y horas HH:MM distintas', 'una franja de ancho cero no se guarda');
select throws_ok(
  $sql$select public.set_business_service_hours('a2000000-0000-4000-8000-000000000001','pickup',
    '[{"weekday":7,"opens_at":"10:00","closes_at":"11:00"}]'::jsonb)$sql$,
  '22023', 'franja invalida: se espera weekday 0-6 y horas HH:MM distintas', 'un octavo dia de la semana no existe');

-- La franja que cruza la medianoche, en pickup y solo el lunes.
select lives_ok(
  $sql$select public.set_business_service_hours('a2000000-0000-4000-8000-000000000001','pickup',
    '[{"weekday":1,"opens_at":"22:00","closes_at":"02:00"}]'::jsonb)$sql$,
  'se guarda una franja que cruza la medianoche');

-- ── 4 · ENCENDER LA EXIGENCIA ────────────────────────────────────────────────
-- Sin huso no se puede exigir un horario, y se dice por qué.
select throws_ok(
  $sql$select public.set_service_enforcement('a2000000-0000-4000-8000-000000000001', true, false)$sql$,
  '22023', 'para exigir horarios hace falta declarar el huso horario',
  'exigir horarios sin huso se rechaza en vez de adivinarlo');
select throws_ok(
  $sql$select public.set_service_enforcement('a2000000-0000-4000-8000-000000000001', true, false, null, 'Marte/Olimpo')$sql$,
  '22023', 'huso horario desconocido', 'un huso inventado no se acepta');
-- Exigir cobertura sin una sola zona activa cancelaria todos los envios.
select throws_ok(
  $sql$select public.set_service_enforcement('a2000000-0000-4000-8000-000000000001', false, true, null, 'America/Argentina/Buenos_Aires')$sql$,
  '55000', 'no hay zonas activas: exigir cobertura cancelaria todos los envios',
  'no se puede encender la cobertura sin zonas: seria un apagon con un clic');

select lives_ok(
  $sql$select public.set_service_enforcement('a2000000-0000-4000-8000-000000000001', true, false, null, 'America/Argentina/Buenos_Aires')$sql$,
  'con horarios cargados y huso declarado, la exigencia se enciende');

-- ── 5 · HORARIO: DOS FRANJAS Y CRUCE DE MEDIANOCHE ───────────────────────────
-- `business_is_open` es interna: no está al alcance de `authenticated`, así que
-- las comprobaciones se hacen con el rol del servidor. Que haga falta cambiar de
-- rol para llamarla es, en sí mismo, parte de lo que se quería demostrar.
set local role postgres;
reset request.jwt.claims;
-- 2026-08-11 es martes; 2026-08-10 es lunes.
select ok(public.business_is_open('a2000000-0000-4000-8000-000000000001', 'delivery', '2026-08-11 09:00-03'::timestamptz),
  'delivery abierto a las 09:00, dentro de la franja de la manana');
select ok(not public.business_is_open('a2000000-0000-4000-8000-000000000001', 'delivery', '2026-08-11 15:00-03'::timestamptz),
  'delivery cerrado a las 15:00, en el corte del mediodia');
select ok(public.business_is_open('a2000000-0000-4000-8000-000000000001', 'delivery', '2026-08-11 18:00-03'::timestamptz),
  'delivery abierto a las 18:00, dentro de la franja de la tarde');
select ok(not public.business_is_open('a2000000-0000-4000-8000-000000000001', 'delivery', '2026-08-11 23:00-03'::timestamptz),
  'delivery cerrado a las 23:00, despues del cierre');
select ok(not public.business_is_open('a2000000-0000-4000-8000-000000000001', 'delivery', '2026-08-11 14:00-03'::timestamptz),
  'a las 14:00 en punto ya esta cerrado: la franja es [apertura, cierre)');
select ok(public.business_is_open('a2000000-0000-4000-8000-000000000001', 'delivery', '2026-08-11 08:00-03'::timestamptz),
  'a las 08:00 en punto ya esta abierto');

select ok(public.business_is_open('a2000000-0000-4000-8000-000000000001', 'pickup', '2026-08-10 23:00-03'::timestamptz),
  'pickup abierto el lunes a las 23:00, dentro de la franja que cruza');
select ok(public.business_is_open('a2000000-0000-4000-8000-000000000001', 'pickup', '2026-08-11 01:00-03'::timestamptz),
  'pickup abierto el martes a la 01:00: es el arrastre de la franja del lunes');
select ok(not public.business_is_open('a2000000-0000-4000-8000-000000000001', 'pickup', '2026-08-10 01:00-03'::timestamptz),
  'pickup CERRADO el lunes a la 01:00: la franja del lunes empieza a las 22:00 y el domingo no tiene ninguna');
select ok(not public.business_is_open('a2000000-0000-4000-8000-000000000001', 'pickup', '2026-08-12 01:00-03'::timestamptz),
  'pickup cerrado el miercoles a la 01:00: el martes no tiene franja que arrastre');
select ok(not public.business_is_open('a2000000-0000-4000-8000-000000000001', 'pickup', '2026-08-10 21:59-03'::timestamptz),
  'pickup cerrado un minuto antes de la apertura');

select is(public.business_next_open_at('a2000000-0000-4000-8000-000000000001', 'delivery', '2026-08-11 15:00-03'::timestamptz),
  '2026-08-11 17:30-03'::timestamptz, 'la proxima apertura despues del corte es la franja de la tarde');

-- ── 6 · DÍAS ESPECIALES ──────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $sql$select public.set_business_service_exception('a2000000-0000-4000-8000-000000000001','all','2026-08-11'::date, true, null, null, 'feriado sintetico')$sql$,
  'se carga un dia cerrado');
set local role postgres;
reset request.jwt.claims;
select ok(not public.business_is_open('a2000000-0000-4000-8000-000000000001', 'delivery', '2026-08-11 09:00-03'::timestamptz),
  'el dia cerrado manda sobre el horario recurrente');
select ok(not public.business_is_open('a2000000-0000-4000-8000-000000000001', 'pickup', '2026-08-11 01:00-03'::timestamptz),
  'un cierre explicito cierra toda la fecha, incluido el arrastre del dia anterior');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $sql$select public.set_business_service_exception('a2000000-0000-4000-8000-000000000001','all','2026-08-11'::date, false, '10:00','12:00','horario reducido')$sql$,
  'la misma fecha se reemplaza por un horario reducido');
set local role postgres;
reset request.jwt.claims;
select ok(public.business_is_open('a2000000-0000-4000-8000-000000000001', 'delivery', '2026-08-11 11:00-03'::timestamptz),
  'dentro del horario reducido esta abierto');
select ok(not public.business_is_open('a2000000-0000-4000-8000-000000000001', 'delivery', '2026-08-11 09:00-03'::timestamptz),
  'fuera del horario reducido esta cerrado aunque el horario recurrente diga que si');

-- ── 7 · LA LISTA BLANCA ──────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $sql$select public.upsert_delivery_zone('a2000000-0000-4000-8000-000000000001',
    '{"name":"Barrio sintetico A","match_kind":"declared_area","delivery_fee":"2500","minimum_subtotal":"4000","priority":10}'::jsonb)$sql$,
  'el owner crea una zona por barrio declarado');
select lives_ok(
  $sql$select public.upsert_delivery_zone('a2000000-0000-4000-8000-000000000001',
    '{"name":"Poligono sintetico","match_kind":"polygon","delivery_fee":"3000","priority":5,
      "boundary":[[-68.10,-38.99],[-68.00,-38.99],[-68.00,-38.90],[-68.10,-38.90]]}'::jsonb)$sql$,
  'el owner crea una zona por poligono');
select throws_ok(
  $sql$select public.upsert_delivery_zone('a2000000-0000-4000-8000-000000000001',
    '{"name":"Sin borde","match_kind":"polygon"}'::jsonb)$sql$,
  '22023', 'una zona por poligono necesita un borde', 'una zona por poligono sin borde no se guarda');
select throws_ok(
  $sql$select public.upsert_delivery_zone('a2000000-0000-4000-8000-000000000001',
    '{"name":"Radio","match_kind":"radius","delivery_fee":"1"}'::jsonb)$sql$,
  '22023', 'tipo de zona invalido: solo declared_area o polygon',
  'no existe una zona por radio: la cobertura no se concede por distancia');
select throws_ok(
  $sql$select public.upsert_delivery_zone('a2000000-0000-4000-8000-000000000001',
    '{"name":"Vertice roto","match_kind":"polygon","boundary":[[-68.1,-38.9],[-999,-38.9],[-68.0,-38.8]]}'::jsonb)$sql$,
  '22023', 'vertice invalido: se espera [lng, lat] dentro de rango', 'un vertice fuera del planeta no se guarda');

select lives_ok(
  $sql$select public.set_service_enforcement('a2000000-0000-4000-8000-000000000001', true, true, null, 'America/Argentina/Buenos_Aires')$sql$,
  'con zonas activas, la cobertura se puede exigir');

set local role postgres;
reset request.jwt.claims;

select is((public.resolve_delivery_zone('a2000000-0000-4000-8000-000000000001', null, null, 'Barrio sintetico A') ->> 'zone_name'),
  'Barrio sintetico A', 'el barrio declarado resuelve su zona');
select is((public.resolve_delivery_zone('a2000000-0000-4000-8000-000000000001', null, null, '  barrio   SINTETICO a. ') ->> 'zone_name'),
  'Barrio sintetico A', 'el plegado del nombre tolera acentos, mayusculas y puntuacion');
select is((public.resolve_delivery_zone('a2000000-0000-4000-8000-000000000001', null, null, 'Barrio sintetico A') ->> 'delivery_fee')::numeric,
  2500::numeric, 'la tarifa sale de la zona, no del negocio');
select is((public.resolve_delivery_zone('a2000000-0000-4000-8000-000000000001', null, null, 'Barrio sintetico A') ->> 'minimum_subtotal')::numeric,
  4000::numeric, 'el minimo sale de la zona');
select is((public.resolve_delivery_zone('a2000000-0000-4000-8000-000000000001', -38.95, -68.05, 'Barrio inexistente') ->> 'zone_name'),
  'Poligono sintetico', 'el punto confirmado dentro del poligono resuelve aunque el barrio declarado no exista');
select is((public.resolve_delivery_zone('a2000000-0000-4000-8000-000000000001', -38.95, -68.05, 'Barrio sintetico A') ->> 'match_kind'),
  'polygon', 'el poligono pesa mas que lo que alguien eligio de una lista');
select is((public.resolve_delivery_zone('a2000000-0000-4000-8000-000000000001', -38.95, -68.05, 'Barrio sintetico A') ->> 'delivery_fee')::numeric,
  3000::numeric, 'y por lo tanto se cobra la tarifa del poligono');

-- Fuera de la lista blanca: no se entrega.
select is((public.resolve_delivery_zone('a2000000-0000-4000-8000-000000000001', -38.93, -67.99, 'Barrio inexistente') ->> 'eligible')::boolean,
  false, 'una direccion fuera de la lista blanca no es elegible');
select is((public.resolve_delivery_zone('a2000000-0000-4000-8000-000000000001', null, null, null) ->> 'eligible')::boolean,
  false, 'sin barrio y sin punto no hay cobertura: falla cerrado');

-- Apagar la zona bloquea sin borrar la historia.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  format($sql$select public.set_delivery_zone_active('a2000000-0000-4000-8000-000000000001', %L::uuid, false)$sql$,
    (select id from public.delivery_zones where name = 'Barrio sintetico A')),
  'el owner apaga una zona');
set local role postgres;
reset request.jwt.claims;
select is((public.resolve_delivery_zone('a2000000-0000-4000-8000-000000000001', null, null, 'Barrio sintetico A') ->> 'eligible')::boolean,
  false, 'una zona apagada deja de dar cobertura de inmediato');
select is((select count(*)::int from public.delivery_zones where name = 'Barrio sintetico A'), 1,
  'pero la zona sigue existiendo: apagarla no borra su historia');

-- Una zona activa sin tarifa en ningun lado no entrega gratis: no entrega.
update public.businesses set delivery_fee = null where id = 'a2000000-0000-4000-8000-000000000001';
update public.delivery_zones set delivery_fee = null where name = 'Poligono sintetico';
select is((public.resolve_delivery_zone('a2000000-0000-4000-8000-000000000001', -38.95, -68.05, null) ->> 'eligible')::boolean,
  false, 'una zona sin tarifa propia ni del negocio no habilita un envio gratis por omision');
update public.businesses set delivery_fee = 1000 where id = 'a2000000-0000-4000-8000-000000000001';
update public.delivery_zones set delivery_fee = 3000 where name = 'Poligono sintetico';

-- ── 8 · EL TOPE DE DISTANCIA SÓLO NIEGA ──────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $sql$select public.set_delivery_pricing('a2000000-0000-4000-8000-000000000001', 1000, 5000, 4000)$sql$,
  '55000', 'el tope de distancia necesita el punto del local verificado por una persona',
  'ni siquiera el owner enciende un tope de distancia anclado en un pin que nadie confirmo');
set local role postgres;
reset request.jwt.claims;

insert into private.rider_map_business_locations(business_id, latitude, longitude, source, human_verified)
values ('a2000000-0000-4000-8000-000000000001', -38.9539, -68.0596, 'business_verified', true);
update public.businesses set delivery_max_radius_meters = 1000 where id = 'a2000000-0000-4000-8000-000000000001';
select is((public.resolve_delivery_zone('a2000000-0000-4000-8000-000000000001', -38.95, -68.05, null) ->> 'eligible')::boolean,
  true, 'con el tope puesto, un punto cercano dentro del poligono sigue entrando');
select is((public.resolve_delivery_zone('a2000000-0000-4000-8000-000000000001', -38.98, -68.09, null) ->> 'eligible')::boolean,
  false, 'un punto dentro del poligono pero mas lejos que el tope se niega');
update public.businesses set delivery_max_radius_meters = null where id = 'a2000000-0000-4000-8000-000000000001';

-- ── 9 · LA RESPUESTA AL CLIENTE NO CUENTA POR QUÉ ────────────────────────────
select is(
  public.commerce_availability('a2000000-0000-4000-8000-000000000001', 'delivery',
    '{"neighborhood":"Barrio inexistente"}'::jsonb) -> 'delivery' ->> 'message',
  'Por el momento no realizamos entregas en esta zona.',
  'una direccion fuera de cobertura recibe la frase acordada');
select is(
  public.commerce_availability('a2000000-0000-4000-8000-000000000001', 'delivery',
    '{"latitude":-38.93,"longitude":-67.99}'::jsonb) -> 'delivery' ->> 'reason',
  'out_of_coverage',
  'todos los motivos de no-cobertura salen con el mismo codigo: no se puede dibujar el mapa preguntando');
select ok(
  not (public.commerce_availability('a2000000-0000-4000-8000-000000000001', 'delivery',
    '{"neighborhood":"Barrio inexistente"}'::jsonb) -> 'delivery' ? 'zone_name'),
  'la respuesta negativa no nombra ninguna zona');
select is(
  (public.commerce_availability('a2000000-0000-4000-8000-000000000001', 'delivery',
    '{"latitude":-38.95,"longitude":-68.05}'::jsonb) -> 'delivery' ->> 'delivery_fee')::numeric,
  3000::numeric, 'cuando si llegamos, la tarifa viaja resuelta por el backend');
select throws_ok(
  $sql$select public.commerce_availability('a2000000-0000-4000-8000-000000000001','delivery','{"delivery_fee":0}'::jsonb)$sql$,
  '22023', 'campo de contexto no permitido',
  'el navegador no puede colar una tarifa en el contexto de la consulta');
select is(
  jsonb_array_length(public.commerce_availability('a2000000-0000-4000-8000-000000000001', 'delivery', '{}'::jsonb) -> 'hours'),
  14, 'los horarios publicados viajan al cliente: la tienda no los tiene escritos adentro');

-- ── 10 · EL NAVEGADOR NO MANDA PLATA ─────────────────────────────────────────
select ok(
  pg_get_functiondef('public.create_order_with_items_core(jsonb)'::regprocedure) like '%resolve_delivery_zone%',
  'el alta de pedido directo resuelve la cobertura contra el backend');
select ok(
  pg_get_functiondef('public.create_order_with_items_core(jsonb)'::regprocedure) like '%business_is_open%',
  'el alta de pedido directo consulta el horario');
select ok(
  pg_get_functiondef('public.create_checkout_session(uuid,jsonb)'::regprocedure) like '%resolve_delivery_zone%',
  'la sesion de pago online resuelve la cobertura contra el backend');
select ok(
  pg_get_functiondef('public.create_checkout_session(uuid,jsonb)'::regprocedure) like '%business_is_open%',
  'la sesion de pago online consulta el horario');
-- La finalizacion corre DESPUES del dinero: ahi un raise seria pago tomado y
-- transaccion revertida en loop. No debe haber ninguna de las dos preguntas.
select ok(
  pg_get_functiondef('public.finalize_paid_checkout_session(uuid)'::regprocedure) not like '%business_is_open%',
  'la finalizacion del pago no vuelve a evaluar el horario: corre despues del dinero');
select ok(
  pg_get_functiondef('public.finalize_paid_checkout_session(uuid)'::regprocedure) not like '%resolve_delivery_zone%',
  'la finalizacion del pago no vuelve a evaluar la cobertura');
-- El intento más directo de manipular la tarifa desde el cliente: mandarla.
-- El pedido no nace. Que la compuerta que lo frena sea la del punto confirmado y
-- no la lista de claves es un detalle del orden de las comprobaciones: ninguna
-- de las dos deja pasar la tarifa, y ninguna crea el pedido.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $sql$select public.create_order_with_items('{"business_id":"a2000000-0000-4000-8000-000000000001","delivery_fee":0,"items":[]}'::jsonb)$sql$,
  '22023', null,
  'un alta que trae delivery_fee se rechaza');
set local role postgres;
reset request.jwt.claims;
select is((select count(*)::int from public.orders
            where business_id = 'a2000000-0000-4000-8000-000000000001'), 0,
  'y no dejo ningun pedido detras');
-- Y la razón de fondo, sin la compuerta del punto de por medio: por retiro, el
-- alta llega hasta la lista de claves y ahí la tarifa se nombra y se rechaza.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $sql$select public.create_order_with_items('{"business_id":"a2000000-0000-4000-8000-000000000001","delivery_mode":"pickup","customer_name":"Cliente sintetico","customer_phone":"2990000000","delivery_fee":0,"items":[]}'::jsonb)$sql$,
  '22023', 'campo no permitido en pedido: delivery_fee',
  'delivery_fee no figura entre las claves aceptadas del contrato de pedido');
set local role postgres;
reset request.jwt.claims;

-- ── 11 · TODO CAMBIO DEJA RASTRO ─────────────────────────────────────────────
select ok((select count(*) from public.business_config_audit
            where business_id = 'a2000000-0000-4000-8000-000000000001' and scope = 'hours') >= 1,
  'la carga de horarios quedo auditada');
select ok((select count(*) from public.business_config_audit
            where business_id = 'a2000000-0000-4000-8000-000000000001' and scope = 'zone' and action = 'created') = 2,
  'las dos zonas creadas quedaron auditadas');
select ok((select count(*) from public.business_config_audit
            where business_id = 'a2000000-0000-4000-8000-000000000001' and scope = 'zone' and action = 'disabled') = 1,
  'apagar una zona quedo auditado');
select ok((select count(*) from public.business_config_audit
            where business_id = 'a2000000-0000-4000-8000-000000000001' and scope = 'enforcement' and action = 'enabled') >= 1,
  'encender la exigencia quedo auditado');
select is((select actor_id from public.business_config_audit
            where business_id = 'a2000000-0000-4000-8000-000000000001' and scope = 'hours' order by created_at limit 1),
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'la auditoria dice QUIEN cargo los horarios');
select ok((select before is not null and after is not null from public.business_config_audit
            where scope = 'zone' and action = 'disabled' limit 1),
  'la fila de auditoria guarda el estado completo antes y despues');

-- Un UPDATE suelto al costo de envio, sin pasar por ninguna RPC, tambien se audita.
update public.businesses set delivery_fee = 9999 where id = 'a2000000-0000-4000-8000-000000000001';
select ok((select count(*) from public.business_config_audit
            where business_id = 'a2000000-0000-4000-8000-000000000001'
              and scope = 'delivery_pricing'
              and (after ->> 'delivery_fee')::numeric = 9999) = 1,
  'cambiar el costo de envio con un UPDATE directo deja rastro igual: el trigger no se puede esquivar');

-- ── 12 · LA DELEGACIÓN EXPLÍCITA ─────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $sql$select public.set_commercial_settings_delegation('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002', true)$sql$,
  'el owner delega la configuracion comercial en un staff');
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  $sql$select public.upsert_delivery_zone('a2000000-0000-4000-8000-000000000001',
    '{"name":"Zona del staff delegado","match_kind":"declared_area","delivery_fee":"1500"}'::jsonb)$sql$,
  'con la delegacion encendida, ese staff ya puede crear una zona');
select ok((select count(*) from public.business_config_audit
            where scope = 'permission' and action = 'enabled') = 1,
  'la delegacion misma quedo auditada');

-- ── 13 · LA AUTORIDAD COMERCIAL HEREDA LA REVOCACIÓN ─────────────────────────
--
-- La primera version de `can_manage_commercial_settings` leia `business_members`
-- por su cuenta. Parecia equivalente y no lo era: con un owner deshabilitado por
-- la capa de autorizacion, `has_business_role` devolvia false y esta funcion
-- devolvia TRUE. Alguien con el acceso revocado seguia pudiendo cambiar tarifas,
-- zonas y banderas. Ahora pregunta por `has_business_role` y hereda la
-- compuerta, sea cual sea.
set local role postgres;
reset request.jwt.claims;
insert into public.identity_user_security (business_id, user_id, disabled_at)
values ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', now())
on conflict (business_id, user_id) do update set disabled_at = excluded.disabled_at;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.has_business_role('a2000000-0000-4000-8000-000000000001', array['owner', 'admin']), false,
  'la capa de autorizacion ya no reconoce al owner deshabilitado');
select is(public.can_manage_commercial_settings('a2000000-0000-4000-8000-000000000001'), false,
  'y por lo tanto pierde la autoridad comercial: no hay puerta de atras');
select throws_ok(
  $sql$select public.set_delivery_pricing('a2000000-0000-4000-8000-000000000001', 100, 100)$sql$,
  '42501', 'sin autorizacion para configurar precios de envio',
  'un owner revocado no puede cambiar el costo de envio');
select throws_ok(
  $sql$select public.set_service_enforcement('a2000000-0000-4000-8000-000000000001', false, false)$sql$,
  '42501', 'sin autorizacion para cambiar la exigencia',
  'ni apagar la exigencia');

select * from finish();
rollback;
