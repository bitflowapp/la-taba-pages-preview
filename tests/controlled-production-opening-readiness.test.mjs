import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  OPENING_CODES, openingItemMark, presentOpeningItem, presentOpeningReadiness,
} from '../js/core/store-opening-readiness.js';
import { containsForbiddenVocabulary } from '../js/business/business-operation-language.js';
import { parseReadinessArgs } from '../scripts/controlled-production/opening-readiness.mjs';
import { parseCheckArgs, verdictLines } from '../scripts/controlled-production/opening-check.mjs';
import { describeRefusal, parseApproveArgs } from '../scripts/controlled-production/opening-approve.mjs';
import { projectCatalog, projectedPending, parseDryRunArgs } from '../scripts/controlled-production/opening-dry-run.mjs';
import { parsePublishArgs } from '../scripts/controlled-production/opening-publish.mjs';
import { openingReportJson } from '../scripts/controlled-production/opening-tools.mjs';

const MIGRATION = fs.readFileSync(new URL('../supabase/migrations/20260928150000_store_opening_readiness.sql', import.meta.url), 'utf8');

const item = (code, status, blocking = true, facts = {}, group = 'business') => ({ code, status, blocking, facts, group });

// Lo que devuelve la base para el comercio real de hoy (2026-09-28).
const today = {
  business: { slug: 'la-taba-cp', name: 'La Taba', status: 'closed' },
  min_products: 1,
  items: [
    item('BUSINESS_ACTIVE', 'pass'),
    item('CURRENCY', 'pass', true, { currency: 'ARS' }),
    item('BUSINESS_ADDRESS', 'pass', false, { present: true }),
    item('BUSINESS_CONTACT', 'warn', false, { configured: false, confirmed: false }),
    item('FULFILLMENT_MODE', 'pending', true, { delivery: false, pickup: false }, 'fulfillment'),
    item('SERVICE_HOURS', 'pending', true, { enforced: true, timezone_ok: true, missing_channels: ['delivery', 'pickup'] }, 'fulfillment'),
    item('DELIVERY_PRICING', 'na', false, {}, 'fulfillment'),
    item('DELIVERY_COVERAGE', 'na', false, {}, 'fulfillment'),
    item('RIDERS', 'na', false, {}, 'fulfillment'),
    item('CATALOG_PRICES', 'pending', true, { with_price: 0, candidates: 28, min: 1 }, 'catalog'),
    item('CATALOG_STOCK', 'pending', true, { with_stock: 0, uncounted: 28, sold_out: 0, candidates: 28, min: 1 }, 'catalog'),
    item('CATALOG_PHOTOS', 'pending', true, { required: true, with_photo: 0, candidates: 28, min: 1 }, 'catalog'),
    item('CATALOG_PUBLISHED', 'pending', true, { published: 0, verified: 0, ready_to_publish: 0, min: 1 }, 'catalog'),
    item('ALCOHOL_POLICY', 'info', false, { enabled: false, alcoholic_products: 18 }, 'catalog'),
    item('PAYMENT_MANUAL', 'pass', true, { methods: ['cash', 'coordinate'] }, 'payments'),
    item('PAYMENT_MERCADOPAGO', 'info', false, { seller: 'none', platform_enabled: false }, 'payments'),
    item('PLATFORM_VERIFICATION', 'pending', true, { verified: false, enabled: false }, 'platform'),
    item('STORE_OPEN', 'info', false, { status: 'closed' }, 'open'),
  ],
  counts: { products: 46, alcoholic: 18, published: 0 },
  pending: ['FULFILLMENT_MODE', 'SERVICE_HOURS', 'CATALOG_PRICES', 'CATALOG_STOCK', 'CATALOG_PHOTOS', 'CATALOG_PUBLISHED', 'PLATFORM_VERIFICATION'],
  ready_for_platform_verification: false,
  can_open: false,
  accepting_orders: false,
};

