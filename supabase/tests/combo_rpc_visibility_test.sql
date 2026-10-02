-- TABA · LAS RPC DE COMBOS MUESTRAN LO MISMO QUE LAS TABLAS
--
-- `resolve_business_combo` y `list_business_combos` las ejecuta `anon` y corren como
-- su dueño: no pasan por las policies. Sin sesión se podía leer un combo pendiente de
-- aprobación, el nombre, el sku y el stock de un producto sin publicar, y la góndola
-- de un comercio cerrado o de QA.
--
-- Acá se prueba, con cambio real de rol:
--   · la mirada pública (anon, cliente, equipo de otro comercio, sesión revocada);
--   · la mirada completa (equipo del comercio y clave de servicio), que no cambió;
--   · que un combo oculto responde igual que uno inventado.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
values
  ('a5000000-0000-4000-8000-0000000000a1','authenticated','authenticated','combo-owner-x@example.invalid','',now(),'{}','{}',false,now(),now()),
  ('a5000000-0000-4000-8000-0000000000a2','authenticated','authenticated','combo-owner-y@example.invalid','',now(),'{}','{}',false,now(),now()),
  ('a5000000-0000-4000-8000-0000000000a3','authenticated','authenticated','combo-staff-x@example.invalid','',now(),'{}','{}',false,now(),now()),
  ('a5000000-0000-4000-8000-0000000000a4','authenticated','authenticated',null,'',null,'{}','{}',true,now(),now());

insert into public.businesses (
  id, name, slug, status, is_active, ordering_enabled, ordering_verified, ordering_verified_at, ordering_verified_by,
  currency_code, pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal, qa_fixture
) values
  ('b5000000-0000-4000-8000-0000000000a1','Combos X abierto','combos-x-abierto','open',true,true,true,clock_timestamp(),
   'a5000000-0000-4000-8000-0000000000a1','ARS',true,false,0,0,false),
  ('b5000000-0000-4000-8000-0000000000a2','Combos Y cerrado','combos-y-cerrado','closed',true,true,true,clock_timestamp(),
   'a5000000-0000-4000-8000-0000000000a2','ARS',true,false,0,0,false),
  ('b5000000-0000-4000-8000-0000000000a3','Combos Q de QA','combos-q-qa','open',true,true,true,clock_timestamp(),
   'a5000000-0000-4000-8000-0000000000a1','ARS',true,false,0,0,true);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('b5000000-0000-4000-8000-0000000000a1','a5000000-0000-4000-8000-0000000000a1','owner',true),
  ('b5000000-0000-4000-8000-0000000000a1','a5000000-0000-4000-8000-0000000000a3','staff',true),
  ('b5000000-0000-4000-8000-0000000000a2','a5000000-0000-4000-8000-0000000000a2','owner',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('c5000000-0000-4000-8000-0000000000a1','a5000000-0000-4000-8000-0000000000a1','b5000000-0000-4000-8000-0000000000a1','owner','panel_web'),
  ('c5000000-0000-4000-8000-0000000000a2','a5000000-0000-4000-8000-0000000000a2','b5000000-0000-4000-8000-0000000000a2','owner','panel_web'),
  ('c5000000-0000-4000-8000-0000000000a3','a5000000-0000-4000-8000-0000000000a3','b5000000-0000-4000-8000-0000000000a1','staff','panel_web');

-- Productos. «Producto Secreto» está sin verificar y sin publicar: nadie de afuera
-- tiene que poder leer su nombre, su sku ni su stock (37).
insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
  variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
  stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
  external_id,sku,catalog_origin,units_per_pack)
