-- ============================================================================
--  Impresión del mostrador: dispositivos locales y cola print_jobs.
-- ============================================================================
--
--  Arquitectura (docs/PANEL-ARCHITECTURE-DECISION.md, opción B): el Panel sigue
--  en la web; Taba.LocalAgent (.NET, Windows) imprime. El backend es la fuente
--  de verdad de QUÉ se imprime; el agente sólo imprime lo que reclama.
--
--  IDENTIDAD DEL AGENTE (local_devices)
--    Un dueño o admin crea un código de emparejamiento de un solo uso (15 min).
--    El agente genera su propio secreto, manda sólo su SHA-256 junto con el
--    código y recibe su device_id. La base guarda el hash, nunca el secreto.
--    Rotación en dos fases: el agente registra el hash nuevo como pendiente y
--    el primer uso del secreto nuevo lo promueve; perder la respuesta no deja
--    al agente afuera. Revocar borra los hashes: ese agente no vuelve a entrar.
--
--    El agente NO usa service_role ni una sesión de usuario: habla con la Edge
--    Function print-agent-gateway, que verifica su credencial y llama a las RPC
--    agent_* (sólo service_role). anon no gana ni una función: el contrato de
--    «exactamente 8 SECURITY DEFINER ejecutables por anon» sigue intacto.
--
--  Conflictos de reclamo: PT409 (PostgREST responde 409 y NO reintenta; con
--  40001 reintentaría la transacción, ver 20260924200000).
--
--  COLA (print_jobs): queued → claimed → printing → printed
--                                    ↘ queued (no se envió nada, con espera)
--                                    ↘ needs_review (resultado desconocido)
--    · claim atómico con FOR UPDATE SKIP LOCKED y un claim_token por reclamo:
--      dos agentes, un solo ganador; un agente con un reclamo viejo no puede
--      marcar «printing» y por lo tanto no imprime.
--    · «printing» se registra en el backend ANTES de mandar bytes. Si el
--      agente no puede registrarlo, no imprime.
--    · Un trabajo «printing» cuyo resultado no llega pasa a needs_review. Nunca
--      se reimprime solo: reimprimir es una acción explícita que crea OTRO
--      trabajo con reprint_of, quién, cuándo y por qué.
--    · Ticket fiscal: sólo existe si el comprobante está autorizado con CAE de
--      14 dígitos (se valida al insertar, también para service_role).
--
--  IMPRESIÓN AUTOMÁTICA (business_print_settings, apagada por defecto)
--    Los triggers sobre orders y fiscal_documents encolan con clave
--    idempotente y NUNCA frenan la operación: cualquier error queda como
--    WARNING y el pedido sigue. Sin un agente activo no se encola nada.
--
--  Rollback: docs/migrations/rollback/20260926160000_local_print_agent.rollback.sql
-- ============================================================================

-- ── Auditoría de configuración: nuevo ámbito «printing» ────────────────────
alter table public.business_config_audit drop constraint if exists business_config_audit_scope_check;
alter table public.business_config_audit add constraint business_config_audit_scope_check check (scope in (
  'hours', 'exception', 'zone', 'delivery_pricing', 'enforcement', 'permission', 'payments', 'printing'
));

-- ── Tablas ─────────────────────────────────────────────────────────────────
create table if not exists public.local_devices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  device_name text not null check (char_length(btrim(device_name)) between 1 and 80),
  platform text not null default 'windows' check (platform in ('windows')),
  agent_version text check (agent_version is null or agent_version ~ '^[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,6}([-+][0-9A-Za-z.-]{1,40})?$'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  secret_hash text check (secret_hash is null or secret_hash ~ '^[0-9a-f]{64}$'),
  pending_secret_hash text check (pending_secret_hash is null or pending_secret_hash ~ '^[0-9a-f]{64}$'),
  secret_rotated_at timestamptz,
  last_seen_at timestamptz,
  last_report jsonb not null default '{}'::jsonb check (jsonb_typeof(last_report) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoke_reason text check (revoke_reason is null or char_length(btrim(revoke_reason)) between 3 and 300),
  constraint local_devices_revoked_consistent check ((status = 'revoked') = (revoked_at is not null)),
  constraint local_devices_active_has_secret check (status <> 'active' or secret_hash is not null),
  constraint local_devices_revoked_without_secret check (status <> 'revoked' or (secret_hash is null and pending_secret_hash is null))
);

create unique index if not exists local_devices_secret_hash_idx on public.local_devices(secret_hash) where secret_hash is not null;
create unique index if not exists local_devices_pending_secret_hash_idx on public.local_devices(pending_secret_hash) where pending_secret_hash is not null;
create index if not exists local_devices_business_idx on public.local_devices(business_id, status);

create table if not exists public.local_device_pairings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  device_name text not null check (char_length(btrim(device_name)) between 1 and 80),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_by_kind text not null check (created_by_kind in ('user', 'service')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  device_id uuid references public.local_devices(id) on delete restrict,
  constraint local_device_pairings_consumed_consistent check ((consumed_at is null) = (device_id is null)),
  constraint local_device_pairings_short_lived check (expires_at > created_at and expires_at <= created_at + interval '30 minutes'),
  constraint local_device_pairings_user_has_actor check (created_by_kind <> 'user' or created_by is not null)
);

create index if not exists local_device_pairings_business_idx on public.local_device_pairings(business_id, created_at desc);

create table if not exists public.business_print_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  auto_print_enabled boolean not null default false,
  kitchen_ticket_on text check (kitchen_ticket_on is null or kitchen_ticket_on in ('submitted', 'accepted', 'preparing')),
  order_ticket_on text check (order_ticket_on is null or order_ticket_on in ('submitted', 'accepted', 'preparing', 'ready')),
  fiscal_receipt_auto boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  -- Dispositivo destino. null = cualquier agente activo del negocio que
  -- imprima este tipo de documento.
  device_id uuid references public.local_devices(id) on delete restrict,
  document_type text not null check (document_type in ('order_ticket', 'kitchen_ticket', 'fiscal_receipt')),
  source_entity_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 65536),
  payload_version integer not null default 1 check (payload_version = 1),
  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'printing', 'printed', 'failed', 'needs_review', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 50),
  claim_token uuid,
  claimed_by_device_id uuid references public.local_devices(id) on delete restrict,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  printing_at timestamptz,
  printed_at timestamptz,
  failed_at timestamptz,
  needs_review_at timestamptz,
  cancelled_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  last_error text check (last_error is null or last_error ~ '^[A-Z0-9_]{3,80}$'),
  reprint_of uuid references public.print_jobs(id) on delete restrict,
  reprint_reason text check (reprint_reason is null or char_length(btrim(reprint_reason)) between 3 and 300),
  requested_by uuid references auth.users(id) on delete set null,
  request_source text not null check (request_source in ('automatic', 'panel', 'agent', 'operator')),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9:_-]{8,160}$'),
  unique (business_id, idempotency_key),
  constraint print_jobs_in_flight_has_lease check (
    status not in ('claimed', 'printing')
    or (claim_token is not null and claimed_by_device_id is not null and lease_expires_at is not null)
  ),
  constraint print_jobs_lease_only_in_flight check (lease_expires_at is null or status in ('claimed', 'printing')),
  constraint print_jobs_printed_has_time check (status <> 'printed' or printed_at is not null),
  constraint print_jobs_reprint_is_explicit check (
    reprint_of is null or (reprint_reason is not null and request_source <> 'automatic')
  )
);

create index if not exists print_jobs_claim_idx on public.print_jobs(business_id, next_attempt_at, created_at)
  where status = 'queued';
create index if not exists print_jobs_in_flight_idx on public.print_jobs(business_id, lease_expires_at)
  where status in ('claimed', 'printing');
create index if not exists print_jobs_source_idx on public.print_jobs(business_id, source_entity_id, document_type);
create index if not exists print_jobs_reprint_idx on public.print_jobs(reprint_of) where reprint_of is not null;

