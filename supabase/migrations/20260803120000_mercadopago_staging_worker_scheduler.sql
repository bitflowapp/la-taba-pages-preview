-- Durable Mercado Pago outbox dispatch for hosted Supabase.
-- Mercado Pago credentials remain Edge Function secrets. Only the independent
-- worker HMAC secret is mirrored into encrypted Supabase Vault so pg_cron can
-- authenticate a short-lived dispatch without putting the secret in pg_net.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function public.dispatch_payment_outbox_worker(p_source text default 'cron')
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, vault, net, pg_temp
as $$
declare
  v_worker_url text;
  v_worker_secret text;
  v_timestamp text;
  v_nonce text;
  v_manifest text;
  v_signature text;
  v_request_id bigint;
  v_due boolean;
begin
  if p_source not in ('cron', 'outbox') then
    raise exception 'invalid payment worker dispatch source' using errcode = '22023';
  end if;

  select exists (
    select 1
      from public.payment_outbox o
     where (o.status in ('pending', 'retry_wait') and o.next_attempt_at <= clock_timestamp())
        or (o.status in ('claimed', 'processing') and coalesce(o.lease_expires_at, '-infinity'::timestamptz) < clock_timestamp())
  ) into v_due;
  if not v_due then return null; end if;

  select ds.decrypted_secret
    into v_worker_url
    from vault.decrypted_secrets ds
   where ds.name = 'taba_payment_worker_url'
   limit 1;
  select ds.decrypted_secret
    into v_worker_secret
    from vault.decrypted_secrets ds
   where ds.name = 'taba_payment_worker_hmac_secret'
   limit 1;

  -- A missing Vault configuration is a safe no-op. Deployment preflight must
  -- prove both names exist before staging certification.
  if nullif(btrim(v_worker_url), '') is null or nullif(v_worker_secret, '') is null then
    return null;
  end if;
  if v_worker_url !~ '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/mercadopago-payment-worker$' then
    raise exception 'invalid payment worker URL' using errcode = '22023';
  end if;
  if length(v_worker_secret) < 32 then
    raise exception 'payment worker secret is too short' using errcode = '22023';
  end if;

  v_timestamp := floor(extract(epoch from clock_timestamp()))::bigint::text;
  v_nonce := gen_random_uuid()::text;
  v_manifest := v_timestamp || '.' || v_nonce || '.POST./functions/v1/mercadopago-payment-worker';
  v_signature := encode(hmac(v_manifest, v_worker_secret, 'sha256'), 'hex');

  select net.http_post(
    url := v_worker_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-taba-worker-timestamp', v_timestamp,
      'x-taba-worker-nonce', v_nonce,
      'x-taba-worker-signature', v_signature
    ),
    body := jsonb_build_object('source', p_source, 'scheduled_at', clock_timestamp()),
    timeout_milliseconds := 5000
  ) into v_request_id;
  return v_request_id;
end;
$$;

create or replace function public.kick_payment_outbox_worker()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform public.dispatch_payment_outbox_worker('outbox');
  return null;
exception when others then
  -- Never roll back a durable receipt/job because the best-effort immediate
  -- kick failed. The cron recovery path remains authoritative.
  return null;
end;
$$;

drop trigger if exists payment_outbox_worker_kick on public.payment_outbox;
create trigger payment_outbox_worker_kick
after insert on public.payment_outbox
for each statement execute function public.kick_payment_outbox_worker();

do $$
begin
  perform cron.schedule(
    'taba-payment-outbox-worker',
    '30 seconds',
    'select public.dispatch_payment_outbox_worker(''cron'');'
  );
end;
$$;

create or replace function public.list_payment_outbox_operational_alerts()
returns table (
  severity text,
  correlation_id uuid,
  observed_at timestamptz,
  state text,
  action text
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    case
      when o.status in ('dead_letter', 'failed') then 'critical'
      when o.status in ('claimed', 'processing') then 'high'
      else 'warning'
    end as severity,
    o.id as correlation_id,
    case
      when o.status in ('claimed', 'processing') then o.lease_expires_at
      else o.next_attempt_at
    end as observed_at,
    case
      when o.status = 'dead_letter' then 'payment_outbox_dead_letter'
      when o.status = 'failed' then 'payment_outbox_failed'
      when o.status in ('claimed', 'processing') then 'payment_outbox_lease_expired'
      else 'payment_outbox_delayed'
    end as state,
    case
      when o.status = 'dead_letter' then 'inspect_provider_state_then_queue_authorized_reconciliation'
      when o.status = 'failed' then 'inspect_worker_configuration_and_last_error'
      when o.status in ('claimed', 'processing') then 'allow_cron_to_reclaim_expired_lease'
      else 'verify_cron_and_edge_function_health'
    end as action
  from public.payment_outbox o
  where o.status in ('dead_letter', 'failed')
     or (o.status in ('claimed', 'processing') and o.lease_expires_at < clock_timestamp())
     or (o.status in ('pending', 'retry_wait') and o.next_attempt_at < clock_timestamp() - interval '2 minutes')
  order by
    case when o.status in ('dead_letter', 'failed') then 0 else 1 end,
    observed_at;
$$;

revoke all on function public.dispatch_payment_outbox_worker(text) from public, anon, authenticated;
revoke all on function public.kick_payment_outbox_worker() from public, anon, authenticated;
revoke all on function public.list_payment_outbox_operational_alerts() from public, anon, authenticated;
grant execute on function public.dispatch_payment_outbox_worker(text) to service_role;
grant execute on function public.list_payment_outbox_operational_alerts() to service_role;

comment on function public.dispatch_payment_outbox_worker(text) is
  'Dispatches due Mercado Pago outbox work through pg_net using a short-lived HMAC; Vault keeps the shared secret encrypted at rest.';
comment on function public.list_payment_outbox_operational_alerts() is
  'Service-only minimal operational alerts for delayed, expired-lease, failed and dead-letter payment work.';
