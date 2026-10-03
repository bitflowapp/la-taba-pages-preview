// Certificador e-commerce (scripts/e2e-staging/ecommerce-certification.mjs): argumentos, confirmaciones por
// destino, identificadores de corrida, el negocio de cada corrida, veredictos, la regla del código de salida,
// la tabla de rechazos y el resumen. Sin red y sin base: sólo funciones puras y objetos armados acá.
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSummary, main, parseArgs, renderSummary } from '../scripts/e2e-staging/ecommerce/cli.mjs';
import {
  CONFIRMATIONS, RUN_ID_PATTERNS, RUN_ID_PREFIXES, TARGET_KINDS, TENANT_NAME_PREFIXES, VERDICTS, createRecorder, exitCodeFor, newRunId, skipReason,
  tenantIdentity, unavailableVerdict,
} from '../scripts/e2e-staging/ecommerce/env.mjs';
import { CODES, REFUSAL_STATUS, hidden, refusal, refusalStatus, refused } from '../scripts/e2e-staging/ecommerce/http.mjs';
import { PHASE_IDS } from '../scripts/e2e-staging/ecommerce/phases/index.mjs';

const at = new Date('2026-10-03T04:15:00Z');

test('cada destino tiene su confirmación y ninguna habilita a otro', () => {
  assert.deepEqual(TARGET_KINDS, ['staging', 'local', 'stack']);
  assert.deepEqual(CONFIRMATIONS, { staging: 'STAGING_MUTATION_OK', local: 'LOCAL_MUTATION_OK', stack: 'STACK_MUTATION_OK' });
  for (const target of TARGET_KINDS) {
    const own = parseArgs(['--target', target, '--confirm', CONFIRMATIONS[target]]);
    assert.deepEqual([own.mode, own.target], ['run', target]);
    for (const other of TARGET_KINDS.filter((kind) => kind !== target)) {
      assert.throws(() => parseArgs(['--target', target, '--confirm', CONFIRMATIONS[other]]), /CONFIRMATION_IS_FOR_ANOTHER_TARGET/, `${other} -> ${target}`);
    }
    assert.throws(() => parseArgs(['--target', target]), /EXPLICIT_CONFIRMATION_REQUIRED/);
    assert.throws(() => parseArgs(['--target', target, '--confirm', 'yes']), /EXPLICIT_CONFIRMATION_REQUIRED/);
    assert.equal(parseArgs(['--target', target, '--preflight']).mode, 'preflight');
    assert.equal(parseArgs(['--target', target, '--reconcile', 'dir']).mode, 'reconcile');
  }
  // Sin --target es Staging, y su confirmación es la única que vale ahí.
  assert.equal(parseArgs(['--confirm', 'STAGING_MUTATION_OK']).target, 'staging');
  assert.throws(() => parseArgs(['--confirm', 'STACK_MUTATION_OK']), /CONFIRMATION_IS_FOR_ANOTHER_TARGET/);
  assert.throws(() => parseArgs(['--target', 'production', '--preflight']), /UNKNOWN_TARGET:production/);
  assert.throws(() => parseArgs(['--target']), /UNKNOWN_TARGET/);
});

