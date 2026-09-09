-- V3 EXPAND: durable, deployment-bound control plane for the later A1/A4
-- CONTRACT. Everything here is additive. The contract DDL is executed only by
-- private.execute_a1_a4_legacy_contract_v3 after a deterministic drain.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Exact immutable fingerprints of the two earlier EXPAND files. The control
-- migration can bind them without a self-referential file hash.
create table private.a1_a4_expand_artifacts (
  version text primary key check (version ~ '^[0-9]{14}$'),
  path text not null unique,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default clock_timestamp()
);
insert into private.a1_a4_expand_artifacts(version,path,sha256) values
  ('20260908164550','supabase/migrations/20260908164550_current_payment_authority_and_refund_identity.sql','83752fdf5fbee0c63b5cae512be20fcdcf13a5fc805872453208daaf21f27853'),
  ('20260908190758','supabase/migrations/20260908190758_a1_attempt_authority_expand_v2.sql','8775a22ff1a5391721b58f33b8984e8581dd137e64ab407f9a48b6c085b37cc9');

create table private.a1_a4_payment_dispatch_control (
  environment text primary key check (environment in ('test', 'production')),
  paused boolean not null,
  paused_at timestamptz,
  paused_by text,
  target_edge_version text,
  generation uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (paused and paused_at is not null and paused_by is not null and target_edge_version is not null)
    or
    (not paused and paused_at is null and paused_by is null and target_edge_version is null)
  )
);

create table private.a1_a4_payment_dispatch_audit (
  request_id bigint primary key,
  source text not null check (source in ('cron', 'outbox')),
  requested_at timestamptz not null default clock_timestamp()
);
create index a1_a4_payment_dispatch_audit_requested_idx
  on private.a1_a4_payment_dispatch_audit(requested_at desc);

-- Backward-compatible observability for both legacy and V2 dispatch. This is
-- the existing dispatcher body plus one private append-only identity row for
-- every pg_net request, allowing the drain to reason about recent dispatches.
create or replace function public.dispatch_payment_outbox_worker(p_source text default 'cron')
returns bigint language plpgsql security definer
set search_path = pg_catalog, public, private, extensions, vault, net, pg_temp
as $$
declare
  v_worker_url text; v_worker_secret text; v_timestamp text; v_nonce text;
  v_manifest text; v_signature text; v_request_id bigint; v_due boolean;
begin
  if p_source not in ('cron', 'outbox') then
    raise exception 'invalid payment worker dispatch source' using errcode='22023';
  end if;
  select exists(select 1 from public.payment_outbox o
    where (o.status in ('pending','retry_wait') and o.next_attempt_at<=clock_timestamp())
       or (o.status in ('claimed','processing') and coalesce(o.lease_expires_at,'-infinity'::timestamptz)<clock_timestamp()))
    into v_due;
  if not v_due then return null; end if;
  select decrypted_secret into v_worker_url from vault.decrypted_secrets
    where name='taba_payment_worker_url' limit 1;
  select decrypted_secret into v_worker_secret from vault.decrypted_secrets
    where name='taba_payment_worker_hmac_secret' limit 1;
  if nullif(btrim(v_worker_url),'') is null or nullif(v_worker_secret,'') is null then return null; end if;
  if v_worker_url !~ '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/mercadopago-payment-worker$' then
    raise exception 'invalid payment worker URL' using errcode='22023';
  end if;
  if length(v_worker_secret)<32 then raise exception 'payment worker secret is too short' using errcode='22023'; end if;
  v_timestamp:=floor(extract(epoch from clock_timestamp()))::bigint::text;
  v_nonce:=gen_random_uuid()::text;
  v_manifest:=v_timestamp||'.'||v_nonce||'.POST./functions/v1/mercadopago-payment-worker';
  v_signature:=encode(hmac(v_manifest,v_worker_secret,'sha256'),'hex');
  select net.http_post(
    url:=v_worker_url,
    headers:=jsonb_build_object('content-type','application/json','x-taba-worker-timestamp',v_timestamp,
      'x-taba-worker-nonce',v_nonce,'x-taba-worker-signature',v_signature),
    body:=jsonb_build_object('source',p_source,'scheduled_at',clock_timestamp()),
    timeout_milliseconds:=5000
  ) into v_request_id;
  insert into private.a1_a4_payment_dispatch_audit(request_id,source)
  values(v_request_id,p_source);
  return v_request_id;
