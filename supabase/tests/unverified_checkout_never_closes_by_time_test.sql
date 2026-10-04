-- TABA · UN CHECKOUT QUE NADIE VERIFICÓ NO SE CIERRA POR TIEMPO (20261003090000)
--
-- Lo que pasaba: un checkout que llegó a Mercado Pago, venció y nunca tuvo una respuesta que
-- probara que no hubo pago (vacíos no concluyentes, o ninguna sonda respondida) tenía su alerta
-- CHECKOUT_PROVIDER_UNVERIFIED abierta a las 47 horas y RESUELTA POR EL SISTEMA a las 49
-- («condición ausente»), y el barrido dejaba de preguntar. Un posible cobro sin pedido quedaba
-- cerrado en silencio.
--
--   A  dentro de las 48 horas nada cambia: una resolución a mano la reabre la corrida siguiente
--   B  pasadas las 48 horas la alerta sigue abierta (vacíos no concluyentes o ninguno)
--   C  la marca de agua: lo anterior a ella no se resucita; sin la fila, se vigila todo
--   D  la cierra una prueba: un vacío concluyente, o el pago que trae la sonda
--   E  la cierra una persona: dueño o encargado con nota, pasada la ventana, hasta que el
--      proveedor diga algo nuevo; la de un empleado no cuenta
--   F  el barrido sigue preguntando una vez por día, hasta los 30 días, aunque una persona haya
--      resuelto la alerta; un vacío concluyente y la marca de agua lo frenan; pasados los 30
--      días, la alerta viva sigue abierta y lo que nunca tuvo alerta no se resucita
--   G  permisos, envoltorio de la frontera y el índice
--   H  un pago que el proveedor todavía no resolvió (pendiente o en revisión manual) sobre un
--      checkout vencido: nada dentro de la ventana, alerta y sonda diaria pasada la ventana,
--      y la cierra el resultado final del proveedor
--   I  un vacío anterior al pago no prueba nada; la resolución de una persona sobre un pago sin
--      resultado final no frena la relectura, una relectura igual no la reabre y un estado
--      nuevo sí; otro pago de la misma preferencia que sigue sin resolver no queda tapado por
--      un rechazo guardado; un pago distinto con el mismo estado es nuevo; lo que la evidencia no
--      mostraba también; con un rechazo guardado y ningún pago sin resolver asentado, la sonda
--      sigue buscando una vez por día; un pago sin resolver asentado después de los 30 días abre
--      la alerta igual
--
-- No depende de la hora: los momentos de sesiones, vacíos y trabajos se escriben a mano. Todo
-- transaccional (rollback). Ids aleatorios y cuentas acotadas a ellos: corre igual sobre la
-- base del gate, que nunca está vacía.

begin;
create extension if not exists pgtap with schema extensions;
select plan(119);

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

-- Asienta un pago leído del proveedor, por el camino del worker.
create function pg_temp.pago(p_intent text, p_payment_id text, p_status text, p_detail text, p_variant text default '',
                             p_hace interval default interval '46 hours 50 minutes')
returns jsonb language sql as $$
  select public.record_mercadopago_payment_snapshot(pg_temp.id(p_intent), jsonb_build_object(
      'provider_payment_id', p_payment_id,
      'external_reference', pi.external_reference,
      'preference_id', pi.preference_id,
      'merchant_order_id', 'MO-' || p_payment_id,
      'collector_id', ps.collector_id,
      'application_id', '',
      'currency', 'ARS',
      'transaction_amount', cs.total::text,
      'status', p_status,
      'status_detail', p_detail,
      'payment_method', 'visa',
      'live_mode', false,
      'provider_occurred_at', (clock_timestamp() - p_hace)::text,
      'refunded_amount', '0.00',
      'payer_email_hash', repeat('e', 64),
      'raw_response_hash', encode(digest(p_payment_id || ':' || p_status || p_variant, 'sha256'), 'hex')), 'reconciliation', null)
    from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.environment = 'test'
   where pi.id = pg_temp.id(p_intent)
$$;

-- La migración se aplicó hace 10 días: los checkouts de abajo nacieron con la garantía vigente.
update private.payment_safety_watermarks set since = clock_timestamp() - interval '10 days'
 where name = 'unverified_checkout_watch_since';

select pg_temp.negocio('a');
select pg_temp.negocio('b');
select pg_temp.negocio('p');
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
select pg_temp.checkout('b8', 'b', interval '29 days');    -- llega a los 30 días con su alerta abierta
select pg_temp.checkout('b9', 'b', interval '72 hours');   -- un vacío concluyente de hace 30 horas
select pg_temp.checkout('b10', 'b', interval '31 days');   -- más de 30 días y nunca tuvo alerta
select pg_temp.checkout('b11', 'b', interval '49 hours');  -- lo resuelve el dueño y después aparece un pago
select public.sweep_expired_checkout_sessions();
select pg_temp.vacios(pg_temp.id('a1:intent'), 20, clock_timestamp() - interval '40 minutes', false);
select pg_temp.vacios(pg_temp.id('a2:intent'), 1, clock_timestamp() - interval '40 minutes', true);
select pg_temp.vacios(pg_temp.id('b1:intent'), 20, clock_timestamp() - interval '25 hours', false);
select pg_temp.vacios(pg_temp.id('b3:intent'), 20, clock_timestamp() - interval '25 hours', false);
select pg_temp.vacios(pg_temp.id('b5:intent'), 20, clock_timestamp() - interval '25 hours', false);
select pg_temp.vacios(pg_temp.id('b6:intent'), 20, clock_timestamp() - interval '25 hours', false);
select pg_temp.vacios(pg_temp.id('b9:intent'), 1, clock_timestamp() - interval '30 hours', true);
select pg_temp.vacios(pg_temp.id('b11:intent'), 20, clock_timestamp() - interval '25 hours', false);

