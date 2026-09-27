-- ============================================================================
--  La Taba · WhatsApp como canal fiscal (V2)
-- ============================================================================
--
--  WhatsApp NO decide nada fiscal. Pide, con un actor real y una confirmación explícita, lo
--  mismo que el Panel: service_request_order_invoice → evaluación única → core. Si el pedido
--  no se puede facturar, contesta las mismas razones que ve el Panel.
--
--  Todo lo que tiene que sobrevivir a un reinicio vive en la base:
--    · whatsapp_pairings ........... códigos de un solo uso (selector + secreto con hash,
--                                    vencimiento, intentos) de un usuario para un negocio;
--    · whatsapp_links .............. teléfono ↔ usuario ↔ negocio, revocables;
--    · whatsapp_sessions ........... el negocio elegido EXPLÍCITAMENTE cuando hay más de uno;
--    · whatsapp_phone_throttle ..... intentos fallidos de vinculación por teléfono;
--    · whatsapp_inbound_messages ... dedup atómico por wa_message_id (Meta reintenta);
--    · whatsapp_pending_actions .... confirmaciones con vencimiento, atadas a UN pedido;
--    · whatsapp_outbound_messages .. las respuestas, que la función envía fuera de la transacción.
--
--  Cada mensaje se procesa en UNA transacción (whatsapp_handle_inbound): dedup, comando,
--  pedido fiscal y respuestas. Si la función cae antes del commit, Meta reintenta y se
--  procesa de cero; si ya se confirmó, el reintento es un duplicado y no hace nada.
--
--  La membresía se revalida en CADA mensaje y otra vez al confirmar. Un vínculo deja de valer
--  si el usuario ya no es miembro activo con rol de back office, si está deshabilitado o
--  bloqueado, si el negocio está inactivo, o si le cerraron las sesiones después de vincular.
--
--  El teléfono lo da Meta (wa_id, firmado): nunca lo escribe el usuario.
-- ============================================================================

-- ---- tablas -----------------------------------------------------------------------------
create table if not exists public.whatsapp_pairings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- El selector ubica la vinculación; el secreto la prueba (solo su hash se guarda).
  selector text not null check (selector ~ '^[A-HJ-NP-Z2-9]{4}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_phone text check (consumed_by_phone is null or consumed_by_phone ~ '^[1-9][0-9]{7,14}$'),
  revoked_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_by_phone is not null)
);
create unique index if not exists whatsapp_pairings_open_selector
  on public.whatsapp_pairings(selector) where consumed_at is null and revoked_at is null;
create index if not exists whatsapp_pairings_open_by_user
  on public.whatsapp_pairings(business_id, user_id) where consumed_at is null and revoked_at is null;

create table if not exists public.whatsapp_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^[1-9][0-9]{7,14}$'),
  pairing_id uuid references public.whatsapp_pairings(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text check (revoke_reason is null or char_length(revoke_reason) between 1 and 200)
);
create unique index if not exists whatsapp_links_one_active
  on public.whatsapp_links(business_id, phone_e164) where revoked_at is null;
create index if not exists whatsapp_links_active_phone on public.whatsapp_links(phone_e164) where revoked_at is null;

create table if not exists public.whatsapp_sessions (
  phone_e164 text primary key check (phone_e164 ~ '^[1-9][0-9]{7,14}$'),
  selected_business_id uuid references public.businesses(id) on delete set null,
  selected_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_phone_throttle (
  phone_e164 text primary key check (phone_e164 ~ '^[1-9][0-9]{7,14}$'),
  window_started_at timestamptz not null default now(),
  failures integer not null default 0 check (failures >= 0),
  blocked_until timestamptz
);

create table if not exists public.whatsapp_inbound_messages (
  wa_message_id text primary key check (char_length(wa_message_id) between 1 and 256),
  phone_e164 text not null check (phone_e164 ~ '^[1-9][0-9]{7,14}$'),
  phone_number_id text check (phone_number_id is null or char_length(phone_number_id) between 1 and 64),
  message_type text not null check (char_length(message_type) between 1 and 32),
  message_timestamp timestamptz,
  received_at timestamptz not null default now(),
  -- Solo el comando y su resultado: el texto libre del mensaje no se guarda.
  command text check (command is null or char_length(command) <= 32),
  outcome text not null check (char_length(outcome) between 1 and 48),
  business_id uuid references public.businesses(id) on delete set null,
  user_id uuid
);
create index if not exists whatsapp_inbound_by_phone on public.whatsapp_inbound_messages(phone_e164, received_at desc);

create table if not exists public.whatsapp_pending_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  link_id uuid not null references public.whatsapp_links(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^[1-9][0-9]{7,14}$'),
  action text not null check (action in ('invoice', 'invoice_and_print')),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_code text not null,
  order_total numeric(14,2) not null,
  source_message_id text not null references public.whatsapp_inbound_messages(wa_message_id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  closed_reason text check (closed_reason in ('confirmed', 'cancelled', 'superseded', 'expired', 'rejected')),
  closed_by_message_id text references public.whatsapp_inbound_messages(wa_message_id),
  result jsonb,
  check (expires_at > created_at),
  check ((closed_at is null) = (closed_reason is null))
);
-- Una sola confirmación abierta por teléfono: "SI" nunca es ambiguo.
create unique index if not exists whatsapp_pending_one_open on public.whatsapp_pending_actions(phone_e164) where closed_at is null;

create table if not exists public.whatsapp_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  inbound_message_id text not null references public.whatsapp_inbound_messages(wa_message_id),
  sequence smallint not null check (sequence between 1 and 10),
  phone_e164 text not null check (phone_e164 ~ '^[1-9][0-9]{7,14}$'),
  kind text not null check (kind in ('text', 'document')),
  body text not null check (char_length(body) between 1 and 4096),
  artifact_id uuid references public.fiscal_document_artifacts(id),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  provider_message_id text,
  last_error text check (last_error is null or char_length(last_error) <= 200),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (inbound_message_id, sequence),
  check ((kind = 'document') = (artifact_id is not null))
);
create index if not exists whatsapp_outbound_pending on public.whatsapp_outbound_messages(created_at) where status = 'pending';

do $grants$
declare
  v_table text;
begin
  foreach v_table in array array['whatsapp_pairings', 'whatsapp_links', 'whatsapp_sessions', 'whatsapp_phone_throttle',
                                 'whatsapp_inbound_messages', 'whatsapp_pending_actions', 'whatsapp_outbound_messages'] loop
    execute format('alter table public.%I enable row level security', v_table);
    -- Nadie las toca directo: solo las funciones de abajo (security definer).
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v_table);
  end loop;
end
$grants$;