create table if not exists public.print_job_events (
  id bigint generated always as identity primary key,
  print_job_id uuid not null references public.print_jobs(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  event_type text not null check (event_type ~ '^[a-z_]{3,40}$'),
  actor_kind text not null check (actor_kind in ('user', 'device', 'service', 'system')),
  actor_id uuid,
  device_id uuid references public.local_devices(id) on delete restrict,
  from_status text,
  to_status text,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now(),
  constraint print_job_events_user_has_actor check (actor_kind <> 'user' or actor_id is not null),
  constraint print_job_events_device_has_device check (actor_kind <> 'device' or device_id is not null)
);

create index if not exists print_job_events_job_idx on public.print_job_events(print_job_id, id);

-- ── Helpers privados (schema private: sin USAGE para anon/authenticated) ───

create or replace function private.print_protect_events()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $print_protect_events$
begin
  raise exception 'la auditoria de impresion es inmutable' using errcode = '55000';
end;
$print_protect_events$;

drop trigger if exists print_job_events_immutable on public.print_job_events;
create trigger print_job_events_immutable before update or delete on public.print_job_events
for each row execute function private.print_protect_events();

create or replace function private.print_sha256_hex(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, public, extensions, pg_temp
as $print_sha256_hex$
  select encode(extensions.digest(convert_to(coalesce(p_value, ''), 'UTF8'), 'sha256'), 'hex');
$print_sha256_hex$;

-- Código Crockford base32 (sin I, L, O, U), 10 caracteres = 50 bits.
create or replace function private.local_device_pairing_code()
returns text
language plpgsql
volatile
set search_path = pg_catalog, public, extensions, pg_temp
as $local_device_pairing_code$
declare
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(10);
  v_code text := '';
  v_index integer;
begin
  for v_index in 0..9 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_index) % 32) + 1, 1);
  end loop;
  return v_code;
end;
$local_device_pairing_code$;

create or replace function private.local_device_normalize_code(p_code text)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $local_device_normalize_code$
  select translate(regexp_replace(upper(coalesce(p_code, '')), '[^0-9A-Z]', '', 'g'), 'OIL', '011');
$local_device_normalize_code$;

create or replace function private.local_device_create_pairing(
  p_business_id uuid,
  p_device_name text,
  p_actor uuid,
  p_actor_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $local_device_create_pairing$
declare
  v_code text;
  v_expires timestamptz := now() + interval '15 minutes';
  v_name text := btrim(coalesce(p_device_name, ''));
begin
  if char_length(v_name) not between 1 and 80 then
    raise exception 'nombre de dispositivo invalido' using errcode = '22023';
  end if;
  perform 1 from public.businesses where id = p_business_id;
  if not found then raise exception 'negocio inexistente' using errcode = 'P0002'; end if;
  if (select count(*) from public.local_devices where business_id = p_business_id and status = 'active') >= 5 then
    raise exception 'el negocio ya tiene 5 agentes activos' using errcode = 'P0001';
  end if;
  -- Un par de códigos vivos por negocio alcanza; más es ruido o abuso.
  if (select count(*) from public.local_device_pairings
       where business_id = p_business_id and consumed_at is null and expires_at > now()) >= 3 then
    raise exception 'demasiados codigos de emparejamiento vigentes' using errcode = 'P0001';
  end if;
  v_code := private.local_device_pairing_code();
  insert into public.local_device_pairings(business_id, device_name, code_hash, created_by, created_by_kind, expires_at)
  values (p_business_id, v_name, private.print_sha256_hex('taba-pairing:v1:' || v_code), p_actor, p_actor_kind, v_expires);
  insert into public.business_config_audit(business_id, scope, action, actor_kind, actor_id, before, after)
  values (p_business_id, 'printing', 'created', p_actor_kind, p_actor, null,
    jsonb_build_object('pairing_for', v_name, 'expires_at', v_expires));
  return jsonb_build_object(
    'pairing_code', substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5),
    'device_name', v_name,
    'expires_at', v_expires
  );
end;
$local_device_create_pairing$;

-- Autentica al agente. Mismo error para «no existe», «revocado» y «secreto
-- incorrecto»: quien no tiene la credencial no aprende nada.
create or replace function private.local_device_authenticate(p_device_id uuid, p_secret_hash text)
returns public.local_devices
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $local_device_authenticate$
declare
  v_device public.local_devices%rowtype;
begin
  if p_device_id is null or coalesce(p_secret_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'dispositivo no autorizado' using errcode = '42501';
  end if;
  select d.* into v_device from public.local_devices d where d.id = p_device_id for update;
  if not found or v_device.status <> 'active' then
    raise exception 'dispositivo no autorizado' using errcode = '42501';
  end if;
  if v_device.secret_hash = p_secret_hash then
    update public.local_devices set last_seen_at = now() where id = v_device.id returning * into v_device;
  elsif v_device.pending_secret_hash = p_secret_hash then
    -- Primer uso del secreto rotado: se promueve y el anterior deja de valer.
    update public.local_devices
       set secret_hash = pending_secret_hash, pending_secret_hash = null,
           secret_rotated_at = now(), last_seen_at = now()
     where id = v_device.id
    returning * into v_device;
    insert into public.business_config_audit(business_id, scope, action, actor_kind, actor_id, before, after)
    values (v_device.business_id, 'printing', 'updated', 'system', null, null,
      jsonb_build_object('device_id', v_device.id, 'secret', 'rotated'));
  else
    raise exception 'dispositivo no autorizado' using errcode = '42501';
  end if;
  return v_device;
end;
$local_device_authenticate$;

create or replace function private.print_job_log(
  p_job public.print_jobs,
  p_event text,
  p_actor_kind text,
  p_actor_id uuid,
  p_device_id uuid,
  p_from text,
  p_detail jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $print_job_log$
  insert into public.print_job_events(print_job_id, business_id, event_type, actor_kind, actor_id, device_id, from_status, to_status, detail)
  values (p_job.id, p_job.business_id, p_event, p_actor_kind, p_actor_id, p_device_id, p_from, p_job.status, coalesce(p_detail, '{}'::jsonb));
$print_job_log$;

create or replace function private.print_payment_label(p_method text, p_manual_status text, p_manual_method text)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $print_payment_label$
  select case
    when p_method = 'mercadopago' then 'Mercado Pago'
    when p_manual_status = 'confirmed' and p_manual_method = 'transfer' then 'Transferencia (pagado)'
    when p_manual_status = 'confirmed' then 'Efectivo (pagado)'
    when p_method = 'cash' then 'Efectivo'
    when p_method = 'coordinate' then 'A coordinar'
    when p_method = 'qa_no_charge' then 'Prueba sin cobro'
    else 'Otro'
  end;
$print_payment_label$;

-- Lo que se imprime de un pedido. Sin teléfono, dirección ni nombre del
-- cliente: el ticket no los necesita (el reparto ya los tiene en la app).
create or replace function private.order_print_payload(p_order_id uuid, p_document_type text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $order_print_payload$
declare
  v_order public.orders%rowtype;
  v_business_name text;
  v_items jsonb;
  v_notes text;
  v_rider text;
begin
  if p_document_type not in ('order_ticket', 'kitchen_ticket') then
    raise exception 'tipo de documento de pedido invalido' using errcode = '22023';
  end if;
  select o.* into v_order from public.orders o where o.id = p_order_id;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  select b.name into v_business_name from public.businesses b where b.id = v_order.business_id;
  v_notes := nullif(left(btrim(coalesce(nullif(btrim(v_order.customer_notes), ''), v_order.notes, '')), 300), '');

  if p_document_type = 'kitchen_ticket' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', left(i.name, 120), 'quantity', i.quantity, 'unit', nullif(left(coalesce(i.unit, ''), 20), ''))
             order by i.created_at, i.id), '[]'::jsonb)
      into v_items from public.order_items i where i.order_id = v_order.id;
    return jsonb_build_object(
      'business', jsonb_build_object('name', left(v_business_name, 80)),
      'order', jsonb_build_object(
        'code', coalesce(v_order.public_code, v_order.code),
        'created_at', v_order.created_at,
        'fulfillment', v_order.delivery_mode,
        'notes', v_notes,
        'items', v_items),
      'reprint', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', left(i.name, 120), 'quantity', i.quantity, 'unit', nullif(left(coalesce(i.unit, ''), 20), ''),
           'unit_price', i.unit_price, 'subtotal', i.subtotal)
           order by i.created_at, i.id), '[]'::jsonb)
    into v_items from public.order_items i where i.order_id = v_order.id;
  if v_order.assigned_rider_user_id is not null then
    select nullif(left(btrim(coalesce(u.raw_user_meta_data->>'display_name', '')), 40), '')
      into v_rider from auth.users u where u.id = v_order.assigned_rider_user_id;
  end if;
  return jsonb_build_object(
    'business', jsonb_build_object('name', left(v_business_name, 80)),
    'order', jsonb_build_object(
      'code', coalesce(v_order.public_code, v_order.code),
      'created_at', v_order.created_at,
      'fulfillment', v_order.delivery_mode,
      'notes', v_notes,
      'items', v_items,
      'subtotal', v_order.subtotal,
      'delivery_fee', v_order.delivery_fee,
      'discount', v_order.discount_total,
      'total', v_order.total,
      'currency', coalesce(v_order.currency_code, 'ARS'),
      'payment', jsonb_build_object(
        'method', v_order.payment_method,
        'label', private.print_payment_label(v_order.payment_method, v_order.manual_payment_status, v_order.manual_payment_method)),
      'rider', case when v_rider is null then null else jsonb_build_object('name', v_rider) end),
    'reprint', false);
