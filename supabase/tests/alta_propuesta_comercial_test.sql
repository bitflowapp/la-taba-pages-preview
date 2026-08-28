-- TABA 24/7 · La puerta que CREA productos, probada contra la base.
--
-- `apply_commercial_catalog_plan` es SECURITY DEFINER y hace INSERT sobre
-- `public.products`. Es la superficie nueva mas delicada de este trabajo: una
-- funcion que corre con los permisos de su duenio y da de alta filas
-- comerciales. Leer su texto y comprobar que las palabras estan no alcanza —eso
-- verifica el SQL, no el comportamiento—, asi que acá se la ejercita con
-- identidades reales sobre el stack aislado.
--
-- Lo que se fija, en una linea cada cosa:
--
--     ANON no la puede ni llamar.
--     AUTHENTICATED SIN MEMBRESIA tampoco.
--     MIEMBRO DE OTRO COMERCIO no puede escribir en un business ajeno.
--     OWNER autorizado si puede, y la fila nace OCULTA y SIN VERIFICAR.
--     LA GONDOLA Y EL ALCOHOL tienen que decir lo mismo.
--     UN SKU EXISTENTE no se puede volver a crear.
--     UN PLAN QUE FALLA no deja ni altas ni modificaciones.
--     REPETIR un plan ya aplicado no duplica nada.
--
-- La identidad se arma como la exige `identity_member_role` desde la
-- 20260814030000: membresia activa MAS una sesion registrada en
-- `identity_sessions`. Un token firmado sin esa fila no autoriza, y esta prueba
-- lo respeta en vez de rodearlo.
--
-- Todo transaccional: termina en rollback y no deja una fila.
--
-- Correr con: supabase test db --local supabase/tests/alta_propuesta_comercial_test.sql

begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- ── Fixture: dos comercios, tres personas ───────────────────────────────────
--
-- OWNER_A manda en el comercio A. OWNER_B manda en el B —existe para probar que
-- mandar en algun lado no es mandar en todos—. SIN_EQUIPO tiene un token valido
-- y ninguna membresia.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('91000000-0000-4000-8000-000000000001','authenticated','authenticated','alta-owner-a@example.invalid','',now(),'{}','{}',now(),now()),
  ('91000000-0000-4000-8000-000000000002','authenticated','authenticated','alta-owner-b@example.invalid','',now(),'{}','{}',now(),now()),
  ('91000000-0000-4000-8000-000000000003','authenticated','authenticated','alta-sin-equipo@example.invalid','',now(),'{}','{}',now(),now());

insert into public.businesses(id,name,status,slug,is_active)
values
  ('92000000-0000-4000-8000-00000000000a','TABA alta fixture A','open','taba-alta-a',true),
  ('92000000-0000-4000-8000-00000000000b','TABA alta fixture B','open','taba-alta-b',true);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('92000000-0000-4000-8000-00000000000a','91000000-0000-4000-8000-000000000001','owner',true),
  ('92000000-0000-4000-8000-00000000000b','91000000-0000-4000-8000-000000000002','owner',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('93000000-0000-4000-8000-00000000000a','91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-00000000000a','owner','panel_web'),
  ('93000000-0000-4000-8000-00000000000b','91000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-00000000000b','owner','panel_web');

-- Un producto que YA existe en A, para poder pedir una MODIFICACION y observar
-- que el rollback tambien la deshace.
insert into public.products(
  business_id, sku, external_id, name, category, price, price_status, stock,
  is_active, available, is_verified, is_alcoholic, catalog_origin)
values (
  '92000000-0000-4000-8000-00000000000a','gaseosa-vieja-1500ml','gaseosa-vieja-1500ml',
  'Gaseosa que ya estaba','Gaseosas',2500,'confirmed',10,
  true,false,false,false,'commercial');

-- El cuerpo de un alta valida, en un solo lugar: las pruebas de abajo cambian
-- una clave por vez y asi cada rechazo se atribuye a esa clave y no al resto.
--
-- OJO CON LOS NOMBRES. La RPC rechaza cualquier SKU que contenga `prueba`,
-- `test`, `qa`, `fixture` o `dummy`, porque un fixture de QA en la gondola
-- comercial ya llego a produccion una vez. Los SKU de este archivo evitan esas
-- palabras a proposito: un `lavandina-prueba-1000ml` haria fallar la prueba por
-- la compuerta que la prueba no esta mirando.
create function pg_temp.alta(p_sku text, p_categoria text, p_alcohol boolean)
returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object(
    'sku', p_sku, 'name', 'Producto ' || p_sku, 'category', p_categoria,
    'subcategory', 'generico', 'is_alcoholic', p_alcohol,
    'price', null, 'stock', 3, 'publish', false));