select is(
  (select count(*)::integer from public.payment_intents pi
    where pi.id in (select id from uv_ids where name like '%:intent') and pi.internal_status = 'expired'),
  13, 'precondición: los trece checkouts vencieron y su intent quedó «expired»');

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
select is(pg_temp.resolver('a:owner', 'a1:intent'), 'resolved', 'A: el dueño la marca resuelta dentro de la ventana');
select pg_temp.reconciliar('a');
select is(pg_temp.alerta('a1:intent'), 'open', 'A: y la corrida siguiente la reabre, como siempre: dentro de la ventana la cierra una prueba');

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
  (select a.required_action like '%Si no existe, pasadas las 48 horas de sondas el dueño o un encargado la da por resuelta con una nota: no se cierra sola.'
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
select ok(private.unverified_checkout_review_holds(pg_temp.id('b:business'), pg_temp.id('b5:intent'), null, null),
  'E: la resolución del dueño vale: está resuelta por él y sigue sin haber ningún pago a la vista');
-- b11: el dueño la da por resuelta y después la sonda trae un pago que nadie había visto.
select is(pg_temp.resolver('b:owner', 'b11:intent'), 'resolved', 'E: el dueño da por resuelta la de b11');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b11:intent'), 'resolved', 'E: precondición: queda resuelta');
select pg_temp.pago('b11:intent', 'PAY-UV-B11', 'in_process', 'pending_review_manual');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b11:intent'), 'open', 'E: un pago que el dueño no vio, asentado después de su resolución, la reabre');
select is(
  (select a.evidence ->> 'provider_status' from public.operational_alerts a
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('b11:intent')),
  'in_process', 'E: con el estado del proveedor en la evidencia');
select is(pg_temp.resolver('b:owner', 'b11:intent'), 'resolved', 'E: el dueño lo mira y la vuelve a resolver');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b11:intent'), 'resolved', 'E: y esa resolución, posterior al pago, vale');
update public.business_members set is_active = false
 where business_id = pg_temp.id('b:business') and user_id = pg_temp.id('b:admin');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b6:intent'), 'open',
  'E: si quien la resolvió ya no es encargado activo, su resolución deja de contar y la alerta vuelve');

-- ══════════════════════════════════════════════════════════════════════════
--  F · el barrido sigue preguntando, una vez por día, hasta los 30 días
-- ══════════════════════════════════════════════════════════════════════════
-- Con la marca de agua del fixture (10 días): lo anterior no se pregunta.
select public.enqueue_checkout_provider_probes(200);
select is(pg_temp.sonda_pendiente('b1:intent'), 1, 'F: pasadas las 48 horas, con el último vacío hace 25 horas, toca la sonda del día');
select is(pg_temp.sonda_pendiente('b2:intent'), 1, 'F: sin ninguna sonda respondida, también');
select is(pg_temp.sonda_pendiente('b7:intent'), 0, 'F: el de hace 12 días, anterior a la marca de agua, no se pregunta');
select is(pg_temp.sonda_pendiente('b9:intent'), 0,
  'F: un vacío concluyente de hace 30 horas frena la sonda diaria (el ritmo solo ya la dejaría pasar)');
select is(private.provider_probe_is_due(pg_temp.id('b9:intent'), clock_timestamp() - interval '72 hours'), true,
  'F: precondición: para el ritmo diario, a b9 le tocaría: lo frena la prueba, no el reloj');
select is(pg_temp.sonda_pendiente('b5:intent'), 1,
  'F: el que resolvió el dueño se sigue preguntando: una persona cierra la alerta, no la sonda');
select is(pg_temp.sonda_pendiente('b3:intent'), 0, 'F: el que tiene un vacío concluyente reciente tampoco');
select is(pg_temp.sonda_pendiente('a1:intent'), 1,
  'F: dentro de la ventana, el ritmo de siempre: un vacío no concluyente de hace 40 minutos ya deja preguntar');
update private.payment_safety_watermarks set since = clock_timestamp() - interval '40 days'
 where name = 'unverified_checkout_watch_since';
select public.enqueue_checkout_provider_probes(200);
select is(pg_temp.sonda_pendiente('b7:intent'), 1, 'F: con la marca de agua 40 días atrás, el de hace 12 días sí se pregunta');
select is(pg_temp.sonda_pendiente('b8:intent'), 1, 'F: y el de hace 29 días también');
select is(pg_temp.sonda_pendiente('b10:intent'), 0, 'F: el de hace más de 30 días no');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b8:intent'), 'open', 'F: el de hace 29 días tiene su alerta abierta');
-- b8 cumple 31 días: ya no se pregunta, pero su alerta no se cierra por tiempo.
update public.payment_outbox set status = 'completed'
 where payment_intent_id = pg_temp.id('b8:intent') and topic = 'payment_reconcile'
   and status in ('pending', 'claimed', 'processing', 'retry_wait');
update public.checkout_sessions set created_at = clock_timestamp() - interval '31 days',
       expires_at = clock_timestamp() - interval '31 days' + interval '20 minutes'
 where id = pg_temp.id('b8');
