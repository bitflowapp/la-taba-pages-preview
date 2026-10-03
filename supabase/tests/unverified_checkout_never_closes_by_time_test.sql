-- TABA · UN CHECKOUT QUE NADIE VERIFICÓ NO SE CIERRA POR TIEMPO (20261003090000)
--
-- Lo que pasaba: un checkout que llegó a Mercado Pago, venció y nunca tuvo una respuesta que
-- probara que no hubo pago (vacíos no concluyentes, o ninguna sonda respondida) tenía su alerta
-- CHECKOUT_PROVIDER_UNVERIFIED abierta a las 47 horas y RESUELTA POR EL SISTEMA a las 49
-- («condición ausente»), y el barrido dejaba de preguntar. Un posible cobro sin pedido quedaba
-- cerrado en silencio.
--
--   A  dentro de las 48 horas nada cambia
--   B  pasadas las 48 horas la alerta sigue abierta (vacíos no concluyentes o ninguno)
--   C  la marca de agua: lo anterior a ella no se resucita; sin la fila, se vigila todo
--   D  la cierra una prueba: un vacío concluyente, o el pago que trae la sonda
--   E  la cierra una persona: dueño o encargado con nota; la de un empleado no cuenta
--   F  el barrido sigue preguntando una vez por día, hasta los 30 días
--   G  permisos, envoltorio de la frontera y el índice
--
-- No depende de la hora: los momentos de sesiones, vacíos y trabajos se escriben a mano. Todo
-- transaccional (rollback). Ids aleatorios y cuentas acotadas a ellos: corre igual sobre la
-- base del gate, que nunca está vacía.

begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table uv_ids (name text primary key, id uuid not null) on commit drop;
create temporary table uv_actores (actor text primary key, claims text not null) on commit drop;

create function pg_temp.id(p_name text) returns uuid language sql stable as $$
  select id from uv_ids where name = p_name
$$;

create function pg_temp.usuario(p_name text, p_anonymous boolean) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values (v_id,'authenticated','authenticated',
          case when p_anonymous then null else 'uv-' || left(v_id::text, 8) || '@example.invalid' end,
          '',case when p_anonymous then null else now() end,'{}','{}',p_anonymous,now(),now());
  insert into uv_ids values (p_name, v_id);
  return v_id;
end $$;

-- Un comercio abierto, de retiro, con un producto, el vendedor conectado por OAuth y su equipo
-- (dueño, encargado y empleado, cada uno con su sesión del Panel).
create function pg_temp.negocio(p_key text) returns void language plpgsql as $$
declare
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_owner uuid := pg_temp.usuario(p_key || ':owner', false);
  v_admin uuid := pg_temp.usuario(p_key || ':admin', false);
  v_staff uuid := pg_temp.usuario(p_key || ':staff', false);
  v_slug text := 'unverified-' || p_key || '-' || right(replace(v_business::text, '-', ''), 8);
  v_member record;
begin
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode, alcohol_sales_enabled
  ) values (
    v_business, 'TABA sin verificar ' || p_key, v_slug, 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off', false
  );
  insert into public.business_members (business_id, user_id, role, is_active)
  values (v_business, v_owner, 'owner', true), (v_business, v_admin, 'admin', true), (v_business, v_staff, 'staff', true);
  for v_member in
    select * from (values ('owner', v_owner), ('admin', v_admin), ('staff', v_staff)) as t(role, user_id)
  loop
    insert into public.identity_sessions(session_id, user_id, business_id, role_at_login, client)
    values (gen_random_uuid(), v_member.user_id, v_business, v_member.role, 'panel_web');
    insert into uv_actores
    select p_key || ':' || v_member.role,
           json_build_object('sub', v_member.user_id, 'role', 'authenticated', 'session_id', s.session_id)::text
      from public.identity_sessions s
     where s.user_id = v_member.user_id and s.business_id = v_business;
  end loop;
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,minimum_age,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_product,v_business,'Lata ' || p_key,'Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    50,true,true,false,null,'{}',true,now(),v_owner,
    v_slug || '-sku',v_slug || '-sku','commercial',1);
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'collector-uv-' || v_slug, 'app-uv-' || v_slug, clock_timestamp(), clock_timestamp());
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_business,'test','collector-uv-' || v_slug,'app-uv-' || v_slug,'connected','ciphertext-only-local-fixture',now() + interval '2 days');
  insert into uv_ids values (p_key || ':business', v_business), (p_key || ':product', v_product);
