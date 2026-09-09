# TABA — A1/A4 rolling remediation V3

Base: `d6716cf7dc023f33d6f79a3f2d2aa89d401e0154`.
This candidate is local only. It does not authorize a deployment, payment
activation, seller connection, payment, cancellation or refund.

## EXPAND compatibility

Production currently ends at migration `20260908070341`. The V3 EXPAND order is:

1. `20260908164550_current_payment_authority_and_refund_identity.sql`
2. `20260908190758_a1_attempt_authority_expand_v2.sql`
3. `20260909011239_a1_a4_durable_contract_control_v3.sql`

`164550` creates only versioned A4 settlement objects and leaves
`record_payment_refund_response(uuid,text,text,numeric,text)` unchanged. The
database records the exact SHA-256 of `164550` and `190758` in the private
EXPAND artifact inventory; the reviewed release manifest additionally binds
the control migration and CONTRACT file.

The legacy `prepare_payment_refund` signature remains available. Its first
request is unchanged; every repeated durable request returns
`reconciliation_required=true`. Therefore the deployed old handler cannot send
a second POST after an approved response whose recorder call failed. The V2
refund handler and worker use only `prepare_payment_refund_v2`,
`record_payment_refund_response_v2` and `claim_payment_outbox_v2`.

## Deterministic drain

The private control function pauses both dispatch sources: it deactivates the
`taba-payment-outbox-worker` cron and disables the
`payment_outbox_worker_kick` trigger. A drain attestation can be created only
when all of the following are true:

- the current control-plane inventory identifies the exact three active Edge
  function versions and bundle hashes;
- the target release is different from the recorded previous release;
- cron and immediate dispatch are paused for that target release;
- no relevant request remains in `net.http_request_queue`, and the private
  append-only dispatch audit supplies the timestamp of the latest completed or
  dequeued relevant request;
- no outbox job is `claimed`/`processing` and no live lease remains;
- no refund is `requested`/`processing`;
- payments remain disabled and no seller is connected;
- at least 430 seconds elapsed after the latest of target deployment, traffic
  switch, dispatcher pause and last audited worker dispatch (400-second hosted
  worker maximum plus 30 seconds safety margin).

The attestation is stored in `private.deployment_drain_attestations`, expires
within ten minutes, includes actor/database role, previous/target releases,
timestamps, exact EXPAND/CONTRACT hashes and platform evidence, and can move
only from `pending` to `consumed` or `expired`. Browser and `service_role`
roles have neither table access nor function execution.

## One-shot CONTRACT

`supabase/contracts/20260909012000_a1_a4_legacy_contract_v3.sql` contains no raw
DDL. It calls the private executor with exact psql bindings. The reviewed Node
executor validates the local manifest, remote migration ledger, database
artifact fingerprints, schema fingerprint, current Supabase Edge inventory and
actor before invoking it.

The database executor then obtains a transaction advisory lock, bounds lock and
statement waits, locks the attestation/ledger/financial/cron/pg_net surfaces,
rechecks the complete drain, replaces legacy RPCs with fail-closed stubs,
inserts `private.deployment_contract_executions`, and consumes the attestation
in the same transaction. A second invocation raises `ALREADY_APPLIED`.

Exact future command shape, after a separately authorized atomic Edge V2
deployment and with credentials supplied through the environment:

```powershell
npx --yes supabase@2.101.0 db push --linked --dry-run
npx --yes supabase@2.101.0 db push --linked
$env:TABA_A1_A4_CONTRACT_CONFIRMATION='I_AUTHORIZE_A1_A4_V3_CONTRACT_CONTROL'
node scripts/a1-a4-contract-v3.mjs --mode pause --project-ref wwcpogltfgzgkrlilbcd
# Wait until the deterministic 430-second bound is satisfied; the next command verifies it.
node scripts/a1-a4-contract-v3.mjs --mode attest --project-ref wwcpogltfgzgkrlilbcd --previous-edge-version <captured-release-id> --previous-deployed-at <ISO-8601>
node scripts/a1-a4-contract-v3.mjs --mode execute --project-ref wwcpogltfgzgkrlilbcd --attestation-id <uuid>
node scripts/a1-a4-contract-v3.mjs --mode resume --project-ref wwcpogltfgzgkrlilbcd
```

The executor additionally requires `SUPABASE_ACCESS_TOKEN` and
`TABA_A1_A4_DATABASE_URL`. It parses the database URL into libpq environment
variables instead of placing credentials in command arguments. Do not invoke
the CONTRACT file directly and do not copy it into `supabase/migrations`.

## Rollback

- After EXPAND, old Edge remains supported: legacy first settlement and safe
  retry behavior are present.
- After Edge V2 but before CONTRACT, rolling back to old Edge remains supported
  by the same compatibility surface.
- After CONTRACT, service restoration is roll-forward only. Deploy a corrected
  V2+ Edge; never restore the old refund recorder or worker claim RPC.

All phases keep production payments disabled and the seller disconnected.
