-- TABA · CONTRATO HTTP: UNA NEGATIVA DE NEGOCIO Y UN «NO EXISTE» NO CONTESTAN 500
--
-- 20261002090000 envuelve el cuerpo de las funciones de entrada que pueden terminar en 55000 o en
-- P0002 en un bloque con un solo manejador (marcador «la-taba:api-boundary v1»). Por la API
-- (request.method) y sólo en el marco PL/pgSQL más externo, el manejador contesta
-- `raise sqlstate 'PGRST'` con el mismo cuerpo y estado 409 (55000) o 404 (P0002); en cualquier otro
-- caso re-lanza el error original. Política: docs/ecommerce-hardening/http-contract.md.
--
-- ESTRUCTURA
--   · cada entrada PL/pgSQL no excluida cuyo propio cuerpo levanta 55000 o P0002 está envuelta (una
--     migración que redefina una de ellas desde un cuerpo viejo falla acá), y el total no baja;
--   · cada función envuelta tiene el manejador exacto que se probó por HTTP;
--   · ninguna excluida por dueño está envuelta y la lista de exclusiones es la de http-contract.json
--     (tests/http-error-contract.test.mjs compara las dos);
--   · ninguna función envuelta se usa por fila en una política o una vista;
--   · RAISE sin errcode en funciones que un cliente ejecuta: no aparece ninguna nueva.
--
-- COMPORTAMIENTO
--   pgTAP llama todo desde una función PL/pgSQL (throws_ok o el ayudante de acá): dentro de una prueba
--   la función envuelta nunca es el marco más externo. Con request.method puesto re-lanza el original:
--   eso prueba que un llamador PL/pgSQL con su propio manejador sigue viendo 55000 / P0002 con el mismo
--   mensaje, detalle y pista. Sin request.method (pgTAP, cron, arneses) sale el original, como antes.
--   La conversión a 409/404 sólo existe cuando la función es el marco más externo, o sea por la API: la
--   prueban el certificador contra un PostgREST real y la prueba HTTP de http-contract-NOTES.md.
--
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

-- ══ 1 · ESTRUCTURA ═══════════════════════════════════════════════════════════
-- Las exclusiones por dueño: las mismas que docs/ecommerce-hardening/http-contract.json (`excluded`).
create temporary table api_excluded (pattern text primary key) on commit drop;
insert into api_excluded values
  ('pos_*'), ('checkout_pos_sale'), ('prepare_daily_reconciliation'), ('close_daily_reconciliation'),
  ('daily_reconciliation_snapshot_internal'), ('identity_register_session'),
  ('authorize_arca_homologation'), ('authorize_fiscal_artifact_access'), ('begin_fiscal_resend'), ('claim_fiscal_*'),
  ('complete_fiscal_*'), ('fail_fiscal_artifact'), ('get_order_fiscal_states'), ('request_credit_note'),
  ('request_full_credit_note'), ('request_fiscal_*'), ('request_order_invoice'), ('reserve_fiscal_document_number'),
  ('service_request_*'),
  ('agent_*'), ('cancel_print_job'), ('create_local_device_pairing'), ('operator_*local_device*'), ('get_local_print_status'),
  ('request_order_print_job'), ('request_print_job_reprint'), ('resolve_print_job_review'), ('revoke_local_device'),
  ('claim_payment_outbox'), ('get_mercadopago_payment_authority'), ('prepare_mercadopago_preference'), ('prepare_payment_refund'),
  ('record_mercadopago_preference_created'), ('record_payment_refund_response');
create function pg_temp.excluded(p_name text) returns boolean language sql stable as $$
  select exists (select 1 from api_excluded e where p_name like replace(replace(e.pattern, '_', '\_'), '*', '%'))
$$;

