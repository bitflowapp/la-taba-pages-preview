-- CONTRACT: separately authorized only after the documented external drain.
-- A timer or an expired lease is not evidence that old provider I/O has ended.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table public.payment_outbox,public.payment_refunds in share mode;
do $$ begin
 if current_setting('taba.a1_a4_drain_verified',true) is distinct from 'on' then
   raise exception 'independent deployment/version drain evidence required';
 end if;
 if exists(select 1 from public.payment_outbox where status in ('claimed','processing'))
   or exists(select 1 from public.payment_refunds where status in ('requested','processing')) then
   raise exception 'financial operations not drained';
 end if;
end; $$;

create or replace function public.prepare_mercadopago_preference(p_checkout_session_id uuid,p_customer_id uuid,p_new_attempt boolean default false) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin raise exception 'legacy payment edge retired; use V2' using errcode='55000'; end; $$;

create or replace function public.record_mercadopago_preference_created(p_payment_attempt_id uuid,p_preference_id text,p_init_point text,p_sandbox_init_point text,p_response_hash text,p_provider_request_id text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin raise exception 'legacy payment edge retired; use V2' using errcode='55000'; end; $$;

create or replace function public.record_payment_refund_response(p_refund_id uuid,p_provider_refund_id text,p_status text,p_amount numeric,p_response_hash text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin raise exception 'legacy payment edge retired; use V2' using errcode='55000'; end; $$;

create or replace function public.get_mercadopago_payment_authority(p_business_id uuid,p_environment text,p_checkout_session_id uuid,p_customer_id uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin raise exception 'legacy payment edge retired; use V2' using errcode='55000'; end; $$;

create or replace function public.prepare_payment_refund(p_payment_intent_id uuid,p_amount numeric,p_idempotency_key uuid,p_reason text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin raise exception 'legacy refund edge retired; use V2' using errcode='55000'; end; $$;
create or replace function public.claim_payment_outbox(p_owner text,p_limit integer default 20,p_lease_seconds integer default 90)
returns setof public.payment_outbox language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin raise exception 'legacy worker retired; use V2' using errcode='55000'; end; $$;

commit;
