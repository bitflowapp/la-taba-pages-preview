-- PREPARAR LA APERTURA · compuertas reales, verificación de plataforma y equipo
--
-- Sobre los roles reales (anon, authenticated, service_role):
--   - la preparación la leen el dueño, el encargado, el equipo y la clave de
--     servicio; nadie de afuera y nadie anónimo;
--   - la verificación de plataforma es sólo de la clave de servicio, pide el
--     identificador del comercio escrito, un verificador con cuenta confirmada
--     y FALLA CERRADA con cada compuerta pendiente (entrega, horario, precio,
--     stock, publicación, foto donde se exige, envío y mínimo);
--   - delivery y retiro se encienden desde el Panel, el horario se guarda para
--     los dos canales y la dirección del local queda auditada;
--   - la planilla y el Panel no publican alcohol con la venta cerrada;
--   - la invitación se consulta y se audita sin exponer el token.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(76);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('ca000000-0000-4000-8000-0000000000a1','authenticated','authenticated','owner@opening.invalid','',now(),'{}','{}',now(),now()),
  ('ca000000-0000-4000-8000-0000000000a2','authenticated','authenticated','staff@opening.invalid','',now(),'{}','{}',now(),now()),
  ('ca000000-0000-4000-8000-0000000000a3','authenticated','authenticated','rider@opening.invalid','',now(),'{}','{}',now(),now()),
  ('ca000000-0000-4000-8000-0000000000a4','authenticated','authenticated','outsider@opening.invalid','',now(),'{}','{}',now(),now()),
  ('ca000000-0000-4000-8000-0000000000a5','authenticated','authenticated','platform@opening.invalid','',now(),'{}','{}',now(),now()),
  ('ca000000-0000-4000-8000-0000000000a6','authenticated','authenticated','unconfirmed@opening.invalid','',null,'{}','{}',now(),now());

-- B: un comercio nuevo, cerrado, con el horario exigido y sin nada cargado.
-- C: el comercio real de CONTROLLED_PRODUCTION (foto aprobada obligatoria).
insert into public.businesses(id,name,status,slug,is_active,operating_timezone,currency_code,hours_enforced,
  delivery_zone_enforced,rider_presence_required)
values
  ('ca000000-0000-4000-8000-0000000000b1','Apertura','closed','op-apertura',true,'America/Argentina/Buenos_Aires','ARS',
    true,false,false),
  ('e7850ad2-a447-402c-8375-3fd74e9466ba','La Taba CP','closed','op-cp-real',true,'America/Argentina/Buenos_Aires','ARS',
    true,false,false);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('ca000000-0000-4000-8000-0000000000b1','ca000000-0000-4000-8000-0000000000a1','owner',true),
  ('ca000000-0000-4000-8000-0000000000b1','ca000000-0000-4000-8000-0000000000a2','staff',true),
  ('ca000000-0000-4000-8000-0000000000b1','ca000000-0000-4000-8000-0000000000a3','rider',true),
  ('e7850ad2-a447-402c-8375-3fd74e9466ba','ca000000-0000-4000-8000-0000000000a1','owner',true);
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('ca000000-0000-4000-8000-0000000000c1','ca000000-0000-4000-8000-0000000000a1','ca000000-0000-4000-8000-0000000000b1','owner','panel_web'),
  ('ca000000-0000-4000-8000-0000000000c2','ca000000-0000-4000-8000-0000000000a2','ca000000-0000-4000-8000-0000000000b1','staff','panel_web'),
  ('ca000000-0000-4000-8000-0000000000c3','ca000000-0000-4000-8000-0000000000a1','e7850ad2-a447-402c-8375-3fd74e9466ba','owner','panel_web');

-- P1 sin alcohol y P2 con alcohol: borradores comerciales completos, sin precio
-- ni stock, sin foto (caso A: ninguna columna de imagen).
insert into public.products(id,business_id,name,category,price,price_status,is_active,brand,subcategory,presentation,capacity,
  packaging_type,stock,available,is_alcoholic,minimum_age,tags,is_verified,external_id,sku,variant,capacity_value,capacity_unit,
  catalog_origin,units_per_pack)
