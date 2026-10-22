// Provisions the payment worker's HMAC secret in the hosted QA project: the Edge secret PAYMENT_WORKER_SECRET and the
// two Vault entries the database dispatcher reads (taba_payment_worker_url / taba_payment_worker_hmac_secret).
// The secret is generated in memory, written once to each place and NEVER printed or stored on disk. Alignment is
// proven by comparing SHA-256 digests, and end to end by a signed call to the live worker (and a tampered one).
//   node scripts/recovery/provision-worker-secrets.mjs [--rotate] [--target deploy/recovery-free-hosted.json]
// Rotation is refused while any payment job is unfinished or any seller is connected.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { withRecoveryProject } from './hosted-client.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const target = JSON.parse(fs.readFileSync(arg('--target') || 'deploy/recovery-free-hosted.json', 'utf8'));
const rotate = process.argv.includes('--rotate');
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const WORKER_URL = `https://${target.projectRef}.supabase.co/functions/v1/mercadopago-payment-worker`;

function sign(secret, timestamp, nonce) {
  return createHmac('sha256', secret).update(`${timestamp}.${nonce}.POST./functions/v1/mercadopago-payment-worker`).digest('hex');
}

async function callWorker(secret, { tamper = false } = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  let signature = sign(secret, timestamp, nonce);
  if (tamper) signature = signature.slice(0, -1) + (signature.endsWith('0') ? '1' : '0');
  const response = await fetch(WORKER_URL, {
    method: 'POST', signal: AbortSignal.timeout(100000),
    headers: { 'content-type': 'application/json', 'x-taba-worker-timestamp': timestamp, 'x-taba-worker-nonce': nonce, 'x-taba-worker-signature': signature },
    body: JSON.stringify({ source: 'provisioning-check' }),
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* keep null */ }
  return { status: response.status, ok: body?.ok === true, claimed: body?.claimed ?? null };
}

await withRecoveryProject(target, async ({ request, query }) => {
  const inventory = await request('/secrets');
  const byName = new Map((Array.isArray(inventory) ? inventory : []).map(row => [String(row.name), String(row.value || '')]));
  const state = (await query(`select
      (select count(*) from public.payment_outbox where status <> 'completed')::int unfinished_jobs,
      (select count(*) from public.mp_seller_connections where status = 'connected')::int connected_sellers,
      exists(select 1 from vault.secrets where name = 'taba_payment_worker_hmac_secret') as vault_has_secret,
      exists(select 1 from vault.secrets where name = 'taba_payment_worker_url') as vault_has_url`))[0];
  const hadEdgeSecret = byName.has('PAYMENT_WORKER_SECRET') && byName.get('PAYMENT_WORKER_SECRET') !== digest('');
  const aligned = hadEdgeSecret && state.vault_has_secret && (await query(
    `select encode(digest(decrypted_secret, 'sha256'), 'hex') = ${literal(byName.get('PAYMENT_WORKER_SECRET'))} as ok
       from vault.decrypted_secrets where name = 'taba_payment_worker_hmac_secret'`))[0]?.ok === true;
  console.log(JSON.stringify({ phase: 'before', edgeSecretPresent: hadEdgeSecret, vaultSecretPresent: state.vault_has_secret, vaultUrlPresent: state.vault_has_url,
    digestsAligned: aligned, unfinishedJobs: state.unfinished_jobs, connectedSellers: state.connected_sellers }));
  if (aligned && state.vault_has_url && !rotate) {
    console.log(JSON.stringify({ phase: 'nothing-to-do', note: 'already aligned; pass --rotate to replace the secret' }));
    return;
  }
  if ((hadEdgeSecret || state.vault_has_secret) && (state.unfinished_jobs !== 0 || state.connected_sellers !== 0)) {
    throw new Error('Refusing to replace the worker secret while payment jobs are unfinished or a seller is connected');
  }
  const secret = randomBytes(48).toString('base64url');
  await request('/secrets', { method: 'POST', body: JSON.stringify([{ name: 'PAYMENT_WORKER_SECRET', value: secret }]) });
  await query(`do $provision$ declare v_id uuid; begin
      select id into v_id from vault.secrets where name = 'taba_payment_worker_hmac_secret';
      if v_id is null then perform vault.create_secret(${literal(secret)}, 'taba_payment_worker_hmac_secret', 'HMAC del worker de pagos (QA)');
      else perform vault.update_secret(v_id, ${literal(secret)}, 'taba_payment_worker_hmac_secret', 'HMAC del worker de pagos (QA)'); end if;
      select id into v_id from vault.secrets where name = 'taba_payment_worker_url';
      if v_id is null then perform vault.create_secret(${literal(WORKER_URL)}, 'taba_payment_worker_url', 'URL canonica del worker de pagos (QA)');
      else perform vault.update_secret(v_id, ${literal(WORKER_URL)}, 'taba_payment_worker_url', 'URL canonica del worker de pagos (QA)'); end if;
    end $provision$;`);
  const after = new Map(((await request('/secrets')) || []).map(row => [String(row.name), String(row.value || '')]));
  const vaultOk = (await query(`select encode(digest(decrypted_secret, 'sha256'), 'hex') = ${literal(after.get('PAYMENT_WORKER_SECRET'))} as ok
      from vault.decrypted_secrets where name = 'taba_payment_worker_hmac_secret'`))[0]?.ok === true;
  const urlOk = (await query(`select decrypted_secret = ${literal(WORKER_URL)} as ok from vault.decrypted_secrets where name = 'taba_payment_worker_url'`))[0]?.ok === true;
  // Edge secrets are read at cold start; give the platform a moment, then prove it with real signed calls.
  let live = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    live = await callWorker(secret);
    if (live.status === 200) break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  const tampered = await callWorker(secret, { tamper: true });
  console.log(JSON.stringify({ phase: 'after', digestsAligned: vaultOk, urlAligned: urlOk, signedCall: live, tamperedCall: tampered }));
  if (!vaultOk || !urlOk || live?.status !== 200 || tampered.status !== 401) process.exitCode = 1;
});
