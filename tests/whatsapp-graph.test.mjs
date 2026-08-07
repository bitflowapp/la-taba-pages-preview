import assert from 'node:assert/strict';
import test from 'node:test';

import { createGraphSender } from '../supabase/functions/_shared/whatsapp/graph.js';

function response(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function sender(responses, options = {}) {
  const requests = [];
  const waits = [];
  const queue = [...responses];
  const client = createGraphSender({
    phoneNumberId: '900000000000000',
    accessToken: 'token-de-servidor',
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (ms) => { waits.push(ms); },
    baseDelayMs: 100,
    ...options,
  });
  return { client, requests, waits };
}

test('un envío exitoso devuelve el identificador de Meta', async () => {
  const { client, requests } = sender([response(200, { messages: [{ id: 'wamid.out.1' }] })]);
  const result = await client.send({ messaging_product: 'whatsapp', to: '549', type: 'text' });
  assert.deepEqual(result, { ok: true, status: 200, providerMessageId: 'wamid.out.1' });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^https:\/\/graph\.facebook\.com\/v21\.0\/900000000000000\/messages$/);
  assert.equal(requests[0].init.headers.authorization, 'Bearer token-de-servidor');
});

test('un 429 se reintenta respetando Retry-After', async () => {
  const { client, waits } = sender([
    response(429, { error: { code: 131056 } }, { 'retry-after': '2' }),
    response(200, { messages: [{ id: 'wamid.out.2' }] }),
  ]);
  const result = await client.send({});
  assert.equal(result.ok, true);
  assert.deepEqual(waits, [2000]);
});

test('un 5xx se reintenta con espera creciente y termina informando', async () => {
  const { client, waits } = sender([response(500), response(502), response(503)]);
  const result = await client.send({});
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.deepEqual(waits, [100, 200]);
});

test('un 4xx que no es 429 no se reintenta', async () => {
  const { client, requests } = sender([response(400, { error: { code: 100 } })]);
  const result = await client.send({});
  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.equal(result.errorCode, '100');
  assert.equal(requests.length, 1);
});

test('una caída de red se reintenta y se declara reintentable', async () => {
  const { client, requests } = sender([new Error('socket hang up'), new Error('socket hang up'), new Error('socket hang up')]);
  const result = await client.send({});
  assert.equal(result.retryable, true);
  assert.equal(result.errorCode, 'network_or_timeout');
  assert.equal(requests.length, 3);
});

test('marcar leído usa el mismo endpoint y el contrato de la Cloud API', async () => {
  const { client, requests } = sender([response(200, { success: true })]);
  await client.markRead('wamid.in.1');
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: 'wamid.in.1',
  });
});

test('sin credenciales el emisor no se construye', () => {
  assert.throws(() => createGraphSender({ phoneNumberId: '', accessToken: 'x' }));
  assert.throws(() => createGraphSender({ phoneNumberId: 'x', accessToken: '' }));
});
