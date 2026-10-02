-- TABA · ACEPTAR UNA INVITACIÓN NO PISA LO QUE YA HAY
--
-- `identity_accept_invitation` hacía `on conflict do update set role, is_active = true`
-- sin mirar la membresía existente. Dos consecuencias medidas:
--   · una persona dada de baja y vuelta a invitar aceptaba, recibía `ok` y quedaba
--     trabada: `is_active = true` con `disabled_at` todavía puesto;
--   · el único dueño, con una invitación vieja como empleado, se degradaba solo y
--     dejaba al comercio sin dueño.
--
-- Acá se prueba el alta nueva (no cambió), la reactivación completa (banderas de baja
-- limpias, un solo perfil, sesión registrable), el rechazo sobre una membresía
-- vigente y el tope de último dueño.
--
-- Y lo que la reactivación NO puede hacer: una invitación emitida ANTES de la baja no
-- la deshace (el despedido no se rehabilita solo con el link viejo), y la invitación
-- de un encargado no reactiva a un dueño ni a otro encargado.
--
-- Todo transaccional: termina en rollback y no deja una fila.

begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('a9000000-0000-4000-8000-0000000000a1','authenticated','authenticated','inv-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9000000-0000-4000-8000-0000000000a2','authenticated','authenticated','inv-staff@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9000000-0000-4000-8000-0000000000a3','authenticated','authenticated','inv-nuevo@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9000000-0000-4000-8000-0000000000a4','authenticated','authenticated','inv-solo@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9000000-0000-4000-8000-0000000000a5','authenticated','authenticated','inv-admin@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9000000-0000-4000-8000-0000000000a6','authenticated','authenticated','inv-exdueno@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9000000-0000-4000-8000-0000000000a7','authenticated','authenticated','inv-trabado@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9000000-0000-4000-8000-0000000000a8','authenticated','authenticated','inv-despedido@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9000000-0000-4000-8000-0000000000a9','authenticated','authenticated','inv-exencargado@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9000000-0000-4000-8000-0000000000aa','authenticated','authenticated','inv-exempleado@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9000000-0000-4000-8000-0000000000ab','authenticated','authenticated','inv-huerfano@example.invalid','',now(),'{}','{}',now(),now()),
  ('a9000000-0000-4000-8000-0000000000ac','authenticated','authenticated','inv-encargado-uno@example.invalid','',now(),'{}','{}',now(),now());

insert into public.businesses(id,name,status,slug,is_active)
values
  ('b9000000-0000-4000-8000-0000000000a1','Invitaciones Uno','open','invitaciones-uno',true),
  ('b9000000-0000-4000-8000-0000000000a2','Invitaciones Dos','open','invitaciones-dos',true);

insert into public.business_members(business_id,user_id,role,is_active)
values
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000a1','owner',true),
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000a2','staff',true),
  -- un ex dueño ya dado de baja, con otro dueño vigente en el mismo comercio
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000a6','owner',false),
  -- una fila que quedó trabada por el defecto anterior: activa y con la baja puesta
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000a7','staff',true),
  -- un encargado vigente que entró por una solicitud de acceso, con una invitación
  -- anterior todavía pendiente (sección 7)
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000a8','admin',true),
  -- un ex encargado y un ex empleado ya dados de baja, y el encargado que los invita (sección 8)
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000a9','admin',false),
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000aa','staff',false),
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000ac','admin',true),
  -- comercio Dos: un único dueño y un encargado
  ('b9000000-0000-4000-8000-0000000000a2','a9000000-0000-4000-8000-0000000000a4','owner',true),
  ('b9000000-0000-4000-8000-0000000000a2','a9000000-0000-4000-8000-0000000000a5','admin',true);

insert into public.staff_profiles(business_id,user_id,full_name)
values
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000a2','Empleado Dos'),
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000a7','Empleado Trabado'),
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000a8','Encargado Despedido'),
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000a9','Ex Encargado'),
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000aa','Ex Empleado'),
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000ac','Encargado Uno');

