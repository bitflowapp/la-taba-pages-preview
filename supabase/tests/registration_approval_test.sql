-- TABA2 · Alta por solicitud · IDENTIDAD NO ES AUTORIZACION
--
-- La frase que esta suite tiene que sostener es una sola:
--
--     registrarse crea una identidad; no crea un permiso.
--
-- Todo lo demas son formas de intentar romperla. Se prueban las obvias (el
-- solicitante se aprueba a si mismo) y las que no lo son tanto: el empleado con
-- sesion valida pero sin identity.members.write, el admin que quiere fabricar
-- otro admin, el owner del comercio de al lado, el que manda el rol en el
-- parametro, el que escribe directo en business_members, y el Rider pendiente
-- que pregunta por el tablero antes de que nadie lo aprobara.
--
-- Tambien se prueba lo que TIENE que funcionar: que al aprobar nazcan en la
-- misma transaccion la membresia, la seguridad y el perfil, y que el Rider
-- recien aprobado entre al contrato Rider normal sin ningun paso extra.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(87);

-- ── Fixture: dos comercios y su gente ──────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('e1000000-0000-4000-8000-000000000001','authenticated','authenticated','owner1@example.invalid','',now(),'{}','{}',now(),now()),
  ('e1000000-0000-4000-8000-000000000002','authenticated','authenticated','admin1@example.invalid','',now(),'{}','{}',now(),now()),
  ('e1000000-0000-4000-8000-000000000003','authenticated','authenticated','staff1@example.invalid','',now(),'{}','{}',now(),now()),
  ('e1000000-0000-4000-8000-000000000004','authenticated','authenticated','rider1@example.invalid','',now(),'{}','{}',now(),now()),
  ('e1000000-0000-4000-8000-000000000005','authenticated','authenticated','owner2@example.invalid','',now(),'{}','{}',now(),now()),
  -- Solicitantes: identidad si, membresia no.
  ('e1000000-0000-4000-8000-00000000000a','authenticated','authenticated','pide-panel@example.invalid','',now(),'{}','{}',now(),now()),
  ('e1000000-0000-4000-8000-00000000000b','authenticated','authenticated','pide-panel2@example.invalid','',now(),'{}','{}',now(),now()),
  ('e1000000-0000-4000-8000-00000000000c','authenticated','authenticated','pide-panel3@example.invalid','',now(),'{}','{}',now(),now()),
  ('e1000000-0000-4000-8000-00000000000d','authenticated','authenticated','pide-rider@example.invalid','',now(),'{}','{}',now(),now()),
  ('e1000000-0000-4000-8000-00000000000e','authenticated','authenticated','pide-rider2@example.invalid','',now(),'{}','{}',now(),now()),
  ('e1000000-0000-4000-8000-00000000000f','authenticated','authenticated','rechazado@example.invalid','',now(),'{}','{}',now(),now()),
  -- El cliente que compra: sesion anonima de GoTrue, sin correo.
  ('e1000000-0000-4000-8000-0000000000aa','authenticated','authenticated',null,'',null,'{}','{}',now(),now());

insert into public.businesses(id,name,status,slug,is_active)
values
  ('e2000000-0000-4000-8000-000000000001','TABA registro','open','taba-registro',true),
  ('e2000000-0000-4000-8000-000000000002','Comercio vecino','open','comercio-vecino',true),
  ('e2000000-0000-4000-8000-000000000009','Comercio cerrado','closed','comercio-cerrado',false);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','owner',true),
  ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','admin',true),
  ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000003','staff',true),
  ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000004','rider',true),
  ('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000005','owner',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','owner','panel_web'),
  ('e3000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','admin','panel_web'),
  ('e3000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000001','staff','panel_web'),
  ('e3000000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000004','e2000000-0000-4000-8000-000000000001','rider','rider_android'),
  ('e3000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000005','e2000000-0000-4000-8000-000000000002','owner','panel_web');

-- Un solicitante NO tiene session_id registrada: todavia no es nadie para la
-- compuerta. Sus llamadas legitimas (pedir, consultar su estado) no lo exigen.
create or replace function pg_temp.as_member(p_user text, p_session text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true)::void;
$$;

create or replace function pg_temp.as_applicant(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)::void;
$$;

create or replace function pg_temp.as_anonymous(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'is_anonymous', true)::text, true)::void;
$$;