end $$;

-- Un checkout con su preferencia creada por el camino de la función Edge (V2), ya vencido:
-- creado hace p_created_ago, vencido 20 minutos después, intent «expired» por el barrido.
create function pg_temp.checkout(p_name text, p_business_key text, p_created_ago interval) returns uuid language plpgsql as $$
declare
  v_customer uuid := pg_temp.usuario(p_name || ':customer', true);
  v_business uuid := pg_temp.id(p_business_key || ':business');
  v_session uuid;
  v_prepare jsonb;
  v_attempt uuid;
begin
  v_session := (public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', v_business,
    'client_request_id', 'uv_' || md5(p_name || v_business::text),
    'items', jsonb_build_array(jsonb_build_object('product_id', pg_temp.id(p_business_key || ':product'), 'quantity', 1)),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Cliente Prueba', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago')) ->> 'checkout_session_id')::uuid;
  v_prepare := public.prepare_mercadopago_preference_v2(v_session, v_customer, false);
  v_attempt := (v_prepare ->> 'payment_attempt_id')::uuid;
  perform public.record_mercadopago_preference_created_v2(
    v_business, 'test', v_session, v_customer, v_attempt,
    public.get_mercadopago_payment_authority_v2(v_business, 'test', v_session, v_customer, v_attempt) ->> 'authority_version',
    'PREF-' || p_name || '-' || left(v_session::text, 8),
    'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=' || p_name,
    'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=' || p_name,
    encode(digest('pref-' || p_name || v_session::text, 'sha256'), 'hex'), 'req-' || p_name || '-' || left(v_session::text, 8));
  update public.checkout_sessions
     set created_at = clock_timestamp() - p_created_ago,
         expires_at = clock_timestamp() - p_created_ago + interval '20 minutes'
   where id = v_session;
  insert into uv_ids values (p_name, v_session);
  insert into uv_ids select p_name || ':intent', pi.id from public.payment_intents pi where pi.checkout_session_id = v_session;
  return v_session;
end $$;

create function pg_temp.vacios(p_intent uuid, p_n integer, p_last timestamptz, p_conclusive boolean) returns void language plpgsql as $$
begin
  delete from public.payment_events where payment_intent_id = p_intent and event_type = 'payment.provider_probe_empty';
  for g in 1 .. p_n loop
    insert into public.payment_events (payment_intent_id, event_type, details, server_recorded_at)
    values (p_intent, 'payment.provider_probe_empty',
            jsonb_build_object('source', 'provider_truth_sweep', 'conclusive', p_conclusive),
            p_last - make_interval(mins => 3 * (p_n - g)));
  end loop;
end $$;

create function pg_temp.alerta(p_intent text) returns text language sql stable as $$
  select a.status from public.operational_alerts a
   where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id(p_intent)
$$;

create function pg_temp.reconciliar(p_business_key text) returns integer language sql as $$
  select public.reconcile_operational_alerts_for_business(pg_temp.id(p_business_key || ':business'))
$$;

create function pg_temp.sonda_pendiente(p_intent text) returns integer language sql stable as $$
  select count(*)::integer from public.payment_outbox po
   where po.payment_intent_id = pg_temp.id(p_intent) and po.topic = 'payment_reconcile'
     and po.status in ('pending', 'claimed', 'processing', 'retry_wait')
$$;

-- Resuelve la alerta del cobro con la sesión de p_actor, como el Panel.
create function pg_temp.resolver(p_actor text, p_intent text) returns text language plpgsql as $$
declare
  v_out jsonb;
  v_alert uuid := (select a.id from public.operational_alerts a
                    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id(p_intent));
begin
  perform set_config('request.jwt.claims', (select claims from uv_actores where actor = p_actor), true);
  set local role authenticated;
  v_out := public.transition_operational_alert(v_alert, 'resolved', 'Busqué la referencia en Mercado Pago: no hay ningún pago.');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_out ->> 'status';
end $$;

-- La migración se aplicó hace 10 días: los checkouts de abajo nacieron con la garantía vigente.
update private.payment_safety_watermarks set since = clock_timestamp() - interval '10 days'
 where name = 'unverified_checkout_watch_since';

