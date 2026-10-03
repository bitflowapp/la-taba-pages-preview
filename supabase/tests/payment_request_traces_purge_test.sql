-- TABA · EL RASTRO DE LOS PEDIDOS DE PAGO SE PODA SOLO, Y LOS WEBHOOKS RECHAZADOS TIENEN SU PROPIO CUPO
--
-- `payment_rate_limit_buckets` y los recibos `rejected_signature` de
-- `payment_webhook_receipts` sólo crecían: nada los borraba, y el webhook —el
-- único endpoint sin autenticación previa— dejaba un recibo por cada pedido sin
-- firma válida. Acá se prueba que:
--
--   · `consume_payment_rate_limit` acepta la operación `webhook_rejected` y sigue
--     rechazando las que no conoce; las de antes funcionan igual;
--   · `purge_payment_request_traces` borra los cupos de más de un día y los
--     recibos rechazados más viejos que el plazo pedido (nunca menos de 2 días);
--   · no borra un recibo con firma válida, ni uno promovido, ni uno que un trabajo
--     de la cola o un evento de pago tengan referenciado;
--   · con una entrega en pausa saltea los recibos sin fallar y poda los cupos igual;
--   · la tarea `taba-payment-traces-purge` existe y, si hay inventario de tareas
--     esperadas, figura en él;
--   · ningún rol de cliente puede ejecutar la poda ni leer los cupos.
--
-- Todo transaccional: termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

-- ── Fixture ────────────────────────────────────────────────────────────────
-- El punto de partida no depende de lo que haya quedado en la base: si un ensayo de
-- entrega dejó la pausa puesta, acá se levanta (dentro de la transacción) para que la
-- sección 5 sea la única que prueba la pausa.
update private.a1_a4_release_control_v5 set paused = false where paused;

create function pg_temp.hash() returns text language sql as $$ select encode(gen_random_bytes(32), 'hex') $$;

create function pg_temp.usuario(p_tag text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_id,'authenticated','authenticated',p_tag || '-' || replace(v_id::text,'-','') || '@example.invalid','',now(),'{}','{}',now(),now());
  return v_id;
end;
$$;

-- Un cobro de Mercado Pago de verdad (negocio, producto, checkout): hace falta
-- para colgarle un evento de pago a un recibo. El guardián de admisión se apaga.
create function pg_temp.cobro() returns uuid language plpgsql as $$
declare
  v_business uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_owner uuid := pg_temp.usuario('poda-owner');
  v_customer uuid := pg_temp.usuario('poda-cliente');
  v_session uuid;
begin
  insert into public.businesses (
    id, name, slug, status, is_active, ordering_enabled, ordering_verified,
    ordering_verified_at, ordering_verified_by, currency_code, pickup_enabled,
    delivery_enabled, delivery_fee, minimum_delivery_subtotal, order_intake_guard_mode
  ) values (
    v_business, 'TABA poda de rastros', 'taba-poda-rastros', 'open', true, true, true,
    clock_timestamp(), v_owner, 'ARS', true, false, 0.00, 0.00, 'off'
  );
  insert into public.business_members (business_id, user_id, role, is_active) values (v_business, v_owner, 'owner', true);
  insert into public.business_payment_settings (
    business_id, enabled, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at, verified_at
  ) values (v_business, true, 'test', 'checkout_pro', 'ARS', true,
    'collector-poda', 'app-poda', clock_timestamp(), clock_timestamp());
  insert into public.products(id,business_id,name,category,subcategory,price,price_status,is_active,brand,
    variant,presentation,capacity_value,capacity_unit,capacity,packaging_type,
    stock,available,merchant_available,is_alcoholic,tags,is_verified,verified_at,verified_by,
    external_id,sku,catalog_origin,units_per_pack)
  values (v_product,v_business,'Lata poda','Gaseosas','Cola',1000,'confirmed',true,'Marca',
    'Lata','Lata',473,'ml','473 ml','lata',
    10,true,true,false,'{}',true,now(),v_owner,'poda-0001','poda-0001','commercial',1);
  v_session := (public.create_checkout_session(v_customer, jsonb_build_object(
    'business_id', v_business, 'client_request_id', 'poda-rastros-0001',
    'items', jsonb_build_array(jsonb_build_object('product_id', v_product, 'quantity', 1)),
    'fulfillment_type', 'pickup',
    'contact', jsonb_build_object('name', 'Cliente Poda', 'phone', '5492990000000'),
    'address', '{}'::jsonb, 'age_confirmed', false, 'payment_method', 'mercadopago'
  )) ->> 'checkout_session_id')::uuid;
  return (select id from public.payment_intents where checkout_session_id = v_session);