end;
$$;

create table private.deployment_drain_attestations (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('test', 'production')),
  deployment_id text not null check (length(deployment_id) between 1 and 200),
  previous_edge_version text not null check (length(previous_edge_version) between 1 and 500),
  target_edge_version text not null check (length(target_edge_version) between 1 and 500),
  contract_sha text not null check (contract_sha ~ '^[a-f0-9]{64}$'),
  expand_version text not null check (expand_version ~ '^[0-9]{14}$'),
  expand_sha text not null check (expand_sha ~ '^[a-f0-9]{64}$'),
  previous_deployed_at timestamptz not null,
  target_deployed_at timestamptz not null,
  traffic_switched_at timestamptz not null,
  scheduler_paused_at timestamptz not null,
  drain_not_before timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  actor text not null check (length(actor) between 1 and 200),
  actor_db_role text not null default session_user,
  evidence jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'consumed', 'expired')),
  consumed_at timestamptz,
  consumed_by text,
  execution_id uuid,
  check (previous_edge_version <> target_edge_version),
  check (previous_deployed_at <= target_deployed_at),
  check (traffic_switched_at >= target_deployed_at),
  check (drain_not_before >= greatest(target_deployed_at, traffic_switched_at, scheduler_paused_at) + interval '430 seconds'),
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  check ((status = 'pending' and consumed_at is null and consumed_by is null and execution_id is null)
    or (status = 'expired' and consumed_at is null and consumed_by is null and execution_id is null)
    or (status = 'consumed' and consumed_at is not null and consumed_by is not null and execution_id is not null))
);

create unique index deployment_drain_attestations_one_pending_idx
  on private.deployment_drain_attestations(environment, contract_sha)
  where status = 'pending';
create index deployment_drain_attestations_expiry_idx
  on private.deployment_drain_attestations(expires_at)
  where status = 'pending';

create table private.deployment_contract_executions (
  id uuid primary key default gen_random_uuid(),
  contract_name text not null,
  contract_sha text not null check (contract_sha ~ '^[a-f0-9]{64}$'),
  expand_version text not null check (expand_version ~ '^[0-9]{14}$'),
  expand_sha text not null check (expand_sha ~ '^[a-f0-9]{64}$'),
  edge_version text not null,
  environment text not null check (environment in ('test', 'production')),
  executed_at timestamptz not null default clock_timestamp(),
  actor text not null,
  actor_db_role text not null default session_user,
  attestation_id uuid not null unique references private.deployment_drain_attestations(id),
  result text not null check (result = 'applied'),
  evidence jsonb not null,
  unique (contract_name, environment)
);

alter table private.a1_a4_payment_dispatch_control enable row level security;
alter table private.a1_a4_payment_dispatch_audit enable row level security;
alter table private.a1_a4_expand_artifacts enable row level security;
alter table private.deployment_drain_attestations enable row level security;
alter table private.deployment_contract_executions enable row level security;
alter table private.a1_a4_payment_dispatch_control force row level security;
alter table private.a1_a4_payment_dispatch_audit force row level security;
alter table private.a1_a4_expand_artifacts force row level security;
alter table private.deployment_drain_attestations force row level security;
alter table private.deployment_contract_executions force row level security;

revoke all on private.a1_a4_expand_artifacts,
  private.a1_a4_payment_dispatch_control,
  private.a1_a4_payment_dispatch_audit,
  private.deployment_drain_attestations,
  private.deployment_contract_executions from public, anon, authenticated, service_role;

