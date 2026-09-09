# Astra production-candidate validation

Base: `4540ade47afa8f12744d3674d01ed765b628e228`.
Production execution and Walter authorization are outside this mission.
The operational authority is [the V5 runbook](A1_A4_PRODUCTION_RUNBOOK_V5.md).

## Adversarial architecture review

The implementation was reviewed again as untrusted code after its initial
positive lifecycle test. The following attacks determined the final design.

| Attack | Final defense and executable evidence |
|---|---|
| Invalid deploy syntax / invented platform behavior | `verify-release-v5-platform.mjs` runs CLI 2.101.0 itself against a strict loopback API. Invalid jobs-without-API fails; valid command produces three bundle-only POSTs and one bulk PUT. |
| Wrong DB/project or misleading environment name | Strict verified TLS connection plus a random application-name/backend-PID challenge read independently through the project's Management API. Actual production read-only endpoint and parameter binding were checked. |
| Session lock expires during deployment | One live `pg.Client`; real second runners fail while staging and source verification are blocked. A killed process releases its lock while durable quiescence survives. Unlock is conditional on the acquiring PID and application name. |
| Activation after preflight / stale snapshot | Writers share the same durable singleton row lock; quiesce upgrades it. A real overlapping activation is observed and rejected. Repeatable-read snapshots serialize instead of observing stale unpaused state. |
| Missing status vocabulary | Every financial-history row blocks. The isolated SQL tests enumerate all 44 actual constrained intent/attempt/refund/cancellation/outbox states; each is rejected. Unknown constraints/columns and query failures fail closed. |
| Scheduler or dispatcher race | Four exact scheduler definitions/targets, paused cron, permanently guarded original dispatcher OID and public wrapper. All 14 financial write surfaces are guarded even in replica mode. |
| pg_net queue/dequeue race | Queue INSERT/UPDATE takes the same interlock; DELETE can drain. A durable empty-queue observation plus audited dispatches and recent responses anchors the 430-second wait. |
| Source hash omits a dependency | Compiler-observed runtime inputs, npm bundles, emitted code and the runtime wrapper determine identity. Shared/runtime changes change identity; test-only changes do not. |
| Wrong hash domain | Local executable SHA, remote compressed-ESZip SHA and immutable hosted version are distinct. Downloaded original source is compared only with uploaded original source. |
| Unchanged V9 / stale metadata / partial release | Exact pre-release baseline; reserved version responses; full inventory, individual endpoints, original source and nonce-bearing runtime `DENO_DEPLOYMENT_ID`. 0/3, 1/3 and 2/3 cannot pass. |
| Lost activation response / replay | Staged immutable versions are durable before PUT. Recovery reuses those same versions; no successor or rollback is admitted while activation may be in flight. |
| Forged local evidence / circular DB validation | No JSON evidence input. Private production lifecycle is authoritative. Expected OLD, each EXPAND stage and CONTRACT definitions come from a separately generated pristine oracle; its bytes are bound to the clean commit. |
| Missing/NULL/expired proof or premature CONTRACT | Phase-dependent database constraints, fresh same-session verification, exact source/project/function/runtime bindings, post-release drain, expiring attestation and atomic consumed execution ledger. Archived V3 entrances cannot bypass the V5 gate. |
| Accidental CI deployment / cancellation | Both production workflows are dispatch-only with explicit target confirmation, exact canonical CI/SHA checks and `cancel-in-progress: false`. Forks and workflow retries cannot enter. Pages never executes Edge/CONTRACT. |
| Secret leakage / mutating dry-run | No request/error bodies or credentials in evidence. Dry-run builds in memory without API/DB calls or output files. Real tests use synthetic credentials and isolated temporary paths. |
| Rollback after retirement | Before activation, abort is executable and leaves compatible EXPAND. After activation, recover the same version set. CONTRACT is one shot; after it, legacy rollback is rejected. |
| Tautological tests | Actual pinned CLI, actual ESZip bundle/unbundle, actual Deno execution, actual PostgreSQL wire sessions, schema-derived states, killed child process, independent historical handlers and committed schema expectations supplement unit fixtures. |

## Eleven additional findings closed

These were found while redesigning/reviewing the release, beyond the original
V4 checklist. Test-fixture/environment setup errors are not counted as findings.

1. Renaming the dispatcher could leave a cached original OID bypass: the
   original body itself now takes the interlock before it is renamed.
2. Disabling a trigger while holding the writer-control row inverted the lock
   order: the kick trigger stays enabled behind permanent guards.
3. Recording the live schema as its own expected identity could bless drift:
   an independent, committed OLD/partial-EXPAND/CONTRACT oracle is required.
