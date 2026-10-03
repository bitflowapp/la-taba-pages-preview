# Delivery code and rate limit — live staging

- Generated through the existing secure handoff contract; never read from restricted tables.
- Incorrect code: explicit `incorrect_code` result.
- Same idempotency key repeated: one persisted attempt only.
- Escalation: server returned `temporarily_locked` with a positive `retry_after_seconds`.
- Unlock: authorized customer tracking-handoff recovery generated a replacement test code in memory and reset the lock through its RPC.
- The Rider reloaded the active delivery revision after recovery before confirmation.
- Correct code: server-side `confirmed`; no optimistic terminal state.

No delivery code, hash, token, or address is included in this evidence.
