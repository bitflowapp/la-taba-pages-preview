#!/usr/bin/env node
/**
 * Contract probe against the Mobbex SANDBOX. Moves no money.
 *
 * It exists so the integration is checked against what Mobbex really answers and
 * not against what the documentation (which contradicts itself in places) says:
 *
 *   1. POST /p/checkout with `test: true` and a synthetic customer.
 *   2. GET  /p/operations/REF:{reference} for a reference nobody has paid (expected result:false, code NDFE).
 *   3. GET  /p/operations/REF:{reference} with a reference that was never created.
 *   4. The plain form /p/operations/{reference} (expected GENERIC:EFCS: it is NOT a "no operation" answer).
 *   5. GET  /p/entity/operations?test=true&reference=... (test operations are listed only with test=true).
 *   6. If the account already holds a test operation: it must be found by REF:{its reference} and NOT by the plain form.
 *
 * Only SYNTHETIC data is sent (no real person, no real address, no real amount).
 * Credentials come from the environment and are never printed:
 *
 *   MOBBEX_API_KEY=...  MOBBEX_ACCESS_TOKEN=...  node scripts/mobbex/sandbox-contract-probe.mjs
 *
 * Mobbex publishes shared demo credentials in https://mobbex.dev/primeros-pasos;
 * their operations land in a shared DEMO account. To probe with Walter's own
 * account use the same variables with his sandbox credentials (see
 * docs/mobbex/ONBOARDING-WALTER.md); never put credentials in a file.
 *
 * Output is a shape report (keys and types, no values except status codes), safe to paste into a PR.
 */
import { randomUUID } from 'node:crypto';

const apiKey = (process.env.MOBBEX_API_KEY || '').trim();
const accessToken = (process.env.MOBBEX_ACCESS_TOKEN || '').trim();
if (!apiKey || !accessToken) {
  console.error('MOBBEX_API_KEY and MOBBEX_ACCESS_TOKEN are required (sandbox credentials only).');
  process.exit(2);
}
const base = 'https://api.mobbex.com';
const headers = { 'x-api-key': apiKey, 'x-access-token': accessToken, 'content-type': 'application/json' };

function shape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length ? [shape(value[0], depth + 1), `(x${value.length})`] : [];
  if (typeof value === 'object') {
    if (depth >= 5) return '{…}';
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, depth + 1)]));
  }
  return typeof value;
}

async function call(label, method, path, body) {
  const started = Date.now();
  const response = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep null */ }
  console.log(JSON.stringify({ label, method, path: path.replace(/taba2-mbx-[0-9a-f-]{36}/, 'taba2-mbx-<uuid>'), http: response.status, ms: Date.now() - started, shape: json ? shape(json) : `non-json(${text.length} bytes)` }, null, 1));
  return { status: response.status, json };
}

const reference = `taba2-mbx-${randomUUID()}`;
const created = await call('create checkout (test mode)', 'POST', '/p/checkout', {
  total: 150.0,
  currency: 'ARS',
  description: 'TABA sandbox contract probe',
  reference,
  test: true,
  timeout: 15,
  return_url: 'https://example.com/pago/resultado',
  webhook: `https://example.com/functions/v1/mobbex-webhook?ref=${reference}&t=probe`,
  customer: { email: 'probe@example.com', name: 'Probe Sintetico' },
  items: [{ description: 'Item sintetico', quantity: 1, total: 150.0 }],
});
console.log(JSON.stringify({ created_ok: created.status === 200 && created.json?.result === true, has_checkout_id: typeof created.json?.data?.id === 'string', has_url: typeof created.json?.data?.url === 'string' }));

const unpaid = await call('operation by REF:reference, created but unpaid', 'GET', `/p/operations/REF:${encodeURIComponent(reference)}`);
const never = await call('operation by REF:reference, never created', 'GET', `/p/operations/REF:${encodeURIComponent(`taba2-mbx-${randomUUID()}`)}`);
const plain = await call('operation by PLAIN reference (wrong form)', 'GET', `/p/operations/${encodeURIComponent(reference)}`);
const listed = await call('entity operations, test=true, by reference', 'GET', `/p/entity/operations?page=0&limit=5&test=true&reference=${encodeURIComponent(reference)}`);
console.log(JSON.stringify({ unpaid_code: unpaid.json?.code ?? null, never_code: never.json?.code ?? null, plain_code: plain.json?.code ?? null,
  listed_for_unpaid: Array.isArray(listed.json?.data?.docs) ? listed.json.data.docs.length : null }));
const recent = await fetch(`${base}/p/entity/operations?page=0&limit=20&test=true`, { headers, signal: AbortSignal.timeout(20_000) }).then((r) => r.json()).catch(() => null);
const sample = (recent?.data?.docs ?? []).find((doc) => typeof doc?.reference === 'string' && /^[A-Za-z0-9_-]{4,120}$/.test(doc.reference));
if (sample) {
  // Only booleans and status codes are printed: the sample may belong to someone else in a shared DEMO account.
  const byRef = await fetch(`${base}/p/operations/REF:${encodeURIComponent(sample.reference)}`, { headers, signal: AbortSignal.timeout(20_000) }).then((r) => r.json()).catch(() => null);
  const byPlain = await fetch(`${base}/p/operations/${encodeURIComponent(sample.reference)}`, { headers, signal: AbortSignal.timeout(20_000) }).then((r) => r.json()).catch(() => null);
  const payment = byRef?.data?.transaction?.payment;
  console.log(JSON.stringify({ existing_test_operation: true, found_by_REF: byRef?.result === true && payment?.reference === sample.reference,
    found_by_plain: byPlain?.result === true, plain_code: byPlain?.code ?? null, status_code: payment?.status?.code ?? null,
    currency_code: payment?.currency?.code ?? null, has_boolean_test: [payment?.test, byRef?.data?.transaction?.test, byRef?.data?.test].some((v) => v !== undefined),
    transactions_len: Array.isArray(byRef?.data?.transactions) ? byRef.data.transactions.length : null }));
} else {
  console.log(JSON.stringify({ existing_test_operation: false }));
}
const wrong = await fetch(`${base}/p/operations/REF:${encodeURIComponent(reference)}`, {
  headers: { 'x-api-key': 'invalid-probe-key', 'x-access-token': 'invalid-probe-token', 'content-type': 'application/json' },
  signal: AbortSignal.timeout(20_000),
});
console.log(JSON.stringify({ label: 'invalid credentials', http: wrong.status }));