test('fases, minutos, nombre del negocio y modos de sólo lectura', () => {
  const run = (...args) => parseArgs(['--target', 'stack', '--confirm', 'STACK_MUTATION_OK', ...args]);
  assert.deepEqual(run('--phases', 'performance,catalog,abuse').phases, ['catalog', 'abuse', 'performance'], 'en el orden del registro');
  assert.throws(() => run('--phases', 'catalog,nope'), /UNKNOWN_PHASES:nope/);
  assert.throws(() => run('--phases', ''), /UNKNOWN_PHASES/);
  assert.equal(run().maxMinutes, 30);
  assert.equal(run('--max-minutes', '60').maxMinutes, 60);
  assert.throws(() => run('--max-minutes', '120'), /MAX_MINUTES_OUT_OF_RANGE/);
  assert.deepEqual([run().signInGapMs, parseArgs(['--target', 'local', '--confirm', 'LOCAL_MUTATION_OK']).signInGapMs, parseArgs(['--confirm', 'STAGING_MUTATION_OK']).signInGapMs], [40, 1, 800]);
  assert.deepEqual([run('--tenant-name', 'X Y Z').tenantName, run('--tenant-slug', 'qa-propio').tenantSlug], ['X Y Z', 'qa-propio']);
  assert.throws(() => run('--reuse-tenant', 'a-b-c', '--tenant-slug', 'x-y-z'), /REUSE_TENANT_EXCLUDES_A_NEW_TENANT_NAME/);
  assert.throws(() => run('--tenant-name'), /TENANT_NAME_NEEDS_A_VALUE/);
  assert.deepEqual(parseArgs(['--summarize', 'evidencia']), { mode: 'summarize', evidenceDir: 'evidencia', target: null });
  assert.throws(() => parseArgs(['--summarize']), /SUMMARIZE_NEEDS_AN_EVIDENCE_DIRECTORY/);
  assert.throws(() => parseArgs(['--target', 'local', '--reconcile']), /RECONCILE_NEEDS_AN_EVIDENCE_DIRECTORY/);
});

test('el registro trae las fases nuevas, en un orden que deja la carga para el final', () => {
  for (const id of ['status', 'customer-cancel', 'rider', 'privacy', 'rls', 'trace', 'health', 'abuse', 'payments', 'lost-ack', 'edge-functions', 'expiry', 'performance']) {
    assert.ok(PHASE_IDS.includes(id), id);
  }
  assert.equal(PHASE_IDS.at(-1), 'performance');
  assert.ok(PHASE_IDS.indexOf('expiry') > PHASE_IDS.indexOf('abuse'));
  assert.equal(new Set(PHASE_IDS).size, PHASE_IDS.length);
});

test('el id de una corrida dice su destino y ningún patrón acepta el de otro', () => {
  const ids = Object.fromEntries(TARGET_KINDS.map((kind) => [kind, newRunId(at, RUN_ID_PREFIXES[kind])]));
  assert.deepEqual(ids, { staging: 'ecom-cert-20261003-041500', local: 'ecom-cert-local-20261003-041500', stack: 'ecom-cert-stack-20261003-041500' });
  for (const kind of TARGET_KINDS) {
    for (const other of TARGET_KINDS) assert.equal(RUN_ID_PATTERNS[kind].test(ids[other]), kind === other, `${kind} vs ${other}`);
  }
});

