import {
  GPS_HARD_MAX_SPEED_MPS,
  GPS_GOOD_ACCURACY_METERS,
  GPS_MAX_ACCURACY_METERS,
  GPS_MAX_REASONABLE_SPEED_MPS,
  distanceKm,
  locationTimestamp,
  normalizeRiderLocation,
} from './route_geometry.js';

/*
 * Movimiento visual del rider.
 *
 * El problema que resuelve, medido sobre las trazas reales del Moto G15: los
 * fixes llegan cada 12,4 s (mediana) y el mapa los dibujaba con una animación
 * fija de 420 ms. O sea que el marcador estaba inmóvil el 96,6 % del tiempo y
 * daba un tirón cada doce segundos. Nadie lee eso como «va en camino»: se lee
 * como una demo que salta.
 *
 * LA REGLA QUE NO SE NEGOCIA: hay dos posiciones y son cosas distintas.
 *
 *   measured  la coordenada que publicó el dispositivo. Es la verdad, es la que
 *             se persiste y es la única que se reporta como ubicación.
 *   visual    dónde se dibuja el marcador AHORA. Sale de interpolar entre dos
 *             posiciones medidas reales, y sólo sirve para que el ojo entienda
 *             el movimiento.
 *
 * La interpolación va SIEMPRE por detrás: recorre el tramo que el rider ya
 * hizo, entre dos puntos que efectivamente reportó. Nunca extrapola hacia
 * adelante, nunca adivina hacia dónde sigue y nunca ajusta el trazo a una
 * calle. Cuando el fix siguiente no llega, el marcador termina su tramo y se
 * queda quieto sobre la última coordenada REAL: quedarse quieto es la respuesta
 * honesta a no tener dato nuevo.
 */

/** Fracción de la cadencia observada que dura la interpolación de un tramo. */
export const MOTION_GAP_FRACTION = 0.9;
export const MOTION_MIN_DURATION_MS = 600;
export const MOTION_MAX_DURATION_MS = 14_000;
/** Cadencia supuesta para el primer tramo, cuando todavía no hay una medida. */
export const MOTION_DEFAULT_GAP_MS = 12_000;
/**
 * Un tramo que no vimos pasar no se recorre: se converge al punto real en este
 * tiempo. Es el caso de la reconexión, donde el rider siguió andando sin red y
 * el salto acumulado no representa un trayecto que podamos dibujar.
 */
export const MOTION_CONVERGE_MS = 1_400;
/** Por encima de esta distancia el tramo se considera un salto, no un trayecto. */
export const MOTION_MAX_TRAVEL_METERS = 400;
/**
 * Y por encima de este múltiplo de la cadencia normal, tampoco: un hueco de
 * tiempo así de grande es una desconexión, no el ritmo del reparto. El contrato
 * público del seguimiento entrega SÓLO la última coordenada —nunca una cola—,
 * así que al volver la red el cliente ve un único salto, y esto es lo que lo
 * convierte en un movimiento entendible en vez de un teletransporte.
 */
export const MOTION_RECOVERY_GAP_FACTOR = 2.5;
/** Cuántos fixes medidos se conservan para calcular la cadencia observada. */
export const MOTION_HISTORY = 6;

export const MOTION_REJECTIONS = Object.freeze({
  INVALID: 'invalid-coordinates',
  FUTURE: 'timestamp-in-the-future',
  BACKWARDS: 'timestamp-not-newer',
  ACCURACY: 'accuracy-out-of-range',
  IMPOSSIBLE: 'implausible-jump',
});

/**
 * ¿Este fix medido es objetivamente inadmisible? Filtra lo que no puede ser
 * cierto —coordenada inválida, reloj adelantado, retroceso en el tiempo,
 * precisión fuera de rango, velocidad imposible— y NADA más. Un fix feo pero
 * posible entra: la coordenada del backend sigue siendo la verdad.
 */
