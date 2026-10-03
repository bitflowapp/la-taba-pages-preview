-- TABA · LA PLATAFORMA NO VERIFICA UN COMERCIO SIN REGLAS, Y LA PREPARACIÓN DICE CADA DATO QUE FALTA
--
-- `platform_verify_business_ordering` es el paso que deja a un comercio tomar pedidos.
-- Verificaba con el horario sin exigir y la cobertura sin exigir: desde ahí el comercio,
-- abierto a mano, aceptaba pedidos a cualquier hora y a cualquier dirección. Acá se fija:
--
--   · la verificación se niega (55000 OPENING_NOT_READY, con el código en `detail`) mientras
--     el horario no se exija con una franja por canal encendido, mientras —con delivery— la
--     cobertura no se exija con una zona activa con envío, y mientras no haya un dueño;
--   · cada paso que falta se nombra, y al completarlo el código desaparece;
--   · un comercio sólo con retiro no necesita zonas;
--   · un comercio ya verificado no se toca;
--   · `get_store_opening_readiness` conserva TODAS sus claves y sus valores y suma tres:
--     `configuration` (doce datos, cada uno CONFIGURED / MISSING / NOT_REQUIRED y si bloquea
--     la apertura), `verification_blockers` y `verification_ready`;
--   · `blocks_opening` dice la verdad: lo que anuncia como bloqueo es exactamente por lo que
--     la verificación se niega;
--   · `get_business_opening_status` cuenta los repartidores reales y no llama falla a cobrar
--     en efectivo.
--
-- Ningún caso depende de la hora de la máquina. Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(80);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('d6600000-0000-4000-8000-0000000000a1','authenticated','authenticated','compuerta-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('d6600000-0000-4000-8000-0000000000a2','authenticated','authenticated','compuerta-equipo@example.invalid','',now(),'{}','{}',now(),now()),
  ('d6600000-0000-4000-8000-0000000000a3','authenticated','authenticated','compuerta-rider@example.invalid','',now(),'{}','{}',now(),now()),
  ('d6600000-0000-4000-8000-0000000000a5','authenticated','authenticated','compuerta-plataforma@example.invalid','',now(),'{}','{}',now(),now());

create temporary table compuerta_ids (clave text primary key, id uuid not null, slug text not null) on commit drop;
insert into compuerta_ids values
  ('G', 'd6600000-0000-4000-8000-0000000000b1', 'compuerta-g'),   -- delivery y retiro, todo cargado MENOS horarios y zonas
  ('P', 'd6600000-0000-4000-8000-0000000000b2', 'compuerta-p'),   -- solo retiro
  ('S', 'd6600000-0000-4000-8000-0000000000b3', 'compuerta-s'),   -- con reglas y sin dueño
  ('L', 'd6600000-0000-4000-8000-0000000000b4', 'compuerta-l');   -- ya verificado de antes, sin reglas
create function pg_temp.id(p_clave text) returns uuid language sql stable as $$
  select id from compuerta_ids where clave = p_clave
$$;

insert into public.businesses(id,name,slug,status,is_active,currency_code,address,pickup_enabled,delivery_enabled,delivery_fee,minimum_delivery_subtotal,
  operating_timezone,hours_enforced,delivery_zone_enforced,ordering_verified,ordering_verified_at,ordering_verified_by,ordering_enabled)
select i.id, 'Compuerta ' || i.clave, i.slug, case when i.clave = 'L' then 'open' else 'closed' end, true, 'ARS', 'Mendoza 827, Neuquen',
       true, i.clave <> 'P', case when i.clave <> 'P' then 1500 end, case when i.clave <> 'P' then 0 end,
       'America/Argentina/Buenos_Aires', i.clave = 'S', i.clave = 'S',
       i.clave = 'L', case when i.clave = 'L' then now() end, case when i.clave = 'L' then 'd6600000-0000-4000-8000-0000000000a5'::uuid end, i.clave = 'L'
  from compuerta_ids i;

insert into public.business_members(business_id,user_id,role,is_active)
select pg_temp.id(c), 'd6600000-0000-4000-8000-0000000000a1', 'owner', true from unnest(array['G','P','L']) c;
insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client) values
  ('d6600000-0000-4000-8000-0000000000e1','d6600000-0000-4000-8000-0000000000a1',pg_temp.id('G'),'owner','panel_web'),
  ('d6600000-0000-4000-8000-0000000000e4','d6600000-0000-4000-8000-0000000000a1',pg_temp.id('L'),'owner','panel_web');