$$;

-- ── 1 · ANON no la puede ni llamar ──────────────────────────────────────────
--
-- Se prueba por el GRANT, que es donde de verdad vive la respuesta: anon no
-- tiene EXECUTE, asi que el cuerpo de la funcion nunca llega a evaluarse y no
-- hay compuerta interna de la que depender.
--
-- POR QUE NO SE INTENTA LA LLAMADA DE VERDAD, y por favor no la vuelvan a
-- agregar sin leer esto. Habia aca un `set local role anon` seguido de un
-- `throws_ok` sobre la funcion. En el stack aislado de CI eso NO fallo la
-- asercion: TIRO ABAJO EL SERVIDOR —«server closed the connection
-- unexpectedly», la instancia entera entrando en recovery y arrastrando las
-- otras bases del contenedor—. Ocurrio de forma reproducible justo despues de
-- las dos aserciones de privilegios, con las otras dos suites pgTAP ya en
-- verde. No se pudo aislar la causa: es una interaccion entre el cambio de rol
-- y la maquinaria de pgTAP, no de esta funcion —anon no tiene EXECUTE, asi que
-- su cuerpo no corrio—.
--
-- Lo que se pierde es poco y lo que se gana es un gate que no voltea la base:
-- `function_privs_are` responde exactamente la misma pregunta —¿puede anon
-- ejecutar esto?— de forma declarativa y deterministica. El rechazo EN
-- EJECUCION de un llamador no autorizado sigue probado abajo, con
-- `authenticated`, que es el rol con el que el resto del repositorio ya
-- ejercita sus RPC sin problemas.
select function_privs_are(
  'public', 'apply_commercial_catalog_plan', array['uuid','jsonb','jsonb'],
  'anon', array[]::text[],
  'anon no tiene ningun privilegio sobre la funcion');
select function_privs_are(
  'public', 'apply_commercial_catalog_plan', array['uuid','jsonb','jsonb'],
  'authenticated', array['EXECUTE'],
  'authenticated tiene EXECUTE y nada mas');

-- ── 2 · AUTHENTICATED SIN MEMBRESIA tampoco ─────────────────────────────────
-- Tiene EXECUTE y un token valido. Lo frena la compuerta de adentro, y este es
-- el rechazo EN EJECUCION que sostiene la mitad que el GRANT no cubre.
set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$select public.apply_commercial_catalog_plan(
      '92000000-0000-4000-8000-00000000000a',
      '[{"sku":"sin-equipo-intenta","name":"Sin equipo","category":"Limpieza","is_alcoholic":false,"price":null,"stock":0,"publish":false}]'::jsonb,
      '[]'::jsonb)$$,
  '42501', 'Only an active owner/admin can apply a commercial catalog plan.',
  'un autenticado sin membresia no puede aplicar un plan');

-- ── 3 · MANDAR EN UN COMERCIO NO ES MANDAR EN TODOS ─────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"93000000-0000-4000-8000-00000000000b"}';
select throws_ok(
  $$select public.apply_commercial_catalog_plan(
      '92000000-0000-4000-8000-00000000000a',
      '[{"sku":"cruzado-intenta","name":"Cruzado","category":"Limpieza","is_alcoholic":false,"price":null,"stock":0,"publish":false}]'::jsonb,
      '[]'::jsonb)$$,
  '42501', 'Only an active owner/admin can apply a commercial catalog plan.',
  'el owner del comercio B no puede crear en el comercio A');