-- Las funciones de public, con su lenguaje, si son entrada y si llevan el envoltorio.
create temporary table api_functions on commit drop as
select p.oid, p.proname as name, p.oid::regprocedure::text as signature, l.lanname as lang, p.prosrc as src,
       p.prorettype = 'pg_catalog.trigger'::regtype as is_trigger,
       (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')) as client,
       (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('service_role', p.oid, 'execute')) as executable,
       position('la-taba:api-boundary v1' in p.prosrc) > 0 as wrapped
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
 where n.nspname = 'public' and p.prokind = 'f'
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');

select is((select count(*)::integer from api_functions where wrapped), 109,
  '109 funciones llevan el envoltorio de la frontera (108 entradas y el trigger de la moneda): ninguna lo perdió');

-- La parte DIRECTA de la regla de selección (la misma expresión que scripts/db/wrap-api-boundary.mjs).
select is_empty($q$
  select signature from api_functions
   where lang = 'plpgsql' and executable and not is_trigger and not pg_temp.excluded(name) and not wrapped
     and regexp_replace(src, '--[^\n]*', '', 'g')
         ~* $re$'(55000|P0002)'|\y(object_not_in_prerequisite_state|no_data_found)\y|\yinto\s+strict\y$re$
$q$, 'toda entrada PL/pgSQL no excluida cuyo cuerpo levanta 55000 o P0002 está envuelta');

select ok((select bool_and(wrapped) from api_functions where name = 'guard_business_currency_code' and is_trigger),
  'el trigger de la moneda (los clientes escriben businesses por PATCH directo) está envuelto');

select is_empty($q$
  select signature from api_functions where wrapped and position($h$
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$h$ in src) = 0
$q$, 'cada función envuelta termina con el manejador exacto que se probó por HTTP');

select is_empty($q$
  select signature from api_functions
   where wrapped and src !~ '^\s*(#[^\n]*\n\s*)*declare\n  -- la-taba:api-boundary v1: '
$q$, 'el envoltorio es el bloque de afuera (sus variables _api_ en su declare), después de las directivas #');

select is_empty($q$ select signature from api_functions where wrapped and pg_temp.excluded(name) $q$,
  'ninguna función excluida por dueño fue regenerada');

select is((select count(*)::integer from api_excluded), 34, 'las exclusiones son los 34 patrones de http-contract.json');

select is_empty($q$
  select x.object || ' -> ' || f.name
    from (select 'policy ' || tablename || '.' || policyname as object, coalesce(qual, '') || ' ' || coalesce(with_check, '') as text
            from pg_policies
          union all
          select 'view ' || schemaname || '.' || viewname, definition from pg_views
           where schemaname not in ('pg_catalog', 'information_schema')) x
    join api_functions f on f.wrapped and x.text ~ ('(^|[^a-z0-9_])' || f.name || '\s*\(')
$q$, 'ninguna función envuelta se evalúa por fila en una política o una vista (una subtransacción por llamada)');

-- RAISE EXCEPTION '...' [, args] ; sin USING: el cliente recibe 400 · P0001, indistinguible de un dato mal
-- escrito. Las cinco que quedan son validaciones del catálogo y del contacto (20261002051000 les dio 42501 a
-- sus negativas de permiso y dejó estas como 400). Una función nueva con ese defecto falla acá.
select is(
  (select array_agg(name order by name) from api_functions
    where lang = 'plpgsql' and client and not is_trigger
      and regexp_replace(src, '--[^\n]*', '', 'g') ~* $re$\yraise\s+exception\s+'([^']|'')*'((?!\yusing\y)[^;])*;$re$),
  array['apply_commercial_catalog_batch', 'import_catalog_batch', 'publish_catalog_product', 'set_business_whatsapp_contact',
        'set_commercial_product_publication']::name[],
  'RAISE sin errcode en funciones de cliente: sólo las cinco conocidas del catálogo y del contacto');