values
  ('d5000000-0000-4000-8000-0000000000a1','b5000000-0000-4000-8000-0000000000a1','Gaseosa Publica','Gaseosas','Cola',1000,'confirmed',true,'Marca',
   'Lata','Lata',473,'ml','473 ml','lata',10,true,true,false,'{}',true,now(),'a5000000-0000-4000-8000-0000000000a1','combo-pub-1','combo-pub-1','commercial',1),
  ('d5000000-0000-4000-8000-0000000000a2','b5000000-0000-4000-8000-0000000000a1','Agua Publica','Aguas','Sin gas',500,'confirmed',true,'Marca',
   'Botella','Botella',500,'ml','500 ml','botella',6,true,true,false,'{}',true,now(),'a5000000-0000-4000-8000-0000000000a1','combo-pub-2','combo-pub-2','commercial',1),
  ('d5000000-0000-4000-8000-0000000000a3','b5000000-0000-4000-8000-0000000000a1','Producto Secreto','Gaseosas','Cola',2500,'pending',true,'Marca',
   'Lata','Lata',473,'ml','473 ml','lata',37,false,true,false,'{}',false,null,null,'combo-secreto-1','secreto-sku','commercial',1),
  ('d5000000-0000-4000-8000-0000000000a4','b5000000-0000-4000-8000-0000000000a2','Gaseosa del cerrado','Gaseosas','Cola',900,'confirmed',true,'Marca',
   'Lata','Lata',473,'ml','473 ml','lata',8,true,true,false,'{}',true,now(),'a5000000-0000-4000-8000-0000000000a2','combo-cer-1','combo-cer-1','commercial',1),
  ('d5000000-0000-4000-8000-0000000000a5','b5000000-0000-4000-8000-0000000000a3','Gaseosa de QA','Gaseosas','Cola',700,'confirmed',true,'Marca',
   'Lata','Lata',473,'ml','473 ml','lata',9,true,true,false,'{}',true,now(),'a5000000-0000-4000-8000-0000000000a1','combo-qa-1','combo-qa-1','commercial',1);

insert into public.product_combos(id,business_id,combo_id,name,terms,discount_percentage,approval_status,approved_at,is_active,sort_order)
values
  ('e5000000-0000-4000-8000-0000000000a1','b5000000-0000-4000-8000-0000000000a1','combo-publico','Combo publico','Hasta agotar stock',10,'APROBADO_COMERCIAL',now(),true,1),
  ('e5000000-0000-4000-8000-0000000000a2','b5000000-0000-4000-8000-0000000000a1','combo-mixto','Combo con un componente sin publicar','t',10,'APROBADO_COMERCIAL',now(),true,2),
  ('e5000000-0000-4000-8000-0000000000a3','b5000000-0000-4000-8000-0000000000a1','promo-sin-aprobar','Promo sin aprobar','Terminos internos en borrador',15,'PENDIENTE_APROBACION_COMERCIAL',null,true,3),
  ('e5000000-0000-4000-8000-0000000000a4','b5000000-0000-4000-8000-0000000000a1','combo-apagado','Combo apagado','t',10,'APROBADO_COMERCIAL',now(),false,4),
  ('e5000000-0000-4000-8000-0000000000a5','b5000000-0000-4000-8000-0000000000a2','promo-del-cerrado','Promo del cerrado','t',10,'APROBADO_COMERCIAL',now(),true,1),
  ('e5000000-0000-4000-8000-0000000000a6','b5000000-0000-4000-8000-0000000000a3','promo-de-qa','Promo de QA','t',10,'APROBADO_COMERCIAL',now(),true,1);

insert into public.product_combo_components(combo_id,product_id,quantity,sort_order)
values
  ('e5000000-0000-4000-8000-0000000000a1','d5000000-0000-4000-8000-0000000000a1',1,1),
  ('e5000000-0000-4000-8000-0000000000a1','d5000000-0000-4000-8000-0000000000a2',1,2),
  ('e5000000-0000-4000-8000-0000000000a2','d5000000-0000-4000-8000-0000000000a1',1,1),
  ('e5000000-0000-4000-8000-0000000000a2','d5000000-0000-4000-8000-0000000000a3',2,2),
  ('e5000000-0000-4000-8000-0000000000a3','d5000000-0000-4000-8000-0000000000a1',1,1),
  ('e5000000-0000-4000-8000-0000000000a3','d5000000-0000-4000-8000-0000000000a3',2,2),
  ('e5000000-0000-4000-8000-0000000000a4','d5000000-0000-4000-8000-0000000000a1',1,1),
  ('e5000000-0000-4000-8000-0000000000a5','d5000000-0000-4000-8000-0000000000a4',1,1),
  ('e5000000-0000-4000-8000-0000000000a6','d5000000-0000-4000-8000-0000000000a5',1,1);

