// CERTIFICACIÓN E-COMMERCE — carga controlada y compuerta de rendimiento.
//
// Dos cosas, las dos sin red y sin base (por eso se pueden probar solas):
//
//   · `runStep`: N requests de una operación con una concurrencia fija, cada una medida en
//     el cliente, y su resumen (p50 / p95 / p99, errores por estado, pico en vuelo);
//   · LA COMPUERTA. Los umbrales NO se inventan: viven en un archivo versionado
//     (`docs/ecommerce-hardening/performance-thresholds.json`), uno por destino, y salen de
//     una corrida medida. Mientras un destino no tiene umbrales, la fase mide y contesta
//     MEASURED_NO_GATE con el bloque que habría que versionar; cuando los tiene, cada p95
//     medido se compara contra su techo y la compuerta es PASS o FAIL.
//
// LA REGLA con la que se propone un techo (está escrita también en el archivo):
//   techo de p95 = el p95 medido × 3, redondeado hacia arriba a 50 ms, nunca por debajo de
//   250 ms y NUNCA por encima del `statement_timeout` del rol que hace la llamada (anon 3 s,
//   authenticated 8 s; la clave de servicio entra por `authenticator`, 8 s). Un techo igual
//   al timeout no dice nada del rendimiento —esa llamada ya estaría fallando—, así que
//   queda marcado (`at_timeout`) para que quien lo versione lo mire.
import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pool, summarize } from './http.mjs';

export const THRESHOLDS_FILE = 'docs/ecommerce-hardening/performance-thresholds.json';
export const THRESHOLD_RULE = Object.freeze({ metric: 'p95_ms', multiplier: 3, round_up_to_ms: 50, floor_ms: 250,
  cap: 'statement_timeout of the role that makes the call' });
export const GATE = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', NO_GATE: 'MEASURED_NO_GATE' });
// El nombre de cada paso de carga: la línea de base en serie y un nivel de concurrencia.
export const stepName = (concurrency) => (concurrency === 1 ? 'baseline' : `c${concurrency}`);

// «3s», «8000ms», «2min» → milisegundos. Lo que no se entiende es «sin límite conocido» (null).
export function timeoutMs(setting) {
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*(us|ms|s|min|h)?$/i.exec(String(setting ?? '').trim());
  if (!match) return null;
  const factor = { us: 0.001, ms: 1, s: 1000, min: 60_000, h: 3_600_000 }[(match[2] || 'ms').toLowerCase()];
  const value = Number(match[1]) * factor;
  return value > 0 ? value : null;   // 0 es «sin límite»
}
// De `pg_db_role_setting` (rol → lista de `clave=valor`) al tiempo límite de sentencia de cada rol de la API.
export function roleTimeouts(roleSettings = {}) {
  const of = (role) => timeoutMs(((roleSettings?.[role] || []).find((entry) => String(entry).startsWith('statement_timeout=')) || '').split('=')[1]);
  const authenticator = of('authenticator');
  return { anon: of('anon') ?? authenticator, authenticated: of('authenticated') ?? authenticator, service_role: of('service_role') ?? authenticator };
}

export function ceilingFor(p95Ms, limitMs = null) {
  if (!(Number.isFinite(p95Ms) && p95Ms >= 0)) return null;
  const { multiplier, round_up_to_ms: step, floor_ms: floor } = THRESHOLD_RULE;
  const wanted = Math.max(floor, Math.ceil((p95Ms * multiplier) / step) * step);
  return Number.isFinite(limitMs) && limitMs > 0 ? Math.min(wanted, limitMs) : wanted;
}

// El bloque que se versiona después de una corrida medida. `results` son los pasos de carga; `roles` dice
// con qué rol llama cada operación; `timeouts`, el tiempo límite de cada rol (ms).
export function proposeThresholds(results = [], { roles = {}, timeouts = {}, runId = null, measuredAt = null } = {}) {
  const operations = {};
  const atTimeout = [];
  for (const result of results) {
    if (!(result.ok > 0) || !Number.isFinite(result.p95)) continue;   // sin una sola respuesta buena no hay de dónde sacar un techo
    const limit = timeouts[roles[result.operation]] ?? null;
    const ceiling = ceilingFor(result.p95, limit);
    operations[result.operation] ||= {};
    operations[result.operation][result.step] = ceiling;
    if (limit !== null && ceiling >= limit) atTimeout.push(`${result.operation}:${result.step}`);
  }
  return { measured_at: measuredAt, run_id: runId, rule: THRESHOLD_RULE, role_timeouts_ms: timeouts, operations, at_timeout: atTimeout };
}

