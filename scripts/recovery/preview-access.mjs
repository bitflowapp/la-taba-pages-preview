// Credencial de la puerta de acceso de los previews QA/candidatos (deploy/qa-preview-gate/_worker.js).
//
//   --rotate        genera usuario/contraseña nuevos, los guarda en el Credential Manager y carga en el
//                   proyecto de Cloudflare Pages (sólo entorno *preview*) el SHA-256 de `usuario:contraseña`.
//                   Afecta a los despliegues de preview que se hagan DESPUÉS; producción no se toca.
//   --copy          copia la contraseña al portapapeles de Windows para pegarla en el navegador.
//   --check <url>   comprueba que sin credencial responde 401 y con la credencial 200.
//
// Ningún modo imprime la contraseña.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cloudflareToken } from './cloudflare-session.mjs';
import { generarContrasena, guardarSecreto, leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const CREDENTIAL = 'RECOVERY PREVIEW ACCESS';
const ACCOUNT = '7367370ad08d0e7be414614bc5ebb173';
const PROJECT = 'taba2-staging';
const USER = 'qa';
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };

async function cloudflare(path, init = {}) {
  const token = await cloudflareToken();
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(60000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new Error(`Cloudflare ${response.status}: ${JSON.stringify(body.errors || {}).slice(0, 300)}`);
  return body.result;
}

const stored = () => {
  const value = leerSecreto(CREDENTIAL);
  assert.ok(value?.usuario === USER && value.secreto, 'Sin credencial de preview: correr --rotate');
  return value;
};

if (process.argv.includes('--rotate')) {
  const project = await cloudflare(`/accounts/${ACCOUNT}/pages/projects/${PROJECT}`);
  assert.equal(project.production_branch, 'staging', 'proyecto inesperado');
  const password = generarContrasena(20);
  const digest = createHash('sha256').update(`${USER}:${password}`, 'utf8').digest('hex');
  await cloudflare(`/accounts/${ACCOUNT}/pages/projects/${PROJECT}`, { method: 'PATCH', body: JSON.stringify({
    deployment_configs: { preview: { env_vars: { PREVIEW_ACCESS_SHA256: { type: 'secret_text', value: digest } } } } }) });
  guardarSecreto(CREDENTIAL, USER, password);
  const after = await cloudflare(`/accounts/${ACCOUNT}/pages/projects/${PROJECT}`);
  console.log(JSON.stringify({ rotated: true, user: USER, credential: `TABA2 E2E:${CREDENTIAL}`,
    previewVars: Object.keys(after.deployment_configs?.preview?.env_vars || {}),
    productionVars: Object.keys(after.deployment_configs?.production?.env_vars || {}) }));
} else if (process.argv.includes('--copy')) {
  const { secreto } = stored();
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())'],
    { input: secreto, stdio: ['pipe', 'ignore', 'ignore'] });
  console.log(JSON.stringify({ copied: true, user: USER }));
} else if (arg('--check')) {
  const target = new URL(arg('--check'));
  assert.equal(target.protocol, 'https:');
  const { usuario, secreto } = stored();
  const anonymous = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const authorized = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { authorization: `Basic ${Buffer.from(`${usuario}:${secreto}`, 'utf8').toString('base64')}` } });
  const wrong = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { authorization: `Basic ${Buffer.from(`${usuario}:x${secreto}`, 'utf8').toString('base64')}` } });
  const result = { url: target.toString(), withoutCredential: anonymous.status, wrongPassword: wrong.status,
    withCredential: authorized.status, robots: authorized.headers.get('x-robots-tag'),
    passed: anonymous.status === 401 && wrong.status === 401 && authorized.status === 200 };
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
} else {
  throw new Error('Usar --rotate, --copy o --check <url>');
}
