-- Staging certification follow-up: remove pre-idempotency Rider overloads.
-- Canonical contracts are claim_delivery_order(...) and
-- publish_rider_location_receipt(..., client_request_id, is_mock_location).

do $revoke_legacy_claim_gps$
begin
  if to_regprocedure('public.claim_available_rider_order(uuid,text,bigint,text,uuid)') is not null then
    execute 'revoke all on function public.claim_available_rider_order(uuid, text, bigint, text, uuid) from public, anon, authenticated';
  end if;
  if to_regprocedure('public.publish_rider_location(uuid,bigint,double precision,double precision,double precision,double precision,double precision,timestamp with time zone)') is not null then
    execute 'revoke all on function public.publish_rider_location(uuid, bigint, double precision, double precision, double precision, double precision, double precision, timestamp with time zone) from public, anon, authenticated';
  end if;
end;
$revoke_legacy_claim_gps$;

comment on function public.claim_delivery_order(uuid, text, bigint, text) is
  'Canonical idempotent Rider claim; legacy claim_available_rider_order overload is not callable.';
comment on function public.publish_rider_location_receipt(uuid, bigint, double precision, double precision, double precision, double precision, double precision, timestamptz, text, boolean) is
  'Canonical classified Rider GPS receipt; legacy publish_rider_location overload is not callable.';