// ¿Los pasos medidos respetan los techos versionados? Sin techos para el destino: MEASURED_NO_GATE.
export function evaluateGate(results = [], thresholds = null) {
  if (!thresholds || typeof thresholds !== 'object' || !thresholds.operations || !Object.keys(thresholds.operations).length) {
    return { verdict: GATE.NO_GATE, checked: 0, violations: [], notMeasured: [], withoutThreshold: results.map((r) => `${r.operation}:${r.step}`) };
  }
  const violations = [];
  const notMeasured = [];
  const withoutThreshold = [];
  let checked = 0;
  const measured = new Map(results.map((result) => [`${result.operation}:${result.step}`, result]));
  for (const [operation, steps] of Object.entries(thresholds.operations)) {
    for (const [step, ceiling] of Object.entries(steps || {})) {
      const result = measured.get(`${operation}:${step}`);
      // Un techo versionado que esta corrida no midió es una compuerta que no se evaluó: falla, no se saltea.
      if (!result || !Number.isFinite(result.p95)) { notMeasured.push(`${operation}:${step}`); continue; }
      checked += 1;
      if (!(Number.isFinite(ceiling) && ceiling > 0)) { violations.push({ operation, step, p95: result.p95, ceiling, reason: 'ceiling is not a positive number' }); continue; }
      if (result.p95 > ceiling) violations.push({ operation, step, p95: result.p95, ceiling, reason: 'p95 above its ceiling' });
    }
  }
  for (const key of measured.keys()) {
    const [operation, step] = key.split(':');
    if (thresholds.operations?.[operation]?.[step] === undefined) withoutThreshold.push(key);
  }
  return { verdict: violations.length || notMeasured.length ? GATE.FAIL : GATE.PASS, checked, violations, notMeasured, withoutThreshold };
}

// Los techos de UN destino, del archivo versionado. `null` = ese destino todavía no tiene compuerta.
export function readThresholds(file, kind) {
  if (!existsSync(file)) return { found: false, thresholds: null, rule: null };
  const document = JSON.parse(readFileSync(file, 'utf8'));
  const thresholds = document?.targets?.[kind] ?? null;
  return { found: true, thresholds: thresholds && typeof thresholds === 'object' ? thresholds : null, rule: document?.rule ?? null };
}

// El resumen de un paso a partir de sus respuestas del transporte (`status`, `ok`, `ms`, `code`). La latencia que
// cuenta es la de las que contestaron bien; las otras se cuentan por estado y código. Una respuesta que falta (la
// cadena se cortó antes de llegar a esa operación) no es una request: no suma.
export function stepResult({ operation, concurrency, answers, wallMs, peak = null }) {
  const sent = answers.filter(Boolean);
  const good = sent.filter((r) => r.ok);
  const statuses = {};
  for (const r of sent) {
    const key = r.ok ? String(r.status) : `${r.status ?? 0}${r.code ? ` ${r.code}` : ''}`;
    statuses[key] = (statuses[key] || 0) + 1;
  }
  const stats = summarize(good.map((r) => r.ms));
  return { operation, step: stepName(concurrency), concurrency, requests: sent.length, ok: good.length, errors: sent.length - good.length, statuses,
    p50: stats.p50, p95: stats.p95, p99: stats.p99, max: stats.max, mean: stats.mean, min: stats.min,
    wallMs: Math.round(wallMs), perSecond: wallMs > 0 ? Math.round((sent.length / (wallMs / 1000)) * 10) / 10 : null, peakInFlight: peak };
}

// Un paso de carga: `items.length` requests de `operation`, a lo sumo `concurrency` en vuelo. `task` devuelve
// la respuesta del transporte.
export async function runStep({ operation, concurrency, items, task, maxConcurrency }) {
  const started = performance.now();
  const answers = await pool(items, Math.min(concurrency, Math.max(1, items.length)), task, maxConcurrency);
  return { ...stepResult({ operation, concurrency, answers, wallMs: performance.now() - started, peak: answers.peak }), answers };
}
