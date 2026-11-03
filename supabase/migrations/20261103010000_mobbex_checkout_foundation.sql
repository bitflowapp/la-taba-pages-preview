-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- MOBBEX CHECKOUT (cuenta propia del comercio) — LEDGER ADITIVO, PARALELO A MERCADO PAGO
--
-- ESTADO: PREPARADA, NO APLICADA EN NINGÚN ENTORNO. Nada de lo que crea está encendido: `mobbex_business_settings`
-- nace vacía (= deshabilitado), la compuerta de producción está cerrada y no existe «alcance público».
--
-- QUÉ ES
-- ------
-- Un segundo proveedor de cobro con hosted checkout redirect. El dinero entra en la cuenta Mobbex del propio
-- comercio (single-merchant); no hay OAuth de vendedores ni split.
--
-- POR QUÉ UN LEDGER PARALELO Y NO UNA FILA MÁS EN `payment_intents`
-- ------------------------------------------------------------------
-- Mercado Pago está cosido a ~15 migraciones (barridos que encolan `payment_outbox`, el worker, refund inventory,
-- lock order I6). Meter un proveedor distinto en esas tablas habría hecho que cada barrido y cada RPC de MP pudiera
-- recoger una fila ajena y llamar a Mercado Pago con ids de Mobbex. Por eso:
--   · NO se altera ninguna tabla, constraint ni función de Mercado Pago;
--   · Mobbex tiene sus propias tablas (`mobbex_*`) y su propia cola;
--   · se REUTILIZAN las piezas que ya son neutrales al proveedor: `checkout_sessions`, `checkout_session_items`,
--     `inventory_reservations`, `private.reserve_for_paid_session`, `public.release_checkout_session_inventory`,
--     y el alta de pedido (derivada, ver abajo).
--
-- DERIVACIÓN EN VEZ DE COPIA
-- --------------------------
-- La creación de la sesión (precio vigente, stock, envío, cobertura, alcohol, combos) y el cierre del pedido son
-- cientos de líneas que ya tienen dueño. Copiarlas a mano las dejaría divergir. Esta migración las DERIVA de la
-- definición vigente con `pg_get_functiondef` y sustituciones textuales exactas; si una ancla ya no existe, la
-- migración FALLA en voz alta (MOBBEX_DERIVATION_*) en lugar de producir en silencio una función distinta. Es la
-- misma técnica de 20261022100000_financial_integrity_core.sql (LOCK_ORDER_PATTERN_MISMATCH).
-- Consecuencia que se acepta y se documenta: si más adelante cambia `create_checkout_session`, hay que re-derivar
-- la de Mobbex (test: tests/mobbex-derivation.test.mjs lo detecta comparando contra la migración vigente).
--
-- CÓMO SE REVIERTE
-- ----------------
-- docs/migrations/rollback/20261103010000_mobbex_checkout_foundation.rollback.sql (se niega si hay dinero registrado).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

create schema if not exists private;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Tablas
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Política NO secreta por comercio. Las credenciales (API key / access token) viven sólo en secrets de Edge.
create table public.mobbex_business_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  enabled boolean not null default false,
  environment text not null default 'test',
  -- Identificador (no secreto) de la entidad Mobbex del comercio, cuando se conoce: se contrasta con la respuesta.
  entity_uid text,
  currency text not null default 'ARS',
  reserve_stock boolean not null default true,
  preference_expiration_minutes integer not null default 15,
  production_review_status text not null default 'not_requested',
  changed_by text,
  updated_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint mobbex_settings_environment_check check (environment in ('test', 'production')),
  constraint mobbex_settings_currency_check check (currency = 'ARS'),
  constraint mobbex_settings_expiration_check check (preference_expiration_minutes between 5 and 60),
  constraint mobbex_settings_review_check check (production_review_status in ('not_requested', 'pending', 'approved', 'rejected')),
  constraint mobbex_settings_entity_check check (entity_uid is null or entity_uid ~ '^[A-Za-z0-9_:-]{3,80}$'),
  constraint mobbex_settings_enabled_check check (
    not enabled or (reserve_stock and (environment = 'test' or production_review_status = 'approved'))
  )
);

create table public.mobbex_payment_intents (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  environment text not null,
  -- Referencia externa única que Mobbex recibe y por la que se consulta la operación. Mobbex documenta que no
  -- admite dos operaciones PAGAS con el mismo `reference`: una segunda defensa contra el cobro doble.
  reference text not null,
  checkout_status text not null default 'none',
  checkout_attempts integer not null default 0,
  checkout_requested_at timestamptz,
  provider_checkout_id text,
  checkout_url text,
  checkout_created_at timestamptz,
  provider_payment_id text,
  provider_status_code text,
  provider_status text,
  internal_status text not null default 'created',
  currency text not null default 'ARS',
  expected_amount numeric(12, 2) not null,
  paid_amount numeric(12, 2),
  refunded_amount numeric(12, 2) not null default 0,
  approved_at timestamptz,
  rejected_at timestamptz,
  provider_event_at timestamptz,
  raw_response_hash text,
  -- Por qué una persona tiene que mirar este cobro (bloqueante) / qué conviene saber (no bloqueante).
  review_reason text,
  attention_reason text,
  reconcile_misses integer not null default 0,
  last_reconciled_at timestamptz,
  revision bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint mobbex_intents_environment_check check (environment in ('test', 'production')),
  constraint mobbex_intents_currency_check check (currency = 'ARS'),
  constraint mobbex_intents_reference_check check (reference ~ '^taba2-mbx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint mobbex_intents_checkout_status_check check (checkout_status in ('none', 'requested', 'created', 'failed', 'ambiguous')),
  constraint mobbex_intents_amount_check check (
    expected_amount > 0 and (paid_amount is null or paid_amount >= 0) and refunded_amount >= 0
    and (paid_amount is null or refunded_amount <= paid_amount)
  ),
  constraint mobbex_intents_hash_check check (raw_response_hash is null or raw_response_hash ~ '^[a-f0-9]{64}$'),
  constraint mobbex_intents_status_check check (internal_status in (
    'created', 'checkout_creating', 'checkout_created', 'pending', 'in_process', 'approved_order_pending',
    'completed', 'rejected', 'cancelled', 'expired', 'refunded', 'partially_refunded',
    'ambiguous', 'security_review_required', 'failed'
  )),
  constraint mobbex_intents_completed_has_order check (internal_status <> 'completed' or order_id is not null),
  unique (checkout_session_id),
  unique (reference)
);
-- Un pago de Mobbex pertenece a UN solo checkout (por entorno): impide dos pedidos pagados con un pago.
create unique index mobbex_intents_payment_key on public.mobbex_payment_intents (environment, provider_payment_id)
  where provider_payment_id is not null;
create index mobbex_intents_business_created_idx on public.mobbex_payment_intents (business_id, created_at desc);
create index mobbex_intents_open_idx on public.mobbex_payment_intents (internal_status, updated_at)
  where internal_status in ('checkout_created', 'pending', 'in_process', 'ambiguous', 'approved_order_pending', 'rejected');

-- Libro de eventos: sólo se agrega. Cada lectura confirmada del proveedor y cada decisión queda con su huella.
create table public.mobbex_payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.mobbex_payment_intents(id) on delete cascade,
  event_type text not null,
  provider_status_code text,
  provider_payment_id text,
  provider_occurred_at timestamptz,
  server_recorded_at timestamptz not null default clock_timestamp(),
  sequence bigint generated always as identity,
  raw_response_hash text,
  details jsonb not null default '{}'::jsonb,
  constraint mobbex_events_hash_check check (raw_response_hash is null or raw_response_hash ~ '^[a-f0-9]{64}$')
);
create unique index mobbex_events_dedupe_key on public.mobbex_payment_events (
  payment_intent_id, event_type, coalesce(provider_status_code, ''), coalesce(provider_payment_id, ''), coalesce(raw_response_hash, ''));
create index mobbex_events_intent_sequence_idx on public.mobbex_payment_events (payment_intent_id, sequence desc);

-- Avisos de Mobbex ya autenticados con el token de URL de TABA. Sólo hay fila para referencias que existen:
-- tráfico inventado no hace crecer la base. El cuerpo NO se guarda (sólo su huella): es una pista, no un hecho.
create table public.mobbex_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.mobbex_payment_intents(id) on delete cascade,
  environment text not null,
  reference text not null,
  payload_hash text not null,
  hint_status_code text,
  hint_payment_id text,
  received_at timestamptz not null default clock_timestamp(),
  constraint mobbex_receipts_hash_check check (payload_hash ~ '^[a-f0-9]{64}$'),
  unique (environment, reference, payload_hash)
);
create index mobbex_receipts_received_idx on public.mobbex_webhook_receipts (received_at);

-- Cola de conciliación: un trabajo ABIERTO por cobro (coalescente), con lease, backoff y dead-letter.
create table public.mobbex_jobs (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.mobbex_payment_intents(id) on delete cascade,
  reason text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  failures integer not null default 0,
  max_failures integer not null default 12,
  -- Algo nuevo llegó mientras el trabajo se ejecutaba: al terminar vuelve a correr en vez de darse por hecho.
  dirty boolean not null default false,
  next_attempt_at timestamptz not null default clock_timestamp(),
  owner text,
  lease_expires_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint mobbex_jobs_status_check check (status in ('pending', 'claimed', 'retry_wait', 'completed', 'dead_letter')),
  constraint mobbex_jobs_reason_check check (reason ~ '^[a-z_:]{3,60}$')
);
create unique index mobbex_jobs_one_open_per_intent on public.mobbex_jobs (payment_intent_id)
  where status in ('pending', 'claimed', 'retry_wait');
create index mobbex_jobs_claim_idx on public.mobbex_jobs (next_attempt_at, created_at)
  where status in ('pending', 'claimed', 'retry_wait');
create index mobbex_jobs_dead_letter_idx on public.mobbex_jobs (updated_at) where status = 'dead_letter';