-- ══ 2 · FIXTURE ══════════════════════════════════════════════════════════════
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
values
  ('d6900000-0000-4000-8000-0000000000a1','authenticated','authenticated','contrato-owner@example.invalid','',now(),'{}','{}',false,now(),now()),
  ('d6900000-0000-4000-8000-0000000000a5','authenticated','authenticated','contrato-plataforma@example.invalid','',now(),'{}','{}',false,now(),now()),
  ('d6900000-0000-4000-8000-0000000000a9','authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());

-- O · verificado, abierto 24/7 para retiro y delivery, cobertura exigida con una sola zona («Centro»).
-- P · sin verificar, sin dueño ni horarios: la plataforma no lo puede verificar.
insert into public.businesses(id,name,slug,status,is_active,currency_code,address,pickup_enabled,delivery_enabled,delivery_fee,minimum_delivery_subtotal,
  operating_timezone,hours_enforced,delivery_zone_enforced,ordering_verified,ordering_verified_at,ordering_verified_by,ordering_enabled,order_intake_guard_mode)
values
  ('d6900000-0000-4000-8000-0000000000b1','Contrato O','contrato-o','open',true,'ARS','Mendoza 827, Neuquen',true,true,1500,0,
    'America/Argentina/Buenos_Aires',true,true,true,now(),'d6900000-0000-4000-8000-0000000000a5',true,'off'),
  ('d6900000-0000-4000-8000-0000000000b2','Contrato P','contrato-p','closed',true,'ARS','Mendoza 827, Neuquen',true,false,null,null,
    'America/Argentina/Buenos_Aires',false,false,false,null,null,false,'off');
insert into public.business_service_hours(business_id,channel,weekday,opens_at,closes_at)
select 'd6900000-0000-4000-8000-0000000000b1', canal, d, '00:00', '24:00'
  from unnest(array['delivery','pickup']) canal, generate_series(0,6) d;
insert into public.delivery_zones(id,business_id,name,is_active,match_kind,area_normalized,boundary,delivery_fee,minimum_subtotal,priority)
values ('d6900000-0000-4000-8000-0000000000f1','d6900000-0000-4000-8000-0000000000b1','Centro',true,'declared_area','centro',null,800,0,10);
insert into public.business_members(business_id,user_id,role,is_active)
values ('d6900000-0000-4000-8000-0000000000b1','d6900000-0000-4000-8000-0000000000a1','owner',true);
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values ('d6900000-0000-4000-8000-0000000000e1','d6900000-0000-4000-8000-0000000000a1','d6900000-0000-4000-8000-0000000000b1','owner','panel_web');

-- c1 una gaseosa a la venta, c2 una cerveza, c3 una gaseosa que el comercio sacó de la venta.
insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,minimum_age,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
values
  ('d6900000-0000-4000-8000-0000000000c1','d6900000-0000-4000-8000-0000000000b1','Lata Contrato','Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',50,true,true,false,null,'{}',true,now(),'d6900000-0000-4000-8000-0000000000a1',
    'contrato-lata','contrato-lata','commercial',1),
  ('d6900000-0000-4000-8000-0000000000c2','d6900000-0000-4000-8000-0000000000b1','Cerveza Contrato','Cervezas','Rubia',2000,'confirmed',true,'Marca',
    'Botella','Botella',1,'l','1 l','botella',50,true,true,true,18,'{}',true,now(),'d6900000-0000-4000-8000-0000000000a1',
    'contrato-cerveza','contrato-cerveza','commercial',1),
  ('d6900000-0000-4000-8000-0000000000c3','d6900000-0000-4000-8000-0000000000b1','Lata Fuera','Gaseosas','Lima',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',50,false,false,false,null,'{}',true,now(),'d6900000-0000-4000-8000-0000000000a1',
    'contrato-fuera','contrato-fuera','commercial',1);

-- Ejecuta una sentencia y devuelve el error tal como lo ve un llamador PL/pgSQL (o {"ok": true}).
create function pg_temp.attempt(p_sql text) returns jsonb language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
  v_hint text;
begin
  execute p_sql;
  return jsonb_build_object('ok', true);
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text,
                          v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return jsonb_strip_nulls(jsonb_build_object('sqlstate', v_state, 'message', v_message,
                                              'detail', nullif(v_detail, ''), 'hint', nullif(v_hint, '')));
end $$;
-- Lo mismo, con request.method puesto como lo pone PostgREST, y vuelta a como estaba.
create function pg_temp.attempt_api(p_sql text) returns jsonb language plpgsql as $$
declare
  v_result jsonb;
begin
  perform set_config('request.method', 'POST', true);
  v_result := pg_temp.attempt(p_sql);
  perform set_config('request.method', '', true);
  return v_result;
end $$;
create function pg_temp.as_customer() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', 'd6900000-0000-4000-8000-0000000000a9', 'role', 'authenticated')::text, true)
$$;
create function pg_temp.as_owner() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', 'd6900000-0000-4000-8000-0000000000a1', 'role', 'authenticated',
    'session_id', 'd6900000-0000-4000-8000-0000000000e1')::text, true)
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true)
$$;
-- Un pedido en efectivo de un producto, por la RPC pública.
create function pg_temp.order_sql(p_key text, p_product text, p_extra jsonb default '{}'::jsonb) returns text language sql stable as $$
  select format('select public.create_order_with_items(%L::jsonb)', (jsonb_build_object(
    'business_id', 'd6900000-0000-4000-8000-0000000000b1',
    'client_request_id', 'contrato-' || p_key,
    'tracking_token', md5(p_key) || md5(p_key || 'contrato'),
    'items', jsonb_build_array(jsonb_build_object('product_id', 'd6900000-0000-4000-8000-0000000000' || p_product, 'quantity', 1)),
    'customer_name', 'Cliente Contrato',
    'customer_phone', '2996209137',
    'delivery_mode', 'pickup',
    'payment_method', 'cash') || p_extra)::text)
