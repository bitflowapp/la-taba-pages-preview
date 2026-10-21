import fs from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { withRecoveryProject } from './hosted-client.mjs';

const value = name => process.argv[process.argv.indexOf(name) + 1];
if (!['--target', '--evidence', '--run-tests'].every(arg => process.argv.includes(arg))) {
  throw new Error('Requires --run-tests --target --evidence');
}
const target = JSON.parse(fs.readFileSync(value('--target'), 'utf8'));
const base = `https://${target.projectRef}.supabase.co`;
await withRecoveryProject(target, async ({ request, query }) => {
  const functions = await request('/functions');
  const checks = [];
  for (const fn of functions) {
    const callback = fn.slug === 'mercadopago-oauth-callback';
    const response = await fetch(`${base}/functions/v1/${fn.slug}`, {
      method: callback ? 'GET' : 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/json', origin: target.checkoutOrigin },
      body: callback ? undefined : '{}', signal: AbortSignal.timeout(30000),
    });
    const location = callback ? new URL(response.headers.get('location') || base) : null;
    const rejected = callback
      ? response.status === 303 && location.origin === target.checkoutOrigin && location.searchParams.get('mp_connection') === 'error'
      : response.status >= 400;
    checks.push({ name: fn.slug, active: fn.status === 'ACTIVE', version: fn.version,
      httpStatus: response.status, rejectedUnauthenticatedOrMalformedRequest: rejected });
  }
  // A signed probe is safe only before connecting any seller or queuing work.
  const [counts] = await query(`select (select count(*) from public.payment_outbox)::int jobs,
    (select count(*) from public.mp_seller_connections)::int connections`);
  if (counts.jobs !== 0 || counts.connections !== 0) throw new Error('Zero-work worker precondition not met');
  const credential = leerSecreto('RECOVERY PAYMENT WORKER SECRET');
  if (credential?.usuario !== target.projectRef) throw new Error('Worker credential project mismatch');
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomUUID();
  const signature = createHmac('sha256', credential.secreto)
    .update(`${timestamp}.${nonce}.POST./functions/v1/mercadopago-payment-worker`).digest('hex');
  const response = await fetch(`${base}/functions/v1/mercadopago-payment-worker`, {
    method: 'POST', body: '{}', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/json', 'x-taba-worker-timestamp': timestamp,
      'x-taba-worker-nonce': nonce, 'x-taba-worker-signature': signature },
  });
  const body = await response.json();
  const worker = { httpStatus: response.status, ok: body.ok, claimed: body.claimed,
    completed: body.completed, retried: body.retried };
  const passed = functions.length === 13 && checks.every(row => row.active && row.rejectedUnauthenticatedOrMalformedRequest)
    && response.status === 200 && body.ok === true && body.claimed === 0 && body.completed === 0 && body.retried === 0;
  const evidence = { at: new Date().toISOString(), projectRef: target.projectRef, checks, worker, passed,
    providerPaymentExecuted: false, webhookSignatureVerified: false };
  fs.writeFileSync(value('--evidence'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  if (!passed) process.exitCode = 1;
});
