# CODEX Findings — auditoría independiente de producción

## CDEX-001

ID: CDEX-001  
SEVERITY: HIGH  
AREA: Payment worker / production configuration  
EVIDENCE: Read-only SQL against Supabase production `wwcpogltfgzgkrlilbcd` returned zero rows from `vault.secrets` for `taba_payment_worker_url` and `taba_payment_worker_hmac_secret`, while `cron.job` contains active job `taba-payment-outbox-worker` every 30 seconds. `public.dispatch_payment_outbox_worker` reads those two Vault names and returns `null` when either is absent (`supabase/migrations/20260803120000_mercadopago_staging_worker_scheduler.sql`, symbols `dispatch_payment_outbox_worker`, lines 38-53).  
ATTACK/FAILURE PATH: After payments are deliberately enabled, Mercado Pago accepts a payment and sends a valid webhook. The receiver durably inserts a `payment_outbox` job. Both the immediate trigger and cron invoke `dispatch_payment_outbox_worker`, which silently returns `null`; the Edge worker is never called.  
IMPACT: Real money can be accepted while the operational order is not finalized automatically. The customer and business may see a paid-without-order incident until a separate status reconciliation or manual recovery occurs.  
MITIGATION: Keep `business_payment_settings` absent/disabled and do not set the real-payment confirmation. Before go-live, provision the canonical production worker URL and the same high-entropy worker HMAC secret in Supabase Vault and Edge Function secrets, then run a no-money signed dispatch probe and verify `pg_net`/outbox completion.  
FIX_STATUS: OPEN — production configuration change required; prohibited during this frozen audit.  
VERIFICATION: Re-query Vault names (names only), inspect cron active state, insert/process only an approved synthetic non-production outbox fixture in an isolated environment, and confirm a signed call reaches `mercadopago-payment-worker`.

## CDEX-002

ID: CDEX-002  
SEVERITY: HIGH  
AREA: Staging/production isolation / OAuth application identity  
EVIDENCE: `oauthConfig()` only checks that `MERCADOPAGO_CLIENT_ID` is numeric (`supabase/functions/_shared/seller-oauth.ts`, lines 11-34). `scripts/mercadopago/configurar-oauth-produccion.mjs`, lines 22-30 and 40-50, accepts and installs any numeric App ID. Repository search found no assertion for production App ID `7677852968049976` or staging App ID `2691240967769590`, and no regression test for a staging App ID in production.  
ATTACK/FAILURE PATH: An operator pastes the staging application's numeric ID/secret/webhook secret into production. Project-ref, deployment, live-mode and review-string checks remain internally consistent and do not identify that the wrong Mercado Pago application is in use.  
IMPACT: OAuth consent and webhooks can be bound to the wrong Mercado Pago application; app-specific review/configuration is bypassed as a deployment invariant, violating ZERO CROSSOVER. Depending on provider configuration, this can break notifications or run live seller authorization under the staging app.  
MITIGATION: Bind the two known Supabase project refs to their expected public Mercado Pago App IDs in server runtime validation and in the production setup script.  
FIX_STATUS: PATCHED LOCALLY on `audit/codex-production-hardening` — server runtime now binds the two known Supabase refs to their deployment and public Mercado Pago App IDs; production setup rejects any ID other than `7677852968049976`. No deployment or merge.  
VERIFICATION: Unit tests must reject staging App ID `2691240967769590` under production ref/deployment, reject production App ID under staging, and accept each canonical pairing.

## CDEX-003

