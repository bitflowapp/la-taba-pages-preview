-- Preserve every historical record. Strengthen the binding for clean onboarding.
create or replace function public.mp_finish_oauth(p_business_id uuid,p_environment text,p_generation uuid,p_seller_id text,p_application_id text,p_scopes text,p_protected_tokens text,p_expires_at timestamptz)
returns boolean language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
begin
  perform 1 from public.mp_seller_connections where business_id=p_business_id and environment=p_environment and generation=p_generation for update;
  if not found then return false; end if;
  -- Once bound, a connection cannot silently switch seller, even without payments.
  -- Disconnect retains seller_id deliberately; reconnecting the same seller is allowed.
  if exists(select 1 from public.mp_seller_connections c where c.business_id=p_business_id
    and c.environment=p_environment and c.seller_id is not null and c.seller_id<>p_seller_id)
  then raise exception 'seller_change_requires_migration'; end if;
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