create function private.guard_deployment_drain_attestation_mutation()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, private, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'drain attestations are append-only' using errcode = '55000';
  end if;
  if old.status <> 'pending' or new.status not in ('consumed', 'expired')
    or (to_jsonb(new) - array['status','consumed_at','consumed_by','execution_id']::text[])
       is distinct from
       (to_jsonb(old) - array['status','consumed_at','consumed_by','execution_id']::text[]) then
    raise exception 'drain attestation mutation is forbidden' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_deployment_drain_attestation_mutation() from public, anon, authenticated, service_role;
create trigger deployment_drain_attestations_append_only
before update or delete on private.deployment_drain_attestations
for each row execute function private.guard_deployment_drain_attestation_mutation();

create function private.reject_contract_execution_mutation()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, private, pg_temp
as $$
begin
  raise exception 'contract execution ledger is append-only' using errcode = '55000';
end;
$$;
revoke all on function private.reject_contract_execution_mutation() from public, anon, authenticated, service_role;
create trigger deployment_contract_executions_append_only
before update or delete on private.deployment_contract_executions
for each row execute function private.reject_contract_execution_mutation();
create trigger a1_a4_expand_artifacts_append_only
before update or delete on private.a1_a4_expand_artifacts
for each row execute function private.reject_contract_execution_mutation();
create trigger a1_a4_payment_dispatch_audit_append_only
before update or delete on private.a1_a4_payment_dispatch_audit
for each row execute function private.reject_contract_execution_mutation();

