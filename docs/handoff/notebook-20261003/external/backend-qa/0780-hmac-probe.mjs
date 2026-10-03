import fs from 'node:fs';
import { createHmac } from 'node:crypto';

const secret = fs.readFileSync('mp-webhook-secret.txt', 'utf8').trim();
const cap = JSON.parse(fs.readFileSync('capture-payment.json', 'utf8')).capture_body;
const h = cap.headers;
const sig = h['x-signature'];
const ts = /ts=([^,]+)/.exec(sig)[1];
const v1 = /v1=([0-9a-f]+)/.exec(sig)[1];
const rid = h['x-request-id'];
const id = cap.query['data.id'] || cap.query.id;
const body = cap.body;

const variants = {
  'canonico': `id:${id};request-id:${rid};ts:${ts};`,
  'sin punto y coma final': `id:${id};request-id:${rid};ts:${ts}`,
  'sin request-id': `id:${id};ts:${ts};`,
  'solo ts e id invertido': `ts:${ts};id:${id};`,
  'con topic': `id:${id};request-id:${rid};ts:${ts};topic:payment;`,
  'body crudo': body,
  'ts punto body': `${ts}.${body}`,
  'ts body': `${ts}${body}`,
  'id del evento': `id:${JSON.parse(body).id};request-id:${rid};ts:${ts};`,
  'user_id': `id:${id};request-id:${rid};ts:${ts};user-id:${JSON.parse(body).user_id};`,
  'mayusculas': `ID:${id};REQUEST-ID:${rid};TS:${ts};`,
};

console.log('secret len:', secret.length, '| v1:', v1.slice(0, 16), '| ts:', ts);
console.log('id:', id, '| request-id:', rid);
let hit = false;
for (const [name, manifest] of Object.entries(variants)) {
  for (const enc of ['utf8', 'hex', 'base64']) {
    let key;
    try { key = enc === 'utf8' ? Buffer.from(secret, 'utf8') : Buffer.from(secret, enc); } catch { continue; }
    const digest = createHmac('sha256', key).update(manifest).digest('hex');
    if (digest === v1) { console.log(`>>> COINCIDE: "${name}" con clave ${enc}`); hit = true; }
  }
}
if (!hit) console.log('Ninguna variante coincide con este secret.');
