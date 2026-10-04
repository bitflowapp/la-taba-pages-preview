-- La admisión de pedidos tiene un solo guardián, y vale para efectivo y para Mercado Pago.
--
-- QUÉ ESTABA ABIERTO (medido el 2026-10-01 sobre las 158 migraciones anteriores)
--
--   1. `create_order_with_items` —el pedido en efectivo/a coordinar— no tenía NINGÚN
--      límite: ni por cliente, ni por ventana, ni por negocio, ni por origen. Una
--      identidad anónima (el cliente web entra con `signInAnonymously`) podía crear
--      pedidos sin tope, y cada uno descuenta stock al nacer y lo retiene sin
--      vencimiento.
--   2. `businesses.max_pending_orders_per_customer` no lo leía nadie, en ningún camino.
--   3. `businesses.order_rate_limit_per_10_minutes` sólo lo leía `create_checkout_session`,
--      contaba sesiones y no pedidos, valía «sin límite» cuando estaba en NULL y no
--      tomaba ningún lock: N pedidos simultáneos con claves distintas pasaban los N.
--   4. `order_abuse_events` existía desde 20260725060000 y nadie le escribía.
--   5. Un solo pedido sin pagar podía llevarse 100 productos × 1000 unidades.
--
-- QUÉ QUEDA
--
--   Un guardián central (`private.order_intake_evaluate`) que consultan las DOS
--   puertas por las que nace un compromiso de stock sin cobro:
--
--     · `create_order_with_items`  (cliente → PostgREST, efectivo / a coordinar)
--     · `create_checkout_session`  (Edge Function → PostgREST, Mercado Pago)
--
--   Las dos sacan del MISMO presupuesto: alternar de canal no duplica el cupo.
--
--   Dimensiones, en este orden:
--     enfriamiento  quien siguió golpeando después de ser frenado espera más
--     cliente       pedidos sin atender y pedidos por ventana de 10 minutos
--     origen        lo mismo, por dirección de red (sólo donde el dato es confiable)
--     negocio       techo por ventana, contra la rotación de identidades
--
--   Lo que NO hace, a propósito:
--     · no cuenta ni frena un reintento idempotente (misma clave → mismo pedido);
--     · no toca un pedido ya pagado: `finalize_paid_checkout_session` no pasa por acá;
--     · no cuenta como «pendiente» lo que el comercio ya aceptó;
--     · no guarda direcciones IP: guarda un HMAC con una sal que no sale de la base;
--     · no deja el local sin vender por un error propio: si el guardián falla, deja
--       pasar y lo anota (`guard_error`).
--
-- DE DÓNDE SALE EL ORIGEN (medido en Staging el 2026-10-01 con una función sonda)
--
--   PostgREST recibe `cf-connecting-ip`, `x-forwarded-for` y `sb-forwarded-for`.
--   Mandando esos encabezados desde el cliente:
--     · `cf-connecting-ip` falsificado → Cloudflare responde 403; el valor que llega
--       es siempre el real;
--     · `x-forwarded-for` falsificado → llega «<falso>, <real>»: el PRIMER elemento lo
--       elige el cliente;
--     · `sb-forwarded-for` falsificado → llega el falso.
--   Por eso sólo se confía en `cf-connecting-ip`. Si no está, la dimensión de origen
--   se saltea (las otras siguen valiendo): nunca se usa un dato que el cliente elige.
--
-- POR QUÉ UN FRENO NO SIEMPRE ES UNA EXCEPCIÓN
--
--   Una excepción deshace la transacción entera, incluida la anotación del intento.
--   Cuando la llamada viene por PostgREST el guardián anota, pone `response.status`
--   en 429 y DEVUELVE el mismo cuerpo que PostgREST arma para un error
--   (`code`, `message`, `details`, `hint`): el cliente recibe un error, y el intento
--   queda escrito. Fuera de PostgREST (pgTAP, SQL directo) levanta la excepción de
--   siempre. Es el mismo contrato visto desde cada capa.
--
-- Forward-only. Reversión: docs/migrations/rollback/20261001180000_order_intake_guard.rollback.sql

-- ── 1. Configuración por negocio ─────────────────────────────────────────────
alter table public.businesses
  add column if not exists order_intake_guard_mode text not null default 'enforce',
  add column if not exists order_ip_rate_limit_per_10_minutes integer,
  add column if not exists max_pending_orders_per_ip integer,
  add column if not exists order_business_rate_limit_per_10_minutes integer,
  add column if not exists max_units_per_unpaid_order integer;

