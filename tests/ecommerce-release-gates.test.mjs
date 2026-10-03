// Compuertas de release del e-commerce (scripts/release). Sin red y sin base:
// la evaluación es pura y la recolección recibe su entrada/salida inyectada.
// `live-io.mjs` —lo único que toca la red y una credencial— NO se importa acá:
// se lee como texto y se comprueba que no sepa escribir.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CRITICAL_EDGE_FUNCTIONS, DEFAULT_MAX_FACTS_AGE_MINUTES, FACTS_SCHEMA, FINDING_STATUSES, GATES, MONEY_MOVEMENT, OBSERVER_GATE,
  PROVENANCE_GATE, READ_ONLY_OBSERVER, RELEASE_TARGETS, VERDICTS, evaluate, expectedMercadoPagoEnvironment, findingBlocker,
  moneyMovementPossible, paymentPlan, realMoneyPlatform,
  LEGACY_SMOKE_CONFIRMATION as EVALUATED_LEGACY_SMOKE, REAL_MONEY_SWITCH as EVALUATED_REAL_MONEY_SWITCH,
} from '../scripts/release/gates/evaluate.mjs';
import {
  FINDINGS_REGISTER_PATH, LEGACY_SMOKE_CONFIRMATION, PAYMENT_CERTIFICATION_PATH, REAL_MONEY_SWITCH, REAL_MONEY_SWITCH_OPEN_VALUE,
  RELEASE_INPUT_PATHS, SQL, assertSelectOnly, classifyRealMoneySecrets, collect, collectRepoFacts, functionSourceFiles,
  isEvidencePath, isRepoRelativePath, parseFunctionsVerifyJwt, parseRepoMigrations, relativeImports,
} from '../scripts/release/gates/collect.mjs';
import {
  EXIT, UsageError, createRepoIo, exitCodeFor, loadSavedFacts, parseArgs, renderMarkdown, renderTable, run,
} from '../scripts/release/ecommerce-release-gates.mjs';
import { scanText } from '../scripts/scan-secrets.mjs';
import { findPersonalLocalPaths } from '../scripts/check-release-hygiene.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const TOOL_FILES = [
  'scripts/release/ecommerce-release-gates.mjs',
  'scripts/release/gates/evaluate.mjs',
  'scripts/release/gates/collect.mjs',
  'scripts/release/gates/live-io.mjs',
  'docs/ecommerce-hardening/release-gates.json',
  'docs/ecommerce-hardening/findings-register.json',
  'docs/ecommerce-hardening/payment-certification.json',
  'tests/ecommerce-release-gates.test.mjs',
];
/** El código sin sus comentarios de línea: lo que se escanea es lo que corre. */
const codeOf = (relativePath) => read(relativePath).split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');

const BUSINESS = 'e7850ad2-a447-402c-8375-3fd74e9466ba';
const HEAD = createHash('sha1').update('release-gates-fixture').digest('hex');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// Las trece funciones del repo con el verify_jwt que declara supabase/config.toml.
const FUNCTIONS = [
  ['catalog-image-manager', true], ['fiscal-artifact-access', true], ['mercadopago-cancel-payment', true],
  ['mercadopago-checkout-status', false], ['mercadopago-connect', false], ['mercadopago-create-checkout-session', false],
  ['mercadopago-create-preference', false], ['mercadopago-oauth-callback', false], ['mercadopago-payment-worker', false],
  ['mercadopago-refund', true], ['mercadopago-webhook', false], ['print-agent-gateway', false], ['team-invitation', false],
];
// El código de cada función se commiteó antes de su despliegue.
const SOURCE_COMMITTED_AT = '2026-09-25T12:00:00.000Z';
const DEPLOYED_AT = Date.parse('2026-09-28T12:00:00.000Z');
const MIGRATIONS = [
  { version: '20260531030000', name: 'la_taba_phase1_orders' },
  { version: '20261001010000', name: 'delivery_location_guard_runs_as_owner' },
  { version: '20261001180000', name: 'order_intake_guard' },
];

/** Los estados de los secretos del dinero real (nunca huellas) de un proyecto productivo abierto. */
function productionRealMoney(overrides = {}) {
  return {
    MERCADOPAGO_ENVIRONMENT: 'PRODUCTION', MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'APPROVED',
    MERCADOPAGO_REAL_MONEY_ENABLED: 'ENABLED', MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION: 'ABSENT', ...overrides,
  };
}

/** Staging: Mercado Pago en test, sin revisión productiva ni interruptor, y ningún comercio que cobre en producción. */
function stagingRealMoney(facts) {
  facts.realMoneySecrets = { ok: true, states: productionRealMoney({
    MERCADOPAGO_ENVIRONMENT: 'TEST', MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'ABSENT', MERCADOPAGO_REAL_MONEY_ENABLED: 'ABSENT',
  }) };
  facts.realMoneyBusinesses = { ok: true, settings_enabled_production: 0, chargeable_production: 0, connected_production_sellers: 0 };
}

/** Un comercio listo para producción: delivery y retiro, Mercado Pago en producción, todo certificado. */
function readyFacts() {
  return {
    schema: 1,
    collectedAt: '2026-10-01T12:00:00.000Z',
    target: 'controlled-production',
    businessId: BUSINESS,
    options: { minProducts: 1, requireRider: false, requireImages: false, functionsReference: null },
    observer: { ok: true, current_user: 'supabase_read_only_user', transaction_read_only: 'on' },
    business: {
      ok: true, id: BUSINESS, slug: 'la-taba-cp', status: 'closed', is_active: true, qa_fixture: false,
      ordering_enabled: true, ordering_verified: true, currency_code: 'ARS', delivery_enabled: true, pickup_enabled: true,
      delivery_fee: 1500, minimum_delivery_subtotal: 0, hours_enforced: true, delivery_zone_enforced: true,
      operating_timezone: 'America/Argentina/Buenos_Aires', timezone_valid: true, address_ok: true,
      rider_presence_required: false, abandoned_order_minutes: 60, order_intake_guard_mode: 'enforce',
    },
    serviceHours: { ok: true, delivery: 7, pickup: 7, alcohol: 0 },
    deliveryZones: { ok: true, total: 3, active: 2, active_without_fee: 0, active_without_minimum: 0 },
    catalog: {
      ok: true, total: 46, available: 12, public: 12, available_unverified: 0, available_without_intent: 0,
      available_inactive: 0, available_without_stock: 0, available_bad_price: 0, available_price_not_confirmed: 0,
      available_non_commercial: 0, available_without_approved_image: 0, pending_price_total: 4, image_policy_applies: true,
      approval_offenders: [], image_offenders: [], non_commercial_offenders: [], price_offenders: [],
    },
    team: { ok: true, owners: 1, admins: 0, staff: 2, riders: 1 },
    mercadoPago: {
      ok: true,
      settings: { enabled: true, environment: 'production', checkout_mode: 'checkout_pro', currency: 'ARS', reserve_stock: true, production_review_status: 'approved' },
      connections: [{ environment: 'production', status: 'connected', has_credential: true, expires_at: '2027-01-01T00:00:00Z', matches_settings: true }],
    },
    migrationLedger: { ok: true, versions: MIGRATIONS.map((row) => ({ ...row })) },
    repoMigrations: { ok: true, files: MIGRATIONS.map((row) => ({ ...row })), unrecognized: [] },
    repoFunctions: {
      ok: true,
      functions: FUNCTIONS.map(([slug, verifyJwt]) => ({ slug, verify_jwt: verifyJwt, declared_in_config: true,
        source_committed_at: SOURCE_COMMITTED_AT, source_files: 2 })),
    },
    deployedFunctions: {
      ok: true,
      functions: FUNCTIONS.map(([slug, verifyJwt]) => ({ slug, status: 'ACTIVE', verify_jwt: verifyJwt, version: 7, bundle_sha256: sha256(slug),
        updated_at: DEPLOYED_AT })),
    },
    abuse: {
      ok: true, guard_function_exists: true, readiness_function_exists: true,
      guard_doors: { create_order_with_items: true, create_checkout_session: true },
    },
    readiness: { ok: true, can_open: true, accepting_orders: false, pending: [] },
    // El dinero real está abierto: revisión aprobada, interruptor en `enabled` y un comercio que cobra.
    realMoneySecrets: { ok: true, states: productionRealMoney() },
    realMoneyBusinesses: { ok: true, settings_enabled_production: 1, chargeable_production: 1, connected_production_sellers: 1 },
    paymentCertification: {
      ok: true,
      opening_decision: { methods: ['manual', 'mercadopago'], decided_by: 'owner', date: '2026-10-01', notes: 'cash, transfer and Mercado Pago' },
      entries: [
        { method: 'manual', environment: 'staging', certified: true, evidence: 'artifacts/cert-manual', evidence_exists: true, evidence_tracked: true, date: '2026-10-01', limits: 'cash path' },
        { method: 'mercadopago', environment: 'production', certified: true, evidence: 'artifacts/cert-mp', evidence_exists: true, evidence_tracked: true, date: '2026-10-01', limits: 'one real payment and refund' },
      ],
    },
    findingsRegister: {
      ok: true,
      findings: [
        { id: 'X-01', severity: 'P0', title: 'fixed p0', status: 'fixed', fixed_by: 'abc1234', notes: '', aliases: [] },
        { id: 'X-02', severity: 'P1', title: 'fixed p1', status: 'fixed', fixed_by: '20261001180000_order_intake_guard', notes: '', aliases: ['Y-02'] },
        { id: 'X-03', severity: 'P1', title: 'accepted p1', status: 'accepted_risk', fixed_by: null, notes: 'accepted by the owner on 2026-10-01: low traffic', aliases: [] },
        { id: 'X-04', severity: 'P2', title: 'open p2', status: 'open', fixed_by: null, notes: '', aliases: [] },
      ],
    },
    repo: { ok: true, head: HEAD, uncommitted_release_inputs: [] },
    ci: { conclusion: 'success', commit: HEAD },
  };
}

// El reloj de las pruebas: cinco minutos después de recolectar los hechos del comercio listo.
const EVALUATED_AT = '2026-10-01T12:05:00.000Z';
const LIVE = Object.freeze({ source: 'live', now: EVALUATED_AT });

const blockerIds = (result) => result.blockers.map((blocker) => blocker.gate);
const gateOf = (result, id) => result.gates.find((gate) => gate.id === id);
const mutated = (change) => { const facts = readyFacts(); change(facts); return facts; };

// ── Evaluación ───────────────────────────────────────────────────────────────

test('las compuertas son las diecisiete del diseño, con sus ids exactos', () => {
  assert.deepEqual(GATES.map((gate) => gate.id), [
    'CATALOG_APPROVAL', 'VALID_PRICES', 'SERVICE_HOURS', 'DELIVERY_ZONES', 'FULFILMENT', 'TEAM', 'MP_SELLER',
    'PAYMENT_CERTIFICATION', 'REAL_MONEY_GATE', 'MIGRATION_PARITY', 'EDGE_FUNCTIONS', 'ABUSE_PROTECTION', 'UNATTENDED_ORDER_POLICY',
    'NO_OPEN_P0', 'NO_OPEN_P1', 'CI_GREEN', 'STORE_STATE',
  ]);
  assert.deepEqual(GATES.filter((gate) => !gate.blocking).map((gate) => gate.id), ['UNATTENDED_ORDER_POLICY', 'STORE_STATE']);
  assert.equal(CRITICAL_EDGE_FUNCTIONS.length, 9);
  assert.ok(CRITICAL_EDGE_FUNCTIONS.every((slug) => slug.startsWith('mercadopago-')));
  assert.deepEqual(RELEASE_TARGETS, ['staging', 'controlled-production']);
});

test('un comercio con todos los hechos en regla es PRODUCTION_READY', () => {
  const result = evaluate(readyFacts());
  assert.equal(result.verdict, 'PRODUCTION_READY');
  assert.equal(result.verdict, VERDICTS.READY);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.gates.map((gate) => gate.status), GATES.map(() => 'PASS'));
  assert.deepEqual(Object.keys(result.gates[0]), ['id', 'title', 'blocking', 'status', 'evidence', 'missing']);
  assert.equal(result.summary.public_launch_ready, true);
  assert.equal(gateOf(result, 'TEAM').evidence.delivery_model, 'SELF_DELIVERY_ALLOWED');
  assert.equal(gateOf(result, 'MP_SELLER').evidence.expected_environment, 'production');
  // El dinero real es posible, y está certificado y decidido.
  assert.deepEqual(result.moneyMovementPossible, { value: 'YES', reasons: ['MERCADOPAGO_ENVIRONMENT_PRODUCTION',
    'PRODUCTION_REVIEW_APPROVED', 'REAL_MONEY_SWITCH_ENABLED', 'BUSINESSES_CAN_CHARGE_IN_PRODUCTION:1'] });
  assert.match(gateOf(result, 'REAL_MONEY_GATE').evidence.reason, /^REAL_MONEY_CERTIFIED/);
});

// Cada fila quita UN hecho del comercio listo. El veredicto tiene que ser
// NOT_READY y el único bloqueo, la compuerta de ese hecho.
const SINGLE_FAULTS = [
  ['catálogo: menos productos públicos que el mínimo', (f) => { f.catalog.public = 0; f.catalog.available = 0; }, 'CATALOG_APPROVAL', /^PUBLIC_PRODUCTS_BELOW_MINIMUM:0\/1$/],
  ['catálogo: mínimo configurable (5) con 3 públicos', (f) => { f.options.minProducts = 5; f.catalog.public = 3; }, 'CATALOG_APPROVAL', /^PUBLIC_PRODUCTS_BELOW_MINIMUM:3\/5$/],
  ['catálogo: un disponible sin verificar', (f) => { f.catalog.available_unverified = 1; }, 'CATALOG_APPROVAL', /^AVAILABLE_UNVERIFIED:1$/],
  ['catálogo: un disponible sin intención del comercio', (f) => { f.catalog.available_without_intent = 2; }, 'CATALOG_APPROVAL', /^AVAILABLE_WITHOUT_MERCHANT_INTENT:2$/],
  ['catálogo: foto aprobada exigida y faltante', (f) => { f.catalog.available_without_approved_image = 3; }, 'CATALOG_APPROVAL', /^AVAILABLE_WITHOUT_APPROVED_IMAGE:3$/],
  ['catálogo: origen no comercial en el comercio real', (f) => { f.catalog.available_non_commercial = 1; }, 'CATALOG_APPROVAL', /^AVAILABLE_NON_COMMERCIAL_ORIGIN:1$/],
  ['precios: disponible con precio 0', (f) => { f.catalog.available_bad_price = 1; }, 'VALID_PRICES', /^AVAILABLE_WITH_NON_POSITIVE_PRICE:1$/],
  ['precios: disponible con precio pendiente', (f) => { f.catalog.available_price_not_confirmed = 1; }, 'VALID_PRICES', /^AVAILABLE_WITH_UNCONFIRMED_PRICE:1$/],
  ['horarios: no se exigen', (f) => { f.business.hours_enforced = false; }, 'SERVICE_HOURS', /^HOURS_NOT_ENFORCED$/],
  ['horarios: un canal encendido sin filas', (f) => { f.serviceHours.pickup = 0; }, 'SERVICE_HOURS', /^NO_HOURS_FOR_CHANNEL:pickup$/],
  ['horarios: sin zona horaria', (f) => { f.business.operating_timezone = null; f.business.timezone_valid = false; }, 'SERVICE_HOURS', /^TIMEZONE_NOT_SET$/],
  ['zonas: no se exigen', (f) => { f.business.delivery_zone_enforced = false; }, 'DELIVERY_ZONES', /^ZONES_NOT_ENFORCED$/],
  ['zonas: ninguna activa', (f) => { f.deliveryZones.active = 0; }, 'DELIVERY_ZONES', /^NO_ACTIVE_ZONE$/],
  ['zonas: envío sin decidir', (f) => { f.business.delivery_fee = null; f.deliveryZones.active_without_fee = 1; }, 'DELIVERY_ZONES', /^DELIVERY_FEE_NOT_DECIDED$/],
  ['zonas: mínimo sin decidir', (f) => { f.business.minimum_delivery_subtotal = null; f.deliveryZones.active_without_minimum = 2; }, 'DELIVERY_ZONES', /^DELIVERY_MINIMUM_NOT_DECIDED$/],
  ['entrega: sin dirección del comercio', (f) => { f.business.address_ok = false; }, 'FULFILMENT', /^BUSINESS_ADDRESS_NOT_SET$/],
  ['equipo: sin dueño activo', (f) => { f.team.owners = 0; }, 'TEAM', /^NO_ACTIVE_OWNER$/],
  ['equipo: sin empleado ni encargado', (f) => { f.team.staff = 0; f.team.admins = 0; }, 'TEAM', /^NO_ACTIVE_STAFF_OR_ADMIN$/],
  ['equipo: trabaja con repartidores y no hay ninguno', (f) => { f.business.rider_presence_required = true; f.team.riders = 0; }, 'TEAM', /^NO_ACTIVE_RIDER$/],
  ['Mercado Pago: sin vendedor conectado', (f) => { f.mercadoPago.connections = []; }, 'MP_SELLER', /^SELLER_NOT_CONNECTED:none@production$/],
  ['Mercado Pago: el vendedor tiene que reautorizar', (f) => { f.mercadoPago.connections[0].status = 'requires_reauthorization'; }, 'MP_SELLER', /^SELLER_NOT_CONNECTED:requires_reauthorization$/],
  ['Mercado Pago: ajustes apagados', (f) => { f.mercadoPago.settings.enabled = false; }, 'MP_SELLER', /^PAYMENT_SETTINGS_NOT_ENABLED$/],
  ['Mercado Pago: revisión de producción sin aprobar', (f) => { f.mercadoPago.settings.production_review_status = 'pending'; }, 'MP_SELLER', /^PRODUCTION_REVIEW_NOT_APPROVED:pending$/],
  ['Mercado Pago: vendedor de otro entorno', (f) => { f.mercadoPago.connections[0].environment = 'test'; }, 'MP_SELLER', /^SELLER_NOT_CONNECTED:none@production$/],
  ['Mercado Pago: el vendedor no es el de los ajustes', (f) => { f.mercadoPago.connections[0].matches_settings = false; }, 'MP_SELLER', /^SELLER_DOES_NOT_MATCH_SETTINGS$/],
  // Con el dinero real posible, Mercado Pago sin certificar para producción lo frenan DOS compuertas, a propósito:
  // la de la certificación y la del dinero real (EDGE-03), que no deja mover dinero real sin esa certificación.
  ['certificación: Mercado Pago sin certificar (con dinero real posible)', (f) => { f.paymentCertification.entries[1].certified = false; },
    ['PAYMENT_CERTIFICATION', 'REAL_MONEY_GATE'], /^NOT_CERTIFIED:mercadopago:production$/],
  ['certificación: Mercado Pago certificado sólo en sandbox (con dinero real posible)', (f) => { f.paymentCertification.entries[1].environment = 'test'; },
    ['PAYMENT_CERTIFICATION', 'REAL_MONEY_GATE'], /^NOT_CERTIFIED:mercadopago:production$/],
  ['dinero real: la variable vieja de humo sigue puesta', (f) => { f.realMoneySecrets.states.MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION = 'PRESENT'; }, 'REAL_MONEY_GATE', /^LEGACY_SMOKE_CONFIRMATION_PRESENT$/],
  ['dinero real: Mercado Pago decidido y el interruptor apagado', (f) => { f.realMoneySecrets.states.MERCADOPAGO_REAL_MONEY_ENABLED = 'ABSENT'; }, 'REAL_MONEY_GATE', /^MERCADOPAGO_DECIDED_BUT_MONEY_MOVEMENT_IS_NO$/],
  // El comercio evaluado abre sólo con efectivo, pero en el destino otro comercio puede cobrar con dinero real.
  ['dinero real: posible con una decisión de sólo efectivo', (f) => {
    f.paymentCertification.opening_decision.methods = ['manual'];
    f.mercadoPago = { ok: true, settings: null, connections: [] };
  }, 'REAL_MONEY_GATE', /^MONEY_MOVEMENT_POSSIBLE_BUT_DECISION_IS_MANUAL_ONLY$/],
  ['certificación: falta el registro del pago manual', (f) => { f.paymentCertification.entries.shift(); }, 'PAYMENT_CERTIFICATION', /^NOT_CERTIFIED:manual$/],
  ['certificación: la evidencia no está en el repo', (f) => { f.paymentCertification.entries[0].evidence_exists = false; }, 'PAYMENT_CERTIFICATION', /^EVIDENCE_NOT_IN_REPO:artifacts\/cert-manual$/],
  ['migraciones: el repo tiene una que el destino no', (f) => { f.migrationLedger.versions.pop(); }, 'MIGRATION_PARITY', /^REPO_NOT_IN_LEDGER:20261001180000$/],
  ['migraciones: el destino tiene una que el repo no', (f) => { f.migrationLedger.versions.push({ version: '20261002000000', name: 'hotfix_a_mano' }); }, 'MIGRATION_PARITY', /^LEDGER_NOT_IN_REPO:20261002000000$/],
  ['migraciones: misma versión, otro nombre', (f) => { f.migrationLedger.versions[1].name = 'otra_cosa'; }, 'MIGRATION_PARITY', /^NAME_MISMATCH:20261001010000$/],
  ['funciones: falta una crítica en el destino', (f) => { f.deployedFunctions.functions = f.deployedFunctions.functions.filter((fn) => fn.slug !== 'mercadopago-webhook'); }, 'EDGE_FUNCTIONS', /^NOT_DEPLOYED:mercadopago-webhook$/],
  ['funciones: una crítica borrada del repo', (f) => { f.repoFunctions.functions = f.repoFunctions.functions.filter((fn) => fn.slug !== 'mercadopago-refund'); }, 'EDGE_FUNCTIONS', /^CRITICAL_NOT_IN_REPO:mercadopago-refund$/],
  ['funciones: verify_jwt distinto al del repo', (f) => { f.deployedFunctions.functions.find((fn) => fn.slug === 'mercadopago-webhook').verify_jwt = true; }, 'EDGE_FUNCTIONS', /^VERIFY_JWT_MISMATCH:mercadopago-webhook:expected=false:actual=true$/],
  ['funciones: desplegada pero no activa', (f) => { f.deployedFunctions.functions.find((fn) => fn.slug === 'team-invitation').status = 'REMOVED'; }, 'EDGE_FUNCTIONS', /^NOT_ACTIVE:team-invitation:REMOVED$/],
  ['funciones: el código cambió después del despliegue', (f) => { f.repoFunctions.functions.find((fn) => fn.slug === 'mercadopago-webhook').source_committed_at = '2026-10-02T09:31:07.000Z'; }, 'EDGE_FUNCTIONS', /^SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-webhook$/],
  ['guardián: en modo monitor', (f) => { f.business.order_intake_guard_mode = 'monitor'; }, 'ABUSE_PROTECTION', /^GUARD_MODE:monitor$/],
  ['guardián: apagado', (f) => { f.business.order_intake_guard_mode = 'off'; }, 'ABUSE_PROTECTION', /^GUARD_MODE:off$/],
  ['guardián: una puerta no lo llama', (f) => { f.abuse.guard_doors.create_checkout_session = false; }, 'ABUSE_PROTECTION', /^GUARD_NOT_WIRED:create_checkout_session$/],
  ['hallazgos: un P0 abierto', (f) => { f.findingsRegister.findings[0].status = 'open'; }, 'NO_OPEN_P0', /^OPEN:X-01$/],
  ['hallazgos: un P1 abierto', (f) => { f.findingsRegister.findings[1].status = 'open'; }, 'NO_OPEN_P1', /^OPEN:X-02$/],
  ['hallazgos: riesgo aceptado sin nota', (f) => { f.findingsRegister.findings[2].notes = '   '; }, 'NO_OPEN_P1', /^ACCEPTED_RISK_WITHOUT_NOTES:X-03$/],
  ['hallazgos: corregido sin decir con qué', (f) => { f.findingsRegister.findings[1].fixed_by = null; }, 'NO_OPEN_P1', /^FIXED_WITHOUT_REFERENCE:X-02$/],
  ['hallazgos: un estado que no existe', (f) => { f.findingsRegister.findings[0].status = 'wontfix'; }, 'NO_OPEN_P0', /^INVALID_STATUS:X-01:wontfix$/],
  ['CI: falló', (f) => { f.ci.conclusion = 'failure'; }, 'CI_GREEN', /^CI_CONCLUSION:failure$/],
  ['CI: verde, pero de otro commit', (f) => { f.ci.commit = 'deadbeefcafe'; }, 'CI_GREEN', /^CI_COMMIT_MISMATCH:/],
];

