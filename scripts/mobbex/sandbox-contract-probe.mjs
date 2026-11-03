#!/usr/bin/env node
/**
 * Contract probe against the Mobbex SANDBOX. Moves no money.
 *
 * It exists so the integration is checked against what Mobbex really answers and
 * not against what the documentation (which contradicts itself in places) says:
 *
 *   1. POST /p/checkout with `test: true` and a synthetic customer.
 *   2. GET  /p/operations/{reference} for a reference nobody has paid.
 *   3. GET  /p/operations/{reference} with a reference that was never created.
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

await call('operation by reference, created but unpaid', 'GET', `/p/operations/${encodeURIComponent(reference)}`);
await call('operation by reference, never created', 'GET', `/p/operations/${encodeURIComponent(`taba2-mbx-${randomUUID()}`)}`);
const wrong = await fetch(`${base}/p/operations/${encodeURIComponent(reference)}`, {
  headers: { 'x-api-key': 'invalid-probe-key', 'x-access-token': 'invalid-probe-token', 'content-type': 'application/json' },
  signal: AbortSignal.timeout(20_000),
});
console.log(JSON.stringify({ label: 'invalid credentials', http: wrong.status }));
