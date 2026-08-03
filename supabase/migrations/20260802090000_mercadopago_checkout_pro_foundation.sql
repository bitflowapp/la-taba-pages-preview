-- TABA2 Mercado Pago Checkout Pro: authoritative checkout sessions and stock
-- reservations. This migration intentionally does not enable a merchant: each
-- business starts with payments disabled and Edge Function secrets are never
-- stored in PostgreSQL.

create extension if not exists pgcrypto;

-- Price state is separate from product publication. Existing verified catalog
-- rows predate this explicit state and retain their established confirmed
-- commercial price; future pending rows remain visible but cannot be reserved.
alter table public.products
  add column if not exists price_status text;

update public.products
   set price_status = 'confirmed'
 where price_status is null;

alter table public.products
  alter column price_status set default 'confirmed';

alter table public.products
  alter column price_status set not null;

alter table public.products
  drop constraint if exists products_price_status_check;

alter table public.products
  add constraint products_price_status_check
  check (price_status in ('confirmed', 'pending'));

comment on column public.products.price_status is
  'Commercial price state. pending products may be published but are never reservable or payable.';

-- Non-secret, per-business payment policy. Collector and application IDs are
-- identifiers used to verify provider responses; credentials remain only in
-- Supabase Edge Function secrets.
create table if not exists public.business_payment_settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null default 'mercadopago',
  enabled boolean not null default false,
  environment text not null default 'test',
  checkout_mode text not null default 'checkout_pro',
  currency text not null default 'ARS',
  installments_limit integer,
  allow_offline_payment_methods boolean not null default false,
  preference_expiration_minutes integer not null default 15,
  reserve_stock boolean not null default true,
  refund_policy text not null default 'manual_review',
  production_review_status text not null default 'not_requested',
  collector_id text,
  application_id text,
  configured_at timestamptz,
  verified_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint business_payment_settings_provider_check
    check (provider = 'mercadopago'),
  constraint business_payment_settings_environment_check
    check (environment in ('test', 'production')),
  constraint business_payment_settings_checkout_mode_check
    check (checkout_mode = 'checkout_pro'),
  constraint business_payment_settings_currency_check
    check (currency = 'ARS'),
  constraint business_payment_settings_installments_check
    check (installments_limit is null or installments_limit between 1 and 24),
  constraint business_payment_settings_expiration_check
    check (preference_expiration_minutes between 5 and 60),
  constraint business_payment_settings_refund_policy_check
    check (refund_policy in ('manual_review', 'owner_approval')),
  constraint business_payment_settings_production_review_check
    check (production_review_status in ('not_requested', 'pending', 'approved', 'rejected')),
  constraint business_payment_settings_enabled_configuration_check
    check (
      not enabled
      or (
        reserve_stock
        and nullif(btrim(collector_id), '') is not null
        and nullif(btrim(application_id), '') is not null
        and (environment <> 'production' or production_review_status = 'approved')
      )
    ),
  unique (business_id, provider)
);

create index if not exists business_payment_settings_enabled_idx
  on public.business_payment_settings (business_id, enabled)
  where enabled;

create table if not exists public.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  customer_id uuid not null references auth.users(id) on delete restrict,
  client_request_id text not null,
  normalized_intent_hash text not null,
  fulfillment_type text not null,
  address_snapshot jsonb not null default '{}'::jsonb,
  contact_snapshot jsonb not null default '{}'::jsonb,
  currency text not null default 'ARS',
  subtotal numeric(12, 2) not null,
  discount_total numeric(12, 2) not null default 0,
  delivery_fee numeric(12, 2) not null default 0,
  total numeric(12, 2) not null,
  status text not null default 'created',
  contains_alcohol boolean not null default false,
  age_confirmed_at timestamptz,
  age_confirmation_policy integer,
  expires_at timestamptz not null,
  completed_order_id uuid references public.orders(id) on delete restrict,
  manual_review_reason text,
  revision bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint checkout_sessions_client_request_format
    check (client_request_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  constraint checkout_sessions_intent_hash_format
    check (normalized_intent_hash ~ '^[a-f0-9]{64}$'),
  constraint checkout_sessions_fulfillment_check
    check (fulfillment_type in ('delivery', 'pickup')),
  constraint checkout_sessions_currency_check
    check (currency = 'ARS'),
  constraint checkout_sessions_money_check
    check (
      subtotal >= 0
      and discount_total >= 0
      and delivery_fee >= 0
      and total = subtotal - discount_total + delivery_fee
      and total >= 0
      -- validating is an internal, unobservable transaction state while the
      -- authoritative product locks calculate the final amount. Every session
      -- made payable or terminal must carry a positive authoritative total.
      and (status in ('created', 'validating') or total > 0)
    ),
  constraint checkout_sessions_status_check
    check (status in (
      'created',
      'validating',
      'ready_for_payment',
      'redirected',
      'payment_pending',
      'payment_approved',
      'finalizing_order',
      'completed',
      'expired',
      'cancelled',
      'manual_review_required'
    )),
  constraint checkout_sessions_age_confirmation_check
    check (
      not contains_alcohol
      or (age_confirmed_at is not null and age_confirmation_policy between 18 and 99)
    ),
  constraint checkout_sessions_expiry_check
    check (expires_at > created_at),
  unique (business_id, customer_id, client_request_id)
);

create index if not exists checkout_sessions_customer_created_idx
  on public.checkout_sessions (customer_id, created_at desc);

create index if not exists checkout_sessions_expiry_idx
  on public.checkout_sessions (expires_at)
  where status in ('created', 'validating', 'ready_for_payment', 'redirected', 'payment_pending');

