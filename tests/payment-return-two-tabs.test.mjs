// Two browser tabs share one cart and one checkout record (both live in localStorage) but not their JavaScript
// memory. If both tabs verify the same approved payment at the same moment, the paid units must leave the cart ONCE:
// a second removal would take products the customer added after the checkout began.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { paymentStatusPresentation } from '../js/payments/mercadopago-checkout.js';

const source = fs.readFileSync(new URL('../js/payments/mercadopago-return.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '');
const P = '22222222-2222-4222-8222-222222222222';
const CHECKOUT = '33333333-3333-4333-8333-333333333333';

// Web Locks semantics, enough for this test: one holder per name at a time, FIFO.
function locks() {
  const queues = new Map();
  return {
    request(name, callback) {
      const previous = queues.get(name) || Promise.resolve();
      const run = previous.then(() => callback({ name }));
      queues.set(name, run.catch(() => {}));
      return run;
    },
  };
}

async function twoTabs({ withLocks }) {
  // Shared browser state.
  const shared = { cart: [{ productId: P, quantity: 3 }], combos: [], record: { checkoutSessionId: CHECKOUT, items: [{ productId: P, quantity: 1 }], combos: [] } };
  const lockManager = locks();
  const releases = [];
  const decrement = (rows, key, id) => {
    const row = rows.find(r => r[key] === id);
    if (row) row.quantity -= 1;
    return rows.filter(r => r.quantity > 0);
  };
  const tab = () => {
    const events = new Map();
    const repository = {
      getMercadoPagoCheckoutRecovery: () => (shared.record ? structuredClone(shared.record) : null),
      getMercadoPagoCheckoutStatus: () => new Promise(resolve => releases.push(() => resolve({ ok: true, checkout: { status: 'completed', payment_status: 'completed', items: [{ product_id: P, quantity: 1 }] } }))),
      clearMercadoPagoCheckoutRecovery: () => { shared.record = null; },
    };
    const context = vm.createContext({
      getOrderRepository: () => repository, paymentStatusPresentation,
      decrementCartItem: id => { shared.cart = decrement(shared.cart, 'productId', id); return { ok: true }; },
      decrementComboItem: id => { shared.combos = decrement(shared.combos, 'comboId', id); return { ok: true }; },
      navigator: withLocks ? { onLine: true, locks: lockManager } : { onLine: true },
      location: { search: '' },
      document: { querySelector: () => ({ dataset: {} }) },
      window: { addEventListener: (name, fn) => events.set(name, fn), setTimeout: () => 1, clearTimeout: () => {} },
    });
    vm.runInContext(source, context);
  };
  tab(); tab();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases.length, 2, 'both tabs asked the server for the same checkout');
  // The server answers both tabs "approved" at the same moment.
  for (const release of releases) release();
  await new Promise(resolve => setTimeout(resolve, 20));
  return shared;
}

test('two tabs verifying the same approved checkout remove the paid units once, not twice', async () => {
  const shared = await twoTabs({ withLocks: true });
  assert.deepEqual(shared.cart, [{ productId: P, quantity: 2 }], 'the second tab removed units that were never paid');
  assert.equal(shared.record, null);
});

test('without Web Locks the same guarantee holds as far as the browser allows (record is taken before items leave)', async () => {
  const shared = await twoTabs({ withLocks: false });
  assert.deepEqual(shared.cart, [{ productId: P, quantity: 2 }]);
});
