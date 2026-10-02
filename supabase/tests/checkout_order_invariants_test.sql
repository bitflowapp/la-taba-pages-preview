-- TABA · LO QUE NO PUEDE PASAR EN UN CHECKOUT NI EN UN PEDIDO
--
-- Varias garantías del checkout y del pedido estaban implementadas y ninguna prueba de
-- la lista canónica las ejecutaba. Acá se fijan, llamando a las puertas públicas con el
-- rol y el token de quien las llama de verdad (el cliente anónimo autenticado en
-- `create_order_with_items`; la clave de servicio en `create_checkout_session`, el
-- snapshot y la finalización; un integrante del comercio con su sesión en el Panel):
--
--   A  no nace un pedido ni una sesión sin renglones, y qué dice el esquema de un
--      pedido sin renglones;
--   B  el total guardado es subtotal - descuento + envío y el subtotal es la suma de
--      los renglones, en retiro, en envío y en un pedido que nace de un cobro; el total
--      del pedido pagado es el importe del cobro aprobado, y un cobro por otro importe
--      no produce un pedido;
--   C  la misma clave en la puerta manual: mismo contenido devuelve el mismo pedido y
--      no escribe; otro contenido se rechaza (23505); la clave de otro cliente no
--      devuelve el pedido ajeno;
--   D  lo mismo en la sesión de checkout;
--   E  un checkout, un pedido: el mismo cobro aprobado registrado dos veces y la
--      finalización llamada tres veces terminan en UN pedido, con el stock descontado
--      una vez y la reserva convertida una vez; el mismo pago no sirve para otra sesión;
--   F  un cobro aprobado sin pedido se detecta: a los 3 minutos en la lista de
--      checkouts sin finalizar y a los 5 en la alerta `PAYMENT_APPROVED_WITHOUT_ORDER`;
--   G  sin cobro aprobado la finalización no crea nada (sin pago, pendiente, en
--      proceso, rechazado, sesión vencida);
--   H  un cobro aprobado sobre una sesión vencida no se convierte en pedido en
--      silencio: queda en revisión manual, visible y con una alerta;
--   I  un pedido siempre tiene medio y estado de pago: el trigger diferido
--      `orders_assert_payment_modality` dispara;
--   J  confirmar dos veces el cobro manual no lo escribe dos veces;
--   K  la máquina de estados del pedido por `transition_order`: la matriz completa de
--      un integrante del comercio, y cada rechazo deja estado y revisión como estaban.
--
-- Después de cada rechazo se comprueba que no se escribió nada: ni pedido, ni sesión,
-- ni reserva, ni evento, y el stock igual.
--
-- Las aserciones que empiezan con «LIMITACION» o «DEFECTO» fijan lo que la base hace
-- HOY donde el requisito pide otra cosa; el comentario de cada una dice qué debería
-- pasar. Las LIMITACION necesitan la clave de servicio o SQL directo: ninguna RPC
-- pública llega a ellas. El DEFECTO es un campo de la respuesta de una RPC del servicio.
--
-- No depende de la hora: los comercios no exigen horario y el tiempo se simula moviendo
-- `expires_at` y `updated_at` respecto del reloj. Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(362);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table inv_ids (name text primary key, id uuid not null) on commit drop;
create temporary sequence inv_claves;

create function pg_temp.id(p_name text) returns uuid language sql as $$
  select id from inv_ids where name = p_name
$$;

create function pg_temp.usuario(p_name text, p_anonimo boolean default true) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,is_anonymous,created_at,updated_at)
  values (v_id,'authenticated','authenticated',
    case when p_anonimo then null else 'inv-' || replace(p_name, ':', '-') || '@example.invalid' end,
    '', case when p_anonimo then null else now() end, '{}','{}', p_anonimo, now(), now());
  insert into inv_ids values (p_name, v_id);
  return v_id;
end $$;

-- Un comercio verificado y abierto, con retiro y envío (envío 500, sin mínimo, sin
-- exigir cobertura ni horario), el guardián de admisión apagado, dos productos
-- (lata 1000, agua 500), un combo del 10 % sobre lata + agua y Mercado Pago de prueba
-- con el vendedor conectado. Dueño y operador con su sesión de Panel, y los clientes
-- anónimos p_clave:c1 .. p_clave:cN.
create function pg_temp.negocio(p_key text, p_stock integer, p_clientes integer default 2) returns void language plpgsql as $$
declare
  v_business uuid := gen_random_uuid();
  v_lata uuid := gen_random_uuid();
  v_agua uuid := gen_random_uuid();
  v_combo uuid := gen_random_uuid();
  v_owner uuid := pg_temp.usuario(p_key || ':owner', false);
  v_staff uuid := pg_temp.usuario(p_key || ':staff', false);
  v_owner_session uuid := gen_random_uuid();
  v_staff_session uuid := gen_random_uuid();
  v_slug text := 'inv-' || p_key || '-' || right(replace(v_business::text, '-', ''), 8);
begin
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified, ordering_verified_at, ordering_verified_by,
    currency_code, pickup_enabled, delivery_enabled, delivery_fee, minimum_delivery_subtotal,
    hours_enforced, delivery_zone_enforced, order_intake_guard_mode
  ) values (
    v_business, 'TABA invariantes ' || p_key, v_slug, 'open', true, true, true, clock_timestamp(), v_owner,
    'ARS', true, true, 500.00, 0.00, false, false, 'off'
  );
  insert into public.business_members(business_id,user_id,role,is_active)
  values (v_business, v_owner, 'owner', true), (v_business, v_staff, 'staff', true);
  insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
  values (v_owner_session, v_owner, v_business, 'owner', 'panel_web'),
         (v_staff_session, v_staff, v_business, 'staff', 'panel_web');

  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values
    (v_lata,v_business,'Lata ' || p_key,'Gaseosas','Cola',1000,'confirmed',true,'Marca',
     'Lata','Lata',473,'ml','473 ml','lata',p_stock,true,true,false,'{}',true,now(),v_owner,
     v_slug || '-lata',v_slug || '-lata','commercial',1),
    (v_agua,v_business,'Agua ' || p_key,'Aguas','Sin gas',500,'confirmed',true,'Marca',
     'Botella','Botella',500,'ml','500 ml','botella',p_stock,true,true,false,'{}',true,now(),v_owner,
     v_slug || '-agua',v_slug || '-agua','commercial',1);

  insert into public.product_combos(id,business_id,combo_id,name,discount_percentage,approval_status,approved_at,is_active)
  values (v_combo, v_business, 'combo-invariantes', 'Combo Invariantes', 10, 'APROBADO_COMERCIAL', now(), true);
  insert into public.product_combo_components(combo_id,product_id,quantity,sort_order)
  values (v_combo, v_lata, 1, 1), (v_combo, v_agua, 1, 2);

  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'collector-' || p_key, 'app-' || p_key, clock_timestamp(), clock_timestamp());
  -- El vendedor conectado por OAuth: sin él la autoridad V2 no deja asentar la preferencia.
  insert into public.mp_seller_connections(business_id,environment,seller_id,application_id,status,protected_tokens,expires_at)
  values (v_business,'test','collector-' || p_key,'app-' || p_key,'connected','ciphertext-only-local-fixture',now() + interval '2 days');

  insert into inv_ids values
    (p_key, v_business), (p_key || ':lata', v_lata), (p_key || ':agua', v_agua),
    (p_key || ':owner:sesion', v_owner_session), (p_key || ':staff:sesion', v_staff_session);
  perform pg_temp.usuario(p_key || ':c' || g) from generate_series(1, p_clientes) g;
end $$;

create function pg_temp.linea(p_producto text, p_cantidad integer) returns jsonb language sql as $$
  select jsonb_build_object('product_id', pg_temp.id(p_producto), 'quantity', p_cantidad)
$$;
create function pg_temp.combo(p_cantidad integer) returns jsonb language sql as $$
  select jsonb_build_object('combo_id', 'combo-invariantes', 'quantity', p_cantidad)
$$;

-- ── La puerta manual: `create_order_with_items`, como el cliente ─────────────
-- El pedido que manda la tienda: retiro en efectivo. p_extra agrega o pisa claves.
create function pg_temp.pedido_json(p_negocio text, p_clave text, p_items jsonb, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'business_id', pg_temp.id(p_negocio),
    'client_request_id', p_clave,
    'tracking_token', md5(p_clave) || md5(p_clave || ':seguimiento'),
    'items', p_items,
    'customer_name', 'Cliente Invariantes',
    'customer_phone', '2996209137',
    'delivery_mode', 'pickup',
    'payment_method', 'cash') || p_extra
$$;
-- La dirección de un envío con su punto confirmado en el mapa.
create function pg_temp.envio_json() returns jsonb language sql as $$
  select jsonb_build_object(
    'delivery_mode', 'delivery',
    'customer_street_address', 'Rio Senguer 1234',
    'customer_neighborhood', 'Centro',
    'delivery_latitude', '-38.9540', 'delivery_longitude', '-68.0600',
    'delivery_location_source', 'map_pin', 'delivery_location_confirmed_at', clock_timestamp()::text)
$$;
-- Llama a la RPC con el rol y el token de un cliente anónimo autenticado, y después
-- hace lo que haría el COMMIT de esa llamada (los triggers diferidos de `orders`).
-- Devuelve 'ok <id del pedido>' o '<SQLSTATE> <mensaje>': un resultado inesperado es
-- una aserción roja, no un archivo abortado. Si falla, no queda nada escrito.
create function pg_temp.pedir(p_cliente text, p_payload jsonb) returns text language plpgsql as $$
declare
  v_claims text := json_build_object('sub', pg_temp.id(p_cliente), 'role', 'authenticated', 'is_anonymous', true)::text;
  v_result jsonb;
  v_out text;
begin
  begin
    perform set_config('request.jwt.claims', v_claims, true);
    set local role authenticated;
    v_result := public.create_order_with_items(p_payload);
    set constraints all immediate;
    set constraints all deferred;
    v_out := 'ok ' || coalesce(v_result ->> 'id', '(sin id) ' || v_result::text);
  exception when others then
    v_out := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end $$;
create function pg_temp.pedido(p_negocio text, p_clave text) returns uuid language sql as $$
  select o.id from public.orders o where o.business_id = pg_temp.id(p_negocio) and o.client_request_id = p_clave
$$;

-- ── La puerta de Mercado Pago: `create_checkout_session`, como la Edge Function ─
create function pg_temp.checkout_json(p_negocio text, p_clave text, p_items jsonb, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'business_id', pg_temp.id(p_negocio),
    'client_request_id', p_clave,
    'items', p_items,
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Cliente Invariantes', 'phone', '5492990000000'),
    'age_confirmed', false,
    'payment_method', 'mercadopago') || p_extra
$$;
create function pg_temp.domicilio_json() returns jsonb language sql as $$
  select jsonb_build_object('fulfillment_type', 'delivery', 'address', jsonb_build_object(
    'street', 'Rio Senguer', 'street_number', '1234', 'city', 'Neuquen', 'neighborhood', 'Centro',
    'latitude', '-38.9540', 'longitude', '-68.0600',
    'location_source', 'map_pin', 'location_confirmed_at', clock_timestamp()::text))
$$;
-- Con la clave de servicio. Devuelve 'ok <id de la sesión>' o '<SQLSTATE> <mensaje>'.
create function pg_temp.checkout(p_cliente text, p_payload jsonb) returns text language plpgsql as $$
declare
  v_customer uuid := pg_temp.id(p_cliente);
  v_result jsonb;
  v_out text;
begin
  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set local role service_role;
    v_result := public.create_checkout_session(v_customer, p_payload);
    v_out := 'ok ' || coalesce(v_result ->> 'checkout_session_id', '(sin id) ' || v_result::text);
  exception when others then
    v_out := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end $$;

-- Crea la sesión por la puerta y la guarda como p_nombre (y su intent como
-- p_nombre:intent). Con p_preferencia asienta además la preferencia por el camino V2
-- de la Edge Function: el comprador queda en Checkout Pro.
create function pg_temp.sesion_nueva(p_nombre text, p_negocio text, p_cliente text, p_items jsonb,
  p_extra jsonb default '{}'::jsonb, p_preferencia boolean default true)
returns text language plpgsql as $$
declare
  v_out text := pg_temp.checkout(p_cliente, pg_temp.checkout_json(p_negocio, 'inv_' || md5(p_nombre), p_items, p_extra));
  v_session uuid;
  v_customer uuid := pg_temp.id(p_cliente);
  v_business uuid := pg_temp.id(p_negocio);
  v_prepare jsonb;
begin
  if v_out not like 'ok %' then
    return v_out;
  end if;
  v_session := substr(v_out, 4)::uuid;
  insert into inv_ids values (p_nombre, v_session);
  insert into inv_ids select p_nombre || ':intent', pi.id from public.payment_intents pi where pi.checkout_session_id = v_session;
  if p_preferencia then
    v_prepare := public.prepare_mercadopago_preference_v2(v_session, v_customer, false);
    perform public.record_mercadopago_preference_created_v2(
      v_business, 'test', v_session, v_customer, (v_prepare ->> 'payment_attempt_id')::uuid,
      public.get_mercadopago_payment_authority_v2(v_business, 'test', v_session, v_customer,
        (v_prepare ->> 'payment_attempt_id')::uuid) ->> 'authority_version',
      'PREF-' || p_nombre,
      'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=' || p_nombre,
      'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=' || p_nombre,
      encode(digest('pref-' || p_nombre, 'sha256'), 'hex'), 'req-' || p_nombre);
  end if;
  return 'ok';
end $$;

-- Lo que el worker persiste después de leer el pago en Mercado Pago. p_semilla
-- decide el hash de la respuesta: misma semilla = misma respuesta del proveedor.
create function pg_temp.pago(p_nombre text, p_pago text, p_estado text, p_semilla text, p_cambios jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
      'provider_payment_id', p_pago,
      'external_reference', pi.external_reference,
      'preference_id', pi.preference_id,
      'merchant_order_id', 'MO-' || p_pago,
      'collector_id', ps.collector_id,
      'application_id', '',
      'currency', 'ARS',
      'transaction_amount', cs.total::text,
      'status', p_estado,
      'status_detail', 'detalle_de_prueba',
      'payment_method', 'visa',
      'live_mode', false,
      'provider_occurred_at', clock_timestamp()::text,
      'refunded_amount', '0.00',
      'payer_email_hash', repeat('e', 64),
      'raw_response_hash', encode(digest(p_semilla, 'sha256'), 'hex')) || p_cambios
    from public.payment_intents pi
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
    join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.provider = 'mercadopago'
   where pi.checkout_session_id = pg_temp.id(p_nombre)
$$;
-- Registra el snapshot con la clave de servicio. Devuelve la respuesta de la función
-- (sin el id del intent) o {"error": SQLSTATE, "message": ...}.
create function pg_temp.registrar(p_nombre text, p_snapshot jsonb, p_origen text default 'webhook') returns jsonb language plpgsql as $$
declare
  v_intent uuid := pg_temp.id(p_nombre || ':intent');
  v_result jsonb;
begin
  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set local role service_role;
    v_result := public.record_mercadopago_payment_snapshot(v_intent, p_snapshot, p_origen, null) - 'payment_intent_id';
  exception when others then
    v_result := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end $$;
-- Finaliza con la clave de servicio y hace lo que haría el COMMIT del worker: correr
-- los triggers diferidos de `orders`. Devuelve la respuesta o {"error", "message"}.
create function pg_temp.finalizar(p_session uuid) returns jsonb language plpgsql as $$
declare v_result jsonb;
begin
  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set local role service_role;
    v_result := public.finalize_paid_checkout_session(p_session);
    set constraints all immediate;
    set constraints all deferred;
  exception when others then
    v_result := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end $$;
-- Una expresión jsonb cualquiera con la clave de servicio.
create function pg_temp.servicio(p_sql text) returns jsonb language plpgsql as $$
declare v_result jsonb;
begin
  begin
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set local role service_role;
    execute 'select ' || p_sql into v_result;
  exception when others then
    v_result := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end $$;

create function pg_temp.sesion(p_nombre text) returns public.checkout_sessions language sql as $$
  select s from public.checkout_sessions s where s.id = pg_temp.id(p_nombre)