create table if not exists public.checkout_session_items (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_snapshot jsonb not null,
  quantity integer not null,
  unit_price numeric(12, 2) not null,
  subtotal numeric(12, 2) not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint checkout_session_items_quantity_check check (quantity between 1 and 1000),
  constraint checkout_session_items_price_check check (unit_price > 0 and subtotal = unit_price * quantity),
  unique (checkout_session_id, product_id)
);

create index if not exists checkout_session_items_session_idx
  on public.checkout_session_items (checkout_session_id, created_at, id);

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null,
  status text not null default 'active',
  expires_at timestamptz not null,
  released_at timestamptz,
  release_reason text,
  converted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint inventory_reservations_quantity_check check (quantity between 1 and 1000),
  constraint inventory_reservations_status_check check (status in ('active', 'released', 'converted')),
  constraint inventory_reservations_transition_check check (
    (status = 'active' and released_at is null and converted_at is null)
    or (status = 'released' and released_at is not null and converted_at is null)
    or (status = 'converted' and converted_at is not null and released_at is null)
  ),
  constraint inventory_reservations_expiry_check check (expires_at > created_at),
  unique (checkout_session_id, product_id)
);

create index if not exists inventory_reservations_active_expiry_idx
  on public.inventory_reservations (expires_at, checkout_session_id)
  where status = 'active';

create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  provider text not null default 'mercadopago',
  environment text not null,
  idempotency_key uuid not null default gen_random_uuid(),
  external_reference text not null,
  preference_id text,
  provider_payment_id text,
  provider_merchant_order_id text,
  provider_status text,
  provider_status_detail text,
  provider_payment_method text,
  internal_status text not null default 'created',
  currency text not null default 'ARS',
  expected_amount numeric(12, 2) not null,
  paid_amount numeric(12, 2),
  payer_email_hash text,
  live_mode boolean,
  preference_created_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  refunded_amount numeric(12, 2) not null default 0,
  provider_event_at timestamptz,
  raw_response_hash text,
  security_review_reason text,
  revision bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint payment_intents_provider_check check (provider = 'mercadopago'),
  constraint payment_intents_environment_check check (environment in ('test', 'production')),
  constraint payment_intents_currency_check check (currency = 'ARS'),
  constraint payment_intents_amount_check check (
    expected_amount > 0
    and (paid_amount is null or paid_amount >= 0)
    and refunded_amount >= 0
  ),
  constraint payment_intents_status_check check (internal_status in (
    'created',
    'preference_creating',
    'preference_created',
    'redirected',
    'pending',
    'in_process',
    'approved',
    'approved_order_pending',
    'completed',
    'rejected',
    'cancelled',
    'expired',
    'refunded',
    'partially_refunded',
    'charged_back',
    'ambiguous',
    'security_review_required',
    'failed'
  )),
  constraint payment_intents_external_reference_format
    check (external_reference ~ '^taba2:checkout:[0-9a-f-]{36}$'),
  constraint payment_intents_raw_response_hash_format
    check (raw_response_hash is null or raw_response_hash ~ '^[a-f0-9]{64}$'),
  unique (checkout_session_id),
  unique (external_reference),
  unique (idempotency_key)
);

create unique index if not exists payment_intents_provider_payment_key
  on public.payment_intents (provider, environment, provider_payment_id)
  where provider_payment_id is not null;

create index if not exists payment_intents_business_created_idx
  on public.payment_intents (business_id, created_at desc);

create index if not exists payment_intents_reconciliation_idx
  on public.payment_intents (environment, internal_status, updated_at)
  where internal_status in ('pending', 'in_process', 'approved_order_pending', 'ambiguous');

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents(id) on delete cascade,
  attempt_number integer not null,
  attempt_type text not null default 'preference',
  idempotency_key uuid not null default gen_random_uuid(),
  preference_id text,
  init_point text,
  sandbox_init_point text,
  status text not null default 'prepared',
  provider_request_id text,
  request_hash text,
  response_hash text,
  last_error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint payment_attempts_number_check check (attempt_number >= 1),
  constraint payment_attempts_type_check check (attempt_type in ('preference', 'refund', 'cancellation', 'reconciliation')),
  constraint payment_attempts_status_check check (status in ('prepared', 'request_sent', 'created', 'ambiguous', 'failed', 'completed', 'cancelled')),
  constraint payment_attempts_hash_check check (
    (request_hash is null or request_hash ~ '^[a-f0-9]{64}$')
    and (response_hash is null or response_hash ~ '^[a-f0-9]{64}$')
  ),
  unique (payment_intent_id, attempt_number, attempt_type),
  unique (idempotency_key)
);

create unique index if not exists payment_attempts_preference_key
  on public.payment_attempts (preference_id)
  where preference_id is not null;

create index if not exists payment_attempts_intent_idx
  on public.payment_attempts (payment_intent_id, created_at desc);

create table if not exists public.payment_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'mercadopago',
  environment text not null,
  webhook_event_id text not null,
  event_type text not null,
  resource_id text not null,
  signature_valid boolean not null,
  request_id text,
  payload_hash text not null,
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  processing_status text not null default 'received',
  attempt_count integer not null default 0,
  last_error text,
  constraint payment_webhook_receipts_provider_check check (provider = 'mercadopago'),
  constraint payment_webhook_receipts_environment_check check (environment in ('test', 'production')),
  constraint payment_webhook_receipts_hash_check check (payload_hash ~ '^[a-f0-9]{64}$'),
  constraint payment_webhook_receipts_status_check check (processing_status in (
    'received', 'duplicate', 'rejected_signature', 'queued', 'processing', 'completed', 'retry_wait', 'failed', 'dead_letter'
  )),
  constraint payment_webhook_receipts_attempt_count_check check (attempt_count >= 0),
  unique (provider, environment, webhook_event_id, event_type, resource_id)
);

