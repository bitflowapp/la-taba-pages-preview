-- Staging certification follow-up: remove the pre-idempotency route-start RPC.
-- The canonical Rider contract is start_rider_delivery(uuid, bigint, text).

do $revoke_legacy_start_rider_delivery$
begin
  if to_regprocedure('public.start_rider_delivery(uuid,bigint)') is not null then
    execute 'revoke all on function public.start_rider_delivery(uuid, bigint) from public, anon, authenticated';
  end if;
end;
$revoke_legacy_start_rider_delivery$;

comment on function public.start_rider_delivery(uuid, bigint, text) is
  'Canonical idempotent Rider route-start transition; legacy two-argument signature is not callable.';