select pg_temp.negocio('a');
select pg_temp.negocio('b');
-- a: dentro de la ventana. b: pasada la ventana.
select pg_temp.checkout('a1', 'a', interval '47 hours');   -- vacíos no concluyentes
select pg_temp.checkout('a2', 'a', interval '47 hours');   -- un vacío concluyente
select pg_temp.checkout('b1', 'b', interval '49 hours');   -- vacíos no concluyentes (el vendedor se reconectó)
select pg_temp.checkout('b2', 'b', interval '49 hours');   -- ninguna sonda respondió
select pg_temp.checkout('b3', 'b', interval '49 hours');   -- llega un vacío concluyente
select pg_temp.checkout('b4', 'b', interval '49 hours');   -- la sonda tardía trae el pago
select pg_temp.checkout('b5', 'b', interval '49 hours');   -- lo resuelve el empleado y después el dueño
select pg_temp.checkout('b6', 'b', interval '49 hours');   -- lo resuelve el encargado
select pg_temp.checkout('b7', 'b', interval '12 days');    -- anterior a la marca de agua
select pg_temp.checkout('b8', 'b', interval '31 days');    -- más de 30 días (con la marca más vieja)
select public.sweep_expired_checkout_sessions();
select pg_temp.vacios(pg_temp.id('a1:intent'), 20, clock_timestamp() - interval '40 minutes', false);
select pg_temp.vacios(pg_temp.id('a2:intent'), 1, clock_timestamp() - interval '40 minutes', true);
select pg_temp.vacios(pg_temp.id('b1:intent'), 20, clock_timestamp() - interval '25 hours', false);
select pg_temp.vacios(pg_temp.id('b3:intent'), 20, clock_timestamp() - interval '25 hours', false);
select pg_temp.vacios(pg_temp.id('b5:intent'), 20, clock_timestamp() - interval '25 hours', false);
select pg_temp.vacios(pg_temp.id('b6:intent'), 20, clock_timestamp() - interval '25 hours', false);

select is(
  (select count(*)::integer from public.payment_intents pi
    where pi.id in (select id from uv_ids where name like '%:intent') and pi.internal_status = 'expired'),
  10, 'precondición: los diez checkouts vencieron y su intent quedó «expired»');

-- ══════════════════════════════════════════════════════════════════════════
--  A · dentro de las 48 horas nada cambia
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.reconciliar('a');
select is(pg_temp.alerta('a1:intent'), 'open', 'A: a las 47 horas con vacíos no concluyentes, la alerta está abierta');
select is(pg_temp.alerta('a2:intent'), null, 'A: con un vacío concluyente calla, como antes');
select is(
  (select (a.evidence ->> 'probe_window_closed')::boolean from public.operational_alerts a
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('a1:intent')),
  false, 'A: la evidencia dice que la ventana de sondas sigue abierta');

-- ══════════════════════════════════════════════════════════════════════════
--  B · pasadas las 48 horas la alerta sigue abierta
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b1:intent'), 'open', 'B: a las 49 horas, con sólo vacíos no concluyentes, la alerta sigue abierta');
select is(pg_temp.alerta('b2:intent'), 'open', 'B: a las 49 horas, sin ninguna sonda respondida, también');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b1:intent'), 'open', 'B: y una segunda reconciliación no la da por «condición ausente»');
select is(
  (select (a.evidence ->> 'probe_window_closed')::boolean from public.operational_alerts a
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('b1:intent')),
  true, 'B: la evidencia dice que la ventana de sondas ya cerró');
select is(
  (select a.severity from public.operational_alerts a
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('b1:intent')),
  'CRITICAL', 'B: sigue siendo crítica');
select ok(
  (select a.required_action like '%Si no existe, el dueño o un encargado la da por resuelta con una nota: no se cierra sola.'
     from public.operational_alerts a
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('b1:intent')),
  'B: la acción requerida dice cómo se cierra');
select is(
  (select count(*)::integer from public.operational_alert_events e
     join public.operational_alerts a on a.id = e.alert_id
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('b1:intent')
      and e.event_type = 'resolved'),
  0, 'B: no quedó ningún evento de cierre automático');

-- ══════════════════════════════════════════════════════════════════════════
--  C · la marca de agua
-- ══════════════════════════════════════════════════════════════════════════
select is(pg_temp.alerta('b7:intent'), null,
  'C: un checkout anterior a la marca de agua no se resucita como alerta (lo muestra la conciliación)');
select ok(
  (select w.since <= clock_timestamp() - interval '9 days' from private.payment_safety_watermarks w
    where w.name = 'unverified_checkout_watch_since'),
  'C: precondición: la marca de agua del fixture tiene 10 días');