create index if not exists payment_webhook_receipts_processing_idx
  on public.payment_webhook_receipts (processing_status, received_at);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents(id) on delete cascade,
  webhook_receipt_id uuid references public.payment_webhook_receipts(id) on delete set null,
  provider_event_id text,
  event_type text not null,
  provider_status text,
  provider_status_detail text,
  provider_occurred_at timestamptz,
  server_recorded_at timestamptz not null default clock_timestamp(),
  sequence bigint generated always as identity,
  raw_response_hash text,
  details jsonb not null default '{}'::jsonb,
  constraint payment_events_hash_check check (raw_response_hash is null or raw_response_hash ~ '^[a-f0-9]{64}$'),
  unique (payment_intent_id, webhook_receipt_id, event_type)
);

create index if not exists payment_events_intent_sequence_idx
  on public.payment_events (payment_intent_id, sequence desc);

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  provider_refund_id text,
  idempotency_key uuid not null default gen_random_uuid(),
  amount numeric(12, 2),
  status text not null default 'requested',
  requested_by uuid references auth.users(id) on delete set null,
  reason text,
  raw_response_hash text,
  requested_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint payment_refunds_amount_check check (amount is null or amount > 0),
  constraint payment_refunds_status_check check (status in ('requested', 'processing', 'approved', 'rejected', 'ambiguous', 'failed')),
  constraint payment_refunds_hash_check check (raw_response_hash is null or raw_response_hash ~ '^[a-f0-9]{64}$'),
  unique (idempotency_key)
);

create unique index if not exists payment_refunds_provider_key
  on public.payment_refunds (provider_refund_id)
  where provider_refund_id is not null;

create index if not exists payment_refunds_intent_idx
  on public.payment_refunds (payment_intent_id, requested_at desc);

create table if not exists public.payment_cancellations (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents(id) on delete restrict,
  idempotency_key uuid not null default gen_random_uuid(),
  status text not null default 'requested',
  requested_by uuid references auth.users(id) on delete set null,
  raw_response_hash text,
  requested_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint payment_cancellations_status_check check (status in ('requested', 'processing', 'cancelled', 'rejected', 'ambiguous', 'failed')),
  constraint payment_cancellations_hash_check check (raw_response_hash is null or raw_response_hash ~ '^[a-f0-9]{64}$'),
  unique (idempotency_key)
);

create index if not exists payment_cancellations_intent_idx
  on public.payment_cancellations (payment_intent_id, requested_at desc);

create table if not exists public.payment_disputes (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents(id) on delete restrict,
  provider_dispute_id text not null,
  dispute_type text not null,
  status text not null,
  coverage_eligible boolean,
  documentation_required boolean,
  documentation_status text,
  due_at timestamptz,
  raw_response_hash text,
  opened_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint payment_disputes_type_check check (dispute_type in ('chargeback', 'claim')),
  constraint payment_disputes_hash_check check (raw_response_hash is null or raw_response_hash ~ '^[a-f0-9]{64}$'),
  unique (provider_dispute_id, dispute_type)
);

create index if not exists payment_disputes_intent_idx
  on public.payment_disputes (payment_intent_id, created_at desc);

create table if not exists public.payment_outbox (
  id uuid primary key default gen_random_uuid(),
  webhook_receipt_id uuid references public.payment_webhook_receipts(id) on delete cascade,
  payment_intent_id uuid references public.payment_intents(id) on delete cascade,
  refund_id uuid references public.payment_refunds(id) on delete cascade,
  cancellation_id uuid references public.payment_cancellations(id) on delete cascade,
  topic text not null,
  resource_id text,
  status text not null default 'pending',
  owner text,
  lease_expires_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default clock_timestamp(),
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint payment_outbox_topic_check check (topic in ('payment', 'chargeback', 'claim', 'refund_reconcile', 'cancellation_reconcile', 'payment_reconcile')),
  constraint payment_outbox_status_check check (status in ('pending', 'claimed', 'processing', 'completed', 'retry_wait', 'failed', 'dead_letter')),
  constraint payment_outbox_attempts_check check (attempts >= 0),
  constraint payment_outbox_reference_check check (
    webhook_receipt_id is not null
    or payment_intent_id is not null
    or refund_id is not null
    or cancellation_id is not null
  )
);

create unique index if not exists payment_outbox_webhook_receipt_key
  on public.payment_outbox (webhook_receipt_id)
  where webhook_receipt_id is not null;

create index if not exists payment_outbox_claim_idx
  on public.payment_outbox (next_attempt_at, created_at)
  where status in ('pending', 'retry_wait', 'claimed', 'processing');

-- All mutable payment state is written through narrowly granted RPCs or the
-- Supabase service role inside Edge Functions. Browser roles cannot insert or
-- update a payment, receipt, reservation, or operational order directly.
alter table public.business_payment_settings enable row level security;
alter table public.checkout_sessions enable row level security;
alter table public.checkout_session_items enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.payment_intents enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.payment_events enable row level security;
alter table public.payment_webhook_receipts enable row level security;
alter table public.payment_refunds enable row level security;
alter table public.payment_cancellations enable row level security;
alter table public.payment_disputes enable row level security;
alter table public.payment_outbox enable row level security;