alter table public.businesses drop constraint if exists businesses_order_intake_guard_valid;
alter table public.businesses add constraint businesses_order_intake_guard_valid check (
  order_intake_guard_mode in ('enforce', 'monitor', 'off')
  and (order_ip_rate_limit_per_10_minutes is null or order_ip_rate_limit_per_10_minutes between 1 and 100000)
  and (max_pending_orders_per_ip is null or max_pending_orders_per_ip between 1 and 100000)
  and (order_business_rate_limit_per_10_minutes is null or order_business_rate_limit_per_10_minutes between 1 and 100000)
  and (max_units_per_unpaid_order is null or max_units_per_unpaid_order between 1 and 100000)
);

comment on column public.businesses.order_intake_guard_mode is
  'enforce: el guardian de admision frena; monitor: evalua, anota y deja pasar; off: no evalua. Solo lo cambia la plataforma.';
comment on column public.businesses.order_rate_limit_per_10_minutes is
  'Pedidos y checkouts que un mismo cliente puede iniciar en 10 minutos. NULL usa el valor de private.order_intake_defaults().';
comment on column public.businesses.max_pending_orders_per_customer is
  'Pedidos sin atender (mas checkouts sin pagar) que un mismo cliente puede tener a la vez. NULL usa el valor por defecto.';
comment on column public.businesses.order_ip_rate_limit_per_10_minutes is
  'Pedidos manuales que un mismo origen de red puede iniciar en 10 minutos. NULL usa el valor por defecto.';
comment on column public.businesses.max_pending_orders_per_ip is
  'Pedidos manuales sin atender que un mismo origen de red puede tener a la vez. NULL usa el valor por defecto.';
comment on column public.businesses.order_business_rate_limit_per_10_minutes is
  'Techo de pedidos y checkouts iniciados en 10 minutos para todo el negocio. NULL usa el valor por defecto.';
comment on column public.businesses.max_units_per_unpaid_order is
  'Unidades totales que acepta un pedido que todavia no se cobro. NULL usa el valor por defecto.';

-- Los límites los afina el dueño, igual que los dos que ya existían (misma regla de
-- columnas que 20260725120000). El modo NO: apagar el guardián es de la plataforma.
grant update (
  order_ip_rate_limit_per_10_minutes,
  max_pending_orders_per_ip,
  order_business_rate_limit_per_10_minutes,
  max_units_per_unpaid_order
) on public.businesses to authenticated;

-- Los negocios de QA (capacidad, carreras de última unidad) llegan desde un solo
-- origen y con ráfagas que un cliente real no hace: llevan techos propios y
-- explícitos en lugar de una excepción en el código.
update public.businesses
   set order_ip_rate_limit_per_10_minutes = coalesce(order_ip_rate_limit_per_10_minutes, 2000),
       max_pending_orders_per_ip = coalesce(max_pending_orders_per_ip, 2000),
       order_business_rate_limit_per_10_minutes = coalesce(order_business_rate_limit_per_10_minutes, 5000)
 where qa_fixture;

-- ── 2. Valores por defecto: NULL nunca significa «sin límite» ───────────────
create or replace function private.order_intake_defaults()
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'customer_rate_per_10_minutes', 20,
    'customer_pending', 5,
    'ip_rate_per_10_minutes', 30,
    'ip_pending', 15,
    'business_rate_per_10_minutes', 120,
    'unpaid_order_units', 120,
    'cooldown_blocked_attempts', 20,
    'window_seconds', 600
  );
$$;
revoke all on function private.order_intake_defaults() from public, anon, authenticated;

-- ── 3. Estado privado ───────────────────────────────────────────────────────
-- Una sal por base, generada acá y nunca leída por un rol de cliente.
create table if not exists private.order_intake_secret (
  singleton boolean primary key default true check (singleton),
  fingerprint_salt bytea not null default extensions.gen_random_bytes(32),
  created_at timestamptz not null default clock_timestamp(),
  constraint order_intake_secret_salt_length check (octet_length(fingerprint_salt) = 32)
);
alter table private.order_intake_secret enable row level security;
revoke all on table private.order_intake_secret from public, anon, authenticated;
insert into private.order_intake_secret (singleton) values (true) on conflict (singleton) do nothing;

-- Una fila por admisión ACEPTADA. Se confirma con el pedido y se deshace con él.
create table if not exists private.order_intake_log (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_user_id uuid not null,
  fingerprint_hash bytea,
  channel text not null,
  order_id uuid,
  checkout_session_id uuid,
  units integer,
  created_at timestamptz not null default clock_timestamp(),
  constraint order_intake_log_channel_valid check (channel in ('manual', 'checkout')),
  constraint order_intake_log_no_raw_fingerprint check (fingerprint_hash is null or octet_length(fingerprint_hash) = 32),
  constraint order_intake_log_one_target check ((order_id is not null) <> (checkout_session_id is not null))
);
create index if not exists order_intake_log_fingerprint_idx
  on private.order_intake_log (business_id, fingerprint_hash, created_at desc)
  where fingerprint_hash is not null;
