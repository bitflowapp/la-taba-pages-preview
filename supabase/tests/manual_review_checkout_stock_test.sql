-- TABA · UN CHECKOUT EN REVISIÓN MANUAL NO PIERDE NI DUPLICA STOCK
--
-- Una sesión de Mercado Pago llega a `manual_review_required` con su reserva
-- todavía `active` cuando el cobro se aprueba entre `expires_at` y el minuto del
-- barrido, o cuando se aprobó a tiempo y la finalización corrió tarde. Antes:
--
--   · rearmar el pedido descontaba el stock por segunda vez (10 - 3 - 3 = 4);
--   · con las últimas unidades el rearmado decía «no hay stock» de lo que esa
--     misma sesión retenía;
--   · devolver el dinero no devolvía las unidades;
--   · se podía rearmar un pedido sobre un cobro ya reembolsado, con el reembolso
--     pedido o con el reembolso dudoso.
--
-- Acá se prueba, en el orden que los tests anteriores no cubrían (aprobación
-- ANTES del barrido), que:
--
--   · rearmar descuenta UNA vez y crea UN pedido, y repetirlo es idempotente;
--   · el reembolso total sin pedido devuelve stock y disponibilidad UNA vez;
--   · el reembolso parcial no toca stock, y el que completa el total sí;
--   · sólo se vuelve a reservar el producto que no tiene reserva activa, todo o nada;
--   · con dinero devuelto o reembolso en curso no se rearma (55000) y el Panel no
--     ofrece el botón; un reembolso rechazado no bloquea;
--   · la alerta receta una acción que funciona en cada estado;
--   · un reembolso propio no pisa lo que informó el proveedor ni retrocede el estado.
--
-- El tiempo se simula moviendo `created_at`/`expires_at` de la sesión y de sus
-- reservas respecto del reloj: no depende de la hora en que corre.
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(87);

-- ── Fixture ────────────────────────────────────────────────────────────────
create temporary table caso (
  k text primary key, business_id uuid, product_id uuid, product2_id uuid,
  owner_id uuid, customer_id uuid, session_id uuid, intent_id uuid
) on commit drop;

create function pg_temp.usuario(p_tag text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_id,'authenticated','authenticated',p_tag || '-' || replace(v_id::text,'-','') || '@example.invalid','',now(),'{}','{}',now(),now());
  return v_id;
end;
$$;

create function pg_temp.producto(p_business uuid, p_owner uuid, p_sku text, p_stock integer) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_id,p_business,'Lata ' || p_sku,'Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    p_stock,true,true,false,'{}',true,now(),p_owner,p_sku,p_sku,'commercial',1);
  return v_id;
end;
$$;

-- Un negocio, su dueño con sesión registrada, uno o dos productos y un checkout
-- de Mercado Pago de p_qty unidades de cada uno. El guardián de admisión se
-- apaga: acá no es lo que se prueba.
create function pg_temp.armar(p_k text, p_stock integer, p_qty integer, p_dos_productos boolean default false)
returns void language plpgsql as $$
declare
  v_business uuid := gen_random_uuid();
  v_owner uuid := pg_temp.usuario('mr-owner-' || p_k);
  v_customer uuid := pg_temp.usuario('mr-cliente-' || p_k);
  v_p1 uuid; v_p2 uuid; v_session uuid; v_items jsonb;
begin
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode
  ) values (
    v_business, 'TABA revision manual ' || p_k, 'taba-revision-manual-' || p_k, 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off'
  );
  insert into public.business_members (business_id, user_id, role, is_active) values (v_business, v_owner, 'owner', true);
  insert into public.identity_sessions(session_id, user_id, business_id, role_at_login, client)
  values (v_owner, v_owner, v_business, 'owner', 'panel_web');
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'collector-mr-' || p_k, 'app-mr-' || p_k, clock_timestamp(), clock_timestamp());
  v_p1 := pg_temp.producto(v_business, v_owner, 'mr-' || p_k || '-a', p_stock);
  v_items := jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', p_qty));
  if p_dos_productos then
    v_p2 := pg_temp.producto(v_business, v_owner, 'mr-' || p_k || '-b', p_stock);
    v_items := v_items || jsonb_build_object('product_id', v_p2, 'quantity', p_qty);
  end if;
  v_session := (public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'mr-' || p_k || '-0001',
    'items', v_items, 'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Cliente Revision', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'
  )) ->> 'checkout_session_id')::uuid;
  insert into caso values (p_k, v_business, v_p1, v_p2, v_owner, v_customer, v_session,
    (select id from public.payment_intents where checkout_session_id = v_session));
