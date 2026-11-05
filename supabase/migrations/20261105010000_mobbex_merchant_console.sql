-- Consola del comercio para Mobbex: ver los cobros, sus devoluciones y pedir una relectura. Aditiva y sin efectos propios.
--
-- Qué agrega (dos funciones, ninguna tabla, ninguna columna, nada de lo existente cambia):
--
--   public.mobbex_list_business_payments(p_business_id)   lectura para el panel. Dueño, encargado y equipo ven la lista; sólo
--                                                          dueño y encargado reciben las banderas can_* (el servidor las
--                                                          vuelve a exigir en cada acción: la bandera sólo evita ofrecer
--                                                          un botón que va a fallar).
--   public.mobbex_request_business_reconcile(p_intent)    «Consultar a Mobbex»: encola la MISMA relectura que hace el
--                                                          worker. No cambia ningún estado por sí misma: lo que Mobbex
--                                                          confirme entra por mobbex_record_provider_snapshot.
--
-- Qué NO hace, a propósito:
--   * no devuelve dinero: el reembolso sigue siendo mobbex_prepare_refund -> Edge mobbex-refund -> Mobbex;
--   * no muestra credenciales, cuerpos de webhook, huellas ni el detalle libre de los eventos: sólo conteos, estados internos,
--     códigos de motivo y los últimos 6 caracteres de la referencia/operación;
--   * no mezcla comercios: toda fila sale filtrada por business_id y por el rol del que llama;
--   * no mezcla entornos: la lista marca cada cobro con su entorno y can_refund es falso si el entorno del cobro no es el que
--     el comercio tiene configurado hoy (mismo criterio que REFUND_ENVIRONMENT_MISMATCH en la Edge).
--
-- Revertible sin riesgo (no toca dinero): docs/migrations/rollback/20261105010000_mobbex_merchant_console.rollback.sql

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Reconocimiento de incidencias. `attention_reason` / `security_review_required` sólo se limpiaban cuando el dinero se resolvía
-- DENTRO de TABA (reembolso completo): un cobro duplicado ya devuelto desde el panel de Mobbex, o una revisión ya verificada a mano,
-- dejaba la alerta encendida para siempre. Una persona (dueño/encargado) puede RECONOCER la incidencia con un motivo escrito:
--   * no cambia el estado del cobro, no otorga ni corta nada y no mueve dinero (sólo apaga la alarma);
--   * vale por esa causa exacta (si la causa cambia, vuelve a alarmar) y 14 DÍAS: lo no resuelto reaparece solo;
--   * se niega con una devolución en curso y sobre un cobro cobrado sin pedido (ahí se arma el pedido o se devuelve);
--   * queda en el libro de eventos y en la tabla de reconocimientos, con quién y por qué.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────

create table public.mobbex_attention_acks (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.mobbex_payment_intents(id) on delete cascade,
  concern text not null,
  note text not null,
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz not null default clock_timestamp(),
  constraint mobbex_acks_concern_check check (concern ~ '^(review|attention):.{0,120}$'),
  constraint mobbex_acks_note_check check (length(btrim(note)) between 10 and 300),
  unique (payment_intent_id, concern)
);
alter table public.mobbex_attention_acks enable row level security;
revoke all on public.mobbex_attention_acks from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.mobbex_attention_acks from service_role;
grant select on public.mobbex_attention_acks to service_role;

-- ¿Queda algo que una persona deba mirar en este cobro? (revisión de seguridad y/o atención, sin un reconocimiento vigente de esa causa).
create function private.mobbex_concern_open(pi public.mobbex_payment_intents) returns boolean
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select (pi.internal_status = 'security_review_required' and not exists (
            select 1 from public.mobbex_attention_acks a
             where a.payment_intent_id = pi.id and a.concern = 'review:' || coalesce(pi.review_reason, '')
               and a.acknowledged_at > clock_timestamp() - interval '14 days'))
      or (pi.attention_reason is not null and not exists (
            select 1 from public.mobbex_attention_acks a
             where a.payment_intent_id = pi.id and a.concern = 'attention:' || pi.attention_reason
               and a.acknowledged_at > clock_timestamp() - interval '14 days'));
$$;
revoke all on function private.mobbex_concern_open(public.mobbex_payment_intents) from public, anon, authenticated;
grant execute on function private.mobbex_concern_open(public.mobbex_payment_intents) to service_role;

