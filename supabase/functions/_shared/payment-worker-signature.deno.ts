import {
  PAYMENT_WORKER_CANONICAL_PATH,
  paymentWorkerManifest,
  signPaymentWorkerRequest,
  validatePaymentWorkerSignature,
} from './payment-worker-signature.ts';

const SECRET = 'staging-worker-secret-with-at-least-32-bytes';
const TIMESTAMP = '1785729600';
const NONCE = '6e964e18-a642-4de7-94bf-0d308a1f7c67';

Deno.test('worker acepta HMAC válido dentro de la tolerancia', async () => {
  const signature = await signPaymentWorkerRequest(SECRET, TIMESTAMP, NONCE);
  assert(await validatePaymentWorkerSignature({
    secret: SECRET,
    timestamp: TIMESTAMP,
    nonce: NONCE,
    signature,
    nowSeconds: Number(TIMESTAMP) + 60,
  }));
});

Deno.test('worker rechaza secret, firma, nonce y timestamp incorrectos', async () => {
  const signature = await signPaymentWorkerRequest(SECRET, TIMESTAMP, NONCE);
  const alteredSignature = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;
  assert(!await validatePaymentWorkerSignature({
    secret: `${SECRET}-wrong`, timestamp: TIMESTAMP, nonce: NONCE, signature, nowSeconds: Number(TIMESTAMP),
  }));
  assert(!await validatePaymentWorkerSignature({
    secret: SECRET, timestamp: TIMESTAMP, nonce: NONCE, signature: alteredSignature, nowSeconds: Number(TIMESTAMP),
  }));
  assert(!await validatePaymentWorkerSignature({
    secret: SECRET, timestamp: TIMESTAMP, nonce: 'not-a-uuid', signature, nowSeconds: Number(TIMESTAMP),
  }));
  assert(!await validatePaymentWorkerSignature({
    secret: SECRET, timestamp: 'not-a-time', nonce: NONCE, signature, nowSeconds: Number(TIMESTAMP),
  }));
});

Deno.test('worker rechaza replay vencido y fecha futura fuera de tolerancia', async () => {
  const signature = await signPaymentWorkerRequest(SECRET, TIMESTAMP, NONCE);
  assert(!await validatePaymentWorkerSignature({
    secret: SECRET, timestamp: TIMESTAMP, nonce: NONCE, signature, nowSeconds: Number(TIMESTAMP) + 121,
  }));
  assert(!await validatePaymentWorkerSignature({
    secret: SECRET, timestamp: TIMESTAMP, nonce: NONCE, signature, nowSeconds: Number(TIMESTAMP) - 31,
  }));
});

Deno.test('manifest canónico coincide con el contrato SQL del scheduler', () => {
  assertEquals(PAYMENT_WORKER_CANONICAL_PATH, '/functions/v1/mercadopago-payment-worker');
  assertEquals(
    paymentWorkerManifest(TIMESTAMP, NONCE),
    `${TIMESTAMP}.${NONCE}.POST./functions/v1/mercadopago-payment-worker`,
  );
});

function assert(value: unknown): asserts value {
  if (!value) throw new Error('Expected value to be truthy');
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}
