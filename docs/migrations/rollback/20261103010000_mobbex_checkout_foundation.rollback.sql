-- Rollback of supabase/migrations/20261103010000_mobbex_checkout_foundation.sql
--
-- It removes ONLY what that migration created and restores the one thing it widened (the allowed values of
-- orders.payment_method). Mercado Pago, cash and pickup are not touched by the migration, so nothing of theirs is
-- touched here either.
--
-- It REFUSES to run when Mobbex ever recorded money: a payment that exists must be refunded and archived
-- by a person first (see docs/mobbex/RUNBOOK.md, "Rollback"). Switching Mobbex off does NOT need this script:
-- `mobbex_enabled=false` (Edge secret) and `configure_mobbex_business(..., false, ...)` are the rollback by flag.
--
-- Verified by scripts/mobbex/run-mobbex-db-tests.mjs: up -> down -> up on the real schema, and the refusal with money recorded.

do $guard$
begin
  if exists (select 1 from public.mobbex_payment_intents where paid_amount is not null or order_id is not null)
     or exists (select 1 from public.orders where payment_method = 'mobbex') then
    raise exception 'ROLLBACK_REFUSED: Mobbex payments or orders exist; refund and archive them before dropping the ledger';
  end if;
end $guard$;

drop trigger if exists mobbex_order_transition_guard on public.orders;
drop trigger if exists orders_assert_mobbex_payment_modality on public.orders;

alter table public.orders drop constraint orders_payment_method_valid;
alter table public.orders add constraint orders_payment_method_valid check (
  payment_method in ('mercadopago', 'cash', 'coordinate', 'qa_no_charge')
);
comment on constraint orders_payment_method_valid on public.orders is
  'Modalidad de pago explícita: Mercado Pago, efectivo, coordinado o QA sin cargo.';

drop table if exists public.mobbex_jobs cascade;
drop table if exists public.mobbex_webhook_receipts cascade;
drop table if exists public.mobbex_refunds cascade;
drop table if exists public.mobbex_payment_events cascade;
drop table if exists public.mobbex_live_authorizations cascade;
drop table if exists public.mobbex_payment_intents cascade;
drop table if exists public.mobbex_business_settings cascade;

do $drop$
declare v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.proname like '%mobbex%'
  loop
    execute format('drop function if exists %s cascade', v_fn);
  end loop;
end $drop$;
