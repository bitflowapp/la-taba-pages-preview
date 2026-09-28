-- REVERSIÓN de la línea fiscal: 20260928180000 … 20260928180800 (las nueve migraciones juntas)
--
--   20260928180000_fiscal_core_receiver_vat_condition
--   20260928180100_fiscal_core_intent_convergence
--   20260928180200_fiscal_core_worker_fencing_and_reconciliation
--   20260928180300_fiscal_core_state_machines
--   20260928180400_fiscal_core_security_hardening
--   20260928180500_fiscal_core_la_taba_server_channel_guards
--   20260928180600_fiscal_core_online_order_source_snapshots
--   20260928180700_commercial_fiscal_policy
--   20260928180800_commercial_order_fiscal_adapter
--
-- CÓMO SE HIZO: comparando dos bases reales, A = todas las migraciones hasta
-- 20260928170000 y B = A + la línea fiscal. Este archivo lleva B a A: tablas,
-- columnas, restricciones, disparadores, políticas y funciones (con sus permisos
-- y comentarios). Los permisos de una función que vuelve a crearse repiten las
-- sentencias GRANT/REVOKE de su migración original, porque el resultado depende de
-- los privilegios por defecto del entorno (en Supabase, EXECUTE para los roles de la
-- API al crear una función). CÓMO SE PRUEBA: después de aplicarlo, la huella
-- `scripts/controlled-production/schema-fingerprint.sql` es IGUAL a la de A en
-- todas sus categorías, y volver a aplicar la línea fiscal da otra vez B. Lo
-- ejercita scripts/run-release-v5-db.mjs en cada CI.
--
-- NUNCA BORRA DATOS FISCALES: se niega (ROLLBACK_BLOCKED) si existe un solo
-- comprobante, intento, envío, snapshot, política comercial, clasificación o
-- pedido de impresión fiscal. Un comprobante emitido es un registro legal: si
-- la línea fiscal ya se usó, no hay reversión, hay arreglo hacia adelante.
--
-- No toca el historial de migraciones. Después de revertir en CP:
--   supabase migration repair --status reverted 20260928180000 20260928180100 \
--     20260928180200 20260928180300 20260928180400 20260928180500 20260928180600 \
--     20260928180700 20260928180800
begin;
set local search_path to public, extensions, pg_temp;

do $rollback_guard$
begin
  if exists (select 1 from public.fiscal_documents)
     or exists (select 1 from public.fiscal_outbox)
     or exists (select 1 from public.fiscal_request_attempts)
     or exists (select 1 from public.fiscal_artifact_outbox)
     or exists (select 1 from public.fiscal_idempotency_keys)
     or exists (select 1 from public.fiscal_source_snapshots)
     or exists (select 1 from public.commercial_fiscal_policies)
     or exists (select 1 from public.product_fiscal_classifications)
     or exists (select 1 from public.fiscal_print_requests)
     or exists (select 1 from public.fiscal_accounting_policies where recipient_vat_condition_id is not null) then
    raise exception 'ROLLBACK_BLOCKED: la línea fiscal ya tiene datos; un registro fiscal no se borra'
      using errcode = '55000';
  end if;
end;
$rollback_guard$;



-- ── Políticas nuevas ──────────────────────────────────────────────────────
drop policy "fiscal source snapshots readable by back office" on public.fiscal_source_snapshots;
drop policy "commercial fiscal policy readable by back office" on public.commercial_fiscal_policies;
drop policy "product fiscal classification readable by back office" on public.product_fiscal_classifications;
drop policy "fiscal print requests readable by back office" on public.fiscal_print_requests;

-- ── Disparadores nuevos o cambiados ───────────────────────────────────────
drop trigger fiscal_documents_credit_note_vat_condition on public.fiscal_documents;
drop trigger fiscal_documents_guard_state on public.fiscal_documents;
drop trigger print_jobs_guard_status on public.print_jobs;
drop trigger fiscal_source_snapshots_immutable on public.fiscal_source_snapshots;
drop trigger fiscal_documents_keep_source_snapshot on public.fiscal_documents;
drop trigger commercial_fiscal_policies_guard on public.commercial_fiscal_policies;
drop trigger product_fiscal_classifications_same_business on public.product_fiscal_classifications;
drop trigger fiscal_documents_fulfill_print_requests on public.fiscal_documents;
drop trigger fiscal_document_items_protect_authorized on public.fiscal_document_items;

-- ── Restricciones nuevas o cambiadas sobre tablas que ya existían ─────────
alter table public.fiscal_documents drop constraint fiscal_documents_source_snapshot_id_fkey;
alter table public.fiscal_documents drop constraint fiscal_documents_dispatch_count_check;
alter table public.fiscal_documents drop constraint fiscal_documents_dispatch_consistency;
alter table public.fiscal_outbox drop constraint fiscal_outbox_lease_epoch_check;
alter table public.fiscal_accounting_policies drop constraint fiscal_accounting_policies_recipient_vat_condition_id_check;
alter table public.fiscal_documents drop constraint fiscal_documents_recipient_vat_condition_id_check;
alter table public.fiscal_documents drop constraint fiscal_documents_artifact_requires_authorization;
alter table public.fiscal_artifact_outbox drop constraint fiscal_artifact_outbox_lease_epoch_check;
alter table public.fiscal_documents drop constraint fiscal_documents_state_check;

-- ── Índices nuevos sobre tablas que ya existían ───────────────────────────

-- ── Columnas nuevas sobre tablas que ya existían ──────────────────────────
alter table public.fiscal_outbox drop column lease_epoch;
alter table public.fiscal_request_attempts drop column lease_epoch;
alter table public.fiscal_request_attempts drop column document_number;
alter table public.fiscal_documents drop column recipient_vat_condition_id;
alter table public.fiscal_documents drop column dispatch_count;
alter table public.fiscal_documents drop column last_dispatch_at;
alter table public.fiscal_documents drop column source_snapshot_id;
alter table public.fiscal_accounting_policies drop column recipient_vat_condition_id;
alter table public.fiscal_artifact_outbox drop column lease_epoch;