delete from private.payment_safety_watermarks where name = 'unverified_checkout_watch_since';
select is(private.unverified_checkout_watch_since(), '-infinity'::timestamptz,
  'C: sin la fila, la marca vale «desde siempre»: ante la duda, se avisa');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b7:intent'), 'open', 'C: y entonces el checkout de hace 12 días también se ve');
insert into private.payment_safety_watermarks (name, since)
values ('unverified_checkout_watch_since', clock_timestamp() - interval '10 days');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b7:intent'), 'resolved', 'C: con la marca de nuevo en su lugar, vuelve a quedar fuera');

-- ══════════════════════════════════════════════════════════════════════════
--  D · la cierra una prueba
-- ══════════════════════════════════════════════════════════════════════════
select is(pg_temp.alerta('b3:intent'), 'open', 'D: precondición: el checkout b3 tiene su alerta abierta');
insert into public.payment_events (payment_intent_id, event_type, details)
values (pg_temp.id('b3:intent'), 'payment.provider_probe_empty',
        jsonb_build_object('source', 'provider_truth_sweep', 'conclusive', true));
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b3:intent'), 'resolved', 'D: un vacío concluyente (buscado con la conexión que creó la preferencia) la cierra');

select is(pg_temp.alerta('b4:intent'), 'open', 'D: precondición: el checkout b4 tiene su alerta abierta');
select lives_ok($$
  select public.record_mercadopago_payment_snapshot(pg_temp.id('b4:intent'), jsonb_build_object(
      'provider_payment_id', 'PAY-UV-B4',
      'external_reference', pi.external_reference,
      'preference_id', pi.preference_id,
      'merchant_order_id', 'MO-UV-B4',
      'collector_id', ps.collector_id,
      'application_id', '',
      'currency', 'ARS',
      'transaction_amount', cs.total::text,
      'status', 'approved',
      'status_detail', 'accredited',
      'payment_method', 'visa',
      'live_mode', false,
      'provider_occurred_at', (clock_timestamp() - interval '48 hours 50 minutes')::text,
      'refunded_amount', '0.00',
      'payer_email_hash', repeat('e', 64),
      'raw_response_hash', encode(digest('uv-b4-approved', 'sha256'), 'hex')), 'reconciliation', null)
    from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.environment = 'test'
   where pi.id = pg_temp.id('b4:intent')
$$, 'D: el pago aprobado que trae la sonda tardía se asienta por el camino de siempre');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b4:intent'), 'resolved', 'D: con el pago del proveedor a la vista, la alerta de «sin verificar» se cierra');
select is(
  (select a.status from public.operational_alerts a
    where a.alert_code = 'PAYMENT_RECONCILIATION_REQUIRED' and a.subject_id = pg_temp.id('b4:intent')),
  'open', 'D: y el cobro aprobado sobre un checkout vencido queda en su propia alerta, que no tiene ventana');

-- ══════════════════════════════════════════════════════════════════════════
--  E · la cierra una persona
-- ══════════════════════════════════════════════════════════════════════════
select is(pg_temp.resolver('b:staff', 'b5:intent'), 'resolved', 'E: el empleado puede marcarla resuelta (el Panel se lo permite)');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b5:intent'), 'open', 'E: pero su resolución no cuenta (no ve el cobro): la corrida siguiente la reabre');
select is(pg_temp.resolver('b:owner', 'b5:intent'), 'resolved', 'E: el dueño la da por resuelta con su nota');
select pg_temp.reconciliar('b');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b5:intent'), 'resolved', 'E: y queda resuelta: las corridas siguientes no la reabren');
select is(pg_temp.resolver('b:admin', 'b6:intent'), 'resolved', 'E: el encargado también');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b6:intent'), 'resolved', 'E: y su resolución cuenta');
select isnt(private.unverified_checkout_reviewed_at(pg_temp.id('b:business'), pg_temp.id('b5:intent')), null,
  'E: la resolución del dueño queda registrada con su autor');
update public.business_members set is_active = false
 where business_id = pg_temp.id('b:business') and user_id = pg_temp.id('b:admin');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b6:intent'), 'open',
  'E: si quien la resolvió ya no es encargado activo, su resolución deja de contar y la alerta vuelve');