end;
$$;

create function pg_temp.sid(p_k text) returns uuid language sql as $$ select session_id from caso where k = p_k $$;
create function pg_temp.iid(p_k text) returns uuid language sql as $$ select intent_id from caso where k = p_k $$;

-- Lo que Mercado Pago informa del pago, ya verificado por la Edge Function.
create function pg_temp.snapshot(p_k text, p_status text default 'approved', p_refunded numeric default 0, p_amount numeric default null)
returns jsonb language sql as $$
  select jsonb_build_object(
    'provider_payment_id', 'PAY-' || right(replace(c.session_id::text, '-', ''), 12),
    'external_reference', 'taba2:checkout:' || c.session_id::text,
    'preference_id', pi.preference_id, 'merchant_order_id', 'MO-' || right(replace(c.session_id::text, '-', ''), 8),
    'collector_id', ps.collector_id, 'currency', 'ARS',
    'transaction_amount', coalesce(p_amount, pi.expected_amount)::text, 'status', p_status,
    'status_detail', 'accredited', 'payment_method', 'visa', 'live_mode', false,
    'provider_occurred_at', clock_timestamp()::text, 'refunded_amount', p_refunded::text,
    'payer_email_hash', encode(gen_random_bytes(32), 'hex'),
    'raw_response_hash', encode(gen_random_bytes(32), 'hex'))
  from caso c
  join public.payment_intents pi on pi.id = c.intent_id
  join public.business_payment_settings ps on ps.business_id = c.business_id and ps.provider = 'mercadopago'
  where c.k = p_k;
$$;

create function pg_temp.asentar(p_k text, p_status text default 'approved', p_refunded numeric default 0, p_amount numeric default null)
returns jsonb language sql as $$
  select public.record_mercadopago_payment_snapshot(pg_temp.iid(p_k), pg_temp.snapshot(p_k, p_status, p_refunded, p_amount), 'webhook', null);
$$;

-- Pasa el tiempo: la sesión y sus reservas activas vencieron hace p_vencida.
create function pg_temp.envejecer(p_k text, p_vencida interval) returns void language sql as $$
  with s as (
    update public.checkout_sessions
       set created_at = clock_timestamp() - p_vencida - interval '15 minutes',
           expires_at = clock_timestamp() - p_vencida
     where id = pg_temp.sid(p_k) returning id
  )
  update public.inventory_reservations
     set created_at = clock_timestamp() - p_vencida - interval '15 minutes',
         expires_at = clock_timestamp() - p_vencida
   where checkout_session_id = (select id from s) and status = 'active';
$$;

