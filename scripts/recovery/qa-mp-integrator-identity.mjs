// Read-only: which Mercado Pago account owns a QA integrator application, and is it a test account?
// A client_credentials grant is the application owner's own token; only its /users/me id, site and tags are printed.
//   node scripts/recovery/qa-mp-integrator-identity.mjs [--app staging|testapp]
//   staging = TABA2 Staging 2691240967769590 (owned by a real account)
//   testapp = TestApp-ae01fd1d 4861627125869370, its automatic test mirror (owned by the QA test seller)
import assert from 'node:assert/strict';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const APPS = {
  staging: { id: '2691240967769590', secret: 'RECOVERY MP TEST CLIENT SECRET' },
  testapp: { id: '4861627125869370', secret: 'RECOVERY MP TESTAPP CLIENT SECRET' },
};
const i = process.argv.indexOf('--app');
const choice = APPS[i < 0 ? 'staging' : process.argv[i + 1]];
assert.ok(choice, '--app staging|testapp');
const app = choice.id;
const stored = leerSecreto(choice.secret);
assert.ok(stored?.secreto, 'client secret unavailable');
if (stored.usuario && /^\d+$/.test(String(stored.usuario))) assert.equal(String(stored.usuario), app, 'client secret bound to another application');
const grant = await fetch('https://api.mercadopago.com/oauth/token', {
  method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
  body: JSON.stringify({ grant_type: 'client_credentials', client_id: app, client_secret: stored.secreto }),
});
const body = await grant.json().catch(() => ({}));
const out = { at: new Date().toISOString(), application: app, grant: { http: grant.status, requestId: grant.headers.get('x-request-id'), user_id: body.user_id ?? null, live_mode: body.live_mode ?? null, error: grant.ok ? null : body.error ?? body.message ?? null } };
if (grant.ok && body.access_token) {
  const me = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${body.access_token}` }, signal: AbortSignal.timeout(15000) });
  const user = await me.json().catch(() => ({}));
  out.owner = { http: me.status, id: user.id ?? null, site_id: user.site_id ?? null, tags: user.tags ?? null, test_user: Array.isArray(user.tags) ? user.tags.includes('test_user') : null };
}
console.log(JSON.stringify(out, null, 1));
