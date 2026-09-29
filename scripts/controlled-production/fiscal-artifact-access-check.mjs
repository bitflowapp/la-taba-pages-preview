// Verificación en vivo de la Edge Function `fiscal-artifact-access` en CONTROLLED_PRODUCTION:
// la que entrega al Panel la vista previa, descarga o impresión del PDF de un comprobante.
//
//   node scripts/controlled-production/fiscal-artifact-access-check.mjs --out <evidencia.json>
//
// No crea filas fiscales. Pide un artefacto que no existe, y la autorización SQL se niega
// antes de registrar el evento; la última comprobación lo confirma contando las tablas.
// Usa sólo la persona dueña del comercio QA, con la sesión registrada como la registra el
// Panel, y la cierra al terminar.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { QA_CONTROL_BUSINESS } from './qa-window.mjs';
import { readQaCredential } from './qa-credentials.mjs';

const PANEL_ORIGIN = 'https://la-taba-commercial-pilot.pages.dev';
const FOREIGN_ORIGIN = 'https://origen-ajeno.invalid';
const FISCAL_TABLES = ['fiscal_documents', 'fiscal_document_artifacts', 'fiscal_events', 'fiscal_outbox', 'fiscal_profiles'];
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

const out = readOption('--out');
const keys = await loadTargetKeys('controlled-production');
assert.equal(keys.ref, 'tkanbadcglszlcyfjvpv', 'WRONG_TARGET');
const endpoint = `${keys.url}/functions/v1/fiscal-artifact-access`;
const admin = createClient(keys.url, keys.secret, OPTIONS);
const checks = [];
const check = (id, ok, detail) => {
  checks.push({ id, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`);
};

const before = await fiscalRows();

const preflight = (origin) => fetch(endpoint, {
  method: 'OPTIONS',
  headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, apikey, content-type, x-client-info' },
});
const panel = await preflight(PANEL_ORIGIN);
check('PREFLIGHT_PANEL_ORIGIN', panel.status === 204 && panel.headers.get('access-control-allow-origin') === PANEL_ORIGIN,
  `${panel.status} ${panel.headers.get('access-control-allow-origin')}`);
const foreign = await preflight(FOREIGN_ORIGIN);
check('PREFLIGHT_FOREIGN_ORIGIN_REFUSED', foreign.status === 403 && !foreign.headers.get('access-control-allow-origin'), `${foreign.status}`);

const unknownArtifact = JSON.stringify({ artifactId: randomUUID(), action: 'preview' });
const post = (headers, body = unknownArtifact) => fetch(endpoint, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: PANEL_ORIGIN, ...headers }, body,
});
const noSession = await post({});
check('NO_SESSION_REFUSED', noSession.status === 401, `${noSession.status}`);
const anonymous = await post({ apikey: keys.publishable, authorization: `Bearer ${keys.publishable}` });
check('ANONYMOUS_DENIED', anonymous.status === 403 && (await anonymous.json()).code === 'ARTIFACT_ACCESS_DENIED', `${anonymous.status}`);

const stored = readQaCredential('CP QA OWNER');
assert.ok(stored?.usuario && stored?.secreto, 'QA_CREDENTIAL_REQUIRED:CP QA OWNER');
const person = createClient(keys.url, keys.publishable, OPTIONS);
const signed = await person.auth.signInWithPassword({ email: stored.usuario, password: stored.secreto });
assert.ok(!signed.error && signed.data?.session, 'QA_OWNER_SIGNIN_FAILED');
try {
  const registered = await person.rpc('identity_register_session', { p_business_id: QA_CONTROL_BUSINESS, p_client: 'panel_web',
    p_device_label: 'Verificación de comprobantes', p_device_key_hash: null, p_app_version: 'fiscal-artifact-access-check' });
  assert.ok(!registered.error && registered.data?.ok === true, 'QA_OWNER_SESSION_REFUSED');
  const auth = { apikey: keys.publishable, authorization: `Bearer ${signed.data.session.access_token}` };
  const invalid = await post(auth, JSON.stringify({ artifactId: 'no-es-un-uuid', action: 'preview' }));
  check('INVALID_REQUEST_REFUSED', invalid.status === 400 && (await invalid.json()).code === 'INVALID_REQUEST', `${invalid.status}`);
  const unknown = await post(auth);
  const unknownBody = await unknown.json();
  check('OWNER_UNKNOWN_ARTIFACT_DENIED', unknown.status === 403 && unknownBody.code === 'ARTIFACT_ACCESS_DENIED' && !('signedUrl' in unknownBody),
    `${unknown.status} ${unknownBody.code}`);
} finally {
  try { await person.rpc('identity_close_own_session', { p_business_id: QA_CONTROL_BUSINESS }); } catch { /* ya cerrada */ }
  try { await person.auth.signOut({ scope: 'local' }); } catch { /* sin sesión */ }
}

const after = await fiscalRows();
check('NO_FISCAL_ROWS_WRITTEN', JSON.stringify(before) === JSON.stringify(after) && Object.values(after).every((count) => count === 0),
  JSON.stringify(after));

const verdict = checks.every((item) => item.ok) ? 'PASS' : 'FAIL';
const report = {
  at: new Date().toISOString(), target: 'controlled-production', function: 'fiscal-artifact-access',
  verdict, passed: checks.filter((item) => item.ok).length, total: checks.length, checks,
};
if (out) {
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`FISCAL_ARTIFACT_ACCESS ${verdict} ${report.passed}/${report.total}`);
process.exitCode = verdict === 'PASS' ? 0 : 1;

async function fiscalRows() {
  const counts = {};
  for (const table of FISCAL_TABLES) {
    const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true });
    if (error) throw Error(`FISCAL_COUNT_FAILED:${table}:${error.code}`);
    counts[table] = count;
  }
  return counts;
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : null;
}
