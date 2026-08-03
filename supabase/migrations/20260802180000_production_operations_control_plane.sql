-- Production operations control plane.
-- Adds correlation, durable alerts and immutable daily reconciliation without
-- changing commercial catalog, pricing or delivery workflow decisions.

create extension if not exists pgcrypto;

-- ===== End-to-end correlation =====

alter table public.checkout_sessions add column if not exists correlation_id uuid;
alter table public.payment_intents add column if not exists correlation_id uuid;
alter table public.orders add column if not exists correlation_id uuid;
alter table public.pos_sales add column if not exists correlation_id uuid;
alter table public.order_packing_sessions add column if not exists correlation_id uuid;
alter table public.fiscal_documents add column if not exists correlation_id uuid;
alter table public.fiscal_print_jobs add column if not exists correlation_id uuid;

update public.checkout_sessions
set correlation_id = gen_random_uuid()
where correlation_id is null;

update public.payment_intents pi
set correlation_id = cs.correlation_id
from public.checkout_sessions cs
where cs.id = pi.checkout_session_id
  and pi.correlation_id is null;

update public.orders o
set correlation_id = pi.correlation_id
from public.payment_intents pi
where pi.order_id = o.id
  and o.correlation_id is null;

update public.orders
set correlation_id = gen_random_uuid()
where correlation_id is null;

update public.pos_sales
set correlation_id = gen_random_uuid()
where correlation_id is null;

update public.order_packing_sessions ps
set correlation_id = o.correlation_id
from public.orders o
where o.id = ps.order_id
  and ps.correlation_id is null;

update public.fiscal_documents fd
set correlation_id = case
  when fd.source_type = 'online_order' then (
    select o.correlation_id from public.orders o where o.id = fd.source_id
  )
  when fd.source_type = 'pos_sale' then (
    select ps.correlation_id from public.pos_sales ps where ps.id = fd.source_id
  )
  when fd.associated_document_id is not null then (
    select original.correlation_id
    from public.fiscal_documents original
    where original.id = fd.associated_document_id
  )
  else null
end
where fd.correlation_id is null;

update public.fiscal_documents
set correlation_id = gen_random_uuid()
where correlation_id is null;

update public.fiscal_print_jobs pj
set correlation_id = fd.correlation_id
from public.fiscal_documents fd
where fd.id = pj.fiscal_document_id
  and pj.correlation_id is null;

alter table public.checkout_sessions alter column correlation_id set default gen_random_uuid();
alter table public.checkout_sessions alter column correlation_id set not null;
alter table public.payment_intents alter column correlation_id set not null;
alter table public.orders alter column correlation_id set default gen_random_uuid();
alter table public.orders alter column correlation_id set not null;
alter table public.pos_sales alter column correlation_id set default gen_random_uuid();
alter table public.pos_sales alter column correlation_id set not null;
alter table public.order_packing_sessions alter column correlation_id set not null;
alter table public.fiscal_documents alter column correlation_id set not null;
alter table public.fiscal_print_jobs alter column correlation_id set not null;

create unique index if not exists checkout_sessions_correlation_key
  on public.checkout_sessions(correlation_id);
create index if not exists payment_intents_correlation_idx
  on public.payment_intents(correlation_id);
create index if not exists orders_correlation_idx
  on public.orders(correlation_id);
create index if not exists pos_sales_correlation_idx
  on public.pos_sales(correlation_id);
create index if not exists packing_sessions_correlation_idx
  on public.order_packing_sessions(correlation_id);
create index if not exists fiscal_documents_correlation_idx
  on public.fiscal_documents(correlation_id);
create index if not exists fiscal_print_jobs_correlation_idx
  on public.fiscal_print_jobs(correlation_id);

create or replace function public.assign_operation_correlation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, extensions, pg_temp
as $assign_operation_correlation$
begin
  if tg_table_name = 'payment_intents' then
    select cs.correlation_id into new.correlation_id
    from public.checkout_sessions cs
    where cs.id = new.checkout_session_id;
  elsif tg_table_name = 'order_packing_sessions' then
    select o.correlation_id into new.correlation_id
    from public.orders o
    where o.id = new.order_id;
  elsif tg_table_name = 'fiscal_print_jobs' then
    select fd.correlation_id into new.correlation_id
    from public.fiscal_documents fd
    where fd.id = new.fiscal_document_id;
  elsif tg_table_name = 'fiscal_documents' then
    if new.associated_document_id is not null then
      select fd.correlation_id into new.correlation_id
      from public.fiscal_documents fd
      where fd.id = new.associated_document_id;
    elsif new.source_type = 'online_order' then
      select o.correlation_id into new.correlation_id
      from public.orders o
      where o.id = new.source_id;
    elsif new.source_type = 'pos_sale' then
      select ps.correlation_id into new.correlation_id
      from public.pos_sales ps
      where ps.id = new.source_id;
    end if;
  end if;
  new.correlation_id := coalesce(new.correlation_id, gen_random_uuid());
  return new;
end;
$assign_operation_correlation$;

drop trigger if exists checkout_sessions_assign_correlation on public.checkout_sessions;
create trigger checkout_sessions_assign_correlation
before insert on public.checkout_sessions
for each row execute function public.assign_operation_correlation();

drop trigger if exists payment_intents_assign_correlation on public.payment_intents;
create trigger payment_intents_assign_correlation
before insert or update of checkout_session_id on public.payment_intents
for each row execute function public.assign_operation_correlation();

drop trigger if exists orders_assign_correlation on public.orders;
create trigger orders_assign_correlation
before insert on public.orders
for each row execute function public.assign_operation_correlation();

