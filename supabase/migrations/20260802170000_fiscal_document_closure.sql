-- Cierre documental fiscal: evidencia privada, reimpresion durable y notas de credito con politica aprobada.

alter table public.fiscal_profiles
  add column if not exists default_recipient_condition text;

alter table public.fiscal_documents
  add column if not exists concept integer not null default 1 check (concept in (1,2,3)),
  add column if not exists currency_rate numeric(16,6) not null default 1 check (currency_rate > 0),
  add column if not exists issuer_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists recipient_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists associated_document_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists fiscal_policy_version text,
  add column if not exists credit_kind text check (credit_kind is null or credit_kind in ('total','partial','commercial_adjustment')),
  add column if not exists credit_reason text,
  add column if not exists artifact_state text not null default 'artifact_pending'
    check (artifact_state in ('artifact_pending','artifact_generating','artifact_ready','artifact_failed','artifact_superseded')),
  add column if not exists artifact_error_code text,
  add column if not exists artifact_error_message text,
  add column if not exists artifact_updated_at timestamptz;

alter table public.fiscal_document_items
  add column if not exists exempt_amount numeric(14,2) not null default 0,
  add column if not exists non_taxed_amount numeric(14,2) not null default 0,
  add column if not exists other_taxes_amount numeric(14,2) not null default 0,
  add column if not exists tax_snapshot jsonb not null default '{}'::jsonb;

alter table public.fiscal_documents
  drop constraint if exists fiscal_documents_business_id_source_type_source_id_document_intent_key;

create unique index if not exists fiscal_documents_one_invoice_per_source_idx
  on public.fiscal_documents(business_id, source_type, source_id, document_intent)
  where document_intent = 'invoice';

create unique index if not exists fiscal_documents_business_idempotency_idx
  on public.fiscal_documents(business_id, idempotency_key);

create table if not exists public.fiscal_accounting_policies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  environment text not null check (environment in ('homologation','production')),
  policy_version text not null check (char_length(btrim(policy_version)) between 1 and 80),
  valid_from date not null,
  issuer_condition text not null check (char_length(btrim(issuer_condition)) between 1 and 80),
  recipient_condition text not null check (char_length(btrim(recipient_condition)) between 1 and 80),
  concept integer not null check (concept in (1,2,3)),
  invoice_type integer not null check (invoice_type > 0),
  credit_note_type integer not null check (credit_note_type > 0),
  recipient_document_type integer not null check (recipient_document_type > 0),
  recipient_document_number text not null check (recipient_document_number ~ '^[0-9]{1,20}$'),
  enabled boolean not null default false,
  allow_commercial_adjustment boolean not null default false,
  accountant_review_status text not null default 'pending'
    check (accountant_review_status in ('pending','approved','rejected')),
  approved_by uuid,
  approved_at timestamptz,
  notes text not null default '' check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id, environment, policy_version, invoice_type, recipient_condition, concept),
  constraint fiscal_accounting_policy_approval_check check (
    accountant_review_status <> 'approved' or (approved_by is not null and approved_at is not null)
  ),
  constraint fiscal_accounting_policy_enabled_check check (
    not enabled or accountant_review_status = 'approved'
  )
);

create index if not exists fiscal_accounting_policies_lookup_idx
  on public.fiscal_accounting_policies(business_id, environment, issuer_condition, recipient_condition, concept, invoice_type, valid_from desc)
  where enabled and accountant_review_status = 'approved';

create table if not exists public.fiscal_document_artifacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  fiscal_document_id uuid not null references public.fiscal_documents(id) on delete restrict,
  artifact_type text not null check (artifact_type in ('authorized_pdf')),
  state text not null default 'artifact_ready'
    check (state in ('artifact_ready','artifact_superseded')),
  storage_provider text not null check (storage_provider = 'supabase_storage'),
  storage_path text not null check (storage_path ~ '^fiscal/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.]pdf$'),
  mime_type text not null check (mime_type = 'application/pdf'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 16777216),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  document_number bigint not null check (document_number > 0),
  generated_at timestamptz not null,
  generated_by text not null check (char_length(generated_by) between 3 and 80),
  generation_version text not null check (char_length(generation_version) between 1 and 80),
  generation_token uuid not null unique,
  is_current boolean not null default true,
  supersedes_artifact_id uuid references public.fiscal_document_artifacts(id) on delete restrict,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  unique(storage_provider, storage_path)
);

