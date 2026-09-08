# TABA — A1/A4 local remediation V2

## Scope and provenance

Work started on `fix/a1-a4-production-blockers`, clean, at
`e3b16ad1aa127bda5e6599c8b5fce6eacbaa63f0`. The remote was
`https://github.com/bitflowapp/la-taba-pages-preview.git`. The preceding audit
baseline is `a56a9c54c155d6b0c1eb088c3dbe93edbfd10b7f`. Git status, branch, HEAD,
remote and the last 20 commits were read before editing. No earlier chat was
used as evidence. The previous remediation and both `artifacts/codex` audits
were inspected, together with the actual schema, handlers and tests.

All mutations in this task are local. No fetch/push, deployment, remote SQL,
secret change, seller consent, payment, refund or cancellation was performed.
The user's production-inert boundary was preserved; live production state was
not re-queried. Earlier operational findings about worker configuration,
migration drift and launch readiness are outside this local A1/A4 closure.
`SAFE_TO_DEPLOY=NO` remains unconditional until independent review and separate
deployment authorization.

## A1 residual defect

V1 hashed business/settings/seller/checkout/intent, but not `payment_attempts`.
The handler held a URL outside that snapshot. Cancellation, replacement of the
attempt UUID, or changing only the attempt's preference or URL during
`/users/me` could therefore release the old URL. The old recorder also changed
cancelled attempts back to `created` without checking whether they were latest.

The independent harness loads `e3b16ad` directly from Git and positively
reproduces those releases through the real handler and PostgreSQL. It does not
modify the working tree to load the baseline.

## Authority and linearization

1. `prepare_mercadopago_preference_v2` locks checkout, intent and latest attempt.
   Its existing states are retained. Supersession means a higher
   `attempt_number` of type `preference`; no fictitious `superseded` state was
   added. `current_payment_attempt_id` makes the current identity explicit.
2. The pre-provider V2 snapshot selects only the latest preference attempt and
   binds its UUID, intent, order through the complete intent row, business,
   checkout/customer, environment, number, idempotency key, state, preference,
   exact URL, seller and credential. An attempt revision increments on every
   update, including changes later reverted. Checkout/intent already have
   revisions. Timestamps are not the sole identity mechanism.
3. After any needed OAuth refresh, the exact encrypted credential from that
   snapshot is decrypted and used for all preference provider requests.
4. NEW and RECOVERED persist through `record_mercadopago_preference_created_v2`.
   It locks checkout → intent → attempt, compares the complete pre-snapshot
   hash, requires the latest eligible attempt and atomically writes the
   preference, exact URL, seller ID/generation and current intent pointer.
   A cancelled or replaced attempt cannot be revived. The recorder returns
   its post-write snapshot; intentional persistence is the only accepted
   transition between pre-provider and ready authority.
   Business/settings/seller rows are also held with short shared locks until
   that returned snapshot is established, so an intra-recorder credential
   rotation cannot silently replace the pre-provider authority.
5. STORED uses its persisted snapshot. An older row without a seller binding
   is adopted only after a specific provider GET verifies preference ID,
   collector, external reference, checkout metadata and the **exact stored
   URL**. A supplied attempt metadata ID must also match. The same CAS recorder
   binds it; unverified legacy URLs are never stamped with today's seller.
6. All three paths converge on `assertCurrentSellerPaymentAuthority`. It
   validates the ready snapshot, calls `/users/me` with that snapshot's exact
   token, and performs one final V2 SQL snapshot. Every authority field and
   hash must still match, the pointer and latest attempt must be the requested
   attempt, and its state must be `created`. Runtime approval is checked again.

**Linearization point:** the MVCC snapshot of the final
`get_mercadopago_payment_authority_v2` statement, after authoritative
persistence and `/users/me`. No provider or database operation follows that
decision before constructing the URL response. A concurrent mutation committed
before that snapshot is visible and rejects the URL. One committed afterward
is ordered after authorization. No SQL transaction remains open over provider
I/O. This does not revoke URLs already issued by Mercado Pago.

