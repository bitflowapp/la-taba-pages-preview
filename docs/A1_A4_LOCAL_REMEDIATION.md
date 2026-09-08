# A1/A4 local remediation

Baseline: `a56a9c54c155d6b0c1eb088c3dbe93edbfd10b7f`.
Scope: A1-RACE and A4-CORRELATION only. No hosted deployments, secret changes,
seller consent, financial requests, production data changes, push or merge.

## Authority decision

All three URL-return paths use the same gate. An owned token refresh, if needed,
finishes first. A private SQL RPC then reads business, settings, seller and the
customer's checkout/intent in a single MVCC snapshot. The token sent to
`/users/me` is decrypted from that snapshot. After the response, a second call
to the same RPC supplies the final decision. It validates current operations,
payment enablement/review, environment/application/collector binding, checkout
ownership/status/expiry, reservation and seller usability. Runtime production
authorization is also checked again.

The SHA-256 authority version includes the underlying rows and encrypted token
material; the final gate also compares the exact ciphertext and generation.
Token-only rotation is therefore detected. No plaintext credential is persisted
or logged. No database transaction spans provider I/O. The final database read
is the authorization decision point; the gate performs no further network call
before releasing the URL. This does not revoke URLs already issued to clients.

Authority changes return an explicit recoverable error. A new preference that
was created successfully is not reclassified as an uncertain provider POST when
the final authority gate rejects its release.

## Refund identity

Chosen lost-response policy: **C — preserve ambiguity without a durable ID**.
Lists, amounts, ordering and timestamps never establish an unknown identity.
The worker does not issue another financial POST to recover a lost response.
Cases without an ID may require manual investigation; automatic resolution is
intentionally unavailable when evidence is insufficient.

When the authenticated creation response supplies an ID, a server-only RPC binds
it to the local refund, payment and persisted idempotency key before financial
recording. Partial responses retain that identity and remain reconcilable.
Known IDs are retrieved through `GET /v1/payments/{payment_id}/refunds/{refund_id}`.
The full resource must match both IDs and the exact amount, contain a timestamp
and a supported terminal status. A 30-second clock-skew allowance bounds creation
time between local request time minus 30 seconds and verification time plus 30
seconds. Those bounds validate an already-bound identity; they never infer one.

Database approval requires the previously bound ID. The unique provider-ID
constraint remains. Writers lock intent before refund, terminal results cannot
regress, and repeated terminal recordings emit no additional financial event,
including when a response hash changes. Late ambiguity notifications preserve
settled outcomes and avoid duplicate outstanding reconciliation jobs.

Contracts consulted: [create refund](https://www.mercadopago.com.ar/developers/en/reference/online-payments/checkout-pro-preferences/create-refund/post)
and the [specific refund lookup](https://www.mercadopago.com.ar/developers/en/reference/online-payments/checkout-api-payments/get-refund/get).
No assumption was made that a list response proves an outbound idempotency key.

## Reproductions and validation

Before the fix, the focused handler tests reproduced nine unsafe URL releases
(disable/close/token rotation across stored/recovered/new), with three unchanged
controls succeeding. Missing, pre-request and future timestamps reproduced the
three false refund matches.

`scripts/verify-a1-a4-reproductions.mjs` reads baseline code from Git without
checking it out, and compares it with current code against real PostgreSQL.
It requires `TABA_LOCAL_PAYMENT_DB=1`, a container named `taba-a1-a4-local-*`,
network mode `none`, no host bind mounts and the complete migration set.
It intentionally creates local fixtures and temporarily exercises the old SQL
recorder inside that disposable container. Never point it at a shared database.

```text
OLD_REPRODUCTION: FAILS_AS_EXPECTED_BEFORE_FIX
NEW_REPRODUCTION: BLOCKED_AFTER_FIX
A4_CONCURRENT_RECORDINGS: 8 requests, 1 financial event
```

The real-handler Deno tests cover authority changes, known/unknown refund IDs,
specific lookup, partial creation responses and lost responses. Runtime network
access is denied. PostgreSQL tests cover authority snapshots, ownership/grants,
credential-only rotation, identity binding, unique IDs and terminal replay.
The full local migration chain and existing checkout lifecycle were exercised;
the OAuth and least-privilege pgTAP suites also passed.

Final validation: `npm run test:payments` 75/75; `npm run test:webhook`
122 Deno cases plus 12 Node cases; `npm test` 2418/2418; 123 local migrations;
102 pgTAP assertions in the OAuth, seller-binding and privilege suites. Deno
type checks, `npm run check`, migration validation and secret scan passed.

An exhausted temporary-files drive required using a task-specific directory on
C: outside the repository. PostgreSQL data ran in RAM with networking disabled.
No unrelated Docker resource or hosted project was changed to work around this.

## Review and deployment boundary

Migration: `20260908164550_current_payment_authority_and_refund_identity.sql`.
It is local and unapplied to staging/production. A later authorized deployment
must apply it before the new Edge code, because the code deliberately fails
closed if the new private RPCs are absent. Independent review is required before
deploying, and seller connection/payment activation remain separate decisions.
