import { createClient } from '../vendor/supabase.js';
import { normalizeBrowserSupabaseKey } from '../core/runtime-config.js';

let cachedClient = null;
let cachedSignature = '';

export function normalizeSupabaseConfig(runtimeConfig = {}) {
  const repository = runtimeConfig?.repository || runtimeConfig || {};
  return {
    supabaseUrl: String(repository.supabaseUrl || repository.url || '').trim(),
    publishableKey: String(repository.publishableKey || repository.anonKey || '').trim(),
    businessId: String(repository.businessId || '').trim(),
  };
}

export function validateSupabaseConfig(runtimeConfig = {}) {
  const config = normalizeSupabaseConfig(runtimeConfig);
  if (!config.supabaseUrl || !config.publishableKey || !config.businessId) {
    throw new Error('La configuración productiva de Supabase está incompleta.');
  }

  let url;
  try {
    url = new URL(config.supabaseUrl);
  } catch (_) {
    throw new Error('La URL productiva de Supabase no es válida.');
  }

  const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(localHost && url.protocol === 'http:')) {
    throw new Error('Supabase productivo requiere HTTPS.');
  }

  if (!isUuid(config.businessId)) {
    throw new Error('El businessId productivo no es válido.');
  }

  const publishableKey = normalizeBrowserSupabaseKey(config.publishableKey);
  if (!publishableKey) {
    throw new Error('La publishableKey de Supabase no es segura para navegador.');
  }

  return {
    ...config,
    supabaseUrl: url.toString().replace(/\/+$/, ''),
    publishableKey,
  };
}

export function createConfiguredSupabaseClient(runtimeConfig, {
  createClientImpl = createClient,
  storage = safeLocalStorage(),
  persistSession = true,
  headers = {},
} = {}) {
  const config = validateSupabaseConfig(runtimeConfig);
  const auth = {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: Boolean(persistSession),
  };
  if (storage && persistSession) auth.storage = storage;

  return createClientImpl(config.supabaseUrl, config.publishableKey, {
    auth,
    global: {
      headers: {
        'x-client-info': 'taba-web-production',
        ...headers,
      },
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
}

export function getSupabaseClient(runtimeConfig, options = {}) {
  const config = validateSupabaseConfig(runtimeConfig);
  const signature = `${config.supabaseUrl}\u0000${config.publishableKey}\u0000${config.businessId}`;
  if (cachedClient && cachedSignature === signature) return cachedClient;

  cachedClient = createConfiguredSupabaseClient(config, options);
  cachedSignature = signature;
  return cachedClient;
}

export function resetSupabaseClientForTests() {
  cachedClient = null;
  cachedSignature = '';
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (_) {
    return null;
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}