insert into public.identity_user_security(business_id,user_id,disabled_at,disabled_reason,sessions_valid_from)
values
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000a6',now() - interval '2 days','traspaso de dueno',now() - interval '2 days'),
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000a7',now() - interval '1 day','baja anterior',now() - interval '1 day'),
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000a9',now() - interval '2 days','baja del encargado',now() - interval '2 days'),
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000aa',now() - interval '2 days','baja del empleado',now() - interval '2 days'),
  -- una ficha de seguridad sin membresía: la baja sobrevivió a la fila (sección 9)
  ('b9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000ab',now() - interval '1 day','baja sin membresia',now() - interval '1 day');

insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
values
  ('c9000000-0000-4000-8000-0000000000a1','a9000000-0000-4000-8000-0000000000a1','b9000000-0000-4000-8000-0000000000a1','owner','panel_web'),
  ('c9000000-0000-4000-8000-0000000000a5','a9000000-0000-4000-8000-0000000000a5','b9000000-0000-4000-8000-0000000000a2','admin','panel_web');

-- Las invitaciones se guardan como las deja `identity_create_invitation`: sólo el
-- hash del token. Los textos de acá abajo son los tokens de la prueba.
-- `p_created` deja fechar la invitación antes de una baja; `p_by_role` es el rol de
-- quien la mandó (el que guarda `identity_create_invitation`).
create function pg_temp.invitar(p_business uuid, p_email text, p_role text, p_name text, p_token text,
                                p_created timestamptz default now(), p_by_role text default 'owner')
returns void language sql as $$
  insert into public.identity_invitations(business_id, invited_email, invited_role, full_name, token_hash, invited_by, invited_by_role, created_at, expires_at)
  values (p_business, p_email, p_role, p_name, encode(extensions.digest(p_token, 'sha256'), 'hex'),
          case when p_by_role = 'admin' then 'a9000000-0000-4000-8000-0000000000ac'::uuid else 'a9000000-0000-4000-8000-0000000000a1'::uuid end,
          p_by_role, p_created, now() + interval '2 days');
$$;

create function pg_temp.pendiente(p_token text) returns boolean language sql as $$
  select i.accepted_at is null and i.revoked_at is null
    from public.identity_invitations i
   where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

create function pg_temp.como(p_user text, p_email text, p_session text default null) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'email', p_email, 'session_id', p_session,
      'iat', extract(epoch from clock_timestamp())::bigint + 60)::text, true)::void;
$$;

create function pg_temp.miembro(p_business text, p_user text) returns text language sql as $$
  select bm.role || ':' || bm.is_active::text || ':' || (us.disabled_at is not null)::text
    from public.business_members bm
    left join public.identity_user_security us on us.business_id = bm.business_id and us.user_id = bm.user_id
   where bm.business_id = p_business::uuid and bm.user_id = p_user::uuid;
$$;

-- ══ 1 · PRIVILEGIOS: NO CAMBIARON ═══════════════════════════════════════════
select ok(
  has_function_privilege('authenticated', 'public.identity_accept_invitation(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.identity_accept_invitation(text)', 'EXECUTE'),
  'aceptar una invitacion sigue siendo de authenticated y nunca de anon');

-- ══ 2 · EL ALTA NUEVA ES LA DE SIEMPRE ══════════════════════════════════════
select pg_temp.invitar('b9000000-0000-4000-8000-0000000000a1', 'inv-nuevo@example.invalid', 'rider', 'Repartidor Nuevo', 'token-alta-nueva-0001');
set local role authenticated;
select pg_temp.como('a9000000-0000-4000-8000-0000000000a3', 'inv-nuevo@example.invalid');
select is(
  public.identity_accept_invitation('token-alta-nueva-0001'),
  '{"ok": true, "business_id": "b9000000-0000-4000-8000-0000000000a1", "role": "rider"}'::jsonb,
  'una persona sin membresia acepta y queda con el rol invitado');
reset role;
select is(pg_temp.miembro('b9000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-0000000000a3'),
  'rider:true:false', 'membresia activa, sin baja');
