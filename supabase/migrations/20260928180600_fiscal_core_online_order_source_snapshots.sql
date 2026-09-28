-- ============================================================================
--  ADOPCION DEL CORE FISCAL · pedidos online desde un origen congelado
-- ============================================================================
--
--  Fuente canonica: bitflowapp/taba-fiscal@9fd32fd29dec4ec4c271edd90f4af2ceef73264c (PR #3, apilada sobre #2 y #1)
--    database/migrations/20260927100000_fiscal_online_order_source_snapshots.sql
--  Se copia textual, con UNA diferencia: la lectura del origen congelado es de owner|admin|staff
--  (La Taba no tiene el rol 'viewer'; mismo criterio que 20260928180400). No se reaplica ninguna
--  migracion historica: es el DELTA desde 20260928180500 al contrato del core.
--
--  ---- Encabezado original en taba-fiscal (20260927100000) ----
-- ============================================================================
--  Pedidos online: facturar SOLO desde un origen fiscal congelado y validado
-- ============================================================================
--
--  QUE PASABA: private.fiscal_request_invoice aceptaba source_type 'online_order'
--  en la validacion y despues lo rechazaba siempre ("facturacion online requiere
--  politica fiscal validada"). No habia forma honesta de facturar un pedido online:
--  disfrazarlo de venta POS (con un pago y un snapshot impositivo inventados) es
--  exactamente lo que se rechazo en la integracion anterior de La Taba.
--
--  QUE CAMBIA. Es generico: el core no conoce el pedido de nadie ni calcula IVA.
--    · fiscal_source_snapshots: el adaptador comercial (La Taba) congela las lineas y
--      los totales del pedido YA CALCULADOS bajo una politica contable aprobada. El core
--      valida y guarda. Es inmutable (55000).
--    · private.fiscal_freeze_source_snapshot valida todo antes de guardar:
--        - importes al centavo (numeric(14,2)); cantidades con hasta 3 decimales;
--        - cada linea cierra: bruto - descuento = neto + IVA + exento + no gravado + tributos;
--        - una linea gravada tiene una alicuota oficial (3,4,5,6,8,9) y no tiene exento ni no
--          gravado; una linea sin alicuota no tiene neto ni IVA;
--        - tributos = 0: el worker no informa el detalle <Tributos> (ARCA 10024);
--        - por alicuota, IVA = base x alicuota con el margen de ARCA (manual WSFEv1 v4.7, 10051);
--        - total + excluido = total del origen, exacto; lo excluido lleva su motivo;
--        - el mismo origen con el mismo contenido devuelve el mismo snapshot; otro contenido: 23505.
--    · private.fiscal_request_invoice: 'online_order' factura desde el snapshot, con la misma
--      convergencia, los mismos locks, la misma politica contable y RG 5616. Sin snapshot sigue
--      fallando cerrado con el mismo error. El camino de pos_sale no cambia.
--    · cada alicuota tiene que estar en la tabla vigente de ARCA (vat_types, FEParamGetTiposIva).
--    · fiscal_documents.source_snapshot_id: el origen congelado del que nacio el comprobante.
-- ============================================================================

-- ---- alicuotas oficiales -----------------------------------------------------
-- ARCA, Libro IVA Digital, "Tablas del sistema", tabla 1 (los mismos Id que devuelve
-- FEParamGetTiposIva): 3 0 %, 4 10,5 %, 5 21 %, 6 27 %, 8 5 %, 9 2,5 %.
create or replace function private.fiscal_vat_rate(p_code integer)
returns numeric
language sql
immutable
set search_path = pg_catalog
as $fiscal_vat_rate$
  select case p_code when 3 then 0 when 4 then 10.5 when 5 then 21 when 6 then 27 when 8 then 5 when 9 then 2.5 end::numeric
$fiscal_vat_rate$;

-- ---- origen congelado ------------------------------------------------------------
create table if not exists public.fiscal_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  source_type text not null check (source_type in ('online_order')),
  source_id uuid not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  source_total numeric(14,2) not null check (source_total >= 0),
  excluded_amount numeric(14,2) not null default 0 check (excluded_amount >= 0),
  excluded_reason text check (excluded_reason is null or char_length(btrim(excluded_reason)) between 3 and 80),
  net_amount numeric(14,2) not null check (net_amount >= 0),
  tax_amount numeric(14,2) not null check (tax_amount >= 0),
  exempt_amount numeric(14,2) not null check (exempt_amount >= 0),
  non_taxed_amount numeric(14,2) not null check (non_taxed_amount >= 0),
  other_taxes_amount numeric(14,2) not null check (other_taxes_amount = 0),
  total_amount numeric(14,2) not null check (total_amount >= 0),
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 500),
  policy_ref jsonb not null check (jsonb_typeof(policy_ref) = 'object'),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  frozen_by uuid,
  frozen_by_type text not null check (frozen_by_type in ('operator', 'system')),
  frozen_at timestamptz not null default now(),
  constraint fiscal_source_snapshots_one_per_source unique (business_id, source_type, source_id),
  constraint fiscal_source_snapshots_totals_close
    check (total_amount = net_amount + tax_amount + exempt_amount + non_taxed_amount + other_taxes_amount),
  constraint fiscal_source_snapshots_source_reconciles check (total_amount + excluded_amount = source_total),
  constraint fiscal_source_snapshots_exclusion_has_reason check ((excluded_amount = 0) = (excluded_reason is null)),
  constraint fiscal_source_snapshots_operator_has_actor check (frozen_by_type <> 'operator' or frozen_by is not null)
);