Preference searches verify specific resources and attempt metadata; they do
not choose another attempt by amount, array order or external reference alone.
Multiple matches, incomplete search pages or unidentifiable legacy recovery
remain reconcilable and do not authorize a blind new POST. Preferences explicitly
belonging to another attempt are skipped. Sandbox URLs are never released.

The monotonic intent trigger required a narrow retry extension: only a
terminal rejected/cancelled/expired/failed intent can return to
`preference_creating`, and only when a changed pointer identifies a later,
latest, prepared preference attempt of that same intent. Ordinary status
regressions remain forbidden.

## EXPAND and legacy behavior

The unapplied local migration
`20260908164550_current_payment_authority_and_refund_identity.sql` was revised
in place without rewriting Git history. It introduces the versioned A4
recorder and retains the legacy signature as a compatibility adapter. Do not
use that edited version on a database that has already recorded the V1 version:
stop and create a new corrective migration after establishing its actual ledger.

`20260908190758_a1_attempt_authority_expand_v2.sql` adds the V2 snapshot/base,
attempt revision and binding columns, current pointer, CAS recorder and
versioned checkout preparation, refund preparation and outbox claim RPCs.
Browser grants remain absent for service RPCs. Refund preparation retains
authenticated owner/admin authorization. Existing columns, states and legacy
RPC signatures are retained.

There is an unavoidable distinction between signature compatibility and
settlement availability: the old refund recorder arguments contain neither
timestamp validation evidence nor proof of a specific-resource lookup. An
adapter cannot reconstruct that missing evidence. **During EXPAND, a legacy
request to newly approve a refund is rejected, even if its ID is bound.** Old
handlers use their existing reconciliation/retry branches; no false approval
or second refund is manufactured to preserve an old success response. Already
settled approvals can be replayed idempotently. V2 settlement is fully available.
This restriction is intentional and must be included in deployment review;
EXPAND does not promise uninterrupted refund settlement on old instances.

The old checkout implementation still has its preexisting A1 defects. It is
not made trustworthy by deploying a schema. Consequently the supported
mixed-version rollout and rollback keep production inert, with payments off
and seller disconnected, throughout. Successful old-code control tests measure
schema compatibility, not authorization to operate that old code with live
payments. Active-money rolling deployment is not certified by this work.

## A4 preservation

`record_payment_refund_response_v2` retains V1's identity and exactly-once
logic. Its implementation and `refund-correlation.ts` were not weakened.
Unknown IDs remain ambiguous. Known IDs require a specific provider lookup,
matching payment/refund IDs and amount, supported status and a timestamp within
the existing 30-second skew bound around request/verification time. Missing,
older-than-allowed and future timestamps cannot approve. Identity is persisted
from the authenticated creation response before settlement. Lost responses
without identity never cause an automatic second POST. Terminal replays with
different hashes create no second financial event; late ambiguity does not
downgrade a settled result.

## CONTRACT and drain

`supabase/contracts/20260908190800_a1_a4_legacy_contract_v2.sql` is deliberately
outside `supabase/migrations`. A bulk migration push must not apply CONTRACT
alongside EXPAND. The file was created with the CLI migration generator and
then moved into this separately executed phase.

CONTRACT retains legacy signatures with explicit `55000` failures for checkout
preparation, preference recording/snapshot, refund preparation/recording and
outbox claims. Old refund handlers therefore stop **before** provider POST;
old workers cannot claim more jobs. V2 implementations do not delegate to
these retired signatures. The legacy base snapshot was copied to a private V2
name for this reason.

The SQL file executes atomically, bounds lock waits, and locks refund/outbox
writes during the contract switch. It refuses execution without
`taba.a1_a4_drain_verified=on` and refuses any `claimed`/`processing` outbox row
or `requested`/`processing` refund. This setting is an operator attestation,
**not** proof of runtime termination. External evidence remains mandatory.

