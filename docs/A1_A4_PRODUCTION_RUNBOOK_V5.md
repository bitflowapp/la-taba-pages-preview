# TABA A1/A4 production release — V5

This is the authoritative runbook. V3/V4 operational commands are retired.
The Astra engineering mission does **not** execute this runbook in production.
Execution requires a successful independent audit of the exact candidate commit
and an explicit operator decision. Walter remains disconnected throughout.

## Scope and trust

Project: `wwcpogltfgzgkrlilbcd`. The release changes exactly:

- `mercadopago-create-preference`
- `mercadopago-payment-worker`
- `mercadopago-refund`

This is the one-time A1/A4 release before financial onboarding. It intentionally
rejects **every row**, including terminal and unknown states, in checkout
sessions/items, inventory reservations, intents, attempts, webhook receipts,
payment events, refunds, cancellations, disputes and payment outbox. Both
environments are checked. Do not delete history to satisfy this gate. A project
with financial history needs a separately reviewed release policy.

Settings must be disabled. Sellers must be disconnected, without protected
tokens or refresh leases. Unexpired OAuth states block release; expired states
cannot be consumed and need not be deleted. The four known scheduler jobs must
target local `postgres` as `postgres`; unknown jobs/commands fail closed. Worker
URL, HMAC alignment, production environment bindings and required Edge secrets
are checked read-only. A global provider token or real-payment smoke
authorization blocks the release.

The trust root is the private production database lifecycle, entered by the
reviewed controller with privileged database and Management API credentials.
Application, browser and `service_role` identities cannot create release proof,
attestations or CONTRACT executions. Database/platform administrators and the
reviewed runner are trusted administrators; this mechanism does not claim to
defend a database against its own malicious administrator. Editing local JSON
does not create proof. There is no release-evidence input flag.

The source identity covers the actual compiler inputs, bundled npm dependencies,
executable bytes, gateway policy and runtime verification wrapper. Runtime
inputs are checked against the clean commit. Test-only modules do not enter the
graph. Each upload contains a unique database-issued release marker. Supabase's
`ezbr_sha256` is a separate compressed-ESZip identity, never equated to raw source.
Reserved version responses, the original remote inventory, downloaded source,
fresh nonce-bearing runtime responses and hosted `DENO_DEPLOYMENT_ID` must agree
for all three functions. Other functions must remain unchanged.

Expected database definitions come from the reviewed pristine migration
installation. The live schema is also fingerprinted to detect changes throughout
the release. Merely inserting a migration version is insufficient.
`scripts/release-v5/compatibility.json` binds OLD, each partial EXPAND stage, full
EXPAND and CONTRACT. Its bytes are bound to the clean commit; it is an intended
schema specification, not proof of a successful release. Normal validation never
regenerates it. Development regeneration is explicit and isolated:

```powershell
$env:TABA_LOCAL_PAYMENT_DB = '1'
$auditDirectory = Join-Path (Split-Path (git rev-parse --show-toplevel) -Parent) 'taba-release-audit'
New-Item -ItemType Directory -Path $auditDirectory -Force | Out-Null
node scripts/run-release-v5-db.mjs --generate-compat (Join-Path $auditDirectory 'new-compatibility.json')
```

Review any resulting definition changes with the migration diff before adopting
that file into a new candidate. The generator cannot connect to production.

## Operator setup and pre-flight

Use Node 22 or newer, Git, installed locked npm dependencies, and the clean
independently audited commit. Direct database connections or Supavisor **session**
connections on port 5432 are supported. Transaction pooling/6543 is rejected.
TLS certificate verification is mandatory. The controller independently finds
its live backend PID, unpredictable application name and advisory lock through
the production Management API; naming a variable `PRODUCTION_DATABASE_URL`
does not establish binding.

Provide `SUPABASE_ACCESS_TOKEN` and `TABA_A1_A4_DATABASE_URL` through a secure
environment/secret store. The token needs project/database read, function
read/write, secret-inventory read and API-key read permissions. The database
identity is the project's `postgres` administrator. If its certificate chain
is not trusted by the host, set `TABA_DATABASE_CA_FILE` to the project's trusted
public CA certificate. In Actions, use `TABA_DATABASE_CA_PEM` for that certificate.
The certificate is public; passwords/tokens are never written to artifacts.

From a PowerShell terminal in the audited checkout, secure prompts keep values out of
command history and terminal output:

