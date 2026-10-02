-- Un reembolso que quedó a medias tiene salida, y un cobro aprobado en revisión siempre se puede devolver.
--
-- QUÉ ESTABA ROTO (medido el 2026-10-01 sobre las 158 migraciones anteriores más
-- el guardián de admisión)
--
--   1. Reembolso sin salida. `prepare_payment_refund_v2` crea la fila `requested`
--      ANTES del POST a Mercado Pago. Si la Edge Function muere entre las dos cosas
--      la fila queda `requested` sin ningún trabajo en la cola; si el POST vence
--      (12 s) queda `ambiguous` sin identidad del proveedor y su trabajo de
--      conciliación termina en `dead_letter` (no hay identificador por el cual
--      consultar). En los dos casos todo intento posterior recibe
--      `reconciliation_required` -202 REFUND_RECONCILING- para siempre: ninguna
--      función podía sacar esa fila de ahí, y bloqueaba cualquier otro reembolso
--      del mismo cobro.
--   2. Cobro aprobado, en revisión, sin devolución posible. Sin pedido,
--      `prepare_payment_refund_v2` sólo aceptaba dos motivos de revisión
--      (`approved_after_reservation_expired`, `finalization_without_active_reservation`).
--      Un cobro que entró en revisión por un snapshot al que le faltaba la
--      preferencia (`preference_mismatch`, cuando falla la consulta de la orden del
--      proveedor) y que DESPUÉS se verificó aprobado, con su identificador y su
--      importe, respondía «pago no reembolsable en su estado actual». Lo mismo
--      `finalization_without_confirmed_delivery_location`. El dinero estaba, el
--      pedido no, y el Panel no podía devolverlo.
--
-- QUÉ QUEDA
--
--   · `prepare_payment_refund_v2` acepta reembolsar un cobro en revisión y sin
--     pedido cuando un snapshot VÁLIDO lo dejó aprobado por el importe esperado
--     (`provider_status = 'approved'` y `paid_amount = expected_amount`: esos dos
--     campos sólo los escribe un snapshot que pasó todas las verificaciones).
--     Los dos motivos de antes siguen valiendo igual.
--   · `resolve_stuck_payment_refund` (dueño o encargado) destraba el reembolso en
--     curso de un cobro. Nunca crea una solicitud nueva ni una clave nueva:
--       - con identidad del proveedor: vuelve a encolar la conciliación (sólo lee);
--       - sin identidad: exige que haya pasado el plazo de la llamada anterior y una
--         lectura del proveedor POSTERIOR a ella. Si el proveedor no muestra ninguna
--         devolución que no esté ya asentada, autoriza UN reintento de la MISMA
--         solicitud con la MISMA clave de idempotencia. Si muestra exactamente el
--         importe de esta solicitud, no reintenta: deja pedida la búsqueda de su
--         identidad. Si muestra otra cosa, no hace nada y lo dice.
--   · `prepare_payment_refund_v2` consume esa autorización una sola vez, bajo el
--     candado del cobro, y sólo si lo que se pide ahora es el mismo importe: devuelve
--     la misma fila y la misma clave con `idempotent = false`, que es lo que la Edge
--     Function ya interpreta como «hacer el POST».
--
-- POR QUÉ NO ALCANZA CON LA CLAVE DE IDEMPOTENCIA
--
--   Reenviar con la misma clave es seguro mientras el proveedor la recuerde, y ese
--   plazo no está bajo nuestro control. Por eso el reintento se autoriza únicamente
--   con evidencia propia de que el primer envío no se ejecutó: una lectura del pago
--   hecha después, sin devoluciones de más. Con esa evidencia, un rechazo del
--   reintento es un rechazo de verdad, y recién ahí la fila pasa a `rejected` (lo
--   asienta la Edge Function con la respuesta explícita del proveedor, como hoy).
--
-- POR QUÉ LA SOLICITUD RECUERDA CONTRA QUÉ PAGO SALIÓ
--
--   Un checkout puede tener varios pagos del proveedor bajo el mismo cobro (una
--   tarjeta rechazada y después otra aprobada; un cupón de pago en efectivo que
--   vence días después de haber pagado con tarjeta). Medido: la lectura válida de
--   OTRO pago del mismo checkout bastaba como «lectura posterior» y autorizaba el
--   reenvío sin haber mirado el pago reembolsado; y si ese otro pago traía una
--   fecha más nueva, el cobro pasaba a apuntarlo y el reenvío salía contra él.
--   Por eso cada solicitud guarda el pago contra el que se envió
--   (`payment_refunds.provider_payment_id`), la evidencia tiene que ser una
--   lectura de ESE pago, y no se autoriza ni se consume nada mientras el cobro
--   apunte a otro. Las solicitudes anteriores a esta migración no lo tienen: se
--   deduce sólo cuando el cobro conoció un único pago, y si no, se deriva a soporte.
--
-- QUÉ NO CAMBIA
--
--   · Una clave de idempotencia = una solicitud. Un reembolso en curso sigue
--     bloqueando cualquier solicitud nueva del mismo cobro.
--   · Firma, privilegios y códigos de error de `prepare_payment_refund_v2`
--     (42501, 55000, 23505, 22023) y la forma de su respuesta; sólo se agrega la
--     clave `provider_retry` en el reintento autorizado.
--   · `record_payment_refund_identity`, `mark_payment_refund_ambiguous` y la
--     versión anterior `prepare_payment_refund` (que delega en la V2).
--   · Un cobro en revisión SIN aprobación verificada sigue sin poder reembolsarse
--     desde el Panel: no hay identificador ni importe confiable contra el cual pedirlo.
--
-- Forward-only. Reversión: docs/migrations/rollback/20261001204000_stuck_refund_resolution_and_review_refund.rollback.sql

