import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStorefrontPreview,
  describeDraft,
  describePublishReadiness,
  ONBOARDING_STEPS,
  planScanOutcome,
  stepsForDraft,
  validateProductDraft,
} from '../js/business/business-product-onboarding.js';
import { containsForbiddenVocabulary } from '../js/business/business-operation-language.js';

const VALID_FIELDS = Object.freeze({
  name: 'Gaseosa cola',
  brand: 'Marca Norte',
  category: 'Gaseosas',
  variant: 'Botella 1,5 L',
  capacityValue: 1.5,
  capacityUnit: 'l',
  packageType: 'unit',
  unitsPerPack: 1,
  stock: 24,
  price: 2500,
  cost: 1600,
  pricePending: false,
});

test('un código desconocido abre un borrador y nunca publica solo', () => {
  const plan = planScanOutcome({ scan: { isValid: true, normalizedValue: '7790895000997', format: 'EAN-13' }, lookup: null });
  assert.equal(plan.outcome, 'unknown');
  assert.equal(plan.canCreateDraft, true);
  assert.equal(plan.step, 'complete');
  assert.match(plan.detail, /Falta completar/i);
});

test('un código ya cargado lleva al producto existente en vez de duplicarlo', () => {
  const plan = planScanOutcome({
    scan: { isValid: true, normalizedValue: '7790895000997', format: 'EAN-13' },
    lookup: { product_id: 'p-1', unit_factor: 6, products: [{ id: 'p-1', name: 'Cerveza rubia', brand: 'Norte', stock: 12 }] },
  });
  assert.equal(plan.outcome, 'existing');
  assert.equal(plan.canCreateDraft, false);
  assert.equal(plan.product.name, 'Cerveza rubia');
});

test('una lectura inválida explica el motivo y no ofrece crear nada', () => {
  const plan = planScanOutcome({ scan: { isValid: false, reason: 'INVALID_CHECK_DIGIT' } });
  assert.equal(plan.canCreateDraft, false);
  assert.match(plan.detail, /etiqueta está dañada/i);
});

test('el borrador queda con código, formato, fecha, usuario y estado explícito', () => {
  const draft = describeDraft({
    id: 'd-1',
    scanned_gtin: '7790895000997',
    created_at: '2026-08-04T10:00:00.000Z',
    suggested_name: 'Gaseosa',
  }, { operatorName: 'Walter' });
  assert.equal(draft.status, 'Falta completar');
  assert.equal(draft.format, 'EAN-13');
  assert.equal(draft.createdBy, 'Walter');
  assert.equal(draft.createdAt, '2026-08-04T10:00:00.000Z');
  assert.equal(draft.suggestions.name, 'Gaseosa');
  assert.equal(draft.hasSuggestions, true);
});

test('no se inventa nombre, marca, categoría ni precio', () => {
  const result = validateProductDraft({ ...VALID_FIELDS, name: '', brand: '', category: '', price: 0, pricePending: false });
  assert.equal(result.ok, false);
  const fields = result.errors.map((error) => error.field);
  for (const field of ['name', 'brand', 'category', 'price']) {
    assert.ok(fields.includes(field), `debería exigir ${field}`);
  }
});

test('el factor de pack se valida contra el tipo de presentación', () => {
  assert.equal(validateProductDraft({ ...VALID_FIELDS, packageType: 'unit', unitsPerPack: 6 }).ok, false);
  assert.equal(validateProductDraft({ ...VALID_FIELDS, packageType: 'pack', unitsPerPack: 1 }).ok, false);
  assert.equal(validateProductDraft({ ...VALID_FIELDS, packageType: 'pack', unitsPerPack: 6 }).ok, true);
  assert.equal(validateProductDraft({ ...VALID_FIELDS, unitsPerPack: 0 }).ok, false);
});

test('un código ya asignado a otro producto no se deja reutilizar', () => {
  const result = validateProductDraft(VALID_FIELDS, { existingGtinOwner: 'Cerveza rubia 1 L' });
  assert.equal(result.ok, false);
  const error = result.errors.find((entry) => entry.field === 'gtin');
  assert.match(error.message, /Cerveza rubia 1 L/);
  assert.match(error.message, /no puede apuntar a dos productos/i);
});