create or replace function private.fiscal_source_snapshots_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $fiscal_source_snapshots_immutable$
begin
  raise exception 'el origen fiscal congelado es inmutable' using errcode = '55000';
end;
$fiscal_source_snapshots_immutable$;

drop trigger if exists fiscal_source_snapshots_immutable on public.fiscal_source_snapshots;
create trigger fiscal_source_snapshots_immutable before update or delete on public.fiscal_source_snapshots
for each row execute function private.fiscal_source_snapshots_immutable();

alter table public.fiscal_source_snapshots enable row level security;
revoke all on public.fiscal_source_snapshots from public, anon, authenticated, service_role;
grant select on public.fiscal_source_snapshots to authenticated, service_role;
drop policy if exists "fiscal source snapshots readable by back office" on public.fiscal_source_snapshots;
create policy "fiscal source snapshots readable by back office" on public.fiscal_source_snapshots
  for select to authenticated using (public.has_business_role(business_id, array['owner', 'admin', 'staff']));

-- ---- el comprobante recuerda de que origen nacio -----------------------------------
alter table public.fiscal_documents
  add column if not exists source_snapshot_id uuid references public.fiscal_source_snapshots(id) on delete restrict;

-- Autorizado, protect_authorized_fiscal_document ya lo congela (todo menos el estado del PDF).
-- Antes de autorizar tampoco se reapunta a otro origen.
create or replace function private.fiscal_documents_keep_source_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $fiscal_documents_keep_source_snapshot$
begin
  if new.source_snapshot_id is distinct from old.source_snapshot_id then
    raise exception 'el origen congelado de un comprobante es inmutable' using errcode = 'TF004';
  end if;
  return new;
end;
$fiscal_documents_keep_source_snapshot$;

drop trigger if exists fiscal_documents_keep_source_snapshot on public.fiscal_documents;
create trigger fiscal_documents_keep_source_snapshot before update of source_snapshot_id on public.fiscal_documents
for each row execute function private.fiscal_documents_keep_source_snapshot();