revoke all privileges on table public.business_payment_settings from public, anon, authenticated;
revoke all privileges on table public.checkout_sessions from public, anon, authenticated;
revoke all privileges on table public.checkout_session_items from public, anon, authenticated;
revoke all privileges on table public.inventory_reservations from public, anon, authenticated;
revoke all privileges on table public.payment_intents from public, anon, authenticated;
revoke all privileges on table public.payment_attempts from public, anon, authenticated;
revoke all privileges on table public.payment_events from public, anon, authenticated;
revoke all privileges on table public.payment_webhook_receipts from public, anon, authenticated;
revoke all privileges on table public.payment_refunds from public, anon, authenticated;
revoke all privileges on table public.payment_cancellations from public, anon, authenticated;
revoke all privileges on table public.payment_disputes from public, anon, authenticated;
revoke all privileges on table public.payment_outbox from public, anon, authenticated;

create policy "payment settings readable by owners and admins"
on public.business_payment_settings for select to authenticated
using (public.has_business_role(business_id, array['owner', 'admin']));

create policy "checkout sessions readable by their customer or finance roles"
on public.checkout_sessions for select to authenticated
using (
  customer_id = auth.uid()
  or public.has_business_role(business_id, array['owner', 'admin'])
);

create policy "checkout session items follow checkout session access"
on public.checkout_session_items for select to authenticated
using (
  exists (
    select 1
      from public.checkout_sessions s
     where s.id = checkout_session_id
       and (
         s.customer_id = auth.uid()
         or public.has_business_role(s.business_id, array['owner', 'admin'])
       )
  )
);

create policy "payment intents readable by finance roles"
on public.payment_intents for select to authenticated
using (public.has_business_role(business_id, array['owner', 'admin']));

create policy "payment refunds readable by finance roles"
on public.payment_refunds for select to authenticated
using (
  exists (
    select 1 from public.payment_intents pi
     where pi.id = payment_intent_id
       and public.has_business_role(pi.business_id, array['owner', 'admin'])
  )
);

create policy "payment cancellations readable by finance roles"
on public.payment_cancellations for select to authenticated
using (
  exists (
    select 1 from public.payment_intents pi
     where pi.id = payment_intent_id
       and public.has_business_role(pi.business_id, array['owner', 'admin'])
  )
);

create policy "payment disputes readable by finance roles"
on public.payment_disputes for select to authenticated
using (
  exists (
    select 1 from public.payment_intents pi
     where pi.id = payment_intent_id
       and public.has_business_role(pi.business_id, array['owner', 'admin'])
  )
);

-- Monotonic state helpers. Raw provider status is retained separately; only
-- the derived internal state is ranked to prevent late events from regressing
-- approved/completed/refunded records.
create or replace function public.payment_internal_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case lower(btrim(coalesce(p_status, '')))
    when 'created' then 10
    when 'preference_creating' then 20
    -- ambiguous means an outbound preference request timed out before its
    -- authoritative result was reconciled; it may safely advance to a known
    -- preference without permitting any payment-state regression.
    when 'ambiguous' then 25
    when 'preference_created' then 30
    when 'redirected' then 40
    when 'pending' then 50
    when 'in_process' then 60
    when 'rejected' then 70
    when 'cancelled' then 75
    when 'expired' then 80
    when 'failed' then 85
    when 'approved' then 100
    when 'approved_order_pending' then 105
    when 'completed' then 110
    when 'partially_refunded' then 120
    when 'refunded' then 130
    when 'charged_back' then 140
    when 'security_review_required' then 150
    else 0
  end;
$$;

create or replace function public.checkout_session_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case lower(btrim(coalesce(p_status, '')))
    when 'created' then 10
    when 'validating' then 20
    when 'ready_for_payment' then 30
    when 'redirected' then 40
    when 'payment_pending' then 50
    when 'expired' then 60
    when 'cancelled' then 70
    when 'payment_approved' then 100
    when 'finalizing_order' then 110
    when 'completed' then 120
    when 'manual_review_required' then 130
    else 0
  end;
$$;

create or replace function public.set_payment_tables_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.bump_checkout_session_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.revision := old.revision;
  if new is distinct from old then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_payment_intent_status_regression()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.revision := old.revision;
  if new is distinct from old then
    if public.payment_internal_status_rank(new.internal_status)
       < public.payment_internal_status_rank(old.internal_status) then
      raise exception 'payment intent status regression: % -> %', old.internal_status, new.internal_status
        using errcode = '22023';
    end if;
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists business_payment_settings_set_updated_at on public.business_payment_settings;
create trigger business_payment_settings_set_updated_at
before update on public.business_payment_settings
for each row execute function public.set_payment_tables_updated_at();

drop trigger if exists checkout_sessions_set_updated_at on public.checkout_sessions;
create trigger checkout_sessions_set_updated_at
before update on public.checkout_sessions
for each row execute function public.set_payment_tables_updated_at();

drop trigger if exists checkout_sessions_zz_bump_revision on public.checkout_sessions;
create trigger checkout_sessions_zz_bump_revision
before update on public.checkout_sessions
for each row execute function public.bump_checkout_session_revision();

drop trigger if exists inventory_reservations_set_updated_at on public.inventory_reservations;
create trigger inventory_reservations_set_updated_at
before update on public.inventory_reservations
for each row execute function public.set_payment_tables_updated_at();

drop trigger if exists payment_intents_set_updated_at on public.payment_intents;
create trigger payment_intents_set_updated_at
before update on public.payment_intents
for each row execute function public.set_payment_tables_updated_at();

