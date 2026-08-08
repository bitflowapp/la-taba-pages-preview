import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { addToCart } from '../js/cart.js';
import {
  canTransitionSandboxStatus,
  createSandboxOrderRepository,
  isSandboxOrderRepository,
  SANDBOX_SCHEMA_VERSION,
} from '../js/repositories/sandbox_order_repository.js';
import { getState } from '../js/state.js';
import { CONFIRMED_DELIVERY_POINT, resetState } from './helpers.mjs';

beforeEach(() => resetState());

test('sandbox repository exposes a versioned local contract and validates transitions', () => {
  const repository = createSandboxOrderRepository();

  assert.equal(isSandboxOrderRepository(repository), true);
  assert.equal(SANDBOX_SCHEMA_VERSION, 1);
  assert.equal(canTransitionSandboxStatus('received', 'preparing'), true);
  assert.equal(canTransitionSandboxStatus('received', 'delivered'), false);
  assert.equal(canTransitionSandboxStatus('delivered', 'preparing'), false);
  assert.equal(canTransitionSandboxStatus('ready', 'cancelled'), true);
});

test('sandbox repository creates an order and rejects a second rider claim', async () => {
  addToCart('qa-gaseosa-cola', 1);
  const repository = createSandboxOrderRepository();
  const created = repository.createOrder({
    customerName: 'Cliente Sandbox',
    customerPhone: '2995550000',
    customerAddress: 'Mendoza 851, Centro',
    customerStreetAddress: 'Mendoza 851',
    customerNeighborhood: 'Centro',
    ...CONFIRMED_DELIVERY_POINT,
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
  });

  assert.equal(created.ok, true);
  const orderId = created.order.id;
  assert.equal(repository.updateOrderStatus(orderId, 'accepted').ok, true);
  assert.equal(repository.updateOrderStatus(orderId, 'ready').ok, true);

  const firstClaim = await repository.claimRiderOrder(orderId, { riderId: 'sandbox-rider-a' });
  const secondClaim = await repository.claimRiderOrder(orderId, { riderId: 'sandbox-rider-b' });

  assert.equal(firstClaim.ok, true);
  assert.equal(secondClaim.ok, false);
  assert.equal(getState().orders.find((order) => order.id === orderId).assignedRiderId, 'sandbox-rider-a');
});
