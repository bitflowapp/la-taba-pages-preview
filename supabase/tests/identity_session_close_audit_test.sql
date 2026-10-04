-- TABA · CERRAR LA PROPIA SESIÓN NO ESCRIBE EN LA AUDITORÍA DE OTRO
--
-- `identity_close_own_session(p_business_id)` anotaba `session_closed` en el comercio
-- que el llamador nombraba, hubiera o no una sesión que cerrar. Cualquier
-- `authenticated` —incluida la identidad anónima con la que compra un cliente— podía
-- llenar la auditoría de un comercio ajeno.
--
-- Acá se prueba que:
--   · sin una sesión de equipo registrada no se escribe nada, en ningún comercio;
--   · cuando sí se cierra una, el evento va al comercio DE ESA SESIÓN aunque el
--     parámetro diga otro;
--   · repetir la llamada no agrega eventos;
--   · el contrato de respuesta y los privilegios no cambiaron.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- ── Fixture: dos comercios; la víctima es el B ─────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
values
  ('a3000000-0000-4000-8000-0000000000a1','authenticated','authenticated','cierre-owner-a@example.invalid','',now(),'{}','{}',false,now(),now()),
  ('a3000000-0000-4000-8000-0000000000a2','authenticated','authenticated','cierre-staff-a@example.invalid','',now(),'{}','{}',false,now(),now()),
  ('a3000000-0000-4000-8000-0000000000a3','authenticated','authenticated','cierre-owner-b@example.invalid','',now(),'{}','{}',false,now(),now()),
  ('a3000000-0000-4000-8000-0000000000a4','authenticated','authenticated',null,'',null,'{}','{}',true,now(),now()),
  ('a3000000-0000-4000-8000-0000000000a5','authenticated','authenticated','cierre-ajeno@example.invalid','',now(),'{}','{}',false,now(),now());

insert into public.businesses(id,name,status,slug,is_active)
values
  ('b3000000-0000-4000-8000-0000000000a1','Cierre A','open','cierre-sesion-a',true),
  ('b3000000-0000-4000-8000-0000000000b1','Cierre B (victima)','open','cierre-sesion-b',true);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('b3000000-0000-4000-8000-0000000000a1','a3000000-0000-4000-8000-0000000000a1','owner',true),
  ('b3000000-0000-4000-8000-0000000000a1','a3000000-0000-4000-8000-0000000000a2','staff',true),
  ('b3000000-0000-4000-8000-0000000000b1','a3000000-0000-4000-8000-0000000000a3','owner',true);

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('c3000000-0000-4000-8000-0000000000a1','a3000000-0000-4000-8000-0000000000a1','b3000000-0000-4000-8000-0000000000a1','owner','panel_web'),
  ('c3000000-0000-4000-8000-0000000000a2','a3000000-0000-4000-8000-0000000000a2','b3000000-0000-4000-8000-0000000000a1','staff','panel_web');

create function pg_temp.eventos(p_business uuid) returns integer language sql as $$
  select count(*)::integer from public.identity_audit_events e
   where e.business_id = p_business and e.event_type = 'session_closed';
$$;

-- ══ 1 · PRIVILEGIOS: NO CAMBIARON ═══════════════════════════════════════════
select ok(
  has_function_privilege('authenticated', 'public.identity_close_own_session(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.identity_close_own_session(uuid)', 'EXECUTE'),
  'cerrar la propia sesion sigue siendo de authenticated y nunca de anon');

-- ══ 2 · UN CLIENTE ANÓNIMO CONTRA UN COMERCIO AJENO ═════════════════════════
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a3000000-0000-4000-8000-0000000000a4","role":"authenticated","is_anonymous":true,"session_id":"c3000000-0000-4000-8000-0000000000a4"}', true);
select is(
  (select count(*)::integer from generate_series(1, 5) g
    where public.identity_close_own_session('b3000000-0000-4000-8000-0000000000b1') = '{"ok": true, "code": "closed"}'::jsonb),
  5, 'el cliente anonimo recibe la misma respuesta de siempre las cinco veces');
reset role;
select is(pg_temp.eventos('b3000000-0000-4000-8000-0000000000b1'), 0,
  'AUTHZ-03: cinco llamadas de un cliente anonimo no dejan ni una fila en la auditoria del comercio ajeno');
select is(
  (select count(*)::integer from public.identity_audit_events e
    where e.actor_user_id = 'a3000000-0000-4000-8000-0000000000a4'),
  0, 'ni en ningun otro lado: no tenia una sesion de equipo que cerrar');

