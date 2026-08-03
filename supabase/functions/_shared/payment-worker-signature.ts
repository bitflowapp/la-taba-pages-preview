export const PAYMENT_WORKER_SIGNATURE_MAX_AGE_SECONDS = 120;
export const PAYMENT_WORKER_SIGNATURE_MAX_FUTURE_SECONDS = 30;
export const PAYMENT_WORKER_CANONICAL_PATH = '/functions/v1/mercadopago-payment-worker';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export type PaymentWorkerSignatureInput = {
  secret: string;
  timestamp: string;
  nonce: string;
  signature: string;
  nowSeconds?: number;
};

export function paymentWorkerManifest(timestamp: string, nonce: string): string {
  return `${timestamp}.${nonce}.POST.${PAYMENT_WORKER_CANONICAL_PATH}`;
}

export async function signPaymentWorkerRequest(
  secret: string,
  timestamp: string,
  nonce: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(paymentWorkerManifest(timestamp, nonce)),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function validatePaymentWorkerSignature(input: PaymentWorkerSignatureInput): Promise<boolean> {
  const timestamp = input.timestamp.trim();
  const nonce = input.nonce.trim();
  const signature = input.signature.trim().toLowerCase();
  if (!/^\d{10}$/.test(timestamp) || !UUID_PATTERN.test(nonce) || !SHA256_PATTERN.test(signature)) return false;

  const nowSeconds = Math.floor(input.nowSeconds ?? Date.now() / 1000);
  const signedAt = Number(timestamp);
  const ageSeconds = nowSeconds - signedAt;
  if (!Number.isSafeInteger(signedAt)
    || ageSeconds > PAYMENT_WORKER_SIGNATURE_MAX_AGE_SECONDS
    || ageSeconds < -PAYMENT_WORKER_SIGNATURE_MAX_FUTURE_SECONDS) {
    return false;
  }

  const expected = await signPaymentWorkerRequest(input.secret, timestamp, nonce);
  return timingSafeHexEqual(signature, expected);
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) {
    different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return different === 0;
}