update public.payment_outbox set created_at = clock_timestamp() - interval '25 hours'
 where payment_intent_id = pg_temp.id('b8:intent') and topic = 'payment_reconcile';
select public.enqueue_checkout_provider_probes(200);
select is(pg_temp.sonda_pendiente('b8:intent'), 0, 'F: a los 31 días ya no se pregunta');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b8:intent'), 'open',
  'F: pero su alerta sigue abierta hasta que alguien la resuelva: pasados los 30 días se sigue por su alerta');
select is(pg_temp.alerta('b10:intent'), null,
  'F: lo que pasó los 30 días sin alerta no se resucita (lo muestra la conciliación): el costo no crece con la historia');
-- b8, con 31 días: la resuelve el encargado (de nuevo activo) y después deja de serlo.
update public.business_members set is_active = true
 where business_id = pg_temp.id('b:business') and user_id = pg_temp.id('b:admin');
select is(pg_temp.resolver('b:admin', 'b8:intent'), 'resolved', 'F: el encargado resuelve la alerta de 31 días');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b8:intent'), 'resolved', 'F: y queda resuelta');
update public.business_members set is_active = false
 where business_id = pg_temp.id('b:business') and user_id = pg_temp.id('b:admin');
select pg_temp.reconciliar('b');
select is(pg_temp.alerta('b8:intent'), 'open',
  'F: si deja de ser encargado, la alerta de más de 30 días vuelve (una resuelta por una persona sigue viva)');
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

-- a1 cruza la ventana con su alerta abierta: la resolución que el dueño hizo adentro no se arrastra.
update public.checkout_sessions set created_at = clock_timestamp() - interval '49 hours',
       expires_at = clock_timestamp() - interval '48 hours 40 minutes'
 where id = pg_temp.id('a1');
select pg_temp.reconciliar('a');
select is(pg_temp.alerta('a1:intent'), 'open', 'E: a1 pasa la ventana abierta: la resolución que el dueño hizo adentro no cuenta');
select is(pg_temp.resolver('a:owner', 'a1:intent'), 'resolved', 'E: el dueño la resuelve pasada la ventana');
select pg_temp.reconciliar('a');
select is(pg_temp.alerta('a1:intent'), 'resolved', 'E: y ésa sí vale');

