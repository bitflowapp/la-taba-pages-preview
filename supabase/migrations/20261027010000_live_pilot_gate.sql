-- Closed-pilot gate for real-money payments (v171).
--
-- Until a business is explicitly opened to the public, a PRODUCTION payment intent can be created for exactly ONE
-- purchase that a person with authority wrote down beforehand: who buys, which products, the exact total in ARS and
-- which Mercado Pago account must receive the money. The "final key" (MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION) is a
-- platform-wide switch and says nothing about WHAT may be bought; this gate does, in the database, so no Edge Function,
-- script or storefront bug can open real payments to the public by accident.
--
--   * Default is closed: a production business with no payment_live_scope row is in 'pilot'.
--   * 'public' is a deliberate act (set_live_payment_scope with a typed confirmation) and is logged.
--   * An authorization is consumed by the payment intent it allows. If that purchase is abandoned, nothing else can be
--     bought until a new authorization is written: the cost of a retry is one more signature, never an open door.
--   * Every check runs inside the checkout-session transaction: a rejected purchase also returns its stock.
--
-- Only the service role can write. Nothing here moves money, creates preferences or touches provider credentials.

create table public.payment_live_scope (
  business_id uuid not null references public.businesses(id) on delete restrict,
  environment text not null,
  scope text not null,
  changed_at timestamptz not null default clock_timestamp(),
  changed_by text not null,
  primary key (business_id, environment),
  constraint payment_live_scope_environment_check check (environment in ('test', 'production')),
  constraint payment_live_scope_scope_check check (scope in ('pilot', 'public')),
  constraint payment_live_scope_changed_by_check check (length(btrim(changed_by)) between 3 and 120)
);

create table public.payment_live_scope_log (
  id bigint generated always as identity primary key,
  business_id uuid not null,
  environment text not null,
  scope text not null,
  changed_by text not null,
  changed_at timestamptz not null default clock_timestamp()
);

create table public.payment_live_pilot_authorizations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  environment text not null,
  status text not null default 'authorized',
  -- What may be bought.
  customer_id uuid not null,
  items jsonb not null,
  amount numeric(12, 2) not null,
  currency text not null default 'ARS',
  concept text not null,
  -- Who receives and who pays.
  seller_collector_id text not null,
  seller_holder text not null,
  buyer_account text not null,
  -- How it is settled and undone.
  fee_bearer text not null,
  refund_plan text not null,
  abort_conditions text not null,
  -- Who decided, and the digest of the signed document.
  authorized_by text not null,
  authorization_sha256 text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  -- Life cycle.
  consumed_at timestamptz,
  consumed_by_intent_id uuid,
  consumed_checkout_session_id uuid,
  aborted_at timestamptz,
  abort_reason text,
  expired_at timestamptz,
  constraint payment_live_pilot_environment_check check (environment in ('test', 'production')),
  constraint payment_live_pilot_status_check check (status in ('authorized', 'consumed', 'aborted', 'expired')),
  constraint payment_live_pilot_currency_check check (currency = 'ARS'),
  constraint payment_live_pilot_amount_check check (amount > 0 and amount <= 50000),
  constraint payment_live_pilot_items_check check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 5),
  constraint payment_live_pilot_concept_check check (length(btrim(concept)) between 5 and 200),
  constraint payment_live_pilot_seller_check check (seller_collector_id ~ '^[1-9][0-9]{4,19}$'),
  constraint payment_live_pilot_holder_check check (length(btrim(seller_holder)) between 3 and 160),
  constraint payment_live_pilot_buyer_check check (length(btrim(buyer_account)) between 3 and 160),
  constraint payment_live_pilot_fee_bearer_check check (fee_bearer in ('seller', 'integrator')),
  constraint payment_live_pilot_refund_plan_check check (refund_plan in ('api', 'seller_panel')),
  constraint payment_live_pilot_abort_check check (length(btrim(abort_conditions)) >= 20),
  constraint payment_live_pilot_authorized_by_check check (length(btrim(authorized_by)) between 3 and 160),
  constraint payment_live_pilot_digest_check check (authorization_sha256 ~ '^[a-f0-9]{64}$'),
  constraint payment_live_pilot_lifetime_check check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  constraint payment_live_pilot_buyer_not_seller_check check (lower(btrim(buyer_account)) <> seller_collector_id),
  constraint payment_live_pilot_consumed_check check (
    (status = 'consumed') = (consumed_at is not null and consumed_by_intent_id is not null)),
  constraint payment_live_pilot_aborted_check check ((status = 'aborted') = (aborted_at is not null))
);

