/*
 * UN PEDIDO NUEVO NO PUEDE PASAR DESAPERCIBIDO.
 * ============================================================================
 *
 * Qué había
 * ---------
 * En el Panel de PRODUCCIÓN, un pedido nuevo hacía exactamente una cosa: un
 * toast de tres segundos (`js/app.js`, `onOrderAlert`). Si el teléfono estaba
 * en el mostrador y nadie lo miraba en esos tres segundos, el pedido entraba
 * mudo y la única forma de enterarse era volver a mirar la pantalla.
 *
 * `business-sound-service.js` y `business-notification-service.js` existían
 * desde antes con el timbre y la notificación ya escritos, y NADIE los
 * instanciaba: `grep -r createBusinessSoundService js/` devolvía una sola línea,
 * su propia definición. Eran código muerto.
 *
 * Qué hace esto
 * -------------
 * Junta los cuatro canales que un teléfono puede ofrecer y los dispara juntos,
 * cada uno degradando solo si la plataforma no lo tiene:
 *
 *   · timbre        — dos tonos cortos (el servicio que ya existía)
 *   · vibración     — `navigator.vibrate`, inexistente en todo iOS
 *   · insignia      — `navigator.setAppBadge`, sólo con la PWA instalada
 *   · título        — «(2) La Taba», que se ve en la pestaña y en el
 *                     conmutador de aplicaciones del teléfono
 *
 * Ninguno informa nada por sí solo: la bandeja sigue siendo la fuente. Si los
 * cuatro fallan, el pedido igual está en la lista, marcado y contado.
 *
 * Nada de spam
 * ------------
 * Este módulo NO decide cuándo avisar. Lo decide `alertOnce()` del coordinador
 * de recepción, que ya reclama el aviso con Web Locks + `localStorage` con
 * retención de siete días: un pedido se anuncia UNA vez, aunque haya dos
 * pestañas abiertas y aunque se recargue la página. Acá sólo se ejecuta el
 * aviso que ese reclamo ya ganó. Se conserva de todos modos una segunda guarda
 * en memoria (`announced`) porque este canal también se usa desde caminos que
 * no pasan por el reclamo.
 *
 * El sonido lo enciende una persona
 * ---------------------------------
 * No por diseño: por política del navegador. `AudioContext` arranca suspendido
 * hasta que hay un gesto del usuario, así que un timbre "siempre encendido"
 * sería un timbre que no suena y que además miente en la interfaz. La
 * preferencia se guarda y sobrevive a la recarga.
 */

import { hapticFeedback } from '../core/haptics.js';
import { createBusinessSoundService } from './business-sound-service.js';

export const ORDER_SOUND_STORAGE_KEY = 'la_taba_business_sound';

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (_) {
    return null;
  }
}

/**
 * @param {object} options
 * @param {object} [options.sound]      servicio de timbre (inyectable en pruebas)
 * @param {object} [options.storage]    dónde recordar si el timbre está encendido
 * @param {object} [options.navigatorRef] para vibración e insignia
 * @param {object} [options.documentRef]  para el contador en el título
 * @param {Function} [options.vibrate]    inyectable; por defecto la háptica del proyecto
 */
export function createBusinessOrderAlertChannel({
  sound = createBusinessSoundService(),
  storage = defaultStorage(),
  navigatorRef = globalThis.navigator,
  documentRef = globalThis.document,
  vibrate = hapticFeedback,
} = {}) {
  const announced = new Set();
  let soundEnabled = readSoundPreference(storage);
  let baseTitle = '';
  let pending = 0;

  sound?.setMuted?.(!soundEnabled);

  function readSoundPreference(store) {
    try {
      return store?.getItem?.(ORDER_SOUND_STORAGE_KEY) === 'on';
    } catch (_) {
      return false;
    }
  }

  function writeSoundPreference(value) {
    try {
      storage?.setItem?.(ORDER_SOUND_STORAGE_KEY, value ? 'on' : 'off');
    } catch (_) {
      // Un almacenamiento bloqueado no puede apagar el timbre de este turno:
      // la preferencia sigue viva en memoria hasta que se cierre la pestaña.
    }
  }

  /**
   * Enciende o apaga el timbre. Se llama SIEMPRE desde el manejador del toque:
   * ahí es donde el navegador permite despertar el `AudioContext`, y por eso
   * además suena una vez al encenderlo —que es la única prueba honesta de que
   * el timbre va a sonar cuando entre un pedido—.
   */
  async function setSoundEnabled(value) {
    soundEnabled = Boolean(value);
    sound?.setMuted?.(!soundEnabled);
    writeSoundPreference(soundEnabled);
    if (soundEnabled) {
      try {
        await sound?.playNewOrder?.();
      } catch (_) {
        // Un navegador que rechaza el audio no puede impedir que se guarde la
        // preferencia; lo que no se hace es decir que sonó.
      }
    }
    return soundEnabled;
  }

  /**
   * La insignia del icono de la aplicación. Sólo existe con la PWA instalada y
   * en los navegadores que la implementan; donde no está, no pasa nada.
   */
  function applyBadge(count) {
    try {
      if (count > 0) navigatorRef?.setAppBadge?.(count);
      else navigatorRef?.clearAppBadge?.();
    } catch (_) {
      // La insignia es decoración informativa: nunca puede tirar el Panel.
    }
  }

  /**
   * El contador en el título. Es el canal que funciona en TODAS partes —también
   * en iOS, donde no hay vibración— y el que se ve sin desbloquear el teléfono
   * cuando el Panel quedó en segundo plano.
   */
  function applyTitle(count) {
    if (!documentRef) return;
    if (!baseTitle) baseTitle = String(documentRef.title || 'La Taba').replace(/^\(\d+\)\s*/, '');
    documentRef.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle;
  }

  /**
   * Cuántos pedidos esperan una decisión. Lo calcula la bandeja y se refleja en
   * la insignia y en el título. Es idempotente: llamarlo con el mismo número no
   * hace nada, así que puede correr en cada repintado.
   */
  function setPendingCount(count) {
    const next = Math.max(0, Math.floor(Number(count) || 0));
    if (next === pending) return pending;
    pending = next;
    applyBadge(pending);
    applyTitle(pending);
    return pending;
  }

  /**
   * Avisá que entró un pedido. Devuelve qué canales aceptaron el aviso: sirve
   * para la prueba y para el informe, nunca para decidir nada de la interfaz.
   */
  async function announceNewOrder(order = {}) {
    const id = String(order.backendId || order.id || order.code || '');
    if (id && announced.has(id)) return { announced: false, reason: 'ya-anunciado' };
    if (id) announced.add(id);

    const results = { announced: true, sound: false, vibration: false };
    try {
      results.sound = soundEnabled ? Boolean(await sound?.playNewOrder?.()) : false;
    } catch (_) {
      results.sound = false;
    }
    try {
      // `confirm` es el patrón de dos golpes cortos: el único de los tres que
      // el proyecto reserva para «algo quedó tomado».
      results.vibration = Boolean(vibrate?.('confirm', { navigatorRef }));
    } catch (_) {
      results.vibration = false;
    }
    return results;
  }

  /** Deja el título y la insignia como estaban. Se llama al cerrar sesión. */
  function reset() {
    announced.clear();
    pending = 0;
    applyBadge(0);
    applyTitle(0);
  }

  return Object.freeze({
    get soundEnabled() { return soundEnabled; },
    setSoundEnabled,
    setPendingCount,
    announceNewOrder,
    reset,
  });
}