-- ══ 1. PEDIR ACCESO NO DA ACCESO ═══════════════════════════════════════════
select pg_temp.as_applicant('e1000000-0000-4000-8000-00000000000a');

select is(
  public.request_business_access(
    'e2000000-0000-4000-8000-000000000001','panel','Pedro Panel','2996000010') ->> 'code',
  'pending',
  'una persona sin membresia puede pedir acceso al Panel');

select is(
  (select count(*) from public.business_members
    where business_id = 'e2000000-0000-4000-8000-000000000001'
      and user_id = 'e1000000-0000-4000-8000-00000000000a'),
  0::bigint,
  'y pedirlo NO le creo ninguna membresia');

select is(
  public.identity_current_context('e2000000-0000-4000-8000-000000000001') -> 'role',
  'null'::jsonb,
  'la compuerta le sigue contestando que no tiene rol');

select is(
  public.identity_current_context('e2000000-0000-4000-8000-000000000001') -> 'permissions',
  '[]'::jsonb,
  'y que no tiene ningun permiso');

select is(
  public.get_my_business_access_request('e2000000-0000-4000-8000-000000000001') ->> 'status',
  'pending',
  'el solicitante puede ver el estado de SU solicitud');

select is(
  public.get_my_business_access_request('e2000000-0000-4000-8000-000000000001') -> 'is_member',
  'false'::jsonb,
  'y ese estado dice, explicitamente, que todavia no es del equipo');

-- ══ 2. INSISTIR NO MULTIPLICA FILAS ════════════════════════════════════════
select is(
  public.request_business_access(
    'e2000000-0000-4000-8000-000000000001','panel','Pedro Panel','2996000010') ->> 'code',
  'already_pending',
  'volver a pedir con una solicitud viva devuelve la que ya existe');

select is(
  (select count(*) from public.business_access_requests
    where business_id = 'e2000000-0000-4000-8000-000000000001'
      and user_id = 'e1000000-0000-4000-8000-00000000000a'),
  1::bigint,
  'y no crea una segunda fila');

select is(
  (select attempt_count from public.business_access_requests
    where user_id = 'e1000000-0000-4000-8000-00000000000a'),
  1,
  'ni suma un intento: insistir sobre un pendiente no es un intento nuevo');

-- ══ 3. LO QUE EL SOLICITANTE NO PUEDE ELEGIR ═══════════════════════════════
-- No hay parametro de usuario ni de rol en la RPC. Lo que si se puede
-- comprobar es que la fila quedo con SU uid y sin rol otorgado.
select is(
  (select granted_role from public.business_access_requests
    where user_id = 'e1000000-0000-4000-8000-00000000000a'),
  null,
  'la solicitud nace sin rol otorgado: el rol lo pone quien aprueba');

select is(
  (select status from public.business_access_requests
    where user_id = 'e1000000-0000-4000-8000-00000000000a'),
  'pending',
  'y nace pendiente, no aprobada');

-- ══ 4. LA SESION ANONIMA NUNCA ES EQUIPO ═══════════════════════════════════
select pg_temp.as_anonymous('e1000000-0000-4000-8000-0000000000aa');
select is(
  public.request_business_access(
    'e2000000-0000-4000-8000-000000000001','panel','Cliente Curioso','2996000099') ->> 'code',
  'not_authenticated',
  'la sesion anonima del cliente que compra no puede pedir acceso al equipo');
select is(
  public.get_my_business_access_request('e2000000-0000-4000-8000-000000000001') ->> 'code',
  'not_authenticated',
  'ni consultar solicitudes');

-- ══ 5. VALIDACION DE ENTRADA ═══════════════════════════════════════════════
select pg_temp.as_applicant('e1000000-0000-4000-8000-00000000000d');

select is(
  public.request_business_access(
    'e2000000-0000-4000-8000-000000000001','rider','Ramiro Rider',null) ->> 'code',
  'phone_required',
  'al Rider hay que poder llamarlo: sin telefono no hay solicitud');

select is(
  public.request_business_access(
    'e2000000-0000-4000-8000-000000000001','dueno','Ramiro Rider','2996000020') ->> 'code',
  'invalid_access',
  'no se puede inventar un tipo de acceso');

