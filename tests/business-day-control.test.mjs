import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLOSURE_CONFIRMATION_PHRASE,
  CLOSURE_SECTIONS,
  evaluateBusinessOpening,
  evaluateDailyClosure,
  OPENING_CHECKS,
  validateClosureOverride,
} from '../js/business/business-day-control.js';
import { containsForbiddenVocabulary } from '../js/business/business-operation-language.js';

const ALL_OK = Object.freeze(Object.fromEntries(OPENING_CHECKS.map((id) => [id, { status: 'ok' }])));

test('la apertura revisa las ocho cosas pedidas', () => {
  assert.deepEqual([...OPENING_CHECKS], [
    'internet', 'backend', 'payments', 'fiscal', 'scanner', 'printers', 'riders', 'queues',
  ]);
  assert.equal(evaluateBusinessOpening(ALL_OK).checks.length, 8);
});

test('con todo verificado el veredicto es que se puede vender', () => {
  const result = evaluateBusinessOpening(ALL_OK);
  assert.equal(result.verdict.headline, 'Todo listo para vender');
  assert.equal(result.canSell, true);
  assert.equal(result.canCharge, true);
  assert.equal(result.canInvoice, true);
});

test('sin facturación se puede vender, pero se avisa', () => {
  const result = evaluateBusinessOpening({ ...ALL_OK, fiscal: { status: 'failed', detail: 'El certificado venció.' } });
  assert.equal(result.verdict.headline, 'Podés vender, facturación pendiente');
  assert.equal(result.canSell, true);
  assert.equal(result.canInvoice, false);
});

test('si falla algo esencial el veredicto frena los cobros', () => {
  const result = evaluateBusinessOpening({ ...ALL_OK, payments: { status: 'failed', detail: 'No responde.' } });
  assert.equal(result.verdict.headline, 'No habilites cobros');
  assert.equal(result.canCharge, false);
  assert.equal(result.blockers.length, 1);
});

test('lo que no se pudo verificar no se asume bueno', () => {
  const result = evaluateBusinessOpening({ ...ALL_OK, backend: { status: 'unknown' } });
  assert.equal(result.verdict.headline, 'No habilites cobros');
  assert.equal(result.checks.find((check) => check.id === 'backend').statusLabel, 'Sin verificar');
});

test('un chequeo no esencial degradado no frena la venta', () => {
  const result = evaluateBusinessOpening({ ...ALL_OK, printers: { status: 'failed', detail: 'Sin papel.' } });
  assert.equal(result.canSell, true);
  assert.equal(result.verdict.headline, 'Todo listo para vender');
});

test('la apertura habla en castellano llano', () => {
  for (const check of evaluateBusinessOpening({}).checks) {
    assert.deepEqual(containsForbiddenVocabulary(`${check.label} ${check.why} ${check.detail} ${check.statusLabel}`), []);
  }
});

test('el cierre resume las nueve secciones pedidas', () => {
  assert.deepEqual([...CLOSURE_SECTIONS], [
    'sales', 'mercadopago', 'cash', 'refunds', 'orders', 'stock', 'documents', 'differences', 'pending',
  ]);
  const closure = evaluateDailyClosure({ cash_difference: 0, declared_cash: 1000, snapshot: {} });
  assert.equal(closure.sections.length, 9);
  for (const section of closure.sections) {
    assert.deepEqual(containsForbiddenVocabulary(`${section.label} ${section.detail}`), []);
  }
});

test('una diferencia de caja sin explicación bloquea el cierre', () => {
  const closure = evaluateDailyClosure({ cash_difference: -2500, difference_note: '' });
  assert.equal(closure.canClose, false);
  assert.equal(closure.blockers[0].id, 'cash-difference');
  assert.match(closure.blockers[0].detail, /2\.500/);
});

test('con la diferencia explicada el cierre se destraba', () => {
  const closure = evaluateDailyClosure({ cash_difference: -2500, difference_note: 'Faltó un vuelto que se repuso mañana.' });
  assert.equal(closure.canClose, true);
  assert.equal(closure.hasDifference, true);
});

test('no se puede cerrar en silencio con problemas críticos abiertos', () => {
  const closure = evaluateDailyClosure({ cash_difference: 0 }, {
    alerts: [{ severity: 'CRITICAL', status: 'open' }, { severity: 'WARNING', status: 'open' }],
  });
  assert.equal(closure.canClose, false);
  assert.equal(closure.criticalAlerts, 1);
  assert.equal(closure.blockers[0].id, 'critical-alerts');
});

test('cerrar con problemas abiertos exige explicación y confirmación escrita', () => {
  assert.equal(validateClosureOverride({ criticalAlerts: 0 }).ok, true);
  assert.equal(validateClosureOverride({ criticalAlerts: 1, note: 'corto', confirmation: CLOSURE_CONFIRMATION_PHRASE }).ok, false);
  assert.equal(validateClosureOverride({ criticalAlerts: 1, note: 'Se reconcilia mañana con el contador.', confirmation: 'si' }).ok, false);
  assert.match(
    validateClosureOverride({ criticalAlerts: 1, note: 'Se reconcilia mañana con el contador.', confirmation: 'si' }).message,
    /CERRAR IGUAL/,
  );
  assert.equal(
    validateClosureOverride({ criticalAlerts: 1, note: 'Se reconcilia mañana con el contador.', confirmation: 'cerrar igual' }).ok,
    true,
  );
});

test('el cierre muestra los importes del día tal como los devolvió el servidor', () => {
  const closure = evaluateDailyClosure({
    cash_difference: 0,
    declared_cash: 12_500,
    snapshot: {
      sales: { total: 98_000, count: 34 },
      payments: { approved_total: 61_000, approved_count: 21, refunded_total: 3_000, refunded_count: 1 },
      cash: { expected: 12_500 },
      orders: { total: 34, open: 2 },
      inventory: { movements: 57, negative: 0 },
      fiscal: { authorized: 30, pending: 4 },
    },
  });
  const byId = Object.fromEntries(closure.sections.map((section) => [section.id, section]));
  assert.match(byId.sales.value, /98\.000/);
  assert.match(byId.mercadopago.value, /61\.000/);
  assert.match(byId.refunds.value, /3\.000/);
  assert.equal(byId.orders.value, '34');
  assert.equal(byId.stock.value, '57');
  assert.equal(byId.documents.value, '30');
  assert.equal(byId.differences.tone, 'calm');
});
