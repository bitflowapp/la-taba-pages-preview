// ─────────────────────────────────────────────────────────────────────────────
// Growth engine · CONTEXTO TEMPORAL.
// -----------------------------------------------------------------------------
// Cubos gruesos de hora y día para que una campaña pueda decir "esta pieza
// rinde más de noche" sin inferir nada personal. Deliberadamente simple: no
// hay perfiles horarios por persona, no se guarda nada; es una función pura
// del reloj que se pasa por parámetro.
//
// Usa la hora LOCAL del dispositivo: el contexto es "qué momento vive el
// cliente", no el huso comercial del negocio (ese existe para el cierre de
// caja y no se toca desde acá).

export const CONTEXT_BUCKETS = Object.freeze([
  'morning', // 06-11
  'afternoon', // 12-17
  'evening', // 18-22
  'night', // 23-05
  'weekend', // sábado y domingo
  'friday',
]);

const VALID_BUCKETS = new Set(CONTEXT_BUCKETS);

export function contextBucketsAt(now) {
  const date = new Date(Number(now));
  if (Number.isNaN(date.getTime())) return [];
  const hour = date.getHours();
  const day = date.getDay();
  const buckets = [];
  if (hour >= 6 && hour <= 11) buckets.push('morning');
  else if (hour >= 12 && hour <= 17) buckets.push('afternoon');
  else if (hour >= 18 && hour <= 22) buckets.push('evening');
  else buckets.push('night');
  if (day === 0 || day === 6) buckets.push('weekend');
  if (day === 5) buckets.push('friday');
  return buckets;
}

/**
 * 0..1: proporción de los contextos declarados por la campaña que están
 * activos ahora. Sin declaración → 0 (neutral: no suma ni resta). El peso
 * final lo pone el ranking; acá sólo se mide coincidencia.
 */
export function contextMatch(declaredContexts, activeBuckets) {
  const declared = (Array.isArray(declaredContexts) ? declaredContexts : [])
    .filter((bucket) => VALID_BUCKETS.has(bucket));
  if (!declared.length) return 0;
  const active = new Set(Array.isArray(activeBuckets) ? activeBuckets : []);
  const matched = declared.filter((bucket) => active.has(bucket)).length;
  return matched / declared.length;
}

/**
 * Desempate determinista para scores EXACTAMENTE iguales (cold start puro):
 * rota por ventana de tiempo (por defecto, por día). Mismo día → misma pieza;
 * otro día → otra. Sin Math.random: los tests fijan `now` y obtienen siempre
 * el mismo índice.
 */
export function rotationIndex(now, count, windowMs) {
  const total = Math.max(1, Math.floor(Number(count) || 1));
  const window = Math.max(1, Math.floor(Number(windowMs) || 1));
  const timestamp = Number(now);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  return Math.floor(timestamp / window) % total;
}