-- ── 1. Lo que hay que recordar de cada solicitud ────────────────────────────
alter table public.payment_refunds
  add column if not exists provider_attempts integer not null default 1,
  add column if not exists last_provider_attempt_at timestamptz,
  add column if not exists resolution_mode text,
  add column if not exists resolution_requested_at timestamptz,
  add column if not exists resolution_requested_by uuid references auth.users(id) on delete set null,
  add column if not exists provider_payment_id text;

alter table public.payment_refunds drop constraint if exists payment_refunds_resolution_check;
alter table public.payment_refunds add constraint payment_refunds_resolution_check check (
  provider_attempts >= 1
  and (resolution_mode is null or resolution_mode in ('provider_retry', 'provider_lookup'))
  and (resolution_mode is null or resolution_requested_at is not null)
);

comment on column public.payment_refunds.provider_attempts is
  'Veces que se autorizo enviar ESTA solicitud al proveedor. Siempre con la misma clave de idempotencia.';
comment on column public.payment_refunds.last_provider_attempt_at is
  'Cuando se autorizo el ultimo reenvio. NULL: el unico envio fue el de requested_at.';
comment on column public.payment_refunds.resolution_mode is
  'Destrabe pendiente pedido por una persona: provider_retry (reenviar la misma solicitud) o provider_lookup (buscar su identidad en el proveedor). Solo tiene sentido mientras la fila esta en curso.';
comment on column public.payment_refunds.resolution_requested_at is
  'Ultima vez que un dueno o encargado pidio destrabar esta solicitud.';
comment on column public.payment_refunds.resolution_requested_by is
  'Quien lo pidio.';
comment on column public.payment_refunds.provider_payment_id is
  'Pago del proveedor contra el que se envio ESTA solicitud. NULL en las solicitudes anteriores a esta columna: al destrabar se deduce solo si el cobro conocio un unico pago.';

