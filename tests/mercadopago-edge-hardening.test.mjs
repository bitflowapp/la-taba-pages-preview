import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Invariantes de texto del endurecimiento de las Edge Functions de Mercado Pago.
// El comportamiento lo prueban las suites de Deno (`npm run test:webhook`), con
// los handlers reales; esto es la red para que un refactor no saque de su lugar
// lo que esas suites dan por sentado.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const shared = (name) => read('supabase/functions/_shared', name);
const handler = (name) => read('supabase/functions', name, 'index.ts');

test('the production payment switch is the real-money switch, exact, and has one definition of the creation gate', () => {
  const runtime = shared('payment-runtime.ts');
  const oauth = shared('seller-oauth.ts');
  const gateModule = shared('real-money-gate.ts');
  // EDGE-03 (owner's decision): production charges open only with the backend
  // secret MERCADOPAGO_REAL_MONEY_ENABLED holding exactly `enabled`. The value
  // is compared raw: no trim, no case folding, no default.
  assert.match(gateModule, /export const REAL_MONEY_SWITCH = 'MERCADOPAGO_REAL_MONEY_ENABLED';/);
  assert.match(gateModule, /export const REAL_MONEY_SWITCH_OPEN_VALUE = 'enabled';/);
  assert.match(gateModule, /const real_money_switch = input\.realMoneySwitch === REAL_MONEY_SWITCH_OPEN_VALUE;/);
  assert.match(gateModule, /const creation_allowed = environment === 'test'\s*\|\| \(environment === 'production' && review_approved && real_money_switch\);/);
  assert.match(runtime, /realMoneySwitch: Deno\.env\.get\(REAL_MONEY_SWITCH\),/);
  assert.doesNotMatch(runtime, /optionalEnv\(REAL_MONEY_SWITCH\)|getRequiredEnv\(REAL_MONEY_SWITCH\)/);
  // The project review is still required, exactly as before.
  assert.match(runtime, /value === 'production' && optionalEnv\('MERCADOPAGO_PRODUCTION_REVIEW_STATUS'\) !== 'approved'/);
  // The legacy smoke variable opens nothing any more: no runtime code reads it
  // and the old phrase is gone from the runtime.
  for (const file of ['payment-runtime.ts', 'seller-oauth.ts', 'mercadopago.ts']) {
    assert.doesNotMatch(shared(file), /MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION|I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE|requireRealPaymentSmokeAuthorization/, file);
  }
  const gate = oauth.slice(oauth.indexOf('export function assertPaymentCreationGate()'), oauth.indexOf('export async function beginSellerPaymentAuthority'));
  for (const check of ['providerEnvironment()', 'oauthMode()', 'oauthConfig()', 'requireRealMoneyGate(environment)']) {
    assert.ok(gate.includes(check), `creation gate lost ${check}`);
  }
  // The preference path evaluates it three times (begin, re-check, final check)
  // and never re-implements a looser copy.
  assert.equal((oauth.match(/assertPaymentCreationGate\(\)/g) || []).length, 4);
  assert.equal((oauth.match(/requireRealMoneyGate\(/g) || []).length, 1);
  // Business and seller are judged by the same predicates as the pure state.
  assert.match(oauth, /!businessPaymentsEnabled\(settings, businessId, environment\)/);
  assert.match(oauth, /!sellerConnected\(seller, settings, businessId, environment, applicationId, Date\.now\(\)\)/);
});

test('every path that can create a preference passes through the creation gate first', () => {
  const provider = shared('mercadopago.ts');
  // The only POST that creates a charge, and the gate right before it.
  assert.equal((provider.match(/mercadoPagoRequest\('\/checkout\/preferences',/g) || []).length, 1);
  const create = provider.slice(provider.indexOf('export async function createPreference'), provider.indexOf('export async function fetchPayment'));
  const gate = create.indexOf('assertPaymentCreationGate();');
  const post = create.indexOf("mercadoPagoRequest('/checkout/preferences',");
  assert.ok(gate > 0 && post > gate, 'createPreference must evaluate the gate before its POST');
  assert.match(create, /throw new PublicPaymentError\(409, 'PAYMENTS_NOT_ENABLED'/);
  // The request builder carries the same switch check of its own.
  const builder = provider.slice(provider.indexOf('export function assertPreparationEnvironment'), provider.indexOf('export function preferenceRequest'));
  assert.match(builder, /requireRealMoneyGate\(environment\);/);
  // Only create-preference calls createPreference, and it evaluates the gate
  // before preparing the attempt (which can re-reserve stock with new_attempt).
  const handlers = fs.readdirSync(path.join(root, 'supabase/functions'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_')).map((entry) => entry.name);
  assert.deepEqual(handlers.filter((name) => /createPreference\(/.test(handler(name))), ['mercadopago-create-preference']);
  const preference = handler('mercadopago-create-preference');
  const early = preference.indexOf('assertPaymentCreationGate();');
  const prepare = preference.indexOf("service.rpc('prepare_mercadopago_preference_v2'");
  assert.ok(early > 0 && prepare > early, 'the gate must run before prepare_mercadopago_preference_v2');
  assert.match(preference.slice(early, prepare), /code: 'PAYMENTS_NOT_ENABLED'/);
  // Nobody else talks to the preferences resource.
  for (const name of handlers.filter((slug) => slug !== 'mercadopago-create-preference')) {
    assert.doesNotMatch(handler(name), /checkout\/preferences/, name);
  }
});

test('money going back never consults the real-money switch', () => {
  for (const name of ['mercadopago-refund', 'mercadopago-cancel-payment', 'mercadopago-webhook', 'mercadopago-payment-worker',
    'mercadopago-checkout-status', 'mercadopago-connect', 'mercadopago-oauth-callback']) {
    assert.doesNotMatch(handler(name), /assertPaymentCreationGate|requireRealMoneyGate|readRealMoneyGateState|MERCADOPAGO_REAL_MONEY_ENABLED|REAL_MONEY_SWITCH/, name);
  }
  // The shared provider call used by refunds, cancellations, the worker and
  // the status screen checks the project review, not the switch.
  const provider = shared('mercadopago.ts');
  const request = provider.slice(provider.indexOf('export async function mercadoPagoRequest'), provider.indexOf('export async function createPreference'));
  assert.doesNotMatch(request, /requireRealMoneyGate|assertPaymentCreationGate/);
  assert.match(request, /providerEnvironment\(\);/);
});

test('create-checkout-session evaluates that same gate before the RPC that reserves stock', () => {
  const source = handler('mercadopago-create-checkout-session');
  const gate = source.indexOf('assertPaymentCreationGate()');
  const reserve = source.indexOf("service.rpc('create_checkout_session'");
  assert.ok(gate > 0 && reserve > gate, 'the gate must run before create_checkout_session');
  assert.match(source, /import \{ assertPaymentCreationGate \} from '\.\.\/_shared\/seller-oauth\.ts'/);
  assert.match(source, /code: 'PAYMENTS_NOT_ENABLED'/);
  // A database refusal is translated by the closed code table, never forwarded.
  assert.match(source, /checkoutRefusal\(error \|\| data\)/);
  assert.doesNotMatch(source.slice(reserve), /\.message\b|\.details\b|\.hint\b/);
  const refusals = shared('checkout-refusal.ts');
  for (const code of ['BUSINESS_CLOSED', 'ALCOHOL_WINDOW_CLOSED', 'OUT_OF_DELIVERY_ZONE', 'DELIVERY_LOCATION_REQUIRED',
    'BELOW_MINIMUM', 'OUT_OF_STOCK', 'ORDER_TOO_LARGE', 'RATE_LIMITED', 'IDEMPOTENCY_CONFLICT', 'CHECKOUT_NOT_AVAILABLE']) {
    assert.ok(refusals.includes(`code: '${code}'`), `missing public refusal ${code}`);
  }
});

test('a failed merchant-order read can never become a snapshot with an empty preference', () => {
  const provider = shared('mercadopago.ts');
  const merchantOrder = provider.slice(provider.indexOf('export async function fetchMerchantOrder'), provider.indexOf('export async function fetchChargeback'));
  assert.match(merchantOrder, /throw new MercadoPagoApiError/);
  assert.doesNotMatch(merchantOrder, /return null/);
  const snapshot = provider.slice(provider.indexOf('export async function paymentSnapshot'), provider.indexOf('export async function disputeSnapshot'));
  assert.match(snapshot, /if \(!preferenceId\) throw new Error/);
  // The customer status poll swallows that failure together with the search.
  const status = handler('mercadopago-checkout-status');
  const guarded = status.slice(status.indexOf('try {', status.indexOf('async function reconcile')), status.indexOf("service.rpc('record_mercadopago_payment_snapshot'"));
  assert.match(guarded, /findPaymentByExternalReference\(/);
  assert.match(guarded, /paymentSnapshot\(/);
});

test('the worker follows the database contracts of 20261001200000 and 20261001204000', () => {
  const worker = handler('mercadopago-payment-worker');
  // A rejected or cancelled pinned payment is looked up again by external reference.
  assert.match(worker, /\.select\('provider_payment_id, provider_status, external_reference'\)/);
  assert.match(worker, /\['rejected', 'cancelled', 'canceled'\]/);
  assert.match(worker, /findPaymentByExternalReference\(externalReference, job\.business_id\)/);
  // Every snapshot goes through the one helper that honours finalize_required.
  assert.equal((worker.match(/service\.rpc\('record_mercadopago_payment_snapshot'/g) || []).length, 1);
  assert.equal((worker.match(/await recordVerifiedPayment\(/g) || []).length, 3);
  // Only the exact dispute refusal is terminal, and only when the intent has a
  // pinned payment that is a different one: the database raises the same text
  // when nothing is pinned, and that dispute is on the only payment there is.
  assert.match(worker, /refusal\.code === '22023' && refusal\.message === 'disputa no coincide con el pago'/);
  const dispute = worker.slice(worker.indexOf('if (disputeIsNotOnPinnedPayment(persistedDispute.error))'), worker.indexOf("if (job.topic === 'refund_reconcile')"));
  assert.match(dispute, /\.select\('provider_payment_id'\)/);
  assert.match(dispute, /if \(pinnedPaymentId && pinnedPaymentId !== paymentId\) \{[\s\S]*?return;\s*\}\s*throw new Error\(/);
  // A run claims small batches, each with its own lease, while there is time.
  assert.match(worker, /p_limit: CLAIM_BATCH_SIZE,\s*p_lease_seconds: CLAIM_LEASE_SECONDS/);
  assert.match(worker, /const CLAIM_BATCH_SIZE = 5;/);
  assert.match(worker, /const CLAIM_LEASE_SECONDS = 150;/);
  assert.equal((worker.match(/service\.rpc\('claim_payment_outbox_v2'/g) || []).length, 1);
  // A refund without identity is searched only on a person's request, against
  // the payment the request was sent to.
  assert.match(worker, /refund\.resolution_mode !== 'provider_lookup'/);
  assert.match(worker, /requestPaymentId !== String\(data\.provider_payment_id\)/);
  assert.match(worker, /locateRefundWithLostResponse\(/);
  const migration = read('supabase/migrations/20261001204000_stuck_refund_resolution_and_review_refund.sql');
  for (const column of ['resolution_mode', 'provider_payment_id', 'last_provider_attempt_at']) {
    assert.match(migration, new RegExp(`add column if not exists ${column}\\b`));
    assert.ok(worker.includes(column), `worker does not read payment_refunds.${column}`);
  }
});

test('preference creation separates a provider rejection, a provider doubt and a local error', () => {
  const preference = handler('mercadopago-create-preference');
  const built = preference.indexOf('const preferencePayload = preferenceRequest(preparation, businessId);');
  const attempt = preference.indexOf('created = await createPreference(preparation, businessId, authority.accessToken, preferencePayload);');
  assert.ok(built > 0 && attempt > built, 'the request is built before the provider attempt');
  assert.match(preference.slice(built, attempt), /\n    try \{\n/);
  assert.match(preference, /error instanceof MercadoPagoApiError && isFinalProviderRejection\(error\.status\)/);
  assert.doesNotMatch(preference, /error\.status >= 400 && error\.status < 500/);
});

test('the seller credential is only destroyed on an authoritative provider answer', () => {
  const provider = shared('mercadopago.ts');
  const oauth = shared('seller-oauth.ts');
  assert.match(provider, /invalidateTokenIfProviderRejectsIt\(init\.businessId, accessToken\)/);
  assert.doesNotMatch(provider, /invalidateRejectedToken\(/);
  const confirm = oauth.slice(oauth.indexOf('export async function invalidateTokenIfProviderRejectsIt'), oauth.indexOf('export async function invalidateRejectedToken'));
  assert.match(confirm, /https:\/\/api\.mercadopago\.com\/users\/me/);
  assert.match(confirm, /if \(status !== 401\) return false;/);
  // In the refresh, tokens are wiped in exactly one place, behind `revoked`.
  const refresh = oauth.slice(oauth.indexOf('export async function sellerAccessToken'), oauth.indexOf('class RefreshedSellerMismatchError'));
  assert.equal((refresh.match(/protected_tokens: null/g) || []).length, 1);
  assert.match(refresh, /if \(revoked\) \{[\s\S]*protected_tokens: null/);
  assert.match(refresh, /error instanceof OAuthProviderError && error\.invalidGrant/);
});

test('refund amounts are validated in integer cents and answered as a bad request', () => {
  const refund = handler('mercadopago-refund');
  assert.match(refund, /refundAmountCents\(value\)/);
  assert.match(refund, /new PublicPaymentError\(400, 'INVALID_REQUEST'/);
  assert.doesNotMatch(refund, /Math\.round\(amount \* 100\) !== amount \* 100/);
  // An authorised retry looks at the provider's refund list before any POST.
  const retry = refund.indexOf('prepared.provider_retry === true');
  const list = refund.indexOf('fetchRefundList(', retry);
  const post = refund.indexOf("method: 'POST'", retry);
  assert.ok(retry > 0 && list > retry && post > list, 'the refund list is read before the retry is sent');
});

test('a refund list row that cannot be read never reads as "the provider has no such refund"', () => {
  const correlation = shared('refund-correlation.ts');
  const locate = correlation.slice(correlation.indexOf('export function locateRefundWithLostResponse'), correlation.indexOf('// 10.000.000,00'));
  assert.match(locate, /if \(unreadable\) return \{ kind: 'ambiguous' \};/);
  // ...and the retry path only sends when the answer is exactly "none".
  const refund = handler('mercadopago-refund');
  assert.match(refund, /if \(earlier\.kind !== 'none'\) \{\s*await markAmbiguous\(service, prepared\.refund_id, requestHash, 'refund_retry_precheck_ambiguous'\);\s*return reconciling\(request\);/);
});

test('rejected webhook receipts are bounded per address and overall, above the health threshold', () => {
  const webhook = handler('mercadopago-webhook');
  const perAddress = Number(/const REJECTED_RECEIPTS_PER_ADDRESS = (\d+);/.exec(webhook)?.[1]);
  const overall = Number(/const REJECTED_RECEIPTS_ALL_ADDRESSES = (\d+);/.exec(webhook)?.[1]);
  assert.equal(Number(/const REJECTED_RECEIPT_WINDOW_SECONDS = (\d+);/.exec(webhook)?.[1]), 3600);
  // `get_ecommerce_health` degrades webhook_processing at this many rejected
  // receipts in an hour with no valid one. The provider retries a notification
  // without creating a new row, so a per-address cap AT the threshold could hide
  // a broken secret: it has to leave room for the retries.
  const health = read('supabase/migrations/20261001221000_ecommerce_health.sql');
  const threshold = Number(/'rejected_signature_last_hour'\)::bigint >= (\d+)/.exec(health)?.[1]);
  assert.ok(threshold >= 1, 'the health threshold could not be read');
  assert.ok(perAddress >= 3 * threshold, `per-address cap ${perAddress} leaves no room over the health threshold ${threshold}`);
  assert.ok(overall > perAddress && overall <= 1000, `overall cap ${overall}`);
  // The shared bucket is spent first: once it is empty a new address writes nothing.
  const record = webhook.slice(webhook.indexOf('async function recordRejectedNotification'), webhook.indexOf('async function persistReceipt'));
  const shared_ = record.indexOf('REJECTED_RECEIPTS_ALL_ADDRESSES');
  const address = record.indexOf('REJECTED_RECEIPTS_PER_ADDRESS');
  const persist = record.indexOf('await persistReceipt(service, input)');
  assert.ok(shared_ > 0 && address > shared_ && persist > address, 'order: shared bucket, address bucket, receipt');
  // The signature is still decided before any of it.
  assert.ok(webhook.indexOf('validateMercadoPagoWebhookSignature({') < webhook.indexOf('await recordRejectedNotification('));
});

// ── What the lead registers in files this package may not edit ───────────────
// The migration adds `taba-payment-traces-purge` to the scheduler inventory.
// `scheduler_inventory_and_history_retention_test.sql` pins that inventory with a
// bag_eq, and `scripts/run-release-v5-db.mjs` runs it after every migration: a
// commit with the migration and without those two registrations turns the
// release database run red, and that run needs Docker to be seen.

const PURGE_MIGRATION = 'supabase/migrations/20261001230000_payment_request_traces_purge_and_rejected_webhook_scope.sql';
const PURGE_PGTAP = 'payment_request_traces_purge_test.sql';

function canonicalPgTap() {
  const runner = read('scripts/run-release-v5-db.mjs');
  return {
    files: /const canonicalTests=\[([\s\S]*?)\];/.exec(runner)[1].match(/'([^']+)'/g).map((name) => name.slice(1, -1)),
    asserted: Number(/assert\.equal\(assertions,(\d+)\)/.exec(runner)[1]),
    announced: /console\.log\('CANONICAL_PGTAP: ([^']*) assertions PASS'\)/.exec(runner)[1]
      .split(' + ').map((part) => Number(/^(\d+)/.exec(part)[1])),
  };
}

// `false` only when git answers "this path is not in the index". Without git, or
// outside a work tree (an exported tree, a CI tarball), the strict branch runs.
function notYetTrackedByGit(relative) {
  return spawnSync('git', ['ls-files', '--error-unmatch', '--', relative], { cwd: root, encoding: 'utf8' }).status === 1;
}

test('the canonical pgTAP total is the sum of the plans of its files, and so is its message', () => {
  const { files, asserted, announced } = canonicalPgTap();
  const planned = files.map((name) => {
    const plans = [...read('supabase/tests', name).matchAll(/select\s+(?:\*\s+from\s+)?plan\(\s*(\d+)\s*\)/gi)];
    assert.equal(plans.length, 1, `${name} must declare exactly one plan`);
    return Number(plans[0][1]);
  });
  assert.equal(planned.reduce((sum, value) => sum + value, 0), asserted, 'assert.equal(assertions, N) is not the sum of the plans');
  assert.equal(announced.reduce((sum, value) => sum + value, 0), asserted, 'the CANONICAL_PGTAP message does not add up to N');
});

test('every job a migration adds to the scheduler inventory is in the pgTAP that pins it, and the purge pgTAP is canonical', (t) => {
  const migrations = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).sort();
  const inventoried = new Set();
  for (const name of migrations) {
    const sql = read('supabase/migrations', name);
    for (const insert of sql.matchAll(/insert into private\.scheduler_expected_jobs \(job_name, purpose\)\s*values([\s\S]*?)on conflict/g)) {
      for (const job of insert[1].matchAll(/\(\s*'(taba-[a-z0-9-]+)'/g)) inventoried.add(job[1]);
    }
  }
  assert.ok(inventoried.has('taba-payment-traces-purge') && inventoried.size >= 9, 'the inventory inserts were not found');

  const inventoryTest = read('supabase/tests/scheduler_inventory_and_history_retention_test.sql');
  const bag = /select bag_eq\(\s*\$\$select job_name from private\.scheduler_expected_jobs\$\$,\s*\$\$values([\s\S]*?)\$\$/.exec(inventoryTest);
  assert.ok(bag, 'the bag_eq that pins the inventory was not found');
  const pinned = new Set([...bag[1].matchAll(/'(taba-[a-z0-9-]+)'/g)].map((match) => match[1]));
  const { files } = canonicalPgTap();

  const registered = pinned.has('taba-payment-traces-purge') && files.includes(PURGE_PGTAP);
  if (!registered && notYetTrackedByGit(PURGE_MIGRATION)) {
    // Working tree of the package, before the lead's commit: the two files are
    // outside what this package may edit. The moment the migration is staged or
    // committed this stops being a skip.
    t.skip('pending lead registration: add taba-payment-traces-purge to the bag_eq of scheduler_inventory_and_history_retention_test.sql and payment_request_traces_purge_test.sql to canonicalTests (+41) in scripts/run-release-v5-db.mjs, in the same commit as the migration');
    return;
  }
  assert.deepEqual([...pinned].sort(), [...inventoried].sort(),
    'scheduler_inventory_and_history_retention_test.sql must name exactly the jobs the migrations put in the inventory');
  assert.ok(files.includes(PURGE_PGTAP), `${PURGE_PGTAP} must be in canonicalTests of scripts/run-release-v5-db.mjs`);
  assert.ok(files.indexOf(PURGE_PGTAP) > files.indexOf('scheduler_inventory_and_history_retention_test.sql'),
    'the purge pgTAP runs after the suite that creates the inventory expectations');
});

test('the purge migration extends one scope, never deletes a valid receipt and schedules its job', () => {
  const migration = read('supabase/migrations/20261001230000_payment_request_traces_purge_and_rejected_webhook_scope.sql');
  const scopes = "('checkout_session', 'preference', 'checkout_status', 'webhook', 'webhook_rejected', 'refund', 'cancellation', 'worker')";
  // The table constraint and the function accept the same list.
  assert.equal(migration.split(scopes).length - 1, 2);
  const purge = migration.slice(migration.indexOf('create or replace function public.purge_payment_request_traces'), migration.indexOf('-- ── 3.'));
  assert.match(purge, /security definer\s+set search_path = pg_catalog, public, pg_temp/);
  assert.match(purge, /r\.processing_status = 'rejected_signature'\s+and r\.signature_valid is false/);
  assert.match(purge, /not exists \(select 1 from public\.payment_outbox o where o\.webhook_receipt_id = r\.id\)/);
  assert.match(purge, /not exists \(select 1 from public\.payment_events e where e\.webhook_receipt_id = r\.id\)/);
  assert.match(purge, /revoke all on function public\.purge_payment_request_traces\(integer\) from public, anon, authenticated;/);
  assert.match(purge, /grant execute on function public\.purge_payment_request_traces\(integer\) to service_role;/);
  assert.doesNotMatch(migration, /grant[^;]*\b(anon|authenticated)\b/i);
  assert.match(migration, /cron\.schedule\(\s*'taba-payment-traces-purge',\s*'23 4 \* \* \*',\s*'select public\.purge_payment_request_traces\(30\);'/);
  assert.match(migration, /if to_regclass\('private\.scheduler_expected_jobs'\) is not null then/);
  assert.ok(fs.existsSync(path.join(root, 'docs/migrations/rollback/20261001230000_payment_request_traces_purge_and_rejected_webhook_scope.rollback.sql')));
  assert.ok(fs.existsSync(path.join(root, 'supabase/tests/payment_request_traces_purge_test.sql')));
  // The Edge runtime and the database agree on the scope names.
  const runtime = shared('payment-runtime.ts');
  for (const scope of scopes.slice(1, -1).split(', ')) assert.ok(runtime.includes(scope), `runtime does not know scope ${scope}`);
});

test('the Deno suites that carry this hardening are the ones the runner executes', () => {
  const runner = read('scripts/run-mercadopago-webhook-tests.mjs');
  for (const [suite, wording] of [
    ['request-protocol.deno.ts', 'dirección del cliente: manda cf-connecting-ip'],
    ['refund-runtime.deno.ts', 'EDGE-01 worker'],
    ['refund-runtime.deno.ts', 'EDGE-02 worker'],
    ['refund-runtime.deno.ts', 'EDGE-09 worker'],
    ['refund-runtime.deno.ts', 'EDGE-11 reembolso'],
    ['refund-runtime.deno.ts', 'EDGE-13 worker'],
    ['refund-runtime.deno.ts', 'frena el reenvío'],
    ['refund-runtime.deno.ts', 'SIN pago fijado'],
    ['refund-correlation.deno.ts', 'no se da por inexistente'],
    ['seller-webhook-runtime.deno.ts', 'TODAS las direcciones juntas'],
    ['refund-correlation.deno.ts', 'entre 0.01 y 500.00'],
    ['checkout-session-availability.deno.ts', 'EDGE-03'],
    ['checkout-session-availability.deno.ts', 'CS-06'],
    ['checkout-session-availability.deno.ts', 'EDGE-05'],
    ['checkout-session-availability.deno.ts', 'EDGE-01 estado del checkout'],
    ['seller-webhook-runtime.deno.ts', 'EDGE-05 webhook'],
    ['seller-oauth-runtime.deno.ts', 'EDGE-08'],
    ['current-payment-authority.deno.ts', 'EDGE-06'],
  ]) {
    assert.ok(runner.includes(`supabase/functions/_shared/${suite}`), `${suite} is not in the runner`);
    assert.ok(shared(suite).includes(wording), `${suite} lost its "${wording}" tests`);
  }
});
