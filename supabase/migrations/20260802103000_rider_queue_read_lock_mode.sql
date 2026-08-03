-- get_rider_queue validates the active Rider membership with FOR SHARE.
-- PostgREST executes STABLE functions in a read-only transaction, where that
-- lock is rejected. VOLATILE preserves the membership lock and routes this
-- read-only projection through a read-write transaction without changing data.

alter function public.get_rider_queue(uuid) volatile;

comment on function public.get_rider_queue(uuid) is
  'Minimized ready-for-pickup queue for the authenticated active rider; VOLATILE preserves membership FOR SHARE validation.';
