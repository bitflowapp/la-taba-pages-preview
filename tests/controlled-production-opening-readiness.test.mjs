import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateOpeningReadiness } from '../scripts/controlled-production/opening-readiness.mjs';

const closedBusiness = {
  slug: 'la-taba-cp', status: 'closed', is_active: true, operating_timezone: 'America/Argentina/Buenos_Aires',
  hours_enforced: true, delivery_enabled: false, pickup_enabled: false, minimum_delivery_subtotal: null,
  ordering_enabled: false, ordering_verified: false, alcohol_sales_enabled: false, alcohol_minimum_age: null,
  alcohol_sales_start: null, alcohol_sales_end: null, alcohol_timezone: null,
};
const draft = (sku, extra = {}) => ({ sku, is_active: true, is_alcoholic: false, available: false, price: null,
  price_status: 'pending', stock: null, catalog_asset_id: null, image_url: null, ...extra });
const ready = (sku, extra = {}) => draft(sku, { price: 4200, price_status: 'confirmed', stock: 12,
  catalog_asset_id: `asset-${sku}`, image_url: `https://cdn.example/${sku}.webp`, ...extra });
const owner = { role: 'owner', is_active: true };
const status = (result, id) => result.items.find((item) => item.id === id)?.status;

test('el negocio real de hoy no está listo y dice exactamente qué falta', () => {
  const result = evaluateOpeningReadiness({ business: closedBusiness, products: [draft('a'), draft('b', { is_alcoholic: true })], members: [owner] });
  assert.equal(result.readyForCanary, false);
  assert.deepEqual(result.pending, ['FULFILMENT_MODE', 'SERVICE_HOURS', 'PRODUCT_PHOTOS', 'PRODUCT_PRICES',
    'PRODUCT_STOCK', 'PRODUCTS_PUBLISHED', 'PLATFORM_VERIFICATION']);
  assert.equal(status(result, 'ALCOHOL_POLICY'), 'INFO');
  assert.equal(result.counts.sellableWithoutAlcohol, 1);
});

test('un canary con retiro, franjas, cinco productos publicados y verificación queda listo', () => {
  const business = { ...closedBusiness, pickup_enabled: true, ordering_enabled: true, ordering_verified: true };
  const products = ['a', 'b', 'c', 'd', 'e'].map((sku) => ready(sku, { available: true }));
  const result = evaluateOpeningReadiness({ business, hours: [{ channel: 'pickup', weekday: 5 }], products, members: [owner] });
  assert.equal(result.readyForCanary, true, JSON.stringify(result.pending));
  assert.equal(result.items.some((item) => item.id === 'RIDERS'), false, 'retiro sólo no exige riders');
  assert.equal(status(result, 'STORE_OPEN'), 'INFO', 'abrir sigue siendo el botón del dueño');
});

test('delivery exige zona con costo, mínimo y al menos un rider', () => {
  const business = { ...closedBusiness, delivery_enabled: true };
  const result = evaluateOpeningReadiness({ business, hours: [{ channel: 'delivery', weekday: 1 }],
    zones: [{ is_active: false, delivery_fee: 1200, minimum_subtotal: 6000 }], members: [owner] });
  for (const id of ['DELIVERY_ZONES', 'DELIVERY_MINIMUM', 'RIDERS']) assert.equal(status(result, id), 'PENDING', id);
  const fixed = evaluateOpeningReadiness({ business, hours: [{ channel: 'delivery', weekday: 1 }],
    zones: [{ is_active: true, delivery_fee: 1200, minimum_subtotal: null }], members: [owner, { role: 'rider', is_active: true }] });
  assert.equal(status(fixed, 'DELIVERY_ZONES'), 'PASS');
  assert.equal(status(fixed, 'DELIVERY_MINIMUM'), 'PENDING', 'una zona sin mínimo y un negocio sin mínimo no alcanzan');
  assert.equal(status(fixed, 'RIDERS'), 'PASS');
});

test('las franjas se piden por cada canal habilitado', () => {
  const business = { ...closedBusiness, delivery_enabled: true, pickup_enabled: true };
  const result = evaluateOpeningReadiness({ business, hours: [{ channel: 'pickup', weekday: 2 }], members: [owner] });
  assert.equal(status(result, 'SERVICE_HOURS'), 'PENDING');
  assert.match(result.items.find((item) => item.id === 'SERVICE_HOURS').detail, /delivery/);
});

test('sin horario exigido avisa, pero no bloquea', () => {
  const result = evaluateOpeningReadiness({ business: { ...closedBusiness, hours_enforced: false }, members: [owner] });
  const hours = result.items.find((item) => item.id === 'SERVICE_HOURS');
  assert.equal(hours.status, 'WARN');
  assert.equal(hours.blocking, false);
  assert.equal(result.pending.includes('SERVICE_HOURS'), false);
});

test('el alcohol sólo cuenta como vendible con la política completa', () => {
  const alcoholic = ['a', 'b', 'c', 'd', 'e'].map((sku) => ready(sku, { is_alcoholic: true }));
  const closed = evaluateOpeningReadiness({ business: closedBusiness, products: alcoholic, members: [owner] });
  assert.equal(closed.counts.readyToPublish, 0);
  assert.equal(status(closed, 'PRODUCT_PHOTOS'), 'PENDING');
  const policy = { alcohol_sales_enabled: true, alcohol_minimum_age: 18, alcohol_sales_start: '10:00',
    alcohol_sales_end: '23:00', alcohol_timezone: 'America/Argentina/Buenos_Aires' };
  const open = evaluateOpeningReadiness({ business: { ...closedBusiness, ...policy }, products: alcoholic, members: [owner] });
  assert.equal(open.counts.readyToPublish, 5);
  assert.equal(status(open, 'ALCOHOL_POLICY'), 'PASS');
});

test('la verificación de plataforma se evalúa después de todo lo demás', () => {
  const result = evaluateOpeningReadiness({ business: closedBusiness, members: [owner] });
  assert.equal(result.blockingPendingBeforeVerification.includes('PLATFORM_VERIFICATION'), false);
  assert.equal(result.pending.at(-1), 'PLATFORM_VERIFICATION');
});