create unique index if not exists fiscal_document_artifacts_one_current_idx
  on public.fiscal_document_artifacts(fiscal_document_id, artifact_type)
  where is_current;

create index if not exists fiscal_document_artifacts_business_document_idx
  on public.fiscal_document_artifacts(business_id, fiscal_document_id, generated_at desc);

create table if not exists public.fiscal_artifact_outbox (
  id uuid primary key default gen_random_uuid(),
  fiscal_document_id uuid not null unique references public.fiscal_documents(id) on delete restrict,
  state text not null default 'pending' check (state in ('pending','leased','retry_wait','completed','dead_letter')),
  generation_token uuid not null default gen_random_uuid(),
  lease_owner text,
  lease_deadline timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists fiscal_artifact_outbox_claim_idx
  on public.fiscal_artifact_outbox(state, next_attempt_at)
  where state in ('pending','retry_wait','leased');

create table if not exists public.fiscal_credit_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  original_document_id uuid not null references public.fiscal_documents(id) on delete restrict,
  original_item_id uuid not null references public.fiscal_document_items(id) on delete restrict,
  credit_document_id uuid not null references public.fiscal_documents(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  net_amount numeric(14,2) not null default 0 check (net_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  exempt_amount numeric(14,2) not null default 0 check (exempt_amount >= 0),
  non_taxed_amount numeric(14,2) not null default 0 check (non_taxed_amount >= 0),
  other_taxes_amount numeric(14,2) not null default 0 check (other_taxes_amount >= 0),
  total_amount numeric(14,2) not null check (total_amount > 0),
  state text not null default 'reserved' check (state in ('reserved','authorized','released')),
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(credit_document_id, original_item_id)
);

create index if not exists fiscal_credit_allocations_original_idx
  on public.fiscal_credit_allocations(original_document_id, original_item_id, state);

create table if not exists public.fiscal_print_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  fiscal_document_id uuid not null references public.fiscal_documents(id) on delete restrict,
  artifact_id uuid not null references public.fiscal_document_artifacts(id) on delete restrict,
  printer_name_hash text not null check (printer_name_hash ~ '^[0-9a-f]{64}$'),
  format text not null check (format in ('a4','thermal')),
  copies integer not null check (copies between 1 and 5),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  status text not null default 'queued'
    check (status in ('queued','sent_to_spooler','completed_when_verifiable','failed','unknown')),
  completed_at timestamptz,
  error_code text,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9:_-]{8,128}$'),
  created_at timestamptz not null default now(),
  unique(business_id, idempotency_key)
);