4. Local source, SQL or compatibility JSON could change after preflight:
   compiler inputs and execution buffers are bound to reviewed Git/file hashes.
5. Managed `postgres` lacks UPDATE/DELETE on `cron.job`; a SHARE lock could fail:
   the retirement body uses ACCESS SHARE plus the durable financial interlock.
6. Nullable fields could weaken verified-phase proof checks: database CHECKs
   enforce complete baseline/staged/runtime/expiry/attestation state by phase.
7. An implicit gateway default would change preference authentication policy:
   its existing production `verify_jwt=false` is explicit, with Auth `getUser`
   still enforcing the original handler's authorization.
8. The Pages route retained an automatic production trigger and unsafe manual
   SHA handling: it now requires dispatch/confirmation and the shared exact-CI
   verifier, with input passed through environment variables and actions-read
   permission explicitly granted.
9. A shallow CI checkout could not run the actual historical handlers:
   the database job fetches full history.
10. The old SQL harness restarted a shared cluster and imported another
    project's Auth schema: it now owns a network-isolated, temporary cluster
    and repository-owned platform fixtures.
11. Locale-dependent ordering could hash identical index definitions differently
    across databases. The canonical schema oracle explicitly uses C collation
    for index, constraint, policy and role ordering.

## Validation commands and scope

- `npm run test:payments`: 172 Node tests.
- `npm run test:webhook`: 166 Deno tests and 12 Node tests.
- `npm test`: 2,515 Node tests.
- `npm run migrations:validate`: 126 automatic migrations; CONTRACT remains separate.
- `npm run check`: syntax, Supabase configuration, assets, precache, release
  identity/hygiene, location contract and secret scan.
- `npm run test:release:platform`: actual CLI 2.101.0 command/wire contract,
  Edge Runtime 1.74.3 offline ESZip round trips, and Deno 2.6.1 runtime probes
  with provider networking denied, for all three functions.
- `TABA_LOCAL_PAYMENT_DB=1 npm run test:db:isolated`: pristine 122-migration OLD,
  all four EXPAND migrations, managed non-superuser permissions, 250 canonical
  plus 44 least-privilege pgTAP assertions, historical OLD/new rolling matrix,
  real legacy refund recorder-failure/retry, eight-way refund replay, lock
  ordering, V5 adversarial lifecycle, CONTRACT and dump/restore.
- Deno 2.6.1 typechecks: preference, worker, refund, webhook, cancellation,
  connect and OAuth callback.
- `npm run fiscal:test`: 22 tests with injected provider/storage transports.
- Actionlint 1.7.12: production/CI workflow syntax and expressions; downloaded
  release archive verified against its published checksum.

The database fixture mirrors the production extension ownership: pg_cron 1.6.4
belongs to `supabase_admin`, its C routines use that extension owner, and the
release identity `postgres` is not a superuser. Actual Vault 0.3.1 encryption is
initialized with an ephemeral container-only root key. No mocked Vault replaces
the configuration check.

## Read-only production evidence

`scripts/inspect-release-v5-readonly.mjs` uses READ ONLY transactions and metadata
GETs. It found no difference in all 293 OLD public/private functions and 90
application tables, including indexes and RLS policies, against the pristine
oracle with canonical ordering. Production remained at 122 migrations, last
`20260908070341`; V3 and V5 controls were absent. All financial-history counts,
enabled settings, usable seller tokens, refresh leases, usable OAuth states and
pending/recent pg_net counts were zero. One expired OAuth state remains harmless.
Preference/worker/refund remained the original V9 versions and bundle identities.
The worker URL/HMAC and production environment bindings were checked read-only.

No production Edge deployment, PostgreSQL mutation, scheduler/dispatcher change,
seller connection, OAuth grant, financial/provider operation, Git push or merge
was performed. Local schema fixtures and provider mocks are not production data.

## Environment and test cleanliness

The host's default temporary volume (E:) had no free space. A new identity test
initially failed with Windows disk-full error 112; unchanged tests were rerun
with `TEMP`/`TMP` pointing to a dedicated TABA temporary directory on C:.
No unrelated data was removed.
Fiscal test dependencies were initially absent and were installed from their
existing lockfile before the successful fiscal run.

Tests never emit `artifacts/codex/A1_A4_EDGE_RELEASE_EVIDENCE.json`. The V5 runner
uses fresh temporary directories/containers, no host database ports or binds,
and removes only resources it created. The committed compatibility JSON is a
reviewed schema specification, not runtime release evidence. Credentials and
runtime evidence are not committed.
