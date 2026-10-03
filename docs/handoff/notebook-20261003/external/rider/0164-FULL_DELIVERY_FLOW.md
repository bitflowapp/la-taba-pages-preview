# Full Rider delivery flow — live staging

All steps used authenticated HTTP RPCs or normal business status RPCs; no direct `orders` update was used.

1. Synthetic customer created an idempotent delivery order once.
2. Business accepted, prepared, and marked it ready.
3. Two Riders raced to claim; one won and one received an explicit conflict.
4. Winner recovered active delivery, confirmed pickup, and started the route.
5. GPS receipt contract passed accepted, inaccurate, throttled, and impossible-jump paths.
6. Stale arrival revision was rejected; snapshot reconciliation enabled confirmed arrival.
7. Incorrect code, same-key double tap idempotency, persistent rate limit, safe customer handoff recovery, revision reconciliation, and correct code confirmation all passed.
8. Delivery reached `delivered`; customer, business, and Rider views converged.
9. Terminal GPS was rejected and active delivery disappeared.

Delivery code in all handling and evidence: `[REDACTED_DELIVERY_CODE]`.

Result: PASS.
