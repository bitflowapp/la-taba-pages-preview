-- Certificacion local del runtime de auto-dispatch de Riders.
--
-- Cubre el contrato completo: pedido listo -> job exactly-once -> ranking
-- deterministico -> oferta con lease -> accept atomico -> un unico Rider, mas
-- rechazo, expiracion, pausa, fin de turno durante entrega, ledger
-- exactly-once, idempotencia, override manual con CAS y privacidad pre-claim.
--
-- Cada verificacion aborta la corrida. No hay asserts blandos.

\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function pg_temp.nuevo_usuario(p_prefix text)
returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_id, 'authenticated', 'authenticated',
    p_prefix || '-' || replace(v_id::text, '-', '') || '@example.invalid',
    '', '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());
  return v_id;
end;
$$;

create or replace function pg_temp.actuar_como(p_user uuid)
returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
$$;

create or replace function pg_temp.nuevo_pedido(
  p_business uuid, p_code text, p_zona text, p_lat numeric, p_lng numeric
)
returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  -- public_code y code son unicos globalmente: el fixture no puede repetirlos
  -- entre corridas sobre la misma base.
  v_code text := p_code || '-' || left(replace(v_id::text, '-', ''), 8);
begin
  insert into public.orders(
    id, business_id, code, public_code, client_request_id, payment_method,
    delivery_mode, fulfillment_type, status, subtotal, total,
    origin, origin_reason, origin_classified_at, customer_neighborhood,
    delivery_latitude, delivery_longitude, delivery_location_source,
    delivery_location_confirmed_at
  ) values (
    v_id, p_business, v_code, v_code, left(replace(v_id::text,'-',''), 24),
    'cash', 'delivery', 'delivery', 'preparing', 1500, 1500,
    'qa', 'certificacion local de auto dispatch', clock_timestamp(), p_zona,
    p_lat, p_lng, 'map_pin', clock_timestamp()
  );
  -- El pedido ya dispara su propio snapshot de ubicacion; aca solo se fija el
  -- punto de fixture para que la distancia sea reproducible.
  insert into private.rider_map_order_location_snapshots(
    order_id, business_latitude, business_longitude, business_source,
    customer_latitude, customer_longitude, customer_source
  ) values (v_id, -38.951, -68.059, 'qa_fixture', p_lat, p_lng, 'qa_fixture')
  on conflict (order_id) do update set
    business_latitude = excluded.business_latitude,
    business_longitude = excluded.business_longitude,
    business_source = excluded.business_source,
    customer_latitude = excluded.customer_latitude,
    customer_longitude = excluded.customer_longitude,
    customer_source = excluded.customer_source;
  insert into private.rider_dispatch_qa_allowlist(order_id, reason, expires_at)
  values (v_id, 'certificacion local de dispatch', clock_timestamp() + interval '1 day');
  return v_id;
end;
$$;

-- Abre turno y late. Devuelve el shift_id.
create or replace function pg_temp.turno_listo(
  p_rider uuid, p_lat numeric, p_lng numeric, p_sufijo text
)
returns uuid
language plpgsql as $$
declare v_shift uuid; v_version bigint; v_res jsonb;
begin
  perform pg_temp.actuar_como(p_rider);
  v_res := public.rider_work_now('worknow-' || p_sufijo);
  -- Un turno ya abierto es un estado valido del fixture: solo hay que latir.
  if v_res ->> 'code' not in ('shift_started', 'shift_already_open') then
    raise exception 'work_now fallo: %', v_res;
  end if;
  select id, version into v_shift, v_version from public.rider_shifts
   where rider_user_id = p_rider and status in ('active','paused');
  v_res := public.rider_shift_heartbeat(v_shift, v_version, clock_timestamp(),
    p_lat::double precision, p_lng::double precision, 12.0, false);
  if v_res ->> 'code' <> 'heartbeat_accepted' then
    raise exception 'heartbeat fallo: %', v_res;
  end if;
  return v_shift;
end;
$$;

do $$
declare
  v_business uuid := gen_random_uuid();
  v_owner uuid; v_rider_a uuid; v_rider_b uuid;
  v_shift_a uuid; v_shift_b uuid;
  v_order uuid; v_order2 uuid; v_order3 uuid;
  v_job uuid; v_job_rev bigint;
  v_offer uuid; v_offer_version bigint; v_offer_rider uuid;
  v_res jsonb; v_payload jsonb; v_control jsonb;
  v_n integer; v_state text; v_status text; v_assigned uuid;
  v_score_a integer; v_score_b integer;