create function pg_temp.ids(p_list jsonb) returns text language sql as $$
  select coalesce(string_agg(c.value ->> 'combo_id', ',' order by c.ordinality), '')
    from jsonb_array_elements(p_list) with ordinality as c(value, ordinality);
$$;

-- ══ 1 · PRIVILEGIOS ═════════════════════════════════════════════════════════
select ok(
  has_function_privilege('anon', 'public.resolve_business_combo(uuid, text, integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.resolve_business_combo(uuid, text, integer)', 'EXECUTE')
  and has_function_privilege('anon', 'public.list_business_combos(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.list_business_combos(uuid)', 'EXECUTE'),
  'las dos RPC siguen siendo la gondola publica: anon y authenticated las ejecutan');
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('business_catalog_is_public', 'catalog_caller_sees_drafts')
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'los predicados internos no son ejecutables por un cliente');

-- ══ 2 · ANON: LO QUE LA TABLA LE MUESTRA ES LO QUE LA RPC LE MUESTRA ════════
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is(
  (select string_agg(c.combo_id, ',' order by c.sort_order) from public.product_combos c
    where c.business_id = 'b5000000-0000-4000-8000-0000000000a1'),
  'combo-publico,combo-mixto', 'tabla: anon ve los dos combos aprobados y activos del comercio abierto');
select is(
  pg_temp.ids(public.list_business_combos('b5000000-0000-4000-8000-0000000000a1')),
  'combo-publico,combo-mixto', 'RPC: lista exactamente los mismos');

select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'promo-sin-aprobar', 1),
  '{"combo_id": "promo-sin-aprobar", "exists": false, "purchasable": false, "blockers": ["El combo no existe para este negocio."]}'::jsonb,
  'AUTHZ-05: un combo pendiente de aprobacion no existe para anon');
select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'promo-sin-aprobar', 1) - 'combo_id',
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'combo-inventado', 1) - 'combo_id',
  'y la respuesta es identica a la de un identificador inventado: no sirve para sondear');
select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'combo-apagado', 1) ->> 'exists',
  'false', 'un combo aprobado pero apagado tampoco existe para anon');

select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'combo-publico', 2)
    - 'combo_uuid' - 'components',
  '{"combo_id": "combo-publico", "exists": true, "name": "Combo publico", "tagline": null, "description": null,
    "category_id": null, "terms": "Hasta agotar stock", "quantity": 2, "discount_percentage": 10.00,
    "approval_status": "APROBADO_COMERCIAL", "list_price": 1500.00, "promotional_price": 1300.00, "savings": 200.00,
    "savings_percentage": 13.3, "stock": 6, "limiting_sku": "combo-pub-2", "age_restricted": false,
    "minimum_age": null, "purchasable": true, "blockers": []}'::jsonb,
  'un combo publico se resuelve entero: precio de lista, promocional, ahorro y stock');
select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'combo-publico', 1) -> 'components' -> 0,
  '{"product_id": "d5000000-0000-4000-8000-0000000000a1", "sku": "combo-pub-1", "name": "Gaseosa Publica",
    "presentation": "Lata", "quantity": 1, "unit_price": 1000.00, "line_price": 1000.00, "alcoholic": false,
    "max_combos": 10}'::jsonb,
  'con el detalle de cada componente publicado');

-- Un combo aprobado con un componente que no está publicado.
select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'combo-mixto', 1) -> 'components' -> 1,
  '{"product_id": "d5000000-0000-4000-8000-0000000000a3", "quantity": 2, "unavailable": true, "max_combos": 0}'::jsonb,
  'AUTHZ-05: del componente sin publicar sale el renglon y nada mas');