create index if not exists order_intake_log_created_idx on private.order_intake_log (created_at);
alter table private.order_intake_log enable row level security;
revoke all on table private.order_intake_log from public, anon, authenticated;

-- Intentos FRENADOS, en baldes de 10 minutos: una fila por sujeto y ventana, no una
-- por intento. Quien golpea mil veces escribe una fila, no mil.
create table if not exists private.order_intake_blocks (
  business_id uuid not null references public.businesses(id) on delete cascade,
  scope text not null,
  subject_hash bytea not null,
  window_started_at timestamptz not null,
  blocked_count integer not null default 0,
  last_reason text not null,
  first_blocked_at timestamptz not null default clock_timestamp(),
  last_blocked_at timestamptz not null default clock_timestamp(),
  primary key (business_id, scope, subject_hash, window_started_at),
  constraint order_intake_blocks_scope_valid check (scope in ('customer', 'ip', 'business')),
  constraint order_intake_blocks_subject_length check (octet_length(subject_hash) = 32),
  constraint order_intake_blocks_count_positive check (blocked_count >= 0)
);
create index if not exists order_intake_blocks_window_idx on private.order_intake_blocks (window_started_at);
alter table private.order_intake_blocks enable row level security;
revoke all on table private.order_intake_blocks from public, anon, authenticated;

-- El techo por negocio cuenta sesiones de checkout por negocio y fecha.
create index if not exists checkout_sessions_business_created_idx
  on public.checkout_sessions (business_id, created_at desc);

-- ── 4. Origen de red ────────────────────────────────────────────────────────
-- Devuelve HMAC-SHA256(sal, dirección) o NULL. Nunca devuelve ni guarda la dirección.
-- IPv6 se reduce a su /64: dentro de un /64 el cliente elige la dirección.
create or replace function private.order_intake_client_fingerprint()
returns bytea
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_headers jsonb;
  v_raw text;
  v_address inet;
  v_salt bytea;
begin
  v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  v_raw := nullif(btrim(coalesce(v_headers ->> 'cf-connecting-ip', '')), '');
  if v_raw is null or char_length(v_raw) > 64 then
    return null;
  end if;
  v_address := v_raw::inet;
  if family(v_address) = 6 then
    v_address := set_masklen(v_address, 64);
    v_address := network(v_address);
  end if;
  select s.fingerprint_salt into v_salt from private.order_intake_secret s where s.singleton;
  if v_salt is null then
    return null;
  end if;
  return hmac(convert_to(host(v_address), 'UTF8'), v_salt, 'sha256');
exception
  when others then
    return null;   -- encabezado ausente o ilegible: la dimensión se saltea, no se inventa
end;
$$;
revoke all on function private.order_intake_client_fingerprint() from public, anon, authenticated;

