import { isProductionDeployment, readRuntimeConfigSource, resolveRuntimeConfig } from './runtime-config.js';
import { isShowcaseMode, isShowcaseQueryRequested } from './showcase-mode.js';

export { isShowcaseMode, isShowcaseQueryRequested };

export const DEMO_QUERY_PARAM = 'demo';

/**
 * ¿La URL PIDE la demostración? Lee la query y nada más. Para decidir
 * comportamiento usar `isDemoMode`: pedirla no es obtenerla.
 */
export function isDemoQueryRequested(search = currentSearch()) {
  try {
    const params = new URLSearchParams(String(search || ''));
    return params.get(DEMO_QUERY_PARAM) === '1' || isShowcaseQueryRequested(search);
  } catch (_) {
    return false;
  }
}

// Incrementa cuando un estado local compatible necesita una migración explícita.
// La versión v3 actualiza el catálogo base sin descartar pedidos ni carrito demo.
export const APP_DATA_VERSION = 'la-taba-runtime-v3';
export const APP_MODE_PUBLIC = 'public';
export const APP_MODE_DEMO = 'demo';
export const APP_MODE_PRODUCTION = 'production';
export const APP_MODE_UNAVAILABLE = 'unavailable';

/*
 * LA DEMOSTRACIÓN NO SE PIDE POR URL EN PRODUCCIÓN.
 *
 * `?demo=1` sirve una tienda entera con datos locales y confirma pedidos con el
 * MISMO texto que la real, sin tocar el backend. En un artefacto de
 * previsualización eso es exactamente lo que tiene que pasar. En el dominio
 * comercial es una trampa: alguien abre un enlace preparado, arma su pedido, lee
 * «pedido confirmado» y se queda esperando algo que nadie va a preparar.
 *
 * Antes esta bandera ganaba SIEMPRE —era la primera línea de `getAppMode`, antes
 * de mirar la configuración—, así que un despliegue productivo se convertía en
 * simulación con agregarle una query. Ahora la configuración manda: en
 * producción la bandera se ignora y la tienda sigue siendo la real.
 */
export function isDemoMode(search = currentSearch(), runtimeSource = readRuntimeConfigSource()) {
  if (!isDemoQueryRequested(search)) return false;
  return !isProductionDeployment(runtimeSource);
}

/**
 * La URL pidió la demostración y el despliegue la rechazó. No cambia
 * comportamiento: existe para que se pueda decir en voz alta —en un rótulo, en
 * un log— en vez de que el rechazo sea invisible.
 */
export function isDemoQueryIgnored(
  search = currentSearch(),
  runtimeSource = readRuntimeConfigSource(),
) {
  return isDemoQueryRequested(search) && isProductionDeployment(runtimeSource);
}

export function getAppMode(
  search = currentSearch(),
  runtimeSource = readRuntimeConfigSource(),
) {
  // La presentación se habilita con la bandera explícita Y con un despliegue que
  // no sea el productivo. En producción la bandera se ignora y se sigue de largo
  // hacia el modo real.
  if (isDemoMode(search, runtimeSource)) return APP_MODE_DEMO;

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