-- Un producto publicado por comercio: el catalogo no es lo que se prueba aca.
insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
select gen_random_uuid(), i.id, 'Lata ' || i.clave, 'Gaseosas', 'Cola', 1000, 'confirmed', true, 'Marca',
    'Lata', 'Lata', 473, 'ml', '473 ml', 'lata',
    50, true, true, false, '{}', true, now(), 'd6600000-0000-4000-8000-0000000000a1',
    'compuerta-' || lower(i.clave), 'compuerta-' || lower(i.clave), 'commercial', 1
  from compuerta_ids i;

-- S: horario y cobertura cargados y exigidos. Lo unico que le falta es un dueño.
insert into public.business_service_hours(business_id,channel,weekday,opens_at,closes_at)
select pg_temp.id('S'), canal, d, '09:00', '21:00' from unnest(array['delivery','pickup']) canal, generate_series(0,6) d;
insert into public.delivery_zones(business_id,name,match_kind,area_normalized,delivery_fee,minimum_subtotal,priority)
values (pg_temp.id('S'),'Centro','declared_area','centro',800,0,10);

-- La preparacion, leida como la clave de servicio.
create function pg_temp.prep(p_clave text, p_min integer default 1) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return public.get_store_opening_readiness(pg_temp.id(p_clave), p_min);
end $$;
-- La configuracion en una linea: CODIGO=ESTADO, con «!» donde bloquea la apertura.
create function pg_temp.config(p_clave text) returns text language sql as $$
  select string_agg((e ->> 'code') || '=' || (e ->> 'status') || case when (e ->> 'blocks_opening')::boolean then '!' else '' end, ' ' order by n)
    from jsonb_array_elements(pg_temp.prep(p_clave) -> 'configuration') with ordinality as c(e, n)
$$;
create function pg_temp.dato(p_clave text, p_code text) returns jsonb language sql as $$
  select e from jsonb_array_elements(pg_temp.prep(p_clave) -> 'configuration') e where e ->> 'code' = p_code
$$;
create function pg_temp.bloqueos(p_clave text, p_min integer default 1) returns text language sql as $$
  select coalesce((select string_agg(b, ',' order by n) from jsonb_array_elements_text(pg_temp.prep(p_clave, p_min) -> 'verification_blockers') with ordinality as x(b, n)), '')
$$;
-- La verificacion de plataforma: «ok changed=…» o «SQLSTATE mensaje: detalle».
create function pg_temp.verificar(p_clave text, p_min integer default 1) returns text language plpgsql as $$
declare
  v_result jsonb;
  v_detail text;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    v_result := public.platform_verify_business_ordering(pg_temp.id(p_clave), 'compuerta-plataforma@example.invalid',
      (select slug from compuerta_ids where clave = p_clave), p_min, 'ensayo de la compuerta');
    return 'ok changed=' || (v_result ->> 'changed');
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return sqlstate || ' ' || sqlerrm || ': ' || coalesce(v_detail, '');
  end;
end $$;
create function pg_temp.verificado(p_clave text) returns boolean language sql stable as $$
  select b.ordering_verified and b.ordering_enabled from public.businesses b where b.id = pg_temp.id(p_clave)
$$;

-- ══ 1 · PRIVILEGIOS: LOS MISMOS QUE TENÍAN ═══════════════════════════════════
select ok(
  not has_function_privilege('anon', 'public.get_store_opening_readiness(uuid,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_store_opening_readiness(uuid,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.get_store_opening_readiness(uuid,integer)', 'EXECUTE'),
  'la preparacion la leen una persona del comercio y la plataforma; anon no');
select ok(
  not has_function_privilege('anon', 'public.platform_verify_business_ordering(uuid,text,text,integer,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.platform_verify_business_ordering(uuid,text,text,integer,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.platform_verify_business_ordering(uuid,text,text,integer,text)', 'EXECUTE'),
  'la verificacion sigue siendo solo de la plataforma');
select ok(
  not has_function_privilege('anon', 'public.get_business_opening_status(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_business_opening_status(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_business_opening_status(uuid)', 'EXECUTE'),
  'el estado para abrir el dia lo lee solo una persona del comercio');
