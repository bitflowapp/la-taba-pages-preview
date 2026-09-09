-- V5 EXPAND. One bootstrap release, before any financial onboarding.
-- All status-bearing financial rows block this release, including terminal and
-- unknown states. Never infer safety from a guessed subset of status strings.
create table private.a1_a4_release_control_v5 (
  singleton boolean primary key default true check (singleton),
  project_ref text not null check (project_ref='wwcpogltfgzgkrlilbcd'),
  paused boolean not null default false,
  release_id uuid,
  paused_at timestamptz,
  drain_observed_at timestamptz,
  schema_sha text,
  contract_sha text not null,
  check (not paused or (release_id is not null and paused_at is not null))
);
insert into private.a1_a4_release_control_v5(project_ref,contract_sha)
values('wwcpogltfgzgkrlilbcd','cdda2d12f165d3056e46a62a399edc26cb3a178a52ec68d081a9f99b4e830184');

create table private.a1_a4_releases_v5 (
  id uuid primary key default gen_random_uuid(),
  project_ref text not null check (project_ref='wwcpogltfgzgkrlilbcd'),
  protocol text not null default 'taba-a1-a4-v5' check (protocol='taba-a1-a4-v5'),
  phase text not null check (phase in ('quiesced','staging','activation_pending','verified','attested','contracted','resumed','aborted')),
  commit_sha text not null check (commit_sha ~ '^[a-f0-9]{40}$'),
  source_sha text not null check (source_sha ~ '^[a-f0-9]{64}$'),
  expand_sha text not null check (expand_sha ~ '^[a-f0-9]{64}$'),
  schema_sha text not null check (schema_sha ~ '^[a-f0-9]{64}$'),
  contract_sha text not null check (contract_sha ~ '^[a-f0-9]{64}$'),
  actor_db_role text not null default session_user,
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
  scheduler_before jsonb not null,
  baseline jsonb,
  staged jsonb,
  activation_response jsonb,
  verified_remote jsonb,
  runtime_proof jsonb,
  remote_sha text,
  verified_at timestamptz,
  last_checked_at timestamptz,
  check_pid integer,
  check_application_name text,
  proof_expires_at timestamptz,
  attestation_id uuid references private.deployment_drain_attestations(id),
  contracted_at timestamptz,
  finished_at timestamptz,
  check (phase not in ('activation_pending','verified','attested','contracted','resumed') or
    (baseline is not null and staged is not null and jsonb_typeof(baseline)='array'
      and jsonb_typeof(staged)='array' and jsonb_array_length(baseline)=9 and jsonb_array_length(staged)=3)),
  check (phase not in ('verified','attested','contracted','resumed') or
    (verified_remote is not null and runtime_proof is not null and remote_sha is not null
      and verified_at is not null and last_checked_at is not null and check_pid is not null
      and check_application_name is not null and proof_expires_at is not null
      and jsonb_typeof(verified_remote)='array' and jsonb_array_length(verified_remote)=9
      and jsonb_typeof(runtime_proof)='array' and jsonb_array_length(runtime_proof)=3
      and remote_sha ~ '^[a-f0-9]{64}$' and proof_expires_at>last_checked_at)),
  check (phase not in ('attested','contracted','resumed') or attestation_id is not null),
  check (phase not in ('contracted','resumed') or contracted_at is not null),
  check (phase not in ('aborted','resumed') or finished_at is not null)
);
create unique index a1_a4_release_one_open_v5 on private.a1_a4_releases_v5(project_ref)
where phase not in ('resumed','aborted');
alter table private.a1_a4_release_control_v5 enable row level security;
alter table private.a1_a4_releases_v5 enable row level security;
alter table private.a1_a4_release_control_v5 force row level security;
alter table private.a1_a4_releases_v5 force row level security;
revoke all on private.a1_a4_release_control_v5,private.a1_a4_releases_v5 from public,anon,authenticated,service_role;

-- Every financial writer holds a SHARE row lock until its transaction ends.
-- Quiesce updates this SAME pre-existing singleton row. FOR SHARE also forces
-- stale REPEATABLE READ/SERIALIZABLE snapshots to abort instead of seeing the
-- old unpaused value. The row survives runner/session/host crashes.
create function private.a1_a4_financial_open_v5() returns boolean
language plpgsql security definer set search_path=pg_catalog,private,pg_temp as $$
declare v_paused boolean;
begin
  select paused into strict v_paused from private.a1_a4_release_control_v5 where singleton for share;
  return not v_paused;
end $$;
create function private.a1_a4_financial_write_guard_v5() returns trigger
language plpgsql security definer set search_path=pg_catalog,private,pg_temp as $$
begin
  if not private.a1_a4_financial_open_v5() then
    raise exception 'TABA_RELEASE_QUIESCED' using errcode='55000';
  end if;
  return null;
