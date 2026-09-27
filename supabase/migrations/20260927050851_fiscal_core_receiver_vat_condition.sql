-- ============================================================================
--  ADOPCION DEL CORE FISCAL · RG 5616, condicion frente al IVA del receptor
-- ============================================================================
--
--  Fuente canonica: bitflowapp/taba-fiscal@26d2f4cb9e379789b52e4a85e88f39910b0e852f (PR #1)
--    database/migrations/20260926170000_fiscal_receiver_vat_condition.sql
--  Los cuerpos de funcion, checks y backfills se copian textuales de la fuente
--  (ver docs/TABA-FISCAL-CORE-ADOPTION.md): La Taba ejecuta el mismo contrato.
--  No se reaplica ninguna migracion historica: esto es el DELTA desde
--  20260926160000_local_print_agent.sql (cabeza de La Taba) al contrato del core.
--
--  Efectos:
--    · recipient_vat_condition_id en fiscal_accounting_policies y fiscal_documents (lo fija la politica aprobada);
--    · save_fiscal_parameter_snapshot acepta 'recipient_vat_conditions' (tabla oficial FEParamGetCondicionIvaReceptor);
--    · resolve_fiscal_accounting_policy no resuelve una condicion que no esta en el snapshot vigente;
--    · la nota de credito hereda la condicion de la factura (trigger BEFORE INSERT).
--
--  No se adopta (sin efecto en La Taba o reemplazado mas adelante):
--    · request_fiscal_document de 5 parametros de 170000: la reemplaza la entrada unica de la migracion siguiente;
--    · protect_authorized_fiscal_document de 170000: la reemplaza la version final de la maquina de estados.
--
-- ============================================================================
--
--  ---- Encabezado original en taba-fiscal (170000); sus rutas son de ese repositorio ----
-- ============================================================================
--  RG 5616 · Condición frente al IVA del receptor (CondicionIVAReceptorId).
-- ============================================================================
--
--  El manual del desarrollador WSFEv1 (4.0+, vigente 4.7 del 2026-09-01) y el
--  WSDL oficial agregan CondicionIVAReceptorId a FECAEDetRequest; ARCA rechaza
--  con 10246 cuando falta. El worker (services/arca-fiscal-bridge) no lo
--  enviaba. Esta migración lleva el dato de punta a punta:
--
--    · fiscal_accounting_policies.recipient_vat_condition_id: lo fija la
--      política aprobada por el contador (no se infiere del texto «Consumidor
--      Final»), validado contra el snapshot de FEParamGetCondicionIvaReceptor;
--    · fiscal_documents.recipient_vat_condition_id: se copia al pedir la
--      factura (obligatorio para facturas NUEVAS), se hereda en la nota de
--      crédito y queda inmutable una vez autorizada;
--    · save_fiscal_parameter_snapshot acepta 'recipient_vat_conditions'.
--
--  Los comprobantes anteriores sin el dato no se tocan: el worker se niega a
--  reservar número sin él (REQUIRES_FISCAL_REVIEW), así ninguno viaja a ARCA
--  incompleto. Nada de esto habilita producción.
--
--  Rollback: docs/migrations/rollback/20260926170000_fiscal_receiver_vat_condition.rollback.sql
-- ============================================================================

alter table public.fiscal_accounting_policies
  add column if not exists recipient_vat_condition_id integer
    check (recipient_vat_condition_id is null or recipient_vat_condition_id between 1 and 999);

alter table public.fiscal_documents
  add column if not exists recipient_vat_condition_id integer
    check (recipient_vat_condition_id is null or recipient_vat_condition_id between 1 and 999);

comment on column public.fiscal_accounting_policies.recipient_vat_condition_id is
  'CondicionIVAReceptorId de ARCA (RG 5616) para esta politica, validado contra FEParamGetCondicionIvaReceptor.';
comment on column public.fiscal_documents.recipient_vat_condition_id is
  'CondicionIVAReceptorId enviado a ARCA. Obligatorio para facturas nuevas; inmutable una vez autorizado.';

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
as $save_fiscal_parameters$
declare v_snapshot public.fiscal_parameter_snapshots%rowtype;
begin
  if p_environment not in ('homologation','production')
    or p_parameter_type not in ('document_types','recipient_document_types','vat_types','currencies','concepts','points_of_sale','recipient_vat_conditions')
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
$save_fiscal_parameters$;

create or replace function public.resolve_fiscal_accounting_policy(
  p_business_id uuid,
  p_environment text,
  p_issuer_condition text,
  p_recipient_condition text,
  p_concept integer,
  p_invoice_type integer,
  p_effective_on date
)
returns public.fiscal_accounting_policies
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $resolve_fiscal_policy$
declare
  v_policy public.fiscal_accounting_policies%rowtype;
begin
  if p_environment not in ('homologation','production')
    or p_concept not in (1,2,3)
    or p_invoice_type < 1
    or btrim(coalesce(p_issuer_condition,'')) = ''
    or btrim(coalesce(p_recipient_condition,'')) = ''
  then
    raise exception 'fiscal_policy_review_required' using errcode = 'P0001';
  end if;

  select p.* into v_policy
  from public.fiscal_accounting_policies p
  where p.business_id = p_business_id
    and p.environment = p_environment
    and p.issuer_condition = btrim(p_issuer_condition)
    and p.recipient_condition = btrim(p_recipient_condition)
    and p.concept = p_concept
    and p.invoice_type = p_invoice_type
    and p.enabled
    and p.accountant_review_status = 'approved'
    and p.valid_from <= coalesce(p_effective_on, current_date)
  order by p.valid_from desc, p.created_at desc
  limit 1
  for share;

  if not found
    or not public.fiscal_has_current_parameter_id(p_environment, 'document_types', v_policy.invoice_type)
    or not public.fiscal_has_current_parameter_id(p_environment, 'document_types', v_policy.credit_note_type)
    or not public.fiscal_has_current_parameter_id(p_environment, 'recipient_document_types', v_policy.recipient_document_type)
    -- RG 5616: si la política declara la condición del receptor, tiene que
    -- existir en la tabla vigente de ARCA.
    or (v_policy.recipient_vat_condition_id is not null
        and not public.fiscal_has_current_parameter_id(p_environment, 'recipient_vat_conditions', v_policy.recipient_vat_condition_id))
  then
    raise exception 'fiscal_policy_review_required' using errcode = 'P0001';
  end if;
  return v_policy;
end;
$resolve_fiscal_policy$;

-- La nota de crédito hereda la condición del receptor de la factura original
-- (o de la política vigente si la original es anterior a RG 5616).
create or replace function private.fiscal_credit_note_inherit_vat_condition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $fiscal_credit_note_inherit_vat_condition$
declare
  v_original public.fiscal_documents%rowtype;
  v_policy_condition integer;
begin
  if new.document_intent <> 'credit_note' or new.recipient_vat_condition_id is not null or new.associated_document_id is null then
    return new;
  end if;
  select d.* into v_original from public.fiscal_documents d where d.id = new.associated_document_id;
  if v_original.recipient_vat_condition_id is not null then
    new.recipient_vat_condition_id := v_original.recipient_vat_condition_id;
  else
    select p.recipient_vat_condition_id into v_policy_condition
      from public.fiscal_accounting_policies p
     where p.business_id = new.business_id and p.environment = new.environment
       and p.policy_version = new.fiscal_policy_version and p.recipient_vat_condition_id is not null
     order by p.valid_from desc, p.created_at desc limit 1;
    new.recipient_vat_condition_id := v_policy_condition;
  end if;
  if new.recipient_vat_condition_id is not null then
    new.recipient_snapshot := coalesce(new.recipient_snapshot, '{}'::jsonb) || jsonb_build_object('vat_condition_id', new.recipient_vat_condition_id);
  end if;
  return new;
end;
$fiscal_credit_note_inherit_vat_condition$;

drop trigger if exists fiscal_documents_credit_note_vat_condition on public.fiscal_documents;
create trigger fiscal_documents_credit_note_vat_condition before insert on public.fiscal_documents
for each row execute function private.fiscal_credit_note_inherit_vat_condition();

revoke all on function private.fiscal_credit_note_inherit_vat_condition() from public, anon, authenticated;