select ok(
  (select bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=pg_catalog, public, pg_temp'))
     from pg_proc p
    where p.oid in ('public.get_store_opening_readiness(uuid,integer)'::regprocedure,
                    'public.platform_verify_business_ordering(uuid,text,text,integer,text)'::regprocedure,
                    'public.get_business_opening_status(uuid)'::regprocedure)),
  'las tres corren como su dueño con search_path fijado');

-- ══ 2 · EL AGUJERO (CAT-01): TODO CARGADO, SIN HORARIOS Y SIN ZONAS ══════════
-- G tiene delivery y retiro, envio y minimo, direccion, dueño y un producto publicado.
-- No tiene una franja ni una zona, y no exige ni horario ni cobertura (los valores por defecto).
select is(pg_temp.prep('G') -> 'pending', '["PLATFORM_VERIFICATION"]'::jsonb,
  'la lista de compuertas de siempre dice que solo falta la verificacion (no cambio)');
select is((pg_temp.prep('G') ->> 'ready_for_platform_verification')::boolean, true,
  'y `ready_for_platform_verification` sale como salia');
select is(
  (select string_agg((e ->> 'code') || ':' || (e ->> 'status') || ':' || (e ->> 'blocking'), ' ' order by e ->> 'code')
     from jsonb_array_elements(pg_temp.prep('G') -> 'items') e where e ->> 'code' in ('SERVICE_HOURS', 'DELIVERY_COVERAGE')),
  'DELIVERY_COVERAGE:warn:false SERVICE_HOURS:warn:false',
  'los dos items siguen saliendo como advertencia: las claves existentes no se tocan');
select is(pg_temp.bloqueos('G'), 'SERVICE_HOURS,DELIVERY_COVERAGE',
  'pero la lista nueva dice por que la verificacion se va a negar');
select is((pg_temp.prep('G') ->> 'verification_ready')::boolean, false, 'y que no esta lista para verificar');
select is(pg_temp.verificar('G'), '55000 OPENING_NOT_READY: SERVICE_HOURS,DELIVERY_COVERAGE',
  'CAT-01: la plataforma NO verifica un comercio sin horarios ni zonas');
select is(pg_temp.verificado('G'), false, 'y no escribe nada');
select is((select count(*)::integer from public.business_config_audit where business_id = pg_temp.id('G') and scope = 'platform_verification'), 0,
  'ni deja una fila de auditoria');

select is(pg_temp.config('G'),
  'OWNER=CONFIGURED! SERVICE_HOURS=MISSING! DELIVERY_ZONES=MISSING! DELIVERY_FEES=CONFIGURED! MINIMUM_ORDER=CONFIGURED! PICKUP=CONFIGURED! '
  || 'STAFF=NOT_REQUIRED RIDERS=NOT_REQUIRED MERCADOPAGO_SELLER=NOT_REQUIRED FISCAL_CONFIG=NOT_REQUIRED PRINTER_CONFIG=NOT_REQUIRED ABANDONED_ORDER_POLICY=MISSING',
  'la configuracion dice, dato por dato, que esta, que falta y que bloquea la apertura');

-- ══ 3 · CADA PASO QUE FALTA SE NOMBRA, Y AL COMPLETARLO DESAPARECE ═══════════
-- Franjas solo para delivery: sigue faltando el retiro, y el horario sin exigir.
insert into public.business_service_hours(business_id,channel,weekday,opens_at,closes_at)
select pg_temp.id('G'), 'delivery', d, '09:00', '21:00' from generate_series(0,6) d;
select is(pg_temp.verificar('G'), '55000 OPENING_NOT_READY: SERVICE_HOURS,DELIVERY_COVERAGE', 'con franjas pero sin exigir el horario: se niega');
update public.businesses set hours_enforced = true where id = pg_temp.id('G');
select is(pg_temp.dato('G', 'SERVICE_HOURS') -> 'facts' -> 'missing_channels', '["pickup"]'::jsonb,
  'horario exigido con franjas solo de delivery: falta el retiro');
select is(pg_temp.verificar('G'), '55000 OPENING_NOT_READY: SERVICE_HOURS,DELIVERY_COVERAGE',
  'un canal encendido sin una franja: se niega');