$$;
create function pg_temp.delivery_to(p_barrio text) returns jsonb language sql stable as $$
  select jsonb_build_object('delivery_mode', 'delivery', 'customer_street_address', 'Rio Senguer 1234',
    'customer_neighborhood', p_barrio, 'delivery_latitude', '-38.9540', 'delivery_longitude', '-68.0600',
    'delivery_location_source', 'map_pin', 'delivery_location_confirmed_at', clock_timestamp()::text)
$$;

-- ══ 3 · LA PUERTA DEL PEDIDO ═════════════════════════════════════════════════
select pg_temp.as_customer();
select is(pg_temp.attempt_api(pg_temp.order_sql('abierto-0001', 'c1')), '{"ok": true}'::jsonb,
  'control: con el comercio abierto el pedido entra (por la API también: el envoltorio no cambia el camino feliz)');

select is(pg_temp.attempt(pg_temp.order_sql('fuera-0001', 'c3')),
  '{"sqlstate": "55000", "message": "producto no disponible: d6900000-0000-4000-8000-0000000000c3"}'::jsonb,
  'producto no disponible, sin request.method: 55000 como antes');
select is(pg_temp.attempt_api(pg_temp.order_sql('fuera-0001', 'c3')),
  '{"sqlstate": "55000", "message": "producto no disponible: d6900000-0000-4000-8000-0000000000c3"}'::jsonb,
  'producto no disponible, con request.method y un llamador PL/pgSQL: el mismo 55000 (no es el marco más externo)');

select is(pg_temp.attempt(pg_temp.order_sql('zona-0001', 'c1', pg_temp.delivery_to('Lejano'))),
  '{"sqlstate": "55000", "message": "OUT_OF_DELIVERY_ZONE", "detail": "la direccion no esta dentro de la cobertura declarada", "hint": "ofrecer retiro en el local"}'::jsonb,
  'fuera de zona, sin request.method: 55000 · OUT_OF_DELIVERY_ZONE con su detalle y su pista');
select is(pg_temp.attempt_api(pg_temp.order_sql('zona-0001', 'c1', pg_temp.delivery_to('Lejano'))),
  '{"sqlstate": "55000", "message": "OUT_OF_DELIVERY_ZONE", "detail": "la direccion no esta dentro de la cobertura declarada", "hint": "ofrecer retiro en el local"}'::jsonb,
  'fuera de zona, con request.method anidado: el mismo error, letra por letra');

update public.businesses
   set alcohol_sales_enabled = true, alcohol_minimum_age = 18, alcohol_sales_start = '00:00', alcohol_sales_end = '24:00',
       alcohol_timezone = 'America/Argentina/Buenos_Aires', alcohol_hours_enforced = true
 where id = 'd6900000-0000-4000-8000-0000000000b1';
select is(pg_temp.attempt(pg_temp.order_sql('cerveza-0001', 'c2', '{"age_confirmed": true}')) - 'detail',
  '{"sqlstate": "55000", "message": "ALCOHOL_WINDOW_CLOSED"}'::jsonb,
  'grilla de alcohol exigida y vacía, sin request.method: 55000 · ALCOHOL_WINDOW_CLOSED');
select is(pg_temp.attempt_api(pg_temp.order_sql('cerveza-0001', 'c2', '{"age_confirmed": true}')),
  pg_temp.attempt(pg_temp.order_sql('cerveza-0001', 'c2', '{"age_confirmed": true}')),
  'ALCOHOL_WINDOW_CLOSED con request.method anidado: el mismo error con el mismo detalle');

insert into public.business_service_exceptions(business_id, channel, on_date, is_closed)
select 'd6900000-0000-4000-8000-0000000000b1', 'all', (now() at time zone 'America/Argentina/Buenos_Aires')::date + d, true
  from generate_series(-1, 1) d;
select is(pg_temp.attempt(pg_temp.order_sql('cerrado-0001', 'c1')) - 'detail',
  '{"sqlstate": "55000", "message": "BUSINESS_CLOSED", "hint": "reintentar dentro del horario de atencion"}'::jsonb,
  'comercio cerrado por excepción, sin request.method: 55000 · BUSINESS_CLOSED (el detalle trae la próxima apertura)');
