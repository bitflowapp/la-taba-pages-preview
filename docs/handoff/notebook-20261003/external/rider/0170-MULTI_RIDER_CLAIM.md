# Multi-Rider claim

Two isolated Rider sessions read the same minimized ready queue and issued `claim_delivery_order` concurrently with the same authoritative revision.

- Queue visibility: both Riders saw the synthetic delivery without customer contact data or delivery code.
- Result: exactly one winner.
- Loser: explicit CAS conflict (`stale_revision`), not an optimistic local success.
- Winner recovered the authoritative active delivery through `get_active_rider_delivery`.
- No duplicate assignment was observed.

PASS — concurrent claim is serialized and conflict is honest.
