// The Mobbex reconciliation cron is PREPARED, never deployed. These checks keep the template inert and correct.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  PAYMENT_WORKER_CANONICAL_PATH, paymentWorkerManifest, signPaymentWorkerRequest, validatePaymentWorkerSignature,
} from '../supabase/functions/_shared/payment-worker-signature.ts';

const root = path.resolve(import.meta.dirname, '..');
const template = fs.readFileSync(path.join(root, 'deploy/mobbex/mobbex-worker-cron.template.sql'), 'utf8');
const executable = template.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

test('the template is not a migration, so no db push can apply it', () => {
  const migrations = fs.readdirSync(path.join(root, 'supabase/migrations'));
  assert.equal(migrations.some((name) => /mobbex.*(cron|worker|schedul)/i.test(name)), false);
  assert.ok(template.includes('NO es una migración'));
});

test('nothing is scheduled by the template itself: cron.schedule exists only inside comments', () => {
  assert.doesNotMatch(executable, /cron\.schedule|cron\.unschedule/);
  assert.match(template, /^-- select cron\.schedule\('taba-mobbex-worker', '60 seconds'/m);
});

test('it signs exactly what the shared worker validator verifies (canonical Mercado Pago path, not mobbex-worker)', async () => {
  assert.ok(executable.includes(`'.POST.${PAYMENT_WORKER_CANONICAL_PATH}'`), 'manifest path must be the canonical one');
  assert.doesNotMatch(executable, /POST\.\/functions\/v1\/mobbex-worker/);
  const secret = 'x'.repeat(48);
  const nonce = '123e4567-e89b-12d3-a456-426614174000';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signPaymentWorkerRequest(secret, timestamp, nonce);
  assert.equal(paymentWorkerManifest(timestamp, nonce), `${timestamp}.${nonce}.POST.${PAYMENT_WORKER_CANONICAL_PATH}`);
  assert.equal(await validatePaymentWorkerSignature({ secret, timestamp, nonce, signature }), true);
  assert.equal(await validatePaymentWorkerSignature({ secret: 'y'.repeat(48), timestamp, nonce, signature }), false, 'another secret is refused');
});

test('it only calls out when Mobbex is on, something is open, and the Vault configuration is complete', () => {
  assert.match(executable, /not exists \(select 1 from public\.mobbex_business_settings s where s\.enabled\) then return null/);
  assert.match(executable, /pi\.internal_status in \('checkout_created', 'pending', 'in_process', 'ambiguous', 'approved_order_pending', 'rejected'\)/);
  assert.match(executable, /nullif\(btrim\(v_worker_url\), ''\) is null or nullif\(v_worker_secret, ''\) is null then return null/);
  assert.match(executable, /\^https:\/\/\[a-z0-9-\]\+\[\.\]supabase\[\.\]co\/functions\/v1\/mobbex-worker\$/);
  assert.match(executable, /length\(v_worker_secret\) < 32/);
});

test('job statuses used by the due check are real ones of the ledger', () => {
  const ledger = fs.readFileSync(path.join(root, 'supabase/migrations/20261103010000_mobbex_checkout_foundation.sql'), 'utf8');
  const allowed = /mobbex_jobs_status_check check \(status in \(([^)]*)\)\)/.exec(ledger)[1].match(/'([a-z_]+)'/g).map((v) => v.slice(1, -1));
  for (const status of [...executable.matchAll(/j\.status (?:in \(([^)]*)\)|= '([a-z_]+)')/g)].flatMap((m) => (m[1] ?? `'${m[2]}'`).match(/'([a-z_]+)'/g).map((v) => v.slice(1, -1)))) {
    assert.ok(allowed.includes(status), `job status "${status}" does not exist`);
  }
});

test('only the service role can run it', () => {
  assert.match(executable, /revoke all on function public\.dispatch_mobbex_worker\(text\) from public, anon, authenticated/);
  assert.match(executable, /grant execute on function public\.dispatch_mobbex_worker\(text\) to service_role/);
  assert.match(executable, /security definer\s+set search_path = pg_catalog, public, extensions, vault, net, pg_temp/);
});