create table public.mobbex_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.mobbex_payment_intents(id) on delete restrict,
  idempotency_key uuid not null,
  -- null = reintegro total.
  amount numeric(12, 2),
  status text not null default 'requested',
  requested_by uuid references auth.users(id) on delete set null,
  reason text,
  provider_response_hash text,
  requested_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint mobbex_refunds_amount_check check (amount is null or amount > 0),
  constraint mobbex_refunds_status_check check (status in ('requested', 'processing', 'approved', 'rejected', 'ambiguous', 'failed')),
  constraint mobbex_refunds_hash_check check (provider_response_hash is null or provider_response_hash ~ '^[a-f0-9]{64}$'),
  unique (idempotency_key)
);
create index mobbex_refunds_intent_idx on public.mobbex_refunds (payment_intent_id, requested_at desc);

-- Compuerta de producción (piloto cerrado). Una autorización es un registro, no un ajuste: autoriza UNA compra
-- concreta (quién, qué productos, cuánto, en qué entidad Mobbex), se consume con el cobro que permite y vence.
-- No existe «alcance público» para Mobbex: abrirlo al público será una decisión y una migración futuras.
create table public.mobbex_live_authorizations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  environment text not null default 'production',
  status text not null default 'authorized',
  customer_id uuid not null,
  items jsonb not null,
  amount numeric(12, 2) not null,
  currency text not null default 'ARS',
  entity_uid text not null,
  concept text not null,
  refund_plan text not null,
  abort_conditions text not null,
  authorized_by text not null,
  authorization_sha256 text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_intent_id uuid,
  aborted_at timestamptz,
  abort_reason text,
  constraint mobbex_live_environment_check check (environment = 'production'),
  constraint mobbex_live_status_check check (status in ('authorized', 'consumed', 'aborted', 'expired')),
  constraint mobbex_live_currency_check check (currency = 'ARS'),
  constraint mobbex_live_amount_check check (amount > 0 and amount <= 50000),
  constraint mobbex_live_items_check check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 5),
  constraint mobbex_live_entity_check check (entity_uid ~ '^[A-Za-z0-9_:-]{3,80}$'),
  constraint mobbex_live_concept_check check (length(btrim(concept)) between 5 and 200),
  constraint mobbex_live_refund_plan_check check (refund_plan in ('api', 'mobbex_panel')),
  constraint mobbex_live_abort_check check (length(btrim(abort_conditions)) >= 20),
  constraint mobbex_live_authorized_by_check check (length(btrim(authorized_by)) between 3 and 160),
  constraint mobbex_live_digest_check check (authorization_sha256 ~ '^[a-f0-9]{64}$'),
  constraint mobbex_live_lifetime_check check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  constraint mobbex_live_consumed_check check ((status = 'consumed') = (consumed_at is not null and consumed_by_intent_id is not null)),
  constraint mobbex_live_aborted_check check ((status = 'aborted') = (aborted_at is not null))
);
create unique index mobbex_live_one_open_idx on public.mobbex_live_authorizations (business_id) where status = 'authorized';

-- Todas las tablas: RLS activa, sin políticas para navegador. Escribe únicamente la función SECURITY DEFINER.
do $rls$
declare v_table text;
begin
  foreach v_table in array array['mobbex_business_settings', 'mobbex_payment_intents', 'mobbex_payment_events',
    'mobbex_webhook_receipts', 'mobbex_jobs', 'mobbex_refunds', 'mobbex_live_authorizations'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from public, anon, authenticated', v_table);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from service_role', v_table);
    execute format('grant select on public.%I to service_role', v_table);
  end loop;
end $rls$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Integridad por trigger
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────

create function private.mobbex_touch() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  new.updated_at := clock_timestamp();
  if tg_table_name = 'mobbex_payment_intents' then new.revision := old.revision + 1; end if;
  return new;
end $$;
create trigger mobbex_intents_touch before update on public.mobbex_payment_intents
  for each row execute function private.mobbex_touch();
create trigger mobbex_settings_touch before update on public.mobbex_business_settings
  for each row execute function private.mobbex_touch();
create trigger mobbex_jobs_touch before update on public.mobbex_jobs
  for each row execute function private.mobbex_touch();
create trigger mobbex_refunds_touch before update on public.mobbex_refunds
  for each row execute function private.mobbex_touch();

-- El libro de eventos y las autorizaciones no se editan ni se borran.
create function private.mobbex_append_only() returns trigger
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  v_mutable constant text[] := array['status', 'consumed_at', 'consumed_by_intent_id', 'aborted_at', 'abort_reason'];
begin
  if tg_table_name = 'mobbex_live_authorizations' and tg_op = 'UPDATE' then
    if (to_jsonb(new) - v_mutable) is distinct from (to_jsonb(old) - v_mutable) then
      raise exception 'the terms of a Mobbex live authorization cannot change' using errcode = '42501';
    end if;
    if old.status <> 'authorized' and new.status is distinct from old.status then
      raise exception 'a % Mobbex live authorization cannot change state', old.status using errcode = '55000';
    end if;
    return new;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
create trigger mobbex_events_append_only before update or delete on public.mobbex_payment_events
  for each row execute function private.mobbex_append_only();
create trigger mobbex_events_no_truncate before truncate on public.mobbex_payment_events
  for each statement execute function private.mobbex_append_only();
create trigger mobbex_live_immutable before update or delete on public.mobbex_live_authorizations
  for each row execute function private.mobbex_append_only();

-- Un pedido sólo puede declarar «mobbex» si existe un cobro Mobbex verificado y completado ligado a él.
alter table public.orders drop constraint orders_payment_method_valid;
alter table public.orders add constraint orders_payment_method_valid check (
  payment_method in ('mercadopago', 'mobbex', 'cash', 'coordinate', 'qa_no_charge')
);
comment on constraint orders_payment_method_valid on public.orders is
  'Modalidad de pago explícita: Mercado Pago, Mobbex, efectivo, coordinado o QA sin cargo.';

create function public.assert_mobbex_order_payment_modality() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.payment_method <> 'mobbex' then return null; end if;
  if not exists (select 1 from public.mobbex_payment_intents pi where pi.order_id = new.id and pi.internal_status = 'completed') then
    raise exception 'pedido % declara pago Mobbex sin cobro verificado y completado', new.public_code using errcode = '23514';
  end if;
  return null;
end $$;
-- Diferido: el cierre inserta el pedido y recién después liga el cobro (igual que Mercado Pago).
create constraint trigger orders_assert_mobbex_payment_modality
  after insert or update of payment_method, id on public.orders
  deferrable initially deferred
  for each row execute function public.assert_mobbex_order_payment_modality();

-- Un pedido cobrado por Mobbex no se cancela sin devolver el dinero, y uno revertido sólo admite cierre operativo.
create function public.mobbex_guard_order_transition() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_intent public.mobbex_payment_intents%rowtype;
  v_old text := public.normalize_order_status_vocabulary(old.status);
  v_new text := public.normalize_order_status_vocabulary(new.status);
  v_reversed boolean;
begin
  if lower(btrim(coalesce(old.payment_method, ''))) <> 'mobbex' then return new; end if;
  select * into v_intent from public.mobbex_payment_intents pi where pi.order_id = old.id;
  if not found then return new; end if;
  v_reversed := coalesce(v_intent.paid_amount, 0) > 0 and v_intent.refunded_amount >= v_intent.paid_amount;
  if v_reversed and v_old not in ('cancelled', 'rejected', 'delivered') and v_new not in ('cancelled', 'rejected') then
    raise exception 'pago revertido: el pedido solo admite cierre operativo' using errcode = '55000';
  end if;
  if v_new in ('cancelled', 'rejected') and v_old not in ('cancelled', 'rejected') and not v_reversed then
    raise exception 'pedido cobrado por Mobbex: gestionar reembolso antes de cancelar' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger mobbex_order_transition_guard before update of status on public.orders
  for each row execute function public.mobbex_guard_order_transition();

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Compuerta de producción: sólo se cobra la compra que una persona con autoridad dejó escrita
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────

create function public.enforce_mobbex_live_gate() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_auth public.mobbex_live_authorizations%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_settings public.mobbex_business_settings%rowtype;
  v_items jsonb;
begin
  if new.environment <> 'production' then return null; end if;
  select * into v_auth from public.mobbex_live_authorizations a
   where a.business_id = new.business_id and a.status = 'authorized' for update;
  if not found then
    raise exception 'MOBBEX_LIVE_NOT_AUTHORIZED' using errcode = '55000',
      detail = 'production Mobbex is closed: there is no open authorization for this business';
  end if;
  if v_auth.expires_at <= clock_timestamp() then raise exception 'MOBBEX_LIVE_AUTHORIZATION_EXPIRED' using errcode = '55000'; end if;
  select * into v_session from public.checkout_sessions where id = new.checkout_session_id;
  if v_session.customer_id is distinct from v_auth.customer_id then
    raise exception 'MOBBEX_LIVE_CUSTOMER_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v_session.fulfillment_type <> 'pickup' or v_session.delivery_fee <> 0 or v_session.discount_total <> 0
     or exists (select 1 from public.checkout_session_combos c where c.checkout_session_id = v_session.id) then
    raise exception 'MOBBEX_LIVE_ITEMS_MISMATCH' using errcode = '55000', detail = 'the pilot purchase is a plain pickup of the authorized products';
  end if;
  if new.expected_amount is distinct from v_auth.amount or v_session.total is distinct from v_auth.amount or new.currency <> v_auth.currency then
    raise exception 'MOBBEX_LIVE_AMOUNT_MISMATCH' using errcode = '55000';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'quantity', i.quantity) order by i.product_id), '[]'::jsonb)
    into v_items from public.checkout_session_items i where i.checkout_session_id = v_session.id;
  if v_items is distinct from v_auth.items then raise exception 'MOBBEX_LIVE_ITEMS_MISMATCH' using errcode = '55000'; end if;
  select * into v_settings from public.mobbex_business_settings s where s.business_id = new.business_id;
  if not found or not v_settings.enabled or v_settings.environment <> 'production'
     or v_settings.production_review_status <> 'approved' or v_settings.entity_uid is distinct from v_auth.entity_uid then
    raise exception 'MOBBEX_LIVE_ENTITY_MISMATCH' using errcode = '55000';
  end if;
  update public.mobbex_live_authorizations
     set status = 'consumed', consumed_at = clock_timestamp(), consumed_by_intent_id = new.id where id = v_auth.id;
  return null;