end;
$order_print_payload$;

-- Etiqueta del comprobante según la tabla de tipos de ARCA (FEParamGetTiposCbte).
create or replace function private.fiscal_voucher_label(p_document_type integer)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $fiscal_voucher_label$
  select case p_document_type
    when 1 then 'Factura A' when 2 then 'Nota de Debito A' when 3 then 'Nota de Credito A'
    when 6 then 'Factura B' when 7 then 'Nota de Debito B' when 8 then 'Nota de Credito B'
    when 11 then 'Factura C' when 12 then 'Nota de Debito C' when 13 then 'Nota de Credito C'
    when 51 then 'Factura M' when 52 then 'Nota de Debito M' when 53 then 'Nota de Credito M'
    else 'Comprobante ' || p_document_type::text
  end;
$fiscal_voucher_label$;

-- URL del QR fiscal (RG 4291): mismo JSON, mismo orden de claves y mismos
-- números que services/arca-fiscal-bridge/src/qr.ts. json_build_object (no
-- jsonb) conserva el orden; trim_scale imprime 1234.5 igual que JavaScript.
create or replace function private.fiscal_qr_url(p_document public.fiscal_documents)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $fiscal_qr_url$
declare
  v_json json;
  v_encoded text;
begin
  if coalesce(p_document.cae, '') !~ '^[0-9]{14}$' or p_document.document_number is null or p_document.issue_date is null
    or coalesce(p_document.cuit, '') !~ '^[0-9]{11}$' then
    raise exception 'no se genera QR fiscal sin CAE valido' using errcode = 'P0001';
  end if;
  if p_document.recipient_document_type is not null and nullif(btrim(coalesce(p_document.recipient_document_number, '')), '') is not null
     and p_document.recipient_document_number ~ '^[0-9]{1,20}$' then
    v_json := json_build_object(
      'ver', 1, 'fecha', to_char(p_document.issue_date, 'YYYY-MM-DD'), 'cuit', p_document.cuit::bigint,
      'ptoVta', p_document.point_of_sale, 'tipoCmp', p_document.document_type, 'nroCmp', p_document.document_number,
      'importe', trim_scale(round(p_document.total_amount, 2)), 'moneda', p_document.currency,
      'ctz', trim_scale(p_document.currency_rate),
      'tipoDocRec', p_document.recipient_document_type, 'nroDocRec', p_document.recipient_document_number::numeric,
      'tipoCodAut', 'E', 'codAut', p_document.cae::bigint);
  else
    v_json := json_build_object(
      'ver', 1, 'fecha', to_char(p_document.issue_date, 'YYYY-MM-DD'), 'cuit', p_document.cuit::bigint,
      'ptoVta', p_document.point_of_sale, 'tipoCmp', p_document.document_type, 'nroCmp', p_document.document_number,
      'importe', trim_scale(round(p_document.total_amount, 2)), 'moneda', p_document.currency,
      'ctz', trim_scale(p_document.currency_rate),
      'tipoCodAut', 'E', 'codAut', p_document.cae::bigint);
  end if;
  -- json_build_object separa con ", " y ": "; JSON.stringify no deja espacios.
  v_encoded := replace(encode(convert_to(private.fiscal_compact_json(v_json::text), 'UTF8'), 'base64'), E'\n', '');
  return 'https://www.arca.gob.ar/fe/qr/?p='
    || replace(replace(replace(v_encoded, '+', '%2B'), '/', '%2F'), '=', '%3D');
end;
$fiscal_qr_url$;

-- Compacta el texto de un json plano generado por json_build_object: sólo
-- quita los espacios que el generador agrega fuera de las cadenas.
create or replace function private.fiscal_compact_json(p_json text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $fiscal_compact_json$
declare
  v_out text := '';
  v_char text;
  v_in_string boolean := false;
  v_escaped boolean := false;
  v_index integer;
begin
  for v_index in 1..char_length(p_json) loop
    v_char := substr(p_json, v_index, 1);
    if v_in_string then
      v_out := v_out || v_char;
      if v_escaped then v_escaped := false;
      elsif v_char = '\' then v_escaped := true;
      elsif v_char = '"' then v_in_string := false;
      end if;
    elsif v_char = '"' then
      v_in_string := true;
      v_out := v_out || v_char;
    elsif v_char <> ' ' then
      v_out := v_out || v_char;
    end if;
  end loop;
  return v_out;
end;
$fiscal_compact_json$;

create or replace function private.fiscal_receipt_print_payload(p_fiscal_document_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $fiscal_receipt_print_payload$
declare
  v_document public.fiscal_documents%rowtype;
  v_items jsonb;
begin
  select d.* into v_document from public.fiscal_documents d where d.id = p_fiscal_document_id;
  if not found then raise exception 'comprobante fiscal inexistente' using errcode = 'P0002'; end if;
  if v_document.state not in ('authorized', 'credited') or coalesce(v_document.cae, '') !~ '^[0-9]{14}$'
    or v_document.document_number is null or v_document.cae_expiration is null or v_document.issue_date is null then
    raise exception 'el comprobante no esta autorizado' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'description', left(i.description, 120), 'quantity', i.quantity, 'unit_price', i.unit_price,
           'net_amount', i.net_amount, 'tax_amount', i.tax_amount) order by i.id), '[]'::jsonb)
    into v_items from public.fiscal_document_items i where i.fiscal_document_id = v_document.id;
  return jsonb_build_object(
    'environment', v_document.environment,
    'issuer', jsonb_build_object(
      'legal_name', v_document.issuer_snapshot->>'legal_name',
      'cuit', v_document.cuit,
      'tax_condition', v_document.issuer_snapshot->>'tax_condition',
      'address', v_document.issuer_snapshot->>'address',
      'gross_income_number', v_document.issuer_snapshot->>'gross_income_number'),
    'receiver', jsonb_build_object(
      'condition', coalesce(v_document.recipient_snapshot->>'condition', v_document.recipient_type),
      'document_type', v_document.recipient_document_type,
      'document_number', v_document.recipient_document_number),
    'voucher', jsonb_build_object(
      'type_code', v_document.document_type,
      'label', private.fiscal_voucher_label(v_document.document_type),
      'point_of_sale', v_document.point_of_sale,
      'number', v_document.document_number,
      'issue_date', v_document.issue_date,
      'intent', v_document.document_intent,
      'associated', case when v_document.associated_document_id is null then null
                         else v_document.associated_document_snapshot end),
    'items', v_items,
    'totals', jsonb_build_object(
      'net', v_document.net_amount, 'tax', v_document.tax_amount, 'exempt', v_document.exempt_amount,
      'non_taxed', v_document.non_taxed_amount, 'other_taxes', v_document.other_taxes_amount,
      'total', v_document.total_amount, 'currency', v_document.currency, 'currency_rate', v_document.currency_rate),
    'cae', v_document.cae,
    'cae_expiration', v_document.cae_expiration,
    'qr_url', private.fiscal_qr_url(v_document),
    'reprint', false);
end;
$fiscal_receipt_print_payload$;

