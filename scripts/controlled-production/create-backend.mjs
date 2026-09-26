// Creates (idempotently) the CONTROLLED_PRODUCTION Supabase project through
// the Management API. Dry-run by default: prints organization, plan and what
// would be created. --apply creates the project, waits for health and stores
// the DB password and the publishable/secret keys ONLY in Windows Credential
// Manager (user = new ref). Nothing secret is printed.
//
//   node scripts/controlled-production/create-backend.mjs [--org <slug>] [--apply]
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conToken } from '../lib/supabase-cli-token.mjs';
import { generarContrasena, guardarSecreto, leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { NON_CP_REFS, TARGETS } from './target-keys.mjs';

export const CP_PROJECT_NAME = 'la-taba-controlled-production';
export const CP_REGION = 'sa-east-1';
const API = 'https://api.supabase.com/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(token, method, route, body) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(`${API}${route}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000),
      });
      const text = await response.text();
      if (!response.ok) throw Object.assign(Error(`MGMT_${method}_${route.split('?')[0]}_HTTP_${response.status}`), { status: response.status, detail: text.slice(0, 200) });
      return text ? JSON.parse(text) : null;
    } catch (error) {
      // Only network failures are retried; an HTTP refusal is an answer.
      if (error.status || attempt >= 4) throw error;
      await sleep(3000 * attempt);
    }
  }
}

export function chooseOrganization(orgs, wanted) {
  if (wanted) {
    const found = orgs.find((org) => org.id === wanted || org.slug === wanted);
    assert.ok(found, 'ORGANIZATION_NOT_FOUND');
    return found;
  }
  assert.equal(orgs.length, 1, 'MULTIPLE_ORGANIZATIONS_PASS_--org');
  return orgs[0];
}

async function main(args) {
  const apply = args.includes('--apply');
  const at = args.indexOf('--org');
  await conToken(async (token) => {
    const orgs = await api(token, 'GET', '/organizations');
    const org = chooseOrganization(orgs, at < 0 ? '' : args[at + 1]);
    const detail = await api(token, 'GET', `/organizations/${org.id}`).catch(() => ({}));
    const projects = await api(token, 'GET', '/projects');
    const inOrg = projects.filter((p) => p.organization_id === org.id);
    // The organization must be the one that already bills La Taba: it holds
    // the Staging and the old Production projects.
    for (const known of ['ucbtjcurawxjwjdvvcvj', 'wwcpogltfgzgkrlilbcd']) {
      assert.ok(inOrg.some((p) => p.id === known), 'ORGANIZATION_IS_NOT_LA_TABA');
    }
    let project = projects.find((p) => p.name === CP_PROJECT_NAME);
    const summary = { organization: org.name, plan: detail.plan || 'unknown',
      projectsInOrganization: inOrg.map((p) => ({ name: p.name, region: p.region, status: p.status })),
      target: { name: CP_PROJECT_NAME, region: CP_REGION, exists: Boolean(project) } };
    if (!apply) {
      console.log(JSON.stringify({ dryRun: true, ...summary,
        note: 'A new project adds its compute to the organization bill (Pro: ~USD 10/month for the smallest instance).' }, null, 2));
      return;
    }
    if (!project) {
      const dbPassword = generarContrasena(40);
      guardarSecreto('CONTROLLED PROD DB PASSWORD', 'pending-ref', dbPassword);
      project = await api(token, 'POST', '/projects', { name: CP_PROJECT_NAME, organization_id: org.id,
        region: CP_REGION, db_pass: dbPassword });
      guardarSecreto('CONTROLLED PROD DB PASSWORD', project.id, dbPassword);
    }
    const ref = project.id;
    assert.match(ref, /^[a-z0-9]{20}$/, 'NEW_REF_INVALID');
    assert.ok(!NON_CP_REFS.has(ref), 'CP_REF_COLLIDES_WITH_EXISTING_ENVIRONMENT');
    for (let i = 0; i < 80; i += 1) {
      const state = await api(token, 'GET', `/projects/${ref}`);
      if (state.status === 'ACTIVE_HEALTHY') break;
      assert.ok(i < 79, `PROJECT_NOT_HEALTHY:${state.status}`);
      await sleep(15_000);
    }
    let keys = await api(token, 'GET', `/projects/${ref}/api-keys?reveal=true`);
    for (const type of ['publishable', 'secret']) {
      if (!keys.some((k) => k.type === type && k.api_key)) {
        await api(token, 'POST', `/projects/${ref}/api-keys`, { type, name: type === 'secret' ? 'operator' : 'web' });
      }
    }
    keys = await api(token, 'GET', `/projects/${ref}/api-keys?reveal=true`);
    const publishable = keys.find((k) => k.type === 'publishable' && k.api_key?.startsWith('sb_publishable_'));
    const secret = keys.find((k) => k.type === 'secret' && k.api_key?.startsWith('sb_secret_'));
    assert.ok(publishable && secret, 'NEW_API_KEYS_UNAVAILABLE');
    const spec = TARGETS['controlled-production'];
    guardarSecreto(spec.publishableName, ref, publishable.api_key);
    guardarSecreto(spec.secretName, ref, secret.api_key);
    // Name used by the catalog importer / preflight (Codex pilot tooling).
    guardarSecreto('PILOT SUPABASE PUBLISHABLE KEY', ref, publishable.api_key);
    assert.equal(leerSecreto(spec.secretName)?.usuario, ref, 'KEY_STORE_FAILED');
    console.log(JSON.stringify({ created: true, ...summary, ref, url: `https://${ref}.supabase.co`,
      keysStored: ['publishable', 'secret', 'db_password'], secretsPrinted: false }, null, 2));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`CP_BACKEND_BLOCKED:${error.message}${error.detail ? ` ${error.detail}` : ''}`);
    process.exitCode = 1;
  });
}
