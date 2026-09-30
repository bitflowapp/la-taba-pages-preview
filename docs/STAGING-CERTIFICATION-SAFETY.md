# Staging certification safety

`certify:orders:staging` and `certify:circuit:staging` mutate staging. Neither
command is a read-only check or a replacement for physical-phone and Panel QA.

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

## Verification on 2026-09-30

Read-only live checks confirmed the current project is `ACTIVE_HEALTHY`, the QA
business identity matches, payment settings are in test mode, and 11 of its 12
products are active, available, positive-stock and positive-price. No backend
writes or financial transactions were performed for this change.

Targeted regression command:

```sh
node --import ./tests/test-bootstrap.mjs --test --test-concurrency=1 tests/staging-certification-target.test.mjs tests/certify-real-order-pipeline-script.test.mjs tests/business-order-recovery.test.mjs tests/mercadopago-payment-recovery.test.mjs
```

Result: 27 passed, 0 failed. Entrypoint tests use an SDK double without mutation
methods and exercise both static rejection and asynchronous identity rejection.

## Remaining prerequisites

The pipeline certifier still expects `demo_fixture` products and historical
`LT-0030`, `LT-0033`, `LT-0034`, `LT-0035` evidence. Current staging products are
all `commercial`; this guard change does not manufacture fixtures or certify
that legacy pipeline. Do not run it merely because its target preflight passes.
Coordinate exclusive QA use before running either mutating command. The circuit
certifier operates an existing QA order and changes that order customer's Auth
credentials; verify the intended test customer before using it.

Physical-phone client, real backend, notebook Panel, same-order lifecycle,
adversarial retries/concurrency, and MP sandbox seller/webhook/refund correlation
remain separate certification requirements. This source fix establishes no
production-readiness claim and performs no deployment.