reset role;
select is(
  (select count(*) from public.products where sku = 'cruzado-intenta'),
  0::bigint,
  'y el intento cruzado no dejo ninguna fila');

-- ── 4 · EL OWNER AUTORIZADO SI PUEDE ────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"93000000-0000-4000-8000-00000000000a"}';
select is(
  public.apply_commercial_catalog_plan(
    '92000000-0000-4000-8000-00000000000a',
    pg_temp.alta('lavandina-ayudin-1000ml','Limpieza',false),
    '[]'::jsonb) -> 'created',
  '1'::jsonb,
  'el owner del comercio crea el producto que propuso');

-- ── 5 · LA FILA NACE OCULTA, SIN VERIFICAR Y EN SU COMERCIO ─────────────────
-- Son los cuatro campos que deciden si algo se puede comprar y de quien es.
-- Se miran uno por uno para que el fallo diga cual se movio.
reset role;
select is(
  (select available from public.products where sku = 'lavandina-ayudin-1000ml'),
  false, 'la fila creada NO esta disponible');
select is(
  (select is_verified from public.products where sku = 'lavandina-ayudin-1000ml'),
  false, 'la fila creada NO esta verificada');
select is(
  (select business_id from public.products where sku = 'lavandina-ayudin-1000ml'),
  '92000000-0000-4000-8000-00000000000a'::uuid,
  'la fila creada pertenece al comercio autorizado y a ningun otro');
select is(
  (select catalog_origin from public.products where sku = 'lavandina-ayudin-1000ml'),
  'commercial', 'la fila creada nace con origen comercial');
select is(
  (select price_status from public.products where sku = 'lavandina-ayudin-1000ml'),
  'pending', 'sin precio en el plan, el precio queda pendiente y no en cero confirmado');

-- ── 6 · LA GONDOLA Y EL ALCOHOL TIENEN QUE DECIR LO MISMO ───────────────────
set local role authenticated;
select throws_ok(
  format($$select public.apply_commercial_catalog_plan(
      '92000000-0000-4000-8000-00000000000a', %L::jsonb, '[]'::jsonb)$$,
    pg_temp.alta('lavandina-con-alcohol','Limpieza',true)),
  '22023', null,
  'una categoria sin alcohol no puede declararse alcoholica');
select throws_ok(
  format($$select public.apply_commercial_catalog_plan(
      '92000000-0000-4000-8000-00000000000a', %L::jsonb, '[]'::jsonb)$$,
    pg_temp.alta('fernet-sin-alcohol','Fernet',false)),
  '22023', null,
  'y una categoria con alcohol no puede declararse sin el');

-- Un alta con alcohol COHERENTE si entra —la compuerta no es «rechazar todo»—
-- y nace igual de oculta, con su edad minima puesta por el contrato.
select is(
  public.apply_commercial_catalog_plan(
    '92000000-0000-4000-8000-00000000000a',
    pg_temp.alta('fernet-branca-750ml','Fernet',true),
    '[]'::jsonb) -> 'created',
  '1'::jsonb,
  'un alta con alcohol coherente se crea');
reset role;
select results_eq(
  $$select available, is_verified, minimum_age
      from public.products where sku = 'fernet-branca-750ml'$$,
  $$values (false, false, 18)$$,
  'y nace oculta, sin verificar y con la edad minima del contrato');

-- ── 7 · UN SKU EXISTENTE NO SE PUEDE VOLVER A CREAR ─────────────────────────
set local role authenticated;
select throws_ok(
  $$select public.apply_commercial_catalog_plan(
      '92000000-0000-4000-8000-00000000000a',
      '[{"sku":"gaseosa-vieja-1500ml","name":"Otro nombre","category":"Gaseosas","is_alcoholic":false,"price":null,"stock":0,"publish":false}]'::jsonb,
      '[]'::jsonb)$$,
  '23505', null,
  'un plan nunca sobreescribe creando sobre un SKU que ya existe');
reset role;
select is(
  (select name from public.products where sku = 'gaseosa-vieja-1500ml'),
  'Gaseosa que ya estaba',
  'y el producto que ya estaba conserva su nombre');