-- At most one open authorization per business and environment: two cannot race for the same open door.
create unique index payment_live_pilot_one_open_idx
  on public.payment_live_pilot_authorizations (business_id, environment) where status = 'authorized';
create index payment_live_pilot_business_idx
  on public.payment_live_pilot_authorizations (business_id, environment, created_at desc);

alter table public.payment_live_scope enable row level security;
alter table public.payment_live_scope_log enable row level security;
alter table public.payment_live_pilot_authorizations enable row level security;
revoke all on public.payment_live_scope, public.payment_live_scope_log, public.payment_live_pilot_authorizations
  from public, anon, authenticated;
-- La plataforma otorga por defecto todos los privilegios de las tablas nuevas a service_role: aquí se le dejan sólo las lecturas.
-- Escribe únicamente a través de las funciones de abajo (SECURITY DEFINER), que validan los términos contra el catálogo y el vendedor.
revoke insert, update, delete, truncate, references, trigger
  on public.payment_live_scope, public.payment_live_scope_log, public.payment_live_pilot_authorizations from service_role;
grant select on public.payment_live_scope, public.payment_live_scope_log, public.payment_live_pilot_authorizations
  to service_role;

-- An authorization is a record, not a setting: its terms never change and it is never deleted. Only the life cycle moves,
-- and only forward from 'authorized'. The scope log is append-only.
create function public.payment_live_pilot_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  v_mutable constant text[] := array['status', 'consumed_at', 'consumed_by_intent_id', 'consumed_checkout_session_id',
                                     'aborted_at', 'abort_reason', 'expired_at'];
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception '% is append-only', tg_table_name using errcode = '42501';
  end if;
  if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
    raise exception 'the terms of a live pilot authorization cannot change' using errcode = '42501';
  end if;
  if old.status <> 'authorized' and new.status is distinct from old.status then
    raise exception 'a % live pilot authorization cannot change state', old.status using errcode = '55000';
  end if;
  return new;
end $$;
create trigger payment_live_pilot_immutable_trg
  before update or delete on public.payment_live_pilot_authorizations
  for each row execute function public.payment_live_pilot_immutable();
create trigger payment_live_pilot_no_truncate_trg
  before truncate on public.payment_live_pilot_authorizations
  for each statement execute function public.payment_live_pilot_immutable();

create function public.payment_live_scope_log_append_only() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  raise exception 'payment_live_scope_log is append-only' using errcode = '42501';
end $$;
create trigger payment_live_scope_log_append_only_trg
  before update or delete on public.payment_live_scope_log
  for each row execute function public.payment_live_scope_log_append_only();
create trigger payment_live_scope_log_no_truncate_trg
  before truncate on public.payment_live_scope_log
  for each statement execute function public.payment_live_scope_log_append_only();

-- Does the pilot lock apply to this business and environment? Production defaults to closed; a test environment is
-- locked only when someone put it in 'pilot' explicitly (so QA can rehearse the gate without touching other tests).
create function public.live_pilot_applies(p_business_id uuid, p_environment text)
returns boolean
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select case
    when exists (select 1 from public.payment_live_scope s
                  where s.business_id = p_business_id and s.environment = p_environment and s.scope = 'public') then false
    when p_environment = 'production' then true
    else exists (select 1 from public.payment_live_scope s
                  where s.business_id = p_business_id and s.environment = p_environment and s.scope = 'pilot')
  end;
$$;