create function pg_temp.como_dueno(p_k text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', owner_id, 'role', 'authenticated', 'session_id', owner_id)::text, true)::void
    from caso where k = p_k;
$$;
create function pg_temp.sin_identidad() returns void language sql as $$
  select set_config('request.jwt.claims', '', true)::void;
$$;

create function pg_temp.rearmar(p_k text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.como_dueno(p_k);
  v := public.recover_paid_checkout_order(pg_temp.sid(p_k));
  perform pg_temp.sin_identidad();
  return v;
end;
$$;

-- Pide el reembolso como el dueño y, según p_status, asienta la respuesta como
-- lo hace la Edge Function: `null` lo deja pedido, 'ambiguous' lo deja dudoso.
create function pg_temp.reembolsar(p_k text, p_amount numeric, p_status text, p_provider_refund text default null)
returns jsonb language plpgsql as $$
declare v_prep jsonb;
begin
  perform pg_temp.como_dueno(p_k);
  v_prep := public.prepare_payment_refund_v2(pg_temp.iid(p_k), p_amount, gen_random_uuid(), 'prueba');
  perform pg_temp.sin_identidad();
  if p_status is null then return v_prep; end if;
  if p_status = 'ambiguous' then
    perform public.mark_payment_refund_ambiguous((v_prep ->> 'refund_id')::uuid, encode(gen_random_bytes(32), 'hex'), 'network_or_timeout');
    return v_prep;
  end if;
  if p_status = 'approved' then
    perform public.record_payment_refund_identity((v_prep ->> 'refund_id')::uuid, pg_temp.iid(p_k),
      v_prep ->> 'provider_payment_id', (v_prep ->> 'idempotency_key')::uuid, p_provider_refund);
  end if;
  return v_prep || public.record_payment_refund_response_v2((v_prep ->> 'refund_id')::uuid,
    case when p_status = 'approved' then p_provider_refund else '' end,
    p_status, (v_prep ->> 'amount')::numeric, encode(gen_random_bytes(32), 'hex'));
end;
$$;

create function pg_temp.stock(p_k text, p_segundo boolean default false) returns integer language sql as $$
  select p.stock from public.products p join caso c on p.id = case when p_segundo then c.product2_id else c.product_id end where c.k = p_k;
$$;
create function pg_temp.disponible(p_k text) returns boolean language sql as $$
  select p.available from public.products p join caso c on p.id = c.product_id where c.k = p_k;
$$;
-- «g1:active:3 g2:converted:3», por producto y generación.
create function pg_temp.reservas(p_k text) returns text language sql as $$
  select coalesce(string_agg(format('g%s:%s:%s', r.reservation_generation, r.status, r.quantity), ' '
           order by r.product_id = c.product_id desc, r.reservation_generation), 'ninguna')
    from caso c join public.inventory_reservations r on r.checkout_session_id = c.session_id
   where c.k = p_k;
$$;
create function pg_temp.pedidos(p_k text) returns text language sql as $$
  select format('%s pedido(s), %s unidad(es)',
    (select count(*) from public.orders o where o.business_id = c.business_id),
    (select coalesce(sum(oi.quantity), 0)::integer from public.order_items oi join public.orders o on o.id = oi.order_id where o.business_id = c.business_id))
    from caso c where c.k = p_k;
$$;
create function pg_temp.estado(p_k text) returns text language sql as $$
  select s.status || '/' || coalesce(s.manual_review_reason, '-') || ' ' || pi.internal_status
    from caso c join public.checkout_sessions s on s.id = c.session_id join public.payment_intents pi on pi.id = c.intent_id
   where c.k = p_k;
$$;
create function pg_temp.alerta(p_k text) returns text language sql as $$
  select coalesce((select a.state || ' -> ' || a.action from public.list_stock_reservation_alerts() a
                    where a.checkout_session_id = pg_temp.sid(p_k) limit 1), 'sin alerta');
$$;

-- ══ 1 · CONTRATO Y PRIVILEGIOS ══════════════════════════════════════════════
select ok(
  has_function_privilege('authenticated', 'public.recover_paid_checkout_order(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.recover_paid_checkout_order(uuid)', 'EXECUTE'),
  'rearmar el pedido sigue siendo del Panel autenticado y nunca de anon');
select ok(
  has_function_privilege('authenticated', 'public.can_recover_paid_checkout(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.can_recover_paid_checkout(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.can_recover_paid_checkout(uuid)', 'EXECUTE'),
  'can_recover_paid_checkout conserva sus privilegios');
select ok(
  has_function_privilege('service_role', 'public.record_payment_refund_response_v2(uuid,text,text,numeric,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_payment_refund_response_v2(uuid,text,text,numeric,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.record_payment_refund_response_v2(uuid,text,text,numeric,text)', 'EXECUTE'),
  'asentar la respuesta de un reembolso sigue siendo solo del servicio');
select ok(
  has_function_privilege('service_role', 'public.release_manual_review_checkout_inventory(uuid,text,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.release_manual_review_checkout_inventory(uuid,text,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.release_manual_review_checkout_inventory(uuid,text,boolean)', 'EXECUTE'),
  'la liberacion de una sesion en revision es solo del servicio');
select ok(
  has_function_privilege('service_role', 'public.list_stock_reservation_alerts()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.list_stock_reservation_alerts()', 'EXECUTE'),
  'la alerta de reservas conserva sus privilegios');
select ok(
  not has_function_privilege('authenticated', 'private.checkout_payment_money_is_out(public.payment_intents)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.checkout_payment_money_is_out(public.payment_intents)', 'EXECUTE'),
  'el predicado privado no es alcanzable por un cliente');
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('recover_paid_checkout_order', 'can_recover_paid_checkout', 'record_payment_refund_response_v2',
                        'release_manual_review_checkout_inventory', 'list_stock_reservation_alerts')
      and p.prosecdef
      and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')),
  5, 'las cinco siguen siendo SECURITY DEFINER con search_path fijado');

-- ══ 2 · APROBADO DESPUÉS DE expires_at Y ANTES DEL BARRIDO → REARMAR ═════════
select pg_temp.armar('a', 10, 3);
select pg_temp.envejecer('a', interval '20 seconds');
select is(pg_temp.asentar('a') ->> 'manual_review_required', 'true',
  'A: el cobro aprobado 20 s despues del vencimiento va a revision manual');
select is(pg_temp.estado('a'), 'manual_review_required/approved_after_reservation_expired security_review_required',
  'A: sesion y cobro quedan en revision con su motivo');
select is(pg_temp.reservas('a') || ' stock=' || pg_temp.stock('a'), 'g1:active:3 stock=7',
  'A: la reserva sigue activa y el stock sigue descontado una vez');
select is((public.release_checkout_session_inventory(pg_temp.sid('a'), 'barrido', 'expired') ->> 'skipped'), 'true',
  'A: la liberacion comun sigue salteando una sesion en revision (no cambia)');
select pg_temp.envejecer('a', interval '10 minutes');
select is(pg_temp.alerta('a'), 'stock_held_by_checkout_in_manual_review -> recover_order_or_refund_payment_from_panel',
  'A: la alerta nombra el estado y receta el Panel, no el barrido');
select is(public.can_recover_paid_checkout(pg_temp.iid('a')), true, 'A: el Panel puede ofrecer rearmar');

create temporary table r_a on commit drop as select pg_temp.rearmar('a') as r;
select is((select r ->> 'ok' from r_a), 'true', 'A: rearmar el pedido funciona');
select is((select r ->> 'reused_reservation' from r_a), 'true', 'A: y avisa que reutilizo la reserva que ya retenia el stock');
select is(pg_temp.stock('a'), 7, 'A: stock 10 - 3 = 7: se desconto exactamente una vez');
select is(pg_temp.reservas('a'), 'g1:converted:3', 'A: una sola generacion, convertida');
select is(pg_temp.pedidos('a'), '1 pedido(s), 3 unidad(es)', 'A: UN pedido con las 3 unidades');
select is(pg_temp.estado('a'), 'completed/- completed', 'A: sesion y cobro completos');
select is(pg_temp.rearmar('a') ->> 'idempotent', 'true', 'A: rearmar otra vez es idempotente');
select is(pg_temp.pedidos('a') || ' stock=' || pg_temp.stock('a'), '1 pedido(s), 3 unidad(es) stock=7',
  'A: y no crea otro pedido ni mueve stock');

-- ══ 3 · MISMO INGRESO → REEMBOLSO TOTAL ══════════════════════════════════════
select pg_temp.armar('b', 4, 4);
select pg_temp.envejecer('b', interval '20 seconds');
select pg_temp.asentar('b');
select is(pg_temp.stock('b') || '/' || pg_temp.disponible('b'), '0/false',
  'B: el comprador retiene las ultimas 4 unidades: stock 0 y fuera de la tienda');
select is(pg_temp.reembolsar('b', null, 'approved', '880000001') ->> 'idempotent', 'false',
  'B: el reembolso total se asienta como aprobado');
select is(pg_temp.stock('b') || '/' || pg_temp.disponible('b'), '4/true',
  'B: el stock vuelve completo y el producto vuelve a estar disponible');
select is(pg_temp.reservas('b'), 'g1:released:4', 'B: la reserva queda liberada');
select is((select r.release_reason from public.inventory_reservations r where r.checkout_session_id = pg_temp.sid('b')),
  'refund_approved_without_order', 'B: con el motivo del reembolso');
select is(
  (public.record_payment_refund_response_v2(
     (select id from public.payment_refunds where payment_intent_id = pg_temp.iid('b')),
     '880000001', 'approved', 4000.00, encode(gen_random_bytes(32), 'hex')) ->> 'idempotent'),
  'true', 'B: repetir la respuesta aprobada es idempotente');
select is(pg_temp.stock('b'), 4, 'B: y no devuelve el stock por segunda vez');
select is(
  (public.release_manual_review_checkout_inventory(pg_temp.iid('b'), 'repetida', false) ->> 'released'),
  '0', 'B: la liberacion directa tampoco libera dos veces');
select is(
  (select count(*)::integer from public.payment_events e
    where e.payment_intent_id = pg_temp.iid('b') and e.event_type = 'payment.manual_review_stock_released'),
  1, 'B: queda UN evento de liberacion');
select is(pg_temp.estado('b'), 'manual_review_required/approved_after_reservation_expired security_review_required',
  'B: la sesion sigue en revision: no admite otra preferencia de pago');
select is(public.can_recover_paid_checkout(pg_temp.iid('b')), false, 'B: con el dinero devuelto el Panel no ofrece rearmar');
select pg_temp.como_dueno('b');
select throws_ok(format('select public.recover_paid_checkout_order(%L)', pg_temp.sid('b')),
  '55000', 'este cobro ya tiene dinero devuelto', 'B: y el rearmado se niega aunque lo llamen directo');
select pg_temp.sin_identidad();
select is(pg_temp.pedidos('b') || ' stock=' || pg_temp.stock('b'), '0 pedido(s), 0 unidad(es) stock=4',
  'B: sin pedido y sin mover stock');

-- ══ 4 · ÚLTIMAS UNIDADES → REARMAR ═══════════════════════════════════════════
select pg_temp.armar('u', 4, 4);
select pg_temp.envejecer('u', interval '20 seconds');
select pg_temp.asentar('u');
create temporary table r_u on commit drop as select pg_temp.rearmar('u') as r;
select is((select r ->> 'ok' from r_u), 'true',
  'U: con las ultimas unidades retenidas por la propia sesion el rearmado ya no dice stock_insuficiente');
select is(pg_temp.stock('u') || ' ' || pg_temp.pedidos('u'), '0 1 pedido(s), 4 unidad(es)',
  'U: stock 0, UN pedido de 4');

-- ══ 5 · finalization_without_active_reservation → REARMAR Y REEMBOLSAR ═══════
select pg_temp.armar('c', 10, 2);
select is(pg_temp.asentar('c') ->> 'finalize_required', 'true', 'C: aprobado a tiempo, falta finalizar');
select pg_temp.envejecer('c', interval '2 minutes');
select is(public.finalize_paid_checkout_session(pg_temp.sid('c')) ->> 'manual_review_required', 'true',
  'C: la finalizacion tardia manda a revision');
select is(pg_temp.estado('c') || ' ' || pg_temp.reservas('c') || ' stock=' || pg_temp.stock('c'),
  'manual_review_required/finalization_without_active_reservation security_review_required g1:active:2 stock=8',
  'C: revision con la reserva activa y el stock descontado una vez');
select is(pg_temp.rearmar('c') ->> 'ok', 'true', 'C: rearmar funciona');
select is(pg_temp.stock('c') || ' ' || pg_temp.reservas('c') || ' ' || pg_temp.pedidos('c'),
  '8 g1:converted:2 1 pedido(s), 2 unidad(es)',
  'C: stock 10 - 2 = 8 exactamente una vez, una generacion, UN pedido');

select pg_temp.armar('d', 10, 2);
select pg_temp.asentar('d');
select pg_temp.envejecer('d', interval '2 minutes');
select public.finalize_paid_checkout_session(pg_temp.sid('d'));
select pg_temp.reembolsar('d', null, 'approved', '880000002');
select is(pg_temp.stock('d') || ' ' || pg_temp.reservas('d') || ' ' || pg_temp.pedidos('d'),
  '10 g1:released:2 0 pedido(s), 0 unidad(es)',
  'D: el reembolso total devuelve el stock completo y no queda pedido');

-- ══ 6 · REEMBOLSO PARCIAL: SIN EFECTO EN STOCK; EL QUE COMPLETA EL TOTAL, SÍ ═
select pg_temp.armar('p', 10, 3);
select pg_temp.envejecer('p', interval '20 seconds');
select pg_temp.asentar('p');
select pg_temp.reembolsar('p', 1000, 'approved', '880000003');
select is(pg_temp.stock('p') || ' ' || pg_temp.reservas('p'), '7 g1:active:3',
  'P: un reembolso parcial no toca stock ni reservas');
select is(public.can_recover_paid_checkout(pg_temp.iid('p')), false, 'P: con dinero devuelto en parte el Panel no ofrece rearmar');
select pg_temp.como_dueno('p');
select throws_ok(format('select public.recover_paid_checkout_order(%L)', pg_temp.sid('p')),
  '55000', 'este cobro ya tiene dinero devuelto', 'P: ni se rearma un pedido por el total sobre un cobro devuelto en parte');
select pg_temp.sin_identidad();
select pg_temp.reembolsar('p', null, 'approved', '880000004');
select is((select refunded_amount from public.payment_intents where id = pg_temp.iid('p')), 3000.00,
  'P: el segundo reembolso completa el total');
select is(pg_temp.stock('p') || ' ' || pg_temp.reservas('p'), '10 g1:released:3',
  'P: y recien ahi vuelve el stock, una vez');

-- ══ 7 · REEMBOLSO EN CURSO, DUDOSO O RECHAZADO (orden de siempre: barrido primero) ═
select pg_temp.armar('q', 10, 3);
select pg_temp.envejecer('q', interval '5 minutes');
select public.expire_checkout_sessions(500);
select pg_temp.asentar('q');
select is(pg_temp.stock('q') || ' ' || pg_temp.reservas('q'), '10 g1:released:3',
  'Q: con el barrido primero la reserva ya se libero (camino anterior, sin cambios)');
select pg_temp.reembolsar('q', null, null);
select is(public.can_recover_paid_checkout(pg_temp.iid('q')), false, 'Q: con un reembolso pedido el Panel no ofrece rearmar');
select pg_temp.como_dueno('q');
select throws_ok(format('select public.recover_paid_checkout_order(%L)', pg_temp.sid('q')),
  '55000', 'este cobro tiene un reembolso en curso', 'Q: reembolso pedido: el rearmado se niega');
select pg_temp.sin_identidad();
select public.mark_payment_refund_ambiguous((select id from public.payment_refunds where payment_intent_id = pg_temp.iid('q')),
  encode(gen_random_bytes(32), 'hex'), 'network_or_timeout');
select pg_temp.como_dueno('q');
select throws_ok(format('select public.recover_paid_checkout_order(%L)', pg_temp.sid('q')),
  '55000', 'este cobro tiene un reembolso en curso', 'Q: reembolso dudoso: el rearmado se niega');
select pg_temp.sin_identidad();
select is(pg_temp.stock('q') || ' ' || pg_temp.pedidos('q'), '10 0 pedido(s), 0 unidad(es)',
  'Q: ninguno de los dos intentos movio stock ni creo pedido');
select public.record_payment_refund_response_v2((select id from public.payment_refunds where payment_intent_id = pg_temp.iid('q')),
  '', 'rejected', 3000.00, encode(gen_random_bytes(32), 'hex'));
select is(public.can_recover_paid_checkout(pg_temp.iid('q')), true, 'Q: un reembolso rechazado por el proveedor no bloquea');
create temporary table r_q on commit drop as select pg_temp.rearmar('q') as r;
select is((select r ->> 'ok' from r_q) || '/' || (select r ->> 'reused_reservation' from r_q) || '/' || (select r ->> 'reservation_generation' from r_q),
  'true/false/2', 'Q: y el rearmado vuelve a reservar en una segunda generacion, como antes');
select is(pg_temp.stock('q') || ' ' || pg_temp.reservas('q') || ' ' || pg_temp.pedidos('q'),
  '7 g1:released:3 g2:converted:3 1 pedido(s), 3 unidad(es)',
  'Q: stock descontado una vez, UN pedido');

-- ══ 8 · SÓLO SE VUELVE A RESERVAR LO QUE NO TIENE RESERVA ACTIVA, TODO O NADA ═
select pg_temp.armar('m', 5, 2, true);
select pg_temp.envejecer('m', interval '20 seconds');
select pg_temp.asentar('m');
-- El segundo producto perdió su reserva (se libera a mano, devolviendo su stock)
-- y después se vendió entero por otro lado.
update public.inventory_reservations r
   set status = 'released', released_at = clock_timestamp(), release_reason = 'fixture'
  from caso c where c.k = 'm' and r.checkout_session_id = c.session_id and r.product_id = c.product2_id;
update public.products p set stock = 0, available = false from caso c where c.k = 'm' and p.id = c.product2_id;
create temporary table r_m1 on commit drop as select pg_temp.rearmar('m') as r;
select is((select r ->> 'reason' from r_m1), 'stock_insuficiente', 'M: si falta un producto no se arma nada');
select is((select jsonb_array_length(r -> 'missing') from r_m1), 1, 'M: y solo se informa el que falta, no el que la sesion retiene');
select is((select (r -> 'missing' -> 0 ->> 'necesarias') || '/' || (r -> 'missing' -> 0 ->> 'disponibles') from r_m1), '2/0',
  'M: con lo que hace falta y lo que hay');
select is(pg_temp.stock('m') || '/' || pg_temp.stock('m', true) || ' ' || pg_temp.reservas('m'),
  '3/0 g1:active:2 g1:released:2', 'M: sin tocar stock ni reservas');
update public.products p set stock = 5, available = true from caso c where c.k = 'm' and p.id = c.product2_id;
create temporary table r_m2 on commit drop as select pg_temp.rearmar('m') as r;
select is((select r ->> 'ok' from r_m2) || '/' || (select r ->> 'reused_reservation' from r_m2), 'true/false',
  'M: con stock del segundo producto el pedido se arma');
select is(pg_temp.stock('m') || '/' || pg_temp.stock('m', true), '3/3',
  'M: el retenido no se descuenta otra vez (5 - 2 = 3) y el otro se reserva una vez (5 - 2 = 3)');
select is(pg_temp.reservas('m'), 'g1:converted:2 g1:released:2 g2:converted:2',
  'M: la reserva retenida se convierte y la nueva es la unica segunda generacion');
select is(pg_temp.pedidos('m'), '1 pedido(s), 4 unidad(es)', 'M: UN pedido con las 4 unidades');

-- ══ 9 · EL DINERO SALIÓ POR OTRO CAMINO: LIBERACIÓN DEL SERVICIO ═════════════
select pg_temp.armar('x', 10, 2);
select pg_temp.envejecer('x', interval '20 seconds');
select pg_temp.asentar('x');
select is(
  (public.release_manual_review_checkout_inventory(pg_temp.iid('x'), 'antes de tiempo', false) ->> 'reason'),
  'money_not_returned', 'X: con el dinero adentro la liberacion del servicio se niega');
select is(
  (public.release_manual_review_checkout_inventory(pg_temp.iid('x'), 'atestiguada', true) ->> 'reason'),
  'money_not_returned', 'X: y la atestacion de soporte no vale sobre un cobro aprobado: ese se reembolsa desde el Panel');
select is(pg_temp.stock('x'), 8, 'X: el stock sigue retenido');
-- La devolución se hizo en Mercado Pago y llega como aviso del proveedor.
select pg_temp.asentar('x', 'refunded', 2000.00);
select pg_temp.envejecer('x', interval '10 minutes');
select is(pg_temp.alerta('x'),
  'stock_held_by_checkout_in_manual_review -> run_release_manual_review_checkout_inventory_for_the_payment_intent',
  'X: con el dinero devuelto por el proveedor la alerta receta la liberacion del servicio');
select is(
  (public.release_manual_review_checkout_inventory(pg_temp.iid('x'), 'provider_refunded', false) ->> 'released'),
  '1', 'X: y esa liberacion funciona');
select is(pg_temp.stock('x') || ' ' || pg_temp.reservas('x'), '10 g1:released:2', 'X: stock completo, reserva liberada');
select is(pg_temp.alerta('x'), 'sin alerta', 'X: y la alerta desaparece');

-- Un cobro que nunca pudo validarse (el importe no coincide): no hay qué
-- reembolsar desde el Panel. Soporte verifica en Mercado Pago y atestigua.
select pg_temp.armar('y', 10, 2);
select is(pg_temp.asentar('y', 'approved', 0, 1.00) ->> 'reason', 'amount_mismatch', 'Y: un snapshot invalido manda a revision');
select is(
  (public.release_manual_review_checkout_inventory(pg_temp.iid('y'), 'atestiguada', true) ->> 'reason'),
  'money_not_returned', 'Y: la atestacion no vale mientras la reserva no vencio');
select pg_temp.envejecer('y', interval '10 minutes');
select is(pg_temp.alerta('y'),
  'stock_held_by_checkout_in_manual_review -> reconcile_payment_from_panel_then_recover_order_or_refund_or_release_with_support_attestation',
  'Y: la alerta receta conciliar y, si no se puede validar, la atestacion de soporte');
select is(
  (public.release_manual_review_checkout_inventory(pg_temp.iid('y'), 'sin atestar', false) ->> 'reason'),
  'money_not_returned', 'Y: sin atestacion no se libera');
select is(
  (public.release_manual_review_checkout_inventory(pg_temp.iid('y'), 'devuelto en mercado pago, verificado por soporte', true) ->> 'released'),
  '1', 'Y: con la atestacion de soporte si');
select is(pg_temp.stock('y') || ' ' || pg_temp.reservas('y'), '10 g1:released:2', 'Y: stock completo');
select is(
  (select e.details ->> 'attested_by_support' from public.payment_events e
    where e.payment_intent_id = pg_temp.iid('y') and e.event_type = 'payment.manual_review_stock_released'),
  'true', 'Y: y queda escrito que fue por atestacion');

-- Un checkout sin pagar y vencido sigue siendo cosa del barrido.
select pg_temp.armar('z', 10, 2);
select pg_temp.envejecer('z', interval '10 minutes');
select is(pg_temp.alerta('z'),
  'stock_reservation_not_released -> verify_taba_checkout_expiry_sweep_cron_then_run_sweep_expired_checkout_sessions',
  'Z: para un checkout sin pagar la alerta sigue recetando el barrido');
select is(
  (public.release_manual_review_checkout_inventory(pg_temp.iid('z'), 'no corresponde', true) ->> 'reason'),
  'not_in_manual_review', 'Z: y la liberacion de revision no toca un checkout que no esta en revision');
select public.expire_checkout_sessions(500);
select is(pg_temp.stock('z') || ' ' || pg_temp.reservas('z'), '10 g1:released:2', 'Z: el barrido lo libera como siempre');

-- Con un reembolso a medias ni rearmar ni reembolsar avanzan: la alerta receta
-- resolver esa solicitud, y vuelve a recetar el Panel cuando se resuelve.
select pg_temp.armar('w', 10, 2);
select pg_temp.envejecer('w', interval '20 seconds');
select pg_temp.asentar('w');
select pg_temp.envejecer('w', interval '10 minutes');
select pg_temp.reembolsar('w', null, 'ambiguous');
select is(pg_temp.alerta('w'),
  'stock_held_by_checkout_in_manual_review -> resolve_refund_in_flight_from_panel_then_recover_order_or_refund',
  'W: con un reembolso dudoso la alerta receta resolver esa solicitud, no rearmar ni reembolsar');
select public.record_payment_refund_response_v2((select id from public.payment_refunds where payment_intent_id = pg_temp.iid('w')),
  '', 'rejected', 2000.00, encode(gen_random_bytes(32), 'hex'));
select is(pg_temp.alerta('w'), 'stock_held_by_checkout_in_manual_review -> recover_order_or_refund_payment_from_panel',
  'W: resuelta la solicitud (rechazo del proveedor) vuelve a recetar el Panel');

-- ══ 10 · UN REEMBOLSO PROPIO NO PISA AL PROVEEDOR NI RETROCEDE EL ESTADO ═════
select pg_temp.armar('n', 10, 3);
select pg_temp.asentar('n');
select public.finalize_paid_checkout_session(pg_temp.sid('n'));
select pg_temp.asentar('n', 'approved', 500.00);
select is((select refunded_amount || ' ' || internal_status from public.payment_intents where id = pg_temp.iid('n')),
  '500.00 partially_refunded', 'N: el proveedor informa 500 devueltos desde Mercado Pago');
select pg_temp.reembolsar('n', 300, 'approved', '880000005');
select is((select refunded_amount || ' ' || internal_status from public.payment_intents where id = pg_temp.iid('n')),
  '500.00 partially_refunded', 'N: un reembolso propio de 300 no baja lo informado a 300');
select is(pg_temp.stock('n') || ' ' || pg_temp.reservas('n'), '7 g1:converted:3',
  'N: y un reembolso de un cobro CON pedido no toca stock');

select pg_temp.armar('o', 10, 3);
select pg_temp.asentar('o');
select public.finalize_paid_checkout_session(pg_temp.sid('o'));
create temporary table prep_o on commit drop as select pg_temp.reembolsar('o', 300, null) as r;
select pg_temp.asentar('o', 'refunded', 3000.00);
select public.record_payment_refund_identity((select (r ->> 'refund_id')::uuid from prep_o), pg_temp.iid('o'),
  (select r ->> 'provider_payment_id' from prep_o), (select (r ->> 'idempotency_key')::uuid from prep_o), '880000006');
select lives_ok(format(
  'select public.record_payment_refund_response_v2(%L, %L, %L, 300, %L)',
  (select r ->> 'refund_id' from prep_o), '880000006', 'approved', encode(gen_random_bytes(32), 'hex')),
  'O: si el proveedor ya informo el total devuelto, asentar la aprobacion propia no falla por regresion de estado');
select is(
  (select pi.refunded_amount || ' ' || pi.internal_status || ' ' || r.status
     from public.payment_intents pi join public.payment_refunds r on r.payment_intent_id = pi.id where pi.id = pg_temp.iid('o')),
  '3000.00 refunded approved', 'O: el cobro sigue devuelto por el total y la solicitud queda resuelta');

select * from finish();
rollback;