end $$;
create constraint trigger mobbex_live_gate_trg after insert on public.mobbex_payment_intents
  deferrable initially immediate for each row execute function public.enforce_mobbex_live_gate();

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Funciones neutrales (helpers privados)
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────

create function private.mobbex_event(
  p_intent uuid, p_type text, p_code text, p_payment_id text, p_occurred timestamptz, p_hash text, p_details jsonb
) returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  insert into public.mobbex_payment_events (payment_intent_id, event_type, provider_status_code, provider_payment_id,
    provider_occurred_at, raw_response_hash, details)
  values (p_intent, p_type, nullif(p_code, ''), p_payment_id, p_occurred, p_hash, coalesce(p_details, '{}'::jsonb))
  on conflict do nothing;
end $$;

create function private.mobbex_enqueue_job(p_intent uuid, p_reason text, p_delay_seconds integer default 0)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_id uuid;
begin
  insert into public.mobbex_jobs (payment_intent_id, reason, next_attempt_at)
  values (p_intent, p_reason, clock_timestamp() + make_interval(secs => greatest(0, coalesce(p_delay_seconds, 0))))
  on conflict (payment_intent_id) where status in ('pending', 'claimed', 'retry_wait')
  do update set next_attempt_at = least(public.mobbex_jobs.next_attempt_at, excluded.next_attempt_at),
                dirty = (public.mobbex_jobs.status = 'claimed'), reason = excluded.reason
  returning id into v_id;
  return v_id;
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 5. Configuración por comercio (service_role; la persona titular decide, nunca el navegador)
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────