```powershell
Set-Location (git rev-parse --show-toplevel)
$auditDirectory = Join-Path (Split-Path (Get-Location).Path -Parent) 'taba-release-audit'
New-Item -ItemType Directory -Path $auditDirectory -Force | Out-Null
$tokenInput = Read-Host 'Supabase Management token' -AsSecureString
$dbInput = Read-Host 'Production PostgreSQL connection URI' -AsSecureString
$env:SUPABASE_ACCESS_TOKEN = [System.Net.NetworkCredential]::new('', $tokenInput).Password
$env:TABA_A1_A4_DATABASE_URL = [System.Net.NetworkCredential]::new('', $dbInput).Password
$releaseArgs = @('scripts/release-edge-production.mjs', '--project-ref', 'wwcpogltfgzgkrlilbcd', '--confirm-project', 'wwcpogltfgzgkrlilbcd')
git rev-parse HEAD
git status --porcelain=v1
npm ci --no-audit --no-fund
npm run release:edge:dry-run
node @releaseArgs --mode preflight
```

The database URI must use `/postgres`, no query-string overrides, and either
`db.wwcpogltfgzgkrlilbcd.supabase.co` with user `postgres`, or the project's
`aws-…pooler.supabase.com` session endpoint with user
`postgres.wwcpogltfgzgkrlilbcd`. Percent-encode password URI characters.

Expected: empty Git status, the audited SHA, dry-run `mutations: 0` and
`production_checks: NOT_EXECUTED`, then a successful read-only preflight.
Production starts at the reviewed 122 migrations through `20260908070341`;
only an exact prefix of the four following migrations is acceptable on retry.
Missing configuration, wrong project/DB, schema/history drift, unusable gateway
key or financial activity is an abort. Pre-flight makes no production changes.

## EXPAND and verify EXPAND

```powershell
node @releaseArgs --mode expand
node @releaseArgs --mode verify-expand
```

The controller applies these files in order, with each file and its exact
migration-ledger entry in one transaction:

1. `20260908164550_current_payment_authority_and_refund_identity.sql`
2. `20260908190758_a1_attempt_authority_expand_v2.sql`
3. `20260909011239_a1_a4_durable_contract_control_v3.sql`
4. `20260909050330_a1_a4_release_interlock_v5.sql`

Expected: `expand_verified: true`, all four exact versions, matching definitions
and CONTRACT SHA. EXPAND mutates PostgreSQL but initiates no provider I/O. It is
compatible with old Edge. If a file fails, its transaction rolls back; earlier
files remain installed. Correct the operational cause and rerun the same command
from the same commit. Retain EXPAND on abort; do not run reverse migrations or
`db push --linked` as a substitute for this controller.

## Establish quiescence

```powershell
$quiesce = node @releaseArgs --mode quiesce | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Quiescence failed' }
$releaseId = $quiesce.result.release_id
$quiesce.result
```

Expected: a database-generated `release_id`, phase `quiesced`, and a drain
snapshot. Save the UUID, not a fabricated evidence file. If terminal output is
lost, recover the UUID with `node @releaseArgs --mode status`.

Quiesce waits for existing financial writers, atomically commits the durable
pause and pauses all four schedulers. Financial writers take a shared lock on
the same singleton row; stale repeatable-read snapshots cannot bypass it.
All guarded financial writes and pg_net INSERT/UPDATE are rejected while paused.
Both the original dispatcher OID and its public wrapper observe this interlock.
The outbox kick trigger remains installed and enabled; no table-lock inversion
is introduced by disabling it. pg_net DELETE remains available for draining.

This stage mutates only release controls/scheduler state. It makes no provider
request. Already started work can still finish until the drain completes.
A crash leaves the durable pause in place. Never clear the pause with raw SQL.

## Drain and verify inertness

```powershell
do {
  $drain = node @releaseArgs --mode drain --release-id $releaseId | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Drain inspection failed' }
  $drain.result
  if (-not $drain.result.ready) { Start-Sleep -Seconds 15 }
} while (-not $drain.result.ready)
```

The drain command seals a database timestamp after the guarded pg_net queue is
observed empty. It does not delete jobs or responses. Readiness requires zero
financial counts, intact schema/interlocks, paused schedulers and at least 430
seconds after the latest pause, empty-queue observation, audited dispatch or
pg_net response. This includes dequeued/recent work, not only visible queue rows.
The hosted worker maximum is 400 seconds; the margin includes pg_net's 5-second
request timeout. A timestamp alone never authorizes release: the durable writer
interlock remains active and all state is checked again inside the release lock.

Expected: `ready: true`. Schema/query failures abort. If existing work prevents
the strict empty-state gate, keep the pause and investigate; this controller
does not manufacture financial reconciliation or erase history.

## Lock, capture baseline, deploy, verify, persist proof

All five stages are one command and one continuously held database session:

