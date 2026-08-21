import {
  APP_MODE_DEMO,
  APP_MODE_PRODUCTION,
  getAppMode,
  isShowcaseMode,
} from './app-mode.js';

// El checkout basado en Perfil comparte una sola interfaz entre modos, pero la
// autoridad de los datos nunca se comparte. Esta capacidad la declara de forma
// explícita para que sea auditable desde afuera: qué modo puede ofrecer el
// checkout por Perfil y, sobre todo, de dónde salen esos datos.
//
// `supabase` es la única autoridad real. `sandbox` son datos sintéticos locales
// y jamás toca la red. `none` bloquea el checkout: una configuración productiva
// incompleta debe fallar cerrada, nunca degradar en silencio hacia fixtures.
export const PROFILE_CHECKOUT_AUTHORITY_SUPABASE = 'supabase';
export const PROFILE_CHECKOUT_AUTHORITY_SANDBOX = 'sandbox';
export const PROFILE_CHECKOUT_AUTHORITY_NONE = 'none';

export function profileCheckoutAuthority(mode = getAppMode()) {
  if (mode === APP_MODE_PRODUCTION) return PROFILE_CHECKOUT_AUTHORITY_SUPABASE;
  // `getAppMode` ya resuelve showcase como demo; ambos usan datos sintéticos
  // locales, y se diferencian sólo por el conjunto de fixtures.
  if (mode === APP_MODE_DEMO) return PROFILE_CHECKOUT_AUTHORITY_SANDBOX;
  return PROFILE_CHECKOUT_AUTHORITY_NONE;
}

export function supportsProfileCheckout(mode = getAppMode()) {
  return profileCheckoutAuthority(mode) !== PROFILE_CHECKOUT_AUTHORITY_NONE;
}

// Los fixtures de showcase son deterministas y no comparten el almacenamiento
// del demo, para que un recorrido guiado siempre muestre el mismo escenario.
export function profileCheckoutFixtureProfile(search = currentSearch()) {
  return isShowcaseMode(search) ? 'showcase' : 'demo';
}

// Escenarios sintéticos de cantidad de direcciones, para poder ejercitar el
// listado con 1, 4 y 10 sin inventar datos en producción.
export const PROFILE_CHECKOUT_ADDRESS_SCENARIOS = Object.freeze([1, 4, 10]);
export const PROFILE_CHECKOUT_DEFAULT_ADDRESS_COUNT = 4;

export function profileCheckoutAddressScenario(search = currentSearch()) {
  const requested = readParam(search, 'addresses');
  const parsed = Number.parseInt(requested, 10);
  if (!Number.isFinite(parsed)) return PROFILE_CHECKOUT_DEFAULT_ADDRESS_COUNT;
  if (parsed <= 0) return 0;
  return Math.min(parsed, 25);
}

function readParam(search, name) {
  try {
    return new URLSearchParams(String(search || '')).get(name) || '';
  } catch (_) {
    return '';
  }
}

function currentSearch() {
  try {
    return globalThis.location?.search ?? '';
  } catch (_) {
    return '';
  }
}
