# TABA A1/A4 V3 — local validation

Base: `d6716cf7dc023f33d6f79a3f2d2aa89d401e0154`.
No deployment, remote migration, seller connection, payment, refund or
cancellation was performed.

## Pristine PostgreSQL matrix

The final run created a new PostgreSQL 17.6.1.166 cluster in tmpfs with
`network=none`, no bind mounts and no published ports. It applied exactly the
122 migrations through production ledger `20260908070341`, then the three V3
EXPAND migrations from the working tree.

| Combination | Result |
|---|---|
| OLD_EDGE + OLD_DB | PASS |
| OLD_EDGE + EXPAND_DB | PASS |
| NEW_EDGE + OLD_DB | EXPECTED_INCOMPATIBLE / fail-closed before provider I/O |
| NEW_EDGE + EXPAND_DB | PASS |
| NEW_EDGE + CONTRACT_DB | PASS |
| OLD_EDGE + CONTRACT_DB | FAIL_CLOSED |

The legacy refund recorder SHA from `pg_get_functiondef` was identical before
and after EXPAND. The real `a56a9c5` refund handler then exercised an eligible
refund: mocked provider POST returned approved, the recorder transport failed,
the first response was the handler's real 409, and the same client request was
retried. PostgreSQL returned `reconciliation_required`; total provider POSTs
remained exactly one.

## Durable CONTRACT controls

- normal `anon`, `authenticated` and `service_role` cannot read/write the
  private tables or execute pause, attestation or contract functions;
- active cron, active immediate trigger, pending pg_net request, recent audited
  dispatch, active lease/job, requested/processing refund, insufficient 430 s
  wait, expired attestation, wrong Edge identity, wrong CONTRACT SHA, wrong
  EXPAND identity and actor mismatch all fail closed;
- a valid execution retires legacy RPCs, writes one append-only ledger row and
  consumes its append-only attestation in the same transaction;
- replay returns `ALREADY_APPLIED`;
- post-CONTRACT V2 dispatch resume requires the matching ledger and restores
  both cron and the immediate trigger;
- seller/settings concurrency uses one `seller -> settings` lock order and the
  real overlap test completed without a deadlock.

## A1/A4 and suites

- A1 stored, legacy stored adoption, recovered and new paths: PASS on EXPAND
  and CONTRACT, including cancellation, supersession, attempt UUID,
  preference ID, exact URL, ABA, settings, business and credential races.
- Two overlapping attempts: stale A rejected, current B released.
- A4 unknown/missing/pre-request/future identities remain ambiguous; known
  identity uses specific lookup; eight concurrent recorders produced one
  durable financial event.
- Missing or truncated preference-search pagination now fails closed.
- `npm run check`: PASS.
- `npm run test:payments`: 80/80.
- `npm run test:webhook`: 166 Deno + 12 Node.
- `npm test`: 2423/2423.
- Deno type checks for preference, refund, worker, webhook and cancellation:
  PASS.
- Migration validation: 125 automatic migrations PASS; CONTRACT remains
  outside `supabase/migrations`.
- pgTAP: 74 assertions PASS, plus checkout lifecycle and new V3 SQL controls.

## Read-only production observation

The linked production project remained at 122 migrations, last
`20260908070341`. Read-only Management API queries returned:

- `seller_connected=0`
- `payments_enabled=0`
- `payment_intents=0`
- `payment_attempts=0`
- `payment_outbox=0`
- `payment_refunds=0`
- relevant `net.http_request_queue=0`
- V2 authority RPC absent

The active production functions remained the pre-V3 versions: preference v9,
payment-worker v9 and refund v9. This is observation only, not deployment
readiness or authorization.