-- ── 2. Preparar un reembolso ────────────────────────────────────────────────
create or replace function public.prepare_payment_refund_v2(
  p_payment_intent_id uuid,
  p_amount numeric,
  p_idempotency_key uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_intent public.payment_intents%rowtype;
  v_refund public.payment_refunds%rowtype;
  v_remaining numeric(12, 2);
  v_amount numeric(12, 2);
  v_refundable_without_order boolean;
  v_local_approved numeric(12, 2);
begin
  if v_actor is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  select * into v_intent
    from public.payment_intents pi
   where pi.id = p_payment_intent_id
   for update;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'reembolso no autorizado' using errcode = '42501';
  end if;
  -- Sin pedido se devuelve sólo dinero que consta: los dos motivos de siempre, o
  -- un cobro que un snapshot válido dejó aprobado por el importe esperado. El
  -- `coalesce` no es decorativo: con un motivo distinto y `provider_status` nulo
  -- la expresión daría NULL, y un NULL acá dejaba pasar la condición de abajo.
  v_refundable_without_order := coalesce(
    v_intent.order_id is null
    and v_intent.internal_status = 'security_review_required'
    and (
      v_intent.security_review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation')
      or (v_intent.provider_status = 'approved' and v_intent.paid_amount = v_intent.expected_amount)
    ),
    false
  );
  if v_intent.provider_payment_id is null
    or (
      not v_refundable_without_order
      and (v_intent.order_id is null or v_intent.internal_status not in ('completed', 'partially_refunded'))
    )
    or (v_refundable_without_order is false and v_intent.internal_status not in ('completed', 'partially_refunded')) then
    raise exception 'pago no reembolsable en su estado actual' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.payment_disputes d
     where d.payment_intent_id = v_intent.id
       and d.dispute_type = 'chargeback'
       and d.resolved_at is null
  ) then
    raise exception 'reembolso bloqueado por contracargo abierto' using errcode = '55000';
  end if;
  select * into v_refund
    from public.payment_refunds r
   where r.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_refund.payment_intent_id <> v_intent.id then
      raise exception 'idempotency key pertenece a otro reembolso' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'refund_id', v_refund.id,
      'provider_payment_id', v_intent.provider_payment_id,
      'amount', v_refund.amount,
      'idempotency_key', v_refund.idempotency_key,
      'idempotent', true,
      -- A caller that sees an existing outbound request must never POST it
      -- again. This is what keeps the deployed legacy handler safe if the
      -- provider answered but its recorder call failed.
      'reconciliation_required', v_refund.status not in ('approved', 'rejected')
        or v_refund.provider_refund_id is not null
    );
  end if;
  v_remaining := coalesce(v_intent.paid_amount, v_intent.expected_amount) - v_intent.refunded_amount;
  -- Never replace an ambiguous outbound financial request with a new UUID.
  select * into v_refund
    from public.payment_refunds r
   where r.payment_intent_id = v_intent.id
     and r.status in ('requested', 'processing', 'ambiguous')
   order by r.requested_at asc
   limit 1
   for update;
  if found then
    -- Reintento autorizado por `resolve_stuck_payment_refund`: la MISMA solicitud
    -- con la MISMA clave, una sola vez, y sólo si lo que se pide ahora es ese
    -- mismo importe. La evidencia se vuelve a mirar acá: entre la autorización y
    -- este momento pudo llegar un aviso del proveedor con una devolución de más,
    -- o el cobro pudo pasar a apuntar a otro pago del mismo checkout (ahí el
    -- reenvío saldría contra un pago que no es el de esta solicitud).
    if v_refund.resolution_mode = 'provider_retry'
      and v_refund.provider_refund_id is null
      and v_refund.provider_payment_id = v_intent.provider_payment_id
      and coalesce(p_amount, v_remaining) = v_refund.amount then
      select coalesce(sum(r.amount), 0) into v_local_approved
        from public.payment_refunds r
       where r.payment_intent_id = v_intent.id and r.status = 'approved';
      if v_intent.refunded_amount <= v_local_approved then
        update public.payment_refunds
           set resolution_mode = null,
               provider_attempts = provider_attempts + 1,
               last_provider_attempt_at = clock_timestamp()
         where id = v_refund.id;
        insert into public.payment_events (payment_intent_id, event_type, details)
        values (
          v_intent.id,
          'payment.refund_retry_started',
          jsonb_build_object(
            'refund_id', v_refund.id,
            'actor_user_id', v_actor,
            'provider_attempt', v_refund.provider_attempts + 1
          )
        );
        return jsonb_build_object(
          'refund_id', v_refund.id,
          'provider_payment_id', v_intent.provider_payment_id,
          'amount', v_refund.amount,
          'idempotency_key', v_refund.idempotency_key,
          'full_refund', v_refund.amount = coalesce(v_intent.paid_amount, v_intent.expected_amount),
          'idempotent', false,
          'provider_retry', true
        );
      end if;
    end if;
    return jsonb_build_object(
      'refund_id', v_refund.id,
      'provider_payment_id', v_intent.provider_payment_id,
      'amount', v_refund.amount,
      'idempotency_key', v_refund.idempotency_key,
      'idempotent', true,
      'reconciliation_required', true
    );
  end if;
  v_amount := coalesce(p_amount, v_remaining);
  if v_amount <= 0 or v_amount > v_remaining then
    raise exception 'importe de reembolso invalido' using errcode = '22023';
  end if;
  insert into public.payment_refunds (
    payment_intent_id, order_id, idempotency_key, amount, requested_by, reason,
    provider_payment_id
  ) values (
    v_intent.id, v_intent.order_id, p_idempotency_key, v_amount, v_actor,
    nullif(left(btrim(coalesce(p_reason, '')), 300), ''),
    v_intent.provider_payment_id
  ) returning * into v_refund;
  return jsonb_build_object(
    'refund_id', v_refund.id,
    'provider_payment_id', v_intent.provider_payment_id,
    'amount', v_refund.amount,
    'idempotency_key', v_refund.idempotency_key,
    'full_refund', v_refund.amount = coalesce(v_intent.paid_amount, v_intent.expected_amount),
    'idempotent', false
  );
