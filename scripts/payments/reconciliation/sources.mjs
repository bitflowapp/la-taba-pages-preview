// Conciliación de pagos: FUENTES DE DATOS. Todas de sólo lectura.
//
// Dos lados y nada más:
//   · LOCAL: una única sentencia SELECT sobre las tablas de pagos y pedidos,
//     ejecutada por un `runReadOnlySql(sql)` que inyecta quien llama (la
//     Management API en su endpoint de sólo lectura, o un cliente pg dentro de
//     una transacción READ ONLY);
//   · PROVEEDOR: un `fetchProviderPayments({ externalReferences, from, to,
//     referencesOnly })` que devuelve `{ payments, coverage }`, con dos
//     adaptadores: un archivo exportado y la búsqueda de pagos de Mercado
//     Pago, que sólo sabe hacer GET. `coverage` dice qué se puede afirmar con
//     esos pagos: `complete` + `range` (el rango vino entero) y
//     `queriedReferences` (referencias de las que se trajeron TODOS los pagos).
//
// POR QUÉ LA GUARDA ES UNA LISTA BLANCA
// -------------------------------------
// Una lista de palabras prohibidas siempre se olvida de alguna. Acá es al
// revés: `assertReadOnlySql` conoce las pocas palabras, funciones, tablas y
// columnas que usa la consulta de este archivo y rechaza cualquier otra cosa.
// Una sentencia que escriba no puede pasar porque sus palabras no están en la
// lista; una que lea otra tabla u otra columna (un teléfono, una dirección)
// tampoco. La guarda envuelve al ejecutor inyectado: ni un cambio futuro en
// este archivo ni un ejecutor mal cableado pueden mandar otra cosa.
//
// POR QUÉ LOS ERRORES NO REPITEN LO RECIBIDO
// ------------------------------------------
// Un token pegado en el flag equivocado, o el cuerpo de una respuesta de
// error, terminarían en la consola y en el log de quien automatice esto. Los
// mensajes llevan un código y, a lo sumo, valores que este archivo conoce.
import { readFileSync } from 'node:fs';
import { INTEGRATION_REFERENCE } from './classify.mjs';

// ── Destinos: sólo estos dos proyectos ───────────────────────────────────────
export const TARGET_REFS = Object.freeze({
  staging: 'ucbtjcurawxjwjdvvcvj',
  'controlled-production': 'tkanbadcglszlcyfjvpv',
});

/** Ata el nombre del destino a su proyecto. Cualquier otro nombre o ref se rechaza. */
export function resolveTarget(target, assertedRef = '') {
  const ref = Object.hasOwn(TARGET_REFS, String(target)) ? TARGET_REFS[target] : null;
  if (!ref) throw Error(`UNKNOWN_TARGET — sólo ${Object.keys(TARGET_REFS).join(' | ')}`);
  if (assertedRef && assertedRef !== ref) throw Error(`TARGET_REF_MISMATCH: el ref indicado no es el proyecto de ${target}`);
  return Object.freeze({ name: target, ref });
}

function assertBoundRef(ref) {
  if (!Object.values(TARGET_REFS).includes(ref)) throw Error('PROJECT_REF_NOT_ALLOWED');
  return ref;
}

// ── Validación de parámetros: lo que entra a la consulta ─────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
export const ENVIRONMENTS = Object.freeze(['test', 'production']);
export const DEFAULT_MAX_INTENTS = 2000;

export function assertUuid(value, label = 'uuid') {
  if (!UUID.test(String(value || ''))) throw Error(`INVALID_UUID:${label}`);
  return String(value).toLowerCase();
}

/**
 * Un instante con zona explícita. Sin zona, «2026-10-01T00:00» significa cosas
 * distintas en la notebook y en la base, y una ventana corrida tres horas hace
 * aparecer o desaparecer pagos.
 */
export function assertInstant(value, label = 'fecha') {
  const raw = String(value || '');
  const ms = Date.parse(raw);
  if (!ISO_INSTANT.test(raw) || !Number.isFinite(ms)) throw Error(`INVALID_INSTANT:${label} — se espera ISO 8601 con zona (…Z o ±hh:mm)`);
  return new Date(ms).toISOString();
}

// ── Guarda de sólo lectura ───────────────────────────────────────────────────
const SQL_WORDS = new Set(['with', 'as', 'select', 'from', 'join', 'on', 'where', 'and', 'or', 'not', 'in', 'is', 'null',
  'true', 'false', 'union', 'all', 'group', 'by', 'order', 'desc', 'limit', 'distinct']);