select is(pg_temp.attempt_api(pg_temp.order_sql('cerrado-0001', 'c1')),
  pg_temp.attempt(pg_temp.order_sql('cerrado-0001', 'c1')),
  'BUSINESS_CLOSED con request.method anidado: el mismo error con el mismo detalle');
select is((select stock from public.products where id = 'd6900000-0000-4000-8000-0000000000c1'), 49,
  'ningún rechazo tocó el stock (49 = el único pedido que entró)');
delete from public.business_service_exceptions where business_id = 'd6900000-0000-4000-8000-0000000000b1';

-- ══ 4 · «NO EXISTE» ══════════════════════════════════════════════════════════
select is(pg_temp.attempt($$select public.cancel_own_order('d6900000-0000-4000-8000-0000000000ff', 'contrato-propio-0001', null)$$),
  '{"sqlstate": "P0002", "message": "pedido inexistente"}'::jsonb,
  'cancel_own_order de un pedido que no existe, sin request.method: P0002');
select is(pg_temp.attempt_api($$select public.cancel_own_order('d6900000-0000-4000-8000-0000000000ff', 'contrato-propio-0001', null)$$),
  '{"sqlstate": "P0002", "message": "pedido inexistente"}'::jsonb,
  'con request.method anidado: P0002, el que atrapa un llamador PL/pgSQL');
select throws_ok($$select public.cancel_own_order('d6900000-0000-4000-8000-0000000000ff', 'contrato-propio-0001', null)$$,
  'P0002', 'pedido inexistente', 'throws_ok sigue viendo P0002 (las pruebas existentes no cambian)');

select pg_temp.as_owner();
select is(pg_temp.attempt($$select public.transition_order('d6900000-0000-4000-8000-0000000000ff', 1, 'accepted', 'contrato-transicion-0001')$$),
  '{"sqlstate": "P0002", "message": "pedido inexistente"}'::jsonb,
  'transition_order de un pedido que no existe, sin request.method: P0002');
select is(pg_temp.attempt_api($$select public.transition_order('d6900000-0000-4000-8000-0000000000ff', 1, 'accepted', 'contrato-transicion-0001')$$),
  '{"sqlstate": "P0002", "message": "pedido inexistente"}'::jsonb,
  'transition_order con request.method anidado: P0002');

-- ══ 5 · EXIGENCIAS Y VERIFICACIÓN ════════════════════════════════════════════
select is(pg_temp.attempt($$select public.set_service_enforcement('d6900000-0000-4000-8000-0000000000b1', false, null, null, null)$$),
  jsonb_build_object('sqlstate', '55000', 'message', 'ENFORCEMENT_LOCKED',
    'detail', 'un comercio verificado no apaga la exigencia de horarios ni la de cobertura',
    'hint', 'para dejar de vender, pausar o cerrar el negocio; para operar sin estas reglas la plataforma revoca antes la verificacion'),
  'set_service_enforcement bloqueado, sin request.method: 55000 con mensaje, detalle y pista');
select is(pg_temp.attempt_api($$select public.set_service_enforcement('d6900000-0000-4000-8000-0000000000b1', false, null, null, null)$$),
  pg_temp.attempt($$select public.set_service_enforcement('d6900000-0000-4000-8000-0000000000b1', false, null, null, null)$$),
  'con request.method anidado: el mismo 55000 con el mismo detalle y la misma pista');
select is((select hours_enforced from public.businesses where id = 'd6900000-0000-4000-8000-0000000000b1'), true,
  'y la exigencia de horarios sigue encendida');

select pg_temp.as_service();
select is(pg_temp.attempt($$select public.platform_verify_business_ordering('d6900000-0000-4000-8000-0000000000fe', 'contrato-plataforma@example.invalid', 'contrato-x', 1, 'ensayo')$$),
  '{"sqlstate": "P0002", "message": "comercio inexistente"}'::jsonb,
  'la plataforma verifica un comercio que no existe, sin request.method: P0002');
select is(pg_temp.attempt_api($$select public.platform_verify_business_ordering('d6900000-0000-4000-8000-0000000000fe', 'contrato-plataforma@example.invalid', 'contrato-x', 1, 'ensayo')$$),
  '{"sqlstate": "P0002", "message": "comercio inexistente"}'::jsonb,
  'con request.method anidado: P0002');
