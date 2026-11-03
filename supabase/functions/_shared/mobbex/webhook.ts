/**
 * Mobbex webhook handling.
 *
 * WHAT MOBBEX DOCUMENTS (https://mobbex.dev/webhooks, read 2026-11-03):
 *   an HTTP POST with `Content-Type: application/json`, `{ type, data }`, sent to the
 *   `webhook` URL given when the checkout was created, over TLS >= 1.2.
 *   The documentation describes NO signature, HMAC, secret header or any other
 *   authenticity mechanism, and no retry policy. TABA does not invent one.
 *
 * THEREFORE THE TRUST MODEL IS:
 *   1. The webhook body is an UNTRUSTED HINT. Nothing in it marks anything paid.
 *   2. TABA puts its own capability token in the URL it registers at checkout
 *      creation: `?ref=<reference>&t=<HMAC-SHA256(secret, env + reference)>`.
 *      This is TABA's mechanism, not a Mobbex signature. It only keeps
 *      unsolicited traffic away from the database; anyone who learns a URL can
 *      replay it, which is harmless because of (3).
 *   3. The ledger always confirms with an authenticated server-to-server read
 *      (`GET /p/operations/{reference}`, merchant credentials) before changing
 *      any financial state. The browser return never marks anything paid either.
 *   4. A scheduled reconciliation reads the same endpoint, so a lost, delayed or
 *      forged webhook cannot change the outcome.
 */

import { MOBBEX_REFERENCE_PATTERN } from './client.ts';

export const MOBBEX_WEBHOOK_MAX_BYTES = 64_000;

export function mobbexReferenceForSession(checkoutSessionId: string): string {
  const reference = `taba2-mbx-${checkoutSessionId.toLowerCase()}`;
  if (!MOBBEX_REFERENCE_PATTERN.test(reference)) throw new RangeError('checkout session id is not a UUID');
  return reference;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

export async function mobbexWebhookToken(secret: string, environment: string, reference: string): Promise<string> {
  if (secret.length < 32) throw new Error('webhook token secret is too short');
  return toBase64Url(await hmac(secret, `mobbex-webhook-v1:${environment}:${reference}`));
}

/** Constant-time: compares MACs of both values under a throwaway key, so length and content leak nothing. */
export async function verifyMobbexWebhookToken(secret: string, environment: string, reference: string, presented: string): Promise<boolean> {
  if (!MOBBEX_REFERENCE_PATTERN.test(reference) || !/^[A-Za-z0-9_-]{43}$/.test(presented)) return false;
  const expected = await mobbexWebhookToken(secret, environment, reference);
  const pad = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', pad, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [a, b] = await Promise.all([
    crypto.subtle.sign('HMAC', key, new TextEncoder().encode(expected)),
    crypto.subtle.sign('HMAC', key, new TextEncoder().encode(presented)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function buildMobbexWebhookUrl(supabaseUrl: string, secret: string, environment: string, reference: string): Promise<string> {
  const base = new URL(supabaseUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(base.hostname);
  if (base.protocol !== 'https:' || loopback) throw new Error('Mobbex webhook endpoint must use public HTTPS');
  const token = await mobbexWebhookToken(secret, environment, reference);
  return `${base.toString().replace(/\/$/, '')}/functions/v1/mobbex-webhook?ref=${encodeURIComponent(reference)}&t=${token}`;
}

export interface ParsedMobbexWebhook {
  reference: string;
  presentedToken: string;
  /** Hints taken from the body. Used only for diagnostics and mismatch detection, never for state. */
  hintType: string;
  hintReference: string;
  hintStatusCode: string;
  hintPaymentId: string;
}

export type WebhookParseResult = { ok: true; webhook: ParsedMobbexWebhook } | { ok: false; code: 'INVALID_QUERY' | 'INVALID_BODY' | 'REFERENCE_MISMATCH' };

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function parseMobbexWebhook(url: URL, rawBody: string): WebhookParseResult {
  const reference = url.searchParams.get('ref')?.trim() ?? '';
  const presentedToken = url.searchParams.get('t')?.trim() ?? '';
  if (!MOBBEX_REFERENCE_PATTERN.test(reference) || !presentedToken) return { ok: false, code: 'INVALID_QUERY' };
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, code: 'INVALID_BODY' };
    body = parsed as Record<string, unknown>;
  } catch (_) {
    return { ok: false, code: 'INVALID_BODY' };
  }
  const data = asObject(body.data);
  const payment = asObject(data.payment);
  const status = asObject(payment.status);
  const hintReference = typeof payment.reference === 'string' ? payment.reference.trim() : '';
  // A body that names a different reference than the URL it was delivered to is not a Mobbex delivery of ours.
  if (hintReference && hintReference !== reference) return { ok: false, code: 'REFERENCE_MISMATCH' };
  return {
    ok: true,
    webhook: {
      reference,
      presentedToken,
      hintType: typeof body.type === 'string' ? body.type.slice(0, 40) : '',
      hintReference,
      hintStatusCode: typeof status.code === 'string' || typeof status.code === 'number' ? String(status.code).slice(0, 16) : '',
      hintPaymentId: typeof payment.id === 'string' ? payment.id.slice(0, 80) : '',
    },
  };
}