end;
$$;

create temporary table recibo (k text primary key, id uuid not null) on commit drop;

-- Un recibo con la antigüedad, el estado y la firma que se pidan.
create function pg_temp.recibir(p_k text, p_age interval, p_status text, p_signature_valid boolean) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.payment_webhook_receipts (
    environment, webhook_event_id, event_type, resource_id, signature_valid,
    payload_hash, processing_status, received_at
  ) values (
    'test', 'poda-' || p_k, 'payment', 'poda-' || p_k, p_signature_valid,
    pg_temp.hash(), p_status, clock_timestamp() - p_age
  ) returning id into v_id;
  insert into recibo values (p_k, v_id);
  return v_id;
end;
$$;
create function pg_temp.queda(p_k text) returns boolean language sql as $$
  select exists (select 1 from public.payment_webhook_receipts r join recibo x on x.id = r.id where x.k = p_k);
$$;
create function pg_temp.cupos(p_scope text) returns integer language sql as $$
  select count(*)::integer from public.payment_rate_limit_buckets where scope = p_scope;
$$;

-- El inventario de tareas esperadas es de otra entrega: puede no existir.
create function pg_temp.tarea_en_inventario() returns boolean language plpgsql as $$
declare v_found boolean;
begin
  if to_regclass('private.scheduler_expected_jobs') is null then return null; end if;
  execute $q$select exists (select 1 from private.scheduler_expected_jobs where job_name = 'taba-payment-traces-purge')$q$
    into v_found;
  return v_found;
end;
$$;

-- La tabla de cupos arranca vacía para que los conteos sean los de esta prueba.
delete from public.payment_rate_limit_buckets;

-- ══ 1 · CONTRATO Y PRIVILEGIOS ══════════════════════════════════════════════
select has_function('public', 'purge_payment_request_traces', array['integer'], 'la poda existe');
select ok(
  (select p.prosecdef and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
     from pg_proc p where p.oid = 'public.purge_payment_request_traces(integer)'::regprocedure),
  'la poda es SECURITY DEFINER con search_path fijo');
select ok(
  has_function_privilege('service_role', 'public.purge_payment_request_traces(integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.purge_payment_request_traces(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.purge_payment_request_traces(integer)', 'EXECUTE'),
  'la poda sólo la ejecuta service_role');
select ok(
  has_function_privilege('service_role', 'public.consume_payment_rate_limit(text,text,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.consume_payment_rate_limit(text,text,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.consume_payment_rate_limit(text,text,integer,integer)', 'EXECUTE'),
  'el cupo lo sigue consumiendo sólo service_role');
select ok(
  (select p.prosecdef and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
     from pg_proc p where p.oid = 'public.consume_payment_rate_limit(text,text,integer,integer)'::regprocedure),
  'el cupo sigue siendo SECURITY DEFINER con search_path fijo');
select ok(
  not has_table_privilege('anon', 'public.payment_rate_limit_buckets', 'select')
  and not has_table_privilege('authenticated', 'public.payment_rate_limit_buckets', 'select')
  and not has_table_privilege('authenticated', 'public.payment_rate_limit_buckets', 'delete')
  and (select c.relrowsecurity from pg_class c where c.oid = 'public.payment_rate_limit_buckets'::regclass),
  'ningún rol de cliente lee ni borra los cupos');

-- ══ 2 · LA OPERACIÓN `webhook_rejected` ═════════════════════════════════════
create temporary table clave on commit drop as select pg_temp.hash() as rechazos, pg_temp.hash() as firmados;

select is(
  (select public.consume_payment_rate_limit('webhook_rejected', rechazos, 5, 3600) from clave) - 'bucket_started_at',
  '{"allowed": true, "count": 1, "limit": 5}'::jsonb,
  'el primer rechazo de una dirección entra en su cupo');
select is(
  (select array_agg((public.consume_payment_rate_limit('webhook_rejected', rechazos, 5, 3600) ->> 'allowed')::boolean order by n)
     from clave, generate_series(2, 7) as n),
  array[true, true, true, true, false, false],
  'del sexto en adelante ya no hay lugar: el recibo no se guarda');
select is(pg_temp.cupos('webhook_rejected'), 1, 'todos esos rechazos son UNA fila de cupo, no una por pedido');
select is(
  (select public.consume_payment_rate_limit('webhook', firmados, 240, 60) ->> 'allowed' from clave),
  'true', 'las notificaciones firmadas tienen su cupo aparte, intacto');
select is(
  (select array_agg((public.consume_payment_rate_limit(s, pg_temp.hash(), 10, 60) ->> 'allowed')::boolean)
     from unnest(array['checkout_session', 'preference', 'checkout_status', 'refund', 'cancellation', 'worker']) as s),
  array[true, true, true, true, true, true],
  'las operaciones que ya existían siguen funcionando');