for (const [name, change, expectedGates, expectedMissing] of SINGLE_FAULTS) {
  test(`un solo hecho en falta bloquea con exactamente su compuerta — ${name}`, () => {
    const result = evaluate(mutated(change));
    assert.equal(result.verdict, 'NOT_READY');
    assert.deepEqual(blockerIds(result), [].concat(expectedGates));
    for (const blocker of result.blockers) {
      assert.equal(blocker.status, 'FAIL');
      assert.match(blocker.missing[0], expectedMissing);
    }
  });
}

test('cada compuerta bloqueante tiene al menos un caso que la hace fallar sola', () => {
  const alone = new Set(SINGLE_FAULTS.filter(([, , gates]) => !Array.isArray(gates)).map(([, , gate]) => gate));
  assert.deepEqual(GATES.filter((gate) => gate.blocking && !alone.has(gate.id)).map((gate) => gate.id), []);
});

test('lo que no se pudo recolectar nunca aprueba: UNKNOWN bloquea', () => {
  const sections = {
    business: ['SERVICE_HOURS', 'DELIVERY_ZONES', 'FULFILMENT', 'TEAM', 'ABUSE_PROTECTION'],
    catalog: ['CATALOG_APPROVAL', 'VALID_PRICES'],
    serviceHours: ['SERVICE_HOURS'],
    deliveryZones: ['DELIVERY_ZONES'],
    team: ['TEAM'],
    mercadoPago: ['MP_SELLER'],
    migrationLedger: ['MIGRATION_PARITY'],
    repoMigrations: ['MIGRATION_PARITY'],
    repoFunctions: ['EDGE_FUNCTIONS'],
    deployedFunctions: ['EDGE_FUNCTIONS'],
    abuse: ['ABUSE_PROTECTION'],
    // Con el dinero real posible, sin la certificación ni la decisión no se sabe si puede moverse.
    paymentCertification: ['PAYMENT_CERTIFICATION', 'REAL_MONEY_GATE'],
    realMoneySecrets: ['REAL_MONEY_GATE'],
    realMoneyBusinesses: ['REAL_MONEY_GATE'],
    findingsRegister: ['NO_OPEN_P0', 'NO_OPEN_P1'],
  };
  for (const [section, gates] of Object.entries(sections)) {
    for (const broken of [{ ok: false, error: 'MGMT_HTTP_500' }, undefined, null, { ok: 'true' }]) {
      const result = evaluate(mutated((facts) => { facts[section] = broken; }));
      assert.equal(result.verdict, 'NOT_READY', section);
      assert.deepEqual(blockerIds(result), gates, section);
      assert.ok(result.blockers.every((blocker) => blocker.status === 'UNKNOWN'), section);
    }
  }
});

test('hechos sin identificar, vacíos o de otra forma: todo UNKNOWN y nunca PRODUCTION_READY', () => {
  for (const facts of [undefined, null, {}, [], 'facts', { target: 'production', businessId: BUSINESS }, { target: 'staging', businessId: 'x' }]) {
    const result = evaluate(facts);
    assert.equal(result.verdict, 'NOT_READY');
    assert.ok(result.gates.every((gate) => gate.status === 'UNKNOWN'));
    assert.equal(result.blockers.length, GATES.filter((gate) => gate.blocking).length);
  }
  // Sólo destino y comercio: ninguna compuerta bloqueante pasa por omisión.
  const bare = evaluate({ target: 'controlled-production', businessId: BUSINESS });
  assert.equal(bare.verdict, 'NOT_READY');
  assert.deepEqual(bare.gates.filter((gate) => gate.blocking && gate.status === 'PASS'), []);
});

test('un contador que no es un entero no se toma como cero', () => {
  for (const value of [undefined, null, '0', -1, 1.5, Number.NaN]) {
    const result = evaluate(mutated((facts) => { facts.catalog.available_bad_price = value; }));
    assert.deepEqual(blockerIds(result), ['VALID_PRICES']);
    assert.equal(result.blockers[0].status, 'UNKNOWN');
  }
  const noPolicy = evaluate(mutated((facts) => { delete facts.catalog.image_policy_applies; }));
  assert.deepEqual(blockerIds(noPolicy), ['CATALOG_APPROVAL']);
  assert.equal(noPolicy.blockers[0].status, 'UNKNOWN');
  const emptyRegister = evaluate(mutated((facts) => { facts.findingsRegister.findings = []; }));
  assert.deepEqual(blockerIds(emptyRegister), ['NO_OPEN_P0', 'NO_OPEN_P1']);
  const emptyRepo = evaluate(mutated((facts) => { facts.repoMigrations.files = []; facts.migrationLedger.versions = []; }));
  assert.deepEqual(blockerIds(emptyRepo), ['MIGRATION_PARITY']);
  assert.deepEqual(emptyRepo.blockers[0].missing, ['REPO_MIGRATIONS_EMPTY']);
});

test('CI: sin dato es UNKNOWN y bloquea; «success» sin commit tampoco alcanza', () => {
  const notSupplied = evaluate(mutated((facts) => { facts.ci = null; }));
  assert.deepEqual(blockerIds(notSupplied), ['CI_GREEN']);
  assert.deepEqual(notSupplied.blockers[0], { gate: 'CI_GREEN', status: 'UNKNOWN', missing: ['CI_CONCLUSION_NOT_SUPPLIED'] });
  const noCommit = evaluate(mutated((facts) => { facts.ci.commit = null; }));
  assert.deepEqual(noCommit.blockers[0].missing, ['CI_COMMIT_NOT_SUPPLIED']);
  const noHead = evaluate(mutated((facts) => { facts.repo = { ok: false, error: 'REPO_HEAD_UNREADABLE' }; }));
  assert.deepEqual(noHead.blockers[0].missing, ['REPO_HEAD_UNKNOWN']);
  const shortSha = evaluate(mutated((facts) => { facts.ci.commit = HEAD.slice(0, 7); }));
  assert.equal(shortSha.verdict, 'PRODUCTION_READY');
});

test('un comercio sólo con retiro no necesita zonas, envío ni repartidores', () => {
  const result = evaluate(mutated((facts) => {
    Object.assign(facts.business, { delivery_enabled: false, delivery_zone_enforced: false, delivery_fee: null, minimum_delivery_subtotal: null, rider_presence_required: true });
    facts.deliveryZones = { ok: true, total: 0, active: 0, active_without_fee: 0, active_without_minimum: 0 };
    facts.serviceHours.delivery = 0;
    facts.team.riders = 0;
  }));
  assert.equal(result.verdict, 'PRODUCTION_READY');
  const zones = gateOf(result, 'DELIVERY_ZONES');
  assert.equal(zones.status, 'PASS');
  assert.match(zones.evidence.reason, /^PICKUP_ONLY/);
  assert.equal(gateOf(result, 'TEAM').evidence.delivery_model, 'NO_DELIVERY');
  // Aunque no se puedan leer las zonas: a un comercio sin delivery no le aplican.
  const unreadable = evaluate(mutated((facts) => { facts.business.delivery_enabled = false; facts.deliveryZones = { ok: false, error: 'X' }; facts.serviceHours.delivery = 0; }));
  assert.equal(gateOf(unreadable, 'DELIVERY_ZONES').status, 'PASS');
  // Sin delivery ni retiro no hay modo de entrega.
  const nothing = evaluate(mutated((facts) => { facts.business.delivery_enabled = false; facts.business.pickup_enabled = false; }));
  assert.deepEqual(blockerIds(nothing), ['FULFILMENT']);
  assert.deepEqual(nothing.blockers[0].missing, ['NO_FULFILMENT_MODE']);
});

test('con --require-rider, entregar sin repartidor bloquea aunque la política de presencia esté apagada', () => {
  const selfDelivery = evaluate(mutated((facts) => { facts.team.riders = 0; }));
  assert.equal(selfDelivery.verdict, 'PRODUCTION_READY', 'el comercio puede cerrar su propia entrega');
  const required = evaluate(mutated((facts) => { facts.team.riders = 0; facts.options.requireRider = true; }));
  assert.deepEqual(blockerIds(required), ['TEAM']);
});

/** Apertura sólo con pago manual: sin ajustes ni vendedor de Mercado Pago, y el dinero real cerrado. */
function manualOnlyFacts() {
  return mutated((facts) => {
    facts.mercadoPago = { ok: true, settings: null, connections: [] };
    facts.realMoneySecrets.states = productionRealMoney({ MERCADOPAGO_REAL_MONEY_ENABLED: 'ABSENT' });
    facts.realMoneyBusinesses = { ok: true, settings_enabled_production: 0, chargeable_production: 0, connected_production_sellers: 0 };
    facts.paymentCertification.opening_decision = { methods: ['manual'], decided_by: 'owner', date: '2026-10-01', notes: 'cash and transfer only' };
    facts.paymentCertification.entries[1] = {
      method: 'mercadopago', environment: 'production', certified: false, evidence: null, evidence_exists: false, evidence_tracked: false, date: '2026-10-01',
      reason: 'sandbox approval blocked at provider (WCS-51579) and requires human test accounts',
    };
  });
}

test('abrir sólo con pago manual no necesita vendedor, pero sí el registro de decisión y la certificación manual', () => {
  const result = evaluate(manualOnlyFacts());
  assert.equal(result.verdict, 'PRODUCTION_READY');
  assert.match(gateOf(result, 'MP_SELLER').evidence.reason, /^MANUAL_ONLY/);
  assert.deepEqual(gateOf(result, 'PAYMENT_CERTIFICATION').evidence.methods_to_open, ['manual']);
  assert.equal(paymentPlan(manualOnlyFacts()).mode, 'manual_only');
  assert.deepEqual(result.moneyMovementPossible, { value: 'NO', reasons: ['REAL_MONEY_SWITCH_ABSENT', 'NO_BUSINESS_CAN_CHARGE_IN_PRODUCTION'] });
  assert.match(gateOf(result, 'REAL_MONEY_GATE').evidence.reason, /^NO_REAL_MONEY: the opening decision is cash and transfer only/);

  // Sin registro de decisión, que falte el vendedor no significa «sólo efectivo»; y que no se
  // mueva dinero real tampoco: la compuerta del dinero real no infiere nada de una decisión en null.
  const noDecision = manualOnlyFacts();
  noDecision.paymentCertification.opening_decision = null;
  assert.deepEqual(blockerIds(evaluate(noDecision)), ['MP_SELLER', 'REAL_MONEY_GATE']);
  assert.deepEqual(evaluate(noDecision).blockers.map((blocker) => blocker.missing), [['PAYMENT_DECISION_MISSING'], ['PAYMENT_DECISION_MISSING']]);

  // Un registro a medio llenar no es una decisión.
  const halfDecision = manualOnlyFacts();
  halfDecision.paymentCertification.opening_decision = { methods: ['manual'] };
  assert.deepEqual(evaluate(halfDecision).blockers.map((blocker) => [blocker.gate, ...blocker.missing]),
    [['MP_SELLER', 'PAYMENT_DECISION_INVALID'], ['REAL_MONEY_GATE', 'PAYMENT_DECISION_INVALID']]);

  // La certificación manual sigue siendo obligatoria.
  const noManual = manualOnlyFacts();
  noManual.paymentCertification.entries.shift();
  assert.deepEqual(blockerIds(evaluate(noManual)), ['PAYMENT_CERTIFICATION']);
  assert.deepEqual(evaluate(noManual).blockers[0].missing, ['NOT_CERTIFIED:manual']);

  // Dice «sólo efectivo» y la base tiene Mercado Pago encendido: se contradicen.
  const conflict = manualOnlyFacts();
  conflict.mercadoPago = readyFacts().mercadoPago;
  const conflicted = evaluate(conflict);
  assert.deepEqual(blockerIds(conflicted), ['MP_SELLER', 'PAYMENT_CERTIFICATION']);
  assert.deepEqual(conflicted.blockers[0].missing, ['MP_ENABLED_BUT_DECISION_IS_MANUAL_ONLY']);

  // Con decisión manual, que el repo ya no tenga las funciones de Mercado Pago no bloquea.
  const noMpFunctions = manualOnlyFacts();
  const keep = (fn) => !fn.slug.startsWith('mercadopago-');
  noMpFunctions.repoFunctions.functions = noMpFunctions.repoFunctions.functions.filter(keep);
  noMpFunctions.deployedFunctions.functions = noMpFunctions.deployedFunctions.functions.filter(keep);
  assert.equal(evaluate(noMpFunctions).verdict, 'PRODUCTION_READY');
});

// ── El interruptor de dinero real (EDGE-03) ──────────────────────────────────

test('dinero real: de las huellas de los secretos salen estados, nunca huellas ni valores', async () => {
  const entry = (name, value) => ({ name, digest: sha256(value) });
  const states = await classifyRealMoneySecrets([
    entry('MERCADOPAGO_ENVIRONMENT', 'production'), entry('MERCADOPAGO_PRODUCTION_REVIEW_STATUS', 'approved'),
    entry('MERCADOPAGO_REAL_MONEY_ENABLED', 'enabled'), entry('PAYMENT_WORKER_SECRET', 'fixture-opaque-value'),
  ]);
  assert.deepEqual(states, productionRealMoney());
  assert.equal(JSON.stringify(states).includes(sha256('enabled')), false);
  assert.deepEqual(await classifyRealMoneySecrets([]), {
    MERCADOPAGO_ENVIRONMENT: 'ABSENT', MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'ABSENT',
    MERCADOPAGO_REAL_MONEY_ENABLED: 'ABSENT', MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION: 'ABSENT',
  });
  // El interruptor: la compuerta compara exacto, así que una huella que no es la de `enabled` PRUEBA que está cerrado.
  for (const value of ['', 'true', 'ENABLED', 'Enabled', ' enabled', 'enabled ', 'enabled\n', '1', 'yes', 'I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE']) {
    const classified = await classifyRealMoneySecrets([entry('MERCADOPAGO_REAL_MONEY_ENABLED', value)]);
    assert.equal(classified.MERCADOPAGO_REAL_MONEY_ENABLED, 'NOT_ENABLED', JSON.stringify(value));
  }
  // El entorno y la revisión: las funciones recortan (y el entorno lo pasan a minúsculas). Una variante no es «cerrado».
  for (const [value, expected] of [['test', 'TEST'], ['production', 'PRODUCTION'], ['Production', 'UNRECOGNIZED'],
    [' production', 'UNRECOGNIZED'], ['sandbox', 'UNRECOGNIZED']]) {
    assert.equal((await classifyRealMoneySecrets([entry('MERCADOPAGO_ENVIRONMENT', value)])).MERCADOPAGO_ENVIRONMENT, expected, value);
  }
  for (const [value, expected] of [['approved', 'APPROVED'], ['pending', 'NOT_APPROVED'], ['not_requested', 'NOT_APPROVED'],
    ['rejected', 'NOT_APPROVED'], [' approved', 'UNRECOGNIZED'], ['APPROVED', 'UNRECOGNIZED']]) {
    assert.equal((await classifyRealMoneySecrets([entry('MERCADOPAGO_PRODUCTION_REVIEW_STATUS', value)])).MERCADOPAGO_PRODUCTION_REVIEW_STATUS, expected, value);
  }
  // La variable vieja: alcanza con que esté.
  assert.equal((await classifyRealMoneySecrets([entry('MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION', 'cualquier cosa')]))
    .MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION, 'PRESENT');
  // Sin una huella legible no se sabe qué vale. Si la API devolviera el valor en vez de la huella, tampoco.
  for (const digest of [null, undefined, '', 'enabled', 'abc', sha256('enabled').slice(0, 63), 42]) {
    const classified = await classifyRealMoneySecrets([{ name: 'MERCADOPAGO_REAL_MONEY_ENABLED', digest }]);
    assert.equal(classified.MERCADOPAGO_REAL_MONEY_ENABLED, 'UNREADABLE', String(digest));
  }
  assert.equal((await classifyRealMoneySecrets([{ name: 'MERCADOPAGO_REAL_MONEY_ENABLED', digest: sha256('enabled').toUpperCase() }]))
    .MERCADOPAGO_REAL_MONEY_ENABLED, 'ENABLED');
  // Un listado que no se puede leer no se lee a medias.
  await assert.rejects(classifyRealMoneySecrets('x'), /SECRETS_NOT_A_LIST/);
  await assert.rejects(classifyRealMoneySecrets([{ digest: sha256('enabled') }]), /SECRETS_ENTRY_WITHOUT_NAME/);
  await assert.rejects(classifyRealMoneySecrets([entry('MERCADOPAGO_REAL_MONEY_ENABLED', 'enabled'), entry('MERCADOPAGO_REAL_MONEY_ENABLED', 'no')]),
    /SECRETS_DUPLICATE_NAME/);
});