create function private.set_a1_a4_payment_dispatch_paused_v3(
  p_environment text, p_target_edge_version text, p_actor text, p_paused boolean
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, cron, pg_temp
as $$
declare
  v_jobid bigint;
  v_now timestamptz := clock_timestamp();
begin
  if p_environment not in ('test', 'production')
    or nullif(btrim(p_actor), '') is null or length(p_actor) > 200
    or (p_paused and (nullif(btrim(p_target_edge_version), '') is null or length(p_target_edge_version) > 500)) then
    raise exception 'invalid dispatch control request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('taba:a1-a4:dispatch-control:' || p_environment, 0));
  select jobid into v_jobid from cron.job where jobname = 'taba-payment-outbox-worker' for update;
  if not found then raise exception 'payment worker cron is missing' using errcode = '55000'; end if;
  if p_paused then
    perform cron.alter_job(v_jobid, active => false);
    execute 'alter table public.payment_outbox disable trigger payment_outbox_worker_kick';
    insert into private.a1_a4_payment_dispatch_control(
      environment, paused, paused_at, paused_by, target_edge_version, generation, updated_at
    ) values (
      p_environment, true, v_now, btrim(p_actor), btrim(p_target_edge_version), gen_random_uuid(), v_now
    ) on conflict(environment) do update set
      paused = true, paused_at = excluded.paused_at, paused_by = excluded.paused_by,
      target_edge_version = excluded.target_edge_version, generation = excluded.generation,
      updated_at = excluded.updated_at;
  else
    if not exists (
      select 1 from private.deployment_contract_executions e
      where e.contract_name = 'a1_a4_legacy_contract_v3'
        and e.environment = p_environment and e.edge_version = p_target_edge_version
    ) then
      raise exception 'contract execution required before dispatch resume' using errcode = '55000';
    end if;
    execute 'alter table public.payment_outbox enable trigger payment_outbox_worker_kick';
    perform cron.alter_job(v_jobid, active => true);
    insert into private.a1_a4_payment_dispatch_control(environment, paused, generation, updated_at)
    values(p_environment, false, gen_random_uuid(), v_now)
    on conflict(environment) do update set paused=false, paused_at=null, paused_by=null,
      target_edge_version=null, generation=excluded.generation, updated_at=excluded.updated_at;
  end if;
  return (select to_jsonb(c) from private.a1_a4_payment_dispatch_control c where c.environment=p_environment);
end;
$$;
revoke all on function private.set_a1_a4_payment_dispatch_paused_v3(text,text,text,boolean)
  from public, anon, authenticated, service_role;

create function private.assert_a1_a4_drain_v3(
  p_environment text, p_target_edge_version text,
  p_target_deployed_at timestamptz, p_traffic_switched_at timestamptz
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, cron, net, pg_temp
as $$
declare
  v_control private.a1_a4_payment_dispatch_control%rowtype;
  v_not_before timestamptz;
  v_last_dispatch_at timestamptz;
  v_blockers jsonb;
begin
  select * into v_control from private.a1_a4_payment_dispatch_control
  where environment=p_environment for share;
  if not found or not v_control.paused or v_control.target_edge_version is distinct from p_target_edge_version then
    raise exception 'payment dispatch is not paused for target Edge release' using errcode='55000';
  end if;
  if exists(select 1 from cron.job where jobname='taba-payment-outbox-worker' and active) then
    raise exception 'payment worker scheduler is active' using errcode='55000';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.payment_outbox'::regclass
    and tgname='payment_outbox_worker_kick' and tgenabled='D') then
    raise exception 'immediate payment worker dispatch is active' using errcode='55000';
  end if;
  if exists(select 1 from net.http_request_queue
    where url like '%/functions/v1/mercadopago-payment-worker') then
    raise exception 'payment worker pg_net dispatch is pending' using errcode='55000';
  end if;
  if exists(select 1 from public.payment_outbox where status in ('claimed','processing'))
    or exists(select 1 from public.payment_outbox
      where owner is not null and lease_expires_at > clock_timestamp()) then
    raise exception 'payment outbox worker lease is active' using errcode='55000';
  end if;
  if exists(select 1 from public.payment_refunds where status in ('requested','processing')) then
    raise exception 'refund operation is in flight' using errcode='55000';
  end if;
  if exists(select 1 from public.business_payment_settings where environment=p_environment and enabled)
    or exists(select 1 from public.mp_seller_connections where environment=p_environment and status='connected') then
    raise exception 'financial activation must remain inert' using errcode='55000';
  end if;
  select max(requested_at) into v_last_dispatch_at
    from private.a1_a4_payment_dispatch_audit;
  v_not_before := greatest(p_target_deployed_at, p_traffic_switched_at, v_control.paused_at,
      coalesce(v_last_dispatch_at,'-infinity'::timestamptz))
    + interval '430 seconds';
  if clock_timestamp() < v_not_before then
    raise exception 'old Edge maximum lifetime has not drained' using errcode='55000';
  end if;
  v_blockers := jsonb_build_object(
    'scheduler_active', false,
    'immediate_dispatch_active', false,
    'pg_net_pending', 0,
    'outbox_inflight', 0,
    'refunds_inflight', 0,
    'last_payment_dispatch_at', v_last_dispatch_at,
    'minimum_wait_seconds', 430,
    'not_before', v_not_before
  );
  return v_blockers;
end;
$$;
revoke all on function private.assert_a1_a4_drain_v3(text,text,timestamptz,timestamptz)
  from public, anon, authenticated, service_role;

create function private.create_a1_a4_drain_attestation_v3(
  p_environment text, p_deployment_id text, p_previous_edge_version text,
  p_target_edge_version text, p_contract_sha text, p_expand_version text,
  p_expand_sha text, p_previous_deployed_at timestamptz,
  p_target_deployed_at timestamptz, p_traffic_switched_at timestamptz,
  p_expires_at timestamptz, p_actor text, p_evidence jsonb
)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_id uuid;
  v_now timestamptz := clock_timestamp();
  v_control private.a1_a4_payment_dispatch_control%rowtype;
  v_drain jsonb;
begin
  if p_environment <> 'production'
    or nullif(btrim(p_deployment_id),'') is null
    or nullif(btrim(p_previous_edge_version),'') is null
    or nullif(btrim(p_target_edge_version),'') is null
    or p_previous_edge_version = p_target_edge_version
    or p_contract_sha !~ '^[a-f0-9]{64}$'
    or p_expand_version !~ '^[0-9]{14}$'
    or p_expand_sha !~ '^[a-f0-9]{64}$'
    or nullif(btrim(p_actor),'') is null
    or jsonb_typeof(p_evidence) <> 'object'
    or jsonb_typeof(p_evidence->'edge_functions') <> 'array'
    or jsonb_array_length(p_evidence->'edge_functions') < 3
    or nullif(p_evidence->>'platform_project_ref','') is null
    or nullif(p_evidence->>'platform_snapshot_sha','') is null then
    raise exception 'invalid durable drain evidence' using errcode='22023';
  end if;
  if p_previous_deployed_at > p_target_deployed_at
    or p_traffic_switched_at < p_target_deployed_at
    or p_expires_at <= v_now + interval '1 minute'
    or p_expires_at > v_now + interval '10 minutes' then
    raise exception 'invalid drain timestamps' using errcode='22023';
  end if;
  v_drain := private.assert_a1_a4_drain_v3(
    p_environment, p_target_edge_version, p_target_deployed_at, p_traffic_switched_at
  );
  select * into v_control from private.a1_a4_payment_dispatch_control
  where environment=p_environment for share;
  update private.deployment_drain_attestations set status='expired'
  where environment=p_environment and contract_sha=p_contract_sha
    and status='pending' and expires_at<=v_now;
  insert into private.deployment_drain_attestations(
    environment,deployment_id,previous_edge_version,target_edge_version,
    contract_sha,expand_version,expand_sha,previous_deployed_at,target_deployed_at,
    traffic_switched_at,scheduler_paused_at,drain_not_before,created_at,expires_at,
    actor,actor_db_role,evidence
  ) values (
    p_environment,btrim(p_deployment_id),btrim(p_previous_edge_version),btrim(p_target_edge_version),
    p_contract_sha,p_expand_version,p_expand_sha,p_previous_deployed_at,p_target_deployed_at,
    p_traffic_switched_at,v_control.paused_at,
    (v_drain->>'not_before')::timestamptz,
    v_now,p_expires_at,btrim(p_actor),session_user,
    p_evidence || jsonb_build_object('database_drain',v_drain,'attested_at',v_now)
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.create_a1_a4_drain_attestation_v3(
  text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text,jsonb
) from public, anon, authenticated, service_role;

create function private.execute_a1_a4_legacy_contract_v3(
  p_attestation_id uuid, p_environment text, p_edge_version text,
  p_contract_sha text, p_expand_version text, p_expand_sha text, p_actor text
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private, cron, net, pg_temp
as $$
declare
  v_attestation private.deployment_drain_attestations%rowtype;
  v_execution_id uuid := gen_random_uuid();
  v_drain jsonb;
begin
  perform set_config('lock_timeout','5s',true);
  perform set_config('statement_timeout','30s',true);
  perform pg_advisory_xact_lock(hashtextextended('taba:a1-a4:legacy-contract:' || p_environment, 0));
  if exists(select 1 from private.deployment_contract_executions
    where contract_name='a1_a4_legacy_contract_v3' and environment=p_environment) then
    raise exception 'ALREADY_APPLIED' using errcode='55000';
  end if;
  lock table private.a1_a4_payment_dispatch_control,
    private.a1_a4_payment_dispatch_audit,
    private.deployment_drain_attestations,
    private.deployment_contract_executions in share row exclusive mode;
  lock table public.payment_outbox, public.payment_refunds,
    public.mp_seller_connections, public.business_payment_settings in share mode;
  lock table cron.job, net.http_request_queue in share mode;
  select * into v_attestation from private.deployment_drain_attestations
  where id=p_attestation_id for update;
  if not found or v_attestation.status <> 'pending'
    or v_attestation.expires_at <= clock_timestamp()
    or v_attestation.environment is distinct from p_environment
    or v_attestation.target_edge_version is distinct from p_edge_version
    or v_attestation.contract_sha is distinct from p_contract_sha
    or v_attestation.expand_version is distinct from p_expand_version
    or v_attestation.expand_sha is distinct from p_expand_sha
    or v_attestation.actor is distinct from p_actor
    or v_attestation.actor_db_role is distinct from session_user then
    raise exception 'contract attestation mismatch or expired' using errcode='55000';
  end if;
  v_drain := private.assert_a1_a4_drain_v3(
    p_environment,p_edge_version,v_attestation.target_deployed_at,v_attestation.traffic_switched_at
  );

  execute $ddl$
    create or replace function public.prepare_mercadopago_preference(
      p_checkout_session_id uuid,p_customer_id uuid,p_new_attempt boolean default false
    )
    returns jsonb language plpgsql security invoker
    set search_path=pg_catalog,public,pg_temp as $stub$
    begin raise exception 'legacy payment edge retired; use V2' using errcode='55000'; end;
    $stub$
  $ddl$;
  execute $ddl$
    create or replace function public.record_mercadopago_preference_created(
      p_payment_attempt_id uuid,p_preference_id text,p_init_point text,
      p_sandbox_init_point text,p_response_hash text,p_provider_request_id text
    )
    returns jsonb language plpgsql security invoker
    set search_path=pg_catalog,public,pg_temp as $stub$
    begin raise exception 'legacy payment edge retired; use V2' using errcode='55000'; end;
    $stub$
  $ddl$;
  execute $ddl$
    create or replace function public.record_payment_refund_response(
      p_refund_id uuid,p_provider_refund_id text,p_status text,p_amount numeric,p_response_hash text
    )
    returns jsonb language plpgsql security invoker
    set search_path=pg_catalog,public,pg_temp as $stub$
    begin raise exception 'legacy refund edge retired; use V2' using errcode='55000'; end;
    $stub$
  $ddl$;
  execute $ddl$
    create or replace function public.get_mercadopago_payment_authority(
      p_business_id uuid,p_environment text,p_checkout_session_id uuid,p_customer_id uuid
    )
    returns jsonb language plpgsql security invoker
    set search_path=pg_catalog,public,pg_temp as $stub$
    begin raise exception 'legacy payment edge retired; use V2' using errcode='55000'; end;
    $stub$
  $ddl$;
  execute $ddl$
    create or replace function public.prepare_payment_refund(
      p_payment_intent_id uuid,p_amount numeric,p_idempotency_key uuid,p_reason text
    )
    returns jsonb language plpgsql security invoker
    set search_path=pg_catalog,public,pg_temp as $stub$
    begin raise exception 'legacy refund edge retired; use V2' using errcode='55000'; end;
    $stub$
  $ddl$;
  execute $ddl$
    create or replace function public.claim_payment_outbox(
      p_owner text,p_limit integer default 20,p_lease_seconds integer default 90
    )
    returns setof public.payment_outbox language plpgsql security invoker
    set search_path=pg_catalog,public,pg_temp as $stub$
    begin raise exception 'legacy worker retired; use V2' using errcode='55000'; end;
    $stub$
  $ddl$;

  insert into private.deployment_contract_executions(
    id,contract_name,contract_sha,expand_version,expand_sha,edge_version,
    environment,actor,actor_db_role,attestation_id,result,evidence
  ) values (
    v_execution_id,'a1_a4_legacy_contract_v3',p_contract_sha,p_expand_version,
    p_expand_sha,p_edge_version,p_environment,p_actor,session_user,p_attestation_id,
    'applied',v_attestation.evidence || jsonb_build_object('execution_drain',v_drain)
  );
  update private.deployment_drain_attestations set status='consumed',
    consumed_at=clock_timestamp(),consumed_by=p_actor,execution_id=v_execution_id
  where id=p_attestation_id;
  return jsonb_build_object('ok',true,'result','applied','execution_id',v_execution_id,
    'attestation_id',p_attestation_id,'contract_sha',p_contract_sha);
end;
$$;
revoke all on function private.execute_a1_a4_legacy_contract_v3(
  uuid,text,text,text,text,text,text
) from public, anon, authenticated, service_role;
