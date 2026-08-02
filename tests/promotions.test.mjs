import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { beforeEach } from 'node:test';
import { addToCart, getCartSummary } from '../js/cart.js';
import {
  evaluatePromotions,
  findPromotionConflicts,
  getActivePromotions,
  isPromotionActive,
  normalizePromotion,
  validatePromotionForActivation,
} from '../js/core/promotions.js';
import { hydrateState } from '../js/state.js';
import { PREVIEW_PROMOTION_SEED } from '../js/preview-promotions-data.js';
import { resetState, state } from './helpers.mjs';

const NOW = new Date('2026-07-26T12:00:00.000Z');

function approvedPromotion(overrides = {}) {
  return {
    promoId: 'promo-coca-verified',
    title: 'Coca-Cola x6 con precio confirmado',
    subtitle: 'Condición comercial registrada',
    includedSkus: ['qa-promo-bebidas'],
    promotionType: 'precio_promocional',
    regularPrice: 5000,
    promotionalPrice: 4200,
    discountPercentage: null,
    requiredQuantity: 1,
    maximumUnits: null,
    validFrom: '2026-07-01',
    validUntil: '2026-07-31',
    active: true,
    priority: 10,
    imagePath: '',
    terms: 'Precio confirmado para una unidad.',
    previewOnly: true,
    approvalStatus: 'APROBADA',
    approvalReference: 'APROBACION-QA-2026-07-26',
    sourceEvidence: 'Registro comercial QA.',
    ...overrides,
  };
}

function item(productId, quantity, unitPrice = 5000) {
  return { product: { id: productId, price: unitPrice }, quantity };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'location', {
    value: { search: '?demo=1' },
    configurable: true,
  });
  resetState({ promotions: [] });
});

test('only an approved, dated and verified promotion can become active', () => {
  const active = approvedPromotion();
  assert.equal(validatePromotionForActivation(active).ok, true);
  assert.equal(isPromotionActive(active, NOW), true);

  const future = approvedPromotion({ promoId: 'future', validFrom: '2026-08-01', validUntil: '2026-08-31' });
  const expired = approvedPromotion({ promoId: 'expired', validFrom: '2026-06-01', validUntil: '2026-06-30' });
  const unapproved = approvedPromotion({ promoId: 'unapproved', approvalStatus: 'PENDIENTE', approvalReference: '' });

  assert.equal(isPromotionActive(future, NOW), false);
  assert.equal(isPromotionActive(expired, NOW), false);
  assert.equal(isPromotionActive(unapproved, NOW), false);
  assert.deepEqual(getActivePromotions([active, future, expired, unapproved], NOW).map((promotion) => promotion.promoId), ['promo-coca-verified']);
});

test('promotion valid range uses local day boundaries for YYYY-MM-DD values', () => {
  const localRange = approvedPromotion({
    promoId: 'local-day-range',
    validFrom: '2026-07-27',
    validUntil: '2026-07-31',
  });
  const beforeRange = new Date(2026, 6, 26, 23, 59, 59, 999);
  const startOfRange = new Date(2026, 6, 27, 0, 0, 0, 0);
  const endOfRange = new Date(2026, 6, 31, 23, 59, 59, 999);
  const afterRange = new Date(2026, 6, 31, 23, 59, 59, 999 + 1);

  assert.equal(isPromotionActive(localRange, beforeRange), false);
  assert.equal(isPromotionActive(localRange, startOfRange), true);
  assert.equal(isPromotionActive(localRange, endOfRange), true);
  assert.equal(isPromotionActive(localRange, afterRange), false);
});

test('promotion normalization never turns CSV false into a visible promotion', () => {
  const normalized = normalizePromotion({
    ...approvedPromotion(),
    active: 'false',
    previewOnly: 'false',
  });
  assert.equal(normalized.active, false);
  assert.equal(normalized.previewOnly, false);
  assert.equal(isPromotionActive(normalized, NOW), false);
});

test('fixed price and percentage promotions apply verified savings once per eligible unit', () => {
  const fixed = approvedPromotion();
  const percent = approvedPromotion({
    promoId: 'promo-sprite-percent',
    includedSkus: ['qa-gaseosa-cola'],
    promotionType: 'descuento_porcentaje',
    regularPrice: 5000,
    promotionalPrice: null,
    discountPercentage: 20,
    priority: 5,
  });
  const result = evaluatePromotions([
    item('qa-promo-bebidas', 2),
    item('qa-gaseosa-cola', 1),
  ], [fixed, percent], { now: NOW });

  assert.equal(result.discountTotal, 2600);
  assert.deepEqual(result.applied.map((promotion) => [promotion.promoId, promotion.discountAmount]), [
    ['promo-coca-verified', 1600],
    ['promo-sprite-percent', 1000],
  ]);
});

test('pack and required-quantity promotions respect bundle conditions and maximum benefited units', () => {
  const pack = approvedPromotion({
    promoId: 'promo-monster-pack',
    includedSkus: ['qa-energetica'],
    promotionType: 'pack',
    regularPrice: 15000,
    promotionalPrice: 12000,
    requiredQuantity: 3,
    maximumUnits: 6,
    priority: 20,
  });

  const underCondition = evaluatePromotions([item('qa-energetica', 2)], [pack], { now: NOW });
  assert.equal(underCondition.discountTotal, 0);
  assert.equal(underCondition.applied.length, 0);

  const eligible = evaluatePromotions([item('qa-energetica', 7, 5000)], [pack], { now: NOW });
  assert.equal(eligible.discountTotal, 6000);
  assert.deepEqual(eligible.applied[0], {
    promoId: 'promo-monster-pack',
    title: 'Coca-Cola x6 con precio confirmado',
    promotionType: 'pack',
    discountAmount: 6000,
    matchedQuantity: 6,
    bundles: 2,
    terms: 'Precio confirmado para una unidad.',
  });
});

