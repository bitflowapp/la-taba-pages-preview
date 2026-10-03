# Migration application — staging only

- Authorized destination verified before every mutation: `ukxqbgswjlibmnjemrzd` / `la-taba-staging`.
- PostgreSQL access: temporary Supabase JIT role `postgres` over TLS; no permanent database password was created.
- Remote history before the Rider work: 21 migrations; `20260802100000` was absent.
- Each change had a transaction dry run with rollback before application.

Applied Rider sequence:

1. `20260802100000_rider_delivery_server_contracts.sql`
2. `20260802101000_rider_delivery_legacy_start_revocation.sql`
3. `20260802102000_rider_delivery_legacy_claim_gps_revocation.sql`
4. `20260802103000_rider_queue_read_lock_mode.sql`
5. `20260802104000_rider_location_receipt_revision.sql`

The incremental Rider migrations were required by reproducible staging failures: absent legacy overloads, a PostgREST read-only transaction conflict for the membership lock, unsafe legacy callable routes, and a NOT NULL `rider_locations.order_revision` receipt failure. No pre-existing migration was edited after application.

Remote history after application: 26 migrations total; all five Rider migration markers present. No production project was queried or changed.
