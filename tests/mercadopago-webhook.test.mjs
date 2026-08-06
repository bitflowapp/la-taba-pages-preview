import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('Mercado Pago webhook uses the official SDK validator and literal data.id query field', () => {
  const signature = read('supabase/functions/_shared/mercadopago-webhook-signature.ts');
  const webhook = read('supabase/functions/mercadopago-webhook/index.ts');

  assert.match(signature, /WebhookSignatureValidator\.validate/);
  assert.match(signature, /xSignature: signature/);
  assert.match(signature, /xRequestId: requestId/);
  assert.match(signature, /dataId/);
  assert.match(signature, /SIGNATURE_MAX_AGE_SECONDS/);
  // The literal data.id lookup now lives in the shared notification parser.
  assert.match(read('supabase/functions/_shared/webhook-notification.ts'), /searchParams\.get\('data\.id'\)/);
  assert.match(webhook, /webhookResourceId\(url\)/);
  assert.match(webhook, /if \(!requestIsHttps\(request\)\)/);
  assert.match(webhook, /WEBHOOK_MAX_BYTES/);
  assert.match(webhook, /signatureValid: false/);
  assert.match(webhook, /return jsonResponse\(request, \{ ok: false, code: 'INVALID_WEBHOOK' \}, 401\)/);
});

test('webhook receipt and worker enforce durable deduplication, leases and API reconciliation', () => {
  const sql = read('supabase/migrations/20260802093000_mercadopago_checkout_pro_lifecycle.sql');
  const foundation = read('supabase/migrations/20260802090000_mercadopago_checkout_pro_foundation.sql');
  const worker = read('supabase/functions/mercadopago-payment-worker/index.ts');

  assert.match(foundation, /unique \(provider, environment, webhook_event_id, event_type, resource_id\)/);
  assert.match(sql, /on conflict \(provider, environment, webhook_event_id, event_type, resource_id\) do nothing/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /lease_expires_at/);
  assert.match(sql, /dead_letter/);
  assert.match(sql, /signature_valid/);
  assert.match(worker, /fetchPayment\(/);
  assert.match(worker, /record_mercadopago_payment_snapshot/);
  assert.match(worker, /finalize_paid_checkout_session/);
  assert.match(worker, /fetchChargeback/);
  assert.match(worker, /fetchClaim/);
});

test('signature unit suite covers valid, invalid, stale and altered webhook cases', () => {
  const tests = read('supabase/functions/_shared/mercadopago-webhook-signature.deno.ts');
  for (const wording of ['firma válida', 'secret erróneo', 'request ID erróneo', 'data.id incorrecto', 'payload alterado', 'sin firma', 'timestamp vencido']) {
    assert.match(tests, new RegExp(wording));
  }
});

test('HTTPS guard reads the proxy header and keeps request.url as fallback', () => {
  const guard = read('supabase/functions/_shared/request-protocol.ts');

  // Supabase terminates TLS at the edge, so request.url is plaintext inside the
  // runtime. Reading it alone rejected every real notification with 400.
  assert.match(guard, /x-forwarded-proto/);
  assert.match(guard, /split\(','\)\[0\]/);
  assert.match(guard, /=== 'https'/);
  assert.match(guard, /new URL\(request\.url\)\.protocol === 'https:'/);

  const webhook = read('supabase/functions/mercadopago-webhook/index.ts');
  assert.match(webhook, /import \{ requestIsHttps \} from '\.\.\/_shared\/request-protocol\.ts'/);
  assert.doesNotMatch(webhook, /new URL\(request\.url\)\.protocol/);
});

test('proxy protocol suite covers forwarded HTTPS, real HTTP and fallback', () => {
  const tests = read('supabase/functions/_shared/request-protocol.deno.ts');
  for (const wording of ['proxy HTTPS', 'HTTP real detrás del proxy', 'cadena de proxies', 'sin encabezado se cae a request\\.url', 'encabezado vacío']) {
    assert.match(tests, new RegExp(wording));
  }
});

test('run-mercadopago-webhook-tests runs the proxy protocol suite', () => {
  const runner = read('scripts/run-mercadopago-webhook-tests.mjs');
  assert.match(runner, /request-protocol\.deno\.ts/);
  assert.match(runner, /webhook-notification\.deno\.ts/);
});

test('notification parser resolves both Mercado Pago delivery shapes', () => {
  const parser = read('supabase/functions/_shared/webhook-notification.ts');

  // Merchant orders arrive as ?topic=<t>&id=<n>; reading only data.id stored
  // them against a payload hash and no signature could ever match.
  assert.match(parser, /searchParams\.get\('topic'\)/);
  assert.match(parser, /searchParams\.get\('id'\)/);
  assert.match(parser, /if \(!topic\) return '';/);

  const suite = read('supabase/functions/_shared/webhook-notification.deno.ts');
  for (const wording of ['notificacion moderna', 'merchant order legacy', 'data.id gana sobre el id legacy', 'id suelto sin topic']) {
    assert.match(suite, new RegExp(wording));
  }
});