-- ── 5. La decisión ──────────────────────────────────────────────────────────
-- Sólo lee. Los locks consultivos los toma quien llama, ANTES, para que el conteo
-- sea exacto con pedidos simultáneos del mismo cliente o del mismo origen.
create or replace function private.order_intake_evaluate(
  p_business public.businesses,
  p_customer_id uuid,
  p_fingerprint bytea,
  p_channel text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_defaults jsonb := private.order_intake_defaults();
  v_window interval := make_interval(secs => (v_defaults ->> 'window_seconds')::integer);
  v_window_seconds integer := (v_defaults ->> 'window_seconds')::integer;
  v_now timestamptz := clock_timestamp();
  v_since timestamptz := v_now - v_window;
  v_bucket timestamptz := to_timestamp(floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds);
  v_customer_rate integer := coalesce(p_business.order_rate_limit_per_10_minutes, (v_defaults ->> 'customer_rate_per_10_minutes')::integer);
  v_customer_pending integer := coalesce(p_business.max_pending_orders_per_customer, (v_defaults ->> 'customer_pending')::integer);
  v_ip_rate integer := coalesce(p_business.order_ip_rate_limit_per_10_minutes, (v_defaults ->> 'ip_rate_per_10_minutes')::integer);
  v_ip_pending integer := coalesce(p_business.max_pending_orders_per_ip, (v_defaults ->> 'ip_pending')::integer);
  v_business_rate integer := coalesce(p_business.order_business_rate_limit_per_10_minutes, (v_defaults ->> 'business_rate_per_10_minutes')::integer);
  v_cooldown integer := (v_defaults ->> 'cooldown_blocked_attempts')::integer;
  v_customer_subject bytea := digest(p_customer_id::text, 'sha256');
  v_count integer;
  v_counts jsonb := '{}'::jsonb;
  v_block jsonb;
begin
  -- Enfriamiento: frenos acumulados en la ventana actual y la anterior.
  select coalesce(sum(b.blocked_count), 0)::integer into v_count
    from private.order_intake_blocks b
   where b.business_id = p_business.id
     and b.window_started_at >= v_bucket - v_window
     and (
       (b.scope = 'customer' and b.subject_hash = v_customer_subject)
       or (p_fingerprint is not null and b.scope = 'ip' and b.subject_hash = p_fingerprint)
     );
  v_counts := v_counts || jsonb_build_object('blocked_recent', v_count);
  if v_count >= v_cooldown then
    v_block := jsonb_build_object('reason', 'cooldown', 'scope', 'customer', 'limit', v_cooldown, 'observed', v_count,
      'retry_after_seconds', v_window_seconds);
  end if;

  -- Cliente: lo que tiene sin atender. Un pedido que el comercio ya aceptó no cuenta,
  -- y uno ya cobrado por Mercado Pago tampoco.
  if v_block is null then
    select (
      select count(*) from public.orders o
       where o.customer_user_id = p_customer_id
         and o.business_id = p_business.id
         and o.status in ('received', 'submitted')
         and o.payment_method <> 'mercadopago'
    ) + (
      select count(*) from public.checkout_sessions s
       where s.customer_id = p_customer_id
         and s.business_id = p_business.id
         and s.status in ('created', 'validating', 'ready_for_payment', 'redirected', 'payment_pending', 'retrying')
         and s.expires_at > v_now
    ) into v_count;
    v_counts := v_counts || jsonb_build_object('customer_pending', v_count);
    if v_count >= v_customer_pending then
      v_block := jsonb_build_object('reason', 'customer_pending', 'scope', 'customer', 'limit', v_customer_pending,
        'observed', v_count, 'retry_after_seconds', 120);
    end if;
  end if;

  -- Cliente: ventana. Los dos canales salen del mismo cupo. Un pedido pagado nace de
  -- su sesión: se cuenta la sesión, no el pedido que salió de ella.
  if v_block is null then
    select (
      select count(*) from public.orders o
       where o.customer_user_id = p_customer_id
         and o.business_id = p_business.id
         and o.created_at >= v_since
         and o.payment_method <> 'mercadopago'
    ) + (
      select count(*) from public.checkout_sessions s
       where s.customer_id = p_customer_id
         and s.business_id = p_business.id
         and s.created_at >= v_since
    ) into v_count;
    v_counts := v_counts || jsonb_build_object('customer_window', v_count);
    if v_count >= v_customer_rate then
      v_block := jsonb_build_object('reason', 'customer_rate', 'scope', 'customer', 'limit', v_customer_rate,
        'observed', v_count, 'retry_after_seconds', v_window_seconds);
    end if;
  end if;

  -- Origen de red: sólo donde hay un dato confiable (pedido manual por PostgREST).
  if v_block is null and p_fingerprint is not null then
    select count(*) into v_count
      from private.order_intake_log l
      join public.orders o on o.id = l.order_id
     where l.business_id = p_business.id
       and l.fingerprint_hash = p_fingerprint
       and o.status in ('received', 'submitted')
       and o.payment_method <> 'mercadopago';
    v_counts := v_counts || jsonb_build_object('ip_pending', v_count);
    if v_count >= v_ip_pending then
      v_block := jsonb_build_object('reason', 'ip_pending', 'scope', 'ip', 'limit', v_ip_pending,
        'observed', v_count, 'retry_after_seconds', 120);
    end if;
  end if;
  if v_block is null and p_fingerprint is not null then
    select count(*) into v_count
      from private.order_intake_log l
     where l.business_id = p_business.id
       and l.fingerprint_hash = p_fingerprint
       and l.created_at >= v_since;
    v_counts := v_counts || jsonb_build_object('ip_window', v_count);
    if v_count >= v_ip_rate then
      v_block := jsonb_build_object('reason', 'ip_rate', 'scope', 'ip', 'limit', v_ip_rate,
        'observed', v_count, 'retry_after_seconds', v_window_seconds);
    end if;
  end if;

  -- Negocio: el último freno contra la rotación de identidades y de orígenes. Es un
  -- conteo sin lock: bajo concurrencia puede pasarse por el grado de simultaneidad,
  -- y a cambio no serializa todos los pedidos del local detrás de un solo candado.
  if v_block is null then
    select (
      select count(*) from public.orders o
       where o.business_id = p_business.id
         and o.created_at >= v_since
         and o.payment_method <> 'mercadopago'
    ) + (
      select count(*) from public.checkout_sessions s
       where s.business_id = p_business.id
         and s.created_at >= v_since
    ) into v_count;
    v_counts := v_counts || jsonb_build_object('business_window', v_count);
    if v_count >= v_business_rate then
      v_block := jsonb_build_object('reason', 'business_rate', 'scope', 'business', 'limit', v_business_rate,
        'observed', v_count, 'retry_after_seconds', v_window_seconds);
    end if;
  end if;

  return jsonb_build_object('allowed', v_block is null, 'channel', p_channel, 'counts', v_counts)
    || coalesce(v_block, '{}'::jsonb);
end;
$$;
revoke all on function private.order_intake_evaluate(public.businesses, uuid, bytea, text) from public, anon, authenticated;

-- ── 6. Anotar un freno ──────────────────────────────────────────────────────
-- Suma en el balde del cliente y, si hay origen, en el del origen. El evento visible
-- para el dueño (`order_abuse_events`) se escribe una sola vez por sujeto y ventana.
create or replace function private.order_intake_record_block(
  p_business_id uuid,
  p_customer_id uuid,
  p_fingerprint bytea,
  p_reason text,
  p_scope text,
  p_monitor boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_window_seconds integer := (private.order_intake_defaults() ->> 'window_seconds')::integer;
  v_bucket timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp()) / v_window_seconds) * v_window_seconds);
  v_reason text := left(coalesce(p_reason, 'unknown'), 60);
  v_first boolean := false;
  v_count integer;