$$;
create function pg_temp.intent(p_nombre text) returns public.payment_intents language sql as $$
  select pi from public.payment_intents pi where pi.checkout_session_id = pg_temp.id(p_nombre)
$$;
-- La sesión y sus reservas vencieron hace un minuto.
create function pg_temp.vencer(p_nombre text) returns void language plpgsql as $$
begin
  update public.checkout_sessions
     set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 minute'
   where id = pg_temp.id(p_nombre);
  update public.inventory_reservations
     set created_at = clock_timestamp() - interval '2 hours', expires_at = clock_timestamp() - interval '1 minute'
   where checkout_session_id = pg_temp.id(p_nombre);
end $$;
-- La sesión y su intent no se tocan desde hace p_hace. `updated_at` lo pone un
-- trigger: se lo apaga sólo para este UPDATE.
create function pg_temp.envejecer(p_nombre text, p_hace interval) returns void language plpgsql as $$
begin
  alter table public.checkout_sessions disable trigger checkout_sessions_set_updated_at;
  alter table public.payment_intents disable trigger payment_intents_set_updated_at;
  update public.checkout_sessions set updated_at = clock_timestamp() - p_hace where id = pg_temp.id(p_nombre);
  -- La aprobación envejece junto con la última escritura: la alerta de «pago aprobado
  -- sin pedido» mide desde `approved_at` (20261001222000).
  update public.payment_intents
     set updated_at = clock_timestamp() - p_hace,
         approved_at = case when approved_at is not null then clock_timestamp() - p_hace end
   where checkout_session_id = pg_temp.id(p_nombre);
  alter table public.checkout_sessions enable trigger checkout_sessions_set_updated_at;
  alter table public.payment_intents enable trigger payment_intents_set_updated_at;
end $$;

-- ── El Panel: un integrante del comercio con su sesión ───────────────────────
-- Ejecuta p_sql (una expresión jsonb) con el rol authenticated y el token de p_actor.
-- Devuelve el jsonb o {"error": SQLSTATE, "message": ...}.
create function pg_temp.panel(p_actor text, p_sql text) returns jsonb language plpgsql as $$
declare
  v_claims text := json_build_object('sub', pg_temp.id(p_actor), 'role', 'authenticated',
    'session_id', pg_temp.id(p_actor || ':sesion'))::text;
  v_result jsonb;
begin
  begin
    perform set_config('request.jwt.claims', v_claims, true);
    set local role authenticated;
    execute 'select ' || p_sql into v_result;
  exception when others then
    v_result := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_result;
end $$;
-- `transition_order` de verdad. Sin p_revision usa la vigente; sin p_clave, una nueva.
-- Devuelve 'ok <estado> rev <n>' (+ ' no_op', + ' replay') o '<SQLSTATE> <mensaje>'.
create function pg_temp.mover(p_actor text, p_order uuid, p_destino text, p_revision bigint default null, p_clave text default null)
returns text language plpgsql as $$
declare
  v jsonb := pg_temp.panel(p_actor, format('public.transition_order(%L, %s, %L, %L)', p_order,
    coalesce(p_revision, (select o.revision from public.orders o where o.id = p_order), 1), p_destino,
    coalesce(p_clave, 'inv-mover-' || lpad(nextval('inv_claves')::text, 6, '0'))));
begin
  if v ? 'error' then
    return (v ->> 'error') || ' ' || (v ->> 'message');
  end if;
  return 'ok ' || (v ->> 'status') || ' rev ' || (v ->> 'revision')
    || case when (v ->> 'idempotent_no_op')::boolean then ' no_op' else '' end
    || case when (v ->> 'idempotent_replay')::boolean then ' replay' else '' end;
end $$;
-- Un ensayo: intenta la transición con la revisión vigente y la deshace siempre.
-- Devuelve 'si' (permitida), 'igual' (no-op) o el SQLSTATE del rechazo.
create function pg_temp.ensayo(p_actor text, p_order uuid, p_destino text) returns text language plpgsql as $$
declare
  v_claims text := json_build_object('sub', pg_temp.id(p_actor), 'role', 'authenticated',
    'session_id', pg_temp.id(p_actor || ':sesion'))::text;
  v_revision bigint := (select o.revision from public.orders o where o.id = p_order);
  v_clave text := 'inv-ensayo-' || lpad(nextval('inv_claves')::text, 6, '0');
  v_result jsonb;
  v_out text;
begin
  begin
    perform set_config('request.jwt.claims', v_claims, true);
    set local role authenticated;
    v_result := public.transition_order(p_order, v_revision, p_destino, v_clave);
    raise exception using errcode = 'TB001',
      message = case when (v_result ->> 'idempotent_no_op')::boolean then 'igual' else 'si' end;
  exception
    when sqlstate 'TB001' then v_out := sqlerrm;
    when others then v_out := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end $$;
-- La fila de la matriz para el estado en que está el pedido.
create function pg_temp.fila(p_actor text, p_order uuid) returns text language sql as $$
  select string_agg(d || '=' || pg_temp.ensayo(p_actor, p_order, d), ' ' order by n)
    from unnest(array['received','accepted','preparing','ready','assigned','picked_up','on_the_way','arrived','delivered','cancelled','rejected'])
         with ordinality as t(d, n)
$$;
create function pg_temp.cobrar(p_actor text, p_order uuid, p_revision bigint, p_medio text, p_clave text) returns jsonb language sql as $$
  select pg_temp.panel(p_actor, format('public.confirm_manual_order_payment(%L, %s, %L, %L)', p_order, p_revision, p_medio, p_clave))
$$;

-- ── Escritura directa, la que sólo puede hacer la clave de servicio ──────────
-- Ejecuta una sentencia con un rol y después lo que haría el COMMIT. Devuelve 'ok' o
-- '<SQLSTATE> <mensaje>'; si falla, no queda nada escrito. 'dueno' es el rol con que
-- corre la prueba.
create function pg_temp.confirmar(p_role text, p_sql text) returns text language plpgsql as $$
declare v_out text;
begin
  begin
    if p_role <> 'dueno' then
      execute format('set local role %I', p_role);
    end if;
    execute p_sql;
    set constraints all immediate;
    v_out := 'ok';
  exception when others then
    v_out := sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  set constraints all deferred;
  return v_out;
