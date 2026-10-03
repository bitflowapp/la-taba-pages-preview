# Terminal convergence

- Order status: `delivered` for customer and business reads.
- Rider `get_active_rider_delivery`: null after terminal confirmation.
- Delivered transition event: exactly one canonical `order.status_changed` event with `next_status=delivered`.
- Terminal outbox: exactly one `delivery_confirmed` outbox row per delivered synthetic order.
- Exact Rider GPS: purged/absent after terminal transition.
- Further GPS publication: `terminal` rejection.

PASS — customer, business, Rider, event, outbox, and tracking closure converge on the server-confirmed terminal result.