export function classifyFix(previousRaw, nextRaw, { now = Date.now() } = {}) {
  const next = normalizeRiderLocation(nextRaw, { source: 'gps' });
  if (!next) return { accepted: false, reason: MOTION_REJECTIONS.INVALID };

  const timestamp = locationTimestamp(next);
  if (!timestamp || timestamp > now + 10_000) {
    return { accepted: false, reason: MOTION_REJECTIONS.FUTURE };
  }
  const accuracy = Number(next.accuracy);
  if (Number.isFinite(accuracy) && accuracy > GPS_MAX_ACCURACY_METERS) {
    return { accepted: false, reason: MOTION_REJECTIONS.ACCURACY };
  }

  const previous = previousRaw ? normalizeRiderLocation(previousRaw, { source: 'gps' }) : null;
  if (!previous) return { accepted: true, reason: '', fix: next };

  const previousTime = locationTimestamp(previous);
  if (previousTime && timestamp <= previousTime) {
    return { accepted: false, reason: MOTION_REJECTIONS.BACKWARDS };
  }
  if (isImplausibleJump(previous, next, previousTime, timestamp)) {
    return { accepted: false, reason: MOTION_REJECTIONS.IMPOSSIBLE };
  }
  return { accepted: true, reason: '', fix: next };
}

function isImplausibleJump(previous, next, previousTime, nextTime) {
  const seconds = (nextTime - previousTime) / 1000;
  if (!(seconds > 0)) return false;
  const meters = distanceKm(previous, next) * 1000;
  const speed = meters / seconds;
  if (speed >= GPS_HARD_MAX_SPEED_MPS) return true;
  const accuracy = Number(next.accuracy);
  return speed >= GPS_MAX_REASONABLE_SPEED_MPS
    && Number.isFinite(accuracy)
    && accuracy >= GPS_GOOD_ACCURACY_METERS;
}

/** Duración de la interpolación de un tramo, derivada de la cadencia real. */
export function travelDurationMs(gapMs, {
  fraction = MOTION_GAP_FRACTION,
  minMs = MOTION_MIN_DURATION_MS,
  maxMs = MOTION_MAX_DURATION_MS,
} = {}) {
  const gap = Number(gapMs);
  if (!Number.isFinite(gap) || gap <= 0) return minMs;
  return Math.min(maxMs, Math.max(minMs, gap * fraction));
}

/* Salida suave en los dos extremos: el marcador no arranca ni frena de golpe. */
export function easeInOutCubic(progress) {
  const t = Math.min(1, Math.max(0, Number(progress) || 0));
  return t < 0.5 ? 4 * t * t * t : 1 - (((-2 * t) + 2) ** 3) / 2;
}

/**
 * Motor de movimiento visual. Puro: sin DOM, sin timers, sin red. Recibe fixes
 * medidos y responde, para un instante cualquiera, dónde dibujar el marcador.
 */