-- Inserta (o devuelve) un trabajo por clave idempotente. La clave repetida
-- con otro contenido es un error: nunca se reutiliza en silencio.
create or replace function private.print_enqueue(
  p_business_id uuid,
  p_document_type text,
  p_source_entity_id uuid,
  p_payload jsonb,
  p_request_source text,
  p_requested_by uuid,
  p_idempotency_key text,
  p_reprint_of uuid default null,
  p_reprint_reason text default null,
  p_actor_kind text default 'system',
  p_device_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $print_enqueue$
declare
  v_job public.print_jobs%rowtype;
begin
  insert into public.print_jobs(business_id, document_type, source_entity_id, payload, request_source, requested_by,
    idempotency_key, reprint_of, reprint_reason)
  values (p_business_id, p_document_type, p_source_entity_id, p_payload, p_request_source, p_requested_by,
    p_idempotency_key, p_reprint_of, nullif(btrim(coalesce(p_reprint_reason, '')), ''))
  on conflict (business_id, idempotency_key) do nothing
  returning * into v_job;
  if not found then
    select j.* into v_job from public.print_jobs j where j.business_id = p_business_id and j.idempotency_key = p_idempotency_key;
    if v_job.document_type <> p_document_type or v_job.source_entity_id <> p_source_entity_id
       or v_job.reprint_of is distinct from p_reprint_of then
      raise exception 'idempotency_key reutilizada con otra solicitud' using errcode = '23505';
    end if;
    return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', true);
  end if;
  perform private.print_job_log(v_job, case when p_reprint_of is null then 'queued' else 'reprint_queued' end,
    p_actor_kind, case when p_actor_kind = 'user' then p_requested_by else null end, p_device_id, null,
    jsonb_strip_nulls(jsonb_build_object('source', p_request_source, 'reprint_of', p_reprint_of,
      'reason', nullif(btrim(coalesce(p_reprint_reason, '')), ''))));
  return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', false);
end;
$print_enqueue$;

-- Ningún camino (ni service_role) inserta un ticket fiscal sin CAE, ni un
-- trabajo que apunte a un pedido de otro negocio.
create or replace function private.print_jobs_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $print_jobs_guard_insert$
begin
  if new.document_type = 'fiscal_receipt' then
    perform 1 from public.fiscal_documents d
     where d.id = new.source_entity_id and d.business_id = new.business_id
       and d.state in ('authorized', 'credited') and d.cae ~ '^[0-9]{14}$' and d.document_number is not null;
    if not found then
      raise exception 'un ticket fiscal requiere un comprobante autorizado con CAE' using errcode = '23514';
    end if;
  else
    perform 1 from public.orders o where o.id = new.source_entity_id and o.business_id = new.business_id;
    if not found then
      raise exception 'el pedido no pertenece al negocio' using errcode = '23514';
    end if;
  end if;
  if new.reprint_of is not null then
    perform 1 from public.print_jobs s
     where s.id = new.reprint_of and s.business_id = new.business_id
       and s.document_type = new.document_type and s.source_entity_id = new.source_entity_id;
    if not found then
      raise exception 'la reimpresion no coincide con el trabajo original' using errcode = '23514';
    end if;
  end if;
  if new.device_id is not null then
    perform 1 from public.local_devices d where d.id = new.device_id and d.business_id = new.business_id;
    if not found then
      raise exception 'el dispositivo no pertenece al negocio' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$print_jobs_guard_insert$;

drop trigger if exists print_jobs_guard_insert on public.print_jobs;
create trigger print_jobs_guard_insert before insert on public.print_jobs
for each row execute function private.print_jobs_guard_insert();

-- Leases vencidos. «claimed» vencido: el agente nunca registró «printing»,
-- así que no salió papel → vuelve a la cola (con tope). «printing» vencido:
-- el resultado es desconocido → needs_review, nunca reimpresión automática.
create or replace function private.print_expire_leases(p_business_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $print_expire_leases$
declare
  v_job public.print_jobs%rowtype;
  v_from text;
  v_count integer := 0;
begin
  for v_job in
    select j.* from public.print_jobs j
     where j.business_id = p_business_id and j.status in ('claimed', 'printing') and j.lease_expires_at < now()
     order by j.lease_expires_at
     for update skip locked
  loop
    v_from := v_job.status;
    if v_job.status = 'claimed' and v_job.attempt_count < 5 then
      update public.print_jobs set status = 'queued', lease_expires_at = null, next_attempt_at = now()
       where id = v_job.id returning * into v_job;
      perform private.print_job_log(v_job, 'lease_expired_requeued', 'system', null, v_job.claimed_by_device_id, v_from);
    elsif v_job.status = 'claimed' then
      update public.print_jobs set status = 'failed', lease_expires_at = null, failed_at = now(),
             last_error = 'CLAIM_EXPIRED_REPEATEDLY'
       where id = v_job.id returning * into v_job;
      perform private.print_job_log(v_job, 'lease_expired_failed', 'system', null, v_job.claimed_by_device_id, v_from);
    else
      update public.print_jobs set status = 'needs_review', lease_expires_at = null, needs_review_at = now(),
             last_error = 'PRINT_OUTCOME_UNKNOWN'
       where id = v_job.id returning * into v_job;
      perform private.print_job_log(v_job, 'lease_expired_needs_review', 'system', null, v_job.claimed_by_device_id, v_from);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$print_expire_leases$;

-- Reimpresión: SIEMPRE un trabajo nuevo, con la misma carga marcada como
-- reimpresión, el original en reprint_of y quién/por qué en la auditoría.
create or replace function private.print_request_reprint(
  p_source_id uuid,
  p_business_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_request_source text,
  p_requested_by uuid,
  p_actor_kind text,
  p_device_id uuid,
  p_operator_label text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $print_request_reprint$
declare
  v_source public.print_jobs%rowtype;
  v_result jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_label text := nullif(left(btrim(coalesce(p_operator_label, '')), 60), '');
begin
  if char_length(v_reason) not between 3 and 300 then
    raise exception 'motivo de reimpresion requerido' using errcode = '22023';
  end if;
  if coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9:_-]{8,160}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;
  select j.* into v_source from public.print_jobs j where j.id = p_source_id and j.business_id = p_business_id for share;
  if not found then raise exception 'trabajo de impresion inexistente' using errcode = 'P0002'; end if;
  if v_source.status not in ('printed', 'failed', 'needs_review', 'cancelled') then
    raise exception 'el trabajo original todavia esta en curso' using errcode = 'P0001';
  end if;
  if v_source.document_type = 'fiscal_receipt' then
    perform 1 from public.fiscal_documents d where d.id = v_source.source_entity_id
      and d.state in ('authorized', 'credited') and d.cae ~ '^[0-9]{14}$';
    if not found then raise exception 'el comprobante ya no es imprimible' using errcode = 'P0001'; end if;
  end if;
  v_result := private.print_enqueue(
    v_source.business_id, v_source.document_type, v_source.source_entity_id,
    v_source.payload || jsonb_build_object('reprint', true),
    p_request_source, p_requested_by, p_idempotency_key, v_source.id, v_reason, p_actor_kind, p_device_id);
  if not (v_result->>'idempotent_replay')::boolean then
    perform private.print_job_log(v_source, 'reprinted_as', p_actor_kind,
      case when p_actor_kind = 'user' then p_requested_by else null end, p_device_id, v_source.status,
      jsonb_strip_nulls(jsonb_build_object('reprint_job_id', v_result->>'print_job_id', 'reason', v_reason,
        'operator_label', v_label)));
  end if;
  return v_result;
end;
$print_request_reprint$;

-- ── Impresión automática (triggers que nunca frenan la operación) ─────────

create or replace function private.orders_enqueue_print_jobs()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $orders_enqueue_print_jobs$
declare
  v_settings public.business_print_settings%rowtype;
  v_status text;
  v_type text;
begin
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then
      return null;
    end if;
  end if;
  v_status := public.normalize_order_status_vocabulary(new.status);
  begin
    if v_status in ('cancelled', 'rejected') then
      -- Una comanda que todavía no reclamó nadie no se imprime para un pedido anulado.
      with cancelled as (
        update public.print_jobs j set status = 'cancelled', cancelled_at = now(), last_error = 'ORDER_CANCELLED'
         where j.business_id = new.business_id and j.source_entity_id = new.id and j.status = 'queued'
           and j.document_type in ('order_ticket', 'kitchen_ticket')
        returning j.*
      )
      insert into public.print_job_events(print_job_id, business_id, event_type, actor_kind, from_status, to_status, detail)
      select c.id, c.business_id, 'cancelled_with_order', 'system', 'queued', 'cancelled', jsonb_build_object('order_status', v_status)
        from cancelled c;
      return null;
    end if;
    select s.* into v_settings from public.business_print_settings s
     where s.business_id = new.business_id and s.auto_print_enabled;
    if not found then return null; end if;
    perform 1 from public.local_devices d where d.business_id = new.business_id and d.status = 'active';
    if not found then return null; end if;
    foreach v_type in array array['kitchen_ticket', 'order_ticket'] loop
      if (v_type = 'kitchen_ticket' and v_settings.kitchen_ticket_on = v_status)
         or (v_type = 'order_ticket' and v_settings.order_ticket_on = v_status) then
        perform private.print_enqueue(new.business_id, v_type, new.id, private.order_print_payload(new.id, v_type),
          'automatic', null, 'auto:' || v_type || ':' || new.id::text);
      end if;
    end loop;
  exception when others then
    -- La impresión es accesoria: un error acá jamás revierte el pedido.
    raise warning 'impresion automatica omitida para el pedido %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end;
$orders_enqueue_print_jobs$;

drop trigger if exists orders_enqueue_print_jobs on public.orders;
create trigger orders_enqueue_print_jobs after insert or update of status on public.orders
for each row execute function private.orders_enqueue_print_jobs();

create or replace function private.fiscal_documents_enqueue_print_job()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fiscal_documents_enqueue_print_job$
begin
  if new.state <> 'authorized' or old.state is not distinct from new.state then
    return null;
  end if;
  begin
    perform 1 from public.business_print_settings s
     where s.business_id = new.business_id and s.auto_print_enabled and s.fiscal_receipt_auto;
    if not found then return null; end if;
    perform 1 from public.local_devices d where d.business_id = new.business_id and d.status = 'active';
    if not found then return null; end if;
    perform private.print_enqueue(new.business_id, 'fiscal_receipt', new.id, private.fiscal_receipt_print_payload(new.id),
      'automatic', null, 'auto:fiscal_receipt:' || new.id::text);
  exception when others then
    raise warning 'impresion fiscal automatica omitida para %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end;
$fiscal_documents_enqueue_print_job$;

drop trigger if exists fiscal_documents_enqueue_print_job on public.fiscal_documents;
create trigger fiscal_documents_enqueue_print_job after update of state on public.fiscal_documents
for each row execute function private.fiscal_documents_enqueue_print_job();

-- ── RPC del Panel (authenticated; el rol se valida adentro) ────────────────

create or replace function public.create_local_device_pairing(p_business_id uuid, p_device_name text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $create_local_device_pairing$
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'owner/admin requerido' using errcode = '42501';
  end if;
  return private.local_device_create_pairing(p_business_id, p_device_name, auth.uid(), 'user');
end;
$create_local_device_pairing$;

create or replace function public.revoke_local_device(p_device_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $revoke_local_device$
declare
  v_business uuid;
begin
  select d.business_id into v_business from public.local_devices d where d.id = p_device_id;
  if v_business is null or not public.has_business_role(v_business, array['owner', 'admin']) then
    raise exception 'owner/admin requerido' using errcode = '42501';
  end if;
  return private.local_device_revoke(p_device_id, p_reason, auth.uid(), 'user');
end;
$revoke_local_device$;

create or replace function private.local_device_revoke(p_device_id uuid, p_reason text, p_actor uuid, p_actor_kind text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $local_device_revoke$
declare
  v_device public.local_devices%rowtype;
  v_job public.print_jobs%rowtype;
  v_from text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) not between 3 and 300 then
    raise exception 'motivo de revocacion requerido' using errcode = '22023';
  end if;
  select d.* into v_device from public.local_devices d where d.id = p_device_id for update;
  if not found then raise exception 'dispositivo inexistente' using errcode = 'P0002'; end if;
  if v_device.status = 'revoked' then
    return jsonb_build_object('device_id', v_device.id, 'status', 'revoked', 'idempotent_replay', true);
  end if;
  update public.local_devices
     set status = 'revoked', revoked_at = now(), revoked_by = p_actor, revoke_reason = v_reason,
         secret_hash = null, pending_secret_hash = null
   where id = v_device.id
  returning * into v_device;
  -- Lo que ese agente tenía reclamado sin empezar vuelve a la cola; lo que
  -- estaba imprimiendo queda para revisión humana.
  for v_job in
    select j.* from public.print_jobs j
     where j.claimed_by_device_id = v_device.id and j.status in ('claimed', 'printing') for update
  loop
    v_from := v_job.status;
    if v_job.status = 'claimed' then
      update public.print_jobs set status = 'queued', lease_expires_at = null, next_attempt_at = now()
       where id = v_job.id returning * into v_job;
    else
      update public.print_jobs set status = 'needs_review', lease_expires_at = null, needs_review_at = now(),
             last_error = 'DEVICE_REVOKED_DURING_PRINT'
       where id = v_job.id returning * into v_job;
    end if;
    perform private.print_job_log(v_job, 'device_revoked', p_actor_kind, case when p_actor_kind = 'user' then p_actor else null end,
      v_device.id, v_from);
  end loop;
  insert into public.business_config_audit(business_id, scope, action, actor_kind, actor_id, before, after)
  values (v_device.business_id, 'printing', 'disabled', p_actor_kind, p_actor,
    jsonb_build_object('device_id', v_device.id, 'status', 'active'),
    jsonb_build_object('device_id', v_device.id, 'status', 'revoked', 'reason', v_reason));
  return jsonb_build_object('device_id', v_device.id, 'status', 'revoked', 'idempotent_replay', false);
end;
$local_device_revoke$;

create or replace function public.get_local_print_status(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $get_local_print_status$
declare
  v_devices jsonb;
  v_queue jsonb;
  v_settings jsonb;
  v_online integer;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  perform private.print_expire_leases(p_business_id);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'name', d.device_name, 'status', d.status, 'agent_version', d.agent_version,
           'last_seen_at', d.last_seen_at,
           'agent', case when d.status = 'active' and d.last_seen_at > now() - interval '150 seconds' then 'ONLINE' else 'OFFLINE' end,
           'printers', coalesce(d.last_report->'printers', '[]'::jsonb),
           'local_queue_depth', d.last_report->'queue_depth')
           order by d.created_at), '[]'::jsonb),
         count(*) filter (where d.status = 'active' and d.last_seen_at > now() - interval '150 seconds')
    into v_devices, v_online
    from public.local_devices d
   where d.business_id = p_business_id and (d.status = 'active' or d.revoked_at > now() - interval '30 days');
  select jsonb_build_object(
           'queued', count(*) filter (where j.status = 'queued'),
           'in_flight', count(*) filter (where j.status in ('claimed', 'printing')),
           'needs_review', count(*) filter (where j.status = 'needs_review'),
           'failed_24h', count(*) filter (where j.status = 'failed' and j.failed_at > now() - interval '24 hours'))
    into v_queue
    from public.print_jobs j
   where j.business_id = p_business_id and j.status in ('queued', 'claimed', 'printing', 'needs_review', 'failed');
  select to_jsonb(s) - 'business_id' - 'updated_by' into v_settings
    from public.business_print_settings s where s.business_id = p_business_id;
  return jsonb_build_object(
    'agent', case when jsonb_array_length(v_devices) = 0 then 'NOT_REGISTERED'
                  when v_online > 0 then 'ONLINE' else 'OFFLINE' end,
    'devices', v_devices,
    'queue', v_queue,
    'settings', coalesce(v_settings, jsonb_build_object('auto_print_enabled', false)),
    'generated_at', now());
end;
$get_local_print_status$;

create or replace function public.configure_business_print_settings(p_business_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $configure_business_print_settings$
declare
  v_before public.business_print_settings%rowtype;
  v_after public.business_print_settings%rowtype;
  v_fiscal boolean;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'owner/admin requerido' using errcode = '42501';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object'
     or p_settings - array['auto_print_enabled', 'kitchen_ticket_on', 'order_ticket_on', 'fiscal_receipt_auto'] <> '{}'::jsonb
     or (p_settings ? 'auto_print_enabled' and jsonb_typeof(p_settings->'auto_print_enabled') <> 'boolean')
     or (p_settings ? 'fiscal_receipt_auto' and jsonb_typeof(p_settings->'fiscal_receipt_auto') <> 'boolean')
     or (p_settings ? 'kitchen_ticket_on' and jsonb_typeof(p_settings->'kitchen_ticket_on') not in ('string', 'null'))
     or (p_settings ? 'order_ticket_on' and jsonb_typeof(p_settings->'order_ticket_on') not in ('string', 'null')) then
    raise exception 'configuracion de impresion invalida' using errcode = '22023';
  end if;
  select s.* into v_before from public.business_print_settings s where s.business_id = p_business_id for update;
  v_fiscal := coalesce((p_settings->>'fiscal_receipt_auto')::boolean, v_before.fiscal_receipt_auto, false);
  if v_fiscal then
    -- El ticket fiscal automático exige facturación habilitada: sin ARCA no hay CAE que imprimir.
    perform 1 from public.fiscal_profiles fp where fp.business_id = p_business_id and fp.is_enabled and fp.environment <> 'disabled';
    if not found then raise exception 'la facturacion electronica no esta habilitada' using errcode = 'P0001'; end if;
  end if;
  insert into public.business_print_settings(business_id, auto_print_enabled, kitchen_ticket_on, order_ticket_on,
    fiscal_receipt_auto, updated_at, updated_by)
  values (p_business_id,
    coalesce((p_settings->>'auto_print_enabled')::boolean, false),
    case when p_settings ? 'kitchen_ticket_on' then p_settings->>'kitchen_ticket_on' else null end,
    case when p_settings ? 'order_ticket_on' then p_settings->>'order_ticket_on' else null end,
    v_fiscal, now(), auth.uid())
  on conflict (business_id) do update set
    auto_print_enabled = coalesce((p_settings->>'auto_print_enabled')::boolean, business_print_settings.auto_print_enabled),
    kitchen_ticket_on = case when p_settings ? 'kitchen_ticket_on' then p_settings->>'kitchen_ticket_on' else business_print_settings.kitchen_ticket_on end,
    order_ticket_on = case when p_settings ? 'order_ticket_on' then p_settings->>'order_ticket_on' else business_print_settings.order_ticket_on end,
    fiscal_receipt_auto = v_fiscal,
    updated_at = now(),
    updated_by = auth.uid()
  returning * into v_after;
  insert into public.business_config_audit(business_id, scope, action, actor_kind, actor_id, before, after)
  values (p_business_id, 'printing', case when v_before.business_id is null then 'created' else 'updated' end, 'user', auth.uid(),
    case when v_before.business_id is null then null else to_jsonb(v_before) - 'business_id' - 'updated_by' - 'updated_at' end,
    to_jsonb(v_after) - 'business_id' - 'updated_by' - 'updated_at');
  return to_jsonb(v_after) - 'business_id' - 'updated_by';
end;
$configure_business_print_settings$;

create or replace function public.request_order_print_job(p_order_id uuid, p_document_type text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $request_order_print_job$
declare
  v_business uuid;
begin
  select o.business_id into v_business from public.orders o where o.id = p_order_id;
  if v_business is null or not public.has_business_role(v_business, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if p_document_type not in ('order_ticket', 'kitchen_ticket') then
    raise exception 'tipo de documento invalido' using errcode = '22023';
  end if;
  if coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9:_-]{8,160}$' or p_idempotency_key like 'auto:%' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;
  return private.print_enqueue(v_business, p_document_type, p_order_id, private.order_print_payload(p_order_id, p_document_type),
    'panel', auth.uid(), 'panel:' || p_idempotency_key, null, null, 'user');
end;
$request_order_print_job$;

create or replace function public.request_print_job_reprint(p_job_id uuid, p_reason text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $request_print_job_reprint$
declare
  v_business uuid;
begin
  select j.business_id into v_business from public.print_jobs j where j.id = p_job_id;
  if v_business is null or not public.has_business_role(v_business, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9:_-]{8,150}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;
  return private.print_request_reprint(p_job_id, v_business, p_reason, 'reprint:' || p_idempotency_key,
    'panel', auth.uid(), 'user', null, null);
end;
$request_print_job_reprint$;

create or replace function public.resolve_print_job_review(p_job_id uuid, p_resolution text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $resolve_print_job_review$
declare
  v_job public.print_jobs%rowtype;
  v_from text;
begin
  select j.* into v_job from public.print_jobs j where j.id = p_job_id for update;
  if not found or not public.has_business_role(v_job.business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if p_resolution not in ('printed', 'not_printed') or char_length(btrim(coalesce(p_note, ''))) > 300 then
    raise exception 'resolucion invalida' using errcode = '22023';
  end if;
  if v_job.status <> 'needs_review' then
    raise exception 'el trabajo no esta en revision' using errcode = 'P0001';
  end if;
  v_from := v_job.status;
  if p_resolution = 'printed' then
    update public.print_jobs set status = 'printed', printed_at = now(), resolved_at = now(), resolved_by = auth.uid()
     where id = v_job.id returning * into v_job;
  else
    -- «No salió»: queda fallido. Volver a imprimir es una reimpresión explícita.
    update public.print_jobs set status = 'failed', failed_at = now(), resolved_at = now(), resolved_by = auth.uid()
     where id = v_job.id returning * into v_job;
  end if;
  perform private.print_job_log(v_job, 'review_resolved', 'user', auth.uid(), null, v_from,
    jsonb_strip_nulls(jsonb_build_object('resolution', p_resolution, 'note', nullif(btrim(coalesce(p_note, '')), ''))));
  return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status);
end;
$resolve_print_job_review$;

create or replace function public.cancel_print_job(p_job_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $cancel_print_job$
declare
  v_job public.print_jobs%rowtype;
begin
  select j.* into v_job from public.print_jobs j where j.id = p_job_id for update;
  if not found or not public.has_business_role(v_job.business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then
    raise exception 'motivo requerido' using errcode = '22023';
  end if;
  if v_job.status = 'cancelled' then
    return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', true);
  end if;
  if v_job.status <> 'queued' then
    raise exception 'solo se cancela un trabajo que no empezo' using errcode = 'P0001';
  end if;
  update public.print_jobs set status = 'cancelled', cancelled_at = now(), resolved_by = auth.uid()
   where id = v_job.id returning * into v_job;
  perform private.print_job_log(v_job, 'cancelled', 'user', auth.uid(), null, 'queued',
    jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', false);
end;
$cancel_print_job$;

-- ── RPC del agente (sólo service_role, vía print-agent-gateway) ────────────

create or replace function public.agent_register_device(
  p_pairing_code text,
  p_secret_hash text,
  p_device_name text,
  p_platform text,
  p_agent_version text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $agent_register_device$
declare
  v_pairing public.local_device_pairings%rowtype;
  v_device public.local_devices%rowtype;
  v_code text := private.local_device_normalize_code(p_pairing_code);
  v_business_name text;
begin
  if char_length(v_code) <> 10 or coalesce(p_secret_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_platform, '') <> 'windows'
     or coalesce(p_agent_version, '') !~ '^[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,6}([-+][0-9A-Za-z.-]{1,40})?$' then
    raise exception 'emparejamiento invalido' using errcode = '22023';
  end if;
  select p.* into v_pairing from public.local_device_pairings p
   where p.code_hash = private.print_sha256_hex('taba-pairing:v1:' || v_code)
   for update;
  if not found or v_pairing.consumed_at is not null or v_pairing.expires_at <= now() then
    raise exception 'codigo de emparejamiento invalido o vencido' using errcode = '42501';
  end if;
  if exists (select 1 from public.local_devices d where d.secret_hash = p_secret_hash or d.pending_secret_hash = p_secret_hash) then
    raise exception 'emparejamiento invalido' using errcode = '22023';
  end if;
  if (select count(*) from public.local_devices where business_id = v_pairing.business_id and status = 'active') >= 5 then
    raise exception 'el negocio ya tiene 5 agentes activos' using errcode = 'P0001';
  end if;
  insert into public.local_devices(business_id, device_name, platform, agent_version, status, secret_hash, created_by, last_seen_at)
  values (v_pairing.business_id,
    coalesce(nullif(left(btrim(coalesce(p_device_name, '')), 80), ''), v_pairing.device_name),
    'windows', p_agent_version, 'active', p_secret_hash, v_pairing.created_by, now())
  returning * into v_device;
  update public.local_device_pairings set consumed_at = now(), device_id = v_device.id where id = v_pairing.id;
  insert into public.business_config_audit(business_id, scope, action, actor_kind, actor_id, before, after)
  values (v_device.business_id, 'printing', 'enabled', 'system', null, null,
    jsonb_build_object('device_id', v_device.id, 'device_name', v_device.device_name, 'agent_version', v_device.agent_version));
  select b.name into v_business_name from public.businesses b where b.id = v_device.business_id;
  return jsonb_build_object('device_id', v_device.id, 'business_id', v_device.business_id,
    'business_name', v_business_name, 'device_name', v_device.device_name);
end;
$agent_register_device$;

create or replace function public.agent_heartbeat(p_device_id uuid, p_secret_hash text, p_report jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $agent_heartbeat$
declare
  v_device public.local_devices%rowtype;
  v_printers jsonb;
  v_version text := p_report->>'agent_version';
  v_open boolean;
begin
  v_device := private.local_device_authenticate(p_device_id, p_secret_hash);
  if p_report is null or jsonb_typeof(p_report) <> 'object' or pg_column_size(p_report) > 8192
     or (p_report ? 'printers' and jsonb_typeof(p_report->'printers') <> 'array') then
    raise exception 'reporte invalido' using errcode = '22023';
  end if;
  if v_version is not null and v_version !~ '^[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,6}([-+][0-9A-Za-z.-]{1,40})?$' then
    raise exception 'version invalida' using errcode = '22023';
  end if;
  -- Sólo lo que el Panel muestra: nombre visible, rol y estado. Nada más se guarda.
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', left(p->>'name', 80),
           'role', case when p->>'role' in ('kitchen', 'counter', 'fiscal') then p->>'role' else null end,
           'status', case when p->>'status' in ('READY', 'ERROR', 'OFFLINE', 'UNKNOWN') then p->>'status' else 'UNKNOWN' end)), '[]'::jsonb)
    into v_printers
    from (select value as p from jsonb_array_elements(coalesce(p_report->'printers', '[]'::jsonb)) limit 10) as printers
   where jsonb_typeof(p) = 'object' and char_length(coalesce(p->>'name', '')) between 1 and 256;
  update public.local_devices
     set agent_version = coalesce(v_version, agent_version),
         last_report = jsonb_build_object(
           'printers', v_printers,
           'queue_depth', case when jsonb_typeof(p_report->'queue_depth') = 'number'
                               then least(greatest((p_report->>'queue_depth')::numeric, 0), 100000) else null end,
           'reported_at', now())
   where id = v_device.id;
  select b.status = 'open' into v_open from public.businesses b where b.id = v_device.business_id;
  return jsonb_build_object('device_status', 'active', 'server_time', now(),
    'poll_seconds', case when coalesce(v_open, false) then 10 else 60 end);
end;
$agent_heartbeat$;

create or replace function public.agent_claim_print_jobs(
  p_device_id uuid,
  p_secret_hash text,
  p_document_types text[],
  p_limit integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $agent_claim_print_jobs$
declare
  v_device public.local_devices%rowtype;
  v_job public.print_jobs%rowtype;
  v_jobs jsonb := '[]'::jsonb;
  v_open boolean;
begin
  v_device := private.local_device_authenticate(p_device_id, p_secret_hash);
  if p_limit is null or p_limit not between 1 and 10 or p_document_types is null or cardinality(p_document_types) = 0
     or not (p_document_types <@ array['order_ticket', 'kitchen_ticket', 'fiscal_receipt']) then
    raise exception 'reclamo invalido' using errcode = '22023';
  end if;
  perform private.print_expire_leases(v_device.business_id);
  for v_job in
    select j.* from public.print_jobs j
     where j.business_id = v_device.business_id
       and (j.device_id is null or j.device_id = v_device.id)
       and j.document_type = any(p_document_types)
       and j.status = 'queued'
       and j.next_attempt_at <= now()
     order by j.created_at, j.id
     for update skip locked
     limit p_limit
  loop
    update public.print_jobs
       set status = 'claimed', claim_token = gen_random_uuid(), claimed_by_device_id = v_device.id,
           claimed_at = now(), lease_expires_at = now() + interval '60 seconds', attempt_count = attempt_count + 1
     where id = v_job.id
    returning * into v_job;
    perform private.print_job_log(v_job, 'claimed', 'device', null, v_device.id, 'queued',
      jsonb_build_object('attempt', v_job.attempt_count));
    v_jobs := v_jobs || jsonb_build_array(jsonb_build_object(
      'id', v_job.id, 'document_type', v_job.document_type, 'payload', v_job.payload,
      'payload_version', v_job.payload_version, 'claim_token', v_job.claim_token,
      'attempt', v_job.attempt_count, 'reprint_of', v_job.reprint_of,
      'created_at', v_job.created_at, 'lease_expires_at', v_job.lease_expires_at));
  end loop;
  select b.status = 'open' into v_open from public.businesses b where b.id = v_device.business_id;
  return jsonb_build_object('jobs', v_jobs, 'server_time', now(),
    'poll_seconds', case when jsonb_array_length(v_jobs) > 0 then 2 when coalesce(v_open, false) then 10 else 60 end);
end;
$agent_claim_print_jobs$;

-- Transiciones que informa el agente, siempre con el claim_token vigente:
--   printing    claimed → printing (ANTES de mandar bytes; si falla, no se imprime)
--   printed     printing|needs_review → printed (una confirmación tardía vale)
--   not_printed claimed|printing → queued con espera (o failed tras 5 intentos):
--               el agente garantiza que no salió nada
--   unknown     claimed|printing → needs_review
create or replace function public.agent_update_print_job(
  p_device_id uuid,
  p_secret_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_transition text,
  p_error_code text default null,
  p_duration_ms integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $agent_update_print_job$
declare
  v_device public.local_devices%rowtype;
  v_job public.print_jobs%rowtype;
  v_from text;
  v_detail jsonb;
begin
  v_device := private.local_device_authenticate(p_device_id, p_secret_hash);
  if p_transition not in ('printing', 'printed', 'not_printed', 'unknown')
     or (p_error_code is not null and p_error_code !~ '^[A-Z0-9_]{3,80}$')
     or (p_duration_ms is not null and p_duration_ms not between 0 and 3600000) then
    raise exception 'transicion invalida' using errcode = '22023';
  end if;
  select j.* into v_job from public.print_jobs j
   where j.id = p_job_id and j.business_id = v_device.business_id for update;
  if not found then raise exception 'trabajo de impresion inexistente' using errcode = 'P0002'; end if;
  if p_claim_token is null or v_job.claim_token is distinct from p_claim_token
     or v_job.claimed_by_device_id is distinct from v_device.id then
    raise exception 'reclamo invalido' using errcode = 'PT409';
  end if;
  v_from := v_job.status;
  v_detail := jsonb_strip_nulls(jsonb_build_object('error_code', p_error_code, 'duration_ms', p_duration_ms));

  if p_transition = 'printing' then
    if v_job.status = 'printing' then
      return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', true);
    end if;
    if v_job.status <> 'claimed' or v_job.lease_expires_at <= now() then
      raise exception 'reclamo vencido: no imprimir' using errcode = 'PT409';
    end if;
    update public.print_jobs set status = 'printing', printing_at = now(), lease_expires_at = now() + interval '120 seconds'
     where id = v_job.id returning * into v_job;
  elsif p_transition = 'printed' then
    if v_job.status = 'printed' then
      return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', true);
    end if;
    if v_job.status not in ('printing', 'needs_review') or (v_job.status = 'needs_review' and v_job.resolved_at is not null) then
      raise exception 'el trabajo no estaba imprimiendo' using errcode = 'PT409';
    end if;
    update public.print_jobs set status = 'printed', printed_at = now(), lease_expires_at = null, last_error = null
     where id = v_job.id returning * into v_job;
  elsif p_transition = 'not_printed' then
    if v_job.status in ('queued', 'failed') then
      return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', true);
    end if;
    if v_job.status not in ('claimed', 'printing') then
      raise exception 'el trabajo no esta en curso' using errcode = 'PT409';
    end if;
    if v_job.attempt_count >= 5 then
      update public.print_jobs set status = 'failed', failed_at = now(), lease_expires_at = null,
             last_error = coalesce(p_error_code, 'NOT_PRINTED')
       where id = v_job.id returning * into v_job;
    else
      update public.print_jobs set status = 'queued', lease_expires_at = null,
             next_attempt_at = now() + least(interval '5 minutes', make_interval(secs => 10 * (2 ^ (v_job.attempt_count - 1)))),
             last_error = coalesce(p_error_code, 'NOT_PRINTED')
       where id = v_job.id returning * into v_job;
    end if;
  else
    if v_job.status = 'needs_review' then
      return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', true);
    end if;
    if v_job.status not in ('claimed', 'printing') then
      raise exception 'el trabajo no esta en curso' using errcode = 'PT409';
    end if;
    update public.print_jobs set status = 'needs_review', needs_review_at = now(), lease_expires_at = null,
           last_error = coalesce(p_error_code, 'PRINT_OUTCOME_UNKNOWN')
     where id = v_job.id returning * into v_job;
  end if;
  perform private.print_job_log(v_job, case p_transition when 'printing' then 'printing' when 'printed' then 'printed'
    when 'not_printed' then 'not_printed' else 'outcome_unknown' end, 'device', null, v_device.id, v_from, v_detail);
  return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', false);
end;
$agent_update_print_job$;

create or replace function public.agent_request_reprint(
  p_device_id uuid,
  p_secret_hash text,
  p_job_id uuid,
  p_reason text,
  p_operator_label text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $agent_request_reprint$
declare
  v_device public.local_devices%rowtype;
begin
  v_device := private.local_device_authenticate(p_device_id, p_secret_hash);
  if coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9:_-]{8,150}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;
  return private.print_request_reprint(p_job_id, v_device.business_id, p_reason, 'reprint:' || p_idempotency_key,
    'agent', null, 'device', v_device.id, p_operator_label);
end;
$agent_request_reprint$;

create or replace function public.agent_rotate_device_secret(p_device_id uuid, p_secret_hash text, p_new_secret_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $agent_rotate_device_secret$
declare
  v_device public.local_devices%rowtype;
begin
  v_device := private.local_device_authenticate(p_device_id, p_secret_hash);
  if coalesce(p_new_secret_hash, '') !~ '^[0-9a-f]{64}$' or p_new_secret_hash = v_device.secret_hash
     or exists (select 1 from public.local_devices d where d.id <> v_device.id
                 and (d.secret_hash = p_new_secret_hash or d.pending_secret_hash = p_new_secret_hash)) then
    raise exception 'secreto nuevo invalido' using errcode = '22023';
  end if;
  update public.local_devices set pending_secret_hash = p_new_secret_hash where id = v_device.id;
  return jsonb_build_object('device_id', v_device.id, 'rotation', 'pending');
end;
$agent_rotate_device_secret$;

-- ── RPC del operador de plataforma (sólo service_role) ─────────────────────

create or replace function public.operator_create_local_device_pairing(p_business_id uuid, p_device_name text)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $operator_create_local_device_pairing$
  select private.local_device_create_pairing(p_business_id, p_device_name, null, 'service');
$operator_create_local_device_pairing$;

create or replace function public.operator_revoke_local_device(p_device_id uuid, p_reason text)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $operator_revoke_local_device$
  select private.local_device_revoke(p_device_id, p_reason, null, 'service');
$operator_revoke_local_device$;

-- ── RLS y menor privilegio ────────────────────────────────────────────────

alter table public.local_devices enable row level security;
alter table public.local_device_pairings enable row level security;
alter table public.business_print_settings enable row level security;
alter table public.print_jobs enable row level security;
alter table public.print_job_events enable row level security;

drop policy if exists "back office reads its print jobs" on public.print_jobs;
create policy "back office reads its print jobs" on public.print_jobs for select to authenticated
  using (public.has_business_role(business_id, array['owner', 'admin', 'staff']));

drop policy if exists "back office reads its print audit" on public.print_job_events;
create policy "back office reads its print audit" on public.print_job_events for select to authenticated
  using (public.has_business_role(business_id, array['owner', 'admin', 'staff']));

revoke all on table public.local_devices, public.local_device_pairings, public.business_print_settings,
  public.print_jobs, public.print_job_events from public, anon, authenticated;
grant select on table public.print_jobs, public.print_job_events to authenticated;

revoke all on function
  private.print_protect_events(),
  private.print_sha256_hex(text),
  private.local_device_pairing_code(),
  private.local_device_normalize_code(text),
  private.local_device_create_pairing(uuid, text, uuid, text),
  private.local_device_authenticate(uuid, text),
  private.print_job_log(public.print_jobs, text, text, uuid, uuid, text, jsonb),
  private.print_payment_label(text, text, text),
  private.order_print_payload(uuid, text),
  private.fiscal_voucher_label(integer),
  private.fiscal_qr_url(public.fiscal_documents),
  private.fiscal_compact_json(text),
  private.fiscal_receipt_print_payload(uuid),
  private.print_enqueue(uuid, text, uuid, jsonb, text, uuid, text, uuid, text, text, uuid),
  private.print_jobs_guard_insert(),
  private.print_expire_leases(uuid),
  private.print_request_reprint(uuid, uuid, text, text, text, uuid, text, uuid, text),
  private.orders_enqueue_print_jobs(),
  private.fiscal_documents_enqueue_print_job(),
  private.local_device_revoke(uuid, text, uuid, text)
from public, anon, authenticated;

revoke all on function
  public.create_local_device_pairing(uuid, text),
  public.revoke_local_device(uuid, text),
  public.get_local_print_status(uuid),
  public.configure_business_print_settings(uuid, jsonb),
  public.request_order_print_job(uuid, text, text),
  public.request_print_job_reprint(uuid, text, text),
  public.resolve_print_job_review(uuid, text, text),
  public.cancel_print_job(uuid, text),
  public.agent_register_device(text, text, text, text, text),
  public.agent_heartbeat(uuid, text, jsonb),
  public.agent_claim_print_jobs(uuid, text, text[], integer),
  public.agent_update_print_job(uuid, text, uuid, uuid, text, text, integer),
  public.agent_request_reprint(uuid, text, uuid, text, text, text),
  public.agent_rotate_device_secret(uuid, text, text),
  public.operator_create_local_device_pairing(uuid, text),
  public.operator_revoke_local_device(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.create_local_device_pairing(uuid, text),
  public.revoke_local_device(uuid, text),
  public.get_local_print_status(uuid),
  public.configure_business_print_settings(uuid, jsonb),
  public.request_order_print_job(uuid, text, text),
  public.request_print_job_reprint(uuid, text, text),
  public.resolve_print_job_review(uuid, text, text),
  public.cancel_print_job(uuid, text)
to authenticated;

grant execute on function
  public.agent_register_device(text, text, text, text, text),
  public.agent_heartbeat(uuid, text, jsonb),
  public.agent_claim_print_jobs(uuid, text, text[], integer),
  public.agent_update_print_job(uuid, text, uuid, uuid, text, text, integer),
  public.agent_request_reprint(uuid, text, uuid, text, text, text),
  public.agent_rotate_device_secret(uuid, text, text),
  public.operator_create_local_device_pairing(uuid, text),
  public.operator_revoke_local_device(uuid, text)
to service_role;

comment on table public.local_devices is 'Agentes locales (Taba.LocalAgent) por negocio. Guarda el SHA-256 de la credencial, nunca el secreto.';
comment on table public.print_jobs is 'Cola de impresion del mostrador. printing se registra antes de imprimir; needs_review nunca se reimprime solo.';
comment on table public.print_job_events is 'Auditoria inmutable de la cola de impresion: quien, cuando, desde y hacia que estado.';
comment on table public.business_print_settings is 'Impresion automatica por negocio. Apagada por defecto.';
comment on function public.agent_claim_print_jobs(uuid, text, text[], integer) is
  'Reclamo atomico (FOR UPDATE SKIP LOCKED) con claim_token y lease de 60 s. Solo service_role (print-agent-gateway).';
