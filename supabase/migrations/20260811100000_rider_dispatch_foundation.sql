-- TABA2 automated Rider dispatch: durable foundation.
--
-- This migration is intentionally orthogonal to orders.status. The commercial
-- order remains `ready` until an offer is accepted. Runtime dispatch decisions
-- live in the tables below and never expose pre-claim customer PII or GPS.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

-- Explicit, local-only QA escape hatch. Production rows never need an entry.
create table if not exists private.rider_dispatch_qa_allowlist (
  order_id uuid primary key references public.orders(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 8 and 300),
  added_by uuid references auth.users(id) on delete restrict,
  added_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  constraint rider_dispatch_qa_allowlist_window check (
    expires_at > added_at and expires_at <= added_at + interval '7 days'
  )
);

revoke all on table private.rider_dispatch_qa_allowlist
from public, anon, authenticated;

create table if not exists public.rider_dispatch_profiles (
  business_id uuid not null references public.businesses(id) on delete cascade,
  rider_user_id uuid not null references auth.users(id) on delete cascade,
  is_blocked boolean not null default false,
  block_reason text,
  zone_code text not null default '*',
  max_concurrent_orders integer not null default 1,
  last_assigned_at timestamptz,
  configured_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (business_id, rider_user_id),
  constraint rider_dispatch_profiles_zone_check check (
    zone_code = '*' or zone_code ~ '^[a-z0-9][a-z0-9_-]{0,39}$'
  ),
  -- Pilot UI represents one active delivery. Keep the future-facing column,
  -- but fail closed until the client can represent more than one order.
  constraint rider_dispatch_profiles_pilot_capacity check (max_concurrent_orders = 1),
  constraint rider_dispatch_profiles_block_check check (
    (is_blocked and char_length(btrim(coalesce(block_reason, ''))) between 5 and 300)
    or (not is_blocked and block_reason is null)
  )
);

-- Deployment kill switch. A migration never starts automatic assignment.
-- `qa_fixture_only` permits local certification without enabling production
-- orders. Turning the switch off preserves jobs and audit rows.
create table if not exists public.business_dispatch_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  auto_dispatch_enabled boolean not null default false,
  qa_fixture_only boolean not null default true,
  change_reason text,
  changed_by uuid references auth.users(id) on delete restrict,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint business_dispatch_settings_reason_check check (
    change_reason is null or char_length(btrim(change_reason)) between 8 and 500
  )
);

insert into public.business_dispatch_settings(business_id)
select b.id from public.businesses b
on conflict (business_id) do nothing;

create table if not exists public.rider_shifts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  rider_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('scheduled','active','paused','ended')),
  availability text not null default 'unavailable'
    check (availability in ('available','unavailable','at_capacity')),
  starts_at timestamptz,
  ends_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  state_changed_at timestamptz not null default clock_timestamp(),
  worked_seconds bigint not null default 0 check (worked_seconds >= 0),
  paused_seconds bigint not null default 0 check (paused_seconds >= 0),
  current_active_orders integer not null default 0 check (current_active_orders >= 0),
  max_concurrent_orders integer not null default 1 check (max_concurrent_orders = 1),
  zone_code text not null default '*',
  scheduled_by uuid references auth.users(id) on delete restrict,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint rider_shifts_zone_check check (
    zone_code = '*' or zone_code ~ '^[a-z0-9][a-z0-9_-]{0,39}$'
  ),
  constraint rider_shifts_capacity_check check (
    current_active_orders <= max_concurrent_orders
  ),
  constraint rider_shifts_schedule_check check (
    starts_at is not null and ends_at is not null and ends_at > starts_at
    and (
      (status = 'scheduled' and started_at is null and ended_at is null)
      or (status in ('active','paused') and started_at is not null and ended_at is null)
      or (status = 'ended' and ended_at is not null)
    )
  ),
  constraint rider_shifts_non_active_unavailable check (
    status = 'active' or availability = 'unavailable'
  )
);

create unique index if not exists rider_shifts_one_open_per_rider
  on public.rider_shifts(business_id, rider_user_id)
  where status in ('active','paused');

create index if not exists rider_shifts_business_state_idx
  on public.rider_shifts(business_id, status, starts_at, rider_user_id);