export function createRiderMotion({
  now = () => Date.now(),
  reducedMotion = false,
  convergeMs = MOTION_CONVERGE_MS,
  maxTravelMeters = MOTION_MAX_TRAVEL_METERS,
} = {}) {
  const state = {
    measured: null,
    history: [],
    from: null,
    to: null,
    startedAt: 0,
    durationMs: 0,
    converging: false,
    rejected: [],
  };

  /** Cadencia observada entre los últimos fixes admitidos. */
  function observedGapMs() {
    if (state.history.length < 2) return MOTION_DEFAULT_GAP_MS;
    const gaps = [];
    for (let i = 1; i < state.history.length; i += 1) {
      const gap = state.history[i] - state.history[i - 1];
      if (gap > 0) gaps.push(gap);
    }
    if (!gaps.length) return MOTION_DEFAULT_GAP_MS;
    const sorted = [...gaps].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  /**
   * Entra un fix medido. Devuelve qué se hizo con él, para que la capa de
   * arriba lo pueda auditar sin tener que adivinar.
   */
  function pushFix(rawFix, { instant = false } = {}) {
    const at = now();
    const verdict = classifyFix(state.measured, rawFix, { now: at });
    if (!verdict.accepted) {
      state.rejected.push({ at, reason: verdict.reason });
      return { accepted: false, reason: verdict.reason };
    }

    const fix = verdict.fix;
    const previous = state.measured;
    const previousTimestamp = previous ? locationTimestamp(previous) : 0;
    // La cadencia se mide ANTES de sumar este fix: si el que acaba de llegar
    // viene de un corte de red, su hueco no debe subir la vara contra la que se
    // lo compara y hacerlo pasar por normal.
    const normalGapMs = observedGapMs();
    // La posición visual de la que se parte es DÓNDE ESTÁ EL MARCADOR AHORA,
    // no el fix anterior: así un tramo que entra a mitad de otro no produce
    // un salto hacia atrás para volver a arrancar.
    const from = visualPositionAt(at) || previous || fix;
    state.measured = fix;
    state.history.push(locationTimestamp(fix));
    if (state.history.length > MOTION_HISTORY) state.history.shift();

    if (instant || reducedMotion || !previous) {
      state.from = null;
      state.to = null;
      state.durationMs = 0;
      state.converging = false;
      return { accepted: true, mode: 'instant', fix };
    }

    const meters = distanceKm(from, fix) * 1000;
    if (meters <= 0) {
      state.from = null;
      state.to = null;
      state.durationMs = 0;
      state.converging = false;
      return { accepted: true, mode: 'idle', fix };
    }

    // Un tramo que pasó fuera de nuestra vista no es un trayecto que podamos
    // dibujar. Se lo reconoce por dos señales independientes: saltó demasiado
    // lejos, o pasó demasiado tiempo entre un fix y el siguiente. En cualquiera
    // de los dos casos se converge rápido al punto real, que es lo que el
    // cliente necesita ver, en vez de fingir un recorrido que nadie observó.
    const gapMs = previousTimestamp ? locationTimestamp(fix) - previousTimestamp : 0;
    const converging = meters > maxTravelMeters
      || (gapMs > 0 && gapMs > normalGapMs * MOTION_RECOVERY_GAP_FACTOR);
    state.from = from;
    state.to = fix;
    state.startedAt = at;
    state.durationMs = converging ? convergeMs : travelDurationMs(normalGapMs);
    state.converging = converging;
    return {
      accepted: true,
      mode: converging ? 'converge' : 'travel',
      fix,
      durationMs: state.durationMs,
      meters,
    };
  }

  /** Dónde dibujar el marcador en este instante. Null si no hay nada medido. */
  function visualPositionAt(at = now()) {
    if (!state.to || !state.from || state.durationMs <= 0) {
      return state.measured ? pointOf(state.measured) : null;
    }
    const elapsed = at - state.startedAt;
    if (elapsed >= state.durationMs) return pointOf(state.to);
    const eased = easeInOutCubic(elapsed / state.durationMs);
    return {
      lat: state.from.lat + ((state.to.lat - state.from.lat) * eased),
      lng: state.from.lng + ((state.to.lng - state.from.lng) * eased),
    };
  }

  /** ¿Queda tramo por recorrer? La capa de render usa esto para pedir frames. */
  function isMoving(at = now()) {
    if (!state.to || !state.from || state.durationMs <= 0) return false;
    return at - state.startedAt < state.durationMs;
  }

  /** La última coordenada MEDIDA. Es la que se reporta, nunca la interpolada. */
  function measuredPosition() {
    return state.measured ? { ...state.measured } : null;
  }

  function reset() {
    state.measured = null;
    state.history = [];
    state.from = null;
    state.to = null;
    state.startedAt = 0;
    state.durationMs = 0;
    state.converging = false;
    state.rejected = [];
  }

  function debugState() {
    return Object.freeze({
      hasMeasured: Boolean(state.measured),
      moving: isMoving(),
      converging: state.converging,
      durationMs: state.durationMs,
      observedGapMs: observedGapMs(),
      rejected: state.rejected.length,
      lastRejection: state.rejected.at(-1)?.reason || '',
    });
  }

  return Object.freeze({
    pushFix,
    visualPositionAt,
    isMoving,
    measuredPosition,
    observedGapMs,
    reset,
    debugState,
  });
}

function pointOf(location) {
  return { lat: Number(location.lat), lng: Number(location.lng) };
}
