# Remote schema verification — staging

Verified over TLS against `ukxqbgswjlibmnjemrzd` as temporary `postgres` access.

- PostgreSQL: 17.6.
- Canonical signatures present: 10/10.
- Canonical security/grant violations: 0.
- All canonical Rider RPCs use `SECURITY DEFINER`, fixed `search_path`, deny `anon`, and grant only `authenticated`.
- RLS enabled: 4/4 Rider contract tables (`rider_delivery_operations`, `delivery_confirmation_attempts`, `rider_delivery_issues`, `delivery_outbox`).
- Terminal delivery guard trigger present: 1 (`orders_prevent_rider_unverified_delivery`).
- Legacy claim, route-start, and GPS bypass overloads executable by `authenticated`: 0.
- `get_rider_queue(uuid)` is `VOLATILE`, preserving its membership `FOR SHARE` validation outside PostgREST's read-only transaction.

Canonical RPCs verified: `get_rider_queue`, `get_active_rider_delivery`, `claim_delivery_order`, `mark_delivery_picked_up`, `start_rider_delivery`, `mark_rider_arrived`, `publish_rider_location_receipt`, `confirm_delivery_code`, `report_rider_delivery_issue`, `release_or_reassign_delivery`.

The canonical queue and active-delivery RPCs were also invoked through PostgREST after schema refresh; no `PGRST202` remained.
