import fs from 'node:fs';
import { createHmac } from 'node:crypto';

const secret = fs.readFileSync('mp-webhook-secret.txt', 'utf8').trim();
const files = fs.readdirSync('.').filter((f) => /^cap-\d+\.json$/.test(f));

const manifestsFor = (cap) => {
  const h = cap.headers;
  const sig = h['x-signature'] || '';
  const ts = (/ts=([^,]+)/.exec(sig) || [])[1] || '';
  const rid = h['x-request-id'] || '';
  const id = cap.query['data.id'] || cap.query.id || '';
  const body = cap.body || '';
  let parsed = {};
  try { parsed = JSON.parse(body); } catch { /* legacy IPN body */ }
  const resource = String(parsed.resource || '');
  const resourceTail = resource.split('/').pop() || '';
  const topic = cap.query.topic || cap.query.type || '';
  return {
    canonico: `id:${id};request-id:${rid};ts:${ts};`,
    sin_punto_final: `id:${id};request-id:${rid};ts:${ts}`,
    sin_request_id: `id:${id};ts:${ts};`,
    solo_id: `id:${id};`,
    con_topic: `id:${id};request-id:${rid};ts:${ts};topic:${topic};`,
    topic_primero: `topic:${topic};id:${id};request-id:${rid};ts:${ts};`,
    recurso_completo: `id:${resource};request-id:${rid};ts:${ts};`,
    recurso_cola: `id:${resourceTail};request-id:${rid};ts:${ts};`,
    id_evento: parsed.id ? `id:${parsed.id};request-id:${rid};ts:${ts};` : '',
    body_crudo: body,
    ts_punto_body: `${ts}.${body}`,
    ts_body: `${ts}${body}`,
    rid_ts: `request-id:${rid};ts:${ts};`,
    user_id: parsed.user_id ? `id:${id};request-id:${rid};ts:${ts};user-id:${parsed.user_id};` : '',
  };
};

let anyHit = false;
for (const file of files) {
  const cap = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sig = cap.headers['x-signature'] || '';
  const v1 = (/v1=([0-9a-f]+)/.exec(sig) || [])[1] || '';
  const label = `${cap.query.topic || cap.query.type} ${cap.query['data.id'] || cap.query.id}`;
  let hit = null;
  for (const [name, manifest] of Object.entries(manifestsFor(cap))) {
    if (!manifest) continue;
    for (const enc of ['utf8', 'hex', 'base64']) {
      let key;
      try { key = enc === 'utf8' ? Buffer.from(secret, 'utf8') : Buffer.from(secret, enc); } catch { continue; }
      if (createHmac('sha256', key).update(manifest).digest('hex') === v1) hit = `${name} / ${enc}`;
    }
  }
  console.log(`${file}  [${label}]  -> ${hit || 'sin coincidencia'}`);
  if (hit) anyHit = true;
}
console.log(anyHit ? '\nAL MENOS UNA COINCIDE' : '\nNINGUNA notificación de preferencia valida con el secret del panel.');