create function public.configure_mobbex_business(
  p_business_id uuid, p_enabled boolean, p_environment text, p_production_review_status text,
  p_entity_uid text, p_actor text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_row public.mobbex_business_settings%rowtype;
begin
  if p_actor is null or length(btrim(p_actor)) < 3 then raise exception 'actor requerido' using errcode = '22023'; end if;
  if not exists (select 1 from public.businesses b where b.id = p_business_id) then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;
  insert into public.mobbex_business_settings (business_id, enabled, environment, production_review_status, entity_uid, changed_by)
  values (p_business_id, coalesce(p_enabled, false), coalesce(p_environment, 'test'),
          coalesce(p_production_review_status, 'not_requested'), nullif(btrim(p_entity_uid), ''), left(btrim(p_actor), 160))
  on conflict (business_id) do update set enabled = excluded.enabled, environment = excluded.environment,
    production_review_status = excluded.production_review_status, entity_uid = excluded.entity_uid, changed_by = excluded.changed_by
  returning * into v_row;
  return jsonb_build_object('business_id', v_row.business_id, 'enabled', v_row.enabled, 'environment', v_row.environment,
    'production_review_status', v_row.production_review_status);
end $$;

create function public.authorize_mobbex_live_payment(
  p_business_id uuid, p_customer_id uuid, p_items jsonb, p_amount numeric, p_concept text, p_entity_uid text,
  p_refund_plan text, p_abort_conditions text, p_authorized_by text, p_authorization_sha256 text, p_valid_minutes integer
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_settings public.mobbex_business_settings%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_total numeric(12, 2) := 0;
  v_normalized jsonb;
  v_row public.mobbex_live_authorizations%rowtype;
begin
  if p_valid_minutes is null or p_valid_minutes not between 5 and 1440 then
    raise exception 'an authorization lasts between 5 minutes and 24 hours' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'items must be a list' using errcode = '22023'; end if;
  if not exists (select 1 from auth.users u where u.id = p_customer_id) then
    raise exception 'the authorized customer does not exist' using errcode = 'P0002';
  end if;
  select * into v_settings from public.mobbex_business_settings s where s.business_id = p_business_id;
  if not found or not v_settings.enabled or v_settings.environment <> 'production'
     or v_settings.production_review_status <> 'approved' or v_settings.entity_uid is distinct from p_entity_uid then
    raise exception 'Mobbex is not switched on for production with this entity' using errcode = '55000';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id', t.product_id, 'quantity', t.quantity) order by t.product_id), '[]'::jsonb)
    into v_normalized from jsonb_to_recordset(p_items) as t(product_id uuid, quantity integer);
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
      raise exception 'product % is not sellable for the pilot (inactive, no stock, alcohol or unconfirmed price)', v_item.product_id using errcode = '55000';
    end if;
    v_total := v_total + v_product.price * v_item.quantity;
  end loop;
  if v_total <> p_amount then raise exception 'the amount (%) is not the live catalog total (%)', p_amount, v_total using errcode = '55000'; end if;
  update public.mobbex_live_authorizations set status = 'expired'
   where business_id = p_business_id and status = 'authorized' and expires_at <= clock_timestamp();
  if exists (select 1 from public.checkout_sessions c where c.business_id = p_business_id
              and c.status in ('ready_for_payment', 'redirected', 'payment_pending') and c.expires_at > clock_timestamp()) then
    raise exception 'there is a checkout in flight for this business' using errcode = '55000';
  end if;
  insert into public.mobbex_live_authorizations (business_id, customer_id, items, amount, entity_uid, concept, refund_plan,
    abort_conditions, authorized_by, authorization_sha256, expires_at)
  values (p_business_id, p_customer_id, v_normalized, p_amount, p_entity_uid, btrim(p_concept), p_refund_plan,
    btrim(p_abort_conditions), btrim(p_authorized_by), p_authorization_sha256, clock_timestamp() + make_interval(mins => p_valid_minutes))
  returning * into v_row;
  return jsonb_build_object('authorization_id', v_row.id, 'status', v_row.status, 'amount', v_row.amount, 'expires_at', v_row.expires_at);
end $$;

create function public.abort_mobbex_live_payment(p_authorization_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_row public.mobbex_live_authorizations%rowtype;
begin
  if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'an abort needs a reason' using errcode = '22023'; end if;
  select * into v_row from public.mobbex_live_authorizations where id = p_authorization_id for update;
  if not found then raise exception 'authorization not found' using errcode = 'P0002'; end if;
  if v_row.status <> 'authorized' then raise exception 'a % authorization cannot be aborted', v_row.status using errcode = '55000'; end if;
  update public.mobbex_live_authorizations set status = 'aborted', aborted_at = clock_timestamp(), abort_reason = btrim(p_reason)
   where id = v_row.id;
  return jsonb_build_object('authorization_id', v_row.id, 'status', 'aborted');
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 6. Disponibilidad y estado (lo único que toca el navegador, siempre de sólo lectura)
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────

-- «Mobbex» sólo se ofrece si TODO esto es cierto. En producción además exige una autorización abierta PARA ESA
-- PERSONA: nadie más ve la opción. La palanca de plataforma (secrets de Edge) se verifica en la Edge Function.
create function public.get_mobbex_checkout_availability(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_settings public.mobbex_business_settings%rowtype;
  v_business public.businesses%rowtype;
begin
  select * into v_settings from public.mobbex_business_settings s where s.business_id = p_business_id;
  select * into v_business from public.businesses b where b.id = p_business_id;
  if v_settings.business_id is null or not v_settings.enabled or v_settings.reserve_stock is not true
     or v_business.id is null or not v_business.is_active or v_business.status <> 'open'
     or not v_business.ordering_enabled or not v_business.ordering_verified then
    return jsonb_build_object('available', false, 'reason', 'not_enabled');
  end if;
  if v_settings.environment = 'production' and (
       v_settings.production_review_status <> 'approved'
       or auth.uid() is null
       or not exists (select 1 from public.mobbex_live_authorizations a
                       where a.business_id = p_business_id and a.status = 'authorized'
                         and a.expires_at > clock_timestamp() and a.customer_id = auth.uid())) then
    return jsonb_build_object('available', false, 'reason', 'production_gate_closed');
  end if;
  return jsonb_build_object('available', true, 'environment', v_settings.environment);
end $$;

create function public.mobbex_checkout_session_payload(p_checkout_session_id uuid, p_customer_id uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
  select jsonb_build_object(
    'payment_provider', 'mobbex',
    'checkout_session_id', s.id,
    'status', s.status,
    'expires_at', s.expires_at,
    'currency', s.currency,
    'subtotal', s.subtotal, 'discount_total', s.discount_total, 'delivery_fee', s.delivery_fee, 'total', s.total,
    'fulfillment_type', s.fulfillment_type,
    'payment_intent_id', pi.id,
    'payment_status', pi.internal_status,
    'provider_status', pi.provider_status,
    'checkout_status', pi.checkout_status,
    'order_id', s.completed_order_id,
    'order_public_code', o.public_code,
    'manual_review_required', s.status = 'manual_review_required' or pi.internal_status = 'security_review_required',
    'items', coalesce((select jsonb_agg(jsonb_build_object('product_id', si.product_id, 'name', si.product_snapshot ->> 'name',
        'presentation', si.product_snapshot ->> 'presentation', 'quantity', si.quantity, 'unit_price', si.unit_price,
        'subtotal', si.subtotal) order by si.created_at, si.id)
      from public.checkout_session_items si where si.checkout_session_id = s.id), '[]'::jsonb),
    'delivery_code', case when s.completed_order_id is not null and s.fulfillment_type = 'delivery' then (
        select pgp_sym_decrypt(h.code_ciphertext, s.id::text) from public.order_delivery_handoffs h
         where h.order_id = s.completed_order_id and h.confirmed_at is null and h.expires_at > clock_timestamp())
      else null end)
  from public.checkout_sessions s
  join public.mobbex_payment_intents pi on pi.checkout_session_id = s.id
  left join public.orders o on o.id = s.completed_order_id
  where s.id = p_checkout_session_id and s.customer_id = p_customer_id;
$$;

-- Lo que la vuelta del navegador puede LEER. Nunca marca nada como pagado.
create function public.get_mobbex_checkout_status(p_checkout_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  return public.mobbex_checkout_session_payload(p_checkout_session_id, auth.uid());
end $$;

-- La persona vuelve del checkout y quiere ver su pedido: pide una lectura inmediata al proveedor (la hace el servidor).
create function public.mobbex_request_reconcile(p_checkout_session_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_intent public.mobbex_payment_intents%rowtype;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  select pi.* into v_intent from public.mobbex_payment_intents pi
    join public.checkout_sessions s on s.id = pi.checkout_session_id
   where pi.checkout_session_id = p_checkout_session_id and s.customer_id = auth.uid();
  if not found then raise exception 'checkout inexistente' using errcode = 'P0002'; end if;
  if v_intent.internal_status in ('completed', 'refunded', 'expired', 'cancelled', 'failed') then
    return jsonb_build_object('queued', false, 'internal_status', v_intent.internal_status);
  end if;
  perform private.mobbex_enqueue_job(v_intent.id, 'browser_return', 0);
  return jsonb_build_object('queued', true, 'intent_id', v_intent.id, 'reference', v_intent.reference);
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 7. Preparación del checkout hosted (el total sale de la sesión; el cliente nunca lo manda)
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────

create function public.mobbex_prepare_checkout(p_checkout_session_id uuid, p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_intent public.mobbex_payment_intents%rowtype;
  v_session public.checkout_sessions%rowtype;
begin
  -- Lock order I6: the intent first, then the session.
  select * into v_intent from public.mobbex_payment_intents pi where pi.checkout_session_id = p_checkout_session_id for update;
  if not found then raise exception 'checkout inexistente' using errcode = 'P0002'; end if;
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id and s.customer_id = p_customer_id for update;
  if not found then raise exception 'checkout no pertenece al cliente' using errcode = '42501'; end if;
  if v_session.status not in ('ready_for_payment', 'redirected', 'payment_pending') then
    raise exception 'checkout no pagable en estado %', v_session.status using errcode = '55000';
  end if;
  if v_session.expires_at <= clock_timestamp() then raise exception 'checkout vencido' using errcode = '55000'; end if;
  if v_intent.internal_status not in ('created', 'checkout_creating', 'checkout_created', 'pending', 'in_process', 'rejected', 'ambiguous') then
    raise exception 'cobro en estado %', v_intent.internal_status using errcode = '55000';
  end if;
  if v_intent.checkout_status = 'created' and v_intent.checkout_url is not null then
    return jsonb_build_object('claimed', false, 'reuse', true, 'checkout_url', v_intent.checkout_url,
      'checkout_session_id', v_session.id, 'expires_at', v_session.expires_at);
  end if;
  if v_intent.checkout_status = 'requested' and v_intent.checkout_requested_at > clock_timestamp() - interval '60 seconds' then
    return jsonb_build_object('claimed', false, 'in_flight', true, 'checkout_session_id', v_session.id);
  end if;
  update public.mobbex_payment_intents
     set checkout_status = 'requested', checkout_requested_at = clock_timestamp(), checkout_attempts = checkout_attempts + 1,
         internal_status = case when internal_status = 'created' then 'checkout_creating' else internal_status end
   where id = v_intent.id;
  return jsonb_build_object('claimed', true, 'intent_id', v_intent.id, 'reference', v_intent.reference,
    'environment', v_intent.environment, 'expected_amount', v_intent.expected_amount, 'currency', v_intent.currency,
    'checkout_session_id', v_session.id, 'expires_at', v_session.expires_at, 'attempt', v_intent.checkout_attempts + 1,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(i.product_snapshot ->> 'name', 'Producto'),
        'quantity', i.quantity, 'subtotal', i.subtotal) order by i.created_at, i.id)
      from public.checkout_session_items i where i.checkout_session_id = v_session.id), '[]'::jsonb),
    'delivery_fee', v_session.delivery_fee, 'discount_total', v_session.discount_total);
end $$;

create function public.mobbex_record_checkout_created(p_intent_id uuid, p_checkout_id text, p_url text, p_response_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_intent public.mobbex_payment_intents%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_wait integer;
begin
  if p_url is null or p_url !~ '^https://([a-z0-9-]+\.)*mobbex\.com/' or length(coalesce(p_checkout_id, '')) not between 3 and 120 then
    raise exception 'respuesta de checkout invalida' using errcode = '22023';
  end if;
  select * into v_intent from public.mobbex_payment_intents where id = p_intent_id for update;
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  select * into v_session from public.checkout_sessions where id = v_intent.checkout_session_id for update;
  update public.mobbex_payment_intents
     set checkout_status = 'created', provider_checkout_id = p_checkout_id, checkout_url = p_url, checkout_created_at = clock_timestamp(),
         internal_status = case when internal_status in ('created', 'checkout_creating') then 'checkout_created' else internal_status end
   where id = v_intent.id;
  update public.checkout_sessions set status = 'redirected' where id = v_session.id and status = 'ready_for_payment';
  perform private.mobbex_event(v_intent.id, 'checkout.created', null, null, null, p_response_hash,
    jsonb_build_object('provider_checkout_id', p_checkout_id));
  -- Red de seguridad contra un aviso perdido: una lectura al proveedor justo después de que el checkout deje de ser pagable.
  v_wait := greatest(30, ceil(extract(epoch from (v_session.expires_at - clock_timestamp())))::integer + 60);
  perform private.mobbex_enqueue_job(v_intent.id, 'after_checkout_window', v_wait);
  return jsonb_build_object('ok', true, 'intent_id', v_intent.id);
end $$;

create function public.mobbex_record_checkout_failed(p_intent_id uuid, p_code text, p_response_hash text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  update public.mobbex_payment_intents
     set checkout_status = 'failed', internal_status = case when internal_status = 'checkout_creating' then 'created' else internal_status end
   where id = p_intent_id and checkout_status in ('requested', 'ambiguous');
  perform private.mobbex_event(p_intent_id, 'checkout.rejected', left(coalesce(p_code, ''), 16), null, null, p_response_hash, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- Si el POST pudo haber llegado a Mobbex no se sabe si hay checkout: nadie vio su URL, así que nadie puede pagarlo.
-- El próximo intento crea otro con la MISMA referencia; Mobbex no admite dos operaciones pagas con ella.
create function public.mobbex_record_checkout_uncertain(p_intent_id uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  update public.mobbex_payment_intents set checkout_status = 'ambiguous'
   where id = p_intent_id and checkout_status = 'requested';
  perform private.mobbex_event(p_intent_id, 'checkout.uncertain', left(coalesce(p_code, ''), 16), null, null, null, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 8. Avisos (webhooks) y cola
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────

create function public.mobbex_record_webhook_receipt(
  p_environment text, p_reference text, p_payload_hash text, p_hint_status_code text, p_hint_payment_id text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_intent public.mobbex_payment_intents%rowtype;
  v_receipt uuid;
begin
  select * into v_intent from public.mobbex_payment_intents pi where pi.reference = p_reference and pi.environment = p_environment;
  if not found then return jsonb_build_object('ok', true, 'unknown_reference', true); end if;
  insert into public.mobbex_webhook_receipts (payment_intent_id, environment, reference, payload_hash, hint_status_code, hint_payment_id)
  values (v_intent.id, p_environment, p_reference, p_payload_hash, left(p_hint_status_code, 16), left(p_hint_payment_id, 80))
  on conflict (environment, reference, payload_hash) do nothing returning id into v_receipt;
  -- Aun un duplicado asegura que haya un trabajo abierto: puede ser el reintento de un aviso cuyo trabajo falló.
  perform private.mobbex_enqueue_job(v_intent.id, 'webhook', 0);
  return jsonb_build_object('ok', true, 'duplicate', v_receipt is null, 'intent_id', v_intent.id, 'queued', true);
end $$;

create function public.mobbex_claim_jobs(p_owner text, p_limit integer default 10, p_lease_seconds integer default 90)
returns table (job_id uuid, payment_intent_id uuid, reference text, environment text, reason text, failures integer)
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
#variable_conflict use_column
begin
  if nullif(btrim(p_owner), '') is null then raise exception 'owner requerido' using errcode = '22023'; end if;
  return query
  with candidate as (
    select j.id from public.mobbex_jobs j
     where (j.status in ('pending', 'retry_wait') and j.next_attempt_at <= clock_timestamp())
        or (j.status = 'claimed' and coalesce(j.lease_expires_at, '-infinity'::timestamptz) < clock_timestamp())
     order by j.next_attempt_at, j.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked
  ), claimed as (
    update public.mobbex_jobs j
       set status = 'claimed', owner = left(btrim(p_owner), 200), dirty = false, attempts = j.attempts + 1,
           lease_expires_at = clock_timestamp() + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 90), 600)))
      from candidate c where j.id = c.id
    returning j.*
  )
  select c.id, c.payment_intent_id, i.reference, i.environment, c.reason, c.failures
    from claimed c join public.mobbex_payment_intents i on i.id = c.payment_intent_id;
end $$;

-- done = terminado; again = sin novedad, volver a mirar (no gasta presupuesto de fallos); failed = error, con backoff.
create function public.mobbex_finish_job(p_job_id uuid, p_owner text, p_outcome text, p_delay_seconds integer default 60, p_error text default null)
returns text language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_job public.mobbex_jobs%rowtype;
  v_failures integer;
  v_backoff integer;
begin
  select * into v_job from public.mobbex_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'claimed' or v_job.owner is distinct from left(btrim(p_owner), 200) then return 'lost_lease'; end if;
  if p_outcome = 'done' then
    if v_job.dirty then
      update public.mobbex_jobs set status = 'pending', next_attempt_at = clock_timestamp(), owner = null, lease_expires_at = null where id = v_job.id;
      return 'pending';
    end if;
    update public.mobbex_jobs set status = 'completed', completed_at = clock_timestamp(), owner = null, lease_expires_at = null, last_error = null where id = v_job.id;
    return 'completed';
  elsif p_outcome = 'again' then
    update public.mobbex_jobs
       set status = 'retry_wait', owner = null, lease_expires_at = null,
           next_attempt_at = clock_timestamp() + make_interval(secs => case when v_job.dirty then 0 else greatest(5, least(coalesce(p_delay_seconds, 60), 3600)) end)
     where id = v_job.id;
    return 'retry_wait';
  elsif p_outcome = 'failed' then
    v_failures := v_job.failures + 1;
    if v_failures >= v_job.max_failures then
      update public.mobbex_jobs set status = 'dead_letter', failures = v_failures, owner = null, lease_expires_at = null,
             last_error = left(coalesce(p_error, 'error'), 200) where id = v_job.id;
      perform private.mobbex_event(v_job.payment_intent_id, 'job.dead_letter', null, null, null, null,
        jsonb_build_object('failures', v_failures, 'error', left(coalesce(p_error, 'error'), 200)));
      return 'dead_letter';
    end if;
    -- 30 s, 60 s, 2 min ... capped at 1 h.
    v_backoff := least(3600, 30 * (2 ^ least(v_job.failures, 7))::integer);
    update public.mobbex_jobs
       set status = 'retry_wait', failures = v_failures, owner = null, lease_expires_at = null,
           next_attempt_at = clock_timestamp() + make_interval(secs => v_backoff), last_error = left(coalesce(p_error, 'error'), 200)
     where id = v_job.id;
    return 'retry_wait';
  end if;
  raise exception 'resultado de trabajo invalido' using errcode = '22023';
end $$;

-- Reabre un trabajo en dead-letter una vez corregida la causa (credenciales, caída del proveedor...). Acción humana.
create function public.mobbex_requeue_dead_letter(p_limit integer default 50) returns integer
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_count integer;
begin
  with revived as (
    update public.mobbex_jobs j set status = 'pending', failures = 0, next_attempt_at = clock_timestamp(), last_error = null
     where j.id in (select id from public.mobbex_jobs where status = 'dead_letter' order by updated_at limit greatest(1, least(coalesce(p_limit, 50), 500)))
       and not exists (select 1 from public.mobbex_jobs o where o.payment_intent_id = j.payment_intent_id and o.status in ('pending', 'claimed', 'retry_wait'))
    returning 1)
  select count(*) into v_count from revived;
  return v_count;
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 9. Cierre del pedido: wrapper propio + núcleo DERIVADO del vigente (ver cabecera)
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────

do $derive$
declare
  v_def text;
  v_new text;
  v_start integer;
  v_end integer;
  v_block text;
begin
  -- 9.1 private.mobbex_finalize_core(session) ← private.finalize_paid_checkout_session_core(session)
  v_def := pg_get_functiondef('private.finalize_paid_checkout_session_core(uuid)'::regprocedure);
  v_new := replace(v_def, 'FUNCTION private.finalize_paid_checkout_session_core(', 'FUNCTION private.mobbex_finalize_core(');
  if v_new = v_def then raise exception 'MOBBEX_DERIVATION_HEADER_CORE'; end if;
  v_new := regexp_replace(v_new, 'public\.payment_intents', 'public.mobbex_payment_intents', 'g');
  v_new := regexp_replace(v_new, 'public\.payment_events', 'public.mobbex_payment_events', 'g');
  v_new := replace(v_new, '''mp_'' || replace(', '''mbx_'' || replace(');
  v_new := replace(v_new, '''mercadopago_checkout_pro''', '''mobbex_checkout''');
  v_new := replace(v_new, '''mercadopago'', v_session.subtotal', '''mobbex'', v_session.subtotal');
  if v_new !~ 'mobbex_payment_intents' or v_new ~ 'mercadopago' or v_new ~ '(^|[^_a-z])payment_intents' or v_new ~ '(^|[^_a-z])payment_events' then
    raise exception 'MOBBEX_DERIVATION_CORE_RESIDUE';
  end if;
  execute v_new;
  revoke all on function private.mobbex_finalize_core(uuid) from public, anon, authenticated;

  -- 9.2 public.create_mobbex_checkout_session(customer, payload) ← public.create_checkout_session(customer, payload)
  v_def := pg_get_functiondef('public.create_checkout_session(uuid,jsonb)'::regprocedure);
  v_new := replace(v_def, 'FUNCTION public.create_checkout_session(', 'FUNCTION public.create_mobbex_checkout_session(');
  if v_new = v_def then raise exception 'MOBBEX_DERIVATION_HEADER_SESSION'; end if;
  -- (a) the settings row
  if strpos(v_new, 'v_settings public.business_payment_settings%rowtype;') = 0 then raise exception 'MOBBEX_DERIVATION_SETTINGS_DECLARATION'; end if;
  v_new := replace(v_new, 'v_settings public.business_payment_settings%rowtype;', 'v_settings public.mobbex_business_settings%rowtype;');
  v_start := strpos(v_new, 'select s.* into v_settings');
  v_end := strpos(v_new, 'Mercado Pago no esta configurado para este negocio');
  if v_start = 0 or v_end = 0 or v_end < v_start then raise exception 'MOBBEX_DERIVATION_SETTINGS_BLOCK'; end if;
  v_end := v_end + strpos(substr(v_new, v_end), 'end if;') + length('end if;') - 2;
  v_block := substr(v_new, v_start, v_end - v_start + 1);
  v_new := replace(v_new, v_block,
$blk$select s.* into v_settings
    from public.mobbex_business_settings s
   where s.business_id = v_business_id
   for share;
  if not found
    or not v_settings.enabled
    or not v_settings.reserve_stock
    or v_settings.currency <> 'ARS'
    or (v_settings.environment = 'production' and v_settings.production_review_status <> 'approved') then
    raise exception 'Mobbex no esta configurado para este negocio' using errcode = '55000';
  end if;$blk$);
  -- (b) the declared payment method
  if strpos(v_new, 'lower(btrim(coalesce(p_payload ->> ''payment_method'', ''''))) <> ''mercadopago''') = 0 then
    raise exception 'MOBBEX_DERIVATION_PAYMENT_METHOD';
  end if;
  v_new := replace(v_new, 'lower(btrim(coalesce(p_payload ->> ''payment_method'', ''''))) <> ''mercadopago''',
                          'lower(btrim(coalesce(p_payload ->> ''payment_method'', ''''))) <> ''mobbex''');
  v_new := replace(v_new, 'medio de pago invalido para Checkout Pro', 'medio de pago invalido para Mobbex');
  -- (c) the intent and its first event
  v_start := strpos(v_new, 'insert into public.payment_intents (');
  v_end := strpos(v_new, 'return public.checkout_session_customer_payload(v_session.id, p_customer_id);');
  if v_start = 0 or v_end = 0 or v_end < v_start then raise exception 'MOBBEX_DERIVATION_INTENT_BLOCK'; end if;
  v_block := substr(v_new, v_start, v_end - v_start);
  v_new := replace(v_new, v_block,
$blk$insert into public.mobbex_payment_intents (
    checkout_session_id, business_id, environment, reference, internal_status, currency, expected_amount
  ) values (
    v_session.id, v_business_id, v_settings.environment, 'taba2-mbx-' || v_session.id::text, 'created', 'ARS', v_total
  ) returning id into v_payment_intent_id;

  insert into public.mobbex_payment_events (
    payment_intent_id, event_type, details
  ) values (
    v_payment_intent_id,
    'checkout.session_created',
    jsonb_build_object('checkout_session_id', v_session.id, 'reservation_expires_at', v_expires_at)
  );

  $blk$);
  -- every place that answers with the session payload (the fresh session and the idempotent replay of an old one)
  v_new := replace(v_new, 'public.checkout_session_customer_payload(', 'public.mobbex_checkout_session_payload(');
  if v_new ~ 'checkout_session_customer_payload' or v_new ~ 'mercadopago' or v_new ~ 'Mercado Pago' or v_new ~ '(^|[^_a-z])payment_intents' or v_new ~ 'business_payment_settings' then
    raise exception 'MOBBEX_DERIVATION_SESSION_RESIDUE';
  end if;
  execute v_new;
  revoke all on function public.create_mobbex_checkout_session(uuid, jsonb) from public, anon, authenticated;
  grant execute on function public.create_mobbex_checkout_session(uuid, jsonb) to service_role;
end $derive$;

create function public.mobbex_finalize_paid_checkout(p_checkout_session_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  v_intent public.mobbex_payment_intents%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_res jsonb;
begin
  select * into v_intent from public.mobbex_payment_intents pi where pi.checkout_session_id = p_checkout_session_id for update;
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found then raise exception 'checkout inexistente' using errcode = 'P0002'; end if;
  if v_session.completed_order_id is not null or v_session.status = 'completed' then
    return jsonb_build_object('ok', true, 'order_id', v_session.completed_order_id, 'idempotent', true);
  end if;
  -- El núcleo derivado exige provider_status = 'approved' y paid_amount = total: sólo una lectura verificada lo cumple.
  if v_intent.id is null or v_intent.internal_status not in ('approved_order_pending') or v_intent.provider_status <> 'approved'
     or v_intent.paid_amount is distinct from v_session.total or v_intent.currency <> 'ARS' then
    raise exception 'pago no aprobado verificadamente' using errcode = '55000';
  end if;
  if exists (select 1 from public.mobbex_refunds r where r.payment_intent_id = v_intent.id and r.status in ('requested', 'processing', 'ambiguous'))
     or v_intent.refunded_amount > 0 then
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'financial_hold:refund' where id = v_session.id;
    return jsonb_build_object('ok', false, 'manual_review_required', true, 'blocked', true, 'hold', 'refund');
  end if;
  v_res := private.reserve_for_paid_session(v_session.id);
  if not coalesce((v_res ->> 'ok')::boolean, false) then
    update public.mobbex_payment_intents set internal_status = 'security_review_required', review_reason = 'finalization_without_active_reservation' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'finalization_without_active_reservation' where id = v_session.id;
    return jsonb_build_object('ok', false, 'manual_review_required', true, 'reason', 'stock_insuficiente');
  end if;
  update public.checkout_sessions set expires_at = greatest(expires_at, clock_timestamp() + interval '10 minutes') where id = v_session.id;
  return private.mobbex_finalize_core(v_session.id);
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 10. La máquina de estados: una lectura CONFIRMADA del proveedor entra aquí y sólo aquí
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Garantías (probadas en supabase/tests/mobbex_ledger_test.sql):
--   · aprobar exige referencia, moneda, importe exacto y entidad coherentes con lo que el SERVIDOR calculó;
--   · un estado desconocido o una forma inesperada NUNCA aprueban: van a revisión;
--   · una lectura vieja o repetida no retrocede nada; lo que movió dinero pesa más que el reloj;
--   · un segundo pago aprobado para la misma referencia se registra y NO crea otro pedido;
--   · un pago que llega después de vencer la reserva vuelve a reservar stock o va a revisión (devolver el dinero);
--   · la aprobación y el pedido ocurren en UNA transacción: o hay pedido o hay un motivo escrito.

create function public.mobbex_record_provider_snapshot(p_intent_id uuid, p_snapshot jsonb, p_source text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  v_intent public.mobbex_payment_intents%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_settings public.mobbex_business_settings%rowtype;
  v_class text;
  v_code text;
  v_pid text;
  v_currency text;
  v_amount numeric(12, 2);
  v_hash text;
  v_time timestamptz;
  v_money boolean;
  v_paid boolean;
  v_open boolean;
  v_reason text;
  v_approved_ops integer;
  v_refunded numeric(12, 2);
  v_local numeric(12, 2);
  v_res jsonb;
  v_final jsonb;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' or coalesce(p_snapshot ->> 'raw_response_hash', '') !~ '^[a-f0-9]{64}$' then
    raise exception 'snapshot de pago invalido' using errcode = '22023';
  end if;
  select * into v_intent from public.mobbex_payment_intents pi where pi.id = p_intent_id for update;       -- I6
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  select * into v_session from public.checkout_sessions s where s.id = v_intent.checkout_session_id for update;
  select * into v_settings from public.mobbex_business_settings s where s.business_id = v_intent.business_id;

  v_class := lower(btrim(coalesce(p_snapshot ->> 'status_class', '')));
  v_code := left(btrim(coalesce(p_snapshot ->> 'status_code', '')), 16);
  v_pid := nullif(btrim(coalesce(p_snapshot ->> 'provider_payment_id', '')), '');
  v_currency := upper(btrim(coalesce(p_snapshot ->> 'currency', '')));
  v_hash := p_snapshot ->> 'raw_response_hash';
  begin v_amount := nullif(p_snapshot ->> 'amount', '')::numeric(12, 2); exception when others then v_amount := null; end;
  begin v_time := coalesce(nullif(p_snapshot ->> 'provider_occurred_at', '')::timestamptz, clock_timestamp());
  exception when others then v_time := clock_timestamp(); end;
  begin v_approved_ops := coalesce(nullif(p_snapshot ->> 'approved_operation_count', '')::integer, case when v_class = 'approved' then 1 else 0 end);
  exception when others then v_approved_ops := 1; end;
  v_money := v_class in ('approved', 'refunded', 'partially_refunded');
  v_paid := v_intent.paid_amount is not null;
  v_open := v_intent.internal_status in ('created', 'checkout_creating', 'checkout_created', 'pending', 'in_process', 'rejected', 'ambiguous');

  -- 10.1 Validation against what the SERVER decided, never against what the provider or the browser claims.
  if p_snapshot ->> 'reference' is distinct from v_intent.reference then v_reason := 'reference_mismatch';
  elsif v_class not in ('approved', 'authorized', 'pending', 'rejected', 'expired', 'cancelled', 'reversing', 'refunded', 'partially_refunded', 'unknown') then
    v_reason := 'unknown_status_class';
  elsif v_money and v_pid is null then v_reason := 'payment_id_missing';
  elsif v_money and (v_currency <> 'ARS' or v_currency <> v_intent.currency) then v_reason := 'currency_mismatch';
  elsif v_money and (v_amount is null or v_amount <> v_intent.expected_amount) then v_reason := 'amount_mismatch';
  elsif v_money and v_settings.entity_uid is not null and nullif(p_snapshot ->> 'entity_uid', '') is not null
        and p_snapshot ->> 'entity_uid' is distinct from v_settings.entity_uid then v_reason := 'entity_mismatch';
  elsif v_money and exists (select 1 from public.mobbex_payment_intents x
                             where x.environment = v_intent.environment and x.provider_payment_id = v_pid and x.id <> v_intent.id) then
    v_reason := 'payment_bound_to_other_checkout';
  end if;

  if v_reason is not null then
    perform private.mobbex_event(v_intent.id, 'payment.snapshot_rejected', v_code, v_pid, v_time, v_hash,
      jsonb_build_object('reason', v_reason, 'source', p_source, 'class', v_class));
    -- A defective reading about a purchase that is already funded must be visible but cannot hold it hostage.
    if v_paid or v_intent.order_id is not null then
      update public.mobbex_payment_intents set attention_reason = left('inconsistent_snapshot:' || v_reason, 120) where id = v_intent.id;
      return jsonb_build_object('ok', false, 'manual_review_required', false, 'reason', v_reason, 'attention', true);
    end if;
    update public.mobbex_payment_intents set internal_status = 'security_review_required', review_reason = v_reason, raw_response_hash = v_hash
     where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = v_reason
     where id = v_session.id and status not in ('completed', 'finalizing_order');
    return jsonb_build_object('ok', false, 'manual_review_required', true, 'reason', v_reason);
  end if;

  update public.mobbex_payment_intents set last_reconciled_at = clock_timestamp(), reconcile_misses = 0 where id = v_intent.id;

  -- 10.2 Out of order. What moved money decides; for everything else the provider's own clock does.
  if not v_money and (v_paid or (v_intent.provider_event_at is not null and v_time < v_intent.provider_event_at)) then
    perform private.mobbex_event(v_intent.id, 'payment.stale_snapshot_ignored', v_code, v_pid, v_time, v_hash,
      jsonb_build_object('stored_status', v_intent.provider_status, 'source', p_source));
    if v_paid and v_class in ('rejected', 'expired', 'unknown') then
      update public.mobbex_payment_intents set attention_reason = left('paid_operation_regressed:' || v_code, 120) where id = v_intent.id;
      return jsonb_build_object('ok', true, 'stale', true, 'attention', true, 'internal_status', v_intent.internal_status);
    end if;
    return jsonb_build_object('ok', true, 'stale', true, 'internal_status', v_intent.internal_status);
  end if;

  -- 10.3 Transitions.
  if v_class = 'approved' then
    if v_paid and v_intent.provider_payment_id is distinct from v_pid then
      update public.mobbex_payment_intents set attention_reason = 'duplicate_approved_payment' where id = v_intent.id;
      perform private.mobbex_event(v_intent.id, 'payment.duplicate_approved_detected', v_code, v_pid, v_time, v_hash,
        jsonb_build_object('funding_payment_id', v_intent.provider_payment_id, 'other_payment_id', v_pid, 'amount', v_amount, 'source', p_source));
      return jsonb_build_object('ok', true, 'ignored_for_intent', true, 'duplicate_payment', true, 'internal_status', v_intent.internal_status);
    end if;
    if v_intent.order_id is not null or v_intent.internal_status in ('completed', 'refunded', 'partially_refunded') then
      update public.mobbex_payment_intents
         set provider_status_code = v_code, attention_reason = case when v_approved_ops > 1 then 'multiple_approved_operations' else attention_reason end
       where id = v_intent.id;
      return jsonb_build_object('ok', true, 'idempotent', true, 'internal_status', v_intent.internal_status, 'order_id', v_intent.order_id);
    end if;
    if v_intent.internal_status = 'security_review_required' then
      perform private.mobbex_event(v_intent.id, 'payment.approved_seen_while_in_review', v_code, v_pid, v_time, v_hash, jsonb_build_object('source', p_source));
      return jsonb_build_object('ok', true, 'manual_review_required', true, 'internal_status', v_intent.internal_status);
    end if;
    update public.mobbex_payment_intents
       set provider_payment_id = v_pid, provider_status_code = v_code, provider_status = 'approved', paid_amount = v_amount,
           approved_at = coalesce(approved_at, v_time), provider_event_at = greatest(coalesce(provider_event_at, '-infinity'::timestamptz), v_time),
           raw_response_hash = v_hash, internal_status = 'approved_order_pending',
           attention_reason = case when v_approved_ops > 1 then 'multiple_approved_operations' else attention_reason end
     where id = v_intent.id;
    perform private.mobbex_event(v_intent.id, 'payment.approved', v_code, v_pid, v_time, v_hash, jsonb_build_object('source', p_source));
    -- Stock is still held, or is taken again in this very transaction (a payment can land after the reservation ran out).
    v_res := private.reserve_for_paid_session(v_session.id);
    if not coalesce((v_res ->> 'ok')::boolean, false) then
      update public.mobbex_payment_intents set internal_status = 'security_review_required', review_reason = 'approved_after_reservation_expired' where id = v_intent.id;
      update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'approved_after_reservation_expired'
       where id = v_session.id and status not in ('completed', 'finalizing_order');
      perform private.mobbex_event(v_intent.id, 'payment.manual_review_required', v_code, v_pid, v_time, v_hash,
        jsonb_build_object('reason', 'approved_after_reservation_expired', 'detail', v_res, 'action', 'devolver_el_dinero'));
      return jsonb_build_object('ok', true, 'manual_review_required', true, 'reason', 'stock_insuficiente',
        'action', 'devolver_el_dinero_desde_el_panel_de_Mobbex_o_con_el_reembolso_de_TABA');
    end if;
    update public.checkout_sessions
       set status = 'payment_approved', manual_review_reason = null, expires_at = greatest(expires_at, clock_timestamp() + interval '10 minutes')
     where id = v_session.id;
    v_final := public.mobbex_finalize_paid_checkout(v_session.id);
    return jsonb_build_object('ok', true, 'internal_status', (select internal_status from public.mobbex_payment_intents where id = v_intent.id),
      'finalized', coalesce((v_final ->> 'ok')::boolean, false), 'order_id', v_final ->> 'order_id',
      'manual_review_required', coalesce((v_final ->> 'manual_review_required')::boolean, false));

  elsif v_class in ('pending', 'authorized') then
    if v_open then
      update public.mobbex_payment_intents
         set provider_status_code = v_code, provider_status = v_class, provider_event_at = v_time, raw_response_hash = v_hash,
             internal_status = case when v_class = 'authorized' then 'in_process' else 'pending' end
       where id = v_intent.id;
      update public.checkout_sessions set status = 'payment_pending' where id = v_session.id and status in ('ready_for_payment', 'redirected');
    end if;
    perform private.mobbex_event(v_intent.id, 'payment.' || v_class, v_code, v_pid, v_time, v_hash, jsonb_build_object('source', p_source));
    return jsonb_build_object('ok', true, 'internal_status', (select internal_status from public.mobbex_payment_intents where id = v_intent.id));

  elsif v_class = 'rejected' then
    if v_open then
      update public.mobbex_payment_intents
         set provider_status_code = v_code, provider_status = 'rejected', provider_event_at = v_time, raw_response_hash = v_hash,
             internal_status = 'rejected', rejected_at = coalesce(rejected_at, v_time)
       where id = v_intent.id;
      -- A rejected card inside a live checkout may be retried: the reservation stays until the session ends.
      if v_session.expires_at > clock_timestamp() then
        update public.checkout_sessions set status = 'payment_pending' where id = v_session.id and status in ('ready_for_payment', 'redirected');
      else
        perform public.release_checkout_session_inventory(v_session.id, 'provider_rejected', 'cancelled');
      end if;
    end if;
    perform private.mobbex_event(v_intent.id, 'payment.rejected', v_code, v_pid, v_time, v_hash, jsonb_build_object('source', p_source));
    return jsonb_build_object('ok', true, 'internal_status', (select internal_status from public.mobbex_payment_intents where id = v_intent.id));

  elsif v_class in ('expired', 'cancelled') then
    if not v_paid then
      update public.mobbex_payment_intents
         set provider_status_code = v_code, provider_status = v_class, provider_event_at = v_time, raw_response_hash = v_hash,
             internal_status = case when v_open or internal_status in ('expired', 'cancelled') then v_class else internal_status end
       where id = v_intent.id;
      perform public.release_checkout_session_inventory(v_session.id, 'provider_' || v_class, case when v_class = 'expired' then 'expired' else 'cancelled' end);
    elsif v_class = 'cancelled' then
      -- Same-day cancellation of a paid operation = the whole amount is back with the buyer.
      update public.mobbex_payment_intents
         set provider_status_code = v_code, provider_status = 'refunded', provider_event_at = v_time, raw_response_hash = v_hash,
             refunded_amount = paid_amount, internal_status = 'refunded', attention_reason = null
       where id = v_intent.id;
    else
      update public.mobbex_payment_intents set attention_reason = left('paid_operation_regressed:' || v_code, 120) where id = v_intent.id;
    end if;
    perform private.mobbex_event(v_intent.id, 'payment.' || v_class, v_code, v_pid, v_time, v_hash, jsonb_build_object('source', p_source, 'was_paid', v_paid));
    return jsonb_build_object('ok', true, 'internal_status', (select internal_status from public.mobbex_payment_intents where id = v_intent.id));

  elsif v_class = 'reversing' then
    if v_paid then update public.mobbex_payment_intents set attention_reason = 'refund_in_progress' where id = v_intent.id; end if;
    perform private.mobbex_event(v_intent.id, 'payment.reversing', v_code, v_pid, v_time, v_hash, jsonb_build_object('source', p_source, 'was_paid', v_paid));
    return jsonb_build_object('ok', true, 'internal_status', v_intent.internal_status, 'attention', v_paid);

  elsif v_class = 'refunded' then
    if v_paid then
      update public.mobbex_payment_intents
         set provider_status_code = v_code, provider_status = 'refunded', provider_event_at = v_time, raw_response_hash = v_hash,
             refunded_amount = paid_amount, internal_status = 'refunded',
             attention_reason = case when attention_reason = 'refund_in_progress' then null else attention_reason end
       where id = v_intent.id;
    else
      -- The refund was seen before the approval (out of order / lost notice): the money is already back; no order is born.
      update public.mobbex_payment_intents
         set provider_payment_id = v_pid, provider_status_code = v_code, provider_status = 'refunded', provider_event_at = v_time,
             raw_response_hash = v_hash, paid_amount = v_amount, refunded_amount = v_amount, internal_status = 'refunded'
       where id = v_intent.id;
      perform public.release_checkout_session_inventory(v_session.id, 'provider_refunded', 'cancelled');
    end if;
    perform private.mobbex_event(v_intent.id, 'payment.refunded', v_code, v_pid, v_time, v_hash, jsonb_build_object('source', p_source, 'was_paid', v_paid));
    return jsonb_build_object('ok', true, 'internal_status', 'refunded');

  elsif v_class = 'partially_refunded' then
    if not v_paid then
      update public.mobbex_payment_intents set internal_status = 'security_review_required', review_reason = 'partial_refund_without_seen_approval' where id = v_intent.id;
      perform private.mobbex_event(v_intent.id, 'payment.partial_refund_unexpected', v_code, v_pid, v_time, v_hash, jsonb_build_object('source', p_source));
      return jsonb_build_object('ok', true, 'manual_review_required', true);
    end if;
    select coalesce(sum(r.amount), 0) into v_local from public.mobbex_refunds r where r.payment_intent_id = v_intent.id and r.status = 'approved' and r.amount is not null;
    begin v_refunded := nullif(p_snapshot ->> 'refunded_amount', '')::numeric(12, 2); exception when others then v_refunded := null; end;
    v_refunded := greatest(coalesce(v_refunded, 0), v_local, v_intent.refunded_amount);
    if v_refunded <= 0 then
      -- Mobbex says «parcialmente devuelta» but not how much, and TABA recorded no refund of its own.
      update public.mobbex_payment_intents set provider_status_code = v_code, attention_reason = 'partial_refund_amount_unknown' where id = v_intent.id;
    else
      update public.mobbex_payment_intents
         set provider_status_code = v_code, provider_status = 'partially_refunded', provider_event_at = v_time, raw_response_hash = v_hash,
             refunded_amount = least(paid_amount, v_refunded),
             internal_status = case when least(paid_amount, v_refunded) >= paid_amount then 'refunded' else 'partially_refunded' end,
             attention_reason = case when attention_reason in ('refund_in_progress', 'partial_refund_amount_unknown') then null else attention_reason end
       where id = v_intent.id;
    end if;
    perform private.mobbex_event(v_intent.id, 'payment.partially_refunded', v_code, v_pid, v_time, v_hash, jsonb_build_object('source', p_source, 'refunded', v_refunded));
    return jsonb_build_object('ok', true, 'internal_status', (select internal_status from public.mobbex_payment_intents where id = v_intent.id));

  else -- unknown: never approves, never regresses; a person looks at it.
    if v_paid then
      update public.mobbex_payment_intents set attention_reason = left('unknown_status_after_payment:' || v_code, 120) where id = v_intent.id;
    elsif v_open then
      update public.mobbex_payment_intents
         set provider_status_code = v_code, provider_status = 'unknown', internal_status = 'ambiguous',
             review_reason = left('unknown_provider_status:' || v_code, 120), raw_response_hash = v_hash
       where id = v_intent.id;
    end if;
    perform private.mobbex_event(v_intent.id, 'payment.unknown_status', v_code, v_pid, v_time, v_hash, jsonb_build_object('source', p_source, 'was_paid', v_paid));
    return jsonb_build_object('ok', true, 'unknown_status', true, 'internal_status', (select internal_status from public.mobbex_payment_intents where id = v_intent.id));
  end if;
end $$;

-- «No hay operación» (o Mobbex falló: indistinguibles, ver client.ts): jamás cuenta como pago ni como rechazo.
-- Sólo cuando la ventana del checkout terminó hace rato y hubo varias lecturas sin nada, el cobro se cierra como vencido.
create function public.mobbex_record_no_operation(p_intent_id uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_intent public.mobbex_payment_intents%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_age_seconds integer;
  v_closed boolean := false;
begin
  select * into v_intent from public.mobbex_payment_intents where id = p_intent_id for update;
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  select * into v_session from public.checkout_sessions where id = v_intent.checkout_session_id for update;
  update public.mobbex_payment_intents set reconcile_misses = reconcile_misses + 1, last_reconciled_at = clock_timestamp() where id = v_intent.id
    returning reconcile_misses into v_intent.reconcile_misses;
  if v_intent.reconcile_misses in (1, 10, 50) then
    perform private.mobbex_event(v_intent.id, 'reconcile.no_operation', left(coalesce(p_code, ''), 16), null, null, null,
      jsonb_build_object('misses', v_intent.reconcile_misses));
  end if;
  if v_intent.internal_status in ('created', 'checkout_creating', 'checkout_created', 'pending', 'ambiguous', 'rejected')
     and v_session.expires_at < clock_timestamp() - interval '3 hours' and v_intent.reconcile_misses >= 5 then
    update public.mobbex_payment_intents set internal_status = 'expired' where id = v_intent.id;
    perform public.release_checkout_session_inventory(v_session.id, 'no_payment_evidence', 'expired');
    perform private.mobbex_event(v_intent.id, 'reconcile.closed_without_payment', null, null, null, null, jsonb_build_object('misses', v_intent.reconcile_misses));
    v_closed := true;
  end if;
  v_age_seconds := greatest(0, extract(epoch from (clock_timestamp() - v_intent.created_at))::integer);
  return jsonb_build_object('ok', true, 'closed', v_closed,
    'retry_after_seconds', case when v_closed then 0 when v_age_seconds < 900 then 30 when v_age_seconds < 3600 then 120 else 600 end);
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 11. Reembolsos
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Se ejecuta con la sesión de la PERSONA (auth.uid()): sólo owner/admin del comercio. Registra la intención
-- ANTES de hablar con Mobbex; la clave de idempotencia hace que un reintento nunca dispare un segundo reintegro.
create function public.mobbex_prepare_refund(p_payment_intent_id uuid, p_amount numeric, p_idempotency_key uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_intent public.mobbex_payment_intents%rowtype;
  v_refund public.mobbex_refunds%rowtype;
  v_inflight numeric(12, 2);
  v_remaining numeric(12, 2);
  v_amount numeric(12, 2);
begin
  if v_actor is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  select * into v_intent from public.mobbex_payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'reembolso no autorizado' using errcode = '42501';
  end if;
  select * into v_refund from public.mobbex_refunds r where r.idempotency_key = p_idempotency_key;
  if found then
    if v_refund.payment_intent_id <> v_intent.id then raise exception 'clave de idempotencia reutilizada' using errcode = '23505'; end if;
    -- A repeated durable request is NEVER sent again: it is reconciled by its stored identity.
    return jsonb_build_object('refund_id', v_refund.id, 'idempotent', true, 'reconciliation_required', v_refund.status in ('processing', 'ambiguous', 'requested'),
      'status', v_refund.status);
  end if;
  -- Money taken but no order (stock ran out before the payment landed) is refundable too: that is the whole point.
  if v_intent.provider_payment_id is null or v_intent.paid_amount is null or not (
       v_intent.internal_status in ('completed', 'partially_refunded')
       or (v_intent.order_id is null and v_intent.internal_status = 'security_review_required'
           and v_intent.review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation'))) then
    raise exception 'pago no reembolsable en su estado actual' using errcode = '55000';
  end if;
  if exists (select 1 from public.mobbex_refunds r where r.payment_intent_id = v_intent.id and r.status in ('requested', 'processing', 'ambiguous')) then
    raise exception 'ya hay un reembolso en curso para este pago' using errcode = '55000';
  end if;
  v_remaining := v_intent.paid_amount - v_intent.refunded_amount;
  if p_amount is not null then
    v_amount := round(p_amount, 2);
    if v_amount <= 0 or v_amount > v_remaining then raise exception 'importe de reembolso invalido' using errcode = '22023'; end if;
  end if;
  insert into public.mobbex_refunds (payment_intent_id, idempotency_key, amount, requested_by, reason)
  values (v_intent.id, p_idempotency_key, case when v_amount is not null and v_amount < v_remaining then v_amount else null end, v_actor, left(btrim(coalesce(p_reason, '')), 300))
  returning * into v_refund;
  perform private.mobbex_event(v_intent.id, 'refund.requested', null, v_intent.provider_payment_id, null, null,
    jsonb_build_object('refund_id', v_refund.id, 'amount', v_refund.amount, 'actor', v_actor));
  return jsonb_build_object('refund_id', v_refund.id, 'idempotent', false, 'reconciliation_required', false,
    'amount', v_refund.amount, 'full', v_refund.amount is null, 'provider_payment_id', v_intent.provider_payment_id,
    'reference', v_intent.reference, 'environment', v_intent.environment);
end $$;

-- Cobro aprobado sin pedido porque faltó stock: cuando hay stock otra vez, una persona del comercio lo cierra.
create function public.mobbex_recover_paid_checkout(p_payment_intent_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_intent public.mobbex_payment_intents%rowtype;
  v_final jsonb;
begin
  if v_actor is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  select * into v_intent from public.mobbex_payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'recuperacion no autorizada' using errcode = '42501';
  end if;
  if v_intent.paid_amount is null or v_intent.order_id is not null or v_intent.internal_status <> 'security_review_required'
     or v_intent.review_reason not in ('approved_after_reservation_expired', 'finalization_without_active_reservation')
     or exists (select 1 from public.mobbex_refunds r where r.payment_intent_id = v_intent.id and r.status in ('requested', 'processing', 'ambiguous', 'approved')) then
    raise exception 'este cobro no es recuperable como pedido' using errcode = '55000';
  end if;
  update public.mobbex_payment_intents set internal_status = 'approved_order_pending', review_reason = null where id = v_intent.id;
  update public.checkout_sessions set status = 'payment_approved', manual_review_reason = null
   where id = v_intent.checkout_session_id and status = 'manual_review_required';
  v_final := public.mobbex_finalize_paid_checkout(v_intent.checkout_session_id);
  perform private.mobbex_event(v_intent.id, 'payment.recovered_by_operator', null, v_intent.provider_payment_id, null, null,
    jsonb_build_object('actor', v_actor, 'result', v_final));
  return v_final;
end $$;

create function public.mobbex_mark_refund_sent(p_refund_id uuid) returns void
language sql security definer set search_path = pg_catalog, public, pg_temp as $$
  update public.mobbex_refunds set status = 'processing' where id = p_refund_id and status = 'requested'; $$;

create function public.mobbex_record_refund_result(p_refund_id uuid, p_outcome text, p_response_hash text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_refund public.mobbex_refunds%rowtype;
  v_intent public.mobbex_payment_intents%rowtype;
  v_amount numeric(12, 2);
begin
  if p_outcome not in ('approved', 'rejected', 'ambiguous') then raise exception 'resultado de reembolso invalido' using errcode = '22023'; end if;
  select * into v_refund from public.mobbex_refunds where id = p_refund_id for update;
  if not found then raise exception 'reembolso inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.mobbex_payment_intents where id = v_refund.payment_intent_id for update;
  if v_refund.status in ('approved', 'rejected') then return jsonb_build_object('ok', true, 'idempotent', true, 'status', v_refund.status); end if;
  update public.mobbex_refunds
     set status = p_outcome, provider_response_hash = p_response_hash, completed_at = case when p_outcome <> 'ambiguous' then clock_timestamp() end
   where id = v_refund.id;
  if p_outcome = 'approved' then
    v_amount := coalesce(v_refund.amount, v_intent.paid_amount - v_intent.refunded_amount);
    update public.mobbex_payment_intents
       set refunded_amount = least(paid_amount, refunded_amount + v_amount),
           internal_status = case when least(paid_amount, refunded_amount + v_amount) >= paid_amount then 'refunded' else 'partially_refunded' end
     where id = v_intent.id;
  end if;
  perform private.mobbex_event(v_intent.id, 'refund.' || p_outcome, null, v_intent.provider_payment_id, null, p_response_hash,
    jsonb_build_object('refund_id', v_refund.id, 'amount', v_refund.amount));
  -- Whatever the answer, the provider's own state is read again to confirm (601/602/605).
  perform private.mobbex_enqueue_job(v_intent.id, 'refund_check', 5);
  return jsonb_build_object('ok', true, 'status', p_outcome);
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 12. Barrido y salud
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────

create function public.mobbex_sweep(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_enqueued integer := 0;
  v_purged integer := 0;
  v_intent uuid;
begin
  -- Cobros abiertos sin trabajo abierto (aviso perdido, worker caído, deploy en medio): vuelven a la cola.
  for v_intent in
    select i.id from public.mobbex_payment_intents i
     where i.internal_status in ('checkout_created', 'pending', 'in_process', 'ambiguous', 'approved_order_pending', 'rejected')
       and i.updated_at < clock_timestamp() - interval '2 minutes'
       and i.created_at > clock_timestamp() - interval '2 days'
       and not exists (select 1 from public.mobbex_jobs j where j.payment_intent_id = i.id and j.status in ('pending', 'claimed', 'retry_wait'))
     order by i.updated_at
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    perform private.mobbex_enqueue_job(v_intent, 'sweep', 0);
    v_enqueued := v_enqueued + 1;
  end loop;
  -- Retención: los avisos y los trabajos terminados no se guardan para siempre.
  delete from public.mobbex_webhook_receipts where id in (select id from public.mobbex_webhook_receipts where received_at < clock_timestamp() - interval '90 days' limit 500);
  get diagnostics v_purged = row_count;
  delete from public.mobbex_jobs where id in (select id from public.mobbex_jobs where status = 'completed' and completed_at < clock_timestamp() - interval '30 days' limit 500);
  return jsonb_build_object('enqueued', v_enqueued, 'purged_receipts', v_purged);
end $$;

-- Para alertas: SÓLO hay algo que atender si una persona tiene que intervenir.
create function public.mobbex_pipeline_health() returns jsonb
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select jsonb_build_object(
    'dead_letter_jobs', (select count(*) from public.mobbex_jobs where status = 'dead_letter'),
    'oldest_open_job_seconds', coalesce((select extract(epoch from (clock_timestamp() - min(next_attempt_at)))::integer
        from public.mobbex_jobs where status in ('pending', 'retry_wait') and next_attempt_at < clock_timestamp()), 0),
    'intents_in_review', (select count(*) from public.mobbex_payment_intents where internal_status = 'security_review_required'),
    'intents_with_attention', (select count(*) from public.mobbex_payment_intents where attention_reason is not null),
    'paid_without_order', (select count(*) from public.mobbex_payment_intents where internal_status = 'approved_order_pending' and updated_at < clock_timestamp() - interval '10 minutes'),
    'open_intents', (select count(*) from public.mobbex_payment_intents where internal_status in ('checkout_created', 'pending', 'in_process', 'ambiguous', 'approved_order_pending')),
    'needs_attention', exists (select 1 from public.mobbex_jobs where status = 'dead_letter')
        or exists (select 1 from public.mobbex_payment_intents where internal_status = 'security_review_required' or attention_reason is not null)
        or exists (select 1 from public.mobbex_payment_intents where internal_status = 'approved_order_pending' and updated_at < clock_timestamp() - interval '10 minutes'));
$$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 13. Permisos: todo cerrado salvo lo que el navegador puede leer
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────

do $grants$
declare v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'mobbex\_%' or p.proname in (
       'configure_mobbex_business', 'authorize_mobbex_live_payment', 'abort_mobbex_live_payment', 'create_mobbex_checkout_session',
       'get_mobbex_checkout_availability', 'get_mobbex_checkout_status', 'enforce_mobbex_live_gate',
       'assert_mobbex_order_payment_modality'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end $grants$;

-- Lo único que el navegador puede invocar: lecturas de su propio checkout y su propio reembolso.
grant execute on function public.get_mobbex_checkout_availability(uuid) to authenticated;
grant execute on function public.get_mobbex_checkout_status(uuid) to authenticated;
grant execute on function public.mobbex_request_reconcile(uuid) to authenticated;
grant execute on function public.mobbex_prepare_refund(uuid, numeric, uuid, text) to authenticated;
grant execute on function public.mobbex_recover_paid_checkout(uuid) to authenticated;
revoke all on function private.mobbex_event(uuid, text, text, text, timestamptz, text, jsonb) from public, anon, authenticated;
revoke all on function private.mobbex_enqueue_job(uuid, text, integer) from public, anon, authenticated;

comment on table public.mobbex_payment_intents is
  'Cobros Mobbex Checkout (cuenta propia del comercio). Ledger paralelo a payment_intents: ningún proceso de Mercado Pago lo ve.';
comment on function public.mobbex_record_provider_snapshot(uuid, jsonb, text) is
  'Única puerta de entrada de una lectura CONFIRMADA de Mobbex. El aviso del navegador o el webhook nunca marcan pagado.';
