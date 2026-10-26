-- An owner-selected ID cannot turn a pending/rejected/absent provider refund
-- into money returned. Preserve the original RPC, locks, roles and grants.
do $patch$
declare
  v_definition text := pg_get_functiondef('public.resolve_ambiguous_refund(uuid,text,text,text)'::regprocedure);
  v_before text := $before$    delete from public.payment_refunds where provider_refund_id = v_id and origin = 'external' and payment_intent_id = v_i.id;$before$;
  v_guard text := $guard$    -- CONFIRMED_PROVIDER_REFUND_AMOUNT
    if not exists (
      select 1 from public.payment_discrepancies d
      cross join lateral jsonb_array_elements(coalesce(d.details -> 'provider_refunds_seen', '[]'::jsonb)) seen
      where d.refund_id = p_refund_id and d.kind = 'refund_identity_unknown'
        and seen ->> 'id' = v_id
        and lower(coalesce(seen ->> 'status', '')) = 'approved'
        and (seen ->> 'amount')::numeric = v_r.amount
    ) then
      raise exception 'provider evidence must confirm the refund id, approved status and exact amount'
        using errcode = '22023';
    end if;
$guard$;
begin
  if position('CONFIRMED_PROVIDER_REFUND_AMOUNT' in v_definition) > 0 then return; end if;
  if position(v_before in v_definition) = 0 then raise exception 'REFUND_RESOLUTION_PATCH_MISMATCH'; end if;
  execute replace(v_definition, v_before, v_guard || v_before);
end $patch$;
