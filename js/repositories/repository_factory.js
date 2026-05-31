import { assertOrderRepository } from './order_repository.js';
import { createDemoOrderRepository } from './demo_order_repository.js';
import { createHttpOrderRepository } from './http_order_repository.js';
import { createRealtimeOrderRepository } from './realtime_order_repository.js';

let orderRepository = null;

export function getDataMode() {
  const params = readParams();
  const requested = params.get('data') || params.get('mode') || '';
  if (requested === 'production' || requested === 'backend' || requested === 'http') return 'http';
  if (params.get('relay')) return 'demo-realtime';
  return 'demo';
}

export function getOrderRepository() {
  if (orderRepository) return orderRepository;

  const mode = getDataMode();
  if (mode === 'http') {
    const apiBase = readParams().get('api');
    if (apiBase) {
      orderRepository = assertOrderRepository(createHttpOrderRepository({ baseUrl: apiBase }));
      return orderRepository;
    }
  }

  const demoRepository = createDemoOrderRepository();
  orderRepository = assertOrderRepository(mode === 'demo-realtime'
    ? createRealtimeOrderRepository(demoRepository)
    : demoRepository);
  return orderRepository;
}

export function resetRepositoryFactoryForTests() {
  orderRepository = null;
}

function readParams() {
  try {
    return new URLSearchParams(globalThis.location?.search || '');
  } catch (_) {
    return new URLSearchParams('');
  }
}