drop trigger if exists payment_intents_zz_monotonic_status on public.payment_intents;
create trigger payment_intents_zz_monotonic_status
before update on public.payment_intents
for each row execute function public.prevent_payment_intent_status_regression();

drop trigger if exists payment_attempts_set_updated_at on public.payment_attempts;
create trigger payment_attempts_set_updated_at
before update on public.payment_attempts
for each row execute function public.set_payment_tables_updated_at();

drop trigger if exists payment_refunds_set_updated_at on public.payment_refunds;
create trigger payment_refunds_set_updated_at
before update on public.payment_refunds
for each row execute function public.set_payment_tables_updated_at();

drop trigger if exists payment_cancellations_set_updated_at on public.payment_cancellations;
create trigger payment_cancellations_set_updated_at
before update on public.payment_cancellations
for each row execute function public.set_payment_tables_updated_at();

drop trigger if exists payment_disputes_set_updated_at on public.payment_disputes;
create trigger payment_disputes_set_updated_at
before update on public.payment_disputes
for each row execute function public.set_payment_tables_updated_at();

drop trigger if exists payment_outbox_set_updated_at on public.payment_outbox;
create trigger payment_outbox_set_updated_at
before update on public.payment_outbox
for each row execute function public.set_payment_tables_updated_at();

-- Customer-safe session payload. It never returns credentials, complete provider
-- payloads, payment instrument data, or an order before the session is final.
create or replace function public.checkout_session_customer_payload(
  p_checkout_session_id uuid,
  p_customer_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'checkout_session_id', s.id,
    'status', s.status,
    'expires_at', s.expires_at,
    'currency', s.currency,
    'subtotal', s.subtotal,
    'discount_total', s.discount_total,
    'delivery_fee', s.delivery_fee,
    'total', s.total,
    'fulfillment_type', s.fulfillment_type,
    'payment_intent_id', pi.id,
    'payment_status', pi.internal_status,
    'provider_status', pi.provider_status,
    'provider_status_detail', pi.provider_status_detail,
    'latest_payment_attempt_status', (
      select pa.status
        from public.payment_attempts pa
       where pa.payment_intent_id = pi.id
         and pa.attempt_type = 'preference'
       order by pa.attempt_number desc
       limit 1
    ),
    'latest_payment_attempt_number', (
      select pa.attempt_number
        from public.payment_attempts pa
       where pa.payment_intent_id = pi.id
         and pa.attempt_type = 'preference'
       order by pa.attempt_number desc
       limit 1
    ),
    'order_id', s.completed_order_id,
    'order_public_code', o.public_code,
    'manual_review_required', s.status = 'manual_review_required',
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'product_id', si.product_id,
          'name', si.product_snapshot ->> 'name',
          'presentation', si.product_snapshot ->> 'presentation',
          'quantity', si.quantity,
          'unit_price', si.unit_price,
          'subtotal', si.subtotal
        ) order by si.created_at, si.id
      )
      from public.checkout_session_items si
      where si.checkout_session_id = s.id
    ), '[]'::jsonb),
    'delivery_code', case
      when s.completed_order_id is not null and s.fulfillment_type = 'delivery' then (
        select pgp_sym_decrypt(h.code_ciphertext, s.id::text)
          from public.order_delivery_handoffs h
         where h.order_id = s.completed_order_id
           and h.confirmed_at is null
           and h.expires_at > clock_timestamp()
      )
      else null
    end
  )
  from public.checkout_sessions s
  join public.payment_intents pi on pi.checkout_session_id = s.id
  left join public.orders o on o.id = s.completed_order_id
  where s.id = p_checkout_session_id
    and s.customer_id = p_customer_id;
$$;

create or replace function public.get_mercadopago_checkout_availability(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'available', coalesce(
      b.is_active
      and b.status = 'open'
      and b.ordering_enabled
      and b.ordering_verified
      and s.enabled
      and s.provider = 'mercadopago'
      and s.checkout_mode = 'checkout_pro'
      and s.currency = 'ARS'
      and (s.environment <> 'production' or s.production_review_status = 'approved'),
      false
    ),
    'environment', s.environment,
    'checkout_mode', s.checkout_mode,
    'allow_offline_payment_methods', coalesce(s.allow_offline_payment_methods, false),
    'installments_limit', s.installments_limit
  )
  from public.businesses b
  left join public.business_payment_settings s
    on s.business_id = b.id
   and s.provider = 'mercadopago'
  where b.id = p_business_id;
$$;