-- ---- congelar un origen ------------------------------------------------------------
create or replace function private.fiscal_freeze_source_snapshot(
  p_business_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_snapshot jsonb,
  p_actor_id uuid,
  p_actor_type text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $fiscal_freeze_source_snapshot$
declare
  c_money constant text := '^[0-9]{1,12}([.][0-9]{1,2})?$';
  c_quantity constant text := '^[0-9]{1,11}([.][0-9]{1,3})?$';
  c_line_keys constant text[] := array['kind', 'description', 'quantity', 'unit_price', 'gross_amount', 'discount_amount',
    'net_amount', 'tax_amount', 'tax_code', 'exempt_amount', 'non_taxed_amount', 'other_taxes_amount', 'reference'];
  v_line jsonb;
  v_field text;
  v_code integer;
  v_gross numeric(14,2);
  v_discount numeric(14,2);
  v_line_net numeric(14,2);
  v_line_tax numeric(14,2);
  v_line_exempt numeric(14,2);
  v_line_non_taxed numeric(14,2);
  v_line_other numeric(14,2);
  v_net numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_exempt numeric(14,2) := 0;
  v_non_taxed numeric(14,2) := 0;
  v_other numeric(14,2) := 0;
  v_total numeric(14,2);
  v_source_total numeric(14,2);
  v_excluded numeric(14,2);
  v_group record;
  v_expected numeric;
  v_hash text;
  v_id uuid;
  v_existing public.fiscal_source_snapshots%rowtype;
begin
  if coalesce(p_source_type, '') <> 'online_order' or p_business_id is null or p_source_id is null then
    raise exception 'origen fiscal no soportado' using errcode = '22023';
  end if;
  if coalesce(p_actor_type, '') not in ('operator', 'system') or (p_actor_type = 'operator' and p_actor_id is null) then
    raise exception 'actor fiscal invalido' using errcode = '22023';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_snapshot) k
                 where k not in ('currency', 'source_total', 'excluded_amount', 'excluded_reason', 'lines', 'policy_ref'))
     or coalesce(p_snapshot->>'currency', '') !~ '^[A-Z]{3}$'
     or coalesce(p_snapshot->>'source_total', '') !~ c_money
     or coalesce(p_snapshot->>'excluded_amount', '') !~ c_money
     or jsonb_typeof(p_snapshot->'lines') is distinct from 'array'
     or jsonb_array_length(p_snapshot->'lines') not between 1 and 500
     or jsonb_typeof(p_snapshot->'policy_ref') is distinct from 'object'
     or coalesce(p_snapshot->'policy_ref'->>'adapter', '') !~ '^[a-z0-9._/-]{3,80}$'
     or char_length(coalesce(p_snapshot->'policy_ref'->>'policy_version', '')) not between 1 and 128
  then
    raise exception 'origen fiscal invalido' using errcode = '22023';
  end if;
  v_source_total := (p_snapshot->>'source_total')::numeric;
  v_excluded := (p_snapshot->>'excluded_amount')::numeric;
  if (v_excluded = 0) <> (jsonb_typeof(p_snapshot->'excluded_reason') is distinct from 'string')
     or (v_excluded > 0 and char_length(btrim(p_snapshot->>'excluded_reason')) not between 3 and 80) then
    raise exception 'lo excluido del comprobante necesita su motivo' using errcode = '22023';
  end if;

  for v_line in select value from jsonb_array_elements(p_snapshot->'lines')
  loop
    if jsonb_typeof(v_line) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_line) k where k <> all (c_line_keys))
       or coalesce(v_line->>'kind', '') not in ('item', 'delivery')
       or char_length(btrim(coalesce(v_line->>'description', ''))) not between 1 and 200
       or coalesce(v_line->>'quantity', '') !~ c_quantity
       or (v_line->>'quantity')::numeric <= 0
       or (v_line ? 'reference' and jsonb_typeof(v_line->'reference') not in ('object', 'null'))
    then
      raise exception 'linea de origen fiscal invalida' using errcode = '22023';
    end if;
    foreach v_field in array array['unit_price', 'gross_amount', 'discount_amount', 'net_amount', 'tax_amount',
                                  'exempt_amount', 'non_taxed_amount', 'other_taxes_amount']
    loop
      if coalesce(v_line->>v_field, '') !~ c_money then
        raise exception 'importe de linea invalido: %', v_field using errcode = '22023';
      end if;
    end loop;
    v_gross := (v_line->>'gross_amount')::numeric;
    v_discount := (v_line->>'discount_amount')::numeric;
    v_line_net := (v_line->>'net_amount')::numeric;
    v_line_tax := (v_line->>'tax_amount')::numeric;
    v_line_exempt := (v_line->>'exempt_amount')::numeric;
    v_line_non_taxed := (v_line->>'non_taxed_amount')::numeric;
    v_line_other := (v_line->>'other_taxes_amount')::numeric;
    if v_line_other <> 0 then
      raise exception 'tributos en un origen fiscal: el worker no informa su detalle' using errcode = '22023';
    end if;
    if v_discount > v_gross or v_gross - v_discount <> v_line_net + v_line_tax + v_line_exempt + v_line_non_taxed + v_line_other then
      raise exception 'la linea no cierra: bruto - descuento distinto de sus componentes' using errcode = '23514';
    end if;
    if jsonb_typeof(v_line->'tax_code') = 'number' then
      if v_line->>'tax_code' !~ '^[0-9]+$' or private.fiscal_vat_rate((v_line->>'tax_code')::integer) is null then
        raise exception 'alicuota de IVA no oficial' using errcode = '22023';
      end if;
      v_code := (v_line->>'tax_code')::integer;
      if v_line_exempt <> 0 or v_line_non_taxed <> 0 then
        raise exception 'una linea gravada no lleva exento ni no gravado' using errcode = '22023';
      end if;
    elsif v_line->'tax_code' is null or jsonb_typeof(v_line->'tax_code') = 'null' then
      if v_line_net <> 0 or v_line_tax <> 0 then
        raise exception 'una linea sin alicuota no lleva neto ni IVA' using errcode = '22023';
      end if;
    else
      raise exception 'alicuota de IVA invalida' using errcode = '22023';
    end if;
    v_net := v_net + v_line_net;
    v_tax := v_tax + v_line_tax;
    v_exempt := v_exempt + v_line_exempt;
    v_non_taxed := v_non_taxed + v_line_non_taxed;
    v_other := v_other + v_line_other;
  end loop;

  -- ARCA 10051: el IVA de cada alicuota corresponde a su base (relativo <= 0,01 % o absoluto <= 0,01).
  -- Cada linea ya se valido arriba: sumar por alicuota es seguro.
  for v_group in
    select (l->>'tax_code')::integer as code, sum((l->>'net_amount')::numeric) as base, sum((l->>'tax_amount')::numeric) as tax
      from jsonb_array_elements(p_snapshot->'lines') l
     where jsonb_typeof(l->'tax_code') = 'number'
     group by 1
  loop
    v_expected := round(v_group.base * private.fiscal_vat_rate(v_group.code) / 100, 2);
    if abs(v_group.tax - v_expected) > 0.01 and abs(v_group.tax - v_expected) > v_expected * 0.0001 then
      raise exception 'el IVA no corresponde a la alicuota %', v_group.code using errcode = '23514', hint = 'VAT_RATE_MISMATCH';
    end if;
  end loop;

  v_total := v_net + v_tax + v_exempt + v_non_taxed + v_other;
  if v_total + v_excluded <> v_source_total then
    raise exception 'el origen fiscal no cierra con su total' using errcode = '23514', hint = 'SOURCE_TOTAL_MISMATCH';
  end if;

  v_hash := encode(sha256(convert_to(p_snapshot::text, 'UTF8')), 'hex');
  insert into public.fiscal_source_snapshots(
    business_id, source_type, source_id, currency, source_total, excluded_amount, excluded_reason,
    net_amount, tax_amount, exempt_amount, non_taxed_amount, other_taxes_amount, total_amount,
    lines, policy_ref, snapshot_hash, frozen_by, frozen_by_type
  ) values (
    p_business_id, p_source_type, p_source_id, p_snapshot->>'currency', v_source_total, v_excluded,
    case when v_excluded > 0 then btrim(p_snapshot->>'excluded_reason') end,
    v_net, v_tax, v_exempt, v_non_taxed, v_other, v_total,
    p_snapshot->'lines', p_snapshot->'policy_ref', v_hash, p_actor_id, p_actor_type
  )
  on conflict (business_id, source_type, source_id) do nothing
  returning id into v_id;
  if v_id is null then
    select s.* into v_existing from public.fiscal_source_snapshots s
     where s.business_id = p_business_id and s.source_type = p_source_type and s.source_id = p_source_id;
    if v_existing.snapshot_hash is distinct from v_hash then
      raise exception 'el origen fiscal ya esta congelado con otro contenido' using errcode = '23505', hint = 'FISCAL_SOURCE_SNAPSHOT_CONFLICT';
    end if;
    v_id := v_existing.id;
  end if;
  return v_id;