```powershell
node @releaseArgs --mode release --release-id $releaseId
```

The command acquires advisory lock `(1413562945, 5)`, proves its ownership through
the production API and holds that same session through staging, activation,
source/runtime verification and durable proof persistence. Default lock wait is
30 seconds; `--lock-timeout-ms 0` fails immediately if another runner owns it.
Every exit releases that session when possible. A hard crash releases the
PostgreSQL session lock while the durable financial pause remains.

Inside the protection, the controller captures the full remote baseline. It
stages exactly three self-contained functions with `bundleOnly=true`, confirms
the live baseline is unchanged, and stores the exact reserved function IDs,
versions and any bundle identities exposed by staging before activation. Optional
staging fields are not invented or equated to source hashes; complete post-release
bundle identities, downloaded bytes and runtime identities remain mandatory.
A single idempotent bulk PUT
activates only those reserved versions. Parallel timestamps are not proof of a
coordinated release.

Verification requires newer identities for all three functions, agreement with
the deployment responses, unchanged unrelated functions, exact downloaded source
bytes, and fresh read-only runtime probes that report the intended marker and
hosted version. A second inventory read must agree. Only then does PostgreSQL
persist the release proof with server timestamps and expiry. Local audit output
is optional and is never authoritative.

Expected: phase `verified`, the same `release_id`, and source identity. Production
Edge changes here; PostgreSQL release metadata also changes. Provider I/O is
prevented throughout. The runtime GET route returns metadata before entering
any payment handler. **0/3, 1/3 and 2/3 cannot produce success.**

On staging, activation, verification, cancellation or connection failure, leave
the pause active. Inspect `--mode status`. For an incomplete release:

```powershell
node @releaseArgs --mode recover --release-id $releaseId
```

Staging can be retried because orphan bundle-only versions cannot receive
traffic. After activation has been attempted, recovery reuses the same stored
three versions. It never rebases onto a partial inventory or creates a successor
release while an earlier activation may be in flight. If activation completed
but proof was not saved, verification alone can finish it:

```powershell
node @releaseArgs --mode verify --release-id $releaseId
```

Before activation only, an abort restores the original scheduler states and
retains the backward-compatible EXPAND database:

```powershell
node @releaseArgs --mode abort --release-id $releaseId
```

Abort is rejected once activation begins. This restriction makes late responses
to uncertain activation requests harmless: all retries target the same versions.
No automatic rollback or automatic CI retry runs a different release.

## Post-release drain and attestation

```powershell
do {
  $drain = node @releaseArgs --mode drain --release-id $releaseId | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Post-release drain failed' }
  if (-not $drain.result.post_release_ready) { Start-Sleep -Seconds 15 }
} while (-not $drain.result.post_release_ready)
node @releaseArgs --mode attest --release-id $releaseId
```

Expected: at least another 430 seconds after complete remote verification, then
an `attestation_id`. The command freshly verifies source, hosted versions and
quiescence before producing a private database attestation. The proof expires
after 20 minutes and the drain attestation after five minutes. CONTRACT also
requires a fresh check in its own live session within 60 seconds. A 24-hour
deadline limits new staging; recovery of already reserved immutable versions
still requires complete fresh verification.

Attestation mutates database metadata only; no provider I/O occurs. Expiry does
not resume payments. Rerun `attest` to obtain a fresh bound attestation after
verification. Caller-supplied timestamps, six-field V4 JSON and old V3 operational
entrances cannot authorize it.

## CONTRACT — irreversible compatibility boundary

```powershell
node @releaseArgs --mode contract --release-id $releaseId
node @releaseArgs --mode verify-contract --release-id $releaseId
```

Preconditions: complete trusted release/runtime proof, unchanged compatibility
definitions, matching CONTRACT SHA, active quiescence and unexpired drain
attestation. The command repeats remote verification. In one database
transaction it retires the six legacy RPCs, consumes the attestation, appends the
execution ledger and advances the release. Failure rolls back that transaction
and retains quiescence. Reapplication reports `ALREADY_APPLIED`.

**After the successful CONTRACT transaction, recovery is roll-forward only.**
Never restore legacy financial RPCs or deploy old Edge as a recovery action.
The executable recovery for an interrupted successful transaction is
`verify-contract`, then `resume`; the consumed ledger determines the outcome.
If a newly discovered defect requires different code, retain the pause and
prepare an independently reviewed V2+ correction. This one-time controller
deliberately refuses a different commit or successor bootstrap release while
its lifecycle is open; it does not conceal a code fix inside rollback.