end $$;
do $$ declare v_table text; begin
  foreach v_table in array array['checkout_sessions','checkout_session_items','inventory_reservations',
    'payment_intents','payment_attempts','payment_webhook_receipts','payment_events','payment_refunds',
    'payment_cancellations','payment_disputes','payment_outbox','business_payment_settings',
    'mp_seller_connections','mp_oauth_states'] loop
    execute format('create trigger a1_a4_financial_interlock_v5 before insert or update or delete or truncate on public.%I for each statement execute function private.a1_a4_financial_write_guard_v5()',v_table);
    execute format('alter table public.%I enable always trigger a1_a4_financial_interlock_v5',v_table);
  end loop;
end $$;

-- pg_net queue INSERT/UPDATE has the same interlock. DELETE remains available
-- to its worker so already queued requests can drain. The extension grants
-- TRIGGER on this table; ownership of the extension is not required.
create trigger a1_a4_pg_net_interlock_v5 before insert or update on net.http_request_queue
for each statement execute function private.a1_a4_financial_write_guard_v5();

-- The old body is private; service_role cannot bypass the wrapper by name.
-- Guard the original OID too: previously prepared calls must not bypass the
-- interlock after the function is renamed/moved into private.
do $$ declare v_definition text; begin
  v_definition:=pg_get_functiondef('public.dispatch_payment_outbox_worker(text)'::regprocedure);
  if position(E'begin\n  if p_source' in v_definition)=0 then raise exception 'DISPATCHER_DEFINITION_MISMATCH'; end if;
  execute replace(v_definition,E'begin\n  if p_source',E'begin\n  if not private.a1_a4_financial_open_v5() then return null; end if;\n  if p_source');
end $$;
alter function public.dispatch_payment_outbox_worker(text) rename to dispatch_payment_outbox_worker_v3_body;
alter function public.dispatch_payment_outbox_worker_v3_body(text) set schema private;
revoke all on function private.dispatch_payment_outbox_worker_v3_body(text) from public,anon,authenticated,service_role;
create function public.dispatch_payment_outbox_worker(p_source text default 'cron') returns bigint
language plpgsql security definer set search_path=pg_catalog,private,pg_temp as $$
begin
  if not private.a1_a4_financial_open_v5() then return null; end if;
  return private.dispatch_payment_outbox_worker_v3_body(p_source);
end $$;
revoke all on function public.dispatch_payment_outbox_worker(text) from public,anon,authenticated;
grant execute on function public.dispatch_payment_outbox_worker(text) to service_role;

create function private.assert_a1_a4_release_lock_v5() returns void
language plpgsql security definer set search_path=pg_catalog,private,pg_temp as $$
begin
  if not exists(select 1 from pg_locks where locktype='advisory' and pid=pg_backend_pid()
    and classid=1413562945 and objid=5 and objsubid=2 and mode='ExclusiveLock' and granted) then
    raise exception 'RELEASE_SESSION_LOCK_REQUIRED' using errcode='55000';
  end if;
end $$;

-- Definition/ACL/column/constraint fingerprint, not a migration-version guess.
-- Rows, sequence values and scheduler activity are deliberately not schema.
create function private.a1_a4_schema_sha_v5() returns text
language sql stable security definer set search_path=pg_catalog,public,private,extensions,pg_temp as $$
select encode(extensions.digest(coalesce(string_agg(v,E'\n' order by v),''),'sha256'),'hex') from (
  select 'function:'||n.nspname||'.'||p.proname||':'||pg_get_functiondef(p.oid)||':'||coalesce(p.proacl::text,'') v
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f'
  union all
  select 'column:'||c.relname||':'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and a.attnum>0 and not a.attisdropped
  union all
  select 'constraint:'||c.relname||':'||k.conname||':'||pg_get_constraintdef(k.oid)||':'||k.convalidated
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private')
  union all
  select 'table:'||n.nspname||'.'||c.relname||':'||pg_get_userbyid(c.relowner)||':'||c.relrowsecurity||':'||c.relforcerowsecurity||':'||coalesce(c.relacl::text,'')
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind in ('r','p')
  union all
  select 'index:'||pg_get_indexdef(i.indexrelid)||':'||i.indisvalid||':'||i.indisready
    from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private')
  union all
  select 'policy:'||n.nspname||'.'||c.relname||':'||p.polname||':'||p.polcmd::text||':'||p.polpermissive||':'||p.polroles::text
    ||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
    from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private')
  union all
  select 'trigger:'||c.relname||':'||pg_get_triggerdef(t.oid)
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where (n.nspname in ('public','private') or t.tgname='a1_a4_pg_net_interlock_v5') and not t.tgisinternal
) definitions
$$;