test('dinero real: el nombre del interruptor y el único valor que abre son los mismos en el backend y en la herramienta', () => {
  const edge = read('supabase/functions/_shared/real-money-gate.ts');
  assert.match(edge, /export const REAL_MONEY_SWITCH = 'MERCADOPAGO_REAL_MONEY_ENABLED';/);
  assert.match(edge, /export const REAL_MONEY_SWITCH_OPEN_VALUE = 'enabled';/);
  assert.match(edge, /export const LEGACY_SMOKE_CONFIRMATION = 'MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION';/);
  assert.equal(REAL_MONEY_SWITCH, 'MERCADOPAGO_REAL_MONEY_ENABLED');
  assert.equal(REAL_MONEY_SWITCH_OPEN_VALUE, 'enabled');
  assert.equal(EVALUATED_REAL_MONEY_SWITCH, REAL_MONEY_SWITCH);
  assert.equal(LEGACY_SMOKE_CONFIRMATION, 'MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION');
  assert.equal(EVALUATED_LEGACY_SMOKE, LEGACY_SMOKE_CONFIRMATION);
  assert.deepEqual(MONEY_MOVEMENT, { YES: 'YES', NO: 'NO', UNKNOWN: 'UNKNOWN' });
  assert.deepEqual(JSON.parse(read('docs/ecommerce-hardening/release-gates.json')).money_movement_possible, ['YES', 'NO', 'UNKNOWN']);
});

// MONEY_MOVEMENT_POSSIBLE: [caso, estados de los secretos (sobre un proyecto productivo abierto), comercios que cobran, valor, razones].
// `null` en los estados o en los comercios = esa sección no se pudo leer.
const ENV = 'MERCADOPAGO_ENVIRONMENT', REVIEW = 'MERCADOPAGO_PRODUCTION_REVIEW_STATUS';
const SWITCH = 'MERCADOPAGO_REAL_MONEY_ENABLED', LEGACY = 'MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION';
const OPEN_REASONS = ['MERCADOPAGO_ENVIRONMENT_PRODUCTION', 'PRODUCTION_REVIEW_APPROVED', 'REAL_MONEY_SWITCH_ENABLED', 'BUSINESSES_CAN_CHARGE_IN_PRODUCTION:1'];
const MONEY_CASES = [
  ['las tres llaves abiertas', {}, 1, 'YES', OPEN_REASONS],
  ['sin el interruptor', { [SWITCH]: 'ABSENT' }, 1, 'NO', ['REAL_MONEY_SWITCH_ABSENT']],
  ['con el interruptor en otro valor', { [SWITCH]: 'NOT_ENABLED' }, 1, 'NO', ['REAL_MONEY_SWITCH_NOT_ENABLED']],
  ['sin el interruptor y con la frase vieja de humo', { [SWITCH]: 'ABSENT', [LEGACY]: 'PRESENT' }, 1, 'YES',
    ['MERCADOPAGO_ENVIRONMENT_PRODUCTION', 'PRODUCTION_REVIEW_APPROVED', 'LEGACY_SMOKE_CONFIRMATION_PRESENT', 'BUSINESSES_CAN_CHARGE_IN_PRODUCTION:1']],
  ['con un interruptor ilegible', { [SWITCH]: 'UNREADABLE' }, 1, 'UNKNOWN', ['REAL_MONEY_SWITCH_UNREADABLE']],
  ['en entorno test', { [ENV]: 'TEST' }, 1, 'NO', ['MERCADOPAGO_ENVIRONMENT_TEST']],
  ['sin entorno', { [ENV]: 'ABSENT' }, 1, 'NO', ['MERCADOPAGO_ENVIRONMENT_ABSENT']],
  ['con un entorno que no se reconoce', { [ENV]: 'UNRECOGNIZED' }, 1, 'UNKNOWN', ['MERCADOPAGO_ENVIRONMENT_UNRECOGNIZED']],
  ['con un entorno que no se reconoce y sin el interruptor', { [ENV]: 'UNRECOGNIZED', [SWITCH]: 'ABSENT' }, 1, 'NO', ['REAL_MONEY_SWITCH_ABSENT']],
  ['sin revisión productiva', { [REVIEW]: 'ABSENT' }, 1, 'NO', ['PRODUCTION_REVIEW_ABSENT']],
  ['con la revisión pendiente', { [REVIEW]: 'NOT_APPROVED' }, 1, 'NO', ['PRODUCTION_REVIEW_NOT_APPROVED']],
  ['con una revisión que no se reconoce', { [REVIEW]: 'UNRECOGNIZED' }, 1, 'UNKNOWN', ['PRODUCTION_REVIEW_UNRECOGNIZED']],
  ['con un estado que la herramienta no conoce', { [REVIEW]: 'MAYBE' }, 1, 'UNKNOWN', ['PRODUCTION_REVIEW_UNREADABLE']],
  ['sin ningún comercio que cobre en producción', {}, 0, 'NO', ['NO_BUSINESS_CAN_CHARGE_IN_PRODUCTION']],
  ['sin poder leer los comercios', {}, null, 'UNKNOWN', ['REAL_MONEY_BUSINESSES_UNAVAILABLE:MGMT_HTTP_500']],
  ['sin poder leer los secretos', null, 1, 'UNKNOWN', ['REAL_MONEY_SECRETS_UNAVAILABLE:MGMT_HTTP_500']],
  ['sin poder leer los secretos y sin ningún comercio que cobre', null, 0, 'NO', ['NO_BUSINESS_CAN_CHARGE_IN_PRODUCTION']],
  ['con varias cerradas a la vez', { [REVIEW]: 'ABSENT', [SWITCH]: 'ABSENT' }, 0, 'NO',
    ['PRODUCTION_REVIEW_ABSENT', 'REAL_MONEY_SWITCH_ABSENT', 'NO_BUSINESS_CAN_CHARGE_IN_PRODUCTION']],
];

const withMoney = (facts, states, chargeable) => {
  facts.realMoneySecrets = states === null ? { ok: false, error: 'MGMT_HTTP_500' } : { ok: true, states: productionRealMoney(states) };
  facts.realMoneyBusinesses = chargeable === null ? { ok: false, error: 'MGMT_HTTP_500' }
    : { ok: true, settings_enabled_production: chargeable, chargeable_production: chargeable, connected_production_sellers: chargeable };
  return facts;
};

for (const [name, states, chargeable, value, reasons] of MONEY_CASES) {
  test(`MONEY_MOVEMENT_POSSIBLE ${name}: ${value}`, () => {
    const facts = withMoney(readyFacts(), states, chargeable);
    assert.deepEqual(moneyMovementPossible(facts), { value, reasons, platform: moneyMovementPossible(facts).platform });
    const result = evaluate(facts, LIVE);
    assert.deepEqual(result.moneyMovementPossible, { value, reasons });
    assert.match(renderTable(result, facts), new RegExp(`^MONEY_MOVEMENT_POSSIBLE: ${value} \\(`, 'm'));
    // UNKNOWN nunca pasa la compuerta, con ninguna decisión.
    if (value === 'UNKNOWN') {
      for (const decide of [() => {}, (f) => { f.paymentCertification.opening_decision.methods = ['manual']; f.mercadoPago = { ok: true, settings: null, connections: [] }; }]) {
        const undecided = readyFacts();
        decide(undecided);
        assert.notEqual(gateOf(evaluate(withMoney(undecided, states, chargeable), LIVE), 'REAL_MONEY_GATE').status, 'PASS', name);
      }
    }
  });
}

test('MONEY_MOVEMENT_POSSIBLE: el lado del proyecto pide las dos llaves cerradas para decir NO', () => {
  assert.equal(realMoneyPlatform(productionRealMoney()).value, 'OPEN');
  assert.equal(realMoneyPlatform(productionRealMoney({ [SWITCH]: 'ABSENT' })).value, 'CLOSED');
  // Con funciones viejas desplegadas, la frase vieja todavía abriría: no se puede decir «cerrado».
  assert.equal(realMoneyPlatform(productionRealMoney({ [SWITCH]: 'ABSENT', [LEGACY]: 'PRESENT' })).value, 'OPEN');
  assert.deepEqual(realMoneyPlatform(productionRealMoney({ [SWITCH]: 'ABSENT', [LEGACY]: 'MAYBE' })).unknown, ['LEGACY_SMOKE_CONFIRMATION_UNREADABLE']);
  for (const malformed of [null, 'states', [], undefined]) assert.equal(realMoneyPlatform(malformed).value, 'UNKNOWN', String(malformed));
});

// REAL_MONEY_GATE en controlled-production: [dinero real, decisión, ¿Mercado Pago certificado para producción?, estado, códigos].
const DECISIONS = {
  'efectivo y Mercado Pago': { methods: ['manual', 'mercadopago'], decided_by: 'owner', date: '2026-10-01' },
  'sólo efectivo': { methods: ['manual'], decided_by: 'owner', date: '2026-10-01' },
  'sin decidir (null)': null,
  'a medio llenar': { methods: ['manual'] },
};
const GATE_CASES = [
  ['YES', 'efectivo y Mercado Pago', true, 'PASS', []],
  ['YES', 'efectivo y Mercado Pago', false, 'FAIL', ['NOT_CERTIFIED:mercadopago:production']],
  ['YES', 'sólo efectivo', true, 'FAIL', ['MONEY_MOVEMENT_POSSIBLE_BUT_DECISION_IS_MANUAL_ONLY']],
  ['YES', 'sólo efectivo', false, 'FAIL', ['MONEY_MOVEMENT_POSSIBLE_BUT_DECISION_IS_MANUAL_ONLY', 'NOT_CERTIFIED:mercadopago:production']],
  ['YES', 'sin decidir (null)', true, 'FAIL', ['PAYMENT_DECISION_MISSING']],
  ['YES', 'sin decidir (null)', false, 'FAIL', ['PAYMENT_DECISION_MISSING', 'NOT_CERTIFIED:mercadopago:production']],
  ['YES', 'a medio llenar', true, 'FAIL', ['PAYMENT_DECISION_INVALID']],
  ['NO', 'sólo efectivo', false, 'PASS', []],
  ['NO', 'sólo efectivo', true, 'PASS', []],
  ['NO', 'efectivo y Mercado Pago', true, 'FAIL', ['MERCADOPAGO_DECIDED_BUT_MONEY_MOVEMENT_IS_NO']],
  ['NO', 'sin decidir (null)', false, 'FAIL', ['PAYMENT_DECISION_MISSING']],
  ['NO', 'a medio llenar', false, 'FAIL', ['PAYMENT_DECISION_INVALID']],
  ['UNKNOWN', 'efectivo y Mercado Pago', true, 'UNKNOWN', ['MONEY_MOVEMENT_UNKNOWN:REAL_MONEY_SWITCH_UNREADABLE']],
  ['UNKNOWN', 'sólo efectivo', false, 'UNKNOWN', ['MONEY_MOVEMENT_UNKNOWN:REAL_MONEY_SWITCH_UNREADABLE']],
  ['UNKNOWN', 'sin decidir (null)', false, 'FAIL', ['PAYMENT_DECISION_MISSING', 'MONEY_MOVEMENT_UNKNOWN:REAL_MONEY_SWITCH_UNREADABLE']],
];
const MONEY_STATES = { YES: {}, NO: { [SWITCH]: 'ABSENT' }, UNKNOWN: { [SWITCH]: 'UNREADABLE' } };

for (const [money, decision, certified, status, missing] of GATE_CASES) {
  test(`REAL_MONEY_GATE en controlled-production: dinero real ${money}, decisión ${decision}, Mercado Pago ${certified ? '' : 'sin '}certificado → ${status}`, () => {
    const facts = withMoney(readyFacts(), MONEY_STATES[money], 1);
    facts.paymentCertification.opening_decision = structuredClone(DECISIONS[decision]);
    facts.paymentCertification.entries[1].certified = certified;
    const gate = gateOf(evaluate(facts, LIVE), 'REAL_MONEY_GATE');
    assert.equal(gate.evidence.money_movement_possible, money);
    assert.equal(gate.status, status);
    assert.deepEqual(gate.missing, missing);
  });
}

test('REAL_MONEY_GATE en staging: sólo pasa con NO; la frase vieja de humo falla en cualquier destino', () => {
  const staging = (states, chargeable = 0) => {
    const facts = withMoney(readyFacts(), states, chargeable);
    facts.target = 'staging';
    // En Staging la decisión de apertura no cuenta: el gate mira que el dinero real no sea posible.
    facts.paymentCertification.opening_decision = null;
    return gateOf(evaluate(facts, LIVE), 'REAL_MONEY_GATE');
  };
  const test_ = { [ENV]: 'TEST', [REVIEW]: 'ABSENT', [SWITCH]: 'ABSENT' };
  assert.deepEqual([staging(test_).status, staging(test_).evidence.reason], ['PASS', 'NO_REAL_MONEY_ON_STAGING']);
  // El interruptor puesto en Staging no cambia nada: el entorno es test.
  assert.equal(staging({ ...test_, [SWITCH]: 'ENABLED' }, 1).status, 'PASS');
  assert.deepEqual(staging({}, 1).missing, ['REAL_MONEY_POSSIBLE_ON_STAGING']);
  assert.deepEqual([staging({ [SWITCH]: 'UNREADABLE' }, 1).status, staging({ [SWITCH]: 'UNREADABLE' }, 1).missing],
    ['UNKNOWN', ['MONEY_MOVEMENT_UNKNOWN:REAL_MONEY_SWITCH_UNREADABLE']]);
  assert.deepEqual(staging({ ...test_, [LEGACY]: 'PRESENT' }).missing, ['LEGACY_SMOKE_CONFIRMATION_PRESENT']);
  // En controlled-production también, aunque todo lo demás esté en regla.
  const cp = gateOf(evaluate(withMoney(readyFacts(), { [LEGACY]: 'PRESENT' }, 1), LIVE), 'REAL_MONEY_GATE');
  assert.deepEqual([cp.status, cp.missing], ['FAIL', ['LEGACY_SMOKE_CONFIRMATION_PRESENT']]);
});

test('REAL_MONEY_GATE: la evidencia dice estados y cantidades, nunca valores ni huellas', () => {
  const facts = readyFacts();
  const gate = gateOf(evaluate(facts, LIVE), 'REAL_MONEY_GATE');
  assert.deepEqual(gate.evidence.secrets, productionRealMoney());
  assert.deepEqual(gate.evidence.businesses, { settings_enabled_production: 1, chargeable_production: 1, connected_production_sellers: 1 });
  assert.deepEqual(gate.evidence.opening_decision, ['manual', 'mercadopago']);
  assert.equal(gate.evidence.mercadopago_certified_for_production, true);
  const printed = [renderTable(evaluate(facts, LIVE), facts), renderMarkdown(evaluate(facts, LIVE), facts), JSON.stringify(evaluate(facts, LIVE))].join('\n');
  for (const value of ['enabled', 'production', 'approved', 'test']) assert.equal(printed.includes(sha256(value)), false, value);
});

test('en Staging Mercado Pago corre en modo test y un cobro de producción es el entorno equivocado', () => {
  assert.equal(expectedMercadoPagoEnvironment('staging'), 'test');
  assert.equal(expectedMercadoPagoEnvironment('controlled-production'), 'production');
  const staging = mutated((facts) => {
    facts.target = 'staging';
    facts.mercadoPago.settings.environment = 'test';
    facts.mercadoPago.settings.production_review_status = 'not_requested';
    facts.mercadoPago.connections[0].environment = 'test';
    facts.paymentCertification.entries[1].environment = 'test';
    facts.catalog.available_non_commercial = 12;
    stagingRealMoney(facts);
  });
  const stagingResult = evaluate(staging);
  assert.equal(stagingResult.verdict, 'PRODUCTION_READY', 'el catálogo de QA y el sandbox son lo esperado en Staging');
  assert.deepEqual(stagingResult.moneyMovementPossible.value, 'NO');
  assert.equal(gateOf(stagingResult, 'REAL_MONEY_GATE').evidence.reason, 'NO_REAL_MONEY_ON_STAGING');
  const wrong = evaluate(mutated((facts) => { facts.target = 'staging'; stagingRealMoney(facts); }));
  assert.deepEqual(blockerIds(wrong), ['MP_SELLER']);
  assert.ok(wrong.blockers[0].missing.includes('WRONG_ENVIRONMENT:production!=test'));
  // Y si los secretos de Staging dijeran producción con el interruptor abierto: en Staging el dinero real no puede ser posible.
  const realOnStaging = evaluate(mutated((facts) => {
    facts.target = 'staging';
    facts.mercadoPago.settings.environment = 'test';
    facts.mercadoPago.settings.production_review_status = 'not_requested';
    facts.mercadoPago.connections[0].environment = 'test';
    facts.paymentCertification.entries[1].environment = 'test';
  }));
  assert.deepEqual(realOnStaging.blockers, [{ gate: 'REAL_MONEY_GATE', status: 'FAIL', missing: ['REAL_MONEY_POSSIBLE_ON_STAGING'] }]);
});

test('modo estricto: los bundles tienen que ser los del entorno de referencia', () => {
  const strict = (change = () => {}) => mutated((facts) => {
    facts.options.functionsReference = 'staging';
    facts.referenceFunctions = { ok: true, target: 'staging', functions: FUNCTIONS.map(([slug, verifyJwt]) => ({ slug, status: 'ACTIVE', verify_jwt: verifyJwt, bundle_sha256: sha256(slug) })) };
    change(facts);
  });
  assert.equal(evaluate(strict()).verdict, 'PRODUCTION_READY');
  const drift = evaluate(strict((facts) => { facts.referenceFunctions.functions[10].bundle_sha256 = sha256('otro bundle'); }));
  assert.deepEqual(blockerIds(drift), ['EDGE_FUNCTIONS']);
  assert.deepEqual(drift.blockers[0].missing, ['BUNDLE_MISMATCH:mercadopago-webhook']);
  const noReference = evaluate(strict((facts) => { facts.referenceFunctions = { ok: false, error: 'MGMT_HTTP_401' }; }));
  assert.deepEqual(noReference.blockers[0], { gate: 'EDGE_FUNCTIONS', status: 'UNKNOWN', missing: ['REFERENCE_UNAVAILABLE:MGMT_HTTP_401'] });
  const extra = evaluate(mutated((facts) => { facts.deployedFunctions.functions.push({ slug: 'vieja', status: 'ACTIVE', verify_jwt: true }); }));
  assert.equal(extra.verdict, 'PRODUCTION_READY');
  assert.deepEqual(gateOf(extra, 'EDGE_FUNCTIONS').evidence.unexpected_on_target, ['vieja']);
});

test('lo que no bloquea se informa aparte: avisos y compuertas externas', () => {
  const result = evaluate(mutated((facts) => {
    facts.business.abandoned_order_minutes = null;
    facts.findingsRegister.findings.push({ id: 'EXT-01', severity: 'P1', title: 'provider approval', status: 'external_gate', fixed_by: null, notes: 'WCS-51579', aliases: [] });
  }));
  assert.equal(result.verdict, 'PRODUCTION_READY');
  assert.deepEqual(result.warnings, [{ gate: 'UNATTENDED_ORDER_POLICY', status: 'FAIL', missing: ['ABANDONED_ORDER_MINUTES_NOT_DECIDED'] }]);
  assert.deepEqual(result.publicLaunchBlockers, [{ id: 'EXT-01', severity: 'P1', title: 'provider approval', notes: 'WCS-51579' }]);
  assert.equal(result.summary.public_launch_ready, false);
  assert.equal(gateOf(result, 'NO_OPEN_P1').evidence.external_gate, 1);
  assert.match(renderTable(result, readyFacts()), /UNATTENDED_ORDER_POLICY\s+no\s+WARNING\s+ABANDONED_ORDER_MINUTES_NOT_DECIDED/);
  assert.match(renderTable(result, readyFacts()), /PUBLIC LAUNCH BLOCKERS — external gates \(1\)\n {2}EXT-01 \[P1\] provider approval/);
  // El estado de la tienda es informativo: cerrada no bloquea, y sin la RPC de preparación tampoco.
  const closed = evaluate(mutated((facts) => { facts.readiness = { ok: false, error: 'permission denied' }; }));
  assert.equal(closed.verdict, 'PRODUCTION_READY');
  assert.equal(gateOf(closed, 'STORE_STATE').evidence.status, 'closed');
  assert.equal(gateOf(closed, 'STORE_STATE').evidence.opening_readiness, 'NOT_AVAILABLE:permission denied');
});

