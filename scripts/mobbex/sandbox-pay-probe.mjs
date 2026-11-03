#!/usr/bin/env node
/**
 * Human-in-the-loop sandbox payment probe. Moves no money: `test: true` + an official Mobbex test card.
 *
 * Why a person and not a browser robot: Mobbex's hosted checkout is protected by a Cloudflare challenge
 * (Turnstile). Automating around an anti-bot control is not something this repository does; one human payment
 * with a test card is enough to record what the operation lookup answers for an APPROVED / DENIED / PENDING payment.
 *
 *   MOBBEX_API_KEY=... MOBBEX_ACCESS_TOKEN=... node scripts/mobbex/sandbox-pay-probe.mjs
 *
 *   1. The script creates a sandbox checkout and prints its URL (the only thing printed besides shapes).
 *   2. Open it, pay with an official test card (https://mobbex.dev/medios-de-pago-para-pruebas):
 *        Visa credit 4507983190082450, expiry 12/34, holder "Demo", document 12123123,
 *        CVV 200 = approved, 400 = denied, 002 = pending.
 *   3. The script polls GET /p/operations/{reference} for up to 5 minutes and prints the SHAPE of the answer
 *      (keys and types) plus the status code, total and reference match. Paste that into the PR evidence.
 *
 * Credentials come from the environment and are never printed.
 */
import { randomUUID } from 'node:crypto';

const apiKey = (process.env.MOBBEX_API_KEY || '').trim();
const accessToken = (process.env.MOBBEX_ACCESS_TOKEN || '').trim();
if (!apiKey || !accessToken) { console.error('MOBBEX_API_KEY and MOBBEX_ACCESS_TOKEN are required (sandbox only).'); process.exit(2); }
const headers = { 'x-api-key': apiKey, 'x-access-token': accessToken, 'content-type': 'application/json' };
const reference = `taba2-mbx-${randomUUID()}`;

const created = await (await fetch('https://api.mobbex.com/p/checkout', {
  method: 'POST', headers,
  body: JSON.stringify({ total: 150, currency: 'ARS', description: 'TABA sandbox payment probe', reference, test: true, timeout: 15,
    return_url: 'https://example.com/pago/resultado', webhook: `https://example.com/mobbex-webhook?ref=${reference}`,
    customer: { email: 'probe@example.com', name: 'Probe Sintetico' } }),
})).json();
if (created.result !== true) { console.error('checkout was not created'); process.exit(1); }
console.log(`Pay here with a TEST card (CVV 200 approves): ${created.data.url}`);
console.log(`reference: ${reference}`);

function shape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length ? [shape(value[0], depth + 1), `(x${value.length})`] : [];
  if (typeof value === 'object') return depth >= 6 ? '{…}' : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v, depth + 1)]));
  return typeof value;
}

const deadline = Date.now() + 5 * 60_000;
while (Date.now() < deadline) {
  const response = await fetch(`https://api.mobbex.com/p/operations/${encodeURIComponent(reference)}`, { headers });
  const json = await response.json().catch(() => null);
  if (json?.result === true) {
    console.log(JSON.stringify(shape(json), null, 1));
    const payment = json?.data?.transaction?.payment ?? json?.data?.payment ?? {};
    console.log(JSON.stringify({
      status_code: payment?.status?.code, status_text: payment?.status?.text, total: payment?.total,
      reference_matches: payment?.reference === reference, id_type: typeof payment?.id,
      transactions_count: Array.isArray(json?.data?.transactions) ? json.data.transactions.length : null,
    }));
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
console.log('No operation appeared within 5 minutes (nobody paid, or the lookup answers result:false until the payment settles).');