-- ── Tablas nuevas ─────────────────────────────────────────────────────────
drop table public.fiscal_idempotency_keys, public.fiscal_source_snapshots, public.commercial_fiscal_policies, public.product_fiscal_classifications, public.fiscal_print_requests;

-- ── Funciones nuevas ──────────────────────────────────────────────────────
drop function private.fiscal_max_dispatches();
drop function private.fiscal_reconcile_backoff(integer);
drop function private.fiscal_dispatch_margin();
drop function reserve_fiscal_document_number(uuid,text,bigint,bigint,date);
drop function claim_fiscal_outbox(text,text,text,integer,integer);
drop function begin_fiscal_resend(uuid,text,bigint,bigint);
drop function complete_fiscal_attempt(uuid,text,bigint,jsonb);
drop function private.commercial_fiscal_policies_guard();
drop function private.product_fiscal_classifications_same_business();
drop function private.fiscal_resend_quiet_period(integer);
drop function private.fiscal_credit_note_inherit_vat_condition();
drop function private.fiscal_invoice_fingerprint(uuid,text,uuid,text);
drop function private.fiscal_canonical_amount(text);
drop function private.fiscal_credit_note_fingerprint(uuid,text,text,jsonb);
drop function private.fiscal_record_intent_replay(fiscal_documents,text,uuid,text,text);
drop function request_fiscal_document(uuid,text,uuid,text,text,text);
drop function private.fiscal_request_invoice(uuid,text,uuid,text,text,text,uuid,text);
drop function service_request_fiscal_document(uuid,text,uuid,text,text,text,uuid);
drop function complete_fiscal_artifact(uuid,text,bigint,jsonb);
drop function fail_fiscal_artifact(uuid,text,bigint,text,text,boolean);
drop function private.fiscal_state_transition_allowed(text,text);
drop function private.fiscal_document_under_construction(fiscal_documents);
drop function private.fiscal_documents_guard_state();
drop function private.print_job_transition_allowed(text,text);
drop function private.print_jobs_guard_status();
drop function private.fiscal_vat_rate(integer);
drop function private.fiscal_freeze_source_snapshot(uuid,text,uuid,jsonb,uuid,text);
drop function private.fiscal_request_invoice_from_snapshot(uuid,text,uuid,text,text,text,uuid,text,fiscal_profiles,text);
drop function private.fiscal_source_snapshots_immutable();
drop function private.fiscal_documents_keep_source_snapshot();
drop function private.allocate_cents(bigint,bigint[]);
drop function private.order_payment_state(orders);
drop function private.commercial_order_item_product(uuid,uuid,text);
drop function private.commercial_order_fiscal_evaluation(uuid,uuid,boolean);
drop function private.commercial_fulfill_fiscal_print(uuid);
drop function private.commercial_register_fiscal_print(uuid,uuid,text,text);
drop function private.fiscal_documents_fulfill_print_requests();
drop function private.commercial_prepare_order_invoice(uuid,uuid,uuid,text);
drop function request_order_invoice(uuid,uuid,text,text,boolean);
drop function service_request_order_invoice(uuid,uuid,text,text,uuid,boolean);
drop function get_order_fiscal_states(uuid,uuid[]);

