// ─────────────────────────────────────────────────────────────────────────────
// QUÉ CUENTA COMO COORDENADA EN EL CLIENTE
//
// POR QUÉ EXISTE
// --------------
// `Number(null)` es `0`, y `Number.isFinite(0)` es `true`. Cuatro validadores
// distintos —`isValidLocation`, `isValidMapPoint`, `normalizeTrackingLocation` y
// `normalizeRiderLocation`— escribían la comprobación así:
//
//     const lat = Number(raw.lat);
//     if (!Number.isFinite(lat) || Math.abs(lat) > 90) return null;
//
// y por lo tanto los cuatro daban por buena la ausencia de dato. Medido sobre el
// código anterior, `{lat: null, lng: null, source: 'gps'}` producía un fix
// completo en 0,0 —con `source`, `timestamp` y `lastFixAt`—, `isUsableGpsFix`
// devolvía `true`, `chooseRiderLocation` lo elegía para dibujar, el halo de
// precisión se pintaba alrededor, y `distanceKm` contra el local informaba
// 8.128,5 km. Ninguno de esos números existió jamás: son `null` pasado por
// `Number()`.
//
// El proyecto prohíbe inventar ubicación. Un dato que falta tiene que verse como
// que falta, no como el Golfo de Guinea.
//
// QUÉ RECHAZA Y POR QUÉ ESE CONJUNTO
// -----------------------------------
// Todo lo que `Number()` convierte en un número sin que nadie haya medido nada:
// `null`, `undefined`, la cadena vacía, la cadena de espacios, los arrays
// —`Number([])` es `0`, `Number([7])` es `7`— y los booleanos —`Number(false)`
// es `0`, `Number(true)` es `1`—. Y además lo que ya se rechazaba bien: `NaN`,
// `±Infinity` y lo que se sale de rango.
//
// El cero numérico SIGUE siendo válido. 0,0 es un punto real y esta capa no es
// el lugar para decidir que un comercio de Neuquén no puede estar ahí: lo que se
// rechaza es la AUSENCIA de dato, no un valor medido.
//
// Las cadenas numéricas siguen siendo válidas: PostgREST devuelve `double
// precision` como número, pero hay caminos que pasan por `FormData` y por
// `localStorage`, donde todo es texto.
// ─────────────────────────────────────────────────────────────────────────────

export const LATITUDE_LIMIT = 90;
export const LONGITUDE_LIMIT = 180;

/**
 * Un número medido dentro de `limit`, o `null`. Nunca completa lo que falta.
 */
export function finiteCoordinate(value, limit) {
  if (value == null) return null;
  if (typeof value === 'boolean') return null;
  if (Array.isArray(value)) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) > limit) return null;
  return numeric;
}

export function finiteLatitude(value) {
  return finiteCoordinate(value, LATITUDE_LIMIT);
}

export function finiteLongitude(value) {
  return finiteCoordinate(value, LONGITUDE_LIMIT);
}

/**
 * El par `{lat, lng}` si AMBAS coordenadas son datos medidos, o `null`.
 *
 * Devolver el par —y no dos valores sueltos— es deliberado: media coordenada no
 * es medio punto, es ningún punto, y separar las dos comprobaciones es
 * exactamente cómo se cuela un 0.
 */
export function coordinatePair(latValue, lngValue) {
  const lat = finiteLatitude(latValue);
  const lng = finiteLongitude(lngValue);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

/**
 * `true` si el objeto trae un punto dibujable en `lat`/`lng`.
 */
export function isGeoPoint(point) {
  return coordinatePair(point?.lat, point?.lng) != null;
}