begin
  raise notice '';
  raise notice '########## AUTO-DISPATCH: CONTRATO COMPLETO ##########';

  v_owner   := pg_temp.nuevo_usuario('disp-owner');
  v_rider_a := pg_temp.nuevo_usuario('disp-rider-a');
  v_rider_b := pg_temp.nuevo_usuario('disp-rider-b');

  insert into public.businesses(id,name,status,slug,is_active,address,currency_code)
  values (v_business,'TABA dispatch cert','open',
    'taba-dispatch-' || left(replace(v_business::text,'-',''),12), true,
    'Av Argentina 100','ARS');
  insert into public.business_members(business_id,user_id,role,is_active) values
    (v_business, v_owner,   'owner', true),
    (v_business, v_rider_a, 'rider', true),
    (v_business, v_rider_b, 'rider', true);
  insert into private.rider_map_business_locations(business_id,latitude,longitude,source)
  values (v_business, -38.951, -68.059, 'qa_fixture');
  perform public.ensure_rider_dispatch_policy(v_business);

  -- ─────────────────────────────────────────────────────────────────────────
  -- 1. La migracion no enciende nada
  -- ─────────────────────────────────────────────────────────────────────────
  if exists (select 1 from public.business_dispatch_settings s
             where s.business_id = v_business
               and (s.auto_dispatch_enabled or not s.qa_fixture_only)) then
    raise exception '1 · auto-dispatch no puede nacer encendido';
  end if;

  v_order := pg_temp.nuevo_pedido(v_business,'TABA-C001','centro',-38.955,-68.070);
  update public.orders set status='ready', ready_at=clock_timestamp() where id=v_order;
  if exists (select 1 from public.dispatch_jobs where order_id=v_order) then
    raise exception '1 · con el switch apagado un pedido listo no puede crear job';
  end if;
  raise notice '1 · OK  switch apagado: pedido listo no crea job';

  -- ─────────────────────────────────────────────────────────────────────────
  -- 2. Encendido QA y job exactly-once
  -- ─────────────────────────────────────────────────────────────────────────
  perform pg_temp.actuar_como(v_owner);
  v_res := public.configure_business_auto_dispatch(v_business, true, true,
    'certificacion local de auto dispatch', 'cert-enable-000001');
  if v_res ->> 'code' <> 'auto_dispatch_enabled' then
    raise exception '2 · no se pudo encender: %', v_res;
  end if;
  -- Encender re-encola lo que ya estaba listo.
  select count(*)::integer into v_n from public.dispatch_jobs where order_id=v_order;
  if v_n <> 1 then raise exception '2 · esperaba 1 job al encender, hay %', v_n; end if;

  -- Ready duplicado, retry explicito y reencendido convergen en la misma fila.
  update public.orders set status='ready' where id=v_order;
  perform public.enqueue_rider_dispatch_job(v_order);
  perform public.enqueue_rider_dispatch_job(v_order);
  select count(*)::integer into v_n from public.dispatch_jobs where order_id=v_order;
  if v_n <> 1 then raise exception '2 · ready duplicado creo % jobs', v_n; end if;
  select id, revision into v_job, v_job_rev from public.dispatch_jobs where order_id=v_order;
  raise notice '2 · OK  job exactly-once ante ready duplicado y retries';

  -- ─────────────────────────────────────────────────────────────────────────
  -- 3. Sin Riders elegibles: motivo explicito, sin oferta
  -- ─────────────────────────────────────────────────────────────────────────
  perform pg_temp.actuar_como(null);
  perform public.run_rider_dispatch_cycle(10,'test');
  select state into v_state from public.dispatch_jobs where id=v_job;
  if v_state <> 'no_rider_available' then
    raise exception '3 · sin Riders el job deberia quedar no_rider_available, quedo %', v_state;
  end if;
  if exists (select 1 from public.dispatch_offers where job_id=v_job) then
    raise exception '3 · no puede haber oferta sin Rider elegible';
  end if;
  raise notice '3 · OK  sin Rider elegible: no_rider_available y cero ofertas';

  -- ─────────────────────────────────────────────────────────────────────────
  -- 4. Ranking deterministico y explicable
  -- ─────────────────────────────────────────────────────────────────────────
  -- A queda cerca del pickup, B lejos. Gana A por score, no por azar.
  v_shift_a := pg_temp.turno_listo(v_rider_a, -38.9515, -68.0595, 'a01');
  v_shift_b := pg_temp.turno_listo(v_rider_b, -38.990, -68.140,  'b01');

  perform pg_temp.actuar_como(null);
  perform public.run_rider_dispatch_cycle(10,'test');

  select count(*)::integer into v_n from public.dispatch_offers where job_id=v_job and status='offered';
  if v_n <> 1 then raise exception '4 · esperaba exactamente 1 oferta viva, hay %', v_n; end if;
  select rider_user_id into v_offer_rider from public.dispatch_offers where job_id=v_job and status='offered';
  if v_offer_rider <> v_rider_a then
    raise exception '4 · el ranking no eligio al Rider mas cercano';
  end if;

  select e.score into v_score_a from public.dispatch_evaluations e
   where e.job_id=v_job and e.rider_user_id=v_rider_a and e.eligible;
  select e.score into v_score_b from public.dispatch_evaluations e
   where e.job_id=v_job and e.rider_user_id=v_rider_b and e.eligible;
  if v_score_a is null or v_score_b is null or v_score_a <= v_score_b then
    raise exception '4 · scores no explican la decision: A=% B=%', v_score_a, v_score_b;
  end if;
  if not exists (select 1 from public.dispatch_evaluations e
                 where e.job_id=v_job and e.rider_user_id=v_rider_b
                   and e.distance_to_pickup_m is not null and e.factors ? 'distance_penalty') then
    raise exception '4 · la evaluacion no guarda componentes reproducibles';
  end if;
  raise notice '4 · OK  ranking deterministico y auditable (A=% B=%)', v_score_a, v_score_b;

  -- ─────────────────────────────────────────────────────────────────────────
  -- 5. Privacidad pre-claim
  -- ─────────────────────────────────────────────────────────────────────────
  select id, version, safe_payload into v_offer, v_offer_version, v_payload
    from public.dispatch_offers where job_id=v_job and status='offered';
  if v_payload ? 'customer_name' or v_payload ? 'customer_phone'
     or v_payload ? 'exact_address' or v_payload ? 'notes'
     or v_payload #> '{destination,latitude}' is not null
     or v_payload #> '{destination,address}' is not null then
    raise exception '5 · la oferta pre-claim filtra datos del cliente: %', v_payload;
  end if;
  if v_payload::text ~* '(-?[0-9]{2}\.[0-9]{3,})' and v_payload ->> 'trip_distance_m' is null then
    raise exception '5 · la oferta pre-claim expone coordenadas';
  end if;
  if v_payload -> 'pickup' ->> 'distance_m' is null then
    raise exception '5 · la oferta debe informar distancia al pickup';
  end if;
  raise notice '5 · OK  oferta pre-claim sin PII ni coordenadas de puerta';

  -- ─────────────────────────────────────────────────────────────────────────
  -- 6. Rechazo: pasa al siguiente y no re-ofrece al que rechazo
  -- ─────────────────────────────────────────────────────────────────────────
  perform pg_temp.actuar_como(v_rider_a);
  v_res := public.reject_rider_dispatch_offer(v_offer, v_offer_version, 'muy lejos', 'cert-reject-00001');
  if v_res ->> 'code' <> 'offer_rejected' then
    raise exception '6 · rechazo fallo: %', v_res;
  end if;
  perform pg_temp.actuar_como(null);
  perform public.run_rider_dispatch_cycle(10,'test');
  select rider_user_id into v_offer_rider from public.dispatch_offers
   where job_id=v_job and status='offered';
  if v_offer_rider is distinct from v_rider_b then
    raise exception '6 · tras el rechazo la oferta deberia ir al siguiente candidato';
  end if;
  if not exists (select 1 from public.dispatch_evaluations e
                 where e.job_id=v_job and e.rider_user_id=v_rider_a
                   and 'ALREADY_OFFERED' = any(e.exclusion_codes)) then
    raise exception '6 · el Rider que rechazo deberia quedar ALREADY_OFFERED';
  end if;
  raise notice '6 · OK  rechazo pasa al siguiente sin bucle';

  -- ─────────────────────────────────────────────────────────────────────────
  -- 7. Expiracion del lease: el sweep libera el job
  -- ─────────────────────────────────────────────────────────────────────────
  -- Se envejece la ventana completa: lease_expires_at > offered_at es un
  -- invariante de la tabla y el fixture no puede violarlo para simular el TTL.
  update public.dispatch_offers
     set offered_at = clock_timestamp() - interval '2 minutes',
         lease_expires_at = clock_timestamp() - interval '1 second'
   where job_id=v_job and status='offered';
  perform public.run_rider_dispatch_cycle(10,'test');
  if exists (select 1 from public.dispatch_offers o
             where o.job_id=v_job and o.status='offered'
               and o.lease_expires_at < clock_timestamp()) then
    raise exception '7 · una oferta vencida no puede seguir viva';
  end if;
  if not exists (select 1 from public.dispatch_offers where job_id=v_job and status='expired') then
    raise exception '7 · el sweep no marco la oferta como expirada';
  end if;
  select state into v_state from public.dispatch_jobs where id=v_job;
  if v_state = 'offering' then
    raise exception '7 · el job quedo bloqueado por una oferta expirada';
  end if;
  raise notice '7 · OK  lease expirado: sweep libera el job (estado %)', v_state;

  -- ─────────────────────────────────────────────────────────────────────────
  -- 8. Accept atomico sobre un pedido nuevo
  -- ─────────────────────────────────────────────────────────────────────────
  v_order2 := pg_temp.nuevo_pedido(v_business,'TABA-C002','centro',-38.956,-68.071);
  update public.orders set status='ready', ready_at=clock_timestamp() where id=v_order2;
  perform pg_temp.actuar_como(null);
  perform public.run_rider_dispatch_cycle(10,'test');
  select o.id, o.version, o.rider_user_id into v_offer, v_offer_version, v_offer_rider
    from public.dispatch_offers o
    join public.dispatch_jobs j on j.id=o.job_id
   where j.order_id=v_order2 and o.status='offered';
  if v_offer is null then raise exception '8 · el pedido nuevo no recibio oferta'; end if;

  perform pg_temp.actuar_como(v_offer_rider);
  v_res := public.accept_rider_dispatch_offer(v_offer, v_offer_version, 'cert-accept-00001');
  if v_res ->> 'code' <> 'offer_accepted' then
    raise exception '8 · accept fallo: %', v_res;
  end if;
  select status, assigned_rider_user_id into v_status, v_assigned
    from public.orders where id=v_order2;
  if v_status <> 'assigned' or v_assigned <> v_offer_rider then
    raise exception '8 · el pedido no quedo asignado al Rider que acepto (% / %)', v_status, v_assigned;
  end if;
  select count(*)::integer into v_n from public.orders
   where id=v_order2 and assigned_rider_user_id is not null;
  if v_n <> 1 then raise exception '8 · doble asignacion'; end if;
  select count(*)::integer into v_n from public.rider_reward_ledger
   where order_id=v_order2 and entry_type='estimated';
  if v_n <> 1 then raise exception '8 · esperaba 1 asiento estimated, hay %', v_n; end if;
  raise notice '8 · OK  accept atomico: un pedido, un Rider, un asiento estimated';

  -- Idempotencia: misma clave y mismo payload devuelve el receipt.
  v_res := public.accept_rider_dispatch_offer(v_offer, v_offer_version, 'cert-accept-00001');
  if coalesce((v_res ->> 'idempotent_no_op')::boolean, false) is not true then
    raise exception '8 · reintento con la misma clave deberia ser idempotente: %', v_res;
  end if;
  -- Misma clave con otro payload debe fallar.
  begin
    perform public.accept_rider_dispatch_offer(v_offer, v_offer_version + 99, 'cert-accept-00001');
    raise exception '8 · reusar la clave con otro payload deberia fallar';
  exception when sqlstate '23505' then null;
  end;
  raise notice '8 · OK  idempotencia por (actor, operacion, clave) con fingerprint';

  -- ─────────────────────────────────────────────────────────────────────────
  -- 9. Fin de turno durante la entrega
  -- ─────────────────────────────────────────────────────────────────────────
  perform pg_temp.actuar_como(v_offer_rider);
  select id into v_shift_a from public.rider_shifts
   where rider_user_id=v_offer_rider and status in ('active','paused');
  v_res := public.rider_end_shift(v_shift_a,
    (select version from public.rider_shifts where id=v_shift_a), 'cert-endshift-0001');
  if v_res ->> 'code' <> 'shift_ended' then
    raise exception '9 · no se pudo finalizar el turno: %', v_res;
  end if;
  select status, assigned_rider_user_id into v_status, v_assigned from public.orders where id=v_order2;
  if v_status <> 'assigned' or v_assigned <> v_offer_rider then
    raise exception '9 · finalizar el turno corto una entrega aceptada';
  end if;
  select state into v_state from public.dispatch_jobs where order_id=v_order2;
  if v_state <> 'claimed' then
    raise exception '9 · el job de una entrega aceptada cambio al terminar el turno: %', v_state;
  end if;
  raise notice '9 · OK  turno finalizado no toca la entrega ya aceptada';

  -- ─────────────────────────────────────────────────────────────────────────
  -- 10. Entrega -> asiento earned exactly-once
  -- ─────────────────────────────────────────────────────────────────────────
  perform pg_temp.actuar_como(v_owner);
  -- El codigo de entrega es un contrato certificado aparte. Aca se satisface de
  -- verdad, con un handoff confirmado, en vez de bajar la guarda.
  insert into public.order_delivery_handoffs(
    order_id, code_hash, code_ciphertext, confirmed_at, confirmed_by_user_id, expires_at
  ) values (
    v_order2, encode(extensions.digest('cert-code','sha256'),'hex'), 'cert-ciphertext',
    clock_timestamp(), v_offer_rider, clock_timestamp() + interval '1 hour'
  )
  on conflict (order_id) do update set confirmed_at = excluded.confirmed_at;
  update public.orders set status='picked_up'  where id=v_order2;
  update public.orders set status='on_the_way' where id=v_order2;
  update public.orders set status='arrived'    where id=v_order2;
  update public.orders set status='delivered', delivered_at=clock_timestamp() where id=v_order2;
  select count(*)::integer into v_n from public.rider_reward_ledger
   where order_id=v_order2 and entry_type='earned';
  if v_n <> 1 then raise exception '10 · esperaba 1 asiento earned, hay %', v_n; end if;
  select state into v_state from public.dispatch_jobs where order_id=v_order2;
  if v_state <> 'completed' then
    raise exception '10 · el job no cerro con la entrega: %', v_state;
  end if;
  -- El ledger es append-only: no se recalcula una entrega cerrada.
  begin
    update public.rider_reward_ledger set amount = amount + 1 where order_id=v_order2;
    raise exception '10 · el ledger acepto una modificacion';
  exception when sqlstate '55000' then null;
  end;
  raise notice '10 · OK  earned exactly-once e inmutable';

  -- ─────────────────────────────────────────────────────────────────────────
  -- 11. Pausa revoca la oferta pendiente
  -- ─────────────────────────────────────────────────────────────────────────
  v_order3 := pg_temp.nuevo_pedido(v_business,'TABA-C003','centro',-38.957,-68.072);
  update public.orders set status='ready', ready_at=clock_timestamp() where id=v_order3;
  v_shift_b := pg_temp.turno_listo(v_rider_b, -38.9516, -68.0596, 'b02');
  perform pg_temp.actuar_como(null);
  perform public.run_rider_dispatch_cycle(10,'test');
  select o.id, o.rider_user_id into v_offer, v_offer_rider
    from public.dispatch_offers o join public.dispatch_jobs j on j.id=o.job_id
   where j.order_id=v_order3 and o.status='offered';
  if v_offer is null then raise exception '11 · el pedido no recibio oferta'; end if;

  perform pg_temp.actuar_como(v_offer_rider);
  select id into v_shift_b from public.rider_shifts
   where rider_user_id=v_offer_rider and status='active';
  v_res := public.rider_pause_shift(v_shift_b,
    (select version from public.rider_shifts where id=v_shift_b), 'cert-pause-000001');
  if v_res ->> 'code' <> 'shift_paused' then
    raise exception '11 · no se pudo pausar: %', v_res;
  end if;
  select status into v_status from public.dispatch_offers where id=v_offer;
  if v_status <> 'revoked' then
    raise exception '11 · pausar el turno deberia revocar la oferta pendiente, quedo %', v_status;
  end if;
  raise notice '11 · OK  pausa revoca la oferta pendiente';

  -- Una oferta revocada ya no se puede aceptar.
  v_res := public.accept_rider_dispatch_offer(v_offer,
    (select version from public.dispatch_offers where id=v_offer), 'cert-accept-revk01');
  if v_res ->> 'code' <> 'offer_not_available' then
    raise exception '11 · una oferta revocada no puede aceptarse: %', v_res;
  end if;
  raise notice '11 · OK  oferta revocada rechaza el accept con receipt estructurado';

  -- ─────────────────────────────────────────────────────────────────────────
  -- 12. Override manual con CAS y motivo
  -- ─────────────────────────────────────────────────────────────────────────
  perform pg_temp.actuar_como(v_owner);
  select revision into v_job_rev from public.dispatch_jobs where order_id=v_order3;
  -- Motivo corto: rechazado antes de tocar nada.
  begin
    perform public.manual_override_dispatch(v_business, v_order3, v_rider_b,
      'corto', 'cert-override-0001', v_job_rev);
    raise exception '12 · un motivo corto deberia ser rechazado';
  exception when sqlstate '22023' then null;
  end;
  -- CAS invalido.
  v_res := public.manual_override_dispatch(v_business, v_order3, v_rider_b,
    'cobertura confirmada por operacion', 'cert-override-0002', v_job_rev + 50);
  if v_res ->> 'code' <> 'stale_revision' then
    raise exception '12 · el override deberia exigir CAS: %', v_res;
  end if;
  -- Override valido.
  v_res := public.manual_override_dispatch(v_business, v_order3, v_rider_b,
    'cobertura confirmada por operacion', 'cert-override-0003', v_job_rev);
  if v_res ->> 'code' <> 'claimed' then
    raise exception '12 · override valido fallo: %', v_res;
  end if;
  select count(*)::integer into v_n from public.dispatch_jobs where order_id=v_order3;
  if v_n <> 1 then raise exception '12 · el override creo un segundo job'; end if;
  select assigned_rider_user_id into v_assigned from public.orders where id=v_order3;
  if v_assigned <> v_rider_b then raise exception '12 · el override no asigno al Rider indicado'; end if;
  if not exists (select 1 from public.dispatch_events e
                 where e.order_id=v_order3 and e.event_type='dispatch.manual_override'
                   and e.actor_user_id=v_owner and e.detail ? 'reason') then
    raise exception '12 · el override no registro actor y motivo';
  end if;
  raise notice '12 · OK  override manual con CAS, motivo, auditoria y sin segundo job';

  -- ─────────────────────────────────────────────────────────────────────────
  -- 13. Panel: control sin PII ni GPS
  -- ─────────────────────────────────────────────────────────────────────────
  v_control := public.get_business_dispatch_control(v_business);
  if v_control::text ~* '(latitude|longitude|customer_phone|customer_name|exact_address)' then
    raise exception '13 · el control del Panel filtra PII o GPS';
  end if;
  if jsonb_array_length(v_control -> 'riders') < 2 then
    raise exception '13 · el control deberia listar los Riders del negocio';
  end if;
  if v_control -> 'metrics' ->> 'backlog_jobs' is null then
    raise exception '13 · el control deberia exponer metricas';
  end if;
  raise notice '13 · OK  control del Panel con metricas y sin PII ni GPS';

  raise notice '';
  raise notice '########## TODAS LAS VERIFICACIONES PASARON ##########';
