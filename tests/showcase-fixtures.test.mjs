import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import {
  SHOWCASE_SYNTHETIC_CUSTOMER,
  isShowcaseFixtureOrder,
  prepareShowcaseScenario,
} from '../js/showcase-fixtures.js';
import {
  getOrderRepository,
  resetRepositoryFactoryForTests,
  startOrderRepositorySync,
} from '../js/repositories/repository_factory.js';
import { pauseSimulation } from '../js/simulation.js';
import { getState } from '../js/state.js';
import { products } from '../js/data.js';
import { resetState } from './helpers.mjs';

let stopSync = null;

beforeEach(() => {
  stopSync = null;
  setLocationSearch('?showcase=1');
  resetRepositoryFactoryForTests();
  resetState({ products });
});

afterEach(() => {
  stopSync?.();
  stopSync = null;
  pauseSimulation();
  resetRepositoryFactoryForTests();
  setLocationSearch('');
});

test('showcase crea un único pedido claramente sintético mediante el repositorio real', async () => {
  stopSync = await startOrderRepositorySync();
  const first = await prepareShowcaseScenario('business-new');
  const second = await prepareShowcaseScenario('business-new');

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const operational = getState().orders.filter((order) => !order.internalSeed);
  assert.equal(operational.length, 1);
  assert.equal(operational[0].status, 'received');
  assert.equal(isShowcaseFixtureOrder(operational[0]), true);
  assert.equal(operational[0].customerName, SHOWCASE_SYNTHETIC_CUSTOMER.name);
  assert.equal(operational[0].customerPhone, SHOWCASE_SYNTHETIC_CUSTOMER.phone);
  assert.match(operational[0].address, /Ficticia|Demo/i);
});

test('showcase recorre transiciones reales hasta rider, mapa y estado entregado', async () => {
  stopSync = await startOrderRepositorySync();

  const rider = await prepareShowcaseScenario('rider');
  assert.equal(rider.ok, true);
  assert.equal(rider.status, 'ready');

  const tracking = await prepareShowcaseScenario('tracking-map');
  assert.equal(tracking.ok, true);
  assert.equal(tracking.status, 'on_the_way');
  assert.equal(getState().simulation?.origin, 'sandbox_route');
  assert.equal(getState().simulation?.sandboxMode, true);

  const delivered = await prepareShowcaseScenario('delivered');
  assert.equal(delivered.ok, true);
  assert.equal(delivered.status, 'delivered');
  const order = getState().orders.find((candidate) => candidate.id === delivered.orderId);
  assert.equal(order.status, 'delivered');
  assert.ok(order.deliveryCode?.confirmedAt);
  assert.equal(getState().simulation, null);
});

test('showcase falla cerrado fuera de showcase=1', async () => {
  setLocationSearch('?demo=1');
  resetRepositoryFactoryForTests();
  const repository = getOrderRepository();
  const result = await prepareShowcaseScenario('business-new', { repository });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'SHOWCASE_DISABLED');
  assert.equal(getState().orders.some((order) => isShowcaseFixtureOrder(order)), false);
});

function setLocationSearch(search) {
  Object.defineProperty(globalThis, 'location', {
    value: { search },
    configurable: true,
  });
}