const SQL_CALLS = new Set(['coalesce', 'jsonb_build_object', 'jsonb_agg', 'bool_or', 'count', 'replace', 'clock_timestamp']);
const SQL_TYPES = new Set(['uuid', 'timestamptz', 'jsonb', 'text']);
const SQL_ALIASES = new Set(['p', 'o', 'pi', 'cs', 's', 'c', 'ir', 'ro', 'so', 'oi', 'wo', 'pe', 'r', 'd', 'b', 'ps']);
const SQL_NAMES = new Set(['params', 'window_orders', 'candidate_intents', 'scoped', 'intent_rows', 'request_orders',
  'scoped_orders', 'order_ids', ...SQL_ALIASES,
  'payload', 'business_id', 'from_ts', 'to_ts', 'id', 'in_window', 'payment_intent_id', 'order_id', 'session_status',
  'session_total', 'session_completed_order_id', 'session_expires_at']);
// Las únicas tablas que se leen y las únicas columnas que se nombran. Ninguna
// es de contacto, dirección o texto libre: `alias.customer_phone` no pasa.
const SQL_TABLES = new Set(['payment_intents', 'checkout_sessions', 'orders', 'payment_events', 'payment_refunds',
  'payment_disputes', 'businesses', 'business_payment_settings']);
const SQL_COLUMNS = new Set(['id', 'business_id', 'from_ts', 'to_ts', 'payment_method', 'created_at', 'updated_at',
  'client_request_id', 'public_code', 'status', 'total', 'origin', 'external_reference', 'provider', 'environment',
  'order_id', 'checkout_session_id', 'provider_payment_id', 'provider_status', 'provider_status_detail',
  'internal_status', 'currency', 'expected_amount', 'paid_amount', 'refunded_amount', 'approved_at',
  'provider_event_at', 'security_review_reason', 'in_window', 'completed_order_id', 'expires_at', 'session_status',
  'session_total', 'session_completed_order_id', 'session_expires_at', 'provider_event_id', 'payment_intent_id',
  'event_type', 'slug', 'enabled', 'collector_id', 'provider_refund_id', 'amount', 'requested_at', 'completed_at',
  'dispute_type', 'resolved_at']);
// Palabras que pueden ir pegadas a un paréntesis sin ser una llamada.
const SQL_PAREN_WORDS = new Set(['in', 'as', 'and', 'or', 'on', 'not', 'where', 'select', 'from', 'all']);

/**
 * Deja pasar sólo lecturas hechas con el vocabulario de este módulo: UNA
 * sentencia que empieza por WITH o SELECT, sin comentarios ni comillas raras,
 * cuyas palabras sueltas, llamadas y tipos están en la lista blanca, y cuyos
 * nombres calificados son `public.<tabla conocida>` o `<alias>.<columna conocida>`.
 *
 * Qué garantiza: que no hay escritura posible y que no se nombra ninguna
 * tabla ni columna fuera de las listadas. Qué no: que la sentencia sea
 * exactamente la de `buildLocalSnapshotSql` (con este vocabulario se pueden
 * armar otras lecturas de las mismas columnas).
 */