test('cada corrida crea su propio negocio; en Staging se llama TABA_ECOMMERCE_FINAL_<fecha>_<hora>', () => {
  const staging = tenantIdentity({ kind: 'staging', runId: 'ecom-cert-20261003-041500' });
  assert.deepEqual([staging.name, staging.slug, staging.emailPrefix], ['TABA_ECOMMERCE_FINAL_20261003_041500', 'taba-ecommerce-final-20261003-041500', 'ecomcert-20261003041500-']);
  assert.equal(staging.operatorEmail('owner'), 'ecomcert-20261003041500-op-owner@example.invalid');
  assert.match(staging.runUserEmail('perf-001'), /^ecomcert-20261003041500-u-perf-001-[0-9a-f]{4}@example\.invalid$/);
  assert.deepEqual([staging.second.slug, staging.second.name], ['taba-ecommerce-final-20261003-041500-b', 'TABA_ECOMMERCE_FINAL_20261003_041500_B']);
  assert.equal(staging.throwawaySlugPrefix, 'taba-ecommerce-final-20261003-041500-x-');
  assert.deepEqual(TENANT_NAME_PREFIXES, { staging: 'TABA_ECOMMERCE_FINAL_', local: 'TABA_ECOMMERCE_LOCAL_', stack: 'TABA_ECOMMERCE_STACK_' });
  assert.equal(tenantIdentity({ kind: 'stack', runId: 'ecom-cert-stack-20261003-041500' }).name, 'TABA_ECOMMERCE_STACK_20261003_041500');
  assert.equal(tenantIdentity({ kind: 'local', runId: 'ecom-cert-local-20261003-041500' }).slug, 'taba-ecommerce-local-20261003-041500');
  // El id tiene que ser del destino: un negocio de Staging no nace de una corrida local.
  assert.throws(() => tenantIdentity({ kind: 'staging', runId: 'ecom-cert-local-20261003-041500' }), /RUN_ID_INVALID_FOR_TARGET/);
  // Otro nombre por bandera, y reusar uno sólo por su slug.
  assert.equal(tenantIdentity({ kind: 'staging', runId: 'ecom-cert-20261003-041500', name: 'TABA_ECOMMERCE_FINAL_MANUAL' }).name, 'TABA_ECOMMERCE_FINAL_MANUAL');
  const reused = tenantIdentity({ kind: 'staging', runId: 'ecom-cert-20261004-000000', slug: 'taba-ecommerce-final-20261003-041500' });
  assert.deepEqual([reused.name, reused.emailPrefix], [staging.name, staging.emailPrefix], 'el slug de otra corrida encuentra a sus mismos operadores');
  assert.throws(() => tenantIdentity({ kind: 'staging', runId: 'x', slug: 'otro-negocio' }), /TENANT_NAME_REQUIRED_FOR_A_CUSTOM_SLUG/);
  assert.throws(() => tenantIdentity({ kind: 'staging', runId: 'x', slug: 'Mal Slug!' }), /TENANT_SLUG_INVALID/);
  assert.equal(tenantIdentity({ kind: 'staging', runId: 'x', slug: 'qa-ecom-cert' }).name, 'QA ECOM CERT · no público');
});

test('veredictos: un salteo nunca es PASS ni FAIL, y un FAIL siempre cambia el código de salida', () => {
  const rec = createRecorder({ targetKind: 'stack' });
  rec.check('a', 'BIEN', true);
  rec.check('a', 'MAL', false, { x: 1 });
  rec.skipCheck('b', 'SIN_CONTRATO', 'order_trace');
  rec.skipOnTarget('c', 'SIN_CRON', 'pg_cron no corre');
  rec.notGated('d', 'COMPUERTA', 'MEASURED_NO_GATE: sin umbrales');
  rec.check('preflight', 'IDENTIDAD', false);
  rec.check('preflight', 'VERSION', false, null, null, { blocking: false });
  assert.deepEqual([rec.verdict('a'), rec.verdict('b'), rec.verdict('c'), rec.verdict('d'), rec.verdict('zzz')],
    ['FAIL', VERDICTS.SKIPPED, VERDICTS.NOT_AVAILABLE_ON_TARGET, VERDICTS.SKIPPED, VERDICTS.NOT_RUN]);
  assert.deepEqual(rec.counts(), { checks: 7, pass: 1, fail: 3, skipped: 2, notAvailableLocally: 0, notAvailableOnTarget: 1 });
  assert.deepEqual(rec.blockingFailures('preflight').map((c) => c.name), ['IDENTIDAD'], 'un hecho de fidelidad en FAIL no frena, pero cuenta');
  assert.equal(unavailableVerdict('local'), VERDICTS.NOT_AVAILABLE_LOCALLY);
  assert.equal(unavailableVerdict('stack'), VERDICTS.NOT_AVAILABLE_ON_TARGET);
  assert.equal(skipReason(rec.checks.find((c) => c.name === 'SIN_CONTRATO')), 'contrato no desplegado: order_trace');
  assert.equal(skipReason(rec.checks.find((c) => c.name === 'SIN_CRON')), 'pg_cron no corre');
  assert.match(skipReason(rec.checks.find((c) => c.name === 'COMPUERTA')), /performance_thresholds — MEASURED_NO_GATE/);
  // LA REGLA: 0 sólo sin FAIL, sin fase pedida que no corrió y sin error fatal.
  assert.equal(exitCodeFor({}), 0);
  assert.equal(exitCodeFor({ failed: 1 }), 1);
  assert.equal(exitCodeFor({ notRun: 1 }), 1);
  assert.equal(exitCodeFor({ fatal: 'X' }), 1);
});