-- ══════════════════════════════════════════════════════════════════════════
--  F · el barrido sigue preguntando, una vez por día, hasta los 30 días
-- ══════════════════════════════════════════════════════════════════════════
update private.payment_safety_watermarks set since = clock_timestamp() - interval '40 days'
 where name = 'unverified_checkout_watch_since';
select public.enqueue_checkout_provider_probes(200);
select is(pg_temp.sonda_pendiente('b1:intent'), 1, 'F: pasadas las 48 horas, con el último vacío hace 25 horas, toca la sonda del día');
select is(pg_temp.sonda_pendiente('b2:intent'), 1, 'F: sin ninguna sonda respondida, también');
select is(pg_temp.sonda_pendiente('b5:intent'), 0, 'F: el que resolvió el dueño ya no se pregunta');
select is(pg_temp.sonda_pendiente('b3:intent'), 0, 'F: el que tiene un vacío concluyente tampoco');
select is(pg_temp.sonda_pendiente('b8:intent'), 0, 'F: ni el de hace más de 30 días (sigue con su alerta abierta)');
select is(pg_temp.sonda_pendiente('a1:intent'), 1,
  'F: dentro de la ventana, el ritmo de siempre: un vacío no concluyente de hace 40 minutos ya deja preguntar');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b8:intent'), 'open',
  'F: el de hace más de 30 días ya no se pregunta, pero su alerta sigue abierta hasta que alguien la resuelva');
-- La sonda del día de b1 se intentó y falló: la próxima es mañana, no en el minuto siguiente.
update public.payment_outbox set status = 'dead_letter', attempts = 8, last_error = 'provider unreachable'
 where payment_intent_id = pg_temp.id('b1:intent') and topic = 'payment_reconcile'
   and status in ('pending', 'claimed', 'processing', 'retry_wait');
select public.enqueue_checkout_provider_probes(200);
select is(pg_temp.sonda_pendiente('b1:intent'), 0, 'F: con la sonda del día ya intentada (aunque haya fallado), no se encola otra');
select is(private.provider_probe_is_due(pg_temp.id('b1:intent'), clock_timestamp() - interval '49 hours'), false,
  'F: el ritmo diario cuenta desde el último trabajo encolado, no sólo desde el último vacío');
update public.payment_outbox set created_at = clock_timestamp() - interval '25 hours'
 where payment_intent_id = pg_temp.id('b1:intent') and topic = 'payment_reconcile';
select is(private.provider_probe_is_due(pg_temp.id('b1:intent'), clock_timestamp() - interval '49 hours'), true,
  'F: y al día siguiente vuelve a tocar');

-- ══════════════════════════════════════════════════════════════════════════
--  G · permisos, envoltorio de la frontera y el índice
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::integer from pg_roles r cross join (values
      ('private.unverified_checkout_watch_since()'::regprocedure),
      ('private.unverified_checkout_reviewed_at(uuid,uuid)'::regprocedure),
      ('private.provider_probe_is_due(uuid,timestamptz)'::regprocedure)) f(oid)
    where r.rolname in ('anon', 'authenticated', 'service_role')
      and has_function_privilege(r.oid, f.oid, 'EXECUTE')),
  0, 'G: las auxiliares no las ejecuta ningún rol de cliente ni service_role');
select is(
  (select count(*)::integer from pg_proc p
    where p.oid in ('public.enqueue_checkout_provider_probes(integer)'::regprocedure,
                    'public.reconcile_operational_alerts_for_business(uuid)'::regprocedure)
      and p.prosecdef
      and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=pg_catalog, public%')
      and has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  2, 'G: el barrido y la reconciliación siguen SECURITY DEFINER, con search_path fijado y sólo para service_role');
select ok(
  (select position('la-taba:api-boundary v1' in p.prosrc) > 0
     from pg_proc p where p.oid = 'public.enqueue_checkout_provider_probes(integer)'::regprocedure),
  'G: el barrido conserva el envoltorio de la frontera HTTP (20261002090000)');
select ok(
  (select has_table_privilege('authenticated', 'private.payment_safety_watermarks', 'SELECT') = false
      and has_table_privilege('anon', 'private.payment_safety_watermarks', 'SELECT') = false),
  'G: la marca de agua no la lee ningún cliente');
select is(
  (select count(*)::integer from pg_indexes
    where schemaname = 'public' and indexname = 'payment_outbox_reconcile_history_idx'),
  1, 'G: el índice del ritmo diario existe');

select * from finish();
rollback;
