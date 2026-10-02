// Compuertas de release del e-commerce: la evaluación, y nada más que la evaluación.
//
// POR QUÉ ES UN MÓDULO PURO
// -------------------------
// `opening:check` decía TECHNICAL_READY sin mirar paridad de migraciones, Edge
// Functions, certificación de pagos ni hallazgos abiertos (auditoría, CAT-02).
// El veredicto PRODUCTION_READY tiene que salir de UN solo lugar, y ese lugar no
// puede depender de la red: acá entran hechos ya recolectados y sale el
// veredicto. No hay reloj, ni disco, ni fetch. Lo que se prueba con un objeto
// de mentira es exactamente lo que corre contra el entorno real.
//
// LA REGLA QUE NO SE NEGOCIA: FALLA CERRADO
// -----------------------------------------
// Un hecho que no se pudo recolectar NUNCA aprueba. Cada sección de `facts`
// llega como `{ ok: true, ... }` o `{ ok: false, error }`; sin `ok: true` la
// compuerta queda UNKNOWN, y UNKNOWN en una compuerta bloqueante es NOT_READY.
// Lo mismo con un contador que no es un entero (no se asume cero) y con una
// bandera que no es un booleano: `delivery_enabled: null` no es «sin delivery»,
// es no saber. Leer un null como «apagado» convertía compuertas enteras en PASS.
//
// DE DÓNDE Y DE CUÁNDO SON LOS HECHOS
// -----------------------------------
// Unos hechos sin fecha de recolección no son de ningún momento: no se evalúan.
// Y como acá no hay reloj, quien llama dice qué hora es (`context.now`) y de
// dónde salieron (`context.source`): hechos viejos, con fecha futura, o
// guardados cuyas secciones del repo no se releyeron del árbol actual, bloquean
// con `FACTS_PROVENANCE`. Sin `context` la antigüedad queda `NOT_CHECKED` y el
// resultado lo dice; el CLI siempre lo pasa.
//
// Los códigos de salida (`missing`) van en inglés y son estables: los consumen
// máquinas y evidencia.

export const VERDICTS = Object.freeze({ READY: 'PRODUCTION_READY', NOT_READY: 'NOT_READY' });
export const RELEASE_TARGETS = Object.freeze(['staging', 'controlled-production']);

// Las nueve funciones sin las que Mercado Pago no cobra, no concilia o no
// devuelve. Están escritas a mano y no leídas del repo a propósito: si alguien
// borra un directorio, el listado del repo dejaría de pedirla y nadie lo vería.
export const CRITICAL_EDGE_FUNCTIONS = Object.freeze([
  'mercadopago-cancel-payment',
  'mercadopago-checkout-status',
  'mercadopago-connect',
  'mercadopago-create-checkout-session',
  'mercadopago-create-preference',
  'mercadopago-oauth-callback',
  'mercadopago-payment-worker',
  'mercadopago-refund',
  'mercadopago-webhook',
]);

// El catálogo de compuertas. `blocking` vive en el código y no en el JSON de
// documentación: un archivo de datos no puede apagar una compuerta. El test
// compara los dos para que no se separen.
export const GATES = Object.freeze([
  { id: 'CATALOG_APPROVAL', title: 'Catalog approval', blocking: true },
  { id: 'VALID_PRICES', title: 'Valid prices', blocking: true },
  { id: 'SERVICE_HOURS', title: 'Service hours', blocking: true },
  { id: 'DELIVERY_ZONES', title: 'Delivery zones', blocking: true },
  { id: 'FULFILMENT', title: 'Fulfilment mode and address', blocking: true },
  { id: 'TEAM', title: 'Team', blocking: true },
  { id: 'MP_SELLER', title: 'Mercado Pago seller', blocking: true },
  { id: 'PAYMENT_CERTIFICATION', title: 'Payment certification', blocking: true },
  { id: 'MIGRATION_PARITY', title: 'Migration parity', blocking: true },
  { id: 'EDGE_FUNCTIONS', title: 'Edge Functions deployed', blocking: true },
  { id: 'ABUSE_PROTECTION', title: 'Order intake guard', blocking: true },
  { id: 'UNATTENDED_ORDER_POLICY', title: 'Unattended order policy', blocking: false },
  { id: 'NO_OPEN_P0', title: 'No open P0 findings', blocking: true },
  { id: 'NO_OPEN_P1', title: 'No open P1 findings', blocking: true },
  { id: 'CI_GREEN', title: 'CI green on the release commit', blocking: true },
  { id: 'STORE_STATE', title: 'Store state', blocking: false },
].map((gate) => Object.freeze(gate)));

export const FINDING_STATUSES = Object.freeze(['open', 'fixed', 'accepted_risk', 'external_gate']);
export const FINDING_SEVERITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);
export const PAYMENT_METHODS = Object.freeze(['manual', 'mercadopago']);

// La versión del formato de `facts` que esta evaluación sabe leer.
export const FACTS_SCHEMA = 1;
// Las dos entradas que no son compuertas del catálogo pero aparecen en el
// resultado: la procedencia de los hechos (bloquea) y quién los leyó (avisa).
export const PROVENANCE_GATE = 'FACTS_PROVENANCE';
export const OBSERVER_GATE = 'OBSERVER';
export const FACTS_SOURCES = Object.freeze(['live', 'saved']);
// Lo que se lee del destino puede cambiar en cualquier momento (una migración,
// un despliegue): media hora es lo que se le cree a una foto.
export const DEFAULT_MAX_FACTS_AGE_MINUTES = 30;
export const MAX_FACTS_AGE_LIMIT_MINUTES = 1440;
// El rol con el que responde el endpoint de sólo lectura de la Management API
// (el mismo que exige `backend-e2e-certification.mjs`).
export const READ_ONLY_OBSERVER = 'supabase_read_only_user';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?)?$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_LISTED = 40;
// Relojes de dos máquinas no coinciden al segundo: esto no es «del futuro».
const FUTURE_TOLERANCE_MS = 2 * 60_000;
const DAY_MS = 86_400_000;

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
/** Un instante ISO completo, en milisegundos, o null. `Date.parse` no mira el reloj: esto sigue siendo puro. */
const instant = (value) => {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};
/**
 * Una fecha de calendario que existe (AAAA-MM-DD, con o sin hora), en
 * milisegundos, o null. El motor corre el 30 de febrero al 2 de marzo en vez
 * de rechazarlo: por eso la fecha tiene que volver igual a como entró.
 */