test('un hallazgo sólo deja de bloquear con estado válido y su respaldo', () => {
  assert.deepEqual(FINDING_STATUSES, ['open', 'fixed', 'accepted_risk', 'external_gate']);
  assert.equal(findingBlocker({ id: 'A', status: 'open' }), 'OPEN:A');
  assert.equal(findingBlocker({ id: 'A', status: 'fixed', fixed_by: '' }), 'FIXED_WITHOUT_REFERENCE:A');
  assert.equal(findingBlocker({ id: 'A', status: 'fixed', fixed_by: '7bdf9d4' }), null);
  assert.equal(findingBlocker({ id: 'A', status: 'accepted_risk', notes: null }), 'ACCEPTED_RISK_WITHOUT_NOTES:A');
  assert.equal(findingBlocker({ id: 'A', status: 'accepted_risk', notes: 'owner, 2026-10-01' }), null);
  assert.equal(findingBlocker({ id: 'A', status: 'external_gate', notes: 'provider ticket WCS-51579' }), null);
  // Sin justificación, `external_gate` sería la forma más barata de destrabar la compuerta.
  assert.equal(findingBlocker({ id: 'A', status: 'external_gate' }), 'EXTERNAL_GATE_WITHOUT_NOTES:A');
  assert.equal(findingBlocker({ id: 'A', status: 'external_gate', notes: '  ' }), 'EXTERNAL_GATE_WITHOUT_NOTES:A');
  const relabelled = evaluate(mutated((facts) => { Object.assign(facts.findingsRegister.findings[0], { status: 'external_gate', fixed_by: null, notes: '' }); }));
  assert.deepEqual(relabelled.blockers, [{ gate: 'NO_OPEN_P0', status: 'FAIL', missing: ['EXTERNAL_GATE_WITHOUT_NOTES:X-01'] }]);
  assert.equal(findingBlocker({ id: 'A' }), 'INVALID_STATUS:A:none');
  const unreadable = evaluate(mutated((facts) => { facts.findingsRegister.findings[3].severity = 'alta'; }));
  assert.deepEqual(blockerIds(unreadable), ['NO_OPEN_P0']);
  assert.deepEqual(unreadable.blockers[0].missing, ['INVALID_SEVERITY:X-04']);
});

// ── Recolección ──────────────────────────────────────────────────────────────

const CONFIG_TOML = [
  'project_id = "fixture"', '',
  ...FUNCTIONS.filter(([slug]) => slug !== 'fiscal-artifact-access')
    .flatMap(([slug, verifyJwt]) => [`[functions.${slug}]`, `verify_jwt = ${verifyJwt} # comentario`, '']),
  '[api]', 'enabled = true', 'verify_jwt = false', '',
].join('\n');

/** Un `io` de mentira armado con los hechos del comercio listo. Registra cada SQL que recibe. */
function fakeIo(overrides = {}) {
  const facts = readyFacts();
  const { ok: _b, ...business } = facts.business;
  const strip = ({ ok: _ok, ...rest }) => rest;
  const answers = new Map([
    [SQL.observer(), strip(facts.observer)],
    [SQL.business(BUSINESS), business],
    [SQL.serviceHours(BUSINESS), strip(facts.serviceHours)],
    [SQL.deliveryZones(BUSINESS), strip(facts.deliveryZones)],
    [SQL.catalog(BUSINESS), strip(facts.catalog)],
    [SQL.team(BUSINESS), strip(facts.team)],
    [SQL.mercadoPago(BUSINESS), strip(facts.mercadoPago)],
    [SQL.migrationLedger(), facts.migrationLedger.versions],
    [SQL.abuse(), strip(facts.abuse)],
    [SQL.readiness(BUSINESS, 1), { can_open: true, accepting_orders: false, pending: [], items: [] }],
    [SQL.realMoneyBusinesses(), strip(facts.realMoneyBusinesses)],
  ].map(([sql, data]) => [assertSelectOnly(sql), data]));
  // Los secretos del proyecto como los devuelve la Management API: nombre y huella SHA-256 del valor.
  // Los valores sólo viven acá, en la prueba; la herramienta ve las huellas.
  const secrets = new Map([
    ['MERCADOPAGO_ENVIRONMENT', 'production'],
    ['MERCADOPAGO_PRODUCTION_REVIEW_STATUS', 'approved'],
    ['MERCADOPAGO_REAL_MONEY_ENABLED', 'enabled'],
    ['MERCADOPAGO_CLIENT_SECRET', 'fixture-client-secret-value'],
    ['PAYMENT_WORKER_SECRET', 'fixture-worker-secret-value'],
  ]);
  const files = {
    'supabase/config.toml': CONFIG_TOML,
    [PAYMENT_CERTIFICATION_PATH]: JSON.stringify({
      opening_decision: facts.paymentCertification.opening_decision,
      entries: facts.paymentCertification.entries.map(({ evidence_exists: _e, evidence_tracked: _t, ...entry }) => entry),
    }),
    [FINDINGS_REGISTER_PATH]: JSON.stringify({ findings: facts.findingsRegister.findings }),
    'artifacts/cert-mp': 'evidence file',
    'supabase/functions/_shared/cors.ts': "export const cors = {};\n",
    'supabase/functions/_shared/runtime.ts': "import { cors } from './cors.ts';\nexport const runtime = { cors };\n",
    ...Object.fromEntries(FUNCTIONS.map(([slug]) => [`supabase/functions/${slug}/index.ts`,
      "import { runtime } from '../_shared/runtime.ts';\nexport default runtime;\n"])),
  };
  const dirs = {
    'supabase/migrations': [...MIGRATIONS.map((row) => ({ name: `${row.version}_${row.name}.sql`, isDirectory: false })), { name: 'README.md', isDirectory: false }],
    'supabase/functions': [...FUNCTIONS.map(([slug]) => ({ name: slug, isDirectory: true })), { name: '_shared', isDirectory: true }, { name: 'deno.json', isDirectory: false }],
    'artifacts/cert-manual': [{ name: 'final-report.md', isDirectory: false }],
    ...Object.fromEntries(FUNCTIONS.map(([slug]) => [`supabase/functions/${slug}`,
      [{ name: 'index.ts', isDirectory: false }, { name: 'index.deno.ts', isDirectory: false }]])),
  };
  const sqlSeen = [];
  const untracked = new Set();
  const uncommittedAsked = [];
  const commitTimeAsked = [];
  const io = {
    sqlSeen,
    async runReadOnlySql(sql) {
      sqlSeen.push(sql);
      if (!answers.has(sql)) throw Error('UNEXPECTED_SQL');
      return [{ data: answers.get(sql) }];
    },
    async listFunctions() {
      return FUNCTIONS.map(([slug, verifyJwt]) => ({ slug, status: 'ACTIVE', verify_jwt: verifyJwt, version: 7, ezbr_sha256: sha256(slug),
        updated_at: DEPLOYED_AT }));
    },
    async listSecrets() {
      return [...secrets].map(([name, value]) => ({ name, digest: sha256(value) }));
    },
    secrets,
    async readRepoFile(relativePath) {
      if (!Object.hasOwn(files, relativePath)) throw Error(`REPO_FILE_UNREADABLE:${relativePath}:ENOENT`);
      return files[relativePath];
    },
    async listRepoDir(relativePath) {
      if (!Object.hasOwn(dirs, relativePath)) throw Error(`REPO_DIR_UNREADABLE:${relativePath}:ENOENT`);
      return dirs[relativePath];
    },
    async repoHead() { return HEAD; },
    // Un árbol limpio donde git versiona todo lo que existe, salvo lo que se marque como no versionado.
    async repoUncommitted(paths) { uncommittedAsked.push(paths); return []; },
    async repoTracked(relativePath) {
      return (Object.hasOwn(files, relativePath) || Object.hasOwn(dirs, relativePath)) && !untracked.has(relativePath);
    },
    async repoLastCommitTime(paths) { commitTimeAsked.push(paths); return Date.parse(SOURCE_COMMITTED_AT); },
    async ciConclusion() { return { conclusion: 'success', commit: HEAD }; },
    answers, files, dirs, untracked, uncommittedAsked, commitTimeAsked,
    ...overrides,
  };
  return io;
}

const NOW = () => new Date('2026-10-01T12:00:00.000Z');

test('collect() arma los hechos con la entrada/salida inyectada y el resultado es PRODUCTION_READY', async () => {
  const io = fakeIo();
  const facts = await collect('controlled-production', BUSINESS.toUpperCase(), io, { now: NOW });
  assert.equal(facts.target, 'controlled-production');
  assert.equal(facts.businessId, BUSINESS);
  assert.equal(facts.collectedAt, '2026-10-01T12:00:00.000Z');
  assert.equal(facts.projectRef, null);
  assert.equal((await collect('staging', BUSINESS, fakeIo({ projectRef: 'a'.repeat(20) }), { now: NOW })).projectRef, 'a'.repeat(20));
  assert.deepEqual(facts.options, { minProducts: 1, requireRider: false, requireImages: false, functionsReference: null });
  assert.deepEqual(facts.repoMigrations, { ok: true, files: MIGRATIONS, unrecognized: [] });
  assert.equal(facts.repoFunctions.functions.length, 13, '_shared y los archivos sueltos no son funciones');
  assert.deepEqual(facts.repoFunctions.functions.find((fn) => fn.slug === 'fiscal-artifact-access'),
    { slug: 'fiscal-artifact-access', verify_jwt: true, declared_in_config: false, source_committed_at: SOURCE_COMMITTED_AT, source_files: 4 },
    'sin entrada en config.toml vale el default de la plataforma');
  assert.equal(facts.deployedFunctions.functions[0].bundle_sha256, sha256('catalog-image-manager'));
  assert.deepEqual(facts.paymentCertification.entries.map((entry) => entry.evidence_exists), [true, true], 'evidencia como directorio y como archivo');
  assert.deepEqual(facts.ci, { conclusion: 'success', commit: HEAD });
  assert.deepEqual(facts.realMoneySecrets, { ok: true, states: productionRealMoney() });
  assert.deepEqual(facts.realMoneyBusinesses, readyFacts().realMoneyBusinesses);
  // De los secretos quedan estados: ni la huella ni el valor de ninguno llega a los hechos.
  const serialized = JSON.stringify(facts);
  for (const value of io.secrets.values()) assert.equal(serialized.includes(sha256(value)), false, 'una huella de secreto llegó a los hechos');
  for (const name of ['MERCADOPAGO_CLIENT_SECRET', 'PAYMENT_WORKER_SECRET']) {
    assert.equal(serialized.includes(io.secrets.get(name)), false, `el valor de ${name} llegó a los hechos`);
    assert.equal(serialized.includes(name), false, `${name} no es del dinero real y no tiene por qué aparecer`);
  }
  assert.equal(io.sqlSeen.length, 11);
  for (const sql of io.sqlSeen) assert.equal(assertSelectOnly(sql), sql);
  const result = evaluate(facts);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.verdict, 'PRODUCTION_READY');
  // Los hechos guardados son JSON plano: ida y vuelta sin cambiar el veredicto.
  assert.equal(evaluate(JSON.parse(JSON.stringify(facts))).verdict, 'PRODUCTION_READY');
});

test('collect() rechaza un pedido mal formado antes de tocar nada', async () => {
  const io = fakeIo();
  await assert.rejects(collect('production', BUSINESS, io), /UNKNOWN_TARGET/);
  await assert.rejects(collect('staging', "x' or '1'='1", io), /BUSINESS_ID_INVALID/);
  assert.throws(() => SQL.business("00000000-0000-4000-8000-000000000001'; select 1"), /BUSINESS_ID_INVALID/);
  assert.equal(io.sqlSeen.length, 0);
});

