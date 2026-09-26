import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { conToken } from '../lib/supabase-cli-token.mjs';

const TARGETS = Object.freeze({
  // Staging se mudó a ucbtjcurawxjwjdvvcvj el 2026-09-18 (PR #93); el ref viejo
  // ya no resuelve y dejaba a esta herramienta apuntando a un proyecto muerto.
  staging: Object.freeze({
    ref: 'ucbtjcurawxjwjdvvcvj',
    deployment: 'staging',
    environment: 'test',
    clientId: '2691240967769590',
  }),
  'controlled-production': Object.freeze({
    ref: 'tkanbadcglszlcyfjvpv',
    deployment: 'production',
    environment: 'production',
    clientId: '7677852968049976',
  }),
  production: Object.freeze({
    ref: 'wwcpogltfgzgkrlilbcd',
    deployment: 'production',
    environment: 'production',
    clientId: '7677852968049976',
  }),
});

const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const sqlLiteral = value => `'${String(value).replaceAll("'", "''")}'`;

async function jsonRequest(request, url, init, label) {
  const response = await request(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} failed (HTTP ${response.status})`);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

async function managementQuery(request, token, ref, query, label) {
  return await jsonRequest(request,
    `https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'taba-worker-hmac-remediation/1.0',
      },
      body: JSON.stringify({ query }),
    }, label);
}

function secretMap(rows) {
  if (!Array.isArray(rows)) throw new Error('Secret inventory returned an invalid shape');
  return new Map(rows.map(row => [String(row.name), String(row.value || '')]));
}

export function assertEnvironmentSecrets(target, secrets, { workerSecretMayBeMissing = false } = {}) {
  const expected = {
    MERCADOPAGO_CLIENT_ID: target.clientId,
    MERCADOPAGO_CREDENTIAL_MODE: 'oauth',
    MERCADOPAGO_ENVIRONMENT: target.environment,
    TABA_DEPLOYMENT_ENV: target.deployment,
    MERCADOPAGO_OAUTH_PROJECT_REF: target.ref,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (secrets.get(name) !== digest(value)) {
      throw new Error(`Environment identity mismatch: ${name}`);
    }
  }
  for (const name of [
    'MERCADOPAGO_CLIENT_SECRET',
    'MERCADOPAGO_OAUTH_WEBHOOK_SECRET',
    'MERCADOPAGO_TOKEN_ENCRYPTION_KEY',
    'PAYMENT_LOG_HASH_SALT',
    'PAYMENT_WORKER_SECRET',
  ]) {
    // A project that never had a worker (a new CONTROLLED_PRODUCTION) has no
    // worker secret yet: it is exactly what the synchronization writes. Every
    // other server secret must already be there, and the check after writing
    // is strict again.
    if (name === 'PAYMENT_WORKER_SECRET' && workerSecretMayBeMissing && !secrets.has(name)) continue;
    if (!secrets.has(name) || secrets.get(name) === digest('')) throw new Error(`Missing server secret: ${name}`);
  }
  if (secrets.has('MERCADOPAGO_ACCESS_TOKEN')) {
    throw new Error('Hosted environment still contains a forbidden global Mercado Pago access token');
  }
  if (target.deployment === 'production') {
    if (secrets.has('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION')) {
      throw new Error('Production real-payment authorization must remain absent');
    }
  }
}

async function readSecretInventory(request, token, target) {
  return secretMap(await jsonRequest(request,
    `https://api.supabase.com/v1/projects/${target.ref}/secrets`, {
      headers: { Authorization: `Bearer ${token}` },
    }, 'Secret inventory'));
}

async function readAlignment(request, token, target, edgeDigest) {
  const workerUrl = `https://${target.ref}.supabase.co/functions/v1/mercadopago-payment-worker`;
  const rows = await managementQuery(request, token, target.ref, `
    select
      coalesce((select encode(digest(decrypted_secret, 'sha256'), 'hex') = ${sqlLiteral(edgeDigest)}
                  from vault.decrypted_secrets where name = 'taba_payment_worker_hmac_secret'), false) as hmac_aligned,
      coalesce((select decrypted_secret = ${sqlLiteral(workerUrl)}
                  from vault.decrypted_secrets where name = 'taba_payment_worker_url'), false) as url_aligned,
      (select count(*) from public.mp_seller_connections where status = 'connected')::integer as connected_sellers,
      (select count(*) from public.business_payment_settings where enabled)::integer as enabled_settings,
      (select count(*) from public.payment_outbox where status <> 'completed')::integer as unfinished_jobs,
      exists(select 1 from vault.secrets where name = 'taba_payment_worker_hmac_secret') as vault_provisioned
  `, 'Worker alignment query');
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new Error('Worker alignment query returned no row');
  return {
    hmacAligned: row.hmac_aligned === true,
    urlAligned: row.url_aligned === true,
    connectedSellers: Number(row.connected_sellers),
    enabledSettings: Number(row.enabled_settings),
    unfinishedJobs: Number(row.unfinished_jobs),
    vaultProvisioned: row.vault_provisioned === true,
  };
}