values
  ('ca000000-0000-4000-8000-0000000000d1','ca000000-0000-4000-8000-0000000000b1','Cola 1 L','Gaseosas',0,'pending',true,
    'Marca','Cola','Botella','1 l','botella',null,false,false,null,'{}',false,'op-cola-1l','op-cola-1l','Botella',1,'l',
    'commercial',1),
  ('ca000000-0000-4000-8000-0000000000d2','ca000000-0000-4000-8000-0000000000b1','Cerveza 1 L','Cervezas',0,'pending',true,
    'Marca','Rubia','Botella','1 l','botella',null,false,true,18,'{}',false,'op-cerveza-1l','op-cerveza-1l','Botella',1,'l',
    'commercial',1),
  ('ca000000-0000-4000-8000-0000000000d3','e7850ad2-a447-402c-8375-3fd74e9466ba','Agua 1 L','Aguas',1500,'confirmed',true,
    'Marca','Sin gas','Botella','1 l','botella',10,false,false,null,'{}',false,'op-agua-1l','op-agua-1l','Botella',1,'l',
    'commercial',1);

create temporary table readiness_snap(label text, payload jsonb) on commit drop;
create temporary table verify_attempts(label text, state text, message text, detail text) on commit drop;
grant insert, select on readiness_snap, verify_attempts to authenticated, service_role;

create function pg_temp.item(p_payload jsonb, p_code text) returns jsonb language sql immutable as $$
  select e from jsonb_array_elements(p_payload -> 'items') e where e ->> 'code' = p_code
$$;
create function pg_temp.snap(p_label text) returns jsonb language sql stable as $$
  select payload from readiness_snap where label = p_label
$$;

-- ── 1 · Quién lee la preparación ───────────────────────────────────────────
select ok(not has_function_privilege('anon', 'public.get_store_opening_readiness(uuid,integer)', 'EXECUTE'),
  'anon no lee la preparacion de la apertura');

set local role authenticated;
set local request.jwt.claims = '{"sub":"ca000000-0000-4000-8000-0000000000a4","role":"authenticated"}';
select throws_ok($$select public.get_store_opening_readiness('ca000000-0000-4000-8000-0000000000b1', 1)$$, '42501', null,
  'alguien de afuera no lee la preparacion');

set local request.jwt.claims = '{"sub":"ca000000-0000-4000-8000-0000000000a2","role":"authenticated","session_id":"ca000000-0000-4000-8000-0000000000c2"}';
select lives_ok($$insert into readiness_snap select 'staff', public.get_store_opening_readiness('ca000000-0000-4000-8000-0000000000b1', 1)$$,
  'el equipo lee la preparacion');
select throws_ok($$select public.get_store_opening_readiness('ca000000-0000-4000-8000-0000000000b1', 0)$$, '22023', null,
  'el minimo de productos es al menos 1');
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into readiness_snap select 'inicial', public.get_store_opening_readiness('ca000000-0000-4000-8000-0000000000b1', 1);
insert into readiness_snap select 'cp', public.get_store_opening_readiness('e7850ad2-a447-402c-8375-3fd74e9466ba', 1);
reset role;

select is(pg_temp.snap('staff') -> 'items', pg_temp.snap('inicial') -> 'items', 'el equipo y la plataforma ven la misma lista');
select ok(position('@' in pg_temp.snap('inicial')::text) = 0 and pg_temp.snap('inicial')::text !~ 'user_id',
  'la preparacion no expone correos ni identificadores de personas');