test('un recolector que falla deja su sección desconocida y los demás siguen', async () => {
  const failing = fakeIo();
  const original = failing.runReadOnlySql;
  failing.runReadOnlySql = async (sql) => {
    // La ruta se arma al correr: el repo no admite rutas de disco escritas en un archivo.
    if (sql.includes('from public.products x')) throw Error(`MGMT_HTTP_500 open '${['C', ':\\Users\\alguien\\Desktop\\x.json'].join('')}' failed`);
    return original(sql);
  };
  const facts = await collect('controlled-production', BUSINESS, failing, { now: NOW });
  assert.equal(facts.catalog.ok, false);
  assert.doesNotMatch(facts.catalog.error, /Users|[A-Za-z]:\\/, 'el motivo no lleva rutas de disco');
  assert.match(facts.catalog.error, /^MGMT_HTTP_500 open '<path>/);
  assert.equal(facts.team.ok, true);
  const result = evaluate(facts);
  assert.deepEqual(blockerIds(result), ['CATALOG_APPROVAL', 'VALID_PRICES']);
  assert.ok(result.blockers.every((blocker) => blocker.status === 'UNKNOWN'));
});

test('lo que la misión todavía está agregando puede no existir: es un hecho, no una caída', async () => {
  // Destino sin la migración del guardián: ni función, ni columna, ni RPC de preparación accesible.
  const io = fakeIo();
  io.answers.set(assertSelectOnly(SQL.abuse()), {
    guard_function_exists: false, readiness_function_exists: false,
    guard_doors: { create_order_with_items: false, create_checkout_session: false },
  });
  const { ok: _ok, order_intake_guard_mode: _mode, ...business } = readyFacts().business;
  io.answers.set(assertSelectOnly(SQL.business(BUSINESS)), { ...business, order_intake_guard_mode: null });
  io.answers.delete(assertSelectOnly(SQL.readiness(BUSINESS, 1)));
  const facts = await collect('controlled-production', BUSINESS, io, { now: NOW });
  assert.equal(facts.readiness.ok, false);
  const result = evaluate(facts);
  assert.deepEqual(blockerIds(result), ['ABUSE_PROTECTION']);
  assert.deepEqual(result.blockers[0], { gate: 'ABUSE_PROTECTION', status: 'FAIL', missing: ['GUARD_FUNCTION_MISSING', 'GUARD_MODE:absent'] });
  assert.equal(gateOf(result, 'STORE_STATE').status, 'PASS');
});

test('un comercio que no existe, un io vacío o un io que sólo falla: NOT_READY sin excepción', async () => {
  const missing = fakeIo({ async runReadOnlySql(sql) { return sql.includes('from public.businesses x') ? [] : [{ data: {} }]; } });
  const notFound = await collect('staging', BUSINESS, missing, { now: NOW });
  assert.deepEqual(notFound.business, { ok: false, error: 'BUSINESS_NOT_FOUND' });

  const broken = () => { throw Error('fetch failed'); };
  for (const io of [{}, { runReadOnlySql: broken, listFunctions: broken, readRepoFile: broken, listRepoDir: broken, repoHead: broken, ciConclusion: broken }]) {
    const facts = await collect('controlled-production', BUSINESS, io, { now: NOW });
    const result = evaluate(facts);
    assert.equal(result.verdict, 'NOT_READY');
    assert.deepEqual(result.gates.filter((gate) => gate.status === 'PASS'), []);
    assert.equal(result.blockers.length, GATES.filter((gate) => gate.blocking).length);
  }
});

test('el driver puede entregar `data` como texto, y una función sin estado conocido no pasa', async () => {
  const io = fakeIo({
    async listFunctions() { return FUNCTIONS.map(([slug]) => ({ slug })); },
  });
  const original = io.runReadOnlySql;
  io.runReadOnlySql = async (sql) => (await original.call(io, sql)).map((row) => ({ data: JSON.stringify(row.data) }));
  const facts = await collect('controlled-production', BUSINESS, io, { now: NOW });
  assert.equal(facts.business.slug, 'la-taba-cp');
  assert.equal(facts.catalog.public, 12);
  const result = evaluate(facts);
  assert.deepEqual(blockerIds(result), ['EDGE_FUNCTIONS']);
  assert.ok(result.blockers[0].missing.includes('NOT_ACTIVE:catalog-image-manager:unknown'));
});

test('la evidencia de una certificación tiene que ser una ruta del repo que exista', async () => {
  const io = fakeIo();
  io.files[PAYMENT_CERTIFICATION_PATH] = JSON.stringify({
    opening_decision: readyFacts().paymentCertification.opening_decision,
    entries: [
      { method: 'manual', environment: 'staging', certified: true, evidence: '../fuera-del-repo', date: '2026-10-01' },
      { method: 'mercadopago', environment: 'production', certified: true, evidence: 'artifacts/no-existe', date: '2026-10-01' },
    ],
  });
  const facts = await collect('controlled-production', BUSINESS, io, { now: NOW });
  assert.deepEqual(facts.paymentCertification.entries.map((entry) => entry.evidence_exists), [false, false]);
  assert.deepEqual(evaluate(facts).blockers, [{
    gate: 'PAYMENT_CERTIFICATION', status: 'FAIL',
    missing: ['EVIDENCE_PATH_INVALID:../fuera-del-repo', 'EVIDENCE_NOT_IN_REPO:artifacts/no-existe'],
  }, {
    // Con el dinero real posible, Mercado Pago sin evidencia de producción también lo frena la compuerta del dinero real.
    gate: 'REAL_MONEY_GATE', status: 'FAIL', missing: ['EVIDENCE_NOT_IN_REPO:artifacts/no-existe'],
  }]);
  for (const bad of ['', '/etc/passwd', '../x', 'a/../b', 'a//b', 'a\\b', 'a b', 'x'.repeat(301)]) assert.equal(isRepoRelativePath(bad), false, bad);
  assert.equal(isRepoRelativePath('artifacts/taba-e2e-cert-20261001-022224/final-report.md'), true);
});

test('config.toml y nombres de migración se leen como los escribe el repo', () => {
  assert.deepEqual(parseFunctionsVerifyJwt('[functions.a]\nverify_jwt = false\n\n# [functions.b]\n[functions."c-d"]\n  verify_jwt   =  true # x\n[api]\nverify_jwt = false\n'),
    { a: false, 'c-d': true });
  assert.deepEqual(parseFunctionsVerifyJwt(null), {});
  const parsed = parseRepoMigrations([
    { name: '20261001180000_order_intake_guard.sql', isDirectory: false }, { name: '20260531030000_a.sql', isDirectory: false },
    { name: 'notas.sql', isDirectory: false }, { name: 'README.md', isDirectory: false }, { name: 'rollback', isDirectory: true },
  ]);
  assert.deepEqual(parsed.files.map((file) => file.version), ['20260531030000', '20261001180000']);
  assert.deepEqual(parsed.unrecognized, ['notas.sql']);
  const stray = evaluate(mutated((facts) => { facts.repoMigrations.unrecognized = ['notas.sql']; }));
  assert.deepEqual(stray.blockers[0].missing, ['REPO_FILE_NOT_A_MIGRATION:notas.sql']);
});

// ── Regresiones de la revisión: un dato ausente o mal formado nunca aprueba ──

const NOT_BOOLEANS = [null, undefined, 'true', 'false', 1, 0];
const setFlag = (facts, name, value) => { if (value === undefined) delete facts.business[name]; else facts.business[name] = value; };

test('una bandera del comercio que no es un booleano no se lee como «apagado»', async () => {
  for (const value of NOT_BOOLEANS) {
    // Antes: `delivery_enabled: null` + zonas ilegibles = «sólo retiro» y PRODUCTION_READY.
    const delivery = evaluate(mutated((facts) => { setFlag(facts, 'delivery_enabled', value); facts.deliveryZones = { ok: false, error: 'MGMT_HTTP_500' }; }));
    assert.equal(delivery.verdict, 'NOT_READY', String(value));
    assert.deepEqual(delivery.blockers, ['SERVICE_HOURS', 'DELIVERY_ZONES', 'FULFILMENT', 'TEAM']
      .map((gate) => ({ gate, status: 'UNKNOWN', missing: ['BUSINESS_FACTS_INCOMPLETE:delivery_enabled'] })), String(value));

    // Antes: `pickup_enabled: null` sin horario de retiro = no se pedía horario de retiro.
    const pickup = evaluate(mutated((facts) => { setFlag(facts, 'pickup_enabled', value); facts.serviceHours.pickup = 0; }));
    assert.equal(pickup.verdict, 'NOT_READY', String(value));
    assert.deepEqual(pickup.blockers, ['SERVICE_HOURS', 'DELIVERY_ZONES', 'FULFILMENT']
      .map((gate) => ({ gate, status: 'UNKNOWN', missing: ['BUSINESS_FACTS_INCOMPLETE:pickup_enabled'] })), String(value));

    for (const [flag, gate] of [['hours_enforced', 'SERVICE_HOURS'], ['delivery_zone_enforced', 'DELIVERY_ZONES'],
      ['rider_presence_required', 'TEAM'], ['address_ok', 'FULFILMENT']]) {
      const result = evaluate(mutated((facts) => { setFlag(facts, flag, value); }));
      assert.deepEqual(result.blockers, [{ gate, status: 'UNKNOWN', missing: [`BUSINESS_FACTS_INCOMPLETE:${flag}`] }], `${flag}=${value}`);
    }
  }
  // Sin repartidores y sin saber si el comercio trabaja con ellos: no se supone que se entrega solo.
  const riders = evaluate(mutated((facts) => { facts.business.rider_presence_required = null; facts.team.riders = 0; }));
  assert.deepEqual(blockerIds(riders), ['TEAM']);

  // El mismo caso por collect(): `SQL.business` devuelve null para una columna
  // que el destino no tiene, y la consulta de zonas falla.
  const io = fakeIo();
  const { ok: _ok, ...business } = readyFacts().business;
  io.answers.set(assertSelectOnly(SQL.business(BUSINESS)), { ...business, delivery_enabled: null });
  io.answers.delete(assertSelectOnly(SQL.deliveryZones(BUSINESS)));
  const facts = await collect('controlled-production', BUSINESS, io, { now: NOW });
  assert.equal(facts.business.ok, true);
  assert.equal(facts.business.delivery_enabled, null);
  assert.equal(facts.deliveryZones.ok, false);
  const collected = evaluate(facts, LIVE);
  assert.equal(collected.verdict, 'NOT_READY');
  assert.deepEqual(blockerIds(collected), ['SERVICE_HOURS', 'DELIVERY_ZONES', 'FULFILMENT', 'TEAM']);
  assert.ok(collected.blockers.every((blocker) => blocker.status === 'UNKNOWN'));
});

test('Mercado Pago: una sección sin ajustes ni conexiones legibles no dice «no está encendido»', () => {
  const malformed = [
    [{ ok: true }, ['settings', 'connections']],
    [{ ok: true, connections: [] }, ['settings']],
    [{ ok: true, settings: { enabled: null }, connections: [] }, ['settings']],
    [{ ok: true, settings: { enabled: 'false' }, connections: [] }, ['settings']],
    [{ ok: true, settings: {}, connections: [] }, ['settings']],
    [{ ok: true, settings: 'none', connections: [] }, ['settings']],
    [{ ok: true, settings: null }, ['connections']],
    [{ ok: true, settings: null, connections: 'x' }, ['connections']],
    [{ ok: true, settings: null, connections: [null] }, ['connections']],
    [{ ok: true, settings: null, connections: [{ environment: 'production' }] }, ['connections']],
  ];
  for (const [section, fields] of malformed) {
    const label = JSON.stringify(section);
    const codes = fields.map((field) => `MERCADOPAGO_FACTS_MALFORMED:${field}`);

    // Antes: con un registro válido de «sólo efectivo» esto era MANUAL_ONLY y PASS, sin haber leído nada.
    const manual = manualOnlyFacts();
    manual.mercadoPago = section;
    assert.equal(paymentPlan(manual).mode, 'unknown', label);
    const result = evaluate(manual);
    assert.equal(result.verdict, 'NOT_READY', label);
    assert.deepEqual(result.blockers, [
      { gate: 'MP_SELLER', status: 'UNKNOWN', missing: codes },
      { gate: 'PAYMENT_CERTIFICATION', status: 'UNKNOWN', missing: ['PAYMENT_METHODS_UNDETERMINED'] },
    ], label);

    // Con un registro que dice «se cobra con Mercado Pago» tampoco se revisa a ciegas.
    const online = evaluate(mutated((facts) => { facts.mercadoPago = section; }));
    assert.deepEqual(online.blockers, [{ gate: 'MP_SELLER', status: 'UNKNOWN', missing: codes }], label);

    // Y sin registro, una sección ilegible no es «sin decidir»: es no saber.
    const undecided = mutated((facts) => { facts.mercadoPago = section; facts.paymentCertification.opening_decision = null; });
    assert.equal(paymentPlan(undecided).mode, 'unknown', label);
    assert.deepEqual(gateOf(evaluate(undecided), 'MP_SELLER').missing, codes, label);
  }
  // La forma correcta de «no configurado» sigue valiendo: ajustes en null (leídos) y lista vacía.
  assert.equal(paymentPlan(manualOnlyFacts()).mode, 'manual_only');
  assert.deepEqual(paymentPlan(manualOnlyFacts()).mercadopago_malformed, []);
  const disabled = manualOnlyFacts();
  disabled.mercadoPago = { ok: true, settings: { enabled: false, environment: 'production', production_review_status: 'not_requested' }, connections: [] };
  assert.equal(evaluate(disabled).verdict, 'PRODUCTION_READY');
});

test('migraciones y funciones: una fila sin versión o sin nombre no da paridad', () => {
  const both = ['MIGRATION_FACTS_MALFORMED:repo', 'MIGRATION_FACTS_MALFORMED:ledger'];
  const cases = [
    [[{}], [{}], both],
    [[null], [null], both],
    [[{ version: 20261001180000, name: 'order_intake_guard' }], [{ version: 20261001180000, name: 'order_intake_guard' }], both],
    [[{ version: '  ', name: 'x' }], [{ version: '', name: 'x' }], both],
    [[...MIGRATIONS, { version: '20261002000000' }], [...MIGRATIONS], ['MIGRATION_FACTS_MALFORMED:repo']],
    [[...MIGRATIONS], [...MIGRATIONS, { name: 'sin_version' }], ['MIGRATION_FACTS_MALFORMED:ledger']],
  ];
  for (const [files, versions, missing] of cases) {
    const result = evaluate(mutated((facts) => { facts.repoMigrations.files = files; facts.migrationLedger.versions = versions; }));
    assert.equal(result.verdict, 'NOT_READY');
    assert.deepEqual(result.blockers, [{ gate: 'MIGRATION_PARITY', status: 'UNKNOWN', missing }], JSON.stringify(files));
  }
  // Sin la lista de .sql sueltos no se sabe si hay alguno que el CLI de Supabase saltearía.
  for (const value of [undefined, null, 'none', {}]) {
    const result = evaluate(mutated((facts) => { if (value === undefined) delete facts.repoMigrations.unrecognized; else facts.repoMigrations.unrecognized = value; }));
    assert.deepEqual(result.blockers, [{ gate: 'MIGRATION_PARITY', status: 'UNKNOWN', missing: ['MIGRATION_FACTS_MALFORMED:unrecognized'] }], String(value));
  }
  // Un nombre vacío en el ledger (aplicada a mano) sigue siendo comparable por versión.
  const unnamed = evaluate(mutated((facts) => { facts.migrationLedger.versions[0].name = null; }));
  assert.equal(unnamed.verdict, 'PRODUCTION_READY');

  const functions = evaluate(mutated((facts) => { facts.repoFunctions.functions = [{}]; facts.deployedFunctions.functions = [{}]; }));
  assert.deepEqual(functions.blockers, [{
    gate: 'EDGE_FUNCTIONS', status: 'UNKNOWN', missing: ['EDGE_FUNCTION_FACTS_MALFORMED:repo', 'EDGE_FUNCTION_FACTS_MALFORMED:deployed'],
  }]);
  const nameless = evaluate(mutated((facts) => { facts.deployedFunctions.functions.push({ status: 'ACTIVE', verify_jwt: true }); }));
  assert.deepEqual(nameless.blockers, [{ gate: 'EDGE_FUNCTIONS', status: 'UNKNOWN', missing: ['EDGE_FUNCTION_FACTS_MALFORMED:deployed'] }]);
});

test('un mínimo de productos ilegible no se cambia por 1', async () => {
  for (const value of [1000, 501, 0, -1, 2.5, '20', Number.NaN, true]) {
    // Antes: pedir 1000 o '20' con 12 públicos pasaba, con `min_products: 1` en la evidencia.
    const result = evaluate(mutated((facts) => { facts.options.minProducts = value; }));
    assert.deepEqual(result.blockers, [{ gate: 'CATALOG_APPROVAL', status: 'UNKNOWN', missing: ['MIN_PRODUCTS_INVALID'] }], String(value));
    const io = fakeIo();
    await assert.rejects(collect('staging', BUSINESS, io, { minProducts: value }), /MIN_PRODUCTS_INVALID/, String(value));
    assert.equal(io.sqlSeen.length, 0, 'un pedido mal formado no llega a leer nada');
  }
  // Sin pedir nada vale 1; un mínimo válido se respeta tal cual.
  const unset = evaluate(mutated((facts) => { delete facts.options.minProducts; }));
  assert.equal(gateOf(unset, 'CATALOG_APPROVAL').evidence.min_products, 1);
  assert.equal(evaluate(mutated((facts) => { delete facts.options; })).verdict, 'PRODUCTION_READY');
  assert.equal(gateOf(evaluate(mutated((facts) => { facts.options.minProducts = 12; })), 'CATALOG_APPROVAL').evidence.min_products, 12);
  assert.deepEqual(blockerIds(evaluate(mutated((facts) => { facts.options.minProducts = 13; }))), ['CATALOG_APPROVAL']);
  assert.equal((await collect('staging', BUSINESS, fakeIo(), { minProducts: 500, now: NOW })).options.minProducts, 500);
});

test('hechos sin fecha de recolección o de otro formato no se evalúan', () => {
  assert.equal(FACTS_SCHEMA, 1);
  const unidentified = (change, code) => {
    for (const context of [undefined, LIVE]) {
      const result = evaluate(mutated(change), context);
      assert.equal(result.verdict, 'NOT_READY', code);
      assert.equal(result.collectedAt, null);
      assert.ok(result.gates.every((gate) => gate.status === 'UNKNOWN' && gate.missing[0] === code), code);
      // Con contexto, además, el bloqueo de procedencia lo dice primero.
      if (context) assert.deepEqual(result.blockers[0], { gate: PROVENANCE_GATE, status: 'UNKNOWN', missing: [code] });
      else assert.equal(result.blockers.length, GATES.filter((gate) => gate.blocking).length);
    }
  };
  for (const value of [undefined, null, '', 'ayer', '2026-10-01', '2026-10-01 12:00:00', '2026-13-45T00:00:00Z', 1790856000000, {}]) {
    unidentified((facts) => { if (value === undefined) delete facts.collectedAt; else facts.collectedAt = value; }, 'FACTS_NOT_IDENTIFIED:collectedAt');
  }
  for (const value of [undefined, null, 2, '1']) {
    unidentified((facts) => { if (value === undefined) delete facts.schema; else facts.schema = value; }, 'FACTS_NOT_IDENTIFIED:schema');
  }
  unidentified((facts) => { delete facts.collectedAt; delete facts.observer; delete facts.schema; }, 'FACTS_NOT_IDENTIFIED:collectedAt,schema');
  // Lo que pidió quien opera puede faltar (valen los valores por defecto), pero si está tiene que leerse.
  for (const options of [null, 'strict', [], { requireRider: 'true' }, { requireImages: 1 }, { functionsReference: 'production' }, { functionsReference: false }]) {
    unidentified((facts) => { facts.options = options; }, 'FACTS_NOT_IDENTIFIED:options');
  }
  assert.equal(evaluate(mutated((facts) => { facts.options = {}; }), LIVE).verdict, 'PRODUCTION_READY');
});

test('el estado de la tienda no bloquea, pero un comercio dado de baja o de QA en el real se avisa', () => {
  const closed = evaluate(mutated((facts) => { Object.assign(facts.business, { status: 'closed', ordering_enabled: false, ordering_verified: false }); }));
  assert.equal(closed.verdict, 'PRODUCTION_READY');
  assert.deepEqual(closed.warnings, []);
  const inactive = evaluate(mutated((facts) => { facts.business.is_active = false; }));
  assert.equal(inactive.verdict, 'PRODUCTION_READY');
  assert.deepEqual(inactive.warnings, [{ gate: 'STORE_STATE', status: 'FAIL', missing: ['BUSINESS_NOT_ACTIVE'] }]);
  const fixture = evaluate(mutated((facts) => { facts.business.qa_fixture = true; }));
  assert.deepEqual(fixture.warnings, [{ gate: 'STORE_STATE', status: 'FAIL', missing: ['QA_FIXTURE_ON_CONTROLLED_PRODUCTION'] }]);
  assert.match(renderTable(fixture, readyFacts()), /STORE_STATE\s+no\s+WARNING\s+QA_FIXTURE_ON_CONTROLLED_PRODUCTION/);
  // En Staging los comercios de QA son lo esperado.
  const staging = evaluate(mutated((facts) => {
    facts.target = 'staging';
    facts.business.qa_fixture = true;
    facts.mercadoPago.settings.environment = 'test';
    facts.mercadoPago.connections[0].environment = 'test';
    facts.paymentCertification.entries[1].environment = 'test';
    stagingRealMoney(facts);
  }));
  assert.deepEqual([staging.verdict, staging.warnings], ['PRODUCTION_READY', []]);
});

test('la procedencia: hechos recientes pasan; viejos, del futuro o con un contexto ilegible bloquean', () => {
  assert.equal(DEFAULT_MAX_FACTS_AGE_MINUTES, 30);
  const at = (now, extra = {}) => evaluate(readyFacts(), { source: 'live', now, ...extra });
  const provenanceBlock = (status, ...missing) => [{ gate: PROVENANCE_GATE, status, missing }];

  const fresh = at(EVALUATED_AT);
  assert.equal(fresh.verdict, 'PRODUCTION_READY');
  assert.deepEqual(fresh.provenance, {
    source: 'live', facts_file: null, collected_at: '2026-10-01T12:00:00.000Z', evaluated_at: EVALUATED_AT, age_minutes: 5,
    max_age_minutes: 30, freshness: 'FRESH', repo_sections: 'READ_WITH_THE_FACTS', repo_head_at_snapshot: null,
  });

  // Viejos: el límite es inclusivo y se puede cambiar, dentro de un rango.
  assert.equal(at('2026-10-01T12:30:00.000Z').verdict, 'PRODUCTION_READY');
  const stale = at('2026-10-01T12:31:00.000Z');
  assert.equal(stale.verdict, 'NOT_READY');
  assert.deepEqual(stale.blockers, provenanceBlock('FAIL', 'FACTS_STALE:age_minutes=31:max=30'));
  assert.equal(stale.provenance.freshness, 'STALE');
  assert.ok(stale.gates.every((gate) => gate.status === 'PASS'), 'las compuertas se informan igual: lo que bloquea es la procedencia');
  assert.equal(at('2026-10-01T13:00:00.000Z', { maxFactsAgeMinutes: 60 }).verdict, 'PRODUCTION_READY');
  assert.deepEqual(at('2026-10-01T13:00:00.000Z', { maxFactsAgeMinutes: 59 }).blockers, provenanceBlock('FAIL', 'FACTS_STALE:age_minutes=60:max=59'));
  assert.deepEqual(at('2027-10-01T12:00:00.000Z').blockers[0].gate, PROVENANCE_GATE);

  // Del futuro, con dos minutos de tolerancia entre relojes.
  const future = at('2026-10-01T11:00:00.000Z');
  assert.deepEqual(future.blockers, provenanceBlock('FAIL', 'FACTS_FROM_THE_FUTURE:collected=2026-10-01T12:00:00.000Z'));
  assert.equal(future.provenance.freshness, 'FUTURE');
  assert.equal(future.provenance.age_minutes, -60);
  assert.equal(at('2026-10-01T11:58:30.000Z').verdict, 'PRODUCTION_READY');
  assert.equal(at('2026-10-01T11:57:59.000Z').verdict, 'NOT_READY');

  // Un contexto que no se entiende no se ignora: bloquea.
  const invalid = [
    [null, ['context']], ['live', ['context']], [[], ['context']], [{}, ['source', 'now']],
    [{ source: 'file', now: EVALUATED_AT }, ['source']], [{ source: 'live' }, ['now']], [{ source: 'live', now: 'ahora' }, ['now']],
    [{ source: 'live', now: 1790856300000 }, ['now']],
    ...[0, -5, 1.5, '60', 1441, Number.POSITIVE_INFINITY].map((max) => [{ source: 'live', now: EVALUATED_AT, maxFactsAgeMinutes: max }, ['maxFactsAgeMinutes']]),
  ];
  for (const [context, fields] of invalid) {
    const result = evaluate(readyFacts(), context);
    assert.equal(result.verdict, 'NOT_READY', JSON.stringify(context));
    assert.deepEqual(result.blockers, provenanceBlock('UNKNOWN', ...fields.map((field) => `EVALUATION_CONTEXT_INVALID:${field}`)), JSON.stringify(context));
  }

  // Hechos guardados: sólo valen si lo del repo se releyó del árbol actual.
  const snapshot = evaluate(readyFacts(), { source: 'saved', now: EVALUATED_AT });
  assert.deepEqual(snapshot.blockers, provenanceBlock('FAIL', 'SAVED_REPO_SECTIONS_NOT_REREAD'));
  assert.equal(snapshot.provenance.repo_sections, 'FROM_SNAPSHOT');
  // La ruta se arma al correr: el repo no admite rutas de disco escritas en un archivo.
  const diskPath = ['C', ':\\Users\\alguien\\Desktop\\facts.json'].join('');
  const reread = evaluate(readyFacts(), { source: 'saved', now: EVALUATED_AT, repoSections: 'reread', factsFile: diskPath, snapshotRepoHead: HEAD.toUpperCase() });
  assert.equal(reread.verdict, 'PRODUCTION_READY');
  assert.deepEqual([reread.provenance.source, reread.provenance.repo_sections, reread.provenance.facts_file, reread.provenance.repo_head_at_snapshot],
    ['saved', 'REREAD_FROM_CURRENT_TREE', 'facts.json', HEAD]);

  // Sin contexto la antigüedad no se comprueba, y el resultado lo dice en vez de callarlo.
  const unchecked = evaluate(readyFacts());
  assert.deepEqual([unchecked.provenance.source, unchecked.provenance.freshness, unchecked.provenance.age_minutes], ['unspecified', 'NOT_CHECKED', null]);
  assert.match(renderTable(unchecked, readyFacts()), /^source: UNSPECIFIED \(facts age not checked\)$/m);
  assert.match(renderTable(fresh, readyFacts()), /^source: live read \(Management API, read-only\)$/m);
});

test('quién leyó el destino se comprueba y se avisa; no decide el veredicto', () => {
  assert.equal(READ_ONLY_OBSERVER, 'supabase_read_only_user');
  const privileged = mutated((facts) => { facts.observer = { ok: true, current_user: 'postgres', transaction_read_only: 'off' }; });
  const result = evaluate(privileged, LIVE);
  assert.equal(result.verdict, 'PRODUCTION_READY');
  assert.deepEqual(result.warnings, [{ gate: OBSERVER_GATE, status: 'FAIL', missing: ['OBSERVER_NOT_READ_ONLY:postgres:transaction_read_only=off'] }]);
  assert.match(renderTable(result, privileged), /WARNINGS \(1\)\n {2}OBSERVER \[FAIL\] OBSERVER_NOT_READ_ONLY:postgres:transaction_read_only=off/);
  assert.match(renderMarkdown(result, privileged), /- `OBSERVER` — OBSERVER_NOT_READ_ONLY:postgres:transaction_read_only=off/);
  const writable = evaluate(mutated((facts) => { facts.observer.transaction_read_only = 'off'; }));
  assert.deepEqual(writable.warnings[0].missing, ['OBSERVER_NOT_READ_ONLY:supabase_read_only_user:transaction_read_only=off']);
  const absent = evaluate(mutated((facts) => { delete facts.observer; }));
  assert.deepEqual(absent.warnings, [{ gate: OBSERVER_GATE, status: 'UNKNOWN', missing: ['OBSERVER_UNAVAILABLE:NOT_COLLECTED'] }]);
  const failed = evaluate(mutated((facts) => { facts.observer = { ok: false, error: 'MGMT_HTTP_500' }; }));
  assert.deepEqual(failed.warnings[0].missing, ['OBSERVER_UNAVAILABLE:MGMT_HTTP_500']);
  assert.deepEqual(evaluate(readyFacts()).warnings, []);
});

test('los hechos del comercio tienen que ser del comercio que se evalúa', () => {
  const businessGates = ['SERVICE_HOURS', 'DELIVERY_ZONES', 'FULFILMENT', 'TEAM', 'ABUSE_PROTECTION'];
  for (const id of ['00000000-0000-4000-8000-000000000001', '', null, undefined, 7]) {
    const result = evaluate(mutated((facts) => { if (id === undefined) delete facts.business.id; else facts.business.id = id; }));
    assert.equal(result.verdict, 'NOT_READY', String(id));
    assert.deepEqual(result.blockers, businessGates.map((gate) => ({ gate, status: 'UNKNOWN', missing: ['BUSINESS_FACTS_UNAVAILABLE:BUSINESS_ID_MISMATCH'] })), String(id));
  }
  assert.equal(evaluate(mutated((facts) => { facts.business.id = BUSINESS.toUpperCase(); })).verdict, 'PRODUCTION_READY');
});

test('CI verde no cubre lo que está sin commitear', async () => {
  assert.deepEqual(RELEASE_INPUT_PATHS, [FINDINGS_REGISTER_PATH, PAYMENT_CERTIFICATION_PATH, 'supabase/migrations', 'supabase/functions',
    'supabase/config.toml', 'scripts/release']);
  const lines = ['M docs/ecommerce-hardening/findings-register.json', '?? supabase/migrations/20261002090000_nueva.sql'];
  // Antes: editar el registro a mano sin commitear y declarar el CI del commit daba verde.
  const dirty = evaluate(mutated((facts) => { facts.repo.uncommitted_release_inputs = lines; }));
  assert.deepEqual(dirty.blockers, [{ gate: 'CI_GREEN', status: 'FAIL', missing: ['RELEASE_INPUTS_NOT_COMMITTED:2'] }]);
  assert.deepEqual(gateOf(dirty, 'CI_GREEN').evidence.uncommitted_release_inputs, lines);
  for (const value of [undefined, null, 'clean', 0]) {
    const unknownState = evaluate(mutated((facts) => { if (value === undefined) delete facts.repo.uncommitted_release_inputs; else facts.repo.uncommitted_release_inputs = value; }));
    assert.deepEqual(unknownState.blockers, [{ gate: 'CI_GREEN', status: 'UNKNOWN', missing: ['REPO_DIRTY_STATE_UNKNOWN'] }], String(value));
  }
  const both = evaluate(mutated((facts) => { facts.ci.conclusion = 'failure'; facts.repo.uncommitted_release_inputs = lines; }));
  assert.deepEqual(both.blockers[0].missing, ['CI_CONCLUSION:failure', 'RELEASE_INPUTS_NOT_COMMITTED:2']);

  // collect() pregunta por las entradas del veredicto y guarda lo que git diga.
  const clean = fakeIo();
  const facts = await collect('controlled-production', BUSINESS, clean, { now: NOW });
  assert.deepEqual(clean.uncommittedAsked, [[...RELEASE_INPUT_PATHS]]);
  assert.deepEqual(facts.repo, { ok: true, head: HEAD, uncommitted_release_inputs: [] });
  const modified = await collect('controlled-production', BUSINESS, fakeIo({ async repoUncommitted() { return [' M supabase/config.toml']; } }), { now: NOW });
  assert.deepEqual(modified.repo.uncommitted_release_inputs, ['M supabase/config.toml']);
  assert.deepEqual(blockerIds(evaluate(modified, LIVE)), ['CI_GREEN']);
  // Si nadie puede decir cómo está el árbol, no se supone limpio.
  const blind = fakeIo();
  delete blind.repoUncommitted;
  const failing = fakeIo({ async repoUncommitted() { throw Error('REPO_STATUS_UNREADABLE'); } });
  for (const io of [blind, failing]) {
    const unknownFacts = await collect('controlled-production', BUSINESS, io, { now: NOW });
    assert.equal(unknownFacts.repo.uncommitted_release_inputs, null);
    assert.deepEqual(evaluate(unknownFacts, LIVE).blockers, [{ gate: 'CI_GREEN', status: 'UNKNOWN', missing: ['REPO_DIRTY_STATE_UNKNOWN'] }]);
  }

  // El io real: dos lecturas de git, sobre rutas del repo y nada más.
  const real = createRepoIo(ROOT);
  const status = await real.repoUncommitted([...RELEASE_INPUT_PATHS]);
  assert.ok(Array.isArray(status) && status.every((line) => typeof line === 'string' && line.length > 3));
  assert.equal(await real.repoTracked('package.json'), true);
  assert.equal(await real.repoTracked('artifacts/esta-ruta-no-existe'), false);
  await assert.rejects(real.repoTracked('../fuera'), /REPO_PATH_INVALID/);
  await assert.rejects(real.repoUncommitted(['docs', '../fuera']), /REPO_PATH_INVALID/);
});

test('evidencia de certificación: bajo artifacts/ o docs/, versionada y con una fecha que existe', async () => {
  for (const bad of ['.', 'docs', 'docs/', 'artifacts', 'package.json', '.git', 'node_modules', 'docs/.oculto/x', 'artifacts/../package.json',
    'scripts/release', PAYMENT_CERTIFICATION_PATH, '/artifacts/x', '', null, undefined]) assert.equal(isEvidencePath(bad), false, String(bad));
  for (const good of ['artifacts/taba-e2e-cert-20261001-022224', 'artifacts/cert/final-report.md', 'docs/evidence/pago.md']) assert.equal(isEvidencePath(good), true, good);
  const decision = readyFacts().paymentCertification.opening_decision;
  const certifiedBy = (manualEvidence, onlineEvidence) => JSON.stringify({
    opening_decision: decision,
    entries: [
      { method: 'manual', environment: 'staging', certified: true, evidence: manualEvidence, date: '2026-10-01' },
      { method: 'mercadopago', environment: 'production', certified: true, evidence: onlineEvidence, date: '2026-10-01' },
    ],
  });

  // Con el dinero real posible, la certificación de Mercado Pago para producción la exigen las dos compuertas.
  const realMoneyToo = (...missing) => ({ gate: 'REAL_MONEY_GATE', status: 'FAIL', missing });
  // Antes: «.», «docs» o «package.json» contaban como evidencia porque existen en cualquier checkout.
  const anywhere = fakeIo();
  Object.assign(anywhere.dirs, { '.': [{ name: 'package.json', isDirectory: false }], docs: [{ name: 'README.md', isDirectory: false }] });
  anywhere.files['package.json'] = '{}';
  for (const [manualEvidence, onlineEvidence] of [['.', 'package.json'], ['docs', '.'], [PAYMENT_CERTIFICATION_PATH, 'docs']]) {
    anywhere.files[PAYMENT_CERTIFICATION_PATH] = certifiedBy(manualEvidence, onlineEvidence);
    const facts = await collect('controlled-production', BUSINESS, anywhere, { now: NOW });
    assert.deepEqual(facts.paymentCertification.entries.map((entry) => [entry.evidence_exists, entry.evidence_tracked]), [[false, false], [false, false]]);
    // Fuera de artifacts/ y docs/ la ruta ni siquiera es evidencia; adentro, tiene que existir.
    const refusal = (evidence) => `${/^(artifacts|docs)\//.test(evidence) ? 'EVIDENCE_NOT_IN_REPO' : 'EVIDENCE_PATH_INVALID'}:${evidence}`;
    assert.deepEqual(evaluate(facts, LIVE).blockers, [{
      gate: 'PAYMENT_CERTIFICATION', status: 'FAIL', missing: [refusal(manualEvidence), refusal(onlineEvidence)],
    }, realMoneyToo(refusal(onlineEvidence))]);
  }
  // Y aunque unos hechos armados a mano digan que existe y está versionada: la ruta manda.
  for (const evidence of ['.', 'package.json', 'docs', 'docs/.oculto/x', 'artifacts/../package.json', 'node_modules/pg']) {
    const forged = evaluate(mutated((facts) => { facts.paymentCertification.entries[1].evidence = evidence; }));
    assert.deepEqual(forged.blockers, [{ gate: 'PAYMENT_CERTIFICATION', status: 'FAIL', missing: [`EVIDENCE_PATH_INVALID:${evidence}`] },
      realMoneyToo(`EVIDENCE_PATH_INVALID:${evidence}`)], evidence);
  }

  // Existe en el disco de quien corre la herramienta, pero git no la versiona (una carpeta ignorada).
  const ignored = fakeIo();
  ignored.untracked.add('artifacts/cert-mp');
  const untracked = await collect('controlled-production', BUSINESS, ignored, { now: NOW });
  assert.deepEqual(untracked.paymentCertification.entries.map((entry) => [entry.evidence_exists, entry.evidence_tracked]), [[true, true], [true, false]]);
  assert.deepEqual(evaluate(untracked, LIVE).blockers, [{ gate: 'PAYMENT_CERTIFICATION', status: 'FAIL', missing: ['EVIDENCE_NOT_TRACKED:artifacts/cert-mp'] },
    realMoneyToo('EVIDENCE_NOT_TRACKED:artifacts/cert-mp')]);
  // Y si nadie puede decir si está versionada, tampoco cuenta.
  const blind = fakeIo();
  delete blind.repoTracked;
  const unknownTracking = await collect('controlled-production', BUSINESS, blind, { now: NOW });
  assert.deepEqual(unknownTracking.paymentCertification.entries.map((entry) => entry.evidence_tracked), [null, null]);
  assert.deepEqual(evaluate(unknownTracking, LIVE).blockers, [{
    gate: 'PAYMENT_CERTIFICATION', status: 'FAIL',
    missing: ['EVIDENCE_TRACKING_UNKNOWN:artifacts/cert-manual', 'EVIDENCE_TRACKING_UNKNOWN:artifacts/cert-mp'],
  }, realMoneyToo('EVIDENCE_TRACKING_UNKNOWN:artifacts/cert-mp')]);

  // Una decisión con una fecha que no sirve no es una decisión: tampoco para el dinero real.
  const invalidDecision = [{ gate: 'MP_SELLER', status: 'FAIL', missing: ['PAYMENT_DECISION_INVALID'] }, realMoneyToo('PAYMENT_DECISION_INVALID')];
  // Antes: la fecha sólo pasaba por una expresión regular.
  for (const date of ['2099-99-99', '0000-00-00', '2026-02-30', '2026-13-01', '01/10/2026', '', null, 20261001]) {
    const result = evaluate(mutated((facts) => { facts.paymentCertification.entries[0].date = date; }));
    assert.deepEqual(result.blockers, [{ gate: 'PAYMENT_CERTIFICATION', status: 'FAIL', missing: ['CERTIFICATION_DATE_INVALID:manual'] }], String(date));
    const manual = manualOnlyFacts();
    manual.paymentCertification.opening_decision.date = date;
    assert.deepEqual(evaluate(manual).blockers, invalidDecision, String(date));
  }
  assert.equal(evaluate(mutated((facts) => { facts.paymentCertification.entries[0].date = '2026-09-30T18:30:00-03:00'; })).verdict, 'PRODUCTION_READY');
  // Con reloj, una firma fechada pasado mañana no es una firma (un día de margen por los husos horarios).
  const postdated = mutated((facts) => { facts.paymentCertification.entries[0].date = '2026-10-03'; });
  assert.deepEqual(evaluate(postdated, LIVE).blockers, [{ gate: 'PAYMENT_CERTIFICATION', status: 'FAIL', missing: ['CERTIFICATION_DATE_IN_THE_FUTURE:manual'] }]);
  assert.equal(evaluate(mutated((facts) => { facts.paymentCertification.entries[0].date = '2026-10-02'; }), LIVE).verdict, 'PRODUCTION_READY');
  const postdatedDecision = manualOnlyFacts();
  postdatedDecision.paymentCertification.opening_decision.date = '2027-01-01';
  assert.deepEqual(evaluate(postdatedDecision, LIVE).blockers, invalidDecision);
});

test('verify_jwt: una función que config.toml no declara se informa con su propio código', () => {
  const undeclared = (actual) => mutated((facts) => {
    facts.repoFunctions.functions.find((fn) => fn.slug === 'fiscal-artifact-access').declared_in_config = false;
    facts.deployedFunctions.functions.find((fn) => fn.slug === 'fiscal-artifact-access').verify_jwt = actual;
  });
  assert.deepEqual(evaluate(undeclared(false)).blockers, [{
    gate: 'EDGE_FUNCTIONS', status: 'FAIL',
    missing: ['VERIFY_JWT_NOT_DECLARED_IN_CONFIG:fiscal-artifact-access:platform_default=true:actual=false'],
  }]);
  // Sin declarar, pero desplegada con el default de la plataforma: no hay diferencia que informar.
  assert.equal(evaluate(undeclared(true)).verdict, 'PRODUCTION_READY');
});

test('el guardián se busca como llamada, no como palabra suelta', () => {
  const sql = SQL.abuse();
  const patterns = [...sql.matchAll(/f\.prosrc ~ '([^']+)'/g)].map((match) => match[1]);
  assert.equal(patterns.length, 2, 'las dos puertas');
  assert.equal(new Set(patterns).size, 1);
  assert.doesNotMatch(sql, /position\('order_intake_guard'/);
  // El patrón es una expresión regular de PostgreSQL que JavaScript lee igual.
  const call = new RegExp(patterns[0]);
  assert.equal(call.test('v_block := private.order_intake_guard(v_business, v_user_id);'), true);
  assert.equal(call.test('perform private.order_intake_guard (v_business);'), true);
  // Antes alcanzaba con leer la columna del modo, o con un comentario que nombrara al guardián.
  assert.equal(call.test("if v_business.order_intake_guard_mode = 'enforce' then return; end if;"), false);
  assert.equal(call.test('-- order_intake_guard: pendiente de cablear'), false);
  assert.equal(call.test('perform public.order_intake_guard(v_business);'), false);
  assert.equal(call.test('perform privateXorder_intake_guard(v_business);'), false);
  // La migración del guardián lo llama así desde las dos puertas (más su propia definición).
  const migration = read('supabase/migrations/20261001180000_order_intake_guard.sql');
  assert.ok((migration.match(new RegExp(patterns[0], 'g')) || []).length >= 3);
});

// ── La herramienta no puede escribir en un destino ───────────────────────────

const ALL_SQL = [
  SQL.observer(), SQL.business(BUSINESS), SQL.serviceHours(BUSINESS), SQL.deliveryZones(BUSINESS), SQL.catalog(BUSINESS),
  SQL.team(BUSINESS), SQL.mercadoPago(BUSINESS), SQL.migrationLedger(), SQL.abuse(), SQL.readiness(BUSINESS, 5),
  SQL.realMoneyBusinesses(),
];

test('toda consulta de la herramienta es UNA sentencia de lectura', () => {
  assert.equal(ALL_SQL.length, Object.keys(SQL).length, 'cada constructor de SQL está bajo prueba');
  for (const sql of ALL_SQL) {
    assert.equal(assertSelectOnly(sql), sql.trim());
    assert.match(sql.trim(), /^(select|with)\b/);
    assert.match(sql, /\bas data\b/, 'una fila, una columna');
  }
  assert.match(SQL.readiness(BUSINESS, 5), /, 5\) as data$/);
  assert.match(SQL.readiness(BUSINESS, '5); drop table x; --'), /, 1\) as data$/, 'el mínimo sólo entra si es un entero');
});