drop trigger if exists pos_sales_assign_correlation on public.pos_sales;
create trigger pos_sales_assign_correlation
before insert on public.pos_sales
for each row execute function public.assign_operation_correlation();

drop trigger if exists packing_sessions_assign_correlation on public.order_packing_sessions;
create trigger packing_sessions_assign_correlation
before insert or update of order_id on public.order_packing_sessions
for each row execute function public.assign_operation_correlation();

drop trigger if exists fiscal_documents_assign_correlation on public.fiscal_documents;
create trigger fiscal_documents_assign_correlation
before insert or update of source_id, associated_document_id on public.fiscal_documents
for each row execute function public.assign_operation_correlation();

drop trigger if exists fiscal_print_jobs_assign_correlation on public.fiscal_print_jobs;
create trigger fiscal_print_jobs_assign_correlation
before insert or update of fiscal_document_id on public.fiscal_print_jobs
for each row execute function public.assign_operation_correlation();

create or replace function public.propagate_paid_order_correlation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $propagate_paid_order_correlation$
begin
  if new.order_id is not null then
    update public.orders
    set correlation_id = new.correlation_id
    where id = new.order_id
      and correlation_id is distinct from new.correlation_id;
  end if;
  return new;
end;
$propagate_paid_order_correlation$;

drop trigger if exists payment_intents_propagate_order_correlation on public.payment_intents;
create trigger payment_intents_propagate_order_correlation
after insert or update of order_id, correlation_id on public.payment_intents
for each row execute function public.propagate_paid_order_correlation();

-- ===== Durable health signals and operational alerts =====

create table if not exists public.service_health_signals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  service text not null check (service in ('storefront','supabase','mercadopago','rider','arca','fiscal_artifact','windows','printing','backup')),
  severity text not null check (severity in ('INFO','WARNING','ACTION_REQUIRED','CRITICAL')),
  signal_code text not null check (signal_code ~ '^[A-Z0-9_]{3,80}$'),
  status text not null check (status in ('healthy','degraded','unavailable','expired')),
  correlation_id uuid,
  observed_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint service_health_signal_window check (expires_at > observed_at),
  constraint service_health_signal_details_size check (octet_length(details::text) <= 4096)
);

create index if not exists service_health_signals_business_current_idx
  on public.service_health_signals(business_id, service, observed_at desc);

create table if not exists public.operational_alerts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  severity text not null check (severity in ('INFO','WARNING','ACTION_REQUIRED','CRITICAL')),
  alert_code text not null check (alert_code ~ '^[A-Z0-9_]{3,80}$'),
  subject_type text not null check (subject_type ~ '^[a-z0-9_]{2,40}$'),
  subject_id uuid,
  correlation_id uuid,
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  summary text not null check (char_length(summary) between 3 and 240),
  required_action text not null check (char_length(required_action) between 3 and 300),
  evidence jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  acknowledged_by uuid references auth.users(id) on delete restrict,
  acknowledged_at timestamptz,
  resolved_by uuid references auth.users(id) on delete restrict,
  resolved_at timestamptz,
  resolution_note text,
  updated_at timestamptz not null default clock_timestamp(),
  constraint operational_alerts_evidence_size check (octet_length(evidence::text) <= 4096),
  constraint operational_alerts_ack_consistency check (
    (status = 'open' and acknowledged_by is null and acknowledged_at is null and resolved_by is null and resolved_at is null)
    or (status = 'acknowledged' and acknowledged_by is not null and acknowledged_at is not null and resolved_by is null and resolved_at is null)
    or (status = 'resolved' and resolved_at is not null)
  ),
  unique (business_id, fingerprint)
);

create index if not exists operational_alerts_open_idx
  on public.operational_alerts(business_id, severity, last_seen_at desc)
  where status <> 'resolved';

create table if not exists public.operational_alert_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  alert_id uuid not null references public.operational_alerts(id) on delete restrict,
  event_type text not null check (event_type in ('detected','redetected','acknowledged','resolved','reopened')),
  actor_id uuid references auth.users(id) on delete restrict,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint operational_alert_events_detail_size check (octet_length(detail::text) <= 2048)
);

create index if not exists operational_alert_events_alert_idx
  on public.operational_alert_events(alert_id, created_at desc);