select is(
  public.request_business_access(
    'e2000000-0000-4000-8000-000000000001','rider','R','2996000020') ->> 'code',
  'invalid_name',
  'ni mandar un nombre vacio');

select is(
  public.request_business_access(
    'e2000000-0000-4000-8000-000000000009','rider','Ramiro Rider','2996000020') ->> 'code',
  'not_available',
  'un comercio dado de baja no recibe solicitudes');

select is(
  public.request_business_access(
    'e2000000-0000-4000-8000-0000000000ff','rider','Ramiro Rider','2996000020') ->> 'code',
  'not_available',
  'y un comercio inexistente responde exactamente lo mismo: no es un oraculo');

select is(
  public.request_business_access(
    'e2000000-0000-4000-8000-000000000001','rider','Ramiro Rider','2996000020') ->> 'code',
  'pending',
  'con telefono y nombre, la solicitud de Rider entra');

-- ══ 6. QUIEN YA ES DEL EQUIPO NO PIDE ══════════════════════════════════════
select pg_temp.as_applicant('e1000000-0000-4000-8000-000000000004');
select is(
  public.request_business_access(
    'e2000000-0000-4000-8000-000000000001','panel','Rider Uno','2996000004') ->> 'code',
  'already_member',
  'quien ya tiene membresia no genera una solicitud');
select is(
  (select count(*) from public.business_access_requests
    where user_id = 'e1000000-0000-4000-8000-000000000004'),
  0::bigint,
  'y no deja fila');

-- ══ 7. LA TABLA NO SE TOCA DESDE EL CLIENTE ════════════════════════════════
select ok(not has_table_privilege('authenticated','public.business_access_requests','SELECT'),
  'authenticated NO puede leer la tabla de solicitudes');
select ok(not has_table_privilege('authenticated','public.business_access_requests','INSERT'),
  'authenticated NO puede insertar solicitudes');
select ok(not has_table_privilege('authenticated','public.business_access_requests','UPDATE'),
  'authenticated NO puede editar solicitudes');
select ok(not has_table_privilege('authenticated','public.business_access_requests','DELETE'),
  'authenticated NO puede borrar solicitudes');
select ok(not has_table_privilege('anon','public.business_access_requests','SELECT'),
  'anon tampoco la ve');

-- ══ 8. NI LA MEMBRESIA ═════════════════════════════════════════════════════
select ok(not has_table_privilege('authenticated','public.business_members','INSERT'),
  'authenticated NO puede insertar una membresia directa');
select ok(not has_table_privilege('authenticated','public.business_members','UPDATE'),
  'ni actualizarla');

select pg_temp.as_applicant('e1000000-0000-4000-8000-00000000000a');
set local role authenticated;
select throws_ok(
  $$ insert into public.business_members(business_id,user_id,role,is_active)
     values ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-00000000000a','owner',true) $$,
  '42501',
  null,
  'con el rol real, escribir una membresia directa es 42501 por falta de grant');
reset role;

-- CONTROL NEGATIVO, capa 2. Se devuelve el grant a proposito, dentro de la
-- transaccion, para ver que hay debajo: la RLS de business_members, que le
-- pregunta a la compuerta si quien escribe tiene autoridad en ese comercio. Si
-- alguien reabre el grant por descuido, esta prueba demuestra que la puerta
-- sigue cerrada por otro lado.
grant insert on table public.business_members to authenticated;
set local role authenticated;
select throws_ok(
  $$ insert into public.business_members(business_id,user_id,role,is_active)
     values ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-00000000000a','owner',true) $$,
  '42501',
  'new row violates row-level security policy for table "business_members"',
  'con el grant devuelto, la RLS lo frena igual: el solicitante no tiene autoridad');
reset role;
revoke insert on table public.business_members from authenticated;
select is(
  (select count(*) from public.business_members where user_id = 'e1000000-0000-4000-8000-00000000000a'),
  0::bigint,
  'ninguno de los dos intentos dejo una membresia');

