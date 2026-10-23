-- Local-only stand-ins for the managed Supabase pieces that a plain PostgreSQL does not ship.
-- Never applied to a hosted project. pg_cron / pg_net / supabase_vault are modelled by plain tables so
-- the migrations, interlocks and SQL tests run unchanged against a disposable cluster.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_storage_admin') then create role supabase_storage_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator noinherit login; end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create schema if not exists vault;
create schema if not exists cron;
create schema if not exists net;
create schema if not exists realtime;
create schema if not exists storage;

create table cron.job (
  jobid bigserial primary key, schedule text not null, command text not null,
  nodename text not null default 'localhost', nodeport integer not null default 5432,
  database text not null default 'postgres', username text not null default 'postgres',
  active boolean not null default true, jobname text unique);
create table cron.job_run_details (
  jobid bigint, runid bigserial primary key, job_pid integer, database text, username text,
  command text, status text, return_message text, start_time timestamptz, end_time timestamptz);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into cron.job(jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command, active = true
  returning jobid into v_id;
  return v_id;
end $$;
create function cron.unschedule(job_name text) returns boolean language sql as $$
  with d as (delete from cron.job where jobname = job_name returning 1) select exists(select 1 from d) $$;
create function cron.unschedule(job_id bigint) returns boolean language sql as $$
  with d as (delete from cron.job where jobid = job_id returning 1) select exists(select 1 from d) $$;
create function cron.alter_job(job_id bigint, schedule text default null, command text default null,
  database text default null, username text default null, active boolean default null) returns void language sql as $$
  update cron.job j set schedule = coalesce($2, j.schedule), command = coalesce($3, j.command),
    active = coalesce($6, j.active) where j.jobid = $1 $$;

create table net.http_request_queue (
  id bigserial primary key, method text, url text, headers jsonb, body bytea, timeout_milliseconds integer);
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds integer default 5000)
  returns bigint language sql as $$
  insert into net.http_request_queue(method, url, headers, body, timeout_milliseconds)
  values ('POST', url, headers, convert_to(body::text, 'utf8'), timeout_milliseconds) returning id $$;

create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text,
  secret text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, created_at, updated_at from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
  returns uuid language sql as $$
  insert into vault.secrets(name, description, secret) values (new_name, new_description, new_secret) returning id $$;

create table storage.buckets (id text primary key, name text, created_at timestamptz default now(),
  updated_at timestamptz default now(), public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
do $$ begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if;
end $$;