-- ══ 3 · UNA CUENTA CON CORREO, SIN MEMBRESÍA ════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a3000000-0000-4000-8000-0000000000a5","role":"authenticated","session_id":"c3000000-0000-4000-8000-0000000000a5"}', true);
select is(public.identity_close_own_session('b3000000-0000-4000-8000-0000000000b1') ->> 'code', 'closed',
  'una cuenta sin membresia tambien recibe closed');
reset role;
select is(pg_temp.eventos('b3000000-0000-4000-8000-0000000000b1'), 0,
  'y tampoco escribe en la auditoria del comercio que nombro');

-- ══ 4 · UN EMPLEADO DEL COMERCIO A NOMBRA AL COMERCIO B ═════════════════════
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a3000000-0000-4000-8000-0000000000a2","role":"authenticated","session_id":"c3000000-0000-4000-8000-0000000000a2"}', true);
select is(public.has_business_role('b3000000-0000-4000-8000-0000000000a1', array['staff']), true,
  'antes de cerrar, el empleado tiene su rol');
select is(public.identity_close_own_session('b3000000-0000-4000-8000-0000000000b1') ->> 'code', 'closed',
  'cierra su sesion nombrando al comercio ajeno');
reset role;
select is(pg_temp.eventos('b3000000-0000-4000-8000-0000000000b1'), 0,
  'el comercio nombrado no recibe el evento');
select is(pg_temp.eventos('b3000000-0000-4000-8000-0000000000a1'), 1,
  'el evento queda en el comercio de la sesion que se cerro');
select is(
  (select e.actor_role || ':' || e.session_id::text from public.identity_audit_events e
    where e.business_id = 'b3000000-0000-4000-8000-0000000000a1' and e.event_type = 'session_closed'),
  'staff:c3000000-0000-4000-8000-0000000000a2',
  'con el rol real de quien cerro y el id de la sesion');
select is(
  (select s.revoked_reason from public.identity_sessions s where s.session_id = 'c3000000-0000-4000-8000-0000000000a2'),
  'self_logout', 'la sesion quedo cerrada por su dueno');

-- ══ 5 · REPETIR NO SUMA ═════════════════════════════════════════════════════
set local role authenticated;
select is(
  (select count(*)::integer from generate_series(1, 3) g
    where public.identity_close_own_session('b3000000-0000-4000-8000-0000000000a1') ->> 'code' = 'closed'),
  3, 'volver a cerrar una sesion ya cerrada responde closed');
select is(public.has_business_role('b3000000-0000-4000-8000-0000000000a1', array['owner', 'admin', 'staff', 'rider']), false,
  'y esa sesion ya no autoriza nada');
reset role;
select is(pg_temp.eventos('b3000000-0000-4000-8000-0000000000a1'), 1,
  'la auditoria sigue con un solo evento: no hay forma de inflarla repitiendo');

-- ══ 6 · EL CAMINO NORMAL ════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a3000000-0000-4000-8000-0000000000a1","role":"authenticated","session_id":"c3000000-0000-4000-8000-0000000000a1"}', true);
select is(public.identity_close_own_session('b3000000-0000-4000-8000-0000000000a1'), '{"ok": true, "code": "closed"}'::jsonb,
  'el dueno cierra su sesion en su comercio');
reset role;
select is(
  (select count(*)::integer from public.identity_audit_events e
    where e.business_id = 'b3000000-0000-4000-8000-0000000000a1' and e.event_type = 'session_closed'
      and e.actor_role = 'owner' and e.actor_user_id = 'a3000000-0000-4000-8000-0000000000a1'
      and e.subject_user_id = e.actor_user_id and e.session_id = 'c3000000-0000-4000-8000-0000000000a1'),
  1, 'y deja exactamente un evento con actor, rol y sesion');

-- ══ 7 · SIN SESIÓN EN EL TOKEN, Y SIN TOKEN ═════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a3000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select is(public.identity_close_own_session('b3000000-0000-4000-8000-0000000000b1') ->> 'code', 'closed',
  'un token sin session_id no tiene nada que cerrar y responde closed');
select set_config('request.jwt.claims', '', true);
select is(public.identity_close_own_session('b3000000-0000-4000-8000-0000000000b1'), '{"ok": false, "code": "not_authorized"}'::jsonb,
  'sin identidad no hay cierre');
reset role;
select is(
  (select count(*)::integer from public.identity_audit_events e where e.event_type = 'session_closed'
    and e.business_id in ('b3000000-0000-4000-8000-0000000000a1', 'b3000000-0000-4000-8000-0000000000b1')),
  2, 'en toda la prueba hubo dos cierres reales y hay dos eventos');

select * from finish();
rollback;
