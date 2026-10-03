# GPS receipts — live staging RPC

Synthetic staging coordinates were submitted only to exercise the real RPC; they are not physical-route evidence and are not recorded here.

- `accepted`: PASS.
- `inaccurate`: PASS.
- `throttled` with `retry_after_seconds`: PASS.
- `impossible_jump`: PASS.
- stale arrival revision: PASS (rejected and reconciled).
- post-delivery `terminal`: PASS (GPS blocked).
- terminal cleanup: zero active exact GPS rows for all certification orders.

The incremental receipt migration persists the authoritative `order_revision` and validated capture timestamp, fixing the reproducible staging NOT NULL failure.
