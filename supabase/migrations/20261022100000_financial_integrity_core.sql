-- Financial integrity core (forensic findings F01-F05, F12 and the lock-order candidate of F-concurrency).
--
-- Invariants this migration enforces in PostgreSQL itself (not in the UI):
--   I1  An order is never created, recovered or advanced while the money behind it is returned, being returned,
--       disputed or ambiguous (private.payment_financial_hold / private.order_payment_blocks_fulfilment).
--   I2  A checkout session holds at most ONE live (active|converted) reservation per product, and a paid
--       purchase is re-reserved only after the previous active reservation was released exactly once.
--   I3  The payment that funds an intent is chosen by what it IS (money moved), never by arrival time. Every payment
--       resource is stored on its own row, keyed by (provider, environment, seller, payment id).
--   I4  Refund totals come from an inventory of refund identities (local + external + one unattributed residual)
--       and never go backwards.
--   I5  Whatever cannot be resolved automatically becomes a durable, visible payment_discrepancies row.
--   I6  Lock order is always payment_intents -> checkout_sessions -> products.
--
-- REVERSAL (only if this has to be backed out; nothing here deletes financial data):
--   restore the previous bodies from 20260814040000 / 20260806180000 and earlier definitions of the replaced functions,
--   `alter function private.finalize_paid_checkout_session_core(uuid) set schema public;`, rename it back, and
--   drop the three new objects: payment_provider_payments, payment_discrepancies, index
--   inventory_reservations_one_live_per_product (column payment_refunds.origin may stay: it has a default).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Storage
-- ---------------------------------------------------------------------------------------------------------------
alter table public.payment_refunds
  add column if not exists origin text not null default 'local';
alter table public.payment_refunds
  drop constraint if exists payment_refunds_origin_check;
alter table public.payment_refunds
  add constraint payment_refunds_origin_check check (origin in ('local', 'external', 'unattributed'));
comment on column public.payment_refunds.origin is
  'local: created by this system; external: observed in the provider ledger with its own id; unattributed: residual between the provider total and the identified refunds.';

-- Exactly-once stock effect: one live reservation per product per checkout. A recovery that wants a new one must
-- release the previous active one first (see private.reserve_for_paid_session).
create unique index if not exists inventory_reservations_one_live_per_product
  on public.inventory_reservations (checkout_session_id, product_id)
  where status in ('active', 'converted');

create table public.payment_provider_payments (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents(id) on delete restrict,
  provider text not null default 'mercadopago' check (provider = 'mercadopago'),
  environment text not null check (environment in ('test', 'production')),
  seller_id text not null check (btrim(seller_id) <> ''),
  provider_payment_id text not null check (btrim(provider_payment_id) <> ''),
  status text not null,
  status_detail text,
  amount numeric(12, 2),
  currency text,
  refunded_amount numeric(12, 2) not null default 0 check (refunded_amount >= 0),
  refunds_observed_at timestamptz,
  provider_event_at timestamptz,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  raw_response_hash text check (raw_response_hash is null or raw_response_hash ~ '^[a-f0-9]{64}$'),
  is_financing boolean not null default false,
  validation_error text,
  unique (provider, environment, seller_id, provider_payment_id)
);
create unique index payment_provider_payments_one_financing
  on public.payment_provider_payments (payment_intent_id) where is_financing;
create index payment_provider_payments_intent_idx on public.payment_provider_payments (payment_intent_id, first_seen_at);
comment on table public.payment_provider_payments is
  'One row per provider payment resource. The intent groups attempts; it never overwrites one payment with another.';

create table public.payment_discrepancies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete restrict,
  payment_intent_id uuid references public.payment_intents(id) on delete restrict,
  checkout_session_id uuid references public.checkout_sessions(id) on delete restrict,
  refund_id uuid references public.payment_refunds(id) on delete restrict,
  kind text not null check (kind ~ '^[a-z][a-z_]{2,59}$'),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  blocks_recovery boolean not null default false,
  environment text check (environment is null or environment in ('test', 'production')),
  seller_id text,
  provider_payment_id text,
  provider_refund_id text,
  details jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 300),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  occurrences integer not null default 1 check (occurrences >= 1),
  first_detected_at timestamptz not null default clock_timestamp(),
  last_detected_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution text,
  resolution_note text,
  check ((status = 'resolved') = (resolved_at is not null))
);
create index payment_discrepancies_open_idx on public.payment_discrepancies (business_id, severity, last_detected_at desc)
  where status <> 'resolved';
create index payment_discrepancies_intent_idx on public.payment_discrepancies (payment_intent_id) where payment_intent_id is not null;
comment on table public.payment_discrepancies is
  'Durable inbox of financial facts that could not be resolved automatically. Nothing is auto-closed by age.';

alter table public.payment_provider_payments enable row level security;
alter table public.payment_discrepancies enable row level security;
revoke all on public.payment_provider_payments, public.payment_discrepancies from public, anon, authenticated;
grant all on public.payment_provider_payments, public.payment_discrepancies to service_role;

do $$ declare v_table text; begin
  foreach v_table in array array['payment_provider_payments', 'payment_discrepancies'] loop
    execute format('create trigger a1_a4_financial_interlock_v5 before insert or update or delete or truncate on public.%I for each statement execute function private.a1_a4_financial_write_guard_v5()', v_table);
    execute format('alter table public.%I enable always trigger a1_a4_financial_interlock_v5', v_table);
  end loop;
end $$;

-- Existing intents keep their payment identity on the new table (financing = money statuses).
insert into public.payment_provider_payments (payment_intent_id, environment, seller_id, provider_payment_id, status,
  amount, currency, refunded_amount, provider_event_at, is_financing, raw_response_hash)
select pi.id, pi.environment, coalesce(nullif(btrim(ps.collector_id), ''), 'unknown'), pi.provider_payment_id,
       coalesce(pi.provider_status, 'unknown'), pi.paid_amount, pi.currency, pi.refunded_amount, pi.provider_event_at,
       coalesce(pi.provider_status, '') in ('approved', 'refunded', 'charged_back'), pi.raw_response_hash
  from public.payment_intents pi
  left join public.business_payment_settings ps on ps.business_id = pi.business_id and ps.provider = 'mercadopago'
 where pi.provider_payment_id is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Small pure helpers
-- ---------------------------------------------------------------------------------------------------------------
create function private.provider_payment_status_rank(p_status text) returns integer
language sql immutable set search_path = pg_catalog as $$
  select case lower(btrim(coalesce(p_status, '')))
    when 'pending' then 10
    when 'in_process' then 20
    when 'authorized' then 20
    when 'rejected' then 30
    when 'cancelled' then 30
    when 'canceled' then 30
    when 'expired' then 30
    when 'approved' then 40
    when 'refunded' then 50
    when 'charged_back' then 60
    else 0
  end $$;

