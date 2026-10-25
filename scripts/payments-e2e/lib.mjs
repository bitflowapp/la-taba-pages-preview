// Utilidades del banco de cobros: credenciales firmadas con el secreto del PostgREST del banco, llamadas a las
// funciones como las hace el navegador o el cron, y lecturas de la base para la evidencia.
import { createHmac, randomUUID } from 'node:crypto';

const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/** JWT HS256 como los que emite Supabase Auth (claims mínimos que usan PostgREST y las funciones). */
export function signJwt(claims, secret, ttlSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: 'supabase', iat: now, exp: now + ttlSeconds, ...claims };
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(body)}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

export function userToken(user, secret) {
  return signJwt({ sub: user.id, role: 'authenticated', aud: 'authenticated', email: user.email,
    session_id: user.sessionId, is_anonymous: false, aal: 'aal1', amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] }, secret);
}

/** Firma de la invocación del worker, como dispatch_payment_outbox_worker (payment-worker-signature.ts). */
export function workerHeaders(secret) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.POST./functions/v1/mercadopago-payment-worker`).digest('hex');
  return { 'x-taba-worker-timestamp': timestamp, 'x-taba-worker-nonce': nonce, 'x-taba-worker-signature': signature };
}

export class FunctionsClient {
  constructor({ gateway, anonKey, origin }) {
    this.gateway = gateway;
    this.anonKey = anonKey;
    this.origin = origin;
    this.log = [];
  }

  async call(name, { token, body, headers = {}, method = 'POST', query = '', ip = '200.0.0.10' } = {}) {
    const response = await fetch(`${this.gateway}/functions/v1/${name}${query}`, {
      method,
      redirect: 'manual',
      headers: {
        'content-type': 'application/json', apikey: this.anonKey, origin: this.origin, 'x-forwarded-for': ip,
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    const entry = { name, status: response.status, code: json?.code ?? null, location: response.headers.get('location') };
    this.log.push(entry);
    return { status: response.status, json, text, location: response.headers.get('location') };
  }
}

/**
 * Corre el worker como el cron: mientras reclame trabajo (en QA reclama de a un trabajo por invocación). El worker
 * real se limita a 30 invocaciones por minuto; ante un 429 se espera como esperaría el próximo minuto del cron.
 */
export async function drainWorker(functions, secret, { maxRuns = 25 } = {}) {
  const runs = [];
  let throttled = 0;
  for (let index = 0; index < maxRuns; index += 1) {
    const result = await functions.call('mercadopago-payment-worker', { headers: workerHeaders(secret), body: {} });
    if (result.status === 429 && throttled < 14) {
      throttled += 1;
      runs.push({ status: 429 });
      await sleep(5000);
      index -= 1;
      continue;
    }
    runs.push({ status: result.status, claimed: result.json?.claimed, completed: result.json?.completed,
      retried: result.json?.retried, ledger: result.json?.ledger ? { ok: result.json.ledger.ok, seen: result.json.ledger.seen, orphans: result.json.ledger.orphans } : null });
    if (result.status !== 200 || !result.json?.claimed) break;
  }
  return runs;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
