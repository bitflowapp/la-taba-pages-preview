// Certificador e-commerce: la fase de rendimiento sin red (percentiles, pasos de carga, la regla de los techos y
// la compuerta contra el archivo versionado), la clasificación de respuestas del runtime de Edge y la forma del
// workflow que corre el certificador contra el stack efímero.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { STAGING_ROLE_SETTINGS } from '../scripts/e2e-staging/ecommerce/env.mjs';
import { createBudget, percentile, pool, summarize } from '../scripts/e2e-staging/ecommerce/http.mjs';
import {
  GATE, THRESHOLDS_FILE, THRESHOLD_RULE, ceilingFor, evaluateGate, proposeThresholds, readThresholds, roleTimeouts, runStep, stepName, stepResult, timeoutMs,
} from '../scripts/e2e-staging/ecommerce/load.mjs';
import { OPERATIONS } from '../scripts/e2e-staging/ecommerce/phases/performance.mjs';
import { edgeFunctionNames, runtimeFailure } from '../scripts/e2e-staging/ecommerce/phases/edge-functions.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const ok = (ms) => ({ ok: true, status: 200, ms });
const bad = (status, code, ms = 1) => ({ ok: false, status, code, ms });

test('percentiles por rango más cercano', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.deepEqual([percentile(values, 0.5), percentile(values, 0.95), percentile(values, 0.99), percentile(values, 1), percentile([], 0.5)], [50, 95, 99, 100, null]);
  assert.deepEqual(summarize([3, 1, 2]), { n: 3, min: 1, p50: 2, p95: 3, p99: 3, max: 3, mean: 2 });
  assert.equal(summarize([]).p95, null);
});

test('un paso de carga: la latencia es la de las respuestas buenas y los errores se cuentan por estado y código', async () => {
  const answers = [ok(10), ok(20), bad(500, '57014'), null, bad(0, 'TimeoutError')];
  const result = stepResult({ operation: 'order_creation_cash', concurrency: 10, answers, wallMs: 1000, peak: 4 });
  assert.deepEqual([result.step, result.requests, result.ok, result.errors, result.p50, result.p95, result.perSecond, result.peakInFlight],
    ['c10', 4, 2, 2, 10, 20, 4, 4], 'una cadena cortada antes de esta operación (null) no es una request');
  assert.deepEqual(result.statuses, { 200: 2, '500 57014': 1, '0 TimeoutError': 1 });
  assert.deepEqual([stepName(1), stepName(30)], ['baseline', 'c30']);
  let inFlight = 0;
  let peak = 0;
  const step = await runStep({ operation: 'catalog_read', concurrency: 3, items: Array.from({ length: 9 }, (_, i) => i), maxConcurrency: 100,
    task: async () => { inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return ok(5); } });
  assert.deepEqual([step.requests, step.ok, step.peakInFlight, peak <= 3], [9, 9, 3, true]);
  await assert.rejects(() => pool([1], 31, async () => 1), /CONCURRENCY_OUT_OF_BOUNDS:31/, 'el tope por defecto es el del entorno compartido');
  assert.equal((await pool([1, 2], 100, async (x) => x * 2, 100))[1], 4);
  const budget = createBudget(10, 8);
  assert.equal(budget.take(2), 10);
  assert.throws(() => budget.take(1), /LOAD_BUDGET_EXCEEDED:11>10/);
});