CONTRACT changes PostgreSQL compatibility. It performs no provider I/O and does
not enable settings, connect sellers or create financial rows.

## Resume and post-deploy health

```powershell
node @releaseArgs --mode resume --release-id $releaseId
node @releaseArgs --mode health --release-id $releaseId
```

Resume freshly verifies the current release and the consumed CONTRACT ledger,
then restores the scheduler states captured before quiescence. It does not
enable payments or connect a seller. Expected: phase `resumed`, then
`healthy: true`, `financially_inert: true`, `ready_for_walter: false`.

Resume is a database mutation. Health uses read-only database connections,
Management reads and the non-financial runtime GET probes. If resume fails,
retain quiescence and rerun after resolving the reported cause. A health failure
does not authorize onboarding, payments, raw scheduler edits or legacy rollback.

Clear credentials from the terminal after operations:

```powershell
Remove-Item Env:SUPABASE_ACCESS_TOKEN, Env:TABA_A1_A4_DATABASE_URL -ErrorAction SilentlyContinue
$tokenInput = $null
$dbInput = $null
```

## Actions and audit output

`.github/workflows/release-edge-production.yml` is dispatch-only. It requires
the canonical repository, main ref, full audited SHA matching that ref, passing
canonical CI, exact project confirmation and a deliberately selected lifecycle
stage. Its default is dry-run. Re-running a workflow attempt cannot mutate
production; use a new explicit dispatch for recovery. Concurrency never cancels
an active financial release. Each action uses the same database lock/interlock
as the local command. Environment approvals and branch protection are useful
defense in depth, not assumptions on which these gates depend.

Supply the same credential inputs as repository/environment Actions secrets.
No credential values are included in logs or uploaded artifacts. The local
route can execute the audited candidate directly; the Actions route additionally
requires that exact SHA on main. Audit any different merge result before release.
Cloudflare Pages has its own explicit-dispatch workflow and never runs Edge or
CONTRACT operations. Ordinary push/PR/CI completion cannot mutate either
production target.

For optional non-authoritative audit JSON, append
`--evidence-file (Join-Path $auditDirectory 'stage-name.json')` to a live command.
The setup above creates that sibling directory; the file must be new and outside the checkout.
The authoritative status remains `--mode status` and the private database ledger.
Dry-run writes no evidence file and cannot create any trusted proof.

## Validation and recovery limits

```powershell
npm run test:payments
npm run test:webhook
npm test
npm run migrations:validate
npm run check
npm run test:release:platform
$env:TABA_LOCAL_PAYMENT_DB = '1'
npm run test:db:isolated
```

The database runner owns a fresh network-isolated container, installs pristine
OLD, applies EXPAND, exercises old/new rolling compatibility, real refund
exactly-once and concurrency, 250 canonical plus 44 privilege pgTAP assertions,
the adversarial V5 lifecycle, CONTRACT and dump/restore. It never borrows or
restarts another project's database. `--release-only` is a development-focused
run that explicitly omits the historical/canonical suites; it is not final
release validation. Tests use temporary output paths.

The restore drill preserves consumed durable evidence and verifies that missing
platform objects fail closed. It does not treat an application-only dump as a
production disaster-recovery image or as permission to replay CONTRACT on a
different project. Project binding must be re-established for every live session.

On Windows ENOSPC, select a dedicated existing-volume temp directory with free
space, set `TEMP` and `TMP` for the test process and rerun unchanged tests. Do not
clean unrelated projects or weaken tests.

## Walter authorization gate

STOP after healthy/inert post-deploy verification. No command above authorizes
Walter or obtains seller credentials. Onboarding is a separate explicit operator
decision after the independent audit, production execution, production health
verification and confirmation that the seller/payment system is inert and ready.

## Platform evidence

- [Pinned CLI 2.101.0 implementation](https://github.com/supabase/cli/tree/v2.101.0/apps/cli-go/pkg/function): server-side bundle-only staging followed by bulk version activation; the bulk PUT is idempotent.
- [Pinned CLI command validation](https://github.com/supabase/cli/blob/v2.101.0/apps/cli-go/cmd/functions.go): `--jobs 3` requires `--use-api`. The executable equivalent is `supabase functions deploy mercadopago-create-preference mercadopago-payment-worker mercadopago-refund --project-ref wwcpogltfgzgkrlilbcd --use-api --jobs 3`; the repository controller adds the required durable lifecycle and response capture.
- [Hosted runtime limits](https://supabase.com/docs/guides/functions/limits) and [hosted deployment identity](https://supabase.com/docs/guides/functions/secrets) define the worker lifetime and `DENO_DEPLOYMENT_ID` used by the drain and runtime verification.
