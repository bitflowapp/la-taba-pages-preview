export const RUNTIME_CONFIG_GLOBAL_KEY = '__LA_TABA_RUNTIME_CONFIG__';
export const RUNTIME_MODE_PRODUCTION = 'production';
export const RUNTIME_REPOSITORY_SUPABASE = 'supabase';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_POLL_MS = 5000;
const MIN_POLL_MS = 1000;
const MAX_POLL_MS = 60000;
let productionCatalogReady = false;

/**
 * Runtime configuration is deployment-owned and must be defined before app.js:
 *
 * globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
 *   mode: 'production',
 *   repository: {
 *     provider: 'supabase',
 *     supabaseUrl: 'https://project.supabase.co',
 *     publishableKey: '...',
 *     businessId: '00000000-0000-4000-8000-000000000000',
 *     pollMs: 5000,
 *   },
 * };
 *
 * Query strings are deliberately not read by this module.
 */
export function readRuntimeConfigSource(globalObject = globalThis) {
  try {
    return globalObject?.[RUNTIME_CONFIG_GLOBAL_KEY] ?? null;
  } catch (_) {
    return null;
  }
}

export function resolveRuntimeConfig(source = readRuntimeConfigSource()) {
  if (source === null || source === undefined) {
    return freezeResult({
      status: 'absent',
      productionRequested: false,
      isProductionReady: false,
      repository: null,
      errors: [],
    });
  }

  const errors = [];
  if (!isRecord(source)) {
    return invalidResult(['La configuración de despliegue debe ser un objeto.']);
  }

  if (normalizeToken(source.mode) !== RUNTIME_MODE_PRODUCTION) {
    errors.push('El modo de despliegue debe ser production.');
  }

  const repository = source.repository;
  if (!isRecord(repository)) {
    errors.push('Falta la configuración del repositorio de pedidos.');
    return invalidResult(errors);
  }

  const provider = normalizeToken(repository.provider || repository.type || repository.mode);
  let normalizedRepository = null;

  if (provider === RUNTIME_REPOSITORY_SUPABASE) {
    normalizedRepository = normalizeSupabaseRepository(repository, errors);
  } else {
    errors.push('El proveedor productivo debe ser supabase.');
  }

  if (errors.length || !normalizedRepository) return invalidResult(errors);

  return freezeResult({
    status: 'ready',
    productionRequested: true,
    isProductionReady: true,
    repository: normalizedRepository,
    errors: [],
  });
}

export function isProductionRuntimeReady(source = readRuntimeConfigSource()) {
  return resolveRuntimeConfig(source).isProductionReady;
}

// Hook fail-closed para el futuro adapter de catálogo. Debe activarse recién
// después de guardar en estado productos remotos verificados; la configuración
// de transporte por sí sola nunca habilita el catálogo estático de la demo.
export function setProductionCatalogReady(ready) {
  productionCatalogReady = ready === true;
  return productionCatalogReady;
}

export function isProductionCatalogReady() {
  return productionCatalogReady;
}

function normalizeSupabaseRepository(repository, errors) {
  const supabaseUrl = normalizeSecureUrl(repository.supabaseUrl);
  const publishableKey = normalizeBrowserSupabaseKey(repository.publishableKey || repository.anonKey);
  const businessId = String(repository.businessId || '').trim();
  const pollMs = normalizePollMs(repository.pollMs);

  if (!supabaseUrl) {
    errors.push('Supabase requiere HTTPS; HTTP sólo se admite para localhost en pruebas locales.');
  }
  if (!publishableKey) {
    errors.push('Supabase requiere una publishableKey pública y no privilegiada.');
  }
  if (!UUID_PATTERN.test(businessId)) errors.push('Supabase requiere un businessId UUID válido.');
  if (repository.pollMs !== undefined && pollMs === null) {
    errors.push(`pollMs debe estar entre ${MIN_POLL_MS} y ${MAX_POLL_MS}.`);
  }

  if (errors.length) return null;
  return {
    provider: RUNTIME_REPOSITORY_SUPABASE,
    supabaseUrl,
    publishableKey,
    businessId,
    pollMs: pollMs ?? DEFAULT_POLL_MS,
  };
}

function normalizeSecureUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    const isLocalSupabase = parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname);
    if (
      (parsed.protocol !== 'https:' && !isLocalSupabase)
      || !parsed.hostname
      || parsed.username
      || parsed.password
    ) return '';
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '[::1]';
}

export function normalizeBrowserSupabaseKey(value) {
  const normalized = String(value || '').trim();
  if (normalized.length < 8) return '';

  const lowerKey = normalized.toLowerCase();
  if (lowerKey.startsWith('sb_')) {
    const publishablePrefix = 'sb_publishable_';
    if (!lowerKey.startsWith(publishablePrefix)) return '';
    return normalized.length >= publishablePrefix.length + 8 ? normalized : '';
  }

  const jwtParts = normalized.split('.');
  if (jwtParts.length === 3) {
    const payload = decodeJwtPayload(jwtParts[1]);
    if (!payload || normalizeToken(payload.role) !== 'anon') return '';
  }

  return normalized;
}

function decodeJwtPayload(encodedPayload) {
  try {
    if (!encodedPayload || typeof globalThis.atob !== 'function') return null;
    const base64 = encodedPayload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=');
    const binary = globalThis.atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const payload = JSON.parse(decoded);
    return isRecord(payload) ? payload : null;
  } catch (_) {
    return null;
  }
}

function normalizePollMs(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_POLL_MS;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < MIN_POLL_MS || normalized > MAX_POLL_MS) return null;
  return normalized;
}

function invalidResult(errors) {
  return freezeResult({
    status: 'invalid',
    productionRequested: true,
    isProductionReady: false,
    repository: null,
    errors: errors.length ? errors : ['La configuración productiva está incompleta.'],
  });
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function freezeResult(result) {
  if (result.repository) Object.freeze(result.repository);
  Object.freeze(result.errors);
  return Object.freeze(result);
}
