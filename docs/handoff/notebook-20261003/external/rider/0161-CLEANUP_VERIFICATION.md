# Cleanup verification — staging

Certification synthetic data is preserved only as terminal audit history.

- Synthetic orders created in this run family: 6, all terminal; active: 0.
- Active Rider GPS rows for those orders: 0.
- Active handoff locks: 0.
- Stock was restored atomically after each delivered synthetic order; cancelled synthetic orders used the business cancellation RPC.
- Reservation tables: none in the deployed schema.
- Temporary Rider memberships active: 0; inactive historical memberships: 8.
- Terminal outbox rows: 2, one per delivered synthetic order and retained intentionally as contractual audit/outbox evidence.
- `delivery_outbox` has no `status` or `processed_at` field, so it has no schema-level “pending” residue to remove.
- Existing Rider A/B orders, including non-QA-marked active deliveries, were never changed.

PASS — no active synthetic delivery, GPS, lock, or operational membership remains.
