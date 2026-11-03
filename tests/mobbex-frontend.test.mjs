import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MOBBEX_RECORD_KEY,
  buildMobbexCheckoutPayload,
  clearMobbexCheckoutRecord,
  mobbexStatusPresentation,
  readMobbexCheckoutRecord,
  trustedMobbexCheckoutUrl,
  writeMobbexCheckoutRecord,
} from '../js/payments/mobbex-checkout.js';
import { paymentStatusPresentation } from '../js/payments/mercadopago-checkout.js';

const SESSION = '3f2b8c1e-5a4d-4e7b-9c3a-1d2e3f4a5b6c';
const memoryStorage = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
};

test('the browser only follows an https Mobbex URL', () => {
  assert.equal(trustedMobbexCheckoutUrl('https://mobbex.com/p/checkout/abc'), 'https://mobbex.com/p/checkout/abc');
  assert.equal(trustedMobbexCheckoutUrl('https://checkout.mobbex.com/x').startsWith('https://checkout.mobbex.com/'), true);
  for (const hostile of [
    'http://mobbex.com/x',
    'https://mobbex.com.evil.test/x',
    'https://evilmobbex.com/x',
    'https://user:pass@mobbex.com/x',
    'https://mobbex.com@evil.test/x',
    'javascript:alert(1)',
    '//mobbex.com/x',
    '',
    null,
    undefined,
  ]) assert.equal(trustedMobbexCheckoutUrl(hostile), '', `refused: ${hostile}`);
});

test('the payload names Mobbex, carries no amount and ignores any price the form offers', () => {
  const payload = buildMobbexCheckoutPayload({
    businessId: '11111111-1111-4111-8111-111111111111',
    clientRequestId: 'req-0000000000001',
    values: { deliveryMode: 'pickup', customerName: 'Ana', customerPhone: '5491100000000', total: 1, price: 1, amount: 1, paymentMethod: 'mobbex' },
    items: [{ product_id: '22222222-2222-4222-8222-222222222222', quantity: 2, price: 1, unit_price: 1, total: 1 }],
  });
  assert.equal(payload.payment_method, 'mobbex');
  assert.deepEqual(payload.items, [{ product_id: '22222222-2222-4222-8222-222222222222', quantity: 2 }]);
  const text = JSON.stringify(payload);
  for (const key of ['"total"', '"price"', '"amount"', '"unit_price"', '"subtotal"']) assert.equal(text.includes(key), false, `no ${key} in payload`);
});

test('the checkout record round-trips, expires and is cleared; garbage is never trusted', () => {
  const storage = memoryStorage();
  assert.equal(writeMobbexCheckoutRecord(storage, 'b', 'not-a-uuid'), false);
  assert.equal(readMobbexCheckoutRecord(storage), null);
  assert.equal(writeMobbexCheckoutRecord(storage, 'b', SESSION, { items: [{ productId: 'p1', quantity: 2 }, { productId: '', quantity: 3 }, { productId: 'p2', quantity: 0 }], now: 1_000 }), true);
  const record = readMobbexCheckoutRecord(storage, { now: 2_000 });
  assert.equal(record.checkoutSessionId, SESSION);
  assert.deepEqual(record.items, [{ productId: 'p1', quantity: 2 }]);
  assert.equal(readMobbexCheckoutRecord(storage, { now: 1_000 + 7 * 60 * 60 * 1000 }), null, 'stale record is ignored');
  storage.setItem(MOBBEX_RECORD_KEY, '{not json');
  assert.equal(readMobbexCheckoutRecord(storage), null);
  storage.setItem(MOBBEX_RECORD_KEY, JSON.stringify({ v: 1, checkoutSessionId: 'x', createdAt: Date.now() }));
  assert.equal(readMobbexCheckoutRecord(storage), null);
  writeMobbexCheckoutRecord(storage, 'b', SESSION, { items: [] });
  clearMobbexCheckoutRecord(storage);
  assert.equal(readMobbexCheckoutRecord(storage), null);
});

test('the return page maps server states and a browser-side success never clears the cart', () => {
  assert.equal(mobbexStatusPresentation, paymentStatusPresentation, 'same server contract as Mercado Pago');
  assert.deepEqual(mobbexStatusPresentation({ status: 'completed', payment_status: 'completed' }).clearCart, true);
  // The query string Mobbex appends on return is not an input of this module at all: only the server's states are.
  for (const checkout of [{}, { status: 'payment_pending' }, { payment_status: 'pending' }, { payment_status: 'approved_order_pending' }, { status: 'payment_approved' }]) {
    assert.equal(mobbexStatusPresentation(checkout).clearCart, false, JSON.stringify(checkout));
  }
  assert.equal(mobbexStatusPresentation({ status: 'payment_pending', payment_status: 'rejected' }).state, 'rejected');
  assert.equal(mobbexStatusPresentation({ payment_status: 'security_review_required' }).state, 'manual_review');
});