-- ══════════════════════════════════════════════════════════════════════════
--  G · permisos, envoltorio de la frontera y el índice
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::integer from pg_roles r cross join (values
      ('private.unverified_checkout_watch_since()'::regprocedure),
      ('private.unverified_checkout_review_holds(uuid,uuid,text,text)'::regprocedure),
      ('private.unresolved_provider_payment(uuid)'::regprocedure),
      ('private.unverified_checkout_findings(uuid)'::regprocedure),
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
select is(
  (select count(*)::integer from pg_indexes
    where schemaname = 'public' and indexname = 'payment_events_unresolved_recent_idx'
      and indexdef like '%(server_recorded_at)%'),
  1, 'G: el índice por fecha de los asientos sin resultado final existe (la reconciliación lee lo reciente, no la historia)');

-- ══════════════════════════════════════════════════════════════════════════
--  H · un pago que el proveedor todavía no resolvió
-- ══════════════════════════════════════════════════════════════════════════
-- p1: tarjeta en revisión manual (in_process). p2: pendiente. Sus sesiones vencen y el stock
-- se libera, pero el pago sigue vivo en Mercado Pago.
select pg_temp.checkout('p1', 'p', interval '47 hours');
select pg_temp.checkout('p2', 'p', interval '49 hours');
select pg_temp.pago('p1:intent', 'PAY-UV-P1', 'in_process', 'pending_review_manual');
select pg_temp.pago('p2:intent', 'PAY-UV-P2', 'pending', 'pending_contingency');
select public.sweep_expired_checkout_sessions();
select is(
  (select string_agg(pi.internal_status || '/' || pi.provider_status, ',' order by pi.provider_payment_id)
     from public.payment_intents pi where pi.id in (pg_temp.id('p1:intent'), pg_temp.id('p2:intent'))),
  'expired/in_process,expired/pending',
  'H: precondición: la sesión venció y el intent quedó «expired» con el pago del proveedor sin resolver');
select pg_temp.reconciliar('p');
select is(pg_temp.alerta('p1:intent'), null, 'H: dentro de la ventana no hay alerta: el barrido lo relee cada pocos minutos');
select is(pg_temp.alerta('p2:intent'), 'open', 'H: pasadas las 48 horas, un pago sin resultado final abre la alerta');
select is(
  (select a.evidence ->> 'provider_status' from public.operational_alerts a
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('p2:intent')),
  'pending', 'H: y la evidencia dice en qué estado lo tiene el proveedor');
select public.enqueue_checkout_provider_probes(200);
select is(pg_temp.sonda_pendiente('p1:intent'), 1, 'H: dentro de la ventana, la relectura de siempre');
select is(pg_temp.sonda_pendiente('p2:intent'), 1, 'H: pasada la ventana, la relectura del día');
update public.checkout_sessions set created_at = clock_timestamp() - interval '49 hours',
       expires_at = clock_timestamp() - interval '48 hours 40 minutes'
 where id = pg_temp.id('p1');
select pg_temp.reconciliar('p');
select is(pg_temp.alerta('p1:intent'), 'open', 'H: el de la revisión manual, pasada la ventana, también');
-- El proveedor rechaza p1: no hubo dinero, la alerta se cierra con esa prueba.
select pg_temp.pago('p1:intent', 'PAY-UV-P1', 'rejected', 'cc_rejected_high_risk');
select pg_temp.reconciliar('p');
select is(pg_temp.alerta('p1:intent'), 'resolved', 'H: el rechazo del proveedor la cierra');
-- El proveedor aprueba p2 al tercer día: el registro de pagos lo manda a revisión, con su alerta.
select pg_temp.pago('p2:intent', 'PAY-UV-P2', 'approved', 'accredited');
update public.payment_intents set approved_at = clock_timestamp() - interval '10 minutes'
 where id = pg_temp.id('p2:intent') and approved_at > clock_timestamp() - interval '5 minutes';
select pg_temp.reconciliar('p');
select is(pg_temp.alerta('p2:intent'), 'resolved', 'H: la aprobación cierra la de «sin resultado final»...');
select ok(
  exists (select 1 from public.operational_alerts a
           where a.subject_id = pg_temp.id('p2:intent') and a.status <> 'resolved'
             and a.alert_code in ('PAYMENT_RECONCILIATION_REQUIRED', 'PAYMENT_APPROVED_WITHOUT_ORDER')),
  'H: ...y el cobro aprobado sin pedido queda en su propia alerta, que no tiene ventana');

-- ══════════════════════════════════════════════════════════════════════════
--  I · un vacío anterior al pago no prueba nada; una persona no frena la relectura
-- ══════════════════════════════════════════════════════════════════════════
-- p3: la sonda anotó un vacío CONCLUYENTE a los 2 minutos del checkout (el comprador todavía no
-- había pagado); después pagó con tarjeta y Mercado Pago dejó el pago en revisión manual.
-- p4: un pago en revisión manual pasada la ventana, que el dueño mira y da por resuelto.
select pg_temp.checkout('p3', 'p', interval '49 hours');
select pg_temp.checkout('p4', 'p', interval '49 hours');
select pg_temp.vacios(pg_temp.id('p3:intent'), 1, clock_timestamp() - interval '48 hours 58 minutes', true);
select pg_temp.pago('p3:intent', 'PAY-UV-P3', 'in_process', 'pending_review_manual');
select pg_temp.pago('p4:intent', 'PAY-UV-P4', 'in_process', 'pending_review_manual');
select public.sweep_expired_checkout_sessions();
select pg_temp.reconciliar('p');
select is(pg_temp.alerta('p3:intent'), 'open',
  'I: un vacío concluyente anterior al pago no calla la alerta del pago que el proveedor no resolvió');
select public.enqueue_checkout_provider_probes(200);
select is(pg_temp.sonda_pendiente('p3:intent'), 1, 'I: ni frena su relectura diaria');
select is(pg_temp.alerta('p4:intent'), 'open', 'I: p4 tiene su alerta abierta');
select is(pg_temp.resolver('p:owner', 'p4:intent'), 'resolved', 'I: el dueño mira el pago en revisión y la da por resuelta');
select pg_temp.reconciliar('p');
select is(pg_temp.alerta('p4:intent'), 'resolved', 'I: y queda resuelta');
update public.payment_outbox set status = 'completed', created_at = clock_timestamp() - interval '25 hours'
 where payment_intent_id = pg_temp.id('p4:intent') and topic = 'payment_reconcile';
select public.enqueue_checkout_provider_probes(200);
select is(pg_temp.sonda_pendiente('p4:intent'), 1,
  'I: pero el pago sigue sin resultado final y se sigue releyendo una vez por día');
-- La relectura trae el mismo pago con el mismo estado (otra respuesta del proveedor, mismo hecho).
select pg_temp.pago('p4:intent', 'PAY-UV-P4', 'in_process', 'pending_review_manual', '-relectura');
select is(
  (select count(*)::integer from public.payment_events pe
    where pe.payment_intent_id = pg_temp.id('p4:intent') and pe.event_type = 'payment.in_process'),
  2, 'I: precondición: la relectura quedó asentada como otro evento del mismo pago y estado');
select pg_temp.reconciliar('p');
select is(pg_temp.alerta('p4:intent'), 'resolved', 'I: una relectura igual no la reabre');
-- El proveedor informa otro estado del mismo pago.
select pg_temp.pago('p4:intent', 'PAY-UV-P4', 'pending', 'pending_contingency');
select pg_temp.reconciliar('p');
select is(pg_temp.alerta('p4:intent'), 'open', 'I: un estado nuevo del proveedor, posterior a la resolución, la reabre');
select is(
  (select a.evidence ->> 'provider_status' from public.operational_alerts a
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('p4:intent')),
  'pending', 'I: con el estado nuevo en la evidencia');

-- p5: la tarjeta 1 queda en revisión manual; el comprador reintenta en la misma preferencia con la
-- tarjeta 2 y se la rechazan. El cobro guarda el pago más nuevo: el rechazo.
select pg_temp.checkout('p5', 'p', interval '49 hours');
select public.sweep_expired_checkout_sessions();
select pg_temp.pago('p5:intent', 'PAY-UV-P5A', 'in_process', 'pending_review_manual');
select pg_temp.pago('p5:intent', 'PAY-UV-P5B', 'rejected', 'cc_rejected_high_risk');
select is(
  (select pi.internal_status || '/' || pi.provider_payment_id || '/' || pi.provider_status from public.payment_intents pi
    where pi.id = pg_temp.id('p5:intent')),
  'expired/PAY-UV-P5B/rejected', 'I: precondición: el cobro tiene guardado el rechazo de la tarjeta 2');
select pg_temp.reconciliar('p');
select is(pg_temp.alerta('p5:intent'), 'open',
  'I: el rechazo guardado no tapa la tarjeta 1, que sigue en revisión: la alerta se abre');
select is(
  (select (a.evidence ->> 'provider_status') || '/' || (a.evidence ->> 'unresolved_provider_payment_id')
     from public.operational_alerts a
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('p5:intent')),
  'in_process/PAY-UV-P5A', 'I: y la evidencia dice qué pago buscar y en qué estado está');
select public.enqueue_checkout_provider_probes(200);
select is(
  (select string_agg(coalesce(po.resource_id, '<búsqueda>'), ',') from public.payment_outbox po
    where po.payment_intent_id = pg_temp.id('p5:intent') and po.topic = 'payment_reconcile'
      and po.status in ('pending', 'claimed', 'processing', 'retry_wait')),
  'PAY-UV-P5A', 'I: la sonda diaria relee la tarjeta 1 por su id');

-- p6: el dueño resuelve con la tarjeta A en revisión a la vista; después aparece la tarjeta B,
-- también en revisión: es otro pago, aunque tenga el mismo estado.
select pg_temp.checkout('p6', 'p', interval '49 hours');
select public.sweep_expired_checkout_sessions();
select pg_temp.pago('p6:intent', 'PAY-UV-P6A', 'in_process', 'pending_review_manual');
select pg_temp.reconciliar('p');
select is(pg_temp.resolver('p:owner', 'p6:intent'), 'resolved', 'I: el dueño resuelve p6 con la tarjeta A a la vista');
select pg_temp.reconciliar('p');
select is(pg_temp.alerta('p6:intent'), 'resolved', 'I: precondición: queda resuelta');
select pg_temp.pago('p6:intent', 'PAY-UV-P6B', 'in_process', 'pending_review_manual');
select pg_temp.reconciliar('p');
select is(pg_temp.alerta('p6:intent'), 'open', 'I: un pago distinto con el mismo estado es nuevo: la reabre');
select is(
  (select a.evidence ->> 'unresolved_provider_payment_id' from public.operational_alerts a
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('p6:intent')),
  'PAY-UV-P6B', 'I: y la evidencia nombra el pago sin resolver más nuevo');

-- p7: la alerta se refresca sin pago a la vista; la sonda asienta un pago en revisión y, antes de
-- la corrida siguiente, el dueño la resuelve: no vio ese pago.
select pg_temp.checkout('p7', 'p', interval '49 hours');
select public.sweep_expired_checkout_sessions();
select pg_temp.vacios(pg_temp.id('p7:intent'), 20, clock_timestamp() - interval '25 hours', false);
select pg_temp.reconciliar('p');
select is(
  (select a.status || '/' || coalesce(a.evidence ->> 'provider_status', '<ninguno>') from public.operational_alerts a
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('p7:intent')),
  'open/<ninguno>', 'I: precondición: la evidencia de p7 no muestra ningún pago');
select pg_temp.pago('p7:intent', 'PAY-UV-P7', 'in_process', 'pending_review_manual');
select is(pg_temp.resolver('p:owner', 'p7:intent'), 'resolved', 'I: el dueño la resuelve antes de que la evidencia se refresque');
select pg_temp.reconciliar('p');
select is(pg_temp.alerta('p7:intent'), 'open',
  'I: lo asentado después del último refresco de la evidencia cuenta como nuevo: la reabre con el pago a la vista');

-- p10: lo mismo con el asiento fechado ANTES del último refresco (se insertó antes y se confirmó
-- después de que la reconciliación leyera): la evidencia tampoco lo mostraba.
select pg_temp.checkout('p10', 'p', interval '49 hours');
select public.sweep_expired_checkout_sessions();
select pg_temp.vacios(pg_temp.id('p10:intent'), 20, clock_timestamp() - interval '25 hours', false);
select pg_temp.reconciliar('p');
select pg_temp.pago('p10:intent', 'PAY-UV-P10', 'in_process', 'pending_review_manual');
update public.payment_events pe set server_recorded_at = a.last_seen_at - interval '1 second'
  from public.operational_alerts a
 where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('p10:intent')
   and pe.payment_intent_id = pg_temp.id('p10:intent') and pe.provider_event_id = 'PAY-UV-P10';
select is(pg_temp.resolver('p:owner', 'p10:intent'), 'resolved', 'I: el dueño resuelve p10 con la evidencia sin pago');
select pg_temp.reconciliar('p');
select is(pg_temp.alerta('p10:intent'), 'open',
  'I: un pago que la evidencia no mostraba la reabre aunque su asiento diga una hora anterior al refresco');

-- p8: la tarjeta A queda en revisión y sus avisos se pierden (nunca se asienta); el comprador reintenta
-- con la tarjeta B, que se rechaza, y sólo B se asienta.
select pg_temp.checkout('p8', 'p', interval '49 hours');
select public.sweep_expired_checkout_sessions();
select pg_temp.pago('p8:intent', 'PAY-UV-P8B', 'rejected', 'cc_rejected_other_reason');
select pg_temp.reconciliar('p');
select is(pg_temp.alerta('p8:intent'), null,
  'I: con un rechazo guardado y ningún pago sin resolver asentado, no hay alerta (no hay nada que mostrar)');
select public.enqueue_checkout_provider_probes(200);
select is(
  (select string_agg(coalesce(po.resource_id, '<búsqueda>'), ',') from public.payment_outbox po
    where po.payment_intent_id = pg_temp.id('p8:intent') and po.topic = 'payment_reconcile'
      and po.status in ('pending', 'claimed', 'processing', 'retry_wait')),
  '<búsqueda>', 'I: pero la sonda del día sigue buscando por la referencia externa, que prefiere un pago aprobado');

-- p9: un pago sin resolver asentado recién a los 31 días, detrás de un rechazo guardado.
select pg_temp.checkout('p9', 'p', interval '31 days');
select public.sweep_expired_checkout_sessions();
select pg_temp.pago('p9:intent', 'PAY-UV-P9A', 'in_process', 'pending_review_manual');
select pg_temp.pago('p9:intent', 'PAY-UV-P9B', 'rejected', 'cc_rejected_other_reason');
select pg_temp.reconciliar('p');
select is(pg_temp.alerta('p9:intent'), 'open',
  'I: un pago sin resolver asentado después de los 30 días abre la alerta igual');
select public.enqueue_checkout_provider_probes(200);
select is(pg_temp.sonda_pendiente('p9:intent'), 0, 'I: (la sonda diaria termina a los 30 días: la alerta queda a la vista)');

-- p11: la tarjeta A en revisión, la B rechazada (guardada); después llega una lectura VIEJA de A
-- (pendiente, con hora del proveedor anterior): el último estado de A es el de la hora del proveedor.
select pg_temp.checkout('p11', 'p', interval '49 hours');
select public.sweep_expired_checkout_sessions();
select pg_temp.pago('p11:intent', 'PAY-UV-P11A', 'in_process', 'pending_review_manual', '', interval '46 hours 50 minutes');
select pg_temp.pago('p11:intent', 'PAY-UV-P11B', 'rejected', 'cc_rejected_other_reason', '', interval '46 hours 40 minutes');
select pg_temp.pago('p11:intent', 'PAY-UV-P11A', 'pending', 'pending_contingency', '', interval '47 hours');
select pg_temp.reconciliar('p');
select is(
  (select (a.evidence ->> 'provider_status') || '/' || (a.evidence ->> 'unresolved_provider_payment_id')
     from public.operational_alerts a
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('p11:intent')),
  'in_process/PAY-UV-P11A', 'I: una lectura vieja que llega tarde no pisa el último estado del pago (manda la hora del proveedor)');

-- p12: dos pagos en revisión (A y después C) y el guardado vencido por el proveedor (B, «expired»):
-- la búsqueda por referencia no sirve con un guardado vencido, así que se relee el pago sin resolver
-- más nuevo por su id.
select pg_temp.checkout('p12', 'p', interval '49 hours');
select public.sweep_expired_checkout_sessions();
select pg_temp.pago('p12:intent', 'PAY-UV-P12A', 'in_process', 'pending_review_manual', '', interval '46 hours 50 minutes');
select pg_temp.pago('p12:intent', 'PAY-UV-P12C', 'in_process', 'pending_review_manual', '', interval '46 hours 45 minutes');
select pg_temp.pago('p12:intent', 'PAY-UV-P12B', 'expired', 'expired', '', interval '46 hours 40 minutes');
select pg_temp.reconciliar('p');
select is(
  (select (a.evidence ->> 'provider_status') || '/' || (a.evidence ->> 'unresolved_provider_payment_id')
     from public.operational_alerts a
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('p12:intent')),
  'in_process/PAY-UV-P12C', 'I: con dos pagos sin resolver, la evidencia nombra el más nuevo');
select public.enqueue_checkout_provider_probes(200);
select is(
  (select string_agg(coalesce(po.resource_id, '<búsqueda>'), ',') from public.payment_outbox po
    where po.payment_intent_id = pg_temp.id('p12:intent') and po.topic = 'payment_reconcile'
      and po.status in ('pending', 'claimed', 'processing', 'retry_wait')),
  'PAY-UV-P12C', 'I: y la sonda diaria lo relee por su id aunque el guardado esté vencido');

-- ══════════════════════════════════════════════════════════════════════════
--  J · lo que acota el costo no deja de mirar nada (quinta revisión)
-- ══════════════════════════════════════════════════════════════════════════
select pg_temp.negocio('q');

-- q1: tarjeta A en revisión y B rechazada (guardada) sobre un checkout de 38 días. La alerta se abre
-- por el asiento reciente de A; con los asientos ya viejos (corridos 35 días, más allá de los 30 que mira
-- la reconciliación) la sostiene su alerta viva.
select pg_temp.checkout('q1', 'q', interval '38 days');
select public.sweep_expired_checkout_sessions();
select pg_temp.pago('q1:intent', 'PAY-UV-Q1A', 'in_process', 'pending_review_manual', '', interval '46 hours 50 minutes');
select pg_temp.pago('q1:intent', 'PAY-UV-Q1B', 'rejected', 'cc_rejected_other_reason', '', interval '46 hours 40 minutes');
select pg_temp.reconciliar('q');
select is(pg_temp.alerta('q1:intent'), 'open',
  'J: un pago sin resolver asentado hoy, detrás de un rechazo guardado, abre la alerta de un checkout de 38 días');
update public.payment_events set server_recorded_at = server_recorded_at - interval '35 days'
 where payment_intent_id = pg_temp.id('q1:intent');
select pg_temp.reconciliar('q');
select is(
  (select a.status || '/' || (a.evidence ->> 'unresolved_provider_payment_id') from public.operational_alerts a
    where a.alert_code = 'CHECKOUT_PROVIDER_UNVERIFIED' and a.subject_id = pg_temp.id('q1:intent')),
  'open/PAY-UV-Q1A', 'J: con esos asientos ya viejos la alerta sigue abierta: la sostiene su alerta viva, no la fecha');

-- El barrido, con cada clase en su cupo. Para contar sólo lo de esta sección, todo lo demás de la
-- base queda con un trabajo de sonda en curso (adentro de esta transacción, que termina en rollback).
insert into public.payment_outbox (payment_intent_id, topic, resource_id)
select pi.id, 'payment_reconcile', null from public.payment_intents pi
 where pi.business_id <> pg_temp.id('q:business')
on conflict do nothing;
select pg_temp.checkout('q3', 'q', interval '3 days 3 minutes');
select pg_temp.checkout('q4', 'q', interval '3 days 2 minutes');
select pg_temp.checkout('q5', 'q', interval '3 days 1 minute');
select public.sweep_expired_checkout_sessions();
select pg_temp.pago('q3:intent', 'PAY-UV-Q3', 'rejected', 'cc_rejected_other_reason');
select pg_temp.pago('q4:intent', 'PAY-UV-Q4', 'rejected', 'cc_rejected_other_reason');
select pg_temp.pago('q5:intent', 'PAY-UV-Q5', 'rejected', 'cc_rejected_other_reason');
select pg_temp.checkout('q6', 'q', interval '5 minutes');   -- el comprador está en Mercado Pago ahora
create function pg_temp.con_sonda(p_names text[]) returns text language sql stable as $$
  select coalesce(string_agg(n, ',' order by n), '') from unnest(p_names) n
   where pg_temp.sonda_pendiente(n || ':intent') > 0
$$;
select public.enqueue_checkout_provider_probes(2);
select is(pg_temp.con_sonda(array['q6']), 'q6',
  'J: con tres checkouts vencidos esperando, el de hace 5 minutos recibe su sonda en la primera corrida');
select is(pg_temp.con_sonda(array['q3', 'q4', 'q5']), 'q3',
  'J: lo que pasó la ventana entra con su propio cupo (un quinto del límite: uno con límite 2), el más viejo primero');
select public.enqueue_checkout_provider_probes(2);
select is(pg_temp.con_sonda(array['q3', 'q4', 'q5']), 'q3,q4', 'J: y en la corrida siguiente, el que sigue');

-- El ritmo diario contado por los índices coincide con la función del ritmo: una pregunta hace 2 horas
-- (un trabajo terminado, o un vacío) espera; una de hace 25 horas, no.
select pg_temp.checkout('q7', 'q', interval '3 days');
select pg_temp.checkout('q8', 'q', interval '3 days');
select pg_temp.checkout('q9', 'q', interval '3 days');
select public.sweep_expired_checkout_sessions();
select pg_temp.pago('q7:intent', 'PAY-UV-Q7', 'rejected', 'cc_rejected_other_reason');
select pg_temp.pago('q8:intent', 'PAY-UV-Q8', 'rejected', 'cc_rejected_other_reason');
select pg_temp.pago('q9:intent', 'PAY-UV-Q9', 'rejected', 'cc_rejected_other_reason');
insert into public.payment_outbox (payment_intent_id, topic, resource_id, status, created_at, updated_at, completed_at)
values (pg_temp.id('q7:intent'), 'payment_reconcile', null, 'completed',
        clock_timestamp() - interval '2 hours', clock_timestamp() - interval '2 hours', clock_timestamp() - interval '2 hours'),
       (pg_temp.id('q8:intent'), 'payment_reconcile', null, 'completed',
        clock_timestamp() - interval '25 hours', clock_timestamp() - interval '25 hours', clock_timestamp() - interval '25 hours'),
       (pg_temp.id('q9:intent'), 'payment_reconcile', null, 'completed',
        clock_timestamp() - interval '25 hours', clock_timestamp() - interval '25 hours', clock_timestamp() - interval '25 hours');
select pg_temp.vacios(pg_temp.id('q9:intent'), 1, clock_timestamp() - interval '2 hours', true);
select public.enqueue_checkout_provider_probes(200);
select is(pg_temp.con_sonda(array['q7', 'q8', 'q9']), 'q8',
  'J: una sonda por día contada desde la última pregunta: sólo el que no preguntó en 24 horas (ni trabajo ni vacío)');

-- ══════════════════════════════════════════════════════════════════════════
--  K · dentro de las 48 horas, un pago guardado no se repregunta cada minuto (sexta revisión)
-- ══════════════════════════════════════════════════════════════════════════
-- Con un pago guardado el worker relee o busca ese pago y no anota vacíos: el ritmo se cuenta por los
-- trabajos de sonda. Para contar sólo lo de esta sección, todo lo demás queda con una sonda en curso.
select pg_temp.negocio('r');
insert into public.payment_outbox (payment_intent_id, topic, resource_id)
select pi.id, 'payment_reconcile', null from public.payment_intents pi
 where pi.business_id <> pg_temp.id('r:business')
on conflict do nothing;
create function pg_temp.sondas_hechas(p_intent text, p_n integer, p_last_ago interval) returns void language sql as $$
  insert into public.payment_outbox (payment_intent_id, topic, resource_id, status, created_at, updated_at, completed_at)
  select pg_temp.id(p_intent), 'payment_reconcile', null, 'completed',
         clock_timestamp() - p_last_ago - make_interval(mins => 3 * (p_n - g)),
         clock_timestamp() - p_last_ago - make_interval(mins => 3 * (p_n - g)),
         clock_timestamp() - p_last_ago - make_interval(mins => 3 * (p_n - g))
    from generate_series(1, p_n) g
$$;
-- r1..r3: rechazados de hace 40, 39 y 38 minutos, preguntados por última vez hace 20 (les toca otra vez); r4:
-- el comprador está en Mercado Pago ahora (hace 3 minutos) y nunca se preguntó.
select pg_temp.checkout('r1', 'r', interval '40 minutes');
select pg_temp.checkout('r2', 'r', interval '39 minutes');
select pg_temp.checkout('r3', 'r', interval '38 minutes');
select pg_temp.pago('r1:intent', 'PAY-UV-R1', 'rejected', 'cc_rejected_other_reason', '', interval '35 minutes');
select pg_temp.pago('r2:intent', 'PAY-UV-R2', 'rejected', 'cc_rejected_other_reason', '', interval '35 minutes');
select pg_temp.pago('r3:intent', 'PAY-UV-R3', 'rejected', 'cc_rejected_other_reason', '', interval '35 minutes');
select pg_temp.sondas_hechas('r1:intent', 3, interval '20 minutes');
select pg_temp.sondas_hechas('r2:intent', 3, interval '20 minutes');
select pg_temp.sondas_hechas('r3:intent', 3, interval '20 minutes');
select pg_temp.checkout('r4', 'r', interval '3 minutes');
select public.enqueue_checkout_provider_probes(2);
select is(pg_temp.con_sonda(array['r4']), 'r4',
  'K: lo que nunca se preguntó va primero: tres rechazados recientes no dejan sin sonda al checkout de hace 3 minutos');

-- Con un pago guardado se relee a intervalo fijo desde la última sonda: cada 2 minutos en la primera media
-- hora del checkout y después cada 15, sin cupo que se gaste (ni las sondas de antes del pago ni las que
-- fallaron frenan la siguiente).
-- r5: rechazado hace 40 minutos, preguntado hace 1: espera.
select pg_temp.checkout('r5', 'r', interval '40 minutes');
select pg_temp.pago('r5:intent', 'PAY-UV-R5', 'rejected', 'cc_rejected_other_reason', '', interval '35 minutes');
select pg_temp.sondas_hechas('r5:intent', 2, interval '1 minute');
-- r6 / r7: tarjetas en revisión de hace 6 horas con 10 sondas previas (tres fallidas); a r6 se le preguntó
-- por última vez hace 20 minutos, a r7 hace 10.
select pg_temp.checkout('r6', 'r', interval '6 hours');
select pg_temp.checkout('r7', 'r', interval '6 hours');
select public.sweep_expired_checkout_sessions();
select pg_temp.pago('r6:intent', 'PAY-UV-R6', 'in_process', 'pending_review_manual', '', interval '355 minutes');
select pg_temp.pago('r7:intent', 'PAY-UV-R7', 'in_process', 'pending_review_manual', '', interval '355 minutes');
select pg_temp.sondas_hechas('r6:intent', 10, interval '20 minutes');
select pg_temp.sondas_hechas('r7:intent', 10, interval '10 minutes');
update public.payment_outbox set status = 'dead_letter', completed_at = null, last_error = 'provider unavailable (fixture)'
 where id in (select po.id from public.payment_outbox po
               where po.payment_intent_id = pg_temp.id('r6:intent') and po.topic = 'payment_reconcile'
               order by po.created_at limit 3);
-- r9 / r10: tarjetas en revisión de hace 10 minutos (la sesión sigue): preguntadas hace 3 y hace 1 minuto.
select pg_temp.checkout('r9', 'r', interval '10 minutes');
select pg_temp.checkout('r10', 'r', interval '10 minutes');
select pg_temp.pago('r9:intent', 'PAY-UV-R9', 'in_process', 'pending_review_manual', '', interval '8 minutes');
select pg_temp.pago('r10:intent', 'PAY-UV-R10', 'in_process', 'pending_review_manual', '', interval '8 minutes');
select pg_temp.sondas_hechas('r9:intent', 3, interval '3 minutes');
select pg_temp.sondas_hechas('r10:intent', 3, interval '1 minute');
-- r8: sin pago, dos vacíos concluyentes (el último hace 3 minutos): el ritmo de los vacíos sigue igual.
select pg_temp.checkout('r8', 'r', interval '20 minutes');
select pg_temp.vacios(pg_temp.id('r8:intent'), 2, clock_timestamp() - interval '3 minutes', true);
select pg_temp.sondas_hechas('r8:intent', 2, interval '3 minutes');
select public.enqueue_checkout_provider_probes(200);
select is(pg_temp.con_sonda(array['r5']), '',
  'K: con un pago guardado, preguntado hace 1 minuto, espera: ya no se le vuelve a preguntar en cada corrida');
select is(pg_temp.con_sonda(array['r6', 'r7']), 'r6',
  'K: pasada la media hora, un pago sin resolver se relee cada 15 minutos desde la última sonda: 10 sondas previas (tres fallidas) no lo frenan');
select is(pg_temp.con_sonda(array['r9', 'r10']), 'r9',
  'K: en la primera media hora del checkout, cada 2 minutos');
select is(pg_temp.con_sonda(array['r8']), 'r8', 'K: sin pago guardado, el ritmo de los vacíos sigue igual');

select * from finish();
rollback;
