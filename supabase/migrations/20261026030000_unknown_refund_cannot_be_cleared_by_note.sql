-- A lost response is not evidence that no money moved. Releasing this hold
-- would permit a new refund UUID before the first request was reconciled.
-- Definitive provider rejections still settle through record_payment_refund_response_v2.
do $patch$
declare
  v_definition text := pg_get_functiondef('public.resolve_ambiguous_refund(uuid,text,text,text)'::regprocedure);
  v_before text := $before$  elsif p_outcome = 'not_executed' then$before$;
  v_guard text := $guard$
    -- UNKNOWN_REFUND_REQUIRES_PROVIDER_OUTCOME
    raise exception 'an ambiguous provider outcome cannot be cleared by an operator note; reconcile the provider result'
      using errcode = '55000';
$guard$;
begin
  if position('UNKNOWN_REFUND_REQUIRES_PROVIDER_OUTCOME' in v_definition) > 0 then return; end if;
  if position(v_before in v_definition) = 0 then raise exception 'REFUND_NEGATIVE_RESOLUTION_PATCH_MISMATCH'; end if;
  execute replace(v_definition, v_before, v_before || v_guard);
end $patch$;