-- ── 8 · UN PLAN QUE FALLA NO DEJA NI ALTAS NI MODIFICACIONES ────────────────
--
-- El orden interno es ALTAS y despues MODIFICACIONES, asi que este caso es el
-- que importa: el alta YA se inserto cuando la modificacion revienta. Si la
-- transaccion no fuera una sola, la fila nueva quedaria y el precio no se
-- habria movido: media gondola aplicada, que es peor que ninguna.
set local role authenticated;
select throws_ok(
  $$select public.apply_commercial_catalog_plan(
      '92000000-0000-4000-8000-00000000000a',
      '[{"sku":"snack-del-lote","name":"Snack del lote","category":"Snacks","is_alcoholic":false,"price":"1200","stock":5,"publish":false}]'::jsonb,
      '[{"sku":"gaseosa-vieja-1500ml","price":"3100"},{"sku":"sku-que-no-existe","price":"999"}]'::jsonb)$$,
  'P0001', null,
  'una modificacion invalida hace fallar el plan entero');
reset role;
select is(
  (select count(*) from public.products where sku = 'snack-del-lote'),
  0::bigint,
  'el alta del mismo plan se deshizo con la modificacion que fallo');
select is(
  (select price from public.products where sku = 'gaseosa-vieja-1500ml'),
  2500::numeric(12,2),
  'y la modificacion valida del mismo plan tampoco quedo aplicada');

-- La direccion contraria: con un alta invalida, la modificacion valida del
-- mismo plan tampoco se aplica.
set local role authenticated;
select throws_ok(
  $$select public.apply_commercial_catalog_plan(
      '92000000-0000-4000-8000-00000000000a',
      '[{"sku":"rubro-inventado","name":"Tornillo","category":"Ferreteria","is_alcoholic":false,"price":null,"stock":0,"publish":false}]'::jsonb,
      '[{"sku":"gaseosa-vieja-1500ml","price":"3200"}]'::jsonb)$$,
  '22023', null,
  'un alta invalida hace fallar el plan entero');
reset role;
select is(
  (select price from public.products where sku = 'gaseosa-vieja-1500ml'),
  2500::numeric(12,2),
  'y la modificacion que venia con ella tampoco quedo aplicada');

-- ── 9 · REPETIR UN PLAN YA APLICADO NO DUPLICA NADA ─────────────────────────
-- Un reintento —la red se cayo, alguien toco dos veces— tiene que rebotar
-- contra la unicidad, no crear un segundo producto con el mismo SKU.
set local role authenticated;
select throws_ok(
  format($$select public.apply_commercial_catalog_plan(
      '92000000-0000-4000-8000-00000000000a', %L::jsonb, '[]'::jsonb)$$,
    pg_temp.alta('lavandina-ayudin-1000ml','Limpieza',false)),
  '23505', null,
  'reaplicar el mismo plan rebota');
reset role;
select is(
  (select count(*) from public.products
    where sku = 'lavandina-ayudin-1000ml'
      and business_id = '92000000-0000-4000-8000-00000000000a'),
  1::bigint,
  'y sigue habiendo exactamente un producto con ese SKU');

-- ── Y una vuelta mas: el mismo SKU en OTRO comercio si es otro producto ─────
-- La unicidad es por comercio, no global. Si fuera global, un comercio podria
-- bloquearle un SKU a otro con solo nombrarlo.
set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"93000000-0000-4000-8000-00000000000b"}';
select is(
  public.apply_commercial_catalog_plan(
    '92000000-0000-4000-8000-00000000000b',
    pg_temp.alta('lavandina-ayudin-1000ml','Limpieza',false),
    '[]'::jsonb) -> 'created',
  '1'::jsonb,
  'el mismo SKU en otro comercio es otro producto y se crea');
reset role;
select is(
  (select count(distinct business_id) from public.products where sku = 'lavandina-ayudin-1000ml'),
  2::bigint,
  'y cada uno quedo en su propio comercio');

select * from finish();
rollback;