begin
  if p_customer_id is not null then
    insert into private.order_intake_blocks as b (business_id, scope, subject_hash, window_started_at, blocked_count, last_reason)
    values (p_business_id, 'customer', digest(p_customer_id::text, 'sha256'), v_bucket, 1, v_reason)
    on conflict (business_id, scope, subject_hash, window_started_at)
    do update set blocked_count = b.blocked_count + 1, last_reason = excluded.last_reason, last_blocked_at = clock_timestamp()
    returning b.blocked_count into v_count;
    v_first := v_first or v_count = 1;
  end if;
  if p_fingerprint is not null then
    insert into private.order_intake_blocks as b (business_id, scope, subject_hash, window_started_at, blocked_count, last_reason)
    values (p_business_id, 'ip', p_fingerprint, v_bucket, 1, v_reason)
    on conflict (business_id, scope, subject_hash, window_started_at)
    do update set blocked_count = b.blocked_count + 1, last_reason = excluded.last_reason, last_blocked_at = clock_timestamp()
    returning b.blocked_count into v_count;
    v_first := v_first or v_count = 1;
  end if;
  if p_scope = 'business' or (p_customer_id is null and p_fingerprint is null) then
    insert into private.order_intake_blocks as b (business_id, scope, subject_hash, window_started_at, blocked_count, last_reason)
    values (p_business_id, 'business', digest(p_business_id::text, 'sha256'), v_bucket, 1, v_reason)
    on conflict (business_id, scope, subject_hash, window_started_at)
    do update set blocked_count = b.blocked_count + 1, last_reason = excluded.last_reason, last_blocked_at = clock_timestamp()
    returning b.blocked_count into v_count;
    v_first := v_first or v_count = 1;
  end if;
  if v_first then
    insert into public.order_abuse_events (business_id, customer_user_id, fingerprint_hash, event_type)
    values (p_business_id, p_customer_id, p_fingerprint,
      case when p_monitor then 'order_intake_would_block:' else 'order_intake_blocked:' end || v_reason);
  end if;
end;
$$;
revoke all on function private.order_intake_record_block(uuid, uuid, bytea, text, text, boolean) from public, anon, authenticated;

create index if not exists order_abuse_events_business_created_idx
  on public.order_abuse_events (business_id, created_at desc);