export function assertReadOnlySql(sql) {
  const source = String(sql ?? '');
  const bare = source.replace(/'(?:[^']|'')*'/g, "''").toLowerCase().trim();
  const refuse = (why) => { throw Error(`READ_ONLY_SQL_REFUSED: ${why}`); };
  if (!/^(with|select)\s/.test(bare)) refuse('la sentencia no empieza por WITH o SELECT');
  if (/;|--|\/\*|"|\$|\\/.test(bare)) refuse('hay separadores, comentarios o comillas que no usa la consulta');
  for (const call of bare.matchAll(/([a-z_][a-z0-9_.]*)\s*\(/g)) {
    if (!SQL_CALLS.has(call[1]) && !SQL_PAREN_WORDS.has(call[1])) refuse(`llamada no permitida: ${call[1]}`);
  }
  // Nombres calificados: exactamente dos partes, y las dos conocidas.
  const qualified = [...bare.matchAll(/(?<![a-z0-9_.])([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)(?![a-z0-9_.])/g)];
  if (qualified.length !== [...bare.matchAll(/\./g)].length) refuse('hay un punto que no es un nombre calificado de dos partes');
  for (const [, qualifier, name] of qualified) {
    if (qualifier === 'public') { if (!SQL_TABLES.has(name)) refuse(`tabla no permitida: ${name}`); }
    else if (!SQL_ALIASES.has(qualifier)) refuse(`calificador no permitido: ${qualifier}`);
    else if (!SQL_COLUMNS.has(name)) refuse(`columna no permitida: ${name}`);
  }
  for (const token of bare.matchAll(/[a-z_][a-z0-9_]*/g)) {
    const before = bare[token.index - 1];
    const after = bare[token.index + token[0].length];
    // `pi.created_at`, `public.orders`: ya validados como nombres calificados.
    if (before === '.' || after === '.') continue;
    const word = token[0];
    if (!SQL_WORDS.has(word) && !SQL_CALLS.has(word) && !SQL_TYPES.has(word) && !SQL_NAMES.has(word)) refuse(`palabra no permitida: ${word}`);
  }
  return source;
}

/** Envuelve al ejecutor inyectado: nada llega a la base sin pasar por la guarda. */
export function readOnlyRunner(runReadOnlySql) {
  if (typeof runReadOnlySql !== 'function') throw Error('READ_ONLY_RUNNER_REQUIRED');
  return async (sql) => runReadOnlySql(assertReadOnlySql(sql));
}

// ── Consulta local ───────────────────────────────────────────────────────────
// Qué se lee y qué NO: estados, importes, fechas e identificadores. Ninguna
// columna de contacto, dirección o nombre, ni los `*_snapshot` del checkout.
const INTENT_JSON = `jsonb_build_object(
      'payment_intent_id', ir.id, 'checkout_session_id', ir.checkout_session_id, 'business_id', ir.business_id,
      'order_id', ir.order_id, 'environment', ir.environment, 'external_reference', ir.external_reference,
      'provider_payment_id', ir.provider_payment_id, 'provider_status', ir.provider_status,
      'provider_status_detail', ir.provider_status_detail, 'internal_status', ir.internal_status,
      'currency', ir.currency, 'expected_amount', ir.expected_amount::text, 'paid_amount', ir.paid_amount::text,
      'refunded_amount', ir.refunded_amount::text, 'approved_at', ir.approved_at, 'provider_event_at', ir.provider_event_at,
      'security_review_reason', ir.security_review_reason, 'created_at', ir.created_at, 'updated_at', ir.updated_at,
      'in_window', ir.in_window, 'session_status', ir.session_status, 'session_total', ir.session_total::text,
      'session_completed_order_id', ir.session_completed_order_id, 'session_expires_at', ir.session_expires_at,
      'approved_provider_payment_ids', (select coalesce(jsonb_agg(distinct pe.provider_event_id), '[]'::jsonb)
         from public.payment_events pe
        where pe.payment_intent_id = ir.id and pe.event_type = 'payment.approved' and pe.provider_event_id is not null),
      'request_order_ids', (select coalesce(jsonb_agg(ro.order_id), '[]'::jsonb)
         from request_orders ro where ro.payment_intent_id = ir.id))`;

/**
 * La lectura local, en UNA sentencia: todas las tablas se ven en la misma foto
 * (un intent y su pedido no pueden salir de dos momentos distintos).
 *
 * Dos modos:
 *   · ventana `[from, to)`: intents creados o tocados en la ventana, más los que
 *     respaldan pedidos de Mercado Pago creados en ella;
 *   · por referencias: intents del negocio con esas referencias externas, de
 *     cualquier fecha (para saber si un pago del proveedor de verdad no existe
 *     localmente o sólo quedó fuera de la ventana).
 */
export function buildLocalSnapshotSql({ businessId, from, to, environment = null, externalReferences = null, maxIntents = DEFAULT_MAX_INTENTS }) {
  const business = assertUuid(businessId, 'business-id');
  const limit = Number(maxIntents);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20000) throw Error('INVALID_MAX_INTENTS');
  if (environment !== null && !ENVIRONMENTS.includes(environment)) throw Error(`INVALID_ENVIRONMENT — sólo ${ENVIRONMENTS.join(' | ')}`);
  const byReference = Array.isArray(externalReferences);
  let params;
  let windowOrders;
  let candidates;
  if (byReference) {
    const references = [...new Set(externalReferences)];
    if (!references.length || references.some((reference) => !INTEGRATION_REFERENCE.test(String(reference)))) throw Error('INVALID_EXTERNAL_REFERENCE');
    params = `select '${business}'::uuid as business_id`;
    windowOrders = 'select o.id from public.orders o join params p on o.business_id = p.business_id where false';
    candidates = `select pi.id, false as in_window
    from public.payment_intents pi
    join params p on pi.business_id = p.business_id
   where pi.external_reference in (${references.map((reference) => `'${reference}'`).join(', ')})`;
  } else {
    const fromIso = assertInstant(from, 'from');
    const toIso = assertInstant(to, 'to');
    if (Date.parse(fromIso) >= Date.parse(toIso)) throw Error('INVALID_WINDOW: --from tiene que ser anterior a --to');
    params = `select '${business}'::uuid as business_id, '${fromIso}'::timestamptz as from_ts, '${toIso}'::timestamptz as to_ts`;
    windowOrders = `select o.id
    from public.orders o
    join params p on o.business_id = p.business_id
   where o.payment_method = 'mercadopago' and o.created_at >= p.from_ts and o.created_at < p.to_ts`;
    candidates = `select pi.id, true as in_window
    from public.payment_intents pi
    join params p on pi.business_id = p.business_id
   where pi.provider = 'mercadopago'${environment ? ` and pi.environment = '${environment}'` : ''}
     and ((pi.created_at >= p.from_ts and pi.created_at < p.to_ts) or (pi.updated_at >= p.from_ts and pi.updated_at < p.to_ts))
  union all
  select pi.id, false as in_window
    from public.payment_intents pi
    join params p on pi.business_id = p.business_id
   where pi.order_id in (select wo.id from window_orders wo)`;
  }
  return `with params as (
  ${params}
),
window_orders as (
  ${windowOrders}
),
candidate_intents as (
  ${candidates}
),
scoped as (
  select c.id, bool_or(c.in_window) as in_window from candidate_intents c group by c.id
),
intent_rows as (
  select pi.id, pi.checkout_session_id, pi.business_id, pi.order_id, pi.environment, pi.external_reference,
         pi.provider_payment_id, pi.provider_status, pi.provider_status_detail, pi.internal_status, pi.currency,
         pi.expected_amount, pi.paid_amount, pi.refunded_amount, pi.approved_at, pi.provider_event_at,
         pi.security_review_reason, pi.created_at, pi.updated_at, s.in_window,
         cs.status as session_status, cs.total as session_total,
         cs.completed_order_id as session_completed_order_id, cs.expires_at as session_expires_at
    from scoped s
    join public.payment_intents pi on pi.id = s.id
    join public.checkout_sessions cs on cs.id = pi.checkout_session_id
   order by pi.created_at desc, pi.id
   limit ${limit}
),
request_orders as (
  select ir.id as payment_intent_id, o.id as order_id
    from intent_rows ir
    join public.orders o on o.business_id = ir.business_id
     and o.client_request_id = 'mp_' || replace(ir.checkout_session_id::text, '-', '')
),
scoped_orders as (
  select wo.id, true as in_window from window_orders wo
  union all
  select ir.order_id as id, false as in_window from intent_rows ir where ir.order_id is not null
  union all
  select ir.session_completed_order_id as id, false as in_window from intent_rows ir where ir.session_completed_order_id is not null
  union all
  select ro.order_id as id, false as in_window from request_orders ro
),
order_ids as (
  select so.id, bool_or(so.in_window) as in_window from scoped_orders so group by so.id
)
select jsonb_build_object(
  'schema', 'taba.payment_reconciliation.local.v1',
  'server_time', clock_timestamp(),
  'business', (select jsonb_build_object('id', b.id, 'slug', b.slug)
     from public.businesses b join params p on b.id = p.business_id),
  'settings', (select jsonb_build_object('environment', ps.environment, 'enabled', ps.enabled, 'collector_id', ps.collector_id)
     from public.business_payment_settings ps join params p on ps.business_id = p.business_id
    where ps.provider = 'mercadopago'),
  'intent_total', (select count(s.id) from scoped s),
  'intents', (select coalesce(jsonb_agg(${INTENT_JSON}), '[]'::jsonb) from intent_rows ir),
  'orders', (select coalesce(jsonb_agg(jsonb_build_object(
      'order_id', o.id, 'business_id', o.business_id, 'public_code', o.public_code, 'status', o.status,
      'payment_method', o.payment_method, 'total', o.total::text, 'origin', o.origin, 'created_at', o.created_at,
      'in_window', oi.in_window)), '[]'::jsonb)
     from order_ids oi join public.orders o on o.id = oi.id),
  'refunds', (select coalesce(jsonb_agg(jsonb_build_object(
      'refund_id', r.id, 'payment_intent_id', r.payment_intent_id, 'provider_refund_id', r.provider_refund_id,
      'amount', r.amount::text, 'status', r.status, 'requested_at', r.requested_at, 'completed_at', r.completed_at)), '[]'::jsonb)
     from public.payment_refunds r where r.payment_intent_id in (select ir.id from intent_rows ir)),
  'disputes', (select coalesce(jsonb_agg(jsonb_build_object(
      'payment_intent_id', d.payment_intent_id, 'dispute_type', d.dispute_type, 'status', d.status,
      'resolved_at', d.resolved_at)), '[]'::jsonb)
     from public.payment_disputes d where d.payment_intent_id in (select ir.id from intent_rows ir))
) as payload`;
}

function payloadOf(result) {
  const rows = Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : null;
  if (!rows || rows.length !== 1) throw Error('LOCAL_SNAPSHOT_SHAPE: se esperaba una única fila');
  let payload = rows[0]?.payload;
  if (typeof payload === 'string') {
    // El mensaje de JSON.parse cita un pedazo del texto: no se propaga.
    try { payload = JSON.parse(payload); } catch { throw Error('LOCAL_SNAPSHOT_SHAPE: el contenido no es JSON'); }
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.intents)) throw Error('LOCAL_SNAPSHOT_SHAPE: falta el contenido');
  return payload;
}

