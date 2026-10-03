-- REVERSIÓN de 20261002042000_business_delivery_wrong_code_replay.sql
--
-- Devuelve `confirm_business_delivery_code` a su cuerpo anterior (capturado con
-- pg_get_functiondef sobre la base sin esta migración; no se reescribió a mano) y su
-- comentario al de antes.
--
-- Qué vuelve a quedar abierto: cada copia del mismo envío con un código equivocado vuelve a
-- contar un intento fallido; un código mal tipeado más cuatro reintentos de red activan la
-- demora de 5 minutos.
--
-- No pierde datos: la migración no creó tablas ni columnas. Las filas de
-- `delivery_confirmation_attempts` que se anotaron con la clave nueva (clave + huella)
-- quedan como están: son rastro de intentos, y la función anterior no las lee.
--
-- Se niega a correr si la función ya no tiene ni el cuerpo que dejó la migración ni el
-- anterior: otra migración la redefinió después y revertir ésta la pisaría.
--
-- No toca supabase_migrations.schema_migrations. Después:
--   supabase migration repair --status reverted 20261002042000
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261002042000', 0)
);

do $guard$
declare
  v_row record;
  v_actual text;
begin
  for v_row in
    select * from (values
      ('public.confirm_business_delivery_code(uuid,bigint,text,text)', '8d7b069a989f111cd2d926a6d9a0df45', 'cc1607cf8f3c39f32922d2bdf649782a')
    ) as t(signature, applied, previous)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into v_actual
      from pg_proc p where p.oid = to_regprocedure(v_row.signature);
    if v_actual is null or v_actual not in (v_row.applied, v_row.previous) then
      raise exception 'ROLLBACK_BLOCKED: % no tiene el cuerpo de 20261002042000 ni el anterior; otra migracion la redefinio despues: revertir esa primero', v_row.signature
        using errcode = 'P0001';
    end if;
  end loop;
end
$guard$;