select throws_ok(
  $$select public.consume_payment_rate_limit('otra_operacion', repeat('a', 64), 5, 60)$$,
  '22023', 'rate limit invalido', 'una operación desconocida se sigue rechazando');
select throws_ok(
  $$select public.consume_payment_rate_limit('webhook_rejected', 'no-es-un-hash', 5, 60)$$,
  '22023', 'rate limit invalido', 'la clave tiene que seguir siendo un hash');
select throws_ok(
  $$insert into public.payment_rate_limit_buckets (scope, subject_hash, bucket_started_at, request_count)
    values ('otra_operacion', repeat('a', 64), clock_timestamp(), 1)$$,
  '23514', null, 'la tabla tampoco admite una operación desconocida');

-- ══ 3 · LA PODA DE CUPOS ════════════════════════════════════════════════════
delete from public.payment_rate_limit_buckets;
insert into public.payment_rate_limit_buckets (scope, subject_hash, bucket_started_at, request_count) values
  ('webhook', repeat('1', 64), clock_timestamp() - interval '40 days', 3),
  ('webhook_rejected', repeat('2', 64), clock_timestamp() - interval '2 days', 5),
  ('checkout_session', repeat('3', 64), clock_timestamp() - interval '25 hours', 12),
  ('checkout_session', repeat('4', 64), clock_timestamp() - interval '23 hours', 1),
  ('worker', repeat('5', 64), clock_timestamp() - interval '30 minutes', 7),
  ('checkout_status', repeat('6', 64), clock_timestamp(), 1);

-- ══ 4 · LA PODA DE RECIBOS ══════════════════════════════════════════════════
create temporary table cobro on commit drop as select pg_temp.cobro() as intent_id;

select pg_temp.recibir('rechazado-40d', interval '40 days', 'rejected_signature', false);
select pg_temp.recibir('rechazado-10d', interval '10 days', 'rejected_signature', false);
select pg_temp.recibir('rechazado-36h', interval '36 hours', 'rejected_signature', false);
select pg_temp.recibir('rechazado-1h', interval '1 hour', 'rejected_signature', false);
select pg_temp.recibir('valido-40d', interval '40 days', 'completed', true);
-- Rechazado primero y promovido después por una entrega con firma válida.
select pg_temp.recibir('promovido-40d', interval '40 days', 'received', true);
select pg_temp.recibir('fallido-40d', interval '40 days', 'dead_letter', true);
-- Estados que no deberían existir; la poda exige las DOS condiciones.
select pg_temp.recibir('rechazado-con-firma-40d', interval '40 days', 'rejected_signature', true);
select pg_temp.recibir('en-cola-sin-firma-40d', interval '40 days', 'queued', false);
-- Rechazados que algo referencia.
select pg_temp.recibir('rechazado-con-trabajo-40d', interval '40 days', 'rejected_signature', false);
select pg_temp.recibir('rechazado-con-evento-40d', interval '40 days', 'rejected_signature', false);
insert into public.payment_outbox (webhook_receipt_id, topic, resource_id)
  select id, 'payment', 'poda-trabajo' from recibo where k = 'rechazado-con-trabajo-40d';
insert into public.payment_events (payment_intent_id, webhook_receipt_id, event_type, details)
  select c.intent_id, x.id, 'payment.pending', '{}'::jsonb from cobro c, recibo x where x.k = 'rechazado-con-evento-40d';

create temporary table primera on commit drop as select public.purge_payment_request_traces() as r;

select is((select r from primera),
  '{"rate_limit_buckets": 3, "rejected_receipts": 1, "rejected_receipts_skipped": false, "kept_days": 30}'::jsonb,
  'la poda informa qué borró: tres cupos de más de un día y un recibo rechazado de más de treinta');
select bag_eq(
  $$select scope, subject_hash from public.payment_rate_limit_buckets$$,
  $$values ('checkout_session', repeat('4', 64)), ('worker', repeat('5', 64)), ('checkout_status', repeat('6', 64))$$,
  'quedan los cupos del último día; se fueron los de 25 horas, 2 días y 40 días');