end;
$fiscal_freeze_source_snapshot$;

-- ---- facturar desde el origen congelado ------------------------------------------
-- La llama private.fiscal_request_invoice con sus locks tomados y la convergencia ya resuelta.
create or replace function private.fiscal_request_invoice_from_snapshot(
  p_business_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_document_intent text,
  p_idempotency_key text,
  p_command_source text,
  p_actor_id uuid,
  p_actor_type text,
  p_profile public.fiscal_profiles,
  p_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $fiscal_request_invoice_from_snapshot$
declare
  v_snapshot public.fiscal_source_snapshots%rowtype;
  v_policy public.fiscal_accounting_policies%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_line jsonb;
  v_code integer;
begin
  select s.* into v_snapshot from public.fiscal_source_snapshots s
   where s.business_id = p_business_id and s.source_type = p_source_type and s.source_id = p_source_id
   for share;
  if not found then
    raise exception 'facturacion online requiere politica fiscal validada' using errcode = 'P0001', hint = 'FISCAL_SOURCE_SNAPSHOT_REQUIRED';
  end if;
  if btrim(coalesce(p_profile.default_recipient_condition, '')) = '' then raise exception 'fiscal_policy_review_required' using errcode = 'P0001'; end if;

  select p.* into v_policy from public.fiscal_accounting_policies p
  where p.business_id = p_business_id and p.environment = p_profile.environment
    and p.issuer_condition = p_profile.tax_condition and p.recipient_condition = p_profile.default_recipient_condition
    and p.concept = p_profile.default_concept and p.enabled and p.accountant_review_status = 'approved'
    and p.valid_from <= current_date
  order by p.valid_from desc, p.created_at desc limit 1 for share;
  if not found then raise exception 'fiscal_policy_review_required' using errcode = 'P0001'; end if;
  v_policy := public.resolve_fiscal_accounting_policy(p_business_id, p_profile.environment, p_profile.tax_condition,
    p_profile.default_recipient_condition, p_profile.default_concept, v_policy.invoice_type, current_date);
  -- RG 5616: una factura nueva no se encola sin la condicion del receptor.
  if v_policy.recipient_vat_condition_id is null then raise exception 'fiscal_policy_review_required' using errcode = 'P0001'; end if;
  if v_snapshot.currency is distinct from p_profile.default_currency then
    raise exception 'fiscal_policy_review_required' using errcode = 'P0001', hint = 'CURRENCY_MISMATCH';
  end if;
  for v_code in
    select distinct (l->>'tax_code')::integer from jsonb_array_elements(v_snapshot.lines) l where jsonb_typeof(l->'tax_code') = 'number'
  loop
    if not public.fiscal_has_current_parameter_id(p_profile.environment, 'vat_types', v_code) then
      raise exception 'fiscal_policy_review_required' using errcode = 'P0001', hint = 'FISCAL_PARAMETERS_REQUIRED';
    end if;
  end loop;

  insert into public.fiscal_documents(
    business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,concept,currency,currency_rate,
    recipient_type,recipient_document_type,recipient_document_number,recipient_vat_condition_id,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,
    state,idempotency_key,issuer_snapshot,recipient_snapshot,fiscal_policy_version,source_snapshot_id
  ) values (
    p_business_id,p_source_type,p_source_id,p_document_intent,p_profile.environment,p_profile.cuit,p_profile.point_of_sale,v_policy.invoice_type,p_profile.default_concept,p_profile.default_currency,1,
    p_profile.default_recipient_condition,v_policy.recipient_document_type,v_policy.recipient_document_number,v_policy.recipient_vat_condition_id,
    v_snapshot.net_amount,v_snapshot.tax_amount,v_snapshot.exempt_amount,v_snapshot.non_taxed_amount,v_snapshot.other_taxes_amount,v_snapshot.total_amount,
    'queued',p_idempotency_key,
    jsonb_build_object('legal_name',p_profile.legal_name,'cuit',p_profile.cuit,'tax_condition',p_profile.tax_condition,'address',p_profile.business_address,'gross_income_number',p_profile.gross_income_number),
    jsonb_build_object('condition',p_profile.default_recipient_condition,'vat_condition_id',v_policy.recipient_vat_condition_id,'document_type',v_policy.recipient_document_type,'document_number',v_policy.recipient_document_number),
    v_policy.policy_version, v_snapshot.id
  ) returning * into v_document;
  for v_line in select value from jsonb_array_elements(v_snapshot.lines)
  loop
    insert into public.fiscal_document_items(fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount,tax_code,exempt_amount,non_taxed_amount,other_taxes_amount,tax_snapshot)
    values (v_document.id, btrim(v_line->>'description'), (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric,
      (v_line->>'net_amount')::numeric, (v_line->>'tax_amount')::numeric,
      case when jsonb_typeof(v_line->'tax_code') = 'number' then (v_line->>'tax_code')::integer end,
      (v_line->>'exempt_amount')::numeric, (v_line->>'non_taxed_amount')::numeric, (v_line->>'other_taxes_amount')::numeric, v_line);
  end loop;
  insert into public.fiscal_outbox(fiscal_document_id) values (v_document.id);
  insert into public.fiscal_idempotency_keys(business_id, idempotency_key, request_kind, request_fingerprint, fiscal_document_id, command_source, actor_id)
  values (p_business_id, p_idempotency_key, 'invoice', p_fingerprint, v_document.id, p_command_source, p_actor_id);
  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,actor_id,sanitized_detail)
  values (v_document.id,'queued',p_actor_type,p_actor_id,jsonb_strip_nulls(jsonb_build_object(
    'source_type',p_source_type,'policy_version',v_policy.policy_version,'recipient_vat_condition_id',v_policy.recipient_vat_condition_id,
    'command_source',p_command_source,'source_snapshot_id',v_snapshot.id,'source_policy_version',v_snapshot.policy_ref->>'policy_version',
    'source_adapter',v_snapshot.policy_ref->>'adapter')));
  return jsonb_build_object('fiscal_document_id',v_document.id,'state','queued','idempotent_replay',false);
end;
$fiscal_request_invoice_from_snapshot$;

-- ---- la entrada unica: online_order va al origen congelado -----------------------
-- Mismo cuerpo que 20260926180000; unico cambio, la rama de 'online_order'. El camino de
-- pos_sale queda identico.
create or replace function private.fiscal_request_invoice(
  p_business_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_document_intent text,
  p_idempotency_key text,
  p_command_source text,
  p_actor_id uuid,
  p_actor_type text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $fiscal_request_invoice$
declare
  v_profile public.fiscal_profiles%rowtype;
  v_sale public.pos_sales%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_existing public.fiscal_documents%rowtype;
  v_policy public.fiscal_accounting_policies%rowtype;
  v_item public.pos_sale_items%rowtype;
  v_net numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_exempt numeric(14,2) := 0;
  v_non_taxed numeric(14,2) := 0;
  v_other_taxes numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_tax_code integer;
  v_fingerprint text;
  v_key public.fiscal_idempotency_keys%rowtype;
begin
  -- NULL nunca pasa una validacion: sin estos coalesce, un NULL hacia el IF nulo y seguia de largo
  -- sin identidad (y sin lock: pg_advisory_xact_lock(NULL) no bloquea nada).
  if coalesce(p_source_type,'') not in ('pos_sale','online_order') or coalesce(p_document_intent,'') <> 'invoice' or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'intencion fiscal no soportada' using errcode = '22023'; end if;
  if p_business_id is null or p_source_id is null then raise exception 'intencion fiscal no soportada' using errcode = '22023'; end if;
  if coalesce(p_actor_type,'') not in ('operator','system') then raise exception 'actor fiscal invalido' using errcode = '22023'; end if;
  v_fingerprint := private.fiscal_invoice_fingerprint(p_business_id, p_source_type, p_source_id, p_document_intent);

  -- Una venta, una intencion: se serializa por la identidad logica (cualquier
  -- clave, cualquier canal) y despues por la clave. Orden fijo: sin ciclos.
  perform pg_advisory_xact_lock(hashtextextended('taba-fiscal:intent:' || v_fingerprint, 0));
  perform pg_advisory_xact_lock(hashtextextended('taba-fiscal:key:' || p_business_id::text || ':' || p_idempotency_key, 0));

  -- Misma clave: tiene que ser la misma solicitud. Otra venta con esta clave es un conflicto explicito.
  select k.* into v_key from public.fiscal_idempotency_keys k where k.business_id = p_business_id and k.idempotency_key = p_idempotency_key;
  if found then
    if v_key.request_kind <> 'invoice' or v_key.request_fingerprint is distinct from v_fingerprint then
      raise exception 'idempotency_key reutilizada con otra solicitud' using errcode = '23505', hint = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    select d.* into v_existing from public.fiscal_documents d where d.id = v_key.fiscal_document_id;
    perform private.fiscal_record_intent_replay(v_existing, p_command_source, p_actor_id, p_actor_type, 'same_key');
    return jsonb_build_object('fiscal_document_id',v_existing.id,'state',v_existing.state,'idempotent_replay',true);
  end if;

  -- Otra clave, misma venta: converge en la intencion existente y la clave queda ligada a ella.
  select d.* into v_existing from public.fiscal_documents d
   where d.business_id = p_business_id and d.source_type = p_source_type and d.source_id = p_source_id and d.document_intent = p_document_intent;
  if found then
    insert into public.fiscal_idempotency_keys(business_id, idempotency_key, request_kind, request_fingerprint, fiscal_document_id, command_source, actor_id)
    values (p_business_id, p_idempotency_key, 'invoice', v_fingerprint, v_existing.id, p_command_source, p_actor_id);
    perform private.fiscal_record_intent_replay(v_existing, p_command_source, p_actor_id, p_actor_type, 'same_intent');
    return jsonb_build_object('fiscal_document_id',v_existing.id,'state',v_existing.state,'idempotent_replay',true);
  end if;
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = p_business_id for share;
  if not found or not v_profile.is_enabled or v_profile.environment = 'disabled' then raise exception 'fiscalizacion deshabilitada' using errcode = 'P0001'; end if;
  if v_profile.environment = 'production' and (v_profile.accountant_review_status <> 'approved' or v_profile.production_gate_status <> 'approved') then raise exception 'produccion fiscal bloqueada' using errcode = '42501'; end if;
  -- Un pedido online se factura SOLO desde su origen congelado y validado (fiscal_source_snapshots).
  -- Sin snapshot, private.fiscal_request_invoice_from_snapshot sigue fallando cerrado con el mismo error.
  if p_source_type = 'online_order' then
    return private.fiscal_request_invoice_from_snapshot(p_business_id, p_source_type, p_source_id, p_document_intent,
      p_idempotency_key, p_command_source, p_actor_id, p_actor_type, v_profile, v_fingerprint);
  end if;
  if p_source_type <> 'pos_sale' then raise exception 'facturacion online requiere politica fiscal validada' using errcode='P0001'; end if;
  select s.* into v_sale from public.pos_sales s where s.id = p_source_id and s.business_id = p_business_id and s.state in ('completed_fiscal_pending','completed') for update;
  if not found then raise exception 'venta no confirmada' using errcode='P0002'; end if;
  if btrim(coalesce(v_profile.default_recipient_condition,'')) = '' then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;

  select p.* into v_policy from public.fiscal_accounting_policies p
  where p.business_id = p_business_id and p.environment = v_profile.environment
    and p.issuer_condition = v_profile.tax_condition and p.recipient_condition = v_profile.default_recipient_condition
    and p.concept = v_profile.default_concept and p.enabled and p.accountant_review_status = 'approved'
    and p.valid_from <= current_date
  order by p.valid_from desc, p.created_at desc limit 1 for share;
  if not found then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;
  v_policy := public.resolve_fiscal_accounting_policy(p_business_id, v_profile.environment, v_profile.tax_condition, v_profile.default_recipient_condition, v_profile.default_concept, v_policy.invoice_type, current_date);
  -- RG 5616: una factura nueva no se encola sin la condicion del receptor.
  if v_policy.recipient_vat_condition_id is null then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;

  for v_item in select * from public.pos_sale_items i where i.sale_id = v_sale.id order by i.id
  loop
    if not (v_item.tax_snapshot ?& array['net_amount','tax_amount','exempt_amount','non_taxed_amount','other_taxes_amount'])
      or coalesce(v_item.tax_snapshot->>'net_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or coalesce(v_item.tax_snapshot->>'tax_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or coalesce(v_item.tax_snapshot->>'exempt_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or coalesce(v_item.tax_snapshot->>'non_taxed_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or coalesce(v_item.tax_snapshot->>'other_taxes_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$'
    then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;
    v_tax_code := case when coalesce(v_item.tax_snapshot->>'tax_code','') ~ '^[0-9]+$' then (v_item.tax_snapshot->>'tax_code')::integer else null end;
    if (v_item.tax_snapshot->>'tax_amount')::numeric > 0 and v_tax_code is null then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;
    v_net := v_net + (v_item.tax_snapshot->>'net_amount')::numeric;
    v_tax := v_tax + (v_item.tax_snapshot->>'tax_amount')::numeric;
    v_exempt := v_exempt + (v_item.tax_snapshot->>'exempt_amount')::numeric;
    v_non_taxed := v_non_taxed + (v_item.tax_snapshot->>'non_taxed_amount')::numeric;
    v_other_taxes := v_other_taxes + (v_item.tax_snapshot->>'other_taxes_amount')::numeric;
  end loop;
  v_total := v_net + v_tax + v_exempt + v_non_taxed + v_other_taxes;
  if abs(v_total - v_sale.total) > 0.01 then raise exception 'snapshot impositivo no coincide con la venta' using errcode='23514'; end if;

  insert into public.fiscal_documents(
    business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,concept,currency,currency_rate,
    recipient_type,recipient_document_type,recipient_document_number,recipient_vat_condition_id,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,
    state,idempotency_key,issuer_snapshot,recipient_snapshot,fiscal_policy_version
  ) values (
    p_business_id,p_source_type,p_source_id,p_document_intent,v_profile.environment,v_profile.cuit,v_profile.point_of_sale,v_policy.invoice_type,v_profile.default_concept,v_profile.default_currency,1,
    v_profile.default_recipient_condition,v_policy.recipient_document_type,v_policy.recipient_document_number,v_policy.recipient_vat_condition_id,v_net,v_tax,v_exempt,v_non_taxed,v_other_taxes,v_total,
    'queued',p_idempotency_key,
    jsonb_build_object('legal_name',v_profile.legal_name,'cuit',v_profile.cuit,'tax_condition',v_profile.tax_condition,'address',v_profile.business_address,'gross_income_number',v_profile.gross_income_number),
    jsonb_build_object('condition',v_profile.default_recipient_condition,'vat_condition_id',v_policy.recipient_vat_condition_id,'document_type',v_policy.recipient_document_type,'document_number',v_policy.recipient_document_number),
    v_policy.policy_version
  ) returning * into v_document;
  for v_item in select * from public.pos_sale_items i where i.sale_id = v_sale.id order by i.id
  loop
    v_tax_code := case when coalesce(v_item.tax_snapshot->>'tax_code','') ~ '^[0-9]+$' then (v_item.tax_snapshot->>'tax_code')::integer else null end;
    insert into public.fiscal_document_items(fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount,tax_code,exempt_amount,non_taxed_amount,other_taxes_amount,tax_snapshot)
    values(v_document.id,v_item.product_name,v_item.quantity,v_item.unit_price,(v_item.tax_snapshot->>'net_amount')::numeric,(v_item.tax_snapshot->>'tax_amount')::numeric,v_tax_code,(v_item.tax_snapshot->>'exempt_amount')::numeric,(v_item.tax_snapshot->>'non_taxed_amount')::numeric,(v_item.tax_snapshot->>'other_taxes_amount')::numeric,v_item.tax_snapshot);
  end loop;
  update public.pos_sales set fiscal_document_id = v_document.id, state = 'completed_fiscal_pending' where id = v_sale.id;
  insert into public.fiscal_outbox(fiscal_document_id) values(v_document.id);
  insert into public.fiscal_idempotency_keys(business_id, idempotency_key, request_kind, request_fingerprint, fiscal_document_id, command_source, actor_id)
  values (p_business_id, p_idempotency_key, 'invoice', v_fingerprint, v_document.id, p_command_source, p_actor_id);
  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,actor_id,sanitized_detail)
  values(v_document.id,'queued',p_actor_type,p_actor_id,jsonb_strip_nulls(jsonb_build_object('source_type',p_source_type,'policy_version',v_policy.policy_version,'recipient_vat_condition_id',v_policy.recipient_vat_condition_id,'command_source',p_command_source)));
  return jsonb_build_object('fiscal_document_id',v_document.id,'state','queued','idempotent_replay',false);
end;
$fiscal_request_invoice$;

revoke all on function private.fiscal_vat_rate(integer) from public;
revoke all on function private.fiscal_freeze_source_snapshot(uuid, text, uuid, jsonb, uuid, text) from public;
revoke all on function private.fiscal_request_invoice_from_snapshot(uuid, text, uuid, text, text, text, uuid, text, public.fiscal_profiles, text) from public;
revoke all on function private.fiscal_source_snapshots_immutable() from public;
revoke all on function private.fiscal_documents_keep_source_snapshot() from public;
