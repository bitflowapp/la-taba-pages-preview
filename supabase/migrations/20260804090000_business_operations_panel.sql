-- Panel de negocio operable sin consola: estado saneado de Mercado Pago y ARCA,
-- autorización explícita de homologación, apertura del día y alta de productos escaneados.
-- Ninguna función devuelve secretos: ni Access Token, ni clave privada, ni ticket de acceso, ni XML.

-- ===== Salud de credenciales fiscales publicada por el puente =====

alter table public.fiscal_profiles add column if not exists certificate_fingerprint_sha256 text;
alter table public.fiscal_profiles add column if not exists certificate_expires_at timestamptz;
alter table public.fiscal_profiles add column if not exists certificate_subject_cuit text;
alter table public.fiscal_profiles add column if not exists credential_checked_at timestamptz;
alter table public.fiscal_profiles add column if not exists delegation_status text not null default 'pending';
alter table public.fiscal_profiles add column if not exists delegation_verified_at timestamptz;
alter table public.fiscal_profiles add column if not exists connection_ok_at timestamptz;
alter table public.fiscal_profiles add column if not exists artifact_verified_at timestamptz;
alter table public.fiscal_profiles add column if not exists print_verified_at timestamptz;
alter table public.fiscal_profiles add column if not exists homologation_authorized_at timestamptz;
alter table public.fiscal_profiles add column if not exists homologation_authorized_by uuid references auth.users(id) on delete restrict;
alter table public.fiscal_profiles add column if not exists last_error_code text;
alter table public.fiscal_profiles add column if not exists last_error_at timestamptz;

alter table public.fiscal_profiles drop constraint if exists fiscal_profiles_delegation_status_check;
alter table public.fiscal_profiles add constraint fiscal_profiles_delegation_status_check
  check (delegation_status in ('pending', 'verified', 'rejected'));

alter table public.fiscal_profiles drop constraint if exists fiscal_profiles_certificate_fingerprint_check;
alter table public.fiscal_profiles add constraint fiscal_profiles_certificate_fingerprint_check
  check (certificate_fingerprint_sha256 is null or certificate_fingerprint_sha256 ~ '^[a-f0-9]{64}$');

alter table public.fiscal_profiles drop constraint if exists fiscal_profiles_last_error_code_check;
alter table public.fiscal_profiles add constraint fiscal_profiles_last_error_code_check
  check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{2,63}$');

alter table public.fiscal_profiles drop constraint if exists fiscal_profiles_certificate_subject_cuit_check;
alter table public.fiscal_profiles add constraint fiscal_profiles_certificate_subject_cuit_check
  check (certificate_subject_cuit is null or certificate_subject_cuit ~ '^[0-9]{11}$');

-- Las pruebas con ARCA sólo se habilitan con una autorización explícita registrada.
alter table public.fiscal_profiles drop constraint if exists fiscal_profiles_homologation_gate;
alter table public.fiscal_profiles add constraint fiscal_profiles_homologation_gate check (
  environment <> 'homologation'
  or (homologation_authorized_at is not null and homologation_authorized_by is not null)
);

comment on column public.fiscal_profiles.certificate_fingerprint_sha256 is
  'Huella pública del certificado. La clave privada nunca sale del puente fiscal.';
comment on column public.fiscal_profiles.last_error_code is
  'Código saneado del último problema con ARCA. Nunca contiene XML ni mensajes del proveedor.';

