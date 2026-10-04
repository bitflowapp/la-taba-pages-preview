// CERTIFICACIÓN E-COMMERCE — transporte.
//
// Las mismas llamadas que hacen los clientes reales (PostgREST: RPC y tablas),
// pero devolviendo SIEMPRE lo que una aserción necesita: estado HTTP, cuerpo,
// error tipado (code/message/details/hint), encabezados y latencia.
//
//   call()            RPC con la sesión de un actor (o sin sesión: rol anon)
//   service()         RPC con la clave de servicio: la llamada que en producción hace una Edge Function
//   restGet/restWrite lecturas y escrituras directas a tablas (lo que decide RLS)
//   edge()            una Edge Function (`/functions/v1/<nombre>`)
//   raw()             cualquier ruta del destino, con o sin la clave del proyecto
//   lostResponse()    la request llega y se procesa, pero quien llamó no recibe
//                     la respuesta (corte de red del lado del cliente)
//   pool()            concurrencia acotada
//   createLatency()   muestras por operación con p50 / p95 / p99
//   refused()         un rechazo afirmado entero: estado HTTP + código (+ texto estable)
//
// Las URL se arman sobre la base del destino (`target.baseUrl`) y quien decide adónde
// llega cada request es su `fetch`: en Staging y en el stack sale tal cual; en el destino
// local se contesta sin salir de la máquina.
import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { STAGING_TARGET, assertNoProtectedBusiness, isGuardStop, nowIso, sleep } from './env.mjs';

export const MAX_CONCURRENCY = 30;
export const MAX_LOAD_REQUESTS_PER_RUN = 3000;

// ── Percentiles ──────────────────────────────────────────────────────────────
// Rango más cercano (nearest-rank): el valor observado en la posición ceil(q·n).
export function percentile(values, q) {
  const sorted = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (!(q > 0)) return sorted[0];
  if (q >= 1) return sorted[sorted.length - 1];
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}
export function summarize(values) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return { n: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null };
  const round = (v) => Math.round(v * 10) / 10;
  return { n: clean.length, min: round(Math.min(...clean)), p50: round(percentile(clean, 0.5)), p95: round(percentile(clean, 0.95)),
    p99: round(percentile(clean, 0.99)), max: round(Math.max(...clean)), mean: round(clean.reduce((a, b) => a + b, 0) / clean.length) };
}
export function createLatency() {
  const samples = new Map();
  return {
    add(name, ms) { if (!samples.has(name)) samples.set(name, []); samples.get(name).push(ms); return ms; },
    values: (name) => (samples.get(name) || []).slice(),
    summary: (name) => summarize(samples.get(name) || []),
    all: () => Object.fromEntries([...samples.keys()].map((name) => [name, summarize(samples.get(name))])),
  };
}

