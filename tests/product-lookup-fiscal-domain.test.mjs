import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateGtinCheckDigit } from '../js/catalog/barcode-normalizer.js';
import { createProductLookupService } from '../js/catalog/product-lookup-service.js';
import { approveProductDraft, createProductDraft } from '../js/catalog/product-draft-controller.js';
import { buildFiscalIntentKey, canRenderFiscalDocument, classifyFiscalResult, validateFiscalActivation } from '../js/core/fiscal-domain.js';

const code = `400638133393${calculateGtinCheckDigit('400638133393')}`;

test('lookup consulta local antes que remoto y registra procedencia', async () => {
  const calls = [];
  const service = createProductLookupService({ providers: [
    { name: 'LocalProductProvider', async lookup() { calls.push('local'); return { productId: 'p1', name: 'Producto local', unitFactor: 1, verified: true, confidence: 1 }; } },
    { name: 'TabaCatalogProvider', async lookup() { calls.push('remote'); return null; } },
  ] });
  const result = await service.lookup(code);
  assert.equal(result.kind, 'local_product');
  assert.equal(result.source, 'LocalProductProvider');
  assert.deepEqual(calls, ['local']);
});

test('lookup desconocido no inventa identificaci\u00f3n y permite borrador humano', async () => {
  const service = createProductLookupService({ providers: [{ name: 'TabaCatalogProvider', async lookup() { return null; } }] });
  const result = await service.lookup(code);
  assert.equal(result.kind, 'unknown');
  assert.equal(result.message, 'Producto no identificado autom\u00e1ticamente');
  const draft = createProductDraft(result, { businessId: 'b', operatorId: 'u', now: () => new Date('2026-08-02T10:00:00Z') });
  assert.equal(draft.status, 'pending_review');
  const approved = approveProductDraft(draft, { name: 'Confirmado por operador', category: 'energy_drinks', unitFactor: 1 }, { reviewerId: 'admin' });
  assert.equal(approved.status, 'approved');
});

test('fiscal producci\u00f3n exige aprobaci\u00f3n contable, gate y confirmaci\u00f3n', () => {
  const profile = { environment: 'production', cuit: '30000000007', pointOfSale: 1, taxCondition: 'configured', legalName: 'Synthetic SA', accountantReviewStatus: 'pending', productionGate: 'blocked' };
  assert.equal(validateFiscalActivation(profile).ok, false);
  const approved = { ...profile, accountantReviewStatus: 'approved', productionGate: 'approved' };
  assert.equal(validateFiscalActivation(approved, { operationalConfirmation: true }).ok, true);
});

test('resultado ARCA s\u00f3lo es autorizado con CAE v\u00e1lido', () => {
  assert.equal(classifyFiscalResult({ result: 'A' }), 'service_error');
  assert.equal(classifyFiscalResult({ result: 'A', cae: '12345678901234' }), 'authorized');
  assert.equal(classifyFiscalResult({ result: 'A', cae: '12345678901234', observations: [{ code: 1 }] }), 'authorized_with_observations');
  assert.equal(classifyFiscalResult({ ambiguous: true }), 'ambiguous');
  assert.equal(canRenderFiscalDocument({ state: 'authorized', cae: '12345678901234' }), true);
  assert.equal(canRenderFiscalDocument({ state: 'queued', cae: '12345678901234' }), false);
});

test('clave fiscal exactly-once vincula negocio, origen e intenci\u00f3n', () => {
  assert.equal(buildFiscalIntentKey({ businessId: 'b', sourceType: 'pos_sale', sourceId: 's1', documentIntent: 'invoice' }), 'b:pos_sale:s1:invoice');
});