test('precio pendiente y precio cargado son excluyentes', () => {
  assert.equal(validateProductDraft({ ...VALID_FIELDS, pricePending: true, price: 2500 }).ok, false);
  const pending = validateProductDraft({ ...VALID_FIELDS, pricePending: true, price: 0 });
  assert.equal(pending.ok, true);
  assert.equal(pending.value.price, null);
});

test('se avisa si el costo cargado deja la venta a pérdida', () => {
  const result = validateProductDraft({ ...VALID_FIELDS, cost: 3000 });
  assert.equal(result.ok, false);
  assert.match(result.errors.find((error) => error.field === 'cost').message, /pérdida/i);
});

test('el costo es opcional', () => {
  assert.equal(validateProductDraft({ ...VALID_FIELDS, cost: '' }).ok, true);
  assert.equal(validateProductDraft({ ...VALID_FIELDS, cost: '' }).value.cost, null);
});

test('los datos válidos se normalizan para el servidor', () => {
  const result = validateProductDraft({ ...VALID_FIELDS, price: '2500.559', capacityValue: '1.5001' });
  assert.equal(result.ok, true);
  assert.equal(result.value.price, 2500.56);
  assert.equal(result.value.capacityValue, 1.5);
  assert.equal(result.value.capacity, '1.5 l');
  assert.equal(result.value.presentation, 'Botella 1,5 L');
});

test('con precio pendiente la vista previa muestra el producto sin permitir comprarlo', () => {
  const value = validateProductDraft({ ...VALID_FIELDS, pricePending: true, price: 0 }).value;
  const preview = buildStorefrontPreview(value, { imageReady: true });
  assert.equal(preview.priceLabel, 'Precio pendiente');
  assert.equal(preview.purchasable, false);
  assert.equal(preview.availabilityLabel, 'Visible, no se puede comprar');
  assert.ok(preview.blockers.some((blocker) => /nadie va a poder comprarlo/i.test(blocker)));
});

test('la vista previa avisa lo que falta antes de publicar', () => {
  const value = validateProductDraft(VALID_FIELDS).value;
  const preview = buildStorefrontPreview(value, { imageReady: false });
  assert.equal(preview.purchasable, false);
  assert.ok(preview.blockers.some((blocker) => /foto aprobada/i.test(blocker)));

  const ready = buildStorefrontPreview(value, { imageReady: true });
  assert.equal(ready.purchasable, true);
  assert.deepEqual([...ready.blockers], []);
  assert.equal(ready.subtitle, 'Marca Norte · Botella 1,5 L');
});

test('el estado de publicación enumera exactamente lo que falta', () => {
  const readiness = describePublishReadiness({
    details_complete: true, image_bound: false, barcode_bound: true,
    price_status: 'pending', stock_positive: true, visible: false, purchasable: false,
  });
  assert.equal(readiness.headline, 'Todavía no aparece en la web');
  assert.equal(readiness.missing.length, 2);
  assert.deepEqual(containsForbiddenVocabulary(readiness.missing.join(' ')), []);

  const live = describePublishReadiness({
    details_complete: true, image_bound: true, barcode_bound: true,
    price_status: 'confirmed', stock_positive: true, visible: true, purchasable: true, published: true,
  });
  assert.equal(live.headline, 'Está a la venta en la web');
  assert.deepEqual([...live.missing], []);
});

test('los pasos del alta se muestran en orden con el actual marcado', () => {
  assert.deepEqual([...ONBOARDING_STEPS], ['scan', 'match', 'complete', 'review', 'publish']);
  const steps = stepsForDraft('review');
  assert.deepEqual(steps.map((step) => step.state), ['done', 'done', 'done', 'current', 'waiting']);
  for (const step of steps) {
    assert.deepEqual(containsForbiddenVocabulary(`${step.title} ${step.detail}`), []);
  }
});
