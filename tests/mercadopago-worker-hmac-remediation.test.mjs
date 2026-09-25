import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  checkWorkerHmac,
  synchronizeWorkerHmac,
} from '../scripts/mercadopago/sincronizar-worker-hmac.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const FIXTURE_SECRET = 'A'.repeat(64);
const FIXTURE_TIME = 1_788_844_800_000;
const FIXTURE_NONCE = '91000000-0000-4000-8000-000000000001';

const REFS = { staging: 'ucbtjcurawxjwjdvvcvj', 'controlled-production': 'tkanbadcglszlcyfjvpv', production: 'wwcpogltfgzgkrlilbcd' };

function hostedSecrets(target = 'production', extra = [], refOverride = null) {
  const staging = target === 'staging';
  return [
    ['MERCADOPAGO_CLIENT_ID', staging ? '2691240967769590' : '7677852968049976'],
    ['MERCADOPAGO_CREDENTIAL_MODE', 'oauth'],
    ['MERCADOPAGO_ENVIRONMENT', staging ? 'test' : 'production'],
    ['TABA_DEPLOYMENT_ENV', staging ? 'staging' : 'production'],
    ['MERCADOPAGO_OAUTH_PROJECT_REF', refOverride || REFS[target]],
    ['MERCADOPAGO_CLIENT_SECRET', 'fixture-client-secret'],
    ['MERCADOPAGO_OAUTH_WEBHOOK_SECRET', 'fixture-webhook-secret'],
    ['MERCADOPAGO_TOKEN_ENCRYPTION_KEY', 'fixture-encryption-key'],
    ['PAYMENT_LOG_HASH_SALT', 'fixture-log-salt'],
    ['PAYMENT_WORKER_SECRET', 'old-worker-secret'],
    ...extra,
  ].map(([name, value]) => ({ name, value: hash(value) }));
}

