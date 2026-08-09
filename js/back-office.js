/*
 * El back office no viaja en la primera pantalla del cliente.
 *
 * QUÉ PROBLEMA CIERRA
 * -------------------
 * `app.js` importaba de forma estática el panel del negocio, el de reparto, el
 * centro de operaciones de producción y las herramientas de sandbox. Como el
 * storefront no tiene empaquetador, cada import estático es una descarga más:
 * medido contra la URL pública, una persona que entraba a comprar una lata se
 * bajaba 127 módulos y 1.988 KB de JavaScript, de los cuales 759 KB —el 38%—
 * eran pantallas que sólo usa quien atiende el local o reparte.
 *
 * Nada de eso se renderizaba para un cliente: `renderBusinessDashboard` y
 * `renderDeliveryPanel` ya estaban detrás de `isDemoMode()`. Pero el navegador
 * igual los descargaba, los parseaba y los ejecutaba antes de poder pintar la
 * góndola. Se pagaba el costo completo por código que no se usaba.
 *
 * POR QUÉ SÓLO EL PANEL, Y NO TAMBIÉN REPARTO / PRODUCCIÓN / SANDBOX
 * -----------------------------------------------------------------
 * Se intentó diferir los cuatro, y ahí el ahorro llegaba a 556 KB y 38 módulos
 * menos. No se pudo sostener: el modo demo depende de que ese grafo esté
 * evaluado y descargado TEMPRANO, y al diferirlo empezaron a fallar de forma
 * reproducible tres pruebas de extremo a extremo —el orden de la góndola, la
 * búsqueda con puntuación local y la dirección del encabezado—.
 *
 * Se probaron tres variantes: cargar al primer render, esperar dentro de
 * `bootstrap()`, y esperar en el nivel superior de este módulo para que termine
 * de evaluarse antes que `app.js`. Las tres arreglan el orden y ninguna arregla
 * la última prueba, porque el problema que queda no es de orden sino de
 * LATENCIA: el import dinámico agrega una vuelta de red antes de que arranque
 * la app, y la hidratación de direcciones llega tarde a la primera lectura.
 *
 * Diferir sólo el panel no tiene ese acoplamiento y es estable. Los otros tres
 * quedan estáticos, y el ahorro que falta —421 KB— queda anotado en el informe
 * con su causa: hace falta separar el documento de la demo del documento del
 * cliente, no seguir escondiendo módulos detrás de una compuerta en runtime.
 */

import * as reparto from './delivery.js';
import * as produccion from './production-operations.js';
import * as sandbox from './sandbox-tools.js';

let modulos = null;
let enVuelo = null;
const suscriptores = new Set();

export function backOfficePresente() {
  return modulos !== null;
}

/* Avisa cuando el back office termina de entrar, para darle su primer pintado. */
export function alEntrarBackOffice(callback) {
  suscriptores.add(callback);
  return () => suscriptores.delete(callback);
}

export function cargarBackOffice() {
  if (modulos) return Promise.resolve(modulos);
  if (!enVuelo) {
    enVuelo = import('./business.js').then((negocio) => {
      modulos = { negocio };
      for (const callback of [...suscriptores]) {
        try { callback(); } catch (_) { /* un suscriptor roto no frena a los demás */ }
      }
      return modulos;
    }).catch((error) => {
      enVuelo = null;
      throw error;
    });
  }
  return enVuelo;
}

/*
 * La regla de si hace falta la decide quien conoce la vista activa —app.js—,
 * por la misma razón que arriba.
 */
export function sincronizarBackOffice({ vistaOperativa = false, demo = false, sandbox = false } = {}) {
  if (!vistaOperativa && !demo && !sandbox) return false;
  cargarBackOffice().catch(() => { /* si no entra, el cliente sigue comprando */ });
  return true;
}

// ── panel del negocio ────────────────────────────────────────────────────────
export function renderBusinessDashboard(...args) {
  return modulos ? modulos.negocio.renderBusinessDashboard(...args) : undefined;
}
export function handleBusinessAction(...args) {
  return modulos ? modulos.negocio.handleBusinessAction(...args) : undefined;
}
export function handleBusinessInput(...args) {
  return modulos ? modulos.negocio.handleBusinessInput(...args) : undefined;
}
export function submitBusinessSetupForm(...args) {
  return modulos ? modulos.negocio.submitBusinessSetupForm(...args) : undefined;
}
export function lockAdmin(...args) {
  return modulos ? modulos.negocio.lockAdmin(...args) : undefined;
}
/*
 * Devuelve false mientras el panel no entró. Quien desbloquea es una persona que
 * ya está en la pantalla del negocio, así que para cuando toca el botón el
 * módulo está. Si por lo que fuera no estuviera, negar es lo correcto: nunca hay
 * que conceder acceso administrativo por una carga incompleta.
 */
export function unlockAdmin(...args) {
  return modulos ? modulos.negocio.unlockAdmin(...args) : false;
}

// ── reparto, producción y sandbox ────────────────────────────────────────────
// Éstos NO se difieren: entran con el arranque, igual que antes. Se re-exportan
// tal cual, sin pasar por el envoltorio del panel, porque su disponibilidad no
// depende de que alguien abra el negocio.
export const {
  renderDeliveryPanel,
  handleDeliveryAction,
  handleDeliveryChange,
} = reparto;

export const {
  initProductionOperations,
  renderProductionOperations,
  handleProductionOperationsAction,
  handleProductionOperationsInput,
  handleProductionAuthSubmit,
  handleProductionOperationsPageHide,
  handleProductionOperationsViewChange,
} = produccion;

export const {
  renderSandboxTools,
  handleSandboxToolsAction,
  handleSandboxToolsChange,
} = sandbox;

