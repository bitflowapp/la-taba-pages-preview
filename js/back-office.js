/*
 * El panel del negocio no viaja en la primera pantalla del cliente.
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
 * LA TRAMPA QUE COSTÓ CARO, Y QUE EXPLICA TODO
 * --------------------------------------------
 * El primer intento de diferir los cuatro rompió pruebas de extremo a extremo
 * que no tenían nada que ver entre sí: el orden de la góndola, la búsqueda con
 * puntuación local, la dirección del encabezado, el scroll fantasma, el sandbox.
 * Pasé por tres teorías equivocadas —orden de evaluación del grafo, momento del
 * arranque, latencia del import dinámico— y llegué a dar el ahorro por
 * imposible.
 *
 * La causa era mucho más tonta y estaba acá adentro. Cuando el módulo no entró,
 * estas funciones devolvían `undefined`. Pero `app.js` hace
 * `if (resultado.handled) return;` sin guardia, así que `undefined` no era un
 * no-op: era un TypeError que abortaba el manejador de eventos ENTERO y se
 * llevaba puesto todo lo que venía después. Escribías en el buscador y la
 * góndola no filtraba, sin un solo error visible en pantalla.
 *
 * Por eso ahora el contrato importa más que la existencia: cuando el módulo no
 * está, cada handler devuelve `{ handled: false }`, que es exactamente lo que
 * devuelve el módulo real cuando el evento no le corresponde. Y eso es
 * literalmente cierto: su pantalla no está en el documento.
 *
 * Medido con los cuatro diferidos: 128 módulos y 2.026 KB pasan a 90 y 1.464 KB,
 * el LCP baja de 6.156 a 4.784 ms y el tiempo hasta ver algo comprable baja de
 * 6.868 a 5.470 ms.
 */

let modulos = null;
let enVuelo = null;
let initProduccionPendiente = null;
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
    enVuelo = Promise.all([
      import('./business.js'),
      import('./delivery.js'),
      import('./production-operations.js'),
      import('./sandbox-tools.js'),
    ]).then(([negocio, reparto, produccion, sandbox]) => {
      modulos = { negocio, reparto, produccion, sandbox };
      if (initProduccionPendiente) {
        const opciones = initProduccionPendiente;
        initProduccionPendiente = null;
        try { produccion.initProductionOperations(opciones); } catch (_) { /* el arranque no puede caerse por esto */ }
      }
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

/*
 * IMPORTANTE: cuando el módulo todavía no entró, estas funciones devuelven
 * `{ handled: false }` y NO `undefined`.
 *
 * `app.js` hace `if (resultado.handled) return;` sin guardia, así que devolver
 * `undefined` no es un no-op: lanza un TypeError que aborta el manejador de
 * eventos ENTERO y se lleva puesto lo que venía después. Se ve así: escribís en
 * el buscador y la góndola no filtra, sin ningún error visible.
 *
 * `{ handled: false }` es exactamente lo que devuelve el módulo real cuando el
 * evento no le corresponde, que es justo la situación: la pantalla del back
 * office no está en el documento.
 */
const NO_LO_ATENDIO = Object.freeze({ handled: false });

// ── panel del negocio ────────────────────────────────────────────────────────
export function renderBusinessDashboard(...args) {
  return modulos ? modulos.negocio.renderBusinessDashboard(...args) : undefined;
}
export function handleBusinessAction(...args) {
  return modulos ? modulos.negocio.handleBusinessAction(...args) : NO_LO_ATENDIO;
}
export function handleBusinessInput(...args) {
  return modulos ? modulos.negocio.handleBusinessInput(...args) : NO_LO_ATENDIO;
}
export function submitBusinessSetupForm(...args) {
  return modulos ? modulos.negocio.submitBusinessSetupForm(...args) : NO_LO_ATENDIO;
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

// ── reparto ──────────────────────────────────────────────────────────────────
export function renderDeliveryPanel(...a) { return modulos ? modulos.reparto.renderDeliveryPanel(...a) : undefined; }
export function handleDeliveryAction(...args) {
  return modulos ? modulos.reparto.handleDeliveryAction(...args) : NO_LO_ATENDIO;
}
export function handleDeliveryChange(...args) {
  return modulos ? modulos.reparto.handleDeliveryChange(...args) : NO_LO_ATENDIO;
}

// ── operaciones de producción ────────────────────────────────────────────────
export function initProductionOperations(opciones) {
  if (modulos) return modulos.produccion.initProductionOperations(opciones);
  initProduccionPendiente = opciones;
  return undefined;
}
export function renderProductionOperations(...a) { return modulos ? modulos.produccion.renderProductionOperations(...a) : undefined; }
export function handleProductionOperationsAction(...args) {
  return modulos ? modulos.produccion.handleProductionOperationsAction(...args) : NO_LO_ATENDIO;
}
export function handleProductionOperationsInput(...args) {
  return modulos ? modulos.produccion.handleProductionOperationsInput(...args) : NO_LO_ATENDIO;
}
export function handleProductionAuthSubmit(...args) {
  return modulos ? modulos.produccion.handleProductionAuthSubmit(...args) : NO_LO_ATENDIO;
}
export function handleProductionOperationsPageHide(...a) { return modulos ? modulos.produccion.handleProductionOperationsPageHide(...a) : undefined; }
export function handleProductionOperationsViewChange(...a) { return modulos ? modulos.produccion.handleProductionOperationsViewChange(...a) : undefined; }

// ── herramientas de sandbox ──────────────────────────────────────────────────
export function renderSandboxTools(...a) { return modulos ? modulos.sandbox.renderSandboxTools(...a) : undefined; }
export function handleSandboxToolsAction(...args) {
  return modulos ? modulos.sandbox.handleSandboxToolsAction(...args) : NO_LO_ATENDIO;
}
export function handleSandboxToolsChange(...args) {
  return modulos ? modulos.sandbox.handleSandboxToolsChange(...args) : NO_LO_ATENDIO;
}