insert into public.business_service_hours(business_id,channel,weekday,opens_at,closes_at)
select pg_temp.id('G'), 'pickup', d, '09:00', '21:00' from generate_series(0,6) d;
select is(pg_temp.dato('G', 'SERVICE_HOURS') ->> 'status', 'CONFIGURED', 'horario exigido, huso valido y una franja por canal: CONFIGURED');
select is(pg_temp.verificar('G'), '55000 OPENING_NOT_READY: DELIVERY_COVERAGE', 'resuelto el horario, queda la cobertura');

-- Una zona activa, pero la cobertura sin exigir.
insert into public.delivery_zones(id,business_id,name,match_kind,area_normalized,delivery_fee,minimum_subtotal,priority)
values ('d6600000-0000-4000-8000-0000000000f1',pg_temp.id('G'),'Centro','declared_area','centro',800,0,10);
select is(pg_temp.verificar('G'), '55000 OPENING_NOT_READY: DELIVERY_COVERAGE', 'con una zona pero sin exigir la cobertura: se niega');
-- La cobertura exigida sin una zona activa.
update public.delivery_zones set is_active = false where business_id = pg_temp.id('G');
update public.businesses set delivery_zone_enforced = true where id = pg_temp.id('G');
select is(pg_temp.verificar('G'), '55000 OPENING_NOT_READY: DELIVERY_COVERAGE', 'cobertura exigida sin una zona activa: se niega');
select is(pg_temp.dato('G', 'DELIVERY_ZONES') -> 'facts' ->> 'active_zones', '0', 'y la configuracion dice que no hay zonas activas');
update public.delivery_zones set is_active = true where business_id = pg_temp.id('G');
-- Un tope de distancia sin el punto del local verificado.
update public.businesses set delivery_max_radius_meters = 5000 where id = pg_temp.id('G');
select is(pg_temp.verificar('G'), '55000 OPENING_NOT_READY: DELIVERY_COVERAGE', 'tope de distancia sin el punto del local verificado: se niega');
update public.businesses set delivery_max_radius_meters = null where id = pg_temp.id('G');

select is(pg_temp.dato('G', 'DELIVERY_ZONES') ->> 'status', 'CONFIGURED', 'cobertura exigida con una zona activa con envio: CONFIGURED');
select is(pg_temp.bloqueos('G'), '', 'no queda ningun bloqueo');
select is((pg_temp.prep('G') ->> 'verification_ready')::boolean, true, 'lista para verificar');
-- El catalogo sigue siendo una compuerta, como antes.
select is(pg_temp.verificar('G', 5), '55000 OPENING_NOT_READY: CATALOG_PRICES,CATALOG_STOCK,CATALOG_PUBLISHED',
  'las compuertas de siempre siguen: con un minimo de 5 productos, uno no alcanza');
select is(pg_temp.bloqueos('G', 5), 'CATALOG_PRICES,CATALOG_STOCK,CATALOG_PUBLISHED', 'y la lista nueva las trae en el mismo orden');

select is(pg_temp.verificar('G'), 'ok changed=true', 'con horario y cobertura exigidos y cargados, la plataforma verifica');
select is(pg_temp.verificado('G'), true, 'queda verificado y habilitado');
select is((select status from public.businesses where id = pg_temp.id('G')), 'closed', 'verificar no abre el comercio');
select is(
  (select string_agg((e ->> 'code') || '=' || (e ->> 'status'), ' ' order by n)
     from public.business_config_audit a, jsonb_array_elements(a.after -> 'configuration') with ordinality as c(e, n)
    where a.business_id = pg_temp.id('G') and a.scope = 'platform_verification' and a.action = 'enabled'
      and (e ->> 'blocks_opening')::boolean),
  'OWNER=CONFIGURED SERVICE_HOURS=CONFIGURED DELIVERY_ZONES=CONFIGURED DELIVERY_FEES=CONFIGURED MINIMUM_ORDER=CONFIGURED PICKUP=CONFIGURED',
  'la auditoria guarda con que configuracion se verifico');
select is(pg_temp.verificar('G'), 'ok changed=false', 'verificar dos veces no cambia nada');
select is((pg_temp.prep('G') ->> 'can_open')::boolean, true, 'verificado: se puede abrir');