create or replace function public.create_checkout_session(
  p_customer_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_business_id uuid;
  v_business public.businesses%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_client_request_id text;
  v_items jsonb;
  v_contact jsonb;
  v_address jsonb;
  v_fulfillment_type text;
  v_age_confirmed boolean := false;
  v_name text;
  v_phone text;
  v_address_id uuid;
  v_saved_address public.customer_addresses%rowtype;
  v_street text;
  v_street_number text;
  v_floor text;
  v_apartment text;
  v_reference text;
  v_city text;
  v_province text;
  v_postal_code text;
  v_address_label text;
  v_address_source text;
  v_address_snapshot jsonb;
  v_contact_snapshot jsonb;
  v_normalized_items jsonb := '[]'::jsonb;
  v_request_hash text;
  v_session public.checkout_sessions%rowtype;
  v_existing public.checkout_sessions%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_subtotal numeric(12, 2) := 0;
  v_delivery_fee numeric(12, 2) := 0;
  v_total numeric(12, 2) := 0;
  v_contains_alcohol boolean := false;
  v_expires_at timestamptz;
  v_payment_intent_id uuid;
  v_unexpected_key text;
  v_rate_count integer;
begin
  if p_customer_id is null then
    raise exception 'cliente autenticado requerido' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload de checkout invalido' using errcode = '22023';
  end if;

  select key into v_unexpected_key
    from jsonb_object_keys(p_payload) as keys(key)
   where key not in (
     'business_id', 'client_request_id', 'items', 'fulfillment_type',
     'contact', 'address', 'age_confirmed', 'payment_method'
   )
   limit 1;
  if v_unexpected_key is not null then
    raise exception 'campo no permitido en checkout: %', v_unexpected_key using errcode = '22023';
  end if;

  if coalesce(p_payload ->> 'business_id', '') !~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'business_id invalido' using errcode = '22023';
  end if;
  v_business_id := (p_payload ->> 'business_id')::uuid;
  v_client_request_id := btrim(coalesce(p_payload ->> 'client_request_id', ''));
  v_items := coalesce(p_payload -> 'items', '[]'::jsonb);
  v_contact := p_payload -> 'contact';
  v_address := coalesce(p_payload -> 'address', '{}'::jsonb);
  v_fulfillment_type := lower(btrim(coalesce(p_payload ->> 'fulfillment_type', '')));
  v_age_confirmed := coalesce((p_payload ->> 'age_confirmed')::boolean, false);

  if v_client_request_id !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'client_request_id invalido' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(p_payload ->> 'payment_method', ''))) <> 'mercadopago' then
    raise exception 'medio de pago invalido para Checkout Pro' using errcode = '22023';
  end if;
  if v_fulfillment_type not in ('delivery', 'pickup') then
    raise exception 'modalidad de entrega invalida' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array'
    or jsonb_array_length(v_items) < 1
    or jsonb_array_length(v_items) > 100 then
    raise exception 'items debe contener entre 1 y 100 productos' using errcode = '22023';
  end if;
  if jsonb_typeof(v_contact) <> 'object' then
    raise exception 'contacto requerido' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_contact) as keys(key)
     where key not in ('name', 'phone')
  ) then
    raise exception 'campo de contacto no permitido' using errcode = '22023';
  end if;
  if jsonb_typeof(v_address) <> 'object' then
    raise exception 'direccion invalida' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_address) as keys(key)
     where key not in (
       'customer_address_id', 'label', 'street', 'street_number', 'floor',
       'apartment', 'reference', 'city', 'province', 'postal_code',
       'latitude', 'longitude', 'source'
     )
  ) then
    raise exception 'campo de direccion no permitido' using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_items) as item(value)
     where jsonb_typeof(item.value) <> 'object'
        or not (item.value ? 'product_id')
        or not (item.value ? 'quantity')
        or (item.value ->> 'product_id') !~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or (item.value ->> 'quantity') !~ '^[1-9][0-9]*$'
        or (item.value ->> 'quantity')::numeric > 1000
        or exists (
          select 1 from jsonb_object_keys(item.value) as item_keys(key)
           where item_keys.key not in ('product_id', 'quantity')
        )
  ) then
    raise exception 'cada item acepta solo product_id UUID y quantity entero' using errcode = '22023';
  end if;

  v_name := nullif(regexp_replace(btrim(coalesce(v_contact ->> 'name', '')), '[[:space:]]+', ' ', 'g'), '');
  v_phone := regexp_replace(coalesce(v_contact ->> 'phone', ''), '[^0-9]', '', 'g');
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 or v_name !~ '[[:alpha:]]' then
    raise exception 'nombre de contacto invalido' using errcode = '22023';
  end if;
  if v_phone !~ '^[0-9]{10,13}$' or v_phone ~ '^([0-9])\1+$' then
    raise exception 'telefono de contacto invalido' using errcode = '22023';
  end if;

  if nullif(v_address ->> 'customer_address_id', '') is not null then
    if (v_address ->> 'customer_address_id') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'identificador de direccion invalido' using errcode = '22023';
    end if;
    v_address_id := (v_address ->> 'customer_address_id')::uuid;
    select * into v_saved_address
      from public.customer_addresses a
     where a.id = v_address_id
       and a.customer_id = p_customer_id
       and a.deleted_at is null;
    if not found then
      raise exception 'direccion guardada no encontrada' using errcode = '42501';
    end if;
    v_address_label := v_saved_address.label;
    v_street := v_saved_address.street;
    v_street_number := v_saved_address.street_number;
    v_floor := v_saved_address.floor;
    v_apartment := v_saved_address.apartment;
    v_reference := v_saved_address.reference;
    v_city := v_saved_address.city;
    v_province := v_saved_address.province;
    v_postal_code := v_saved_address.postal_code;
    v_address_source := v_saved_address.source;
  else
    v_address_label := nullif(btrim(coalesce(v_address ->> 'label', '')), '');
    v_street := nullif(btrim(coalesce(v_address ->> 'street', '')), '');
    v_street_number := nullif(btrim(coalesce(v_address ->> 'street_number', '')), '');
    v_floor := nullif(btrim(coalesce(v_address ->> 'floor', '')), '');
    v_apartment := nullif(btrim(coalesce(v_address ->> 'apartment', '')), '');
    v_reference := nullif(btrim(coalesce(v_address ->> 'reference', '')), '');
    v_city := nullif(btrim(coalesce(v_address ->> 'city', '')), '');
    v_province := nullif(btrim(coalesce(v_address ->> 'province', '')), '');
    v_postal_code := nullif(btrim(coalesce(v_address ->> 'postal_code', '')), '');
    v_address_source := nullif(btrim(coalesce(v_address ->> 'source', 'manual')), '');
  end if;

  if v_fulfillment_type = 'delivery'
    and (v_street is null or v_street_number is null or v_city is null) then
    raise exception 'direccion de delivery incompleta' using errcode = '22023';
  end if;
  if char_length(coalesce(v_address_label, '')) > 60
    or char_length(coalesce(v_street, '')) > 120
    or char_length(coalesce(v_street_number, '')) > 24
    or char_length(coalesce(v_floor, '')) > 24
    or char_length(coalesce(v_apartment, '')) > 24
    or char_length(coalesce(v_reference, '')) > 180
    or char_length(coalesce(v_city, '')) > 100
    or char_length(coalesce(v_province, '')) > 100
    or char_length(coalesce(v_postal_code, '')) > 20
    or v_address_source not in ('manual', 'gps', 'geocoder', 'previous_order') then
    raise exception 'direccion invalida' using errcode = '22023';
  end if;

  v_contact_snapshot := jsonb_build_object('name', v_name, 'phone', v_phone);
  v_address_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'address_id', v_address_id,
    'label', v_address_label,
    'street', v_street,
    'street_number', v_street_number,
    'floor', v_floor,
    'apartment', v_apartment,
    'reference', v_reference,
    'city', v_city,
    'province', v_province,
    'postal_code', v_postal_code,
    'source', v_address_source
  ));

  select coalesce(jsonb_agg(
    jsonb_build_object('product_id', normalized.product_id, 'quantity', normalized.quantity)
    order by normalized.product_id
  ), '[]'::jsonb)
    into v_normalized_items
    from (
      select (item.value ->> 'product_id')::uuid as product_id,
             sum((item.value ->> 'quantity')::integer)::integer as quantity
        from jsonb_array_elements(v_items) as item(value)
       group by (item.value ->> 'product_id')::uuid
    ) as normalized;

  if exists (
    select 1 from jsonb_to_recordset(v_normalized_items) as normalized(product_id uuid, quantity integer)
     where quantity > 1000
  ) then
    raise exception 'quantity total demasiado alta para producto' using errcode = '22023';
  end if;

  v_request_hash := encode(digest(jsonb_build_object(
    'business_id', v_business_id,
    'items', v_normalized_items,
    'fulfillment_type', v_fulfillment_type,
    'contact', v_contact_snapshot,
    'address', v_address_snapshot,
    'age_confirmed', v_age_confirmed
  )::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtext(v_business_id::text), hashtext(v_client_request_id));
  select * into v_existing
    from public.checkout_sessions s
   where s.business_id = v_business_id
     and s.customer_id = p_customer_id
     and s.client_request_id = v_client_request_id
   for update;
  if found then
    if v_existing.normalized_intent_hash <> v_request_hash then
      raise exception 'client_request_id reutilizado con un checkout diferente' using errcode = '23505';
    end if;
    return public.checkout_session_customer_payload(v_existing.id, p_customer_id);
  end if;

  select b.* into v_business
    from public.businesses b
   where b.id = v_business_id
   for share;
  if not found
    or not v_business.is_active
    or v_business.status <> 'open'
    or not v_business.ordering_enabled
    or not v_business.ordering_verified
    or upper(coalesce(v_business.currency_code, '')) <> 'ARS' then
    raise exception 'negocio no habilitado para pagos online' using errcode = '55000';
  end if;
  if (v_fulfillment_type = 'delivery' and not v_business.delivery_enabled)
    or (v_fulfillment_type = 'pickup' and not v_business.pickup_enabled) then
    raise exception 'modalidad de entrega no habilitada' using errcode = '55000';
  end if;

  select s.* into v_settings
    from public.business_payment_settings s
   where s.business_id = v_business_id
     and s.provider = 'mercadopago'
   for share;
  if not found
    or not v_settings.enabled
    or not v_settings.reserve_stock
    or v_settings.checkout_mode <> 'checkout_pro'
    or v_settings.currency <> 'ARS'
    or nullif(btrim(v_settings.collector_id), '') is null
    or nullif(btrim(v_settings.application_id), '') is null
    or (v_settings.environment = 'production' and v_settings.production_review_status <> 'approved') then
    raise exception 'Mercado Pago no esta configurado para este negocio' using errcode = '55000';
  end if;

  if v_business.order_rate_limit_per_10_minutes is not null then
    select count(*) into v_rate_count
      from public.checkout_sessions s
     where s.business_id = v_business_id
       and s.customer_id = p_customer_id
       and s.created_at >= clock_timestamp() - interval '10 minutes';
    if v_rate_count >= v_business.order_rate_limit_per_10_minutes then
      raise exception 'demasiados intentos de checkout; reintenta mas tarde' using errcode = '54000';
    end if;
  end if;

  v_expires_at := clock_timestamp() + make_interval(mins => v_settings.preference_expiration_minutes);
  insert into public.checkout_sessions (
    business_id, customer_id, client_request_id, normalized_intent_hash,
    fulfillment_type, address_snapshot, contact_snapshot, currency,
    subtotal, discount_total, delivery_fee, total, status, expires_at
  ) values (
    v_business_id, p_customer_id, v_client_request_id, v_request_hash,
    v_fulfillment_type, v_address_snapshot, v_contact_snapshot, 'ARS',
    0, 0, 0, 0, 'validating', v_expires_at
  ) returning * into v_session;

  -- Lock products in deterministic UUID order. Reserving decrements the same
  -- authoritative stock used by the legacy direct-order RPC, so both flows see
  -- active reservations and cannot oversell each other.
  for v_item in
    select * from jsonb_to_recordset(v_normalized_items) as normalized(product_id uuid, quantity integer)
     order by product_id
  loop
    select p.* into v_product
      from public.products p
     where p.id = v_item.product_id
       and p.business_id = v_business_id
     for update;
    if not found
      or not v_product.is_active
      or not v_product.is_verified
      or not v_product.available
      or v_product.price_status <> 'confirmed'
      or v_product.stock is null
      or v_product.price is null
      or v_product.price <= 0 then
      raise exception 'producto no disponible para pago: %', v_item.product_id using errcode = '55000';
    end if;
    if v_product.stock < v_item.quantity then
      raise exception 'stock insuficiente para producto: %', v_item.product_id using errcode = '23514';
    end if;
    if v_product.is_alcoholic then
      v_contains_alcohol := true;
      if v_product.minimum_age is null then
        raise exception 'producto alcoholico sin edad minima configurada' using errcode = '55000';
      end if;
    end if;

    insert into public.checkout_session_items (
      checkout_session_id, product_id, product_snapshot, quantity, unit_price, subtotal
    ) values (
      v_session.id,
      v_product.id,
      jsonb_strip_nulls(jsonb_build_object(
        'name', v_product.name,
        'presentation', v_product.presentation,
        'category', v_product.category,
        'image_url', v_product.image_url,
        'sku', v_product.sku
      )),
      v_item.quantity,
      v_product.price,
      v_product.price * v_item.quantity
    );
    insert into public.inventory_reservations (
      checkout_session_id, product_id, quantity, expires_at
    ) values (
      v_session.id, v_product.id, v_item.quantity, v_expires_at
    );
    update public.products p
       set stock = p.stock - v_item.quantity,
           available = case when p.stock - v_item.quantity > 0 then p.available else false end
     where p.id = v_product.id;
    v_subtotal := v_subtotal + (v_product.price * v_item.quantity);
  end loop;

  if v_contains_alcohol then
    if not v_business.alcohol_sales_enabled
      or v_business.alcohol_minimum_age is null
      or v_business.alcohol_sales_start is null
      or v_business.alcohol_sales_end is null
      or v_business.alcohol_timezone is null
      or not v_age_confirmed then
      raise exception 'politica o confirmacion de edad incompleta' using errcode = '55000';
    end if;
    if v_business.alcohol_sales_start <= v_business.alcohol_sales_end then
      if (clock_timestamp() at time zone v_business.alcohol_timezone)::time
         not between v_business.alcohol_sales_start and v_business.alcohol_sales_end then
        raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
      end if;
    elsif (clock_timestamp() at time zone v_business.alcohol_timezone)::time
      between v_business.alcohol_sales_end and v_business.alcohol_sales_start then
      raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
    end if;
  end if;

  if v_fulfillment_type = 'delivery' then
    v_delivery_fee := v_business.delivery_fee;
    if v_delivery_fee is null or v_business.minimum_delivery_subtotal is null
      or v_subtotal < v_business.minimum_delivery_subtotal then
      raise exception 'configuracion o minimo de delivery no valido' using errcode = '23514';
    end if;
  end if;
  v_total := v_subtotal + v_delivery_fee;

  update public.checkout_sessions
     set subtotal = v_subtotal,
         discount_total = 0,
         delivery_fee = v_delivery_fee,
         total = v_total,
         contains_alcohol = v_contains_alcohol,
         age_confirmed_at = case when v_contains_alcohol then clock_timestamp() else null end,
         age_confirmation_policy = case when v_contains_alcohol then v_business.alcohol_minimum_age else null end,
         status = 'ready_for_payment'
   where id = v_session.id
   returning * into v_session;

  insert into public.payment_intents (
    checkout_session_id, business_id, provider, environment, external_reference,
    internal_status, currency, expected_amount, live_mode
  ) values (
    v_session.id, v_business_id, 'mercadopago', v_settings.environment,
    'taba2:checkout:' || v_session.id::text,
    'created', 'ARS', v_total, v_settings.environment = 'production'
  ) returning id into v_payment_intent_id;

  insert into public.payment_events (
    payment_intent_id, event_type, details
  ) values (
    v_payment_intent_id,
    'checkout.session_created',
    jsonb_build_object('checkout_session_id', v_session.id, 'reservation_expires_at', v_expires_at)
  );

  return public.checkout_session_customer_payload(v_session.id, p_customer_id);
end;
$$;

create or replace function public.get_checkout_session_for_customer(p_checkout_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_customer_id uuid := auth.uid();
  v_payload jsonb;
begin
  if v_customer_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  select public.checkout_session_customer_payload(p_checkout_session_id, v_customer_id)
    into v_payload;
  if v_payload is null then
    raise exception 'checkout no encontrado o acceso denegado' using errcode = '42501';
  end if;
  return v_payload;
end;
$$;

revoke all on function public.checkout_session_customer_payload(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_mercadopago_checkout_availability(uuid) from public, anon;
grant execute on function public.get_mercadopago_checkout_availability(uuid) to authenticated;
revoke all on function public.create_checkout_session(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_checkout_session(uuid, jsonb) to service_role;
revoke all on function public.get_checkout_session_for_customer(uuid) from public, anon;
grant execute on function public.get_checkout_session_for_customer(uuid) to authenticated;

comment on function public.create_checkout_session(uuid, jsonb) is
  'Service-only Checkout Pro entry point: recalculates server prices, locks products, reserves stock once, and creates no operational order.';
comment on function public.get_checkout_session_for_customer(uuid) is
  'Customer-safe checkout recovery DTO. Redirect query parameters are never payment authority.';