test('LA TABLA de rechazos: estado y código juntos, y los hallazgos abiertos clavados en un solo lugar', () => {
  // Cada código con nombre tiene su estado en la tabla: ninguna fase afirma un estado por fuera de ella.
  for (const [name, code] of Object.entries(CODES)) assert.ok(REFUSAL_STATUS[code], `${name} (${code}) sin estado en REFUSAL_STATUS`);
  // API-01 y C-2, cerrados del lado del servidor (20261002090000, docs/ecommerce-hardening/http-contract.md):
  // una negativa por el estado es 409 y un «no existe» es 404; antes los dos salían con 500.
  assert.equal(REFUSAL_STATUS[55000], 409);
  assert.equal(REFUSAL_STATUS.P0002, 404);
  assert.deepEqual([refusalStatus('42501', null), refusalStatus('42501', { label: 'cliente' }), refusalStatus('42501')], [401, 403, 403]);
  assert.equal(refusalStatus('P0001'), null, 'C-1: un P0001 no es un rechazo declarado');
  const r = (status, code, message = 'm', details = null) => ({ ok: false, status, code, error: { code, message, details } });
  assert.ok(refused(r(429, 'PT429', 'ORDER_RATE_LIMITED', 'ip_rate'), CODES.INTAKE_LIMIT, { message: 'ORDER_RATE_LIMITED', details: 'ip_rate' }));
  assert.ok(refused(r(429, '54000', 'demasiados intentos de checkout', 'cooldown'), CODES.CHECKOUT_LIMIT, { details: 'cooldown' }));
  assert.ok(!refused(r(400, '55000'), CODES.STATE), 'el estado tiene que ser el de la tabla');
  assert.ok(!refused(r(500, '22023'), CODES.VALIDATION));
  assert.ok(!refused(r(400, 'P0001'), 'P0001'));
  assert.ok(!refused({ ok: true, status: 200 }, CODES.VALIDATION) && !refused(null, CODES.VALIDATION));
  assert.equal(refusal(CODES.STATE, { message: 'pedido cobrado por Mercado Pago' }), 'HTTP 409 · 55000 · pedido cobrado por Mercado Pago');
  assert.equal(refusal(CODES.FORBIDDEN, { actor: null }), 'HTTP 401 · 42501');
  // `hidden`: o cero filas, o «sin permiso». Nunca filas, nunca otro error.
  assert.ok(hidden({ status: 200, ok: true, rows: [] }) && hidden(r(403, '42501'), { label: 'x' }) && hidden(r(401, '42501'), null));
  assert.ok(!hidden({ status: 200, ok: true, rows: [{ id: 1 }] }) && !hidden(r(500, '57014')) && !hidden(r(401, '42501'), { label: 'x' }));
});