-- ══ 4 · SÓLO RETIRO: NO HACEN FALTA ZONAS ════════════════════════════════════
select is(pg_temp.verificar('P'), '55000 OPENING_NOT_READY: SERVICE_HOURS', 'solo retiro sin horario: se niega por el horario, no por la cobertura');
insert into public.business_service_hours(business_id,channel,weekday,opens_at,closes_at)
select pg_temp.id('P'), 'pickup', d, '00:00', '24:00' from generate_series(0,6) d;
update public.businesses set hours_enforced = true where id = pg_temp.id('P');
select is(pg_temp.config('P'),
  'OWNER=CONFIGURED! SERVICE_HOURS=CONFIGURED! DELIVERY_ZONES=NOT_REQUIRED DELIVERY_FEES=NOT_REQUIRED MINIMUM_ORDER=NOT_REQUIRED PICKUP=CONFIGURED! '
  || 'STAFF=NOT_REQUIRED RIDERS=NOT_REQUIRED MERCADOPAGO_SELLER=NOT_REQUIRED FISCAL_CONFIG=NOT_REQUIRED PRINTER_CONFIG=NOT_REQUIRED ABANDONED_ORDER_POLICY=MISSING',
  'solo retiro: zonas, envio y minimo no hacen falta y no bloquean');
select is(pg_temp.verificar('P'), 'ok changed=true', 'un comercio que atiende las 24 horas lo dice con la grilla 00:00-24:00 y se verifica sin zonas');
-- Sin direccion, el retiro no esta configurado.
update public.businesses set ordering_verified = false, ordering_enabled = false, ordering_verified_at = null, ordering_verified_by = null,
       address = 'Direccion a confirmar' where id = pg_temp.id('P');
select is(pg_temp.dato('P', 'PICKUP') ->> 'status', 'MISSING', 'retiro encendido sin direccion del local: MISSING');
select is(pg_temp.verificar('P'), '55000 OPENING_NOT_READY: BUSINESS_ADDRESS', 'y la verificacion se niega con el codigo de siempre');

-- ══ 5 · SIN DUEÑO NO SE VERIFICA ═════════════════════════════════════════════
select is(pg_temp.dato('S', 'OWNER'), '{"code": "OWNER", "gate": "BUSINESS_OWNER", "blocks_opening": true, "status": "MISSING", "facts": {"owners": 0}}'::jsonb,
  'un comercio sin dueño: OWNER MISSING y bloquea');
select is(pg_temp.verificar('S'), '55000 OPENING_NOT_READY: BUSINESS_OWNER', 'con todas las reglas y sin dueño: se niega');
insert into public.business_members(business_id,user_id,role,is_active) values (pg_temp.id('S'),'d6600000-0000-4000-8000-0000000000a2','admin',true);
select is(pg_temp.verificar('S'), '55000 OPENING_NOT_READY: BUSINESS_OWNER', 'un encargado no reemplaza al dueño');
insert into public.business_members(business_id,user_id,role,is_active) values (pg_temp.id('S'),'d6600000-0000-4000-8000-0000000000a1','owner',true);
insert into public.identity_user_security(business_id,user_id,disabled_at,disabled_reason)
values (pg_temp.id('S'),'d6600000-0000-4000-8000-0000000000a1',now(),'cuenta suspendida');
select is(pg_temp.verificar('S'), '55000 OPENING_NOT_READY: BUSINESS_OWNER', 'un dueño con la cuenta deshabilitada tampoco cuenta');
update public.identity_user_security set disabled_at = null, disabled_reason = null where business_id = pg_temp.id('S');
select is(pg_temp.dato('S', 'STAFF') ->> 'status', 'CONFIGURED', 'con un encargado, STAFF pasa a CONFIGURED');
select is(pg_temp.verificar('S'), 'ok changed=true', 'con el dueño activo, se verifica');

-- ══ 6 · UN COMERCIO YA VERIFICADO NO SE TOCA ═════════════════════════════════
-- L estaba verificado antes de esta regla, sin horario ni cobertura exigidos.
select is(pg_temp.verificar('L'), 'ok changed=false', 'la verificacion idempotente de un comercio ya verificado sigue contestando sin cambios');
select is(pg_temp.verificado('L'), true, 'sigue verificado');
select is((pg_temp.prep('L') ->> 'can_open')::boolean, true, '`can_open` sale como salia');
select is((pg_temp.prep('L') ->> 'accepting_orders')::boolean, true, 'y `accepting_orders` tambien (abierto y sin exigir horario)');
select is(pg_temp.bloqueos('L'), 'SERVICE_HOURS,DELIVERY_COVERAGE', 'la lista nueva avisa que opera sin reglas');
select is(pg_temp.dato('L', 'SERVICE_HOURS') ->> 'status', 'MISSING', 'y la configuracion lo marca como faltante');