-- ── 7. El guardián: una sola función para las dos puertas ───────────────────
-- Devuelve NULL cuando la admisión sigue. Cuando frena:
--   · por PostgREST: anota, pone 429 y devuelve el cuerpo de error (la transacción
--     se confirma y el intento queda escrito);
--   · fuera de PostgREST: levanta la excepción.
-- `p_error_code` / `p_error_message` conservan el contrato de cada puerta.
create or replace function private.order_intake_guard(
  p_business public.businesses,
  p_customer_id uuid,
  p_channel text,
  p_units bigint,
  p_error_code text,
  p_error_message text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_defaults jsonb := private.order_intake_defaults();
  v_mode text := p_business.order_intake_guard_mode;
  v_unit_cap integer := coalesce(p_business.max_units_per_unpaid_order, (v_defaults ->> 'unpaid_order_units')::integer);
  v_fingerprint bytea;
  v_decision jsonb;
  v_reason text;
  v_retry integer;
  v_hint text;
  v_via_api boolean := coalesce(nullif(current_setting('request.method', true), ''), '') <> '';
begin
  if v_mode = 'off' then
    return null;
  end if;

  -- Tamaño de un pedido que todavía no se cobró. Es una validación, no un freno por
  -- abuso: se rechaza con el código de las demás validaciones y no se anota.
  if p_units is not null and p_units > v_unit_cap and v_mode = 'enforce' then
    raise exception 'ORDER_TOO_LARGE'
      using errcode = '22023',
            detail = format('un pedido sin cobrar acepta hasta %s unidades', v_unit_cap),
            hint = 'reducir las cantidades o coordinar el pedido con el comercio';
  end if;

  -- El origen sólo existe cuando el cliente llega directo a PostgREST. En el canal
  -- de checkout quien llama es la Edge Function: sus encabezados no son del cliente.
  if p_channel = 'manual' then
    v_fingerprint := private.order_intake_client_fingerprint();
    if v_fingerprint is not null then
      perform pg_advisory_xact_lock(
        hashtext('taba.order_intake.ip'),
        hashtext(p_business.id::text || ':' || encode(v_fingerprint, 'hex')));
    end if;
  end if;

  begin
    v_decision := private.order_intake_evaluate(p_business, p_customer_id, v_fingerprint, p_channel);
  exception
    when others then
      -- Falla abierta: un error del guardián no puede dejar al local sin vender.
      -- Anotarlo tampoco puede: si hasta eso falla, el pedido sigue igual.
      begin
        perform private.order_intake_record_block(p_business.id, null, null, 'guard_error', 'business', true);
      exception
        when others then null;
      end;
      perform set_config('taba.order_intake_fingerprint', coalesce(encode(v_fingerprint, 'hex'), ''), true);
      return null;
  end;

  perform set_config('taba.order_intake_fingerprint', coalesce(encode(v_fingerprint, 'hex'), ''), true);

  if coalesce((v_decision ->> 'allowed')::boolean, true) then
    return null;
  end if;

  v_reason := coalesce(v_decision ->> 'reason', 'unknown');
  v_retry := coalesce((v_decision ->> 'retry_after_seconds')::integer, 600);
  perform private.order_intake_record_block(
    p_business.id, p_customer_id, v_fingerprint, v_reason, coalesce(v_decision ->> 'scope', 'customer'), v_mode = 'monitor');

  if v_mode = 'monitor' then
    return null;
  end if;

  v_hint := case
    when v_reason in ('customer_pending', 'ip_pending')
      then 'esperar a que el comercio confirme los pedidos anteriores'
    else format('reintentar en %s segundos', v_retry)
  end;

  if v_via_api then
    perform set_config('response.status', '429', true);
    perform set_config('response.headers', jsonb_build_array(jsonb_build_object('Retry-After', v_retry::text))::text, true);
    return jsonb_build_object('code', p_error_code, 'message', p_error_message, 'details', v_reason, 'hint', v_hint);
  end if;

  raise exception '%', p_error_message using errcode = p_error_code, detail = v_reason, hint = v_hint;
end;
$$;
revoke all on function private.order_intake_guard(public.businesses, uuid, text, bigint, text, text) from public, anon, authenticated;

-- Anotar una admisión aceptada. El origen viaja por un ajuste local a la transacción
-- (mismo patrón que `taba.pending_delivery_location`): no cambia ninguna firma.
create or replace function private.order_intake_record_accept(
  p_business_id uuid,
  p_customer_id uuid,
  p_channel text,
  p_order_id uuid,
  p_checkout_session_id uuid,
  p_units bigint
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_hex text := nullif(current_setting('taba.order_intake_fingerprint', true), '');
begin
  perform set_config('taba.order_intake_fingerprint', '', true);
  -- El rastro es del guardián, no del pedido: si no se puede escribir, el pedido
  -- —que ya pasó todas las validaciones— no se pierde por eso.
  begin
    insert into private.order_intake_log (business_id, customer_user_id, fingerprint_hash, channel, order_id, checkout_session_id, units)
    values (p_business_id, p_customer_id, case when v_hex ~ '^[0-9a-f]{64}$' then decode(v_hex, 'hex') end,
      p_channel, p_order_id, p_checkout_session_id, least(coalesce(p_units, 0), 2147483647)::integer);
  exception
    when others then null;
  end;
end;
$$;
revoke all on function private.order_intake_record_accept(uuid, uuid, text, uuid, uuid, bigint) from public, anon, authenticated;

-- ── 8. Puerta 1: pedido en efectivo / a coordinar ───────────────────────────
-- Misma técnica de capas que las anteriores (`_legacy`, `_profile_v1`, `_profile_v2`):
-- la función vigente pasa a ser una capa interna y la nueva envuelve a la anterior.
-- No se copia ningún cuerpo.
alter function public.create_order_with_items(jsonb) rename to create_order_with_items_confirmed_location;
revoke all on function public.create_order_with_items_confirmed_location(jsonb) from public, anon, authenticated;
grant execute on function public.create_order_with_items_confirmed_location(jsonb) to service_role;

create function public.create_order_with_items(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_customer_id uuid := auth.uid();
  v_business_id uuid;
  v_client_request_id text;
  v_business public.businesses%rowtype;
  v_guarded boolean := false;
  v_units bigint;
  v_block jsonb;
  v_payload jsonb := payload;
  v_key text;
  v_result jsonb;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload invalido' using errcode = '22023';
  end if;

  -- Higiene de entrada. Lo que el resto de las capas no mide.
  if octet_length(payload::text) > 32768 then
    raise exception 'payload demasiado grande' using errcode = '22023';
  end if;
  if char_length(coalesce(payload ->> 'address_label', '')) > 300 then
    raise exception 'datos del cliente demasiado largos' using errcode = '22023';
  end if;
  -- Los caracteres de control no llegan al Panel ni a la comandera (misma regla que
  -- ya aplicaba el checkout de Mercado Pago a sus observaciones).
  foreach v_key in array array['customer_notes', 'notes', 'customer_reference'] loop
    if jsonb_typeof(v_payload -> v_key) = 'string' and (v_payload ->> v_key) ~ '[[:cntrl:]]' then
      v_payload := jsonb_set(v_payload, array[v_key],
        to_jsonb(btrim(regexp_replace(v_payload ->> v_key, '[[:cntrl:]]+', ' ', 'g'))));
    end if;
  end loop;

  -- El guardián sólo actúa sobre un pedido que se puede identificar. Todo lo demás lo
  -- rechazan las capas de adentro con sus errores de siempre.
  if coalesce(payload ->> 'business_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and btrim(coalesce(payload ->> 'client_request_id', '')) ~ '^[A-Za-z0-9_-]{8,128}$' then
    v_business_id := (payload ->> 'business_id')::uuid;
    v_client_request_id := btrim(payload ->> 'client_request_id');
    select b.* into v_business from public.businesses b where b.id = v_business_id;
    if found and v_business.order_intake_guard_mode <> 'off' then
      -- Un cliente, una admisión a la vez por negocio: el conteo queda exacto aunque
      -- lleguen veinte pedidos juntos con veinte claves distintas.
      perform pg_advisory_xact_lock(
        hashtext('taba.order_intake.customer'),
        hashtext(v_business_id::text || ':' || v_customer_id::text));
      -- Un reintento idempotente no es una admisión nueva: no se cuenta ni se frena.
      -- Se mira DESPUÉS del lock, para que el segundo de dos envíos iguales ya vea
      -- el pedido del primero.
      v_guarded := not exists (
        select 1 from public.orders o
         where o.business_id = v_business_id
           and o.client_request_id = v_client_request_id);
    end if;
  end if;

  if v_guarded then
    if jsonb_typeof(payload -> 'items') = 'array' then
      select sum((item.value ->> 'quantity')::bigint) into v_units
        from jsonb_array_elements(payload -> 'items') as item(value)
       where jsonb_typeof(item.value) = 'object'
         and (item.value ->> 'quantity') ~ '^[1-9][0-9]{0,8}$';
    end if;
    v_block := private.order_intake_guard(
      v_business, v_customer_id, 'manual', v_units, 'PT429', 'ORDER_RATE_LIMITED');
    if v_block is not null then
      return v_block;
    end if;
  end if;

  v_result := public.create_order_with_items_confirmed_location(v_payload);

  if v_guarded and nullif(v_result ->> 'id', '') is not null then
    perform private.order_intake_record_accept(
      v_business_id, v_customer_id, 'manual', (v_result ->> 'id')::uuid, null, v_units);
  end if;
  return v_result;
end;
$$;
revoke all on function public.create_order_with_items(jsonb) from public, anon;
grant execute on function public.create_order_with_items(jsonb) to authenticated, service_role;
comment on function public.create_order_with_items(jsonb) is
  'Alta de pedido manual. Pasa por el guardian de admision (limites por cliente, origen y negocio) antes de reservar stock.';

-- ── 9. Puerta 2: sesión de checkout de Mercado Pago ─────────────────────────
alter function public.create_checkout_session(uuid, jsonb) rename to create_checkout_session_reserving;
revoke all on function public.create_checkout_session_reserving(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_checkout_session_reserving(uuid, jsonb) to service_role;

create function public.create_checkout_session(p_customer_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_business_id uuid;
  v_client_request_id text;
  v_business public.businesses%rowtype;
  v_guarded boolean := false;
  v_units bigint;
  v_block jsonb;
  v_result jsonb;
begin
  if p_customer_id is not null
    and p_payload is not null
    and jsonb_typeof(p_payload) = 'object'
    and coalesce(p_payload ->> 'business_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and btrim(coalesce(p_payload ->> 'client_request_id', '')) ~ '^[A-Za-z0-9_-]{8,128}$' then
    v_business_id := (p_payload ->> 'business_id')::uuid;
    v_client_request_id := btrim(p_payload ->> 'client_request_id');
    select b.* into v_business from public.businesses b where b.id = v_business_id;
    if found and v_business.order_intake_guard_mode <> 'off' then
      perform pg_advisory_xact_lock(
        hashtext('taba.order_intake.customer'),
        hashtext(v_business_id::text || ':' || p_customer_id::text));
      v_guarded := not exists (
        select 1 from public.checkout_sessions s
         where s.business_id = v_business_id
           and s.customer_id = p_customer_id
           and s.client_request_id = v_client_request_id);
    end if;
  end if;

  if v_guarded then
    -- Unidades que la sesión va a reservar: productos sueltos más los componentes de
    -- cada combo. Un combo desconocido lo rechaza la capa de adentro.
    if jsonb_typeof(p_payload -> 'items') = 'array' then
      select coalesce(sum(
               case
                 when item.value ? 'combo_id' then
                   (item.value ->> 'quantity')::bigint * coalesce((
                     select sum(cc.quantity)::bigint
                       from public.product_combos pc
                       join public.product_combo_components cc on cc.combo_id = pc.id
                      where pc.business_id = v_business_id
                        and pc.combo_id = (item.value ->> 'combo_id')), 0)
                 else (item.value ->> 'quantity')::bigint
               end), 0)
        into v_units
        from jsonb_array_elements(p_payload -> 'items') as item(value)
       where jsonb_typeof(item.value) = 'object'
         and (item.value ->> 'quantity') ~ '^[1-9][0-9]{0,8}$';
    end if;
    -- Mismo código y mismo mensaje que el freno que ya existía en este canal: la
    -- Edge Function no cambia.
    v_block := private.order_intake_guard(
      v_business, p_customer_id, 'checkout', v_units,
      '54000', 'demasiados intentos de checkout; reintenta mas tarde');
    if v_block is not null then
      return v_block;
    end if;
  end if;

  v_result := public.create_checkout_session_reserving(p_customer_id, p_payload);

  if v_guarded and nullif(v_result ->> 'checkout_session_id', '') is not null then
    perform private.order_intake_record_accept(
      v_business_id, p_customer_id, 'checkout', null, (v_result ->> 'checkout_session_id')::uuid, v_units);
  end if;
  return v_result;
end;
$$;
revoke all on function public.create_checkout_session(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_checkout_session(uuid, jsonb) to service_role;
comment on function public.create_checkout_session(uuid, jsonb) is
  'Alta de sesion de checkout. Pasa por el guardian de admision antes de reservar stock.';

-- ── 10. Retención ───────────────────────────────────────────────────────────
-- El rastro de admisión sirve para ventanas de minutos; no se guarda para siempre.
create or replace function public.purge_order_intake_traces(p_keep_days integer default 7)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_keep interval := make_interval(days => greatest(1, least(coalesce(p_keep_days, 7), 90)));
  v_deleted integer := 0;
  v_step integer;
begin
  delete from private.order_intake_log where created_at < clock_timestamp() - v_keep;
  get diagnostics v_step = row_count;
  v_deleted := v_deleted + v_step;
  delete from private.order_intake_blocks where window_started_at < clock_timestamp() - v_keep;
  get diagnostics v_step = row_count;
  v_deleted := v_deleted + v_step;
  return v_deleted;
end;
$$;
revoke all on function public.purge_order_intake_traces(integer) from public, anon, authenticated;
grant execute on function public.purge_order_intake_traces(integer) to service_role;

create extension if not exists pg_cron with schema pg_catalog;
do $$
begin
  perform cron.schedule(
    'taba-order-intake-purge',
    '17 * * * *',
    'select public.purge_order_intake_traces(7);'
  );
end;
$$;
