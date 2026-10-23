-- A pending payment nobody can read any more must stay visible.
--
-- 20261022130000 stopped following sellers whose Mercado Pago connection is gone (every read would fail and be
-- enqueued again forever). It also made run_financial_integrity_checks CLOSE the findings of such a seller:
--   - pending_payment_unchecked was resolved as 'checked_again' ("the pending payment was read again or settled");
--   - order_paid_unverified was resolved as 'verified_no_loss' ("the provider confirmed the payment again").
-- Neither had happened. When Mercado Pago revokes the link (mp_mark_seller_deauthorized also turns the payment
-- method off, so MERCADOPAGO_SELLER_CANNOT_CHARGE does not fire), a payment still pending at the provider (a cash
-- ticket can be paid days later) lost its only alert: the money could be approved and nobody would know.
--
-- Now:
--   - a pending payment of a seller that cannot be read is a finding, opened ONCE per payment (never re-opened
--     after a person resolved it, never counted again: nothing piles up while the seller stays disconnected);
--   - a pending finding closes only when the payment was read again or settled, never because the link is gone;
--   - an overdue verification of a COMPLETED order still closes when the seller disconnects (a voluntary
--     disconnect is allowed with it on purpose), but with the truth: resolution 'seller_disconnected'.
-- Nothing is enqueued for a disconnected seller (unchanged).
--
-- REVERSAL: re-apply run_financial_integrity_checks from 20261022130000. No row is rewritten here.

create or replace function public.run_financial_integrity_checks(p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_unverified integer := 0; v_no_order integer := 0; v_pending integer := 0; v_unreadable integer := 0; v_row record;
begin
  for v_row in
    select pi.id, pi.business_id, pi.checkout_session_id, pi.provider_payment_id, pi.environment
      from public.payment_intents pi
     where pi.order_id is not null and pi.paid_amount is not null
       and pi.created_at > clock_timestamp() - interval '30 days'
       and private.provider_seller_connected(pi.business_id, pi.environment)
       and exists (select 1 from public.payment_provider_payments x
                    where x.payment_intent_id = pi.id and x.is_financing and x.watch_state = 'verify'
                      and x.next_check_at < clock_timestamp() - interval '1 hour')
     order by pi.created_at desc limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    perform private.open_payment_discrepancy(v_row.business_id, v_row.id, v_row.checkout_session_id, 'order_paid_unverified',
      'high', false, v_row.provider_payment_id, jsonb_build_object('reason', 'provider verification is overdue'),
      'order_paid_unverified:' || v_row.id::text, null, null, v_row.environment);
    v_unverified := v_unverified + 1;
  end loop;
  -- Verified again later => the finding closes itself.
  update public.payment_discrepancies d set status = 'resolved', resolved_at = clock_timestamp(), resolution = 'verified_no_loss',
         resolution_note = 'the provider confirmed the payment again'
   where d.kind = 'order_paid_unverified' and d.status <> 'resolved'
     and not exists (select 1 from public.payment_provider_payments x
                      where x.payment_intent_id = d.payment_intent_id and x.is_financing and x.watch_state = 'verify'
                        and x.next_check_at < clock_timestamp() - interval '1 hour');
  -- Still overdue but the seller is gone: say so instead of claiming a verification.
  update public.payment_discrepancies d set status = 'resolved', resolved_at = clock_timestamp(), resolution = 'seller_disconnected',
         resolution_note = 'the Mercado Pago link is gone: a later refund or chargeback of this order can only be checked in Mercado Pago'
   where d.kind = 'order_paid_unverified' and d.status <> 'resolved'
     and not exists (select 1 from public.payment_intents di
                      where di.id = d.payment_intent_id and private.provider_seller_connected(di.business_id, di.environment));
  for v_row in
    select pi.id, pi.business_id, pi.checkout_session_id, pi.environment, x.provider_payment_id, x.id as watch_id
      from public.payment_provider_payments x
      join public.payment_intents pi on pi.id = x.payment_intent_id
     where x.watch_state = 'pending' and x.next_check_at < clock_timestamp() - interval '1 hour'
       and private.provider_seller_connected(pi.business_id, pi.environment)
     order by x.next_check_at limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    perform private.open_payment_discrepancy(v_row.business_id, v_row.id, v_row.checkout_session_id, 'pending_payment_unchecked',
      'high', false, v_row.provider_payment_id, jsonb_build_object('reason', 'a pending provider payment was not re-read on schedule'),
      'pending_unchecked:' || v_row.watch_id::text, null, null, v_row.environment);
    v_pending := v_pending + 1;
  end loop;
  -- A pending payment of a seller that can no longer be read: one finding per payment, opened once.
  for v_row in
    select pi.id, pi.business_id, pi.checkout_session_id, pi.environment, x.provider_payment_id, x.id as watch_id
      from public.payment_provider_payments x
      join public.payment_intents pi on pi.id = x.payment_intent_id
     where x.watch_state = 'pending' and x.next_check_at < clock_timestamp() - interval '1 hour'
       and not private.provider_seller_connected(pi.business_id, pi.environment)
       and not exists (select 1 from public.payment_discrepancies d where d.dedupe_key = 'pending_unchecked:' || x.id::text)
     order by x.next_check_at limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    perform private.open_payment_discrepancy(v_row.business_id, v_row.id, v_row.checkout_session_id, 'pending_payment_unchecked',
      'high', false, v_row.provider_payment_id,
      jsonb_build_object('reason', 'the Mercado Pago link is gone: reconnect it, or check this pending payment in Mercado Pago',
                         'seller_connected', false),
      'pending_unchecked:' || v_row.watch_id::text, null, null, v_row.environment);
    v_unreadable := v_unreadable + 1;
  end loop;
  -- Read again or settled => the finding closes itself. A lost link never closes it.
  update public.payment_discrepancies d set status = 'resolved', resolved_at = clock_timestamp(), resolution = 'checked_again',
         resolution_note = 'the pending payment was read again or settled'
   where d.kind = 'pending_payment_unchecked' and d.status <> 'resolved'
     and not exists (select 1 from public.payment_provider_payments x
                      where x.payment_intent_id = d.payment_intent_id and x.watch_state = 'pending'
                        and x.next_check_at < clock_timestamp() - interval '1 hour');
  for v_row in
    select pi.id, pi.business_id, pi.checkout_session_id, pi.provider_payment_id, pi.environment
      from public.payment_intents pi
     where pi.order_id is null and pi.provider_status = 'approved' and pi.paid_amount is not null
       and pi.updated_at < clock_timestamp() - interval '10 minutes'
       and pi.internal_status not in ('refunded', 'partially_refunded', 'charged_back')
     order by pi.updated_at limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    perform private.open_payment_discrepancy(v_row.business_id, v_row.id, v_row.checkout_session_id, 'paid_without_order',
      'high', false, v_row.provider_payment_id, jsonb_build_object('stage', 'integrity_check'),
      'paid_without_order:' || v_row.id::text, null, null, v_row.environment);
    v_no_order := v_no_order + 1;
  end loop;
  update public.payment_discrepancies d set status = 'resolved', resolved_at = clock_timestamp(), resolution = 'order_created',
         resolution_note = 'the order now exists'
   where d.kind = 'paid_without_order' and d.status <> 'resolved'
     and exists (select 1 from public.payment_intents pi where pi.id = d.payment_intent_id and pi.order_id is not null);
  return jsonb_build_object('order_paid_unverified', v_unverified, 'paid_without_order', v_no_order,
    'pending_payment_unchecked', v_pending, 'pending_payment_unreadable', v_unreadable);
end $$;