-- ══ 7 · EL CONTRATO: CLAVES EXISTENTES INTACTAS, TRES NUEVAS ═════════════════
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.prep('G')) k),
  array['accepting_orders', 'business', 'business_id', 'can_open', 'configuration', 'counts', 'generated_at', 'items', 'min_products', 'pending',
        'ready_for_platform_verification', 'verification_blockers', 'verification_ready'],
  'la respuesta trae las diez claves de siempre mas configuration, verification_blockers y verification_ready');
select is(
  (select array_agg(e ->> 'code' order by n) from jsonb_array_elements(pg_temp.prep('G') -> 'items') with ordinality as i(e, n)),
  array['BUSINESS_ACTIVE', 'CURRENCY', 'BUSINESS_ADDRESS', 'BUSINESS_CONTACT', 'FULFILLMENT_MODE', 'SERVICE_HOURS', 'DELIVERY_PRICING', 'DELIVERY_COVERAGE',
        'RIDERS', 'CATALOG_PRICES', 'CATALOG_STOCK', 'CATALOG_PHOTOS', 'CATALOG_PUBLISHED', 'ALCOHOL_POLICY', 'PAYMENT_MANUAL', 'PAYMENT_MERCADOPAGO',
        'PLATFORM_VERIFICATION', 'STORE_OPEN'],
  '`items` conserva sus 18 codigos y su orden');
select is(
  (select array_agg(e ->> 'code' order by n) from jsonb_array_elements(pg_temp.prep('G') -> 'configuration') with ordinality as c(e, n)),
  array['OWNER', 'SERVICE_HOURS', 'DELIVERY_ZONES', 'DELIVERY_FEES', 'MINIMUM_ORDER', 'PICKUP', 'STAFF', 'RIDERS', 'MERCADOPAGO_SELLER', 'FISCAL_CONFIG',
        'PRINTER_CONFIG', 'ABANDONED_ORDER_POLICY'],
  '`configuration` trae los doce datos, en orden');
select is(
  (select count(*)::integer from jsonb_array_elements(pg_temp.prep('G') -> 'configuration') e
    where (select array_agg(k order by k) from jsonb_object_keys(e) k) is distinct from array['blocks_opening', 'code', 'facts', 'gate', 'status']
       or e ->> 'status' not in ('CONFIGURED', 'MISSING', 'NOT_REQUIRED')
       or jsonb_typeof(e -> 'blocks_opening') <> 'boolean'
       or jsonb_typeof(e -> 'facts') <> 'object'),
  0, 'cada dato trae codigo, compuerta, si bloquea, uno de los tres estados y sus hechos');
select ok(position('@' in pg_temp.prep('G')::text) = 0 and pg_temp.prep('G')::text !~ '(user_id|d6600000-0000-4000-8000-0000000000a)',
  'la preparacion sigue sin exponer correos ni identificadores de personas');

-- `blocks_opening` dice la verdad: lo que bloquea y falta es exactamente lo que la lista nombra.
select is(
  (select count(*)::integer
     from compuerta_ids i, lateral (select pg_temp.prep(i.clave) as r) x
    where (select coalesce(array_agg(distinct e ->> 'gate' order by e ->> 'gate'), '{}')
             from jsonb_array_elements(x.r -> 'configuration') e
            where (e ->> 'blocks_opening')::boolean and e ->> 'status' = 'MISSING')
          is distinct from
          (select coalesce(array_agg(b order by b), '{}')
             from jsonb_array_elements_text(x.r -> 'verification_blockers') b
            where b in ('BUSINESS_OWNER', 'SERVICE_HOURS', 'DELIVERY_COVERAGE', 'DELIVERY_PRICING', 'BUSINESS_ADDRESS'))),
  0, 'en los cuatro comercios, los bloqueos de configuracion anunciados son los que la verificacion aplica');

