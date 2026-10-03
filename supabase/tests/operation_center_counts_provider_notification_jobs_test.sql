-- TABA · EL CENTRO DE OPERACIÓN CUENTA LOS AVISOS DE MERCADO PAGO QUE LA COLA ABANDONÓ (20261003091000, DIAG-02)
--
-- Un aviso del proveedor se encola sin intento de pago. Abandonado por el worker, la alerta y la salud de la cola ya lo
-- veían (atribuido al negocio del vendedor que lo recibió); el contador `metrics.blocked_outboxes` del centro de
-- operación decía 0.
--
--   A  un aviso abandonado (o fallido) del vendedor de B suma en el contador de B
--   B  uno pendiente no suma, y A no ve el de B
--   C  la función sigue igual en todo lo demás: permisos, SECURITY DEFINER, search_path, y quién entra
--
-- Todo transaccional (rollback). Ids aleatorios y cuentas acotadas a ellos: corre igual sobre la base del gate.

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

create temporary table oc_ids (name text primary key, id uuid not null) on commit drop;
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from oc_ids where name = p_name $$;

-- Un comercio con su dueño (y su sesión del Panel) y el vendedor de Mercado Pago conectado en TEST.
create function pg_temp.negocio(p_key text) returns void language plpgsql as $$
declare
  v_business uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_slug text := 'opcenter-' || p_key || '-' || right(replace(v_business::text, '-', ''), 8);
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values (v_owner,'authenticated','authenticated',v_slug || '@example.invalid','',now(),'{}','{}',false,now(),now());
  insert into public.businesses (id, name, slug, status, is_active, currency_code, pickup_enabled, delivery_enabled,
    delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode)
  values (v_business, 'TABA centro ' || p_key, v_slug, 'open', true, 'ARS', true, false, 0.00, 0.00, 'off');
  insert into public.business_members (business_id, user_id, role, is_active) values (v_business, v_owner, 'owner', true);
  insert into public.identity_sessions (session_id, user_id, business_id, role_at_login, client)
  values (v_session, v_owner, v_business, 'owner', 'panel_web');
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_business,'test','collector-oc-' || v_slug,'app-oc-' || v_slug,'connected','ciphertext-only-local-fixture',now() + interval '2 days');
  insert into oc_ids values (p_key, v_business), (p_key || ':owner', v_owner), (p_key || ':session', v_session);
end $$;

-- Un aviso firmado para el vendedor del comercio: devuelve su trabajo en la cola (sin intento de pago).
create function pg_temp.aviso(p_key text, p_nombre text) returns uuid language plpgsql as $$
declare v_receipt uuid; v_job uuid;
begin
  v_receipt := (public.mp_record_seller_webhook('test', 'evt-opcenter-' || p_nombre || '-' || left(pg_temp.id(p_key)::text, 8), 'payment',
    'PAY-opcenter-' || p_nombre, true, 'rq-opcenter-' || p_nombre, encode(digest('opcenter-' || p_nombre || pg_temp.id(p_key)::text, 'sha256'), 'hex'),
    pg_temp.id(p_key)) ->> 'receipt_id')::uuid;
  select o.id into strict v_job from public.payment_outbox o where o.webhook_receipt_id = v_receipt;
  insert into oc_ids values (p_nombre, v_job);
  return v_job;
end $$;

-- El contador como lo ve el dueño del comercio en el Panel.
create function pg_temp.bloqueados(p_key text) returns integer language plpgsql as $$
declare v_center jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(p_key || ':owner'), 'role', 'authenticated',
    'session_id', pg_temp.id(p_key || ':session'))::text, true);
  v_center := public.get_production_operation_center(pg_temp.id(p_key));
  perform set_config('request.jwt.claims', '', true);
  return (v_center -> 'metrics' ->> 'blocked_outboxes')::integer;
end $$;

select pg_temp.negocio('a');
select pg_temp.negocio('b');
select pg_temp.aviso('b', 'muerto');
select pg_temp.aviso('b', 'fallido');
select pg_temp.aviso('b', 'pendiente');

-- ══ A · un aviso abandonado o fallido del vendedor de B suma en el contador de B ══
select is((select count(*)::integer from public.payment_outbox where id in (pg_temp.id('muerto'), pg_temp.id('fallido'), pg_temp.id('pendiente'))
             and payment_intent_id is null), 3, 'A: precondición: los tres avisos se encolaron sin intento de pago');
select is(pg_temp.bloqueados('b'), 0, 'A: con los tres avisos pendientes, nada bloqueado');
update public.payment_outbox set status = 'dead_letter', attempts = 8 where id = pg_temp.id('muerto');
select is(pg_temp.bloqueados('b'), 1, 'A: el aviso abandonado (dead_letter) cuenta como cola bloqueada en el negocio del vendedor');
update public.payment_outbox set status = 'failed' where id = pg_temp.id('fallido');
select is(pg_temp.bloqueados('b'), 2, 'A: el fallido también');

-- ══ B · uno pendiente no suma, y A no ve el de B ══
select is((select status from public.payment_outbox where id = pg_temp.id('pendiente')), 'pending', 'B: precondición: el tercero sigue pendiente');
select is(pg_temp.bloqueados('a'), 0, 'B: el centro de operación de A no cuenta los avisos del vendedor de B');

-- ══ C · lo demás no cambia ══
select is(
  (select p.proacl::text from pg_proc p where p.oid = 'public.get_production_operation_center(uuid)'::regprocedure)
    ~ 'authenticated=X', true, 'C: authenticated sigue pudiendo ejecutarla (quién entra lo decide has_business_role)');
select ok(
  (select p.prosecdef and not has_function_privilege('anon', p.oid, 'EXECUTE')
          and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=pg_catalog, public%')
     from pg_proc p where p.oid = 'public.get_production_operation_center(uuid)'::regprocedure),
  'C: SECURITY DEFINER, search_path fijado y sin EXECUTE para anon');
select throws_ok(
  format($q$select set_config('request.jwt.claims', %L, true); select public.get_production_operation_center(%L)$q$,
    json_build_object('sub', pg_temp.id('a:owner'), 'role', 'authenticated', 'session_id', pg_temp.id('a:session'))::text, pg_temp.id('b')),
  '42501', 'operador no autorizado', 'C: el dueño de A no entra al centro de operación de B');

select * from finish();
rollback;