end;
$$;

revoke all on function public.prepare_payment_refund_v2(uuid, numeric, uuid, text) from public, anon, authenticated;
grant execute on function public.prepare_payment_refund_v2(uuid, numeric, uuid, text) to authenticated;

-- ── 3. Destrabar el reembolso en curso de un cobro ──────────────────────────
create or replace function public.resolve_stuck_payment_refund(p_payment_intent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  -- La llamada al proveedor se corta a los 12 s. Cinco minutos después ya no
  -- puede haber una respuesta en camino ni un asiento a medio hacer.
  c_settle constant interval := interval '5 minutes';
  v_actor uuid := auth.uid();
  v_intent public.payment_intents%rowtype;
  v_refund public.payment_refunds%rowtype;
  v_target text;
  v_last_attempt timestamptz;
  v_checked_at timestamptz;
  v_local_approved numeric(12, 2);
  v_unmatched numeric(12, 2);
  v_queued boolean := false;
begin
  if v_actor is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  -- Mismo orden de candados que el resto del reembolso: cobro, después solicitud.
  select * into v_intent
    from public.payment_intents pi
   where pi.id = p_payment_intent_id
   for update;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'reembolso no autorizado' using errcode = '42501';
  end if;
  select * into v_refund
    from public.payment_refunds r
   where r.payment_intent_id = v_intent.id
     and r.status in ('requested', 'processing', 'ambiguous')
   order by r.requested_at asc
   limit 1
   for update;
  if not found then
    return jsonb_build_object('ok', true, 'action', 'none', 'reason', 'no_refund_in_flight');
  end if;

  -- Con identidad no hay nada que adivinar: se consulta ese reembolso. La cola lo
  -- abandona a los 8 intentos; esto la vuelve a poner en marcha.
  if v_refund.provider_refund_id is not null then
    if not exists (
      select 1 from public.payment_outbox o
       where o.refund_id = v_refund.id and o.topic = 'refund_reconcile'
         and o.status in ('pending', 'claimed', 'processing', 'retry_wait')
    ) then
      insert into public.payment_outbox (payment_intent_id, refund_id, topic, resource_id, last_error)
      values (v_intent.id, v_refund.id, 'refund_reconcile', null, 'operator_requested_reconcile');
      v_queued := true;
    end if;
    update public.payment_refunds
       set resolution_requested_at = clock_timestamp(), resolution_requested_by = v_actor
     where id = v_refund.id;
    return jsonb_build_object(
      'ok', true, 'refund_id', v_refund.id,
      'action', case when v_queued then 'reconcile_enqueued' else 'reconcile_already_queued' end
    );
  end if;

  -- El pago del proveedor contra el que salió ESTA solicitud. Un cobro puede
  -- conocer varios pagos del mismo checkout: la lectura de otro no dice nada de
  -- este reembolso, y si el cobro pasó a apuntar a otro, reenviar sería pedirle
  -- la devolución a un pago que no es. Una solicitud anterior a la columna no lo
  -- tiene anotado: se deduce (y se anota) sólo si el cobro conoció un único pago;
  -- `provider_event_id` lo escribe únicamente el asiento de un snapshot válido.
  v_target := v_refund.provider_payment_id;
  if v_target is null and v_intent.provider_payment_id is not null and not exists (
    select 1 from public.payment_events e
     where e.payment_intent_id = v_intent.id
       and e.provider_event_id is not null
       and e.provider_event_id <> v_intent.provider_payment_id
  ) then
    v_target := v_intent.provider_payment_id;
    update public.payment_refunds set provider_payment_id = v_target where id = v_refund.id;
  end if;
  if v_target is null or v_target is distinct from v_intent.provider_payment_id then
    return jsonb_build_object(
      'ok', false, 'refund_id', v_refund.id,
      'reason', case when v_target is null then 'provider_payment_unknown' else 'provider_payment_changed' end,
      'action', 'resolver_en_mercado_pago_con_soporte'
    );
  end if;

  if v_refund.resolution_mode = 'provider_retry' then
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'action', 'retry_authorized',
      'refund_id', v_refund.id, 'amount', v_refund.amount
    );
  end if;

  v_last_attempt := coalesce(v_refund.last_provider_attempt_at, v_refund.requested_at);
  if clock_timestamp() < v_last_attempt + c_settle then
    return jsonb_build_object(
      'ok', false, 'reason', 'refund_request_in_flight', 'refund_id', v_refund.id,
      'retry_after_seconds', ceil(extract(epoch from (v_last_attempt + c_settle - clock_timestamp())))::integer
    );
  end if;

  -- Evidencia: la última vez que se LEYÓ ese pago en el proveedor y el resultado
  -- pasó todas las verificaciones (la única fila de `payment_events` con ese
  -- nombre, ese estado y el identificador del pago). Tiene que ser posterior al
  -- envío más su plazo. La lectura de otro pago del mismo checkout no cuenta.
  select max(e.server_recorded_at) into v_checked_at
    from public.payment_events e
   where e.payment_intent_id = v_intent.id
     and e.provider_event_id = v_target
     and e.provider_status is not null
     and e.event_type = 'payment.' || e.provider_status;
  if v_checked_at is null or v_checked_at < v_last_attempt + c_settle then
    if not exists (
      select 1 from public.payment_outbox o
       where o.payment_intent_id = v_intent.id and o.topic = 'payment_reconcile'
         and o.status in ('pending', 'claimed', 'processing', 'retry_wait')
    ) then
      begin
        insert into public.payment_outbox (payment_intent_id, topic, resource_id)
        values (v_intent.id, 'payment_reconcile', v_target);
      exception when unique_violation then
        null;  -- otra lectura del mismo pago se encoló recién
      end;
    end if;
    update public.payment_refunds
       set resolution_requested_at = clock_timestamp(), resolution_requested_by = v_actor
     where id = v_refund.id;
    return jsonb_build_object(
      'ok', false, 'reason', 'provider_check_pending',
      'action', 'provider_check_enqueued', 'refund_id', v_refund.id
    );
  end if;

  select coalesce(sum(r.amount), 0) into v_local_approved
    from public.payment_refunds r
   where r.payment_intent_id = v_intent.id and r.status = 'approved';
  v_unmatched := v_intent.refunded_amount - v_local_approved;

  if v_unmatched > 0 then
    if v_unmatched <> v_refund.amount then
      -- Hay devoluciones en el proveedor que no son (sólo) ésta. Reintentar o
      -- adoptar una identidad sería adivinar con dinero.
      return jsonb_build_object(
        'ok', false, 'reason', 'provider_refunds_do_not_match', 'refund_id', v_refund.id,
        'unmatched_amount', v_unmatched, 'refund_amount', v_refund.amount,
        'action', 'resolver_en_mercado_pago_con_soporte'
      );
    end if;
    -- El proveedor muestra exactamente este importe sin dueño: lo más probable es
    -- que el envío sí se ejecutó y se perdió la respuesta. No se reenvía. Queda
    -- pedida, por una persona, la búsqueda de su identidad.
    if not exists (
      select 1 from public.payment_outbox o
       where o.refund_id = v_refund.id and o.topic = 'refund_reconcile'
         and o.status in ('pending', 'claimed', 'processing', 'retry_wait')
    ) then
      insert into public.payment_outbox (payment_intent_id, refund_id, topic, resource_id, last_error)
      values (v_intent.id, v_refund.id, 'refund_reconcile', null, 'operator_requested_identity_lookup');
    end if;
    update public.payment_refunds
       set resolution_mode = 'provider_lookup',
           resolution_requested_at = clock_timestamp(), resolution_requested_by = v_actor
     where id = v_refund.id;
    -- Insistir mientras la búsqueda sigue pendiente no deja un evento por toque.
    if v_refund.resolution_mode is distinct from 'provider_lookup' then
      insert into public.payment_events (payment_intent_id, event_type, details)
      values (v_intent.id, 'payment.refund_identity_lookup_requested',
        jsonb_build_object('refund_id', v_refund.id, 'actor_user_id', v_actor, 'amount', v_refund.amount));
    end if;
    return jsonb_build_object(
      'ok', false, 'reason', 'provider_reports_unmatched_refund',
      'action', 'identity_lookup_enqueued', 'refund_id', v_refund.id,
      'idempotent', v_refund.resolution_mode is not distinct from 'provider_lookup'
    );
  end if;

  update public.payment_refunds
     set resolution_mode = 'provider_retry',
         resolution_requested_at = clock_timestamp(), resolution_requested_by = v_actor
   where id = v_refund.id;
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (v_intent.id, 'payment.refund_retry_authorized',
    jsonb_build_object('refund_id', v_refund.id, 'actor_user_id', v_actor, 'amount', v_refund.amount,
      'provider_checked_at', v_checked_at));
  return jsonb_build_object(
    'ok', true, 'action', 'retry_authorized',
    'refund_id', v_refund.id, 'amount', v_refund.amount
  );
end;
$$;

revoke all on function public.resolve_stuck_payment_refund(uuid) from public, anon, authenticated;
grant execute on function public.resolve_stuck_payment_refund(uuid) to authenticated;

comment on function public.resolve_stuck_payment_refund(uuid) is
  'Dueno o encargado: destraba el reembolso en curso de un cobro sin crear otra solicitud. Reencola la conciliacion si hay identidad; si no, autoriza UN reintento con la misma clave solo cuando una lectura posterior del proveedor no muestra devoluciones sin asentar.';