CREATE OR REPLACE FUNCTION public.confirm_business_delivery_code(p_order_id uuid, p_expected_revision bigint, p_delivery_code text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_order public.orders%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_code text := regexp_replace(coalesce(p_delivery_code, ''), '[^0-9]', '', 'g');
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
  v_retry_seconds integer;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if v_order.delivery_mode <> 'delivery' then
    raise exception 'este cierre es para pedidos con envio' using errcode = '42501';
  end if;
  -- Con repartidor asignado el pedido es suyo: lo cierra el, por su camino.
  if v_order.assigned_rider_user_id is not null then
    raise exception 'la entrega la confirma el repartidor asignado' using errcode = '42501';
  end if;

  -- La idempotencia del Panel: la misma tabla y la misma huella que el resto de
  -- sus comandos, asi que un reintento del outbox devuelve el recibo en vez de
  -- gastar un intento del codigo.
  v_hash := public.business_command_request_hash(
    'confirm_business_delivery_code', p_order_id,
    jsonb_build_object('expected_revision', p_expected_revision));
  select r.* into v_existing from public.business_command_receipts r
   where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  -- Doble toque sobre un pedido ya entregado: exito, sin tocar nada.
  if public.normalize_order_status_vocabulary(v_order.status) = 'delivered' then
    select to_jsonb(o) into v_result from public.orders o where o.id = v_order.id;
    return v_result || jsonb_build_object('ok', true, 'outcome', 'already_delivered', 'idempotent_replay', false);
  end if;

  if p_expected_revision is null
    or v_order.revision is distinct from p_expected_revision then
    raise exception 'revision desactualizada: esperada %, actual %',
      p_expected_revision, v_order.revision using errcode = 'PT409';
  end if;
  if public.normalize_order_status_vocabulary(v_order.status) <> 'on_the_way' then
    raise exception 'el pedido tiene que estar en reparto para cerrarlo' using errcode = '23514';
  end if;

  if v_order.delivery_code_required then
    if v_code !~ '^[0-9]{4}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_format', 'revision', v_order.revision);
    end if;

    select h.* into v_handoff from public.order_delivery_handoffs h
     where h.order_id = v_order.id for update;
    if not found or v_handoff.expires_at <= v_now then
      return jsonb_build_object('ok', false, 'code', 'code_unavailable', 'revision', v_order.revision);
    end if;

    -- La demora vive en la fila del pedido, no en el actor: un intento fallido
    -- del Rider deja esperando tambien al mostrador, y al reves. Una segunda
    -- ventana de intentos por entrar por otra puerta seria justamente el agujero.
    if v_handoff.locked_until is not null and v_handoff.locked_until > v_now then
      v_retry_seconds := greatest(1, ceil(extract(epoch from (v_handoff.locked_until - v_now)))::integer);
      insert into public.delivery_confirmation_attempts(
        business_id, order_id, rider_id, request_id, result, lock_level, retry_after_seconds)
      values (v_order.business_id, v_order.id, auth.uid(), left(regexp_replace(p_idempotency_key, '[^A-Za-z0-9_-]', '-', 'g'), 128),
              'temporarily_locked', greatest(1, v_handoff.failed_attempts - 4), v_retry_seconds)
      on conflict do nothing;
      return jsonb_build_object('ok', false, 'code', 'temporarily_locked',
                                'retry_after_seconds', v_retry_seconds, 'revision', v_order.revision);
    end if;

    if crypt(v_code, v_handoff.code_hash) <> v_handoff.code_hash then
      v_attempts := least(20, v_handoff.failed_attempts + 1);
      v_retry_seconds := case when v_attempts < 5 then null
                              else least(86400, 300 * power(2, least(8, v_attempts - 5))::integer) end;
      update public.order_delivery_handoffs
         set failed_attempts = v_attempts,
             locked_until = case when v_retry_seconds is null then null
                                 else v_now + make_interval(secs => v_retry_seconds) end
       where order_id = v_order.id;
      insert into public.delivery_confirmation_attempts(
        business_id, order_id, rider_id, request_id, result, lock_level, retry_after_seconds)
      values (v_order.business_id, v_order.id, auth.uid(), left(regexp_replace(p_idempotency_key, '[^A-Za-z0-9_-]', '-', 'g'), 128),
              case when v_retry_seconds is null then 'incorrect_code' else 'temporarily_locked' end,
              greatest(0, v_attempts - 4), v_retry_seconds)
      on conflict do nothing;
      return jsonb_build_object('ok', false,
        'code', case when v_retry_seconds is null then 'incorrect_code' else 'temporarily_locked' end,
        'remaining_attempts', greatest(0, 5 - v_attempts),
        'retry_after_seconds', v_retry_seconds, 'revision', v_order.revision);
    end if;

    -- El codigo es el bueno. Se marca ANTES del update: `prevent_unverified_delivery`
    -- mira esta fila, no una variable de sesion.
    update public.order_delivery_handoffs
       set confirmed_at = v_now, confirmed_by_user_id = auth.uid(),
           failed_attempts = 0, locked_until = null
     where order_id = v_order.id;
    insert into public.delivery_confirmation_attempts(
      business_id, order_id, rider_id, request_id, result)
    values (v_order.business_id, v_order.id, auth.uid(),
            left(regexp_replace(p_idempotency_key, '[^A-Za-z0-9_-]', '-', 'g'), 128), 'confirmed')
    on conflict do nothing;
  end if;

  perform set_config('taba.delivery_code_confirmed', 'true', true);
  update public.orders set status = 'delivered' where id = v_order.id and status = v_order.status;
  perform set_config('taba.delivery_code_confirmed', '', true);

  select to_jsonb(o) into v_result from public.orders o where o.id = v_order.id;
  v_result := v_result || jsonb_build_object(
    'ok', true, 'outcome', 'confirmed',
    'code_verified', v_order.delivery_code_required,
    'idempotent_replay', false);

  insert into public.business_command_receipts(
    business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'confirm_business_delivery_code',
          p_idempotency_key, v_hash, v_result);

  return v_result;
end;
$function$;

revoke all on function public.confirm_business_delivery_code(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.confirm_business_delivery_code(uuid, bigint, text, text) to authenticated;

comment on function public.confirm_business_delivery_code(uuid, bigint, text, text) is
  'El comercio cierra su propio reparto con el codigo del cliente. Comparte la fila de handoff -y su demora- con el camino del Rider; nunca toca un pedido con repartidor asignado.';

commit;
