-- Distributed, privacy-minimized Edge Function rate limiter. Subjects are
-- SHA-256 hashes calculated in the Edge runtime; raw IPs, emails, and tokens
-- never reach PostgreSQL.

create table if not exists public.payment_rate_limit_buckets (
  scope text not null,
  subject_hash text not null,
  bucket_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (scope, subject_hash, bucket_started_at),
  constraint payment_rate_limit_scope_check
    check (scope in ('checkout_session', 'preference', 'checkout_status', 'webhook', 'refund', 'cancellation', 'worker')),
  constraint payment_rate_limit_subject_hash_check
    check (subject_hash ~ '^[a-f0-9]{64}$'),
  constraint payment_rate_limit_count_check
    check (request_count >= 0)
);

alter table public.payment_rate_limit_buckets enable row level security;
revoke all privileges on table public.payment_rate_limit_buckets from public, anon, authenticated;

create or replace function public.consume_payment_rate_limit(
  p_scope text,
  p_subject_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if p_scope not in ('checkout_session', 'preference', 'checkout_status', 'webhook', 'refund', 'cancellation', 'worker')
    or p_subject_hash !~ '^[a-f0-9]{64}$'
    or p_limit not between 1 and 1000
    or p_window_seconds not between 10 and 3600 then
    raise exception 'rate limit invalido' using errcode = '22023';
  end if;
  v_bucket := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  insert into public.payment_rate_limit_buckets (
    scope, subject_hash, bucket_started_at, request_count
  ) values (
    p_scope, p_subject_hash, v_bucket, 1
  ) on conflict (scope, subject_hash, bucket_started_at)
  do update set request_count = public.payment_rate_limit_buckets.request_count + 1
  returning request_count into v_count;
  return jsonb_build_object('allowed', v_count <= p_limit, 'count', v_count, 'limit', p_limit, 'bucket_started_at', v_bucket);
end;
$$;

revoke all on function public.consume_payment_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_payment_rate_limit(text, text, integer, integer) to service_role;