select is(
  (select count(*)::integer from public.rider_profiles where user_id = 'a9000000-0000-4000-8000-0000000000a3'),
  1, 'con su perfil de repartidor');
select is(
  (select e.metadata - 'invitation_id' from public.identity_audit_events e
    where e.event_type = 'invitation_accepted' and e.subject_user_id = 'a9000000-0000-4000-8000-0000000000a3'),
  '{"role": "rider"}'::jsonb, 'y el evento de siempre, sin marca de reactivacion');
set local role authenticated;
select is(public.identity_accept_invitation('token-alta-nueva-0001') ->> 'code', 'invalid_token',
  'la invitacion es de un solo uso');
reset role;

-- ══ 3 · DADO DE BAJA Y VUELTO A INVITAR: QUEDA HABILITADO DE VERDAD ═════════
set local role authenticated;
select pg_temp.como('a9000000-0000-4000-8000-0000000000a1', 'inv-owner@example.invalid', 'c9000000-0000-4000-8000-0000000000a1');
select is(
  public.identity_set_member_active('b9000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-0000000000a2', false, 'baja de prueba') ->> 'ok',
  'true', 'el dueno da de baja al empleado');
reset role;
select is(pg_temp.miembro('b9000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-0000000000a2'),
  'staff:false:true', 'queda inactivo y con la baja anotada');

select pg_temp.invitar('b9000000-0000-4000-8000-0000000000a1', 'inv-staff@example.invalid', 'rider', 'Ahora Repartidor', 'token-reingreso-0002');
set local role authenticated;
select pg_temp.como('a9000000-0000-4000-8000-0000000000a2', 'inv-staff@example.invalid', 'c9000000-0000-4000-8000-0000000000a2');
select is(public.identity_accept_invitation('token-reingreso-0002') ->> 'role', 'rider',
  'vuelve invitado como repartidor y acepta');
select is(
  public.identity_register_session('b9000000-0000-4000-8000-0000000000a1', 'rider_android', 'Telefono de prueba', null, '1') ->> 'code',
  'registered', 'AUTHZ-09: ahora SI puede registrar su sesion (antes quedaba trabado en not_authorized)');
select is(public.has_business_role('b9000000-0000-4000-8000-0000000000a1', array['rider']), true,
  'y su rol nuevo autoriza');
reset role;
select is(pg_temp.miembro('b9000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-0000000000a2'),
  'rider:true:false', 'la baja quedo limpia');
select ok(
  (select us.disabled_by is null and us.disabled_reason is null from public.identity_user_security us
    where us.business_id = 'b9000000-0000-4000-8000-0000000000a1' and us.user_id = 'a9000000-0000-4000-8000-0000000000a2'),
  'sin quien ni por que: las tres columnas de la baja se limpian juntas');
select is(
  (select (select count(*) from public.staff_profiles p where p.user_id = 'a9000000-0000-4000-8000-0000000000a2')::text
       || ':' || (select count(*) from public.rider_profiles p where p.user_id = 'a9000000-0000-4000-8000-0000000000a2' and p.status = 'active')::text),
  '0:1', 'queda un solo perfil, el del rol nuevo');
select is(
  (select e.metadata - 'invitation_id' from public.identity_audit_events e
    where e.event_type = 'invitation_accepted' and e.subject_user_id = 'a9000000-0000-4000-8000-0000000000a2'),
  '{"role": "rider", "reactivated": true, "previous_role": "staff"}'::jsonb,
  'la auditoria dice que fue una reactivacion y desde que rol');

-- La persona reactivada se puede volver a administrar: sin limpiar el perfil viejo,
-- esta baja chocaba contra identity_assert_profile_role.
set local role authenticated;
select pg_temp.como('a9000000-0000-4000-8000-0000000000a1', 'inv-owner@example.invalid', 'c9000000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$select public.identity_set_member_active('b9000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-0000000000a2', false, 'segunda baja')$$,
  'el dueno puede volver a darlo de baja');
select lives_ok(
  $$select public.identity_set_member_active('b9000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-0000000000a2', true)$$,
  'y a reactivarlo por la via normal');
