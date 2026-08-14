/*
 * HÁPTICA — mejora progresiva, nunca un requisito
 * ============================================================================
 *
 * Lo que la plataforma REALMENTE ofrece, que no es lo mismo en todos lados:
 *
 * | Plataforma                         | `navigator.vibrate` | Vibra de verdad |
 * |------------------------------------|---------------------|-----------------|
 * | Chrome / Edge / Samsung en Android | sí                  | sí              |
 * | Firefox en Android                 | sí                  | sí              |
 * | Safari en iOS / iPadOS             | NO existe           | no              |
 * | Chrome en iOS                      | NO existe           | no              |
 * | Firefox en iOS                     | NO existe           | no              |
 * | Chrome / Firefox / Edge escritorio | sí                  | no (sin motor)  |
 * | Safari escritorio                  | NO existe           | no              |
 *
 * Los dos renglones que importan y que se suelen dar por sabidos al revés:
 *
 * 1. **Ningún navegador de iOS soporta la Vibration API.** Chrome y Firefox en
 *    iOS son WebKit por obligación de plataforma, así que "probamos en Chrome"
 *    no dice nada sobre un iPhone. WebKit nunca implementó `navigator.vibrate`
 *    y no hay una alternativa web para el motor háptico de Apple. En iPhone
 *    esto es, y va a seguir siendo, silencio.
 * 2. **En escritorio la API existe y no hace nada.** `'vibrate' in navigator`
 *    devuelve verdadero en Chrome de escritorio y la llamada devuelve `true`
 *    sin que haya hardware. No hay forma de detectar el motor: por eso este
 *    módulo NUNCA usa el resultado para decidir nada de la interfaz.
 *
 * Además, donde sí funciona, el navegador exige activación del usuario: una
 * vibración fuera de un gesto se descarta (Chrome además la anota como
 * intervención en la consola). Por eso se llama desde el manejador del toque,
 * no desde el render que viene después.
 *
 * Contrato: esto no informa nada. Si no hay háptica, no pasa nada — ni error,
 * ni aviso, ni camino alternativo. Toda la información sigue viviendo en lo que
 * se ve y en lo que anuncia el lector de pantalla.
 */

// Tres patrones y no más. Cada milisegundo está elegido para que el pulso se
// sienta como un golpecito y no como una alarma: por encima de ~30 ms el motor
// de un teléfono deja de leerse como acuse y empieza a leerse como aviso.
export const HAPTIC_PATTERNS = Object.freeze({
  // Sumar algo al pedido: el gesto más repetido de la app.
  add: 12,
  // Sacar algo: más corto que agregar, para que no premie lo mismo.
  remove: 8,
  // Confirmación relevante (el pedido quedó tomado). Dos toques cortos: es el
  // único momento donde un patrón, y no un pulso, está justificado.
  confirm: Object.freeze([14, 60, 22]),
});

let lastAt = 0;

// Ventana antirrebote. Sin esto, mantener el dedo en "+" convierte una serie de
// acuses en una vibración continua, que es lo que hace que la gente apague el
// teléfono en vez de la función.
const MIN_GAP_MS = 60;

/**
 * Describe el soporte REAL, separando las dos preguntas que no son la misma:
 * si la API existe y si hay motivos para creer que hay motor.
 * Se usa en el informe y en las pruebas; la interfaz no depende de esto.
 */
export function getHapticSupport(navigatorRef = globalThis.navigator) {
  const hasApi = Boolean(navigatorRef) && typeof navigatorRef.vibrate === 'function';
  // `maxTouchPoints` no prueba que haya motor háptico, pero un dispositivo sin
  // ningún punto táctil es con seguridad un escritorio. Es la única señal
  // honesta disponible, y por eso se llama `probableEngine` y no `hasEngine`.
  const touchPoints = Number(navigatorRef?.maxTouchPoints || 0);
  return {
    hasApi,
    probableEngine: hasApi && touchPoints > 0,
    // WebKit en iOS: se nombra para que el informe por plataforma no tenga que
    // adivinarlo, no para cambiar ninguna decisión de la interfaz.
    knownUnsupportedPlatform: !hasApi,
  };
}

/**
 * Emite el acuse háptico correspondiente. Devuelve `true` sólo si el navegador
 * aceptó la llamada; ningún camino de la interfaz puede depender de eso.
 * Llamar SIEMPRE desde el manejador del gesto: fuera de la activación del
 * usuario el navegador la descarta.
 */
export function hapticFeedback(kind, {
  navigatorRef = globalThis.navigator,
  now = Date.now(),
} = {}) {
  const pattern = HAPTIC_PATTERNS[kind];
  if (pattern === undefined) return false;
  if (typeof navigatorRef?.vibrate !== 'function') return false;
  if (now - lastAt < MIN_GAP_MS) return false;
  lastAt = now;
  try {
    return navigatorRef.vibrate(pattern) === true;
  } catch (_) {
    // Un navegador puede lanzar por política de permisos (iframe cruzado) o por
    // un patrón que su implementación rechaza. Nada de esto es un problema del
    // pedido: se traga y la compra sigue igual.
    return false;
  }
}

export function resetHapticsForTests() {
  lastAt = 0;
}