-- ── 2 · El comercio recien creado: todo lo que falta ───────────────────────
select is(pg_temp.item(pg_temp.snap('inicial'), 'FULFILLMENT_MODE') ->> 'status', 'pending', 'sin delivery ni retiro: pendiente');
select is(pg_temp.item(pg_temp.snap('inicial'), 'SERVICE_HOURS') ->> 'status', 'pending', 'horario exigido sin franjas: pendiente');
select is(pg_temp.item(pg_temp.snap('inicial'), 'CATALOG_PRICES') ->> 'status', 'pending', 'sin precios confirmados: pendiente');
select is(pg_temp.item(pg_temp.snap('inicial'), 'CATALOG_STOCK') ->> 'status', 'pending', 'sin stock contado: pendiente');
select is(pg_temp.item(pg_temp.snap('inicial'), 'CATALOG_PUBLISHED') ->> 'status', 'pending', 'sin productos publicados: pendiente');
select is(pg_temp.item(pg_temp.snap('inicial'), 'CATALOG_PHOTOS') ->> 'status', 'na', 'fuera de CP la foto no es obligatoria');
select is(pg_temp.item(pg_temp.snap('cp'), 'CATALOG_PHOTOS') ->> 'status', 'pending', 'en el comercio real de CP la foto aprobada es obligatoria');
select is(pg_temp.item(pg_temp.snap('inicial'), 'BUSINESS_ADDRESS') ->> 'status', 'warn', 'sin retiro la direccion es una recomendacion');
select is(pg_temp.item(pg_temp.snap('inicial'), 'PAYMENT_MANUAL') ->> 'status', 'pass', 'el pago manual no depende de configuracion');
select is(pg_temp.item(pg_temp.snap('inicial'), 'PAYMENT_MERCADOPAGO') ->> 'status', 'info', 'Mercado Pago sin vendedor es informativo');
select is(pg_temp.item(pg_temp.snap('inicial'), 'ALCOHOL_POLICY') -> 'facts' ->> 'alcoholic_products', '1', 'cuenta los productos con alcohol');
select is((pg_temp.snap('inicial') ->> 'ready_for_platform_verification')::boolean, false, 'no esta listo para verificar');
select is((pg_temp.snap('inicial') ->> 'can_open')::boolean, false, 'no se puede abrir');

-- ── 3 · La verificacion de plataforma falla cerrada ────────────────────────
select ok(not has_function_privilege('authenticated', 'public.platform_verify_business_ordering(uuid,text,text,integer,text)', 'EXECUTE'),
  'una persona no puede verificar pedidos online');
select ok(not has_function_privilege('authenticated', 'public.platform_revoke_business_ordering(uuid,text,text,text)', 'EXECUTE'),
  'una persona no puede revocar la verificacion');
select ok(not has_column_privilege('authenticated', 'public.businesses', 'ordering_verified', 'UPDATE'),
  'ordering_verified no se escribe con un UPDATE de persona');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.platform_verify_business_ordering('ca000000-0000-4000-8000-0000000000b1','platform@opening.invalid','otro',1,null)$$,
  '22023', 'CONFIRMATION_MISMATCH', 'sin escribir el identificador exacto no se verifica');
select throws_ok($$select public.platform_verify_business_ordering('ca000000-0000-4000-8000-0000000000b1','nadie@opening.invalid','op-apertura',1,null)$$,
  '22023', 'VERIFIER_NOT_FOUND', 'un verificador inexistente no verifica');
select throws_ok($$select public.platform_verify_business_ordering('ca000000-0000-4000-8000-0000000000b1','unconfirmed@opening.invalid','op-apertura',1,null)$$,
  '22023', 'VERIFIER_NOT_FOUND', 'un verificador sin correo confirmado no verifica');
do $$
declare v_detail text;
begin
  perform public.platform_verify_business_ordering('ca000000-0000-4000-8000-0000000000b1','platform@opening.invalid','op-apertura',1,null);
  insert into verify_attempts values ('prematura', '00000', 'ok', null);
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  insert into verify_attempts values ('prematura', sqlstate, sqlerrm, v_detail);
end $$;
reset role;

select is((select state || ' ' || message from verify_attempts where label = 'prematura'), '55000 OPENING_NOT_READY',
  'verificar antes de tiempo falla con OPENING_NOT_READY');
select ok((select string_to_array(detail, ',') @> array['FULFILLMENT_MODE','SERVICE_HOURS','CATALOG_PRICES','CATALOG_STOCK','CATALOG_PUBLISHED']
  from verify_attempts where label = 'prematura'), 'el rechazo nombra entrega, horario, precio, stock y publicacion');
select is((select ordering_verified or ordering_enabled from public.businesses where id = 'ca000000-0000-4000-8000-0000000000b1'), false,
  'el rechazo no escribe nada');

-- ── 4 · Entrega, direccion y horario desde el Panel ────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca000000-0000-4000-8000-0000000000a2","role":"authenticated","session_id":"ca000000-0000-4000-8000-0000000000c2"}';
select throws_ok($$select public.set_business_fulfillment('ca000000-0000-4000-8000-0000000000b1', false, true)$$, '42501', null,
  'el equipo sin delegacion no cambia como entrega el comercio');
