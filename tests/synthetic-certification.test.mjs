import assert from 'node:assert/strict';
import test from 'node:test';
import { runCertification } from './synthetic/scenarios.mjs';

const certification = await runCertification();

for (const scenario of certification.scenarios) {
  test(`escenario ${scenario.id} · ${scenario.title}`, () => {
    const failed = scenario.checks.filter((entry) => !entry.ok);
    assert.deepEqual(
      failed.map((entry) => `${entry.name}: ${entry.detail}`),
      [],
      `${failed.length} comprobación(es) fallaron en ${scenario.title}`,
    );
    assert.ok(scenario.checks.length > 0, 'el escenario debe ejecutar comprobaciones');
  });
}

test('la jornada sintética deja el negocio limpio', () => {
  assert.equal(certification.cleanup.activeQaOrders, 0, 'no deben quedar pedidos QA activos');
  assert.equal(certification.cleanup.stockRestored, true, 'el stock QA debe volver a su valor inicial');
  assert.equal(certification.cleanup.openLocks, 0, 'no deben quedar locks abiertos');
  assert.equal(certification.cleanup.pendingQaOutbox, 0, 'no debe quedar cola QA pendiente');
  assert.equal(certification.cleanup.humanOperationsTouched, 0, 'ninguna operación humana debe haberse modificado');
  assert.equal(certification.cleanup.ok, true);
});

test('la certificación cubre los ocho escenarios y los permisos', () => {
  assert.deepEqual(
    certification.scenarios.map((scenario) => scenario.id),
    ['1', '2', '3', '4', '5', '6', '7', '8', 'P'],
  );
});