const calendarDate = (value) => {
  const raw = text(value);
  if (!ISO_DATE.test(raw)) return null;
  const day = Date.parse(`${raw.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== raw.slice(0, 10)) return null;
  const ms = raw.length === 10 ? day : Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
};
/** Una fecha firmada mañana no es una firma. Sin reloj (`nowMs` null) no se puede saber y no acusa. */
const isFuture = (ms, env) => Number.isFinite(env?.nowMs) && ms > env.nowMs + DAY_MS;
/** La sección sólo cuenta si quien la recolectó dijo, explícitamente, que la tiene. */
const known = (section) => (isObject(section) && section.ok === true ? section : null);
/** Un contador es un entero no negativo o no es nada: jamás se completa con cero. */
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
const reasonOf = (section) => text(section?.error) || 'NOT_COLLECTED';
const capped = (codes) => (codes.length > MAX_LISTED
  ? [...codes.slice(0, MAX_LISTED), `AND_${codes.length - MAX_LISTED}_MORE`]
  : codes);

const pass = (evidence = {}) => ({ status: 'PASS', evidence, missing: [] });
const fail = (missing, evidence = {}) => ({ status: 'FAIL', evidence, missing: capped(missing) });
const unknown = (missing, evidence = {}) => ({ status: 'UNKNOWN', evidence, missing: capped([].concat(missing)) });
const settle = (missing, evidence) => (missing.length ? fail(missing, evidence) : pass(evidence));

/**
 * El mínimo de productos públicos: 1 si nadie pidió otro, y null si lo pedido
 * no es un entero de 1 a 500. Un mínimo ilegible no se reemplaza por 1: pedir
 * 20 y evaluar contra 1 es aprobar un catálogo que no se pidió.
 */
function minProductsOf(facts) {
  const value = facts?.options?.minProducts;
  if (value === undefined || value === null) return 1;
  return Number.isInteger(value) && value >= 1 && value <= 500 ? value : null;
}

/**
 * Las banderas del comercio son booleanas o no son nada. `null`, ausente,
 * 'true' o 1 no se leen como «apagado»: la compuerta queda UNKNOWN.
 */
function flagsUnknown(business, names) {
  const bad = names.filter((name) => typeof business[name] !== 'boolean');
  return bad.length ? unknown(bad.map((name) => `BUSINESS_FACTS_INCOMPLETE:${name}`)) : null;
}

// ── Catálogo ─────────────────────────────────────────────────────────────────

function catalogApproval(facts) {
  const catalog = known(facts.catalog);
  if (!catalog) return unknown(`CATALOG_FACTS_UNAVAILABLE:${reasonOf(facts.catalog)}`);
  const min = minProductsOf(facts);
  if (min === null) return unknown('MIN_PRODUCTS_INVALID');
  const published = count(catalog.public);
  const unverified = count(catalog.available_unverified);
  const withoutIntent = count(catalog.available_without_intent);
  const withoutImage = count(catalog.available_without_approved_image);
  const nonCommercial = count(catalog.available_non_commercial);
  // La política de foto aprobada es de un comercio puntual (el CHECK
  // `cp_published_requires_approved_image`). Si no se sabe si aplica, no se
  // aprueba un catálogo que quizás debía tener fotos.
  const forced = facts.options?.requireImages === true;
  if (typeof catalog.image_policy_applies !== 'boolean' && !forced) {
    return unknown('CATALOG_FACTS_INCOMPLETE:image_policy_applies');
  }
  const imageRequired = forced || catalog.image_policy_applies === true;
  // En el comercio real no se vende catálogo de QA: el origen tiene que ser comercial.
  const commercialOnly = facts.target === 'controlled-production';
  const incomplete = [
    ['public', published], ['available_unverified', unverified], ['available_without_intent', withoutIntent],
    ...(imageRequired ? [['available_without_approved_image', withoutImage]] : []),
    ...(commercialOnly ? [['available_non_commercial', nonCommercial]] : []),
  ].filter(([, value]) => value === null).map(([name]) => `CATALOG_FACTS_INCOMPLETE:${name}`);
  if (incomplete.length) return unknown(incomplete);

  const list = (value) => (Array.isArray(value) ? value : []);
  const evidence = {
    min_products: min, public: published, available: count(catalog.available), total: count(catalog.total),
    available_unverified: unverified, available_without_intent: withoutIntent,
    image_policy_applies: imageRequired, available_without_approved_image: imageRequired ? withoutImage : null,
    commercial_origin_required: commercialOnly, available_non_commercial: nonCommercial,
    // Sólo se nombran los SKU que incumplen una regla que a este comercio le aplica.
    offenders: [...new Set([
      ...list(catalog.approval_offenders),
      ...(imageRequired ? list(catalog.image_offenders) : []),
      ...(commercialOnly ? list(catalog.non_commercial_offenders) : []),
    ])].sort().slice(0, 20),
  };
  const missing = [];
  if (published < min) missing.push(`PUBLIC_PRODUCTS_BELOW_MINIMUM:${published}/${min}`);
  if (unverified > 0) missing.push(`AVAILABLE_UNVERIFIED:${unverified}`);
  if (withoutIntent > 0) missing.push(`AVAILABLE_WITHOUT_MERCHANT_INTENT:${withoutIntent}`);
  if (imageRequired && withoutImage > 0) missing.push(`AVAILABLE_WITHOUT_APPROVED_IMAGE:${withoutImage}`);
  if (commercialOnly && nonCommercial > 0) missing.push(`AVAILABLE_NON_COMMERCIAL_ORIGIN:${nonCommercial}`);
  return settle(missing, evidence);
}

function validPrices(facts) {
  const catalog = known(facts.catalog);
  if (!catalog) return unknown(`CATALOG_FACTS_UNAVAILABLE:${reasonOf(facts.catalog)}`);
  const badPrice = count(catalog.available_bad_price);
  const unconfirmed = count(catalog.available_price_not_confirmed);
  if (badPrice === null) return unknown('CATALOG_FACTS_INCOMPLETE:available_bad_price');
  if (unconfirmed === null) return unknown('CATALOG_FACTS_INCOMPLETE:available_price_not_confirmed');
  const evidence = {
    available: count(catalog.available), available_bad_price: badPrice, available_price_not_confirmed: unconfirmed,
    pending_price_total: count(catalog.pending_price_total),
    offenders: Array.isArray(catalog.price_offenders) ? catalog.price_offenders : [],
  };
  const missing = [];
  if (badPrice > 0) missing.push(`AVAILABLE_WITH_NON_POSITIVE_PRICE:${badPrice}`);
  if (unconfirmed > 0) missing.push(`AVAILABLE_WITH_UNCONFIRMED_PRICE:${unconfirmed}`);
  return settle(missing, evidence);
}

// ── Operación ────────────────────────────────────────────────────────────────

/**
 * Los canales que el comercio tiene encendidos. Sin ninguno, se miran los dos
 * (igual que la base). Quien llama ya comprobó que las dos banderas son booleanas.
 */
function enabledChannels(business) {
  const channels = [];
  if (business.delivery_enabled === true) channels.push('delivery');
  if (business.pickup_enabled === true) channels.push('pickup');
  return channels;
}

function serviceHours(facts) {
  const business = known(facts.business);
  if (!business) return unknown(`BUSINESS_FACTS_UNAVAILABLE:${reasonOf(facts.business)}`);
  // Sin saber qué canales están encendidos no se sabe qué horarios exigir: un
  // `pickup_enabled: null` dejaba de pedir horario de retiro.
  const incompleteFlags = flagsUnknown(business, ['delivery_enabled', 'pickup_enabled', 'hours_enforced']);
  if (incompleteFlags) return incompleteFlags;
  const hours = known(facts.serviceHours);
  if (!hours) return unknown(`SERVICE_HOURS_FACTS_UNAVAILABLE:${reasonOf(facts.serviceHours)}`);
  const enabled = enabledChannels(business);
  const checked = enabled.length ? enabled : ['delivery', 'pickup'];
  const rows = Object.fromEntries(checked.map((channel) => [channel, count(hours[channel])]));
  const incomplete = checked.filter((channel) => rows[channel] === null).map((channel) => `SERVICE_HOURS_FACTS_INCOMPLETE:${channel}`);
  if (incomplete.length) return unknown(incomplete);
  const evidence = {
    hours_enforced: business.hours_enforced === true, operating_timezone: business.operating_timezone ?? null,
    timezone_valid: business.timezone_valid === true, channels: checked, rows,
  };
  const missing = [];
  // CAT-01: con `hours_enforced` apagado `business_is_open` devuelve siempre
  // abierto. Tener filas de horario sin exigirlas es no tener horario.
  if (business.hours_enforced !== true) missing.push('HOURS_NOT_ENFORCED');
  if (!text(business.operating_timezone)) missing.push('TIMEZONE_NOT_SET');
  else if (business.timezone_valid !== true) missing.push('TIMEZONE_INVALID');
  for (const channel of checked) if (rows[channel] === 0) missing.push(`NO_HOURS_FOR_CHANNEL:${channel}`);
  return settle(missing, evidence);
}

function deliveryZones(facts) {
  const business = known(facts.business);
  if (!business) return unknown(`BUSINESS_FACTS_UNAVAILABLE:${reasonOf(facts.business)}`);
  // «Sólo retiro» se afirma con `delivery_enabled: false`, no con que falte el
  // dato: antes un null aprobaba la compuerta sin haber leído una sola zona.
  const incompleteFlags = flagsUnknown(business, ['delivery_enabled', 'pickup_enabled', 'delivery_zone_enforced']);
  if (incompleteFlags) return incompleteFlags;
  if (business.delivery_enabled === false) {
    return pass({
      delivery_enabled: false,
      reason: business.pickup_enabled === true ? 'PICKUP_ONLY: delivery is disabled, zones do not apply'
        : 'NO_DELIVERY: delivery is disabled (see FULFILMENT)',
    });
  }
  const zones = known(facts.deliveryZones);
  if (!zones) return unknown(`DELIVERY_ZONES_FACTS_UNAVAILABLE:${reasonOf(facts.deliveryZones)}`);
  const active = count(zones.active);
  const withoutFee = count(zones.active_without_fee);
  const withoutMinimum = count(zones.active_without_minimum);
  if (active === null || withoutFee === null || withoutMinimum === null) return unknown('DELIVERY_ZONES_FACTS_INCOMPLETE');
  const businessFee = business.delivery_fee ?? null;
  const businessMinimum = business.minimum_delivery_subtotal ?? null;
  const evidence = {
    delivery_enabled: true, delivery_zone_enforced: business.delivery_zone_enforced === true, zones_total: count(zones.total),
    zones_active: active, active_without_fee: withoutFee, active_without_minimum: withoutMinimum,
    business_delivery_fee: businessFee, business_minimum_subtotal: businessMinimum,
  };
  const missing = [];
  // CAT-01: sin exigir zonas, `resolve_delivery_zone` acepta cualquier dirección
  // con el envío plano del comercio.
  if (business.delivery_zone_enforced !== true) missing.push('ZONES_NOT_ENFORCED');
  if (active === 0) missing.push('NO_ACTIVE_ZONE');
  // El envío y el mínimo se deciden por zona o, si la zona no los trae, por el
  // comercio. «Decidido» es que ninguna zona activa quede sin valor efectivo.
  const feeDecided = active > 0 ? withoutFee === 0 : businessFee !== null;
  const minimumDecided = active > 0 ? withoutMinimum === 0 : businessMinimum !== null;
  if (!feeDecided) missing.push('DELIVERY_FEE_NOT_DECIDED');
  if (!minimumDecided) missing.push('DELIVERY_MINIMUM_NOT_DECIDED');
  return settle(missing, evidence);
}

function fulfilment(facts) {
  const business = known(facts.business);
  if (!business) return unknown(`BUSINESS_FACTS_UNAVAILABLE:${reasonOf(facts.business)}`);
  const incompleteFlags = flagsUnknown(business, ['delivery_enabled', 'pickup_enabled', 'address_ok']);
  if (incompleteFlags) return incompleteFlags;
  const evidence = {
    delivery_enabled: business.delivery_enabled === true, pickup_enabled: business.pickup_enabled === true,
    address_set: business.address_ok === true,
  };
  const missing = [];
  if (!evidence.delivery_enabled && !evidence.pickup_enabled) missing.push('NO_FULFILMENT_MODE');
  if (!evidence.address_set) missing.push('BUSINESS_ADDRESS_NOT_SET');
  return settle(missing, evidence);
}

function team(facts) {
  const business = known(facts.business);
  if (!business) return unknown(`BUSINESS_FACTS_UNAVAILABLE:${reasonOf(facts.business)}`);
  // Si hace falta repartidor depende de estas dos banderas: sin ellas no se decide.
  const incompleteFlags = flagsUnknown(business, ['delivery_enabled', 'rider_presence_required']);
  if (incompleteFlags) return incompleteFlags;
  const members = known(facts.team);
  if (!members) return unknown(`TEAM_FACTS_UNAVAILABLE:${reasonOf(facts.team)}`);
  const owners = count(members.owners);
  const admins = count(members.admins);
  const staff = count(members.staff);
  const riders = count(members.riders);
  if ([owners, admins, staff, riders].includes(null)) return unknown('TEAM_FACTS_INCOMPLETE');
  // La preparación de apertura no bloquea por repartidores: desde 20260919120000
  // el comercio puede cerrar su propia entrega con el código del cliente. La
  // base no guarda «entrego yo»; lo más cercano es `rider_presence_required`,
  // que declara que el comercio trabaja con repartidores presentes. Con esa
  // política encendida (o si quien opera lo pide con --require-rider) sin
  // repartidor no hay quien entregue.
  const delivery = business.delivery_enabled === true;
  const riderRequired = delivery && (business.rider_presence_required === true || facts.options?.requireRider === true);
  const evidence = {
    owners, admins, staff, riders, delivery_enabled: delivery, rider_required: riderRequired,
    delivery_model: !delivery ? 'NO_DELIVERY' : riderRequired ? 'RIDERS' : 'SELF_DELIVERY_ALLOWED',
  };
  const missing = [];
  if (owners === 0) missing.push('NO_ACTIVE_OWNER');
  if (admins + staff === 0) missing.push('NO_ACTIVE_STAFF_OR_ADMIN');
  if (riderRequired && riders === 0) missing.push('NO_ACTIVE_RIDER');
  return settle(missing, evidence);
}

// ── Pagos ────────────────────────────────────────────────────────────────────

/** El entorno de Mercado Pago que corresponde a cada destino: plata real sólo en el comercio real. */
export function expectedMercadoPagoEnvironment(target) {
  return target === 'controlled-production' ? 'production' : 'test';
}

function normalizeDecision(raw, env) {
  if (raw === null || raw === undefined) return { present: false, valid: false, methods: [] };
  const methods = Array.isArray(raw?.methods) ? [...new Set(raw.methods.map(text))] : [];
  // La fecha tiene que existir en el calendario y no ser de mañana: «2099-99-99» pasaba una expresión regular.
  const decidedOn = calendarDate(raw?.date);
  const valid = isObject(raw) && methods.length > 0 && methods.every((method) => PAYMENT_METHODS.includes(method))
    && methods.includes('manual') && Boolean(text(raw.decided_by)) && decidedOn !== null && !isFuture(decidedOn, env);
  return { present: true, valid, methods: valid ? methods : [] };
}

/**
 * Qué le falta a la sección de Mercado Pago para poder leerse. `settings` es
 * null (el comercio no tiene ajustes) o un objeto con `enabled` booleano;
 * `connections` es una lista de filas con entorno y estado. Una sección que
 * dice `ok: true` y no trae esto no leyó nada: de ahí no sale «Mercado Pago
 * no está encendido».
 */
function mercadoPagoShapeProblems(mp) {
  const problems = [];
  if (!(mp.settings === null || (isObject(mp.settings) && typeof mp.settings.enabled === 'boolean'))) problems.push('settings');
  const rowsOk = Array.isArray(mp.connections)
    && mp.connections.every((row) => isObject(row) && Boolean(text(row.environment)) && Boolean(text(row.status)));
  if (!rowsOk) problems.push('connections');
  return problems;
}

/**
 * Con qué medios de pago abre el comercio.
 *
 * Sale de dos fuentes y ninguna alcanza sola: lo que la base ya tiene
 * configurado (ajustes encendidos o un vendedor conectado) y el registro de
 * decisión del repo. «Sólo efectivo» no se deduce de que falte un vendedor: eso
 * es exactamente lo que se ve cuando alguien se olvidó de conectarlo.
 *
 *   online       hay que cobrar con Mercado Pago
 *   manual_only  hay un registro explícito y la base no tiene MP encendido
 *   conflict     el registro dice sólo efectivo y la base tiene MP encendido
 *   undecided    ni configuración ni registro
 *   unknown      falta un hecho para saberlo, o llegó con otra forma
 */
export function paymentPlan(facts, env = null) {
  const certification = known(facts?.paymentCertification);
  const section = known(facts?.mercadoPago);
  const malformed = section ? mercadoPagoShapeProblems(section) : [];
  // Una sección mal formada vale lo mismo que una que no se pudo leer.
  const mp = section && malformed.length === 0 ? section : null;
  const decision = certification ? normalizeDecision(certification.opening_decision, env) : null;
  const configured = Boolean(mp) && (mp.settings?.enabled === true || mp.connections.some((row) => row.status === 'connected'));
  const base = {
    decision_present: Boolean(decision?.present), decision_valid: Boolean(decision?.valid),
    configured_on_target: mp ? configured : null, mercadopago_malformed: malformed,
  };

  if (decision?.valid && decision.methods.includes('mercadopago')) return { mode: 'online', methods: ['manual', 'mercadopago'], ...base };
  if (decision?.valid) {
    if (!mp) return { mode: 'unknown', methods: null, ...base };
    if (mp.settings?.enabled === true) return { mode: 'conflict', methods: ['manual', 'mercadopago'], ...base };
    return { mode: 'manual_only', methods: ['manual'], ...base };
  }
  if (!mp) return { mode: 'unknown', methods: null, ...base };
  if (configured) return { mode: 'online', methods: ['manual', 'mercadopago'], ...base };
  if (!certification) return { mode: 'unknown', methods: null, ...base };
  return { mode: 'undecided', methods: ['manual'], ...base };
}

function mercadoPagoSeller(facts, env) {
  const plan = paymentPlan(facts, env);
  const evidence = { payment_mode: plan.mode, decision_present: plan.decision_present, decision_valid: plan.decision_valid };
  const malformed = plan.mercadopago_malformed.map((field) => `MERCADOPAGO_FACTS_MALFORMED:${field}`);
  // Aunque el registro diga que se cobra con Mercado Pago, una sección ilegible
  // no se revisa campo por campo: no se sabe, y se dice.
  if (plan.mode === 'unknown' || malformed.length) {
    const reasons = [
      ...(known(facts.mercadoPago) ? malformed : [`MERCADOPAGO_FACTS_UNAVAILABLE:${reasonOf(facts.mercadoPago)}`]),
      ...(known(facts.paymentCertification) ? [] : [`PAYMENT_DECISION_UNAVAILABLE:${reasonOf(facts.paymentCertification)}`]),
    ];
    return unknown(reasons.length ? reasons : ['PAYMENT_PLAN_UNDETERMINED'], evidence);
  }
  if (plan.mode === 'undecided') {
    return fail([plan.decision_present ? 'PAYMENT_DECISION_INVALID' : 'PAYMENT_DECISION_MISSING'], evidence);
  }
  if (plan.mode === 'conflict') return fail(['MP_ENABLED_BUT_DECISION_IS_MANUAL_ONLY'], evidence);
  if (plan.mode === 'manual_only') {
    return pass({ ...evidence, reason: 'MANUAL_ONLY: explicit decision record, Mercado Pago is not enabled on the target' });
  }

  const mp = known(facts.mercadoPago);
  if (!mp) return unknown(`MERCADOPAGO_FACTS_UNAVAILABLE:${reasonOf(facts.mercadoPago)}`, evidence);
  const expected = expectedMercadoPagoEnvironment(facts.target);
  const settings = isObject(mp.settings) ? mp.settings : null;
  const connections = Array.isArray(mp.connections) ? mp.connections : [];
  const seller = connections.find((row) => row?.environment === expected) || null;
  Object.assign(evidence, {
    expected_environment: expected,
    settings: settings ? {
      enabled: settings.enabled === true, environment: settings.environment ?? null,
      production_review_status: settings.production_review_status ?? null,
    } : null,
    seller: seller ? {
      environment: seller.environment, status: seller.status ?? null, has_credential: seller.has_credential === true,
      matches_settings: seller.matches_settings === true, expires_at: seller.expires_at ?? null,
    } : null,
    other_connections: connections.filter((row) => row !== seller).map((row) => `${row?.environment}:${row?.status}`),
  });
  const missing = [];
  if (!settings) missing.push('PAYMENT_SETTINGS_MISSING');
  else {
    if (settings.enabled !== true) missing.push('PAYMENT_SETTINGS_NOT_ENABLED');
    if (settings.environment !== expected) missing.push(`WRONG_ENVIRONMENT:${settings.environment ?? 'none'}!=${expected}`);
    if (expected === 'production' && settings.production_review_status !== 'approved') {
      missing.push(`PRODUCTION_REVIEW_NOT_APPROVED:${settings.production_review_status ?? 'none'}`);
    }
  }
  if (!seller) missing.push(`SELLER_NOT_CONNECTED:none@${expected}`);
  else {
    if (seller.status !== 'connected') missing.push(`SELLER_NOT_CONNECTED:${seller.status ?? 'unknown'}`);
    if (seller.has_credential !== true) missing.push('SELLER_CREDENTIAL_MISSING');
    // La misma comprobación que `get_store_opening_readiness`: el vendedor
    // conectado tiene que ser el que los ajustes dicen que cobra.
    if (settings && seller.matches_settings !== true) missing.push('SELLER_DOES_NOT_MATCH_SETTINGS');
  }
  return settle(missing, evidence);
}

const MANUAL_CERTIFICATION_ENVIRONMENTS = ['staging', 'controlled-production', 'production'];
const EVIDENCE_PATH = /^(?:artifacts|docs)\/[A-Za-z0-9._\-/]+$/;

/** Por qué una entrada que dice «certificado» no cuenta, o null si cuenta. */
function certificationDefect(entry, label, env) {
  if (!text(entry.evidence)) return `EVIDENCE_NOT_DECLARED:${label}`;
  // La misma regla que aplica el recolector, repetida acá para que unos hechos
  // armados a mano no la salteen: evidencia es algo bajo artifacts/ o docs/.
  if (!EVIDENCE_PATH.test(text(entry.evidence)) || text(entry.evidence).split('/').some((segment) => segment.startsWith('.'))) {
    return `EVIDENCE_PATH_INVALID:${text(entry.evidence).slice(0, 80)}`;
  }
  // Evidencia es una ruta bajo artifacts/ o docs/ que existe y está versionada.
  // «Existe en el disco de quien corrió la herramienta» no es estar en el repo:
  // hay carpetas de artifacts/ ignoradas por git.
  if (entry.evidence_exists !== true) return `EVIDENCE_NOT_IN_REPO:${text(entry.evidence)}`;
  if (entry.evidence_tracked !== true) {
    return `${entry.evidence_tracked === false ? 'EVIDENCE_NOT_TRACKED' : 'EVIDENCE_TRACKING_UNKNOWN'}:${text(entry.evidence)}`;
  }
  const date = calendarDate(entry.date);
  if (date === null) return `CERTIFICATION_DATE_INVALID:${label}`;
  if (isFuture(date, env)) return `CERTIFICATION_DATE_IN_THE_FUTURE:${label}`;
  return null;
}

function certifiedEntry(entries, method, environments, label, env) {
  const claimed = entries.filter((entry) => isObject(entry) && entry.method === method
    && environments.includes(entry.environment) && entry.certified === true);
  if (!claimed.length) return { entry: null, missing: [`NOT_CERTIFIED:${label}`] };
  const usable = claimed.find((entry) => certificationDefect(entry, label, env) === null);
  if (usable) return { entry: usable, missing: [] };
  // Dice «certificado» pero la evidencia no acompaña: no es una certificación.
  return { entry: null, missing: [certificationDefect(claimed[0], label, env)] };
}

function paymentCertification(facts, env) {
  const certification = known(facts.paymentCertification);
  if (!certification) return unknown(`PAYMENT_CERTIFICATION_UNAVAILABLE:${reasonOf(facts.paymentCertification)}`);
  if (!Array.isArray(certification.entries)) return unknown('PAYMENT_CERTIFICATION_MALFORMED');
  const plan = paymentPlan(facts, env);
  const expected = expectedMercadoPagoEnvironment(facts.target);
  const evidence = { payment_mode: plan.mode, methods_to_open: plan.methods, certified: {} };
  const missing = [];
  // Efectivo y «a coordinar» los ofrece la base siempre, sin configuración:
  // el camino manual se abre con cualquier decisión.
  const manual = certifiedEntry(certification.entries, 'manual', MANUAL_CERTIFICATION_ENVIRONMENTS, 'manual', env);
  missing.push(...manual.missing);
  if (manual.entry) evidence.certified.manual = { environment: manual.entry.environment, evidence: manual.entry.evidence, date: manual.entry.date };
  if (plan.methods?.includes('mercadopago')) {
    // Para cobrar en producción no alcanza una certificación de sandbox.
    const environments = expected === 'production' ? ['production'] : ['test', 'production'];
    const online = certifiedEntry(certification.entries, 'mercadopago', environments, `mercadopago:${expected}`, env);
    missing.push(...online.missing);
    if (online.entry) evidence.certified.mercadopago = { environment: online.entry.environment, evidence: online.entry.evidence, date: online.entry.date };
  }
  if (missing.length) return fail(missing, evidence);
  if (plan.mode === 'unknown') return unknown('PAYMENT_METHODS_UNDETERMINED', evidence);
  return pass(evidence);
}

// ── Plataforma ───────────────────────────────────────────────────────────────

function migrationParity(facts) {
  const ledger = known(facts.migrationLedger);
  const repo = known(facts.repoMigrations);
  if (!ledger || !repo) {
    return unknown([
      ...(ledger ? [] : [`LEDGER_UNAVAILABLE:${reasonOf(facts.migrationLedger)}`]),
      ...(repo ? [] : [`REPO_MIGRATIONS_UNAVAILABLE:${reasonOf(facts.repoMigrations)}`]),
    ]);
  }
  if (!Array.isArray(ledger.versions) || !Array.isArray(repo.files)) return unknown('MIGRATION_FACTS_MALFORMED');
  // Un listado vacío del repo contra un ledger vacío daría «iguales». No lo son: es no haber leído nada.
  if (repo.files.length === 0) return unknown('REPO_MIGRATIONS_EMPTY');
  // Una fila sin versión no es una migración. `[{}]` contra `[{}]` daba la misma
  // clave vacía de los dos lados y, con eso, paridad.
  const versioned = (row) => isObject(row) && Boolean(text(row.version));
  const malformedSides = [
    ...(repo.files.every((file) => versioned(file) && Boolean(text(file.name))) ? [] : ['repo']),
    ...(ledger.versions.every(versioned) ? [] : ['ledger']),
  ];
  if (malformedSides.length) return unknown(malformedSides.map((side) => `MIGRATION_FACTS_MALFORMED:${side}`));
  // La lista de .sql que no son migraciones tiene que venir, aunque sea vacía: sin ella no se sabe si hay sueltos.
  if (!Array.isArray(repo.unrecognized)) return unknown('MIGRATION_FACTS_MALFORMED:unrecognized');
  const repoByVersion = new Map(repo.files.map((file) => [text(file?.version), text(file?.name)]));
  const ledgerByVersion = new Map(ledger.versions.map((row) => [text(row?.version), text(row?.name)]));
  const repoOnly = [...repoByVersion.keys()].filter((version) => !ledgerByVersion.has(version)).sort();
  const ledgerOnly = [...ledgerByVersion.keys()].filter((version) => !repoByVersion.has(version)).sort();
  // Misma versión con otro nombre es otra migración bajo el mismo sello. Un
  // nombre vacío en el ledger (aplicada a mano) no se puede comparar y no acusa.
  const renamed = [...repoByVersion.entries()]
    .filter(([version, name]) => ledgerByVersion.get(version) && ledgerByVersion.get(version) !== name)
    .map(([version]) => version).sort();
  const duplicated = repo.files.length - repoByVersion.size;
  const { unrecognized } = repo;
  const evidence = {
    repo: repoByVersion.size, ledger: ledgerByVersion.size,
    repo_head: [...repoByVersion.keys()].sort().at(-1) ?? null, ledger_head: [...ledgerByVersion.keys()].sort().at(-1) ?? null,
    repo_not_in_ledger: repoOnly.length, ledger_not_in_repo: ledgerOnly.length, name_mismatches: renamed.length,
  };
  const missing = [
    ...repoOnly.map((version) => `REPO_NOT_IN_LEDGER:${version}`),
    ...ledgerOnly.map((version) => `LEDGER_NOT_IN_REPO:${version}`),
    ...renamed.map((version) => `NAME_MISMATCH:${version}`),
    ...(duplicated > 0 ? [`REPO_DUPLICATE_VERSIONS:${duplicated}`] : []),
    ...unrecognized.map((name) => `REPO_FILE_NOT_A_MIGRATION:${name}`),
  ];
  return settle(missing, evidence);
}

function edgeFunctions(facts, env) {
  const repo = known(facts.repoFunctions);
  const deployed = known(facts.deployedFunctions);
  if (!repo || !deployed) {
    return unknown([
      ...(repo ? [] : [`REPO_FUNCTIONS_UNAVAILABLE:${reasonOf(facts.repoFunctions)}`]),
      ...(deployed ? [] : [`DEPLOYED_FUNCTIONS_UNAVAILABLE:${reasonOf(facts.deployedFunctions)}`]),
    ]);
  }
  if (!Array.isArray(repo.functions) || !Array.isArray(deployed.functions)) return unknown('EDGE_FUNCTION_FACTS_MALFORMED');
  if (repo.functions.length === 0) return unknown('REPO_FUNCTIONS_EMPTY');
  // Igual que con las migraciones: una fila sin nombre no se compara con nada.
  const named = (fn) => isObject(fn) && Boolean(text(fn.slug));
  const malformedSides = [
    ...(repo.functions.every(named) ? [] : ['repo']),
    ...(deployed.functions.every(named) ? [] : ['deployed']),
  ];
  if (malformedSides.length) return unknown(malformedSides.map((side) => `EDGE_FUNCTION_FACTS_MALFORMED:${side}`));
  const live = new Map(deployed.functions.map((fn) => [text(fn?.slug), fn]));
  const declared = new Map(repo.functions.map((fn) => [text(fn?.slug), fn]));
  const missing = [];
  for (const [slug, fn] of [...declared.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const target = live.get(slug);
    if (!target) { missing.push(`NOT_DEPLOYED:${slug}`); continue; }
    if (target.status !== 'ACTIVE') missing.push(`NOT_ACTIVE:${slug}:${target.status ?? 'unknown'}`);
    // `verify_jwt` distinto al del repo es un 401 en el preflight del
    // storefront o, peor, un webhook que exige un JWT que el proveedor no manda.
    if (typeof fn.verify_jwt !== 'boolean' || target.verify_jwt !== fn.verify_jwt) {
      // Si config.toml no declara la función, lo esperado es el default de la
      // plataforma y lo que hay que corregir es el archivo: se dice con otro código.
      missing.push(fn.declared_in_config === false
        ? `VERIFY_JWT_NOT_DECLARED_IN_CONFIG:${slug}:platform_default=${fn.verify_jwt}:actual=${target.verify_jwt}`
        : `VERIFY_JWT_MISMATCH:${slug}:expected=${fn.verify_jwt}:actual=${target.verify_jwt}`);
    }
  }
  // El conjunto crítico se exige salvo que haya un registro explícito de
  // apertura sólo con pago manual. Sin saber el plan, se exige.
  const plan = paymentPlan(facts, env);
  const criticalRequired = plan.mode !== 'manual_only';
  if (criticalRequired) {
    for (const slug of CRITICAL_EDGE_FUNCTIONS) {
      if (!declared.has(slug)) missing.push(`CRITICAL_NOT_IN_REPO:${slug}`);
      else if (!live.has(slug) && !missing.includes(`NOT_DEPLOYED:${slug}`)) missing.push(`NOT_DEPLOYED:${slug}`);
    }
  }
  const unexpected = [...live.keys()].filter((slug) => !declared.has(slug)).sort();
  const evidence = {
    repo: declared.size, deployed: live.size, critical_required: criticalRequired, critical: CRITICAL_EDGE_FUNCTIONS.length,
    unexpected_on_target: unexpected, strict_reference: null,
  };

  // Modo estricto: el bundle desplegado tiene que ser, byte a byte, el del entorno de referencia.
  let strictUnknown = null;
  if (facts.options?.functionsReference) {
    const reference = known(facts.referenceFunctions);
    evidence.strict_reference = facts.options.functionsReference;
    if (!reference || !Array.isArray(reference.functions)) strictUnknown = `REFERENCE_UNAVAILABLE:${reasonOf(facts.referenceFunctions)}`;
    else {
      const referenceBySlug = new Map(reference.functions.map((fn) => [text(fn?.slug), fn]));
      for (const slug of [...declared.keys()].sort()) {
        const a = live.get(slug)?.bundle_sha256;
        const b = referenceBySlug.get(slug)?.bundle_sha256;
        if (!live.has(slug)) continue;
        if (!text(a) || !text(b)) missing.push(`BUNDLE_HASH_UNAVAILABLE:${slug}`);
        else if (a !== b) missing.push(`BUNDLE_MISMATCH:${slug}`);
      }
    }
  }
  if (missing.length) return fail(missing, evidence);
  if (strictUnknown) return unknown(strictUnknown, evidence);
  return pass(evidence);
}

function abuseProtection(facts) {
  const business = known(facts.business);
  const abuse = known(facts.abuse);
  if (!business || !abuse) {
    return unknown([
      ...(business ? [] : [`BUSINESS_FACTS_UNAVAILABLE:${reasonOf(facts.business)}`]),
      ...(abuse ? [] : [`ABUSE_FACTS_UNAVAILABLE:${reasonOf(facts.abuse)}`]),
    ]);
  }
  if (typeof abuse.guard_function_exists !== 'boolean') return unknown('ABUSE_FACTS_INCOMPLETE:guard_function_exists');
  const doors = isObject(abuse.guard_doors) ? abuse.guard_doors : {};
  const mode = business.order_intake_guard_mode ?? null;
  const evidence = { guard_function_exists: abuse.guard_function_exists, guard_doors: doors, order_intake_guard_mode: mode };
  const missing = [];
  // Que la función no exista es un hecho conocido (la migración no está): FAIL, no UNKNOWN.
  if (!abuse.guard_function_exists) missing.push('GUARD_FUNCTION_MISSING');
  else {
    // Desplegado pero sin que las puertas lo llamen no protege nada.
    for (const door of ['create_order_with_items', 'create_checkout_session']) {
      if (doors[door] !== true) missing.push(`GUARD_NOT_WIRED:${door}`);
    }
  }
  if (mode !== 'enforce') missing.push(`GUARD_MODE:${mode ?? 'absent'}`);
  return settle(missing, evidence);
}

function unattendedOrderPolicy(facts) {
  const business = known(facts.business);
  if (!business) return unknown(`BUSINESS_FACTS_UNAVAILABLE:${reasonOf(facts.business)}`);
  const minutes = business.abandoned_order_minutes ?? null;
  const evidence = { abandoned_order_minutes: minutes };
  return minutes === null ? fail(['ABANDONED_ORDER_MINUTES_NOT_DECIDED'], evidence) : pass(evidence);
}

// ── Hallazgos de auditoría ───────────────────────────────────────────────────

/**
 * Por qué un hallazgo sigue bloqueando, o null si no bloquea.
 *
 * `fixed` sin referencia, `accepted_risk` sin nota y `external_gate` sin nota no
 * son estados: son una palabra escrita en un JSON. Si `external_gate` no pidiera
 * justificación sería la forma más barata de destrabar la compuerta: cambiar
 * una palabra. Un estado desconocido tampoco cierra nada.
 */
export function findingBlocker(finding) {
  const id = text(finding?.id) || 'UNIDENTIFIED';
  const status = text(finding?.status);
  if (!FINDING_STATUSES.includes(status)) return `INVALID_STATUS:${id}:${status || 'none'}`;
  if (status === 'open') return `OPEN:${id}`;
  if (status === 'accepted_risk' && !text(finding.notes)) return `ACCEPTED_RISK_WITHOUT_NOTES:${id}`;
  if (status === 'external_gate' && !text(finding.notes)) return `EXTERNAL_GATE_WITHOUT_NOTES:${id}`;
  if (status === 'fixed' && !text(finding.fixed_by)) return `FIXED_WITHOUT_REFERENCE:${id}`;
  return null;
}

function openFindings(facts, severity) {
  const register = known(facts.findingsRegister);
  if (!register) return unknown(`FINDINGS_REGISTER_UNAVAILABLE:${reasonOf(facts.findingsRegister)}`);
  if (!Array.isArray(register.findings)) return unknown('FINDINGS_REGISTER_MALFORMED');
  // Un registro sin hallazgos no es «cero hallazgos»: es un archivo vaciado.
  if (register.findings.length === 0) return unknown('FINDINGS_REGISTER_EMPTY');
  const scoped = register.findings.filter((finding) => finding?.severity === severity);
  // Una severidad que no se entiende se trata como la peor.
  const unreadable = severity === 'P0'
    ? register.findings.filter((finding) => !FINDING_SEVERITIES.includes(finding?.severity))
    : [];
  const missing = [
    ...unreadable.map((finding) => `INVALID_SEVERITY:${text(finding?.id) || 'UNIDENTIFIED'}`),
    ...scoped.map(findingBlocker).filter(Boolean),
  ];
  const byStatus = (status) => scoped.filter((finding) => finding.status === status).length;
  const evidence = {
    severity, total: scoped.length, open: byStatus('open'), fixed: byStatus('fixed'),
    accepted_risk: byStatus('accepted_risk'), external_gate: byStatus('external_gate'),
  };
  return settle(missing, evidence);
}

function ciGreen(facts) {
  const ci = isObject(facts.ci) ? facts.ci : null;
  const conclusion = text(ci?.conclusion);
  const commit = text(ci?.commit).toLowerCase();
  const repo = known(facts.repo);
  const head = text(repo?.head).toLowerCase();
  const uncommitted = Array.isArray(repo?.uncommitted_release_inputs) ? repo.uncommitted_release_inputs : null;
  const evidence = {
    conclusion: conclusion || null, commit: commit || null, repo_head: head || null,
    uncommitted_release_inputs: uncommitted ? uncommitted.slice(0, 20) : null,
  };
  const failed = [];
  const undetermined = [];
  if (!conclusion) undetermined.push('CI_CONCLUSION_NOT_SUPPLIED');
  else if (conclusion !== 'success') failed.push(`CI_CONCLUSION:${conclusion}`);
  // Un «success» sin decir de qué commit no dice nada del que se va a publicar.
  else if (!commit) undetermined.push('CI_COMMIT_NOT_SUPPLIED');
  else if (!head) undetermined.push('REPO_HEAD_UNKNOWN');
  else if (commit.length < 7 || !head.startsWith(commit)) failed.push(`CI_COMMIT_MISMATCH:${commit.slice(0, 12)}!=${head.slice(0, 12)}`);
  // El CI corrió sobre el commit; el registro de hallazgos, la certificación,
  // las migraciones y la configuración se leen del árbol de trabajo. Si esos
  // archivos tienen cambios sin commitear, lo evaluado no es lo que el CI probó:
  // editar el registro a mano y no commitearlo no puede dar verde.
  if (repo) {
    if (!uncommitted) undetermined.push('REPO_DIRTY_STATE_UNKNOWN');
    else if (uncommitted.length) failed.push(`RELEASE_INPUTS_NOT_COMMITTED:${uncommitted.length}`);
  }
  if (failed.length) return fail([...failed, ...undetermined], evidence);
  if (undetermined.length) return unknown(undetermined, evidence);
  return pass(evidence);
}

function storeState(facts) {
  const business = known(facts.business);
  if (!business) return unknown(`BUSINESS_FACTS_UNAVAILABLE:${reasonOf(facts.business)}`);
  const readiness = known(facts.readiness);
  const evidence = {
    slug: business.slug ?? null, status: business.status ?? null, is_active: business.is_active === true,
    ordering_enabled: business.ordering_enabled === true, ordering_verified: business.ordering_verified === true,
    qa_fixture: business.qa_fixture === true,
    opening_readiness: readiness
      ? { can_open: readiness.can_open === true, pending: Array.isArray(readiness.pending) ? readiness.pending : [] }
      : `NOT_AVAILABLE:${reasonOf(facts.readiness)}`,
  };
  // Esta compuerta no bloquea: cerrada, pausada o sin verificar son estados
  // válidos antes de abrir. Pero dos cosas no pueden pasar sin que alguien las
  // vea, y salen como aviso: un comercio dado de baja, y un comercio de QA
  // evaluado como si fuera el real.
  const missing = [];
  if (business.is_active !== true) missing.push('BUSINESS_NOT_ACTIVE');
  if (facts.target === 'controlled-production' && business.qa_fixture !== false) missing.push('QA_FIXTURE_ON_CONTROLLED_PRODUCTION');
  return settle(missing, evidence);
}

const EVALUATORS = Object.freeze({
  CATALOG_APPROVAL: catalogApproval,
  VALID_PRICES: validPrices,
  SERVICE_HOURS: serviceHours,
  DELIVERY_ZONES: deliveryZones,
  FULFILMENT: fulfilment,
  TEAM: team,
  MP_SELLER: mercadoPagoSeller,
  PAYMENT_CERTIFICATION: paymentCertification,
  MIGRATION_PARITY: migrationParity,
  EDGE_FUNCTIONS: edgeFunctions,
  ABUSE_PROTECTION: abuseProtection,
  UNATTENDED_ORDER_POLICY: unattendedOrderPolicy,
  NO_OPEN_P0: (facts) => openFindings(facts, 'P0'),
  NO_OPEN_P1: (facts) => openFindings(facts, 'P1'),
  CI_GREEN: ciGreen,
  STORE_STATE: storeState,
});

/** Lo que frena el lanzamiento al público y no depende de este equipo: se informa aparte. */
function publicLaunchBlockers(facts) {
  const register = known(facts.findingsRegister);
  if (!register || !Array.isArray(register.findings)) return [];
  return register.findings
    .filter((finding) => finding?.status === 'external_gate')
    .map((finding) => ({
      id: text(finding.id), severity: finding.severity ?? null, title: text(finding.title), notes: text(finding.notes),
    }))
    .sort((a, b) => String(a.severity).localeCompare(String(b.severity)) || a.id.localeCompare(b.id));
}

/**
 * Qué le falta a `facts` para decir de dónde y de cuándo es. Sin destino no es
 * de ningún lado; sin fecha de recolección no es de ningún momento; con otro
 * `schema` no se sabe leer.
 */
function identityProblems(input) {
  if (!isObject(input)) return ['facts'];
  return [
    ...(RELEASE_TARGETS.includes(input.target) ? [] : ['target']),
    ...(UUID.test(text(input.businessId)) ? [] : ['businessId']),
    ...(instant(input.collectedAt) === null ? ['collectedAt'] : []),
    ...(input.schema === FACTS_SCHEMA ? [] : ['schema']),
    ...(optionsReadable(input.options) ? [] : ['options']),
  ];
}

/**
 * Las opciones son lo que pidió quien opera (exigir repartidor, exigir fotos,
 * comparar bundles). Pueden faltar —valen los valores por defecto—, pero si
 * están tienen que leerse: un `requireRider: 'true'` no se toma como «no pedido».
 * El mínimo de productos se revisa en su compuerta (`MIN_PRODUCTS_INVALID`).
 */
function optionsReadable(options) {
  if (options === undefined) return true;
  if (!isObject(options)) return false;
  const optionalFlag = (value) => value === undefined || typeof value === 'boolean';
  const reference = options.functionsReference;
  return optionalFlag(options.requireRider) && optionalFlag(options.requireImages)
    && (reference === undefined || reference === null || RELEASE_TARGETS.includes(reference));
}

/**
 * La procedencia de los hechos: de dónde salieron, qué antigüedad tienen y si
 * eso alcanza. Devuelve el bloque que va al resultado, el bloqueo (o null) y la
 * hora de la evaluación en milisegundos (null si nadie la dijo).
 */
function provenanceOf(facts, unidentified, context) {
  const collectedMs = unidentified.length ? null : instant(facts.collectedAt);
  const provenance = {
    source: 'unspecified', facts_file: null, collected_at: collectedMs === null ? null : facts.collectedAt, evaluated_at: null,
    age_minutes: null, max_age_minutes: null, freshness: 'NOT_CHECKED', repo_sections: null, repo_head_at_snapshot: null,
  };
  if (context === undefined) return { provenance, blocker: null, nowMs: null };

  const block = (status, missing) => ({ gate: PROVENANCE_GATE, status, missing });
  const max = isObject(context) ? context.maxFactsAgeMinutes ?? DEFAULT_MAX_FACTS_AGE_MINUTES : null;
  const invalid = !isObject(context) ? ['context'] : [
    ...(FACTS_SOURCES.includes(context.source) ? [] : ['source']),
    ...(instant(context.now) === null ? ['now'] : []),
    ...(Number.isInteger(max) && max >= 1 && max <= MAX_FACTS_AGE_LIMIT_MINUTES ? [] : ['maxFactsAgeMinutes']),
  ];
  if (invalid.length) {
    provenance.freshness = 'UNKNOWN';
    return { provenance, blocker: block('UNKNOWN', invalid.map((field) => `EVALUATION_CONTEXT_INVALID:${field}`)), nowMs: null };
  }

  const nowMs = instant(context.now);
  const saved = context.source === 'saved';
  const reread = context.repoSections === 'reread';
  Object.assign(provenance, {
    source: context.source,
    // Sólo el nombre del archivo: una ruta de disco no va a un reporte que se commitea.
    facts_file: text(context.factsFile).split(/[\\/]/).pop() || null,
    evaluated_at: context.now,
    max_age_minutes: max,
    repo_sections: !saved ? 'READ_WITH_THE_FACTS' : reread ? 'REREAD_FROM_CURRENT_TREE' : 'FROM_SNAPSHOT',
    repo_head_at_snapshot: text(context.snapshotRepoHead).toLowerCase() || null,
  });
  if (collectedMs === null) {
    provenance.freshness = 'UNKNOWN';
    return { provenance, blocker: block('UNKNOWN', [`FACTS_NOT_IDENTIFIED:${unidentified.join(',')}`]), nowMs };
  }
  const ageMs = nowMs - collectedMs;
  const missing = [];
  if (ageMs < -FUTURE_TOLERANCE_MS) {
    provenance.freshness = 'FUTURE';
    missing.push(`FACTS_FROM_THE_FUTURE:collected=${facts.collectedAt}`);
  } else if (ageMs > max * 60_000) {
    provenance.freshness = 'STALE';
    missing.push(`FACTS_STALE:age_minutes=${Math.floor(ageMs / 60_000)}:max=${max}`);
  } else {
    provenance.freshness = 'FRESH';
  }
  provenance.age_minutes = provenance.freshness === 'FUTURE' ? Math.ceil(ageMs / 60_000) : Math.max(0, Math.floor(ageMs / 60_000));
  // Lo del repo (hallazgos, certificación, migraciones, funciones, commit) no se
  // toma de una foto: un P1 reabierto o una migración agregada después no se verían.
  if (saved && !reread) missing.push('SAVED_REPO_SECTIONS_NOT_REREAD');
  return { provenance, blocker: missing.length ? block('FAIL', missing) : null, nowMs };
}

/**
 * Quién leyó el destino. No es una compuerta de preparación (dice cómo se
 * leyeron los hechos, no cómo está el comercio): se informa como aviso.
 */
function observerWarning(facts) {
  const observer = known(facts.observer);
  if (!observer) return { gate: OBSERVER_GATE, status: 'UNKNOWN', missing: [`OBSERVER_UNAVAILABLE:${reasonOf(facts.observer)}`] };
  const user = text(observer.current_user) || 'unknown';
  const readOnly = text(observer.transaction_read_only) || 'unknown';
  if (user === READ_ONLY_OBSERVER && readOnly === 'on') return null;
  return { gate: OBSERVER_GATE, status: 'FAIL', missing: [`OBSERVER_NOT_READ_ONLY:${user}:transaction_read_only=${readOnly}`] };
}

/**
 * (facts, context?) → { verdict, gates, blockers, warnings, publicLaunchBlockers, provenance, summary }.
 *
 * `context` = { source: 'live' | 'saved', now: <instante ISO>, maxFactsAgeMinutes?,
 * repoSections?: 'reread', factsFile?, snapshotRepoHead? }. Con `context` se
 * exige que los hechos sean recientes y, si son guardados, que lo del repo se
 * haya releído; sin `context` eso queda `NOT_CHECKED` en `provenance`.
 *
 * Los hechos tienen que decir de qué entorno, de qué comercio y de cuándo son.
 * Si no, no son de ningún lado: todo queda UNKNOWN.
 */
export function evaluate(input, context = undefined) {
  const unidentified = identityProblems(input);
  const identified = unidentified.length === 0;
  let facts = identified ? input : {};
  // Los hechos del comercio tienen que ser del comercio que dicen evaluar.
  const business = known(facts.business);
  if (business && text(business.id).toLowerCase() !== facts.businessId.toLowerCase()) {
    facts = { ...facts, business: { ok: false, error: 'BUSINESS_ID_MISMATCH' } };
  }
  const { provenance, blocker: provenanceBlocker, nowMs } = provenanceOf(facts, unidentified, context);
  const env = { nowMs };
  const gates = GATES.map((definition) => {
    let outcome;
    try {
      outcome = identified ? EVALUATORS[definition.id](facts, env) : unknown(`FACTS_NOT_IDENTIFIED:${unidentified.join(',')}`);
    } catch (error) {
      // Un hecho con forma inesperada no puede tumbar la evaluación ni aprobarla.
      outcome = unknown(`EVALUATION_ERROR:${text(error?.message).slice(0, 120) || 'unexpected'}`);
    }
    return { id: definition.id, title: definition.title, blocking: definition.blocking, ...outcome };
  });
  const notPassing = gates.filter((gate) => gate.status !== 'PASS');
  const brief = (gate) => ({ gate: gate.id, status: gate.status, missing: gate.missing });
  const blockers = [...(provenanceBlocker ? [provenanceBlocker] : []), ...notPassing.filter((gate) => gate.blocking).map(brief)];
  const observer = identified ? observerWarning(facts) : null;
  const warnings = [...notPassing.filter((gate) => !gate.blocking).map(brief), ...(observer ? [observer] : [])];
  const tally = (status) => gates.filter((gate) => gate.status === status).length;
  const launch = publicLaunchBlockers(facts);
  const verdict = identified && blockers.length === 0 ? VERDICTS.READY : VERDICTS.NOT_READY;
  return {
    verdict,
    target: identified ? facts.target : null,
    businessId: identified ? facts.businessId : null,
    collectedAt: identified ? facts.collectedAt : null,
    provenance,
    gates,
    blockers,
    warnings,
    publicLaunchBlockers: launch,
    summary: {
      gates: gates.length, pass: tally('PASS'), fail: tally('FAIL'), unknown: tally('UNKNOWN'),
      blocking_not_passing: blockers.length, public_launch_ready: verdict === VERDICTS.READY && launch.length === 0,
    },
  };
}
