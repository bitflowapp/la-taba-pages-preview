// Read-only: which fields the provider's application resource exposes to its owner (names and non-secret values
// only). Used to decide whether a test-owned integrator application can be configured without the web panel.
//   node scripts/recovery/qa-mp-application-fields.mjs
import assert from 'node:assert/strict';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const token = leerSecreto('RECOVERY MP TEST ACCESS TOKEN')?.secreto;
assert.ok(token?.startsWith('APP_USR-'));
const app = /^APP_USR-(\d+)-/.exec(token)[1];
const r = await fetch(`https://api.mercadopago.com/applications/${app}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
const body = await r.json().catch(() => ({}));
const SECRET = /secret|key|token|password/i;
const shown = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, SECRET.test(k) ? `[${typeof v}${v ? ', present' : ', empty'}]` : v]));
console.log(JSON.stringify({ http: r.status, requestId: r.headers.get('x-request-id'), application: app, fields: shown }, null, 1));
