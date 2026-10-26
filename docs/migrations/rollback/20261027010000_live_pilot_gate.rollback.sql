-- Rollback of 20261027010000_live_pilot_gate.sql
-- Removes the closed-pilot gate. After this, real-money payments are limited ONLY by the platform switches
-- (MERCADOPAGO_PRODUCTION_REVIEW_STATUS, MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION and the per-business switch):
-- do not run it while a business is switched on in production unless the final key has been removed first.
-- A consumed authorization is the record of a real purchase: the rollback refuses to erase it. Export it first
-- (select * from public.payment_live_pilot_authorizations) and drop the guard below only with that copy in hand.
do $$
begin
  if exists (select 1 from public.payment_live_pilot_authorizations where status = 'consumed') then
    raise exception 'refusing to drop consumed live pilot authorizations (records of real purchases): export them first';
  end if;
end $$;

drop trigger if exists payment_live_pilot_gate_trg on public.payment_intents;
drop function if exists public.enforce_live_pilot_payment_intent();
drop function if exists public.get_live_pilot_status(uuid, text);
drop function if exists public.set_live_payment_scope(uuid, text, text, text, text);
drop function if exists public.abort_live_pilot_payment(uuid, text);
drop function if exists public.authorize_live_pilot_payment(uuid, text, uuid, jsonb, numeric, text, text, text, text, text, text, text, text, text, integer);
drop function if exists public.live_pilot_applies(uuid, text);
drop table if exists public.payment_live_pilot_authorizations;
drop table if exists public.payment_live_scope_log;
drop table if exists public.payment_live_scope;
drop function if exists public.payment_live_pilot_immutable();
drop function if exists public.payment_live_scope_log_append_only();
