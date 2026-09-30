# Staging certification safety

These helpers are engineering diagnostics. A successful CLI run does not certify
physical-phone UX, the notebook Panel, provider payments or production readiness.
No backend mutations or deployments were performed while implementing this change.

## Target and read-only modes

Both helpers require the exact `ucbtjcurawxjwjdvvcvj` staging URL, QA business
`a57b1c20-0f4e-4a6b-9d31-7c2e5f8a41d0`, and
`TABA_CERTIFY_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING`. Before any mutation they
verify the live active business slug `la-taba-staging` and its test payment mode.
Production, CP, retired staging, another business and uncertain reads fail closed.

Use `--preflight-only` with either helper to read only identity and payment mode.
It returns `scope: staging_identity_only`; it does not validate order fixtures.
The pipeline also accepts `--fixtures-preflight-only`, returning
`scope: staging_identity_and_fixtures` after checking explicit product IDs.
Refusals before actors exist exit 2 with coarse diagnostics; failed operational
checks or cleanup exit 1. Natural exit allows pending output to finish.

## Explicit QA resources

The pipeline requires both `TABA_CERTIFY_OPERATIONAL_PRODUCT_ID` and
`TABA_CERTIFY_ISOLATION_PRODUCT_ID`, distinct UUIDs selected for this coordinated
QA run. Each must belong to the designated QA business and be active, available,
verified, merchant available, have a confirmed positive price and stock >= 2.
Both must explicitly have `is_alcoholic: false`; missing, null or malformed alcohol
metadata is refused. The helper submits `age_confirmed: false` and never invents
age verification or consent. Order core in
`20260812220000_business_operations_checkout_enforcement.sql` and the current
checkout implementation in `20260813020000_checkout_pro_carries_customer_notes.sql`
require age confirmation for alcoholic items, so either fixture must be refused
during preflight before Gate 1 creates actors or orders.
The operational product may be `commercial` or `demo_fixture`; the isolation
product must be `test_only` or `staging_only`, matching backend classification.
All prerequisites are checked before actors are created. The helper never
creates or edits catalog publication, prices or fixture definitions.

Historical `LT-0030/33/34/35` orders are no longer prerequisites. A declared sample
of up to 100 existing orders in the QA tenant is compared before and after the
run. An empty sample is printed as NOT_EXERCISED, rather than fabricated evidence.
This does not certify preservation of every existing order, GPS row or audit event.

The circuit requires a fresh, unassigned `received` QA order and
`TABA_CERTIFY_CUSTOMER_ACCESS_TOKEN` from that order's current anonymous customer
session. The token must be passed through a private environment, never arguments
or logs. Auth verifies its user before actor creation and again before tracking
recovery. Registered/identified users, memberships, another customer, expired
access and already-operated orders are refused. No customer email or password
is changed. The existing anonymous session remains owned by the phone client.

Coordinate exclusive QA use with the resource owner before any mutating run.
Project credentials are available through the established Windows Credential
Manager/Management API binding; they are not the current access blocker.

## Scoped expiry and checked cleanup

The pipeline uses the existing `release_checkout_session_inventory` RPC for only
its freshly-created checkout after verifying business, customer and exact random
client request ID. It refuses approved, completed, finalizing or review states;
the backend rechecks protected states under a row lock. Retries release zero
additional reservations, and cleanup preserves an expired session as expired.
There are no project-wide sweep or global payment/reservation-alert calls.
The output explicitly marks global cron and MP provider certification NOT_EXERCISED.

Cleanup is registered immediately after actor creation, before membership writes.
It runs once in reverse order, checking SDK errors and results. A session-close
or membership-revocation failure does not prevent the independent actor ban.
The ban response must confirm the correct user and a future ban timestamp.
Both helpers register authoritative staff/rider sessions and close them on cleanup.
Orders are retained as QA audit evidence; pipeline orders retain checked stock
restoration. Circuit cleanup cancels an unfinished owned order when permitted,
then classifies it QA even when cancellation fails. Scoped post-reads verify both
the cancelled status and QA origin; successful RPC responses alone are insufficient.
A refused cancellation is a failed run requiring manual QA reconciliation, never
a green result. The circuit preserves delivered orders and does not restore their
consumed stock; any required restoration belongs in that coordinated QA reconciliation.

All client fetches have a 15-second request deadline. SIGINT/SIGTERM abort normal
requests while independent bounded cleanup clients remain usable. A failed
invariant stops subsequent operational work. A native crash, hard kill or lost
server acknowledgement can still leave resources needing reconciliation; these
helpers are not durable orchestration. Do not run them unattended as a substitute
for a coordinated test window and checking cleanup evidence.

## Evidence on 2026-09-30

Read-only live inspection confirmed healthy staging and 12 QA-business products.
The updated aggregate includes alcohol metadata: 11 operational products meet all
fixture predicates with explicit nonalcoholic status; zero eligible isolation-origin
products exist. No alcoholic or unknown-alcohol rows were found. Service-role
INSERT privilege on products is present, so fixture creation is not blocked by
that permission. No fixture was created or published: safe actor ownership and
crash reconciliation remain unmet prerequisites. Live SQL confirmed service_role
can execute the per-session release
API, authenticated cannot, and create_checkout_session does not call a global sweep.
No database migration or deployment is needed for that scoped API change.

Updated live identity preflights completed at 07:34 UTC using SDK 2.110.8 with
Management-API-bound credentials and a transport that rejects every non-GET
request. Both entrypoints exited 0; the pipeline's fixture mode without explicit
IDs exited 2 with EXPLICIT_FIXTURES_REQUIRED before actors existed. These reads
do not exercise cleanup, inventory writes or a customer order.

