// Sólo lectura: qué ve el Rider en su cola, preguntándoselo con SU sesión.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { REF, URL_BASE, SUPABASE_CLI, BUSINESS_ID, secreto } from './entorno.mjs';
const keys = JSON.parse(execFileSync(SUPABASE_CLI,
  ['projects', 'api-keys', '--project-ref', REF, '--output', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const ANON = keys.filter((k) => k.name === 'anon')[0].api_key;

const cred = fs.readFileSync(secreto('rider-map-qa-login.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
const email = (cred.find((l) => l.startsWith('email=')) || '').slice(6).trim();
const pass = (cred.find((l) => !l.includes('=')) || '').trim();
const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: pass }),
});
if (!login.ok) { console.log('login del rider FALLO', login.status); process.exit(1); }
const s = await login.json();
const rh = { apikey: ANON, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' };
const rpc = async (n, body = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${n}`, { method: 'POST', headers: rh, body: JSON.stringify(body) });
  const t = await r.text();
  try { return { status: r.status, data: JSON.parse(t) }; } catch { return { status: r.status, data: t.slice(0, 200) }; }
};

console.log(`rider ${s.user.id.slice(0, 8)} (${s.user.email.replace(/^(.{3}).*(@.*)$/, '$1***$2')})`);
const cola = await rpc('list_available_rider_orders', { p_business_id: BUSINESS_ID });
console.log(`\nlist_available_rider_orders -> HTTP ${cola.status}`);
console.log(JSON.stringify(cola.data, null, 2).slice(0, 1500));

const activa = await rpc('get_active_rider_delivery');
console.log(`\nget_active_rider_delivery -> HTTP ${activa.status}: ${JSON.stringify(activa.data).slice(0, 400)}`);