ID: CDEX-003  
SEVERITY: MEDIUM  
AREA: Kill switch semantics  
EVIDENCE: `prepare_mercadopago_preference` checks `business_payment_settings.enabled` before returning the preparation (`supabase/migrations/20260806260000_taba2_combo_preference_lines.sql`, lines 41-57). The subsequent provider search/POST occurs outside that transaction in `mercadopago-create-preference/index.ts`, lines 35-99. Existing `init_point` URLs remain provider-hosted until preference expiry; the worker intentionally does not check the kill switch so it can reconcile money already moved.  
ATTACK/FAILURE PATH: An authorized checkout passes the DB gate, then an operator disables payments while the Edge Function is between preparation and provider POST; or a shopper already holds a valid `init_point`. That preference may still be created/paid after the switch.  
IMPACT: `enabled=false` stops new TABA checkout/preference preparations without cache delay, but is not an instantaneous revocation of in-flight or already issued Mercado Pago preferences.  
MITIGATION: Document the bounded semantics; during a payment incident combine the DB switch with seller disconnect/provider-side invalidation as appropriate and reconcile all outstanding intents. Consider a short-lived activation generation checked immediately before provider creation, understanding that an external-call race cannot be made strictly atomic.  
FIX_STATUS: OPEN — documentation/operational hardening; no production change made.  
VERIFICATION: Controlled test environment with a paused provider call, flip `enabled=false`, then prove new preparations fail while the already-prepared/existing preference remains independently payable until expiry.

## CDEX-004

ID: CDEX-004  
SEVERITY: HIGH  
AREA: Payment gate / legacy credential shadow path  
EVIDENCE: Deployed `oauthMode()` returns true only for the exact string `oauth`; every absent, misspelled or `legacy` value returns false (`supabase/functions/_shared/seller-oauth.ts`, original lines 9-10). `mercadoPagoRequest()` then reads global `MERCADOPAGO_ACCESS_TOKEN` instead of calling `sellerAccessToken(businessId)` (`supabase/functions/_shared/mercadopago.ts`, lines 120-134). There was no project-level prohibition on that branch for staging or production.  
ATTACK/FAILURE PATH: Production receives a missing/mistyped `MERCADOPAGO_CREDENTIAL_MODE`, while DB settings are later deliberately enabled. `prepare_mercadopago_preference` passes, and the provider request uses the global token without requiring a connected seller, current seller token, or seller-business token binding.  
IMPACT: A direct Edge request can create a preference without `mp_seller_connections.status='connected'`; funds may route through an unintended global credential and reconciliation can fall into collector mismatch after money moved. This directly violates the required seller gate.  
MITIGATION: For the two known hosted project refs, make OAuth credential mode mandatory and fail closed for every other value. Retain legacy mode only for unknown/local fixture projects if still needed for tests/migration.  
FIX_STATUS: PATCHED LOCALLY on `audit/codex-production-hardening`; no deployment or merge.  
VERIFICATION: Regression test must reject missing, misspelled and `legacy` modes for both known refs, while accepting exact `oauth` and preserving isolated fixtures.

## CDEX-005

ID: CDEX-005  
SEVERITY: MEDIUM  
AREA: Release authority / reproducibility  
EVIDENCE: Local/deployed web SHA is `899caaf849c1db8672e83b5cd9e31b0d4e141199`; both `/version.json` endpoints report `899caaf`, and sampled critical web assets are byte-identical. However `origin/feature/taba-mercadopago-oauth` stops at `11aa86e`; local is ahead by `34f055f` and `899caaf`, and no remote branch contains `899caaf`.  
ATTACK/FAILURE PATH: The production deployment cannot be reconstructed from the expected remote branch if the local worktree/objects are lost, and normal review/rollback tooling sees a different release authority than the code actually serving.  
IMPACT: Change-control and rollback provenance are broken even though the current served bytes match the local RC.  
MITIGATION: After human approval, push the two non-destructive commits to the expected remote branch (no force push), then re-check branch containment and deployment identity.  
FIX_STATUS: OPEN — no push performed during the frozen audit.  
VERIFICATION: `git branch -r --contains 899caaf` must include the expected remote branch and the remote SHA must equal the release SHA.

## CDEX-006