select ok(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'combo-mixto', 1)::text !~ 'Secreto|secreto|2500|18|37',
  'ni el nombre, ni el sku, ni el precio, ni el stock (37, o 18 combos) del producto sin publicar');
select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'combo-mixto', 1)
    - 'combo_uuid' - 'components' - 'name' - 'terms',
  '{"combo_id": "combo-mixto", "exists": true, "tagline": null, "description": null, "category_id": null,
    "quantity": 1, "discount_percentage": 10.00, "approval_status": "APROBADO_COMERCIAL", "list_price": null,
    "promotional_price": null, "savings": null, "savings_percentage": null, "stock": 0, "limiting_sku": null,
    "age_restricted": false, "minimum_age": null, "purchasable": false,
    "blockers": ["Un componente no está disponible."]}'::jsonb,
  'y el combo queda no comprable, sin precio, con un motivo que no nombra al producto');
select ok(
  public.list_business_combos('b5000000-0000-4000-8000-0000000000a1')::text !~ 'Secreto|secreto',
  'la lista tampoco lo filtra');

-- Comercio cerrado y comercio de QA fuera de ventana.
select is(public.list_business_combos('b5000000-0000-4000-8000-0000000000a2'), '[]'::jsonb,
  'AUTHZ-05: la lista de un comercio cerrado es vacia para anon');
select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a2', 'promo-del-cerrado', 1) ->> 'exists',
  'false', 'y sus combos no existen: ni precios ni stock de un comercio cerrado');
select is(public.list_business_combos('b5000000-0000-4000-8000-0000000000a3'), '[]'::jsonb,
  'AUTHZ-05: un comercio de QA fuera de su ventana no muestra combos');
select is(
  (select count(*)::integer from public.products p where p.business_id = 'b5000000-0000-4000-8000-0000000000a3'),
  0, 'igual que sus productos por tabla');
reset role;

-- La ventana de QA abierta lo hace público, igual que a sus productos.
update public.businesses set qa_window_until = now() + interval '10 minutes'
 where id = 'b5000000-0000-4000-8000-0000000000a3';
set local role anon;
select is(
  pg_temp.ids(public.list_business_combos('b5000000-0000-4000-8000-0000000000a3')),
  'promo-de-qa', 'con la ventana de QA abierta, el combo de QA si se ve');
reset role;

-- ══ 3 · CLIENTE, EQUIPO AJENO Y SESIÓN REVOCADA: MIRADA PÚBLICA ═════════════
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a5000000-0000-4000-8000-0000000000a4","role":"authenticated","is_anonymous":true}', true);
select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'promo-sin-aprobar', 1) ->> 'exists',
  'false', 'un cliente (sesion anonima) tampoco ve el combo pendiente');
select is(
  pg_temp.ids(public.list_business_combos('b5000000-0000-4000-8000-0000000000a1')),
  'combo-publico,combo-mixto', 'y lista los mismos dos que anon');

select set_config('request.jwt.claims',
  '{"sub":"a5000000-0000-4000-8000-0000000000a2","role":"authenticated","session_id":"c5000000-0000-4000-8000-0000000000a2"}', true);
select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'promo-sin-aprobar', 1) ->> 'exists',
  'false', 'el dueno de OTRO comercio no ve los borradores de este');
select ok(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'combo-mixto', 1)::text !~ 'Secreto|secreto',
  'ni sus productos sin publicar');
select is(
  pg_temp.ids(public.list_business_combos('b5000000-0000-4000-8000-0000000000a2')),
  'promo-del-cerrado', 'pero si los de su propio comercio, aunque este cerrado');
reset role;

update public.identity_sessions set revoked_at = clock_timestamp(), revoked_reason = 'owner_revoked'
 where session_id = 'c5000000-0000-4000-8000-0000000000a3';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a5000000-0000-4000-8000-0000000000a3","role":"authenticated","session_id":"c5000000-0000-4000-8000-0000000000a3"}', true);
select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'promo-sin-aprobar', 1) ->> 'exists',
  'false', 'un empleado con la sesion revocada queda en la mirada publica');

