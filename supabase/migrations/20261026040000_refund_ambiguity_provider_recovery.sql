-- Independent review of PR #157. An ambiguous refund whose provider identity never arrived had no way out:
-- 20261026010000 requires provider evidence for "executed" and 20261026030000 forbids "not executed", so a request that
-- never reached Mercado Pago froze the order (order_payment_blocks_fulfilment) and every new refund FOREVER.
--
-- The way out is provider evidence, never an operator's note. This function is called only by the payment worker, with
-- the provider's own refund list for the payment. It settles the refund as "not executed" only when ALL of these hold:
--   * the refund is still ambiguous and has no provider identity;
--   * the list was read completely (HTTP 200, a JSON array, not truncated);
--   * the request is older than any invocation that could still be sending it;
--   * every refund the provider lists that moved or may move money is already a row of THIS payment with the same
--     amount, so nothing the provider holds is unaccounted for.
-- Anything else leaves the refund ambiguous (the owner can still adopt a provider refund as "executed" with evidence).
-- The evidence is always refreshed on the open case, so a refund that became visible late can be adopted by the owner.
create function public.settle_ambiguous_refund_from_provider(p_refund_id uuid, p_evidence jsonb)
returns text
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_r public.payment_refunds%rowtype;
  v_i public.payment_intents%rowtype;
  v_seen jsonb := coalesce(p_evidence -> 'provider_refunds', '[]'::jsonb);
  v_complete boolean := coalesce(p_evidence ->> 'list_complete' = 'true', false);
  v_item jsonb;
  v_id text;
  v_amount numeric;
begin
  if jsonb_typeof(v_seen) is distinct from 'array' then
    raise exception 'provider refund evidence must be a list' using errcode = '22023';
  end if;
  select * into v_r from public.payment_refunds where id = p_refund_id;
  if not found then raise exception 'reembolso inexistente' using errcode = 'P0002'; end if;
  select * into v_i from public.payment_intents where id = v_r.payment_intent_id for update;
  select * into v_r from public.payment_refunds where id = p_refund_id for update;
  if v_r.status <> 'ambiguous' or v_r.provider_refund_id is not null then return 'not_applicable'; end if;

  -- An unreadable list (a provider outage) must never overwrite evidence that was read earlier.
  if not v_complete then return 'incomplete_evidence'; end if;
  update public.payment_discrepancies
     set details = details || jsonb_build_object('provider_refunds_seen', v_seen, 'evidence_complete', true,
                                                 'evidence_captured_at', clock_timestamp()),
         last_detected_at = clock_timestamp()
   where refund_id = p_refund_id and kind = 'refund_identity_unknown' and status <> 'resolved';

  -- Longer than an Edge invocation plus the provider timeout: the original request cannot still be in flight.
  if v_r.requested_at > clock_timestamp() - interval '15 minutes' then return 'too_recent'; end if;

  for v_item in select * from jsonb_array_elements(v_seen) loop
    -- A refund the provider rejected or cancelled moved no money; it cannot be ours in flight.
    if lower(coalesce(v_item ->> 'status', '')) in ('rejected', 'cancelled', 'failed') then continue; end if;
    v_id := v_item ->> 'id';
    begin
      v_amount := (v_item ->> 'amount')::numeric;
    exception when others then
      return 'unaccounted';
    end;
    if v_id is null or v_id !~ '^[1-9][0-9]{0,31}$' or v_amount is null
       or not exists (select 1 from public.payment_refunds x
                       where x.payment_intent_id = v_i.id and x.id <> p_refund_id
                         and x.provider_refund_id = v_id and x.amount = v_amount) then
      return 'unaccounted';
    end if;
  end loop;

  update public.payment_refunds
     set status = 'failed', completed_at = clock_timestamp(),
         reason = left(coalesce(reason, '') || ' | not executed: the provider refund list was read completely and every refund in it is already recorded', 300)
   where id = p_refund_id;
  -- The job that is calling is under lease: the worker completes it itself. Only waiting or abandoned jobs close here.
  update public.payment_outbox set status = 'completed', completed_at = clock_timestamp()
   where refund_id = p_refund_id and topic = 'refund_reconcile' and status in ('pending', 'retry_wait', 'failed', 'dead_letter');
  update public.payment_discrepancies
     set status = 'resolved', resolved_at = clock_timestamp(), resolved_by = null, resolution = 'not_executed_in_provider',
         resolution_note = 'resolved by the system from a complete provider refund list'
   where refund_id = p_refund_id and kind = 'refund_identity_unknown' and status <> 'resolved';
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (v_i.id, 'payment.refund_ambiguity_resolved',
    jsonb_build_object('refund_id', p_refund_id, 'outcome', 'not_executed', 'actor_user_id', null, 'source', 'provider_list'));
  return 'settled_not_executed';
end $$;
revoke all on function public.settle_ambiguous_refund_from_provider(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.settle_ambiguous_refund_from_provider(uuid, jsonb) to service_role;

-- The owner can ask for another provider read once the automatic retries are exhausted (dead letter) or the evidence
-- looks stale. It only schedules a read: nothing about money changes until the worker has provider evidence.
create function public.request_refund_reverification(p_refund_id uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_r public.payment_refunds%rowtype;
  v_i public.payment_intents%rowtype;
begin
  select * into v_r from public.payment_refunds where id = p_refund_id;
  if not found then raise exception 'reembolso inexistente' using errcode = 'P0002'; end if;
  select * into v_i from public.payment_intents where id = v_r.payment_intent_id for update;
  if v_actor is null or not public.has_business_role(v_i.business_id, array['owner', 'admin']) then
    raise exception 'resolucion no autorizada' using errcode = '42501';
  end if;
  select * into v_r from public.payment_refunds where id = p_refund_id for update;
  if v_r.status <> 'ambiguous' or v_r.provider_refund_id is not null then return false; end if;
  if not exists (select 1 from public.payment_outbox where refund_id = p_refund_id and topic = 'refund_reconcile'
                  and status in ('pending', 'claimed', 'processing', 'retry_wait')) then
    insert into public.payment_outbox (payment_intent_id, refund_id, topic, resource_id, last_error)
    values (v_i.id, p_refund_id, 'refund_reconcile', null, 'owner_requested_reverification');
  end if;
  return true;
end $$;
revoke all on function public.request_refund_reverification(uuid) from public, anon;
grant execute on function public.request_refund_reverification(uuid) to authenticated;