-- The gate. It runs when the payment intent of a checkout session is created, after the session has its items, total and
-- stock reservation, inside the same transaction: raising here aborts the whole checkout and returns the stock.
create function public.enforce_live_pilot_payment_intent() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_auth public.payment_live_pilot_authorizations%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_items jsonb;
begin
  if not public.live_pilot_applies(new.business_id, new.environment) then return null; end if;

  select * into v_auth from public.payment_live_pilot_authorizations a
   where a.business_id = new.business_id and a.environment = new.environment and a.status = 'authorized'
   for update;
  if not found then
    raise exception 'LIVE_PILOT_NOT_AUTHORIZED' using errcode = '55000',
      detail = 'the business is in closed-pilot mode and has no open authorization';
  end if;
  if v_auth.expires_at <= clock_timestamp() then
    raise exception 'LIVE_PILOT_AUTHORIZATION_EXPIRED' using errcode = '55000';
  end if;

  select * into v_session from public.checkout_sessions where id = new.checkout_session_id;
  if v_session.customer_id is distinct from v_auth.customer_id then
    raise exception 'LIVE_PILOT_CUSTOMER_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v_session.fulfillment_type <> 'pickup' or v_session.delivery_fee <> 0 or v_session.discount_total <> 0
     or exists (select 1 from public.checkout_session_combos c where c.checkout_session_id = v_session.id) then
    raise exception 'LIVE_PILOT_ITEMS_MISMATCH' using errcode = '55000',
      detail = 'the pilot purchase is a plain pickup of the authorized products';
  end if;
  if new.expected_amount is distinct from v_auth.amount or v_session.total is distinct from v_auth.amount
     or new.currency <> v_auth.currency then
    raise exception 'LIVE_PILOT_AMOUNT_MISMATCH' using errcode = '55000';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'quantity', i.quantity)
                            order by i.product_id), '[]'::jsonb)
    into v_items from public.checkout_session_items i where i.checkout_session_id = v_session.id;
  if v_items is distinct from v_auth.items then
    raise exception 'LIVE_PILOT_ITEMS_MISMATCH' using errcode = '55000';
  end if;

  select * into v_settings from public.business_payment_settings s
   where s.business_id = new.business_id and s.provider = 'mercadopago';
  if v_settings.collector_id is distinct from v_auth.seller_collector_id
     or not exists (select 1 from public.mp_seller_connections c
                     where c.business_id = new.business_id and c.environment = new.environment
                       and c.status = 'connected' and c.seller_id = v_auth.seller_collector_id) then
    raise exception 'LIVE_PILOT_SELLER_MISMATCH' using errcode = '55000';
  end if;

  update public.payment_live_pilot_authorizations
     set status = 'consumed', consumed_at = clock_timestamp(),
         consumed_by_intent_id = new.id, consumed_checkout_session_id = new.checkout_session_id
   where id = v_auth.id;
  return null;
end $$;
create constraint trigger payment_live_pilot_gate_trg
  after insert on public.payment_intents
  deferrable initially immediate
  for each row execute function public.enforce_live_pilot_payment_intent();

