// Compuerta local FALSA para las pruebas de unidad del destino local del certificador e-commerce
// (scripts/e2e-staging/ecommerce/local-target.mjs). Apunta a un servidor eco en loopback (puerto en
// FAKE_GATE_PORT), firma tokens con un secreto de prueba y no abre ninguna base de datos.
import { createHmac } from 'node:crypto';

export const REST_URL = `http://127.0.0.1:${process.env.FAKE_GATE_PORT}`;
export const DB = 'fake_gate_db';
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
export function mint(claims, ttlSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ aud: 'authenticated', iat: now, exp: now + ttlSeconds, ...claims })}`;
  return `${body}.${createHmac('sha256', 'fake-gate-test-only').update(body).digest('base64url')}`;
}
export const tokens = { anon: () => mint({ role: 'anon' }), service: () => mint({ role: 'service_role' }) };
export const pg = async () => { throw Error('the fake gate has no database'); };
