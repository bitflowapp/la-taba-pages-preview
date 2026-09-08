# TABA A1/A4 V2 — local validation

Initial Git verification, before any edit:

```text
git status: On branch fix/a1-a4-production-blockers; nothing to commit, working tree clean
git branch --show-current: fix/a1-a4-production-blockers
git rev-parse HEAD: e3b16ad1aa127bda5e6599c8b5fce6eacbaa63f0
git remote -v: origin https://github.com/bitflowapp/la-taba-pages-preview.git (fetch/push)
git log --oneline --decorate -20: read; first two commits e3b16ad and a56a9c5
```

## Results

| Check | Result |
|---|---|
| `npm run check` | PASS, including syntax, config, release hygiene and secret scan |
| `npm run test:payments` | 75/75 |
| `npm run test:webhook` | 165 Deno cases (25 + 140), 12 Node cases |
| A1 real-handler Deno subset | 84 cases: stored, legacy stored adoption, recovered, new, mutations and initial denial controls |
| `npm test` | 2418/2418 |
| Deno type checks | Preference, refund, worker, webhook and cancellation handlers PASS |
| Migration validator | 124 automatic migrations PASS; CONTRACT is a separate file |
| PostgreSQL | 17.6 isolated in tmpfs, network `none`, no host mounts, no exposed ports |
| Original financial lifecycle on OLD DB | PASS using actual `a56a9c5` SQL from Git |
| Current financial lifecycle on EXPAND | PASS |
| pgTAP | 74 assertions: OAuth 15, seller binding 15, least privilege 44 |
| V2 grants | Browser execution denied for service RPCs; authenticated refund preparation retains its role checks |
| V1 residual A1 reproduction | `e3b16ad` releases cancelled/changed attempt URLs, reproduced through real PostgreSQL |
| V2 independent matrix | PASS on EXPAND and CONTRACT; see transcript |
| Overlapping handlers | A superseded by B: A denies, B releases, on both schemas |
| CAS transition locks | Three separate business/settings/credential writers hit lock timeout while recorder holds authority stable |
| Current CONTRACT replay after lock addition | PASS, including all routes, adoption, races and overlapping handlers |
| Old refund handlers after CONTRACT | Actual a56/e3 handlers return `REFUND_NOT_AVAILABLE`, zero provider POSTs |
| CONTRACT guards | Missing runtime attestation and active claimed job reject the whole transaction |
| A4 | Missing/pre-request/future/unknown identity rejection preserved; known identity control passes |
| Refund concurrent recording | Eight writers, exactly one approval event |

The main schema run applied 122 baseline migrations, both EXPAND migrations,
then CONTRACT. The final short-lock addition to the recorder was applied to
that same isolated schema and tested with concurrent writers plus the complete
current CONTRACT handler suite. The transactional CONTRACT guard was then
reapplied and tested with both rejection and success cases. No application
migration was skipped or rewritten by the PostgreSQL harness.

## Compatibility meaning and limits

OLD+EXPAND means preserved checkout signatures and safe refund reconciliation,
not successful new refund settlement by old code. A legacy recorder cannot
prove V2 timestamp/resource validation. It only replays already-settled approval;
new approval requires V2. Old checkout A1 vulnerabilities remain a reason to keep
production inert throughout the mixed-version rollout and any pre-CONTRACT
rollback. **Active-money rolling deployment is not certified.**

The safe deployment sequence, external runtime drain evidence, rollback limits
and migration-ledger preconditions are in
`docs/A1_A4_LOCAL_REMEDIATION_V2.md`. After CONTRACT use roll-forward; do not
restore the old refund recorder. `SAFE_TO_DEPLOY=NO`.

The PostgreSQL harness imports only local auth schema definitions and uses
minimal Storage fixture tables. Authentication transport and Mercado Pago are
synthetic. It does not exercise hosted Auth, Storage, routing or actual provider
settlement, and does not establish that production runtime has drained.

No staging/production deployment, remote migration, credential change, seller
connection or financial operation occurred. Production inertness was preserved
by making no remote changes, not newly certified through a live query.

Local A1/A4 technical findings after remediation: P0 0, P1 0, P2 blocking 0
within the documented inert rollout. Earlier production activation/configuration
findings remain outside this scope. Candidate for GPT-5.6 Sol independent review;
not authorization to deploy or activate payments.

## Files changed

- artifacts/codex/A1_A4_V2_INDEPENDENT.txt
- artifacts/codex/A1_A4_V2_INITIAL_HISTORY.txt
- artifacts/codex/A1_A4_V2_VALIDATION.md
- docs/A1_A4_LOCAL_REMEDIATION_V2.md
- scripts/a1-v2-drain-inspection.sql
- scripts/bootstrap-a1-v2-local.mjs
- scripts/verify-a1-v2-independent.mjs
- scripts/verify-a1-v2-locks.mjs
- scripts/verify-a1-v2-sql.mjs
- supabase/contracts/20260908190800_a1_a4_legacy_contract_v2.sql
- supabase/functions/_shared/current-payment-authority.deno.ts
- supabase/functions/_shared/mercadopago.ts
- supabase/functions/_shared/refund-runtime.deno.ts
- supabase/functions/_shared/seller-oauth.ts
- supabase/functions/mercadopago-create-preference/index.ts
- supabase/functions/mercadopago-payment-worker/index.ts
- supabase/functions/mercadopago-refund/index.ts
- supabase/migrations/20260908164550_current_payment_authority_and_refund_identity.sql
- supabase/migrations/20260908190758_a1_attempt_authority_expand_v2.sql
- supabase/tests/mercadopago_checkout_pro.local.sql

## Final source fingerprints (SHA-256)

- supabase/contracts/20260908190800_a1_a4_legacy_contract_v2.sql — c90b2d9872f5f9bb8f4250474d943d297fc628866e6463c9b9bfc21effd82e9a
- supabase/functions/_shared/current-payment-authority.deno.ts — a9fc8a23bc2eda802bd83a7372219f8dd09e085b2901b683b89592eda8b69752
- supabase/functions/_shared/mercadopago.ts — 26640453b02589705d92765d7b2a11e231cfac0c826882df0913e88e9baa3635
- supabase/functions/_shared/refund-runtime.deno.ts — 794083107844f86a1785ac2fbfe3de3c8aadd8c0dd44856e92e2b36b1c6e7414
- supabase/functions/_shared/seller-oauth.ts — a643cbe8ea815938a612e8db13d1675ec09c493a4e30e6b07c460e8542df6a1e
- supabase/functions/mercadopago-create-preference/index.ts — 9e3ef99963f1b5fa4ae300fe1774e4916d0330fb1d93803b93f1255b7ecd1ab4
- supabase/functions/mercadopago-payment-worker/index.ts — ebc9c616f5037fafc8edf091e84ed4d2fdd560545ddd6a9c96816fde5f58c903
- supabase/functions/mercadopago-refund/index.ts — 8aa4d897ba086b09042c4feb642a814f5219c4ad00470635965ab706a7ab03ff
- supabase/migrations/20260908164550_current_payment_authority_and_refund_identity.sql — f7f9c766237293abfd77b89ed23419a005c0c159c4e001caf19291c54d455eb9
- supabase/migrations/20260908190758_a1_attempt_authority_expand_v2.sql — 9570b9506f09925fd3f5fdcb8969ad10adc8f13c8e4e322b2d5866a9f50e0c73
