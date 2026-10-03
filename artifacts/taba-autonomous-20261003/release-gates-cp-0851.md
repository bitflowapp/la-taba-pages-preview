# E-commerce release gates

**VERDICT: NOT_READY**

- target: controlled-production (project tkanbadcglszlcyfjvpv)
- business: e7850ad2-a447-402c-8375-3fd74e9466ba (la-taba-cp)
- source: live read (Management API, read-only)
- facts collected: 2026-10-03T11:51:11.652Z · age 0 min (max 30) · FRESH
- observer: supabase_read_only_user · transaction_read_only=on
- min products: 1

| Gate | Blocking | Status | Missing |
|---|---|---|---|
| CATALOG_APPROVAL | yes | FAIL | PUBLIC_PRODUCTS_BELOW_MINIMUM:0/1 |
| VALID_PRICES | yes | PASS |  |
| SERVICE_HOURS | yes | FAIL | NO_HOURS_FOR_CHANNEL:delivery, NO_HOURS_FOR_CHANNEL:pickup |
| DELIVERY_ZONES | yes | PASS | NO_DELIVERY: delivery is disabled (see FULFILMENT) |
| FULFILMENT | yes | FAIL | NO_FULFILMENT_MODE |
| TEAM | yes | FAIL | NO_ACTIVE_STAFF_OR_ADMIN |
| MP_SELLER | yes | FAIL | PAYMENT_DECISION_MISSING |
| PAYMENT_CERTIFICATION | yes | PASS |  |
| MIGRATION_PARITY | yes | FAIL | REPO_NOT_IN_LEDGER:20261001010000, REPO_NOT_IN_LEDGER:20261001180000, REPO_NOT_IN_LEDGER:20261001190000, REPO_NOT_IN_LEDGER:20261001190500, REPO_NOT_IN_LEDGER:20261001191000, REPO_NOT_IN_LEDGER:20261001192000, REPO_NOT_IN_LEDGER:20261001193000, REPO_NOT_IN_LEDGER:20261001194000, REPO_NOT_IN_LEDGER:20261001195000, REPO_NOT_IN_LEDGER:20261001200000, REPO_NOT_IN_LEDGER:20261001200100, REPO_NOT_IN_LEDGER:20261001200200, REPO_NOT_IN_LEDGER:20261001200300, REPO_NOT_IN_LEDGER:20261001203000, REPO_NOT_IN_LEDGER:20261001204000, REPO_NOT_IN_LEDGER:20261001205000, REPO_NOT_IN_LEDGER:20261001210000, REPO_NOT_IN_LEDGER:20261001213000, REPO_NOT_IN_LEDGER:20261001214000, REPO_NOT_IN_LEDGER:20261001215000, REPO_NOT_IN_LEDGER:20261001216000, REPO_NOT_IN_LEDGER:20261001220000, REPO_NOT_IN_LEDGER:20261001220500, REPO_NOT_IN_LEDGER:20261001221000, REPO_NOT_IN_LEDGER:20261001221500, REPO_NOT_IN_LEDGER:20261001222000, REPO_NOT_IN_LEDGER:20261001223000, REPO_NOT_IN_LEDGER:20261001223500, REPO_NOT_IN_LEDGER:20261001224000, REPO_NOT_IN_LEDGER:20261001224500, REPO_NOT_IN_LEDGER:20261001225000, REPO_NOT_IN_LEDGER:20261001230000, REPO_NOT_IN_LEDGER:20261002030000 |
| EDGE_FUNCTIONS | yes | FAIL | SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-cancel-payment, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-checkout-status, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-connect, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-create-checkout-session, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-create-preference, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-oauth-callback, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-payment-worker, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-refund, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-webhook |
| ABUSE_PROTECTION | yes | FAIL | GUARD_FUNCTION_MISSING, GUARD_MODE:absent |
| UNATTENDED_ORDER_POLICY | no | WARNING | ABANDONED_ORDER_MINUTES_NOT_DECIDED |
| NO_OPEN_P0 | yes | PASS |  |
| NO_OPEN_P1 | yes | PASS |  |
| CI_GREEN | yes | FAIL | RELEASE_INPUTS_NOT_COMMITTED:4, CI_CONCLUSION_NOT_SUPPLIED |
| STORE_STATE | no | PASS |  |

