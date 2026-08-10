import {
  GPS_GOOD_ACCURACY_METERS,
  locationTimestamp,
  trackingLocationFreshness,
} from './route_geometry.js';

/*
 * Qué le decimos al cliente sobre el estado del seguimiento.
 *
 * Cuatro estados y ni uno más, porque son las cuatro cosas distintas que le
 * pueden estar pasando y cada una pide una reacción distinta:
 *
 *   live      llega todo bien. No hay nada que hacer.
 *   delayed   el último dato tiene unos segundos. Esperar, sigue viniendo.
 *   weak      llega, pero con poca precisión. El punto es aproximado.
 *   offline   dejó de llegar. Lo que se ve es lo último que se supo.
 *
 * En ningún estado se borra el rider ni se apaga el mapa: la última coordenada
 * conocida sigue siendo información, y sacarla de la pantalla deja al cliente
 * peor que dejarla con su fecha a la vista.
 */

export const TRACKING_STATE = Object.freeze({
  LIVE: 'live',
  DELAYED: 'delayed',
  WEAK: 'weak',
  OFFLINE: 'offline',
  NONE: 'none',
});

/** Por encima de esta precisión la posición es orientativa, no exacta. */
export const WEAK_SIGNAL_ACCURACY_METERS = GPS_GOOD_ACCURACY_METERS;

/** «hace 8 s», «hace 3 min», «hace 2 h». Sin decimales ni precisión falsa. */
export function relativeAge(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  if (value < 60) return `hace ${value} s`;
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `hace ${hours} h`;
}

/**
 * Estado y texto del seguimiento. Puro: recibe el fix medido y el momento, y
 * devuelve qué mostrar. No mira el DOM ni el reloj del sistema por su cuenta.
 */
/*
 * Nota de alcance: esto describe el estado de la SEÑAL, no el del pedido. Que
 * el rider haya llegado, o que lo que se muestre sea un recorrido de muestra,
 * son decisiones de la vista y se resuelven antes de llegar acá.
 */
export function trackingStatus(location, {
  now = Date.now(),
  online = true,
} = {}) {
  const freshness = trackingLocationFreshness(location, { now });
  if (freshness === 'none') {
    return { state: TRACKING_STATE.NONE, label: 'Ubicación temporalmente no disponible', ageSeconds: null };
  }

  const timestamp = locationTimestamp(location);
  const ageSeconds = Math.max(0, (now - timestamp) / 1000);
  const age = relativeAge(ageSeconds);
  const accuracy = Number(location?.accuracy);
  const weak = Number.isFinite(accuracy) && accuracy > WEAK_SIGNAL_ACCURACY_METERS;

  // Que el cliente se quede sin red y que el rider deje de publicar se ven
  // igual desde acá —no llega nada— y se dicen igual. Lo que no se hace es
  // callar la antigüedad: es el dato que le permite decidir si esperar.
  if (online === false || freshness === 'lost') {
    return {
      state: TRACKING_STATE.OFFLINE,
      label: `Sin conexión · última ubicación ${age}`,
      ageSeconds,
    };
  }

  if (weak) {
    return {
      state: TRACKING_STATE.WEAK,
      label: `Señal GPS débil · ${age}`,
      ageSeconds,
      accuracy,
    };
  }

  if (freshness === 'delayed') {
    return { state: TRACKING_STATE.DELAYED, label: `Actualizado ${age}`, ageSeconds };
  }

  return {
    state: TRACKING_STATE.LIVE,
    label: ageSeconds < 2 ? 'Ubicación en vivo · ahora' : `Ubicación en vivo · ${age}`,
    ageSeconds,
  };
}