select throws_ok($$select public.set_business_opening_hours('ca000000-0000-4000-8000-0000000000b1', '[]'::jsonb)$$, '42501', null,
  'el equipo sin delegacion no cambia el horario');

set local request.jwt.claims = '{"sub":"ca000000-0000-4000-8000-0000000000a1","role":"authenticated","session_id":"ca000000-0000-4000-8000-0000000000c1"}';
select throws_ok($$select public.set_business_fulfillment('ca000000-0000-4000-8000-0000000000b1', null, true)$$, '22023', null,
  'delivery y retiro se dicen explicitamente');
select is((public.set_business_fulfillment('ca000000-0000-4000-8000-0000000000b1', false, true)) ->> 'pickup_enabled', 'true',
  'el dueño enciende solo retiro');
insert into readiness_snap select 'solo retiro', public.get_store_opening_readiness('ca000000-0000-4000-8000-0000000000b1', 1);
select is(pg_temp.item(pg_temp.snap('solo retiro'), 'BUSINESS_ADDRESS') ->> 'status', 'pending', 'con retiro la direccion pasa a ser obligatoria');
select is(pg_temp.item(pg_temp.snap('solo retiro'), 'SERVICE_HOURS') -> 'facts' -> 'missing_channels', '["pickup"]'::jsonb,
  'con solo retiro falta el horario del retiro');
select is(pg_temp.item(pg_temp.snap('solo retiro'), 'DELIVERY_PRICING') ->> 'status', 'na', 'sin delivery el envio no aplica');

select throws_ok($$select public.set_business_address('ca000000-0000-4000-8000-0000000000b1', 'Av')$$, '22023', null,
  'una direccion demasiado corta no se guarda');
select throws_ok($$select public.set_business_address('ca000000-0000-4000-8000-0000000000b1', 'Direccion a confirmar')$$, '22023', null,
  'un texto provisorio no es una direccion');
select is((public.set_business_address('ca000000-0000-4000-8000-0000000000b1', '  Mendoza   827, Neuquén ')) ->> 'address',
  'Mendoza 827, Neuquén', 'la direccion se guarda normalizada');