create function private.a1_a4_financial_counts_v5() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,net,cron,pg_temp as $$
declare v_table text; v_count bigint; v_result jsonb:='{}';
begin
  foreach v_table in array array['checkout_sessions','checkout_session_items','inventory_reservations',
    'payment_intents','payment_attempts','payment_webhook_receipts','payment_events','payment_refunds',
    'payment_cancellations','payment_disputes','payment_outbox'] loop
    execute format('select count(*) from public.%I',v_table) into v_count;
    v_result:=v_result||jsonb_build_object(v_table,v_count);
  end loop;
  return v_result||jsonb_build_object(
    'settings',(select count(*) from public.business_payment_settings where enabled is distinct from false or environment not in ('test','production')),
    'sellers',(select count(*) from public.mp_seller_connections where status is distinct from 'disconnected'
      or protected_tokens is not null or refresh_owner is not null or refresh_started_at is not null or environment not in ('test','production')),
    'oauth_states',(select count(*) from public.mp_oauth_states where expires_at>clock_timestamp()),
    'pg_net_pending',(select count(*) from net.http_request_queue),
    'scheduler_active',(select count(*) from cron.job where active),
    'dispatcher_active',(select (not paused)::integer from private.a1_a4_release_control_v5 where singleton)
  );
end $$;

create function private.a1_a4_inert_snapshot_v5() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private,net,cron,pg_temp as $$
declare v_control private.a1_a4_release_control_v5%rowtype; v_not_before timestamptz; v_schema boolean;
begin
  select * into strict v_control from private.a1_a4_release_control_v5 where singleton;
  v_schema:=v_control.schema_sha=private.a1_a4_schema_sha_v5()
    and (select count(*)=14 and bool_and(tgenabled='A') from pg_trigger
      where tgname='a1_a4_financial_interlock_v5')
    and (select count(*)=1 and bool_and(tgenabled='O' and tgfoid='private.a1_a4_financial_write_guard_v5()'::regprocedure)
      from pg_trigger where tgrelid='net.http_request_queue'::regclass and tgname='a1_a4_pg_net_interlock_v5')
    and (select count(*)=1 and bool_and(tgenabled='O') from pg_trigger where tgrelid='public.payment_outbox'::regclass and tgname='payment_outbox_worker_kick')
    and (select count(*)=4 from cron.job)
    and not exists(select 1 from cron.job where database<>'postgres' or username<>'postgres' or nodename<>'localhost' or nodeport<>5432)
    and not exists(select 1 from cron.job where (jobname,command) not in (
      ('taba-payment-outbox-worker','select public.dispatch_payment_outbox_worker(''cron'');'),
      ('taba-checkout-expiry-sweep','select public.sweep_expired_checkout_sessions();'),
      ('taba-checkout-provider-truth-sweep','select public.enqueue_checkout_provider_probes();'),
      ('taba-operational-alerts-sweep','select public.evaluate_operational_alerts_sweep();')));
  v_not_before:=greatest(v_control.paused_at,v_control.drain_observed_at,
    (select max(requested_at) from private.a1_a4_payment_dispatch_audit),
    (select max(created) from net._http_response)) + interval '430 seconds';
  return jsonb_build_object('schema_ok',coalesce(v_schema,false),'paused',v_control.paused,
    'release_id',v_control.release_id,'not_before',v_not_before,
    'drained',v_control.drain_observed_at is not null and coalesce(clock_timestamp()>=v_not_before,false),'counts',private.a1_a4_financial_counts_v5());