end $$;
-- El INSERT de un pedido de retiro en efectivo por 1000, sin renglones. p_cambios
-- pisa columnas (un null de JSON es NULL).
create function pg_temp.fila_pedido(p_negocio text, p_codigo text, p_cambios jsonb default '{}'::jsonb) returns text language sql as $$
  select format('insert into public.orders (%s) values (%s)',
           string_agg(quote_ident(c.key), ', ' order by c.key),
           string_agg(case when jsonb_typeof(c.value) = 'null' then 'null' else quote_literal(c.value #>> '{}') end, ', ' order by c.key))
    from jsonb_each(jsonb_build_object(
      'business_id', pg_temp.id(p_negocio), 'code', p_codigo, 'public_code', p_codigo,
      'status', 'received', 'fulfillment_type', 'pickup', 'delivery_mode', 'pickup',
      'client_request_id', 'inv-directo-' || lower(p_codigo),
      'customer_name', 'Cliente Directo', 'customer_phone', '2996209139',
      'payment_method', 'cash', 'subtotal', 1000, 'discount_total', 0, 'delivery_fee', 0, 'total', 1000,
      'currency_code', 'ARS') || p_cambios) c
$$;

-- ── Fotos para comprobar que un rechazo no escribió nada ─────────────────────
-- Todo lo que una alta, un cobro o una transición pueden escribir en un comercio.
create function pg_temp.foto(p_negocio text) returns text language sql as $$
  select concat_ws(' ',
    'pedidos=' || (select count(*) from public.orders o where o.business_id = pg_temp.id(p_negocio)),
    'renglones=' || (select count(*) from public.order_items i join public.orders o on o.id = i.order_id where o.business_id = pg_temp.id(p_negocio)),
    'eventos=' || (select count(*) from public.order_events e where e.business_id = pg_temp.id(p_negocio)),
    'recibos=' || (select count(*) from public.business_command_receipts r where r.business_id = pg_temp.id(p_negocio)),
    'sesiones=' || (select count(*) from public.checkout_sessions s where s.business_id = pg_temp.id(p_negocio)),
    'intents=' || (select count(*) from public.payment_intents pi where pi.business_id = pg_temp.id(p_negocio)),
    'reservas=' || (select count(*) filter (where r.status = 'active') || 'a+' || count(*) filter (where r.status = 'converted') || 'c+'
                      || count(*) filter (where r.status = 'released') || 'l'
                      from public.inventory_reservations r join public.checkout_sessions s on s.id = r.checkout_session_id
                     where s.business_id = pg_temp.id(p_negocio)),
    'eventos_pago=' || (select count(*) from public.payment_events pe join public.payment_intents pi on pi.id = pe.payment_intent_id
                         where pi.business_id = pg_temp.id(p_negocio)),
    'lata=' || (select p.stock from public.products p where p.id = pg_temp.id(p_negocio || ':lata')),
    'agua=' || (select p.stock from public.products p where p.id = pg_temp.id(p_negocio || ':agua')))
$$;
-- El dinero de un pedido como quedó guardado, contra sus renglones y sus combos.
create function pg_temp.importe(p_order uuid) returns text language sql as $$
  select concat_ws(' ', 'subtotal=' || o.subtotal, 'descuento=' || o.discount_total, 'envio=' || o.delivery_fee, 'total=' || o.total,
    'renglones=' || (select coalesce(sum(i.subtotal), 0) from public.order_items i where i.order_id = o.id),
    'combos=' || (select coalesce(sum(c.discount_amount), 0) from public.order_combos c where c.order_id = o.id))
    from public.orders o where o.id = p_order
$$;
create function pg_temp.estado(p_order uuid) returns text language sql as $$
  select o.status || ' rev ' || o.revision from public.orders o where o.id = p_order
$$;
-- Dónde quedó una sesión: estado, motivo de revisión, intent, proveedor, lo cobrado,
-- si tiene pedido y sus reservas.
create function pg_temp.resumen(p_nombre text) returns text language sql as $$
  select concat_ws(' ', 'sesion=' || s.status, 'motivo=' || coalesce(s.manual_review_reason, '-'), 'intent=' || pi.internal_status,
    'proveedor=' || coalesce(pi.provider_status, '-'), 'cobrado=' || coalesce(pi.paid_amount::text, '-'),
    'pedido=' || (s.completed_order_id is not null),
    'reservas=' || (select coalesce(string_agg(r.status, ',' order by r.reservation_generation, r.product_id), '-')
                      from public.inventory_reservations r where r.checkout_session_id = s.id))
    from public.checkout_sessions s join public.payment_intents pi on pi.checkout_session_id = s.id where s.id = pg_temp.id(p_nombre)
$$;
create function pg_temp.pago_del_pedido(p_order uuid) returns text language sql as $$
  select concat_ws(' ', 'medio=' || o.payment_method, 'manual=' || coalesce(o.manual_payment_status, 'NULL'),
    'estado=' || private.order_payment_state(o))
    from public.orders o where o.id = p_order
$$;
create function pg_temp.cobro(p_order uuid) returns text language sql as $$
  select concat_ws(' ', 'manual=' || coalesce(o.manual_payment_status, 'NULL'), 'medio=' || coalesce(o.manual_payment_method, '-'),
    'rev=' || o.revision,
    'eventos=' || (select count(*) from public.order_events e where e.order_id = o.id and e.event_type = 'order.manual_payment_confirmed'),
    'recibos=' || (select count(*) from public.business_command_receipts r where r.order_id = o.id and r.command_type = 'confirm_manual_order_payment'))
    from public.orders o where o.id = p_order
$$;

-- ── Operaciones: lo que mira quien tiene que enterarse ───────────────────────
-- La reconciliación de alertas de un comercio, con la clave de servicio: es la función
-- que el barrido `taba-operational-alerts-sweep` llama por cada comercio.
create function pg_temp.reconciliar(p_negocio text) returns text language plpgsql as $$
declare v jsonb := pg_temp.servicio(format('to_jsonb(public.reconcile_operational_alerts_for_business(%L))', pg_temp.id(p_negocio)));
begin
  return case when jsonb_typeof(v) = 'number' then 'ok' else (v ->> 'error') || ' ' || (v ->> 'message') end;
end $$;
create function pg_temp.alerta(p_negocio text, p_codigo text, p_sujeto uuid) returns text language sql as $$
  select coalesce((select a.severity || ' ' || a.status || ' ' || a.subject_type from public.operational_alerts a
                    where a.business_id = pg_temp.id(p_negocio) and a.alert_code = p_codigo and a.subject_id = p_sujeto), '(no hay)')
$$;
-- Cómo figura una sesión en `list_unfinalized_paid_checkouts`.
create function pg_temp.sin_finalizar(p_nombre text) returns text language plpgsql as $$
declare v jsonb := pg_temp.servicio(format(
  '(select to_jsonb(concat_ws('' '', l.severity, l.pipeline_state, l.total, l.action)) from public.list_unfinalized_paid_checkouts() l where l.checkout_session_id = %L)',
  pg_temp.id(p_nombre)));
begin
  return case when v is null then '(no figura)' when jsonb_typeof(v) = 'string' then v #>> '{}'
    else (v ->> 'error') || ' ' || (v ->> 'message') end;
end $$;

-- ── Casos de rechazo, de a uno, con la comprobación de que no escribieron ────
create temporary table inv_casos (
  n serial primary key, grupo text not null, puerta text not null, negocio text not null, actor text not null,
  payload jsonb, pedido uuid, revision bigint, destino text, esperado text not null, que text not null
) on commit drop;
-- Por cada caso del grupo: la respuesta exacta, y la foto del comercio igual que antes.
--   puerta 'manual'      create_order_with_items como el cliente
--   puerta 'checkout'    create_checkout_session con la clave de servicio
--   puerta 'transicion'  transition_order como un integrante del comercio
create function pg_temp.rechazos(p_grupo text) returns setof text language plpgsql as $$
declare
  c record;
  v_antes text;
  v_resultado text;
begin
  for c in select * from inv_casos where grupo = p_grupo order by n loop
    v_antes := pg_temp.foto(c.negocio) || coalesce(' | ' || pg_temp.estado(c.pedido), '');
    v_resultado := case c.puerta
      when 'manual' then pg_temp.pedir(c.actor, c.payload)
      when 'checkout' then pg_temp.checkout(c.actor, c.payload)
      when 'transicion' then pg_temp.mover(c.actor, c.pedido, c.destino, c.revision)
    end;
    return next is(v_resultado, c.esperado, c.que);
    return next is(pg_temp.foto(c.negocio) || coalesce(' | ' || pg_temp.estado(c.pedido), ''), v_antes,
      c.que || ' · no escribio nada');
  end loop;
end $$;
-- La finalización de una sesión sin cobro aprobado: la respuesta, y la sesión y el
-- comercio igual que antes.
create function pg_temp.no_finaliza(p_nombre text, p_negocio text, p_esperado text, p_que text) returns setof text language plpgsql as $$
declare
  v_antes text := pg_temp.resumen(p_nombre) || ' | ' || pg_temp.foto(p_negocio);
  v jsonb := pg_temp.finalizar(pg_temp.id(p_nombre));
begin
  return next is(coalesce((v ->> 'error') || ' ' || (v ->> 'message'), v::text), p_esperado, p_que);
  return next is(pg_temp.resumen(p_nombre) || ' | ' || pg_temp.foto(p_negocio), v_antes, p_que || ' · no escribio nada');
end $$;

select pg_temp.negocio('a', 10);
select pg_temp.negocio('b', 50, 4);
select pg_temp.negocio('c', 20);
select pg_temp.negocio('d', 20);
select pg_temp.negocio('e', 20);
select pg_temp.negocio('f', 20);
select pg_temp.negocio('g', 20, 6);
select pg_temp.negocio('h', 20, 4);
select pg_temp.negocio('i', 20);
select pg_temp.negocio('j', 20);
select pg_temp.negocio('k', 50);

-- ══════════════════════════════════════════════════════════════════════════
--  0 · LOS RESPALDOS ESTÁN PUESTOS
-- ══════════════════════════════════════════════════════════════════════════
select is(
  (select string_agg(t.name, ', ' order by t.name)
     from unnest(array['public.orders', 'public.order_items', 'public.order_combos', 'public.checkout_sessions',
                       'public.payment_intents', 'public.inventory_reservations']) t(name),
          unnest(array['anon', 'authenticated']) r(rol)
    where has_table_privilege(r.rol, t.name, 'INSERT') or has_table_privilege(r.rol, t.name, 'UPDATE')
       or has_table_privilege(r.rol, t.name, 'DELETE') or has_table_privilege(r.rol, t.name, 'TRUNCATE')),
  null, 'ni anon ni authenticated escriben pedidos, renglones, sesiones, cobros o reservas: solo por las RPC');
select is(
  (select string_agg(c.conname, ', ' order by c.conname) from pg_constraint c
    where c.connamespace = 'public'::regnamespace
      and c.conname in ('orders_total_matches_parts', 'order_items_subtotal_matches_parts', 'checkout_sessions_money_check',
                        'orders_payment_method_valid', 'orders_manual_payment_consistent',
                        'payment_intents_checkout_session_id_key', 'checkout_sessions_business_id_customer_id_client_request_id_key')),
  'checkout_sessions_business_id_customer_id_client_request_id_key, checkout_sessions_money_check, order_items_subtotal_matches_parts, orders_manual_payment_consistent, orders_payment_method_valid, orders_total_matches_parts, payment_intents_checkout_session_id_key',
  'las restricciones que respaldan el total, el medio de pago, un cobro por sesion y una sesion por clave existen');
select is(
  (select string_agg(i.indexname, ', ' order by i.indexname) from pg_indexes i
    where i.schemaname = 'public' and i.indexdef like 'CREATE UNIQUE INDEX%'
      and i.indexname in ('orders_business_client_request_key', 'payment_intents_provider_payment_key')),
  'orders_business_client_request_key, payment_intents_provider_payment_key',
  'y los indices unicos de un pedido por clave y un intent por pago del proveedor');
select is(
  (select concat_ws(' ', t.tgdeferrable, t.tginitdeferred, t.tgenabled, pg_get_triggerdef(t.oid) ~ 'AFTER INSERT OR UPDATE OF payment_method')
     from pg_trigger t where t.tgrelid = 'public.orders'::regclass and t.tgname = 'orders_assert_payment_modality'),
  't t O t', 'orders_assert_payment_modality es un trigger de restriccion diferido, encendido, sobre el alta y el cambio de medio de pago');

-- ══════════════════════════════════════════════════════════════════════════
--  A · NO NACE UN PEDIDO NI UNA SESIÓN SIN RENGLONES
-- ══════════════════════════════════════════════════════════════════════════
select is(pg_temp.foto('a'),
  'pedidos=0 renglones=0 eventos=0 recibos=0 sesiones=0 intents=0 reservas=0a+0c+0l eventos_pago=0 lata=10 agua=10',
  'A: punto de partida del comercio');

insert into inv_casos (grupo, puerta, negocio, actor, payload, esperado, que) values
  ('A', 'manual', 'a', 'a:c1', pg_temp.pedido_json('a', 'inv-sin-renglon-01', '[]'),
    '22023 items debe contener entre 1 y 100 productos', 'A manual: items vacio'),
  ('A', 'manual', 'a', 'a:c1', pg_temp.pedido_json('a', 'inv-sin-renglon-02', '[]') - 'items',
    '22023 items debe contener entre 1 y 100 productos', 'A manual: sin la clave items'),
  ('A', 'manual', 'a', 'a:c1', pg_temp.pedido_json('a', 'inv-sin-renglon-03', 'null'),
    '22023 items debe contener entre 1 y 100 productos', 'A manual: items en null'),
  ('A', 'manual', 'a', 'a:c1', pg_temp.pedido_json('a', 'inv-sin-renglon-04', pg_temp.linea('a:lata', 1)),
    '22023 items debe contener entre 1 y 100 productos', 'A manual: items es un objeto (un renglon suelto) y no una lista'),
  ('A', 'manual', 'a', 'a:c1', pg_temp.pedido_json('a', 'inv-sin-renglon-05', '"lata"'),
    '22023 items debe contener entre 1 y 100 productos', 'A manual: items es un texto'),
  ('A', 'manual', 'a', 'a:c1', pg_temp.pedido_json('a', 'inv-sin-renglon-06', '3'),
    '22023 items debe contener entre 1 y 100 productos', 'A manual: items es un numero'),
  ('A', 'manual', 'a', 'a:c1', pg_temp.pedido_json('a', 'inv-sin-renglon-07', '[{}]'),
    '22023 cada item acepta solo product_id UUID y quantity entero', 'A manual: un renglon vacio'),
  ('A', 'manual', 'a', 'a:c1', pg_temp.pedido_json('a', 'inv-sin-renglon-09',
      (select jsonb_agg(pg_temp.linea('a:lata', 1)) from generate_series(1, 101))),
    '22023 items debe contener entre 1 y 100 productos', 'A manual: 101 renglones'),
  ('A', 'checkout', 'a', 'a:c1', pg_temp.checkout_json('a', 'inv-sin-renglon-11', '[]'),
    '22023 items debe contener entre 1 y 100 productos', 'A checkout: items vacio'),
  ('A', 'checkout', 'a', 'a:c1', pg_temp.checkout_json('a', 'inv-sin-renglon-12', '[]') - 'items',
    '22023 items debe contener entre 1 y 100 productos', 'A checkout: sin la clave items'),
  ('A', 'checkout', 'a', 'a:c1', pg_temp.checkout_json('a', 'inv-sin-renglon-13', 'null'),
    '22023 items debe contener entre 1 y 100 productos', 'A checkout: items en null'),
  ('A', 'checkout', 'a', 'a:c1', pg_temp.checkout_json('a', 'inv-sin-renglon-14', pg_temp.linea('a:lata', 1)),
    '22023 items debe contener entre 1 y 100 productos', 'A checkout: items es un objeto y no una lista'),
  ('A', 'checkout', 'a', 'a:c1', pg_temp.checkout_json('a', 'inv-sin-renglon-15', '"lata"'),
    '22023 items debe contener entre 1 y 100 productos', 'A checkout: items es un texto'),
  ('A', 'checkout', 'a', 'a:c1', pg_temp.checkout_json('a', 'inv-sin-renglon-17', '[{}]'),
    '22023 cada item acepta product_id UUID o combo_id, con quantity entero', 'A checkout: un renglon vacio'),
  ('A', 'checkout', 'a', 'a:c1', pg_temp.checkout_json('a', 'inv-sin-renglon-19',
      (select jsonb_agg(pg_temp.linea('a:lata', 1)) from generate_series(1, 101))),
    '22023 items debe contener entre 1 y 100 productos', 'A checkout: 101 renglones');
select * from pg_temp.rechazos('A');

-- Control: el mismo payload con un renglón sí entra, por las dos puertas.
select matches(pg_temp.pedir('a:c1', pg_temp.pedido_json('a', 'inv-con-renglon-01', jsonb_build_array(pg_temp.linea('a:lata', 1)))),
  '^ok [0-9a-f-]{36}$', 'A manual: con un renglon el pedido nace');
select matches(pg_temp.checkout('a:c1', pg_temp.checkout_json('a', 'inv-con-renglon-11', jsonb_build_array(pg_temp.linea('a:lata', 1)))),
  '^ok [0-9a-f-]{36}$', 'A checkout: con un renglon la sesion nace');
select is(pg_temp.foto('a'),
  'pedidos=1 renglones=1 eventos=1 recibos=0 sesiones=1 intents=1 reservas=1a+0c+0l eventos_pago=1 lata=8 agua=10',
  'A: un pedido con su renglon, una sesion con su reserva, dos unidades menos');

-- El esquema. Borrar el renglón de un pedido se rechaza (lo prueba
-- order_money_snapshot_immutable_test.sql), pero nada exige que un pedido nazca con uno.
-- LIMITACION (PRICE-03): debería rechazarse; hoy la base acepta la cabecera sola. Sólo
-- la clave de servicio o el dueño de la base pueden hacer este INSERT.
select is(pg_temp.confirmar('service_role', pg_temp.fila_pedido('a', 'INV-A-SIN-RENGLON')), 'ok',
  'LIMITACION A: con la clave de servicio, un pedido de 1000 sin ningun renglon se acepta y confirma (no hay restriccion de al menos un renglon)');
select is(pg_temp.importe(pg_temp.pedido('a', 'inv-directo-inv-a-sin-renglon')),
  'subtotal=1000.00 descuento=0.00 envio=0.00 total=1000.00 renglones=0 combos=0',
  'LIMITACION A: y queda con subtotal 1000 y cero renglones');

-- ══════════════════════════════════════════════════════════════════════════
--  B · EL TOTAL LO CALCULA EL SERVIDOR Y CIERRA CON SUS PARTES
-- ══════════════════════════════════════════════════════════════════════════
-- Retiro en efectivo: 2 latas + 3 aguas.
select matches(pg_temp.pedir('b:c1', pg_temp.pedido_json('b', 'inv-total-retiro-01',
    jsonb_build_array(pg_temp.linea('b:lata', 2), pg_temp.linea('b:agua', 3)))),
  '^ok ', 'B: el pedido de retiro nace');
select is(pg_temp.importe(pg_temp.pedido('b', 'inv-total-retiro-01')),
  'subtotal=3500.00 descuento=0.00 envio=0.00 total=3500.00 renglones=3500.00 combos=0',
  'B retiro: 2 x 1000 + 3 x 500 = 3500, sin envio; el subtotal es la suma de los renglones');
-- Envío en efectivo: la lata viene en dos renglones (2 + 1) y se consolida.
select matches(pg_temp.pedir('b:c2', pg_temp.pedido_json('b', 'inv-total-envio-01',
    jsonb_build_array(pg_temp.linea('b:lata', 2), pg_temp.linea('b:agua', 1), pg_temp.linea('b:lata', 1)), pg_temp.envio_json())),
  '^ok ', 'B: el pedido de envio nace');
select is(pg_temp.importe(pg_temp.pedido('b', 'inv-total-envio-01')),
  'subtotal=3500.00 descuento=0.00 envio=500.00 total=4000.00 renglones=3500.00 combos=0',
  'B envio: 3 x 1000 + 1 x 500 = 3500, mas 500 de envio que pone el comercio = 4000');
select is(
  (select string_agg(i.name || ' x ' || trim_scale(i.quantity) || ' = ' || i.subtotal, ', ' order by i.name)
     from public.order_items i where i.order_id = pg_temp.pedido('b', 'inv-total-envio-01')),
  'Agua b x 1 = 500.00, Lata b x 3 = 3000.00', 'B envio: la lata repetida queda en un solo renglon de 3');

-- Mercado Pago, envío, una lata suelta y dos combos (lata + agua al 10 %, redondeo a 100).
select is(pg_temp.sesion_nueva('b1', 'b', 'b:c3', jsonb_build_array(pg_temp.linea('b:lata', 1), pg_temp.combo(2)), pg_temp.domicilio_json()),
  'ok', 'B: la sesion de Mercado Pago nace con su preferencia');
select is(
  (select concat_ws(' ', 'subtotal=' || s.subtotal, 'descuento=' || s.discount_total, 'envio=' || s.delivery_fee, 'total=' || s.total,
            'a_cobrar=' || pi.expected_amount)
     from public.checkout_sessions s join public.payment_intents pi on pi.checkout_session_id = s.id where s.id = pg_temp.id('b1')),
  'subtotal=4000.00 descuento=400.00 envio=500.00 total=4100.00 a_cobrar=4100.00',
  'B sesion: 3 latas + 2 aguas = 4000, menos 2 x 200 del combo, mas 500 de envio; lo que se va a cobrar es ese total');
select is(pg_temp.registrar('b1', pg_temp.pago('b1', 'INV-PAY-B1', 'approved', 'b1-aprobado')),
  '{"ok": true, "internal_status": "approved_order_pending", "finalize_required": true, "manual_review_required": false}'::jsonb,
  'B: el cobro aprobado por 4100 se registra y pide finalizar');
select is(pg_temp.finalizar(pg_temp.id('b1')) - 'order_id' - 'order_code', '{"ok": true, "idempotent": false}'::jsonb,
  'B: la finalizacion crea el pedido');
select is(pg_temp.importe((pg_temp.sesion('b1')).completed_order_id),
  'subtotal=4000.00 descuento=400.00 envio=500.00 total=4100.00 renglones=4000.00 combos=400.00',
  'B pedido pagado: el subtotal es la suma de los renglones, el descuento la suma de los combos, y el total cierra');
select is(
  (select concat_ws(' ', o.total = pi.paid_amount, o.total = pi.expected_amount, o.total = s.total, pi.paid_amount)
     from public.checkout_sessions s
     join public.payment_intents pi on pi.checkout_session_id = s.id
     join public.orders o on o.id = s.completed_order_id
    where s.id = pg_temp.id('b1')),
  't t t 4100.00', 'B pedido pagado: su total es lo que se cobro, lo que se esperaba cobrar y el total de la sesion');
select is(
  (select count(*)::integer from public.orders o
    where o.business_id = pg_temp.id('b')
      and (o.total <> o.subtotal - o.discount_total + o.delivery_fee
        or o.subtotal <> (select coalesce(sum(i.subtotal), 0) from public.order_items i where i.order_id = o.id)
        or o.discount_total <> (select coalesce(sum(c.discount_amount), 0) from public.order_combos c where c.order_id = o.id))),
  0, 'B: en los tres pedidos total = subtotal - descuento + envio, subtotal = renglones y descuento = combos');

-- Un cobro aprobado por otro importe no produce un pedido.
select is(pg_temp.sesion_nueva('b2', 'b', 'b:c4', jsonb_build_array(pg_temp.linea('b:lata', 1))), 'ok', 'B: otra sesion, por 1000');
select is(pg_temp.registrar('b2', pg_temp.pago('b2', 'INV-PAY-B2', 'approved', 'b2-aprobado', '{"transaction_amount": "999.00"}')),
  '{"ok": false, "reason": "amount_mismatch", "finalize_required": false, "manual_review_required": true}'::jsonb,
  'B: un aprobado por 999 sobre una sesion de 1000 es amount_mismatch y va a revision');
select * from pg_temp.no_finaliza('b2', 'b', '55000 pago no aprobado verificadamente',
  'B: finalizar esa sesion se rechaza: no hay pedido por un importe que no es el suyo');

-- Que ningún importe entra por el payload (precio, total, descuento, envío) lo ejecuta
-- server_side_pricing_test.sql, clave por clave y por las dos puertas: acá no se repite.

-- Los respaldos del esquema, con la clave de servicio.
select is(pg_temp.confirmar('service_role', pg_temp.fila_pedido('b', 'INV-B-TOTAL', '{"total": 900}')),
  '23514 new row for relation "orders" violates check constraint "orders_total_matches_parts"',
  'B esquema: un pedido cuyo total no es subtotal - descuento + envio no se puede escribir');
select is(pg_temp.confirmar('service_role', format(
    $f$insert into public.order_items(order_id,product_id,product_uuid,name,quantity,unit,unit_price,subtotal) values (%L,%L,%L,'Lata',3,'Lata',1000,2000)$f$,
    pg_temp.pedido('b', 'inv-total-retiro-01'), pg_temp.id('b:lata'), pg_temp.id('b:lata'))),
  '23514 new row for relation "order_items" violates check constraint "order_items_subtotal_matches_parts"',
  'B esquema: un renglon cuyo subtotal no es cantidad x precio tampoco');
select is(pg_temp.confirmar('service_role', format($f$update public.checkout_sessions set total = 1 where id = %L$f$, pg_temp.id('b2'))),
  '23514 new row for relation "checkout_sessions" violates check constraint "checkout_sessions_money_check"',
  'B esquema: ni una sesion cuyo total no cierra');
-- LIMITACION (PRICE-03): los renglones de un pedido no se pueden cambiar ni borrar, pero
-- sí AGREGAR. Debería rechazarse (o comprobarse la suma al confirmar); hoy la clave de
-- servicio agrega un renglón bien formado a un pedido ya creado y la cabecera no se entera.
select is(pg_temp.confirmar('service_role', format(
    $f$insert into public.order_items(order_id,product_id,product_uuid,name,quantity,unit,unit_price,subtotal) values (%L,%L,%L,'Lata',1,'Lata',1000,1000)$f$,
    pg_temp.pedido('b', 'inv-total-retiro-01'), pg_temp.id('b:lata'), pg_temp.id('b:lata'))),
  'ok', 'LIMITACION B: con la clave de servicio se puede agregar un renglon a un pedido ya creado');
select is(pg_temp.importe(pg_temp.pedido('b', 'inv-total-retiro-01')),
  'subtotal=3500.00 descuento=0.00 envio=0.00 total=3500.00 renglones=4500.00 combos=0',
  'LIMITACION B: y el pedido queda con renglones por 4500 y subtotal 3500: nada compara la suma con la cabecera');

-- ══════════════════════════════════════════════════════════════════════════
--  C · LA MISMA CLAVE EN LA PUERTA MANUAL
-- ══════════════════════════════════════════════════════════════════════════
select matches(pg_temp.pedir('c:c1', pg_temp.pedido_json('c', 'inv-clave-manual-01', jsonb_build_array(pg_temp.linea('c:lata', 2)))),
  '^ok ', 'C: el primer pedido con la clave nace');
select is(pg_temp.foto('c'),
  'pedidos=1 renglones=1 eventos=1 recibos=0 sesiones=0 intents=0 reservas=0a+0c+0l eventos_pago=0 lata=18 agua=20',
  'C: un pedido, un renglon, un evento y dos latas menos');
select is(pg_temp.estado(pg_temp.pedido('c', 'inv-clave-manual-01')), 'received rev 3', 'C: el pedido queda recibido, en su revision 3');

-- Mismo contenido: el mismo pedido.
select is(pg_temp.pedir('c:c1', pg_temp.pedido_json('c', 'inv-clave-manual-01', jsonb_build_array(pg_temp.linea('c:lata', 2)))),
  'ok ' || pg_temp.pedido('c', 'inv-clave-manual-01'), 'C: la misma clave con el mismo contenido devuelve el mismo pedido');
select is(pg_temp.pedir('c:c1', pg_temp.pedido_json('c', 'inv-clave-manual-01',
    jsonb_build_array(pg_temp.linea('c:lata', 1), pg_temp.linea('c:lata', 1)))),
  'ok ' || pg_temp.pedido('c', 'inv-clave-manual-01'), 'C: y tambien si las mismas 2 latas llegan en dos renglones de 1');
select is(pg_temp.foto('c') || ' | ' || pg_temp.estado(pg_temp.pedido('c', 'inv-clave-manual-01')),
  'pedidos=1 renglones=1 eventos=1 recibos=0 sesiones=0 intents=0 reservas=0a+0c+0l eventos_pago=0 lata=18 agua=20 | received rev 3',
  'C: los dos reintentos no escribieron nada: un pedido, el stock descontado una vez, la misma revision');

-- Otro contenido, u otra persona: se rechaza.
insert into inv_casos (grupo, puerta, negocio, actor, payload, esperado, que) values
  ('C', 'manual', 'c', 'c:c1', pg_temp.pedido_json('c', 'inv-clave-manual-01', jsonb_build_array(pg_temp.linea('c:lata', 3))),
    '23505 client_request_id reutilizado con un payload diferente', 'C: la misma clave con otra cantidad'),
  ('C', 'manual', 'c', 'c:c1', pg_temp.pedido_json('c', 'inv-clave-manual-01', jsonb_build_array(pg_temp.linea('c:agua', 2))),
    '23505 client_request_id reutilizado con un payload diferente', 'C: la misma clave con otro producto'),
  ('C', 'manual', 'c', 'c:c1', pg_temp.pedido_json('c', 'inv-clave-manual-01', jsonb_build_array(pg_temp.linea('c:lata', 2)), '{"payment_method": "coordinate"}'),
    '23505 client_request_id reutilizado con un payload diferente', 'C: la misma clave con otro medio de pago'),
  ('C', 'manual', 'c', 'c:c1', pg_temp.pedido_json('c', 'inv-clave-manual-01', jsonb_build_array(pg_temp.linea('c:lata', 2)), '{"customer_notes": "sin hielo"}'),
    '23505 client_request_id reutilizado con un payload diferente', 'C: la misma clave con una observacion'),
  ('C', 'manual', 'c', 'c:c1', pg_temp.pedido_json('c', 'inv-clave-manual-01', jsonb_build_array(pg_temp.linea('c:lata', 2)), pg_temp.envio_json()),
    '23505 client_request_id reutilizado con un payload diferente', 'C: la misma clave ahora como envio'),
  ('C', 'manual', 'c', 'c:c1', pg_temp.pedido_json('c', 'inv-clave-manual-01', jsonb_build_array(pg_temp.linea('c:lata', 2)),
      jsonb_build_object('tracking_token', repeat('f', 64))),
    '23505 client_request_id ya pertenece a otro pedido', 'C: la misma clave y el mismo contenido con otro token de seguimiento'),
  ('C', 'manual', 'c', 'c:c2', pg_temp.pedido_json('c', 'inv-clave-manual-01', jsonb_build_array(pg_temp.linea('c:lata', 2))),
    '23505 client_request_id ya pertenece a otro pedido', 'C: OTRO cliente con la misma clave y el mismo contenido no recibe el pedido ajeno'),
  ('C', 'manual', 'c', 'c:c2', pg_temp.pedido_json('c', 'inv-clave-manual-01', jsonb_build_array(pg_temp.linea('c:agua', 5))),
    '23505 client_request_id ya pertenece a otro pedido', 'C: otro cliente con la misma clave y otro contenido tampoco crea nada');
select * from pg_temp.rechazos('C');

select is(
  (select concat_ws(' ', o.customer_user_id = pg_temp.id('c:c1'), o.payment_method, coalesce(o.customer_notes, '-'), o.delivery_mode)
     from public.orders o where o.id = pg_temp.pedido('c', 'inv-clave-manual-01'))
    || ' | ' || pg_temp.importe(pg_temp.pedido('c', 'inv-clave-manual-01')) || ' | ' || pg_temp.estado(pg_temp.pedido('c', 'inv-clave-manual-01')),
  't cash - pickup | subtotal=2000.00 descuento=0.00 envio=0.00 total=2000.00 renglones=2000.00 combos=0 | received rev 3',
  'C: despues de los ocho intentos el primer pedido esta intacto: mismo cliente, medio, importe y revision');
select matches(pg_temp.pedir('c:c2', pg_temp.pedido_json('c', 'inv-clave-manual-02', jsonb_build_array(pg_temp.linea('c:agua', 5)))),
  '^ok ', 'C: con una clave propia el otro cliente si pide');
select is(pg_temp.foto('c'),
  'pedidos=2 renglones=2 eventos=2 recibos=0 sesiones=0 intents=0 reservas=0a+0c+0l eventos_pago=0 lata=18 agua=15',
  'C: dos pedidos de dos claves; las latas del primero se descontaron una sola vez');

-- ══════════════════════════════════════════════════════════════════════════
--  D · LA MISMA CLAVE EN LA SESIÓN DE CHECKOUT
-- ══════════════════════════════════════════════════════════════════════════
-- Sin preferencia todavía: la sesión queda como la deja `create_checkout_session`.
select is(pg_temp.sesion_nueva('d1', 'd', 'd:c1', jsonb_build_array(pg_temp.linea('d:lata', 2), pg_temp.combo(1)), '{}', false),
  'ok', 'D: la primera sesion con la clave nace');
select is(pg_temp.resumen('d1') || ' total=' || (pg_temp.sesion('d1')).total || ' rev=' || (pg_temp.sesion('d1')).revision,
  'sesion=ready_for_payment motivo=- intent=created proveedor=- cobrado=- pedido=false reservas=active,active total=3300.00 rev=2',
  'D: crear, validar y reservar es una sola llamada: la sesion nace lista para pagar, con una reserva por producto');
select is(pg_temp.foto('d'),
  'pedidos=0 renglones=0 eventos=0 recibos=0 sesiones=1 intents=1 reservas=2a+0c+0l eventos_pago=1 lata=17 agua=19',
  'D: una sesion, un intent, dos reservas; 3 latas y 1 agua menos (2 sueltas + el combo)');

select is(pg_temp.checkout('d:c1', pg_temp.checkout_json('d', 'inv_' || md5('d1'), jsonb_build_array(pg_temp.linea('d:lata', 2), pg_temp.combo(1)))),
  'ok ' || pg_temp.id('d1'), 'D: la misma clave con el mismo carrito devuelve la misma sesion');
select is(pg_temp.checkout('d:c1', pg_temp.checkout_json('d', 'inv_' || md5('d1'),
    jsonb_build_array(pg_temp.combo(1), pg_temp.linea('d:lata', 1), pg_temp.linea('d:lata', 1)))),
  'ok ' || pg_temp.id('d1'), 'D: y tambien con el mismo carrito en otro orden y la lata partida en dos renglones');
select is(pg_temp.foto('d') || ' rev=' || (pg_temp.sesion('d1')).revision,
  'pedidos=0 renglones=0 eventos=0 recibos=0 sesiones=1 intents=1 reservas=2a+0c+0l eventos_pago=1 lata=17 agua=19 rev=2',
  'D: los dos reintentos no escribieron nada: una sesion, un juego de reservas, el stock reservado una vez');

insert into inv_casos (grupo, puerta, negocio, actor, payload, esperado, que) values
  ('D', 'checkout', 'd', 'd:c1', pg_temp.checkout_json('d', 'inv_' || md5('d1'), jsonb_build_array(pg_temp.linea('d:lata', 3), pg_temp.combo(1))),
    '23505 client_request_id reutilizado con un checkout diferente', 'D: la misma clave con otra cantidad'),
  ('D', 'checkout', 'd', 'd:c1', pg_temp.checkout_json('d', 'inv_' || md5('d1'), jsonb_build_array(pg_temp.linea('d:lata', 2))),
    '23505 client_request_id reutilizado con un checkout diferente', 'D: la misma clave sin el combo'),
  ('D', 'checkout', 'd', 'd:c1', pg_temp.checkout_json('d', 'inv_' || md5('d1'), jsonb_build_array(pg_temp.linea('d:lata', 2), pg_temp.combo(2))),
    '23505 client_request_id reutilizado con un checkout diferente', 'D: la misma clave con dos combos en vez de uno'),
  ('D', 'checkout', 'd', 'd:c1', pg_temp.checkout_json('d', 'inv_' || md5('d1'), jsonb_build_array(pg_temp.linea('d:lata', 2), pg_temp.combo(1)),
      '{"contact": {"name": "Otra Persona", "phone": "5492990000000"}}'),
    '23505 client_request_id reutilizado con un checkout diferente', 'D: la misma clave con otro contacto'),
  ('D', 'checkout', 'd', 'd:c1', pg_temp.checkout_json('d', 'inv_' || md5('d1'), jsonb_build_array(pg_temp.linea('d:lata', 2), pg_temp.combo(1)),
      pg_temp.domicilio_json()),
    '23505 client_request_id reutilizado con un checkout diferente', 'D: la misma clave ahora como envio');
select * from pg_temp.rechazos('D');
select is(pg_temp.resumen('d1') || ' total=' || (pg_temp.sesion('d1')).total || ' rev=' || (pg_temp.sesion('d1')).revision,
  'sesion=ready_for_payment motivo=- intent=created proveedor=- cobrado=- pedido=false reservas=active,active total=3300.00 rev=2',
  'D: despues de los cinco intentos la primera sesion esta intacta');

-- La clave es por cliente: otro cliente con la misma clave abre SU sesión.
create temporary table inv_d2 on commit drop as
select pg_temp.checkout('d:c2', pg_temp.checkout_json('d', 'inv_' || md5('d1'), jsonb_build_array(pg_temp.linea('d:lata', 2), pg_temp.combo(1)))) as respuesta;
select matches((select respuesta from inv_d2), '^ok [0-9a-f-]{36}$', 'D: OTRO cliente con la misma clave y el mismo carrito no es rechazado');
select isnt((select respuesta from inv_d2), 'ok ' || pg_temp.id('d1'), 'D: y no recibe la sesion del primero');
select is(
  (select concat_ws(' ', count(*), count(distinct s.customer_id), count(distinct s.client_request_id),
            count(*) filter (where s.customer_id = pg_temp.id('d:c1') and s.id = pg_temp.id('d1')),
            count(*) filter (where s.customer_id = pg_temp.id('d:c2') and 'ok ' || s.id = (select respuesta from inv_d2)))
     from public.checkout_sessions s where s.business_id = pg_temp.id('d')),
  '2 2 1 1 1', 'D: quedan dos sesiones de dos clientes con UNA misma clave: cada cliente tiene la suya');
select is(pg_temp.foto('d'),
  'pedidos=0 renglones=0 eventos=0 recibos=0 sesiones=2 intents=2 reservas=4a+0c+0l eventos_pago=2 lata=14 agua=18',
  'D: dos sesiones de dos clientes, cada una con su reserva');

-- ══════════════════════════════════════════════════════════════════════════
--  E · UN CHECKOUT, UN PEDIDO
-- ══════════════════════════════════════════════════════════════════════════
-- El recorrido de una sesión: lista -> en Checkout Pro -> pago pendiente -> aprobado -> pedido.
select is(pg_temp.sesion_nueva('e1', 'e', 'e:c1', jsonb_build_array(pg_temp.linea('e:lata', 3))), 'ok', 'E: la sesion nace y se asienta su preferencia');
select is(pg_temp.resumen('e1'),
  'sesion=redirected motivo=- intent=preference_created proveedor=- cobrado=- pedido=false reservas=active',
  'E: con la preferencia creada la sesion queda redirected');
select is(pg_temp.registrar('e1', pg_temp.pago('e1', 'INV-PAY-E1', 'pending', 'e1-pendiente')) ->> 'internal_status', 'pending',
  'E: llega el pago pendiente');
select is(pg_temp.resumen('e1'),
  'sesion=payment_pending motivo=- intent=pending proveedor=pending cobrado=- pedido=false reservas=active',
  'E: la sesion pasa a payment_pending');
select is(pg_temp.registrar('e1', pg_temp.pago('e1', 'INV-PAY-E1', 'approved', 'e1-aprobado')),
  '{"ok": true, "internal_status": "approved_order_pending", "finalize_required": true, "manual_review_required": false}'::jsonb,
  'E: el mismo pago se aprueba: pide finalizar');
select is(pg_temp.resumen('e1') || ' | ' || pg_temp.foto('e'),
  'sesion=payment_approved motivo=- intent=approved_order_pending proveedor=approved cobrado=3000.00 pedido=false reservas=active'
    || ' | pedidos=0 renglones=0 eventos=0 recibos=0 sesiones=1 intents=1 reservas=1a+0c+0l eventos_pago=3 lata=17 agua=20',
  'E: la sesion queda payment_approved, con el cobro por 3000, todavia sin pedido');

-- El mismo cobro aprobado, otra vez (el webhook y la consulta de estado llegan los dos).
create temporary table inv_e0 on commit drop as
select pg_temp.resumen('e1') || ' | ' || pg_temp.foto('e') || ' rev_intent=' || (pg_temp.intent('e1')).revision
         || ' rev_sesion=' || (pg_temp.sesion('e1')).revision as foto;
select is(pg_temp.registrar('e1', pg_temp.pago('e1', 'INV-PAY-E1', 'approved', 'e1-aprobado')),
  '{"ok": true, "internal_status": "approved_order_pending", "finalize_required": true, "manual_review_required": false}'::jsonb,
  'E: registrar otra vez el mismo aprobado responde lo mismo y vuelve a pedir la finalizacion');
select is(pg_temp.resumen('e1') || ' | ' || pg_temp.foto('e') || ' rev_intent=' || (pg_temp.intent('e1')).revision
            || ' rev_sesion=' || (pg_temp.sesion('e1')).revision,
  (select foto from inv_e0), 'E: y no escribe: ni otro evento de pago, ni la revision del intent, ni la de la sesion');

-- La finalización, tres veces.
select is(pg_temp.finalizar(pg_temp.id('e1')) - 'order_id' - 'order_code', '{"ok": true, "idempotent": false}'::jsonb,
  'E: la primera finalizacion crea el pedido');
select is(pg_temp.resumen('e1') || ' | ' || pg_temp.foto('e'),
  'sesion=completed motivo=- intent=completed proveedor=approved cobrado=3000.00 pedido=true reservas=converted'
    || ' | pedidos=1 renglones=1 eventos=1 recibos=0 sesiones=1 intents=1 reservas=0a+1c+0l eventos_pago=4 lata=17 agua=20',
  'E: un pedido, la reserva convertida, y el stock igual que al reservar: la finalizacion no descuenta otra vez');
create temporary table inv_e1 on commit drop as
select (pg_temp.sesion('e1')).completed_order_id as pedido, (pg_temp.sesion('e1')).revision as rev_sesion, (pg_temp.intent('e1')).revision as rev_intent,
       (select r.converted_at from public.inventory_reservations r where r.checkout_session_id = pg_temp.id('e1')) as convertida,
       pg_temp.foto('e') as foto;
select is(pg_temp.finalizar(pg_temp.id('e1')), jsonb_build_object('ok', true, 'order_id', (select pedido from inv_e1), 'idempotent', true),
  'E: la segunda finalizacion devuelve EL MISMO pedido, marcado idempotente');
select is(pg_temp.finalizar(pg_temp.id('e1')), jsonb_build_object('ok', true, 'order_id', (select pedido from inv_e1), 'idempotent', true),
  'E: y la tercera tambien');
select is(pg_temp.foto('e'), (select foto from inv_e1), 'E: las dos repeticiones no escribieron nada: un pedido, un renglon, un evento, el mismo stock');
select is(
  concat_ws(' ', (pg_temp.sesion('e1')).revision = (select rev_sesion from inv_e1), (pg_temp.intent('e1')).revision = (select rev_intent from inv_e1),
    (select r.converted_at from public.inventory_reservations r where r.checkout_session_id = pg_temp.id('e1')) = (select convertida from inv_e1)),
  't t t', 'E: ni tocaron la sesion, el intent o el momento en que se convirtio la reserva');
select is(
  concat_ws(' ',
    (select count(*) from public.order_events e where e.order_id = (select pedido from inv_e1) and e.event_type = 'order.received'),
    (select count(*) from public.payment_events pe where pe.payment_intent_id = pg_temp.id('e1:intent') and pe.event_type = 'payment.order_completed'),
    (select count(*) from public.order_public_tokens t where t.order_id = (select pedido from inv_e1)),
    (select count(*) from public.payment_intents pi where pi.order_id = (select pedido from inv_e1))),
  '1 1 1 1', 'E: un order.received, un payment.order_completed, un token de seguimiento y un intent atado al pedido');
select is(
  (select concat_ws(' ', o.client_request_id = 'mp_' || replace(pg_temp.id('e1')::text, '-', ''), o.payment_method, o.status, o.total)
     from public.orders o where o.id = (select pedido from inv_e1)),
  't mercadopago received 3000.00', 'E: la clave del pedido se deriva del id de la sesion: una sesion no puede tener dos');

-- El aprobado vuelve a llegar con el pedido ya creado, y el cliente reintenta el alta.
select is(pg_temp.registrar('e1', pg_temp.pago('e1', 'INV-PAY-E1', 'approved', 'e1-aprobado')),
  '{"ok": true, "internal_status": "completed", "finalize_required": false, "manual_review_required": false}'::jsonb,
  'E: el aprobado que llega despues del pedido ya no pide finalizar');
select is(pg_temp.checkout('e:c1', pg_temp.checkout_json('e', 'inv_' || md5('e1'), jsonb_build_array(pg_temp.linea('e:lata', 3)))),
  'ok ' || pg_temp.id('e1'), 'E: y repetir el alta con la misma clave devuelve la sesion completada, no una nueva');
select is(pg_temp.foto('e'), (select foto from inv_e1), 'E: nada de eso escribio');

-- El mismo pago del proveedor presentado contra OTRA sesión.
select is(pg_temp.sesion_nueva('e2', 'e', 'e:c2', jsonb_build_array(pg_temp.linea('e:lata', 3))), 'ok', 'E: otra sesion, de otro cliente, por el mismo importe');
create temporary table inv_e2 on commit drop as select pg_temp.resumen('e2') || ' | ' || pg_temp.foto('e') as foto;
select is(pg_temp.registrar('e2', pg_temp.pago('e2', 'INV-PAY-E1', 'approved', 'e2-aprobado-con-pago-ajeno')),
  '{"error": "23505", "message": "duplicate key value violates unique constraint \"payment_intents_provider_payment_key\""}'::jsonb,
  'E: el pago que ya pago el pedido de e1 no se puede asentar en otra sesion: lo frena el indice unico (23505)');
select is(pg_temp.resumen('e2') || ' | ' || pg_temp.foto('e'), (select foto from inv_e2),
  'E: la segunda sesion queda como estaba, sin cobro, y no se escribio nada');
select * from pg_temp.no_finaliza('e2', 'e', '55000 pago no aprobado verificadamente', 'E: y finalizarla se rechaza: un pago no sirve para dos pedidos');

-- Los respaldos del esquema, con la clave de servicio.
select is(pg_temp.confirmar('service_role', pg_temp.fila_pedido('e', 'INV-E-SEGUNDO',
    jsonb_build_object('client_request_id', 'mp_' || replace(pg_temp.id('e1')::text, '-', '')))),
  '23505 duplicate key value violates unique constraint "orders_business_client_request_key"',
  'E esquema: un segundo pedido con la clave derivada de la misma sesion no se puede escribir');
select is(pg_temp.confirmar('service_role', format(
    $f$insert into public.payment_intents(checkout_session_id,business_id,provider,environment,external_reference,internal_status,currency,expected_amount,correlation_id)
       values (%L,%L,'mercadopago','test',%L,'created','ARS',3000,%L)$f$,
    pg_temp.id('e1'), pg_temp.id('e'), 'taba2:checkout:' || gen_random_uuid(), gen_random_uuid())),
  '23505 duplicate key value violates unique constraint "payment_intents_checkout_session_id_key"',
  'E esquema: ni un segundo intent para la misma sesion');
-- LIMITACION: la restricción `inventory_reservations_transition_check` comprueba que las
-- columnas de la reserva sean coherentes con su estado, NO de qué estado viene. Debería
-- rechazarse; hoy la clave de servicio reactiva una reserva ya convertida. Lo que la
-- convierte una sola vez es el filtro `status = 'active'` de la finalización.
select is(pg_temp.confirmar('service_role', format(
    $f$update public.inventory_reservations set status = 'active', converted_at = null where checkout_session_id = %L$f$, pg_temp.id('e1'))),
  'ok', 'LIMITACION E: con la clave de servicio una reserva convertida se puede volver a dejar activa: el CHECK no mira la transicion');
select is(pg_temp.finalizar(pg_temp.id('e1')), jsonb_build_object('ok', true, 'order_id', (select pedido from inv_e1), 'idempotent', true),
  'E: aun asi la finalizacion no crea otro pedido: corta antes, por el pedido ya atado a la sesion');

-- ══════════════════════════════════════════════════════════════════════════
--  F · UN COBRO APROBADO SIN PEDIDO SE DETECTA
-- ══════════════════════════════════════════════════════════════════════════
-- El cobro se aprueba y la finalización no corre (el worker se cayó).
select is(pg_temp.sesion_nueva('f1', 'f', 'f:c1', jsonb_build_array(pg_temp.linea('f:lata', 2))), 'ok', 'F: la sesion nace');
select is(pg_temp.registrar('f1', pg_temp.pago('f1', 'INV-PAY-F1', 'approved', 'f1-aprobado')) ->> 'finalize_required', 'true',
  'F: el cobro se aprueba y pide finalizar; nadie finaliza');
select is(pg_temp.reconciliar('f'), 'ok', 'F: la reconciliacion de alertas corre con la clave de servicio');
select is(pg_temp.alerta('f', 'PAYMENT_APPROVED_WITHOUT_ORDER', pg_temp.id('f1:intent')) || ' | ' || pg_temp.sin_finalizar('f1'),
  '(no hay) | (no figura)', 'F: recien aprobado no hay alerta ni figura en la lista: la finalizacion normal tarda segundos');

-- La lista de checkouts pagados sin finalizar: umbral de 3 minutos sobre la sesión.
select pg_temp.envejecer('f1', interval '2 minutes 30 seconds');
select is(pg_temp.sin_finalizar('f1'), '(no figura)', 'F: a los 2:30 sin pedido todavia no figura en la lista');
select pg_temp.envejecer('f1', interval '3 minutes 30 seconds');
select is(pg_temp.sin_finalizar('f1'), 'high paid 2000.00 run_finalize_paid_checkout_session_or_inspect_payment_outbox',
  'F: a los 3:30 figura, con severidad alta, el importe y la accion');

-- La alerta: umbral de 5 minutos sobre el intent.
select pg_temp.envejecer('f1', interval '4 minutes 30 seconds');
select is(pg_temp.reconciliar('f'), 'ok', 'F: se reconcilia a los 4:30');
select is(pg_temp.alerta('f', 'PAYMENT_APPROVED_WITHOUT_ORDER', pg_temp.id('f1:intent')), '(no hay)',
  'F: a los 4:30 todavia no hay alerta');
select pg_temp.envejecer('f1', interval '5 minutes 30 seconds');
select is(pg_temp.reconciliar('f'), 'ok', 'F: se reconcilia a los 5:30');
select is(pg_temp.alerta('f', 'PAYMENT_APPROVED_WITHOUT_ORDER', pg_temp.id('f1:intent')), 'CRITICAL open payment_intent',
  'F: a los 5:30 hay una alerta PAYMENT_APPROVED_WITHOUT_ORDER critica y abierta sobre ese intent');
select is(
  (select concat_ws(' | ', a.summary, a.required_action, a.evidence ->> 'status', (a.evidence ->> 'payment_intent_id')::uuid = pg_temp.id('f1:intent'))
     from public.operational_alerts a
    where a.business_id = pg_temp.id('f') and a.alert_code = 'PAYMENT_APPROVED_WITHOUT_ORDER'),
  'Pago aprobado sin pedido operativo. | Reconciliar el pago y finalizar el pedido; no cobrar nuevamente. | approved_order_pending | t',
  'F: dice que pasa, que hay que hacer y sobre que cobro');
select pg_temp.envejecer('f1', interval '16 minutes');
select is(pg_temp.sin_finalizar('f1'), 'critical paid 2000.00 run_finalize_paid_checkout_session_or_inspect_payment_outbox',
  'F: a los 16 minutos la lista lo sube a critico');
select is(pg_temp.resumen('f1') || ' | ' || pg_temp.foto('f'),
  'sesion=payment_approved motivo=- intent=approved_order_pending proveedor=approved cobrado=2000.00 pedido=false reservas=active'
    || ' | pedidos=0 renglones=0 eventos=0 recibos=0 sesiones=1 intents=1 reservas=1a+0c+0l eventos_pago=2 lata=18 agua=20',
  'F: detectar no cambia nada: el cobro sigue aprobado, sin pedido y con su reserva');

-- La alerta mide sus cinco minutos desde que el cobro se aprobó (`approved_at`), no
-- desde la última escritura del intent. Antes de 20261001222000 medía desde
-- `updated_at`: cualquier relectura del MISMO pago aprobado que trajera otro cuerpo de
-- respuesta (la pantalla de estado, la sonda, un reintento del webhook) reescribía el
-- intent, reiniciaba el reloj y la reconciliación siguiente daba la alerta crítica por
-- RESUELTA con el pedido todavía sin crear. Esta prueba lo encontró.
select is(pg_temp.registrar('f1', pg_temp.pago('f1', 'INV-PAY-F1', 'approved', 'f1-aprobado-con-otro-cuerpo')),
  '{"ok": true, "internal_status": "approved_order_pending", "finalize_required": true, "manual_review_required": false}'::jsonb,
  'F: se relee el mismo pago aprobado y el proveedor responde con otro cuerpo: se registra y sigue pidiendo finalizar');
select is(pg_temp.reconciliar('f'), 'ok', 'F: se reconcilia despues de la relectura');
select is(pg_temp.alerta('f', 'PAYMENT_APPROVED_WITHOUT_ORDER', pg_temp.id('f1:intent')) || ' pedido=' || ((pg_temp.sesion('f1')).completed_order_id is not null),
  'CRITICAL open payment_intent pedido=false',
  'F: releer el pago no cierra la alerta: sigue ABIERTA mientras el cobro este aprobado y sin pedido');
select is(
  (select (pi.updated_at > clock_timestamp() - interval '1 minute') || ' / ' || (pi.approved_at < clock_timestamp() - interval '5 minutes')
     from public.payment_intents pi where pi.id = pg_temp.id('f1:intent')),
  'true / true', 'F: la relectura si reescribio el intent (updated_at reciente); lo que no cambio es cuando se aprobo');
select is(pg_temp.sin_finalizar('f1'), 'critical paid 2000.00 run_finalize_paid_checkout_session_or_inspect_payment_outbox',
  'F: la lista de checkouts sin finalizar no se resuelve con la relectura: mide desde la sesion, que no se toco');
select pg_temp.envejecer('f1', interval '5 minutes 30 seconds');
select is(pg_temp.reconciliar('f'), 'ok', 'F: se reconcilia 5:30 despues de la relectura');
select is(pg_temp.alerta('f', 'PAYMENT_APPROVED_WITHOUT_ORDER', pg_temp.id('f1:intent')), 'CRITICAL open payment_intent',
  'F: y sigue abierta despues, sin haberse cerrado en el medio');

-- La salida normal: finalizar. La alerta se cierra sola.
select is(pg_temp.finalizar(pg_temp.id('f1')) - 'order_id' - 'order_code', '{"ok": true, "idempotent": false}'::jsonb,
  'F: la finalizacion tardia crea el pedido');
select is(pg_temp.reconciliar('f'), 'ok', 'F: se reconcilia otra vez');
select is(pg_temp.alerta('f', 'PAYMENT_APPROVED_WITHOUT_ORDER', pg_temp.id('f1:intent')) || ' | ' || pg_temp.sin_finalizar('f1'),
  'CRITICAL resolved payment_intent | (no figura)', 'F: con el pedido creado la alerta queda resuelta y la sesion sale de la lista');

-- ══════════════════════════════════════════════════════════════════════════
--  G · SIN COBRO APROBADO LA FINALIZACIÓN NO CREA NADA
-- ══════════════════════════════════════════════════════════════════════════
select is(pg_temp.sesion_nueva('g0', 'g', 'g:c1', jsonb_build_array(pg_temp.linea('g:lata', 1)), '{}', false), 'ok', 'G: sesion sin preferencia');
select is(pg_temp.sesion_nueva('g1', 'g', 'g:c2', jsonb_build_array(pg_temp.linea('g:lata', 1))), 'ok', 'G: sesion en Checkout Pro, sin pago');
select is(pg_temp.sesion_nueva('g2', 'g', 'g:c3', jsonb_build_array(pg_temp.linea('g:lata', 1))), 'ok', 'G: sesion para el pago pendiente');
select is(pg_temp.sesion_nueva('g3', 'g', 'g:c4', jsonb_build_array(pg_temp.linea('g:lata', 1))), 'ok', 'G: sesion para el pago rechazado');
select is(pg_temp.sesion_nueva('g4', 'g', 'g:c5', jsonb_build_array(pg_temp.linea('g:lata', 4))), 'ok', 'G: sesion que va a vencer');

select * from pg_temp.no_finaliza('g0', 'g', '55000 pago no aprobado verificadamente', 'G: finalizar una sesion recien creada, sin preferencia ni pago');
select * from pg_temp.no_finaliza('g1', 'g', '55000 pago no aprobado verificadamente', 'G: finalizar una sesion en Checkout Pro sin ningun pago');

select is(pg_temp.registrar('g2', pg_temp.pago('g2', 'INV-PAY-G2', 'pending', 'g2-pendiente')) ->> 'finalize_required', 'false',
  'G: un pago pendiente no pide finalizar');
select is(pg_temp.resumen('g2'), 'sesion=payment_pending motivo=- intent=pending proveedor=pending cobrado=- pedido=false reservas=active',
  'G: la sesion queda payment_pending');
select * from pg_temp.no_finaliza('g2', 'g', '55000 pago no aprobado verificadamente', 'G: finalizar con el pago pendiente');
select is(pg_temp.registrar('g2', pg_temp.pago('g2', 'INV-PAY-G2', 'in_process', 'g2-en-proceso')) ->> 'internal_status', 'in_process',
  'G: el pago pasa a en proceso');
select * from pg_temp.no_finaliza('g2', 'g', '55000 pago no aprobado verificadamente', 'G: finalizar con el pago en proceso');

select is(pg_temp.registrar('g3', pg_temp.pago('g3', 'INV-PAY-G3', 'rejected', 'g3-rechazado')) ->> 'internal_status', 'rejected',
  'G: el pago se rechaza');
select is(pg_temp.resumen('g3'), 'sesion=redirected motivo=- intent=rejected proveedor=rejected cobrado=- pedido=false reservas=active',
  'G: el rechazo deja la sesion pagable y la reserva retenida');
select * from pg_temp.no_finaliza('g3', 'g', '55000 pago no aprobado verificadamente', 'G: finalizar con el pago rechazado');

-- Vence sin pago: primero sólo por el reloj, después pasa el barrido.
select pg_temp.vencer('g4');
select * from pg_temp.no_finaliza('g4', 'g', '55000 pago no aprobado verificadamente', 'G: finalizar una sesion vencida que el barrido todavia no toco');
select cmp_ok(public.expire_checkout_sessions(500), '>=', 1, 'G: el barrido alcanza la sesion vencida');
select is(pg_temp.resumen('g4'), 'sesion=expired motivo=- intent=expired proveedor=- cobrado=- pedido=false reservas=released',
  'G: queda expired, con la reserva liberada');
select * from pg_temp.no_finaliza('g4', 'g', '55000 pago no aprobado verificadamente', 'G: finalizar una sesion expirada');

select is(pg_temp.finalizar(gen_random_uuid()), '{"error": "P0002", "message": "checkout inexistente"}'::jsonb,
  'G: finalizar una sesion que no existe');
select is(pg_temp.foto('g'),
  'pedidos=0 renglones=0 eventos=0 recibos=0 sesiones=5 intents=5 reservas=4a+0c+1l eventos_pago=8 lata=16 agua=20',
  'G: ningun pedido en el comercio; cuatro reservas vivas y las 4 latas de la vencida de vuelta');

-- ══════════════════════════════════════════════════════════════════════════
--  H · UN COBRO APROBADO SOBRE UNA SESIÓN VENCIDA NO ES UN PEDIDO EN SILENCIO
-- ══════════════════════════════════════════════════════════════════════════
-- Es deliberado (20261001200000 / 20261001203000): con el plazo de la sesión vencido ni
-- el snapshot ni la finalización arman el pedido solos, siga retenido el stock (H1, H3)
-- o haya vuelto a la venta (H2). Tampoco descartan el cobro: el dinero entró. Queda en
-- revisión manual, a la vista, y la salida es de una persona (rearmar el pedido o
-- devolver el dinero; lo prueba manual_review_checkout_stock_test.sql).

-- H1 · venció por el reloj y el barrido todavía no pasó: llega el aprobado.
select is(pg_temp.sesion_nueva('h1', 'h', 'h:c1', jsonb_build_array(pg_temp.linea('h:lata', 2))), 'ok', 'H1: la sesion nace');
select pg_temp.vencer('h1');
select is(pg_temp.registrar('h1', pg_temp.pago('h1', 'INV-PAY-H1', 'approved', 'h1-aprobado')),
  '{"ok": true, "finalize_required": false, "manual_review_required": true}'::jsonb,
  'H1: el aprobado sobre la sesion vencida se registra, NO pide finalizar y declara revision manual');
select is(pg_temp.resumen('h1'),
  'sesion=manual_review_required motivo=approved_after_reservation_expired intent=security_review_required proveedor=approved cobrado=2000.00 pedido=false reservas=active',
  'H1: la sesion queda en revision manual con su motivo, el cobro anotado y la reserva retenida');
select is(
  (select string_agg(pe.event_type, ', ' order by pe.sequence) from public.payment_events pe where pe.payment_intent_id = pg_temp.id('h1:intent')),
  'checkout.session_created, payment.approved, payment.manual_review_required', 'H1: y deja el evento de revision manual en la traza del cobro');
select * from pg_temp.no_finaliza('h1', 'h', '55000 pago no aprobado verificadamente', 'H1: finalizarla se rechaza');
-- Pasa el barrido de vencimiento (no es una aserción: lo que importa es lo que deja).
select public.expire_checkout_sessions(500) >= 0 as barrido;
select is(pg_temp.resumen('h1') || ' | ' || pg_temp.foto('h'),
  'sesion=manual_review_required motivo=approved_after_reservation_expired intent=security_review_required proveedor=approved cobrado=2000.00 pedido=false reservas=active'
    || ' | pedidos=0 renglones=0 eventos=0 recibos=0 sesiones=1 intents=1 reservas=1a+0c+0l eventos_pago=3 lata=18 agua=20',
  'H1: el barrido no libera las unidades de alguien que pago: siguen retenidas, sin pedido');
select is(pg_temp.sin_finalizar('h1'), 'critical expired 2000.00 decide_refund_or_manual_fulfillment_the_money_is_already_in',
  'H1: figura como critica en la lista desde el primer minuto, con la accion: devolver o rearmar');
select is(pg_temp.reconciliar('h'), 'ok', 'H1: se reconcilian las alertas');
select is(pg_temp.alerta('h', 'PAYMENT_RECONCILIATION_REQUIRED', pg_temp.id('h1:intent')), 'ACTION_REQUIRED open payment_intent',
  'H1: y hay una alerta PAYMENT_RECONCILIATION_REQUIRED sobre ese cobro, sin esperar ningun umbral');
select pg_temp.envejecer('h1', interval '6 minutes');
select is(pg_temp.reconciliar('h'), 'ok', 'H1: se reconcilia seis minutos despues');
select is(pg_temp.alerta('h', 'PAYMENT_APPROVED_WITHOUT_ORDER', pg_temp.id('h1:intent')), '(no hay)',
  'H1: un cobro en revision no levanta PAYMENT_APPROVED_WITHOUT_ORDER: esa alerta es solo para el aprobado que espera finalizar');
-- DEFECTO (menor, de la respuesta): el mismo snapshot repetido debería volver a decir
-- `manual_review_required: true`, porque la sesión sigue en revisión. Hoy responde
-- false. No cambia ningún estado y ninguna Edge Function lee ese campo (leen
-- `finalize_required`), pero la respuesta contradice a la base.
select is(pg_temp.registrar('h1', pg_temp.pago('h1', 'INV-PAY-H1', 'approved', 'h1-aprobado')),
  '{"ok": true, "internal_status": "security_review_required", "finalize_required": false, "manual_review_required": false}'::jsonb,
  'DEFECTO H1: repetir el mismo aprobado responde manual_review_required=false con la sesion en revision manual');
select is(pg_temp.resumen('h1'),
  'sesion=manual_review_required motivo=approved_after_reservation_expired intent=security_review_required proveedor=approved cobrado=2000.00 pedido=false reservas=active',
  'H1: la repeticion no cambio el estado');

-- H2 · venció y el barrido ya devolvió el stock: llega el aprobado.
select is(pg_temp.sesion_nueva('h2', 'h', 'h:c2', jsonb_build_array(pg_temp.linea('h:lata', 3))), 'ok', 'H2: la sesion nace');
select pg_temp.vencer('h2');
select cmp_ok(public.expire_checkout_sessions(500), '>=', 1, 'H2: el barrido la vence');
select is(pg_temp.resumen('h2') || ' lata=' || (select p.stock from public.products p where p.id = pg_temp.id('h:lata')),
  'sesion=expired motivo=- intent=expired proveedor=- cobrado=- pedido=false reservas=released lata=18',
  'H2: queda expired y sus 3 latas vuelven (18 = 20 - las 2 retenidas de H1)');
select is(pg_temp.registrar('h2', pg_temp.pago('h2', 'INV-PAY-H2', 'approved', 'h2-aprobado')),
  '{"ok": true, "finalize_required": false, "manual_review_required": true}'::jsonb,
  'H2: el aprobado sobre la sesion expirada tambien va a revision manual');
select is(pg_temp.resumen('h2') || ' lata=' || (select p.stock from public.products p where p.id = pg_temp.id('h:lata')),
  'sesion=manual_review_required motivo=approved_after_reservation_expired intent=security_review_required proveedor=approved cobrado=3000.00 pedido=false reservas=released lata=18',
  'H2: sale de expired a revision manual con el cobro anotado; el stock devuelto no se vuelve a descontar solo');
select * from pg_temp.no_finaliza('h2', 'h', '55000 pago no aprobado verificadamente', 'H2: finalizarla se rechaza');
select is(pg_temp.sin_finalizar('h2'), 'critical expired 3000.00 decide_refund_or_manual_fulfillment_the_money_is_already_in',
  'H2: figura como critica en la lista');

-- H3 · se aprobó a tiempo y la finalización corrió tarde.
select is(pg_temp.sesion_nueva('h3', 'h', 'h:c3', jsonb_build_array(pg_temp.linea('h:lata', 1))), 'ok', 'H3: la sesion nace');
select is(pg_temp.registrar('h3', pg_temp.pago('h3', 'INV-PAY-H3', 'approved', 'h3-aprobado')) ->> 'finalize_required', 'true',
  'H3: el cobro se aprueba a tiempo y pide finalizar');
select pg_temp.vencer('h3');
select is(pg_temp.finalizar(pg_temp.id('h3')), '{"ok": false, "manual_review_required": true}'::jsonb,
  'H3: la finalizacion que corre con la sesion ya vencida no crea el pedido: responde revision manual, sin error');
select is(pg_temp.resumen('h3'),
  'sesion=manual_review_required motivo=finalization_without_active_reservation intent=security_review_required proveedor=approved cobrado=1000.00 pedido=false reservas=active',
  'H3: y deja la sesion en revision manual con su propio motivo');
select is(pg_temp.sin_finalizar('h3'), 'critical expired 1000.00 decide_refund_or_manual_fulfillment_the_money_is_already_in',
  'H3: figura como critica en la lista');
-- LIMITACION: la revisión que decide la finalización no deja evento en `payment_events`
-- (la que decide el snapshot sí: `payment.manual_review_required`, ver H1). Debería
-- dejarlo: la historia de un checkout se reconstruye de esa tabla, y este paso sólo
-- queda en `manual_review_reason` de la sesión.
select is(
  (select string_agg(pe.event_type, ', ' order by pe.sequence) from public.payment_events pe where pe.payment_intent_id = pg_temp.id('h3:intent')),
  'checkout.session_created, payment.approved',
  'LIMITACION H3: la finalizacion que manda a revision no agrega ningun evento a la traza del cobro');
select * from pg_temp.no_finaliza('h3', 'h', '55000 pago no aprobado verificadamente', 'H3: una segunda finalizacion ya se rechaza');

-- H4 · venció sin pago: el comprador no puede volver a pagarla.
select is(pg_temp.sesion_nueva('h4', 'h', 'h:c4', jsonb_build_array(pg_temp.linea('h:lata', 1))), 'ok', 'H4: la sesion nace');
select pg_temp.vencer('h4');
select is(pg_temp.servicio(format('public.prepare_mercadopago_preference_v2(%L, %L, true)', pg_temp.id('h4'), pg_temp.id('h:c4'))),
  '{"error": "55000", "message": "checkout vencido"}'::jsonb, 'H4: pedir otra preferencia para una sesion vencida se rechaza');
select is(pg_temp.checkout('h:c4', pg_temp.checkout_json('h', 'inv_' || md5('h4'), jsonb_build_array(pg_temp.linea('h:lata', 1)))),
  'ok ' || pg_temp.id('h4'), 'H4: y repetir el alta con la misma clave devuelve esa misma sesion vencida, no una nueva');
select is(pg_temp.foto('h'),
  'pedidos=0 renglones=0 eventos=0 recibos=0 sesiones=4 intents=4 reservas=3a+0c+1l eventos_pago=9 lata=16 agua=20',
  'H: cuatro sesiones vencidas, tres cobros aprobados, ningun pedido');

-- ══════════════════════════════════════════════════════════════════════════
--  I · UN PEDIDO SIEMPRE TIENE MEDIO Y ESTADO DE PAGO
-- ══════════════════════════════════════════════════════════════════════════
-- Por las puertas.
select matches(pg_temp.pedir('i:c1', pg_temp.pedido_json('i', 'inv-medio-efectivo', jsonb_build_array(pg_temp.linea('i:lata', 1)))),
  '^ok ', 'I: un pedido en efectivo nace');
select is(pg_temp.pago_del_pedido(pg_temp.pedido('i', 'inv-medio-efectivo')), 'medio=cash manual=pending estado=pending',
  'I: nace con su cobro manual pendiente');
select matches(pg_temp.pedir('i:c1', pg_temp.pedido_json('i', 'inv-medio-coordinar', jsonb_build_array(pg_temp.linea('i:lata', 1)), '{"payment_method": "coordinate"}')),
  '^ok ', 'I: un pedido a coordinar nace');
select is(pg_temp.pago_del_pedido(pg_temp.pedido('i', 'inv-medio-coordinar')), 'medio=coordinate manual=pending estado=pending',
  'I: tambien con su cobro manual pendiente');
select is(pg_temp.sesion_nueva('i1', 'i', 'i:c2', jsonb_build_array(pg_temp.linea('i:lata', 1))), 'ok', 'I: una sesion de Mercado Pago');
select is(pg_temp.registrar('i1', pg_temp.pago('i1', 'INV-PAY-I1', 'approved', 'i1-aprobado')) ->> 'finalize_required', 'true', 'I: se aprueba su cobro');
select is(pg_temp.finalizar(pg_temp.id('i1')) ->> 'ok', 'true',
  'I: la finalizacion pasa el trigger diferido: el pedido de Mercado Pago tiene su intent completado');
select is(pg_temp.pago_del_pedido((pg_temp.sesion('i1')).completed_order_id), 'medio=mercadopago manual=NULL estado=confirmed',
  'I: el pedido que nace de un cobro lleva medio mercadopago y pago confirmado');

-- El cliente no elige un medio que la puerta manual no cobra, ni escribe el estado.
insert into inv_casos (grupo, puerta, negocio, actor, payload, esperado, que) values
  ('I', 'manual', 'i', 'i:c1', pg_temp.pedido_json('i', 'inv-medio-01', jsonb_build_array(pg_temp.linea('i:lata', 1))) - 'payment_method',
    '23502 null value in column "payment_method" of relation "orders" violates not-null constraint', 'I manual: un pedido sin medio de pago'),
  ('I', 'manual', 'i', 'i:c1', pg_temp.pedido_json('i', 'inv-medio-02', jsonb_build_array(pg_temp.linea('i:lata', 1)), '{"payment_method": ""}'),
    '23502 null value in column "payment_method" of relation "orders" violates not-null constraint', 'I manual: con el medio de pago en blanco'),
  ('I', 'manual', 'i', 'i:c1', pg_temp.pedido_json('i', 'inv-medio-03', jsonb_build_array(pg_temp.linea('i:lata', 1)), '{"payment_method": "tarjeta"}'),
    '23514 new row for relation "orders" violates check constraint "orders_payment_method_valid"', 'I manual: con un medio de pago que no existe'),
  ('I', 'manual', 'i', 'i:c1', pg_temp.pedido_json('i', 'inv-medio-04', jsonb_build_array(pg_temp.linea('i:lata', 1)), '{"payment_method": "qa_no_charge"}'),
    '23514 new row for relation "orders" violates check constraint "orders_qa_payment_method_requires_qa_origin"', 'I manual: con el medio «sin cobro» de QA'),
  ('I', 'manual', 'i', 'i:c1', pg_temp.pedido_json('i', 'inv-medio-05', jsonb_build_array(pg_temp.linea('i:lata', 1)), '{"manual_payment_status": "confirmed"}'),
    '22023 campo no permitido en pedido: manual_payment_status', 'I manual: un pedido que se declara ya cobrado'),
  ('I', 'checkout', 'i', 'i:c1', pg_temp.checkout_json('i', 'inv-medio-11', jsonb_build_array(pg_temp.linea('i:lata', 1)), '{"payment_method": "cash"}'),
    '22023 medio de pago invalido para Checkout Pro', 'I checkout: una sesion en efectivo'),
  ('I', 'checkout', 'i', 'i:c1', pg_temp.checkout_json('i', 'inv-medio-12', jsonb_build_array(pg_temp.linea('i:lata', 1))) - 'payment_method',
    '22023 medio de pago invalido para Checkout Pro', 'I checkout: una sesion sin medio de pago');
select * from pg_temp.rechazos('I');

-- EL TRIGGER DIFERIDO. La puerta manual acepta el payload que dice «mercadopago»: quien
-- lo frena es `orders_assert_payment_modality` al confirmar la transacción. `pedir` hace
-- lo que haría ese COMMIT.
select matches(
  pg_temp.pedir('i:c1', pg_temp.pedido_json('i', 'inv-medio-06', jsonb_build_array(pg_temp.linea('i:lata', 1)), '{"payment_method": "mercadopago"}')),
  '^23514 pedido \S+ declara pago Mercado Pago sin intent verificado y completado$',
  'I manual: un pedido que se declara pagado por Mercado Pago sin haber pagado no se confirma (23514, del trigger diferido)');
select is(pg_temp.foto('i'),
  'pedidos=3 renglones=3 eventos=3 recibos=0 sesiones=1 intents=1 reservas=0a+1c+0l eventos_pago=3 lata=17 agua=20',
  'I: ese intento no dejo nada: siguen los tres pedidos legitimos y el mismo stock');

-- Lo mismo con la clave de servicio: el trigger vale para todos los roles.
select matches(pg_temp.confirmar('service_role', pg_temp.fila_pedido('i', 'INV-I-MP', '{"payment_method": "mercadopago"}')),
  '^23514 pedido INV-I-MP declara pago Mercado Pago sin intent verificado y completado$',
  'I trigger: con la clave de servicio, un pedido mercadopago sin intent completado no se confirma');
select matches(pg_temp.confirmar('dueno', pg_temp.fila_pedido('i', 'INV-I-MP', '{"payment_method": "mercadopago"}')),
  '^23514 pedido INV-I-MP declara pago Mercado Pago sin intent verificado y completado$',
  'I trigger: tampoco para el dueno de la base');
select is(pg_temp.confirmar('service_role', pg_temp.fila_pedido('i', 'INV-I-NULL', '{"payment_method": null}')),
  '23502 null value in column "payment_method" of relation "orders" violates not-null constraint',
  'I esquema: un pedido sin medio de pago no se puede escribir');
select is(pg_temp.confirmar('service_role', pg_temp.fila_pedido('i', 'INV-I-OTRO', '{"payment_method": "tarjeta"}')),
  '23514 new row for relation "orders" violates check constraint "orders_payment_method_valid"',
  'I esquema: ni con un medio fuera del vocabulario');
select is(pg_temp.confirmar('service_role', pg_temp.fila_pedido('i', 'INV-I-EFECTIVO', '{"manual_payment_status": null}')), 'ok',
  'I: un pedido en efectivo escrito sin estado de cobro se acepta...');
select is(pg_temp.pago_del_pedido(pg_temp.pedido('i', 'inv-directo-inv-i-efectivo')), 'medio=cash manual=pending estado=pending',
  'I: ...porque el trigger de alta le pone pending aunque el INSERT diga NULL');
select is(pg_temp.confirmar('service_role', format($f$update public.orders set manual_payment_status = 'pagado' where id = %L$f$,
    pg_temp.pedido('i', 'inv-directo-inv-i-efectivo'))),
  '23514 new row for relation "orders" violates check constraint "orders_manual_payment_consistent"',
  'I esquema: un estado de cobro inventado no se puede escribir');
select is(pg_temp.confirmar('service_role', format($f$update public.orders set manual_payment_status = 'confirmed' where id = %L$f$,
    pg_temp.pedido('i', 'inv-directo-inv-i-efectivo'))),
  '23514 new row for relation "orders" violates check constraint "orders_manual_payment_consistent"',
  'I esquema: ni «confirmed» sin el medio y el momento del cobro');
select is(pg_temp.confirmar('service_role', format($f$update public.orders set payment_method = 'mercadopago' where id = %L$f$,
    pg_temp.pedido('i', 'inv-directo-inv-i-efectivo'))),
  '23514 new row for relation "orders" violates check constraint "orders_manual_payment_consistent"',
  'I esquema: pasar un pedido en efectivo a mercadopago choca con su estado de cobro manual');

-- LIMITACION: el estado de cobro manual se puede BORRAR. Debería rechazarse; hoy la
-- clave de servicio deja un pedido en efectivo con `manual_payment_status` en NULL. La
-- lectura del Panel lo sigue mostrando «pendiente».
select is(pg_temp.confirmar('service_role', format($f$update public.orders set manual_payment_status = null where id = %L$f$,
    pg_temp.pedido('i', 'inv-directo-inv-i-efectivo'))),
  'ok', 'LIMITACION I: con la clave de servicio, el estado de cobro de un pedido en efectivo se puede dejar en NULL');
select is(pg_temp.pago_del_pedido(pg_temp.pedido('i', 'inv-directo-inv-i-efectivo')), 'medio=cash manual=NULL estado=pending',
  'LIMITACION I: queda sin estado de cobro guardado; private.order_payment_state lo informa como pending');
-- Con el estado en NULL el CHECK ya no frena el cambio de medio: ahí dispara el trigger.
select matches(pg_temp.confirmar('service_role', format($f$update public.orders set payment_method = 'mercadopago' where id = %L$f$,
    pg_temp.pedido('i', 'inv-directo-inv-i-efectivo'))),
  '^23514 pedido INV-I-EFECTIVO declara pago Mercado Pago sin intent verificado y completado$',
  'I trigger: tambien dispara en el UPDATE del medio de pago, no solo en el alta');
-- LIMITACION: el medio de pago de un pedido YA COBRADO por Mercado Pago se puede cambiar.
-- Debería rechazarse (es parte de lo cobrado, como el importe); hoy la clave de servicio
-- lo pasa a efectivo y el pedido deja de figurar como pagado.
select is(pg_temp.confirmar('service_role', format($f$update public.orders set payment_method = 'cash' where id = %L$f$,
    (pg_temp.sesion('i1')).completed_order_id)),
  'ok', 'LIMITACION I: con la clave de servicio, el pedido pagado por Mercado Pago se puede pasar a efectivo');
select is(pg_temp.pago_del_pedido((pg_temp.sesion('i1')).completed_order_id), 'medio=cash manual=NULL estado=pending',
  'LIMITACION I: y pasa de pago confirmado a pendiente, sin estado de cobro manual');

-- ══════════════════════════════════════════════════════════════════════════
--  J · CONFIRMAR DOS VECES EL COBRO MANUAL
-- ══════════════════════════════════════════════════════════════════════════
select matches(pg_temp.pedir('j:c1', pg_temp.pedido_json('j', 'inv-cobro-efectivo', jsonb_build_array(pg_temp.linea('j:lata', 2)))),
  '^ok ', 'J: un pedido en efectivo por 2000');
select is(pg_temp.cobro(pg_temp.pedido('j', 'inv-cobro-efectivo')), 'manual=pending medio=- rev=3 eventos=0 recibos=0', 'J: nace con el cobro pendiente');
select is(pg_temp.cobrar('j:staff', pg_temp.pedido('j', 'inv-cobro-efectivo'), 3, 'cash', 'inv-cobrar-0001'),
  '{"ok": true, "code": "confirmed", "amount": 2000, "revision": 4, "actual_method": "cash", "manual_payment_status": "confirmed"}'::jsonb,
  'J: el operador confirma el cobro en efectivo: por el total del pedido');
select is(pg_temp.cobro(pg_temp.pedido('j', 'inv-cobro-efectivo')), 'manual=confirmed medio=cash rev=4 eventos=1 recibos=1',
  'J: queda confirmado, con un evento y un recibo');

select is(pg_temp.cobrar('j:staff', pg_temp.pedido('j', 'inv-cobro-efectivo'), 3, 'cash', 'inv-cobrar-0001'),
  '{"ok": true, "code": "confirmed", "amount": 2000, "revision": 4, "actual_method": "cash", "manual_payment_status": "confirmed", "idempotent_replay": true}'::jsonb,
  'J: la misma llamada otra vez (misma clave) devuelve el recibo guardado, marcado como repeticion');
select is(pg_temp.cobrar('j:staff', pg_temp.pedido('j', 'inv-cobro-efectivo'), 4, 'cash', 'inv-cobrar-0002'),
  '{"ok": true, "code": "already_confirmed", "revision": 4, "idempotent_no_op": true, "manual_payment_status": "confirmed"}'::jsonb,
  'J: confirmar de nuevo con otra clave responde already_confirmed y no hace nada');
select is(pg_temp.cobrar('j:owner', pg_temp.pedido('j', 'inv-cobro-efectivo'), 3, 'cash', 'inv-cobrar-0003'),
  '{"ok": true, "code": "already_confirmed", "revision": 4, "idempotent_no_op": true, "manual_payment_status": "confirmed"}'::jsonb,
  'J: lo mismo si lo intenta el dueno desde otra pantalla con la revision vieja');
select is(pg_temp.cobrar('j:staff', pg_temp.pedido('j', 'inv-cobro-efectivo'), 4, 'transfer', 'inv-cobrar-0004'),
  '{"error": "22023", "message": "El pedido no admite este cobro manual"}'::jsonb,
  'J: y un pedido en efectivo no se cobra por transferencia');
select is(pg_temp.cobro(pg_temp.pedido('j', 'inv-cobro-efectivo')) || ' | ' || pg_temp.importe(pg_temp.pedido('j', 'inv-cobro-efectivo')),
  'manual=confirmed medio=cash rev=4 eventos=1 recibos=1 | subtotal=2000.00 descuento=0.00 envio=0.00 total=2000.00 renglones=2000.00 combos=0',
  'J: los cuatro intentos no escribieron nada: un cobro, un evento, un recibo, la misma revision y el mismo importe');
select is(
  (select o.manual_payment_confirmed_by = pg_temp.id('j:staff') from public.orders o where o.id = pg_temp.pedido('j', 'inv-cobro-efectivo')),
  true, 'J: y quien cobro sigue siendo el primer operador');

-- A coordinar: revisión vieja, medio inválido, cobro, y la misma clave con otro medio.
select matches(pg_temp.pedir('j:c1', pg_temp.pedido_json('j', 'inv-cobro-coordinar', jsonb_build_array(pg_temp.linea('j:lata', 1)), '{"payment_method": "coordinate"}')),
  '^ok ', 'J: un pedido a coordinar por 1000');
select is(pg_temp.cobrar('j:staff', pg_temp.pedido('j', 'inv-cobro-coordinar'), 1, 'transfer', 'inv-cobrar-0011'),
  '{"error": "PT409", "message": "Revisión de pedido obsoleta"}'::jsonb, 'J: cobrar con una revision vieja es un conflicto (PT409)');
select is(pg_temp.cobrar('j:staff', pg_temp.pedido('j', 'inv-cobro-coordinar'), 3, 'tarjeta', 'inv-cobrar-0012'),
  '{"error": "22023", "message": "Medio de cobro manual inválido"}'::jsonb, 'J: un medio de cobro que no es efectivo ni transferencia se rechaza');
select is(pg_temp.cobrar('j:c1', pg_temp.pedido('j', 'inv-cobro-coordinar'), 3, 'transfer', 'inv-cobrar-0013'),
  '{"error": "42501", "message": "Operador no autorizado"}'::jsonb, 'J: el cliente no confirma su propio cobro');
select is(pg_temp.cobro(pg_temp.pedido('j', 'inv-cobro-coordinar')), 'manual=pending medio=- rev=3 eventos=0 recibos=0',
  'J: los tres rechazos no escribieron nada');
select is(pg_temp.cobrar('j:staff', pg_temp.pedido('j', 'inv-cobro-coordinar'), 3, 'transfer', 'inv-cobrar-0014') ->> 'code', 'confirmed',
  'J: con la revision vigente se cobra por transferencia');
select is(pg_temp.cobrar('j:staff', pg_temp.pedido('j', 'inv-cobro-coordinar'), 3, 'cash', 'inv-cobrar-0014'),
  '{"error": "23505", "message": "Clave de idempotencia reutilizada con otro comando"}'::jsonb,
  'J: la misma clave con otro medio se rechaza (23505)');
select is(pg_temp.cobro(pg_temp.pedido('j', 'inv-cobro-coordinar')), 'manual=confirmed medio=transfer rev=4 eventos=1 recibos=1',
  'J: queda un solo cobro, por transferencia');

-- Un pedido cancelado no se cobra, y uno cobrado no se cancela sin devolver.
select matches(pg_temp.pedir('j:c2', pg_temp.pedido_json('j', 'inv-cobro-cancelado', jsonb_build_array(pg_temp.linea('j:lata', 1)))),
  '^ok ', 'J: otro pedido en efectivo');
select is(pg_temp.mover('j:staff', pg_temp.pedido('j', 'inv-cobro-cancelado'), 'cancelled'), 'ok cancelled rev 4', 'J: el comercio lo cancela');
select is(pg_temp.cobrar('j:staff', pg_temp.pedido('j', 'inv-cobro-cancelado'), 4, 'cash', 'inv-cobrar-0021'),
  '{"error": "55000", "message": "Pedido terminal sin cobro permitido"}'::jsonb, 'J: cobrar un pedido cancelado se rechaza');
select is(pg_temp.cobro(pg_temp.pedido('j', 'inv-cobro-cancelado')), 'manual=pending medio=- rev=4 eventos=0 recibos=0', 'J: y no escribe nada');
insert into inv_casos (grupo, puerta, negocio, actor, pedido, destino, esperado, que) values
  ('J', 'transicion', 'j', 'j:staff', pg_temp.pedido('j', 'inv-cobro-efectivo'), 'cancelled',
    '55000 Devolvé y registrá el cobro manual antes de cancelar el pedido', 'J: cancelar un pedido con el cobro confirmado'),
  ('J', 'transicion', 'j', 'j:staff', pg_temp.pedido('j', 'inv-cobro-efectivo'), 'rejected',
    '55000 Devolvé y registrá el cobro manual antes de cancelar el pedido', 'J: rechazar un pedido con el cobro confirmado');
select * from pg_temp.rechazos('J');

-- ══════════════════════════════════════════════════════════════════════════
--  K · LA MÁQUINA DE ESTADOS DEL PEDIDO
-- ══════════════════════════════════════════════════════════════════════════
-- Cada fila de la matriz se obtiene ensayando, desde el estado en que está el pedido,
-- la transición a cada uno de los once estados con `transition_order`, como operador:
--   si = permitida · igual = no-op (ya está ahí) · un SQLSTATE = rechazada
-- El ensayo se deshace siempre; el avance de verdad se hace después, y se comprueba.
select matches(pg_temp.pedir('k:c1', pg_temp.pedido_json('k', 'inv-estado-retiro', jsonb_build_array(pg_temp.linea('k:lata', 2)))), '^ok ', 'K: pedido de retiro');
select matches(pg_temp.pedir('k:c1', pg_temp.pedido_json('k', 'inv-estado-envio', jsonb_build_array(pg_temp.linea('k:lata', 2)), pg_temp.envio_json())), '^ok ', 'K: pedido de envio');
select matches(pg_temp.pedir('k:c1', pg_temp.pedido_json('k', 'inv-estado-cancelado', jsonb_build_array(pg_temp.linea('k:lata', 2)))), '^ok ', 'K: pedido que se va a cancelar');
select matches(pg_temp.pedir('k:c1', pg_temp.pedido_json('k', 'inv-estado-rechazado', jsonb_build_array(pg_temp.linea('k:lata', 2)))), '^ok ', 'K: pedido que se va a rechazar');
select matches(pg_temp.pedir('k:c1', pg_temp.pedido_json('k', 'inv-estado-saltos', jsonb_build_array(pg_temp.linea('k:lata', 2)))), '^ok ', 'K: pedido para los saltos');
select is(pg_temp.sesion_nueva('k1', 'k', 'k:c2', jsonb_build_array(pg_temp.linea('k:lata', 1))), 'ok', 'K: sesion de Mercado Pago');
select is(pg_temp.registrar('k1', pg_temp.pago('k1', 'INV-PAY-K1', 'approved', 'k1-aprobado')) ->> 'finalize_required', 'true', 'K: cobro aprobado');
select is(pg_temp.finalizar(pg_temp.id('k1')) ->> 'ok', 'true', 'K: pedido pagado por Mercado Pago');
create temporary table inv_k on commit drop as select pg_temp.foto('k') as foto;
select is((select foto from inv_k),
  'pedidos=6 renglones=6 eventos=6 recibos=0 sesiones=1 intents=1 reservas=0a+1c+0l eventos_pago=3 lata=39 agua=50',
  'K: seis pedidos recibidos, 11 latas menos');

-- Recibido.
select is(pg_temp.fila('k:staff', pg_temp.pedido('k', 'inv-estado-retiro')),
  'received=igual accepted=si preparing=23514 ready=23514 assigned=23514 picked_up=23514 on_the_way=23514 arrived=23514 delivered=23514 cancelled=si rejected=si',
  'K recibido: se acepta, se rechaza o se cancela; no se saltea a preparar, listo ni entregado');
select is(pg_temp.fila('k:staff', (pg_temp.sesion('k1')).completed_order_id),
  'received=igual accepted=si preparing=23514 ready=23514 assigned=23514 picked_up=23514 on_the_way=23514 arrived=23514 delivered=23514 cancelled=55000 rejected=55000',
  'K recibido y pagado por Mercado Pago: se acepta, pero no se cancela ni se rechaza por esta puerta (55000: va por el reembolso)');
select is(pg_temp.estado(pg_temp.pedido('k', 'inv-estado-retiro')) || ' | ' || pg_temp.foto('k'), 'received rev 3 | ' || (select foto from inv_k),
  'K: los 22 ensayos no dejaron nada: mismo estado, misma revision, sin eventos ni recibos, mismo stock');

-- Aceptado, en preparación, listo, entregado (retiro).
select is(pg_temp.mover('k:staff', pg_temp.pedido('k', 'inv-estado-retiro'), 'accepted'), 'ok accepted rev 4', 'K: recibido -> aceptado, la revision sube en uno');
select is(pg_temp.fila('k:staff', pg_temp.pedido('k', 'inv-estado-retiro')),
  'received=22023 accepted=igual preparing=si ready=23514 assigned=23514 picked_up=23514 on_the_way=23514 arrived=23514 delivered=23514 cancelled=si rejected=23514',
  'K aceptado: pasa a preparacion o se cancela; no vuelve a recibido, no se rechaza y no saltea a listo');
select is(pg_temp.mover('k:staff', pg_temp.pedido('k', 'inv-estado-retiro'), 'preparing'), 'ok preparing rev 5', 'K: aceptado -> en preparacion');
select is(pg_temp.fila('k:staff', pg_temp.pedido('k', 'inv-estado-retiro')),
  'received=22023 accepted=23514 preparing=igual ready=si assigned=23514 picked_up=23514 on_the_way=23514 arrived=23514 delivered=23514 cancelled=si rejected=23514',
  'K en preparacion: pasa a listo o se cancela; no vuelve a aceptado ni saltea a entregado');
select is(pg_temp.mover('k:staff', pg_temp.pedido('k', 'inv-estado-retiro'), 'ready'), 'ok ready rev 6', 'K: en preparacion -> listo');
select is(pg_temp.fila('k:staff', pg_temp.pedido('k', 'inv-estado-retiro')),
  'received=22023 accepted=23514 preparing=23514 ready=igual assigned=23514 picked_up=23514 on_the_way=23514 arrived=23514 delivered=si cancelled=si rejected=23514',
  'K listo (retiro): se entrega o se cancela; no sale a reparto ni vuelve atras');
select is(pg_temp.mover('k:staff', pg_temp.pedido('k', 'inv-estado-retiro'), 'delivered'), 'ok delivered rev 7', 'K: listo -> entregado');
select is(pg_temp.fila('k:staff', pg_temp.pedido('k', 'inv-estado-retiro')),
  'received=22023 accepted=23514 preparing=23514 ready=23514 assigned=23514 picked_up=23514 on_the_way=23514 arrived=23514 delivered=igual cancelled=23514 rejected=23514',
  'K entregado: terminal. No se cancela, no se rechaza y no vuelve a ningun estado');

-- Cancelado y rechazado.
select is(pg_temp.mover('k:staff', pg_temp.pedido('k', 'inv-estado-cancelado'), 'cancelled'), 'ok cancelled rev 4', 'K: recibido -> cancelado');
select is(pg_temp.fila('k:staff', pg_temp.pedido('k', 'inv-estado-cancelado')),
  'received=22023 accepted=23514 preparing=23514 ready=23514 assigned=23514 picked_up=23514 on_the_way=23514 arrived=23514 delivered=23514 cancelled=igual rejected=23514',
  'K cancelado: terminal. No se acepta, no se entrega y no pasa a rechazado');
select is(pg_temp.mover('k:staff', pg_temp.pedido('k', 'inv-estado-rechazado'), 'rejected'), 'ok rejected rev 4', 'K: recibido -> rechazado');
select is(pg_temp.fila('k:staff', pg_temp.pedido('k', 'inv-estado-rechazado')),
  'received=22023 accepted=23514 preparing=23514 ready=23514 assigned=23514 picked_up=23514 on_the_way=23514 arrived=23514 delivered=23514 cancelled=23514 rejected=igual',
  'K rechazado: terminal. Ni siquiera se cancela');

-- Envío: listo y en camino.
select is(
  concat_ws(' / ', pg_temp.mover('k:staff', pg_temp.pedido('k', 'inv-estado-envio'), 'accepted'),
    pg_temp.mover('k:staff', pg_temp.pedido('k', 'inv-estado-envio'), 'preparing'),
    pg_temp.mover('k:staff', pg_temp.pedido('k', 'inv-estado-envio'), 'ready')),
  'ok accepted rev 4 / ok preparing rev 5 / ok ready rev 6', 'K: el envio avanza hasta listo');
select is(pg_temp.fila('k:staff', pg_temp.pedido('k', 'inv-estado-envio')),
  'received=22023 accepted=23514 preparing=23514 ready=igual assigned=23514 picked_up=23514 on_the_way=si arrived=23514 delivered=23514 cancelled=si rejected=23514',
  'K listo (envio sin repartidor): el comercio lo despacha o lo cancela; no lo da por entregado');
select is(pg_temp.mover('k:staff', pg_temp.pedido('k', 'inv-estado-envio'), 'on_the_way'), 'ok on_the_way rev 7', 'K: listo -> en camino');
select is(pg_temp.fila('k:staff', pg_temp.pedido('k', 'inv-estado-envio')),
  'received=22023 accepted=23514 preparing=23514 ready=23514 assigned=23514 picked_up=23514 on_the_way=igual arrived=23514 delivered=23514 cancelled=si rejected=23514',
  'K en camino: por esta puerta solo se cancela; el cierre es con el codigo de entrega, no una arista de la matriz');

create temporary table inv_k2 on commit drop as select pg_temp.foto('k') as foto;
select is((select foto from inv_k2),
  'pedidos=6 renglones=6 eventos=16 recibos=10 sesiones=1 intents=1 reservas=0a+1c+0l eventos_pago=3 lata=43 agua=50',
  'K: diez transiciones de verdad = diez eventos y diez recibos; cancelar y rechazar devolvieron 2 latas cada uno, una vez');

-- Los rechazos, con su mensaje, uno por uno.
insert into inv_casos (grupo, puerta, negocio, actor, pedido, revision, destino, esperado, que) values
  ('K', 'transicion', 'k', 'k:staff', pg_temp.pedido('k', 'inv-estado-cancelado'), null, 'accepted',
    '23514 transicion no permitida: cancelled -> accepted', 'K: aceptar un pedido cancelado'),
  ('K', 'transicion', 'k', 'k:staff', pg_temp.pedido('k', 'inv-estado-cancelado'), null, 'delivered',
    '23514 transicion no permitida: cancelled -> delivered', 'K: entregar un pedido cancelado'),
  ('K', 'transicion', 'k', 'k:owner', pg_temp.pedido('k', 'inv-estado-cancelado'), null, 'preparing',
    '23514 transicion no permitida: cancelled -> preparing', 'K: tampoco el dueno lo reabre'),
  ('K', 'transicion', 'k', 'k:staff', pg_temp.pedido('k', 'inv-estado-rechazado'), null, 'accepted',
    '23514 transicion no permitida: rejected -> accepted', 'K: aceptar un pedido rechazado'),
  ('K', 'transicion', 'k', 'k:staff', pg_temp.pedido('k', 'inv-estado-retiro'), null, 'cancelled',
    '23514 transicion no permitida: delivered -> cancelled', 'K: cancelar un pedido entregado'),
  ('K', 'transicion', 'k', 'k:staff', pg_temp.pedido('k', 'inv-estado-retiro'), null, 'rejected',
    '23514 transicion no permitida: delivered -> rejected', 'K: rechazar un pedido entregado'),
  ('K', 'transicion', 'k', 'k:staff', pg_temp.pedido('k', 'inv-estado-retiro'), null, 'ready',
    '23514 transicion no permitida: delivered -> ready', 'K: volver un pedido entregado a listo'),
  ('K', 'transicion', 'k', 'k:staff', pg_temp.pedido('k', 'inv-estado-retiro'), null, 'received',
    '22023 estado destino invalido', 'K: volver un pedido entregado a recibido (recibido no es un destino)'),
  ('K', 'transicion', 'k', 'k:staff', pg_temp.pedido('k', 'inv-estado-saltos'), null, 'preparing',
    '23514 transicion no permitida: submitted -> preparing', 'K: saltear de recibido a en preparacion'),
  ('K', 'transicion', 'k', 'k:staff', pg_temp.pedido('k', 'inv-estado-saltos'), null, 'delivered',
    '23514 transicion no permitida: submitted -> delivered', 'K: saltear de recibido a entregado'),
  ('K', 'transicion', 'k', 'k:staff', pg_temp.pedido('k', 'inv-estado-saltos'), null, 'pagado',
    '22023 estado destino invalido', 'K: un estado que no existe'),
  ('K', 'transicion', 'k', 'k:staff', pg_temp.pedido('k', 'inv-estado-saltos'), null, '',
    '22023 estado destino requerido', 'K: sin estado destino'),
  ('K', 'transicion', 'k', 'k:staff', pg_temp.pedido('k', 'inv-estado-saltos'), 2, 'accepted',
    'PT409 revision desactualizada: esperada 2, actual 3', 'K: una transicion permitida con una revision vieja es un conflicto'),
  ('K', 'transicion', 'k', 'k:staff', pg_temp.pedido('k', 'inv-estado-saltos'), 4, 'accepted',
    'PT409 revision desactualizada: esperada 4, actual 3', 'K: y con una revision que todavia no existe tambien'),
  ('K', 'transicion', 'k', 'k:staff', pg_temp.pedido('k', 'inv-estado-saltos'), 0, 'accepted',
    '22023 expected_revision requerido', 'K: la revision cero no es una revision'),
  ('K', 'transicion', 'k', 'k:staff', pg_temp.pedido('k', 'inv-estado-retiro'), 1, 'delivered',
    'PT409 revision desactualizada: esperada 1, actual 7', 'K: la revision vieja se rechaza aunque el pedido ya este en ese estado'),
  ('K', 'transicion', 'k', 'k:c1', pg_temp.pedido('k', 'inv-estado-saltos'), null, 'cancelled',
    '42501 operador no autorizado', 'K: el cliente no usa esta puerta ni para cancelar lo suyo (tiene cancel_own_order)'),
  ('K', 'transicion', 'k', 'j:staff', pg_temp.pedido('k', 'inv-estado-saltos'), null, 'accepted',
    '42501 operador no autorizado', 'K: el operador de OTRO comercio tampoco'),
  ('K', 'transicion', 'k', 'k:staff', (pg_temp.sesion('k1')).completed_order_id, null, 'cancelled',
    '55000 pedido cobrado por Mercado Pago: gestionar reembolso desde Pagos', 'K: cancelar un pedido cobrado por Mercado Pago');
select * from pg_temp.rechazos('K');
select is(pg_temp.mover('k:staff', gen_random_uuid(), 'accepted', 1), 'P0002 pedido inexistente', 'K: un pedido que no existe');

-- Doble toque y clave repetida.
select is(pg_temp.mover('k:staff', pg_temp.pedido('k', 'inv-estado-cancelado'), 'cancelled'), 'ok cancelled rev 4 no_op',
  'K: cancelar por segunda vez es un no-op: mismo estado, misma revision');
select is(pg_temp.foto('k'),
  'pedidos=6 renglones=6 eventos=16 recibos=11 sesiones=1 intents=1 reservas=0a+1c+0l eventos_pago=3 lata=43 agua=50',
  'K: el no-op no agrega evento ni devuelve stock otra vez; solo deja el recibo de su clave');
select is(pg_temp.mover('k:staff', pg_temp.pedido('k', 'inv-estado-saltos'), 'accepted', 3, 'inv-clave-repetida-01'), 'ok accepted rev 4',
  'K: una transicion con clave propia');
select is(pg_temp.mover('k:staff', pg_temp.pedido('k', 'inv-estado-saltos'), 'accepted', 3, 'inv-clave-repetida-01'), 'ok accepted rev 4 replay',
  'K: la misma llamada con la misma clave devuelve el recibo guardado (respuesta perdida)');
select is(pg_temp.mover('k:staff', pg_temp.pedido('k', 'inv-estado-saltos'), 'cancelled', 3, 'inv-clave-repetida-01'),
  '23505 idempotency_key reutilizada con otro payload', 'K: la misma clave con otro destino se rechaza (23505)');
select is(pg_temp.estado(pg_temp.pedido('k', 'inv-estado-saltos')) || ' | ' || pg_temp.foto('k'),
  'accepted rev 4 | pedidos=6 renglones=6 eventos=17 recibos=12 sesiones=1 intents=1 reservas=0a+1c+0l eventos_pago=3 lata=43 agua=50',
  'K: una transicion, un evento y un recibo: la repeticion y el rechazo no escribieron');

-- Fuera de las RPC. Un cliente no tiene UPDATE sobre `orders`; la clave de servicio sí.
select is(pg_temp.confirmar('authenticated', format($f$update public.orders set status = 'accepted' where id = %L$f$, pg_temp.pedido('k', 'inv-estado-cancelado'))),
  '42501 permission denied for table orders', 'K: authenticated no cambia el estado de un pedido con un UPDATE');
-- LIMITACION: ningún trigger prohíbe salir de un estado terminal. Debería rechazarse; hoy
-- la matriz vive sólo en `change_order_status` y la clave de servicio reabre un pedido
-- cancelado cuyo stock ya se devolvió.
select is(pg_temp.confirmar('service_role', format($f$update public.orders set status = 'accepted' where id = %L$f$, pg_temp.pedido('k', 'inv-estado-cancelado'))),
  'ok', 'LIMITACION K: con la clave de servicio un pedido cancelado se puede volver a aceptado con un UPDATE directo');
select is(
  pg_temp.estado(pg_temp.pedido('k', 'inv-estado-cancelado')) || ' stock_devuelto='
    || (select o.inventory_released_at is not null from public.orders o where o.id = pg_temp.pedido('k', 'inv-estado-cancelado'))
    || ' lata=' || (select p.stock from public.products p where p.id = pg_temp.id('k:lata')),
  'accepted rev 5 stock_devuelto=true lata=43',
  'LIMITACION K: queda aceptado, con el stock ya devuelto y sin volver a descontarlo');

-- Lo que el COMMIT verificaría con todo lo anterior hecho.
select lives_ok($$set constraints all immediate$$, 'los resguardos diferidos de orders aceptan el resultado');

select * from finish();
rollback;