create function private.open_payment_discrepancy(
  p_business_id uuid, p_payment_intent_id uuid, p_checkout_session_id uuid, p_kind text, p_severity text,
  p_blocks_recovery boolean, p_provider_payment_id text, p_details jsonb, p_dedupe_key text,
  p_refund_id uuid default null, p_seller_id text default null, p_environment text default null,
  p_provider_refund_id text default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_id uuid; v_inserted boolean;
begin
  insert into public.payment_discrepancies as d (
    business_id, payment_intent_id, checkout_session_id, refund_id, kind, severity, blocks_recovery,
    environment, seller_id, provider_payment_id, provider_refund_id, details, dedupe_key)
  values (p_business_id, p_payment_intent_id, p_checkout_session_id, p_refund_id, p_kind, p_severity, p_blocks_recovery,
    p_environment, p_seller_id, p_provider_payment_id, p_provider_refund_id, coalesce(p_details, '{}'::jsonb), p_dedupe_key)
  on conflict (dedupe_key) do update
    set occurrences = d.occurrences + 1, last_detected_at = clock_timestamp(),
        details = d.details || excluded.details,
        -- A recurrence of something already closed reopens it: the fact is back.
        status = case when d.status = 'resolved' then 'open' else d.status end,
        resolved_at = case when d.status = 'resolved' then null else d.resolved_at end,
        resolved_by = case when d.status = 'resolved' then null else d.resolved_by end,
        resolution = case when d.status = 'resolved' then null else d.resolution end
  returning d.id, (d.xmax = 0) into v_id, v_inserted;
  if v_inserted and p_payment_intent_id is not null then
    insert into public.payment_events (payment_intent_id, event_type, provider_event_id, details)
    values (p_payment_intent_id, 'payment.discrepancy_opened', p_provider_payment_id,
      jsonb_build_object('kind', p_kind, 'severity', p_severity, 'discrepancy_id', v_id));
  end if;
  return v_id;
end $$;

create function private.resolve_open_discrepancies(p_payment_intent_id uuid, p_kind text, p_resolution text)
returns integer language sql security definer set search_path = pg_catalog, public, pg_temp as $$
  with r as (
    update public.payment_discrepancies
       set status = 'resolved', resolved_at = clock_timestamp(), resolution = p_resolution,
           resolution_note = 'resolved automatically by the system after the cause disappeared'
     where payment_intent_id = p_payment_intent_id and kind = p_kind and status <> 'resolved'
     returning 1)
  select count(*)::integer from r $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Financial hold: is there any money fact that makes creating/advancing an order unsafe?
-- ---------------------------------------------------------------------------------------------------------------
create function private.payment_financial_hold(p_intent_id uuid) returns text
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select case
    when exists (select 1 from public.payment_refunds r
                  where r.payment_intent_id = i.id and r.status in ('requested', 'processing', 'ambiguous'))
      then 'refund_in_flight'
    when exists (select 1 from public.payment_cancellations c
                  where c.payment_intent_id = i.id and c.status in ('requested', 'processing', 'ambiguous'))
      then 'cancellation_in_flight'
    when i.refunded_amount > 0
      or exists (select 1 from public.payment_refunds r where r.payment_intent_id = i.id and r.status = 'approved')
      then 'refund_registered'
    when i.internal_status in ('refunded', 'partially_refunded', 'charged_back') then 'money_returned'
    when exists (select 1 from public.payment_disputes d where d.payment_intent_id = i.id and d.resolved_at is null)
      then 'dispute_open'
    when exists (select 1 from public.payment_discrepancies x
                  where x.payment_intent_id = i.id and x.status <> 'resolved' and x.blocks_recovery)
      then 'financial_discrepancy_open'
  end
  from public.payment_intents i where i.id = p_intent_id $$;

-- An order may still be fulfilled while at least one unit of money backs it. Full (or fully requested) refunds,
-- chargebacks and open chargeback disputes freeze it.
create function private.order_payment_blocks_fulfilment(p_order_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select exists (
    select 1 from public.payment_intents pi
     where pi.order_id = p_order_id
       and coalesce(pi.paid_amount, pi.expected_amount) > 0
       and (
         pi.internal_status = 'charged_back'
         or exists (select 1 from public.payment_disputes d
                     where d.payment_intent_id = pi.id and d.dispute_type = 'chargeback' and d.resolved_at is null)
         or pi.refunded_amount + coalesce((select sum(r.amount) from public.payment_refunds r
              where r.payment_intent_id = pi.id and r.status in ('requested', 'processing', 'ambiguous')), 0)
            >= coalesce(pi.paid_amount, pi.expected_amount)
       )
  ) $$;

create or replace function public.order_payment_is_financially_reversed(p_order_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
  -- Reversed = the money is back with the buyer, judged by amounts, not by a status label that a review can mask.
  select
    exists (
      select 1 from public.payment_intents pi
       where pi.order_id = p_order_id
         and coalesce(pi.paid_amount, pi.expected_amount) > 0
         and (pi.internal_status = 'charged_back'
              or pi.refunded_amount >= coalesce(pi.paid_amount, pi.expected_amount))
    )
    and not exists (
      select 1 from public.payment_intents pi
       where pi.order_id = p_order_id
         and pi.internal_status not in ('rejected', 'cancelled', 'expired', 'failed', 'charged_back')
         and pi.refunded_amount < coalesce(pi.paid_amount, pi.expected_amount)
    ) $$;

create or replace function public.prevent_paid_order_generic_cancellation() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
begin
  if (public.order_payment_is_financially_reversed(old.id) or private.order_payment_blocks_fulfilment(old.id))
     and public.normalize_order_status_vocabulary(old.status) not in ('cancelled', 'rejected', 'delivered')
     and public.normalize_order_status_vocabulary(new.status) not in ('cancelled', 'rejected') then
    raise exception 'pago revertido: el pedido solo admite cierre operativo'
      using errcode = '55000';
  end if;

  if public.normalize_order_status_vocabulary(new.status) in ('cancelled', 'rejected')
     and public.normalize_order_status_vocabulary(old.status) not in ('cancelled', 'rejected')
     and (
       lower(btrim(coalesce(old.payment_method, ''))) = 'mercadopago'
       or exists (select 1 from public.payment_intents pi where pi.order_id = old.id)
     )
     and not public.order_payment_is_financially_reversed(old.id) then
    raise exception 'pedido cobrado por Mercado Pago: gestionar reembolso desde Pagos'
      using errcode = '55000';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Stock: release / reserve exactly once
-- ---------------------------------------------------------------------------------------------------------------
-- Caller holds the intent and session locks. Returns the stock of every ACTIVE reservation, once.
create function private.release_active_reservations(p_checkout_session_id uuid, p_reason text) returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_reservation public.inventory_reservations%rowtype; v_released integer := 0;
begin
  perform 1
    from public.products p
    join public.inventory_reservations r on r.product_id = p.id
   where r.checkout_session_id = p_checkout_session_id and r.status = 'active'
   order by p.id
   for update of p;
  for v_reservation in
    select * from public.inventory_reservations r
     where r.checkout_session_id = p_checkout_session_id and r.status = 'active'
     order by r.product_id, r.reservation_generation
     for update
  loop
    update public.products p
       set stock = p.stock + v_reservation.quantity,
           available = p.merchant_available and p.is_active and p.is_verified
                       and (p.stock + v_reservation.quantity) > 0
                       and p.price_status = 'confirmed' and p.price > 0
     where p.id = v_reservation.product_id;
    update public.inventory_reservations
       set status = 'released', released_at = clock_timestamp(),
           release_reason = left(coalesce(p_reason, 'terminal'), 120)
     where id = v_reservation.id and status = 'active';
    v_released := v_released + 1;
  end loop;
  return v_released;
end $$;

-- Makes sure a PAID purchase is backed by exactly its items' stock. Reuses the live reservation when it already
-- covers the items (stock is still held for it), otherwise returns it once and takes a fresh one if stock exists.
create function private.reserve_for_paid_session(p_checkout_session_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_item record;
  v_product public.products%rowtype;
  v_missing jsonb := '[]'::jsonb;
  v_generation integer;
  v_expires timestamptz := clock_timestamp() + interval '10 minutes';
begin
  if exists (select 1 from public.inventory_reservations r
              where r.checkout_session_id = p_checkout_session_id and r.status = 'active')
     and not exists (
       select 1 from public.checkout_session_items i
        where i.checkout_session_id = p_checkout_session_id
          and coalesce((select sum(r.quantity) from public.inventory_reservations r
                         where r.checkout_session_id = p_checkout_session_id
                           and r.product_id = i.product_id and r.status = 'active'), 0) <> i.quantity)
     and not exists (
       select 1 from public.inventory_reservations r
        where r.checkout_session_id = p_checkout_session_id and r.status = 'active'
          and r.product_id not in (select i.product_id from public.checkout_session_items i
                                    where i.checkout_session_id = p_checkout_session_id)) then
    update public.inventory_reservations
       set expires_at = greatest(expires_at, v_expires)
     where checkout_session_id = p_checkout_session_id and status = 'active';
    return jsonb_build_object('ok', true, 'reused_reservation', true);
  end if;

  perform private.release_active_reservations(p_checkout_session_id, 'paid_checkout_re_reserve');

  for v_item in
    select i.product_id, i.quantity, i.product_snapshot
      from public.checkout_session_items i
     where i.checkout_session_id = p_checkout_session_id
     order by i.product_id
  loop
    select * into v_product from public.products p where p.id = v_item.product_id for update;
    if not found or not v_product.is_active or v_product.stock is null or v_product.stock < v_item.quantity then
      v_missing := v_missing || jsonb_build_object(
        'product_id', v_item.product_id,
        'name', coalesce(v_item.product_snapshot ->> 'name', 'Producto'),
        'necesarias', v_item.quantity,
        'disponibles', coalesce(v_product.stock, 0));
    end if;
  end loop;
  if jsonb_array_length(v_missing) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'stock_insuficiente', 'missing', v_missing,
      'action', 'devolver_el_dinero_desde_el_panel');
  end if;

  select coalesce(max(r.reservation_generation), 0) + 1 into v_generation
    from public.inventory_reservations r where r.checkout_session_id = p_checkout_session_id;
  for v_item in
    select i.product_id, i.quantity from public.checkout_session_items i
     where i.checkout_session_id = p_checkout_session_id order by i.product_id
  loop
    update public.products p
       set stock = p.stock - v_item.quantity,
           available = case when p.stock - v_item.quantity > 0 then p.available else false end
     where p.id = v_item.product_id;
    insert into public.inventory_reservations (checkout_session_id, product_id, quantity, expires_at, reservation_generation)
    values (p_checkout_session_id, v_item.product_id, v_item.quantity, v_expires, v_generation);
  end loop;
  return jsonb_build_object('ok', true, 'reserved', true, 'reservation_generation', v_generation);
end $$;

-- Lock order I6: the intent first. Used by both sweeps and by terminal releases.
create or replace function public.release_checkout_session_inventory(
  p_checkout_session_id uuid, p_reason text, p_terminal_status text default 'cancelled'
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_session public.checkout_sessions%rowtype;
  v_released integer;
  v_status text := lower(btrim(coalesce(p_terminal_status, 'cancelled')));
begin
  if v_status not in ('cancelled', 'expired') then
    raise exception 'estado terminal de reserva invalido' using errcode = '22023';
  end if;
  perform 1 from public.payment_intents pi where pi.checkout_session_id = p_checkout_session_id for update;
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found then
    raise exception 'checkout inexistente' using errcode = 'P0002';
  end if;
  if v_session.status in ('completed', 'payment_approved', 'finalizing_order', 'manual_review_required') then
    return jsonb_build_object('released', 0, 'skipped', true, 'status', v_session.status);
  end if;
  v_released := private.release_active_reservations(v_session.id, p_reason);
  update public.checkout_sessions
     set status = v_status
   where id = v_session.id
     and status not in ('completed', 'payment_approved', 'finalizing_order', 'manual_review_required');
  update public.payment_intents
     set internal_status = case
       when public.payment_internal_status_rank(internal_status) < public.payment_internal_status_rank(v_status)
         then v_status else internal_status end
   where checkout_session_id = v_session.id;
  return jsonb_build_object('released', v_released, 'status', v_status);
end $$;

create or replace function public.expire_checkout_sessions(p_limit integer default 100) returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_session_id uuid;
  v_count integer := 0;
begin
  -- Candidates are read WITHOUT locks and in a total order (expires_at, id): two overlapping sweeps then lock
  -- sessions in the same order and cannot form a cycle. The INTENT is try-locked first (canonical order I6, same as
  -- payment snapshots): a checkout a payment is being recorded on right now is skipped, not waited for.
  for v_session_id in
    select s.id
      from public.checkout_sessions s
     where s.expires_at <= clock_timestamp()
       and s.status in ('created', 'validating', 'ready_for_payment', 'redirected', 'payment_pending')
       and not exists (select 1 from public.payment_intents pi
                        where pi.checkout_session_id = s.id and pi.paid_amount is not null)
     order by s.expires_at, s.id
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    if exists (select 1 from public.payment_intents pi where pi.checkout_session_id = v_session_id) then
      perform 1 from public.payment_intents pi where pi.checkout_session_id = v_session_id for update skip locked;
      if not found then continue; end if;
    end if;
    perform public.release_checkout_session_inventory(v_session_id, 'checkout_expired', 'expired');
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Lock order I6 for the buyer-facing preference functions too. They used to lock the SESSION and then the intent,
-- the inverse of payment snapshots, the expiry sweep and recovery: a buyer reopening the payment link while a
-- webhook was being recorded could deadlock. Each gets one extra statement in front that takes the intent first.
do $$
declare
  v_fn regprocedure;
  v_def text;
  v_new text;
  v_pre constant text := E'  perform 1 from public.payment_intents _pi where _pi.checkout_session_id = p_checkout_session_id for update;
';
begin
  foreach v_fn in array array[
    'public.prepare_mercadopago_preference(uuid,uuid,boolean)'::regprocedure,
    'public.prepare_mercadopago_preference_v2(uuid,uuid,boolean)'::regprocedure] loop
    v_def := pg_get_functiondef(v_fn);
    v_new := replace(v_def, E'  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;',
      v_pre || E'  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;');
    if v_new = v_def then raise exception 'LOCK_ORDER_PATTERN_MISMATCH %', v_fn; end if;
    execute v_new;
  end loop;
  v_fn := 'public.record_mercadopago_preference_created_v2(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text)'::regprocedure;
  v_def := pg_get_functiondef(v_fn);
  v_new := replace(v_def, E' perform 1 from public.checkout_sessions where id=p_checkout_session_id and customer_id=p_customer_id for update;',
    v_pre || E' perform 1 from public.checkout_sessions where id=p_checkout_session_id and customer_id=p_customer_id for update;');
  if v_new = v_def then raise exception 'LOCK_ORDER_PATTERN_MISMATCH %', v_fn; end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Refund inventory (F05)
-- ---------------------------------------------------------------------------------------------------------------
-- Rebuilds the refunded total from identities. `p_provider_total` is the provider's cumulative figure (null = not
-- observed now). The residual between that figure and the identified refunds is ONE row, so repeating a snapshot
-- never double counts. p_overlap_since: a local refund recorded after the provider total was observed is independent
-- of it; one requested before might already be inside it.
create function private.refresh_refund_totals(
  p_payment_intent_id uuid, p_provider_total numeric default null, p_observed_at timestamptz default null,
  p_local_refund_requested_at timestamptz default null
) returns numeric
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_intent public.payment_intents%rowtype;
  v_pay public.payment_provider_payments%rowtype;
  v_attributed numeric(12, 2);
  v_known_total numeric(12, 2);
  v_residual numeric(12, 2);
  v_residual_id text := 'unattributed:' || p_payment_intent_id::text;
  v_use_total numeric(12, 2);
  v_use_observed timestamptz;
  v_total numeric(12, 2);
begin
  select * into v_intent from public.payment_intents where id = p_payment_intent_id;
  select * into v_pay from public.payment_provider_payments
   where payment_intent_id = p_payment_intent_id and is_financing;
  v_use_total := p_provider_total;
  v_use_observed := p_observed_at;
  if v_use_total is not null and found then
    -- The stored provider figure is a running maximum: a stale read can never shrink the residual.
    v_use_total := greatest(v_use_total, v_pay.refunded_amount);
  end if;
  if v_use_total is null and found and v_pay.refunds_observed_at is not null
     and (p_local_refund_requested_at is null or v_pay.refunds_observed_at >= p_local_refund_requested_at) then
    -- A local refund may already be part of the provider's last figure: recompute the residual against it.
    v_use_total := v_pay.refunded_amount;
    v_use_observed := v_pay.refunds_observed_at;
  end if;

  if v_use_total is not null then
    select coalesce(sum(amount), 0) into v_attributed from public.payment_refunds
     where payment_intent_id = p_payment_intent_id and status = 'approved' and origin <> 'unattributed';
    v_residual := greatest(v_use_total - v_attributed, 0);
    if v_residual > 0 then
      insert into public.payment_refunds (payment_intent_id, order_id, provider_refund_id, amount, status, origin,
                                          reason, requested_at, completed_at)
      values (p_payment_intent_id, v_intent.order_id, v_residual_id, v_residual, 'approved', 'unattributed',
              'provider_total_without_identity', coalesce(v_use_observed, clock_timestamp()), clock_timestamp())
      on conflict (provider_refund_id) where provider_refund_id is not null
        do update set amount = excluded.amount, completed_at = clock_timestamp();
    else
      delete from public.payment_refunds
       where payment_intent_id = p_payment_intent_id and provider_refund_id = v_residual_id;
    end if;
    update public.payment_provider_payments
       set refunded_amount = greatest(refunded_amount, v_use_total),
           refunds_observed_at = greatest(coalesce(refunds_observed_at, '-infinity'::timestamptz), coalesce(v_use_observed, clock_timestamp()))
     where payment_intent_id = p_payment_intent_id and is_financing;
  end if;

  select coalesce(sum(amount), 0) into v_total from public.payment_refunds
   where payment_intent_id = p_payment_intent_id and status = 'approved';
  -- Monotonic: a total never goes down because a provider read was stale.
  v_total := greatest(v_total, v_intent.refunded_amount);
  update public.payment_intents set refunded_amount = v_total where id = p_payment_intent_id and refunded_amount <> v_total;
  return v_total;
end $$;

-- Imports the provider's refund list (ids) and its cumulative total into the inventory.
create function private.reconcile_payment_refunds(
  p_payment_intent_id uuid, p_status text, p_amount numeric, p_provider_total numeric, p_refunds jsonb,
  p_observed_at timestamptz
) returns numeric
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_intent public.payment_intents%rowtype;
  v_item jsonb;
  v_id text;
  v_amt numeric(12, 2);
  v_total numeric(12, 2);
begin
  select * into v_intent from public.payment_intents where id = p_payment_intent_id;
  if p_refunds is not null and jsonb_typeof(p_refunds) = 'array' then
    for v_item in select * from jsonb_array_elements(p_refunds) loop
      v_id := nullif(btrim(coalesce(v_item ->> 'id', '')), '');
      begin v_amt := nullif(v_item ->> 'amount', '')::numeric(12, 2); exception when others then v_amt := null; end;
      if v_id is null or v_amt is null or v_amt <= 0
         or lower(coalesce(v_item ->> 'status', 'approved')) <> 'approved' then
        continue;
      end if;
      insert into public.payment_refunds (payment_intent_id, order_id, provider_refund_id, amount, status, origin,
                                          reason, requested_at, completed_at)
      values (p_payment_intent_id, v_intent.order_id, v_id, v_amt, 'approved', 'external',
              'observed_in_provider_ledger', coalesce(p_observed_at, clock_timestamp()), clock_timestamp())
      on conflict (provider_refund_id) where provider_refund_id is not null do nothing;
    end loop;
  end if;
  -- A payment the provider reports as refunded is refunded in full even if its list is missing: fail closed.
  v_total := greatest(coalesce(p_provider_total, 0), case when p_status in ('refunded', 'charged_back') then coalesce(p_amount, 0) else 0 end);
  return private.refresh_refund_totals(p_payment_intent_id, v_total, p_observed_at, null);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Local refund recording keeps the inventory coherent
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.record_payment_refund_identity(
  p_refund_id uuid, p_payment_intent_id uuid, p_provider_payment_id text, p_idempotency_key uuid, p_provider_refund_id text
) returns boolean
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare v_refund public.payment_refunds%rowtype; v_intent public.payment_intents%rowtype;
begin
  if p_provider_refund_id is null or p_provider_refund_id !~ '^[1-9][0-9]{0,31}$' then
    raise exception 'identidad de reembolso invalida' using errcode = '22023';
  end if;
  -- Same lock order as prepare_payment_refund: intent, then refund.
  select * into v_intent from public.payment_intents where id = p_payment_intent_id for update;
  if not found or v_intent.provider_payment_id is distinct from p_provider_payment_id then
    raise exception 'pago del reembolso no coincide' using errcode = '22023';
  end if;
  select * into v_refund from public.payment_refunds where id = p_refund_id for update;
  if not found or v_refund.payment_intent_id is distinct from p_payment_intent_id
    or v_refund.idempotency_key is distinct from p_idempotency_key then
    raise exception 'solicitud de reembolso no coincide' using errcode = '22023';
  end if;
  if v_refund.provider_refund_id is not null then
    if v_refund.provider_refund_id <> p_provider_refund_id then
      raise exception 'identidad de reembolso no coincide' using errcode = '23505';
    end if;
    return true;
  end if;
  if v_refund.status not in ('requested', 'processing', 'ambiguous') then
    raise exception 'reembolso ya resuelto' using errcode = '55000';
  end if;
  -- The provider ledger may have shown this very refund before our own call returned: it is the same money, adopt it.
  delete from public.payment_refunds
   where provider_refund_id = p_provider_refund_id and origin = 'external' and id <> p_refund_id
     and payment_intent_id = p_payment_intent_id;
  update public.payment_refunds set provider_refund_id = p_provider_refund_id where id = p_refund_id;
  return true;
end $$;

create or replace function public.record_payment_refund_response_v2(
  p_refund_id uuid, p_provider_refund_id text, p_status text, p_amount numeric, p_response_hash text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_refund public.payment_refunds%rowtype;
  v_intent public.payment_intents%rowtype;
  v_intent_id uuid;
  v_total numeric(12, 2);
  v_provider_id text := nullif(btrim(coalesce(p_provider_refund_id, '')), '');
begin
  if p_response_hash is null or p_response_hash !~ '^[a-f0-9]{64}$'
    or p_status is null or p_status not in ('approved', 'rejected', 'ambiguous', 'failed')
    or p_amount is null or p_amount <= 0 then
    raise exception 'respuesta de reembolso invalida' using errcode = '22023';
  end if;
  select payment_intent_id into v_intent_id from public.payment_refunds where id = p_refund_id;
  if not found then raise exception 'reembolso inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents where id = v_intent_id for update;
  select * into v_refund from public.payment_refunds where id = p_refund_id for update;
  if not found or v_refund.payment_intent_id is distinct from v_intent_id then
    raise exception 'solicitud de reembolso cambio' using errcode = '22023';
  end if;
  if p_amount is distinct from v_refund.amount then
    raise exception 'importe de reembolso no coincide' using errcode = '22023';
  end if;
  if v_provider_id is distinct from v_refund.provider_refund_id
    or (p_status = 'approved' and v_provider_id is null) then
    raise exception 'identidad de reembolso no confirmada' using errcode = '23505';
  end if;
  if v_refund.status in ('approved', 'rejected') then
    if v_refund.status <> p_status then
      raise exception 'resultado de reembolso ya confirmado' using errcode = '55000';
    end if;
    return jsonb_build_object('ok', true, 'payment_intent_id', v_intent_id, 'idempotent', true);
  end if;
  if v_refund.status = p_status and v_refund.raw_response_hash = p_response_hash then
    return jsonb_build_object('ok', true, 'payment_intent_id', v_intent_id, 'idempotent', true);
  end if;
  update public.payment_refunds set status = p_status, raw_response_hash = p_response_hash,
    completed_at = case when p_status in ('approved', 'rejected') then clock_timestamp() else completed_at end
   where id = p_refund_id;
  if p_status = 'approved' then
    v_total := private.refresh_refund_totals(v_intent_id, null, null, v_refund.requested_at);
    -- The review label is kept (the reason for the review is still true), but the money fact is now on the row
    -- AND every guard reads amounts, not this label.
    if v_intent.internal_status <> 'security_review_required' then
      update public.payment_intents
         set internal_status = case when v_total >= coalesce(paid_amount, expected_amount) then 'refunded' else 'partially_refunded' end
       where id = v_intent_id;
    end if;
  end if;
  insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash)
  values (v_intent_id, 'payment.refund_' || p_status,
          jsonb_build_object('refund_id', p_refund_id, 'amount', p_amount), p_response_hash);
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent_id, 'idempotent', false);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Advancing a paid checkout: one routine, three callers (snapshot, operator, sweep)
-- ---------------------------------------------------------------------------------------------------------------
-- Move the audited finalizer out of reach: it has no money guards of its own.
alter function public.finalize_paid_checkout_session(uuid) rename to finalize_paid_checkout_session_core;
alter function public.finalize_paid_checkout_session_core(uuid) set schema private;
revoke all on function private.finalize_paid_checkout_session_core(uuid) from public, anon, authenticated, service_role;

create function public.finalize_paid_checkout_session(p_checkout_session_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  v_intent_id uuid;
  v_intent public.payment_intents%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_hold text;
  v_res jsonb;
begin
  select pi.id into v_intent_id from public.payment_intents pi where pi.checkout_session_id = p_checkout_session_id;
  if v_intent_id is not null then
    select * into v_intent from public.payment_intents pi where pi.id = v_intent_id for update;
  end if;
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found then raise exception 'checkout inexistente' using errcode = 'P0002'; end if;
  if v_session.completed_order_id is not null or v_session.status = 'completed' then
    return jsonb_build_object('ok', true, 'order_id', v_session.completed_order_id, 'idempotent', true);
  end if;
  if v_intent_id is null or v_intent.internal_status not in ('approved_order_pending', 'approved')
    or v_intent.provider_status <> 'approved' or v_intent.paid_amount <> v_session.total or v_intent.currency <> 'ARS' then
    raise exception 'pago no aprobado verificadamente' using errcode = '55000';
  end if;

  v_hold := private.payment_financial_hold(v_intent.id);
  if v_hold is not null then
    update public.checkout_sessions
       set status = 'manual_review_required', manual_review_reason = left('financial_hold:' || v_hold, 120)
     where id = v_session.id;
    if v_hold in ('refund_in_flight', 'cancellation_in_flight', 'dispute_open', 'financial_discrepancy_open') then
      perform private.open_payment_discrepancy(v_session.business_id, v_intent.id, v_session.id, 'paid_without_order', 'high',
        false, v_intent.provider_payment_id, jsonb_build_object('hold', v_hold, 'stage', 'finalize'),
        'paid_without_order:' || v_intent.id::text);
    end if;
    return jsonb_build_object('ok', false, 'manual_review_required', true, 'blocked', true, 'hold', v_hold);
  end if;

  v_res := private.reserve_for_paid_session(v_session.id);
  if not coalesce((v_res ->> 'ok')::boolean, false) then
    update public.payment_intents
       set internal_status = 'security_review_required', security_review_reason = 'finalization_without_active_reservation'
     where id = v_intent.id;
    update public.checkout_sessions
       set status = 'manual_review_required', manual_review_reason = 'finalization_without_active_reservation'
     where id = v_session.id;
    perform private.open_payment_discrepancy(v_session.business_id, v_intent.id, v_session.id, 'paid_without_order', 'high',
      false, v_intent.provider_payment_id, jsonb_build_object('reason', 'stock_insuficiente', 'missing', v_res -> 'missing'),
      'paid_without_order:' || v_intent.id::text);
    return jsonb_build_object('ok', false, 'manual_review_required', true, 'reason', 'stock_insuficiente');
  end if;
  update public.checkout_sessions
     set expires_at = greatest(expires_at, clock_timestamp() + interval '10 minutes')
   where id = v_session.id;
  v_res := private.finalize_paid_checkout_session_core(v_session.id);
  if coalesce((v_res ->> 'ok')::boolean, false) then
    perform private.resolve_open_discrepancies(v_intent.id, 'paid_without_order', 'order_created');
  end if;
  return v_res;
end $$;
revoke all on function public.finalize_paid_checkout_session(uuid) from public, anon, authenticated;
grant execute on function public.finalize_paid_checkout_session(uuid) to service_role;

-- Caller holds the intent and the session. Used by the operator and by the stuck-checkout sweep.
create function private.advance_paid_checkout(p_checkout_session_id uuid, p_actor uuid, p_source text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_res jsonb;
  v_final jsonb;
begin
  select * into v_session from public.checkout_sessions where id = p_checkout_session_id;
  select * into v_intent from public.payment_intents where checkout_session_id = p_checkout_session_id;
  v_res := private.reserve_for_paid_session(v_session.id);
  if not coalesce((v_res ->> 'ok')::boolean, false) then
    perform private.open_payment_discrepancy(v_session.business_id, v_intent.id, v_session.id, 'paid_without_order', 'high',
      false, v_intent.provider_payment_id, jsonb_build_object('reason', 'stock_insuficiente', 'missing', v_res -> 'missing', 'source', p_source),
      'paid_without_order:' || v_intent.id::text);
    return v_res;
  end if;
  update public.checkout_sessions
     set expires_at = greatest(expires_at, clock_timestamp() + interval '10 minutes'),
         status = 'payment_approved', manual_review_reason = null
   where id = v_session.id;
  update public.payment_intents
     set internal_status = 'approved_order_pending', security_review_reason = null
   where id = v_intent.id and internal_status in ('security_review_required', 'approved');
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (v_intent.id, case when p_actor is null then 'payment.order_auto_recovered' else 'payment.order_recovered_by_operator' end,
          jsonb_build_object('actor_user_id', p_actor, 'source', p_source, 'reservation', v_res));
  v_final := public.finalize_paid_checkout_session(v_session.id);
  return v_final || (v_res - 'ok') || jsonb_build_object('recovered', true);
end $$;

create or replace function public.recover_paid_checkout_order(p_checkout_session_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_business uuid;
  v_intent_id uuid;
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_hold text;
begin
  select s.business_id into v_business from public.checkout_sessions s where s.id = p_checkout_session_id;
  if not found then raise exception 'checkout inexistente' using errcode = 'P0002'; end if;
  if v_actor is null or not public.has_business_role(v_business, array['owner', 'admin']) then
    raise exception 'recuperacion no autorizada' using errcode = '42501';
  end if;
  select pi.id into v_intent_id from public.payment_intents pi where pi.checkout_session_id = p_checkout_session_id;
  if v_intent_id is not null then
    select * into v_intent from public.payment_intents pi where pi.id = v_intent_id for update;
  end if;
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;

  -- Tocar dos veces no puede crear dos pedidos.
  if v_session.completed_order_id is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'order_id', v_session.completed_order_id);
  end if;
  if v_intent_id is null or v_intent.provider_status <> 'approved'
    or v_intent.paid_amount is distinct from v_session.total or v_intent.currency <> 'ARS' then
    raise exception 'este checkout no tiene un cobro aprobado y verificado' using errcode = '55000';
  end if;
  if v_intent.order_id is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'order_id', v_intent.order_id);
  end if;
  if v_intent.internal_status = 'security_review_required'
     and v_intent.security_review_reason not in ('approved_after_reservation_expired', 'finalization_without_active_reservation') then
    raise exception 'la revision de este cobro no es recuperable por el panel' using errcode = '55000';
  end if;
  v_hold := private.payment_financial_hold(v_intent.id);
  if v_hold is not null then
    raise exception 'recuperacion bloqueada: operacion financiera pendiente (%)', v_hold using errcode = '55000';
  end if;
  return private.advance_paid_checkout(v_session.id, v_actor, 'operator');
end $$;

create or replace function public.can_recover_paid_checkout(p_payment_intent_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select exists (
    select 1
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where pi.id = p_payment_intent_id
       and pi.order_id is null
       and cs.completed_order_id is null
       and pi.provider_status = 'approved'
       and pi.paid_amount is not distinct from cs.total
       and pi.internal_status not in ('refunded', 'partially_refunded', 'charged_back', 'completed')
       and not (pi.internal_status = 'security_review_required'
                and pi.security_review_reason not in ('approved_after_reservation_expired', 'finalization_without_active_reservation'))
       and private.payment_financial_hold(pi.id) is null
  ) $$;

-- Re-drives approved-but-unfulfilled purchases (stuck after a crash, or waiting for stock). Idempotent; one failure
-- never stops the rest. Called by the same cron job that expires checkouts.
create function public.retry_stuck_paid_checkouts(p_limit integer default 25) returns integer
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  v_row record;
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_done integer := 0;
  v_res jsonb;
begin
  for v_row in
    select pi.id as intent_id, pi.checkout_session_id
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where pi.order_id is null and cs.completed_order_id is null
       and pi.provider_status = 'approved' and pi.paid_amount is not distinct from cs.total
       and (pi.internal_status = 'approved_order_pending'
            or (pi.internal_status = 'security_review_required'
                and pi.security_review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation')))
       and cs.status in ('payment_approved', 'manual_review_required', 'finalizing_order')
       and pi.updated_at < clock_timestamp() - interval '45 seconds'
     order by pi.updated_at
     limit greatest(1, least(coalesce(p_limit, 25), 100))
  loop
    begin
      select * into v_intent from public.payment_intents where id = v_row.intent_id for update skip locked;
      if not found then continue; end if;
      select * into v_session from public.checkout_sessions where id = v_row.checkout_session_id for update skip locked;
      if not found or v_session.completed_order_id is not null then continue; end if;
      if private.payment_financial_hold(v_intent.id) is not null then continue; end if;
      v_res := private.advance_paid_checkout(v_session.id, null, 'sweep');
      if coalesce((v_res ->> 'order_id') is not null, false) then v_done := v_done + 1; end if;
    exception when others then
      -- One bad row must not hide the others. The discrepancy / alert layer shows rows that stay stuck.
      insert into public.payment_events (payment_intent_id, event_type, details)
      values (v_row.intent_id, 'payment.auto_recovery_failed', jsonb_build_object('sqlstate', sqlstate, 'message', left(sqlerrm, 200)));
    end;
  end loop;
  return v_done;
end $$;
revoke all on function public.retry_stuck_paid_checkouts(integer) from public, anon, authenticated;
grant execute on function public.retry_stuck_paid_checkouts(integer) to service_role;

create or replace function public.sweep_expired_checkout_sessions() returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_released integer;
begin
  v_released := public.expire_checkout_sessions(200);
  perform public.retry_stuck_paid_checkouts(25);
  return coalesce(v_released, 0);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. The snapshot: payment identity by what it is, refunds by identity, stuck states healed transactionally
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.record_mercadopago_payment_snapshot(
  p_payment_intent_id uuid, p_snapshot jsonb, p_source text, p_webhook_receipt_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $function$
declare
  v_intent public.payment_intents%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_pay public.payment_provider_payments%rowtype;
  v_other public.payment_provider_payments%rowtype;
  v_status text;
  v_next text;
  v_effective text;
  v_amount numeric(12, 2);
  v_refunded numeric(12, 2);
  v_total_refunded numeric(12, 2);
  v_currency text;
  v_provider_time timestamptz;
  v_valid boolean := true;
  v_reason text;
  v_finalize boolean := false;
  v_pid text;
  v_seller text;
  v_money boolean;
  v_apply boolean := false;
  v_pay_found boolean;
  v_foreign boolean;
  v_hold text;
  v_res jsonb;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
    or coalesce(p_snapshot ->> 'raw_response_hash', '') !~ '^[a-f0-9]{64}$' then
    raise exception 'snapshot de pago invalido' using errcode = '22023';
  end if;
  -- I6: intent first, then session.
  select * into v_intent from public.payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  select * into v_session from public.checkout_sessions s where s.id = v_intent.checkout_session_id for update;
  select * into v_settings from public.business_payment_settings ps
   where ps.business_id = v_intent.business_id and ps.provider = 'mercadopago' for share;
  v_status := lower(btrim(coalesce(p_snapshot ->> 'status', '')));
  v_currency := upper(btrim(coalesce(p_snapshot ->> 'currency', '')));
  v_amount := nullif(p_snapshot ->> 'transaction_amount', '')::numeric(12, 2);
  v_refunded := coalesce(nullif(p_snapshot ->> 'refunded_amount', '')::numeric(12, 2), 0);
  v_pid := nullif(btrim(coalesce(p_snapshot ->> 'provider_payment_id', '')), '');
  v_seller := coalesce(nullif(btrim(coalesce(p_snapshot ->> 'collector_id', '')), ''), v_settings.collector_id, 'unknown');
  begin
    v_provider_time := coalesce(nullif(p_snapshot ->> 'provider_occurred_at', '')::timestamptz, clock_timestamp());
  exception when others then
    v_provider_time := clock_timestamp();
  end;
  v_money := v_status in ('approved', 'refunded', 'charged_back');

  if v_pid is null then
    v_valid := false; v_reason := 'payment_id_missing';
  elsif p_snapshot ->> 'external_reference' is distinct from v_intent.external_reference then
    v_valid := false; v_reason := 'external_reference_mismatch';
  -- An EMPTY preference is "not verified yet" (the provider lookup that carries it may be down), handled below as a
  -- retry. Only a different, non-empty preference proves the payment belongs to another checkout.
  elsif nullif(btrim(coalesce(v_intent.preference_id, '')), '') is not null
    and nullif(btrim(coalesce(p_snapshot ->> 'preference_id', '')), '') is not null
    and btrim(p_snapshot ->> 'preference_id') is distinct from v_intent.preference_id then
    v_valid := false; v_reason := 'preference_mismatch';
  elsif v_settings.collector_id is null or p_snapshot ->> 'collector_id' is distinct from v_settings.collector_id then
    v_valid := false; v_reason := 'collector_mismatch';
  elsif nullif(btrim(coalesce(p_snapshot ->> 'application_id', '')), '') is not null
    and p_snapshot ->> 'application_id' is distinct from coalesce(v_settings.application_id, '') then
    v_valid := false; v_reason := 'application_mismatch';
  elsif v_currency <> 'ARS' or v_currency <> v_intent.currency then
    v_valid := false; v_reason := 'currency_mismatch';
  elsif v_amount is null or v_amount <> v_intent.expected_amount then
    v_valid := false; v_reason := 'amount_mismatch';
  elsif v_intent.environment = 'production'
    and coalesce((p_snapshot ->> 'live_mode')::boolean, false) is not true then
    v_valid := false; v_reason := 'live_mode_mismatch';
  elsif v_status not in ('approved', 'pending', 'in_process', 'authorized', 'rejected', 'cancelled', 'canceled', 'expired', 'refunded', 'charged_back') then
    v_valid := false; v_reason := 'unknown_provider_status';
  elsif exists (select 1 from public.payment_provider_payments x
                 where x.provider = 'mercadopago' and x.environment = v_intent.environment
                   and x.seller_id = v_seller and x.provider_payment_id = v_pid
                   and x.payment_intent_id <> v_intent.id) then
    v_valid := false; v_reason := 'payment_bound_to_other_checkout';
  end if;

  if not v_valid then
    -- A defective payment that is NOT the one funding this intent must not poison a healthy purchase.
    v_foreign := v_intent.provider_payment_id is not null and v_pid is distinct from v_intent.provider_payment_id
                 and (v_intent.order_id is not null or v_intent.paid_amount is not null);
    if v_pid is not null and v_reason <> 'payment_bound_to_other_checkout' then
      insert into public.payment_provider_payments (payment_intent_id, environment, seller_id, provider_payment_id, status,
        amount, currency, provider_event_at, raw_response_hash, validation_error)
      values (v_intent.id, v_intent.environment, v_seller, v_pid, coalesce(nullif(v_status, ''), 'unknown'),
        v_amount, v_currency, v_provider_time, p_snapshot ->> 'raw_response_hash', v_reason)
      on conflict (provider, environment, seller_id, provider_payment_id) do update
        set last_seen_at = clock_timestamp(), validation_error = excluded.validation_error;
    end if;
    -- A defective payment foreign to a purchase that is already funded must be visible, but it cannot hold the
    -- legitimate payment's order hostage.
    perform private.open_payment_discrepancy(v_intent.business_id, v_intent.id, v_session.id, 'provider_payment_inconsistent',
      'critical', not v_foreign, v_pid, jsonb_build_object('reason', v_reason, 'source', p_source, 'status', v_status,
        'amount', v_amount, 'currency', v_currency, 'foreign_to_intent_payment', v_foreign),
      'inconsistent:' || v_intent.id::text || ':' || coalesce(v_pid, 'none') || ':' || v_reason,
      null, v_seller, v_intent.environment);
    if v_foreign then
      return jsonb_build_object('ok', false, 'manual_review_required', false, 'discrepancy', true, 'reason', v_reason, 'finalize_required', false);
    end if;
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = v_reason,
      raw_response_hash = p_snapshot ->> 'raw_response_hash' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = v_reason where id = v_session.id;
    insert into public.payment_events (payment_intent_id, webhook_receipt_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
    values (v_intent.id, p_webhook_receipt_id, 'payment.security_review_required', v_status,
      nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, p_snapshot ->> 'raw_response_hash', jsonb_build_object('reason', v_reason, 'source', p_source));
    return jsonb_build_object('ok', false, 'manual_review_required', true, 'reason', v_reason, 'finalize_required', false);
  end if;

  if nullif(btrim(coalesce(v_intent.preference_id, '')), '') is not null
     and nullif(btrim(coalesce(p_snapshot ->> 'preference_id', '')), '') is null then
    -- Transient by definition: the same facts will validate on the next read. Nothing is changed and nothing is blocked.
    insert into public.payment_events (payment_intent_id, webhook_receipt_id, event_type, provider_status, provider_occurred_at, raw_response_hash, details)
    values (v_intent.id, p_webhook_receipt_id, 'payment.preference_unverified', v_status, v_provider_time,
      p_snapshot ->> 'raw_response_hash', jsonb_build_object('source', p_source, 'payment_id', v_pid));
    return jsonb_build_object('ok', false, 'retryable', true, 'reason', 'preference_unverified',
      'manual_review_required', false, 'finalize_required', false);
  end if;

  -- Store this payment resource on its own row; versions of the SAME resource only move forward.
  select * into v_pay from public.payment_provider_payments x
   where x.provider = 'mercadopago' and x.environment = v_intent.environment
     and x.seller_id = v_seller and x.provider_payment_id = v_pid for update;
  v_pay_found := found;
  if not v_pay_found then
    insert into public.payment_provider_payments (payment_intent_id, environment, seller_id, provider_payment_id, status,
      status_detail, amount, currency, refunded_amount, provider_event_at, raw_response_hash)
    values (v_intent.id, v_intent.environment, v_seller, v_pid, v_status, nullif(p_snapshot ->> 'status_detail', ''),
      v_amount, v_currency, v_refunded, v_provider_time, p_snapshot ->> 'raw_response_hash')
    returning * into v_pay;
  elsif private.provider_payment_status_rank(v_status) > private.provider_payment_status_rank(v_pay.status)
     or (private.provider_payment_status_rank(v_status) = private.provider_payment_status_rank(v_pay.status)
         and v_provider_time >= coalesce(v_pay.provider_event_at, '-infinity'::timestamptz)) then
    update public.payment_provider_payments
       set status = v_status, status_detail = nullif(p_snapshot ->> 'status_detail', ''), amount = v_amount,
           currency = v_currency, refunded_amount = greatest(refunded_amount, v_refunded),
           provider_event_at = greatest(coalesce(provider_event_at, '-infinity'::timestamptz), v_provider_time),
           last_seen_at = clock_timestamp(), raw_response_hash = p_snapshot ->> 'raw_response_hash', validation_error = null
     where id = v_pay.id
     returning * into v_pay;
  else
    update public.payment_provider_payments set last_seen_at = clock_timestamp() where id = v_pay.id;
    insert into public.payment_events (payment_intent_id, webhook_receipt_id, provider_event_id, event_type, provider_status, provider_occurred_at, raw_response_hash, details)
    values (v_intent.id, p_webhook_receipt_id, v_pid, 'payment.stale_snapshot_ignored', v_status, v_provider_time,
      p_snapshot ->> 'raw_response_hash', jsonb_build_object('stored_status', v_pay.status, 'source', p_source));
    return jsonb_build_object('ok', true, 'stale', true, 'payment_intent_id', v_intent.id,
      'internal_status', v_intent.internal_status, 'manual_review_required', false,
      'finalize_required', v_intent.internal_status = 'approved_order_pending' and v_session.status = 'payment_approved');
  end if;

  -- Which payment speaks for the intent? What it is decides (money moved), not when it arrived.
  if v_intent.provider_payment_id is null or v_intent.provider_payment_id = v_pid then
    v_apply := true;
  else
    select * into v_other from public.payment_provider_payments x
     where x.payment_intent_id = v_intent.id and x.provider_payment_id = v_intent.provider_payment_id
     order by x.first_seen_at limit 1;
    if coalesce(v_other.is_financing, false) then
      v_apply := false;
      if v_money then
        -- Critical and visible, but the first payment still funds its order: the surplus is refunded by an operator.
        perform private.open_payment_discrepancy(v_intent.business_id, v_intent.id, v_session.id, 'multiple_approved_payments',
          'critical', false, v_pid, jsonb_build_object('financing_payment_id', v_intent.provider_payment_id, 'other_payment_id', v_pid,
            'other_status', v_status, 'amount', v_amount, 'source', p_source),
          'multiple_money:' || v_intent.id::text || ':' || v_pid, null, v_seller, v_intent.environment);
      end if;
    elsif v_money then
      v_apply := true;
    else
      v_apply := v_provider_time >= coalesce(v_intent.provider_event_at, '-infinity'::timestamptz);
    end if;
  end if;

  if not v_apply then
    insert into public.payment_events (payment_intent_id, webhook_receipt_id, provider_event_id, event_type, provider_status, provider_occurred_at, raw_response_hash, details)
    values (v_intent.id, p_webhook_receipt_id, v_pid, 'payment.' || v_status, v_status, v_provider_time,
      p_snapshot ->> 'raw_response_hash', jsonb_build_object('source', p_source, 'applied_to_intent', false));
    return jsonb_build_object('ok', true, 'ignored_for_intent', true, 'payment_intent_id', v_intent.id,
      'internal_status', v_intent.internal_status, 'manual_review_required', false, 'finalize_required', false);
  end if;

  if v_money then
    update public.payment_provider_payments set is_financing = false
     where payment_intent_id = v_intent.id and is_financing and id <> v_pay.id;
    update public.payment_provider_payments set is_financing = true where id = v_pay.id and not is_financing;
    v_total_refunded := private.reconcile_payment_refunds(v_intent.id, v_status, v_amount, v_refunded, p_snapshot -> 'refunds', v_provider_time);
  else
    v_total_refunded := v_intent.refunded_amount;
  end if;

  v_next := case v_status
    when 'approved' then case when v_total_refunded >= v_amount then 'refunded' when v_total_refunded > 0 then 'partially_refunded' else 'approved_order_pending' end
    when 'pending' then 'pending'
    when 'in_process' then 'in_process'
    when 'authorized' then 'in_process'
    when 'rejected' then 'rejected'
    when 'cancelled' then 'cancelled'
    when 'canceled' then 'cancelled'
    when 'expired' then 'expired'
    when 'refunded' then 'refunded'
    when 'charged_back' then 'charged_back'
    else 'ambiguous'
  end;
  v_effective := case when public.payment_internal_status_rank(v_next) >= public.payment_internal_status_rank(v_intent.internal_status)
    then v_next else v_intent.internal_status end;

  update public.payment_intents set
    provider_payment_id = v_pid,
    provider_merchant_order_id = coalesce(nullif(p_snapshot ->> 'merchant_order_id', ''), provider_merchant_order_id),
    provider_status = v_status,
    provider_status_detail = nullif(p_snapshot ->> 'status_detail', ''),
    provider_payment_method = coalesce(nullif(p_snapshot ->> 'payment_method', ''), provider_payment_method),
    provider_event_at = greatest(coalesce(provider_event_at, '-infinity'::timestamptz), v_provider_time),
    paid_amount = case when v_money then v_amount else paid_amount end,
    payer_email_hash = nullif(p_snapshot ->> 'payer_email_hash', ''), live_mode = (p_snapshot ->> 'live_mode')::boolean,
    approved_at = case when v_money then coalesce(approved_at, v_provider_time) else approved_at end,
    rejected_at = case when v_status in ('rejected', 'cancelled', 'canceled', 'expired') then coalesce(rejected_at, v_provider_time) else rejected_at end,
    internal_status = v_effective,
    raw_response_hash = p_snapshot ->> 'raw_response_hash'
  where id = v_intent.id;
  insert into public.payment_events (payment_intent_id, webhook_receipt_id, provider_event_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
  values (v_intent.id, p_webhook_receipt_id, v_pid, 'payment.' || v_status,
    v_status, nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, p_snapshot ->> 'raw_response_hash', jsonb_build_object('source', p_source));

  if v_status = 'approved' and v_effective = 'approved_order_pending' then
    v_hold := private.payment_financial_hold(v_intent.id);
    if v_hold is not null then
      update public.checkout_sessions
         set status = 'manual_review_required', manual_review_reason = left('financial_hold:' || v_hold, 120)
       where id = v_session.id;
      perform private.open_payment_discrepancy(v_intent.business_id, v_intent.id, v_session.id, 'paid_without_order', 'high',
        false, v_pid, jsonb_build_object('hold', v_hold, 'stage', 'snapshot'), 'paid_without_order:' || v_intent.id::text);
      return jsonb_build_object('ok', true, 'manual_review_required', true, 'hold', v_hold, 'finalize_required', false);
    end if;
    -- Stock is still held (reservation active even if its clock ran out) or can be re-taken in this very transaction.
    v_res := private.reserve_for_paid_session(v_session.id);
    if not coalesce((v_res ->> 'ok')::boolean, false) then
      update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'approved_after_reservation_expired' where id = v_intent.id;
      update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'approved_after_reservation_expired' where id = v_session.id;
      insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash)
      values (v_intent.id, 'payment.manual_review_required',
        jsonb_build_object('reason', 'approved_after_reservation_expired', 'detail', v_res), p_snapshot ->> 'raw_response_hash');
      perform private.open_payment_discrepancy(v_intent.business_id, v_intent.id, v_session.id, 'paid_without_order', 'high',
        false, v_pid, jsonb_build_object('reason', 'stock_insuficiente', 'missing', v_res -> 'missing', 'stage', 'snapshot'),
        'paid_without_order:' || v_intent.id::text);
      return jsonb_build_object('ok', true, 'manual_review_required', true, 'finalize_required', false);
    end if;
    update public.checkout_sessions
       set status = 'payment_approved', manual_review_reason = null,
           expires_at = greatest(expires_at, clock_timestamp() + interval '10 minutes')
     where id = v_session.id;
    v_finalize := true;
  elsif v_status in ('pending', 'in_process', 'authorized') then
    update public.checkout_sessions set status = case when status in ('ready_for_payment', 'redirected') then 'payment_pending' else status end where id = v_session.id;
  elsif v_status = 'expired' then
    perform public.release_checkout_session_inventory(v_session.id, 'provider_expired', 'expired');
  elsif v_status = 'rejected' and v_session.expires_at > clock_timestamp() then
    update public.checkout_sessions
       set status = case when status in ('ready_for_payment', 'redirected') then 'payment_pending' else status end
     where id = v_session.id;
  elsif v_status in ('rejected', 'cancelled', 'canceled') then
    perform public.release_checkout_session_inventory(v_session.id, 'provider_' || v_status, 'cancelled');
  end if;
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'internal_status', v_effective,
    'manual_review_required', false, 'finalize_required', v_finalize);
end $function$;
