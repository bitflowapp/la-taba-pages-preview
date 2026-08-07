-- Facturación ARCA: de PARCIAL/NO OPERATIVA a circuito real.
--
-- Esta migración corta los tres cortes de contrato documentados en
-- BUSINESS-PANEL-HARDENING.md §4 y cablea el circuito objetivo:
--   pedido pagado -> intención fiscal idempotente -> configuración validada ->
--   outbox -> WSAA/WSFEv1 -> CAE o rechazo -> persistencia -> Panel.
--
-- Principio que ordena todo el archivo: NINGUNA decisión fiscal se infiere.
-- Condición frente al IVA, alícuota, tipo de comprobante, punto de venta y
-- tratamiento del envío los declara una persona en una política contable
-- aprobada, y cada identificador se valida contra las tablas oficiales que el
-- puente sincroniza desde ARCA. Si algo no está declarado, el circuito se
-- detiene y pide revisión: nunca adivina.

-- ===== 1. La política contable declara lo que antes no tenía dónde vivir =====
-- Faltaban cuatro datos sin los cuales no se puede armar un FECAESolicitar
-- correcto: la condición frente al IVA del receptor (CondicionIVAReceptorId,
-- que el WSDL vigente de WSFEv1 publica), si el IVA se discrimina, con qué
-- alícuota, y si los precios del catálogo ya la incluyen.

alter table public.fiscal_accounting_policies
  add column if not exists recipient_vat_condition_id integer,
  add column if not exists vat_computation text not null default 'discriminated',
  add column if not exists vat_rate_id integer,
  add column if not exists vat_rate_percent numeric(6,3),
  add column if not exists prices_include_vat boolean not null default true,
  add column if not exists delivery_vat_rate_id integer,
  add column if not exists delivery_vat_rate_percent numeric(6,3),
  add column if not exists authorized_sources text[] not null default array['pos_sale']::text[],
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid;

alter table public.fiscal_accounting_policies drop constraint if exists fiscal_accounting_policy_vat_computation_check;
alter table public.fiscal_accounting_policies add constraint fiscal_accounting_policy_vat_computation_check
  check (vat_computation in ('discriminated','not_discriminated'));

-- Discriminar IVA exige alícuota declarada; no discriminarlo exige que no haya
-- ninguna, para que nadie "recuerde" una alícuota que el comprobante no lleva.
alter table public.fiscal_accounting_policies drop constraint if exists fiscal_accounting_policy_vat_rate_pairing;
alter table public.fiscal_accounting_policies add constraint fiscal_accounting_policy_vat_rate_pairing check (
  (vat_computation = 'discriminated' and vat_rate_id is not null and vat_rate_percent is not null
     and vat_rate_percent >= 0 and vat_rate_percent <= 100)
  or (vat_computation = 'not_discriminated' and vat_rate_id is null and vat_rate_percent is null)
);

alter table public.fiscal_accounting_policies drop constraint if exists fiscal_accounting_policy_delivery_rate_pairing;
alter table public.fiscal_accounting_policies add constraint fiscal_accounting_policy_delivery_rate_pairing check (
  (delivery_vat_rate_id is null and delivery_vat_rate_percent is null)
  or (delivery_vat_rate_id is not null and delivery_vat_rate_percent is not null
      and delivery_vat_rate_percent >= 0 and delivery_vat_rate_percent <= 100
      and vat_computation = 'discriminated')
);

alter table public.fiscal_accounting_policies drop constraint if exists fiscal_accounting_policy_sources_check;
alter table public.fiscal_accounting_policies add constraint fiscal_accounting_policy_sources_check check (
  authorized_sources <@ array['pos_sale','online_order']::text[]
  and array_length(authorized_sources, 1) >= 1
);

-- Una política habilitada sin condición IVA del receptor no puede facturar:
-- el campo es parte del contrato vigente de WSFEv1.
alter table public.fiscal_accounting_policies drop constraint if exists fiscal_accounting_policy_receptor_condition_check;
alter table public.fiscal_accounting_policies add constraint fiscal_accounting_policy_receptor_condition_check check (
  not enabled or (recipient_vat_condition_id is not null and recipient_vat_condition_id > 0)
);

comment on column public.fiscal_accounting_policies.recipient_vat_condition_id is
  'CondicionIVAReceptorId de WSFEv1. Lo declara el titular o su contador y se valida contra FEParamGetCondicionIvaReceptor.';
comment on column public.fiscal_accounting_policies.vat_computation is
  'discriminated: el comprobante lleva ImpNeto/ImpIVA y detalle Iva. not_discriminated: ImpNeto = ImpTotal e ImpIVA = 0 (comprobantes clase C).';
comment on column public.fiscal_accounting_policies.prices_include_vat is
  'true: el precio del catálogo ya contiene el IVA y se desagrega. false: el IVA se suma al precio.';
comment on column public.fiscal_accounting_policies.delivery_vat_rate_percent is
  'Tratamiento declarado del envío. Sin declarar, un pedido con envío pide revisión en vez de suponer una alícuota.';

alter table public.fiscal_documents
  add column if not exists recipient_vat_condition_id integer;

comment on column public.fiscal_documents.recipient_vat_condition_id is
  'CondicionIVAReceptorId enviado a ARCA, congelado desde la política vigente al momento de la solicitud.';

-- Un comprobante que requiere intervención humana deja de disfrazarse de
-- "failed" genérico: tiene su propio estado y la UI lo traduce a "requiere atención".
alter table public.fiscal_documents drop constraint if exists fiscal_documents_state_check;
alter table public.fiscal_documents add constraint fiscal_documents_state_check check (
  state in ('draft','queued','claiming','authenticating','authorizing','authorized','observed',
            'rejected','ambiguous','retry_wait','failed','manual_review','credited')
);

-- La tabla oficial de condiciones IVA del receptor se guarda como cualquier otro
-- parámetro: con ambiente, versión y fecha. No se hardcodea ningún valor.
create or replace function public.save_fiscal_parameter_snapshot(
  p_environment text,
  p_parameter_type text,
  p_version text,
  p_values_json jsonb,
  p_synchronized_at timestamptz
)
returns public.fiscal_parameter_snapshots
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $save_fiscal_parameters_v2$
declare v_snapshot public.fiscal_parameter_snapshots%rowtype;
begin
  if p_environment not in ('homologation','production')
    or p_parameter_type not in ('document_types','recipient_document_types','vat_types','currencies','concepts','points_of_sale','vat_receptor_conditions')
    or char_length(coalesce(p_version,'')) not between 1 and 128
    or p_values_json is null
    or p_synchronized_at is null
    or p_synchronized_at > now() + interval '5 minutes'
  then raise exception 'snapshot de parametros fiscales invalido' using errcode='22023'; end if;
  insert into public.fiscal_parameter_snapshots(environment,parameter_type,version,values_json,synchronized_at)
  values(p_environment,p_parameter_type,left(p_version,128),p_values_json,p_synchronized_at)
  on conflict(environment,parameter_type,version) do update
    set synchronized_at=greatest(public.fiscal_parameter_snapshots.synchronized_at,excluded.synchronized_at)
  returning * into v_snapshot;
  return v_snapshot;
end;
$save_fiscal_parameters_v2$;

-- ===== 2. Alta y aprobación de políticas contables (corte 2) =====
-- Antes no existía ninguna vía: ni RPC, ni UI, ni seed. Sin política aprobada
-- request_fiscal_document lanzaba siempre y nunca se emitía nada.

alter table public.fiscal_profile_events drop constraint if exists fiscal_profile_events_event_type_check;
alter table public.fiscal_profile_events add constraint fiscal_profile_events_event_type_check check (
  event_type in ('homologation_authorized','accountant_review_recorded',
                 'accounting_policy_proposed','accounting_policy_approved','accounting_policy_revoked')
);