ID: CDEX-006  
SEVERITY: LOW  
AREA: Supabase migration drift  
EVIDENCE: Local and staging contain 121 migrations; production contains 120. Production is missing `20260826120000_alcohol_policy_readable`, although all three reach latest version `20260905195357`. The missing migration only expands the owner/admin/staff read DTO for alcohol policy. Production currently has `alcohol_sales_enabled=false` and zero available alcoholic products.  
ATTACK/FAILURE PATH: Operators cannot read back the complete alcohol policy from the panel when that feature is eventually configured.  
IMPACT: Operational visibility drift, currently mitigated because alcohol sale is disabled and no alcoholic SKU is purchasable. No payment gate or seller-binding code differs.  
MITIGATION: Schedule the missing migration only after the production freeze is lifted and normal migration approval is obtained.  
FIX_STATUS: OPEN — production migration explicitly prohibited in this audit.  
VERIFICATION: Production migration ledger count/version set must equal local, and `get_business_operations_config` must expose the five sanitized alcohol policy fields only to authorized business roles.

## CDEX-007

ID: CDEX-007  
SEVERITY: LOW  
AREA: Webhook availability / acknowledgement latency  
EVIDENCE: In OAuth mode the webhook validates HMAC, then performs seller lookup and a provider `GET /v1/payments/{id}` before persisting and returning HTTP 201 (`supabase/functions/mercadopago-webhook/index.ts`, lines 82-126). Provider fetch timeout is 12 seconds. The official sample exposes a 22-second sender socket timeout, so this is within the observed budget but not an immediate acknowledgement.  
ATTACK/FAILURE PATH: Provider/API or DB latency delays acknowledgement and causes Mercado Pago retries; duplicate work is suppressed by durable receipt/outbox keys.  
IMPACT: Retry amplification and delayed processing, not fake approval: every queued payment was read back with the seller token and is re-read by the worker.  
MITIGATION: Consider durably storing the signed unbound receipt first and moving tenant/provider resolution to the worker, preserving all current seller/payment assertions.  
FIX_STATUS: OPEN — architecture hardening, non-blocking relative to the HIGH findings.  
VERIFICATION: Load/latency test below provider timeout; verify duplicate deliveries create one outbox job and one order.

## CDEX-008

ID: CDEX-008  
SEVERITY: LOW  
AREA: OAuth state retention  
EVIDENCE: Production contains one expired `mp_oauth_states` row (expired `2026-09-08 04:12:37 UTC`) whose generation still matches a disconnected connection. Consumption correctly rejects it. Expired rows are deleted only by a later `mp_begin_oauth`; there is no independent cleanup. The protected verifier also contains the originating bearer token encrypted at rest.  
ATTACK/FAILURE PATH: If no later OAuth attempt occurs, expired encrypted session material remains indefinitely; it cannot be replayed through `mp_consume_oauth` because expiry is enforced.  
IMPACT: Excess retention raises the consequence of a future encryption-key compromise but is not a live replay path.  
MITIGATION: Add periodic deletion of expired OAuth states or delete the consumed/denied state lifecycle residue independently, without logging protected material.  
FIX_STATUS: OPEN.  
VERIFICATION: Expired rows disappear within a documented retention window and replay remains rejected.

## CDEX-009

ID: CDEX-009  
SEVERITY: LOW  
AREA: Mercado Pago quality / conversion metadata  
EVIDENCE: Official `quality_checklist` for App ID `7677852968049976` lists `statement_descriptor`, payer email/last name and other optimization fields. `preferenceRequest()` sends authoritative items, back URLs, notification URL, external reference, expiry and payment restrictions, but no `statement_descriptor` or `payer` object (`supabase/functions/_shared/mercadopago.ts`, lines 60-117).  
ATTACK/FAILURE PATH: Payments lack optional fraud/conversion context and recognizable card statement text.  
IMPACT: Potentially higher rejection/chargeback friction; no authorization bypass or amount manipulation.  
MITIGATION: Add only server-derived, privacy-reviewed payer/descriptor data and corresponding tests after launch blockers are fixed.  
FIX_STATUS: OPEN.  
VERIFICATION: Official checklist rerun plus request-construction tests.