## Blockers (9)

- `CATALOG_APPROVAL` — FAIL: PUBLIC_PRODUCTS_BELOW_MINIMUM:0/1
- `SERVICE_HOURS` — FAIL: NO_HOURS_FOR_CHANNEL:delivery, NO_HOURS_FOR_CHANNEL:pickup
- `FULFILMENT` — FAIL: NO_FULFILMENT_MODE
- `TEAM` — FAIL: NO_ACTIVE_STAFF_OR_ADMIN
- `MP_SELLER` — FAIL: PAYMENT_DECISION_MISSING
- `MIGRATION_PARITY` — FAIL: REPO_NOT_IN_LEDGER:20261001010000, REPO_NOT_IN_LEDGER:20261001180000, REPO_NOT_IN_LEDGER:20261001190000, REPO_NOT_IN_LEDGER:20261001190500, REPO_NOT_IN_LEDGER:20261001191000, REPO_NOT_IN_LEDGER:20261001192000, REPO_NOT_IN_LEDGER:20261001193000, REPO_NOT_IN_LEDGER:20261001194000, REPO_NOT_IN_LEDGER:20261001195000, REPO_NOT_IN_LEDGER:20261001200000, REPO_NOT_IN_LEDGER:20261001200100, REPO_NOT_IN_LEDGER:20261001200200, REPO_NOT_IN_LEDGER:20261001200300, REPO_NOT_IN_LEDGER:20261001203000, REPO_NOT_IN_LEDGER:20261001204000, REPO_NOT_IN_LEDGER:20261001205000, REPO_NOT_IN_LEDGER:20261001210000, REPO_NOT_IN_LEDGER:20261001213000, REPO_NOT_IN_LEDGER:20261001214000, REPO_NOT_IN_LEDGER:20261001215000, REPO_NOT_IN_LEDGER:20261001216000, REPO_NOT_IN_LEDGER:20261001220000, REPO_NOT_IN_LEDGER:20261001220500, REPO_NOT_IN_LEDGER:20261001221000, REPO_NOT_IN_LEDGER:20261001221500, REPO_NOT_IN_LEDGER:20261001222000, REPO_NOT_IN_LEDGER:20261001223000, REPO_NOT_IN_LEDGER:20261001223500, REPO_NOT_IN_LEDGER:20261001224000, REPO_NOT_IN_LEDGER:20261001224500, REPO_NOT_IN_LEDGER:20261001225000, REPO_NOT_IN_LEDGER:20261001230000, REPO_NOT_IN_LEDGER:20261002030000
- `EDGE_FUNCTIONS` — FAIL: SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-cancel-payment, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-checkout-status, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-connect, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-create-checkout-session, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-create-preference, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-oauth-callback, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-payment-worker, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-refund, SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-webhook
- `ABUSE_PROTECTION` — FAIL: GUARD_FUNCTION_MISSING, GUARD_MODE:absent
- `CI_GREEN` — FAIL: RELEASE_INPUTS_NOT_COMMITTED:4, CI_CONCLUSION_NOT_SUPPLIED

## Warnings (1)

- `UNATTENDED_ORDER_POLICY` — ABANDONED_ORDER_MINUTES_NOT_DECIDED

## Public launch blockers — external gates (1)