test('free delivery and the centralized cart total use the active promotion state', () => {
  const freeDelivery = approvedPromotion({
    promoId: 'promo-delivery-verified',
    includedSkus: ['qa-promo-bebidas'],
    promotionType: 'envio_gratis',
    regularPrice: 5000,
    promotionalPrice: null,
    priority: 20,
    terms: 'Envío sin cargo confirmado.',
    validFrom: '2020-01-01',
    validUntil: '2099-12-31',
  });
  const fixed = approvedPromotion({
    priority: 10,
    validFrom: '2020-01-01',
    validUntil: '2099-12-31',
  });
  resetState({ promotions: [freeDelivery, fixed] });
  assert.equal(addToCart('qa-promo-bebidas').ok, true);

  const summary = getCartSummary('delivery');
  assert.equal(summary.subtotal, 5000);
  assert.equal(summary.discountTotal, 800);
  assert.equal(summary.deliveryFee, 0);
  assert.equal(summary.total, 4200);
  assert.deepEqual(summary.promotions.map((promotion) => promotion.promoId), [
    'promo-delivery-verified',
    'promo-coca-verified',
  ]);
});

test('free delivery promotion validates without regularPrice but still needs SKUs, dates, and approval', () => {
  const freeDelivery = approvedPromotion({
    promoId: 'free-delivery-without-regular',
    promotionType: 'envio_gratis',
    regularPrice: null,
    promotionalPrice: null,
    discountPercentage: null,
    includedSkus: ['qa-gaseosa-cola'],
  });
  assert.equal(validatePromotionForActivation(freeDelivery).ok, true);
  assert.equal(validatePromotionForActivation({
    ...freeDelivery,
    includedSkus: [],
  }).ok, false);
  assert.equal(validatePromotionForActivation({
    ...freeDelivery,
    validFrom: '',
    validUntil: '',
  }).ok, false);
  assert.equal(validatePromotionForActivation({
    ...freeDelivery,
    approvalStatus: 'PENDIENTE',
    approvalReference: '',
  }).ok, false);
});

test('sandbox promotions persist through state hydration and conflicts are detected before activation', () => {
  const active = approvedPromotion();
  const hydrated = hydrateState({
    ...state(),
    promotions: [active],
  }, state());
  assert.equal(hydrated.promotions[0].promoId, active.promoId);
  assert.equal(isPromotionActive(hydrated.promotions[0], NOW), true);

  const overlapping = approvedPromotion({ promoId: 'promo-overlap', promotionType: 'descuento_porcentaje', discountPercentage: 10, promotionalPrice: null });
  assert.deepEqual(findPromotionConflicts(overlapping, [active]).map((promotion) => promotion.promoId), ['promo-coca-verified']);
});

test('conflicts use the same day boundaries and detect boundary overlaps', () => {
  const seed = approvedPromotion({
    promoId: 'seed',
    validFrom: '2026-07-10',
    validUntil: '2026-07-20',
  });

  const overlapAtStart = approvedPromotion({
    promoId: 'overlap-start',
    validFrom: '2026-07-01',
    validUntil: '2026-07-10',
    promotionType: 'descuento_porcentaje',
    discountPercentage: 10,
    promotionalPrice: null,
  });
  const overlapAtEnd = approvedPromotion({
    promoId: 'overlap-end',
    validFrom: '2026-07-20',
    validUntil: '2026-07-25',
    promotionType: 'descuento_porcentaje',
    discountPercentage: 10,
    promotionalPrice: null,
  });
  const noOverlap = approvedPromotion({
    promoId: 'no-overlap',
    validFrom: '2026-07-21',
    validUntil: '2026-07-25',
    promotionType: 'descuento_porcentaje',
    discountPercentage: 10,
    promotionalPrice: null,
  });

  assert.deepEqual(findPromotionConflicts(overlapAtStart, [seed]).map((promotion) => promotion.promoId), ['seed']);
  assert.deepEqual(findPromotionConflicts(overlapAtEnd, [seed]).map((promotion) => promotion.promoId), ['seed']);
  assert.deepEqual(findPromotionConflicts(noOverlap, [seed]).map((promotion) => promotion.promoId), []);
});

test('the versioned CSV only seeds inactive promotion candidates until confirmation exists', async () => {
  const source = await readFile(new URL('../data/preview-promotions.csv', import.meta.url), 'utf8');
  const csvIds = [...source.matchAll(/^(promo-[^,]+)/gm)].map((match) => match[1]);
  assert.deepEqual(PREVIEW_PROMOTION_SEED.map((promotion) => promotion.promoId), csvIds);
  assert.equal(PREVIEW_PROMOTION_SEED.every((promotion) => promotion.active === false), true);
  assert.equal(getActivePromotions(PREVIEW_PROMOTION_SEED, NOW).length, 0);
});