end $$;

-- ---------------------------------------------------------------------------
-- Superficie: el bypass legado queda cerrado y el worker no es alcanzable
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated','public.change_order_status(uuid,text,text)','execute') then
    raise exception 'S · change_order_status sigue ejecutable por authenticated';
  end if;
  if has_function_privilege('authenticated','public.transition_order(uuid,bigint,text)','execute') then
    raise exception 'S · transition_order(3 args) sigue ejecutable por authenticated';
  end if;
  if has_function_privilege('authenticated','public.run_rider_dispatch_cycle(integer,text)','execute') then
    raise exception 'S · el worker no puede ser invocable desde una sesion de navegador';
  end if;
  if not has_function_privilege('authenticated','public.accept_rider_dispatch_offer(uuid,bigint,text)','execute') then
    raise exception 'S · el Rider no puede aceptar su oferta';
  end if;
  if not has_function_privilege('authenticated','public.get_business_dispatch_control(uuid)','execute') then
    raise exception 'S · el Panel no puede leer su control';
  end if;
  if has_table_privilege('authenticated','public.dispatch_jobs','insert')
     or has_table_privilege('authenticated','public.dispatch_offers','update')
     or has_table_privilege('authenticated','public.rider_reward_ledger','insert') then
    raise exception 'S · hay escritura directa a la verdad de dispatch';
  end if;
  if has_schema_privilege('authenticated','private','usage') then
    raise exception 'S · el esquema private es alcanzable desde authenticated';
  end if;
  raise notice 'S · OK  bypass legado cerrado, worker fuera del navegador, private aislado';
end $$;
