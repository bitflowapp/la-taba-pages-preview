// Credential binding for QA/ops runners without a Supabase management token.
// A key is accepted only if the target project itself authenticates it: the
// publishable key must open that project's Auth settings and the secret key
// must open that project's Auth admin API. Values are never printed.
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { isRetiredOrForeignRef, productionTarget } from '../lib/environments.mjs';

export const TARGETS = Object.freeze({
  staging: Object.freeze({
    ref: 'ucbtjcurawxjwjdvvcvj',
    secretName: 'STAGING SUPABASE SECRET KEY',
    publishableName: 'STAGING SUPABASE PUBLISHABLE KEY',
  }),
  'controlled-production': Object.freeze({
    ref: null, // bound at runtime to the stored credential's user (the new ref)
    secretName: 'CONTROLLED PROD SUPABASE SECRET KEY',
    publishableName: 'CONTROLLED PROD SUPABASE PUBLISHABLE KEY',
  }),
  // Production of deploy/environments.json: the ref is never taken from a credential, only from the registry
  // (PRODUCTION_NOT_PROVISIONED while it has no project). Staging and controlled production are retired projects.
  production: Object.freeze({
    ref: null,
    fromRegistry: true,
    secretName: 'PRODUCTION SUPABASE SECRET KEY',
    publishableName: 'PRODUCTION SUPABASE PUBLISHABLE KEY',
  }),
});

// Never valid as CONTROLLED_PRODUCTION: Staging QA, old Production, DEMO.
export const NON_CP_REFS = Object.freeze(new Set(['ucbtjcurawxjwjdvvcvj',
  'wwcpogltfgzgkrlilbcd', 'yakhtrkukqlgzvxuvhzs']));

async function status(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  await response.arrayBuffer().catch(() => {});
  return response.status;
}

// CI path: only the public (publishable) key travels, bound to an explicit
// ref. The secret key never leaves the operator's machine.
function publishableFromEnv(env) {
  if (!env.TABA_QA_PUBLISHABLE_KEY) return null;
  return { usuario: env.TABA_QA_PROJECT_REF, secreto: env.TABA_QA_PUBLISHABLE_KEY };
}

export async function loadTargetKeys(target, { requireSecret = true, read = leerSecreto, env = process.env, registry } = {}) {
  const spec = TARGETS[target];
  if (!spec) throw Error(`UNKNOWN_TARGET:${target}`);
  const publishable = spec.fromRegistry ? read(spec.publishableName) : (publishableFromEnv(env) || read(spec.publishableName));
  const ref = spec.fromRegistry
    ? productionTarget({ ...(registry ? { registry } : {}), allowProvisioned: true }).ref
    : (spec.ref || publishable?.usuario);
  if (!/^[a-z0-9]{20}$/.test(ref || '')) throw Error('TARGET_REF_NOT_BOUND');
  if (target === 'controlled-production' && NON_CP_REFS.has(ref)) throw Error('CP_REF_IS_NOT_ISOLATED');
  if (isRetiredOrForeignRef(ref, registry)) throw Error(`TARGET_RETIRED:${target}`);
  if (publishable?.usuario !== ref || !publishable.secreto?.startsWith('sb_publishable_')) {
    throw Error('PUBLISHABLE_KEY_NOT_BOUND');
  }
  const url = `https://${ref}.supabase.co`;
  if (await status(`${url}/auth/v1/settings`, { apikey: publishable.secreto }) !== 200) {
    throw Error('PUBLISHABLE_KEY_REJECTED_BY_TARGET');
  }
  let secret = null;
  if (requireSecret) {
    const stored = read(spec.secretName);
    if (stored?.usuario !== ref || !stored.secreto?.startsWith('sb_secret_')) throw Error('SECRET_KEY_NOT_BOUND');
    const code = await status(`${url}/auth/v1/admin/users?page=1&per_page=1`,
      { apikey: stored.secreto, Authorization: `Bearer ${stored.secreto}` });
    if (code !== 200) throw Error(`SECRET_KEY_REJECTED_BY_TARGET:${code}`);
    secret = stored.secreto;
  }
  return { target, ref, url, publishable: publishable.secreto, secret };
}