test('LA REGLA de los techos: p95 × 3, redondeado a 50 ms, piso 250 ms, nunca por encima del límite del rol', () => {
  assert.deepEqual(THRESHOLD_RULE, { metric: 'p95_ms', multiplier: 3, round_up_to_ms: 50, floor_ms: 250, cap: 'statement_timeout of the role that makes the call' });
  assert.equal(ceilingFor(10), 250, 'piso');
  assert.equal(ceilingFor(101), 350, '303 → 350');
  assert.equal(ceilingFor(1000, 3000), 3000, 'tope: el statement_timeout del rol');
  assert.equal(ceilingFor(2000, 8000), 6000);
  assert.equal(ceilingFor(null), null);
  assert.deepEqual([timeoutMs('3s'), timeoutMs('8000ms'), timeoutMs('2min'), timeoutMs('0'), timeoutMs('raro')], [3000, 8000, 120000, null, null]);
  assert.deepEqual(roleTimeouts(STAGING_ROLE_SETTINGS), { anon: 3000, authenticated: 8000, service_role: 8000 }, 'service_role entra por authenticator');
  // Cada operación de la fase tiene el rol con el que llama: de ahí sale su tope.
  assert.deepEqual(Object.keys(OPERATIONS).sort(), ['catalog_read', 'checkout_creation', 'order_creation_cash', 'order_query', 'panel_query', 'payment_intent',
    'stock_commit_paid', 'tracking_query']);
  assert.ok(Object.values(OPERATIONS).every((role) => ['anon', 'authenticated', 'service_role'].includes(role)));
});

test('la propuesta de techos sale de la corrida medida y marca los que quedan en el límite', () => {
  const results = [
    { operation: 'catalog_read', step: 'baseline', ok: 30, p95: 40 },
    { operation: 'catalog_read', step: 'c100', ok: 100, p95: 2500 },
    { operation: 'panel_query', step: 'c100', ok: 0, p95: null },
  ];
  const proposed = proposeThresholds(results, { roles: OPERATIONS, timeouts: roleTimeouts(STAGING_ROLE_SETTINGS), runId: 'ecom-cert-stack-20261003-041500', measuredAt: 'x' });
  assert.deepEqual(proposed.operations, { catalog_read: { baseline: 250, c100: 3000 } }, 'sin una respuesta buena no hay de dónde sacar un techo');
  assert.deepEqual(proposed.at_timeout, ['catalog_read:c100']);
  assert.equal(proposed.run_id, 'ecom-cert-stack-20261003-041500');
});

test('la compuerta: sin techos mide y no decide; con techos, PASS o FAIL, y un techo sin medir es FAIL', () => {
  const results = [{ operation: 'catalog_read', step: 'baseline', ok: 30, p95: 40 }, { operation: 'tracking_query', step: 'c10', ok: 40, p95: 400 }];
  assert.equal(evaluateGate(results, null).verdict, GATE.NO_GATE);
  assert.equal(evaluateGate(results, { operations: {} }).verdict, GATE.NO_GATE);
  const pass = evaluateGate(results, { operations: { catalog_read: { baseline: 250 }, tracking_query: { c10: 500 } } });
  assert.deepEqual([pass.verdict, pass.checked, pass.violations], [GATE.PASS, 2, []]);
  const over = evaluateGate(results, { operations: { tracking_query: { c10: 300 } } });
  assert.deepEqual([over.verdict, over.violations[0].reason, over.withoutThreshold], [GATE.FAIL, 'p95 above its ceiling', ['catalog_read:baseline']]);
  const notMeasured = evaluateGate(results, { operations: { panel_query: { c100: 8000 } } });
  assert.deepEqual([notMeasured.verdict, notMeasured.notMeasured], [GATE.FAIL, ['panel_query:c100']]);
  assert.equal(evaluateGate(results, { operations: { catalog_read: { baseline: 0 } } }).verdict, GATE.FAIL, 'un techo que no es un número positivo no pasa');
});

test('el archivo de umbrales versionado: la misma regla que el código, y ningún destino con techos inventados', () => {
  const file = path.join(ROOT, THRESHOLDS_FILE);
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of ['metric', 'multiplier', 'round_up_to_ms', 'floor_ms']) assert.equal(document.rule[key], THRESHOLD_RULE[key], key);
  assert.deepEqual(Object.keys(document.targets).sort(), ['local', 'stack', 'staging']);
  assert.deepEqual(Object.keys(document.operations).sort(), Object.keys(OPERATIONS).sort());
  for (const kind of ['staging', 'local', 'stack']) {
    const { found, thresholds } = readThresholds(file, kind);
    assert.ok(found);
    // Un bloque presente tiene que tener la forma que lee la compuerta, y venir de una corrida (run_id).
    if (thresholds) assert.ok(thresholds.operations && thresholds.run_id, `targets.${kind} tiene que traer operations y run_id`);
  }
  assert.deepEqual(readThresholds(path.join(ROOT, 'no-existe.json'), 'stack'), { found: false, thresholds: null, rule: null });
});