select is(pg_temp.attempt($$select public.platform_verify_business_ordering('d6900000-0000-4000-8000-0000000000b2', 'contrato-plataforma@example.invalid', 'contrato-p', 1, 'ensayo')$$) ->> 'message',
  'OPENING_NOT_READY', 'un comercio sin dueño ni horarios, sin request.method: 55000 · OPENING_NOT_READY');
select is(pg_temp.attempt_api($$select public.platform_verify_business_ordering('d6900000-0000-4000-8000-0000000000b2', 'contrato-plataforma@example.invalid', 'contrato-p', 1, 'ensayo')$$),
  pg_temp.attempt($$select public.platform_verify_business_ordering('d6900000-0000-4000-8000-0000000000b2', 'contrato-plataforma@example.invalid', 'contrato-p', 1, 'ensayo')$$),
  'con request.method anidado: el mismo 55000 con la misma lista de pendientes en el detalle');
select is((select ordering_verified from public.businesses where id = 'd6900000-0000-4000-8000-0000000000b2'), false,
  'y el comercio sigue sin verificar');

-- ══ 6 · EL TRIGGER DE LA MONEDA ══════════════════════════════════════════════
select is(pg_temp.attempt($$update public.businesses set currency_code = 'USD' where id = 'd6900000-0000-4000-8000-0000000000b1'$$),
  jsonb_build_object('sqlstate', '55000', 'message', 'la moneda de un comercio con pedidos verificados no se cambia',
    'detail', 'currency_code ARS -> USD', 'hint', 'revocar primero la verificacion de pedidos del comercio'),
  'UPDATE directo de la moneda de un comercio verificado, sin request.method: 55000 con detalle y pista');
select is(pg_temp.attempt_api($$update public.businesses set currency_code = 'USD' where id = 'd6900000-0000-4000-8000-0000000000b1'$$),
  pg_temp.attempt($$update public.businesses set currency_code = 'USD' where id = 'd6900000-0000-4000-8000-0000000000b1'$$),
  'con request.method, disparado desde otra función: el mismo 55000 (el trigger no es el marco más externo)');
select is((select currency_code from public.businesses where id = 'd6900000-0000-4000-8000-0000000000b1'), 'ARS',
  'y la moneda no cambió');

-- ══ 7 · LOS MANEJADORES INTERNOS SIGUEN FUNCIONANDO POR LA API ════════════════
-- Son entradas (service_role las llama por la API) y por dentro atrapan negativas de las funciones que
-- llaman: con request.method puesto, la función de adentro no es el marco más externo y re-lanza el original.
select pg_temp.as_service();
select is(pg_temp.attempt_api('select public.expire_unattended_manual_orders(50)'), '{"ok": true}'::jsonb,
  'expire_unattended_manual_orders corre con request.method puesto');
select is(pg_temp.attempt_api('select public.close_expired_qa_windows()'), '{"ok": true}'::jsonb,
  'close_expired_qa_windows corre con request.method puesto');
select is(pg_temp.attempt_api('select public.sweep_expired_checkout_sessions()'), '{"ok": true}'::jsonb,
  'sweep_expired_checkout_sessions corre con request.method puesto');
select is(pg_temp.attempt_api('select public.enqueue_checkout_provider_probes(10)'), '{"ok": true}'::jsonb,
  'enqueue_checkout_provider_probes corre con request.method puesto');

-- Un llamador PL/pgSQL con un manejador sólo para 55000 atrapa la negativa de una función envuelta.
create function pg_temp.catches_state() returns text language plpgsql as $$
begin
  perform public.set_service_enforcement('d6900000-0000-4000-8000-0000000000b1', false, null, null, null);
  return 'no rechazó';
exception when sqlstate '55000' then
  return 'atrapado ' || sqlstate || ' ' || sqlerrm;
end $$;
select pg_temp.as_owner();
select set_config('request.method', 'POST', true);
select is(pg_temp.catches_state(), 'atrapado 55000 ENFORCEMENT_LOCKED',
  'con request.method puesto, un llamador con su propio manejador de 55000 lo sigue atrapando');
select set_config('request.method', '', true);
select is(pg_temp.catches_state(), 'atrapado 55000 ENFORCEMENT_LOCKED', 'y sin request.method, igual');

-- request.method vacío (como lo deja una sesión que no es de la API) cuenta como «no es la API».
select set_config('request.method', '', true);
select is(pg_temp.attempt($$select public.cancel_own_order('d6900000-0000-4000-8000-0000000000ff', 'contrato-propio-0002', null)$$) ->> 'sqlstate',
  'P0002', 'request.method vacío: el original');

select * from finish();
rollback;