function withStatuses(payload, statuses, extra = {}) {
  return {
    ...payload,
    ...extra,
    items: payload.items.map((row) => (statuses[row.code] ? { ...row, status: statuses[row.code] } : row)),
  };
}

test('cada compuerta que la base puede devolver tiene su texto: no hay requisitos sin explicar', () => {
  const sqlCodes = [...new Set([...MIGRATION.matchAll(/'code', '([A-Z_]+)'/g)].map((match) => match[1]))];
  assert.ok(sqlCodes.length >= 18, `la migración declara ${sqlCodes.length} compuertas`);
  for (const code of sqlCodes) assert.ok(OPENING_CODES.includes(code), `${code} sin texto en el presentador`);
});

test('el texto para el comercio no usa vocabulario técnico', () => {
  for (const code of OPENING_CODES) {
    for (const status of ['pass', 'pending', 'warn', 'info', 'na']) {
      const presented = presentOpeningItem({ code, status, blocking: true, facts: { missing_channels: ['pickup'] } });
      const text = [presented.title, presented.reason, presented.action, presented.where].join(' ');
      assert.deepEqual(containsForbiddenVocabulary(text), [], `${code}/${status}: ${text}`);
      assert.doesNotMatch(text, /[a-z]+_[a-z]+\(|constraint|uuid|sqlstate/i, `${code}/${status}`);
    }
  }
});

test('el comercio real de hoy: faltan seis pasos y cada uno dice dónde se arregla', () => {
  const presented = presentOpeningReadiness(today);
  assert.equal(presented.known, true);
  assert.equal(presented.commercialReady, false);
  assert.equal(presented.canOpen, false);
  assert.equal(presented.headline, 'Faltan 6 pasos para abrir.');
  const hours = presented.items.find((row) => row.code === 'SERVICE_HOURS');
  assert.match(hours.reason, /Falta el horario de delivery y de retiro/);
  assert.equal(hours.view, 'operations-config');
  assert.match(hours.where, /Horarios y cobertura/);
  const published = presented.items.find((row) => row.code === 'CATALOG_PUBLISHED');
  assert.match(published.reason, /foto aprobada/);
  const photos = presented.items.find((row) => row.code === 'CATALOG_PHOTOS');
  assert.equal(photos.view, 'catalog');
  assert.equal(presented.items.find((row) => row.code === 'PAYMENT_MANUAL').action, '', 'lo cumplido no pide acción');
  assert.deepEqual(presented.groups.map((group) => group.id), ['business', 'fulfillment', 'catalog', 'payments', 'platform', 'open']);
});

test('listo del lado del comercio, verificado y abierto: tres titulares distintos', () => {
  const ready = withStatuses(today, {
    FULFILLMENT_MODE: 'pass', SERVICE_HOURS: 'pass', CATALOG_PRICES: 'pass', CATALOG_STOCK: 'pass', CATALOG_PHOTOS: 'pass', CATALOG_PUBLISHED: 'pass',
  }, { ready_for_platform_verification: true, pending: ['PLATFORM_VERIFICATION'] });
  const commercial = presentOpeningReadiness(ready);
  assert.equal(commercial.commercialReady, true);
  assert.equal(commercial.canOpen, false);
  assert.equal(commercial.headline, 'Todo listo del lado del comercio.');

  const verified = presentOpeningReadiness(withStatuses(ready, { PLATFORM_VERIFICATION: 'pass' }, { can_open: true, pending: [] }));
  assert.equal(verified.canOpen, true);
  assert.equal(verified.headline, 'Todo listo: falta abrir el local.');

  const open = presentOpeningReadiness(withStatuses(ready, { PLATFORM_VERIFICATION: 'pass', STORE_OPEN: 'pass' },
    { can_open: true, pending: [], accepting_orders: true, business: { ...today.business, status: 'open' } }));
  assert.equal(open.accepting, true);
  assert.equal(open.headline, 'La tienda está tomando pedidos.');
});

test('lo que no se pudo leer no se inventa y un código nuevo queda pendiente', () => {
  assert.equal(presentOpeningReadiness(null).known, false);
  assert.equal(presentOpeningReadiness({ items: 'x' }).canOpen, false);
  const unknown = presentOpeningItem({ code: 'NEW_GATE', status: 'pass', blocking: true });
  assert.equal(unknown.title, 'Requisito nuevo');
  const blocked = presentOpeningReadiness({ ...today, items: [...today.items, item('NEW_GATE', 'pending')], can_open: true,
    ready_for_platform_verification: true });
  assert.equal(blocked.canOpen, false, 'una compuerta pendiente siempre gana');
  assert.equal(blocked.commercialReady, false);
});

test('marcas de texto plano', () => {
  assert.equal(openingItemMark({ status: 'pass' }), '✓');
  assert.equal(openingItemMark({ status: 'pending', blocking: true }), '✗');
  assert.equal(openingItemMark({ status: 'warn' }), '!');
  assert.equal(openingItemMark({ status: 'info' }), '·');
  assert.equal(openingItemMark({ status: 'na' }), '–');
});

test('Mercado Pago dice su estado sin identificadores', () => {
  const say = (facts) => presentOpeningItem({ code: 'PAYMENT_MERCADOPAGO', status: 'info', facts }).reason;
  assert.match(say({ seller: 'none' }), /No conectado/);
  assert.match(say({ seller: 'connected', platform_enabled: false }), /falta la habilitación de la plataforma/);
  assert.match(say({ seller: 'requires_reauthorization' }), /volver a conectar/);
});

test('el reporte estable para máquinas: code, title, reason, action, where_to_fix', () => {
  const report = openingReportJson(today, presentOpeningReadiness(today));
  assert.equal(report.verdict, 'BLOCKED');
  assert.deepEqual(Object.keys(report.blockers[0]), ['code', 'title', 'reason', 'action', 'where_to_fix']);
  assert.equal(report.blockers.some((blocker) => blocker.code === 'PLATFORM_VERIFICATION'), true);
});

test('la terminal ya no escribe la verificación: la hace opening:approve', () => {
  assert.throws(() => parseReadinessArgs(['--verify-ordering']), /opening:approve/);
  assert.deepEqual(parseReadinessArgs([]), { business: 'la-taba-cp', minProducts: 1, json: false, verbose: false, out: '' });
  assert.throws(() => parseReadinessArgs(['--min-products', '0']), /1 a 500/);
  assert.throws(() => parseReadinessArgs(['--min-products']), /necesita un valor/);
});

test('opening:check termina con los tres veredictos', () => {
  assert.deepEqual(parseCheckArgs(['--strict', '--no-pulse']).strict, true);
  const lines = verdictLines({ technicalReady: true, presented: presentOpeningReadiness(today) });
  assert.deepEqual(lines, ['TECHNICAL_READY: YES', 'COMMERCIAL_READY: NO', 'CAN_OPEN: NO']);
});

test('opening:approve exige operador, motivo para revocar y traduce el rechazo', () => {
  assert.throws(() => parseApproveArgs([]), /verifier-email/);
  assert.throws(() => parseApproveArgs(['--verifier-email', 'op@example.com', '--revoke']), /--reason/);
  const parsed = parseApproveArgs(['--verifier-email', 'op@example.com', '--min-products', '5', '--note', 'canary']);
  assert.equal(parsed.minProducts, 5);
  assert.equal(parsed.business, 'la-taba-cp');
  const lines = describeRefusal({ message: 'OPENING_NOT_READY', details: 'SERVICE_HOURS,CATALOG_PRICES' });
  assert.match(lines.join('\n'), /Horarios/);
  assert.match(lines.join('\n'), /Precios/);
  assert.match(describeRefusal({ message: 'CONFIRMATION_MISMATCH' })[0], /No se escribió nada/);
});

test('el ensayo proyecta el catálogo con los mismos predicados que la base', () => {
  const products = [
    { sku: 'a', is_active: true, is_alcoholic: false, price_status: 'pending', price: 0, stock: null, available: false },
    { sku: 'b', is_active: true, is_alcoholic: false, price_status: 'pending', price: 0, stock: null, available: false },
    { sku: 'c', is_active: true, is_alcoholic: true, price_status: 'pending', price: 0, stock: null, available: false },
  ];
  const planRows = [
    { sku: 'a', after: { price: 4200, stock: 12, published: true } },
    { sku: 'b', after: { price: 3000, stock: 0, published: false } },
    { sku: 'c', after: { price: 9000, stock: 6, published: false } },
  ];
  const projection = projectCatalog({ products, planRows, alcoholOpen: false, minProducts: 1 });
  assert.deepEqual({ p: projection.withPrice, s: projection.withStock, pub: projection.published }, { p: 2, s: 1, pub: 1 },
    'el alcohol cerrado no cuenta y stock 0 es agotado');
  assert.deepEqual(projection.statuses, { CATALOG_PRICES: 'pass', CATALOG_STOCK: 'pass', CATALOG_PUBLISHED: 'pass' });
  assert.deepEqual(projectCatalog({ products, planRows, minProducts: 5 }).statuses.CATALOG_PUBLISHED, 'pending');
  assert.deepEqual(projectedPending(today.items, projection.statuses),
    ['FULFILLMENT_MODE', 'SERVICE_HOURS', 'CATALOG_PHOTOS', 'PLATFORM_VERIFICATION']);
  assert.equal(parseDryRunArgs([]).sheet, 'catalog/opening/planilla-apertura-cp.csv');
});

test('opening:publish aplica sólo con una cuenta del comercio', () => {
  assert.equal(parsePublishArgs([]).apply, false);
  assert.throws(() => parsePublishArgs(['--apply']), /--credential/);
  assert.equal(parsePublishArgs(['--apply', '--credential', 'CP OWNER MARCO PANEL']).credential, 'CP OWNER MARCO PANEL');
  assert.throws(() => parsePublishArgs(['--apply', '--service-key']), /Flag desconocido/);
});

test('alcohol: la política se escribe completa con la sesión del comercio, nunca a medias', async () => {
  const { parseAlcoholArgs, policyPatch, ENABLE_PHRASE } = await import('../scripts/controlled-production/alcohol-policy.mjs');
  assert.equal(ENABLE_PHRASE, 'HABILITAR ALCOHOL');
  assert.deepEqual(parseAlcoholArgs(['status']), { command: 'status', business: 'la-taba-cp', credential: '' });
  assert.throws(() => parseAlcoholArgs(['apply', '--min-age', '18', '--start', '10:00', '--end', '23:00']), /--credential/);
  assert.throws(() => parseAlcoholArgs(['apply', '--credential', 'X', '--min-age', '17', '--start', '10:00', '--end', '23:00']), /18 a 99/);
  assert.throws(() => parseAlcoholArgs(['apply', '--credential', 'X', '--min-age', '18', '--start', '10:00', '--end', '10:00']), /distintas/);
  const apply = parseAlcoholArgs(['apply', '--credential', 'X', '--min-age', '18', '--start', '20:00', '--end', '02:00']);
  assert.deepEqual(policyPatch(apply), {
    alcohol_minimum_age: 18, alcohol_sales_start: '20:00', alcohol_sales_end: '02:00',
    alcohol_timezone: 'America/Argentina/Buenos_Aires', alcohol_sales_enabled: true,
  });
  assert.deepEqual(policyPatch(parseAlcoholArgs(['disable', '--credential', 'X'])), { alcohol_sales_enabled: false });
  assert.throws(() => parseAlcoholArgs(['enable']), /status, apply o disable/);
});