end $$;
create function private.assert_a1_a4_inert_v5(p_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private,pg_temp as $$
declare v jsonb;
begin
  perform private.assert_a1_a4_release_lock_v5();
  perform 1 from private.a1_a4_release_control_v5 where singleton for share;
  v:=private.a1_a4_inert_snapshot_v5();
  if v->>'release_id' is distinct from p_id::text or (v->>'schema_ok')::boolean is distinct from true
    or (v->>'paused')::boolean is distinct from true or (v->>'drained')::boolean is distinct from true
    or exists(select 1 from jsonb_each_text(v->'counts') e where e.value::bigint<>0) then
    raise exception 'RELEASE_NOT_INERT_OR_DRAINED' using errcode='55000';
  end if;
  return v;
end $$;

create function private.quiesce_a1_a4_release_v5(p_commit text,p_source text,p_expand text,p_contract text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public,private,cron,pg_temp as $$
declare v_control private.a1_a4_release_control_v5%rowtype; v_id uuid:=gen_random_uuid(); v_jobs jsonb; v_job record; v_counts jsonb;
begin
  perform private.assert_a1_a4_release_lock_v5();
  select * into strict v_control from private.a1_a4_release_control_v5 where singleton for update;
  if v_control.paused or exists(select 1 from private.deployment_contract_executions where environment='production') then
    raise exception 'RELEASE_ALREADY_OPEN_OR_CONTRACTED' using errcode='55000';
  end if;
  if p_contract is distinct from v_control.contract_sha or v_control.schema_sha is distinct from private.a1_a4_schema_sha_v5() then
    raise exception 'RELEASE_COMPATIBILITY_MISMATCH' using errcode='55000';
  end if;
  v_counts:=private.a1_a4_financial_counts_v5()-array['scheduler_active','dispatcher_active','pg_net_pending'];
  if exists(select 1 from jsonb_each_text(v_counts) e where e.value::bigint<>0) then
    raise exception 'PRE_ONBOARDING_FINANCIAL_STATE_REQUIRED' using errcode='55000';
  end if;
  if (select count(*) from cron.job)<>4 or exists(select 1 from cron.job where database<>'postgres' or username<>'postgres' or nodename<>'localhost' or nodeport<>5432)
    or exists(select 1 from cron.job where (jobname,command) not in (
    ('taba-payment-outbox-worker','select public.dispatch_payment_outbox_worker(''cron'');'),
    ('taba-checkout-expiry-sweep','select public.sweep_expired_checkout_sessions();'),
    ('taba-checkout-provider-truth-sweep','select public.enqueue_checkout_provider_probes();'),
    ('taba-operational-alerts-sweep','select public.evaluate_operational_alerts_sweep();'))) then
    raise exception 'UNKNOWN_SCHEDULER' using errcode='55000';
  end if;
  select jsonb_agg(jsonb_build_object('jobid',jobid,'jobname',jobname,'command',command,'schedule',schedule,'active',active) order by jobname)
    into v_jobs from cron.job;
  insert into private.a1_a4_releases_v5(id,project_ref,phase,commit_sha,source_sha,expand_sha,schema_sha,contract_sha,scheduler_before)
    values(v_id,v_control.project_ref,'quiesced',p_commit,p_source,p_expand,v_control.schema_sha,p_contract,v_jobs);
  update private.a1_a4_release_control_v5 set paused=true,release_id=v_id,paused_at=clock_timestamp(),drain_observed_at=null where singleton;
  for v_job in select jobid from cron.job order by jobid loop perform cron.alter_job(v_job.jobid,active=>false); end loop;
  -- Leave the kick trigger installed/enabled. Both its original dispatcher OID
  -- and its public wrapper obey the durable interlock. ALTER TABLE here would
  -- invert the writer's table-lock -> control-row-lock order and can deadlock.
  insert into private.a1_a4_payment_dispatch_control(environment,paused,paused_at,paused_by,target_edge_version,generation)
    values('production',true,clock_timestamp(),session_user,v_id::text,v_id)
    on conflict(environment) do update set paused=true,paused_at=excluded.paused_at,paused_by=excluded.paused_by,
      target_edge_version=excluded.target_edge_version,generation=excluded.generation,updated_at=clock_timestamp();
  return v_id;
end $$;

create function private.seal_a1_a4_drain_v5(p_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,private,net,pg_temp as $$
begin
  perform private.assert_a1_a4_release_lock_v5();
  perform 1 from private.a1_a4_release_control_v5 where singleton and paused and release_id=p_id for update;
  if not found then raise exception 'QUIESCENCE_LOST'; end if;
  if exists(select 1 from net.http_request_queue) then raise exception 'PG_NET_STILL_DRAINING'; end if;
  update private.a1_a4_release_control_v5 set drain_observed_at=coalesce(drain_observed_at,clock_timestamp()) where singleton;
end $$;

create function private.a1_a4_validate_inventory_v5(p_inventory jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,private,pg_temp as $$
begin
  if jsonb_typeof(p_inventory) is distinct from 'array' then raise exception 'INVALID_REMOTE_INVENTORY'; end if;
  if (select array_agg(x->>'slug' order by x->>'slug') from jsonb_array_elements(p_inventory) x)
    is distinct from array['mercadopago-cancel-payment','mercadopago-checkout-status','mercadopago-connect',
      'mercadopago-create-checkout-session','mercadopago-create-preference','mercadopago-oauth-callback',
      'mercadopago-payment-worker','mercadopago-refund','mercadopago-webhook'] then raise exception 'INVALID_REMOTE_FUNCTION_SET'; end if;
  if exists(select 1 from jsonb_array_elements(p_inventory) x where
    x->>'name' is distinct from x->>'slug' or x->>'status' is distinct from 'ACTIVE'
    or coalesce(x->>'id','')!~'^[a-f0-9-]{36}$' or coalesce(x->>'version','')!~'^[1-9][0-9]*$'
    or coalesce(x->>'ezbr_sha256','')!~'^[a-f0-9]{64}$' or jsonb_typeof(x->'verify_jwt') is distinct from 'boolean'
    or coalesce(x->>'updated_at','')!~'^[1-9][0-9]*$') then raise exception 'INVALID_REMOTE_IDENTITY'; end if;
end $$;

create function private.capture_a1_a4_baseline_v5(p_id uuid,p_baseline jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,private,pg_temp as $$
begin
  perform private.assert_a1_a4_inert_v5(p_id);
  perform private.a1_a4_validate_inventory_v5(p_baseline);
  update private.a1_a4_releases_v5 set baseline=p_baseline,phase='staging'
    where id=p_id and phase='quiesced' and baseline is null and expires_at>clock_timestamp();
  if not found then raise exception 'BASELINE_ALREADY_CAPTURED_OR_EXPIRED'; end if;
end $$;

-- Store the immutable reserved versions BEFORE the single activation request.
-- A crash/retry can only reactivate these same versions. It cannot introduce a
-- successor while an earlier activation may still be in flight.
create function private.stage_a1_a4_release_v5(p_id uuid,p_staged jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,private,pg_temp as $$
declare v_release private.a1_a4_releases_v5%rowtype; v_row jsonb; v_old jsonb;
begin
  perform private.assert_a1_a4_inert_v5(p_id);
  select * into strict v_release from private.a1_a4_releases_v5 where id=p_id for update;
  if v_release.phase<>'staging' or v_release.expires_at<=clock_timestamp() then raise exception 'INVALID_RELEASE_PHASE'; end if;
  if jsonb_typeof(p_staged) is distinct from 'array' then raise exception 'INVALID_STAGED_RELEASE'; end if;
  if (select array_agg(x->>'slug' order by x->>'slug') from jsonb_array_elements(p_staged) x)
    is distinct from array['mercadopago-create-preference','mercadopago-payment-worker','mercadopago-refund'] then raise exception 'INCOMPLETE_STAGED_RELEASE'; end if;
  for v_row in select * from jsonb_array_elements(p_staged) loop
    select x into strict v_old from jsonb_array_elements(v_release.baseline) x where x->>'slug'=v_row->>'slug';
    if v_row->>'id' is distinct from v_old->>'id' or v_row->>'name' is distinct from v_row->>'slug'
      or v_row->>'status' is distinct from 'ACTIVE' or coalesce(v_row->>'version','')!~'^[1-9][0-9]*$'
      or (v_row->>'version')::bigint<=(v_old->>'version')::bigint
      or (v_row ? 'ezbr_sha256' and (coalesce(v_row->>'ezbr_sha256','')!~'^[a-f0-9]{64}$' or v_row->>'ezbr_sha256'=v_old->>'ezbr_sha256'))
      or (v_row->>'verify_jwt')::boolean is distinct from (v_row->>'slug'='mercadopago-refund')
      or (v_row ? 'entrypoint_path' and coalesce(v_row->>'entrypoint_path','')='')
      then raise exception 'STAGED_RELEASE_IDENTITY_MISMATCH'; end if;
  end loop;
  update private.a1_a4_releases_v5 set staged=p_staged,phase='activation_pending' where id=p_id;
end $$;

create function private.verify_a1_a4_release_v5(p_id uuid,p_remote jsonb,p_response jsonb,p_runtime jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,private,extensions,pg_temp as $$
declare v private.a1_a4_releases_v5%rowtype; v_old jsonb; v_actual jsonb; v_expected jsonb; v_remote_sha text;
begin
  perform private.assert_a1_a4_inert_v5(p_id);
  perform private.a1_a4_validate_inventory_v5(p_remote);
  select * into strict v from private.a1_a4_releases_v5 where id=p_id for update;
  if v.phase not in ('activation_pending','verified','attested','contracted') or v.staged is null
    then raise exception 'TRUSTED_RELEASE_REQUIRED'; end if;
  for v_old in select * from jsonb_array_elements(v.baseline) loop
    select x into strict v_actual from jsonb_array_elements(p_remote) x where x->>'slug'=v_old->>'slug';
    select x into v_expected from jsonb_array_elements(v.staged) x where x->>'slug'=v_old->>'slug';
    if v_expected is null then
      if v_actual is distinct from v_old then raise exception 'UNRELATED_REMOTE_CHANGE'; end if;
    elsif exists(select 1 from jsonb_each(v_expected-array['updated_at']) e where v_actual->e.key is distinct from e.value)
      or v_actual->>'ezbr_sha256'=v_old->>'ezbr_sha256'
      or (v_actual->>'updated_at')::bigint<=(v_old->>'updated_at')::bigint then
      raise exception 'PARTIAL_OR_STALE_REMOTE_RELEASE';
    end if;
  end loop;
  if p_response is not null and exists(select 1 from jsonb_array_elements(v.staged) s where not exists(
    select 1 from jsonb_array_elements(p_response->'functions') r
    where r->>'id'=s->>'id' and r->>'version'=s->>'version' and r->>'slug'=s->>'slug')) then
    raise exception 'ACTIVATION_RESPONSE_MISMATCH';
  end if;
  if jsonb_typeof(p_runtime) is distinct from 'array' then raise exception 'RUNTIME_RELEASE_PROOF_REQUIRED'; end if;
  if (select array_agg(x->>'function' order by x->>'function') from jsonb_array_elements(p_runtime) x)
    is distinct from array['mercadopago-create-preference','mercadopago-payment-worker','mercadopago-refund'] then raise exception 'INCOMPLETE_RUNTIME_RELEASE'; end if;
  if exists(select 1 from jsonb_array_elements(p_runtime) x where
    x->>'release_id' is distinct from p_id::text or x->>'project' is distinct from v.project_ref
    or x->>'protocol' is distinct from v.protocol or x->>'source_identity' is distinct from v.source_sha
    or coalesce(x->>'nonce','')!~'^[a-f0-9-]{36}$'
    or not exists(select 1 from jsonb_array_elements(v.staged) s where s->>'slug'=x->>'function'
      and x->>'deployment_id'=v.project_ref||'_'||(s->>'id')||'_'||(s->>'version'))) then raise exception 'RUNTIME_RELEASE_IDENTITY_MISMATCH'; end if;
  v_remote_sha:=encode(extensions.digest(p_remote::text,'sha256'),'hex');
  if v.verified_remote is not null and v.verified_remote is distinct from p_remote then raise exception 'RELEASE_CHANGED_AFTER_VERIFICATION'; end if;
  update private.a1_a4_releases_v5 set verified_remote=p_remote,runtime_proof=p_runtime,remote_sha=v_remote_sha,
    activation_response=coalesce(activation_response,p_response),verified_at=coalesce(verified_at,clock_timestamp()),
    last_checked_at=clock_timestamp(),check_pid=pg_backend_pid(),check_application_name=current_setting('application_name'),proof_expires_at=clock_timestamp()+interval '20 minutes',
    phase=case when phase='activation_pending' then 'verified' else phase end where id=p_id;
  update private.a1_a4_payment_dispatch_control set target_edge_version='sha256:'||v_remote_sha
    where environment='production' and generation=p_id and paused;
  if not found then raise exception 'QUIESCENCE_GENERATION_LOST'; end if;
end $$;

-- Retain the tested financial retirement body. Disable the old operational
-- entrances so V3 JSON and caller-supplied timestamps can no longer authorize it.
alter function private.create_a1_a4_drain_attestation_v3(text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text,jsonb)
  rename to create_a1_a4_drain_attestation_v3_body;
alter function private.execute_a1_a4_legacy_contract_v3(uuid,text,text,text,text,text,text)
  rename to execute_a1_a4_legacy_contract_v3_body;
create function private.create_a1_a4_drain_attestation_v3(text,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text,jsonb)
returns uuid language plpgsql as $$ begin raise exception 'V5_TRUSTED_RELEASE_REQUIRED'; end $$;
create function private.execute_a1_a4_legacy_contract_v3(uuid,text,text,text,text,text,text)
returns jsonb language plpgsql as $$ begin raise exception 'V5_TRUSTED_RELEASE_REQUIRED'; end $$;
create or replace function private.set_a1_a4_payment_dispatch_paused_v3(p_environment text,p_target_edge_version text,p_actor text,p_paused boolean)
returns jsonb language plpgsql as $$ begin raise exception 'V5_RELEASE_LIFECYCLE_REQUIRED'; end $$;

do $$ declare v_definition text; begin
  -- V5 uses a permanently installed dispatcher guard, not an ALTER TRIGGER
  -- pause. Preserve the tested V3 timing/ledger body behind the stronger gate.
  v_definition:=pg_get_functiondef('private.assert_a1_a4_drain_v3(text,text,timestamptz,timestamptz)'::regprocedure);
  if position('tgenabled=''D''' in v_definition)=0 then raise exception 'DRAIN_DEFINITION_MISMATCH'; end if;
  execute replace(v_definition,'tgenabled=''D''','tgenabled=''O''');
  -- Managed postgres has SELECT on cron.job, not table-owner privileges.
  -- The V5 writer/pg_net interlock prevents work even if a cron fires; the
  -- original SHARE table lock required unavailable UPDATE/DELETE privileges.
  v_definition:=pg_get_functiondef('private.execute_a1_a4_legacy_contract_v3_body(uuid,text,text,text,text,text,text)'::regprocedure);
  execute replace(v_definition,'lock table cron.job, net.http_request_queue in share mode;',
    'lock table cron.job in access share mode; lock table net.http_request_queue in share mode;');
end $$;

-- Even a direct invocation of an archived V3 body must pass the V5 trust root.
-- These INSERT guards run inside the original transaction, so retirement DDL
-- rolls back if a caller attempts to bypass V5 using a fabricated attestation.
create function private.a1_a4_trusted_attestation_guard_v5() returns trigger
language plpgsql security definer set search_path=pg_catalog,private,pg_temp as $$
declare v private.a1_a4_releases_v5%rowtype;
begin
  perform private.assert_a1_a4_release_lock_v5();
  select * into v from private.a1_a4_releases_v5 where id=(new.evidence->>'release_id')::uuid for share;
  if not found or v.phase not in ('verified','attested') or v.remote_sha is null
    or new.environment is distinct from 'production' or new.deployment_id is distinct from v.id::text
    or new.expand_version is distinct from '20260909050330' or new.actor is distinct from session_user
    or new.contract_sha is distinct from v.contract_sha or new.expand_sha is distinct from v.expand_sha
    or new.target_edge_version is distinct from 'sha256:'||v.remote_sha
    or new.evidence->>'protocol' is distinct from v.protocol
    or new.evidence->>'source_sha' is distinct from v.source_sha
    or new.evidence->>'schema_sha' is distinct from v.schema_sha
    or new.evidence->>'platform_snapshot_sha' is distinct from v.remote_sha
    or new.evidence->'edge_functions' is distinct from v.staged
    or new.evidence->>'platform_project_ref' is distinct from v.project_ref
    or v.check_pid is distinct from pg_backend_pid() or v.check_application_name is distinct from current_setting('application_name') or v.proof_expires_at<=clock_timestamp()
    or v.last_checked_at<clock_timestamp()-interval '60 seconds'
    or clock_timestamp()<v.verified_at+interval '430 seconds'
    or new.target_deployed_at is distinct from v.verified_at or new.traffic_switched_at is distinct from v.verified_at then
    raise exception 'DURABLE_V5_RELEASE_REQUIRED_FOR_ATTESTATION';
  end if;
  perform private.assert_a1_a4_inert_v5(v.id);
  return new;
end $$;
create trigger a1_a4_trusted_attestation_v5 before insert on private.deployment_drain_attestations
for each row execute function private.a1_a4_trusted_attestation_guard_v5();

create function private.a1_a4_trusted_execution_guard_v5() returns trigger
language plpgsql security definer set search_path=pg_catalog,private,pg_temp as $$
begin
  perform private.assert_a1_a4_release_lock_v5();
  if not exists(select 1 from private.a1_a4_releases_v5 r
    join private.a1_a4_release_control_v5 c on c.release_id=r.id and c.paused
    where r.phase='attested' and r.attestation_id=new.attestation_id and r.contract_sha=new.contract_sha
      and r.expand_sha=new.expand_sha and new.edge_version='sha256:'||r.remote_sha
      and r.check_pid=pg_backend_pid() and r.check_application_name=current_setting('application_name') and r.last_checked_at>clock_timestamp()-interval '60 seconds'
      and r.proof_expires_at>clock_timestamp() and new.environment='production') then
    raise exception 'DURABLE_V5_RELEASE_REQUIRED_FOR_CONTRACT';
  end if;
  return new;
end $$;
create trigger a1_a4_trusted_execution_v5 before insert on private.deployment_contract_executions
for each row execute function private.a1_a4_trusted_execution_guard_v5();

create function private.attest_a1_a4_release_v5(p_id uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,private,extensions,pg_temp as $$
declare v private.a1_a4_releases_v5%rowtype; v_id uuid; v_previous timestamptz; v_evidence jsonb;
begin
  perform private.assert_a1_a4_inert_v5(p_id);
  select * into strict v from private.a1_a4_releases_v5 where id=p_id for update;
  if v.phase not in ('verified','attested') or v.verified_remote is null or v.proof_expires_at<=clock_timestamp()
    or v.last_checked_at<clock_timestamp()-interval '60 seconds' or v.check_pid<>pg_backend_pid() or v.check_application_name is distinct from current_setting('application_name')
    or clock_timestamp()<v.verified_at+interval '430 seconds' then raise exception 'RELEASE_PROOF_OR_POST_RELEASE_DRAIN_REQUIRED'; end if;
  if v.attestation_id is not null and exists(select 1 from private.deployment_drain_attestations where id=v.attestation_id and status='pending' and expires_at>clock_timestamp()+interval '1 minute') then return v.attestation_id; end if;
  update private.deployment_drain_attestations set status='expired' where id=v.attestation_id and status='pending';
  select to_timestamp(max((x->>'updated_at')::bigint)/1000.0) into v_previous from jsonb_array_elements(v.baseline) x;
  v_evidence:=jsonb_build_object('release_id',v.id,'protocol',v.protocol,'source_sha',v.source_sha,
    'schema_sha',v.schema_sha,'platform_project_ref',v.project_ref,'platform_snapshot_sha',v.remote_sha,
    'edge_functions',v.staged,'non_dry_run',true);
  v_id:=private.create_a1_a4_drain_attestation_v3_body('production',v.id::text,
    'sha256:'||encode(extensions.digest(v.baseline::text,'sha256'),'hex'),'sha256:'||v.remote_sha,
    v.contract_sha,'20260909050330',v.expand_sha,v_previous,v.verified_at,v.verified_at,
    clock_timestamp()+interval '5 minutes',session_user,v_evidence);
  update private.a1_a4_releases_v5 set phase='attested',attestation_id=v_id where id=p_id;
  return v_id;
end $$;

create function private.execute_a1_a4_contract_v5(p_id uuid,p_contract text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private,pg_temp as $$
declare v private.a1_a4_releases_v5%rowtype; v_result jsonb;
begin
  perform private.assert_a1_a4_release_lock_v5();
  if exists(select 1 from private.deployment_contract_executions where contract_name='a1_a4_legacy_contract_v3' and environment='production') then raise exception 'ALREADY_APPLIED'; end if;
  perform private.assert_a1_a4_inert_v5(p_id);
  select * into strict v from private.a1_a4_releases_v5 where id=p_id for update;
  if v.phase<>'attested' or v.attestation_id is null or v.verified_remote is null
    or v.contract_sha is distinct from p_contract or p_contract is distinct from (select contract_sha from private.a1_a4_release_control_v5 where singleton)
    or v.proof_expires_at<=clock_timestamp() or v.last_checked_at<clock_timestamp()-interval '60 seconds'
    or v.check_pid<>pg_backend_pid() or v.check_application_name is distinct from current_setting('application_name') or v.actor_db_role<>session_user
    or not exists(select 1 from private.deployment_drain_attestations a where a.id=v.attestation_id
      and a.evidence->>'release_id'=v.id::text and a.evidence->>'protocol'=v.protocol) then
    raise exception 'TRUSTED_RELEASE_CONTRACT_BINDING_REQUIRED';
  end if;
  v_result:=private.execute_a1_a4_legacy_contract_v3_body(v.attestation_id,'production','sha256:'||v.remote_sha,
    v.contract_sha,'20260909050330',v.expand_sha,session_user);
  update private.a1_a4_releases_v5 set phase='contracted',contracted_at=clock_timestamp() where id=p_id;
  update private.a1_a4_release_control_v5 set schema_sha=private.a1_a4_schema_sha_v5() where singleton;
  return v_result;
end $$;

create function private.finish_a1_a4_release_v5(p_id uuid,p_abort boolean) returns void
language plpgsql security definer set search_path=pg_catalog,public,private,cron,pg_temp as $$
declare v private.a1_a4_releases_v5%rowtype; v_job jsonb;
begin
  perform private.assert_a1_a4_release_lock_v5();
  perform 1 from private.a1_a4_release_control_v5 where singleton and paused and release_id=p_id for update;
  if not found then raise exception 'QUIESCENCE_LOST'; end if;
  select * into strict v from private.a1_a4_releases_v5 where id=p_id for update;
  if p_abort then
    if v.phase not in ('quiesced','staging') then raise exception 'ACTIVATION_STARTED_RECOVER_SAME_RELEASE_ONLY'; end if;
  else
    perform private.assert_a1_a4_inert_v5(p_id);
    if v.phase<>'contracted' or v.last_checked_at<clock_timestamp()-interval '60 seconds' or v.check_pid<>pg_backend_pid() or v.check_application_name is distinct from current_setting('application_name')
      or not exists(select 1 from private.deployment_contract_executions where attestation_id=v.attestation_id) then raise exception 'CONTRACT_AND_REMOTE_VERIFICATION_REQUIRED'; end if;
  end if;
  for v_job in select * from jsonb_array_elements(v.scheduler_before) loop
    if not exists(select 1 from cron.job j where j.jobid=(v_job->>'jobid')::bigint and j.jobname=v_job->>'jobname'
      and j.command=v_job->>'command' and j.schedule=v_job->>'schedule' and not j.active) then raise exception 'SCHEDULER_CHANGED_DURING_RELEASE'; end if;
    perform cron.alter_job((v_job->>'jobid')::bigint,active=>(v_job->>'active')::boolean);
  end loop;
  -- The dispatcher guard and kick trigger remain permanently installed.
  update private.a1_a4_payment_dispatch_control set paused=false,paused_at=null,paused_by=null,target_edge_version=null,
    generation=gen_random_uuid(),updated_at=clock_timestamp() where environment='production';
  update private.a1_a4_release_control_v5 set paused=false where singleton;
  update private.a1_a4_releases_v5 set phase=case when p_abort then 'aborted' else 'resumed' end,finished_at=clock_timestamp() where id=p_id;
end $$;

-- Function creation defaults to PUBLIC EXECUTE, irrespective of the private
-- schema. Explicitly close every new control and every renamed V3 body.
do $$ declare p regprocedure; begin
  for p in select oid::regprocedure from pg_proc where pronamespace='private'::regnamespace
    and (proname like '%a1_a4%' or proname='dispatch_payment_outbox_worker_v3_body') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',p);
  end loop;
end $$;
update private.a1_a4_release_control_v5 set schema_sha=private.a1_a4_schema_sha_v5() where singleton;