// Un contexto mínimo como el que arma `buildContext`, para el resumen.
function fakeContext({ checks = [], invocations = [{ phases: ['catalog', 'performance'] }], benchmark = null } = {}) {
  const rec = createRecorder({ targetKind: 'stack' });
  for (const [phase, name, result, extra] of checks) {
    if (result === 'PASS') rec.check(phase, name, true);
    else if (result === 'FAIL') rec.check(phase, name, false, extra || null, 'esperado');
    else rec.skipOnTarget(phase, name, extra);
  }
  return { runId: 'ecom-cert-stack-20261003-041500', rec, identity: { slug: 'taba-ecommerce-stack-20261003-041500', name: 'TABA_ECOMMERCE_STACK_20261003_041500' },
    env: { target: { kind: 'stack', label: 'supabase-ephemeral-stack', project: { name: 'supabase-ephemeral-stack', ref: 'stack' } }, observer: { stats: { calls: 3 } } },
    ledger: { startedAt: at.toISOString(), invocations, anonymousSignIns: 1, serviceRoleUses: [], databaseInterventions: [{ what: 'age' }], target: {} },
    caps: {}, requests: { total: 10 }, budget: { used: () => 0, max: 12000 }, benchmark, tenant: { id: 'b' } };
}

test('el resumen lista cada FAIL, cada salteo con su motivo y cada fase pedida que no corrió', () => {
  const ctx = fakeContext({ checks: [['catalog', 'BIEN', 'PASS'], ['catalog', 'MAL', 'FAIL', { http: 500 }], ['expiry', 'SIN_CRON', 'SKIP', 'pg_cron no corre']] });
  const summary = buildSummary(ctx);
  assert.equal(summary.exitCode, 1);
  assert.deepEqual(summary.failed, ['catalog:MAL']);
  assert.deepEqual(summary.skips, [{ check: 'expiry:SIN_CRON', verdict: VERDICTS.NOT_AVAILABLE_ON_TARGET, reason: 'pg_cron no corre' }]);
  assert.deepEqual(summary.notRun, ['performance'], 'pedida y sin un solo check');
  assert.equal(summary.phases.catalog.verdict, 'FAIL');
  const clean = buildSummary(fakeContext({ checks: [['catalog', 'BIEN', 'PASS'], ['performance', 'X', 'PASS']] }));
  assert.equal(clean.exitCode, 0);
  const text = renderSummary({ summary });
  assert.match(text, /Checks que fallaron \(1\)/);
  assert.match(text, /\*\*catalog:MAL\*\*/);
  assert.match(text, /expiry:SIN_CRON — SKIPPED_NOT_AVAILABLE_ON_TARGET — pg_cron no corre/);
  assert.match(text, /Fases pedidas que NO corrieron \(1\)/);
  assert.match(renderSummary({ summary: null, directory: 'x' }), /no llegó a escribir un resumen/);
});

test('el resumen imprime la tabla de rendimiento y, sin compuerta, el bloque de umbrales propuesto', () => {
  const steps = [{ operation: 'catalog_read', step: 'baseline', requests: 30, ok: 30, errors: 0, p50: 10, p95: 20, p99: 25, max: 30, perSecond: 50 }];
  const summary = buildSummary(fakeContext({ checks: [['performance', 'X', 'PASS']] }));
  const performance = { target: 'stack', benchmark: { steps, conservation: [{ after: 'x', exact: true }] },
    gate: { verdict: 'MEASURED_NO_GATE', thresholdsFile: 'docs/ecommerce-hardening/performance-thresholds.json',
      proposed: { rule: { multiplier: 3, round_up_to_ms: 50, floor_ms: 250 }, operations: { catalog_read: { baseline: 250 } } } } };
  const text = renderSummary({ summary, performance });
  assert.match(text, /\| catalog_read \| baseline \| 30 \| 30 \| 0 \| 10 \| 20 \| 25 \| 30 \| 50 \|/);
  assert.match(text, /compuerta: MEASURED_NO_GATE/);
  assert.match(text, /Umbrales propuestos para `targets\.stack`/);
  assert.match(text, /"catalog_read": \{\s+"baseline": 250/);
});

test('el modo --summarize no carga un destino ni abre una conexión', async () => {
  const written = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  try {
    assert.equal(await main(['--summarize', 'carpeta-que-no-existe']), 0);
  } finally { process.stdout.write = original; }
  assert.match(written.join(''), /No hay `summary\.json` en carpeta-que-no-existe/);
});