create index if not exists fiscal_print_jobs_document_idx
  on public.fiscal_print_jobs(business_id, fiscal_document_id, requested_at desc);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('fiscal-documents', 'fiscal-documents', false, 16777216, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fiscal documents service-only" on storage.objects;
create policy "fiscal documents service-only"
  on storage.objects for all to service_role
  using (bucket_id = 'fiscal-documents')
  with check (bucket_id = 'fiscal-documents');

create or replace function public.fiscal_json_contains_parameter_id(p_value jsonb, p_id integer)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $fiscal_json_contains_parameter_id$
declare
  v_child jsonb;
begin
  if p_value is null then return false; end if;
  if jsonb_typeof(p_value) = 'object' then
    if coalesce(p_value->>'Id', p_value->>'id') = p_id::text then return true; end if;
    for v_child in select value from jsonb_each(p_value)
    loop
      if public.fiscal_json_contains_parameter_id(v_child, p_id) then return true; end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if public.fiscal_json_contains_parameter_id(v_child, p_id) then return true; end if;
    end loop;
  end if;
  return false;
end;
$fiscal_json_contains_parameter_id$;

create or replace function public.fiscal_has_current_parameter_id(
  p_environment text,
  p_parameter_type text,
  p_id integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $fiscal_has_current_parameter_id$
declare
  v_values jsonb;
begin
  select s.values_json into v_values
  from public.fiscal_parameter_snapshots s
  where s.environment = p_environment
    and s.parameter_type = p_parameter_type
    and s.synchronized_at >= now() - interval '7 days'
  order by s.synchronized_at desc, s.id desc
  limit 1;
  return found and public.fiscal_json_contains_parameter_id(v_values, p_id);
end;
$fiscal_has_current_parameter_id$;

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

create or replace function public.fiscal_artifact_storage_path(
  p_business_id uuid,
  p_document_id uuid,
  p_generation_token uuid
)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $fiscal_artifact_storage_path$
  select concat('fiscal/', p_business_id::text, '/', p_document_id::text, '/', p_generation_token::text, '.pdf');
$fiscal_artifact_storage_path$;

create or replace function public.enqueue_authorized_fiscal_artifact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $enqueue_authorized_fiscal_artifact$
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
$enqueue_authorized_fiscal_artifact$;

drop trigger if exists fiscal_documents_enqueue_authorized_artifact on public.fiscal_documents;
create trigger fiscal_documents_enqueue_authorized_artifact
after update of state on public.fiscal_documents
for each row execute function public.enqueue_authorized_fiscal_artifact();

update public.fiscal_documents
  set artifact_state = 'artifact_pending', artifact_updated_at = now()
  where state in ('authorized','credited')
    and artifact_state <> 'artifact_ready';

insert into public.fiscal_artifact_outbox(fiscal_document_id)
select d.id
from public.fiscal_documents d
where d.state in ('authorized','credited')
on conflict(fiscal_document_id) do nothing;

create or replace function public.claim_fiscal_artifact_outbox(
  p_worker_id text,
  p_limit integer default 5,
  p_lease_seconds integer default 120
)
returns setof public.fiscal_artifact_outbox
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $claim_fiscal_artifact_outbox$
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
$claim_fiscal_artifact_outbox$;

create or replace function public.complete_fiscal_artifact(
  p_artifact_outbox_id uuid,
  p_worker_id text,
  p_artifact jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $complete_fiscal_artifact$
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
    raise exception 'lease de artefacto invalido' using errcode = '40001';
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
$complete_fiscal_artifact$;

create or replace function public.fail_fiscal_artifact(
  p_artifact_outbox_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message text,
  p_retryable boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $fail_fiscal_artifact$
declare
  v_outbox public.fiscal_artifact_outbox%rowtype;
  v_dead_letter boolean;
begin
  if coalesce(p_error_code,'') !~ '^[A-Z0-9_]{3,80}$' then raise exception 'codigo de artefacto invalido' using errcode = '22023'; end if;
  select o.* into v_outbox from public.fiscal_artifact_outbox o where o.id = p_artifact_outbox_id for update;
  if not found or v_outbox.state <> 'leased' or v_outbox.lease_owner <> p_worker_id then
    raise exception 'lease de artefacto invalido' using errcode = '40001';
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
$fail_fiscal_artifact$;

create or replace function public.request_fiscal_artifact_regeneration(p_fiscal_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $request_fiscal_artifact_regeneration$
declare
  v_document public.fiscal_documents%rowtype;
  v_outbox public.fiscal_artifact_outbox%rowtype;
begin
  select d.* into v_document from public.fiscal_documents d where d.id = p_fiscal_document_id for update;
  if not found then raise exception 'comprobante fiscal inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_document.business_id, array['owner','admin']) then raise exception 'owner/admin requerido para regenerar' using errcode = '42501'; end if;
  if v_document.state not in ('authorized','credited') then raise exception 'solo se regenera un comprobante autorizado' using errcode = 'P0001'; end if;
  select o.* into v_outbox from public.fiscal_artifact_outbox o where o.fiscal_document_id = v_document.id for update;
  if found and v_outbox.state = 'leased' and v_outbox.lease_deadline > now() then raise exception 'ya existe una generacion en curso' using errcode = '40001'; end if;
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
$request_fiscal_artifact_regeneration$;

create or replace function public.list_fiscal_document_artifacts(p_business_id uuid)
returns table(
  fiscal_document_id uuid,
  artifact_id uuid,
  artifact_type text,
  artifact_state text,
  mime_type text,
  size_bytes bigint,
  sha256 text,
  document_number bigint,
  generated_at timestamptz,
  generation_version text,
  is_current boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $list_fiscal_document_artifacts$
begin
  if not public.is_business_member(p_business_id) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  return query
  select a.fiscal_document_id, a.id, a.artifact_type, d.artifact_state, a.mime_type, a.size_bytes,
         a.sha256, a.document_number, a.generated_at, a.generation_version, a.is_current
  from public.fiscal_document_artifacts a
  join public.fiscal_documents d on d.id = a.fiscal_document_id
  where a.business_id = p_business_id and a.is_current
  order by a.generated_at desc;
end;
$list_fiscal_document_artifacts$;

create or replace function public.authorize_fiscal_artifact_access(
  p_artifact_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $authorize_fiscal_artifact_access$
declare
  v_artifact public.fiscal_document_artifacts%rowtype;
begin
  if p_action not in ('preview','download','print') then raise exception 'accion de artefacto invalida' using errcode = '22023'; end if;
  select a.* into v_artifact from public.fiscal_document_artifacts a where a.id = p_artifact_id and a.is_current and a.state = 'artifact_ready';
  if not found then raise exception 'artefacto fiscal no disponible' using errcode = 'P0002'; end if;
  if not public.is_business_member(v_artifact.business_id) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  insert into public.fiscal_events(fiscal_document_id, event_type, actor_type, actor_id, sanitized_detail)
  values(v_artifact.fiscal_document_id, concat('artifact_', p_action, '_authorized'), 'operator', auth.uid(), jsonb_build_object('artifact_id', v_artifact.id));
  return jsonb_build_object(
    'artifact_id', v_artifact.id,
    'mime_type', v_artifact.mime_type,
    'sha256', v_artifact.sha256,
    'expires_in_seconds', 60
  );
end;
$authorize_fiscal_artifact_access$;

create or replace function public.request_fiscal_print_job(
  p_fiscal_document_id uuid,
  p_artifact_id uuid,
  p_printer_name_hash text,
  p_format text,
  p_copies integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $request_fiscal_print_job$
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
$request_fiscal_print_job$;

create or replace function public.update_fiscal_print_job(
  p_print_job_id uuid,
  p_status text,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $update_fiscal_print_job$
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
$update_fiscal_print_job$;

create or replace function public.configure_fiscal_profile(
  p_business_id uuid,
  p_profile jsonb
)
returns public.fiscal_profiles
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $configure_profile_closure$
declare v_result public.fiscal_profiles%rowtype;
begin
  if not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'owner/admin requerido' using errcode='42501'; end if;
  if coalesce(p_profile,'{}'::jsonb)-array['legal_name','cuit','tax_condition','gross_income_number','business_address','environment','point_of_sale','default_currency','default_concept','invoice_policy','is_enabled','default_recipient_condition'] <> '{}'::jsonb then raise exception 'payload fiscal no permitido' using errcode='22023'; end if;
  if coalesce(p_profile->>'environment','disabled') not in ('disabled','homologation') then raise exception 'produccion no se configura desde el panel' using errcode='42501'; end if;
  if (p_profile->>'is_enabled')::boolean and (
    coalesce(p_profile->>'environment','disabled')='disabled'
    or coalesce(p_profile->>'cuit','') !~ '^[0-9]{11}$'
    or coalesce((p_profile->>'point_of_sale')::integer,0) not between 1 and 99999
    or btrim(coalesce(p_profile->>'legal_name',''))=''
    or btrim(coalesce(p_profile->>'tax_condition',''))=''
    or btrim(coalesce(p_profile->>'default_recipient_condition',''))=''
  ) then raise exception 'perfil fiscal incompleto' using errcode='22023'; end if;
  insert into public.fiscal_profiles(business_id,legal_name,cuit,tax_condition,gross_income_number,business_address,environment,point_of_sale,default_currency,default_concept,invoice_policy,is_enabled,default_recipient_condition,updated_at)
  values(p_business_id,nullif(btrim(p_profile->>'legal_name'),''),nullif(regexp_replace(coalesce(p_profile->>'cuit',''),'[^0-9]','','g'),''),nullif(btrim(p_profile->>'tax_condition'),''),nullif(btrim(p_profile->>'gross_income_number'),''),nullif(btrim(p_profile->>'business_address'),''),coalesce(p_profile->>'environment','disabled'),(p_profile->>'point_of_sale')::integer,coalesce(nullif(btrim(p_profile->>'default_currency'),''),'PES'),(p_profile->>'default_concept')::integer,coalesce(nullif(btrim(p_profile->>'invoice_policy'),''),'manual'),coalesce((p_profile->>'is_enabled')::boolean,false),nullif(btrim(p_profile->>'default_recipient_condition'),''),now())
  on conflict(business_id) do update set
    legal_name=excluded.legal_name,cuit=excluded.cuit,tax_condition=excluded.tax_condition,
    gross_income_number=excluded.gross_income_number,business_address=excluded.business_address,
    environment=excluded.environment,point_of_sale=excluded.point_of_sale,
    default_currency=excluded.default_currency,default_concept=excluded.default_concept,
    invoice_policy=excluded.invoice_policy,is_enabled=excluded.is_enabled,
    default_recipient_condition=excluded.default_recipient_condition,updated_at=now()
  returning * into v_result;
  return v_result;
end;
$configure_profile_closure$;

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

create or replace function public.request_credit_note(
  p_original_document_id uuid,
  p_reason text,
  p_credit_kind text,
  p_lines jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $request_credit_note$
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
$request_credit_note$;

create or replace function public.request_full_credit_note(
  p_original_document_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $request_full_credit_note$
  select public.request_credit_note(p_original_document_id, p_reason, 'total', '[]'::jsonb, p_idempotency_key);
$request_full_credit_note$;

create or replace function public.complete_fiscal_attempt(
  p_outbox_id uuid,
  p_worker_id text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $complete_fiscal_attempt_closure$
declare
  v_outbox public.fiscal_outbox%rowtype;
  v_document public.fiscal_documents%rowtype;
  v_class text;
  v_cae text;
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
$complete_fiscal_attempt_closure$;

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

create or replace function public.protect_authorized_fiscal_document_item()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $protect_fiscal_item$
declare v_document_id uuid;
declare v_state text;
begin
  v_document_id := case when tg_op='DELETE' then old.fiscal_document_id else new.fiscal_document_id end;
  select state into v_state from public.fiscal_documents where id=v_document_id;
  if v_state in ('authorized','credited') then raise exception 'los items de un comprobante autorizado son inmutables' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end;
$protect_fiscal_item$;

drop trigger if exists fiscal_document_items_protect_authorized on public.fiscal_document_items;
create trigger fiscal_document_items_protect_authorized before update or delete on public.fiscal_document_items
for each row execute function public.protect_authorized_fiscal_document_item();

alter table public.fiscal_accounting_policies enable row level security;
alter table public.fiscal_document_artifacts enable row level security;
alter table public.fiscal_artifact_outbox enable row level security;
alter table public.fiscal_credit_allocations enable row level security;
alter table public.fiscal_print_jobs enable row level security;

create policy "business reads fiscal print audit" on public.fiscal_print_jobs for select to authenticated
  using (public.is_business_member(business_id));
create policy "business reads fiscal artifact metadata" on public.fiscal_document_artifacts for select to authenticated
  using (public.is_business_member(business_id));
create policy "business reads fiscal credit allocations" on public.fiscal_credit_allocations for select to authenticated
  using (public.is_business_member(business_id));
create policy "business reads approved fiscal policies" on public.fiscal_accounting_policies for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin']));

revoke all on table public.fiscal_accounting_policies, public.fiscal_document_artifacts,
  public.fiscal_artifact_outbox, public.fiscal_credit_allocations, public.fiscal_print_jobs
from public, anon, authenticated;

grant select on public.fiscal_print_jobs to authenticated;

revoke all on function public.fiscal_json_contains_parameter_id(jsonb,integer),
  public.fiscal_has_current_parameter_id(text,text,integer),
  public.resolve_fiscal_accounting_policy(uuid,text,text,text,integer,integer,date),
  public.fiscal_artifact_storage_path(uuid,uuid,uuid),
  public.claim_fiscal_artifact_outbox(text,integer,integer),
  public.complete_fiscal_artifact(uuid,text,jsonb),
  public.fail_fiscal_artifact(uuid,text,text,text,boolean)
from public, anon, authenticated;

grant execute on function public.claim_fiscal_artifact_outbox(text,integer,integer),
  public.complete_fiscal_artifact(uuid,text,jsonb),
  public.fail_fiscal_artifact(uuid,text,text,text,boolean)
to service_role;

grant execute on function public.request_credit_note(uuid,text,text,jsonb,text),
  public.request_full_credit_note(uuid,text,text),
  public.request_fiscal_artifact_regeneration(uuid),
  public.list_fiscal_document_artifacts(uuid),
  public.authorize_fiscal_artifact_access(uuid,text),
  public.request_fiscal_print_job(uuid,uuid,text,text,integer,text),
  public.update_fiscal_print_job(uuid,text,text)
to authenticated;

comment on table public.fiscal_document_artifacts is 'Metadatos inmutables de PDF fiscal autorizado; storage_path no se expone al panel.';
comment on table public.fiscal_artifact_outbox is 'Cola privada idempotente para generar y persistir PDFs despues de la autorizacion ARCA.';
comment on table public.fiscal_accounting_policies is 'Politicas versionadas; solo una politica aprobada y validada contra tablas ARCA puede resolver tipos.';
comment on table public.fiscal_print_jobs is 'Auditoria de reimpresion. sent_to_spooler no equivale a completado.';
