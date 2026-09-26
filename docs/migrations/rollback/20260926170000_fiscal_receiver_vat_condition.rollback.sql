-- Rollback de 20260926170000 (RG 5616): vuelve al contrato fiscal anterior.
--
-- Restaura, byte a byte, las definiciones previas de save_fiscal_parameter_snapshot
-- (20260802160000), resolve_fiscal_accounting_policy, request_fiscal_document y
-- protect_authorized_fiscal_document (20260802170000), y quita la herencia de la
-- condición en notas de crédito. Las columnas recipient_vat_condition_id se
-- conservan (evidencia de lo enviado a ARCA); sin las funciones nuevas nadie las
-- completa. OJO: con este rollback ARCA vuelve a rechazar con 10246 los pedidos
-- nuevos; el worker ya se niega a numerar sin el dato (REQUIRES_FISCAL_REVIEW).
begin;

drop trigger if exists fiscal_documents_credit_note_vat_condition on public.fiscal_documents;
drop function if exists private.fiscal_credit_note_inherit_vat_condition();

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
    or p_parameter_type not in ('document_types','recipient_document_types','vat_types','currencies','concepts','points_of_sale')
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
  then
    raise exception 'fiscal_policy_review_required' using errcode = 'P0001';
  end if;
  return v_policy;
end;
$resolve_fiscal_policy$;

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
as $request_fiscal_document_closure$
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
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if p_source_type not in ('pos_sale','online_order') or p_document_intent <> 'invoice' or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'intencion fiscal no soportada' using errcode = '22023'; end if;
  select d.* into v_existing from public.fiscal_documents d where d.business_id = p_business_id and d.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.source_type <> p_source_type or v_existing.source_id <> p_source_id or v_existing.document_intent <> p_document_intent then raise exception 'idempotency_key reutilizada con otra solicitud' using errcode = '23505'; end if;
    return jsonb_build_object('fiscal_document_id',v_existing.id,'state',v_existing.state,'idempotent_replay',true);
  end if;
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = p_business_id for share;
  if not found or not v_profile.is_enabled or v_profile.environment = 'disabled' then raise exception 'fiscalizacion deshabilitada' using errcode = 'P0001'; end if;
  if v_profile.environment = 'production' and (v_profile.accountant_review_status <> 'approved' or v_profile.production_gate_status <> 'approved') then raise exception 'produccion fiscal bloqueada' using errcode = '42501'; end if;
  if p_source_type <> 'pos_sale' then raise exception 'facturacion online requiere politica fiscal validada' using errcode='P0001'; end if;
  select s.* into v_sale from public.pos_sales s where s.id = p_source_id and s.business_id = p_business_id and s.state in ('completed_fiscal_pending','completed') for share;
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
    recipient_type,recipient_document_type,recipient_document_number,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,
    state,idempotency_key,issuer_snapshot,recipient_snapshot,fiscal_policy_version
  ) values (
    p_business_id,p_source_type,p_source_id,p_document_intent,v_profile.environment,v_profile.cuit,v_profile.point_of_sale,v_policy.invoice_type,v_profile.default_concept,v_profile.default_currency,1,
    v_profile.default_recipient_condition,v_policy.recipient_document_type,v_policy.recipient_document_number,v_net,v_tax,v_exempt,v_non_taxed,v_other_taxes,v_total,
    'queued',p_idempotency_key,
    jsonb_build_object('legal_name',v_profile.legal_name,'cuit',v_profile.cuit,'tax_condition',v_profile.tax_condition,'address',v_profile.business_address,'gross_income_number',v_profile.gross_income_number),
    jsonb_build_object('condition',v_profile.default_recipient_condition,'document_type',v_policy.recipient_document_type,'document_number',v_policy.recipient_document_number),
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
  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,actor_id,sanitized_detail)
  values(v_document.id,'queued','operator',auth.uid(),jsonb_build_object('source_type',p_source_type,'policy_version',v_policy.policy_version));
  return jsonb_build_object('fiscal_document_id',v_document.id,'state','queued','idempotent_replay',false);
end;
$request_fiscal_document_closure$;

create or replace function public.protect_authorized_fiscal_document()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $protect_fiscal_closure$
begin
  if tg_op='DELETE' and old.state in ('authorized','credited') then raise exception 'un comprobante autorizado no se elimina' using errcode='55000'; end if;
  if tg_op='UPDATE' and old.state in ('authorized','credited') and (
    new.cae is distinct from old.cae or new.document_number is distinct from old.document_number
    or new.total_amount is distinct from old.total_amount or new.net_amount is distinct from old.net_amount
    or new.tax_amount is distinct from old.tax_amount or new.exempt_amount is distinct from old.exempt_amount
    or new.non_taxed_amount is distinct from old.non_taxed_amount or new.other_taxes_amount is distinct from old.other_taxes_amount
    or new.cuit is distinct from old.cuit or new.point_of_sale is distinct from old.point_of_sale
    or new.document_type is distinct from old.document_type or new.concept is distinct from old.concept
    or new.currency is distinct from old.currency or new.currency_rate is distinct from old.currency_rate
    or new.issuer_snapshot is distinct from old.issuer_snapshot or new.recipient_snapshot is distinct from old.recipient_snapshot
    or new.associated_document_id is distinct from old.associated_document_id or new.associated_document_snapshot is distinct from old.associated_document_snapshot
  ) then raise exception 'los datos autorizados son inmutables' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end;
$protect_fiscal_closure$;

commit;