-- Writing an authorization. It validates the terms against the live catalog and the live seller connection, so a typo in
-- the document is caught before any buyer can act on it. Service role only.
create function public.authorize_live_pilot_payment(
  p_business_id uuid, p_environment text, p_customer_id uuid, p_items jsonb, p_amount numeric,
  p_concept text, p_seller_collector_id text, p_seller_holder text, p_buyer_account text,
  p_fee_bearer text, p_refund_plan text, p_abort_conditions text,
  p_authorized_by text, p_authorization_sha256 text, p_valid_minutes integer
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_settings public.business_payment_settings%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_total numeric(12, 2) := 0;
  v_normalized jsonb;
  v_row public.payment_live_pilot_authorizations%rowtype;
begin
  if p_environment not in ('test', 'production') then
    raise exception 'environment must be test or production' using errcode = '22023';
  end if;
  if not public.live_pilot_applies(p_business_id, p_environment) then
    raise exception 'the business is not in closed-pilot mode for %', p_environment using errcode = '55000';
  end if;
  if p_valid_minutes is null or p_valid_minutes not between 5 and 1440 then
    raise exception 'an authorization lasts between 5 minutes and 24 hours' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a list' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_customer_id) then
    raise exception 'the authorized customer does not exist' using errcode = 'P0002';
  end if;

  select * into v_settings from public.business_payment_settings s
   where s.business_id = p_business_id and s.provider = 'mercadopago';
  if not found or not v_settings.enabled or v_settings.environment <> p_environment
     or (p_environment = 'production' and v_settings.production_review_status <> 'approved') then
    raise exception 'Mercado Pago is not switched on for this business and environment' using errcode = '55000';
  end if;
  if v_settings.collector_id is distinct from p_seller_collector_id
     or not exists (select 1 from public.mp_seller_connections c
                     where c.business_id = p_business_id and c.environment = p_environment and c.status = 'connected'
                       and c.seller_id = p_seller_collector_id and c.application_id = v_settings.application_id) then
    raise exception 'the seller account is not the one connected to this business' using errcode = '55000';
  end if;

  -- Canonical item list: sorted by product, one line per product, priced from the live catalog.
  select coalesce(jsonb_agg(jsonb_build_object('product_id', t.product_id, 'quantity', t.quantity)
                            order by t.product_id), '[]'::jsonb)
    into v_normalized
    from jsonb_to_recordset(p_items) as t(product_id uuid, quantity integer);
  if jsonb_array_length(v_normalized) <> jsonb_array_length(p_items)
     or (select count(distinct (e ->> 'product_id')) from jsonb_array_elements(v_normalized) e) <> jsonb_array_length(v_normalized) then
    raise exception 'items must be unique products with a quantity' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_to_recordset(v_normalized) as t(product_id uuid, quantity integer) loop
    if v_item.quantity is null or v_item.quantity not between 1 and 10 then
      raise exception 'quantity must be between 1 and 10' using errcode = '22023';
    end if;
    select * into v_product from public.products p where p.id = v_item.product_id and p.business_id = p_business_id;
    if not found or not v_product.is_active or not v_product.available or v_product.price_status <> 'confirmed'
       or v_product.price is null or v_product.price <= 0 or coalesce(v_product.is_alcoholic, false)
       or coalesce(v_product.stock, 0) < v_item.quantity then
      raise exception 'product % is not sellable for the pilot (inactive, no stock, alcohol or unconfirmed price)',
        v_item.product_id using errcode = '55000';
    end if;
    v_total := v_total + v_product.price * v_item.quantity;
  end loop;
  if v_total <> p_amount then
    raise exception 'the amount (%) is not the live catalog total (%)', p_amount, v_total using errcode = '55000';
  end if;

  -- Nothing else may be in flight: the pilot is one isolated purchase.
  update public.payment_live_pilot_authorizations
     set status = 'expired', expired_at = clock_timestamp()
   where business_id = p_business_id and environment = p_environment and status = 'authorized'
     and expires_at <= clock_timestamp();
  if exists (select 1 from public.checkout_sessions c
             where c.business_id = p_business_id and c.status in ('ready_for_payment', 'redirected', 'payment_pending')
               and c.expires_at > clock_timestamp()) then
    raise exception 'there is a checkout in flight for this business' using errcode = '55000';
  end if;

  insert into public.payment_live_pilot_authorizations (
    business_id, environment, customer_id, items, amount, concept, seller_collector_id, seller_holder,
    buyer_account, fee_bearer, refund_plan, abort_conditions, authorized_by, authorization_sha256, expires_at
  ) values (
    p_business_id, p_environment, p_customer_id, v_normalized, p_amount, btrim(p_concept), p_seller_collector_id,
    btrim(p_seller_holder), btrim(p_buyer_account), p_fee_bearer, p_refund_plan, btrim(p_abort_conditions),
    btrim(p_authorized_by), p_authorization_sha256, clock_timestamp() + make_interval(mins => p_valid_minutes)
  ) returning * into v_row;

  return jsonb_build_object('authorization_id', v_row.id, 'status', v_row.status, 'amount', v_row.amount,
                            'currency', v_row.currency, 'expires_at', v_row.expires_at);
end $$;

-- Closing the door again, before or after the purchase window. A consumed authorization cannot be aborted: its purchase
-- exists and is undone through the refund procedure, never by editing the record.
create function public.abort_live_pilot_payment(p_authorization_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_row public.payment_live_pilot_authorizations%rowtype;
begin
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'an abort needs a reason' using errcode = '22023';
  end if;
  select * into v_row from public.payment_live_pilot_authorizations where id = p_authorization_id for update;
  if not found then raise exception 'authorization not found' using errcode = 'P0002'; end if;
  if v_row.status = 'consumed' then
    raise exception 'the authorization was consumed: use the refund procedure' using errcode = '55000';
  end if;
  if v_row.status = 'authorized' then
    update public.payment_live_pilot_authorizations
       set status = 'aborted', aborted_at = clock_timestamp(), abort_reason = btrim(p_reason)
     where id = p_authorization_id returning * into v_row;
  end if;
  return jsonb_build_object('authorization_id', v_row.id, 'status', v_row.status);
end $$;

-- Opening to the public is a separate, typed, logged decision. Closing it again needs no confirmation.
create function public.set_live_payment_scope(
  p_business_id uuid, p_environment text, p_scope text, p_changed_by text, p_confirmation text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_environment not in ('test', 'production') or p_scope not in ('pilot', 'public') then
    raise exception 'invalid environment or scope' using errcode = '22023';
  end if;
  if p_scope = 'public' and p_confirmation is distinct from 'I_AUTHORIZE_PUBLIC_REAL_PAYMENTS' then
    raise exception 'opening real payments to the public needs the typed confirmation' using errcode = '22023';
  end if;
  if not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'business not found' using errcode = 'P0002';
  end if;
  insert into public.payment_live_scope (business_id, environment, scope, changed_by)
  values (p_business_id, p_environment, p_scope, p_changed_by)
  on conflict (business_id, environment)
  do update set scope = excluded.scope, changed_by = excluded.changed_by, changed_at = clock_timestamp();
  insert into public.payment_live_scope_log (business_id, environment, scope, changed_by)
  values (p_business_id, p_environment, p_scope, p_changed_by);
  return jsonb_build_object('business_id', p_business_id, 'environment', p_environment, 'scope', p_scope);
end $$;

-- What the operator sees: the scope and the latest authorizations, without personal data beyond what the operator wrote.
create function public.get_live_pilot_status(p_business_id uuid, p_environment text)
returns jsonb
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select jsonb_build_object(
    'business_id', p_business_id,
    'environment', p_environment,
    'pilot_lock_applies', public.live_pilot_applies(p_business_id, p_environment),
    'scope', coalesce((select s.scope from public.payment_live_scope s
                        where s.business_id = p_business_id and s.environment = p_environment),
                      case when p_environment = 'production' then 'pilot (default)' else 'public (no lock)' end),
    'authorizations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'status', case when a.status = 'authorized' and a.expires_at <= clock_timestamp() then 'expired' else a.status end,
        'amount', a.amount, 'currency', a.currency, 'concept', a.concept, 'items', a.items,
        'seller_collector_id', a.seller_collector_id, 'fee_bearer', a.fee_bearer, 'refund_plan', a.refund_plan,
        'authorization_sha256', a.authorization_sha256, 'created_at', a.created_at, 'expires_at', a.expires_at,
        'consumed_at', a.consumed_at, 'consumed_by_intent_id', a.consumed_by_intent_id,
        'consumed_checkout_session_id', a.consumed_checkout_session_id, 'aborted_at', a.aborted_at,
        'abort_reason', a.abort_reason) order by a.created_at desc)
      from (select * from public.payment_live_pilot_authorizations x
             where x.business_id = p_business_id and x.environment = p_environment
             order by x.created_at desc limit 5) a), '[]'::jsonb));
$$;

revoke all on function
  public.live_pilot_applies(uuid, text),
  public.enforce_live_pilot_payment_intent(),
  public.payment_live_pilot_immutable(),
  public.payment_live_scope_log_append_only(),
  public.authorize_live_pilot_payment(uuid, text, uuid, jsonb, numeric, text, text, text, text, text, text, text, text, text, integer),
  public.abort_live_pilot_payment(uuid, text),
  public.set_live_payment_scope(uuid, text, text, text, text),
  public.get_live_pilot_status(uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.live_pilot_applies(uuid, text),
  public.authorize_live_pilot_payment(uuid, text, uuid, jsonb, numeric, text, text, text, text, text, text, text, text, text, integer),
  public.abort_live_pilot_payment(uuid, text),
  public.set_live_payment_scope(uuid, text, text, text, text),
  public.get_live_pilot_status(uuid, text)
  to service_role;