-- Exact pre-claim location and heartbeat are outside PostgREST. The public
-- aggregate contracts expose age/quality classifications, never coordinates.
create table if not exists private.rider_dispatch_presence (
  shift_id uuid primary key references public.rider_shifts(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  rider_user_id uuid not null references auth.users(id) on delete cascade,
  heartbeat_at timestamptz not null,
  captured_at timestamptz not null,
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  accuracy_m numeric(10, 2) not null check (accuracy_m between 0 and 10000),
  is_mock boolean not null default false,
  receipt_sequence bigint generated always as identity,
  client_request_key text not null,
  request_fingerprint bytea not null,
  updated_at timestamptz not null default clock_timestamp(),
  unique (business_id, rider_user_id),
  unique (receipt_sequence)
);

revoke all on table private.rider_dispatch_presence
from public, anon, authenticated;

-- Policies are insert-only versions. Version 1 is deliberately financially
-- neutral: no real reward amount is inferred by this repository.
create table if not exists public.rider_dispatch_policies (
  business_id uuid not null references public.businesses(id) on delete cascade,
  version integer not null check (version > 0),
  ranking_version text not null default 'dispatch-score-v1'
    check (ranking_version ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  offer_ttl_seconds integer not null default 25 check (offer_ttl_seconds between 10 and 60),
  heartbeat_ttl_seconds integer not null default 90 check (heartbeat_ttl_seconds between 15 and 300),
  gps_ttl_seconds integer not null default 120 check (gps_ttl_seconds between 30 and 600),
  work_now_horizon_seconds integer not null default 43200
    check (work_now_horizon_seconds between 3600 and 57600),
  max_gps_accuracy_m numeric(10, 2) not null default 150
    check (max_gps_accuracy_m between 10 and 500),
  no_rider_retry_seconds integer not null default 60 check (no_rider_retry_seconds between 15 and 900),
  job_stalled_seconds integer not null default 120 check (job_stalled_seconds between 60 and 3600),
  reward_currency text not null default 'ARS' check (reward_currency ~ '^[A-Z]{3}$'),
  reward_base numeric(12, 2) not null default 0 check (reward_base >= 0),
  reward_per_km numeric(12, 2) not null default 0 check (reward_per_km >= 0),
  reward_shift numeric(12, 2) not null default 0 check (reward_shift >= 0),
  reward_demand numeric(12, 2) not null default 0 check (reward_demand >= 0),
  reward_goal numeric(12, 2) not null default 0 check (reward_goal >= 0),
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (business_id, version)
);

insert into public.rider_dispatch_policies(
  business_id, version, reward_currency
)
select b.id, 1, coalesce(nullif(upper(b.currency_code), ''), 'ARS')
from public.businesses b
on conflict (business_id, version) do nothing;

create table if not exists public.dispatch_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  state text not null default 'queued' check (state in (
    'queued','ranking','offering','claimed','completed','no_rider_available','cancelled'
  )),
  revision bigint not null default 1 check (revision > 0),
  round_no integer not null default 1 check (round_no > 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  policy_version integer not null,
  dispatch_zone text not null default '*',
  assigned_rider_user_id uuid references auth.users(id) on delete restrict,
  claimed_shift_id uuid references public.rider_shifts(id) on delete restrict,
  queued_at timestamptz not null default clock_timestamp(),
  ranking_started_at timestamptz,
  first_offer_at timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  next_attempt_at timestamptz not null default clock_timestamp(),
  last_failure_code text,
  failure_evidence jsonb not null default '{}'::jsonb,
  worker_lease_owner text,
  worker_lease_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (business_id, policy_version)
    references public.rider_dispatch_policies(business_id, version) on delete restrict,
  constraint dispatch_jobs_zone_check check (
    dispatch_zone = '*' or dispatch_zone ~ '^[a-z0-9][a-z0-9_-]{0,39}$'
  ),
  constraint dispatch_jobs_failure_code_check check (
    last_failure_code is null or last_failure_code ~ '^[A-Z0-9_]{3,80}$'
  ),
  constraint dispatch_jobs_evidence_size check (octet_length(failure_evidence::text) <= 4096),
  constraint dispatch_jobs_assignment_pair check (
    (assigned_rider_user_id is null and claimed_shift_id is null)
    or (assigned_rider_user_id is not null and claimed_shift_id is not null)
  )
);

create index if not exists dispatch_jobs_worker_idx
  on public.dispatch_jobs(state, next_attempt_at, queued_at)
  where state in ('queued','ranking','offering','no_rider_available');

create index if not exists dispatch_jobs_business_state_idx
  on public.dispatch_jobs(business_id, state, updated_at desc);

create table if not exists public.dispatch_offers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.dispatch_jobs(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  rider_user_id uuid not null references auth.users(id) on delete restrict,
  shift_id uuid not null references public.rider_shifts(id) on delete restrict,
  round_no integer not null check (round_no > 0),
  rank integer not null check (rank > 0),
  score integer not null,
  source text not null default 'automatic' check (source in ('automatic','manual_override')),
  status text not null default 'offered' check (status in (
    'offered','accepted','rejected','expired','revoked','lost'
  )),
  version bigint not null default 1 check (version > 0),
  expected_order_revision bigint not null check (expected_order_revision > 0),
  job_revision_at_offer bigint not null check (job_revision_at_offer > 0),
  offered_at timestamptz not null default clock_timestamp(),
  lease_expires_at timestamptz not null,
  responded_at timestamptz,
  response_reason text,
  estimated_reward numeric(12, 2) not null default 0 check (estimated_reward >= 0),
  reward_currency text not null check (reward_currency ~ '^[A-Z]{3}$'),
  reward_snapshot jsonb not null default '{}'::jsonb,
  safe_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (job_id, round_no, rider_user_id),
  constraint dispatch_offers_lease_window check (lease_expires_at > offered_at),
  constraint dispatch_offers_response_check check (
    (status = 'offered' and responded_at is null)
    or (status <> 'offered' and responded_at is not null)
  ),
  constraint dispatch_offers_reward_snapshot_size check (octet_length(reward_snapshot::text) <= 4096),
  constraint dispatch_offers_safe_payload_size check (octet_length(safe_payload::text) <= 4096)
);

create unique index if not exists dispatch_offers_one_live_per_job
  on public.dispatch_offers(job_id) where status = 'offered';

create unique index if not exists dispatch_offers_one_live_per_rider
  on public.dispatch_offers(rider_user_id) where status = 'offered';

create unique index if not exists dispatch_offers_one_accepted_per_job
  on public.dispatch_offers(job_id) where status = 'accepted';

create index if not exists dispatch_offers_expiry_idx
  on public.dispatch_offers(lease_expires_at, job_id) where status = 'offered';

create table if not exists public.dispatch_evaluations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.dispatch_jobs(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  rider_user_id uuid not null references auth.users(id) on delete restrict,
  shift_id uuid references public.rider_shifts(id) on delete restrict,
  round_no integer not null check (round_no > 0),
  evaluated_at timestamptz not null default clock_timestamp(),
  eligible boolean not null,
  exclusion_codes text[] not null default '{}'::text[],
  distance_to_pickup_m integer,
  active_orders integer not null default 0 check (active_orders >= 0),
  max_concurrent_orders integer not null default 1 check (max_concurrent_orders > 0),
  idle_seconds integer not null default 0 check (idle_seconds >= 0),
  assignments_last_4h integer not null default 0 check (assignments_last_4h >= 0),
  heartbeat_age_seconds integer,
  gps_age_seconds integer,
  policy_version integer not null,
  ranking_version text not null,
  score integer,
  rank integer,
  factors jsonb not null default '{}'::jsonb,
  unique (job_id, round_no, rider_user_id),
  constraint dispatch_evaluations_distance_check check (
    distance_to_pickup_m is null or distance_to_pickup_m >= 0
  ),
  constraint dispatch_evaluations_age_check check (
    (heartbeat_age_seconds is null or heartbeat_age_seconds >= 0)
    and (gps_age_seconds is null or gps_age_seconds >= 0)
  ),
  constraint dispatch_evaluations_rank_check check (
    (eligible and score is not null) or (not eligible and rank is null)
  ),
  constraint dispatch_evaluations_factors_size check (octet_length(factors::text) <= 4096)
);

create index if not exists dispatch_evaluations_rank_idx
  on public.dispatch_evaluations(job_id, round_no, eligible, rank, rider_user_id);

create table if not exists public.dispatch_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  job_id uuid references public.dispatch_jobs(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  offer_id uuid references public.dispatch_offers(id) on delete cascade,
  shift_id uuid references public.rider_shifts(id) on delete restrict,
  rider_user_id uuid references auth.users(id) on delete restrict,
  event_type text not null check (event_type ~ '^[a-z0-9._-]{3,100}$'),
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_role text not null check (actor_role in ('rider','business','system','worker')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint dispatch_events_detail_size check (octet_length(detail::text) <= 4096)
);

create index if not exists dispatch_events_job_timeline_idx
  on public.dispatch_events(job_id, id desc);

create index if not exists dispatch_events_business_timeline_idx
  on public.dispatch_events(business_id, id desc);

create table if not exists public.dispatch_command_receipts (
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  operation text not null check (operation ~ '^[a-z][a-z0-9_]{2,79}$'),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  request_fingerprint bytea not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_user_id, operation, idempotency_key),
  constraint dispatch_command_receipts_result_size check (octet_length(result::text) <= 32768)
);

create table if not exists public.rider_reward_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  job_id uuid not null references public.dispatch_jobs(id) on delete restrict,
  offer_id uuid not null references public.dispatch_offers(id) on delete restrict,
  shift_id uuid not null references public.rider_shifts(id) on delete restrict,
  rider_user_id uuid not null references auth.users(id) on delete restrict,
  entry_type text not null check (entry_type in ('estimated','earned','bonus','adjustment')),
  entry_key text not null check (entry_key ~ '^[A-Za-z0-9:_-]{8,180}$'),
  amount numeric(12, 2) not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  policy_version integer not null,
  snapshot jsonb not null,
  reason text,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (business_id, entry_key),
  foreign key (business_id, policy_version)
    references public.rider_dispatch_policies(business_id, version) on delete restrict,
  constraint rider_reward_ledger_amount_check check (
    entry_type = 'adjustment' or amount >= 0
  ),
  constraint rider_reward_ledger_reason_check check (
    entry_type <> 'adjustment'
    or char_length(btrim(coalesce(reason, ''))) between 8 and 500
  ),
  constraint rider_reward_ledger_snapshot_size check (octet_length(snapshot::text) <= 4096)
);

create unique index if not exists rider_reward_ledger_one_delivery_entry
  on public.rider_reward_ledger(order_id, rider_user_id, entry_type)
  where entry_type in ('estimated','earned');

create index if not exists rider_reward_ledger_rider_time_idx
  on public.rider_reward_ledger(business_id, rider_user_id, created_at desc);

create table if not exists public.rider_dispatch_worker_state (
  singleton boolean primary key default true check (singleton),
  last_started_at timestamptz,
  last_success_at timestamptz,
  last_finished_at timestamptz,
  last_error_code text,
  processed_jobs integer not null default 0 check (processed_jobs >= 0),
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.rider_dispatch_worker_state(singleton) values (true)
on conflict (singleton) do nothing;

create table if not exists public.rider_dispatch_worker_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('manual','cron','recovery','test')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  processed_jobs integer not null default 0 check (processed_jobs >= 0),
  error_code text,
  detail jsonb not null default '{}'::jsonb,
  constraint rider_dispatch_worker_runs_detail_size check (octet_length(detail::text) <= 4096)
);

-- Monotonic aggregate revisions are server-owned CAS tokens.
create or replace function public.bump_rider_dispatch_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $bump$
begin
  new.version := old.version;
  if new is distinct from old then
    new.version := old.version + 1;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$bump$;

drop trigger if exists rider_shifts_bump_revision on public.rider_shifts;
create trigger rider_shifts_bump_revision
before update on public.rider_shifts
for each row execute function public.bump_rider_dispatch_revision();

drop trigger if exists business_dispatch_settings_bump_revision on public.business_dispatch_settings;
create trigger business_dispatch_settings_bump_revision
before update on public.business_dispatch_settings
for each row execute function public.bump_rider_dispatch_revision();

drop trigger if exists dispatch_jobs_bump_revision on public.dispatch_jobs;
create trigger dispatch_jobs_bump_revision
before update on public.dispatch_jobs
for each row execute function public.bump_rider_dispatch_revision();

drop trigger if exists dispatch_offers_bump_revision on public.dispatch_offers;
create trigger dispatch_offers_bump_revision
before update on public.dispatch_offers
for each row execute function public.bump_rider_dispatch_revision();

create or replace function public.reject_rider_dispatch_immutable_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $immutable$
begin
  raise exception 'rider dispatch audit rows are append-only' using errcode = '55000';
end;
$immutable$;

drop trigger if exists rider_dispatch_policies_immutable on public.rider_dispatch_policies;
create trigger rider_dispatch_policies_immutable
before update or delete on public.rider_dispatch_policies
for each row execute function public.reject_rider_dispatch_immutable_mutation();

drop trigger if exists dispatch_evaluations_immutable on public.dispatch_evaluations;
create trigger dispatch_evaluations_immutable
before update or delete on public.dispatch_evaluations
for each row execute function public.reject_rider_dispatch_immutable_mutation();

drop trigger if exists dispatch_events_immutable on public.dispatch_events;
create trigger dispatch_events_immutable
before update or delete on public.dispatch_events
for each row execute function public.reject_rider_dispatch_immutable_mutation();

drop trigger if exists dispatch_command_receipts_immutable on public.dispatch_command_receipts;
create trigger dispatch_command_receipts_immutable
before update or delete on public.dispatch_command_receipts
for each row execute function public.reject_rider_dispatch_immutable_mutation();

drop trigger if exists rider_reward_ledger_immutable on public.rider_reward_ledger;
create trigger rider_reward_ledger_immutable
before update or delete on public.rider_reward_ledger
for each row execute function public.reject_rider_dispatch_immutable_mutation();

-- New tables are RPC-only. Exact presence and QA fixture authority remain in
-- private; browser roles receive no direct write path to dispatch truth.
alter table public.rider_dispatch_profiles enable row level security;
alter table public.business_dispatch_settings enable row level security;
alter table public.rider_shifts enable row level security;
alter table public.rider_dispatch_policies enable row level security;
alter table public.dispatch_jobs enable row level security;
alter table public.dispatch_offers enable row level security;
alter table public.dispatch_evaluations enable row level security;
alter table public.dispatch_events enable row level security;
alter table public.dispatch_command_receipts enable row level security;
alter table public.rider_reward_ledger enable row level security;
alter table public.rider_dispatch_worker_state enable row level security;
alter table public.rider_dispatch_worker_runs enable row level security;

revoke all privileges on table public.rider_dispatch_profiles from public, anon, authenticated;
revoke all privileges on table public.business_dispatch_settings from public, anon, authenticated;
revoke all privileges on table public.rider_shifts from public, anon, authenticated;
revoke all privileges on table public.rider_dispatch_policies from public, anon, authenticated;
revoke all privileges on table public.dispatch_jobs from public, anon, authenticated;
revoke all privileges on table public.dispatch_offers from public, anon, authenticated;
revoke all privileges on table public.dispatch_evaluations from public, anon, authenticated;
revoke all privileges on table public.dispatch_events from public, anon, authenticated;
revoke all privileges on table public.dispatch_command_receipts from public, anon, authenticated;
revoke all privileges on table public.rider_reward_ledger from public, anon, authenticated;
revoke all privileges on table public.rider_dispatch_worker_state from public, anon, authenticated;
revoke all privileges on table public.rider_dispatch_worker_runs from public, anon, authenticated;

revoke all on function public.bump_rider_dispatch_revision() from public, anon, authenticated;
revoke all on function public.reject_rider_dispatch_immutable_mutation() from public, anon, authenticated;

comment on table public.dispatch_jobs is
  'Exactly-one durable dispatch aggregate per order. It never replaces orders.status.';
comment on table public.dispatch_offers is
  'Server-time offer leases. safe_payload is a pre-claim PII-free projection.';
comment on table public.dispatch_evaluations is
  'Immutable deterministic ranking/exclusion audit for every Rider in a dispatch round.';
comment on table private.rider_dispatch_presence is
  'Private pre-claim heartbeat/GPS. Coordinates are never exposed by public aggregate RPCs.';
comment on table public.rider_reward_ledger is
  'Immutable Rider reward ledger. Default policy values are zero until explicitly configured.';