select lives_ok($$select public.set_business_opening_hours('ca000000-0000-4000-8000-0000000000b1',
  '[{"weekday":0,"opens_at":"00:00","closes_at":"24:00"},{"weekday":1,"opens_at":"00:00","closes_at":"24:00"},
    {"weekday":2,"opens_at":"00:00","closes_at":"24:00"},{"weekday":3,"opens_at":"00:00","closes_at":"24:00"},
    {"weekday":4,"opens_at":"00:00","closes_at":"24:00"},{"weekday":5,"opens_at":"00:00","closes_at":"24:00"},
    {"weekday":6,"opens_at":"00:00","closes_at":"24:00"}]'::jsonb)$$, 'el dueño guarda una grilla');
select throws_ok($$select public.set_business_opening_hours('ca000000-0000-4000-8000-0000000000b1',
  '[{"weekday":1,"opens_at":"10:00","closes_at":"14:00"},{"weekday":1,"opens_at":"13:00","closes_at":"18:00"}]'::jsonb)$$, '22023', null,
  'una grilla con tramos superpuestos no se guarda en ningun canal');
reset role;

select is((select count(*)::integer from public.business_service_hours where business_id = 'ca000000-0000-4000-8000-0000000000b1' and channel = 'delivery'), 7,
  'la grilla quedo en delivery');
select is((select count(*)::integer from public.business_service_hours where business_id = 'ca000000-0000-4000-8000-0000000000b1' and channel = 'pickup'), 7,
  'y la misma grilla quedo en retiro');
select is((select array_agg(scope order by scope)::text[] from public.business_config_audit where business_id = 'ca000000-0000-4000-8000-0000000000b1'),
  array['contact','fulfillment','hours','hours']::text[], 'entrega, direccion y los dos horarios quedaron auditados');

-- ── 5 · Delivery: envio y minimo del comercio, zonas y repartidores ────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca000000-0000-4000-8000-0000000000a1","role":"authenticated","session_id":"ca000000-0000-4000-8000-0000000000c1"}';
select lives_ok($$select public.set_business_fulfillment('ca000000-0000-4000-8000-0000000000b1', true, true)$$,
  'antes de verificar, delivery se enciende aunque falte el envio');
insert into readiness_snap select 'delivery sin envio', public.get_store_opening_readiness('ca000000-0000-4000-8000-0000000000b1', 1);
select is(pg_temp.item(pg_temp.snap('delivery sin envio'), 'DELIVERY_PRICING') ->> 'status', 'pending',
  'con delivery falta el envio y el minimo del comercio');
select is(pg_temp.item(pg_temp.snap('delivery sin envio'), 'DELIVERY_COVERAGE') ->> 'status', 'warn',
  'sin exigir zonas la cobertura es una advertencia');
select is(pg_temp.item(pg_temp.snap('delivery sin envio'), 'RIDERS') ->> 'status', 'pass', 'hay un repartidor activo');
select lives_ok($$select public.set_delivery_pricing('ca000000-0000-4000-8000-0000000000b1', 800, 0, null)$$,
  'el dueño carga envio y minimo cero');

-- ── 6 · Catalogo: primera publicacion y la compuerta de alcohol ────────────
select throws_like($$select * from public.apply_commercial_catalog_batch('ca000000-0000-4000-8000-0000000000b1',
  '[{"sku":"op-cerveza-1l","price":"2500","stock":"6","publish":true}]'::jsonb)$$, '%alcohol sales are not enabled%',
  'la planilla no publica alcohol con la venta cerrada');
select is((select available or is_verified from public.products where id = 'ca000000-0000-4000-8000-0000000000d2'), false,
  'la cerveza sigue como borrador');
select is((select applied_available from public.apply_commercial_catalog_batch('ca000000-0000-4000-8000-0000000000b1',
  '[{"sku":"op-cola-1l","price":"1500","stock":"12","publish":true}]'::jsonb)), true, 'la primera publicacion verifica y publica la cola');
insert into readiness_snap select 'listo', public.get_store_opening_readiness('ca000000-0000-4000-8000-0000000000b1', 1);
reset role;

select is(pg_temp.snap('listo') -> 'pending', '["PLATFORM_VERIFICATION"]'::jsonb, 'solo falta la verificacion de plataforma');
select is((pg_temp.snap('listo') ->> 'ready_for_platform_verification')::boolean, true, 'listo para verificar');
select is((pg_temp.snap('listo') ->> 'can_open')::boolean, false, 'todavia no se puede abrir');
select is((pg_temp.item(pg_temp.snap('listo'), 'CATALOG_PUBLISHED') -> 'facts' ->> 'published')::integer, 1, 'un producto publicado');

-- ── 7 · Verificar: auditada, idempotente y sin abrir ───────────────────────
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
do $$
declare v_detail text;
begin
  perform public.platform_verify_business_ordering('ca000000-0000-4000-8000-0000000000b1','platform@opening.invalid','op-apertura',5,null);
  insert into verify_attempts values ('minimo 5', '00000', 'ok', null);
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  insert into verify_attempts values ('minimo 5', sqlstate, sqlerrm, v_detail);
end $$;
select is((public.platform_verify_business_ordering('ca000000-0000-4000-8000-0000000000b1','PLATFORM@opening.invalid','op-apertura',1,
  'canary con retiro')) ->> 'changed', 'true', 'con todo cumplido la plataforma verifica');
select is((public.platform_verify_business_ordering('ca000000-0000-4000-8000-0000000000b1','platform@opening.invalid','op-apertura',1,null))
  ->> 'changed', 'false', 'verificar dos veces no cambia nada');
insert into readiness_snap select 'verificado', public.get_store_opening_readiness('ca000000-0000-4000-8000-0000000000b1', 1);
reset role;

select is((select detail from verify_attempts where label = 'minimo 5'), 'CATALOG_PRICES,CATALOG_STOCK,CATALOG_PUBLISHED',
  'con un minimo de 5 productos el catalogo de 1 no alcanza');
select is((select status from public.businesses where id = 'ca000000-0000-4000-8000-0000000000b1'), 'closed',
  'verificar no abre el comercio');
select ok((select ordering_verified and ordering_enabled and ordering_verified_by = 'ca000000-0000-4000-8000-0000000000a5'
  from public.businesses where id = 'ca000000-0000-4000-8000-0000000000b1'), 'queda verificado por la persona de plataforma');
select is((select count(*)::integer from public.business_config_audit
  where business_id = 'ca000000-0000-4000-8000-0000000000b1' and scope = 'platform_verification' and action = 'enabled'
    and actor_id = 'ca000000-0000-4000-8000-0000000000a5' and after ->> 'note' = 'canary con retiro'), 1,
  'la verificacion queda auditada con actor, fecha y nota');
select is((pg_temp.snap('verificado') ->> 'can_open')::boolean, true, 'verificado, se puede abrir');
select is((pg_temp.snap('verificado') ->> 'accepting_orders')::boolean, false, 'cerrado no toma pedidos');

-- ── 8 · Abrir y lo que la base ya no deja romper ───────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca000000-0000-4000-8000-0000000000a1","role":"authenticated","session_id":"ca000000-0000-4000-8000-0000000000c1"}';
select is((public.set_business_open_state('ca000000-0000-4000-8000-0000000000b1', 'open')) ->> 'status', 'open', 'el dueño abre');
select is((public.get_store_opening_readiness('ca000000-0000-4000-8000-0000000000b1', 1)) ->> 'accepting_orders', 'true',
  'abierto, verificado y en horario: toma pedidos');
select throws_ok($$select public.set_business_fulfillment('ca000000-0000-4000-8000-0000000000b1', false, false)$$, '22023', null,
  'verificado, no se apagan delivery y retiro a la vez');
reset role;
select is((select count(*)::integer from public.business_config_audit
  where business_id = 'ca000000-0000-4000-8000-0000000000b1' and scope = 'open_state' and after ->> 'status' = 'open'), 1,
  'abrir queda auditado');

-- ── 9 · Revocar ────────────────────────────────────────────────────────────
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.platform_revoke_business_ordering('ca000000-0000-4000-8000-0000000000b1','platform@opening.invalid','op-apertura','')$$,
  '22023', null, 'revocar exige un motivo');