-- ---- utilidades -------------------------------------------------------------------------
create or replace function private.whatsapp_sha256(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, extensions
as $$ select encode(extensions.digest(convert_to(coalesce(p_value, ''), 'UTF8'), 'sha256'), 'hex') $$;

-- Letras y dígitos sin ambigüedades (sin 0/O ni 1/I): 32 símbolos, reparto uniforme de un byte.
create or replace function private.whatsapp_random_code(p_length integer)
returns text
language plpgsql
volatile
set search_path = pg_catalog, extensions
as $whatsapp_random_code$
declare
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(p_length);
  v_out text := '';
  v_index integer;
begin
  for v_index in 0 .. p_length - 1 loop
    v_out := v_out || substr(c_alphabet, (get_byte(v_bytes, v_index) % 32) + 1, 1);
  end loop;
  return v_out;
end;
$whatsapp_random_code$;

create or replace function private.whatsapp_money(p_amount numeric)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select '$ ' || replace(replace(replace(to_char(round(coalesce(p_amount, 0), 2), 'FM999,999,999,990.00'), ',', '#'), '.', ','), '#', '.')
$$;

-- ¿Este vínculo todavía habla por su usuario? Se pregunta en cada mensaje.
create or replace function private.whatsapp_link_valid(p_link_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $whatsapp_link_valid$
  select exists (
    select 1
      from public.whatsapp_links l
      join public.business_members m on m.business_id = l.business_id and m.user_id = l.user_id
      join public.businesses b on b.id = l.business_id
      join auth.users u on u.id = l.user_id
     where l.id = p_link_id
       and l.revoked_at is null
       and m.is_active and m.role in ('owner', 'admin', 'staff')
       and b.is_active
       and u.deleted_at is null
       and (u.banned_until is null or u.banned_until < now())
       and not exists (
         select 1 from public.identity_user_security s
          where s.business_id = l.business_id and s.user_id = l.user_id
            and (s.disabled_at is not null or s.sessions_valid_from > l.created_at)))
$whatsapp_link_valid$;

-- ---- el estado fiscal de un pedido, una sola implementación ------------------------------
-- La lectura del Panel (get_order_fiscal_states) y la de WhatsApp comparten el cuerpo. La
-- entrada pública conserva su firma y su compuerta de rol.
create or replace function private.order_fiscal_states(p_business_id uuid, p_order_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $order_fiscal_states$
declare
  v_order_id uuid;
  v_out jsonb := '[]'::jsonb;
  v_document public.fiscal_documents%rowtype;
  v_evaluation jsonb;
begin
  if p_order_ids is null or cardinality(p_order_ids) > 100 then
    raise exception 'lista de pedidos invalida' using errcode = '22023';
  end if;
  foreach v_order_id in array p_order_ids loop
    continue when not exists (select 1 from public.orders o where o.id = v_order_id and o.business_id = p_business_id);
    select d.* into v_document from public.fiscal_documents d
     where d.business_id = p_business_id and d.source_type = 'online_order' and d.source_id = v_order_id and d.document_intent = 'invoice';
    if found then
      v_out := v_out || jsonb_build_object(
        'order_id', v_order_id,
        'readiness', jsonb_build_object('status', 'ALREADY_REQUESTED', 'reasons', '[]'::jsonb),
        'document', jsonb_build_object(
          'id', v_document.id, 'state', v_document.state, 'environment', v_document.environment,
          'document_type', v_document.document_type, 'point_of_sale', v_document.point_of_sale,
          'document_number', v_document.document_number,
          'cae', case when v_document.state in ('authorized', 'credited') then v_document.cae end,
          'cae_expiration', case when v_document.state in ('authorized', 'credited') then v_document.cae_expiration end,
          'authorized_at', v_document.authorized_at, 'total_amount', v_document.total_amount,
          'artifact_state', v_document.artifact_state,
          'artifact_id', (select a.id from public.fiscal_document_artifacts a
                           where a.fiscal_document_id = v_document.id and a.is_current and a.state = 'artifact_ready' limit 1)),
        'print', jsonb_build_object(
          'requested', exists (select 1 from public.fiscal_print_requests r where r.fiscal_document_id = v_document.id),
          'request_error', (select r.last_error is not null from public.fiscal_print_requests r where r.fiscal_document_id = v_document.id),
          'latest_job', (select jsonb_build_object('id', j.id, 'status', j.status, 'reprint_of', j.reprint_of, 'created_at', j.created_at)
                           from public.print_jobs j
                          where j.business_id = p_business_id and j.document_type = 'fiscal_receipt' and j.source_entity_id = v_document.id
                          order by j.created_at desc, j.id desc limit 1),
          'jobs', (select count(*) from public.print_jobs j
                    where j.business_id = p_business_id and j.document_type = 'fiscal_receipt' and j.source_entity_id = v_document.id)));
    else
      v_evaluation := private.commercial_order_fiscal_evaluation(p_business_id, v_order_id, false);
      v_out := v_out || jsonb_build_object('order_id', v_order_id,
        'readiness', jsonb_build_object('status', v_evaluation->>'status', 'reasons', coalesce(v_evaluation->'reasons', '[]'::jsonb)),
        'document', null, 'print', null);
    end if;
  end loop;
  return v_out;
end;
$order_fiscal_states$;

create or replace function public.get_order_fiscal_states(p_business_id uuid, p_order_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $get_order_fiscal_states$
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  return private.order_fiscal_states(p_business_id, p_order_ids);
end;
$get_order_fiscal_states$;

-- ---- textos (los mismos del Panel: js/business/order-fiscal-presenter.js) ----------------
create or replace function private.whatsapp_reason_text(p_reason jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $whatsapp_reason_text$
declare
  v_code text := coalesce(p_reason->>'code', '');
  v_item text := left(regexp_replace(btrim(coalesce(p_reason->>'item', '')), '\s+', ' ', 'g'), 60);
  v_text text;
begin
  if v_code = 'ORDER_NOT_BILLABLE_YET' then
    v_text := case p_reason->>'billing_moment'
      when 'after_payment_confirmed' then 'Se factura cuando el pago esté confirmado'
      when 'after_delivered' then 'Se factura cuando el pedido se entregue'
      when 'after_accepted' then 'Se factura cuando el pedido se acepte' end;
    if v_text is not null then return v_text; end if;
  end if;
  if v_code = 'PAYMENT_REQUIRED' then
    v_text := case p_reason->>'payment_state'
      when 'pending' then 'Falta confirmar el pago'
      when 'refunded' then 'El pago fue devuelto'
      when 'reversed' then 'El cobro fue revertido'
      when 'unknown' then 'No se pudo verificar el pago' end;
    if v_text is not null then return v_text; end if;
  end if;
  v_text := case v_code
    when 'ACCOUNTING_POLICY_REQUIRED' then 'Configuración fiscal pendiente'
    when 'FISCAL_PROFILE_DISABLED' then 'La facturación está desactivada'
    when 'HOMOLOGATION_NOT_AUTHORIZED' then 'Falta autorizar la homologación con ARCA'
    when 'PRODUCTION_BLOCKED' then 'La facturación real todavía no está habilitada'
    when 'ORDER_CANCELLED' then 'Pedido cancelado: no se factura'
    when 'QA_ORDER_NOT_BILLABLE' then 'Pedido de prueba: no se factura'
    when 'PAYMENT_REQUIRED' then 'Falta confirmar el pago'
    when 'PAYMENT_METHOD_NOT_INVOICEABLE' then 'La configuración fiscal no factura este medio de pago'
    when 'ORDER_NOT_BILLABLE_YET' then 'Todavía no corresponde facturarlo'
    when 'INVALID_TOTAL' then 'Los importes del pedido no se pueden facturar exactos'
    when 'INVALID_PRODUCT_REFERENCE' then 'Hay un producto que no se puede identificar'
    when 'MISSING_TAX_CLASSIFICATION' then 'Falta la clasificación impositiva de un producto'
    when 'DISCOUNT_NOT_INVOICEABLE' then 'La configuración fiscal no factura descuentos'
    when 'DELIVERY_NOT_INVOICEABLE' then 'La configuración fiscal no factura el envío'
    when 'FISCAL_PARAMETERS_REQUIRED' then 'Faltan las tablas actualizadas de ARCA'
    when 'RECIPIENT_DATA_REQUIRED' then 'Por el monto, hay que identificar al consumidor'
    else 'Revisión fiscal necesaria' end;
  if v_item <> '' and v_code in ('MISSING_TAX_CLASSIFICATION', 'INVALID_PRODUCT_REFERENCE') then
    return v_text || ': ' || v_item;
  end if;
  return v_text;
end;
$whatsapp_reason_text$;

create or replace function private.whatsapp_reasons_text(p_reasons jsonb)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(string_agg(t, ' · ' order by first_seen), 'Revisión fiscal necesaria')
    from (select private.whatsapp_reason_text(r) as t, min(n) as first_seen
            from jsonb_array_elements(case when jsonb_typeof(p_reasons) = 'array' then p_reasons else '[]'::jsonb end)
                 with ordinality as x(r, n)
           group by 1) texts
$$;

create or replace function private.whatsapp_print_agent(p_business_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when not exists (select 1 from public.local_devices d
                      where d.business_id = p_business_id and (d.status = 'active' or d.revoked_at > now() - interval '30 days')) then 'NOT_REGISTERED'
    when exists (select 1 from public.local_devices d
                  where d.business_id = p_business_id and d.status = 'active' and d.last_seen_at > now() - interval '150 seconds') then 'ONLINE'
    else 'OFFLINE' end
$$;

-- Una fila de order_fiscal_states → el texto del mostrador.
create or replace function private.whatsapp_state_text(p_code text, p_state jsonb, p_agent text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $whatsapp_state_text$
declare
  v_document jsonb := p_state->'document';
  v_print jsonb := p_state->'print';
  v_job jsonb := p_state->'print'->'latest_job';
  v_state text := v_document->>'state';
  v_authorized boolean;
  v_label text;
  v_kind text;
  v_number text;
  v_print_text text;
  v_rest jsonb;
  v_lines text[] := '{}';
begin
  if v_document is null or jsonb_typeof(v_document) <> 'object' then
    if p_state->'readiness'->>'status' = 'READY' then
      return p_code || ' · Listo para facturar. Para pedir la factura: facturar ' || p_code;
    end if;
    if exists (select 1 from jsonb_array_elements(coalesce(p_state->'readiness'->'reasons', '[]'::jsonb)) r where r->>'code' = 'ACCOUNTING_POLICY_REQUIRED') then
      v_rest := (select coalesce(jsonb_agg(r), '[]'::jsonb) from jsonb_array_elements(p_state->'readiness'->'reasons') r
                  where r->>'code' <> 'ACCOUNTING_POLICY_REQUIRED');
      return p_code || ' · Configuración fiscal pendiente'
        || case when jsonb_array_length(v_rest) > 0 then ': ' || private.whatsapp_reasons_text(v_rest) else '' end;
    end if;
    return p_code || ' · No se puede facturar todavía: ' || private.whatsapp_reasons_text(p_state->'readiness'->'reasons');
  end if;
  v_authorized := v_state in ('authorized', 'credited') and coalesce(v_document->>'cae', '') ~ '^[0-9]{14}$';
  v_label := case
    when v_state in ('authorized', 'credited') and not v_authorized then 'Requiere revisión'
    when v_state in ('queued', 'retry_wait') then 'Pendiente'
    when v_state = 'authorizing' then 'Emitiendo…'
    when v_state = 'ambiguous' then 'Verificando con ARCA…'
    when v_state = 'authorized' then 'Factura emitida'
    when v_state = 'credited' then 'Factura emitida · con nota de crédito'
    when v_state = 'rejected' then 'Rechazada'
    else 'Requiere revisión' end;
  v_lines := v_lines || (p_code || ' · ' || v_label);
  if v_authorized then
    v_kind := case (v_document->>'document_type')::integer
      when 1 then 'Factura A' when 6 then 'Factura B' when 11 then 'Factura C'
      when 3 then 'Nota de crédito A' when 8 then 'Nota de crédito B' when 13 then 'Nota de crédito C'
      else 'Comprobante' end;
    if coalesce(v_document->>'document_number', '') ~ '^[0-9]+$' then
      v_number := v_kind || ' ' || lpad(v_document->>'point_of_sale', 5, '0') || '-' || lpad(v_document->>'document_number', 8, '0');
      v_lines := v_lines || (v_number || ' · ' || case when v_document->>'environment' = 'production' then 'CAE ' else 'CAE de homologación ' end || (v_document->>'cae'));
    end if;
  end if;
  if coalesce(v_document->>'environment', '') <> 'production' then
    v_lines := v_lines || 'HOMOLOGACIÓN · sin validez fiscal'::text;
  end if;
  if v_job is not null and jsonb_typeof(v_job) = 'object' then
    v_print_text := case v_job->>'status'
      when 'queued' then 'Impresión pendiente' when 'claimed' then 'Impresión pendiente'
      when 'printing' then 'Imprimiendo…' when 'printed' then 'Impreso'
      when 'needs_review' then 'Impresión a revisar' when 'failed' then 'La impresión falló'
      when 'cancelled' then 'Impresión cancelada' else 'Impresión a revisar' end;
    if v_print_text = 'Impresión pendiente' and p_agent = 'NOT_REGISTERED' then
      v_print_text := v_print_text || ' · no hay una PC de impresión vinculada';
    elsif v_print_text = 'Impresión pendiente' and p_agent = 'OFFLINE' then
      v_print_text := v_print_text || ' · la PC de impresión está sin conexión';
    end if;
  elsif coalesce((v_print->>'request_error')::boolean, false) then
    v_print_text := 'No se pudo mandar a imprimir';
  elsif coalesce((v_print->>'requested')::boolean, false) then
    v_print_text := case when v_state in ('authorized', 'credited') then 'Impresión pendiente' else 'Se imprime al emitirse' end;
  end if;
  if v_print_text is not null then
    v_lines := v_lines || ('Impresión: ' || v_print_text);
  end if;
  return array_to_string(v_lines, E'\n');
end;
$whatsapp_state_text$;

-- Un pedido del negocio por su código visible (LT-1234). Nunca por texto libre en una consulta.
create or replace function private.whatsapp_find_order(p_business_id uuid, p_code text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select case when count(*) = 1 then min(o.id::text)::uuid end
    from public.orders o
   where o.business_id = p_business_id
     and (upper(o.public_code) = upper(p_code) or upper(o.code) = upper(p_code))
$$;

-- ---- contexto: quién habla y por qué negocio ---------------------------------------------
create or replace function private.whatsapp_context(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $whatsapp_context$
declare
  v_valid jsonb;
  v_count integer;
  v_selected uuid;
  v_had_links boolean;
begin
  select coalesce(jsonb_agg(jsonb_build_object('link_id', l.id, 'business_id', l.business_id, 'user_id', l.user_id, 'business_name', b.name)
                            order by b.name, b.id), '[]'::jsonb)
    into v_valid
    from public.whatsapp_links l join public.businesses b on b.id = l.business_id
   where l.phone_e164 = p_phone and l.revoked_at is null and private.whatsapp_link_valid(l.id);
  v_count := jsonb_array_length(v_valid);
  if v_count = 0 then
    select exists (select 1 from public.whatsapp_links l where l.phone_e164 = p_phone and l.revoked_at is null) into v_had_links;
    return jsonb_build_object('status', case when v_had_links then 'inactive' else 'unlinked' end);
  end if;
  if v_count = 1 then
    return jsonb_build_object('status', 'ok', 'multiple', false) || (v_valid->0);
  end if;
  select s.selected_business_id into v_selected from public.whatsapp_sessions s where s.phone_e164 = p_phone;
  if v_selected is not null then
    return coalesce(
      (select jsonb_build_object('status', 'ok', 'multiple', true) || x from jsonb_array_elements(v_valid) x where (x->>'business_id')::uuid = v_selected),
      jsonb_build_object('status', 'choose', 'options', v_valid));
  end if;
  return jsonb_build_object('status', 'choose', 'options', v_valid);
end;
$whatsapp_context$;

-- ---- vincular ----------------------------------------------------------------------------
create or replace function private.whatsapp_redeem(p_phone text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $whatsapp_redeem$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_throttle public.whatsapp_phone_throttle%rowtype;
  v_pairing public.whatsapp_pairings%rowtype;
  v_link_id uuid;
  v_business_name text;
  c_invalid constant text := 'El código no es válido o venció. Pedí uno nuevo en el Panel.';
begin
  insert into public.whatsapp_phone_throttle(phone_e164) values (p_phone) on conflict (phone_e164) do nothing;
  select t.* into v_throttle from public.whatsapp_phone_throttle t where t.phone_e164 = p_phone for update;
  if v_throttle.blocked_until > now() then
    return jsonb_build_object('outcome', 'pairing_throttled', 'reply', 'Demasiados intentos con códigos inválidos. Probá de nuevo en una hora.');
  end if;
  if v_throttle.window_started_at < now() - interval '1 hour' then
    update public.whatsapp_phone_throttle set window_started_at = now(), failures = 0, blocked_until = null where phone_e164 = p_phone;
  end if;

  if v_code !~ '^[A-HJ-NP-Z2-9]{12}$' then
    perform private.whatsapp_pairing_failure(p_phone);
    return jsonb_build_object('outcome', 'pairing_invalid', 'reply', c_invalid);
  end if;
  -- El selector ubica la vinculación abierta; el lock la serializa frente a otro intento.
  select p.* into v_pairing from public.whatsapp_pairings p
   where p.selector = left(v_code, 4) and p.consumed_at is null and p.revoked_at is null
   for update;
  if not found or v_pairing.expires_at <= now() then
    perform private.whatsapp_pairing_failure(p_phone);
    return jsonb_build_object('outcome', 'pairing_invalid', 'reply', c_invalid);
  end if;
  if private.whatsapp_sha256(substr(v_code, 5)) <> v_pairing.code_hash then
    update public.whatsapp_pairings
       set attempt_count = attempt_count + 1,
           revoked_at = case when attempt_count + 1 >= max_attempts then now() end
     where id = v_pairing.id;
    perform private.whatsapp_pairing_failure(p_phone);
    return jsonb_build_object('outcome', 'pairing_invalid', 'reply', c_invalid);
  end if;
  -- El usuario tiene que seguir siendo del back office de ese negocio al canjear.
  if not exists (select 1 from public.business_members m join public.businesses b on b.id = m.business_id
                  where m.business_id = v_pairing.business_id and m.user_id = v_pairing.user_id
                    and m.is_active and m.role in ('owner', 'admin', 'staff') and b.is_active)
     or exists (select 1 from public.identity_user_security s
                 where s.business_id = v_pairing.business_id and s.user_id = v_pairing.user_id and s.disabled_at is not null) then
    update public.whatsapp_pairings set revoked_at = now() where id = v_pairing.id;
    return jsonb_build_object('outcome', 'pairing_member_inactive', 'reply', 'Tu usuario ya no está activo en ese negocio. No se vinculó nada.');
  end if;

  update public.whatsapp_pairings set consumed_at = now(), consumed_by_phone = p_phone where id = v_pairing.id;
  -- Un teléfono habla por UN usuario en cada negocio: el vínculo anterior se reemplaza.
  update public.whatsapp_links set revoked_at = now(), revoke_reason = 'reemplazado por una nueva vinculación'
   where business_id = v_pairing.business_id and phone_e164 = p_phone and revoked_at is null;
  insert into public.whatsapp_links(business_id, user_id, phone_e164, pairing_id)
  values (v_pairing.business_id, v_pairing.user_id, p_phone, v_pairing.id)
  returning id into v_link_id;
  insert into public.whatsapp_sessions(phone_e164, selected_business_id, selected_at)
  values (p_phone, v_pairing.business_id, now())
  on conflict (phone_e164) do update set selected_business_id = excluded.selected_business_id, selected_at = now(), updated_at = now();
  update public.whatsapp_phone_throttle set failures = 0, blocked_until = null where phone_e164 = p_phone;
  select b.name into v_business_name from public.businesses b where b.id = v_pairing.business_id;
  return jsonb_build_object('outcome', 'paired', 'business_id', v_pairing.business_id, 'user_id', v_pairing.user_id, 'link_id', v_link_id,
    'reply', 'Listo: este WhatsApp quedó vinculado a ' || v_business_name || '. Escribí ayuda para ver qué podés hacer.');
end;
$whatsapp_redeem$;

create or replace function private.whatsapp_pairing_failure(p_phone text)
returns void
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  update public.whatsapp_phone_throttle
     set failures = failures + 1,
         blocked_until = case when failures + 1 >= 10 then now() + interval '1 hour' else blocked_until end
   where phone_e164 = p_phone
$$;

-- ---- comandos ----------------------------------------------------------------------------
create or replace function private.whatsapp_help_text()
returns text
language sql
immutable
as $$
  select array_to_string(array[
    'Esto podés hacer por acá:',
    '• facturar LT-1234 — pide la factura de un pedido (te pido confirmación)',
    '• facturar LT-1234 e imprimir — lo mismo, y se imprime al autorizarse',
    '• estado LT-1234 — cómo va la factura de un pedido',
    '• pendientes — facturas en curso y pedidos listos para facturar',
    '• ventas hoy — el resumen del día',
    '• estado — cómo está la facturación del negocio',
    '• negocio — elegir el negocio, si tenés más de uno'], E'\n')
$$;

create or replace function private.whatsapp_business_status_text(p_business_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $whatsapp_business_status_text$
declare
  v_name text;
  v_profile public.fiscal_profiles%rowtype;
  v_policy text;
  v_agent text := private.whatsapp_print_agent(p_business_id);
  v_in_flight integer;
begin
  select b.name into v_name from public.businesses b where b.id = p_business_id;
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = p_business_id;
  select p.policy_version into v_policy from public.commercial_fiscal_policies p
   where p.business_id = p_business_id and p.status = 'approved' and p.valid_from <= current_date
   order by p.valid_from desc, p.approved_at desc limit 1;
  select count(*) into v_in_flight from public.fiscal_documents d
   where d.business_id = p_business_id and d.state in ('queued', 'retry_wait', 'authorizing', 'ambiguous', 'manual_review', 'failed');
  return array_to_string(array[
    v_name,
    'Facturación: ' || case
      when v_profile.business_id is null or not v_profile.is_enabled or v_profile.environment = 'disabled' then 'desactivada'
      when v_profile.environment = 'production' then 'producción'
      else 'homologación (sin validez fiscal)' end,
    'Configuración fiscal: ' || coalesce('aprobada (' || v_policy || ')', 'pendiente'),
    'PC de impresión: ' || case v_agent when 'ONLINE' then 'conectada' when 'OFFLINE' then 'sin conexión' else 'no vinculada' end,
    'Comprobantes en curso o a revisar: ' || v_in_flight], E'\n');
end;
$whatsapp_business_status_text$;

create or replace function private.whatsapp_sales_today_text(p_business_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $whatsapp_sales_today_text$
declare
  v_name text;
  v_zone text;
  v_today date;
  v_orders integer;
  v_orders_total numeric;
  v_sales integer;
  v_sales_total numeric;
  v_authorized integer;
begin
  select b.name, coalesce(nullif(b.operating_timezone, ''), 'America/Argentina/Buenos_Aires') into v_name, v_zone
    from public.businesses b where b.id = p_business_id;
  v_today := (now() at time zone v_zone)::date;
  select count(*), coalesce(sum(o.total), 0) into v_orders, v_orders_total from public.orders o
   where o.business_id = p_business_id and o.origin = 'production'
     and o.status not in ('cancelled', 'canceled', 'rejected')
     and (o.created_at at time zone v_zone)::date = v_today;
  select count(*), coalesce(sum(s.total), 0) into v_sales, v_sales_total from public.pos_sales s
   where s.business_id = p_business_id and s.state = 'completed' and (s.completed_at at time zone v_zone)::date = v_today;
  select count(*) into v_authorized from public.fiscal_documents d
   where d.business_id = p_business_id and d.state in ('authorized', 'credited') and (d.authorized_at at time zone v_zone)::date = v_today;
  return array_to_string(array[
    v_name || ' · hoy, hasta las ' || to_char(now() at time zone v_zone, 'HH24:MI'),
    'Pedidos online (sin cancelados): ' || v_orders || ' por ' || private.whatsapp_money(v_orders_total),
    'Mostrador: ' || v_sales || ' ventas por ' || private.whatsapp_money(v_sales_total),
    'Comprobantes autorizados hoy: ' || v_authorized], E'\n');
end;
$whatsapp_sales_today_text$;

create or replace function private.whatsapp_pending_text(p_business_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $whatsapp_pending_text$
declare
  v_lines text[] := '{}';
  v_row record;
  v_ready integer := 0;
begin
  for v_row in
    select coalesce(o.public_code, o.code) as code, d.state
      from public.fiscal_documents d join public.orders o on o.id = d.source_id
     where d.business_id = p_business_id and d.source_type = 'online_order'
       and d.state in ('queued', 'retry_wait', 'authorizing', 'ambiguous', 'manual_review', 'failed')
     order by d.created_at limit 5
  loop
    v_lines := v_lines || (v_row.code || ' · ' || case
      when v_row.state in ('queued', 'retry_wait') then 'Pendiente'
      when v_row.state = 'authorizing' then 'Emitiendo…'
      when v_row.state = 'ambiguous' then 'Verificando con ARCA…'
      else 'Requiere revisión' end);
  end loop;
  for v_row in
    select o.id, coalesce(o.public_code, o.code) as code
      from public.orders o
     where o.business_id = p_business_id and o.origin = 'production'
       and o.status not in ('cancelled', 'canceled', 'rejected')
       and o.created_at > now() - interval '3 days'
       and not exists (select 1 from public.fiscal_documents d where d.source_type = 'online_order' and d.source_id = o.id)
     order by o.created_at desc limit 30
  loop
    exit when v_ready >= 5;
    if private.commercial_order_fiscal_evaluation(p_business_id, v_row.id, false)->>'status' = 'READY' then
      v_lines := v_lines || (v_row.code || ' · Listo para facturar');
      v_ready := v_ready + 1;
    end if;
  end loop;
  if cardinality(v_lines) = 0 then
    return 'No hay facturas en curso ni pedidos listos para facturar.';
  end if;
  return 'Pendientes:' || E'\n' || array_to_string(v_lines, E'\n');
end;
$whatsapp_pending_text$;

-- ---- el procesador ------------------------------------------------------------------------
create or replace function private.whatsapp_process(p_message_id text, p_phone text, p_message_type text, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $whatsapp_process$
declare
  v_text text := lower(btrim(regexp_replace(translate(coalesce(p_text, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), '\s+', ' ', 'g')));
  v_match text[];
  v_context jsonb;
  v_business uuid;
  v_user uuid;
  v_link uuid;
  v_prefix text := '';
  v_order uuid;
  v_order_row public.orders%rowtype;
  v_state jsonb;
  v_evaluation jsonb;
  v_action public.whatsapp_pending_actions%rowtype;
  v_result jsonb;
  v_environment text;
  v_sqlstate text;
  v_hint text;
  v_detail text;
  v_reasons jsonb;
  v_option jsonb;
  v_replies jsonb := '[]'::jsonb;
  v_code text;
  v_print boolean;
  v_redeem jsonb;
begin
  if p_message_type <> 'text' then
    -- A un número sin vínculo no se le contesta nada que no sea texto.
    if not exists (select 1 from public.whatsapp_links l where l.phone_e164 = p_phone and l.revoked_at is null) then
      return jsonb_build_object('command', null, 'outcome', 'unsupported_type_silent', 'replies', '[]'::jsonb);
    end if;
    return jsonb_build_object('command', 'no_texto', 'outcome', 'unsupported_type',
      'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body', 'Por ahora solo entiendo mensajes de texto. Escribí: ayuda')));
  end if;

  -- vincular CODIGO: lo único que puede hacer un teléfono sin vínculo.
  v_match := regexp_match(v_text, '^vincular ([a-z0-9 -]{12,24})$');
  if v_match is not null then
    v_redeem := private.whatsapp_redeem(p_phone, v_match[1]);
    return jsonb_build_object('command', 'vincular', 'outcome', v_redeem->>'outcome',
      'business_id', v_redeem->'business_id', 'user_id', v_redeem->'user_id',
      'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body', v_redeem->>'reply')));
  end if;

  -- SI / NO: atados a la confirmación abierta de ESTE teléfono, no al negocio elegido.
  v_match := regexp_match(v_text, '^(si|confirmo|confirmar)( [a-z0-9-]{2,40})?$');
  if v_match is not null then
    select a.* into v_action from public.whatsapp_pending_actions a where a.phone_e164 = p_phone and a.closed_at is null for update;
    if not found then
      return jsonb_build_object('command', 'si', 'outcome', 'nothing_to_confirm',
        'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body', 'No hay nada para confirmar. Para pedir una factura: facturar LT-1234')));
    end if;
    if v_action.expires_at <= now() then
      update public.whatsapp_pending_actions set closed_at = now(), closed_reason = 'expired', closed_by_message_id = p_message_id where id = v_action.id;
      return jsonb_build_object('command', 'si', 'outcome', 'confirmation_expired', 'business_id', v_action.business_id, 'user_id', v_action.user_id,
        'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body',
          'La confirmación venció. Pedila de nuevo: facturar ' || v_action.order_code)));
    end if;
    if v_match[2] is not null and upper(btrim(v_match[2])) <> upper(v_action.order_code) then
      return jsonb_build_object('command', 'si', 'outcome', 'confirmation_mismatch', 'business_id', v_action.business_id, 'user_id', v_action.user_id,
        'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body',
          'La confirmación abierta es para ' || v_action.order_code || '. Respondé SI para ese pedido, o pedí: facturar' || upper(v_match[2]))));
    end if;
    -- La membresía se revalida al confirmar: pudo cambiar desde el "facturar".
    if not private.whatsapp_link_valid(v_action.link_id) then
      update public.whatsapp_pending_actions set closed_at = now(), closed_reason = 'rejected', closed_by_message_id = p_message_id,
             result = jsonb_build_object('reason', 'membership') where id = v_action.id;
      return jsonb_build_object('command', 'si', 'outcome', 'member_inactive', 'business_id', v_action.business_id, 'user_id', v_action.user_id,
        'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body', 'Tu usuario ya no puede facturar en ese negocio. No se pidió nada.')));
    end if;
    select o.* into v_order_row from public.orders o where o.id = v_action.order_id;
    if v_order_row.total is distinct from v_action.order_total then
      update public.whatsapp_pending_actions set closed_at = now(), closed_reason = 'rejected', closed_by_message_id = p_message_id,
             result = jsonb_build_object('reason', 'order_changed') where id = v_action.id;
      return jsonb_build_object('command', 'si', 'outcome', 'order_changed', 'business_id', v_action.business_id, 'user_id', v_action.user_id,
        'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body',
          'El pedido ' || v_action.order_code || ' cambió desde que lo pediste. Pedí de nuevo: facturar ' || v_action.order_code)));
    end if;
    v_print := v_action.action = 'invoice_and_print';
    begin
      -- La misma entrada de servidor que las automatizaciones: guardas de La Taba, evaluación,
      -- origen congelado y el core. La clave es la de ESTA confirmación: un reintento converge.
      v_result := public.service_request_order_invoice(v_action.business_id, v_action.order_id, 'wa-' || v_action.id::text,
        'WHATSAPP', v_action.user_id, v_print);
      update public.whatsapp_pending_actions set closed_at = now(), closed_reason = 'confirmed', closed_by_message_id = p_message_id,
             result = jsonb_build_object('fiscal_document_id', v_result->>'fiscal_document_id') where id = v_action.id;
      update public.whatsapp_links set last_used_at = now() where id = v_action.link_id;
      v_state := private.order_fiscal_states(v_action.business_id, array[v_action.order_id])->0;
      return jsonb_build_object('command', 'si', 'outcome', 'invoice_requested', 'business_id', v_action.business_id, 'user_id', v_action.user_id,
        'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body',
          'Solicitud recibida. La factura del pedido ' || v_action.order_code || ' queda pendiente hasta que ARCA la autorice.'
          || case when v_print then ' Se imprime cuando se autorice.' else '' end
          || E'\n' || private.whatsapp_state_text(v_action.order_code, v_state, private.whatsapp_print_agent(v_action.business_id))
          || E'\n' || 'Para ver cómo va: estado ' || v_action.order_code)));
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_hint = pg_exception_hint, v_detail = pg_exception_detail;
      update public.whatsapp_pending_actions set closed_at = now(), closed_reason = 'rejected', closed_by_message_id = p_message_id,
             result = jsonb_build_object('sqlstate', v_sqlstate, 'hint', v_hint) where id = v_action.id;
      if v_hint = 'ORDER_NOT_FISCALLY_READY' then
        begin
          v_reasons := v_detail::jsonb;
        exception when others then
          v_reasons := '[]'::jsonb;
        end;
        return jsonb_build_object('command', 'si', 'outcome', 'order_not_ready', 'business_id', v_action.business_id, 'user_id', v_action.user_id,
          'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body',
            'No se pidió la factura de ' || v_action.order_code || ': ' || private.whatsapp_reasons_text(v_reasons))));
      end if;
      return jsonb_build_object('command', 'si', 'outcome', 'request_failed', 'sqlstate', v_sqlstate, 'business_id', v_action.business_id, 'user_id', v_action.user_id,
        'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body',
          'No se pudo pedir la factura de ' || v_action.order_code || '. Probá de nuevo o pedila desde el Panel.')));
    end;
  end if;

  if v_text in ('no', 'cancelar', 'cancelo') then
    update public.whatsapp_pending_actions set closed_at = now(), closed_reason = 'cancelled', closed_by_message_id = p_message_id
     where phone_e164 = p_phone and closed_at is null
     returning * into v_action;
    return jsonb_build_object('command', 'no', 'outcome', case when v_action.id is null then 'nothing_to_cancel' else 'cancelled' end,
      'business_id', v_action.business_id, 'user_id', v_action.user_id,
      'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body',
        case when v_action.id is null then 'No había nada para cancelar.' else 'Cancelado: no se pidió la factura de ' || v_action.order_code || '.' end)));
  end if;

  -- Todo lo demás necesita un vínculo válido HOY.
  v_context := private.whatsapp_context(p_phone);
  if v_context->>'status' in ('unlinked', 'inactive') then
    -- A un número sin vínculo se le contesta una vez cada 10 minutos: no es un canal abierto.
    if exists (select 1 from public.whatsapp_inbound_messages m
                where m.phone_e164 = p_phone and m.wa_message_id <> p_message_id
                  and m.outcome in ('unlinked', 'inactive') and m.received_at > now() - interval '10 minutes') then
      return jsonb_build_object('command', null, 'outcome', (v_context->>'status') || '_silent', 'replies', '[]'::jsonb);
    end if;
    return jsonb_build_object('command', null, 'outcome', v_context->>'status',
      'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body', case v_context->>'status'
        when 'inactive' then 'Tu usuario ya no está activo en el negocio vinculado. Si es un error, pedile al dueño que te habilite de nuevo.'
        else 'Este WhatsApp no está vinculado a ningún negocio. Pedí un código en el Panel y mandá: vincular CÓDIGO' end)));
  end if;

  if v_text in ('ayuda', 'menu', 'hola', 'comandos') then
    return jsonb_build_object('command', 'ayuda', 'outcome', 'help', 'business_id', v_context->'business_id', 'user_id', v_context->'user_id',
      'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body', private.whatsapp_help_text())));
  end if;

  v_match := regexp_match(v_text, '^negocio( [a-z0-9-]{1,40})?$');
  if v_match is not null then
    select coalesce(jsonb_agg(jsonb_build_object('business_id', l.business_id, 'business_name', b.name) order by b.name, b.id), '[]'::jsonb)
      into v_reasons
      from public.whatsapp_links l join public.businesses b on b.id = l.business_id
     where l.phone_e164 = p_phone and l.revoked_at is null and private.whatsapp_link_valid(l.id);
    if v_match[1] is null then
      return jsonb_build_object('command', 'negocio', 'outcome', 'business_list',
        'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body',
          'Tus negocios:' || E'\n' || (select string_agg(n || ') ' || (x->>'business_name'), E'\n' order by n)
                                         from jsonb_array_elements(v_reasons) with ordinality as t(x, n))
          || E'\n' || 'Para elegir: negocio 1')));
    end if;
    v_code := btrim(v_match[1]);
    select x into v_option from jsonb_array_elements(v_reasons) with ordinality as t(x, n)
     where (case when v_code ~ '^[0-9]{1,3}$' then n = v_code::integer else false end)
        or exists (select 1 from public.businesses b where b.id = (x->>'business_id')::uuid and lower(b.slug) = v_code);
    if v_option is null then
      return jsonb_build_object('command', 'negocio', 'outcome', 'business_unknown',
        'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body', 'No tenés ese negocio. Escribí: negocio')));
    end if;
    insert into public.whatsapp_sessions(phone_e164, selected_business_id, selected_at)
    values (p_phone, (v_option->>'business_id')::uuid, now())
    on conflict (phone_e164) do update set selected_business_id = excluded.selected_business_id, selected_at = now(), updated_at = now();
    return jsonb_build_object('command', 'negocio', 'outcome', 'business_selected', 'business_id', v_option->'business_id',
      'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body', 'Listo: ahora hablás por ' || (v_option->>'business_name') || '.')));
  end if;

  if v_context->>'status' = 'choose' then
    return jsonb_build_object('command', null, 'outcome', 'business_choice_required',
      'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body',
        'Este WhatsApp está vinculado a más de un negocio. Elegí uno antes de seguir:' || E'\n'
        || (select string_agg(n || ') ' || (x->>'business_name'), E'\n' order by n)
              from jsonb_array_elements(v_context->'options') with ordinality as t(x, n))
        || E'\n' || 'Respondé: negocio 1')));
  end if;

  v_business := (v_context->>'business_id')::uuid;
  v_user := (v_context->>'user_id')::uuid;
  v_link := (v_context->>'link_id')::uuid;
  if coalesce((v_context->>'multiple')::boolean, false) then
    v_prefix := '[' || (v_context->>'business_name') || '] ';
  end if;
  update public.whatsapp_links set last_used_at = now() where id = v_link;

  if v_text = 'estado' then
    return jsonb_build_object('command', 'estado', 'outcome', 'business_status', 'business_id', v_business, 'user_id', v_user,
      'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body', v_prefix || private.whatsapp_business_status_text(v_business))));
  end if;
  if v_text = 'ventas hoy' then
    return jsonb_build_object('command', 'ventas_hoy', 'outcome', 'sales_today', 'business_id', v_business, 'user_id', v_user,
      'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body', v_prefix || private.whatsapp_sales_today_text(v_business))));
  end if;
  if v_text = 'pendientes' then
    return jsonb_build_object('command', 'pendientes', 'outcome', 'pending_list', 'business_id', v_business, 'user_id', v_user,
      'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body', v_prefix || private.whatsapp_pending_text(v_business))));
  end if;

  v_match := regexp_match(v_text, '^estado ([a-z0-9-]{2,40})$');
  if v_match is not null then
    v_code := upper(v_match[1]);
    v_order := private.whatsapp_find_order(v_business, v_code);
    if v_order is null then
      return jsonb_build_object('command', 'estado_pedido', 'outcome', 'order_not_found', 'business_id', v_business, 'user_id', v_user,
        'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body', v_prefix || 'No encontré el pedido ' || v_code || '.')));
    end if;
    v_state := private.order_fiscal_states(v_business, array[v_order])->0;
    v_replies := jsonb_build_array(jsonb_build_object('kind', 'text', 'body',
      v_prefix || private.whatsapp_state_text(v_code, v_state, private.whatsapp_print_agent(v_business))));
    -- El PDF vigente, por el id del ARTEFACTO (no el del comprobante).
    if v_state->'document'->>'state' in ('authorized', 'credited') and v_state->'document'->>'artifact_id' is not null then
      v_replies := v_replies || jsonb_build_object('kind', 'document', 'artifact_id', v_state->'document'->>'artifact_id',
        'body', 'Comprobante del pedido ' || v_code
          || case when v_state->'document'->>'environment' = 'production' then '' else ' (HOMOLOGACIÓN · sin validez fiscal)' end);
    end if;
    return jsonb_build_object('command', 'estado_pedido', 'outcome', 'order_status', 'business_id', v_business, 'user_id', v_user, 'replies', v_replies);
  end if;

  v_match := regexp_match(v_text, '^facturar ([a-z0-9-]{2,40})( e imprimir)?$');
  if v_match is not null then
    v_code := upper(v_match[1]);
    v_order := private.whatsapp_find_order(v_business, v_code);
    if v_order is null then
      return jsonb_build_object('command', 'facturar', 'outcome', 'order_not_found', 'business_id', v_business, 'user_id', v_user,
        'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body', v_prefix || 'No encontré el pedido ' || v_code || '.')));
    end if;
    v_state := private.order_fiscal_states(v_business, array[v_order])->0;
    if v_state->'document' is not null and jsonb_typeof(v_state->'document') = 'object' then
      return jsonb_build_object('command', 'facturar', 'outcome', 'already_requested', 'business_id', v_business, 'user_id', v_user,
        'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body',
          v_prefix || 'Ese pedido ya tiene la factura pedida.' || E'\n' || private.whatsapp_state_text(v_code, v_state, private.whatsapp_print_agent(v_business)))));
    end if;
    if v_state->'readiness'->>'status' <> 'READY' then
      return jsonb_build_object('command', 'facturar', 'outcome', 'order_not_ready', 'business_id', v_business, 'user_id', v_user,
        'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body',
          v_prefix || private.whatsapp_state_text(v_code, v_state, private.whatsapp_print_agent(v_business)))));
    end if;
    select o.* into v_order_row from public.orders o where o.id = v_order;
    select fp.environment into v_environment from public.fiscal_profiles fp where fp.business_id = v_business;
    -- Una sola confirmación abierta por teléfono: la anterior queda reemplazada.
    update public.whatsapp_pending_actions set closed_at = now(), closed_reason = 'superseded', closed_by_message_id = p_message_id
     where phone_e164 = p_phone and closed_at is null;
    insert into public.whatsapp_pending_actions(business_id, user_id, link_id, phone_e164, action, order_id, order_code, order_total, source_message_id, expires_at)
    values (v_business, v_user, v_link, p_phone, case when v_match[2] is null then 'invoice' else 'invoice_and_print' end,
            v_order, v_code, v_order_row.total, p_message_id, now() + interval '5 minutes');
    return jsonb_build_object('command', 'facturar', 'outcome', 'confirmation_requested', 'business_id', v_business, 'user_id', v_user,
      'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body',
        v_prefix || 'Vas a pedir la factura del pedido ' || v_code || ' (' || coalesce(nullif(btrim(v_order_row.customer_name), ''), 'sin nombre')
        || ', ' || private.whatsapp_money(v_order_row.total) || ')'
        || case when coalesce(v_environment, '') = 'production' then '' else ' — HOMOLOGACIÓN, sin validez fiscal' end
        || case when v_match[2] is null then '' else ', y se imprime al autorizarse' end || '.'
        || E'\n' || 'Respondé SI para confirmar o NO para cancelar. Vence en 5 minutos.')));
  end if;

  return jsonb_build_object('command', null, 'outcome', 'unknown_command', 'business_id', v_business, 'user_id', v_user,
    'replies', jsonb_build_array(jsonb_build_object('kind', 'text', 'body', v_prefix || 'No entendí. Escribí: ayuda')));