-- El puente fiscal publica la salud de las credenciales. No devuelve nada al panel.
create or replace function public.record_fiscal_credential_health(
  p_business_id uuid,
  p_certificate_fingerprint text,
  p_certificate_expires_at timestamptz,
  p_certificate_subject_cuit text,
  p_delegation_status text,
  p_connection_ok boolean,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $record_fiscal_credential_health$
begin
  if p_certificate_fingerprint is not null and p_certificate_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'huella de certificado invalida' using errcode = '22023';
  end if;
  if p_certificate_subject_cuit is not null and p_certificate_subject_cuit !~ '^[0-9]{11}$' then
    raise exception 'cuit de certificado invalido' using errcode = '22023';
  end if;
  if p_delegation_status is not null and p_delegation_status not in ('pending', 'verified', 'rejected') then
    raise exception 'estado de delegacion invalido' using errcode = '22023';
  end if;
  -- Se acepta únicamente un código saneado; cualquier texto libre del proveedor se descarta.
  if p_error_code is not null and p_error_code !~ '^[A-Z][A-Z0-9_]{2,63}$' then
    raise exception 'codigo de error no saneado' using errcode = '22023';
  end if;

  update public.fiscal_profiles set
    certificate_fingerprint_sha256 = coalesce(p_certificate_fingerprint, certificate_fingerprint_sha256),
    certificate_expires_at = coalesce(p_certificate_expires_at, certificate_expires_at),
    certificate_subject_cuit = coalesce(p_certificate_subject_cuit, certificate_subject_cuit),
    delegation_status = coalesce(p_delegation_status, delegation_status),
    delegation_verified_at = case
      when coalesce(p_delegation_status, delegation_status) = 'verified' then clock_timestamp()
      else delegation_verified_at
    end,
    connection_ok_at = case when p_connection_ok then clock_timestamp() else connection_ok_at end,
    credential_checked_at = clock_timestamp(),
    last_error_code = p_error_code,
    last_error_at = case when p_error_code is null then last_error_at else clock_timestamp() end,
    updated_at = now()
  where business_id = p_business_id;
end;
$record_fiscal_credential_health$;

-- Estado de ARCA para el panel. Sólo hechos verificables y ya saneados.
create or replace function public.get_arca_activation_status(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $get_arca_activation_status$
declare
  v_profile public.fiscal_profiles%rowtype;
  v_last_document record;
  v_result jsonb;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;

  select * into v_profile from public.fiscal_profiles where business_id = p_business_id;

  select fd.document_type, fd.document_number, fd.point_of_sale, fd.state, fd.created_at
    into v_last_document
    from public.fiscal_documents fd
   where fd.business_id = p_business_id
   order by fd.created_at desc
   limit 1;

  v_result := jsonb_build_object(
    'generated_at', clock_timestamp(),
    'legal_name', v_profile.legal_name,
    'cuit', v_profile.cuit,
    'cuit_valid', coalesce(v_profile.cuit ~ '^[0-9]{11}$', false),
    'tax_condition', v_profile.tax_condition,
    'business_address', v_profile.business_address,
    'accountant_review_status', coalesce(v_profile.accountant_review_status, 'pending'),
    'environment', coalesce(v_profile.environment, 'disabled'),
    'point_of_sale', v_profile.point_of_sale,
    'certificate_loaded', v_profile.certificate_fingerprint_sha256 is not null,
    'certificate_expires_at', v_profile.certificate_expires_at,
    'certificate_cuit_mismatch', coalesce(
      v_profile.certificate_subject_cuit is not null
      and v_profile.cuit is not null
      and v_profile.certificate_subject_cuit <> v_profile.cuit,
      false
    ),
    'delegation_status', coalesce(v_profile.delegation_status, 'pending'),
    'connection_ok_at', v_profile.connection_ok_at,
    'artifact_verified_at', v_profile.artifact_verified_at,
    'print_verified_at', v_profile.print_verified_at,
    'homologation_authorized_at', v_profile.homologation_authorized_at,
    'homologated_invoices', (
      select count(*) from public.fiscal_documents fd
       where fd.business_id = p_business_id and fd.environment = 'homologation'
         and fd.document_intent = 'invoice' and fd.state in ('authorized', 'credited')
    ),
    'homologated_credit_notes', (
      select count(*) from public.fiscal_documents fd
       where fd.business_id = p_business_id and fd.environment = 'homologation'
         and fd.document_intent = 'credit_note' and fd.state = 'authorized'
    ),
    'pending_documents', (
      select count(*) from public.fiscal_documents fd
       where fd.business_id = p_business_id
         and fd.state in ('draft', 'queued', 'claiming', 'authenticating', 'authorizing', 'retry_wait')
    ),
    'stalled_documents', (
      select count(*) from public.fiscal_outbox fo
       join public.fiscal_documents fd on fd.id = fo.fiscal_document_id
       where fd.business_id = p_business_id
         and (fo.state = 'dead_letter'
              or (fo.state in ('pending', 'retry_wait') and fo.next_attempt_at < clock_timestamp() - interval '15 minutes'))
    ),
    'last_document_label', case
      when v_last_document.document_number is null then null
      else concat_ws(' ', v_last_document.document_type, v_last_document.point_of_sale::text, v_last_document.document_number::text)
    end,
    'last_document_at', v_last_document.created_at,
    'last_document_failed', coalesce(v_last_document.state in ('failed', 'ambiguous'), false),
    'last_error_code', v_profile.last_error_code,
    'last_error_at', v_profile.last_error_at
  );
  return v_result;
end;
$get_arca_activation_status$;

-- Habilitar las pruebas con ARCA exige la frase exacta y deja rastro de quién autorizó.
create or replace function public.authorize_arca_homologation(
  p_business_id uuid,
  p_authorization text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $authorize_arca_homologation$
declare
  v_profile public.fiscal_profiles%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'autorizacion fiscal requiere owner o admin' using errcode = '42501';
  end if;
  if p_authorization is distinct from 'I_AUTHORIZE_ARCA_HOMOLOGATION' then
    raise exception 'autorizacion de homologacion ausente' using errcode = '22023';
  end if;

  select * into v_profile from public.fiscal_profiles where business_id = p_business_id for update;
  if not found then
    raise exception 'perfil fiscal inexistente' using errcode = 'P0002';
  end if;
  if v_profile.accountant_review_status <> 'approved' then
    raise exception 'falta la aprobacion contable' using errcode = 'P0001';
  end if;
  if coalesce(v_profile.cuit, '') !~ '^[0-9]{11}$'
     or coalesce(v_profile.point_of_sale, 0) < 1
     or coalesce(btrim(v_profile.legal_name), '') = ''
     or coalesce(btrim(v_profile.tax_condition), '') = '' then
    raise exception 'faltan datos fiscales obligatorios' using errcode = '22023';
  end if;
  if v_profile.certificate_fingerprint_sha256 is null then
    raise exception 'falta el certificado' using errcode = 'P0001';
  end if;
  if v_profile.certificate_expires_at is not null and v_profile.certificate_expires_at <= clock_timestamp() then
    raise exception 'certificado vencido' using errcode = 'P0001';
  end if;

  update public.fiscal_profiles set
    environment = 'homologation',
    is_enabled = true,
    homologation_authorized_at = clock_timestamp(),
    homologation_authorized_by = auth.uid(),
    updated_at = now()
  where business_id = p_business_id
  returning * into v_profile;

  insert into public.fiscal_events (business_id, fiscal_document_id, event_type, detail)
  values (p_business_id, null, 'homologation_authorized', jsonb_build_object('actor', auth.uid()));

  return jsonb_build_object('ok', true, 'environment', v_profile.environment);
end;
$authorize_arca_homologation$;

-- El panel confirma que el PDF con QR se abrió y que una impresión salió. No lo asume.
create or replace function public.record_fiscal_verification(
  p_business_id uuid,
  p_verification text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $record_fiscal_verification$
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'verificacion fiscal requiere owner o admin' using errcode = '42501';
  end if;
  if p_verification not in ('artifact', 'print') then
    raise exception 'verificacion desconocida' using errcode = '22023';
  end if;

  update public.fiscal_profiles set
    artifact_verified_at = case when p_verification = 'artifact' then clock_timestamp() else artifact_verified_at end,
    print_verified_at = case when p_verification = 'print' then clock_timestamp() else print_verified_at end,
    updated_at = now()
  where business_id = p_business_id;

  return jsonb_build_object('ok', true, 'verification', p_verification);
end;
$record_fiscal_verification$;

-- ===== Mercado Pago: estado saneado y ajustes no secretos =====

create or replace function public.get_mercadopago_activation_status(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $get_mercadopago_activation_status$
declare
  v_settings public.business_payment_settings%rowtype;
  v_business public.businesses%rowtype;
  v_signed_at timestamptz;
  v_test_payment record;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'estado de cobros no autorizado' using errcode = '42501';
  end if;

  select * into v_business from public.businesses where id = p_business_id;
  select * into v_settings from public.business_payment_settings
   where business_id = p_business_id and provider = 'mercadopago';

  select max(r.received_at) into v_signed_at
    from public.payment_webhook_receipts r
    join public.payment_events e on e.webhook_receipt_id = r.id
    join public.payment_intents pi on pi.id = e.payment_intent_id
   where pi.business_id = p_business_id and r.signature_valid;

  select pi.approved_at, pi.order_id,
         exists (
           select 1 from public.inventory_reservations ir
            join public.checkout_sessions cs on cs.id = ir.checkout_session_id
           where cs.business_id = p_business_id and ir.checkout_session_id = pi.checkout_session_id
         ) as stock_applied
    into v_test_payment
    from public.payment_intents pi
   where pi.business_id = p_business_id
     and pi.internal_status in ('approved', 'completed')
   order by pi.approved_at desc nulls last
   limit 1;

  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'settings_present', v_settings.id is not null,
    'enabled', coalesce(v_settings.enabled, false),
    'environment', coalesce(v_settings.environment, 'test'),
    'currency', coalesce(v_settings.currency, 'ARS'),
    'reserve_stock', coalesce(v_settings.reserve_stock, false),
    'installments_limit', v_settings.installments_limit,
    'preference_expiration_minutes', v_settings.preference_expiration_minutes,
    'refund_policy', v_settings.refund_policy,
    'production_review_status', coalesce(v_settings.production_review_status, 'not_requested'),
    'collector_configured', nullif(btrim(coalesce(v_settings.collector_id, '')), '') is not null,
    'application_configured', nullif(btrim(coalesce(v_settings.application_id, '')), '') is not null,
    -- Sólo los últimos dígitos: alcanzan para reconocer la cuenta y no exponen el identificador completo.
    'collector_id_short', right(coalesce(v_settings.collector_id, ''), 4),
    'application_id_short', right(coalesce(v_settings.application_id, ''), 4),
    'configured_at', v_settings.configured_at,
    'verified_at', v_settings.verified_at,
    -- El servidor tiene credenciales cuando pudo firmar y recibir al menos una preferencia.
    'credentials_loaded', exists (
      select 1 from public.payment_intents pi
       where pi.business_id = p_business_id
         and pi.internal_status not in ('created', 'preference_creating')
    ),
    'signed_notice_at', v_signed_at,
    'rejected_notices_recent', (
      select count(*) from public.payment_webhook_receipts r
       where r.processing_status = 'rejected_signature'
         and r.received_at > clock_timestamp() - interval '24 hours'
         and r.resource_id in (
           select pi.provider_payment_id from public.payment_intents pi
            where pi.business_id = p_business_id and pi.provider_payment_id is not null
         )
    ),
    'test_payment_at', v_test_payment.approved_at,
    'test_payment_order_created', coalesce(v_test_payment.order_id is not null, false),
    'test_payment_stock_applied', coalesce(v_test_payment.stock_applied, false),
    'storefront_ready', coalesce(
      v_business.is_active and v_business.status = 'open'
      and v_business.ordering_enabled and v_business.ordering_verified,
      false
    )
  );
end;
$get_mercadopago_activation_status$;

-- Ajustes operativos de cobro. El Access Token nunca pasa por acá: sólo vive en el servidor de pagos.
create or replace function public.configure_mercadopago_settings(
  p_business_id uuid,
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $configure_mercadopago_settings$
declare
  v_settings public.business_payment_settings%rowtype;
  v_allowed text[] := array['collector_id', 'application_id', 'installments_limit', 'preference_expiration_minutes', 'reserve_stock', 'enabled'];
  v_collector text;
  v_application text;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'configuracion de cobros requiere owner o admin' using errcode = '42501';
  end if;
  -- Cualquier clave fuera de la lista se rechaza: impide que un secreto entre por esta puerta.
  if coalesce(p_settings, '{}'::jsonb) - v_allowed <> '{}'::jsonb then
    raise exception 'payload no permitido' using errcode = '22023';
  end if;

  v_collector := nullif(btrim(coalesce(p_settings->>'collector_id', '')), '');
  v_application := nullif(btrim(coalesce(p_settings->>'application_id', '')), '');
  if v_collector is not null and v_collector !~ '^[0-9]{6,32}$' then
    raise exception 'identificador de vendedor invalido' using errcode = '22023';
  end if;
  if v_application is not null and v_application !~ '^[0-9]{6,32}$' then
    raise exception 'identificador de aplicacion invalido' using errcode = '22023';
  end if;

  insert into public.business_payment_settings (
    business_id, provider, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at
  )
  values (
    p_business_id, 'mercadopago', 'test', 'checkout_pro', 'ARS', true,
    v_collector, v_application, clock_timestamp()
  )
  on conflict (business_id, provider) do nothing;

  select * into v_settings from public.business_payment_settings
   where business_id = p_business_id and provider = 'mercadopago' for update;

  -- El panel opera únicamente el ambiente de prueba; el pase a dinero real es una decisión aparte.
  if v_settings.environment <> 'test' then
    raise exception 'el panel no configura cobros con dinero real' using errcode = '42501';
  end if;

  update public.business_payment_settings set
    collector_id = coalesce(v_collector, collector_id),
    application_id = coalesce(v_application, application_id),
    installments_limit = case
      when p_settings ? 'installments_limit' then nullif(p_settings->>'installments_limit', '')::integer
      else installments_limit
    end,
    preference_expiration_minutes = case
      when p_settings ? 'preference_expiration_minutes' then (p_settings->>'preference_expiration_minutes')::integer
      else preference_expiration_minutes
    end,
    reserve_stock = case
      when p_settings ? 'reserve_stock' then (p_settings->>'reserve_stock')::boolean
      else reserve_stock
    end,
    enabled = case
      when p_settings ? 'enabled' then (p_settings->>'enabled')::boolean
      else enabled
    end,
    configured_at = coalesce(configured_at, clock_timestamp()),
    updated_at = clock_timestamp()
  where id = v_settings.id
  returning * into v_settings;

  return jsonb_build_object('ok', true, 'enabled', v_settings.enabled, 'environment', v_settings.environment);
end;
$configure_mercadopago_settings$;

-- ===== Abrir el negocio =====

create or replace function public.get_business_opening_status(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $get_business_opening_status$
declare
  v_business public.businesses%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_profile public.fiscal_profiles%rowtype;
  v_stalled integer;
  v_riders integer;
  v_open_orders integer;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;

  select * into v_business from public.businesses where id = p_business_id;
  if not found then
    raise exception 'negocio inexistente' using errcode = 'P0002';
  end if;
  select * into v_settings from public.business_payment_settings
   where business_id = p_business_id and provider = 'mercadopago';
  select * into v_profile from public.fiscal_profiles where business_id = p_business_id;

  select
    (select count(*) from public.payment_outbox po
      join public.payment_intents pi on pi.id = po.payment_intent_id
     where pi.business_id = p_business_id and po.status in ('failed', 'dead_letter'))
    + (select count(*) from public.fiscal_outbox fo
        join public.fiscal_documents fd on fd.id = fo.fiscal_document_id
       where fd.business_id = p_business_id and fo.state = 'dead_letter')
    into v_stalled;

  select count(*) into v_riders from public.riders r
   where r.business_id = p_business_id and r.status = 'available';

  select count(*) into v_open_orders from public.orders o
   where o.business_id = p_business_id
     and o.status not in ('delivered', 'canceled', 'cancelled', 'rejected');

  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'business_status', v_business.status,
    'backend', jsonb_build_object('status', 'ok', 'detail', 'El sistema del negocio respondió.'),
    'payments', jsonb_build_object(
      'status', case
        when coalesce(v_settings.enabled, false)
          and v_business.ordering_enabled and v_business.ordering_verified then 'ok'
        when v_settings.id is null then 'failed'
        else 'degraded'
      end,
      'detail', case
        when v_settings.id is null then 'Los cobros por la web todavía no están configurados.'
        when not coalesce(v_settings.enabled, false) then 'Los cobros por la web están apagados.'
        when not (v_business.ordering_enabled and v_business.ordering_verified) then 'La web todavía no acepta pedidos.'
        else 'Los cobros por la web están activos.'
      end
    ),
    'fiscal', jsonb_build_object(
      'status', case
        when coalesce(v_profile.is_enabled, false) and coalesce(v_profile.environment, 'disabled') <> 'disabled' then 'ok'
        when v_profile.business_id is null then 'failed'
        else 'degraded'
      end,
      'detail', case
        when v_profile.business_id is null then 'Todavía no se cargaron los datos de facturación.'
        when not coalesce(v_profile.is_enabled, false) then 'La facturación está apagada.'
        else 'La facturación está activa.'
      end
    ),
    'riders', jsonb_build_object(
      'status', case when v_riders > 0 then 'ok' else 'degraded' end,
      'detail', case
        when v_riders > 0 then v_riders || ' repartidor(es) disponible(s).'
        else 'No hay repartidores disponibles ahora.'
      end
    ),
    'queues', jsonb_build_object(
      'status', case when v_stalled > 0 then 'degraded' else 'ok' end,
      'detail', case
        when v_stalled > 0 then v_stalled || ' cosa(s) quedaron esperando de antes.'
        else 'No quedó nada trabado de antes.'
      end
    ),
    'open_orders', v_open_orders
  );
end;
$get_business_opening_status$;

create or replace function public.set_business_open_state(
  p_business_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $set_business_open_state$
declare
  v_business public.businesses%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if p_status not in ('open', 'paused', 'closed') then
    raise exception 'estado de negocio invalido' using errcode = '22023';
  end if;

  update public.businesses set status = p_status, updated_at = now()
   where id = p_business_id
  returning * into v_business;
  if not found then
    raise exception 'negocio inexistente' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'status', v_business.status);
end;
$set_business_open_state$;

-- ===== Alta de producto escaneado =====

alter table public.products add column if not exists unit_cost numeric(12, 2);
alter table public.products drop constraint if exists products_unit_cost_check;
alter table public.products add constraint products_unit_cost_check
  check (unit_cost is null or unit_cost >= 0);

create table if not exists public.scanned_product_audit (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  draft_id uuid references public.catalog_product_drafts(id) on delete set null,
  gtin text not null,
  action text not null check (action in ('completed', 'price_confirmed', 'published', 'unpublished')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists scanned_product_audit_business_idx
  on public.scanned_product_audit (business_id, created_at desc);

-- Completa un producto creado por escaneo. Nunca inventa datos ni lo publica solo.
create or replace function public.complete_scanned_product(
  p_product_id uuid,
  p_details jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $complete_scanned_product$
declare
  v_product public.products%rowtype;
  v_allowed text[] := array['name', 'brand', 'category', 'variant', 'capacity_value', 'capacity_unit', 'units_per_pack', 'price', 'price_pending', 'unit_cost', 'stock'];
  v_price numeric(12, 2);
  v_price_pending boolean;
  v_stock integer;
  v_units integer;
  v_capacity_value numeric;
  v_capacity_unit text;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'producto inexistente' using errcode = 'P0002';
  end if;
  if not public.has_business_role(v_product.business_id, array['owner', 'admin']) then
    raise exception 'completar el producto requiere owner o admin' using errcode = '42501';
  end if;
  if coalesce(p_details, '{}'::jsonb) - v_allowed <> '{}'::jsonb then
    raise exception 'payload no permitido' using errcode = '22023';
  end if;

  v_price_pending := coalesce((p_details->>'price_pending')::boolean, false);
  v_price := case when v_price_pending then 0 else round(coalesce((p_details->>'price')::numeric, -1), 2) end;
  v_stock := coalesce((p_details->>'stock')::integer, -1);
  v_units := coalesce((p_details->>'units_per_pack')::integer, 0);
  v_capacity_value := coalesce((p_details->>'capacity_value')::numeric, 0);
  v_capacity_unit := btrim(coalesce(p_details->>'capacity_unit', ''));

  if char_length(btrim(coalesce(p_details->>'name', ''))) not between 2 and 160
     or char_length(btrim(coalesce(p_details->>'brand', ''))) not between 2 and 80
     or char_length(btrim(coalesce(p_details->>'category', ''))) not between 2 and 80
     or char_length(btrim(coalesce(p_details->>'variant', ''))) not between 1 and 80 then
    raise exception 'faltan datos obligatorios del producto' using errcode = '22023';
  end if;
  if v_capacity_value <= 0 or v_capacity_unit not in ('ml', 'l', 'g', 'kg', 'unidad') then
    raise exception 'presentacion invalida' using errcode = '22023';
  end if;
  if v_units < 1 then
    raise exception 'unidades por pack invalidas' using errcode = '22023';
  end if;
  if v_stock < 0 then
    raise exception 'stock invalido' using errcode = '22023';
  end if;
  if not v_price_pending and v_price <= 0 then
    raise exception 'precio invalido' using errcode = '22023';
  end if;

  update public.products set
    name = btrim(p_details->>'name'),
    brand = btrim(p_details->>'brand'),
    category = btrim(p_details->>'category'),
    variant = btrim(p_details->>'variant'),
    presentation = btrim(p_details->>'variant'),
    capacity_value = v_capacity_value,
    capacity_unit = v_capacity_unit,
    capacity = v_capacity_value::text || ' ' || v_capacity_unit,
    units_per_pack = v_units,
    price = v_price,
    price_status = case when v_price_pending then 'pending' else 'confirmed' end,
    unit_cost = nullif(p_details->>'unit_cost', '')::numeric,
    stock = v_stock,
    -- Disponible sólo cuando hay precio confirmado, stock y verificación de catálogo.
    available = (not v_price_pending) and v_stock > 0 and is_verified,
    updated_at = now()
  where id = v_product.id
  returning * into v_product;

  insert into public.scanned_product_audit (business_id, product_id, gtin, action, actor_id, detail)
  values (
    v_product.business_id,
    v_product.id,
    coalesce((select pb.gtin from public.product_barcodes pb where pb.product_id = v_product.id and pb.is_primary limit 1), ''),
    case when v_price_pending then 'completed' else 'price_confirmed' end,
    auth.uid(),
    jsonb_build_object('price_status', v_product.price_status, 'stock', v_product.stock)
  );

  return public.get_scanned_product_readiness(v_product.id);
end;
$complete_scanned_product$;

-- Dice exactamente qué falta para que el producto aparezca y se pueda comprar.
create or replace function public.get_scanned_product_readiness(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $get_scanned_product_readiness$
declare
  v_product public.products%rowtype;
  v_barcode boolean;
  v_image boolean;
  v_details boolean;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'producto inexistente' using errcode = 'P0002';
  end if;
  if not public.has_business_role(v_product.business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;

  v_barcode := exists (
    select 1 from public.product_barcodes pb
     where pb.product_id = v_product.id and pb.is_active
  );
  v_image := v_product.catalog_asset_id is not null
    and nullif(btrim(coalesce(v_product.image_url, '')), '') is not null;
  v_details := nullif(btrim(coalesce(v_product.brand, '')), '') is not null
    and nullif(btrim(coalesce(v_product.variant, '')), '') is not null
    and coalesce(v_product.capacity_value, 0) > 0
    and coalesce(v_product.units_per_pack, 0) > 0;

  return jsonb_build_object(
    'product_id', v_product.id,
    'details_complete', v_details,
    'barcode_bound', v_barcode,
    'image_bound', v_image,
    'price_status', v_product.price_status,
    'stock_positive', coalesce(v_product.stock, 0) > 0,
    'published', coalesce(v_product.is_verified, false),
    'visible', v_details and v_barcode and v_image and coalesce(v_product.is_verified, false),
    'purchasable', coalesce(v_product.available, false)
      and v_product.price_status = 'confirmed'
      and coalesce(v_product.stock, 0) > 0
  );
end;
$get_scanned_product_readiness$;

-- ===== RLS y privilegios mínimos =====

alter table public.scanned_product_audit enable row level security;
revoke all privileges on table public.scanned_product_audit from public, anon, authenticated;
grant select on table public.scanned_product_audit to authenticated;

drop policy if exists "business reads scanned product audit" on public.scanned_product_audit;
create policy "business reads scanned product audit" on public.scanned_product_audit
for select to authenticated using (public.is_business_member(business_id));

revoke execute on function public.record_fiscal_credential_health(uuid, text, timestamptz, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.record_fiscal_credential_health(uuid, text, timestamptz, text, text, boolean, text) to service_role;

revoke execute on function public.get_arca_activation_status(uuid) from public, anon;
revoke execute on function public.authorize_arca_homologation(uuid, text) from public, anon;
revoke execute on function public.record_fiscal_verification(uuid, text) from public, anon;
revoke execute on function public.get_mercadopago_activation_status(uuid) from public, anon;
revoke execute on function public.configure_mercadopago_settings(uuid, jsonb) from public, anon;
revoke execute on function public.get_business_opening_status(uuid) from public, anon;
revoke execute on function public.set_business_open_state(uuid, text) from public, anon;
revoke execute on function public.complete_scanned_product(uuid, jsonb) from public, anon;
revoke execute on function public.get_scanned_product_readiness(uuid) from public, anon;

grant execute on function public.get_arca_activation_status(uuid) to authenticated;
grant execute on function public.authorize_arca_homologation(uuid, text) to authenticated;
grant execute on function public.record_fiscal_verification(uuid, text) to authenticated;
grant execute on function public.get_mercadopago_activation_status(uuid) to authenticated;
grant execute on function public.configure_mercadopago_settings(uuid, jsonb) to authenticated;
grant execute on function public.get_business_opening_status(uuid) to authenticated;
grant execute on function public.set_business_open_state(uuid, text) to authenticated;
grant execute on function public.complete_scanned_product(uuid, jsonb) to authenticated;
grant execute on function public.get_scanned_product_readiness(uuid) to authenticated;

comment on function public.get_mercadopago_activation_status(uuid) is
  'Estado de activación de cobros para el panel. Devuelve sólo los últimos dígitos de los identificadores y ningún secreto.';
comment on function public.configure_mercadopago_settings(uuid, jsonb) is
  'Ajustes operativos de cobro para owner/admin. Rechaza cualquier clave fuera de la lista permitida y no admite dinero real.';
comment on function public.authorize_arca_homologation(uuid, text) is
  'Habilita las pruebas con ARCA sólo con la frase exacta I_AUTHORIZE_ARCA_HOMOLOGATION y deja registrado quién autorizó.';
comment on function public.complete_scanned_product(uuid, jsonb) is
  'Completa un producto creado por escaneo. Un precio pendiente lo deja visible pero no comprable.';