-- CAPA 3, y por que aca se comprueba distinto.
--
-- Debajo de los grants y de la RLS esta identity_guard_membership_write, que
-- exige la marca `taba.identity_write` que solo ponen las RPC de identidad. Esa
-- capa NO se puede ejercitar desde esta suite, y conviene decir por que en vez
-- de fingir que si: el guard tiene una via de escape deliberada para las
-- conexiones directas de migraciones, semillas y fixtures, y la reconoce
-- mirando `session_user`. `supabase test db` entra justamente por una de esas
-- conexiones (`session_user` = postgres), y `set role` no cambia `session_user`.
-- `set session authorization` cambiaria las dos cosas, pero el rol postgres de
-- Supabase no es superusuario y no puede usarlo.
--
-- Lo que si se puede comprobar, y es lo que se rompio de verdad una vez
-- (migracion 20260812080000), es que el guard este colgado de la tabla y que NO
-- sea `security definer`: con definer, `current_user` es el duenio de la
-- funcion y las tres vias de escape se evaluan mal. Su comportamiento contra un
-- cliente real quedo certificado en esa migracion, contra PostgREST alojado.
select ok(
  exists (
    select 1
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_proc p on p.oid = t.tgfoid
     where c.relname = 'business_members'
       and not t.tgisinternal
       and p.proname = 'identity_guard_membership_write'
  ),
  'el guard de membresias sigue colgado de business_members');
select ok(
  not (select p.prosecdef from pg_catalog.pg_proc p
        where p.proname = 'identity_guard_membership_write'
          and p.pronamespace = 'public'::regnamespace),
  'y sigue sin ser security definer, que es lo que le deja ver quien llama de verdad');

