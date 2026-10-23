-- Fixes from the independent review of the financial core (2026-10-23). Applied AFTER 20261022233526; nothing already
-- applied is edited. Every change is a CREATE OR REPLACE of an existing function (privileges are kept), and the one patch
-- of a large function is an exact-text replacement that fails closed if the deployed definition is not the expected one.
--
--   1. HIGH   A payment that Mercado Pago reports as `in_mediation` (the buyer opened a dispute) was judged an unknown
--             status: the intent became `security_review_required` (absorbing), the session `manual_review_required`, a
--             BLOCKING critical discrepancy was opened, the owner's refund was refused and disconnection was blocked
--             forever, on a purchase that was already paid and fulfilled. A dispute is information about money already
--             collected: it is now recorded, shown to the owner as a non-blocking finding, and closed by itself when the
--             payment leaves mediation. The intent and the session are not touched.
--   2. MEDIUM retry_stuck_paid_checkouts() fulfilled approved purchases of ANY age. After a deploy, or after a payment
--             was refunded in the provider's dashboard before the next read, it would create an order and take stock for
--             a purchase that is days old. The sweep now acts only within 48 h of the approval; older ones are shown to
--             the owner as `paid_without_order` instead of being fulfilled automatically. The failure event is no longer
--             written on every run for the same intent.
--   3. MEDIUM find_payment_intent_by_external_reference() also returns the owner business, so that the worker can refuse
--             to apply a payment read with business B's token to a checkout of business A (see the worker change).
--   4. MEDIUM resolve_ambiguous_refund('executed') accepted any provider refund id that had the right shape. When the
--             provider's own list was captured as evidence, the id must now be one of the refunds in that list; with no
--             evidence the owner can still resolve it with a written note.
--
-- Rollback: docs/migrations/rollback/20261023210000_financial_core_review_fixes.rollback.sql

-- ---------------------------------------------------------------------------------------------------------------
-- 1. in_mediation
-- ---------------------------------------------------------------------------------------------------------------
-- Same rank as `approved`: after a dispute the provider returns to `approved` (seller wins) or moves on to refunded /
-- charged_back, and the newer provider time decides between equal ranks.
create or replace function private.provider_payment_status_rank(p_status text) returns integer
language sql immutable set search_path = pg_catalog as $$
  select case lower(btrim(coalesce(p_status, '')))
    when 'pending' then 10
    when 'in_process' then 20
    when 'authorized' then 20
    when 'rejected' then 30
    when 'cancelled' then 30
    when 'canceled' then 30
    when 'expired' then 30
    when 'approved' then 40
    when 'in_mediation' then 40
    when 'refunded' then 50
    when 'charged_back' then 60
    else 0
  end $$;

do $patch$
declare
  v_oid regprocedure := 'public.record_mercadopago_payment_snapshot(uuid,jsonb,text,uuid)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  v_whitelist text := $a$'expired', 'refunded', 'charged_back') then$a$;
  v_anchor text := $a$  -- Which payment speaks for the intent? What it is decides (money moved), not when it arrived.$a$;
  v_branch text := $b$
  -- A dispute (in_mediation) is information about money that was already collected, not a payment state that changes
  -- the purchase: it is recorded and shown to the owner, and the intent and the session are left as they are. Treating
  -- it as an unknown status turned a paid, fulfilled order into an absorbing review state that also refused the refund.
  if v_status = 'in_mediation' then
    insert into public.payment_events (payment_intent_id, webhook_receipt_id, provider_event_id, event_type, provider_status,
      provider_status_detail, provider_occurred_at, raw_response_hash, details)
    values (v_intent.id, p_webhook_receipt_id, v_pid, 'payment.in_mediation', v_status, nullif(p_snapshot ->> 'status_detail', ''),
      v_provider_time, p_snapshot ->> 'raw_response_hash', jsonb_build_object('source', p_source, 'applied_to_intent', false))
    on conflict do nothing;
    perform private.open_payment_discrepancy(v_intent.business_id, v_intent.id, v_session.id, 'payment_in_mediation', 'high',
      false, v_pid, jsonb_build_object('status', v_status, 'status_detail', nullif(p_snapshot ->> 'status_detail', ''),
        'amount', v_amount, 'source', p_source),
      'in_mediation:' || v_intent.id::text || ':' || v_pid, null, v_seller, v_intent.environment);
    return jsonb_build_object('ok', true, 'mediation', true, 'payment_intent_id', v_intent.id,
      'internal_status', v_intent.internal_status, 'manual_review_required', false,
      'finalize_required', v_intent.internal_status = 'approved_order_pending' and v_session.status = 'payment_approved');
  end if;
  -- The payment left mediation (the seller won, or it moved on to a refund): the finding closes by itself.
  update public.payment_discrepancies
     set status = 'resolved', resolved_at = clock_timestamp(), resolution = 'provider_status_' || v_status,
         resolution_note = 'resolved automatically: the provider payment left mediation'
   where dedupe_key = 'in_mediation:' || v_intent.id::text || ':' || v_pid and status <> 'resolved';

