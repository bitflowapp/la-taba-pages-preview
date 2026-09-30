# Staging certification safety

`certify:orders:staging` and `certify:circuit:staging` mutate staging by default.
Add `--preflight-only` to either command to verify only target identity and test
payment mode, with no actor, order, session, stock or customer-credential writes.
This preflight is not a replacement for physical-phone and Panel QA.

Both commands now use `scripts/lib/staging-certification-target.mjs` before
creating actors, changing orders, rotating customer credentials or reserving stock.
The guard accepts only:

- Project `ucbtjcurawxjwjdvvcvj`, exact URL
  `https://ucbtjcurawxjwjdvvcvj.supabase.co`.
- QA business `a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0`.
- `TABA_CERTIFY_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING`.
- A live, active business with slug `la-taba-staging`, and that same business's
  payment settings explicitly in `test` mode.

Production, controlled production, retired staging projects, other businesses,
missing identity rows, failed reads and production payment mode fail closed.
The preflight reads are bounded to 15 seconds each and do not print backend error
details. Order-code lookups are scoped to the designated QA business.
Preflight refusals exit 2 and report only a coarse reason, such as missing rows,
multiple rows, upstream HTTP failure or timeout. A passing read-only preflight
exits 0 with `scope: staging_identity_only`; it does not certify order fixtures.

The circuit certifier additionally refuses terminal orders, missing customers,
registered or identified customers, and customers with any business membership.
These checks run before actors are created and again before changing the
anonymous test customer's credentials. Earlier failed checks stop that change.

## Verification on 2026-09-30

Read-only live checks confirmed the current project is `ACTIVE_HEALTHY`, the QA
business identity matches, payment settings are in test mode, and 11 of its 12
products are active, available, positive-stock and positive-price. No backend
writes or financial transactions were performed for this change.

Targeted regression command:

```sh
node --import ./tests/test-bootstrap.mjs --test --test-concurrency=1 tests/staging-certification-target.test.mjs tests/certify-real-order-pipeline-script.test.mjs tests/business-order-recovery.test.mjs tests/mercadopago-payment-recovery.test.mjs
```

Result after independent Opus review corrections: 33 passed, 0 failed. Entrypoint tests use an SDK double without mutation
methods and exercise both static rejection and asynchronous identity rejection.

Both read-only entrypoints also passed against live staging with the pinned
Supabase JS SDK 2.110.8, existing credentials verified against the Management API,
and a GET-only transport that rejects every mutation. The pipeline's first
attempt exited with native Windows code `3221226505`; one isolated retry passed.
The failed attempt remains in the local evidence and its native crash cause is
unresolved. No mutating certification was run.

Independent review used Claude Opus 5.5, `effort=max`, one turn, 644676 ms, with
tools, hooks and MCP disabled. No introduced P0/P1 was identified in the initial
guard. Corrections added tenant-filter coverage, read-only preflight and coarse
refusal diagnostics; they also addressed the pre-existing registered-customer
credential takeover, writes before missing-product checks, and false green QA
isolation gate. The final corrections were regression-tested; they were not
subjected to a second independent audit.

## Remaining prerequisites

The pipeline certifier still expects `demo_fixture` products and historical
`LT-0030`, `LT-0033`, `LT-0034`, `LT-0035` evidence. Current staging products are
all `commercial`; this guard change does not manufacture fixtures or certify
that legacy pipeline. Do not run it merely because its target preflight passes.
Missing product prerequisites are checked before actor creation. A missing QA
isolation fixture now records a failure rather than an unexercised green gate.
Coordinate exclusive QA use before running either mutating command. The circuit
certifier operates an existing QA order and changes only an anonymous test
customer's Auth credentials; verify the intended test customer before using it.
The legacy pipeline still calls a project-wide expiry sweep and checks global
reservation/payment alerts. Those calls and incomplete cleanup error handling
remain blockers to independent, concurrent or unattended certification.

Physical-phone client, real backend, notebook Panel, same-order lifecycle,
adversarial retries/concurrency, and MP sandbox seller/webhook/refund correlation
remain separate certification requirements. This source fix establishes no
production-readiness claim and performs no deployment.