// ── Concurrencia acotada ─────────────────────────────────────────────────────
// `max` es el tope del que llama: 30 por defecto (el entorno compartido), y lo que el destino admita en la
// fase de rendimiento (`target.load.maxConcurrency`).
export async function pool(items, limit, worker, max = MAX_CONCURRENCY) {
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw Error(`CONCURRENCY_OUT_OF_BOUNDS:${limit}`);
  const results = new Array(items.length);
  let next = 0;
  let inFlight = 0;
  let peak = 0;
  const lane = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try { results[index] = await worker(items[index], index); } finally { inFlight -= 1; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  results.peak = peak;
  return results;
}

// Presupuesto de requests de carga por corrida: el entorno es compartido.
export function createBudget(max = MAX_LOAD_REQUESTS_PER_RUN, used = 0) {
  let spent = used;
  return {
    take(n = 1) { if (spent + n > max) throw Error(`LOAD_BUDGET_EXCEEDED:${spent + n}>${max}`); spent += n; return spent; },
    used: () => spent,
    max,
  };
}

// ── Transporte ───────────────────────────────────────────────────────────────
const parseBody = (text) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
const pickHeaders = (res) => ({ retryAfter: res.headers.get('retry-after'), contentRange: res.headers.get('content-range'),
  contentType: res.headers.get('content-type'), server: res.headers.get('server') });

export function createHttp({ publishableKey, secretKey = null, guard = null, requests = { total: 0 }, target = STAGING_TARGET, latency = null, journal = null }) {
  const base = target.baseUrl;
  // `actor.apikey` sólo lo trae el actor de servicio: la puerta de entrada exige la clave y deriva el rol de ella.
  const baseHeaders = (actor, extra = {}, origin = null) => ({ apikey: actor?.apikey ?? publishableKey, Authorization: `Bearer ${actor?.jwt || publishableKey}`,
    'Content-Type': 'application/json', ...target.originHeaders(origin), ...extra });
  // `origin`: la dirección de red desde la que llega la request. En Staging la pone Cloudflare y no se elige
  // (pedirla lanza); en local la estampa el `fetch` del destino; en el stack viaja en el encabezado que
  // declara el transporte. Es para las pruebas de abuso y para repartir la carga entre orígenes.
  const send = (url, init, origin) => (origin ? target.fromOrigin(origin, () => target.fetch(url, init)) : target.fetch(url, init));
  // La clave de servicio como actor del transporte propio: lo que en producción llama una Edge Function.
  const serviceActor = secretKey ? Object.freeze({ kind: 'service_role', label: 'edge-function', jwt: secretKey, apikey: secretKey }) : null;

  // `operation` nombra el tipo de llamada (`rpc <función>`, `GET <tabla>`) para la latencia por operación.
  // `journal` junta TODA respuesta que no fue 2xx, en orden: qué se llamó, como quién, y qué estado y código volvieron.
  const shape = (res, text, t0, operation, actor) => {
    const json = parseBody(text);
    const failed = !res.ok;
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    latency?.add(operation, ms);
    if (failed) {
      journal?.push({ at: nowIso(), operation, as: actor ? `${actor.kind}:${actor.label}` : 'anon', http: res.status, code: json?.code ?? null,
        message: String(json?.message ?? json?.msg ?? text ?? '').slice(0, 200), details: json?.details ? String(json.details).slice(0, 200) : null, hint: json?.hint ?? null,
        retryAfter: res.headers.get('retry-after') });
    }
    return { status: res.status, ok: res.ok, ms,
      data: failed ? null : json,
      error: failed ? { code: json?.code ?? null, message: String(json?.message ?? json?.msg ?? text ?? '').slice(0, 300), details: json?.details ?? null, hint: json?.hint ?? null } : null,
      code: failed ? json?.code ?? null : null, headers: pickHeaders(res) };
  };
  const tableOf = (pathAndQuery) => String(pathAndQuery).split('?')[0];
  const failure = (error, t0) => ({ status: 0, ok: false, ms: Math.round((performance.now() - t0) * 10) / 10, data: null,
    aborted: error?.name === 'AbortError' || error?.name === 'TimeoutError',
    error: { code: error?.name || 'NETWORK', message: String(error?.message || error).slice(0, 200), details: null, hint: null },
    code: error?.name || 'NETWORK', headers: {} });

  // RPC. `actor` nulo = sin sesión (rol anon, sólo la clave publicable).
  async function call(actor, fn, params = {}, { headers = {}, timeoutMs = 60_000, signal, allowDecoy = false, origin = null } = {}) {
    if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw Error('RPC_NAME_INVALID');
    if (guard) guard.assertParams(params, { allowDecoy });
    const t0 = performance.now();
    requests.total += 1;
    try {
      const res = await send(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: baseHeaders(actor, headers, origin),
        body: JSON.stringify(params), signal: signal || AbortSignal.timeout(timeoutMs) }, origin);
      return shape(res, await res.text(), t0, `rpc ${fn}`, actor);
    } catch (error) {
      if (isGuardStop(error)) throw error;
      return failure(error, t0);
    }
  }

  // RPC con la clave de servicio, por el MISMO transporte: mide, anota cada respuesta no 2xx y pasa por el
  // resguardo de tenant. Quien la usa deja el uso anotado en el ledger (`ctx.serviceRole.announce`).
  function service(fn, params = {}, options = {}) {
    if (!serviceActor) throw Error('SERVICE_ROLE_KEY_NOT_LOADED');
    return call(serviceActor, fn, params, options);
  }

  async function restGet(actor, pathAndQuery, { headers = {}, timeoutMs = 30_000, origin = null } = {}) {
    const t0 = performance.now();
    requests.total += 1;
    try {
      const res = await send(`${base}/rest/v1/${pathAndQuery}`, { method: 'GET',
        headers: baseHeaders(actor, headers, origin), signal: AbortSignal.timeout(timeoutMs) }, origin);
      const out = shape(res, await res.text(), t0, `GET ${tableOf(pathAndQuery)}`, actor);
      out.rows = Array.isArray(out.data) ? out.data : null;
      return out;
    } catch (error) {
      if (isGuardStop(error)) throw error;
      return { ...failure(error, t0), rows: null };
    }
  }

  // Escritura directa a una tabla. `businessId` es obligatorio: dice a qué negocio
  // pertenece la fila que se intenta tocar y pasa por el resguardo de tenant.
  async function restWrite(actor, method, pathAndQuery, body, { businessId, headers = {}, timeoutMs = 30_000, origin = null } = {}) {
    const verb = String(method).toUpperCase();
    if (!['POST', 'PATCH', 'DELETE'].includes(verb)) throw Error('REST_WRITE_METHOD_INVALID');
    if (guard) guard.assertWrite(businessId);
    const t0 = performance.now();
    requests.total += 1;
    try {
      const res = await send(`${base}/rest/v1/${pathAndQuery}`, { method: verb,
        headers: baseHeaders(actor, { Prefer: 'return=representation', ...headers }, origin),
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) }, origin);
      const out = shape(res, await res.text(), t0, `${verb} ${tableOf(pathAndQuery)}`, actor);
      out.rows = Array.isArray(out.data) ? out.data : null;
      return out;
    } catch (error) {
      if (isGuardStop(error)) throw error;
      return { ...failure(error, t0), rows: null };
    }
  }

  // Cualquier ruta del destino, tal cual. `key: false` manda la request SIN la clave del proyecto (para
  // afirmar que la puerta de entrada la exige). Devuelve además el texto del cuerpo: no toda respuesta
  // de la plataforma es JSON.
  async function raw(method, pathname, { actor = null, key = true, headers = {}, body, timeoutMs = 30_000, operation = null } = {}) {
    if (!String(pathname).startsWith('/')) throw Error('RAW_PATH_INVALID');
    if (typeof body === 'string') assertNoProtectedBusiness(body);
    const t0 = performance.now();
    requests.total += 1;
    try {
      const sent = key ? { ...baseHeaders(actor), ...headers } : { 'Content-Type': 'application/json', ...headers };
      const res = await target.fetch(`${base}${pathname}`, { method: String(method).toUpperCase(), headers: sent,
        body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      const out = shape(res, text, t0, operation || `${String(method).toUpperCase()} ${String(pathname).split('?')[0]}`, actor);
      // El cuerpo entero (JSON o texto) para quien afirma sobre una respuesta de la plataforma, sea 2xx o no.
      out.body = parseBody(text);
      out.text = text.slice(0, 600);
      return out;
    } catch (error) {
      if (isGuardStop(error)) throw error;
      return { ...failure(error, t0), body: null, text: '' };
    }
  }

  // Una Edge Function. Nunca lleva la clave de servicio: la llama un cliente (o nadie, sin sesión). `query` va
  // tal cual detrás del nombre (el webhook de Mercado Pago lee `data.id` y `type` de la URL).
  const edge = (name, { method = 'POST', actor = null, headers = {}, body = {}, timeoutMs = 30_000, query = '' } = {}) => {
    if (!/^[a-z][a-z0-9-]{1,60}$/.test(name)) throw Error('EDGE_FUNCTION_NAME_INVALID');
    if (query && !/^\?[A-Za-z0-9._~%=&-]{1,300}$/.test(query)) throw Error('EDGE_FUNCTION_QUERY_INVALID');
    return raw(method, `/functions/v1/${name}${query}`, { actor, headers, body: ['GET', 'HEAD'].includes(String(method).toUpperCase()) ? undefined : body,
      timeoutMs, operation: `edge ${name}` });
  };

  // Respuesta perdida, de forma determinista: la request sale por un socket propio, se
  // espera a que el servidor la haya procesado (lo dice quien llama, con el observador)
  // y se corta la conexión SIN leer la respuesta. Lo que haya llegado al socket se destruye.
  async function sendAndDropResponse(actor, fn, params, serverProcessed, { maxMs = 25_000 } = {}) {
    if (guard) guard.assertParams(params);
    const body = JSON.stringify(params);
    assertNoProtectedBusiness(body);
    // El socket propio no pasa por el `fetch` del destino: es el destino el que dice adónde va y con qué encabezados.
    const wire = target.wire(target.guard(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', body }), baseHeaders(actor));
    const info = { mode: 'dropped-unread', requestSent: false, serverProcessed: false, responseDeliveredToCaller: false, bytesReachedSocketBeforeDrop: false };
    requests.total += 1;
    const req = (wire.url.protocol === 'https:' ? https : http).request(wire.url, { method: 'POST', agent: false, headers: wire.headers });
    req.on('error', () => {});
    req.on('response', (res) => { info.bytesReachedSocketBeforeDrop = true; res.destroy(); });
    await new Promise((resolve) => req.end(body, resolve));
    info.requestSent = true;
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      if (await serverProcessed()) { info.serverProcessed = true; break; }
      await sleep(400);
    }
    req.destroy();
    info.waitedMs = Date.now() - t0;
    return info;
  }

  // LA RESPUESTA PERDIDA. Es el corte determinista de arriba, con su veredicto: «perdida» quiere decir que la
  // request salió entera, que el servidor la procesó (lo confirmó el observador) y que quien llamó no leyó un
  // byte de la respuesta. Un corte por tiempo del lado del cliente no sirve contra un backend rápido: la
  // respuesta llega antes de que venza cualquier temporizador razonable, y entonces no se perdió nada.
  async function lostResponse(actor, fn, params, serverProcessed, options = {}) {
    const dropped = await sendAndDropResponse(actor, fn, params, serverProcessed, options);
    return { lost: Boolean(dropped.requestSent && dropped.serverProcessed && !dropped.responseDeliveredToCaller), mode: dropped.mode, dropped };
  }
  // Lo mismo para la llamada que hace una Edge Function con la clave de servicio.
  const lostServiceResponse = (fn, params, serverProcessed, options) => {
    if (!serviceActor) throw Error('SERVICE_ROLE_KEY_NOT_LOADED');
    return lostResponse(serviceActor, fn, params, serverProcessed, options);
  };

  return { call, service, restGet, restWrite, raw, edge, sendAndDropResponse, lostResponse, lostServiceResponse, requests };
}

// Resumen estable de una respuesta para dejar en la evidencia (sin el cuerpo entero).
export const brief = (r) => ({ http: r?.status ?? null, ok: Boolean(r?.ok), code: r?.error?.code ?? null,
  message: r?.error?.message ? String(r.error.message).slice(0, 160) : null, details: r?.error?.details ?? null, ms: r?.ms ?? null });

// ── Rechazos ─────────────────────────────────────────────────────────────────
// LA TABLA. El estado HTTP con el que el backend contesta cada SQLSTATE que usa para rechazar. Un rechazo se
// afirma ENTERO, estado + código: un cliente decide por el estado (reintentar, avisar, cortar) antes de leer
// el cuerpo, y un 500 con el código correcto adentro sigue siendo un 500. Todas las aserciones de rechazo de
// todas las fases pasan por acá: cuando el backend cambia un estado, se cambia UN número.
export const REFUSAL_STATUS = Object.freeze({
  22007: 400,   // un texto que no es un instante (lo rechaza el tipo antes que la función)
  22023: 400,   // validación de entrada
  23502: 400,   // not null
  23503: 409,   // la referencia no existe
  23505: 409,   // clave repetida
  23514: 400,   // regla de negocio (check)
  42501: 403,   // sin permiso, CON sesión; sin sesión es 401 (ver `refused`)
  PT409: 409,   // revisión desactualizada
  PT429: 429,   // frenado por el guardián de admisión (pedido manual)
  54000: 429,   // frenado por el guardián de admisión (canal de checkout: lo recibe la Edge Function)
  // API-01: un rechazo de negocio con SQLSTATE 55000 («el objeto no está en el estado que hace falta»: comercio
  // cerrado, producto no disponible, fuera de zona…) es definitivo para ese pedido y sale con HTTP 409. Lo
  // decide la frontera de la API (20261002090000; política en docs/ecommerce-hardening/http-contract.md): el
  // cuerpo (code, message, details, hint) es el mismo de antes, sólo cambió el estado, que era 500.
  55000: 409,
  // C-2: «no existe» (P0002) sale con HTTP 404, por el mismo mecanismo (antes 500).
  P0002: 404,
});
// Los códigos por su nombre. Las fases nuevas piden el rechazo por lo que SIGNIFICA: si el arreglo de un
// hallazgo cambia el SQLSTATE además del estado, también se cambia acá y en ningún otro lado.
export const CODES = Object.freeze({ VALIDATION: '22023', BAD_INSTANT: '22007', NOT_FOUND: 'P0002', DUPLICATE: '23505', MISSING_REFERENCE: '23503', RULE: '23514',
  FORBIDDEN: '42501', STATE: '55000', STALE_REVISION: 'PT409', INTAKE_LIMIT: 'PT429', CHECKOUT_LIMIT: '54000' });
// `actor` nulo = sin sesión: PostgREST contesta 401 a un 42501 cuando no hay un usuario autenticado.
export const refusalStatus = (code, actor = undefined) => (String(code) === '42501' && actor === null ? 401 : REFUSAL_STATUS[code] ?? null);
// ¿`r` es el rechazo `code`, con su estado HTTP y (si se piden) su texto estable en el mensaje o en el detalle?
export function refused(r, code, { actor, message = null, details = null } = {}) {
  return Boolean(r) && !r.ok && r.code === String(code) && r.status === refusalStatus(code, actor)
    && (!message || String(r.error?.message || '').includes(message))
    && (!details || String(r.error?.details || '').includes(details));
}
// Lo que se esperaba, en palabras, para la evidencia.
export const refusal = (code, { actor, message = null, details = null } = {}) => `HTTP ${refusalStatus(code, actor)} · ${code}${message ? ` · ${message}` : ''}${details ? ` · ${details}` : ''}`;
// Una lectura que NO tiene que mostrar nada: o contesta 200 con cero filas (la política de filas la vació) o
// se rechaza como «sin permiso» (no hay privilegio sobre la tabla o la columna). Nunca filas, y nunca otro error.
export function hidden(r, actor = undefined) {
  return Boolean(r) && ((r.status === 200 && Array.isArray(r.rows) && r.rows.length === 0) || refused(r, CODES.FORBIDDEN, { actor }));
}