-- ══ 8 · LOS DATOS QUE NO BLOQUEAN: EQUIPO, REPARTIDORES, COBROS, FISCAL, IMPRESIÓN, ABANDONO ═══
-- Repartidores.
select is(pg_temp.dato('G', 'RIDERS') ->> 'status', 'NOT_REQUIRED', 'sin repartidores y sin exigirlos: el comercio entrega por su cuenta');
update public.businesses set rider_presence_required = true where id = pg_temp.id('G');
select is(pg_temp.dato('G', 'RIDERS') ->> 'status', 'MISSING', 'si el comercio pide repartidor presente y no tiene ninguno: MISSING');
insert into public.business_members(business_id,user_id,role,is_active) values (pg_temp.id('G'),'d6600000-0000-4000-8000-0000000000a3','rider',true);
select is(pg_temp.dato('G', 'RIDERS') - 'facts', '{"code": "RIDERS", "gate": null, "blocks_opening": false, "status": "CONFIGURED"}'::jsonb,
  'con un repartidor en el equipo: CONFIGURED, y nunca bloquea');
-- Equipo.
insert into public.business_members(business_id,user_id,role,is_active) values (pg_temp.id('G'),'d6600000-0000-4000-8000-0000000000a2','staff',true);
select is(pg_temp.dato('G', 'STAFF') -> 'facts', '{"members": 1, "commercial_managers": 0}'::jsonb, 'el equipo se cuenta sin nombrar a nadie');
-- Mercado Pago.
insert into public.business_payment_settings(business_id, enabled, environment, checkout_mode, currency, reserve_stock, collector_id, application_id, configured_at)
values (pg_temp.id('G'), true, 'test', 'checkout_pro', 'ARS', true, 'collector-compuerta', 'app-compuerta', now());
select is(pg_temp.dato('G', 'MERCADOPAGO_SELLER') ->> 'status', 'MISSING', 'Mercado Pago encendido por la plataforma y sin vendedor conectado: MISSING');
select is((pg_temp.dato('G', 'MERCADOPAGO_SELLER') ->> 'blocks_opening')::boolean, false, 'y no bloquea: se cobra en efectivo o a coordinar');
-- Fiscal.
insert into public.fiscal_profiles(business_id, legal_name, cuit, tax_condition, environment, point_of_sale, is_enabled)
values (pg_temp.id('G'), 'Compuerta SRL', '30000000007', 'responsable_inscripto', 'homologation', 1, true);
select is(pg_temp.dato('G', 'FISCAL_CONFIG') -> 'facts', '{"enabled": true, "environment": "homologation"}'::jsonb,
  'la facturacion encendida se informa con su ambiente y nada mas');
select is(pg_temp.dato('G', 'FISCAL_CONFIG') ->> 'status', 'CONFIGURED', 'FISCAL_CONFIG pasa a CONFIGURED');
-- Impresion.
insert into public.business_print_settings(business_id, auto_print_enabled) values (pg_temp.id('G'), true);
select is(pg_temp.dato('G', 'PRINTER_CONFIG') ->> 'status', 'MISSING', 'impresion automatica encendida sin un equipo activo: MISSING');
-- El hash es único en toda la tabla y la base del gate ya trae dispositivos confirmados
-- (las filas fiscales legadas usan repeat('a', 64)): acá va uno propio de esta prueba.
insert into public.local_devices(business_id, device_name, status, secret_hash)
values (pg_temp.id('G'), 'Caja', 'active', encode(digest('opening-gate-requires-rules:caja', 'sha256'), 'hex'));
select is(pg_temp.dato('G', 'PRINTER_CONFIG') ->> 'status', 'CONFIGURED', 'con un equipo activo: CONFIGURED');
-- Pedidos abandonados.
update public.businesses set abandoned_order_minutes = 45 where id = pg_temp.id('G');
select is(pg_temp.dato('G', 'ABANDONED_ORDER_POLICY'),
  '{"code": "ABANDONED_ORDER_POLICY", "gate": null, "blocks_opening": false, "status": "CONFIGURED", "facts": {"minutes": 45}}'::jsonb,
  'el plazo de pedidos abandonados se informa tal como lo cargo el comercio');
-- F-01 / PRICE-04: dos barrios declarados con distinto precio.
select is((pg_temp.dato('G', 'DELIVERY_ZONES') -> 'facts' ->> 'customer_selects_price')::boolean, false,
  'con una sola zona declarada no hay precio que elegir');