test('Edge: las funciones del repo y qué respuesta es del runtime y no de la función', () => {
  const names = edgeFunctionNames(path.join(ROOT, 'supabase/functions'));
  assert.ok(names.length >= 10 && names.includes('mercadopago-webhook') && names.includes('mercadopago-create-checkout-session'));
  assert.ok(names.every((name) => !name.startsWith('_')), 'los módulos compartidos no son funciones');
  const answer = (status, body, text = '') => ({ status, body, text });
  assert.equal(runtimeFailure(answer(503, { code: 'BOOT_ERROR', message: 'Worker failed to boot (please check logs)' })), 'BOOT_ERROR');
  assert.equal(runtimeFailure(answer(500, { msg: 'InvalidWorkerCreation: worker boot error: Uncaught SyntaxError' })), 'boot error');
  assert.equal(runtimeFailure(answer(404, { msg: 'Function not found' })), 'function not found');
  assert.equal(runtimeFailure(answer(0, null)), 'no answer');
  // Las respuestas de las funciones mismas, también las de error, son de una función que arrancó.
  assert.equal(runtimeFailure(answer(503, { ok: false, code: 'PAYMENT_UNAVAILABLE' })), null);
  assert.equal(runtimeFailure(answer(409, { ok: false, code: 'PAYMENTS_NOT_ENABLED' })), null);
  assert.equal(runtimeFailure(answer(404, { code: 'ARTIFACT_NOT_AVAILABLE' })), null);
  assert.equal(runtimeFailure(answer(503, null, 'La conexión no está disponible.')), null);
  assert.equal(runtimeFailure(answer(401, { ok: false, code: 'AUTH_REQUIRED' })), null);
});

test('el workflow del stack: acciones fijadas por commit, sin secretos, el certificador corre y su FAIL hace fallar el job', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/ecommerce-stack-certification.yml'), 'utf8');
  const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./, 'ningún secreto del repositorio');
  const uses = [...workflow.matchAll(/^\s+uses:\s+(\S+)/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 4);
  for (const action of uses) {
    assert.match(action, /@[0-9a-f]{40}$/, `${action} tiene que estar fijada por commit`);
    assert.ok(ci.includes(action), `${action}: el mismo commit que usa ci.yml`);
  }
  assert.ok(uses.some((action) => action.startsWith('actions/upload-artifact@')));
  assert.match(workflow, /SUPABASE_CLI_VERSION: '2\.101\.0'/);
  assert.match(workflow, /--target stack --confirm STACK_MUTATION_OK/);
  assert.match(workflow, /--summarize "\$RUNNER_TEMP\/ecommerce-stack-evidence"[^\n]*GITHUB_STEP_SUMMARY/);
  // Resumen, evidencia y apagado corren siempre; el paso del certificador no se disculpa: su código de salida manda.
  for (const step of ['Certification summary', 'Upload certification evidence', 'Stop the stack']) {
    assert.match(workflow, new RegExp(`- name: ${step}\\n\\s+if: \\$\\{\\{ always\\(\\) \\}\\}`), step);
  }
  assert.doesNotMatch(workflow, /continue-on-error/);
  // Las claves del stack no se escriben en GITHUB_ENV ni se imprimen.
  assert.doesNotMatch(workflow, />>\s*"?\$\{?GITHUB_ENV/);
  assert.match(workflow, /::add-mask::/);
  assert.doesNotMatch(workflow, /echo[^\n]*\$(anon_key|service_key|db_url)\b(?!")/);
  assert.match(workflow, /TABA_STACK_API_URL="\$api_url" TABA_STACK_ANON_KEY="\$anon_key" TABA_STACK_SERVICE_ROLE_KEY="\$service_key" TABA_STACK_DB_URL="\$db_url"/);
});