reset role;

-- ══ 4 · UNA FILA TRABADA POR EL DEFECTO ANTERIOR SE DESTRABA ════════════════
select is(pg_temp.miembro('b9000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-0000000000a7'),
  'staff:true:true', 'fixture: activa y con la baja puesta, como las dejaba el defecto');
select pg_temp.invitar('b9000000-0000-4000-8000-0000000000a1', 'inv-trabado@example.invalid', 'staff', 'Empleado Trabado', 'token-trabado-0003');
set local role authenticated;
select pg_temp.como('a9000000-0000-4000-8000-0000000000a7', 'inv-trabado@example.invalid', 'c9000000-0000-4000-8000-0000000000a7');
select is(public.identity_accept_invitation('token-trabado-0003') ->> 'ok', 'true',
  'no cuenta como vigente: aceptar la destraba');
select is(
  public.identity_register_session('b9000000-0000-4000-8000-0000000000a1', 'panel_web', 'Panel de prueba', null, '1') ->> 'code',
  'registered', 'y puede entrar');
reset role;

-- ══ 5 · UNA MEMBRESÍA VIGENTE NO SE PISA ════════════════════════════════════
-- El único dueño del comercio Dos con una invitación vieja como empleado.
select pg_temp.invitar('b9000000-0000-4000-8000-0000000000a2', 'inv-solo@example.invalid', 'staff', 'Dueno Unico', 'token-dueno-unico-0004');
set local role authenticated;
select pg_temp.como('a9000000-0000-4000-8000-0000000000a4', 'inv-solo@example.invalid');
select is(public.identity_accept_invitation('token-dueno-unico-0004'), '{"ok": false, "code": "already_member"}'::jsonb,
  'AUTHZ-09: el dueno vigente no puede aceptar una invitacion como empleado');
reset role;
select is(pg_temp.miembro('b9000000-0000-4000-8000-0000000000a2', 'a9000000-0000-4000-8000-0000000000a4'),
  'owner:true:false', 'sigue siendo dueno');
select is(public.identity_count_active_owners('b9000000-0000-4000-8000-0000000000a2'), 1,
  'y el comercio conserva a su dueno');
select ok(
  (select i.accepted_at is null and i.revoked_at is null from public.identity_invitations i
    where i.token_hash = encode(extensions.digest('token-dueno-unico-0004', 'sha256'), 'hex')),
  'la invitacion rechazada no se consume: la retira quien la mando, o vence');

-- Un encargado vigente tampoco sube de rol aceptando una invitación.
select pg_temp.invitar('b9000000-0000-4000-8000-0000000000a2', 'inv-admin@example.invalid', 'owner', 'Encargado', 'token-encargado-0005');
set local role authenticated;
select pg_temp.como('a9000000-0000-4000-8000-0000000000a5', 'inv-admin@example.invalid', 'c9000000-0000-4000-8000-0000000000a5');
select is(public.identity_accept_invitation('token-encargado-0005') ->> 'code', 'already_member',
  'una invitacion no es la via para cambiarle el rol a quien ya esta adentro');
reset role;
select is(pg_temp.miembro('b9000000-0000-4000-8000-0000000000a2', 'a9000000-0000-4000-8000-0000000000a5'),
  'admin:true:false', 'el encargado sigue siendo encargado');

-- ══ 6 · EL TOPE DE ÚLTIMO DUEÑO ═════════════════════════════════════════════
-- El dueño del comercio Dos queda dado de baja por una tarea de plataforma (la RPC
-- no deja: es el último). Reinvitado como empleado, aceptar borraría el único
-- registro de quién es el dueño.
update public.business_members set is_active = false
 where business_id = 'b9000000-0000-4000-8000-0000000000a2' and user_id = 'a9000000-0000-4000-8000-0000000000a4';
set local role authenticated;
select pg_temp.como('a9000000-0000-4000-8000-0000000000a4', 'inv-solo@example.invalid');
select is(public.identity_accept_invitation('token-dueno-unico-0004'), '{"ok": false, "code": "last_owner"}'::jsonb,
  'sin otro dueno vigente, el dueno dado de baja no se reactiva con un rol menor');
