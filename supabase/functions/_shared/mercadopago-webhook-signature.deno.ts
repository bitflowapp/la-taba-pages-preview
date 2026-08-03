import { validateMercadoPagoWebhookSignature } from './mercadopago-webhook-signature.ts';

const NOW_MS = 1_780_000_000_000;
const SECRET = 'webhook-test-secret';
const DATA_ID = '123456789';
const REQUEST_ID = 'request-abc';

async function signature({
  secret = SECRET,
  dataId = DATA_ID,
  requestId = REQUEST_ID,
  timestamp = Math.floor(NOW_MS / 1000),
}: {
  secret?: string;
  dataId?: string;
  requestId?: string;
  timestamp?: number;
} = {}) {
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
  return `ts=${timestamp},v1=${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function validate(overrides: Partial<Parameters<typeof validateMercadoPagoWebhookSignature>[0]> = {}) {
  return validateMercadoPagoWebhookSignature({
    signature: '',
    requestId: REQUEST_ID,
    dataId: DATA_ID,
    secret: SECRET,
    nowMs: NOW_MS,
    ...overrides,
  });
}

Deno.test('Mercado Pago webhook: firma válida', async () => {
  const valid = await signature();
  if (!validate({ signature: valid })) throw new Error('expected valid signature');
});

Deno.test('Mercado Pago webhook: firma inválida, secret erróneo y request ID erróneo', async () => {
  const valid = await signature();
  if (validate({ signature: `${valid}00` })) throw new Error('invalid signature accepted');
  if (validate({ signature: valid, secret: 'another-secret' })) throw new Error('wrong secret accepted');
  if (validate({ signature: valid, requestId: 'another-request' })) throw new Error('wrong request id accepted');
});

Deno.test('Mercado Pago webhook: data.id incorrecto, payload alterado y sin firma', async () => {
  const valid = await signature();
  if (validate({ signature: valid, dataId: '987654321' })) throw new Error('wrong data.id accepted');
  if (validate({ signature: valid, bodyDataId: '987654321' })) throw new Error('altered data payload accepted');
  if (validate({ signature: '' })) throw new Error('missing signature accepted');
});

Deno.test('Mercado Pago webhook: timestamp vencido', async () => {
  const expired = await signature({ timestamp: Math.floor(NOW_MS / 1000) - 301 });
  if (validate({ signature: expired })) throw new Error('expired timestamp accepted');
});
