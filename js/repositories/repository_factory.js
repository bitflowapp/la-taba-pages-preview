import {
  APP_MODE_DEMO,
  APP_MODE_PRODUCTION,
  APP_MODE_UNAVAILABLE,
  getAppMode,
} from '../core/app-mode.js';
import { resolveRuntimeConfig } from '../core/runtime-config.js';
import {
  createConfiguredSupabaseClient,
  getSupabaseClient,
} from '../services/supabase-client.js';
import { assertOrderRepository } from './order_repository.js';
import { createDemoOrderRepository } from './demo_order_repository.js';
import { createRealtimeOrderRepository } from './realtime_order_repository.js';
import { createSupabaseOrderRepository } from './supabase_order_repository.js';
import { createUnavailableOrderRepository } from './unavailable_order_repository.js';

let orderRepository = null;
let repositoryDiagnostic = null;

export function getDataMode() {
  const appMode = getAppMode();
  if (appMode === APP_MODE_DEMO) {
    return readDemoParams().has('relay') ? 'demo-realtime' : 'demo';
  }
  if (appMode === APP_MODE_PRODUCTION) {
    return resolveRuntimeConfig().repository?.provider || 'unavailable';
  }
  if (appMode === APP_MODE_UNAVAILABLE) return 'unavailable';
  return 'preview';
}

export function getOrderRepository() {
  if (orderRepository) return orderRepository;

  repositoryDiagnostic = null;
  const mode = getDataMode();

  if (mode === 'supabase') {
    return createProductionRepository(mode);
  }

  if (mode === 'unavailable') {
    const runtime = resolveRuntimeConfig();
    repositoryDiagnostic = {
      level: 'error',
      blocking: true,
      code: 'RUNTIME_CONFIG_INVALID',
      requestedMode: 'production',
      message: runtime.errors.join(' ') || 'La configuración productiva está incompleta.',
    };
    orderRepository = assertOrderRepository(createUnavailableOrderRepository());
    return orderRepository;
  }

  const demoRepository = createDemoOrderRepository();
  if (mode === 'demo-realtime') {
    orderRepository = assertOrderRepository(createRealtimeOrderRepository(demoRepository));
  } else if (mode === 'demo') {
    orderRepository = assertOrderRepository(demoRepository);
  } else {
    // Preview usa el motor local, pero conserva un modo explícito para que
    // ninguna integración lo confunda con la presentación ?demo=1.
    orderRepository = assertOrderRepository({ ...demoRepository, mode: 'preview' });
  }
  return orderRepository;
}

export function getRepositoryDiagnostic() {
  return repositoryDiagnostic;
}

export function startOrderRepositorySync() {
  const repository = getOrderRepository();
  if (typeof repository.startSync === 'function') return repository.startSync();
  return () => {};
}

export function isPersistentOrderRepository(repository = getOrderRepository()) {
  return repository?.mode === 'supabase';
}

export function resetRepositoryFactoryForTests() {
  orderRepository = null;
  repositoryDiagnostic = null;
}

function createProductionRepository(mode) {
  const runtime = resolveRuntimeConfig();
  const repositoryConfig = runtime.repository;

  try {
    orderRepository = assertOrderRepository(createSupabaseOrderRepository({
      client: getSupabaseClient(repositoryConfig),
      createTrackingClient: (trackingToken) => createConfiguredSupabaseClient(repositoryConfig, {
        storage: null,
        persistSession: false,
        headers: {
          'x-order-token': trackingToken,
        },
      }),
      businessId: repositoryConfig.businessId,
      pollMs: repositoryConfig.pollMs,
    }));
    return orderRepository;
  } catch (error) {
    repositoryDiagnostic = {
      level: 'error',
      blocking: true,
      code: 'PRODUCTION_REPOSITORY_INIT_FAILED',
      requestedMode: mode,
      message: `El repositorio productivo no se pudo inicializar: ${error?.message || 'configuración inválida'}.`,
    };
    orderRepository = assertOrderRepository(createUnavailableOrderRepository({
      message: 'Los pedidos online no están disponibles. Reintentá más tarde.',
    }));
    return orderRepository;
  }
}

function readDemoParams() {
  try {
    return new URLSearchParams(globalThis.location?.search || '');
  } catch (_) {
    return new URLSearchParams('');
  }
}