reset role;
select is(pg_temp.miembro('b9000000-0000-4000-8000-0000000000a2', 'a9000000-0000-4000-8000-0000000000a4'),
  'owner:false:false', 'su fila conserva el rol de dueno');

-- Con otro dueño vigente, un ex dueño sí vuelve como empleado (comercio Uno).
select pg_temp.invitar('b9000000-0000-4000-8000-0000000000a1', 'inv-exdueno@example.invalid', 'staff', 'Ex Dueno', 'token-ex-dueno-0006');
set local role authenticated;
select pg_temp.como('a9000000-0000-4000-8000-0000000000a6', 'inv-exdueno@example.invalid');
select is(public.identity_accept_invitation('token-ex-dueno-0006') ->> 'role', 'staff',
  'habiendo otro dueno vigente, el ex dueno vuelve como empleado');
reset role;
select is(pg_temp.miembro('b9000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-0000000000a6'),
  'staff:true:false', 'activo, sin baja y con el rol invitado');
select is(public.identity_count_active_owners('b9000000-0000-4000-8000-0000000000a1'), 1,
  'y el comercio Uno sigue con su dueno');

-- ══ 7 · UNA BAJA DEJA SIN EFECTO LA INVITACIÓN QUE YA ESTABA EMITIDA ════════
-- La persona tenía una invitación pendiente como encargado y entró por otra vía (una
-- solicitud de acceso crea la membresía y no toca las invitaciones). El dueño la da
-- de baja; la baja no retira la invitación. Con el link viejo no vuelve.
select pg_temp.invitar('b9000000-0000-4000-8000-0000000000a1', 'inv-despedido@example.invalid', 'admin', 'Encargado Despedido',
  'token-anterior-a-la-baja-0007', now() - interval '3 days');
set local role authenticated;
select pg_temp.como('a9000000-0000-4000-8000-0000000000a1', 'inv-owner@example.invalid', 'c9000000-0000-4000-8000-0000000000a1');
select is(
  public.identity_set_member_active('b9000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-0000000000a8', false, 'despedido') ->> 'ok',
  'true', 'el dueno da de baja al encargado que tenia una invitacion pendiente');
select pg_temp.como('a9000000-0000-4000-8000-0000000000a8', 'inv-despedido@example.invalid', 'c9000000-0000-4000-8000-0000000000a8');
select is(public.identity_accept_invitation('token-anterior-a-la-baja-0007'), '{"ok": false, "code": "account_disabled"}'::jsonb,
  'la invitacion emitida ANTES de la baja no rehabilita al despedido');
select is(
  public.identity_register_session('b9000000-0000-4000-8000-0000000000a1', 'panel_web', 'Panel de prueba', null, '1') ->> 'code',
  'not_authorized', 'y sigue sin poder registrar una sesion');
select is(public.identity_member_role('b9000000-0000-4000-8000-0000000000a1'), null,
  'ni tiene rol en el comercio');
reset role;
select is(pg_temp.miembro('b9000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-0000000000a8'),
  'admin:false:true', 'la baja sigue puesta');
select is(pg_temp.pendiente('token-anterior-a-la-baja-0007'), true,
  'la invitacion no se consume');
select is(
  (select count(*)::integer from public.identity_audit_events e
    where e.event_type = 'invitation_accepted' and e.subject_user_id = 'a9000000-0000-4000-8000-0000000000a8'),
  0, 'ni queda un evento de aceptacion');

-- Volver a habilitarlo es un acto nuevo del dueño: retira la invitación vieja y manda
-- otra, que nace después de la baja.
-- El id se toma acá: `authenticated` no lee la tabla de invitaciones.
select set_config('test.invitacion_vieja', (select i.id::text from public.identity_invitations i
  where i.token_hash = encode(extensions.digest('token-anterior-a-la-baja-0007', 'sha256'), 'hex')), true);
