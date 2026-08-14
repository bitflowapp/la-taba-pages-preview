import { isProductionDeployment, readRuntimeConfigSource } from './runtime-config.js';

export const SHOWCASE_QUERY_PARAM = 'showcase';

/**
 * ¿La URL PIDE la presentación? Lee la query y nada más.
 *
 * Casi nunca es la pregunta correcta: pedirla no es obtenerla. Existe para el
 * diagnóstico y para las pruebas; para decidir comportamiento usar
 * `isShowcaseMode`.
 */
export function isShowcaseQueryRequested(search = currentSearch()) {
  try {
    return new URLSearchParams(String(search || '')).get(SHOWCASE_QUERY_PARAM) === '1';
  } catch (_) {
    return false;
  }
}

/**
 * ¿Corre la presentación?
 *
 * Pedirla por la URL no alcanza: en un despliegue productivo la bandera se
 * ignora. Ver `isProductionDeployment` para las tres respuestas y el porqué de
 * cada una.
 */
export function isShowcaseMode(search = currentSearch(), runtimeSource = readRuntimeConfigSource()) {
  if (!isShowcaseQueryRequested(search)) return false;
  return !isProductionDeployment(runtimeSource);
}

function currentSearch() {
  try {
    return globalThis.location?.search ?? '';
  } catch (_) {
    return '';
  }
}
