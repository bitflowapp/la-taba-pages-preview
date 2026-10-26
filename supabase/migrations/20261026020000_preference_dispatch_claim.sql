-- Independent audit A-04: one local owner dispatches a preference POST, even if concurrent searches were empty.
-- Commit before provider I/O. Do not reclaim request_sent: a terminated invocation may already have sent it.
create function public.claim_mercadopago_preference_dispatch(
  p_payment_attempt_id uuid, p_customer_id uuid, p_expected_authority text
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp as $$
declare
  v_intent public.payment_intents%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_snapshot jsonb;
begin
  select i.* into v_intent from public.payment_intents i
    join public.payment_attempts a on a.payment_intent_id = i.id
    where a.id = p_payment_attempt_id for update of i;
  if not found then raise exception 'payment attempt not found' using errcode = 'P0002'; end if;
  select * into v_session from public.checkout_sessions where id = v_intent.checkout_session_id for update;
  if v_session.customer_id is distinct from p_customer_id then
    raise exception 'checkout not authorized' using errcode = '42501';
  end if;
  select * into v_attempt from public.payment_attempts where id = p_payment_attempt_id for update;
  if v_attempt.status <> 'prepared' or v_attempt.preference_id is not null then return null; end if;
  v_snapshot := public.get_mercadopago_payment_authority_v2(
    v_intent.business_id, v_intent.environment, v_session.id, p_customer_id, p_payment_attempt_id);
  if v_snapshot is null or v_snapshot->>'authority_version' is distinct from p_expected_authority
    or v_intent.current_payment_attempt_id is distinct from p_payment_attempt_id
    or v_attempt.attempt_type <> 'preference'
    or v_intent.internal_status not in ('created','preference_creating','preference_created','redirected','ambiguous')
    or v_session.status not in ('ready_for_payment','redirected','payment_pending')
    or v_session.expires_at <= clock_timestamp() then
    raise exception 'payment authority changed' using errcode = '55000';
  end if;
  update public.payment_attempts set status = 'request_sent' where id = p_payment_attempt_id;
  return public.get_mercadopago_payment_authority_v2(
    v_intent.business_id, v_intent.environment, v_session.id, p_customer_id, p_payment_attempt_id);
end $$;
revoke all on function public.claim_mercadopago_preference_dispatch(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_mercadopago_preference_dispatch(uuid,uuid,text) to service_role;