set local role authenticated;
select pg_temp.como('a9000000-0000-4000-8000-0000000000a1', 'inv-owner@example.invalid', 'c9000000-0000-4000-8000-0000000000a1');
select is(
  public.identity_revoke_invitation(current_setting('test.invitacion_vieja')::uuid) ->> 'ok',
  'true', 'el dueno retira la invitacion vieja');
reset role;
select pg_temp.invitar('b9000000-0000-4000-8000-0000000000a1', 'inv-despedido@example.invalid', 'staff', 'Vuelve Como Empleado', 'token-posterior-a-la-baja-0008');
set local role authenticated;
select pg_temp.como('a9000000-0000-4000-8000-0000000000a8', 'inv-despedido@example.invalid', 'c9000000-0000-4000-8000-0000000000a8');
select is(public.identity_accept_invitation('token-posterior-a-la-baja-0008') ->> 'role', 'staff',
  'una invitacion emitida DESPUES de la baja si lo reactiva, con el rol nuevo');
select is(
  public.identity_register_session('b9000000-0000-4000-8000-0000000000a1', 'panel_web', 'Panel de prueba', null, '1') ->> 'code',
  'registered', 'y ahora puede entrar');
reset role;
select is(pg_temp.miembro('b9000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-0000000000a8'),
  'staff:true:false', 'activo, sin baja y como empleado');

-- ══ 8 · LA INVITACIÓN DE UN ENCARGADO NO REACTIVA A LA CONDUCCIÓN ═══════════
-- Un encargado no puede habilitar a un dueño ni a otro encargado con
-- identity_set_member_active; su invitación tampoco, ni con un rol menor.
select pg_temp.invitar('b9000000-0000-4000-8000-0000000000a1', 'inv-exencargado@example.invalid', 'staff', 'Ex Encargado',
  'token-de-encargado-0009', now(), 'admin');
set local role authenticated;
select pg_temp.como('a9000000-0000-4000-8000-0000000000a9', 'inv-exencargado@example.invalid');
select is(public.identity_accept_invitation('token-de-encargado-0009'), '{"ok": false, "code": "account_disabled"}'::jsonb,
  'un ex encargado dado de baja no vuelve con la invitacion de otro encargado');
reset role;
select is(pg_temp.miembro('b9000000-0000-4000-8000-0000000000a1', 'a9000000-0000-4000-8000-0000000000a9'),
  'admin:false:true', 'su baja sigue puesta');

-- A un empleado dado de baja sí: es a quien un encargado administra.
select pg_temp.invitar('b9000000-0000-4000-8000-0000000000a1', 'inv-exempleado@example.invalid', 'rider', 'Ex Empleado',
  'token-de-encargado-0010', now(), 'admin');
set local role authenticated;
select pg_temp.como('a9000000-0000-4000-8000-0000000000aa', 'inv-exempleado@example.invalid');
select is(public.identity_accept_invitation('token-de-encargado-0010') ->> 'role', 'rider',
  'un ex empleado si vuelve con la invitacion de un encargado');
reset role;

-- ══ 9 · LA BAJA VALE AUNQUE LA MEMBRESÍA YA NO ESTÉ ═════════════════════════
-- La ficha de seguridad no cuelga de la membresía. Si quedó una baja anotada y la
-- fila de membresía ya no existe, la invitación anterior a esa baja tampoco sirve.
select pg_temp.invitar('b9000000-0000-4000-8000-0000000000a1', 'inv-huerfano@example.invalid', 'staff', 'Sin Membresia',
  'token-baja-sin-membresia-0011', now() - interval '3 days');
set local role authenticated;
select pg_temp.como('a9000000-0000-4000-8000-0000000000ab', 'inv-huerfano@example.invalid');
select is(public.identity_accept_invitation('token-baja-sin-membresia-0011') ->> 'code', 'account_disabled',
  'la invitacion anterior a una baja no crea una membresia nueva');
reset role;
select is(
  (select count(*)::integer from public.business_members bm where bm.user_id = 'a9000000-0000-4000-8000-0000000000ab'),
  0, 'no se creo ninguna membresia');

select * from finish();
rollback;