test('assertSelectOnly rechaza cualquier cosa que no sea leer', () => {
  const refused = [
    'update public.businesses set status = \'open\'',
    'insert into public.products (name) values (\'x\')',
    'delete from public.orders',
    'select 1; drop table public.orders',
    'with gone as (delete from public.orders returning id) select count(*) from gone',
    'with x as (select 1) insert into public.products select * from x',
    'select * into public.copia from public.products',
    'select id from public.products for update',
    'select id from public.products for share',
    'select set_config(\'request.jwt.claims\', \'{}\', false)',
    'select nextval(\'public.order_code_seq\')',
    'select pg_advisory_lock(1)',
    'select pg_sleep(60)',
    'select pg_terminate_backend(1)',
    'select 1 -- comentario',
    'select 1 /* comentario */',
    'truncate public.orders',
    'call public.algo()',
    'do $$ begin end $$',
    'create table x (id int)',
    'grant all on public.orders to anon',
    'explain analyze select 1',
    '',
    null,
  ];
  for (const sql of refused) assert.throws(() => assertSelectOnly(sql), /SQL_NOT_READ_ONLY/, String(sql));
  // Un verbo adentro de un literal no es un verbo…
  assert.equal(assertSelectOnly("select 'update' as data"), "select 'update' as data");
  assert.equal(assertSelectOnly("  with a as (select 'it''s a delete' as v) select v as data from a  "), "with a as (select 'it''s a delete' as v) select v as data from a");
  // …pero un punto y coma no se admite ni adentro de un literal: una sentencia, sin discusión.
  assert.throws(() => assertSelectOnly("select 'a; b' as data"), /single statement only/);
});