insert into public.delivery_zones(business_id,name,match_kind,area_normalized,delivery_fee,minimum_subtotal,priority)
values (pg_temp.id('G'),'Confluencia','declared_area','confluencia',2500,12000,20);
select is(pg_temp.dato('G', 'DELIVERY_ZONES') -> 'facts',
  '{"enforced": true, "active_zones": 2, "zones_with_fee": 2, "declared_zones": 2, "polygon_zones": 0, "max_radius_set": false, "point_verified": false, '
  '"declared_prices": 2, "customer_selects_price": true}'::jsonb,
  'F-01: con barrios declarados de distinto precio la preparacion avisa que el precio lo elige el cliente');
select is(pg_temp.config('G'),
  'OWNER=CONFIGURED! SERVICE_HOURS=CONFIGURED! DELIVERY_ZONES=CONFIGURED! DELIVERY_FEES=CONFIGURED! MINIMUM_ORDER=CONFIGURED! PICKUP=CONFIGURED! '
  || 'STAFF=CONFIGURED RIDERS=CONFIGURED MERCADOPAGO_SELLER=MISSING FISCAL_CONFIG=CONFIGURED PRINTER_CONFIG=CONFIGURED ABANDONED_ORDER_POLICY=CONFIGURED',
  'la configuracion completa de G, dato por dato');
select is(pg_temp.bloqueos('G'), '', 'lo que falta y no bloquea no aparece entre los bloqueos');

-- ══ 9 · EL ESTADO PARA ABRIR EL DÍA (CAT-10) ═════════════════════════════════
create function pg_temp.dia(p_clave text, p_sesion text) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'd6600000-0000-4000-8000-0000000000a1', 'role', 'authenticated',
    'session_id', 'd6600000-0000-4000-8000-0000000000' || p_sesion)::text, true);
  return public.get_business_opening_status(pg_temp.id(p_clave));
end $$;

select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.dia('L', 'e4')) k),
  array['backend', 'business_status', 'fiscal', 'generated_at', 'open_orders', 'payments', 'queues', 'riders'],
  'el estado para abrir el dia conserva sus ocho claves');
select is(pg_temp.dia('L', 'e4') -> 'payments' ->> 'status', 'ok',
  'CAT-10: sin Mercado Pago configurado los cobros no son una falla: se cobra en efectivo o por transferencia');
select matches(pg_temp.dia('L', 'e4') -> 'payments' ->> 'detail', 'efectivo', 'y el detalle lo dice');
select is(pg_temp.dia('L', 'e4') -> 'riders' ->> 'status', 'degraded', 'sin repartidores disponibles: degradado');

-- La tabla anterior `public.riders` no cuenta: nadie le escribe.
insert into public.riders(business_id, name, status) values (pg_temp.id('L'), 'Fila heredada', 'available');
select is(pg_temp.dia('L', 'e4') -> 'riders' ->> 'status', 'degraded', 'CAT-10: una fila de la tabla heredada no es un repartidor disponible');
-- Un repartidor real, integrante del equipo, conectado ahora.
insert into public.business_members(business_id,user_id,role,is_active) values (pg_temp.id('L'),'d6600000-0000-4000-8000-0000000000a3','rider',true);
select is(pg_temp.dia('L', 'e4') -> 'riders' ->> 'status', 'degraded', 'un repartidor del equipo que no esta conectado no cuenta');
insert into public.rider_availability(business_id, rider_user_id, available, last_seen_at)
values (pg_temp.id('L'),'d6600000-0000-4000-8000-0000000000a3', true, now());
select is(pg_temp.dia('L', 'e4') -> 'riders', '{"status": "ok", "detail": "1 repartidor(es) disponible(s)."}'::jsonb,
  'CAT-10: un repartidor real, conectado ahora, cuenta');
-- Con Mercado Pago configurado el estado de cobros sigue como antes.
select is(pg_temp.dia('G', 'e1') -> 'payments' ->> 'status', 'ok', 'Mercado Pago encendido en un comercio verificado: ok, como antes');
update public.business_payment_settings set enabled = false where business_id = pg_temp.id('G');
select is(pg_temp.dia('G', 'e1') -> 'payments', '{"status": "degraded", "detail": "Los cobros por la web están apagados."}'::jsonb,
  'Mercado Pago configurado y apagado: degradado, como antes');

select * from finish();
rollback;