select ok(not pg_temp.queda('rechazado-40d'), 'un rechazo de 40 días se borra');
select ok(pg_temp.queda('rechazado-10d'), 'un rechazo de 10 días todavía se conserva');
select ok(pg_temp.queda('rechazado-36h') and pg_temp.queda('rechazado-1h'), 'los rechazos recientes quedan');
select ok(pg_temp.queda('valido-40d'), 'un recibo con firma válida no se borra por viejo que sea');
select ok(pg_temp.queda('promovido-40d'), 'un rechazo que después llegó firmado ya es un recibo válido');
select ok(pg_temp.queda('fallido-40d'), 'un recibo válido cuyo trabajo fracasó tampoco se borra');
select ok(pg_temp.queda('rechazado-con-firma-40d'), 'con firma válida no se borra aunque el estado diga rechazado');
select ok(pg_temp.queda('en-cola-sin-firma-40d'), 'sin estado de rechazo no se borra aunque la firma no valga');
select ok(pg_temp.queda('rechazado-con-trabajo-40d'), 'un recibo que un trabajo de la cola referencia no se borra');
select is(
  (select count(*)::integer from public.payment_outbox o join recibo x on x.id = o.webhook_receipt_id
    where x.k = 'rechazado-con-trabajo-40d'),
  1, 'y su trabajo sigue en la cola');
select ok(pg_temp.queda('rechazado-con-evento-40d'), 'un recibo que un evento de pago referencia no se borra');
select is(
  (select count(*)::integer from public.payment_events e join recibo x on x.id = e.webhook_receipt_id
    where x.k = 'rechazado-con-evento-40d'),
  1, 'y el evento conserva su recibo');

select is(public.purge_payment_request_traces(),
  '{"rate_limit_buckets": 0, "rejected_receipts": 0, "rejected_receipts_skipped": false, "kept_days": 30}'::jsonb,
  'una segunda poda no encuentra nada más');

-- ── El plazo ────────────────────────────────────────────────────────────────
select is(public.purge_payment_request_traces(7) ->> 'rejected_receipts', '1', 'con siete días de plazo se va el rechazo de 10 días');
select ok(not pg_temp.queda('rechazado-10d') and pg_temp.queda('rechazado-36h'), 'y sólo ése');
select is(public.purge_payment_request_traces(0),
  '{"rate_limit_buckets": 0, "rejected_receipts": 0, "rejected_receipts_skipped": false, "kept_days": 2}'::jsonb,
  'el plazo nunca baja de dos días: lo que la alerta de 24 horas todavía cuenta no se toca');
select ok(pg_temp.queda('rechazado-36h') and pg_temp.queda('rechazado-1h'), 'los rechazos de las últimas 48 horas siguen ahí');
select is(
  array[public.purge_payment_request_traces(null) ->> 'kept_days', public.purge_payment_request_traces(100000) ->> 'kept_days',
        public.purge_payment_request_traces(-5) ->> 'kept_days'],
  array['30', '365', '2'], 'sin plazo son treinta días; el máximo es un año; uno negativo es el mínimo');
select ok(
  (select a.rejected_count >= 1 from public.list_webhook_signature_alerts() a where a.environment = 'test'),
  'la alerta de firmas rechazadas sigue viendo el rechazo de la última hora');

-- ══ 5 · CON UNA ENTREGA EN PAUSA ════════════════════════════════════════════
select pg_temp.recibir('rechazado-en-pausa-40d', interval '40 days', 'rejected_signature', false);
insert into public.payment_rate_limit_buckets (scope, subject_hash, bucket_started_at, request_count)
  values ('webhook', repeat('7', 64), clock_timestamp() - interval '3 days', 1);
update private.a1_a4_release_control_v5
   set paused = true, release_id = gen_random_uuid(), paused_at = clock_timestamp()
 where singleton;

select is(public.purge_payment_request_traces(),
  '{"rate_limit_buckets": 1, "rejected_receipts": 0, "rejected_receipts_skipped": true, "kept_days": 30}'::jsonb,
  'con la entrega en pausa la poda no falla: saltea los recibos y poda los cupos');
select ok(pg_temp.queda('rechazado-en-pausa-40d'), 'el recibo queda para la poda siguiente');

update private.a1_a4_release_control_v5 set paused = false where singleton;
select is(public.purge_payment_request_traces() ->> 'rejected_receipts', '1', 'terminada la pausa, la poda siguiente se lo lleva');

-- ══ 6 · LA TAREA ════════════════════════════════════════════════════════════
select is(
  (select array[j.schedule, j.command, j.active::text] from cron.job j where j.jobname = 'taba-payment-traces-purge'),
  array['23 4 * * *', 'select public.purge_payment_request_traces(30);', 'true'],
  'la tarea diaria existe, activa, con treinta días de plazo');
select is(
  (select count(*)::integer from cron.job j where j.jobname = 'taba-payment-traces-purge'),
  1, 'y es una sola');
select ok(
  coalesce(pg_temp.tarea_en_inventario(), true),
  'si existe el inventario de tareas esperadas, la tarea figura en él');

select * from finish();
rollback;