- `EDGE-03` (P1) Production has no steady-state switch for real payments: every production preference needs the 'smoke' secret that runbooks and tooling require to be absent, and the failure happens after stock is reserved — SOFTWARE HALF FIXED (4b3f40f): with the production gate closed the checkout session answers 409 PAYMENTS_NOT_ENABLED and reserves nothing. WAITING ON THE OWNER: which switch enables real payments in steady state. Today production only issues a preference while the secret named 'smoke' is present, and the runbooks and tools require it to be absent. Options in the decision memo (evidence, payments.md): A, an explicit permanent project-level switch (recommended); B, rely on the project review status plus the per-business switch. Until it is decided production stays closed and fails closed. Not changed in this branch: it is the switch for real money.

## Evidence

- `CATALOG_APPROVAL`: `{"min_products":1,"public":0,"available":0,"total":46,"available_unverified":0,"available_without_intent":0,"image_policy_applies":true,"available_without_approved_image":0,"commercial_origin_required":true,"available_non_commercial":0,"offenders":[]}`
- `VALID_PRICES`: `{"available":0,"available_bad_price":0,"available_price_not_confirmed":0,"pending_price_total":46,"offenders":[]}`
- `SERVICE_HOURS`: `{"hours_enforced":true,"operating_timezone":"America/Argentina/Buenos_Aires","timezone_valid":true,"channels":["delivery","pickup"],"rows":{"delivery":0,"pickup":0}}`
- `DELIVERY_ZONES`: `{"delivery_enabled":false,"reason":"NO_DELIVERY: delivery is disabled (see FULFILMENT)"}`
- `FULFILMENT`: `{"delivery_enabled":false,"pickup_enabled":false,"address_set":true}`
- `TEAM`: `{"owners":1,"admins":0,"staff":0,"riders":0,"delivery_enabled":false,"rider_required":false,"delivery_model":"NO_DELIVERY"}`
- `MP_SELLER`: `{"payment_mode":"undecided","decision_present":false,"decision_valid":false}`
- `PAYMENT_CERTIFICATION`: `{"payment_mode":"undecided","methods_to_open":["manual"],"certified":{"manual":{"environment":"staging","evidence":"artifacts/taba-e2e-cert-20261001-022224","date":"2026-10-01"}}}`
- `MIGRATION_PARITY`: `{"repo":190,"ledger":157,"repo_head":"20261002030000","ledger_head":"20260929120000","repo_not_in_ledger":33,"ledger_not_in_repo":0,"name_mismatches":0}`
- `EDGE_FUNCTIONS`: `{"repo":13,"deployed":13,"critical_required":true,"critical":9,"unexpected_on_target":[],"strict_reference":null}`
- `ABUSE_PROTECTION`: `{"guard_function_exists":false,"guard_doors":{"create_checkout_session":false,"create_order_with_items":false},"order_intake_guard_mode":null}`
- `UNATTENDED_ORDER_POLICY`: `{"abandoned_order_minutes":null}`
- `NO_OPEN_P0`: `{"severity":"P0","total":0,"open":0,"fixed":0,"accepted_risk":0,"external_gate":0}`
- `NO_OPEN_P1`: `{"severity":"P1","total":14,"open":0,"fixed":12,"accepted_risk":1,"external_gate":1}`
- `CI_GREEN`: `{"conclusion":null,"commit":null,"repo_head":"f2cafbd3885c8f9c7ee9ec0c615bd3e3a13d6317","uncommitted_release_inputs":["M supabase/functions/_shared/cancel-runtime.deno.ts","M supabase/functions/_shared/refund-runtime.deno.ts","M supabase/functions/_shared/seller-webhook-runtime.deno.ts","M supabase/functions/mercadopago-cancel-payment/index.ts"]}`
- `STORE_STATE`: `{"slug":"la-taba-cp","status":"closed","is_active":true,"ordering_enabled":false,"ordering_verified":false,"qa_fixture":false,"opening_readiness":"NOT_AVAILABLE:MGMT_HTTP_400:read-only-sql:{\"message\":\"Failed to run sql query: ERROR: 42501: permission denied for function get_store_opening_readiness\\n\"}"}`