-- CUARTO CORTE, no registrado en BUSINESS-PANEL-HARDENING §4:
-- authorize_arca_homologation exige fiscal_profiles.accountant_review_status =
-- 'approved' (M4090:134) y NINGUNA función, UI o seed podía escribir ese valor.
-- Con certificado, parámetros y política, el botón seguía siendo inalcanzable.
-- La revisión es una decisión del titular o su contador: se registra con frase
-- explícita, actor y fecha, y nunca se deduce de haber guardado un formulario.
create or replace function public.record_fiscal_accountant_review(
  p_business_id uuid,
  p_decision text,
  p_authorization text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $record_fiscal_accountant_review$
declare v_profile public.fiscal_profiles%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner','admin']) then
    raise exception 'revision contable requiere owner o admin' using errcode='42501';
  end if;
  if p_decision not in ('approved','rejected','pending') then
    raise exception 'decision contable invalida' using errcode='22023';
  end if;
  if char_length(coalesce(p_notes,'')) > 1000 then
    raise exception 'nota de revision demasiado larga' using errcode='22023';
  end if;
  if p_decision = 'approved' and p_authorization is distinct from 'I_CONFIRM_THE_FISCAL_DATA_WERE_REVIEWED' then
    raise exception 'confirmacion de revision contable ausente' using errcode='22023';
  end if;
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = p_business_id for update;
  if not found then raise exception 'perfil fiscal inexistente' using errcode='P0002'; end if;

  if p_decision = 'approved' and (
    coalesce(v_profile.cuit,'') !~ '^[0-9]{11}$'
    or coalesce(v_profile.point_of_sale,0) not between 1 and 99999
    or btrim(coalesce(v_profile.legal_name,'')) = ''
    or btrim(coalesce(v_profile.tax_condition,'')) = ''
    or btrim(coalesce(v_profile.default_recipient_condition,'')) = ''
    or v_profile.default_concept is null
  ) then
    raise exception 'faltan datos fiscales obligatorios' using errcode='22023';
  end if;

  update public.fiscal_profiles set
    accountant_review_status = p_decision,
    verified_at = case when p_decision = 'approved' then clock_timestamp() else null end,
    verified_by = case when p_decision = 'approved' then auth.uid() else null end,
    updated_at = now()
  where business_id = p_business_id
  returning * into v_profile;

  insert into public.fiscal_profile_events(business_id, event_type, actor_id, detail)
  values (p_business_id, 'accountant_review_recorded', auth.uid(), jsonb_build_object(
    'decision', p_decision, 'environment', v_profile.environment
  ));
  return jsonb_build_object('ok', true, 'accountant_review_status', v_profile.accountant_review_status);
end;
$record_fiscal_accountant_review$;

create or replace function public.fiscal_parameter_id_is_current(
  p_environment text,
  p_parameter_type text,
  p_id integer
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $fiscal_parameter_id_is_current$
  select p_id is not null and public.fiscal_has_current_parameter_id(p_environment, p_parameter_type, p_id);
$fiscal_parameter_id_is_current$;

create or replace function public.upsert_fiscal_accounting_policy(
  p_business_id uuid,
  p_policy jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $upsert_fiscal_accounting_policy$
declare
  v_policy public.fiscal_accounting_policies%rowtype;
  v_sources text[];
  v_environment text;
  v_vat_computation text;
begin
  if not public.has_business_role(p_business_id, array['owner','admin']) then
    raise exception 'owner/admin requerido para declarar politica fiscal' using errcode='42501';
  end if;
  if coalesce(p_policy,'{}'::jsonb) - array[
      'environment','policy_version','valid_from','issuer_condition','recipient_condition','concept',
      'invoice_type','credit_note_type','recipient_document_type','recipient_document_number',
      'recipient_vat_condition_id','vat_computation','vat_rate_id','vat_rate_percent',
      'prices_include_vat','delivery_vat_rate_id','delivery_vat_rate_percent',
      'authorized_sources','allow_commercial_adjustment','notes'] <> '{}'::jsonb then
    raise exception 'payload de politica fiscal no permitido' using errcode='22023';
  end if;

  v_environment := coalesce(p_policy->>'environment','');
  v_vat_computation := coalesce(nullif(btrim(p_policy->>'vat_computation'),''),'discriminated');
  -- La política de producción no se declara desde el panel: producción tiene su
  -- propia puerta y su propio expediente.
  if v_environment <> 'homologation' then
    raise exception 'solo se declara politica de homologacion desde el panel' using errcode='42501';
  end if;
  if v_vat_computation not in ('discriminated','not_discriminated') then
    raise exception 'vat_computation invalido' using errcode='22023';
  end if;
  if coalesce(p_policy->>'recipient_document_number','') !~ '^[0-9]{1,20}$'
    or char_length(btrim(coalesce(p_policy->>'policy_version',''))) not between 1 and 80
    or char_length(btrim(coalesce(p_policy->>'issuer_condition',''))) not between 1 and 80
    or char_length(btrim(coalesce(p_policy->>'recipient_condition',''))) not between 1 and 80
    or char_length(coalesce(p_policy->>'notes','')) > 1000
  then raise exception 'datos de politica fiscal invalidos' using errcode='22023'; end if;

  select coalesce(array_agg(distinct value::text), array['pos_sale']::text[])
    into v_sources
  from jsonb_array_elements_text(
    case when jsonb_typeof(p_policy->'authorized_sources') = 'array'
      then p_policy->'authorized_sources' else '["pos_sale"]'::jsonb end
  ) as t(value);
  if not (v_sources <@ array['pos_sale','online_order']::text[]) then
    raise exception 'origen de facturacion no soportado' using errcode='22023';
  end if;

  insert into public.fiscal_accounting_policies(
    business_id, environment, policy_version, valid_from, issuer_condition, recipient_condition,
    concept, invoice_type, credit_note_type, recipient_document_type, recipient_document_number,
    recipient_vat_condition_id, vat_computation, vat_rate_id, vat_rate_percent, prices_include_vat,
    delivery_vat_rate_id, delivery_vat_rate_percent, authorized_sources,
    allow_commercial_adjustment, enabled, accountant_review_status, notes, updated_at
  ) values (
    p_business_id, v_environment, btrim(p_policy->>'policy_version'),
    coalesce((p_policy->>'valid_from')::date, current_date),
    btrim(p_policy->>'issuer_condition'), btrim(p_policy->>'recipient_condition'),
    (p_policy->>'concept')::integer, (p_policy->>'invoice_type')::integer,
    (p_policy->>'credit_note_type')::integer, (p_policy->>'recipient_document_type')::integer,
    p_policy->>'recipient_document_number',
    (p_policy->>'recipient_vat_condition_id')::integer, v_vat_computation,
    (p_policy->>'vat_rate_id')::integer, (p_policy->>'vat_rate_percent')::numeric,
    coalesce((p_policy->>'prices_include_vat')::boolean, true),
    (p_policy->>'delivery_vat_rate_id')::integer, (p_policy->>'delivery_vat_rate_percent')::numeric,
    v_sources, coalesce((p_policy->>'allow_commercial_adjustment')::boolean, false),
    false, 'pending', coalesce(p_policy->>'notes',''), now()
  )
  on conflict (business_id, environment, policy_version, invoice_type, recipient_condition, concept)
  do update set
    valid_from = excluded.valid_from,
    issuer_condition = excluded.issuer_condition,
    credit_note_type = excluded.credit_note_type,
    recipient_document_type = excluded.recipient_document_type,
    recipient_document_number = excluded.recipient_document_number,
    recipient_vat_condition_id = excluded.recipient_vat_condition_id,
    vat_computation = excluded.vat_computation,
    vat_rate_id = excluded.vat_rate_id,
    vat_rate_percent = excluded.vat_rate_percent,
    prices_include_vat = excluded.prices_include_vat,
    delivery_vat_rate_id = excluded.delivery_vat_rate_id,
    delivery_vat_rate_percent = excluded.delivery_vat_rate_percent,
    authorized_sources = excluded.authorized_sources,
    allow_commercial_adjustment = excluded.allow_commercial_adjustment,
    notes = excluded.notes,
    -- Tocar una política aprobada la devuelve a revisión: cambiar un dato fiscal
    -- exige que alguien vuelva a aprobarlo.
    enabled = false,
    accountant_review_status = 'pending',
    approved_by = null,
    approved_at = null,
    revoked_at = null,
    revoked_by = null,
    updated_at = now()
  returning * into v_policy;

  insert into public.fiscal_profile_events(business_id, event_type, actor_id, detail)
  values (p_business_id, 'accounting_policy_proposed', auth.uid(), jsonb_build_object(
    'policy_id', v_policy.id, 'policy_version', v_policy.policy_version, 'environment', v_policy.environment
  ));

  return jsonb_build_object(
    'policy_id', v_policy.id,
    'policy_version', v_policy.policy_version,
    'accountant_review_status', v_policy.accountant_review_status,
    'enabled', v_policy.enabled
  );
end;
$upsert_fiscal_accounting_policy$;

create or replace function public.approve_fiscal_accounting_policy(
  p_policy_id uuid,
  p_authorization text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $approve_fiscal_accounting_policy$
declare
  v_policy public.fiscal_accounting_policies%rowtype;
begin
  select p.* into v_policy from public.fiscal_accounting_policies p where p.id = p_policy_id for update;
  if not found then raise exception 'politica fiscal inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_policy.business_id, array['owner','admin']) then
    raise exception 'owner/admin requerido para aprobar politica fiscal' using errcode='42501';
  end if;
  if p_authorization is distinct from 'I_APPROVE_THIS_FISCAL_ACCOUNTING_POLICY' then
    raise exception 'aprobacion de politica fiscal ausente' using errcode='22023';
  end if;
  if v_policy.environment <> 'homologation' then
    raise exception 'produccion fiscal no se aprueba desde el panel' using errcode='42501';
  end if;
  if v_policy.revoked_at is not null then
    raise exception 'la politica fue revocada; declarar una version nueva' using errcode='P0001';
  end if;

  -- Cada identificador declarado tiene que existir HOY en la tabla oficial que el
  -- puente bajó de ARCA. Sin parámetros sincronizados no se aprueba nada: es la
  -- diferencia entre "el contador escribió 6" y "ARCA reconoce el 6".
  if not public.fiscal_parameter_id_is_current(v_policy.environment, 'document_types', v_policy.invoice_type)
    or not public.fiscal_parameter_id_is_current(v_policy.environment, 'document_types', v_policy.credit_note_type)
    or not public.fiscal_parameter_id_is_current(v_policy.environment, 'recipient_document_types', v_policy.recipient_document_type)
    or not public.fiscal_parameter_id_is_current(v_policy.environment, 'vat_receptor_conditions', v_policy.recipient_vat_condition_id)
  then
    raise exception 'fiscal_parameters_not_synchronized' using errcode='P0001';
  end if;
  if v_policy.vat_computation = 'discriminated'
    and not public.fiscal_parameter_id_is_current(v_policy.environment, 'vat_types', v_policy.vat_rate_id) then
    raise exception 'fiscal_parameters_not_synchronized' using errcode='P0001';
  end if;
  if v_policy.delivery_vat_rate_id is not null
    and not public.fiscal_parameter_id_is_current(v_policy.environment, 'vat_types', v_policy.delivery_vat_rate_id) then
    raise exception 'fiscal_parameters_not_synchronized' using errcode='P0001';
  end if;

  update public.fiscal_accounting_policies set
    accountant_review_status = 'approved',
    approved_by = auth.uid(),
    approved_at = now(),
    enabled = true,
    notes = case when char_length(coalesce(p_notes,'')) between 1 and 1000 then p_notes else notes end,
    updated_at = now()
  where id = v_policy.id
  returning * into v_policy;

  insert into public.fiscal_profile_events(business_id, event_type, actor_id, detail)
  values (v_policy.business_id, 'accounting_policy_approved', auth.uid(), jsonb_build_object(
    'policy_id', v_policy.id, 'policy_version', v_policy.policy_version,
    'invoice_type', v_policy.invoice_type, 'concept', v_policy.concept,
    'recipient_vat_condition_id', v_policy.recipient_vat_condition_id
  ));

  return jsonb_build_object('policy_id', v_policy.id, 'enabled', true, 'accountant_review_status', 'approved');
end;
$approve_fiscal_accounting_policy$;

create or replace function public.revoke_fiscal_accounting_policy(
  p_policy_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $revoke_fiscal_accounting_policy$
declare v_policy public.fiscal_accounting_policies%rowtype;
begin
  if char_length(btrim(coalesce(p_reason,''))) not between 5 and 300 then
    raise exception 'motivo de revocacion invalido' using errcode='22023';
  end if;
  select p.* into v_policy from public.fiscal_accounting_policies p where p.id = p_policy_id for update;
  if not found then raise exception 'politica fiscal inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_policy.business_id, array['owner','admin']) then
    raise exception 'owner/admin requerido para revocar politica fiscal' using errcode='42501';
  end if;
  update public.fiscal_accounting_policies set
    enabled = false, accountant_review_status = 'rejected',
    revoked_at = now(), revoked_by = auth.uid(), updated_at = now()
  where id = v_policy.id returning * into v_policy;
  insert into public.fiscal_profile_events(business_id, event_type, actor_id, detail)
  values (v_policy.business_id, 'accounting_policy_revoked', auth.uid(), jsonb_build_object(
    'policy_id', v_policy.id, 'policy_version', v_policy.policy_version, 'reason', btrim(p_reason)
  ));
  return jsonb_build_object('policy_id', v_policy.id, 'enabled', false);
end;
$revoke_fiscal_accounting_policy$;

create or replace function public.list_fiscal_accounting_policies(p_business_id uuid)
returns table(
  id uuid,
  environment text,
  policy_version text,
  valid_from date,
  issuer_condition text,
  recipient_condition text,
  concept integer,
  invoice_type integer,
  credit_note_type integer,
  recipient_document_type integer,
  recipient_document_number text,
  recipient_vat_condition_id integer,
  vat_computation text,
  vat_rate_id integer,
  vat_rate_percent numeric,
  prices_include_vat boolean,
  delivery_vat_rate_id integer,
  delivery_vat_rate_percent numeric,
  authorized_sources text[],
  allow_commercial_adjustment boolean,
  enabled boolean,
  accountant_review_status text,
  approved_at timestamptz,
  revoked_at timestamptz,
  notes text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $list_fiscal_accounting_policies$
begin
  if not public.has_business_role(p_business_id, array['owner','admin']) then
    raise exception 'owner/admin requerido' using errcode='42501';
  end if;
  return query
  select p.id, p.environment, p.policy_version, p.valid_from, p.issuer_condition, p.recipient_condition,
         p.concept, p.invoice_type, p.credit_note_type, p.recipient_document_type, p.recipient_document_number,
         p.recipient_vat_condition_id, p.vat_computation, p.vat_rate_id, p.vat_rate_percent, p.prices_include_vat,
         p.delivery_vat_rate_id, p.delivery_vat_rate_percent, p.authorized_sources, p.allow_commercial_adjustment,
         p.enabled, p.accountant_review_status, p.approved_at, p.revoked_at, p.notes
  from public.fiscal_accounting_policies p
  where p.business_id = p_business_id
  order by p.valid_from desc, p.created_at desc;
end;
$list_fiscal_accounting_policies$;

-- Resolución única: el perfil dice quién emite, la política dice cómo.
create or replace function public.resolve_active_fiscal_policy(
  p_business_id uuid,
  p_source_type text,
  p_effective_on date default null
)
returns public.fiscal_accounting_policies
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $resolve_active_fiscal_policy$
declare
  v_profile public.fiscal_profiles%rowtype;
  v_policy public.fiscal_accounting_policies%rowtype;
begin
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = p_business_id;
  if not found or not v_profile.is_enabled or v_profile.environment = 'disabled' then
    raise exception 'fiscalizacion deshabilitada' using errcode='P0001';
  end if;
  if btrim(coalesce(v_profile.tax_condition,'')) = ''
    or btrim(coalesce(v_profile.default_recipient_condition,'')) = ''
    or v_profile.default_concept is null then
    raise exception 'fiscal_policy_review_required' using errcode='P0001';
  end if;

  select p.* into v_policy
  from public.fiscal_accounting_policies p
  where p.business_id = p_business_id
    and p.environment = v_profile.environment
    and p.issuer_condition = btrim(v_profile.tax_condition)
    and p.recipient_condition = btrim(v_profile.default_recipient_condition)
    and p.concept = v_profile.default_concept
    and p.enabled
    and p.accountant_review_status = 'approved'
    and p.revoked_at is null
    and p_source_type = any(p.authorized_sources)
    and p.valid_from <= coalesce(p_effective_on, current_date)
  order by p.valid_from desc, p.created_at desc
  limit 1;
  if not found then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;

  -- Se revalida contra las tablas oficiales en cada uso: una política aprobada
  -- con parámetros vencidos no factura.
  if not public.fiscal_parameter_id_is_current(v_policy.environment, 'document_types', v_policy.invoice_type)
    or not public.fiscal_parameter_id_is_current(v_policy.environment, 'document_types', v_policy.credit_note_type)
    or not public.fiscal_parameter_id_is_current(v_policy.environment, 'recipient_document_types', v_policy.recipient_document_type)
    or not public.fiscal_parameter_id_is_current(v_policy.environment, 'vat_receptor_conditions', v_policy.recipient_vat_condition_id)
    or (v_policy.vat_computation = 'discriminated'
        and not public.fiscal_parameter_id_is_current(v_policy.environment, 'vat_types', v_policy.vat_rate_id))
  then
    raise exception 'fiscal_parameters_not_synchronized' using errcode='P0001';
  end if;
  return v_policy;
end;
$resolve_active_fiscal_policy$;

-- Aritmética explícita: nunca redondea "hacia algún lado" ni pierde un centavo.
-- neto + iva es exactamente lo que se cobró cuando el precio ya incluye IVA.
create or replace function public.fiscal_split_amount(
  p_gross numeric,
  p_vat_computation text,
  p_vat_rate_id integer,
  p_vat_rate_percent numeric,
  p_prices_include_vat boolean
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $fiscal_split_amount$
declare
  v_net numeric(14,2);
  v_tax numeric(14,2);
begin
  if p_gross is null or p_gross < 0 then
    raise exception 'importe invalido para desagregar' using errcode='22023';
  end if;
  if p_vat_computation = 'not_discriminated' then
    return jsonb_build_object(
      'net_amount', to_char(round(p_gross,2),'FM9999999999990.00'),
      'tax_amount', '0.00', 'exempt_amount', '0.00', 'non_taxed_amount', '0.00', 'other_taxes_amount', '0.00',
      'total_amount', to_char(round(p_gross,2),'FM9999999999990.00')
    );
  end if;
  if p_prices_include_vat then
    v_net := round(p_gross / (1 + p_vat_rate_percent / 100), 2);
    v_tax := round(p_gross, 2) - v_net;
  else
    v_net := round(p_gross, 2);
    v_tax := round(v_net * p_vat_rate_percent / 100, 2);
  end if;
  return jsonb_build_object(
    'net_amount', to_char(v_net,'FM9999999999990.00'),
    'tax_amount', to_char(v_tax,'FM9999999999990.00'),
    'exempt_amount', '0.00', 'non_taxed_amount', '0.00', 'other_taxes_amount', '0.00',
    'tax_code', p_vat_rate_id::text,
    'vat_rate_percent', to_char(p_vat_rate_percent,'FM990.000'),
    'total_amount', to_char(v_net + v_tax,'FM9999999999990.00')
  );
end;
$fiscal_split_amount$;

-- ===== 3. El mostrador escribe un snapshot impositivo real (corte 1) =====
-- checkout_pos_sale escribía {"configured_by_server": true}. request_fiscal_document
-- exige las cinco claves de importes: toda venta POS rompía en el primer ítem.

create or replace function public.checkout_pos_sale(
  p_business_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_idempotency_key text,
  p_request_fiscal boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $checkout_pos_fiscal$
declare
  v_sale public.pos_sales%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_subtotal numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_policy public.fiscal_accounting_policies%rowtype;
  v_has_policy boolean := false;
  v_split jsonb;
  v_line_gross numeric(12,2);
  v_line_total numeric(12,2);
  v_fiscal_enqueued boolean := false;
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if p_payment_method not in ('cash','debit_card','credit_card','transfer','qr') then raise exception 'medio de pago invalido' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 200 then raise exception 'items invalidos' using errcode = '22023'; end if;
  if (select count(distinct value->>'productId') from jsonb_array_elements(p_items)) <> jsonb_array_length(p_items) then raise exception 'productos duplicados en payload' using errcode='22023'; end if;
  select s.* into v_sale from public.pos_sales s where s.business_id = p_business_id and s.idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('sale_id', v_sale.id, 'state', v_sale.state, 'total', v_sale.total, 'idempotent_replay', true); end if;

  -- La política es opcional para vender: sin ella el mostrador cobra igual y el
  -- comprobante queda explícitamente indisponible. Lo que no puede pasar es
  -- escribir un snapshot que parezca fiscal sin serlo.
  begin
    v_policy := public.resolve_active_fiscal_policy(p_business_id, 'pos_sale', current_date);
    v_has_policy := true;
  exception when others then
    v_has_policy := false;
  end;

  insert into public.pos_sales(business_id, operator_id, state, idempotency_key) values(p_business_id, auth.uid(), 'pricing', p_idempotency_key) returning * into v_sale;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if v_item - array['productId','quantity'] <> '{}'::jsonb then raise exception 'payload de item no permitido' using errcode = '22023'; end if;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity < 1 then raise exception 'cantidad invalida' using errcode = '22023'; end if;
    select p.* into v_product from public.products p where p.id = (v_item->>'productId')::uuid and p.business_id = p_business_id and p.is_active and p.is_verified for update;
    if not found then raise exception 'producto no disponible' using errcode = 'P0002'; end if;
    if coalesce(v_product.stock,0) < v_quantity then raise exception 'stock insuficiente' using errcode = '23514'; end if;
    update public.products set stock = stock - v_quantity where id = v_product.id;

    v_line_gross := v_quantity * v_product.price;
    if v_has_policy then
      v_split := public.fiscal_split_amount(v_line_gross, v_policy.vat_computation, v_policy.vat_rate_id, v_policy.vat_rate_percent, v_policy.prices_include_vat);
      v_split := v_split || jsonb_build_object('policy_version', v_policy.policy_version, 'source', 'fiscal_accounting_policy');
      v_line_total := (v_split->>'total_amount')::numeric;
    else
      v_split := jsonb_build_object('fiscal_pricing','unavailable','reason','fiscal_policy_review_required');
      v_line_total := v_line_gross;
    end if;

    insert into public.pos_sale_items(sale_id, product_id, product_name, quantity, unit_price, tax_snapshot, line_total)
    values(v_sale.id, v_product.id, v_product.name, v_quantity, v_product.price, v_split, v_line_total);
    insert into public.inventory_movements(business_id, product_id, movement_type, quantity_delta, previous_stock, resulting_stock, unit_factor, reference_type, reference_id, operator_id, idempotency_key)
    values(p_business_id, v_product.id, 'sale', -v_quantity, v_product.stock, v_product.stock-v_quantity, 1, 'pos_sale', v_sale.id, auth.uid(), p_idempotency_key || '-' || v_product.id::text);
    v_subtotal := v_subtotal + v_line_gross;
    v_total := v_total + v_line_total;
  end loop;

  insert into public.pos_payments(sale_id, payment_method, amount, status) values(v_sale.id, p_payment_method, v_total, 'confirmed');
  update public.pos_sales set subtotal = v_subtotal, total = v_total, state = 'completed', completed_at = now() where id = v_sale.id returning * into v_sale;

  if coalesce(p_request_fiscal, false) and v_has_policy then
    v_fiscal_enqueued := public.enqueue_fiscal_emission_intent(p_business_id, 'pos_sale', v_sale.id, 'operator');
  end if;

  return jsonb_build_object(
    'sale_id', v_sale.id, 'state', v_sale.state, 'total', v_sale.total,
    'fiscal_requested', coalesce(p_request_fiscal, false),
    'fiscal_enqueued', v_fiscal_enqueued,
    'fiscal_policy_ready', v_has_policy,
    'idempotent_replay', false
  );
end;
$checkout_pos_fiscal$;

-- ===== 4. Intención fiscal idempotente: el pedido pagado dispara el circuito =====
-- Se desacopla a propósito. Facturar nunca puede hacer fracasar una venta ni un
-- pedido: la intención se registra, y el promotor la convierte en comprobante.

create table if not exists public.fiscal_emission_intents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  source_type text not null check (source_type in ('pos_sale','online_order')),
  source_id uuid not null,
  document_intent text not null default 'invoice' check (document_intent = 'invoice'),
  trigger_reason text not null check (char_length(trigger_reason) between 3 and 60),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9:_-]{8,128}$'),
  state text not null default 'pending' check (state in ('pending','processing','promoted','manual_review','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_deadline timestamptz,
  fiscal_document_id uuid references public.fiscal_documents(id) on delete restrict,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id, source_type, source_id, document_intent)
);

create index if not exists fiscal_emission_intents_claim_idx
  on public.fiscal_emission_intents(state, next_attempt_at)
  where state in ('pending','processing');

create index if not exists fiscal_emission_intents_business_idx
  on public.fiscal_emission_intents(business_id, created_at desc);

comment on table public.fiscal_emission_intents is
  'Cola idempotente entre "se cobró" y "se pidió CAE". La unicidad por origen es la primera de las dos defensas contra la doble emisión; la segunda es fiscal_documents_one_invoice_per_source_idx.';

create or replace function public.enqueue_fiscal_emission_intent(
  p_business_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_trigger_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $enqueue_fiscal_emission_intent$
declare
  v_profile public.fiscal_profiles%rowtype;
  v_key text;
  v_rows integer := 0;
begin
  if p_source_type not in ('pos_sale','online_order') or p_source_id is null then return false; end if;
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = p_business_id;
  if not found or not v_profile.is_enabled or v_profile.environment = 'disabled' then return false; end if;

  -- Determinística y estable: el mismo origen produce siempre la misma clave, así
  -- que un reintento, un doble click o dos disparadores distintos convergen.
  v_key := concat('fiscal-', p_source_type, '-', replace(p_source_id::text,'-',''));
  insert into public.fiscal_emission_intents(business_id, source_type, source_id, trigger_reason, idempotency_key)
  values (p_business_id, p_source_type, p_source_id, left(coalesce(nullif(btrim(p_trigger_reason),''),'system'), 60), v_key)
  on conflict (business_id, source_type, source_id, document_intent) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$enqueue_fiscal_emission_intent$;

-- Un pedido nunca se cae por un problema fiscal: el disparador captura todo.
create or replace function public.enqueue_order_fiscal_intent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $enqueue_order_fiscal_intent$
declare
  v_profile public.fiscal_profiles%rowtype;
  v_should boolean := false;
  v_reason text := '';
begin
  begin
    select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = new.business_id;
    if not found or not v_profile.is_enabled or v_profile.environment = 'disabled' then return new; end if;

    if tg_op = 'INSERT' then
      -- finalize_checkout_session sólo crea el pedido con un pago verificado.
      if v_profile.invoice_policy = 'on_payment_confirmed' and new.payment_method = 'mercadopago' then
        v_should := true; v_reason := 'payment_confirmed';
      end if;
    elsif new.status is distinct from old.status then
      if v_profile.invoice_policy = 'on_order_accepted' and new.status = 'accepted' then
        v_should := true; v_reason := 'order_accepted';
      elsif v_profile.invoice_policy = 'on_ready' and new.status = 'ready' then
        v_should := true; v_reason := 'order_ready';
      elsif v_profile.invoice_policy = 'on_delivered' and new.status = 'delivered' then
        v_should := true; v_reason := 'order_delivered';
      elsif v_profile.invoice_policy = 'on_payment_confirmed'
        and new.status = 'delivered' and coalesce(new.payment_method,'') <> 'mercadopago' then
        v_should := true; v_reason := 'cash_collected';
      end if;
    end if;

    if v_should then perform public.enqueue_fiscal_emission_intent(new.business_id, 'online_order', new.id, v_reason); end if;
  exception when others then
    -- Facturar es importante; cobrar y entregar lo es más. El error queda en el
    -- perfil, no en la transacción del pedido.
    begin
      update public.fiscal_profiles
        set last_error_code = 'FISCAL_INTENT_ENQUEUE_FAILED', last_error_at = clock_timestamp()
        where business_id = new.business_id;
    exception when others then null;
    end;
  end;
  return new;
end;
$enqueue_order_fiscal_intent$;

drop trigger if exists orders_enqueue_fiscal_intent_on_insert on public.orders;
create trigger orders_enqueue_fiscal_intent_on_insert
after insert on public.orders
for each row execute function public.enqueue_order_fiscal_intent();

drop trigger if exists orders_enqueue_fiscal_intent_on_status on public.orders;
create trigger orders_enqueue_fiscal_intent_on_status
after update of status on public.orders
for each row execute function public.enqueue_order_fiscal_intent();

-- ===== 5. Núcleo compartido: operador y sistema crean el comprobante igual =====

create or replace function public.internal_create_fiscal_document(
  p_business_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_idempotency_key text,
  p_actor_id uuid,
  p_actor_type text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $internal_create_fiscal_document$
declare
  v_profile public.fiscal_profiles%rowtype;
  v_policy public.fiscal_accounting_policies%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_existing public.fiscal_documents%rowtype;
  v_sale public.pos_sales%rowtype;
  v_order public.orders%rowtype;
  v_item record;
  v_net numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_exempt numeric(14,2) := 0;
  v_non_taxed numeric(14,2) := 0;
  v_other numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_expected_total numeric(14,2);
  v_tax_code integer;
  v_split jsonb;
  v_charged numeric(14,2);
  v_allocated numeric(14,2) := 0;
  v_discount numeric(14,2) := 0;
  v_item_base numeric(14,2) := 0;
  v_index integer := 0;
  v_count integer := 0;
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
begin
  if p_source_type not in ('pos_sale','online_order') or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'intencion fiscal no soportada' using errcode='22023';
  end if;

  select d.* into v_existing from public.fiscal_documents d
    where d.business_id = p_business_id and d.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.source_type <> p_source_type or v_existing.source_id <> p_source_id or v_existing.document_intent <> 'invoice' then
      raise exception 'idempotency_key reutilizada con otra solicitud' using errcode='23505';
    end if;
    return jsonb_build_object('fiscal_document_id', v_existing.id, 'state', v_existing.state, 'idempotent_replay', true);
  end if;
  -- Segunda defensa: aunque cambie la clave, un origen ya facturado no se factura de nuevo.
  select d.* into v_existing from public.fiscal_documents d
    where d.business_id = p_business_id and d.source_type = p_source_type
      and d.source_id = p_source_id and d.document_intent = 'invoice';
  if found then
    return jsonb_build_object('fiscal_document_id', v_existing.id, 'state', v_existing.state, 'idempotent_replay', true);
  end if;

  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = p_business_id for share;
  if not found or not v_profile.is_enabled or v_profile.environment = 'disabled' then
    raise exception 'fiscalizacion deshabilitada' using errcode='P0001';
  end if;
  if v_profile.environment = 'production'
    and (v_profile.accountant_review_status <> 'approved' or v_profile.production_gate_status <> 'approved') then
    raise exception 'produccion fiscal bloqueada' using errcode='42501';
  end if;
  v_policy := public.resolve_active_fiscal_policy(p_business_id, p_source_type, current_date);

  if p_source_type = 'pos_sale' then
    select s.* into v_sale from public.pos_sales s
      where s.id = p_source_id and s.business_id = p_business_id
        and s.state in ('completed_fiscal_pending','completed') for share;
    if not found then raise exception 'venta no confirmada' using errcode='P0002'; end if;
    v_expected_total := v_sale.total;
    for v_item in select i.* from public.pos_sale_items i where i.sale_id = v_sale.id order by i.id
    loop
      -- El snapshot es evidencia, no una promesa: si un ítem no trae los cinco
      -- importes con formato exacto, el comprobante no se arma.
      if not (v_item.tax_snapshot ?& array['net_amount','tax_amount','exempt_amount','non_taxed_amount','other_taxes_amount'])
        or coalesce(v_item.tax_snapshot->>'net_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
        or coalesce(v_item.tax_snapshot->>'tax_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
        or coalesce(v_item.tax_snapshot->>'exempt_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
        or coalesce(v_item.tax_snapshot->>'non_taxed_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
        or coalesce(v_item.tax_snapshot->>'other_taxes_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      then
        raise exception 'fiscal_policy_review_required' using errcode='P0001';
      end if;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'description', v_item.product_name, 'quantity', v_item.quantity,
        'unit_price', v_item.unit_price, 'snapshot', v_item.tax_snapshot
      ));
    end loop;
  else
    select o.* into v_order from public.orders o
      where o.id = p_source_id and o.business_id = p_business_id for share;
    if not found then raise exception 'pedido inexistente' using errcode='P0002'; end if;
    if v_order.status = 'canceled' then raise exception 'pedido cancelado' using errcode='P0001'; end if;
    if coalesce(v_order.total,0) <= 0 then raise exception 'pedido sin importe' using errcode='P0001'; end if;
    -- Un pedido pagado con Mercado Pago sólo se factura contra un pago verificado
    -- por el servidor. La UI no puede afirmarlo.
    if coalesce(v_order.payment_method,'') = 'mercadopago' and not exists (
      select 1 from public.payment_intents pi
      where pi.order_id = v_order.id and pi.provider_status = 'approved'
        and pi.internal_status in ('completed','approved','approved_order_pending')
        and pi.paid_amount = v_order.total
    ) then
      raise exception 'pago del pedido no verificado' using errcode='P0001';
    end if;
    if coalesce(v_order.delivery_fee,0) > 0
      and v_policy.vat_computation = 'discriminated'
      and v_policy.delivery_vat_rate_id is null then
      -- El tratamiento del envío es una decisión fiscal. Sin declararla, se pide
      -- revisión: no se le aplica "la misma alícuota, total da igual".
      raise exception 'fiscal_policy_review_required' using errcode='P0001';
    end if;

    v_expected_total := v_order.total;
    v_discount := coalesce(v_order.discount_total, 0);
    select coalesce(sum(i.subtotal),0), count(*) into v_item_base, v_count
      from public.order_items i where i.order_id = v_order.id;
    if v_count = 0 or v_item_base <= 0 then raise exception 'pedido sin lineas facturables' using errcode='P0001'; end if;
    if v_discount > v_item_base then raise exception 'descuento mayor que las lineas' using errcode='23514'; end if;

    for v_item in select i.* from public.order_items i where i.order_id = v_order.id order by i.id
    loop
      v_index := v_index + 1;
      if v_index = v_count then
        -- La última línea absorbe el resto del prorrateo: la suma cierra al centavo.
        v_charged := round(v_item_base - v_discount, 2) - v_allocated;
      else
        v_charged := round(v_item.subtotal - (v_discount * v_item.subtotal / v_item_base), 2);
        v_allocated := v_allocated + v_charged;
      end if;
      if v_charged < 0 then raise exception 'linea con importe negativo' using errcode='23514'; end if;
      v_split := public.fiscal_split_amount(v_charged, v_policy.vat_computation, v_policy.vat_rate_id, v_policy.vat_rate_percent, v_policy.prices_include_vat);
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'description', v_item.name, 'quantity', v_item.quantity,
        'unit_price', case when v_item.quantity > 0 then round(v_charged / v_item.quantity, 2) else v_charged end,
        'snapshot', v_split || jsonb_build_object('policy_version', v_policy.policy_version, 'charged_amount', to_char(v_charged,'FM9999999999990.00'))
      ));
    end loop;

    if coalesce(v_order.delivery_fee,0) > 0 then
      v_split := public.fiscal_split_amount(
        v_order.delivery_fee, v_policy.vat_computation,
        coalesce(v_policy.delivery_vat_rate_id, v_policy.vat_rate_id),
        coalesce(v_policy.delivery_vat_rate_percent, v_policy.vat_rate_percent),
        v_policy.prices_include_vat);
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'description', 'Envio', 'quantity', 1, 'unit_price', v_order.delivery_fee,
        'snapshot', v_split || jsonb_build_object('policy_version', v_policy.policy_version, 'line_kind', 'delivery_fee')
      ));
    end if;
  end if;

  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    v_net := v_net + ((v_line->'snapshot')->>'net_amount')::numeric;
    v_tax := v_tax + ((v_line->'snapshot')->>'tax_amount')::numeric;
    v_exempt := v_exempt + ((v_line->'snapshot')->>'exempt_amount')::numeric;
    v_non_taxed := v_non_taxed + ((v_line->'snapshot')->>'non_taxed_amount')::numeric;
    v_other := v_other + ((v_line->'snapshot')->>'other_taxes_amount')::numeric;
  end loop;
  v_total := v_net + v_tax + v_exempt + v_non_taxed + v_other;
  if abs(v_total - v_expected_total) > 0.01 then
    raise exception 'snapshot impositivo no coincide con el importe cobrado' using errcode='23514';
  end if;

  insert into public.fiscal_documents(
    business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,concept,currency,currency_rate,
    recipient_type,recipient_document_type,recipient_document_number,recipient_vat_condition_id,
    net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,
    state,idempotency_key,issuer_snapshot,recipient_snapshot,fiscal_policy_version
  ) values (
    p_business_id,p_source_type,p_source_id,'invoice',v_profile.environment,v_profile.cuit,v_profile.point_of_sale,
    v_policy.invoice_type,v_profile.default_concept,v_profile.default_currency,1,
    v_profile.default_recipient_condition,v_policy.recipient_document_type,v_policy.recipient_document_number,
    v_policy.recipient_vat_condition_id,
    v_net,v_tax,v_exempt,v_non_taxed,v_other,v_total,
    'queued',p_idempotency_key,
    jsonb_build_object('legal_name',v_profile.legal_name,'cuit',v_profile.cuit,'tax_condition',v_profile.tax_condition,'address',v_profile.business_address,'gross_income_number',v_profile.gross_income_number),
    jsonb_build_object('condition',v_profile.default_recipient_condition,'document_type',v_policy.recipient_document_type,'document_number',v_policy.recipient_document_number,'vat_condition_id',v_policy.recipient_vat_condition_id),
    v_policy.policy_version
  ) returning * into v_document;

  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    v_tax_code := case when coalesce((v_line->'snapshot')->>'tax_code','') ~ '^[0-9]+$' then ((v_line->'snapshot')->>'tax_code')::integer else null end;
    if ((v_line->'snapshot')->>'tax_amount')::numeric > 0 and v_tax_code is null then
      raise exception 'fiscal_policy_review_required' using errcode='P0001';
    end if;
    insert into public.fiscal_document_items(fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount,tax_code,exempt_amount,non_taxed_amount,other_taxes_amount,tax_snapshot)
    values(v_document.id, left(v_line->>'description',300), (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric,
      ((v_line->'snapshot')->>'net_amount')::numeric, ((v_line->'snapshot')->>'tax_amount')::numeric, v_tax_code,
      ((v_line->'snapshot')->>'exempt_amount')::numeric, ((v_line->'snapshot')->>'non_taxed_amount')::numeric,
      ((v_line->'snapshot')->>'other_taxes_amount')::numeric, v_line->'snapshot');
  end loop;

  if p_source_type = 'pos_sale' then
    update public.pos_sales set fiscal_document_id = v_document.id, state = 'completed_fiscal_pending' where id = v_sale.id;
  end if;
  insert into public.fiscal_outbox(fiscal_document_id) values(v_document.id);
  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,actor_id,sanitized_detail)
  values(v_document.id,'queued',p_actor_type,p_actor_id,jsonb_build_object('source_type',p_source_type,'policy_version',v_policy.policy_version));
  return jsonb_build_object('fiscal_document_id',v_document.id,'state','queued','idempotent_replay',false);
end;
$internal_create_fiscal_document$;

create or replace function public.request_fiscal_document(
  p_business_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_document_intent text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $request_fiscal_document_automation$
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;
  if p_document_intent <> 'invoice' then
    raise exception 'intencion fiscal no soportada' using errcode='22023';
  end if;
  return public.internal_create_fiscal_document(p_business_id, p_source_type, p_source_id, p_idempotency_key, auth.uid(), 'operator');
end;
$request_fiscal_document_automation$;

-- ===== 6. El promotor convierte intenciones en comprobantes, una por una =====

create or replace function public.promote_fiscal_emission_intents(
  p_worker_id text,
  p_limit integer default 5,
  p_lease_seconds integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $promote_fiscal_emission_intents$
declare
  v_intent public.fiscal_emission_intents%rowtype;
  v_result jsonb;
  v_promoted integer := 0;
  v_review integer := 0;
  v_retry integer := 0;
  v_claimed integer := 0;
  v_code text;
  v_message text;
  v_ids uuid[];
  v_id uuid;
begin
  if btrim(coalesce(p_worker_id,'')) !~ '^[A-Za-z0-9._-]{3,80}$'
    or p_limit not between 1 and 50 or p_lease_seconds not between 30 and 300 then
    raise exception 'parametros de promocion invalidos' using errcode='22023';
  end if;

  -- El lease se toma de una sola vez y recién después se procesa: nunca se
  -- actualiza la misma tabla que un cursor abierto está recorriendo.
  with candidates as (
    select i.id from public.fiscal_emission_intents i
    where (i.state = 'pending' and i.next_attempt_at <= now())
       or (i.state = 'processing' and i.lease_deadline < now())
    order by i.next_attempt_at, i.created_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.fiscal_emission_intents i
      set state = 'processing', lease_owner = p_worker_id,
          lease_deadline = now() + make_interval(secs => p_lease_seconds),
          attempt_count = i.attempt_count + 1, updated_at = now()
    from candidates c where i.id = c.id
    returning i.id
  )
  select coalesce(array_agg(claimed.id), array[]::uuid[]) into v_ids from claimed;

  foreach v_id in array v_ids
  loop
    select i.* into v_intent from public.fiscal_emission_intents i where i.id = v_id;
    v_claimed := v_claimed + 1;
    begin
      v_result := public.internal_create_fiscal_document(
        v_intent.business_id, v_intent.source_type, v_intent.source_id,
        v_intent.idempotency_key, null, 'system');
      update public.fiscal_emission_intents set
        state = 'promoted', fiscal_document_id = (v_result->>'fiscal_document_id')::uuid,
        lease_owner = null, lease_deadline = null,
        last_error_code = null, last_error_message = null, updated_at = now()
      where id = v_intent.id;
      v_promoted := v_promoted + 1;
    exception when others then
      get stacked diagnostics v_code = returned_sqlstate, v_message = message_text;
      -- Un problema de configuración no se reintenta a ciegas: va a revisión
      -- humana. Un problema transitorio espera y vuelve.
      if v_message in ('fiscal_policy_review_required','fiscal_parameters_not_synchronized')
        or v_code in ('42501','22023','23505','23514','P0002')
        or v_intent.attempt_count >= 8 then
        update public.fiscal_emission_intents set
          state = 'manual_review', lease_owner = null, lease_deadline = null,
          last_error_code = case
            when v_message = 'fiscal_policy_review_required' then 'FISCAL_POLICY_REVIEW_REQUIRED'
            when v_message = 'fiscal_parameters_not_synchronized' then 'FISCAL_PARAMETERS_NOT_SYNCHRONIZED'
            else 'FISCAL_INTENT_REJECTED' end,
          last_error_message = left(v_message, 300), updated_at = now()
        where id = v_intent.id;
        v_review := v_review + 1;
      else
        update public.fiscal_emission_intents set
          state = 'pending', lease_owner = null, lease_deadline = null,
          next_attempt_at = now() + least(interval '30 minutes', make_interval(secs => 30 * (2 ^ least(v_intent.attempt_count, 6)))),
          last_error_code = 'FISCAL_INTENT_RETRY', last_error_message = left(v_message, 300), updated_at = now()
        where id = v_intent.id;
        v_retry := v_retry + 1;
      end if;
    end;
  end loop;

  return jsonb_build_object('claimed', v_claimed, 'promoted', v_promoted, 'manual_review', v_review, 'retry', v_retry);
end;
$promote_fiscal_emission_intents$;

-- ===== 7. La outbox deja de ser multi-tenant y multi-ambiente =====
-- Un worker de homologación con un certificado de un CUIT no puede reclamar
-- comprobantes de otro CUIT ni de producción.

create or replace function public.claim_fiscal_outbox(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 90,
  p_environment text default null,
  p_cuit text default null
)
returns setof public.fiscal_outbox
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $claim_fiscal_scoped$
begin
  if btrim(coalesce(p_worker_id,'')) !~ '^[A-Za-z0-9._-]{3,80}$'
    or p_limit not between 1 and 50 or p_lease_seconds not between 30 and 300
    or (p_environment is not null and p_environment not in ('homologation','production'))
    or (p_cuit is not null and p_cuit !~ '^[0-9]{11}$')
  then raise exception 'parametros de lease invalidos' using errcode='22023'; end if;
  return query
  with candidates as (
    select o.id from public.fiscal_outbox o
    join public.fiscal_documents d on d.id = o.fiscal_document_id
    where ((o.state in ('pending','retry_wait') and o.next_attempt_at <= now())
        or (o.state='leased' and o.lease_deadline < now()))
      and (p_environment is null or d.environment = p_environment)
      and (p_cuit is null or d.cuit = p_cuit)
    order by o.next_attempt_at, o.created_at
    for update skip locked
    limit p_limit
  )
  update public.fiscal_outbox o
  set state='leased',lease_owner=p_worker_id,lease_deadline=now()+make_interval(secs=>p_lease_seconds),attempt_count=o.attempt_count+1
  from candidates c where o.id=c.id returning o.*;
end;
$claim_fiscal_scoped$;

-- Un lease abandonado por un worker que se murió antes de responder tiene que
-- poder soltarse sin esperar el vencimiento completo.
create or replace function public.release_fiscal_outbox_lease(
  p_outbox_id uuid,
  p_worker_id text,
  p_error_code text default 'WORKER_RELEASED'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $release_fiscal_outbox_lease$
declare v_outbox public.fiscal_outbox%rowtype;
begin
  if coalesce(p_error_code,'') !~ '^[A-Z][A-Z0-9_]{2,63}$' then
    raise exception 'codigo de liberacion invalido' using errcode='22023';
  end if;
  select o.* into v_outbox from public.fiscal_outbox o where o.id = p_outbox_id for update;
  if not found or v_outbox.state <> 'leased' or v_outbox.lease_owner <> p_worker_id then
    raise exception 'lease fiscal invalido' using errcode='40001';
  end if;
  update public.fiscal_outbox set
    state = 'retry_wait', lease_owner = null, lease_deadline = null,
    next_attempt_at = now() + interval '30 seconds', last_error_code = p_error_code
  where id = v_outbox.id;
  return jsonb_build_object('outbox_id', v_outbox.id, 'state', 'retry_wait');
end;
$release_fiscal_outbox_lease$;

-- Cerrar un comprobante ya autorizado sin volver a llamar a ARCA: el worker
-- encontró el documento resuelto y sólo tiene que soltar la cola.
create or replace function public.settle_completed_fiscal_outbox(
  p_outbox_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $settle_completed_fiscal_outbox$
declare
  v_outbox public.fiscal_outbox%rowtype;
  v_document public.fiscal_documents%rowtype;
begin
  select o.* into v_outbox from public.fiscal_outbox o where o.id = p_outbox_id for update;
  if not found or v_outbox.state <> 'leased' or v_outbox.lease_owner <> p_worker_id then
    raise exception 'lease fiscal invalido' using errcode='40001';
  end if;
  select d.* into v_document from public.fiscal_documents d where d.id = v_outbox.fiscal_document_id for share;
  if v_document.state not in ('authorized','credited') then
    raise exception 'el comprobante no esta resuelto' using errcode='P0001';
  end if;
  update public.fiscal_outbox set state='completed', processed_at=now(), lease_owner=null, lease_deadline=null where id=v_outbox.id;
  return jsonb_build_object('outbox_id', v_outbox.id, 'state', 'completed');
end;
$settle_completed_fiscal_outbox$;

-- ===== 8. Cierre del intento: la venta sale de "pendiente" y el estado es honesto =====

create or replace function public.complete_fiscal_attempt(
  p_outbox_id uuid,
  p_worker_id text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $complete_fiscal_attempt_automation$
declare
  v_outbox public.fiscal_outbox%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_class text;
  v_cae text;
  v_terminal boolean := false;
begin
  select o.* into v_outbox from public.fiscal_outbox o where o.id=p_outbox_id for update;
  if not found or v_outbox.state <> 'leased' or v_outbox.lease_owner <> p_worker_id or v_outbox.lease_deadline <= now() then raise exception 'lease fiscal invalido' using errcode='40001'; end if;
  select d.* into v_document from public.fiscal_documents d where d.id=v_outbox.fiscal_document_id for update;
  v_class := p_result->>'classification';
  v_cae := regexp_replace(coalesce(p_result->>'cae',''),'[^0-9]','','g');
  insert into public.fiscal_request_attempts(fiscal_document_id,outbox_id,request_id,operation,result_class,request_hash,response_hash,duration_ms,error_code,error_message)
  values(v_document.id,v_outbox.id,left(coalesce(p_result->>'request_id',gen_random_uuid()::text),128),left(coalesce(p_result->>'operation','FECAESolicitar'),80),v_class,left(p_result->>'request_hash',128),left(p_result->>'response_hash',128),greatest(0,coalesce((p_result->>'duration_ms')::integer,0)),left(p_result->>'error_code',80),left(p_result->>'error_message',300));

  if v_class in ('authorized','authorized_with_observations') then
    if length(v_cae) <> 14 or coalesce((p_result->>'document_number')::bigint,0) < 1 then raise exception 'autorizacion sin CAE o numero valido' using errcode='22023'; end if;
    update public.fiscal_documents set state='authorized',result=v_class,cae=v_cae,cae_expiration=(p_result->>'cae_expiration')::date,document_number=(p_result->>'document_number')::bigint,issue_date=(p_result->>'issue_date')::date,observations=coalesce(p_result->'observations','[]'::jsonb),request_hash=p_result->>'request_hash',response_hash=p_result->>'response_hash',authorized_at=now() where id=v_document.id returning * into v_document;
    if v_document.document_intent='credit_note' then update public.fiscal_credit_allocations set state='authorized' where credit_document_id=v_document.id and state='reserved'; end if;
    update public.fiscal_outbox set state='completed',processed_at=now(),lease_owner=null,lease_deadline=null where id=v_outbox.id;
    v_terminal := true;
  elsif v_class='ambiguous' then
    update public.fiscal_documents set state='ambiguous',result='ambiguous',errors=coalesce(p_result->'errors','[]'::jsonb) where id=v_document.id;
    update public.fiscal_outbox set state='retry_wait',next_attempt_at=now()+interval '60 seconds',lease_owner=null,lease_deadline=null,last_error_code='AMBIGUOUS',last_error_message='Se consultara antes de reenviar' where id=v_outbox.id;
  elsif v_class='rejected' then
    update public.fiscal_documents set state='rejected',result='rejected',observations=coalesce(p_result->'observations','[]'::jsonb),errors=coalesce(p_result->'errors','[]'::jsonb) where id=v_document.id;
    if v_document.document_intent='credit_note' then update public.fiscal_credit_allocations set state='released' where credit_document_id=v_document.id and state='reserved'; end if;
    update public.fiscal_outbox set state='dead_letter',processed_at=now(),lease_owner=null,lease_deadline=null,last_error_code='ARCA_REJECTED' where id=v_outbox.id;
    v_terminal := true;
  elsif p_result->>'error_code' in ('REQUIRES_FISCAL_REVIEW','ARCA_RECONCILIATION_MISMATCH') then
    update public.fiscal_documents set state='manual_review',result='configuration_error',errors=coalesce(p_result->'errors','[]'::jsonb) where id=v_document.id;
    if v_document.document_intent='credit_note' then update public.fiscal_credit_allocations set state='released' where credit_document_id=v_document.id and state='reserved'; end if;
    update public.fiscal_outbox set state='dead_letter',processed_at=now(),lease_owner=null,lease_deadline=null,last_error_code=coalesce(p_result->>'error_code','REQUIRES_FISCAL_REVIEW'),last_error_message=case when p_result->>'error_code'='ARCA_RECONCILIATION_MISMATCH' then 'La consulta ARCA no coincide; requiere revision' else 'Requiere datos fiscales o revision' end where id=v_outbox.id;
    v_terminal := true;
  else
    update public.fiscal_documents set state='retry_wait',result=coalesce(v_class,'service_error') where id=v_document.id;
    update public.fiscal_outbox set state=case when attempt_count>=8 then 'dead_letter' else 'retry_wait' end,next_attempt_at=now()+least(interval '30 minutes',make_interval(secs=>30*(2^least(attempt_count,6)))),lease_owner=null,lease_deadline=null,last_error_code=left(coalesce(p_result->>'error_code','SERVICE_ERROR'),80),last_error_message=left(coalesce(p_result->>'error_message',''),300) where id=v_outbox.id;
    if (select attempt_count from public.fiscal_outbox where id = v_outbox.id) >= 8 then
      update public.fiscal_documents set state='manual_review' where id=v_document.id;
      v_terminal := true;
    end if;
  end if;

  -- La venta del mostrador no queda secuestrada: cobrada es cobrada. El problema
  -- fiscal vive en el comprobante, que es donde el Panel lo muestra.
  if v_terminal and v_document.source_type = 'pos_sale' then
    update public.pos_sales set state = 'completed'
      where id = v_document.source_id and state = 'completed_fiscal_pending';
  end if;

  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,sanitized_detail)
  values(v_document.id,coalesce(v_class,'service_error'),'worker',p_result-'token'-'sign'-'certificate'-'private_key'-'service_role');
  return jsonb_build_object('fiscal_document_id',v_document.id,'state',(select state from public.fiscal_documents where id=v_document.id));
end;
$complete_fiscal_attempt_automation$;

-- ===== 9. Proyección canónica de estado: cinco palabras, una sola fuente =====
-- La UI muestra exactamente pendiente, procesando, autorizado, rechazado o
-- requiere atención. Nunca "emitido" sin CAE: un 'authorized' sin CAE de 14
-- dígitos no es autorizado, es un problema.

create or replace function public.fiscal_public_state(p_state text, p_cae text)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $fiscal_public_state$
  select case
    when p_state in ('authorized','credited','observed') and coalesce(p_cae,'') ~ '^[0-9]{14}$' then 'authorized'
    when p_state in ('authorized','credited','observed') then 'attention'
    when p_state = 'rejected' then 'rejected'
    when p_state in ('failed','manual_review') then 'attention'
    when p_state in ('claiming','authenticating','authorizing','retry_wait','ambiguous') then 'processing'
    when p_state in ('draft','queued') then 'pending'
    else 'attention'
  end;
$fiscal_public_state$;

comment on function public.fiscal_public_state(text,text) is
  'Traduce el estado real del comprobante a las cinco palabras que la UI puede decir. Sin CAE de 14 digitos jamas devuelve authorized.';

create or replace function public.list_fiscal_emission_intents(p_business_id uuid)
returns table(
  id uuid,
  source_type text,
  source_id uuid,
  trigger_reason text,
  state text,
  attempt_count integer,
  fiscal_document_id uuid,
  last_error_code text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $list_fiscal_emission_intents$
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;
  return query
  select i.id, i.source_type, i.source_id, i.trigger_reason, i.state, i.attempt_count,
         i.fiscal_document_id, i.last_error_code, i.created_at, i.updated_at
  from public.fiscal_emission_intents i
  where i.business_id = p_business_id
  order by i.created_at desc
  limit 200;
end;
$list_fiscal_emission_intents$;

-- ===== 10. Permisos: lo mínimo, y nada del worker para el navegador =====

alter table public.fiscal_emission_intents enable row level security;

drop policy if exists "business reads fiscal intents" on public.fiscal_emission_intents;
create policy "business reads fiscal intents" on public.fiscal_emission_intents
for select to authenticated using (public.is_business_member(business_id));

revoke all on table public.fiscal_emission_intents from public, anon, authenticated;
grant select on table public.fiscal_emission_intents to authenticated;

revoke all on function public.enqueue_fiscal_emission_intent(uuid,text,uuid,text),
  public.internal_create_fiscal_document(uuid,text,uuid,text,uuid,text),
  public.promote_fiscal_emission_intents(text,integer,integer),
  public.claim_fiscal_outbox(text,integer,integer,text,text),
  public.release_fiscal_outbox_lease(uuid,text,text),
  public.settle_completed_fiscal_outbox(uuid,text),
  public.fiscal_parameter_id_is_current(text,text,integer),
  public.resolve_active_fiscal_policy(uuid,text,date),
  public.fiscal_split_amount(numeric,text,integer,numeric,boolean)
from public, anon, authenticated;

grant execute on function public.promote_fiscal_emission_intents(text,integer,integer),
  public.claim_fiscal_outbox(text,integer,integer,text,text),
  public.release_fiscal_outbox_lease(uuid,text,text),
  public.settle_completed_fiscal_outbox(uuid,text)
to service_role;

grant execute on function public.upsert_fiscal_accounting_policy(uuid,jsonb),
  public.record_fiscal_accountant_review(uuid,text,text,text),
  public.approve_fiscal_accounting_policy(uuid,text,text),
  public.revoke_fiscal_accounting_policy(uuid,text),
  public.list_fiscal_accounting_policies(uuid),
  public.list_fiscal_emission_intents(uuid),
  public.fiscal_public_state(text,text)
to authenticated;

comment on function public.internal_create_fiscal_document(uuid,text,uuid,text,uuid,text) is
  'Núcleo único de creación de comprobantes. El operador entra por request_fiscal_document; el promotor entra como sistema. Ambos pasan por la misma política y las mismas dos defensas contra doble emisión.';
comment on function public.promote_fiscal_emission_intents(text,integer,integer) is
  'Convierte intenciones en comprobantes encolados. Un problema de configuración va a manual_review; uno transitorio espera con backoff.';