The actual lifecycle is: cron every 30 seconds, an immediate insert trigger,
pg_net dispatch with a 5-second HTTP timeout, worker signatures valid for 120
seconds plus 30 seconds permitted future skew, a 90-second claim lease, up to
20 sequential jobs, and 12-second provider calls. A lease can expire while a
worker is still alive. None of the affected handlers uses `waitUntil`, but a
client timeout is still not proof of worker termination.

[Supabase's current limits](https://supabase.com/docs/guides/functions/limits)
document a maximum worker lifetime of 400 seconds on paid plans (150 on free),
and distinguish that from the 150-second request idle timeout.
[Background tasks](https://supabase.com/docs/guides/functions/background-tasks)
can continue beyond a response. These sources were consulted on 2026-09-08.
Do not substitute an arbitrary two-minute sleep for a drain.

Required evidence before CONTRACT:

1. Keep financial activation disabled. Establish the exact deployed old and
   new function version IDs. Block new routing to old versions, including
   retries and any pinned invocation route; verify the new version serves all
   affected endpoint names.
2. Pause both scheduled and immediate worker dispatch, and account for queued
   pg_net calls and already signed requests. Pausing cron alone is insufficient.
3. From platform routing/invocation/termination evidence, establish the last
   possible old invocation and confirm no old worker can still execute. The
   documented 400-second lifetime can bound a **known last possible start**;
   it cannot establish when routing stopped. Account for signature validity,
   queueing and clock skew before fixing that start bound. If the platform
   cannot provide this evidence, do not apply CONTRACT.
4. Inspect all leases, including expired ones. New workers identify owners as
   `edge:v2:…`; old owners use `edge:…`. No claimed/processing job may remain.
   Resolve an abandoned outbound refund as ambiguous using its existing ID/key,
   never by resetting it for a POST. An ambiguous refund may remain pending for
   V2 reconciliation or manual investigation after old execution has ended.
5. Require zero requested/processing refunds and zero active financial SQL
   transactions/locks from old work. Save the read-only drain inspection and
   external version evidence. Only then attest and apply CONTRACT in one
   transaction. Restore dispatch to the new version afterward.

An external provider may complete an already sent POST after worker death.
That uncertainty is retained as ambiguity; worker termination is never used as
proof that no refund occurred.

## Compatibility and rollback interpretation

| Combination | Local evidence / supported result |
|---|---|
| a56 old Edge + old DB (122 migrations) | Checkout controls and original financial lifecycle pass. Historical defects are reproduced separately. |
| a56/e3 old Edge + EXPAND DB | Checkout contracts work. Legacy new refund approval follows safe reconciliation; settled replay is compatible. Inert mixed-version rollout only. |
| V2 Edge + old DB | Missing V2 preparation fails closed before provider I/O. |
| V2 Edge + EXPAND DB | STORED, legacy STORED adoption, RECOVERED, NEW, adversarial races and overlapping handlers pass. |
| V2 Edge + CONTRACT DB | The same handler/race suite passes; V2 refund recorder and worker claim remain callable. |
| Old Edge + CONTRACT DB | Checkout, refund preparation/recording and worker claims fail closed. |

Rollback after EXPAND: leave additive schema and safe adapters in place; keep
the old Edge inert. Do not restore the unsafe original refund recorder.

Rollback after Edge: before CONTRACT, old endpoint signatures remain, so an
inert rollback is possible. Preserve all V2 identity/revision data and accept
legacy refund reconciliation rather than settlement. No claim of restoring
active old payment processing is made.

Rollback after CONTRACT: **ROLL_FORWARD_ONLY** for service restoration. Old
code is deliberately unsupported. Retain the V2 database contract and deploy
a corrected V2 Edge; never reinstall the original recorder to regain success.

## Reproduction and verification

`scripts/verify-a1-v2-independent.mjs` is separate from the Deno handler test.
It loads both Git baselines and working code through Node's TypeScript VM,
uses real PostgreSQL for preparation, CAS persistence and snapshots, and mocks
only authentication transport and provider responses. Provider transport
rejects every unexpected origin/path. Mutations run as independent committed
SQL operations during the paused provider request. A mutation error fails the
test itself; a failed attempt to mutate cannot masquerade as a successful race
rejection. Fixture rewinds alone suppress triggers; all exercised RPCs and
adversarial mutations use normal triggers.

The harness also overlaps two actual handler promises: A waits on `/users/me`,
B is prepared by the real controlled retry RPC, B releases its URL, then A
resumes and must return no URL. It separately cancels/supersedes/changes
preference/URL/credential/settings/business before persistence, tests same-seller
different UUID and ABA changes, and repeats the suite after CONTRACT.

`scripts/verify-a1-v2-sql.mjs` runs the checkout financial lifecycle, three
pgTAP suites (OAuth, seller binding and least privilege) and V2 grant checks on
EXPAND. The independent harness executes it at the correct phase.

Local reproduction recipe (a **fresh disposable** container, no host mounts,
no published ports; substitute a fresh name and an existing local Supabase DB
container for the auth-schema-only source):

```powershell
$env:TABA_LOCAL_PAYMENT_DB='1'
docker run -d --name taba-a1-a4-local-review --network none --tmpfs /var/lib/postgresql/data:rw,size=768m,uid=100,gid=101 --tmpfs /tmp:rw,size=64m --user postgres --entrypoint /bin/sh public.ecr.aws/supabase/postgres:17.6.1.166 -c 'initdb -D /var/lib/postgresql/data/db -A trust >/tmp/init.log && postgres -D /var/lib/postgresql/data/db -k /tmp -c listen_addresses= -c shared_preload_libraries=pg_cron,pg_net -c cron.database_name=postgres'
node scripts/bootstrap-a1-v2-local.mjs taba-a1-a4-local-review supabase_db_LOCAL_SOURCE
node --experimental-vm-modules scripts/verify-a1-v2-independent.mjs taba-a1-a4-local-review
```

The bootstrap uses real PostgreSQL 17.6, pg_cron, pg_net and Vault extensions.
It copies only local auth schema definitions, excluding project-specific auth
triggers, and creates minimal Storage bucket/object fixture tables. It applies
every application migration without editing or skipping one. This is a database
and Edge-handler test, not a Supabase Auth/Storage service end-to-end test.
The older `verify-a1-a4-reproductions.mjs` is the historical V1 harness and is
superseded for this candidate by the separate V2 harness.

Final results are recorded in `artifacts/codex/A1_A4_V2_VALIDATION.md` and the
independent run transcript. The standalone checks are `npm run check`,
`npm run test:payments`, `npm run test:webhook`, `npm test`, Deno type checks
and `npm run migrations:validate`.

## Recommended sequence — not executed

1. GPT-5.6 Sol independently reviews the final local commit and these caveats.
2. Obtain separate deployment authorization and verify real remote version and
   migration ledgers; keep production payments/seller inactive. An already
   applied V1 migration requires a newly versioned correction, not ledger edits.
3. Apply only EXPAND migrations through `20260908190758` and verify private RPC
   grants. Do not copy CONTRACT into an automatic pending-migration batch.
4. Deploy the V2 preference, refund and payment-worker functions with their
   matching shared modules. Verify function versions and nonfinancial checks.
5. Drain old code with the evidence above. Preserve ambiguous financial work.
6. In a separately authorized database session, set the drain attestation,
   apply the self-contained transactional CONTRACT file, reset the attestation,
   and record its execution/hash in the release audit.
7. Resume dispatcher/worker execution on V2; verify legacy fail-closed and V2
   compatibility. Keep payments disabled and seller disconnected. Activation,
   Walter consent and all money movement are separate future decisions.

Next step: GPT-5.6 Sol independent review V2.