## CDEX-010

ID: CDEX-010  
SEVERITY: LOW  
AREA: Supabase SECURITY DEFINER surface  
EVIDENCE: Eight SECURITY DEFINER functions are executable by `anon`. Seven are bounded read helpers; `check_scheduler_watchdog(text)` writes/resolves `operational_alerts` for all businesses and accepts an unauthenticated caller-provided source label. Its health conclusion comes from server state and writes are throttled/idempotent, limiting impact.  
ATTACK/FAILURE PATH: Any holder of the public key can invoke external watchdog evaluation and influence audit timing/source metadata, although cannot falsify the underlying heartbeat health.  
IMPACT: Operational audit/alert integrity noise, no direct payment or identity access.  
MITIGATION: Authenticate watchdog calls with a short-lived HMAC or private Edge endpoint and revoke anonymous execute.  
FIX_STATUS: OPEN.  
VERIFICATION: Anonymous RPC returns permission denied; signed watchdog still opens/resolves exactly one truthful alert.

## CDEX-011

ID: CDEX-011  
SEVERITY: INFO  
AREA: PWA cache labeling  
EVIDENCE: The identical production/staging shell loads and precaches `runtime-config.js?tenant=walter-staging` (`index.html:1250`, `sw.js:24`). Same-origin isolation means production receives the production file, and live inspection confirmed the production ref/business. The query label is nevertheless stale and the service worker programmatically caches a response also marked `Cache-Control: no-store`.  
ATTACK/FAILURE PATH: A same-origin runtime-only cutover without cache identity rotation could temporarily use a stale public backend config during a static-origin outage.  
IMPACT: No current crossover and no secret exposure; confusing cache provenance.  
MITIGATION: Use an environment-neutral version key and explicitly define whether runtime config is network-only or version-bound to `CACHE_NAME`.  
FIX_STATUS: OPEN.  
VERIFICATION: Offline/update test confirms the intended config and no staging ref can be served on the production origin.

## CDEX-012

ID: CDEX-012  
SEVERITY: INFO  
AREA: Test environment  
EVIDENCE: `npm test` initially produced 2407/2410 because `E:\DevCache\Temp` was full. Final rerun with a healthy external TEMP passed 2410/2410. The local Docker stack was then started ephemerally and the integrated PostgreSQL/migration/pgTAP/dump-restore drill passed. No production mutation occurred.  
ATTACK/FAILURE PATH: Environmental, not a product attack path.  
IMPACT: Environmental only. Full E2E was 543/544 under concurrent load and its only failed scroll assertion passed 1/1 in isolation.  
MITIGATION: Keep CI temp/storage capacity monitored and treat the scroll test as flaky until its timing/threshold is stabilized.  
FIX_STATUS: VERIFIED for unit/DB suites; one E2E flake remains informational.  
VERIFICATION: Integrated local DB/restore drill exited zero and reported all pgTAP suites passed.

## CDEX-013

ID: CDEX-013  
SEVERITY: MEDIUM  
AREA: Production web / browser containment  
EVIDENCE: Live `https://la-taba.pages.dev/` sends `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy` and COOP, but no `Content-Security-Policy`. `_headers:3-6` documents that CSP was deliberately omitted.  
ATTACK/FAILURE PATH: A future DOM injection or compromised same-origin asset has no CSP boundary limiting script execution/network destinations in an authenticated business-panel browser.  
IMPACT: Defense-in-depth gap for Auth sessions and operational actions. No exploitable injection was identified in this audit, and payment secrets never enter the browser.  
MITIGATION: Derive a report-only policy from actual runtime dependencies, remove violations, then enforce a nonce/hash-based CSP with narrow `connect-src` for the environment.  
FIX_STATUS: OPEN.  
VERIFICATION: Browser E2E under enforced CSP with zero violations and unchanged MapLibre/Supabase/Auth/payment flows.