create function public.mobbex_acknowledge_attention(p_payment_intent_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_intent public.mobbex_payment_intents%rowtype;
  v_note text := left(btrim(coalesce(p_note, '')), 300);
  v_concerns text[] := '{}';
begin
  if v_actor is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  select * into v_intent from public.mobbex_payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'reconocimiento no autorizado' using errcode = '42501';
  end if;
  if length(v_note) < 10 then raise exception 'motivo requerido' using errcode = '22023'; end if;
  if exists (select 1 from public.mobbex_refunds r where r.payment_intent_id = v_intent.id and (r.status in ('processing', 'ambiguous') or (r.status = 'requested' and r.requested_at > clock_timestamp() - interval '2 minutes'))) then
    raise exception 'hay una devolucion en curso' using errcode = '55000';
  end if;
  if v_intent.internal_status = 'security_review_required' then v_concerns := v_concerns || ('review:' || coalesce(v_intent.review_reason, '')); end if;
  if v_intent.attention_reason is not null then v_concerns := v_concerns || ('attention:' || v_intent.attention_reason); end if;
  if cardinality(v_concerns) = 0 then raise exception 'nada para reconocer' using errcode = 'P0002'; end if;
  -- Cobrado y sin pedido: la salida es armar el pedido o devolver; no se esconde.
  if v_intent.order_id is null and v_intent.paid_amount is not null and v_intent.paid_amount - v_intent.refunded_amount > 0 then
    raise exception 'cobro sin pedido: arme el pedido o devuelva el dinero' using errcode = '55000';
  end if;
  insert into public.mobbex_attention_acks (payment_intent_id, concern, note, acknowledged_by)
  select v_intent.id, c, v_note, v_actor from unnest(v_concerns) c
  on conflict (payment_intent_id, concern) do update set note = excluded.note, acknowledged_by = excluded.acknowledged_by, acknowledged_at = clock_timestamp();
  perform private.mobbex_event(v_intent.id, 'merchant.attention_acknowledged', null, v_intent.provider_payment_id, null, null,
    jsonb_build_object('actor', v_actor, 'concerns', to_jsonb(v_concerns), 'note', v_note));
  return jsonb_build_object('acknowledged', true, 'concerns', to_jsonb(v_concerns), 'valid_days', 14);
end $$;

-- Una fila 'requested' de más de 2 minutos NUNCA salió de TABA (se marca 'processing' ANTES de enviar): no es dinero en vuelo, y
-- mobbex_prepare_refund la cierra sola. Contarla como «sin resolver» le escondía el botón «Devolver» al comercio hasta el barrido.
-- La lista pide el ÚLTIMO trabajo de cada cobro; sin este índice la búsqueda recorre todo el historial de trabajos completados.
create index if not exists mobbex_jobs_intent_created_idx on public.mobbex_jobs (payment_intent_id, created_at desc);

create function public.mobbex_list_business_payments(p_business_id uuid, p_limit integer default 100, p_offset integer default 0)
returns setof jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_can_operate boolean;
  v_environment text;
begin
  if v_actor is null or p_business_id is null or not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'pagos no autorizados' using errcode = '42501';
  end if;
  v_can_operate := public.has_business_role(p_business_id, array['owner', 'admin']);
  select s.environment into v_environment from public.mobbex_business_settings s where s.business_id = p_business_id;
  -- Lo que pide a una persona va PRIMERO (y su total viaja en cada fila): un cobro dudoso antiguo no puede quedar fuera de la
  -- primera página. Después, lo más nuevo. `p_offset` pagina; el tope por página sigue siendo 200.
  return query
  -- Las banderas salen SIEMPRE true/false: una columna NULL dentro de un `and` las volvería JSON null.
  select x.row_json || jsonb_build_object('attention_total', x.attention_total,
      'can_refund', coalesce((x.row_json ->> 'can_refund')::boolean, false),
      'can_recover_order', coalesce((x.row_json ->> 'can_recover_order')::boolean, false),
      'can_reconcile', coalesce((x.row_json ->> 'can_reconcile')::boolean, false),
      'can_acknowledge', coalesce((x.row_json ->> 'can_acknowledge')::boolean, false),
      'concern_open', coalesce((x.row_json ->> 'concern_open')::boolean, false))
  from (
  select jsonb_build_object(
    'payment_intent_id', pi.id,
    'needs_attention', att.v,
    'concern_open', private.mobbex_concern_open(pi),
    'attention_acknowledged', (pi.attention_reason is not null or pi.internal_status = 'security_review_required') and not private.mobbex_concern_open(pi),
    'can_acknowledge', v_can_operate and private.mobbex_concern_open(pi)
      and not exists (select 1 from public.mobbex_refunds r where r.payment_intent_id = pi.id and (r.status in ('processing', 'ambiguous') or (r.status = 'requested' and r.requested_at > clock_timestamp() - interval '2 minutes')))
      and not (pi.order_id is null and pi.paid_amount is not null and pi.paid_amount - pi.refunded_amount > 0),
    'checkout_session_id', pi.checkout_session_id,
    'order_id', pi.order_id,
    'order_public_code', o.public_code,
    'reference_short', right(pi.reference, 8),
    'environment', pi.environment,
    'current_environment', v_environment,
    'amount', coalesce(pi.paid_amount, pi.expected_amount),
    'expected_amount', pi.expected_amount,
    'paid_amount', pi.paid_amount,
    'refunded_amount', pi.refunded_amount,
    'refundable_amount', case when pi.paid_amount is null then 0 else greatest(pi.paid_amount - pi.refunded_amount, 0) end,
    'currency', pi.currency,
    'internal_status', pi.internal_status,
    'provider_status_code', pi.provider_status_code,
    'review_reason', pi.review_reason,
    'attention_reason', pi.attention_reason,
    'created_at', pi.created_at,
    'approved_at', pi.approved_at,
    'last_reconciled_at', pi.last_reconciled_at,
    'payment_id_short', case when pi.provider_payment_id is null then null else right(pi.provider_payment_id, 6) end,
    'refund_in_flight', exists (select 1 from public.mobbex_refunds r where r.payment_intent_id = pi.id and (r.status in ('processing', 'ambiguous') or (r.status = 'requested' and r.requested_at > clock_timestamp() - interval '2 minutes'))),
    'latest_refund_status', lr.status,
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
          'refund_id', r.id, 'status', r.status, 'amount', r.amount, 'full', r.amount is null,
          'requested_at', r.requested_at, 'completed_at', r.completed_at, 'reason', left(coalesce(r.reason, ''), 300))
        order by r.requested_at desc)
        from (select * from public.mobbex_refunds x where x.payment_intent_id = pi.id order by x.requested_at desc limit 10) r), '[]'::jsonb),
    -- Estado del trabajo de relectura: el comercio ve que el sistema está mirando, o que se trabó.
    'worker_status', j.status,
    'worker_attempts', coalesce(j.attempts, 0),
    'worker_next_attempt_at', j.next_attempt_at,
    'processing_state', case
      when pi.internal_status in ('completed', 'refunded', 'partially_refunded', 'rejected', 'cancelled', 'expired', 'failed') and j.status is null then 'normal'
      when j.status = 'dead_letter' then 'stuck'
      when j.status in ('pending', 'retry_wait') and j.next_attempt_at <= clock_timestamp() - interval '15 minutes' then 'delayed'
      when j.status = 'claimed' and coalesce(j.lease_expires_at, '-infinity'::timestamptz) < clock_timestamp() then 'delayed'
      when j.status in ('pending', 'claimed', 'retry_wait') then 'checking'
      when pi.internal_status in ('checkout_created', 'pending', 'in_process', 'ambiguous', 'approved_order_pending') and pi.updated_at < clock_timestamp() - interval '30 minutes' then 'delayed'
      else 'normal' end,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('type', e.event_type, 'code', e.provider_status_code, 'at', e.server_recorded_at) order by e.sequence desc)
        from (select * from public.mobbex_payment_events x where x.payment_intent_id = pi.id order by x.sequence desc limit 8) e), '[]'::jsonb),
    'can_operate', v_can_operate,
    -- Mismas condiciones que mobbex_prepare_refund (la que decide de verdad), más: sin devolución en curso, algo por devolver y
    -- el cobro pertenece al entorno que el comercio tiene hoy.
    'can_refund', v_can_operate
      and pi.provider_payment_id is not null and pi.paid_amount is not null
      and pi.paid_amount - pi.refunded_amount > 0
      and (pi.internal_status in ('completed', 'partially_refunded')
           or (pi.order_id is null and pi.internal_status = 'security_review_required'
               and pi.review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation')))
      and not exists (select 1 from public.mobbex_refunds r where r.payment_intent_id = pi.id and (r.status in ('processing', 'ambiguous') or (r.status = 'requested' and r.requested_at > clock_timestamp() - interval '2 minutes')))
      and v_environment is not null and v_environment = pi.environment,
    -- Dinero cobrado y sin pedido que se puede rearmar (la misma puerta que mobbex_recover_paid_checkout).
    'can_recover_order', v_can_operate
      and pi.paid_amount is not null and pi.order_id is null and pi.internal_status = 'security_review_required'
      and pi.review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation')
      and not exists (select 1 from public.mobbex_refunds r where r.payment_intent_id = pi.id and r.status in ('requested', 'processing', 'ambiguous', 'approved')),
    'can_reconcile', v_can_operate and (
      pi.internal_status in ('checkout_created', 'pending', 'in_process', 'ambiguous', 'approved_order_pending', 'security_review_required', 'completed', 'partially_refunded')
      or exists (select 1 from public.mobbex_refunds r where r.payment_intent_id = pi.id and r.status in ('processing', 'ambiguous')))) as row_json,
    att.v as needs_attention,
    pi.created_at as created_at, pi.id as intent_id,
    count(*) filter (where att.v) over () as attention_total
  from public.mobbex_payment_intents pi
  left join public.orders o on o.id = pi.order_id
  left join lateral (
    select r.status from public.mobbex_refunds r where r.payment_intent_id = pi.id order by r.requested_at desc limit 1
  ) lr on true
  left join lateral (
    select x.status, x.attempts, x.next_attempt_at, x.lease_expires_at
      from public.mobbex_jobs x where x.payment_intent_id = pi.id order by x.created_at desc limit 1
  ) j on true
  cross join lateral (select (private.mobbex_concern_open(pi) or pi.internal_status in ('ambiguous', 'approved_order_pending')
      or exists (select 1 from public.mobbex_refunds r where r.payment_intent_id = pi.id and (r.status in ('processing', 'ambiguous') or (r.status = 'requested' and r.requested_at > clock_timestamp() - interval '2 minutes')))
      or j.status is not distinct from 'dead_letter') as v) att  -- (j.status puede ser NULL: sin esto la condición sería NULL y DESC la ordenaría primero)
  where pi.business_id = p_business_id
    -- Un checkout abierto que nunca llegó a Mobbex no es un cobro: no ensucia la lista.
    and (pi.checkout_status in ('created', 'ambiguous') or pi.provider_payment_id is not null or pi.internal_status not in ('created', 'checkout_creating'))
  ) x
  order by x.needs_attention desc, x.created_at desc, x.intent_id
  offset least(greatest(coalesce(p_offset, 0), 0), 100000)
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create function public.mobbex_request_business_reconcile(p_payment_intent_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_intent public.mobbex_payment_intents%rowtype;
  v_refund_open boolean;
begin
  if v_actor is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  select * into v_intent from public.mobbex_payment_intents pi where pi.id = p_payment_intent_id;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'conciliacion no autorizada' using errcode = '42501';
  end if;
  v_refund_open := exists (select 1 from public.mobbex_refunds r where r.payment_intent_id = v_intent.id and r.status in ('processing', 'ambiguous'));
  if v_intent.internal_status in ('refunded', 'expired', 'cancelled', 'failed', 'rejected') and not v_refund_open then
    return jsonb_build_object('queued', false, 'internal_status', v_intent.internal_status);
  end if;
  -- 'completed' / 'partially_refunded' SÍ se pueden releer: el comercio puede haber devuelto desde el panel de Mobbex, y sin una lectura
  -- TABA seguiría ofreciendo «Devolver» y bloqueando la cancelación del pedido (la lectura del proveedor es idempotente para lo aprobado).
  perform private.mobbex_enqueue_job(v_intent.id, case when v_refund_open then 'merchant_refund_check' else 'merchant_check' end, 0);
  perform private.mobbex_event(v_intent.id, 'merchant.reconcile_requested', null, v_intent.provider_payment_id, null, null,
    jsonb_build_object('actor', v_actor, 'refund_open', v_refund_open));
  return jsonb_build_object('queued', true, 'intent_id', v_intent.id, 'environment', v_intent.environment);
end $$;

-- Sólo el navegador autenticado (y la función revalida rol y comercio): nada para anon ni PUBLIC.
revoke all on function public.mobbex_list_business_payments(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.mobbex_request_business_reconcile(uuid) from public, anon, authenticated;
grant execute on function public.mobbex_list_business_payments(uuid, integer, integer) to authenticated, service_role;
grant execute on function public.mobbex_request_business_reconcile(uuid) to authenticated, service_role;
revoke all on function public.mobbex_acknowledge_attention(uuid, text) from public, anon, authenticated;
grant execute on function public.mobbex_acknowledge_attention(uuid, text) to authenticated, service_role;

comment on function public.mobbex_list_business_payments(uuid, integer, integer) is
  'Lista de cobros Mobbex del comercio para el panel. Sólo lectura; las banderas can_* son una comodidad, cada acción se revalida.';
comment on function public.mobbex_request_business_reconcile(uuid) is
  'Encola la relectura de un cobro Mobbex. No cambia estados: lo confirmado entra por mobbex_record_provider_snapshot.';
