import { assertOrderRepository } from './order_repository.js';
import { createDemoOrderRepository } from './demo_order_repository.js';
import { createHttpOrderRepository } from './http_order_repository.js';
import { createRealtimeOrderRepository } from './realtime_order_repository.js';
import { createSupabaseOrderRepository, DEFAULT_SUPABASE_BUSINESS_ID } from './supabase_order_repository.js';

let orderRepository = null;
let repositoryDiagnostic = null;

export function getDataMode() {
  const params = readParams();
  const requested = params.get('data') || params.get('mode') || '';
  if (requested === 'supabase') return 'supabase';
  if ((requested === 'production' || requested === 'backend') && hasSupabaseConfig(params)) return 'supabase';
  if (requested === 'production' || requested === 'backend' || requested === 'http') return 'http';
  if (params.get('relay')) return 'demo-realtime';
  return 'demo';
}

export function getOrderRepository() {
  if (orderRepository) return orderRepository;

  const mode = getDataMode();
  repositoryDiagnostic = null;
  if (mode === 'supabase') {
    const options = readSupabaseOptions(readParams());
    if (options.supabaseUrl && options.anonKey) {
      try {
        orderRepository = assertOrderRepository(createSupabaseOrderRepository(options));
        return orderRepository;
      } catch (error) {
        // Config presente pero inválida: no dejamos la UI rota, caemos a demo
        // y dejamos un diagnóstico técnico (no se muestra al cliente normal).
        repositoryDiagnostic = {
          level: 'error',
          requestedMode: 'supabase',
          message: `Supabase no se pudo inicializar: ${error?.message || 'configuración inválida'}. Usando demo local.`,
        };
      }
    } else {
      repositoryDiagnostic = {
        level: 'warn',
        requestedMode: 'supabase',
        message: 'Pediste data=supabase pero falta supabaseUrl/anonKey. Usando demo local.',
      };
    }
  }

  if (mode === 'http') {
    const apiBase = readParams().get('api');
    if (apiBase) {
      orderRepository = assertOrderRepository(createHttpOrderRepository({ baseUrl: apiBase }));
      return orderRepository;
    }
    repositoryDiagnostic = {
      level: 'warn',
      requestedMode: 'http',
      message: 'Pediste backend http pero falta el parámetro api. Usando demo local.',
    };
  }

  const demoRepository = createDemoOrderRepository();
  orderRepository = assertOrderRepository(mode === 'demo-realtime'
    ? createRealtimeOrderRepository(demoRepository)
    : demoRepository);
  return orderRepository;
}

// Diagnóstico técnico del fallback (null si todo ok). Pensado para un aviso
// discreto, nunca para el cliente final.
export function getRepositoryDiagnostic() {
  return repositoryDiagnostic;
}

export function startOrderRepositorySync() {
  const repository = getOrderRepository();
  if (typeof repository.startSync === 'function') return repository.startSync();
  return () => {};
}

export function isPersistentOrderRepository(repository = getOrderRepository()) {
  return repository?.mode === 'supabase' || repository?.mode === 'http';
}

export function resetRepositoryFactoryForTests() {
  orderRepository = null;
  repositoryDiagnostic = null;
}

function readParams() {
  try {
    return new URLSearchParams(globalThis.location?.search || '');
  } catch (_) {
    return new URLSearchParams('');
  }
}

function hasSupabaseConfig(params) {
  return Boolean(params.get('supabaseUrl') && (params.get('supabaseAnonKey') || params.get('supabaseKey')));
}

function readSupabaseOptions(params) {
  return {
    supabaseUrl: params.get('supabaseUrl') || '',
    anonKey: params.get('supabaseAnonKey') || params.get('supabaseKey') || '',
    businessId: params.get('businessId') || DEFAULT_SUPABASE_BUSINESS_ID,
    pollMs: Number(params.get('pollMs')) || 5000,
  };
}
