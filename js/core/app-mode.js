import { readRuntimeConfigSource, resolveRuntimeConfig } from './runtime-config.js';

export const APP_DATA_VERSION = 'la-taba-runtime-v2';
export const APP_MODE_PUBLIC = 'public';
export const APP_MODE_DEMO = 'demo';
export const APP_MODE_PRODUCTION = 'production';
export const APP_MODE_UNAVAILABLE = 'unavailable';

export function isDemoMode(search = currentSearch()) {
  try {
    return new URLSearchParams(String(search || '')).get('demo') === '1';
  } catch (_) {
    return false;
  }
}

export function getAppMode(
  search = currentSearch(),
  runtimeSource = readRuntimeConfigSource(),
) {
  // La presentación sólo se habilita con la bandera explícita. Aun en un
  // despliegue productivo, ?demo=1 usa datos locales y nunca el backend.
  if (isDemoMode(search)) return APP_MODE_DEMO;

  const runtime = resolveRuntimeConfig(runtimeSource);
  if (runtime.isProductionReady) return APP_MODE_PRODUCTION;
  if (runtime.productionRequested) return APP_MODE_UNAVAILABLE;
  return APP_MODE_PUBLIC;
}

export function isProductionMode(
  search = currentSearch(),
  runtimeSource = readRuntimeConfigSource(),
) {
  return getAppMode(search, runtimeSource) === APP_MODE_PRODUCTION;
}

export function isRuntimeConfigurationUnavailable(
  search = currentSearch(),
  runtimeSource = readRuntimeConfigSource(),
) {
  return getAppMode(search, runtimeSource) === APP_MODE_UNAVAILABLE;
}

// Conserva el contrato histórico: devuelve true cuando una ruta operativa debe
// bloquearse para el modo actual. Demo y producción pueden resolver el hash;
// preview y una configuración inválida vuelven siempre al inicio.
export function isOperationalView(
  view,
  search = currentSearch(),
  runtimeSource = readRuntimeConfigSource(),
) {
  const operational = ['business', 'rider'].includes(String(view || ''));
  if (!operational) return false;
  return ![APP_MODE_DEMO, APP_MODE_PRODUCTION].includes(getAppMode(search, runtimeSource));
}

function currentSearch() {
  try {
    return globalThis.location?.search ?? '';
  } catch (_) {
    return '';
  }
}