-- ══ 9. NADIE SE APRUEBA A SI MISMO ═════════════════════════════════════════
select throws_ok(
  format($$ select public.identity_review_access_request(%L::uuid,'approve','admin') $$,
    (select id from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-00000000000a')),
  '42501',
  null,
  'el solicitante no puede aprobar su propia solicitud: no tiene autoridad en el comercio');

select throws_ok(
  format($$ select public.identity_list_access_requests(%L::uuid) $$,
    'e2000000-0000-4000-8000-000000000001'),
  '42501',
  null,
  'ni ver la bandeja');

-- ══ 10. TENER SESION VALIDA NO ES TENER AUTORIDAD ══════════════════════════
select pg_temp.as_member('e1000000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000003');
select throws_ok(
  format($$ select public.identity_review_access_request(%L::uuid,'approve','staff') $$,
    (select id from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-00000000000a')),
  '42501',
  null,
  'un empleado con sesion viva no puede aprobar: no tiene identity.members.write');

select pg_temp.as_member('e1000000-0000-4000-8000-000000000004','e3000000-0000-4000-8000-000000000004');
select throws_ok(
  format($$ select public.identity_review_access_request(%L::uuid,'approve','rider') $$,
    (select id from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-00000000000d')),
  '42501',
  null,
  'y un Rider tampoco aprueba a otro Rider');

-- ══ 11. EL COMERCIO DE AL LADO NO DECIDE ═══════════════════════════════════
select pg_temp.as_member('e1000000-0000-4000-8000-000000000005','e3000000-0000-4000-8000-000000000005');
select throws_ok(
  format($$ select public.identity_review_access_request(%L::uuid,'approve','staff') $$,
    (select id from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-00000000000a')),
  '42501',
  null,
  'el owner del comercio vecino no puede aprobar una solicitud ajena');
select throws_ok(
  $$ select public.identity_list_access_requests('e2000000-0000-4000-8000-000000000001') $$,
  '42501',
  null,
  'ni leer su bandeja');
select is(
  jsonb_array_length(public.identity_list_access_requests('e2000000-0000-4000-8000-000000000002')),
  0,
  'su propia bandeja esta vacia: las solicitudes no cruzan de comercio');

-- ══ 12. LA BANDEJA DEL OWNER ═══════════════════════════════════════════════
select pg_temp.as_member('e1000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001');
select is(
  jsonb_array_length(public.identity_list_access_requests('e2000000-0000-4000-8000-000000000001')),
  2,
  'el owner ve las dos solicitudes pendientes');
-- Se busca la entrada por su contenido y no por su posicion: dentro de una
-- misma transaccion `now()` no avanza, asi que las dos solicitudes comparten
-- `requested_at` y el orden entre ellas no esta definido.
select is(
  (select e -> 'roles_grantable'
     from jsonb_array_elements(
       public.identity_list_access_requests('e2000000-0000-4000-8000-000000000001')) e
    where e ->> 'requested_access' = 'rider'),
  '["rider"]'::jsonb,
  'sobre una solicitud de Rider, el unico rol otorgable es rider');

-- ══ 13. APROBAR ES UN SOLO ACTO ════════════════════════════════════════════
select is(
  public.identity_review_access_request(
    (select id from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-00000000000a'),
    'approve','staff') ->> 'granted_role',
  'staff',
  'el owner aprueba al solicitante de Panel como staff');

select is(
  (select role from public.business_members
    where business_id = 'e2000000-0000-4000-8000-000000000001'
      and user_id = 'e1000000-0000-4000-8000-00000000000a' and is_active),
  'staff',
  'la membresia nacio en la misma operacion');
select is(
  (select full_name from public.staff_profiles
    where business_id = 'e2000000-0000-4000-8000-000000000001'
      and user_id = 'e1000000-0000-4000-8000-00000000000a'),
  'Pedro Panel',
  'y el perfil de Panel tambien, con el nombre que la persona declaro');
select is(
  (select count(*) from public.identity_user_security
    where business_id = 'e2000000-0000-4000-8000-000000000001'
      and user_id = 'e1000000-0000-4000-8000-00000000000a'),
  1::bigint,
  'y su estado de seguridad, para que se lo pueda dar de baja despues');
select is(
  (select status from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-00000000000a'),
  'approved',
  'la solicitud quedo sellada como aprobada');
select is(
  (select count(*) from public.identity_audit_events
    where event_type = 'access_request_approved'
      and subject_user_id = 'e1000000-0000-4000-8000-00000000000a'),
  1::bigint,
  'y quedo escrito en la auditoria, una sola vez');

-- ══ 14. APROBAR DOS VECES NO APRUEBA DOS VECES ═════════════════════════════
select is(
  public.identity_review_access_request(
    (select id from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-00000000000a'),
    'approve','admin') ->> 'code',
  'already_decided',
  'la segunda aprobacion no vuelve a decidir');
select is(
  (select role from public.business_members where user_id = 'e1000000-0000-4000-8000-00000000000a'),
  'staff',
  'y sobre todo no le sube el rol a admin por reintentar');
select is(
  (select count(*) from public.identity_audit_events
    where event_type = 'access_request_approved'
      and subject_user_id = 'e1000000-0000-4000-8000-00000000000a'),
  1::bigint,
  'ni escribe un segundo evento de auditoria');

-- ══ 15. 'owner' NO ES UN ROL OTORGABLE POR ESTA VIA ════════════════════════
select pg_temp.as_applicant('e1000000-0000-4000-8000-00000000000b');
select public.request_business_access('e2000000-0000-4000-8000-000000000001','panel','Paula Panel','2996000011');
select pg_temp.as_member('e1000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001');
select is(
  public.identity_review_access_request(
    (select id from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-00000000000b'),
    'approve','owner') ->> 'code',
  'invalid_role',
  'ni siquiera el owner puede fabricar otro owner respondiendo un formulario');
select is(
  (select count(*) from public.business_members
    where user_id = 'e1000000-0000-4000-8000-00000000000b'),
  0::bigint,
  'y el intento no dejo membresia a medio hacer');

-- ══ 16. UN ADMIN NO FABRICA OTRO ADMIN ═════════════════════════════════════
select pg_temp.as_member('e1000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002');
select is(
  public.identity_review_access_request(
    (select id from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-00000000000b'),
    'approve','admin') ->> 'code',
  'role_above_actor',
  'un admin no puede otorgar admin: eso exige identity.roles.write');
select is(
  (select e -> 'roles_grantable'
     from jsonb_array_elements(
       public.identity_list_access_requests('e2000000-0000-4000-8000-000000000001','pending')) e
    where e ->> 'user_id' = 'e1000000-0000-4000-8000-00000000000b'),
  '["staff"]'::jsonb,
  'y su bandeja se lo dice: para el, el unico rol otorgable de Panel es staff');
select is(
  public.identity_review_access_request(
    (select id from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-00000000000b'),
    'approve','staff') ->> 'granted_role',
  'staff',
  'lo que si puede es aprobar como staff');

-- ══ 17. PEDIR REPARTIR NO TERMINA EN ENCARGADO ═════════════════════════════
select pg_temp.as_member('e1000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001');
select is(
  public.identity_review_access_request(
    (select id from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-00000000000d'),
    'approve','admin') ->> 'code',
  'invalid_role',
  'una solicitud de Rider no se puede aprobar como admin');

-- ══ 18. EL RIDER PENDIENTE NO VE LA OPERACION ══════════════════════════════
select pg_temp.as_applicant('e1000000-0000-4000-8000-00000000000d');
select throws_ok(
  $$ select public.get_rider_delivery_board() $$,
  '42501',
  null,
  'un Rider pendiente no puede pedir el tablero');
select throws_ok(
  $$ select public.publish_rider_location_fanout(
       -38.95, -68.06, 8.0, null, null, now(), 'pendingriderkey0001', false) $$,
  '42501',
  null,
  'ni publicar su GPS operativo');
select throws_ok(
  $$ select public.get_rider_queue('e2000000-0000-4000-8000-000000000001') $$,
  '42501',
  null,
  'ni ver la cola de pedidos del comercio');

set local role authenticated;
select is(
  (select count(*) from public.orders),
  0::bigint,
  'ni leer un solo pedido con el rol real de PostgREST');
reset role;

-- Las ofertas no las protege una policy: `authenticated` no tiene ni SELECT
-- sobre la tabla. Un Rider pendiente no puede ni intentarlo.
select ok(not has_table_privilege('authenticated','public.rider_order_offers','SELECT'),
  'y la tabla de ofertas no la lee authenticated en ningun caso');

-- ══ 19. APROBADO, ENTRA AL CONTRATO RIDER NORMAL ═══════════════════════════
select pg_temp.as_member('e1000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001');
select is(
  public.identity_review_access_request(
    (select id from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-00000000000d'),
    'approve') ->> 'granted_role',
  'rider',
  'sin pasar rol, una solicitud de Rider se aprueba como rider');
select is(
  (select contact_phone from public.rider_profiles
    where user_id = 'e1000000-0000-4000-8000-00000000000d'),
  '2996000020',
  'y su perfil de Rider queda con el telefono que declaro');

-- La app hace exactamente esto al entrar: registra la sesion y pide el tablero.
select pg_temp.as_member('e1000000-0000-4000-8000-00000000000d','e3000000-0000-4000-8000-00000000000d');
select is(
  public.identity_register_session(
    'e2000000-0000-4000-8000-000000000001','rider_android','Moto QA',null,'test') ->> 'role',
  'rider',
  'el Rider recien aprobado ya puede registrar su sesion');
select is(
  public.get_rider_delivery_board() -> 'orders',
  '[]'::jsonb,
  'y el tablero le contesta: vacio, pero le contesta');

-- ══ 20. RECHAZO ════════════════════════════════════════════════════════════
select pg_temp.as_applicant('e1000000-0000-4000-8000-00000000000f');
select public.request_business_access('e2000000-0000-4000-8000-000000000001','panel','Rita Rechazada','2996000015');

select pg_temp.as_member('e1000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001');
select is(
  public.identity_review_access_request(
    (select id from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-00000000000f'),
    'reject',null,'no lo conocemos') ->> 'code',
  'rejected',
  'el owner rechaza una solicitud');
select is(
  (select count(*) from public.business_members where user_id = 'e1000000-0000-4000-8000-00000000000f'),
  0::bigint,
  'y rechazar no crea ninguna membresia');

select pg_temp.as_applicant('e1000000-0000-4000-8000-00000000000f');
select is(
  public.get_my_business_access_request('e2000000-0000-4000-8000-000000000001') ->> 'status',
  'rejected',
  'la persona ve que fue rechazada');
select is(
  public.get_my_business_access_request('e2000000-0000-4000-8000-000000000001') -> 'decision_reason',
  null,
  'pero no ve el motivo interno que escribio el comercio');
select ok(
  (public.get_my_business_access_request('e2000000-0000-4000-8000-000000000001') ->> 'retry_at')::timestamptz > now(),
  'y sabe a partir de cuando puede volver a pedir');

select is(
  public.request_business_access(
    'e2000000-0000-4000-8000-000000000001','panel','Rita Rechazada','2996000015') ->> 'code',
  'retry_later',
  'volver a pedir antes de tiempo no entra: la espera es del servidor');
select is(
  (select count(*) from public.business_access_requests
    where user_id = 'e1000000-0000-4000-8000-00000000000f'),
  1::bigint,
  'y sigue habiendo una sola fila para esta persona');

-- Pasada la espera, la MISMA fila vuelve a pendiente y suma el intento.
update public.business_access_requests
   set decided_at = now() - interval '48 hours'
 where user_id = 'e1000000-0000-4000-8000-00000000000f';
select is(
  public.request_business_access(
    'e2000000-0000-4000-8000-000000000001','panel','Rita Rechazada','2996000015') ->> 'code',
  'pending',
  'pasada la espera si puede volver a pedir');
select is(
  (select attempt_count from public.business_access_requests
    where user_id = 'e1000000-0000-4000-8000-00000000000f'),
  2,
  'y el contador de intentos lo deja a la vista de quien decide');
select is(
  (select count(*) from public.business_access_requests
    where user_id = 'e1000000-0000-4000-8000-00000000000f'),
  1::bigint,
  'sin crear una fila nueva: insistir nunca hace crecer la tabla');

-- ══ 21. NADIE DECIDE SOBRE SI MISMO, NI EL OWNER ═══════════════════════════
-- El owner no puede llegar a tener una solicitud por la via normal, asi que la
-- fila se fabrica a mano para poder probar la regla en si.
insert into public.business_access_requests(business_id,user_id,requested_access,full_name)
values ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','panel','Owner Uno');
select pg_temp.as_member('e1000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001');
select is(
  public.identity_review_access_request(
    (select id from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-000000000001'),
    'approve','admin') ->> 'code',
  'self_review',
  'el owner tampoco decide sobre su propia solicitud');

-- ══ 22. APROBAR NO PISA UNA MEMBRESIA EXISTENTE ════════════════════════════
insert into public.business_access_requests(business_id,user_id,requested_access,full_name)
values ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000003','panel','Staff Uno');
select is(
  public.identity_review_access_request(
    (select id from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-000000000003'),
    'approve','admin') ->> 'code',
  'already_member',
  'una solicitud de alguien que ya entro por otra via no se aprueba');
select is(
  (select role from public.business_members where user_id = 'e1000000-0000-4000-8000-000000000003'),
  'staff',
  'y su rol no se toca: aprobar no es un ascenso encubierto');
select is(
  public.identity_review_access_request(
    (select id from public.business_access_requests where user_id = 'e1000000-0000-4000-8000-000000000003'),
    'reject') ->> 'code',
  'rejected',
  'lo que si se puede es rechazarla para vaciar la bandeja');

-- ══ 23. SUPERFICIE DE LAS FUNCIONES NUEVAS ═════════════════════════════════
select ok(not has_function_privilege('anon','public.request_business_access(uuid,text,text,text)','EXECUTE'),
  'anon no puede pedir acceso: hace falta una identidad');
select ok(not has_function_privilege('anon','public.get_my_business_access_request(uuid)','EXECUTE'),
  'anon no puede consultar solicitudes');
select ok(not has_function_privilege('anon','public.identity_review_access_request(uuid,text,text,text)','EXECUTE'),
  'anon no puede decidir');
select ok(not has_function_privilege('anon','public.identity_list_access_requests(uuid,text)','EXECUTE'),
  'anon no puede leer la bandeja');
select ok(not has_function_privilege('authenticated','public.business_access_request_retry_delay()','EXECUTE'),
  'ni siquiera authenticated ejecuta la funcion interna de la espera');
select ok(has_function_privilege('authenticated','public.request_business_access(uuid,text,text,text)','EXECUTE'),
  'authenticated si puede pedir: la autoridad esta adentro, no en el grant');
select ok(has_function_privilege('authenticated','public.identity_review_access_request(uuid,text,text,text)','EXECUTE'),
  'y puede llamar a la de decidir, que es la que comprueba el permiso real');

select * from finish();
rollback;