test('assertSelectOnly sólo deja llamar a una lista cerrada de funciones', () => {
  // Lo que la revisión mostró que pasaba: un SELECT que ejecuta texto, una función
  // del proyecto que escribe, cadenas con otro delimitador y funciones con efecto.
  const refused = [
    ["select query_to_xml('delete from public.orders', true, true, '')", /call not allowed:query_to_xml/],
    ["select public.create_order_with_items('{}'::jsonb)", /call not allowed:public\.create_order_with_items/],
    ["select create_order_with_items('{}'::jsonb)", /call not allowed:create_order_with_items/],
    ['select private.order_intake_guard(null, null, null, null, null, null)', /call not allowed:private\.order_intake_guard/],
    ['select txid_current()', /call not allowed:txid_current/],
    ['select pg_current_xact_id()', /call not allowed:pg_current_xact_id/],
    ['select version()', /call not allowed:version/],
    ['select $$x$$ as data', /dollar quoting/],
    ["select $tag$it's$tag$ as data", /dollar quoting/],
    ["select E'a\\'b' as data", /prefixed string literals/],
    ['select "query_to_xml"(1)', /quoted identifiers/],
  ];
  for (const [sql, reason] of refused) {
    assert.throws(() => assertSelectOnly(sql), (error) => /^SQL_NOT_READ_ONLY:/.test(error.message) && reason.test(error.message), sql);
  }
  // Nombrar una función adentro de un literal no es llamarla: así busca el guardián la consulta de abuso.
  assert.equal(assertSelectOnly("select position('private.order_intake_guard(' in 'x') as data"), "select position('private.order_intake_guard(' in 'x') as data");
  // La única función del proyecto que se llama es la de preparación de apertura, que sólo lee.
  const projectCalls = ALL_SQL.flatMap((sql) => [...sql.replace(/'(?:[^']|'')*'/g, "''").matchAll(/\b((?:public|private)\.\w+)\s*\(/g)].map((match) => match[1]));
  assert.deepEqual(projectCalls, ['public.get_store_opening_readiness']);
});

test('collectRepoFacts lee del repo las cinco secciones que no salen del destino', async () => {
  const io = fakeIo();
  const repoFacts = await collectRepoFacts(io);
  assert.deepEqual(Object.keys(repoFacts), ['repoMigrations', 'repoFunctions', 'paymentCertification', 'findingsRegister', 'repo']);
  assert.ok(Object.values(repoFacts).every((section) => section.ok === true));
  assert.equal(io.sqlSeen.length, 0, 'releer el repo no toca el destino');
  const full = await collect('controlled-production', BUSINESS, fakeIo(), { now: NOW });
  for (const [name, section] of Object.entries(repoFacts)) assert.deepEqual(full[name], section, name);
  // Sin io, o con uno que no sabe leer, cada sección queda desconocida y nada lanza.
  for (const broken of [undefined, null, {}]) {
    assert.ok(Object.values(await collectRepoFacts(broken)).every((section) => section.ok === false));
  }
});

test('ninguna consulta devuelve credenciales, identificadores de cuenta ni datos de contacto', () => {
  const all = ALL_SQL.join('\n');
  const tokens = [...all.matchAll(/protected_tokens(.{0,13})/g)].map((match) => match[1]);
  assert.deepEqual(tokens, [' is not null,'], 'la credencial sólo se mira como «está o no está»');
  assert.equal((all.match(/\b(seller_id|collector_id)\b/g) || []).length, 2);
  assert.match(all, /s\.collector_id = c\.seller_id and s\.application_id = c\.application_id/, 'vendedor y aplicación sólo se comparan');
  for (const forbidden of ['access_token', 'refresh_token', 'email', 'phone', 'whatsapp', 'user_id,', 'payer', 'auth.users']) {
    assert.equal(all.includes(forbidden), false, forbidden);
  }
});

test('el cableado real sólo sabe hacer tres llamadas de lectura', () => {
  const code = codeOf('scripts/release/gates/live-io.mjs');
  assert.equal((code.match(/fetchImpl\(/g) || []).length, 3);
  assert.deepEqual([...code.matchAll(/method:\s*'([A-Z]+)'/g)].map((match) => match[1]), ['GET', 'GET', 'POST']);
  assert.deepEqual([...code.matchAll(/\/v1\/projects\/\$\{ref\}([^`]*)`/g)].map((match) => match[1]),
    ['/functions', '/secrets', '/database/query/read-only']);
  assert.match(code, /const query = assertSelectOnly\(sql\);/, 'el SQL vuelve a pasar por el cerrojo antes de salir');
  assert.match(code, /body: JSON\.stringify\(\{ query \}\)/);
  // Los secretos: un GET sin cuerpo, del que quedan nombre y huella, y cuyo cuerpo no se repite en ningún error.
  const secrets = code.slice(code.indexOf('const listSecrets'), code.indexOf('const runReadOnlySql'));
  assert.match(secrets, /method: 'GET'/);
  assert.doesNotMatch(secrets, /\bbody:|safe\(|\$\{body\}|reveal/);
  assert.match(secrets, /throw Error\(`MGMT_HTTP_\$\{response\.status\}:secrets`\)/);
  assert.match(secrets, /name: typeof secret\?\.name === 'string' \? secret\.name : null,\s*digest: typeof secret\?\.value === 'string' \? secret\.value : null/);
  for (const forbidden of [/\bPUT\b/, /\bPATCH\b/, /\bDELETE\b/, /supabase-js/, /createClient/, /\.rpc\(/, /\.from\(/, /service_role/,
    /\/secrets\//, /reveal=/, /\/config\b/, /\/deploy/, /\/database\/query`/, /writeFile/, /child_process/, /console\./, /guardarSecreto|borrarSecreto/]) {
    assert.doesNotMatch(code, forbidden, String(forbidden));
  }
  assert.deepEqual([...code.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]), [
    '../../e2e-production-sale/secretos-windows.mjs', '../../lib/supabase-cli-token.mjs',
    '../../controlled-production/target-keys.mjs', './collect.mjs',
  ]);
});

test('evaluación y recolección no importan nada; el CLI sólo carga la red cuando recolecta', () => {
  for (const file of ['scripts/release/gates/evaluate.mjs', 'scripts/release/gates/collect.mjs']) {
    const code = codeOf(file);
    assert.doesNotMatch(code, /^\s*import\b|\bimport\(|\brequire\(/m, file);
    assert.doesNotMatch(code, /\bfetch\(|node:fs|node:child_process|process\.env|Date\.now\(/, file);
  }
  const cli = codeOf('scripts/release/ecommerce-release-gates.mjs');
  assert.deepEqual([...cli.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]),
    ['node:child_process', 'node:fs', 'node:path', 'node:url', './gates/collect.mjs', './gates/evaluate.mjs']);
  assert.deepEqual([...cli.matchAll(/import\('([^']+)'\)/g)].map((match) => match[1]), ['./gates/live-io.mjs']);
  assert.deepEqual([...cli.matchAll(/execFileSync\(([^\]]*\])/g)].map((match) => match[1]), [
    "'git', ['rev-parse', 'HEAD']",
    "'git', ['--no-optional-locks', 'status', '--porcelain', '--', ...paths]",
    "'git', ['ls-files', '--', String(relativePath)]",
    "'git', ['log', '-1', '--format=%ct', '--', ...paths]",
  ], 'los únicos procesos hijos son cuatro lecturas de git: el commit, qué está sin commitear, qué está versionado y cuándo se commiteó');
  assert.equal((cli.match(/writeFileSync\(/g) || []).length, 1, 'una sola escritura, y es local');
  assert.doesNotMatch(cli, /\bfetch\(|createClient|supabase-js|\.rpc\(/);
  assert.doesNotMatch(read('tests/ecommerce-release-gates.test.mjs'), /from '\.\.\/scripts\/release\/gates\/live-io\.mjs'/);
});

// ── CLI ──────────────────────────────────────────────────────────────────────

test('argumentos: lo mínimo, los opcionales y cada forma de pedirlo mal', () => {
  assert.deepEqual(parseArgs(['--target', 'controlled-production', '--business-id', BUSINESS.toUpperCase()]), {
    help: false, target: 'controlled-production', businessId: BUSINESS, minProducts: null, facts: null, maxFactsAgeMinutes: null,
    saveFacts: null, out: null, markdown: null, ciConclusion: null, ciCommit: null, functionsReference: null, requireRider: false,
    requireImages: false, json: false,
  });
  assert.equal(parseArgs(['--facts', 'f.json', '--max-facts-age-minutes', '90']).maxFactsAgeMinutes, 90);
  const full = parseArgs(['--target', 'staging', '--business-id', BUSINESS, '--min-products', '20', '--out', 'r.json', '--markdown', 'r.md',
    '--save-facts', 'f.json', '--ci-conclusion', 'success', '--ci-commit', HEAD, '--functions-reference', 'controlled-production',
    '--require-rider', '--require-images', '--json']);
  assert.equal(full.minProducts, 20);
  assert.equal(full.functionsReference, 'controlled-production');
  assert.equal(full.requireRider && full.requireImages && full.json, true);
  assert.equal(parseArgs(['--facts', 'f.json']).facts, 'f.json');
  const wrong = [
    [[], /--target y --business-id/],
    [['--target', 'staging'], /--target y --business-id/],
    [['--target', 'production', '--business-id', BUSINESS], /--target va con/],
    [['--target', 'staging', '--business-id', 'la-taba-cp'], /UUID/],
    [['--target', 'staging', '--business-id'], /necesita un valor/],
    [['--target', '--business-id', BUSINESS], /necesita un valor/],
    [['--target', 'staging', '--business-id', BUSINESS, '--min-products', '0'], /1 a 500/],
    [['--target', 'staging', '--business-id', BUSINESS, '--min-products', '2.5'], /1 a 500/],
    [['--target', 'staging', '--business-id', BUSINESS, '--apply'], /Flag desconocido: --apply/],
    [['--target', 'staging', '--business-id', BUSINESS, 'extra'], /Argumento inesperado/],
    [['--target', 'staging', '--target', 'staging', '--business-id', BUSINESS], /repetido/],
    [['--target', 'staging', '--business-id', BUSINESS, '--ci-commit', HEAD], /junto con --ci-conclusion/],
    [['--target', 'staging', '--business-id', BUSINESS, '--ci-conclusion', 'success', '--ci-commit', 'HEAD'], /SHA/],
    [['--target', 'staging', '--business-id', BUSINESS, '--functions-reference', 'staging'], /distinto del destino/],
    [['--facts', 'f.json', '--functions-reference', 'staging'], /no va con --facts/],
    [['--facts', 'f.json', '--save-facts', 'g.json'], /no va con --facts/],
    [['--target', 'staging', '--business-id', BUSINESS, '--max-facts-age-minutes', '60'], /va con --facts/],
    [['--facts', 'f.json', '--max-facts-age-minutes', '0'], /1 a 1440/],
    [['--facts', 'f.json', '--max-facts-age-minutes', '1441'], /1 a 1440/],
    [['--facts', 'f.json', '--max-facts-age-minutes', 'forever'], /1 a 1440/],
  ];
  for (const [argv, message] of wrong) assert.throws(() => parseArgs(argv), (error) => error instanceof UsageError && message.test(error.message), argv.join(' '));
});

test('códigos de salida: 0 sólo para PRODUCTION_READY', () => {
  assert.deepEqual(EXIT, { READY: 0, ERROR: 1, USAGE: 2, NOT_READY: 3 });
  assert.equal(exitCodeFor('PRODUCTION_READY'), 0);
  for (const verdict of ['NOT_READY', 'READY', '', undefined, null, 'production_ready']) assert.equal(exitCodeFor(verdict), 3, String(verdict));
});

/** Corre el CLI en proceso con el reloj y el repo inyectados; devuelve el código de salida y lo impreso. */
async function runCli(argv, { now = EVALUATED_AT, repoIo = fakeIo() } = {}) {
  const lines = [];
  const code = await run(argv, { log: (line) => lines.push(line), error: (line) => lines.push(line), now: () => new Date(now), repoIo });
  return { code, output: lines.join('\n') };
}

/** Un directorio temporal con archivos de hechos: `save(nombre, cambio)` devuelve la ruta. */
function factsDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-release-gates-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = (name) => path.join(dir, name);
  const save = (name, change = () => {}) => { fs.writeFileSync(file(name), JSON.stringify(mutated(change))); return file(name); };
  return { file, save };
}

test('evaluar hechos guardados: tabla, reporte, markdown y códigos de salida, sin red', async (t) => {
  const { file, save } = factsDir(t);
  const ready = save('ready.json');

  const first = await runCli(['--facts', ready, '--out', file('out/report.json'), '--markdown', file('out/report.md')]);
  assert.equal(first.code, 0);
  assert.match(first.output, /VERDICT: PRODUCTION_READY\nBLOCKERS \(0\)/);
  assert.match(first.output, /observer: supabase_read_only_user · transaction_read_only=on/);
  // Quien lee la tabla sabe que mira una foto, de cuándo es, y que lo del repo es el árbol de hoy.
  assert.match(first.output, /^source: SAVED FACTS \(ready\.json\) — target sections from the file, repo sections re-read from the current tree$/m);
  assert.match(first.output, /^facts collected: 2026-10-01T12:00:00\.000Z · age 5 min \(max 30\) · FRESH$/m);
  assert.match(first.output, /^MONEY_MOVEMENT_POSSIBLE: YES \(MERCADOPAGO_ENVIRONMENT_PRODUCTION, PRODUCTION_REVIEW_APPROVED, REAL_MONEY_SWITCH_ENABLED, BUSINESSES_CAN_CHARGE_IN_PRODUCTION:1\)$/m);
  const report = JSON.parse(fs.readFileSync(file('out/report.json'), 'utf8'));
  assert.equal(report.moneyMovementPossible.value, 'YES');
  assert.equal(report.verdict, 'PRODUCTION_READY');
  assert.equal(report.tool, 'ecommerce-release-gates');
  assert.equal(report.source, 'saved');
  assert.equal(report.evaluatedAt, EVALUATED_AT);
  assert.deepEqual(report.provenance, {
    source: 'saved', facts_file: 'ready.json', collected_at: '2026-10-01T12:00:00.000Z', evaluated_at: EVALUATED_AT, age_minutes: 5,
    max_age_minutes: 30, freshness: 'FRESH', repo_sections: 'REREAD_FROM_CURRENT_TREE', repo_head_at_snapshot: HEAD,
  });
  assert.doesNotMatch(JSON.stringify(report.provenance), /taba-release-gates-/, 'del archivo va sólo el nombre: sin rutas de disco');
  assert.equal(report.gates.length, 17);
  assert.equal(report.facts.businessId, BUSINESS);
  const markdown = fs.readFileSync(file('out/report.md'), 'utf8');
  assert.match(markdown, /\*\*VERDICT: PRODUCTION_READY\*\*/);
  assert.match(markdown, /^- MONEY_MOVEMENT_POSSIBLE: YES \(/m);
  assert.match(markdown, /^- source: SAVED FACTS \(ready\.json\) — target sections from the file/m);
  assert.match(markdown, /^- facts collected: 2026-10-01T12:00:00\.000Z · age 5 min \(max 30\) · FRESH$/m);
  // El reporte trae los hechos adentro: se puede volver a evaluar mientras sigan siendo recientes.
  assert.equal((await runCli(['--facts', file('out/report.json'), '--target', 'controlled-production', '--business-id', BUSINESS])).code, 0);

  // Lo pedido en la línea de comandos manda sobre lo guardado.
  assert.equal((await runCli(['--facts', ready, '--min-products', '13'])).code, 3);
  assert.equal((await runCli(['--facts', ready, '--ci-conclusion', 'failure'])).code, 3);
  const asJson = await runCli(['--facts', ready, '--require-rider', '--json']);
  assert.equal(asJson.code, 0);
  assert.equal(JSON.parse(asJson.output).provenance.source, 'saved');

  // Uso incorrecto: 2, sin evaluar nada.
  assert.equal((await runCli(['--facts', ready, '--target', 'staging'])).code, 2);
  assert.equal((await runCli(['--facts', ready, '--business-id', '00000000-0000-4000-8000-000000000001'])).code, 2);
  assert.equal((await runCli(['--facts', file('no-existe.json')])).code, 2);
  assert.equal((await runCli(['--target', 'staging'])).code, 2);
  assert.equal((await runCli(['--help'])).code, 2, 'ni la ayuda sale con 0');
  assert.throws(() => loadSavedFacts(ready, parseArgs(['--facts', 'x', '--target', 'staging'])), UsageError);
});

// Regresión de la revisión: `--facts` daba PRODUCTION_READY / salida 0 con hechos
// de cualquier antigüedad, o sin fecha, y nada decía que venían de un archivo.
test('hechos guardados viejos, con fecha futura o sin fecha nunca dan PRODUCTION_READY', async (t) => {
  const { save } = factsDir(t);

  // (a) Una foto de hace meses de un comercio que entonces estaba listo.
  const old = await runCli(['--facts', save('old.json', (facts) => { facts.collectedAt = '2025-01-01T00:00:00.000Z'; })]);
  assert.equal(old.code, 3);
  assert.match(old.output, /VERDICT: NOT_READY\nBLOCKERS \(1\)\n {2}FACTS_PROVENANCE \[FAIL\] FACTS_STALE:age_minutes=\d+:max=30$/m);
  assert.match(old.output, /^facts collected: 2025-01-01T00:00:00\.000Z · age \d+ min \(max 30\) · STALE$/m);
  assert.match(old.output, /^source: SAVED FACTS \(old\.json\)/m);

  // (b) Sin fecha, sin observador y sin versión de formato: no son hechos de ningún momento.
  const anonymous = await runCli(['--facts', save('anonymous.json', (facts) => { delete facts.collectedAt; delete facts.observer; delete facts.schema; })]);
  assert.equal(anonymous.code, 3);
  assert.match(anonymous.output, /VERDICT: NOT_READY\nBLOCKERS \(16\)\n {2}FACTS_PROVENANCE \[UNKNOWN\] FACTS_NOT_IDENTIFIED:collectedAt,schema$/m);
  assert.match(anonymous.output, /CATALOG_APPROVAL\s+yes\s+UNKNOWN\s+FACTS_NOT_IDENTIFIED:collectedAt,schema/);
  // Sin saber de cuándo son los hechos, tampoco se sabe si puede moverse dinero real.
  assert.match(anonymous.output, /^MONEY_MOVEMENT_POSSIBLE: UNKNOWN \(FACTS_NOT_IDENTIFIED:collectedAt,schema\)$/m);
  assert.match(anonymous.output, /^facts collected: \(unknown\) · UNKNOWN$/m);
  for (const [index, value] of ['ayer', '2026-10-01', '', null, 1790856000000, '2026-13-45T00:00:00Z'].entries()) {
    const undated = await runCli(['--facts', save(`undated-${index}.json`, (facts) => { facts.collectedAt = value; })]);
    assert.equal(undated.code, 3, String(value));
    assert.match(undated.output, /FACTS_PROVENANCE \[UNKNOWN\] FACTS_NOT_IDENTIFIED:collectedAt$/m, String(value));
  }

  // Unas opciones guardadas que no se pueden leer no se «arreglan» al cargarlas, ni con un flag encima.
  for (const [index, value] of ['strict', null, ['requireRider'], { requireRider: 'true' }].entries()) {
    const garbled = await runCli(['--facts', save(`options-${index}.json`, (facts) => { facts.options = value; }), '--min-products', '1']);
    assert.equal(garbled.code, 3, JSON.stringify(value));
    assert.match(garbled.output, /FACTS_PROVENANCE \[UNKNOWN\] FACTS_NOT_IDENTIFIED:options$/m, JSON.stringify(value));
  }

  // (c) Con fecha futura: o el archivo está editado o el reloj de esta máquina atrasa. En los dos casos, no.
  const future = await runCli(['--facts', save('future.json', (facts) => { facts.collectedAt = '2026-10-01T13:00:00.000Z'; })]);
  assert.equal(future.code, 3);
  assert.match(future.output, /BLOCKERS \(1\)\n {2}FACTS_PROVENANCE \[FAIL\] FACTS_FROM_THE_FUTURE:collected=2026-10-01T13:00:00\.000Z$/m);
  assert.match(future.output, /· FUTURE$/m);
  // Un minuto de diferencia entre dos relojes no es «del futuro».
  assert.equal((await runCli(['--facts', save('skew.json', (facts) => { facts.collectedAt = '2026-10-01T12:06:00.000Z'; })])).code, 0);

  // (d) El límite: 30 minutos por defecto, y quien opera puede subirlo a sabiendas.
  const ready = save('ready.json');
  assert.equal((await runCli(['--facts', ready], { now: '2026-10-01T12:30:00.000Z' })).code, 0);
  const late = await runCli(['--facts', ready], { now: '2026-10-01T12:45:00.000Z' });
  assert.equal(late.code, 3);
  assert.match(late.output, /FACTS_PROVENANCE \[FAIL\] FACTS_STALE:age_minutes=45:max=30$/m);
  const allowed = await runCli(['--facts', ready, '--max-facts-age-minutes', '60'], { now: '2026-10-01T12:45:00.000Z' });
  assert.equal(allowed.code, 0);
  assert.match(allowed.output, /^facts collected: 2026-10-01T12:00:00\.000Z · age 45 min \(max 60\) · FRESH$/m);
  assert.equal((await runCli(['--facts', ready, '--max-facts-age-minutes', '60'], { now: '2026-10-01T13:00:01.000Z' })).code, 3);
});

// Regresión de la revisión: las secciones del repo se tomaban del archivo, así
// que un P1 reabierto o una migración agregada después de la foto no se veían.
test('hechos guardados: lo del repo se relee del árbol actual, no de la foto', async (t) => {
  const { file, save } = factsDir(t);
  const ready = save('ready.json');

  // Un P1 reabierto después de la foto.
  const reopened = fakeIo();
  const register = JSON.parse(reopened.files[FINDINGS_REGISTER_PATH]);
  register.findings[1].status = 'open';
  reopened.files[FINDINGS_REGISTER_PATH] = JSON.stringify(register);
  const blocked = await runCli(['--facts', ready], { repoIo: reopened });
  assert.equal(blocked.code, 3);
  assert.match(blocked.output, /NO_OPEN_P1\s+yes\s+FAIL\s+OPEN:X-02/);
  assert.match(blocked.output, /VERDICT: NOT_READY\nBLOCKERS \(1\)\n {2}NO_OPEN_P1 \[FAIL\] OPEN:X-02$/m);

  // Una migración agregada después de la foto.
  const migrated = fakeIo();
  migrated.dirs['supabase/migrations'].push({ name: '20261002090000_agregada_despues.sql', isDirectory: false });
  const behind = await runCli(['--facts', ready], { repoIo: migrated });
  assert.equal(behind.code, 3);
  assert.match(behind.output, /BLOCKERS \(1\)\n {2}MIGRATION_PARITY \[FAIL\] REPO_NOT_IN_LEDGER:20261002090000$/m);

  // Una certificación retirada después de la foto.
  const withdrawn = fakeIo();
  const certification = JSON.parse(withdrawn.files[PAYMENT_CERTIFICATION_PATH]);
  certification.entries[1].certified = false;
  withdrawn.files[PAYMENT_CERTIFICATION_PATH] = JSON.stringify(certification);
  assert.match((await runCli(['--facts', ready], { repoIo: withdrawn })).output, /PAYMENT_CERTIFICATION \[FAIL\] NOT_CERTIFIED:mercadopago:production$/m);

  // El commit se movió: el CI que declaraba la foto no es el de este árbol.
  const otherHead = createHash('sha1').update('otro commit').digest('hex');
  const moved = await runCli(['--facts', ready, '--out', file('moved.json')], { repoIo: fakeIo({ async repoHead() { return otherHead; } }) });
  assert.equal(moved.code, 3);
  assert.match(moved.output, /BLOCKERS \(1\)\n {2}CI_GREEN \[FAIL\] CI_COMMIT_MISMATCH:/);
  const movedReport = JSON.parse(fs.readFileSync(file('moved.json'), 'utf8'));
  assert.equal(movedReport.provenance.repo_head_at_snapshot, HEAD);
  assert.equal(movedReport.facts.repo.head, otherHead, 'el reporte guarda el commit del árbol evaluado, no el de la foto');

  // Entradas del veredicto sin commitear en el árbol de hoy.
  const dirty = await runCli(['--facts', ready], { repoIo: fakeIo({ async repoUncommitted() { return [' M docs/ecommerce-hardening/findings-register.json']; } }) });
  assert.equal(dirty.code, 3);
  assert.match(dirty.output, /BLOCKERS \(1\)\n {2}CI_GREEN \[FAIL\] RELEASE_INPUTS_NOT_COMMITTED:1$/m);

  // Al revés también: la foto trae un P1 abierto que el árbol de hoy tiene corregido. Vale el árbol.
  const outdated = save('outdated.json', (facts) => { facts.findingsRegister.findings[1].status = 'open'; facts.repoMigrations.files.pop(); });
  assert.equal((await runCli(['--facts', outdated])).code, 0);

  // Si el repo no se puede leer, lo del repo queda desconocido: jamás se cae a lo que decía la foto.
  const unreadable = await runCli(['--facts', ready, '--json'], { repoIo: {} });
  assert.equal(unreadable.code, 3);
  const blind = JSON.parse(unreadable.output);
  assert.deepEqual(blind.blockers.map((blocker) => [blocker.gate, blocker.status]), [
    ['PAYMENT_CERTIFICATION', 'UNKNOWN'], ['REAL_MONEY_GATE', 'UNKNOWN'], ['MIGRATION_PARITY', 'UNKNOWN'], ['EDGE_FUNCTIONS', 'UNKNOWN'],
    ['NO_OPEN_P0', 'UNKNOWN'], ['NO_OPEN_P1', 'UNKNOWN'], ['CI_GREEN', 'UNKNOWN'],
  ]);
  for (const section of ['repoMigrations', 'repoFunctions', 'paymentCertification', 'findingsRegister', 'repo']) assert.equal(blind.facts[section].ok, false, section);
});

test('el proceso real: 3 con hechos guardados contra el árbol de verdad, 2 por uso incorrecto', (t) => {
  const { save } = factsDir(t);
  const cli = path.join(ROOT, 'scripts/release/ecommerce-release-gates.mjs');
  const spawn = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 60_000, windowsHide: true });

  // Hechos recién guardados de un comercio «listo», evaluados contra ESTE repo: la
  // foto dice tres migraciones y un registro sin hallazgos abiertos; el árbol real no.
  const fresh = spawn(['--facts', save('fresh.json', (facts) => { facts.collectedAt = new Date().toISOString(); })]);
  assert.equal(fresh.status, 3, fresh.stderr);
  assert.match(fresh.stdout, /^source: SAVED FACTS \(fresh\.json\) — target sections from the file, repo sections re-read from the current tree$/m);
  assert.match(fresh.stdout, /· FRESH$/m);
  assert.match(fresh.stdout, /MIGRATION_PARITY\s+yes\s+FAIL\s+REPO_NOT_IN_LEDGER:/);
  assert.match(fresh.stdout, /VERDICT: NOT_READY/);
  assert.doesNotMatch(fresh.stdout, /FACTS_PROVENANCE/);

  const old = spawn(['--facts', save('old.json', (facts) => { facts.collectedAt = '2025-01-01T00:00:00.000Z'; })]);
  assert.equal(old.status, 3, old.stderr);
  assert.match(old.stdout, /FACTS_PROVENANCE \[FAIL\] FACTS_STALE:age_minutes=\d+:max=30$/m);

  const usage = spawn(['--business-id', BUSINESS]);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /ERROR Hacen falta --target y --business-id/);
});

test('el reporte en markdown nombra cada compuerta y cada bloqueo', () => {
  const facts = mutated((f) => { f.business.hours_enforced = false; f.business.abandoned_order_minutes = null; });
  const markdown = renderMarkdown(evaluate(facts), facts);
  for (const gate of GATES) assert.ok(markdown.includes(`| ${gate.id} |`), gate.id);
  assert.match(markdown, /\*\*VERDICT: NOT_READY\*\*/);
  assert.match(markdown, /- `SERVICE_HOURS` — FAIL: HOURS_NOT_ENFORCED/);
  assert.match(markdown, /\| UNATTENDED_ORDER_POLICY \| no \| WARNING \|/);
  assert.ok(markdown.endsWith('\n'));
});

// ── Los archivos de datos del repo ───────────────────────────────────────────

test('el catálogo de compuertas documenta exactamente las que evalúa el código', () => {
  const catalogue = JSON.parse(read('docs/ecommerce-hardening/release-gates.json'));
  assert.deepEqual(catalogue.gates.map(({ id, title, blocking }) => ({ id, title, blocking })), GATES.map((gate) => ({ ...gate })));
  for (const gate of catalogue.gates) {
    assert.deepEqual(Object.keys(gate), ['id', 'title', 'blocking', 'checks', 'source']);
    assert.ok(gate.checks.length > 40 && gate.source.length > 10, gate.id);
  }
  assert.deepEqual(catalogue.verdicts, [VERDICTS.READY, VERDICTS.NOT_READY]);
  assert.equal(catalogue.tool, 'scripts/release/ecommerce-release-gates.mjs');
});

// Los P0/P1 que encontraron los doce lectores de la auditoría (2026-10-01). No hubo P0.
const AUDIT_P0_P1 = ['STK-01', 'STK-02', 'PRICE-01', 'DIAG-01', 'AUTHZ-01', 'EDGE-01', 'EDGE-02', 'EDGE-03', 'EDGE-04', 'PAY-01', 'PAY-02',
  'CS-01', 'CS-02', 'CS-03', 'CS-04', 'F1', 'F2', 'CAT-01', 'CAT-02', 'TOOL-01', 'OSM-01'];
const AUDIT_P2 = ['STK-03', 'STK-04', 'STK-05', 'STK-06', 'STK-07', 'PRICE-02', 'PRICE-03', 'PRICE-04', 'DIAG-02', 'DIAG-03', 'DIAG-04',
  'DIAG-05', 'DIAG-06', 'DIAG-07', 'DIAG-08', 'DIAG-09', 'DIAG-10', 'AUTHZ-02', 'AUTHZ-03', 'AUTHZ-04', 'EDGE-05', 'EDGE-06', 'EDGE-07',
  'EDGE-08', 'EDGE-09', 'PAY-03', 'PAY-04', 'PAY-05', 'PAY-06', 'PAY-07', 'PAY-08', 'CS-05', 'CS-06', 'F3', 'F4', 'F5', 'F6', 'CAT-03',
  'CAT-04', 'CAT-05', 'CAT-06', 'CAT-07', 'CAT-08', 'TOOL-02', 'TOOL-03', 'TOOL-04', 'TOOL-05', 'TOOL-06', 'TOOL-07', 'F-01', 'F-02',
  'F-03', 'F-04', 'F-05', 'F-06', 'OSM-02', 'OSM-03', 'OSM-04', 'OSM-05', 'OSM-06'];

test('el registro de hallazgos trae todos los P0, P1 y P2 de la auditoría, sin duplicar', () => {
  const register = JSON.parse(read(FINDINGS_REGISTER_PATH));
  const { findings } = register;
  assert.ok(findings.length >= 60, `${findings.length} hallazgos`);
  const names = findings.flatMap((finding) => [finding.id, ...finding.aliases]);
  assert.equal(new Set(names).size, names.length, 'ningún id aparece dos veces, ni como hallazgo ni como alias');
  for (const finding of findings) {
    for (const field of ['id', 'severity', 'title', 'status', 'fixed_by', 'notes', 'aliases']) assert.ok(Object.hasOwn(finding, field), `${finding.id}.${field}`);
    assert.ok(['P0', 'P1', 'P2'].includes(finding.severity), finding.id);
    assert.ok(FINDING_STATUSES.includes(finding.status), `${finding.id}: ${finding.status}`);
    assert.ok(finding.title.length > 15, finding.id);
    assert.ok(Array.isArray(finding.aliases), finding.id);
  }
  const carrier = (id) => findings.find((finding) => finding.id === id || finding.aliases.includes(id));
  for (const id of AUDIT_P0_P1) {
    assert.ok(carrier(id), `${id} falta en el registro`);
    assert.ok(['P0', 'P1'].includes(carrier(id).severity), `${id} quedó con severidad ${carrier(id).severity}`);
  }
  for (const id of AUDIT_P2) assert.ok(carrier(id), `${id} falta en el registro`);
  assert.equal(new Set(AUDIT_P0_P1).size, 21);
  assert.equal(new Set(AUDIT_P2).size, 60);
});

test('las compuertas de hallazgos dicen lo mismo que el registro del repo', async () => {
  const register = JSON.parse(read(FINDINGS_REGISTER_PATH));
  const facts = await collect('controlled-production', BUSINESS, createRepoIo(ROOT), { now: NOW });
  assert.equal(facts.findingsRegister.ok, true);
  assert.equal(facts.findingsRegister.findings.length, register.findings.length);
  const result = evaluate(facts);
  assert.equal(result.verdict, 'NOT_READY', 'sin leer el destino no hay PRODUCTION_READY');
  for (const severity of ['P0', 'P1']) {
    const expected = register.findings.filter((finding) => finding.severity === severity).map(findingBlocker).filter(Boolean);
    const gate = gateOf(result, `NO_OPEN_${severity}`);
    assert.equal(gate.status, expected.length ? 'FAIL' : 'PASS', severity);
    assert.deepEqual(gate.missing.filter((code) => !code.startsWith('AND_')), expected.slice(0, 40), severity);
  }
});

test('la certificación de pagos dice lo que hoy se sabe, con su evidencia en el repo', async () => {
  const document = JSON.parse(read(PAYMENT_CERTIFICATION_PATH));
  const manual = document.entries.find((entry) => entry.method === 'manual');
  assert.equal(manual.certified, true);
  assert.equal(manual.environment, 'staging');
  assert.equal(manual.evidence, 'artifacts/taba-e2e-cert-20261001-022224');
  assert.ok(fs.existsSync(path.join(ROOT, manual.evidence, 'final-report.md')), 'la evidencia del pago manual está en el repo');
  const online = document.entries.filter((entry) => entry.method === 'mercadopago');
  assert.ok(online.length >= 1);
  for (const entry of document.entries) {
    assert.deepEqual(['method', 'environment', 'certified', 'evidence', 'date', 'limits'].filter((field) => !Object.hasOwn(entry, field)), [], entry.method);
    // Nadie puede marcar «certificado» sin evidencia que exista.
    if (entry.certified) assert.ok(isRepoRelativePath(entry.evidence) && fs.existsSync(path.join(ROOT, entry.evidence)), `${entry.method}: ${entry.evidence}`);
    else assert.ok(String(entry.reason || '').length > 20, `${entry.method}: sin certificar necesita un motivo`);
  }
  const facts = await collect('controlled-production', BUSINESS, createRepoIo(ROOT), { now: NOW });
  assert.equal(facts.paymentCertification.ok, true);
  assert.equal(facts.paymentCertification.entries.find((entry) => entry.method === 'manual').evidence_exists, true);
  // Con los hechos de un comercio listo y el archivo real: la compuerta pasa sólo si Mercado Pago está certificado en producción.
  const ready = readyFacts();
  ready.paymentCertification = { ...facts.paymentCertification, opening_decision: ready.paymentCertification.opening_decision };
  const certified = online.some((entry) => entry.environment === 'production' && entry.certified === true);
  assert.equal(gateOf(evaluate(ready), 'PAYMENT_CERTIFICATION').status, certified ? 'PASS' : 'FAIL');
  if (!certified) assert.deepEqual(gateOf(evaluate(ready), 'PAYMENT_CERTIFICATION').missing, ['NOT_CERTIFIED:mercadopago:production']);
});

test('contra el repo real: funciones, verify_jwt y migraciones se leen completos', async () => {
  const facts = await collect('controlled-production', BUSINESS, createRepoIo(ROOT), { now: NOW });
  const bySlug = Object.fromEntries(facts.repoFunctions.functions.map((fn) => [fn.slug, fn]));
  for (const slug of CRITICAL_EDGE_FUNCTIONS) assert.ok(bySlug[slug], `${slug} no está en supabase/functions`);
  assert.equal(bySlug._shared, undefined);
  assert.equal(bySlug['mercadopago-webhook'].verify_jwt, false);
  assert.equal(bySlug['mercadopago-refund'].verify_jwt, true);
  assert.equal(bySlug['mercadopago-create-checkout-session'].verify_jwt, false);
  for (const fn of facts.repoFunctions.functions) assert.equal(typeof fn.verify_jwt, 'boolean', fn.slug);
  assert.equal(facts.repoMigrations.ok, true);
  assert.ok(facts.repoMigrations.files.length >= 159);
  assert.deepEqual(facts.repoMigrations.unrecognized, []);
  assert.equal(new Set(facts.repoMigrations.files.map((file) => file.version)).size, facts.repoMigrations.files.length);
  assert.ok(facts.repoMigrations.files.some((file) => file.version === '20261001180000' && file.name === 'order_intake_guard'));
  // Lo que es del destino no se leyó: queda desconocido, no aprobado.
  for (const section of ['business', 'catalog', 'migrationLedger', 'deployedFunctions', 'realMoneySecrets', 'realMoneyBusinesses']) {
    assert.equal(facts[section].ok, false, section);
  }
  assert.equal(evaluate(facts).moneyMovementPossible.value, 'UNKNOWN', 'sin leer el destino no se sabe si puede moverse dinero real');
  await assert.rejects(createRepoIo(ROOT).readRepoFile('../fuera.txt'), /REPO_PATH_INVALID/);
  await assert.rejects(createRepoIo(ROOT).readRepoFile('docs/no-existe.json'), /^Error: REPO_FILE_UNREADABLE:docs\/no-existe\.json:ENOENT$/);
});

test('los archivos de la herramienta respetan las compuertas del repo', () => {
  for (const file of TOOL_FILES) {
    const bytes = fs.readFileSync(path.join(ROOT, file));
    const source = bytes.toString('utf8');
    assert.notEqual(bytes[0], 0xef, `${file}: sin BOM`);
    assert.equal(source.includes('\r'), false, `${file}: fin de línea LF`);
    assert.ok(source.endsWith('\n'), `${file}: termina con salto de línea`);
    assert.deepEqual(scanText(source), [], `${file}: sin literales con forma de credencial`);
    assert.deepEqual(findPersonalLocalPaths(file, source), [], `${file}: sin rutas de disco locales`);
  }
});

// ── El código desplegado tiene que ser el del repo ─────────────────────────────

test('una función cuyo código cambió después de su despliegue no pasa, y sin fechas no se sabe', () => {
  const stale = evaluate(mutated((facts) => {
    for (const fn of facts.repoFunctions.functions.filter((item) => item.slug.startsWith('mercadopago-'))) fn.source_committed_at = '2026-10-02T09:31:09.000Z';
  }));
  assert.equal(stale.verdict, 'NOT_READY');
  assert.deepEqual(blockerIds(stale), ['EDGE_FUNCTIONS']);
  assert.deepEqual(gateOf(stale, 'EDGE_FUNCTIONS').missing, CRITICAL_EDGE_FUNCTIONS.map((slug) => `SOURCE_NEWER_THAN_DEPLOYMENT:${slug}`).sort());
  // Volver a desplegar después del commit lo resuelve; el mismo instante todavía vale.
  const redeployed = evaluate(mutated((facts) => {
    for (const fn of facts.repoFunctions.functions) fn.source_committed_at = '2026-10-02T09:31:09.000Z';
    for (const fn of facts.deployedFunctions.functions) fn.updated_at = Date.parse('2026-10-02T09:31:09.000Z');
  }));
  assert.equal(redeployed.verdict, 'PRODUCTION_READY');
  // La fecha del despliegue llega en milisegundos (Management API) o como instante ISO: las dos se leen.
  const iso = evaluate(mutated((facts) => { for (const fn of facts.deployedFunctions.functions) fn.updated_at = '2026-09-28T12:00:00.000Z'; }));
  assert.equal(gateOf(iso, 'EDGE_FUNCTIONS').status, 'PASS');

  const noSource = evaluate(mutated((facts) => { facts.repoFunctions.functions.find((fn) => fn.slug === 'team-invitation').source_committed_at = null; }));
  assert.deepEqual(noSource.blockers, [{ gate: 'EDGE_FUNCTIONS', status: 'UNKNOWN', missing: ['SOURCE_TIME_UNAVAILABLE:team-invitation'] }]);
  const noDeploy = evaluate(mutated((facts) => { delete facts.deployedFunctions.functions.find((fn) => fn.slug === 'team-invitation').updated_at; }));
  assert.deepEqual(noDeploy.blockers, [{ gate: 'EDGE_FUNCTIONS', status: 'UNKNOWN', missing: ['DEPLOY_TIME_UNAVAILABLE:team-invitation'] }]);
  for (const junk of ['ayer', 0, -5, 1.5, true, {}]) {
    const result = evaluate(mutated((facts) => { facts.deployedFunctions.functions[0].updated_at = junk; }));
    assert.equal(gateOf(result, 'EDGE_FUNCTIONS').status, 'UNKNOWN', `una fecha ilegible (${JSON.stringify(junk)}) no es una fecha`);
  }
  // Un defecto cierto pesa más que una fecha que falta.
  const both = evaluate(mutated((facts) => {
    facts.repoFunctions.functions.find((fn) => fn.slug === 'team-invitation').source_committed_at = null;
    facts.repoFunctions.functions.find((fn) => fn.slug === 'mercadopago-refund').source_committed_at = '2026-10-02T09:31:09.000Z';
  }));
  assert.deepEqual(gateOf(both, 'EDGE_FUNCTIONS'), { ...gateOf(both, 'EDGE_FUNCTIONS'), status: 'FAIL', missing: ['SOURCE_NEWER_THAN_DEPLOYMENT:mercadopago-refund'] });
});

test('el código de una función es lo que importa, sin sus pruebas, y esa es la lista que se le pregunta a git', async () => {
  assert.deepEqual(relativeImports(`
    import { a } from '../_shared/a.ts';
    import b from "./b.ts";
    import './side-effect.ts';
    const c = await import('../_shared/c.ts');
    export { d } from '../_shared/d.ts';
    import { serve } from 'https://deno.land/std/http/server.ts';
    import pg from 'npm:pg';
  `), ['../_shared/a.ts', './b.ts', './side-effect.ts', '../_shared/c.ts', '../_shared/d.ts']);

  const io = fakeIo();
  assert.deepEqual(await functionSourceFiles(io, 'mercadopago-webhook'), [
    'supabase/functions/_shared/cors.ts', 'supabase/functions/_shared/runtime.ts',
    'supabase/functions/deno.json', 'supabase/functions/mercadopago-webhook/index.ts',
  ], 'su archivo, el código común que alcanza por imports encadenados y la configuración de Deno; no su prueba');

  const facts = await collect('controlled-production', BUSINESS, io, { now: NOW });
  assert.equal(io.commitTimeAsked.length, 13, 'una pregunta por función');
  assert.ok(io.commitTimeAsked.every((paths) => paths.length === 4 && !paths.some((file) => file.endsWith('.deno.ts'))));
  assert.ok(facts.repoFunctions.functions.every((fn) => fn.source_committed_at === SOURCE_COMMITTED_AT && fn.source_files === 4));

  // Un import que no se puede resolver, o que sale de supabase/functions: no se sabe qué se despliega.
  const broken = fakeIo();
  broken.files['supabase/functions/team-invitation/index.ts'] = "import x from '../_shared/no-existe.ts';\n";
  const outside = fakeIo();
  outside.files['supabase/functions/print-agent-gateway/index.ts'] = "import x from '../../../scripts/lib/algo.mjs';\n";
  for (const [fake, slug] of [[broken, 'team-invitation'], [outside, 'print-agent-gateway']]) {
    const collected = await collect('controlled-production', BUSINESS, fake, { now: NOW });
    assert.equal(collected.repoFunctions.functions.find((fn) => fn.slug === slug).source_committed_at, null);
    assert.deepEqual(evaluate(collected).blockers, [{ gate: 'EDGE_FUNCTIONS', status: 'UNKNOWN', missing: [`SOURCE_TIME_UNAVAILABLE:${slug}`] }]);
  }
  // Sin git (una entrada/salida que no sabe de commits) tampoco se supone nada.
  const { repoLastCommitTime: _omitted, ...withoutGit } = fakeIo();
  const blind = await collect('controlled-production', BUSINESS, withoutGit, { now: NOW });
  assert.ok(blind.repoFunctions.functions.every((fn) => fn.source_committed_at === null));
  assert.equal(gateOf(evaluate(blind), 'EDGE_FUNCTIONS').status, 'UNKNOWN');
});

test('contra el repo real: cada función tiene fecha de código y su lista no incluye pruebas', async () => {
  const io = createRepoIo(ROOT);
  const facts = await collect('controlled-production', BUSINESS, io, { now: NOW });
  for (const fn of facts.repoFunctions.functions) {
    assert.match(String(fn.source_committed_at), /^\d{4}-\d{2}-\d{2}T/, `${fn.slug} tiene la fecha de su último commit`);
    assert.ok(fn.source_files >= 1, fn.slug);
  }
  const webhook = await functionSourceFiles(io, 'mercadopago-webhook');
  assert.ok(webhook.includes('supabase/functions/mercadopago-webhook/index.ts'));
  assert.ok(webhook.includes('supabase/functions/_shared/payment-runtime.ts'), 'sigue los imports hacia el código común');
  assert.ok(webhook.every((file) => !/\.(deno|test)\.ts$/.test(file)), 'las pruebas no se despliegan');
  assert.ok(webhook.every((file) => file.startsWith('supabase/functions/')));
});
