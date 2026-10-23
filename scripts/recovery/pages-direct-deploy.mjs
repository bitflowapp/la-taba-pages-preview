// Direct Upload of a prepared artifact to a Cloudflare Pages project, without wrangler.
// Default is a DRY RUN that lists what would be published. --publish uploads to the given NON-production
// branch only (the project's production branch is refused). Uses the existing wrangler OAuth session;
// tokens are never printed. Session: cloudflare-login.mjs (stored on D:).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cloudflareToken } from './cloudflare-session.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const artifact = path.resolve(arg('--artifact') || '');
const project = arg('--project');
const branch = arg('--branch');
const account = arg('--account');
const publish = process.argv.includes('--publish');
assert.ok(fs.statSync(artifact).isDirectory() && project && branch && account, 'Requires --artifact --project --branch --account');
assert.match(branch, /^[a-z0-9][a-z0-9-]{2,40}$/, 'branch name');

const oauth = await cloudflareToken();
const api = async (url, { token = oauth, ...init } = {}) => {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(120000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw new Error(`Cloudflare ${response.status}: ${JSON.stringify(body.errors || body).slice(0, 400)}`);
  }
  return body.result;
};
const base = 'https://api.cloudflare.com/client/v4';
const TYPES = { html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
  webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', ico: 'image/x-icon', txt: 'text/plain', woff2: 'font/woff2', woff: 'font/woff', map: 'application/json',
  xml: 'application/xml', pdf: 'application/pdf', mp4: 'video/mp4' };
const SPECIAL = new Set(['_headers', '_redirects', '_worker.js', '_routes.json']);

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
})(artifact);
const assets = []; const special = [];
for (const file of files) {
  const rel = path.relative(artifact, file).replaceAll('\\', '/');
  const content = fs.readFileSync(file);
  if (SPECIAL.has(rel)) { special.push({ rel, content }); continue; }
  const ext = path.extname(rel).slice(1).toLowerCase();
  // 32-hex content address (extension included, like Pages), SHA-256 based.
  const hash = createHash('sha256').update(content.toString('base64') + ext).digest('hex').slice(0, 32);
  assets.push({ rel, hash, content, type: TYPES[ext] || 'application/octet-stream' });
}
const bytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
console.log(JSON.stringify({ mode: publish ? 'PUBLISH' : 'DRY_RUN', project, branch, files: files.length, assets: assets.length,
  special: special.map(s => s.rel), bytes }));

const projectInfo = await api(`${base}/accounts/${account}/pages/projects/${project}`);
assert.notEqual(branch, projectInfo.production_branch, 'Refusing to deploy to the production branch');
console.log(JSON.stringify({ projectFound: projectInfo.name, productionBranch: projectInfo.production_branch,
  envVarsProduction: Object.keys(projectInfo.deployment_configs?.production?.env_vars || {}).length,
  envVarsPreview: Object.keys(projectInfo.deployment_configs?.preview?.env_vars || {}).length }));
if (!publish) process.exit(0);

const { jwt } = await api(`${base}/accounts/${account}/pages/projects/${project}/upload-token`);
const json = { 'Content-Type': 'application/json' };
const missing = await api(`${base}/pages/assets/check-missing`, { method: 'POST', token: jwt, headers: json,
  body: JSON.stringify({ hashes: assets.map(a => a.hash) }) });
const need = assets.filter(a => missing.includes(a.hash));
console.log(JSON.stringify({ missing: need.length }));
for (let i = 0; i < need.length; i += 25) {
  const batch = need.slice(i, i + 25).map(a => ({ key: a.hash, value: a.content.toString('base64'),
    metadata: { contentType: a.type }, base64: true }));
  await api(`${base}/pages/assets/upload`, { method: 'POST', token: jwt, headers: json, body: JSON.stringify(batch) });
}
await api(`${base}/pages/assets/upsert-hashes`, { method: 'POST', token: jwt, headers: json,
  body: JSON.stringify({ hashes: assets.map(a => a.hash) }) });

const form = new FormData();
form.set('manifest', JSON.stringify(Object.fromEntries(assets.map(a => ['/' + a.rel, a.hash]))));
form.set('branch', branch);
form.set('commit_message', arg('--message') || 'QA preview');
form.set('commit_dirty', 'false');
for (const s of special) form.set(s.rel, new Blob([s.content]), s.rel);
const deployment = await api(`${base}/accounts/${account}/pages/projects/${project}/deployments`, { method: 'POST', body: form });
console.log(JSON.stringify({ id: deployment.id, environment: deployment.environment, url: deployment.url,
  aliases: deployment.aliases, stage: deployment.latest_stage?.name, status: deployment.latest_stage?.status }));