function harness({ active = false, globalToken = false, target = 'production', vaultProvisioned = false, pendingWork = 0, inventoryOf = null } = {}) {
  const ref = REFS[target];
  let secrets = hostedSecrets(target, globalToken ? [['MERCADOPAGO_ACCESS_TOKEN', 'fixture-global']] : [], inventoryOf ? REFS[inventoryOf] : null);
  let vaultDigest = '';
  let vaultUrlAligned = false;
  let mutationCalls = 0;
  let signedProbe = false;
  const request = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/secrets') && !init.method) return Response.json(secrets);
    if (url.endsWith('/secrets') && init.method === 'POST') {
      mutationCalls++;
      const update = JSON.parse(String(init.body))[0];
      secrets = secrets.filter(item => item.name !== update.name)
        .concat({ name: update.name, value: hash(update.value) });
      return Response.json({ ok: true });
    }
    if (url.endsWith('/database/query')) {
      const query = JSON.parse(String(init.body)).query;
      if (query.includes('do $sync$')) {
        mutationCalls++;
        assert.match(query, new RegExp(FIXTURE_SECRET));
        vaultDigest = hash(FIXTURE_SECRET);
        vaultUrlAligned = query.includes(`${ref}.supabase.co/functions/v1/mercadopago-payment-worker`);
        return Response.json([]);
      }
      const edgeDigest = secrets.find(item => item.name === 'PAYMENT_WORKER_SECRET')?.value || '';
      return Response.json([{
        hmac_aligned: Boolean(vaultDigest) && vaultDigest === edgeDigest,
        url_aligned: vaultUrlAligned,
        connected_sellers: active ? 1 : 0,
        enabled_settings: active ? 1 : 0,
        unfinished_jobs: active ? 1 : 0,
        vault_provisioned: vaultProvisioned || Boolean(vaultDigest),
      }]);
    }
    if (url.endsWith('/functions/v1/mercadopago-payment-worker')) {
      const headers = new Headers(init.headers);
      const timestamp = headers.get('x-taba-worker-timestamp');
      const nonce = headers.get('x-taba-worker-nonce');
      const manifest = `${timestamp}.${nonce}.POST./functions/v1/mercadopago-payment-worker`;
      assert.equal(headers.get('x-taba-worker-signature'), createHmac('sha256', FIXTURE_SECRET).update(manifest).digest('hex'));
      signedProbe = true;
      return Response.json({ ok: true, claimed: pendingWork, completed: pendingWork, retried: 0 });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  return {
    request,
    withToken: task => task('fixture-management-token'),
    state: () => ({ mutationCalls, signedProbe }),
  };
}

test('worker HMAC check fails closed when Vault has no matching authority', async () => {
  const h = harness();
  const result = await checkWorkerHmac('production', h);
  assert.equal(result.ok, false);
  assert.equal(result.hmacAligned, false);
  assert.equal(result.urlAligned, false);
  assert.equal(h.state().mutationCalls, 0);
});

test('production setup accepts only the La Taba Delivery application id', () => {
  const nodeSetup = readFileSync('scripts/mercadopago/configurar-oauth-produccion.mjs', 'utf8');
  const powershellSetup = readFileSync('scripts/mercadopago/configurar-oauth-produccion.ps1', 'utf8');
  for (const source of [nodeSetup, powershellSetup]) {
    assert.match(source, /7677852968049976/);
    assert.doesNotMatch(source, /2691240967769590/);
  }
  assert.match(nodeSetup, /clientId\s*!==\s*expectedClientId/);
  assert.match(powershellSetup, /taskClientId\s*-ne\s*'7677852968049976'/);
});

test('worker HMAC remediation refuses active production payment state and global tokens', async () => {
  const active = harness({ active: true });
  await assert.rejects(() => synchronizeWorkerHmac('production', {
    ...active,
    createSecret: () => FIXTURE_SECRET,
  }), /active payment state/);
  assert.equal(active.state().mutationCalls, 0);

  const global = harness({ globalToken: true });
  await assert.rejects(() => synchronizeWorkerHmac('production', {
    ...global,
    createSecret: () => FIXTURE_SECRET,
  }), /forbidden global Mercado Pago access token/);
  assert.equal(global.state().mutationCalls, 0);

  const stagingGlobal = harness({ target: 'staging', globalToken: true });
  await assert.rejects(() => checkWorkerHmac('staging', stagingGlobal), /global Mercado Pago access token/);
  assert.equal(stagingGlobal.state().mutationCalls, 0);
});

test('worker HMAC remediation aligns Edge and Vault then performs a zero-work signed probe', async () => {
  const h = harness();
  const result = await synchronizeWorkerHmac('production', {
    ...h,
    createSecret: () => FIXTURE_SECRET,
    createNonce: () => FIXTURE_NONCE,
    now: () => FIXTURE_TIME,
  });
  assert.deepEqual(result, {
    ok: true,
    target: 'production',
    aligned: true,
    signedProbe: true,
  });
  assert.equal(h.state().mutationCalls, 2);
  assert.equal(h.state().signedProbe, true);
});

test('first Staging provisioning is allowed with queued work when Vault never held the worker key', async () => {
  const h = harness({ target: 'staging', active: true, pendingWork: 2 });
  const result = await synchronizeWorkerHmac('staging', {
    ...h,
    createSecret: () => FIXTURE_SECRET,
    createNonce: () => FIXTURE_NONCE,
    now: () => FIXTURE_TIME,
  });
  assert.deepEqual(result, {
    ok: true, target: 'staging', aligned: true, signedProbe: true,
    firstProvisioning: true, drained: { claimed: 2, completed: 2, retried: 0 },
  });
  assert.equal(h.state().mutationCalls, 2);
});

test('a provisioned Staging worker is still not rotated under active payment state', async () => {
  const h = harness({ target: 'staging', active: true, vaultProvisioned: true });
  await assert.rejects(() => synchronizeWorkerHmac('staging', { ...h, createSecret: () => FIXTURE_SECRET }), /active payment state/);
  assert.equal(h.state().mutationCalls, 0);
});

test('production never takes the first-provisioning exception', async () => {
  const h = harness({ active: true });
  await assert.rejects(() => synchronizeWorkerHmac('production', { ...h, createSecret: () => FIXTURE_SECRET }), /active payment state/);
  assert.equal(h.state().mutationCalls, 0);
});

test('controlled production is checked as its own project with the La Taba Delivery application', async () => {
  const h = harness({ target: 'controlled-production' });
  const result = await checkWorkerHmac('controlled-production', h);
  assert.equal(result.ok, false);
  assert.equal(result.vaultProvisioned, false);
  assert.equal(h.state().mutationCalls, 0);
});

test('controlled production keeps the strict production guard: no first-provisioning exception', async () => {
  const h = harness({ target: 'controlled-production', active: true, pendingWork: 1 });
  await assert.rejects(() => synchronizeWorkerHmac('controlled-production', { ...h, createSecret: () => FIXTURE_SECRET }), /active payment state/);
  assert.equal(h.state().mutationCalls, 0);
});

test('a secret inventory of another project is refused for controlled production', async () => {
  const h = harness({ target: 'controlled-production', inventoryOf: 'production' });
  await assert.rejects(() => checkWorkerHmac('controlled-production', h), /Environment identity mismatch: MERCADOPAGO_OAUTH_PROJECT_REF/);
});

test('the production OAuth setup maps controlled production to its own host with the same application', () => {
  const nodeSetup = readFileSync('scripts/mercadopago/configurar-oauth-produccion.mjs', 'utf8');
  const powershellSetup = readFileSync('scripts/mercadopago/configurar-oauth-produccion.ps1', 'utf8');
  assert.match(nodeSetup, /'controlled-production': \{ ref: 'tkanbadcglszlcyfjvpv', site: 'https:\/\/la-taba-commercial-pilot\.pages\.dev' \}/);
  assert.match(nodeSetup, /production: \{ ref: 'wwcpogltfgzgkrlilbcd', site: 'https:\/\/la-taba\.pages\.dev' \}/);
  assert.match(powershellSetup, /ValidateSet\('production', 'controlled-production'\)/);
  assert.match(powershellSetup, /tkanbadcglszlcyfjvpv/);
});