export async function checkWorkerHmac(targetName, {
  request = fetch,
  withToken = conToken,
} = {}) {
  const target = TARGETS[targetName];
  if (!target) throw new Error('Target must be staging, controlled-production or production');
  return await withToken(async token => {
    const secrets = await readSecretInventory(request, token, target);
    assertEnvironmentSecrets(target, secrets);
    const alignment = await readAlignment(request, token, target, secrets.get('PAYMENT_WORKER_SECRET'));
    return { ok: alignment.hmacAligned && alignment.urlAligned, target: targetName, ...alignment };
  });
}

export async function synchronizeWorkerHmac(targetName, {
  request = fetch,
  withToken = conToken,
  createSecret = () => randomBytes(48).toString('base64url'),
  createNonce = randomUUID,
  now = () => Date.now(),
} = {}) {
  const target = TARGETS[targetName];
  if (!target) throw new Error('Target must be staging, controlled-production or production');
  return await withToken(async token => {
    const before = await readSecretInventory(request, token, target);
    assertEnvironmentSecrets(target, before, { workerSecretMayBeMissing: true });
    const current = await readAlignment(request, token, target, before.get('PAYMENT_WORKER_SECRET'));
    // Rotar con trabajo en vuelo puede dejar una llamada firmada con la clave
    // vieja. Si el Vault de Staging nunca tuvo la clave, el dispatcher nunca
    // firmó nada: no hay nada en vuelo que romper, sólo una cola que nadie
    // procesa (lo que pasó tras la mudanza de proyecto). Producción no tiene
    // esa excepción.
    const firstStagingProvisioning = target.deployment === 'staging' && !current.vaultProvisioned;
    if (!firstStagingProvisioning && (current.connectedSellers !== 0 || current.unfinishedJobs !== 0 ||
        (target.deployment === 'production' && current.enabledSettings !== 0))) {
      throw new Error('Worker HMAC rotation is blocked by active payment state');
    }

    const secret = createSecret();
    if (!/^[A-Za-z0-9_-]{64}$/.test(secret)) throw new Error('Generated worker secret is invalid');
    const workerUrl = `https://${target.ref}.supabase.co/functions/v1/mercadopago-payment-worker`;
    const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    await jsonRequest(request, `https://api.supabase.com/v1/projects/${target.ref}/secrets`, {
      method: 'POST', headers,
      body: JSON.stringify([{ name: 'PAYMENT_WORKER_SECRET', value: secret }]),
    }, 'Edge worker secret update');

    await managementQuery(request, token, target.ref, `
      do $sync$
      declare v_id uuid;
      begin
        select id into v_id from vault.secrets where name = 'taba_payment_worker_hmac_secret';
        if v_id is null then
          perform vault.create_secret(${sqlLiteral(secret)}, 'taba_payment_worker_hmac_secret', 'HMAC worker TABA');
        else
          perform vault.update_secret(v_id, ${sqlLiteral(secret)}, 'taba_payment_worker_hmac_secret', 'HMAC worker TABA');
        end if;
        select id into v_id from vault.secrets where name = 'taba_payment_worker_url';
        if v_id is null then
          perform vault.create_secret(${sqlLiteral(workerUrl)}, 'taba_payment_worker_url', 'URL canonica del worker de pagos TABA');
        else
          perform vault.update_secret(v_id, ${sqlLiteral(workerUrl)}, 'taba_payment_worker_url', 'URL canonica del worker de pagos TABA');
        end if;
      end $sync$;
    `, 'Vault worker secret update');

    const after = await readSecretInventory(request, token, target);
    assertEnvironmentSecrets(target, after);
    const alignment = await readAlignment(request, token, target, after.get('PAYMENT_WORKER_SECRET'));
    if (!alignment.hmacAligned || !alignment.urlAligned) {
      throw new Error('Worker HMAC was written but did not verify');
    }

    const timestamp = String(Math.floor(now() / 1000));
    const nonce = createNonce();
    const manifest = `${timestamp}.${nonce}.POST./functions/v1/mercadopago-payment-worker`;
    const signature = createHmac('sha256', secret).update(manifest).digest('hex');
    const probe = await jsonRequest(request, workerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-taba-worker-timestamp': timestamp,
        'x-taba-worker-nonce': nonce,
        'x-taba-worker-signature': signature,
      },
      body: JSON.stringify({ source: 'hmac_alignment_probe' }),
    }, 'Signed worker probe');
    // En la primera provisión la sonda firmada ES el primer turno del worker y
    // procesa la cola acumulada; en una rotación normal no debe haber trabajo.
    const expectsWork = firstStagingProvisioning && current.unfinishedJobs > 0;
    if (!probe?.ok || (!expectsWork && (probe.claimed !== 0 || probe.completed !== 0 || probe.retried !== 0))) {
      throw new Error('Signed worker probe observed unexpected payment work');
    }
    return {
      ok: true, target: targetName, aligned: true, signedProbe: true,
      ...(firstStagingProvisioning ? { firstProvisioning: true, drained: { claimed: probe.claimed, completed: probe.completed, retried: probe.retried } } : {}),
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = String(process.argv.find(value => value.startsWith('--target=')) || '').split('=')[1];
  const apply = process.argv.includes('--apply');
  try {
    const result = apply
      ? await synchronizeWorkerHmac(target)
      : await checkWorkerHmac(target);
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`WORKER_HMAC_REMEDIATION_FAILED: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  }
}