The corrected read-only Management API configuration probe verified
`TABA_DEPLOYMENT_ENV=staging`, both MP environment declarations as `test`, and
the OAuth project ref as the current staging ref. It used the API's `value` field
or digest comparison only for enumerated safe configuration. No credential values
or hashes were recorded. Provider seller validity, OAuth/PKCE, webhooks and refunds
remain unexercised despite the verified test declarations.

Exact commit `768b8d4397c7dabfd4ae5b9a2215cb6a58dbe951` passed all three GitHub Actions
jobs in [Validate release candidate](https://github.com/bitflowapp/la-taba-pages-preview/actions/runs/36689509069),
including the full browser E2E step. This CI is separate from live staging and
physical-phone/Panel certification. Any subsequent amendment needs its own CI.

Targeted regression command:

```sh
node --import ./tests/test-bootstrap.mjs --test --test-concurrency=1 tests/staging-certification-resources.test.mjs tests/staging-certification-target.test.mjs tests/certify-real-order-pipeline-script.test.mjs tests/business-order-recovery.test.mjs tests/mercadopago-payment-recovery.test.mjs
```

Continuation checkpoint: 52 passed, 0 failed. Includes real entrypoint execution
with mutation-free SDK doubles, explicit fixture refusal, wrong/expired customer
access, cross-business/customer/request checkout refusal, protected payment states,
alcoholic or unknown-metadata fixtures in either selection, partial actor failures,
cleanup failures, circuit cancellation/classification
postconditions, interruption and idempotent release.
Refused entrypoint cases explicitly record zero insert/update/upsert/delete/RPC
or actor/auth write attempts. A valid-fixture positive control reaches exactly the
first fake actor write, showing that refusal tests do not stop at an unrelated
missing customer-token gate. All SDK operations in this regression are local doubles.
No full local build, browser or physical-device run was performed.

The earlier independent max-effort Opus review covered the initial target guard,
not this continuation. Two continuation attempts used `--effort max`, one turn,
disabled tools/hooks/MCP, and a 420-second deadline. Both timed out without
findings (elapsed 442 and 441 seconds). Only each attempt's own child was stopped.
Those timeouts provide no independent sign-off for the broader cleanup changes.
No absence-of-findings approval is inferred; the PR remains in draft.

A subsequent independent read-only review of `58b3c4f` identified that fixture
preflight could accept alcohol while the pipeline always submits no age consent.
Two regression cases reproduced the missing rejection before the correction.
Preflight now selects alcohol metadata and requires strict boolean false for both
products. Local tests exercise both selections with true, null, missing and malformed
metadata, and both pipeline modes refuse before actors.
Other independent review findings remain pending; no backend write was needed.

A later bounded Opus review of the exact `768b8d4` alcohol amendment completed
successfully with `--effort max`, tools/hooks/MCP disabled and a 720-second cap
(356 seconds elapsed). It approved the guard and identified a nonblocking gap in
the proof of zero writes. The write-attempt ledger and positive control above
address that gap; the 52 targeted tests passed again. Its inferred pipeline
customer-token prerequisite belonged to the adjacent circuit cases and was not
a pipeline defect. This review does not cover the whole repository, the later
test-only strengthening, or live execution.

## Native preflight failure remains unproven

The initial GET-only live pipeline preflight exited `3221226505` (0xC0000409).
Its stderr was not retained by the original harness. A subsequent isolated retry
passed; that is not proof of resolution. No matching Windows Node crash event or
dump was found. A bounded Node v24.18.0 loopback GET probe completed 6 forced-exit
and 6 natural-exit runs without reproducing the failure.

[Node's process documentation](https://nodejs.org/docs/latest-v24.x/api/process.html#processexitcode)
recommends natural exit to avoid truncating pending I/O. A
[Node Windows issue](https://github.com/nodejs/node/issues/56645) documents the same
native code after fetch plus forced exit on Node 23; it is a plausible analogue,
not proof about this Node 24 failure. Both helpers now avoid forced process.exit.
The original failed evidence is preserved and the root cause remains unresolved.

## Real access and certification blockers

The parent granted a staging backend slot; physical Moto G15 and UI remain with
APEX. No viewport substitutes for physical evidence. That backend slot was not
used for writes because the following run prerequisites could not be established:

- No existing member in the certifier's synthetic namespace or current task tag
  was found. This is not a claim that the QA business has no other test accounts.
  Historical shared QA credentials do not prove exclusive ownership by this task.
  The current actor helper creates password-backed accounts; the run's instruction
  prohibits creating persistent access credentials.
- Cleanup uses in-memory callbacks. Hard crashes and lost server acknowledgements
  can leave actors, orders, reservations or stock changes without a durable record
  available for exclusively scoped reconciliation.
- The repository's QA-origin order classification suppresses pending new-order notifications in
  the order-items transaction, but Gate 1 uses an operational commercial/demo
  product. Its order is only classified QA during cleanup. No guarantee that all
  real notification or preparation consumers are disabled was established. The QA
  business already has 16 pending new-order events; these unrelated events were
  left untouched. Staging also lacks the print-settings, print-jobs and local-devices
  tables used by the current print-agent path.

An isolated fixture could use generic nonalcoholic test data, but creating it
alone does not resolve actor ownership, notification isolation or crash recovery.
No order or fixture was written under this slot. The circuit still needs the
intended phone customer's current session and fresh order. MP sandbox OAuth/PKCE,
seller authority, correlation, webhooks, refunds and live concurrency remain unexercised.
No production readiness, financial transaction or customer notification is claimed.