create or replace function public.record_service_health_signal(
  p_business_id uuid,
  p_service text,
  p_severity text,
  p_signal_code text,
  p_status text,
  p_correlation_id uuid,
  p_observed_at timestamptz,
  p_expires_at timestamptz,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $record_service_health_signal$
declare
  v_id uuid;
begin
  if p_observed_at > clock_timestamp() + interval '5 minutes'
    or p_expires_at <= p_observed_at
    or p_expires_at > p_observed_at + interval '7 days' then
    raise exception 'ventana de health signal invalida' using errcode = '22023';
  end if;
  insert into public.service_health_signals(
    business_id, service, severity, signal_code, status, correlation_id,
    observed_at, expires_at, details
  ) values (
    p_business_id, p_service, p_severity, p_signal_code, p_status,
    p_correlation_id, p_observed_at, p_expires_at, coalesce(p_details, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$record_service_health_signal$;

create or replace function public.refresh_operational_alerts(p_business_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $refresh_operational_alerts$
declare
  v_finding record;
  v_alert_id uuid;
  v_previous_status text;
  v_previous_seen timestamptz;
  v_fingerprint text;
  v_seen text[] := '{}'::text[];
  v_count integer := 0;
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;

  for v_finding in
    select * from (
      select
        'CRITICAL'::text as severity,
        'PAYMENT_APPROVED_WITHOUT_ORDER'::text as alert_code,
        'payment_intent'::text as subject_type,
        pi.id as subject_id,
        pi.correlation_id,
        'Pago aprobado sin pedido operativo.'::text as summary,
        'Reconciliar el pago y finalizar el pedido; no cobrar nuevamente.'::text as required_action,
        jsonb_build_object('payment_intent_id', pi.id, 'status', pi.internal_status) as evidence
      from public.payment_intents pi
      where pi.business_id = p_business_id
        and pi.internal_status in ('approved','approved_order_pending')
        and pi.order_id is null
        and pi.updated_at < clock_timestamp() - interval '5 minutes'

      union all

      select
        'ACTION_REQUIRED', 'PAYMENT_RECONCILIATION_REQUIRED', 'payment_intent',
        pi.id, pi.correlation_id,
        'Pago con resultado ambiguo o revisión de seguridad.',
        'Consultar el proveedor y comparar importe, moneda y referencia antes de continuar.',
        jsonb_build_object('payment_intent_id', pi.id, 'status', pi.internal_status)
      from public.payment_intents pi
      where pi.business_id = p_business_id
        and pi.internal_status in ('ambiguous','security_review_required')

      union all

      select
        'CRITICAL', 'FISCAL_AUTHORIZATION_AMBIGUOUS', 'fiscal_document',
        fd.id, fd.correlation_id,
        'La autorización fiscal es ambigua.',
        'Consultar ARCA por tipo, punto de venta y número; no volver a emitir a ciegas.',
        jsonb_build_object('fiscal_document_id', fd.id, 'state', fd.state)
      from public.fiscal_documents fd
      where fd.business_id = p_business_id and fd.state = 'ambiguous'

      union all

      select
        case when fo.state = 'dead_letter' then 'CRITICAL' else 'ACTION_REQUIRED' end,
        'FISCAL_OUTBOX_STALLED', 'fiscal_document',
        fd.id, fd.correlation_id,
        'La cola fiscal no progresa.',
        'Revisar conectividad y worker; conservar número e idempotencia antes de reintentar.',
        jsonb_build_object('fiscal_document_id', fd.id, 'outbox_state', fo.state, 'attempts', fo.attempt_count)
      from public.fiscal_outbox fo
      join public.fiscal_documents fd on fd.id = fo.fiscal_document_id
      where fd.business_id = p_business_id
        and (
          fo.state = 'dead_letter'
          or (fo.state in ('pending','retry_wait') and fo.next_attempt_at < clock_timestamp() - interval '15 minutes')
          or (fo.state = 'leased' and fo.lease_deadline < clock_timestamp())
        )

      union all

      select
        case when po.status = 'dead_letter' then 'CRITICAL' else 'ACTION_REQUIRED' end,
        'PAYMENT_OUTBOX_STALLED', 'payment_intent',
        pi.id, pi.correlation_id,
        'La cola de pagos no progresa.',
        'Revisar el worker y reconciliar con Mercado Pago usando la misma referencia.',
        jsonb_build_object('payment_intent_id', pi.id, 'outbox_status', po.status, 'attempts', po.attempts)
      from public.payment_outbox po
      join public.payment_intents pi on pi.id = po.payment_intent_id
      where pi.business_id = p_business_id
        and (
          po.status in ('failed','dead_letter')
          or (po.status in ('pending','retry_wait') and po.next_attempt_at < clock_timestamp() - interval '15 minutes')
          or (po.status in ('claimed','processing') and po.lease_expires_at < clock_timestamp())
        )

      union all

      select
        'ACTION_REQUIRED', 'FISCAL_ARTIFACT_STALLED', 'fiscal_document',
        fd.id, fd.correlation_id,
        'El PDF fiscal no está disponible.',
        'Revisar Storage y el worker de artefactos; no modificar el CAE autorizado.',
        jsonb_build_object('fiscal_document_id', fd.id, 'artifact_state', fd.artifact_state, 'outbox_state', fao.state)
      from public.fiscal_documents fd
      left join public.fiscal_artifact_outbox fao on fao.fiscal_document_id = fd.id
      where fd.business_id = p_business_id
        and fd.state = 'authorized'
        and fd.artifact_state in ('artifact_failed','artifact_pending','artifact_generating')
        and coalesce(fao.created_at, fd.authorized_at, fd.created_at) < clock_timestamp() - interval '10 minutes'

      union all

      select
        'ACTION_REQUIRED', 'PRINT_JOB_FAILED', 'print_job',
        pj.id, pj.correlation_id,
        'Una impresión fiscal falló o no pudo verificarse.',
        'Comprobar impresora y papel, abrir la vista previa y reimprimir sólo si corresponde.',
        jsonb_build_object('print_job_id', pj.id, 'status', pj.status, 'error_code', pj.error_code)
      from public.fiscal_print_jobs pj
      where pj.business_id = p_business_id and pj.status in ('failed','unknown')

      union all

      select
        'WARNING', 'RIDER_SIGNAL_STALE', 'order',
        o.id, o.correlation_id,
        'Rider sin señal reciente durante una entrega activa.',
        'Contactar al Rider y verificar el estado sin inventar una ubicación.',
        jsonb_build_object('order_id', o.id, 'status', o.status)
      from public.orders o
      left join lateral (
        select rl.created_at
        from public.rider_locations rl
        where rl.order_id = o.id
        order by rl.created_at desc
        limit 1
      ) last_location on true
      where o.business_id = p_business_id
        and o.status in ('assigned','picked_up','on_the_way','arrived')
        and coalesce(last_location.created_at, o.updated_at) < clock_timestamp() - interval '5 minutes'

      union all

      select
        shs.severity, shs.signal_code, 'service_health', shs.id,
        shs.correlation_id,
        'Un servicio operativo reportó estado degradado.',
        'Abrir diagnóstico y ejecutar el runbook indicado para el servicio.',
        jsonb_build_object('signal_id', shs.id, 'service', shs.service, 'status', shs.status)
      from public.service_health_signals shs
      where shs.business_id = p_business_id
        and shs.expires_at > clock_timestamp()
        and shs.status <> 'healthy'
    ) findings
  loop
    v_fingerprint := encode(digest(
      p_business_id::text || ':' || v_finding.alert_code || ':' || coalesce(v_finding.subject_id::text, 'none'),
      'sha256'
    ), 'hex');
    v_seen := array_append(v_seen, v_fingerprint);
    select status,last_seen_at into v_previous_status,v_previous_seen
    from public.operational_alerts
    where business_id = p_business_id and fingerprint = v_fingerprint
    for update;

    insert into public.operational_alerts(
      business_id, fingerprint, severity, alert_code, subject_type, subject_id,
      correlation_id, status, summary, required_action, evidence
    ) values (
      p_business_id, v_fingerprint, v_finding.severity,
      v_finding.alert_code, v_finding.subject_type, v_finding.subject_id,
      v_finding.correlation_id, 'open', v_finding.summary,
      v_finding.required_action, v_finding.evidence
    )
    on conflict (business_id, fingerprint) do update set
      severity = excluded.severity,
      correlation_id = excluded.correlation_id,
      status = case when operational_alerts.status = 'resolved' then 'open' else operational_alerts.status end,
      summary = excluded.summary,
      required_action = excluded.required_action,
      evidence = excluded.evidence,
      last_seen_at = clock_timestamp(),
      occurrence_count = operational_alerts.occurrence_count + case
        when operational_alerts.last_seen_at < clock_timestamp() - interval '1 minute' then 1 else 0 end,
      resolved_by = case when operational_alerts.status = 'resolved' then null else operational_alerts.resolved_by end,
      resolved_at = case when operational_alerts.status = 'resolved' then null else operational_alerts.resolved_at end,
      resolution_note = case when operational_alerts.status = 'resolved' then null else operational_alerts.resolution_note end,
      acknowledged_by = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_by end,
      acknowledged_at = case when operational_alerts.status = 'resolved' then null else operational_alerts.acknowledged_at end,
      updated_at = clock_timestamp()
    returning id into v_alert_id;

    if v_previous_status is null or v_previous_status = 'resolved'
      or v_previous_seen < clock_timestamp() - interval '15 minutes' then
      insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
      values (
        p_business_id,
        v_alert_id,
        case when v_previous_status is null then 'detected' when v_previous_status = 'resolved' then 'reopened' else 'redetected' end,
        jsonb_build_object('alert_code', v_finding.alert_code)
      );
    end if;
    v_count := v_count + 1;
  end loop;

  update public.operational_alerts
  set status = 'resolved', resolved_at = clock_timestamp(), resolution_note = 'Condición ausente en la reconciliación automática.', updated_at = clock_timestamp()
  where business_id = p_business_id
    and status <> 'resolved'
    and not (fingerprint = any(v_seen));

  insert into public.operational_alert_events(business_id, alert_id, event_type, detail)
  select p_business_id, a.id, 'resolved', jsonb_build_object('resolution', 'automatic_condition_cleared')
  from public.operational_alerts a
  where a.business_id = p_business_id
    and a.status = 'resolved'
    and a.resolved_at >= transaction_timestamp()
    and a.resolved_by is null;

  return v_count;
end;
$refresh_operational_alerts$;

create or replace function public.transition_operational_alert(
  p_alert_id uuid,
  p_target_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $transition_operational_alert$
declare
  v_alert public.operational_alerts%rowtype;
begin
  select * into v_alert
  from public.operational_alerts
  where id = p_alert_id
  for update;
  if not found then raise exception 'alerta inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_alert.business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if p_target_status not in ('acknowledged','resolved') then
    raise exception 'transicion de alerta invalida' using errcode = '22023';
  end if;
  if p_target_status = 'resolved' and char_length(btrim(coalesce(p_note, ''))) not between 5 and 500 then
    raise exception 'la resolucion requiere una nota' using errcode = '22023';
  end if;
  if v_alert.status = 'resolved' then
    return jsonb_build_object('ok', true, 'alert_id', v_alert.id, 'status', v_alert.status, 'idempotent_replay', true);
  end if;
  if p_target_status = 'acknowledged' then
    update public.operational_alerts
    set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_alert.id;
  else
    update public.operational_alerts
    set status = 'resolved', resolved_by = auth.uid(), resolved_at = clock_timestamp(), resolution_note = btrim(p_note), updated_at = clock_timestamp()
    where id = v_alert.id;
  end if;
  insert into public.operational_alert_events(business_id, alert_id, event_type, actor_id, detail)
  values (v_alert.business_id, v_alert.id, p_target_status, auth.uid(), jsonb_build_object('note', nullif(btrim(coalesce(p_note,'')),'')));
  return jsonb_build_object('ok', true, 'alert_id', v_alert.id, 'status', p_target_status, 'idempotent_replay', false);
end;
$transition_operational_alert$;

-- ===== Immutable daily reconciliation =====

create table if not exists public.daily_reconciliations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  business_date date not null,
  timezone text not null,
  status text not null default 'open' check (status in ('open','closed')),
  revision bigint not null default 1 check (revision > 0),
  window_start timestamptz not null,
  window_end timestamptz not null,
  snapshot jsonb not null,
  declared_cash numeric(14,2) not null check (declared_cash >= 0),
  expected_cash numeric(14,2) not null check (expected_cash >= 0),
  cash_difference numeric(14,2) not null,
  difference_note text,
  open_alerts integer not null default 0 check (open_alerts >= 0),
  critical_alerts integer not null default 0 check (critical_alerts >= 0),
  snapshot_sha256 text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  prepared_by uuid not null references auth.users(id) on delete restrict,
  prepared_at timestamptz not null default clock_timestamp(),
  refreshed_at timestamptz not null default clock_timestamp(),
  closed_by uuid references auth.users(id) on delete restrict,
  closed_at timestamptz,
  prepare_idempotency_key text not null check (prepare_idempotency_key ~ '^[A-Za-z0-9:_-]{8,128}$'),
  close_idempotency_key text check (close_idempotency_key is null or close_idempotency_key ~ '^[A-Za-z0-9:_-]{8,128}$'),
  created_at timestamptz not null default clock_timestamp(),
  constraint daily_reconciliation_window check (window_end > window_start),
  constraint daily_reconciliation_closed_consistency check (
    (status = 'open' and closed_by is null and closed_at is null and snapshot_sha256 is null and close_idempotency_key is null)
    or (status = 'closed' and closed_by is not null and closed_at is not null and snapshot_sha256 is not null and close_idempotency_key is not null)
  ),
  constraint daily_reconciliation_difference_note check (
    cash_difference = 0 or char_length(btrim(coalesce(difference_note, ''))) between 5 and 500
  ),
  unique (business_id, business_date),
  unique (business_id, prepare_idempotency_key),
  unique (business_id, close_idempotency_key)
);

create index if not exists daily_reconciliations_business_date_idx
  on public.daily_reconciliations(business_id, business_date desc);

create table if not exists public.daily_reconciliation_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  reconciliation_id uuid not null references public.daily_reconciliations(id) on delete restrict,
  event_type text not null check (event_type in ('prepared','refreshed','closed','idempotent_replay')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  revision bigint not null check (revision > 0),
  snapshot_sha256 text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists daily_reconciliation_events_run_idx
  on public.daily_reconciliation_events(reconciliation_id, created_at desc);

create or replace function public.prevent_closed_daily_reconciliation_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $prevent_closed_daily_reconciliation_mutation$
begin
  if tg_op = 'DELETE' or old.status = 'closed' then
    raise exception 'cierre diario inmutable' using errcode = '55000';
  end if;
  return new;
end;
$prevent_closed_daily_reconciliation_mutation$;

drop trigger if exists daily_reconciliations_immutable on public.daily_reconciliations;
create trigger daily_reconciliations_immutable
before update or delete on public.daily_reconciliations
for each row execute function public.prevent_closed_daily_reconciliation_mutation();

create or replace function public.daily_reconciliation_snapshot_internal(
  p_business_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $daily_reconciliation_snapshot_internal$
  select jsonb_build_object(
    'orders', jsonb_build_object(
      'created', (select count(*) from public.orders o where o.business_id = p_business_id and o.created_at >= p_window_start and o.created_at < p_window_end),
      'cancelled', (select count(*) from public.orders o where o.business_id = p_business_id and coalesce(o.cancelled_at,o.canceled_at) >= p_window_start and coalesce(o.cancelled_at,o.canceled_at) < p_window_end),
      'delivered', (select count(*) from public.orders o where o.business_id = p_business_id and o.delivered_at >= p_window_start and o.delivered_at < p_window_end),
      'returned', (select count(distinct fd.source_id) from public.fiscal_documents fd where fd.business_id = p_business_id and fd.document_intent = 'credit_note' and fd.state = 'authorized' and fd.authorized_at >= p_window_start and fd.authorized_at < p_window_end and fd.source_type = 'online_order')
    ),
    'payments', jsonb_build_object(
      'approved_count', (select count(*) from public.payment_intents pi where pi.business_id = p_business_id and pi.approved_at >= p_window_start and pi.approved_at < p_window_end),
      'approved_amount', (select coalesce(sum(pi.paid_amount),0) from public.payment_intents pi where pi.business_id = p_business_id and pi.approved_at >= p_window_start and pi.approved_at < p_window_end),
      'pending', (select count(*) from public.payment_intents pi where pi.business_id = p_business_id and pi.created_at < p_window_end and pi.internal_status in ('created','preference_creating','preference_created','redirected','pending','in_process','approved_order_pending')),
      'rejected', (select count(*) from public.payment_intents pi where pi.business_id = p_business_id and pi.rejected_at >= p_window_start and pi.rejected_at < p_window_end),
      'refunded_amount', (select coalesce(sum(pr.amount),0) from public.payment_refunds pr join public.payment_intents pi on pi.id = pr.payment_intent_id where pi.business_id = p_business_id and pr.status = 'approved' and pr.completed_at >= p_window_start and pr.completed_at < p_window_end),
      'chargebacks', (select count(*) from public.payment_disputes pd join public.payment_intents pi on pi.id = pd.payment_intent_id where pi.business_id = p_business_id and pd.dispute_type = 'chargeback' and pd.created_at >= p_window_start and pd.created_at < p_window_end)
    ),
    'cash', jsonb_build_object(
      'expected', (select coalesce(sum(pp.amount),0) from public.pos_payments pp join public.pos_sales ps on ps.id = pp.sale_id where ps.business_id = p_business_id and pp.payment_method = 'cash' and pp.status = 'confirmed' and pp.created_at >= p_window_start and pp.created_at < p_window_end)
    ),
    'inventory', jsonb_build_object(
      'sales_units', (select coalesce(abs(sum(im.quantity_delta)),0) from public.inventory_movements im where im.business_id = p_business_id and im.movement_type = 'sale' and im.created_at >= p_window_start and im.created_at < p_window_end),
      'received_units', (select coalesce(sum(im.quantity_delta),0) from public.inventory_movements im where im.business_id = p_business_id and im.movement_type in ('purchase_receipt','initial_stock') and im.created_at >= p_window_start and im.created_at < p_window_end),
      'waste_units', (select coalesce(abs(sum(im.quantity_delta)),0) from public.inventory_movements im where im.business_id = p_business_id and im.movement_type in ('damage','loss','expiration') and im.created_at >= p_window_start and im.created_at < p_window_end),
      'adjustment_units', (select coalesce(sum(im.quantity_delta),0) from public.inventory_movements im where im.business_id = p_business_id and im.movement_type = 'manual_adjustment' and im.created_at >= p_window_start and im.created_at < p_window_end),
      'counts', (select count(*) from public.inventory_movements im where im.business_id = p_business_id and im.movement_type = 'stock_count' and im.created_at >= p_window_start and im.created_at < p_window_end),
      'count_difference_units', (select coalesce(sum(im.quantity_delta),0) from public.inventory_movements im where im.business_id = p_business_id and im.movement_type = 'stock_count' and im.created_at >= p_window_start and im.created_at < p_window_end)
    ),
    'fiscal', jsonb_build_object(
      'authorized', (select count(*) from public.fiscal_documents fd where fd.business_id = p_business_id and fd.authorized_at >= p_window_start and fd.authorized_at < p_window_end and fd.state = 'authorized'),
      'pending', (select count(*) from public.fiscal_documents fd where fd.business_id = p_business_id and fd.created_at < p_window_end and fd.state in ('draft','queued','claiming','authenticating','authorizing','ambiguous','retry_wait','failed')),
      'rejected', (select count(*) from public.fiscal_documents fd where fd.business_id = p_business_id and fd.created_at >= p_window_start and fd.created_at < p_window_end and fd.state in ('observed','rejected')),
      'credit_notes', (select count(*) from public.fiscal_documents fd where fd.business_id = p_business_id and fd.document_intent = 'credit_note' and fd.created_at >= p_window_start and fd.created_at < p_window_end),
      'pdf_pending', (select count(*) from public.fiscal_documents fd where fd.business_id = p_business_id and fd.state = 'authorized' and fd.artifact_state <> 'artifact_ready' and fd.authorized_at < p_window_end)
    )
  )
$daily_reconciliation_snapshot_internal$;

revoke execute on function public.daily_reconciliation_snapshot_internal(uuid,timestamptz,timestamptz) from public, anon, authenticated;

create or replace function public.prepare_daily_reconciliation(
  p_business_id uuid,
  p_business_date date,
  p_timezone text,
  p_declared_cash numeric,
  p_difference_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $prepare_daily_reconciliation$
declare
  v_run public.daily_reconciliations%rowtype;
  v_snapshot jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_expected numeric(14,2);
  v_difference numeric(14,2);
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'zona horaria invalida' using errcode = '22023';
  end if;
  if p_declared_cash is null or p_declared_cash < 0 or p_declared_cash > 999999999999.99 then
    raise exception 'efectivo declarado invalido' using errcode = '22023';
  end if;
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || p_business_date::text, 0));
  select * into v_run from public.daily_reconciliations
  where business_id = p_business_id and prepare_idempotency_key = p_idempotency_key
  for update;
  if found then
    insert into public.daily_reconciliation_events(business_id,reconciliation_id,event_type,actor_id,revision,snapshot_sha256)
    values (p_business_id,v_run.id,'idempotent_replay',auth.uid(),v_run.revision,v_run.snapshot_sha256);
    return jsonb_build_object('ok',true,'reconciliation',to_jsonb(v_run),'idempotent_replay',true);
  end if;
  v_start := p_business_date::timestamp at time zone p_timezone;
  v_end := (p_business_date + 1)::timestamp at time zone p_timezone;
  v_snapshot := public.daily_reconciliation_snapshot_internal(p_business_id,v_start,v_end);
  v_expected := coalesce((v_snapshot #>> '{cash,expected}')::numeric,0);
  v_difference := round(p_declared_cash - v_expected,2);
  if v_difference <> 0 and char_length(btrim(coalesce(p_difference_note,''))) not between 5 and 500 then
    raise exception 'la diferencia de caja requiere una explicacion' using errcode = '22023';
  end if;
  insert into public.daily_reconciliations(
    business_id,business_date,timezone,status,window_start,window_end,snapshot,
    declared_cash,expected_cash,cash_difference,difference_note,open_alerts,
    critical_alerts,prepared_by,prepare_idempotency_key
  ) values (
    p_business_id,p_business_date,p_timezone,'open',v_start,v_end,v_snapshot,
    round(p_declared_cash,2),v_expected,v_difference,nullif(btrim(coalesce(p_difference_note,'')),''),
    (select count(*) from public.operational_alerts a where a.business_id=p_business_id and a.status<>'resolved'),
    (select count(*) from public.operational_alerts a where a.business_id=p_business_id and a.status<>'resolved' and a.severity='CRITICAL'),
    auth.uid(),p_idempotency_key
  )
  on conflict (business_id,business_date) do update set
    timezone=excluded.timezone,window_start=excluded.window_start,window_end=excluded.window_end,
    snapshot=excluded.snapshot,declared_cash=excluded.declared_cash,expected_cash=excluded.expected_cash,
    cash_difference=excluded.cash_difference,difference_note=excluded.difference_note,
    open_alerts=excluded.open_alerts,critical_alerts=excluded.critical_alerts,
    refreshed_at=clock_timestamp(),revision=daily_reconciliations.revision+1,
    prepare_idempotency_key=excluded.prepare_idempotency_key
  where daily_reconciliations.status='open'
  returning * into v_run;
  if not found then
    select * into v_run from public.daily_reconciliations where business_id=p_business_id and business_date=p_business_date;
    return jsonb_build_object('ok',true,'reconciliation',to_jsonb(v_run),'idempotent_replay',true);
  end if;
  insert into public.daily_reconciliation_events(business_id,reconciliation_id,event_type,actor_id,revision)
  values (p_business_id,v_run.id,case when v_run.revision=1 then 'prepared' else 'refreshed' end,auth.uid(),v_run.revision);
  return jsonb_build_object('ok',true,'reconciliation',to_jsonb(v_run),'idempotent_replay',false);
end;
$prepare_daily_reconciliation$;

create or replace function public.close_daily_reconciliation(
  p_reconciliation_id uuid,
  p_expected_revision bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $close_daily_reconciliation$
declare
  v_run public.daily_reconciliations%rowtype;
  v_snapshot jsonb;
  v_expected numeric(14,2);
  v_difference numeric(14,2);
  v_hash text;
begin
  select * into v_run from public.daily_reconciliations where id=p_reconciliation_id for update;
  if not found then raise exception 'conciliacion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_run.business_id,array['owner','admin']) then
    raise exception 'cierre requiere owner o admin' using errcode='42501';
  end if;
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode='22023';
  end if;
  if v_run.status='closed' then
    return jsonb_build_object('ok',true,'reconciliation',to_jsonb(v_run),'idempotent_replay',true);
  end if;
  if v_run.revision<>p_expected_revision then
    raise exception 'conflicto de revision' using errcode='40001';
  end if;
  perform public.refresh_operational_alerts(v_run.business_id);
  v_snapshot := public.daily_reconciliation_snapshot_internal(v_run.business_id,v_run.window_start,v_run.window_end);
  v_expected := coalesce((v_snapshot #>> '{cash,expected}')::numeric,0);
  v_difference := round(v_run.declared_cash-v_expected,2);
  if v_difference<>0 and char_length(btrim(coalesce(v_run.difference_note,''))) not between 5 and 500 then
    raise exception 'la diferencia de caja requiere una explicacion' using errcode='22023';
  end if;
  v_hash := encode(digest(
    v_snapshot::text || '|' || v_run.declared_cash::text || '|' || v_expected::text || '|' || v_difference::text || '|' || coalesce(v_run.difference_note,''),
    'sha256'
  ),'hex');
  update public.daily_reconciliations set
    status='closed',snapshot=v_snapshot,expected_cash=v_expected,cash_difference=v_difference,
    open_alerts=(select count(*) from public.operational_alerts a where a.business_id=v_run.business_id and a.status<>'resolved'),
    critical_alerts=(select count(*) from public.operational_alerts a where a.business_id=v_run.business_id and a.status<>'resolved' and a.severity='CRITICAL'),
    snapshot_sha256=v_hash,closed_by=auth.uid(),closed_at=clock_timestamp(),close_idempotency_key=p_idempotency_key,
    refreshed_at=clock_timestamp()
  where id=v_run.id returning * into v_run;
  insert into public.daily_reconciliation_events(business_id,reconciliation_id,event_type,actor_id,revision,snapshot_sha256)
  values(v_run.business_id,v_run.id,'closed',auth.uid(),v_run.revision,v_run.snapshot_sha256);
  return jsonb_build_object('ok',true,'reconciliation',to_jsonb(v_run),'idempotent_replay',false);
end;
$close_daily_reconciliation$;

create or replace function public.get_production_operation_center(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $get_production_operation_center$
declare
  v_result jsonb;
begin
  if not public.has_business_role(p_business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;
  perform public.refresh_operational_alerts(p_business_id);
  select jsonb_build_object(
    'generated_at',clock_timestamp(),
    'business_id',p_business_id,
    'metrics',jsonb_build_object(
      'new_orders',(select count(*) from public.orders o where o.business_id=p_business_id and o.status in ('submitted','received') and o.created_at>=clock_timestamp()-interval '24 hours'),
      'delayed_orders',(select count(*) from public.orders o where o.business_id=p_business_id and o.status not in ('delivered','canceled','cancelled','rejected') and coalesce(o.acknowledged_at,o.created_at)+make_interval(mins=>coalesce(o.preparation_estimate_minutes,30))<clock_timestamp()),
      'pending_payments',(select count(*) from public.payment_intents pi where pi.business_id=p_business_id and pi.internal_status in ('created','preference_creating','preference_created','redirected','pending','in_process')),
      'payments_in_review',(select count(*) from public.payment_intents pi where pi.business_id=p_business_id and pi.internal_status in ('ambiguous','security_review_required','approved_order_pending')),
      'orders_without_stock',(select count(*) from public.checkout_sessions cs where cs.business_id=p_business_id and cs.status='manual_review_required' and coalesce(cs.manual_review_reason,'') like '%reservation%'),
      'packing_incomplete',(select count(*) from public.order_packing_sessions ps where ps.business_id=p_business_id and ps.status in ('not_started','in_progress','complete','exception_required')),
      'active_deliveries',(select count(*) from public.orders o where o.business_id=p_business_id and o.status in ('assigned','picked_up','on_the_way','arrived')),
      'riders_without_signal',(select count(*) from public.operational_alerts a where a.business_id=p_business_id and a.alert_code='RIDER_SIGNAL_STALE' and a.status<>'resolved'),
      'fiscal_documents_pending',(select count(*) from public.fiscal_documents fd where fd.business_id=p_business_id and (fd.state in ('draft','queued','claiming','authenticating','authorizing','ambiguous','retry_wait','failed') or (fd.state='authorized' and fd.artifact_state<>'artifact_ready'))),
      'failed_prints',(select count(*) from public.fiscal_print_jobs pj where pj.business_id=p_business_id and pj.status in ('failed','unknown')),
      'pending_credit_notes',(select count(*) from public.fiscal_documents fd where fd.business_id=p_business_id and fd.document_intent='credit_note' and (fd.state<>'authorized' or fd.artifact_state<>'artifact_ready')),
      'blocked_outboxes',(
        (select count(*) from public.payment_outbox po join public.payment_intents pi on pi.id=po.payment_intent_id where pi.business_id=p_business_id and po.status in ('failed','dead_letter'))
        +(select count(*) from public.fiscal_outbox fo join public.fiscal_documents fd on fd.id=fo.fiscal_document_id where fd.business_id=p_business_id and fo.state='dead_letter')
        +(select count(*) from public.fiscal_artifact_outbox fao join public.fiscal_documents fd on fd.id=fao.fiscal_document_id where fd.business_id=p_business_id and fao.state='dead_letter')
      ),
      'reconciliations_required',(
        (select count(*) from public.payment_intents pi where pi.business_id=p_business_id and pi.internal_status in ('ambiguous','security_review_required','approved_order_pending'))
        +(select count(*) from public.payment_refunds pr join public.payment_intents pi on pi.id=pr.payment_intent_id where pi.business_id=p_business_id and pr.status='ambiguous')
        +(select count(*) from public.payment_cancellations pc join public.payment_intents pi on pi.id=pc.payment_intent_id where pi.business_id=p_business_id and pc.status='ambiguous')
        +(select count(*) from public.fiscal_documents fd where fd.business_id=p_business_id and fd.state='ambiguous')
      )
    ),
    'alerts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'severity',a.severity,'code',a.alert_code,'status',a.status,
      'summary',a.summary,'required_action',a.required_action,
      'subject_type',a.subject_type,'subject_id',a.subject_id,
      'correlation_id',a.correlation_id,'last_seen_at',a.last_seen_at,
      'occurrence_count',a.occurrence_count
    ) order by case a.severity when 'CRITICAL' then 1 when 'ACTION_REQUIRED' then 2 when 'WARNING' then 3 else 4 end,a.last_seen_at desc)
      from public.operational_alerts a where a.business_id=p_business_id and a.status<>'resolved'),'[]'::jsonb),
    'recent_closures',coalesce((select jsonb_agg(to_jsonb(r) order by r.business_date desc)
      from (select id,business_date,status,revision,declared_cash,expected_cash,cash_difference,difference_note,open_alerts,critical_alerts,snapshot_sha256,prepared_at,closed_at
        from public.daily_reconciliations where business_id=p_business_id order by business_date desc limit 14) r),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$get_production_operation_center$;

-- ===== RLS and least privilege =====

alter table public.service_health_signals enable row level security;
alter table public.operational_alerts enable row level security;
alter table public.operational_alert_events enable row level security;
alter table public.daily_reconciliations enable row level security;
alter table public.daily_reconciliation_events enable row level security;

revoke all privileges on table public.service_health_signals from public,anon,authenticated;
revoke all privileges on table public.operational_alerts from public,anon,authenticated;
revoke all privileges on table public.operational_alert_events from public,anon,authenticated;
revoke all privileges on table public.daily_reconciliations from public,anon,authenticated;
revoke all privileges on table public.daily_reconciliation_events from public,anon,authenticated;

grant select on table public.operational_alerts,public.operational_alert_events,
  public.daily_reconciliations,public.daily_reconciliation_events to authenticated;

drop policy if exists "business reads operational alerts" on public.operational_alerts;
create policy "business reads operational alerts" on public.operational_alerts
for select to authenticated using(public.is_business_member(business_id));
drop policy if exists "business reads operational alert events" on public.operational_alert_events;
create policy "business reads operational alert events" on public.operational_alert_events
for select to authenticated using(public.is_business_member(business_id));
drop policy if exists "business reads daily reconciliations" on public.daily_reconciliations;
create policy "business reads daily reconciliations" on public.daily_reconciliations
for select to authenticated using(public.is_business_member(business_id));
drop policy if exists "business reads daily reconciliation events" on public.daily_reconciliation_events;
create policy "business reads daily reconciliation events" on public.daily_reconciliation_events
for select to authenticated using(public.is_business_member(business_id));

revoke execute on function public.assign_operation_correlation(),
  public.propagate_paid_order_correlation(),
  public.prevent_closed_daily_reconciliation_mutation() from public,anon,authenticated;
revoke execute on function public.record_service_health_signal(uuid,text,text,text,text,uuid,timestamptz,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.record_service_health_signal(uuid,text,text,text,text,uuid,timestamptz,timestamptz,jsonb) to service_role;

revoke execute on function public.refresh_operational_alerts(uuid),
  public.transition_operational_alert(uuid,text,text),
  public.prepare_daily_reconciliation(uuid,date,text,numeric,text,text),
  public.close_daily_reconciliation(uuid,bigint,text),
  public.get_production_operation_center(uuid) from public,anon,authenticated;
grant execute on function public.refresh_operational_alerts(uuid),
  public.transition_operational_alert(uuid,text,text),
  public.prepare_daily_reconciliation(uuid,date,text,numeric,text,text),
  public.close_daily_reconciliation(uuid,bigint,text),
  public.get_production_operation_center(uuid) to authenticated;

comment on table public.daily_reconciliations is 'Immutable-after-close daily operational reconciliation; snapshots contain aggregate business data only.';
comment on table public.operational_alerts is 'Durable sanitized operational alerts with concrete remediation actions.';
comment on column public.service_health_signals.details is 'Sanitized bounded metadata only; secrets and customer data are forbidden.';
