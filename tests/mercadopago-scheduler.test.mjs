import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(root, 'supabase/migrations/20260803120000_mercadopago_staging_worker_scheduler.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const runtime = fs.readFileSync(path.join(root, 'supabase/functions/_shared/payment-runtime.ts'), 'utf8');

test('scheduler uses official Supabase Cron, pg_net and encrypted Vault configuration', () => {
  assert.match(migration, /create extension if not exists pg_cron/i);
  assert.match(migration, /create extension if not exists pg_net/i);
  assert.match(migration, /vault\.decrypted_secrets/i);
  assert.match(migration, /cron\.schedule\([\s\S]*'30 seconds'/i);
  assert.match(migration, /net\.http_post\(/i);
  assert.match(migration, /timeout_milliseconds\s*:=\s*5000/i);
});

test('worker dispatch never puts its secret or Mercado Pago credentials in the HTTP request', () => {
  assert.match(migration, /hmac\(v_manifest, v_worker_secret, 'sha256'\)/i);
  assert.match(migration, /x-taba-worker-signature/i);
  assert.doesNotMatch(migration, /jsonb_build_object\([\s\S]{0,400}x-taba-payment-worker-secret/i);
  assert.doesNotMatch(migration, /MERCADOPAGO_ACCESS_TOKEN|MERCADOPAGO_WEBHOOK_SECRET/i);
  assert.doesNotMatch(runtime, /x-taba-payment-worker-secret/i);
  assert.match(runtime, /validatePaymentWorkerSignature/);
});

test('every inserted outbox job gets an immediate best-effort kick with cron recovery', () => {
  assert.match(migration, /after insert on public\.payment_outbox\s+for each statement/i);
  assert.match(migration, /dispatch_payment_outbox_worker\('outbox'\)/i);
  assert.match(migration, /dispatch_payment_outbox_worker\(''cron''\)/i);
  assert.match(migration, /exception when others[\s\S]*cron recovery path/i);
});

test('scheduler preserves outbox concurrency, lease recovery and dead-letter observability contracts', () => {
  const lifecycle = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260802093000_mercadopago_checkout_pro_lifecycle.sql'),
    'utf8',
  );
  assert.match(lifecycle, /for update skip locked/i);
  assert.match(lifecycle, /lease_expires_at[\s\S]*clock_timestamp\(\)/i);
  assert.match(lifecycle, /attempts >= 8 then 'dead_letter'/i);
  assert.match(migration, /list_payment_outbox_operational_alerts/);
  assert.match(migration, /payment_outbox_dead_letter/);
  assert.match(migration, /payment_outbox_lease_expired/);
  assert.match(migration, /payment_outbox_delayed/);
});

test('scheduler RPCs remain unavailable to browser database roles', () => {
  for (const signature of [
    'dispatch_payment_outbox_worker\\(text\\)',
    'kick_payment_outbox_worker\\(\\)',
    'list_payment_outbox_operational_alerts\\(\\)',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated`, 'i'));
  }
  assert.match(migration, /grant execute on function public\.dispatch_payment_outbox_worker\(text\) to service_role/i);
  assert.match(migration, /grant execute on function public\.list_payment_outbox_operational_alerts\(\) to service_role/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]{0,140}to anon|grant execute[\s\S]{0,140}to authenticated/i);
});