const rowsOf = (value) => (Array.isArray(value) ? value : []);

async function loadSnapshot(runReadOnlySql, query, maxIntents) {
  const run = readOnlyRunner(runReadOnlySql);
  const payload = payloadOf(await run(buildLocalSnapshotSql({ ...query, maxIntents })));
  // Un uuid mal tipeado devolvería «cero pagos, cero hallazgos»: una
  // tranquilidad falsa. Si el negocio no existe en este proyecto, se frena.
  if (!payload.business) throw Error('BUSINESS_NOT_FOUND: ese negocio no existe en el proyecto consultado');
  // La consulta está atada al negocio pedido; si lo que vuelve es de otro, el
  // ejecutor no corrió esta consulta y nada de lo que trae sirve.
  if (String(payload.business.id ?? '').toLowerCase() !== assertUuid(query.businessId, 'business-id')) {
    throw Error('LOCAL_SNAPSHOT_BUSINESS_MISMATCH: la respuesta no es del negocio pedido');
  }
  // Sin un total entero no se puede saber si la lista vino recortada.
  const total = payload.intent_total;
  if (!Number.isInteger(total) || total < 0) throw Error('LOCAL_SNAPSHOT_SHAPE: falta el total de intents');
  if (total > payload.intents.length) {
    throw Error(`LOCAL_WINDOW_TOO_LARGE: ${total} intents superan el tope de ${maxIntents}; acortá la ventana o subí --max-intents`);
  }
  return {
    business_id: String(payload.business.id),
    business_slug: payload.business.slug ?? null,
    server_time: payload.server_time ?? null,
    settings: payload.settings || null,
    intents: rowsOf(payload.intents),
    orders: rowsOf(payload.orders),
    refunds: rowsOf(payload.refunds),
    disputes: rowsOf(payload.disputes),
    looked_up_references: [],
  };
}