end;
$whatsapp_process$;

-- ---- entradas de servidor (la Edge Function whatsapp-webhook, con service_role) -------------
create or replace function public.whatsapp_handle_inbound(
  p_message_id text,
  p_phone text,
  p_phone_number_id text,
  p_message_type text,
  p_text text,
  p_message_timestamp timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $whatsapp_handle_inbound$
declare
  v_inserted integer;
  v_result jsonb;
  v_reply jsonb;
  v_sequence integer := 0;
  v_out jsonb := '[]'::jsonb;
  v_id uuid;
begin
  if coalesce(public.identity_jwt_claims() ->> 'role', '') <> 'service_role' then
    raise exception 'canal de servidor no autorizado' using errcode = '42501';
  end if;
  if coalesce(p_message_id, '') !~ '^[A-Za-z0-9._:=+/-]+$' or char_length(p_message_id) > 256 or coalesce(p_phone, '') !~ '^[1-9][0-9]{7,14}$'
     or coalesce(p_message_type, '') !~ '^[a-z_]{1,32}$' or char_length(coalesce(p_text, '')) > 4096 then
    raise exception 'mensaje de WhatsApp invalido' using errcode = '22023';
  end if;
  -- Dedup ATÓMICO: la primera entrega inserta; las demás (Meta reintenta) no hacen nada.
  insert into public.whatsapp_inbound_messages(wa_message_id, phone_e164, phone_number_id, message_type, message_timestamp, outcome)
  values (p_message_id, p_phone, nullif(p_phone_number_id, ''), p_message_type, p_message_timestamp, 'processing')
  on conflict (wa_message_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('duplicate', true, 'replies', '[]'::jsonb);
  end if;

  v_result := private.whatsapp_process(p_message_id, p_phone, p_message_type, p_text);
  update public.whatsapp_inbound_messages
     set command = v_result->>'command', outcome = coalesce(v_result->>'outcome', 'processed'),
         business_id = nullif(v_result->>'business_id', '')::uuid, user_id = nullif(v_result->>'user_id', '')::uuid
   where wa_message_id = p_message_id;
  for v_reply in select x from jsonb_array_elements(coalesce(v_result->'replies', '[]'::jsonb)) x loop
    v_sequence := v_sequence + 1;
    insert into public.whatsapp_outbound_messages(inbound_message_id, sequence, phone_e164, kind, body, artifact_id)
    values (p_message_id, v_sequence, p_phone, v_reply->>'kind', left(v_reply->>'body', 4096), nullif(v_reply->>'artifact_id', '')::uuid)
    returning id into v_id;
    v_out := v_out || jsonb_build_object('id', v_id, 'kind', v_reply->>'kind', 'body', left(v_reply->>'body', 4096),
      'artifact_id', v_reply->'artifact_id', 'to', p_phone);
  end loop;
  return jsonb_build_object('duplicate', false, 'outcome', v_result->>'outcome', 'replies', v_out);
end;
$whatsapp_handle_inbound$;

create or replace function public.whatsapp_mark_outbound(p_outbound_id uuid, p_status text, p_provider_message_id text default null, p_error text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $whatsapp_mark_outbound$
begin
  if coalesce(public.identity_jwt_claims() ->> 'role', '') <> 'service_role' then
    raise exception 'canal de servidor no autorizado' using errcode = '42501';
  end if;
  if p_status not in ('sent', 'failed') then raise exception 'estado invalido' using errcode = '22023'; end if;
  update public.whatsapp_outbound_messages
     set status = case when status = 'sent' then 'sent' else p_status end,
         attempts = attempts + 1,
         provider_message_id = coalesce(provider_message_id, left(p_provider_message_id, 128)),
         last_error = case when p_status = 'failed' then left(p_error, 200) else last_error end,
         sent_at = case when p_status = 'sent' then coalesce(sent_at, now()) else sent_at end
   where id = p_outbound_id;
end;
$whatsapp_mark_outbound$;

-- Para mandar el PDF: la ruta privada del artefacto vigente, solo si es del negocio que habló.
create or replace function public.whatsapp_outbound_artifact(p_outbound_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $whatsapp_outbound_artifact$
declare
  v_row record;
begin
  if coalesce(public.identity_jwt_claims() ->> 'role', '') <> 'service_role' then
    raise exception 'canal de servidor no autorizado' using errcode = '42501';
  end if;
  select a.storage_path, a.mime_type, a.document_number, d.point_of_sale, d.document_type into v_row
    from public.whatsapp_outbound_messages m
    join public.whatsapp_inbound_messages i on i.wa_message_id = m.inbound_message_id
    join public.fiscal_document_artifacts a on a.id = m.artifact_id
    join public.fiscal_documents d on d.id = a.fiscal_document_id
   where m.id = p_outbound_id and m.kind = 'document' and a.business_id = i.business_id
     and a.is_current and a.state = 'artifact_ready';
  if not found then raise exception 'comprobante no disponible' using errcode = 'P0002'; end if;
  return jsonb_build_object('bucket', 'fiscal-documents', 'storage_path', v_row.storage_path, 'mime_type', v_row.mime_type,
    'filename', 'comprobante-' || lpad(v_row.point_of_sale::text, 5, '0') || '-' || lpad(v_row.document_number::text, 8, '0') || '.pdf');
end;
$whatsapp_outbound_artifact$;

-- Respuestas que no salieron (Graph API caído): la función las reintenta en el próximo mensaje.
create or replace function public.whatsapp_pending_outbound(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $whatsapp_pending_outbound$
begin
  if coalesce(public.identity_jwt_claims() ->> 'role', '') <> 'service_role' then
    raise exception 'canal de servidor no autorizado' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'body', m.body, 'artifact_id', m.artifact_id, 'to', m.phone_e164)
                     order by m.created_at, m.sequence)
      from (select * from public.whatsapp_outbound_messages
             where status = 'pending' and attempts < 5 and created_at < now() - interval '30 seconds'
               and created_at > now() - interval '24 hours'
             order by created_at, sequence limit least(greatest(coalesce(p_limit, 10), 1), 50)) m), '[]'::jsonb);
end;
$whatsapp_pending_outbound$;

-- ---- el Panel: vincular, ver y revocar -----------------------------------------------------
create or replace function public.create_whatsapp_pairing(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $create_whatsapp_pairing$
declare
  v_user uuid := auth.uid();
  v_selector text;
  v_secret text;
  v_id uuid;
  v_expires timestamptz := now() + interval '10 minutes';
  v_attempt integer;
begin
  if v_user is null or not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if (select count(*) from public.whatsapp_pairings p where p.user_id = v_user and p.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'demasiados codigos pedidos; probar en una hora' using errcode = '54000';
  end if;
  -- Un código abierto por usuario y negocio; los vencidos liberan su selector.
  update public.whatsapp_pairings set revoked_at = now()
   where consumed_at is null and revoked_at is null
     and ((business_id = p_business_id and user_id = v_user) or expires_at <= now());
  for v_attempt in 1 .. 5 loop
    v_selector := private.whatsapp_random_code(4);
    v_secret := private.whatsapp_random_code(8);
    insert into public.whatsapp_pairings(business_id, user_id, selector, code_hash, expires_at)
    values (p_business_id, v_user, v_selector, private.whatsapp_sha256(v_secret), v_expires)
    on conflict (selector) where consumed_at is null and revoked_at is null do nothing
    returning id into v_id;
    exit when v_id is not null;
  end loop;
  if v_id is null then raise exception 'no se pudo generar el codigo' using errcode = '55000'; end if;
  return jsonb_build_object('pairing_id', v_id, 'expires_at', v_expires,
    'code', v_selector || '-' || left(v_secret, 4) || '-' || right(v_secret, 4),
    'message', 'vincular ' || v_selector || '-' || left(v_secret, 4) || '-' || right(v_secret, 4));
end;
$create_whatsapp_pairing$;

create or replace function public.list_whatsapp_links(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $list_whatsapp_links$
declare
  v_role text := public.identity_member_role(p_business_id);
begin
  if v_role is null or v_role not in ('owner', 'admin', 'staff') then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'user_id', l.user_id, 'is_own', l.user_id = auth.uid(),
             -- El número completo no vuelve a la pantalla: alcanza para reconocerlo.
             'phone_hint', '+' || left(l.phone_e164, 2) || ' ••• ' || right(l.phone_e164, 4),
             'created_at', l.created_at, 'last_used_at', l.last_used_at, 'active', private.whatsapp_link_valid(l.id))
             order by l.created_at desc)
      from public.whatsapp_links l
     where l.business_id = p_business_id and l.revoked_at is null
       and (v_role in ('owner', 'admin') or l.user_id = auth.uid())), '[]'::jsonb);
