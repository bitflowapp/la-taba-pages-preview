export const APP_DATA_VERSION = 'la-taba-pizzeria-v1';
export const APP_MODE_PUBLIC = 'public';
export const APP_MODE_DEMO = 'demo';

export function isDemoMode(search = currentSearch()) {
  // Los módulos unitarios no tienen location: conservan el escenario demo
  // histórico. En navegador el modo presentación siempre exige ?demo=1.
  if (search === null) return true;
  try {
    return new URLSearchParams(String(search || '')).get('demo') === '1';
  } catch (_) {
    return false;
  }
}

export function getAppMode(search = currentSearch()) {
  return isDemoMode(search) ? APP_MODE_DEMO : APP_MODE_PUBLIC;
}

export function isOperationalView(view, search = currentSearch()) {
  return ['business', 'rider'].includes(String(view || '')) && !isDemoMode(search);
}

function currentSearch() {
  try {
    return globalThis.location?.search ?? null;
  } catch (_) {
    return null;
  }
}