/** Filas locales de un negocio y una ventana `[from, to)`. */
export function loadLocalRows(runReadOnlySql, { businessId, from, to, environment = null, maxIntents = DEFAULT_MAX_INTENTS }) {
  return loadSnapshot(runReadOnlySql, { businessId, from, to, environment }, maxIntents);
}

/**
 * Intents del negocio por referencia externa, sin límite de fecha. Las
 * referencias consultadas quedan anotadas: sólo de ésas puede afirmarse después
 * que «no hay intent local».
 */
export async function loadLocalRowsByReference(runReadOnlySql, { businessId, externalReferences, maxIntents = DEFAULT_MAX_INTENTS }) {
  const references = [...new Set(externalReferences || [])].filter((reference) => INTEGRATION_REFERENCE.test(String(reference)));
  if (!references.length) return null;
  const rows = await loadSnapshot(runReadOnlySql, { businessId, externalReferences: references }, maxIntents);
  return { ...rows, looked_up_references: references };
}

/** Une la ventana con lo traído por referencia, sin duplicar filas. */
export function mergeLocalRows(base, extra) {
  if (!extra) return base;
  const union = (left, right, keyOf) => {
    const seen = new Set(left.map(keyOf));
    return [...left, ...right.filter((row) => !seen.has(keyOf(row)))];
  };
  return {
    ...base,
    intents: union(base.intents, extra.intents, (row) => row.payment_intent_id),
    orders: union(base.orders, extra.orders, (row) => row.order_id),
    refunds: union(base.refunds, extra.refunds, (row) => row.refund_id),
    disputes: union(base.disputes, extra.disputes, (row) => `${row.payment_intent_id}:${row.dispute_type}:${row.status}:${row.resolved_at}`),
    looked_up_references: [...new Set([...(base.looked_up_references || []), ...(extra.looked_up_references || [])])],
  };
}

