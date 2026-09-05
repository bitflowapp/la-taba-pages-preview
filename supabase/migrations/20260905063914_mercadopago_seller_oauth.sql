-- Incremental seller connections. Only service_role may access protected material.
create table public.mp_seller_connections (
  business_id uuid not null references public.businesses(id),
  environment text not null check (environment in ('test','production')),
  provider text not null default 'mercadopago' check (provider = 'mercadopago'),
  seller_id text,
  application_id text,
  status text not null default 'disconnected' check (status in ('disconnected','connected','requires_reauthorization')),
  scopes text not null default '',
  protected_tokens text,
  expires_at timestamptz,
  connected_at timestamptz,
  last_refresh_at timestamptz,
  generation uuid not null default gen_random_uuid(),
  refresh_owner uuid,
  refresh_started_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (business_id, environment),
  unique (environment, seller_id),
  check (status <> 'connected' or (protected_tokens is not null and expires_at is not null and seller_id is not null))
);
create table public.mp_oauth_states (
  state_hash text primary key,
  business_id uuid not null references public.businesses(id),
  user_id uuid not null references auth.users(id),
  environment text not null check (environment in ('test','production')),
  generation uuid not null,
  protected_verifier text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.mp_seller_connections enable row level security;
alter table public.mp_oauth_states enable row level security;
revoke all on public.mp_seller_connections, public.mp_oauth_states from public, anon, authenticated;
grant all on public.mp_seller_connections, public.mp_oauth_states to service_role;

-- Uses the existing session/membership authority, including revoked sessions.
create function public.mp_connection_authorized(p_business_id uuid) returns boolean
language sql stable security invoker set search_path = pg_catalog, public, pg_temp
as $$ select auth.uid() is not null and public.has_business_role(p_business_id, array['owner','admin']) $$;
revoke all on function public.mp_connection_authorized(uuid) from public, anon;
grant execute on function public.mp_connection_authorized(uuid) to authenticated;

create function public.mp_begin_oauth(p_business_id uuid, p_user_id uuid, p_environment text, p_state_hash text, p_protected_verifier text)
returns uuid language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
declare v_generation uuid := gen_random_uuid();
begin
  insert into public.mp_seller_connections(business_id,environment) values(p_business_id,p_environment) on conflict do nothing;
  update public.mp_seller_connections set generation=v_generation, updated_at=now()
    where business_id=p_business_id and environment=p_environment and refresh_owner is null;
  if not found then raise exception 'connection_busy'; end if;
  delete from public.mp_oauth_states where (business_id=p_business_id and environment=p_environment) or expires_at < now();
  insert into public.mp_oauth_states values(p_state_hash,p_business_id,p_user_id,p_environment,v_generation,p_protected_verifier,now()+interval '10 minutes',now());
  return v_generation;
end $$;

create function public.mp_consume_oauth(p_state_hash text, p_environment text)
returns setof public.mp_oauth_states language sql security invoker set search_path = pg_catalog, public, pg_temp as $$
  delete from public.mp_oauth_states s where s.state_hash=p_state_hash and s.environment=p_environment and s.expires_at>now()
    and exists(select 1 from public.mp_seller_connections c where c.business_id=s.business_id and c.environment=s.environment and c.generation=s.generation)
    returning s.*
$$;

-- All settings and protected material become visible atomically; stale callbacks cannot reconnect after disconnect.
create function public.mp_finish_oauth(p_business_id uuid,p_environment text,p_generation uuid,p_seller_id text,p_application_id text,p_scopes text,p_protected_tokens text,p_expires_at timestamptz)
returns boolean language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
begin
  perform 1 from public.mp_seller_connections where business_id=p_business_id and environment=p_environment and generation=p_generation for update;
  if not found then return false; end if;
  -- Changing the receiving account while historical intents exist would corrupt reconciliation.
  if exists(select 1 from public.business_payment_settings s where s.business_id=p_business_id and s.collector_id is not null and s.collector_id<>p_seller_id
    and exists(select 1 from public.payment_intents i where i.business_id=p_business_id)) then raise exception 'seller_change_requires_migration'; end if;
  update public.mp_seller_connections set seller_id=p_seller_id,application_id=p_application_id,scopes=p_scopes,
    protected_tokens=p_protected_tokens,expires_at=p_expires_at,status='connected',connected_at=now(),updated_at=now(),refresh_owner=null,refresh_started_at=null
    where business_id=p_business_id and environment=p_environment and generation=p_generation;
  insert into public.business_payment_settings(business_id,environment,collector_id,application_id,configured_at,verified_at,enabled)
    values(p_business_id,p_environment,p_seller_id,p_application_id,now(),now(),p_environment='test')
  on conflict(business_id,provider) do update set collector_id=excluded.collector_id,application_id=excluded.application_id,
    configured_at=now(),verified_at=now(),updated_at=now(),
    enabled=case when business_payment_settings.environment=p_environment then business_payment_settings.enabled or p_environment='test' else false end,
    environment=p_environment;
  return true;
end $$;

-- No lease takeover: an ambiguous rotating refresh must not be issued twice.
-- A worker crash expires into reauthorization, never reuse of a possibly consumed refresh token.
create function public.mp_claim_refresh(p_business_id uuid,p_environment text,p_owner uuid)
returns setof public.mp_seller_connections language sql security invoker set search_path=pg_catalog,public,pg_temp as $$
  update public.mp_seller_connections set refresh_owner=p_owner,refresh_started_at=now()
    where business_id=p_business_id and environment=p_environment and status='connected'
      and expires_at < now()+interval '1 day' and refresh_owner is null returning *
$$;
create function public.mp_finish_refresh(p_business_id uuid,p_environment text,p_owner uuid,p_generation uuid,p_protected_tokens text,p_expires_at timestamptz,p_scopes text)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin
  update public.mp_seller_connections set protected_tokens=p_protected_tokens,expires_at=p_expires_at,scopes=p_scopes,
    refresh_owner=null,refresh_started_at=null,last_refresh_at=now(),updated_at=now()
    where business_id=p_business_id and environment=p_environment and refresh_owner=p_owner and generation=p_generation and status='connected';
  return found;
end $$;
create function public.mp_disconnect(p_business_id uuid,p_environment text)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin
  update public.mp_seller_connections set protected_tokens=null,status='disconnected',generation=gen_random_uuid(),
    refresh_owner=null,refresh_started_at=null,updated_at=now() where business_id=p_business_id and environment=p_environment;
  delete from public.mp_oauth_states where business_id=p_business_id and environment=p_environment;
  update public.business_payment_settings set enabled=false,updated_at=now() where business_id=p_business_id and environment=p_environment;
  return true;
end $$;

alter table public.payment_webhook_receipts add column seller_business_id uuid references public.businesses(id);
create function public.mp_record_seller_webhook(p_environment text,p_webhook_event_id text,p_event_type text,p_resource_id text,p_signature_valid boolean,p_request_id text,p_payload_hash text,p_business_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare v_result jsonb;
begin
  if not exists(select 1 from public.mp_seller_connections where business_id=p_business_id and environment=p_environment and status='connected') then raise exception 'seller_not_connected'; end if;
  v_result := public.record_mercadopago_webhook_receipt(p_environment,p_webhook_event_id,p_event_type,p_resource_id,p_signature_valid,p_request_id,p_payload_hash);
  update public.payment_webhook_receipts set seller_business_id=p_business_id where id=(v_result->>'receipt_id')::uuid and seller_business_id is null;
  if exists(select 1 from public.payment_webhook_receipts where id=(v_result->>'receipt_id')::uuid and seller_business_id<>p_business_id) then raise exception 'webhook_business_mismatch'; end if;
  return v_result;
end $$;

-- No public RPC may consume state or decrypt/update credentials.
revoke all on function public.mp_begin_oauth(uuid,uuid,text,text,text), public.mp_consume_oauth(text,text),
 public.mp_finish_oauth(uuid,text,uuid,text,text,text,text,timestamptz), public.mp_claim_refresh(uuid,text,uuid),
 public.mp_finish_refresh(uuid,text,uuid,uuid,text,timestamptz,text),public.mp_disconnect(uuid,text),
 public.mp_record_seller_webhook(text,text,text,text,boolean,text,text,uuid) from public,anon,authenticated;
grant execute on function public.mp_begin_oauth(uuid,uuid,text,text,text), public.mp_consume_oauth(text,text),
 public.mp_finish_oauth(uuid,text,uuid,text,text,text,text,timestamptz), public.mp_claim_refresh(uuid,text,uuid),
 public.mp_finish_refresh(uuid,text,uuid,uuid,text,timestamptz,text),public.mp_disconnect(uuid,text),
 public.mp_record_seller_webhook(text,text,text,text,boolean,text,text,uuid) to service_role;