-- ── Funciones que la línea fiscal reemplazó por otra firma: vuelven como estaban ───
CREATE OR REPLACE FUNCTION public.request_fiscal_document(p_business_id uuid, p_source_type text, p_source_id uuid, p_document_intent text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.claim_fiscal_outbox(p_worker_id text, p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 90)
 RETURNS SETOF fiscal_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if btrim(coalesce(p_worker_id,'')) !~ '^[A-Za-z0-9._-]{3,80}$' or p_limit not between 1 and 50 or p_lease_seconds not between 30 and 300 then raise exception 'parametros de lease invalidos' using errcode='22023'; end if;
  return query
  with candidates as (
    select o.id from public.fiscal_outbox o
    where ((o.state in ('pending','retry_wait') and o.next_attempt_at <= now()) or (o.state='leased' and o.lease_deadline < now()))
    order by o.next_attempt_at,o.created_at
    for update skip locked
    limit p_limit
  )
  update public.fiscal_outbox o
  set state='leased',lease_owner=p_worker_id,lease_deadline=now()+make_interval(secs=>p_lease_seconds),attempt_count=o.attempt_count+1
  from candidates c where o.id=c.id returning o.*;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_fiscal_document_number(p_document_id uuid, p_worker_id text, p_expected_number bigint)
 RETURNS fiscal_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_document public.fiscal_documents%rowtype;
  v_outbox public.fiscal_outbox%rowtype;
begin
  if p_expected_number < 1 then raise exception 'numero fiscal invalido' using errcode='22023'; end if;
  select d.* into v_document from public.fiscal_documents d where d.id=p_document_id for update;
  if not found then raise exception 'documento fiscal inexistente' using errcode='P0002'; end if;
  select o.* into v_outbox from public.fiscal_outbox o where o.fiscal_document_id=p_document_id for update;
  if not found or v_outbox.state<>'leased' or v_outbox.lease_owner<>p_worker_id or v_outbox.lease_deadline<=now() then raise exception 'lease fiscal invalido' using errcode='PT409'; end if;
  if v_document.state in ('authorized','credited') or v_document.document_number is not null then return v_document; end if;
  if v_document.document_type < 1 then raise exception 'tipo de comprobante requiere revision fiscal' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',v_document.environment,v_document.cuit,v_document.point_of_sale,v_document.document_type),0));
  if exists(select 1 from public.fiscal_documents d where d.environment=v_document.environment and d.cuit=v_document.cuit and d.point_of_sale=v_document.point_of_sale and d.document_type=v_document.document_type and d.document_number=p_expected_number and d.id<>v_document.id) then
    raise exception 'numero fiscal ya reservado localmente' using errcode='PT409';
  end if;
  update public.fiscal_documents set document_number=p_expected_number,state='authorizing' where id=p_document_id returning * into v_document;
  return v_document;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_fiscal_attempt(p_outbox_id uuid, p_worker_id text, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_outbox public.fiscal_outbox%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_class text;
  v_cae text;
begin
  select o.* into v_outbox from public.fiscal_outbox o where o.id=p_outbox_id for update;
  if not found or v_outbox.state <> 'leased' or v_outbox.lease_owner <> p_worker_id or v_outbox.lease_deadline <= now() then raise exception 'lease fiscal invalido' using errcode='PT409'; end if;
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
  elsif v_class='ambiguous' then
    update public.fiscal_documents set state='ambiguous',result='ambiguous',errors=coalesce(p_result->'errors','[]'::jsonb) where id=v_document.id;
    update public.fiscal_outbox set state='retry_wait',next_attempt_at=now()+interval '60 seconds',lease_owner=null,lease_deadline=null,last_error_code='AMBIGUOUS',last_error_message='Se consultara antes de reenviar' where id=v_outbox.id;
  elsif v_class='rejected' then
    update public.fiscal_documents set state='rejected',result='rejected',observations=coalesce(p_result->'observations','[]'::jsonb),errors=coalesce(p_result->'errors','[]'::jsonb) where id=v_document.id;
    if v_document.document_intent='credit_note' then update public.fiscal_credit_allocations set state='released' where credit_document_id=v_document.id and state='reserved'; end if;
    update public.fiscal_outbox set state='dead_letter',processed_at=now(),lease_owner=null,lease_deadline=null,last_error_code='ARCA_REJECTED' where id=v_outbox.id;
  elsif p_result->>'error_code' in ('REQUIRES_FISCAL_REVIEW','ARCA_RECONCILIATION_MISMATCH') then
    update public.fiscal_documents set state='failed',result='configuration_error',errors=coalesce(p_result->'errors','[]'::jsonb) where id=v_document.id;
    if v_document.document_intent='credit_note' then update public.fiscal_credit_allocations set state='released' where credit_document_id=v_document.id and state='reserved'; end if;
    update public.fiscal_outbox set state='dead_letter',processed_at=now(),lease_owner=null,lease_deadline=null,last_error_code=coalesce(p_result->>'error_code','REQUIRES_FISCAL_REVIEW'),last_error_message=case when p_result->>'error_code'='ARCA_RECONCILIATION_MISMATCH' then 'La consulta ARCA no coincide; requiere revision' else 'Requiere datos fiscales o revision' end where id=v_outbox.id;
  else
    update public.fiscal_documents set state='retry_wait',result=coalesce(v_class,'service_error') where id=v_document.id;
    update public.fiscal_outbox set state=case when attempt_count>=8 then 'dead_letter' else 'retry_wait' end,next_attempt_at=now()+least(interval '30 minutes',make_interval(secs=>30*(2^least(attempt_count,6)))),lease_owner=null,lease_deadline=null,last_error_code=left(coalesce(p_result->>'error_code','SERVICE_ERROR'),80),last_error_message=left(coalesce(p_result->>'error_message',''),300) where id=v_outbox.id;
  end if;
  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,sanitized_detail)
  values(v_document.id,coalesce(v_class,'service_error'),'worker',p_result-'token'-'sign'-'certificate'-'private_key'-'service_role');
  return jsonb_build_object('fiscal_document_id',v_document.id,'state',(select state from public.fiscal_documents where id=v_document.id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.fail_fiscal_artifact(p_artifact_outbox_id uuid, p_worker_id text, p_error_code text, p_error_message text, p_retryable boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_outbox public.fiscal_artifact_outbox%rowtype;
  v_dead_letter boolean;
begin
  if coalesce(p_error_code,'') !~ '^[A-Z0-9_]{3,80}$' then raise exception 'codigo de artefacto invalido' using errcode = '22023'; end if;
  select o.* into v_outbox from public.fiscal_artifact_outbox o where o.id = p_artifact_outbox_id for update;
  if not found or v_outbox.state <> 'leased' or v_outbox.lease_owner <> p_worker_id then
    raise exception 'lease de artefacto invalido' using errcode = 'PT409';
  end if;
  v_dead_letter := not coalesce(p_retryable, true) or v_outbox.attempt_count >= 8;
  update public.fiscal_artifact_outbox
    set state = case when v_dead_letter then 'dead_letter' else 'retry_wait' end,
        processed_at = case when v_dead_letter then now() else null end,
        next_attempt_at = case when v_dead_letter then next_attempt_at else now() + least(interval '30 minutes', make_interval(secs => 30 * (2 ^ least(attempt_count, 6)))) end,
        lease_owner = null, lease_deadline = null,
        last_error_code = p_error_code, last_error_message = left(coalesce(p_error_message,''), 300)
    where id = v_outbox.id;
  update public.fiscal_documents
    set artifact_state = 'artifact_failed', artifact_error_code = p_error_code,
        artifact_error_message = left(coalesce(p_error_message,''), 300), artifact_updated_at = now()
    where id = v_outbox.fiscal_document_id;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
  values (v_outbox.fiscal_document_id, 'artifact_failed', 'worker', jsonb_build_object('error_code', p_error_code, 'retryable', not v_dead_letter));
  return jsonb_build_object('fiscal_document_id', v_outbox.fiscal_document_id, 'state', case when v_dead_letter then 'artifact_failed' else 'artifact_pending' end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_fiscal_artifact(p_artifact_outbox_id uuid, p_worker_id text, p_artifact jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if not (coalesce(p_artifact, '{}'::jsonb) ?& array[
    'artifact_type','storage_provider','storage_path','mime_type','size_bytes',
    'sha256','generated_at','generated_by','generation_version'
  ]) then
    raise exception 'metadata de artefacto incompleta' using errcode = '22023';
  end if;
  return public.complete_fiscal_artifact_unchecked(p_artifact_outbox_id, p_worker_id, p_artifact);
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_fiscal_artifact_unchecked(p_artifact_outbox_id uuid, p_worker_id text, p_artifact jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_outbox public.fiscal_artifact_outbox%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_artifact public.fiscal_document_artifacts%rowtype;
  v_supersedes uuid;
  v_expected_path text;
  v_sha256 text;
  v_size bigint;
begin
  if coalesce(p_artifact,'{}'::jsonb) - array['artifact_type','storage_provider','storage_path','mime_type','size_bytes','sha256','generated_at','generated_by','generation_version'] <> '{}'::jsonb then
    raise exception 'metadata de artefacto no permitida' using errcode = '22023';
  end if;
  select o.* into v_outbox from public.fiscal_artifact_outbox o where o.id = p_artifact_outbox_id for update;
  if not found or v_outbox.state <> 'leased' or v_outbox.lease_owner <> p_worker_id or v_outbox.lease_deadline <= now() then
    raise exception 'lease de artefacto invalido' using errcode = 'PT409';
  end if;
  select d.* into v_document from public.fiscal_documents d where d.id = v_outbox.fiscal_document_id for share;
  if v_document.state not in ('authorized','credited') or v_document.cae !~ '^[0-9]{14}$' or v_document.document_number is null then
    raise exception 'el comprobante no esta autorizado para generar PDF' using errcode = 'P0001';
  end if;
  v_expected_path := public.fiscal_artifact_storage_path(v_document.business_id, v_document.id, v_outbox.generation_token);
  v_sha256 := lower(coalesce(p_artifact->>'sha256',''));
  v_size := coalesce((p_artifact->>'size_bytes')::bigint, 0);
  if p_artifact->>'artifact_type' <> 'authorized_pdf'
    or p_artifact->>'storage_provider' <> 'supabase_storage'
    or p_artifact->>'storage_path' <> v_expected_path
    or p_artifact->>'mime_type' <> 'application/pdf'
    or v_sha256 !~ '^[0-9a-f]{64}$'
    or v_size not between 1 and 16777216
    or char_length(coalesce(p_artifact->>'generation_version','')) not between 1 and 80
    or char_length(coalesce(p_artifact->>'generated_by','')) not between 3 and 80
  then raise exception 'metadata de artefacto invalida' using errcode = '22023'; end if;

  select a.* into v_artifact from public.fiscal_document_artifacts a where a.generation_token = v_outbox.generation_token for update;
  if found then
    update public.fiscal_artifact_outbox set state = 'completed', processed_at = now(), lease_owner = null, lease_deadline = null where id = v_outbox.id;
    update public.fiscal_documents set artifact_state = 'artifact_ready', artifact_error_code = null, artifact_error_message = null, artifact_updated_at = now() where id = v_document.id;
    return jsonb_build_object('artifact_id', v_artifact.id, 'idempotent_replay', true);
  end if;

  select a.id into v_supersedes
  from public.fiscal_document_artifacts a
  where a.fiscal_document_id = v_document.id and a.artifact_type = 'authorized_pdf' and a.is_current
  for update;

  update public.fiscal_document_artifacts
    set is_current = false, state = 'artifact_superseded', superseded_at = now()
    where id = v_supersedes;

  insert into public.fiscal_document_artifacts(
    business_id, fiscal_document_id, artifact_type, state, storage_provider, storage_path,
    mime_type, size_bytes, sha256, document_number, generated_at, generated_by,
    generation_version, generation_token, is_current, supersedes_artifact_id
  ) values (
    v_document.business_id, v_document.id, 'authorized_pdf', 'artifact_ready', 'supabase_storage', v_expected_path,
    'application/pdf', v_size, v_sha256, v_document.document_number,
    coalesce((p_artifact->>'generated_at')::timestamptz, now()), p_artifact->>'generated_by',
    p_artifact->>'generation_version', v_outbox.generation_token, true, v_supersedes
  ) returning * into v_artifact;

  update public.fiscal_artifact_outbox
    set state = 'completed', processed_at = now(), lease_owner = null, lease_deadline = null,
        last_error_code = null, last_error_message = null
    where id = v_outbox.id;
  update public.fiscal_documents
    set artifact_state = 'artifact_ready', artifact_error_code = null, artifact_error_message = null, artifact_updated_at = now()
    where id = v_document.id;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
  values (v_document.id, 'artifact_ready', 'worker', jsonb_build_object(
    'artifact_id', v_artifact.id, 'sha256', v_sha256, 'size_bytes', v_size,
    'generation_version', v_artifact.generation_version, 'supersedes_artifact_id', v_supersedes
  ));
  return jsonb_build_object('artifact_id', v_artifact.id, 'idempotent_replay', false);
end;
$function$;


-- ── Funciones cambiadas: vuelven al cuerpo anterior ───────────────────────
CREATE OR REPLACE FUNCTION public.protect_authorized_fiscal_document_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_document_id uuid;
declare v_state text;
begin
  v_document_id := case when tg_op='DELETE' then old.fiscal_document_id else new.fiscal_document_id end;
  select state into v_state from public.fiscal_documents where id=v_document_id;
  if v_state in ('authorized','credited') then raise exception 'los items de un comprobante autorizado son inmutables' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_authorized_fiscal_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.save_fiscal_parameter_snapshot(p_environment text, p_parameter_type text, p_version text, p_values_json jsonb, p_synchronized_at timestamp with time zone)
 RETURNS fiscal_parameter_snapshots
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_authorized_fiscal_artifact()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if new.state = 'authorized' and old.state is distinct from 'authorized' then
    insert into public.fiscal_artifact_outbox(fiscal_document_id)
    values (new.id)
    on conflict(fiscal_document_id) do nothing;
    update public.fiscal_documents
      set artifact_state = 'artifact_pending', artifact_error_code = null, artifact_error_message = null, artifact_updated_at = now()
      where id = new.id;
    insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, sanitized_detail)
    values (new.id, 'artifact_pending', 'system', jsonb_build_object('required', true));
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_fiscal_accounting_policy(p_business_id uuid, p_environment text, p_issuer_condition text, p_recipient_condition text, p_concept integer, p_invoice_type integer, p_effective_on date)
 RETURNS fiscal_accounting_policies
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.claim_fiscal_artifact_outbox(p_worker_id text, p_limit integer DEFAULT 5, p_lease_seconds integer DEFAULT 120)
 RETURNS SETOF fiscal_artifact_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if btrim(coalesce(p_worker_id,'')) !~ '^[A-Za-z0-9._-]{3,80}$'
    or p_limit not between 1 and 50
    or p_lease_seconds not between 30 and 300
  then raise exception 'parametros de lease de artefacto invalidos' using errcode = '22023'; end if;

  return query
  with candidates as (
    select o.id
    from public.fiscal_artifact_outbox o
    where (o.state in ('pending','retry_wait') and o.next_attempt_at <= now())
       or (o.state = 'leased' and o.lease_deadline < now())
    order by o.next_attempt_at, o.created_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.fiscal_artifact_outbox o
      set state = 'leased', lease_owner = p_worker_id,
          lease_deadline = now() + make_interval(secs => p_lease_seconds),
          attempt_count = o.attempt_count + 1
    from candidates c
    where o.id = c.id
    returning o.*
  ), documented as (
    update public.fiscal_documents d
      set artifact_state = 'artifact_generating', artifact_error_code = null,
          artifact_error_message = null, artifact_updated_at = now()
    from claimed c
    where d.id = c.fiscal_document_id
    returning d.id
  )
  select c.* from claimed c;
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_credit_note_unchecked(p_original_document_id uuid, p_reason text, p_credit_kind text, p_lines jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_original public.fiscal_documents%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_existing public.fiscal_documents%rowtype;
  v_profile public.fiscal_profiles%rowtype;
  v_policy public.fiscal_accounting_policies%rowtype;
  v_line jsonb;
  v_item public.fiscal_document_items%rowtype;
  v_reserved_quantity numeric(14,3);
  v_reserved_net numeric(14,2);
  v_reserved_tax numeric(14,2);
  v_reserved_exempt numeric(14,2);
  v_reserved_non_taxed numeric(14,2);
  v_reserved_other numeric(14,2);
  v_quantity numeric(14,3);
  v_net numeric(14,2);
  v_tax numeric(14,2);
  v_exempt numeric(14,2);
  v_non_taxed numeric(14,2);
  v_other numeric(14,2);
  v_total numeric(14,2) := 0;
  v_total_net numeric(14,2) := 0;
  v_total_tax numeric(14,2) := 0;
  v_total_exempt numeric(14,2) := 0;
  v_total_non_taxed numeric(14,2) := 0;
  v_total_other numeric(14,2) := 0;
  v_issuer_condition text;
  v_recipient_condition text;
begin
  if p_credit_kind not in ('total','partial','commercial_adjustment')
    or jsonb_typeof(coalesce(p_lines,'[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_lines,'[]'::jsonb)) > 200
    or char_length(btrim(coalesce(p_reason,''))) not between 5 and 300
    or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9:_-]{8,128}$'
  then raise exception 'solicitud de nota de credito invalida' using errcode='22023'; end if;
  select d.* into v_original from public.fiscal_documents d where d.id = p_original_document_id for update;
  if not found then raise exception 'comprobante original inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_original.business_id,array['owner','admin']) then raise exception 'owner/admin requerido' using errcode='42501'; end if;
  if v_original.state not in ('authorized','credited') or v_original.document_intent <> 'invoice' or v_original.document_type < 1 then raise exception 'solo una factura autorizada admite nota de credito' using errcode='P0001'; end if;
  select d.* into v_existing from public.fiscal_documents d where d.business_id = v_original.business_id and d.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.document_intent <> 'credit_note' or v_existing.associated_document_id <> v_original.id then raise exception 'idempotency_key reutilizada con otra solicitud' using errcode='23505'; end if;
    return jsonb_build_object('fiscal_document_id',v_existing.id,'state',v_existing.state,'idempotent_replay',true);
  end if;
  select fp.* into v_profile from public.fiscal_profiles fp where fp.business_id = v_original.business_id for share;
  v_issuer_condition := coalesce(nullif(btrim(v_original.issuer_snapshot->>'tax_condition'),''), v_profile.tax_condition, '');
  v_recipient_condition := coalesce(nullif(btrim(v_original.recipient_snapshot->>'condition'),''), nullif(btrim(v_original.recipient_type),''), '');
  v_policy := public.resolve_fiscal_accounting_policy(v_original.business_id, v_original.environment, v_issuer_condition, v_recipient_condition, v_original.concept, v_original.document_type, current_date);
  if p_credit_kind = 'commercial_adjustment' and not v_policy.allow_commercial_adjustment then raise exception 'fiscal_policy_review_required' using errcode='P0001'; end if;
  if p_credit_kind = 'total' and jsonb_array_length(p_lines) <> 0 then raise exception 'nota total no admite lineas manuales' using errcode='22023'; end if;
  if p_credit_kind <> 'total' and jsonb_array_length(p_lines) = 0 then raise exception 'nota parcial requiere lineas precisas' using errcode='22023'; end if;
  if p_credit_kind <> 'total' and (select count(distinct value->>'original_item_id') from jsonb_array_elements(p_lines)) <> jsonb_array_length(p_lines) then raise exception 'lineas de nota duplicadas' using errcode='22023'; end if;

  insert into public.fiscal_documents(
    business_id,source_type,source_id,document_intent,environment,cuit,point_of_sale,document_type,concept,currency,currency_rate,
    recipient_type,recipient_document_type,recipient_document_number,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,
    state,idempotency_key,associated_document_id,issuer_snapshot,recipient_snapshot,associated_document_snapshot,fiscal_policy_version,credit_kind,credit_reason
  ) values (
    v_original.business_id,'credit_note',gen_random_uuid(),'credit_note',v_original.environment,v_original.cuit,v_original.point_of_sale,v_policy.credit_note_type,v_original.concept,v_original.currency,v_original.currency_rate,
    v_original.recipient_type,v_original.recipient_document_type,v_original.recipient_document_number,0,0,0,0,0,0,
    'queued',p_idempotency_key,v_original.id,v_original.issuer_snapshot,v_original.recipient_snapshot,
    jsonb_build_object('fiscal_document_id',v_original.id,'document_type',v_original.document_type,'point_of_sale',v_original.point_of_sale,'document_number',v_original.document_number,'issue_date',v_original.issue_date,'cae',v_original.cae),
    v_policy.policy_version,p_credit_kind,btrim(p_reason)
  ) returning * into v_document;

  if p_credit_kind = 'total' then
    for v_item in select * from public.fiscal_document_items i where i.fiscal_document_id = v_original.id order by i.id for share
    loop
      select coalesce(sum(a.quantity) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.net_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.tax_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.exempt_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.non_taxed_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.other_taxes_amount) filter(where a.state in ('reserved','authorized')),0)
        into v_reserved_quantity,v_reserved_net,v_reserved_tax,v_reserved_exempt,v_reserved_non_taxed,v_reserved_other
      from public.fiscal_credit_allocations a where a.original_item_id = v_item.id;
      v_quantity := v_item.quantity - v_reserved_quantity;
      v_net := v_item.net_amount - v_reserved_net;
      v_tax := v_item.tax_amount - v_reserved_tax;
      v_exempt := v_item.exempt_amount - v_reserved_exempt;
      v_non_taxed := v_item.non_taxed_amount - v_reserved_non_taxed;
      v_other := v_item.other_taxes_amount - v_reserved_other;
      if v_quantity <= 0 or (v_net + v_tax + v_exempt + v_non_taxed + v_other) <= 0 then continue; end if;
      insert into public.fiscal_document_items(fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount,tax_code,exempt_amount,non_taxed_amount,other_taxes_amount,tax_snapshot)
      values(v_document.id,concat('Nota de credito: ',v_item.description),v_quantity,round((v_net+v_tax+v_exempt+v_non_taxed+v_other)/v_quantity,2),v_net,v_tax,v_item.tax_code,v_exempt,v_non_taxed,v_other,v_item.tax_snapshot);
      insert into public.fiscal_credit_allocations(business_id,original_document_id,original_item_id,credit_document_id,quantity,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,snapshot)
      values(v_original.business_id,v_original.id,v_item.id,v_document.id,v_quantity,v_net,v_tax,v_exempt,v_non_taxed,v_other,v_net+v_tax+v_exempt+v_non_taxed+v_other,jsonb_build_object('original_item_id',v_item.id,'original_quantity',v_item.quantity,'credit_kind',p_credit_kind));
      v_total_net := v_total_net + v_net; v_total_tax := v_total_tax + v_tax; v_total_exempt := v_total_exempt + v_exempt; v_total_non_taxed := v_total_non_taxed + v_non_taxed; v_total_other := v_total_other + v_other;
    end loop;
  else
    for v_line in select value from jsonb_array_elements(p_lines)
    loop
      if v_line - array['original_item_id','quantity','net_amount','tax_amount'] <> '{}'::jsonb
        or coalesce(v_line->>'original_item_id','') !~ '^[0-9a-fA-F-]{36}$'
        or coalesce(v_line->>'quantity','') !~ '^[0-9]+([.][0-9]{1,3})?$'
      then raise exception 'linea de nota invalida' using errcode='22023'; end if;
      select i.* into v_item from public.fiscal_document_items i where i.id = (v_line->>'original_item_id')::uuid and i.fiscal_document_id = v_original.id for share;
      if not found then raise exception 'item original invalido' using errcode='P0002'; end if;
      select coalesce(sum(a.quantity) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.net_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.tax_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.exempt_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.non_taxed_amount) filter(where a.state in ('reserved','authorized')),0),
             coalesce(sum(a.other_taxes_amount) filter(where a.state in ('reserved','authorized')),0)
        into v_reserved_quantity,v_reserved_net,v_reserved_tax,v_reserved_exempt,v_reserved_non_taxed,v_reserved_other
      from public.fiscal_credit_allocations a where a.original_item_id = v_item.id;
      v_quantity := (v_line->>'quantity')::numeric;
      if v_quantity <= 0 or v_quantity > v_item.quantity - v_reserved_quantity then raise exception 'importe o cantidad excede el saldo acreditable' using errcode='23514'; end if;
      if p_credit_kind = 'partial' then
        if v_quantity = v_item.quantity - v_reserved_quantity then
          v_net := v_item.net_amount - v_reserved_net; v_tax := v_item.tax_amount - v_reserved_tax; v_exempt := v_item.exempt_amount - v_reserved_exempt; v_non_taxed := v_item.non_taxed_amount - v_reserved_non_taxed; v_other := v_item.other_taxes_amount - v_reserved_other;
        else
          v_net := round(v_item.net_amount * v_quantity / v_item.quantity,2); v_tax := round(v_item.tax_amount * v_quantity / v_item.quantity,2); v_exempt := round(v_item.exempt_amount * v_quantity / v_item.quantity,2); v_non_taxed := round(v_item.non_taxed_amount * v_quantity / v_item.quantity,2); v_other := round(v_item.other_taxes_amount * v_quantity / v_item.quantity,2);
        end if;
      else
        if coalesce(v_line->>'net_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$' or coalesce(v_line->>'tax_amount','') !~ '^[0-9]+([.][0-9]{1,2})?$' then raise exception 'ajuste comercial requiere importes precisos' using errcode='22023'; end if;
        v_net := (v_line->>'net_amount')::numeric; v_tax := (v_line->>'tax_amount')::numeric; v_exempt := 0; v_non_taxed := 0; v_other := 0;
        if v_net > v_item.net_amount - v_reserved_net or v_tax > v_item.tax_amount - v_reserved_tax then raise exception 'importe o cantidad excede el saldo acreditable' using errcode='23514'; end if;
      end if;
      if v_net + v_tax + v_exempt + v_non_taxed + v_other <= 0 then raise exception 'nota de credito sin importe' using errcode='22023'; end if;
      insert into public.fiscal_document_items(fiscal_document_id,description,quantity,unit_price,net_amount,tax_amount,tax_code,exempt_amount,non_taxed_amount,other_taxes_amount,tax_snapshot)
      values(v_document.id,concat('Nota de credito: ',v_item.description),v_quantity,round((v_net+v_tax+v_exempt+v_non_taxed+v_other)/v_quantity,2),v_net,v_tax,v_item.tax_code,v_exempt,v_non_taxed,v_other,v_item.tax_snapshot);
      insert into public.fiscal_credit_allocations(business_id,original_document_id,original_item_id,credit_document_id,quantity,net_amount,tax_amount,exempt_amount,non_taxed_amount,other_taxes_amount,total_amount,snapshot)
      values(v_original.business_id,v_original.id,v_item.id,v_document.id,v_quantity,v_net,v_tax,v_exempt,v_non_taxed,v_other,v_net+v_tax+v_exempt+v_non_taxed+v_other,jsonb_build_object('original_item_id',v_item.id,'original_quantity',v_item.quantity,'credit_kind',p_credit_kind));
      v_total_net := v_total_net + v_net; v_total_tax := v_total_tax + v_tax; v_total_exempt := v_total_exempt + v_exempt; v_total_non_taxed := v_total_non_taxed + v_non_taxed; v_total_other := v_total_other + v_other;
    end loop;
  end if;
  v_total := v_total_net + v_total_tax + v_total_exempt + v_total_non_taxed + v_total_other;
  if v_total <= 0 then raise exception 'no existe saldo acreditable' using errcode='23514'; end if;
  update public.fiscal_documents
    set net_amount=v_total_net,tax_amount=v_total_tax,exempt_amount=v_total_exempt,non_taxed_amount=v_total_non_taxed,other_taxes_amount=v_total_other,total_amount=v_total
    where id=v_document.id;
  insert into public.fiscal_outbox(fiscal_document_id) values(v_document.id);
  insert into public.fiscal_events(fiscal_document_id,event_type,actor_type,actor_id,sanitized_detail)
  values(v_document.id,'credit_note_queued','operator',auth.uid(),jsonb_build_object('reason',btrim(p_reason),'associated_document_id',v_original.id,'credit_kind',p_credit_kind,'policy_version',v_policy.policy_version));
  return jsonb_build_object('fiscal_document_id',v_document.id,'state','queued','idempotent_replay',false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_fiscal_artifact_regeneration(p_fiscal_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_document public.fiscal_documents%rowtype;
  v_outbox public.fiscal_artifact_outbox%rowtype;
begin
  select d.* into v_document from public.fiscal_documents d where d.id = p_fiscal_document_id for update;
  if not found then raise exception 'comprobante fiscal inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_document.business_id, array['owner','admin']) then raise exception 'owner/admin requerido para regenerar' using errcode = '42501'; end if;
  if v_document.state not in ('authorized','credited') then raise exception 'solo se regenera un comprobante autorizado' using errcode = 'P0001'; end if;
  select o.* into v_outbox from public.fiscal_artifact_outbox o where o.fiscal_document_id = v_document.id for update;
  if found and v_outbox.state = 'leased' and v_outbox.lease_deadline > now() then raise exception 'ya existe una generacion en curso' using errcode = 'PT409'; end if;
  if found then
    update public.fiscal_artifact_outbox
      set state = 'pending', generation_token = gen_random_uuid(), lease_owner = null, lease_deadline = null,
          next_attempt_at = now(), last_error_code = null, last_error_message = null, processed_at = null
      where id = v_outbox.id;
  else
    insert into public.fiscal_artifact_outbox(fiscal_document_id) values (v_document.id);
  end if;
  update public.fiscal_documents
    set artifact_state = 'artifact_pending', artifact_error_code = null, artifact_error_message = null, artifact_updated_at = now()
    where id = v_document.id;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, actor_id, sanitized_detail)
  values(v_document.id, 'artifact_regeneration_requested', 'operator', auth.uid(), jsonb_build_object('authorized', true));
  return jsonb_build_object('fiscal_document_id', v_document.id, 'artifact_state', 'artifact_pending');
end;
$function$;

CREATE OR REPLACE FUNCTION public.authorize_fiscal_artifact_access(p_artifact_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_artifact public.fiscal_document_artifacts%rowtype;
begin
  if p_action not in ('preview','download','print') then raise exception 'accion de artefacto invalida' using errcode = '22023'; end if;
  select a.* into v_artifact from public.fiscal_document_artifacts a where a.id = p_artifact_id and a.is_current and a.state = 'artifact_ready';
  if not found then raise exception 'artefacto fiscal no disponible' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_artifact.business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, actor_id, sanitized_detail)
  values(v_artifact.fiscal_document_id, concat('artifact_', p_action, '_authorized'), 'operator', auth.uid(), jsonb_build_object('artifact_id', v_artifact.id));
  return jsonb_build_object(
    'artifact_id', v_artifact.id,
    'mime_type', v_artifact.mime_type,
    'sha256', v_artifact.sha256,
    'expires_in_seconds', 60
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_credit_note(p_original_document_id uuid, p_reason text, p_credit_kind text, p_lines jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'lineas de nota invalidas' using errcode = '22023';
  end if;
  return public.request_credit_note_unchecked(
    p_original_document_id, p_reason, p_credit_kind, p_lines, p_idempotency_key
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_fiscal_print_job(p_print_job_id uuid, p_status text, p_error_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_job public.fiscal_print_jobs%rowtype;
begin
  if p_status not in ('queued','sent_to_spooler','completed_when_verifiable','failed','unknown')
    or (p_error_code is not null and p_error_code !~ '^[A-Z0-9_]{3,80}$')
  then raise exception 'estado de impresion invalido' using errcode = '22023'; end if;
  select j.* into v_job from public.fiscal_print_jobs j where j.id = p_print_job_id for update;
  if not found or not public.has_business_role(v_job.business_id, array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if v_job.status = 'completed_when_verifiable' then return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', true); end if;
  update public.fiscal_print_jobs
    set status = p_status,
        error_code = case when p_status = 'failed' then p_error_code else null end,
        completed_at = case when p_status = 'completed_when_verifiable' then now() else null end
    where id = v_job.id
    returning * into v_job;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, actor_id, sanitized_detail)
  values(v_job.fiscal_document_id, concat('print_', p_status), 'operator', auth.uid(), jsonb_build_object('print_job_id', v_job.id, 'error_code', case when p_status = 'failed' then p_error_code else null end));
  return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_fiscal_print_job(p_fiscal_document_id uuid, p_artifact_id uuid, p_printer_name_hash text, p_format text, p_copies integer, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_document public.fiscal_documents%rowtype;
  v_artifact public.fiscal_document_artifacts%rowtype;
  v_job public.fiscal_print_jobs%rowtype;
begin
  if p_printer_name_hash !~ '^[0-9a-f]{64}$'
    or p_format not in ('a4','thermal')
    or p_copies not between 1 and 5
    or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9:_-]{8,128}$'
  then raise exception 'solicitud de impresion invalida' using errcode = '22023'; end if;
  select d.* into v_document from public.fiscal_documents d where d.id = p_fiscal_document_id for share;
  if not found or not public.has_business_role(v_document.business_id, array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  select a.* into v_artifact from public.fiscal_document_artifacts a
    where a.id = p_artifact_id and a.fiscal_document_id = v_document.id and a.is_current and a.state = 'artifact_ready'
    for share;
  if not found then raise exception 'PDF fiscal no disponible para impresion' using errcode = 'P0001'; end if;
  select j.* into v_job from public.fiscal_print_jobs j where j.business_id = v_document.business_id and j.idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', true); end if;
  insert into public.fiscal_print_jobs(business_id, fiscal_document_id, artifact_id, printer_name_hash, format, copies, requested_by, idempotency_key)
  values(v_document.business_id, v_document.id, v_artifact.id, p_printer_name_hash, p_format, p_copies, auth.uid(), p_idempotency_key)
  returning * into v_job;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, actor_id, sanitized_detail)
  values(v_document.id, 'print_queued', 'operator', auth.uid(), jsonb_build_object('print_job_id', v_job.id, 'artifact_id', v_artifact.id, 'format', p_format, 'copies', p_copies));
  return jsonb_build_object('print_job_id', v_job.id, 'status', v_job.status, 'idempotent_replay', false);
end;
$function$;


-- ── Permisos de esas funciones ────────────────────────────────────────────
revoke all on function request_fiscal_document(uuid,text,uuid,text,text) from public, anon, authenticated; -- 20260802160000
grant execute on function request_fiscal_document(uuid,text,uuid,text,text) to authenticated; -- 20260802160000
revoke all on function claim_fiscal_outbox(text,integer,integer) from public, anon, authenticated; -- 20260802160000
grant execute on function claim_fiscal_outbox(text,integer,integer) to service_role; -- 20260802160000
revoke all on function reserve_fiscal_document_number(uuid,text,bigint) from public, anon, authenticated; -- 20260802160000
grant execute on function reserve_fiscal_document_number(uuid,text,bigint) to service_role; -- 20260802160000
revoke all on function complete_fiscal_attempt(uuid,text,jsonb) from public, anon, authenticated; -- 20260802160000
grant execute on function complete_fiscal_attempt(uuid,text,jsonb) to service_role; -- 20260802160000
revoke all on function fail_fiscal_artifact(uuid,text,text,text,boolean) from public, anon, authenticated; -- 20260802170000
grant execute on function fail_fiscal_artifact(uuid,text,text,text,boolean) to service_role; -- 20260802170000
revoke all on function complete_fiscal_artifact(uuid,text,jsonb) from public, anon, authenticated; -- 20260802170000
grant execute on function complete_fiscal_artifact(uuid,text,jsonb) to service_role; -- 20260802170000
revoke all on function complete_fiscal_artifact(uuid,text,jsonb) from public, anon, authenticated; -- 20260802171000
grant execute on function complete_fiscal_artifact(uuid,text,jsonb) to service_role; -- 20260802171000
revoke all on function complete_fiscal_artifact_unchecked(uuid,text,jsonb) from public, anon, authenticated, service_role; -- 20260802171000
do $restore_factory_acl$
declare
  v_fn regprocedure;
  v_grantee text;
begin
  foreach v_fn in array array['protect_authorized_fiscal_document_item()'::regprocedure, 'protect_authorized_fiscal_document()'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
    execute format('grant execute on function %s to public', v_fn);
    for v_grantee in
      select distinct case when a.grantee = 0 then 'public' else quote_ident(r.rolname) end
        from pg_catalog.pg_default_acl d
        cross join lateral aclexplode(d.defaclacl) a
        left join pg_catalog.pg_roles r on r.oid = a.grantee
       where d.defaclobjtype = 'f'
         and a.privilege_type = 'EXECUTE'
         and d.defaclrole = (select p.proowner from pg_catalog.pg_proc p where p.oid = v_fn)
         and d.defaclnamespace in (0, (select p.pronamespace from pg_catalog.pg_proc p where p.oid = v_fn))
         and a.grantee <> (select p.proowner from pg_catalog.pg_proc p where p.oid = v_fn)
    loop
      execute format('grant execute on function %s to %s', v_fn, v_grantee);
    end loop;
  end loop;
end;
$restore_factory_acl$;

-- ── Comentarios de esas funciones ─────────────────────────────────────────
comment on function request_fiscal_document(uuid,text,uuid,text,text) is null;
comment on function claim_fiscal_outbox(text,integer,integer) is 'RPC privada para worker fiscal; reclama trabajos con FOR UPDATE SKIP LOCKED.';
comment on function reserve_fiscal_document_number(uuid,text,bigint) is null;
comment on function complete_fiscal_attempt(uuid,text,jsonb) is null;
comment on function fail_fiscal_artifact(uuid,text,text,text,boolean) is null;
comment on function complete_fiscal_artifact(uuid,text,jsonb) is 'Exige metadata documental completa antes de persistir un artefacto privado.';
comment on function complete_fiscal_artifact_unchecked(uuid,text,jsonb) is null;

-- ── Restricciones, índices, disparadores y políticas anteriores ───────────
alter table public.fiscal_documents add constraint fiscal_documents_state_check CHECK ((state = ANY (ARRAY['draft'::text, 'queued'::text, 'claiming'::text, 'authenticating'::text, 'authorizing'::text, 'authorized'::text, 'observed'::text, 'rejected'::text, 'ambiguous'::text, 'retry_wait'::text, 'failed'::text, 'credited'::text])));
CREATE TRIGGER fiscal_document_items_protect_authorized BEFORE DELETE OR UPDATE ON public.fiscal_document_items FOR EACH ROW EXECUTE FUNCTION protect_authorized_fiscal_document_item();

-- ── Permisos de tablas y comentarios ──────────────────────────────────────

commit;