// ── Ejecutor por la Management API: endpoint de SÓLO LECTURA ─────────────────
/**
 * `runReadOnlySql` contra `…/database/query/read-only`, que corre como
 * `supabase_read_only_user`: aunque la guarda fallara, ese rol no puede
 * escribir. El token se recibe ya leído y vive sólo en este cierre.
 */
export function createManagementApiRunner({ projectRef, token, fetchImpl = globalThis.fetch, timeoutMs = 90_000 }) {
  const ref = assertBoundRef(projectRef);
  if (!token) throw Error('SUPABASE_TOKEN_REQUIRED');
  return async function runReadOnlySql(sql) {
    const query = assertReadOnlySql(sql);
    let response;
    try {
      response = await fetchImpl(`https://api.supabase.com/v1/projects/${ref}/database/query/read-only`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw Error(`LOCAL_QUERY_REQUEST_FAILED:${error?.name || 'Error'}:${error?.cause?.code || ''}`);
    }
    // El cuerpo de un error puede repetir el token o un pedazo de la consulta,
    // y el de un 200 que no es JSON, cualquier cosa: sólo sale el código.
    if (!response.ok) throw Error(`LOCAL_QUERY_HTTP_${Number(response.status) || 0}`);
    const body = await response.text();
    if (!body) return [];
    try { return JSON.parse(body); } catch { throw Error('LOCAL_QUERY_RESPONSE_NOT_JSON'); }
  };
}

// ── Proveedor: archivo exportado ─────────────────────────────────────────────
// Lo que puede llevar la consulta declarada de un export sin dejar pagos afuera.
const EXPORT_QUERY_KEYS = new Set(['begin_date', 'end_date', 'range', 'sort', 'criteria', 'limit', 'offset']);

/**
 * Lee un export de pagos de Mercado Pago. Formas aceptadas:
 *
 *   1. la respuesta de `GET /v1/payments/search`:
 *        { "paging": { "total": 2, "limit": 50, "offset": 0 }, "results": [ { …pago… } ] }
 *   2. una lista de esas respuestas (una por página);
 *   3. una lista de pagos sueltos: [ { …pago… }, … ].
 *
 * En 1 y 2 hay que DECLARAR la consulta que se le hizo al proveedor, porque la
 * respuesta de Mercado Pago no la repite:
 *        { "query": { "begin_date": "2026-09-01T00:00:00Z", "end_date": "2026-10-01T00:00:00Z" }, "paging": …, "results": … }
 * La consulta tiene que ser la búsqueda por `date_created` sin más filtros
 * (admite `range`, `sort`, `criteria`, `limit`, `offset`). Cualquier otra clave
 * (`status`, `external_reference`, …) marca el export como filtrado.
 *
 * Sin `query`, o con un export filtrado o una lista suelta (3), el export sirve
 * para comparar los pagos que trae y nada más: no se puede afirmar que falta un
 * pago ni que los que se ven son todos, así que ningún intent queda conciliado.
 * Antes el rango se infería de la primera y la última `date_created`; un export
 * filtrado por estado fabricaba así pagos «faltantes» y conciliaba lo que no vio.
 */
export function providerRowsFromExport(document) {
  const pages = Array.isArray(document) && document.every((entry) => entry && Array.isArray(entry.results))
    && document.length ? document : null;
  const wrapped = pages || (document && !Array.isArray(document) && Array.isArray(document.results) ? [document] : null);
  if (!wrapped && !Array.isArray(document)) throw Error('PROVIDER_EXPORT_SHAPE: se esperaba { results: […] }, una lista de páginas o una lista de pagos');
  const seen = new Set();
  const payments = [];
  for (const payment of wrapped ? wrapped.flatMap((page) => page.results) : document) {
    const id = String(payment?.id ?? '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    payments.push(payment);
  }
  if (!wrapped) return { payments, coverage: { mode: 'export', complete: false, range: null, queriedReferences: [], query_declared: false, filtered: false } };

  const totals = wrapped.map((page) => page.paging?.total).filter((total) => Number.isFinite(total));
  const queries = wrapped.map((page) => page.query).filter((query) => query && typeof query === 'object');
  const filtered = queries.some((query) => Object.keys(query).some((key) => !EXPORT_QUERY_KEYS.has(key))
    || (query.range !== undefined && query.range !== 'date_created'));
  // Completo sólo si el export trae todo lo que el proveedor dijo tener y la
  // consulta no dejó pagos afuera a propósito.
  const complete = totals.length > 0 && payments.length >= Math.max(...totals) && !filtered;
  const declared = queries.find((query) => query.begin_date && query.end_date);
  const range = declared
    ? { from: assertInstant(declared.begin_date, 'query.begin_date'), to: assertInstant(declared.end_date, 'query.end_date'), source: 'declared' }
    : null;
  return { payments, coverage: { mode: 'export', complete, range, queriedReferences: [], query_declared: Boolean(declared), filtered } };
}

/**
 * Une dos respuestas del proveedor (la pasada por rango y una pasada extra por
 * referencias). El rango y la completitud son los de la primera; de la segunda
 * se suman pagos, referencias consultadas y contadores.
 */
export function mergeProviderRows(base, extra) {
  if (!extra) return base;
  const byId = new Map();
  for (const payment of [...(base.payments || []), ...(extra.payments || [])]) {
    const id = String(payment?.id ?? payment?.provider_payment_id ?? '');
    if (id) byId.set(id, payment);
  }
  const left = base.coverage || {};
  const right = extra.coverage || {};
  const counters = {};
  for (const [key, value] of Object.entries(right)) {
    if (typeof value === 'number') counters[key] = (Number(left[key]) || 0) + value;
  }
  return {
    payments: [...byId.values()],
    coverage: { ...left, ...counters, queriedReferences: [...new Set([...(left.queriedReferences || []), ...(right.queriedReferences || [])])] },
  };
}

export function createExportProvider({ filePath, readFile = readFileSync }) {
  if (!filePath) throw Error('PROVIDER_EXPORT_REQUIRED');
  return async function fetchProviderPayments() {
    let document;
    try {
      document = JSON.parse(String(readFile(filePath, 'utf8')).replace(/^\uFEFF/, ''));
    } catch (error) {
      throw Error(`PROVIDER_EXPORT_UNREADABLE: ${error.code || error.name}`);
    }
    return providerRowsFromExport(document);
  };
}

// ── Proveedor: búsqueda de pagos de Mercado Pago (sólo GET) ──────────────────
const MERCADOPAGO_SEARCH = 'https://api.mercadopago.com/v1/payments/search';
const ENV_NAME = /^[A-Z][A-Z0-9_]{2,63}$/;

/** El flag recibe el NOMBRE de una variable, nunca el token. */
export function assertTokenEnvName(name) {
  if (!ENV_NAME.test(String(name || ''))) {
    // No se repite lo recibido: si alguien pegó el token acá, no va al log.
    throw Error('INVALID_TOKEN_ENV_NAME: se espera el NOMBRE de una variable de entorno (MAYUSCULAS_CON_GUIONES_BAJOS), no el token');
  }
  return String(name);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Adaptador de la búsqueda de pagos. Dos pasadas, las dos por GET:
 *   1. rango `date_created` en `[from, to]`, paginado: descubre también los
 *      pagos que la base no conoce (`referencesOnly: true` la saltea);
 *   2. una búsqueda por CADA referencia pedida, la haya traído el rango o no.
 *      Checkout Pro deja pagar varias veces una preferencia: si el rango trae
 *      un pago de la referencia, el otro puede haber quedado del otro lado del
 *      borde de la ventana. Saltear la consulta porque «ya se vio» daba un
 *      doble cobro por conciliado y un reintento rechazado por pago faltante.
 *
 * Una referencia cuenta como consultada sólo si el proveedor dijo cuántos
 * pagos tiene y vinieron todos.
 *
 * El token sale de la variable de entorno nombrada, se lee en cada llamada y
 * no se guarda, no se registra y no viaja en ningún error.
 */
export function createMercadoPagoSearchProvider({
  tokenEnv, env = process.env, fetchImpl = globalThis.fetch, sleep = defaultSleep,
  pageSize = 50, maxPages = 100, maxReferenceLookups = 300, timeoutMs = 20_000,
}) {
  const name = assertTokenEnvName(tokenEnv);

  async function get(query, token) {
    const url = `${MERCADOPAGO_SEARCH}?${new URLSearchParams(query).toString()}`;
    for (let attempt = 1; ; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (attempt >= 3) throw Error(`PROVIDER_REQUEST_FAILED:${error?.name || 'Error'}:${error?.cause?.code || ''}`);
        await sleep(1000 * attempt);
        continue;
      }
      const transient = response.status === 429 || response.status >= 500;
      if (transient && attempt < 3) { await sleep(1000 * attempt); continue; }
      // El cuerpo de un error del proveedor no se copia: puede repetir datos del pedido.
      if (!response.ok) throw Error(`PROVIDER_HTTP_${response.status}`);
      const body = await response.json().catch(() => null);
      if (!body || !Array.isArray(body.results)) throw Error('PROVIDER_RESPONSE_SHAPE');
      return body;
    }
  }

  return async function fetchProviderPayments({ externalReferences = [], from, to, referencesOnly = false }) {
    const token = env[name];
    if (!token) throw Error(`PROVIDER_TOKEN_ENV_EMPTY:${name}`);
    const begin = assertInstant(from, 'from');
    const end = assertInstant(to, 'to');
    const byId = new Map();
    const keep = (payment) => { const id = String(payment?.id ?? ''); if (id) byId.set(id, payment); return id; };
    const stats = { requests: 0, range_pages: 0, reference_lookups: 0, reference_lookups_inconclusive: 0, reference_lookups_skipped: 0 };

    let complete = false;
    if (!referencesOnly) {
      const rangeIds = new Set();
      let offset = 0;
      for (let page = 0; page < maxPages; page += 1) {
        const body = await get({ sort: 'date_created', criteria: 'asc', range: 'date_created', begin_date: begin, end_date: end,
          limit: String(pageSize), offset: String(offset) }, token);
        stats.requests += 1;
        stats.range_pages += 1;
        for (const payment of body.results) { const id = keep(payment); if (id) rangeIds.add(id); }
        const total = body.paging?.total;
        // Completo sólo si se tienen tantos pagos DISTINTOS como el proveedor
        // dijo tener: contar páginas pedidas daba por completo un resultado
        // al que le faltaban filas.
        if (Number.isFinite(total) && rangeIds.size >= total) { complete = true; break; }
        if (!body.results.length) break;
        // El proveedor puede entregar menos filas que las pedidas: se avanza
        // por las recibidas, no por las pedidas.
        offset += body.results.length;
      }
    }

    const pending = [...new Set(externalReferences)].filter((reference) => INTEGRATION_REFERENCE.test(String(reference)));
    const queried = [];
    for (const reference of pending.slice(0, maxReferenceLookups)) {
      const body = await get({ external_reference: reference, sort: 'date_created', criteria: 'desc', limit: String(pageSize) }, token);
      stats.requests += 1;
      stats.reference_lookups += 1;
      // La búsqueda puede devolver parecidos: sólo cuenta la referencia exacta.
      const exact = body.results.filter((payment) => String(payment?.external_reference ?? '') === reference);
      exact.forEach(keep);
      const total = body.paging?.total;
      // Sin un total declarado no se sabe si vinieron todos: no prueba ausencia.
      if (Number.isFinite(total) && total <= body.results.length) queried.push(reference);
      else stats.reference_lookups_inconclusive += 1;
    }
    stats.reference_lookups_skipped = Math.max(0, pending.length - maxReferenceLookups);

    return {
      payments: [...byId.values()],
      coverage: { mode: 'api', complete, range: referencesOnly ? null : { from: begin, to: end, source: 'query' }, queriedReferences: queried, ...stats },
    };
  };
}