-- ══ 4 · EL EQUIPO DEL COMERCIO: LA MIRADA COMPLETA, SIN CAMBIOS ═════════════
select set_config('request.jwt.claims',
  '{"sub":"a5000000-0000-4000-8000-0000000000a1","role":"authenticated","session_id":"c5000000-0000-4000-8000-0000000000a1"}', true);
select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'promo-sin-aprobar', 1)
    - 'combo_uuid' - 'components',
  '{"combo_id": "promo-sin-aprobar", "exists": true, "name": "Promo sin aprobar", "tagline": null, "description": null,
    "category_id": null, "terms": "Terminos internos en borrador", "quantity": 1, "discount_percentage": 15.00,
    "approval_status": "PENDIENTE_APROBACION_COMERCIAL", "list_price": null, "promotional_price": null,
    "savings": null, "savings_percentage": null, "stock": 10, "limiting_sku": "combo-pub-1",
    "age_restricted": false, "minimum_age": null, "purchasable": false,
    "blockers": ["El combo no está aprobado comercialmente (PENDIENTE_APROBACION_COMERCIAL).",
                 "secreto-sku: precio pendiente de confirmación del negocio."]}'::jsonb,
  'el dueno ve el combo pendiente con su estado y el motivo de cada bloqueo, como antes');
select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'promo-sin-aprobar', 1) -> 'components' -> 1,
  '{"product_id": "d5000000-0000-4000-8000-0000000000a3", "sku": "secreto-sku", "name": "Producto Secreto",
    "presentation": "Lata", "quantity": 2, "unit_price": null, "line_price": null, "alcoholic": false,
    "max_combos": 18}'::jsonb,
  'y el componente sin publicar con todo su detalle');
select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'combo-apagado', 1) -> 'blockers',
  '["El combo está desactivado."]'::jsonb, 'un combo apagado le dice que esta apagado');
select is(
  pg_temp.ids(public.list_business_combos('b5000000-0000-4000-8000-0000000000a1')),
  'combo-publico,combo-mixto', 'la lista del equipo sigue siendo la de activos y aprobados');
reset role;

-- El comercio se pausa: el público deja de ver, el equipo no.
update public.businesses set status = 'paused' where id = 'b5000000-0000-4000-8000-0000000000a1';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(public.list_business_combos('b5000000-0000-4000-8000-0000000000a1'), '[]'::jsonb,
  'con el comercio en pausa, anon no ve combos (igual que no ve productos)');
select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'combo-publico', 1) ->> 'exists',
  'false', 'ni resolviendo uno por su identificador');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a5000000-0000-4000-8000-0000000000a1","role":"authenticated","session_id":"c5000000-0000-4000-8000-0000000000a1"}', true);
select is(
  pg_temp.ids(public.list_business_combos('b5000000-0000-4000-8000-0000000000a1')),
  'combo-publico,combo-mixto', 'el equipo sigue viendo su gondola con el comercio en pausa');
reset role;

-- ══ 5 · LA CLAVE DE SERVICIO: EL IMPORTADOR SIGUE VIENDO TODO ═══════════════
-- El claim `role` lo firma Auth: un cliente no lo puede elegir.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'promo-sin-aprobar', 1) ->> 'approval_status',
  'PENDIENTE_APROBACION_COMERCIAL', 'la clave de servicio resuelve un combo pendiente');
select is(
  pg_temp.ids(public.list_business_combos('b5000000-0000-4000-8000-0000000000a2')),
  'promo-del-cerrado', 'y lista los combos de un comercio cerrado (lo usa el importador)');

-- Sin ningún claim (una conexión directa que no es PostgREST) no hay mirada completa.
select set_config('request.jwt.claims', '', true);
select is(
  public.resolve_business_combo('b5000000-0000-4000-8000-0000000000a1', 'promo-sin-aprobar', 1) ->> 'exists',
  'false', 'sin claim no se asume servicio: la ausencia de usuario no es un permiso');

select * from finish();
rollback;