end;
$list_whatsapp_links$;

create or replace function public.revoke_whatsapp_link(p_link_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $revoke_whatsapp_link$
declare
  v_link public.whatsapp_links%rowtype;
  v_role text;
begin
  select l.* into v_link from public.whatsapp_links l where l.id = p_link_id for update;
  if not found then raise exception 'vinculo inexistente' using errcode = 'P0002'; end if;
  v_role := public.identity_member_role(v_link.business_id);
  if v_role is null or not (v_role in ('owner', 'admin') or (v_role = 'staff' and v_link.user_id = auth.uid())) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if v_link.revoked_at is not null then
    return jsonb_build_object('link_id', v_link.id, 'revoked_at', v_link.revoked_at, 'idempotent_replay', true);
  end if;
  update public.whatsapp_links set revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = coalesce(nullif(left(btrim(coalesce(p_reason, '')), 200), ''), 'revocado desde el Panel')
   where id = v_link.id;
  update public.whatsapp_pending_actions set closed_at = now(), closed_reason = 'cancelled'
   where link_id = v_link.id and closed_at is null;
  return jsonb_build_object('link_id', v_link.id, 'revoked_at', now(), 'idempotent_replay', false);
end;
$revoke_whatsapp_link$;

-- ---- permisos ------------------------------------------------------------------------------
revoke all on function private.whatsapp_sha256(text) from public;
revoke all on function private.whatsapp_random_code(integer) from public;
revoke all on function private.whatsapp_money(numeric) from public;
revoke all on function private.whatsapp_link_valid(uuid) from public;
revoke all on function private.order_fiscal_states(uuid, uuid[]) from public;
revoke all on function private.whatsapp_reason_text(jsonb) from public;
revoke all on function private.whatsapp_reasons_text(jsonb) from public;
revoke all on function private.whatsapp_print_agent(uuid) from public;
revoke all on function private.whatsapp_state_text(text, jsonb, text) from public;
revoke all on function private.whatsapp_find_order(uuid, text) from public;
revoke all on function private.whatsapp_context(text) from public;
revoke all on function private.whatsapp_redeem(text, text) from public;
revoke all on function private.whatsapp_pairing_failure(text) from public;
revoke all on function private.whatsapp_help_text() from public;
revoke all on function private.whatsapp_business_status_text(uuid) from public;
revoke all on function private.whatsapp_sales_today_text(uuid) from public;
revoke all on function private.whatsapp_pending_text(uuid) from public;
revoke all on function private.whatsapp_process(text, text, text, text) from public;

revoke all on function public.get_order_fiscal_states(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.get_order_fiscal_states(uuid, uuid[]) to authenticated;
revoke all on function public.whatsapp_handle_inbound(text, text, text, text, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.whatsapp_handle_inbound(text, text, text, text, text, timestamptz) to service_role;
revoke all on function public.whatsapp_mark_outbound(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.whatsapp_mark_outbound(uuid, text, text, text) to service_role;
revoke all on function public.whatsapp_outbound_artifact(uuid) from public, anon, authenticated, service_role;
grant execute on function public.whatsapp_outbound_artifact(uuid) to service_role;
revoke all on function public.whatsapp_pending_outbound(integer) from public, anon, authenticated, service_role;
grant execute on function public.whatsapp_pending_outbound(integer) to service_role;
revoke all on function public.create_whatsapp_pairing(uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_whatsapp_pairing(uuid) to authenticated;
revoke all on function public.list_whatsapp_links(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_whatsapp_links(uuid) to authenticated;
revoke all on function public.revoke_whatsapp_link(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.revoke_whatsapp_link(uuid, text) to authenticated;