select is((public.platform_revoke_business_ordering('ca000000-0000-4000-8000-0000000000b1','platform@opening.invalid','op-apertura',
  'rollback del canary')) ->> 'changed', 'true', 'la plataforma revoca');
reset role;
select is((select ordering_verified or ordering_enabled from public.businesses where id = 'ca000000-0000-4000-8000-0000000000b1'), false,
  'revocado, la web deja de tomar pedidos');

-- ── 10 · Invitacion consultable por la funcion de borde ────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"ca000000-0000-4000-8000-0000000000a1","role":"authenticated","session_id":"ca000000-0000-4000-8000-0000000000c1"}';
insert into readiness_snap select 'invitacion', public.identity_create_invitation(
  'ca000000-0000-4000-8000-0000000000b1', 'nuevo.rider@opening.invalid', 'rider', 'Rider Nuevo', interval '2 days');
reset role;
select ok(not has_function_privilege('authenticated', 'public.team_invitation_lookup(text)', 'EXECUTE'),
  'una persona no consulta invitaciones por token');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((public.team_invitation_lookup(pg_temp.snap('invitacion') ->> 'token')) ->> 'status', 'pending', 'la invitacion vigente se encuentra');
select is((public.team_invitation_lookup(pg_temp.snap('invitacion') ->> 'token')) -> 'account' ->> 'exists', 'false',
  'para un correo nuevo no hay cuenta');
select is((public.team_invitation_lookup(repeat('0', 64))) ->> 'found', 'false', 'un token inventado no encuentra nada');
select lives_ok($$select public.team_invitation_record_activation(
  (select payload ->> 'token' from readiness_snap where label = 'invitacion'), 'ca000000-0000-4000-8000-0000000000a4', true)$$,
  'la activacion de la cuenta queda registrada');
reset role;
select is((select count(*)::integer from public.identity_audit_events
  where event_type = 'invitation_account_activated' and subject_user_id = 'ca000000-0000-4000-8000-0000000000a4'), 1,
  'la auditoria de identidad guarda la activacion');

select * from finish();
rollback;