$b$;
  v_new text;
  v_count integer;
begin
  if position($a$'in_mediation'$a$ in v_def) > 0 then
    return; -- already patched
  end if;
  v_count := (length(v_def) - length(replace(v_def, v_whitelist, ''))) / length(v_whitelist);
  if v_count <> 1 then raise exception 'unexpected snapshot function definition (status whitelist matches: %)', v_count; end if;
  v_count := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_count <> 1 then raise exception 'unexpected snapshot function definition (anchor matches: %)', v_count; end if;
  v_new := replace(v_def, v_whitelist, $a$'expired', 'refunded', 'charged_back', 'in_mediation') then$a$);
  v_new := replace(v_new, v_anchor, v_branch || v_anchor);
  execute v_new;
end $patch$;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. The stuck-purchase sweep has an age
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.retry_stuck_paid_checkouts(p_limit integer default 25) returns integer
language plpgsql security definer set search_path = pg_catalog, public, extensions, pg_temp as $$
declare
  v_row record;
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_done integer := 0;
  v_res jsonb;
begin
  -- Too old to fulfil on the system's own authority: a purchase approved more than 48 h ago may have been refunded in the
  -- provider's dashboard, and its customer is gone. The owner sees it and decides.
  for v_row in
    select pi.id as intent_id, pi.business_id, pi.checkout_session_id, pi.provider_payment_id
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where pi.order_id is null and cs.completed_order_id is null
       and pi.provider_status = 'approved' and pi.paid_amount is not distinct from cs.total
       and (pi.internal_status = 'approved_order_pending'
            or (pi.internal_status = 'security_review_required'
                and pi.security_review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation')))
       and cs.status in ('payment_approved', 'manual_review_required', 'finalizing_order')
       and coalesce(pi.approved_at, pi.updated_at) <= clock_timestamp() - interval '48 hours'
     order by pi.updated_at
     limit 25
  loop
    begin
      perform private.open_payment_discrepancy(v_row.business_id, v_row.intent_id, v_row.checkout_session_id, 'paid_without_order',
        'high', false, v_row.provider_payment_id,
        jsonb_build_object('reason', 'approved_over_48h_without_order', 'stage', 'sweep'),
        'paid_without_order:' || v_row.intent_id::text);
    exception when others then
      insert into public.payment_events (payment_intent_id, event_type, details)
      select v_row.intent_id, 'payment.auto_recovery_failed', jsonb_build_object('sqlstate', sqlstate, 'message', left(sqlerrm, 200))
       where not exists (select 1 from public.payment_events e where e.payment_intent_id = v_row.intent_id
                          and e.event_type = 'payment.auto_recovery_failed' and e.server_recorded_at > clock_timestamp() - interval '1 hour');
    end;
  end loop;

  for v_row in
    select pi.id as intent_id, pi.checkout_session_id
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where pi.order_id is null and cs.completed_order_id is null
       and pi.provider_status = 'approved' and pi.paid_amount is not distinct from cs.total
       and (pi.internal_status = 'approved_order_pending'
            or (pi.internal_status = 'security_review_required'
                and pi.security_review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation')))
       and cs.status in ('payment_approved', 'manual_review_required', 'finalizing_order')
       and pi.updated_at < clock_timestamp() - interval '45 seconds'
       and coalesce(pi.approved_at, pi.updated_at) > clock_timestamp() - interval '48 hours'
     order by pi.updated_at
     limit greatest(1, least(coalesce(p_limit, 25), 100))
  loop
    begin
      select * into v_intent from public.payment_intents where id = v_row.intent_id for update skip locked;
      if not found then continue; end if;
      select * into v_session from public.checkout_sessions where id = v_row.checkout_session_id for update skip locked;
      if not found or v_session.completed_order_id is not null then continue; end if;
      if private.payment_financial_hold(v_intent.id) is not null then continue; end if;
      v_res := private.advance_paid_checkout(v_session.id, null, 'sweep');
      if coalesce((v_res ->> 'order_id') is not null, false) then v_done := v_done + 1; end if;
    exception when others then
      -- One bad row must not hide the others. The discrepancy / alert layer shows rows that stay stuck. One event per
      -- intent per hour: the same failure every minute was a growing table, not information.
      insert into public.payment_events (payment_intent_id, event_type, details)
      select v_row.intent_id, 'payment.auto_recovery_failed', jsonb_build_object('sqlstate', sqlstate, 'message', left(sqlerrm, 200))
       where not exists (select 1 from public.payment_events e where e.payment_intent_id = v_row.intent_id
                          and e.event_type = 'payment.auto_recovery_failed' and e.server_recorded_at > clock_timestamp() - interval '1 hour');
    end;
  end loop;
  return v_done;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. The reference lookup says which business owns the checkout
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.find_payment_intent_by_external_reference(
  p_environment text, p_external_reference text
)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_intent public.payment_intents%rowtype;
begin
  select * into v_intent from public.payment_intents pi
   where pi.environment = lower(btrim(coalesce(p_environment, '')))
     and pi.external_reference = btrim(coalesce(p_external_reference, ''))
   for share;
  if not found then raise exception 'referencia de pago desconocida' using errcode = 'P0002'; end if;
  return jsonb_build_object('payment_intent_id', v_intent.id, 'checkout_session_id', v_intent.checkout_session_id,
    'business_id', v_intent.business_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. A provider refund id has to be one the provider listed
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.resolve_ambiguous_refund(
  p_refund_id uuid, p_outcome text, p_provider_refund_id text, p_note text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_r public.payment_refunds%rowtype;
  v_i public.payment_intents%rowtype;
  v_id text := nullif(btrim(coalesce(p_provider_refund_id, '')), '');
  v_total numeric(12, 2);
begin
  select * into v_r from public.payment_refunds where id = p_refund_id;
  if not found then raise exception 'reembolso inexistente' using errcode = 'P0002'; end if;
  select * into v_i from public.payment_intents where id = v_r.payment_intent_id for update;
  select * into v_r from public.payment_refunds where id = p_refund_id for update;
  if v_actor is null or not public.has_business_role(v_i.business_id, array['owner', 'admin']) then
    raise exception 'resolucion no autorizada' using errcode = '42501';
  end if;
  if v_r.status <> 'ambiguous' then raise exception 'el reembolso no esta pendiente de aclaracion' using errcode = '55000'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'la nota de evidencia es obligatoria (10+ caracteres)' using errcode = '22023';
  end if;
  if p_outcome = 'executed' then
    if v_id is null or v_id !~ '^[1-9][0-9]{0,31}$' then
      raise exception 'identidad de reembolso invalida' using errcode = '22023';
    end if;
    if exists (select 1 from public.payment_refunds x where x.provider_refund_id = v_id and x.id <> p_refund_id and x.origin <> 'external') then
      raise exception 'esa identidad ya pertenece a otro reembolso' using errcode = '23505';
    end if;
    -- When the provider's own refund list was captured as evidence, the id must be one of its entries: a typo (or a
    -- wrong number) must not mark money as returned. With no evidence captured the owner can still resolve it, in writing.
    if exists (select 1 from public.payment_discrepancies d
                cross join lateral jsonb_array_elements(coalesce(d.details -> 'provider_refunds_seen', '[]'::jsonb)) seen
               where d.refund_id = p_refund_id and d.kind = 'refund_identity_unknown')
       and not exists (select 1 from public.payment_discrepancies d
                        cross join lateral jsonb_array_elements(coalesce(d.details -> 'provider_refunds_seen', '[]'::jsonb)) seen
                       where d.refund_id = p_refund_id and d.kind = 'refund_identity_unknown' and seen ->> 'id' = v_id) then
      raise exception 'esa identidad no figura entre los reembolsos que el proveedor informo para este pago' using errcode = '22023';
    end if;
    delete from public.payment_refunds where provider_refund_id = v_id and origin = 'external' and payment_intent_id = v_i.id;
    update public.payment_refunds
       set provider_refund_id = v_id, status = 'approved', completed_at = clock_timestamp(),
           reason = left(coalesce(reason, '') || ' | resolved: ' || btrim(p_note), 300)
     where id = p_refund_id;
    v_total := private.refresh_refund_totals(v_i.id, null, null, v_r.requested_at);
    if v_i.internal_status <> 'security_review_required' then
      update public.payment_intents
         set internal_status = case when v_total >= coalesce(paid_amount, expected_amount) then 'refunded' else 'partially_refunded' end
       where id = v_i.id;
    end if;
  elsif p_outcome = 'not_executed' then
    update public.payment_refunds
       set status = 'failed', completed_at = clock_timestamp(),
           reason = left(coalesce(reason, '') || ' | not executed: ' || btrim(p_note), 300)
     where id = p_refund_id;
  else
    raise exception 'resultado invalido' using errcode = '22023';
  end if;
  update public.payment_outbox set status = 'completed', completed_at = clock_timestamp()
   where refund_id = p_refund_id and topic = 'refund_reconcile' and status in ('pending', 'claimed', 'processing', 'retry_wait', 'failed', 'dead_letter');
  update public.payment_discrepancies
     set status = 'resolved', resolved_at = clock_timestamp(), resolved_by = v_actor,
         resolution = case p_outcome when 'executed' then 'refunded_in_provider' else 'not_executed_in_provider' end,
         resolution_note = left(btrim(p_note), 500)
   where refund_id = p_refund_id and kind = 'refund_identity_unknown' and status <> 'resolved';
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (v_i.id, 'payment.refund_ambiguity_resolved',
    jsonb_build_object('refund_id', p_refund_id, 'outcome', p_outcome, 'actor_user_id', v_actor));
  return jsonb_build_object('ok', true, 'refund_id', p_refund_id, 'outcome', p_outcome);
end $$;
