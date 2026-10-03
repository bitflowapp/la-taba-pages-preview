// CERTIFICACIÓN E-COMMERCE — orquestación.
//
//   --target staging|local|stack             contra qué se corre (por defecto, staging). Vale con todos los modos.
//        staging   el proyecto `la-taba-staging`. Confirmación: STAGING_MUTATION_OK
//        local     el PostgREST real delante de un PostgreSQL local (`local-target.mjs`). No lee ninguna clave
//                  real y de la máquina no sale nada. Confirmación: LOCAL_MUTATION_OK
//        stack     el stack efímero de `supabase start` en loopback (`stack-target.mjs`): GoTrue, la puerta de
//                  entrada, pg_cron y el runtime de Edge reales. Sus cuatro entradas vienen del entorno.
//                  Confirmación: STACK_MUTATION_OK
//
//   --preflight                              identidad del entorno y capacidades; no escribe nada
//   --confirm <la del destino>               corre fases sobre el negocio propio de la corrida
//        [--phases a,b,c]                    sólo esas fases (por defecto, todas)
//        [--evidence-dir <dir>]              dónde dejar la evidencia (si ya tiene una corrida, la continúa)
//        [--evidence-root <dir>]             carpeta madre: la evidencia va a <dir>/<run id>
//        [--keep-tenant-open]                no cierra el tenant al terminar (para encadenar invocaciones)
//        [--no-anonymous]                    no gasta ingresos anónimos (presupuesto compartido)
//        [--max-minutes <n>]                 deja de empezar fases pasado ese tiempo (por defecto, el del destino)
//        [--tenant-name <nombre>] [--tenant-slug <slug>]   otro nombre y slug para el negocio NUEVO de la corrida
//        [--reuse-tenant <slug>]             en vez de crear un negocio, reusa ESE (tiene que ser de esta herramienta)
//   --reconcile <evidence dir>               termina la limpieza de una corrida cortada, desde su ledger
//   --summarize <evidence dir>               imprime el resumen de una corrida ya hecha (no se conecta a nada)
//
// CADA CORRIDA CREA SU PROPIO NEGOCIO (en Staging, TABA_ECOMMERCE_FINAL_<fecha>_<hora>) y no toca ninguno que
// no haya creado. Sale con código 0 sólo si ningún check FALLÓ y ninguna fase pedida quedó sin correr.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  CAPABILITY_SQL, CONFIRMATIONS, FORBIDDEN_REFS, PROTECTED_BUSINESS_IDS, RUN_ID_PATTERNS, RUN_ID_PREFIXES, STAGING_TARGET, TARGET_KINDS, VERDICTS,
  createEvidence, createLedger, createLogger, createRecorder, createRedactor, createServiceRole, exitCodeFor, isGuardStop, isSkip, loadEnvironment, newRunId,
  normalizeCapabilities, nowIso, runGatedPhase, skipReason, sqlText, tenantIdentity,
} from './env.mjs';
import { createBudget, createLatency } from './http.mjs';
import { GATE } from './load.mjs';
import { createOrders } from './orders.mjs';
import { createPayments } from './payments.mjs';
import { certifyIntakeLimits, certifyOpeningGate, ensureTenant, fixtureRows, fixturesAtDeclaredState, isTenantStop, readTenant, readTenantDetail, restoreConfig, teardown, tenantStrangers } from './tenant.mjs';
import { PHASES, PHASE_IDS } from './phases/index.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
export const CONFIRMATION = CONFIRMATIONS.staging;
const SYSTEM_PHASES = Object.freeze(['preflight', 'tenant', 'teardown']);
const DEFAULT_MAX_MINUTES = Object.freeze({ staging: 30, local: 30, stack: 30 });
const DEFAULT_SIGN_IN_GAP_MS = Object.freeze({ staging: 800, local: 1, stack: 40 });

export function parseArgs(argv = []) {
  const args = [...argv];
  const flag = (name) => args.includes(name);
  const opt = (name) => { const i = args.indexOf(name); return i < 0 ? '' : String(args[i + 1] || ''); };
  const valueOf = (name) => { const value = opt(name); if (flag(name) && (!value || value.startsWith('--'))) throw Error(`${name.slice(2).toUpperCase().replaceAll('-', '_')}_NEEDS_A_VALUE`); return value || null; };
  if (flag('--summarize')) {
    const dir = opt('--summarize');
    if (!dir || dir.startsWith('--')) throw Error('SUMMARIZE_NEEDS_AN_EVIDENCE_DIRECTORY');
    return { mode: 'summarize', evidenceDir: dir, target: flag('--target') ? opt('--target') : null };
  }
  const target = flag('--target') ? opt('--target') : 'staging';
  if (!TARGET_KINDS.includes(target)) throw Error(`UNKNOWN_TARGET:${target || '(none given)'}`);
  const out = { mode: null, target, phases: null, evidenceDir: opt('--evidence-dir') || null, evidenceRoot: opt('--evidence-root') || null, keepOpen: flag('--keep-tenant-open'),
    noAnonymous: flag('--no-anonymous'), maxMinutes: Number(opt('--max-minutes')) || DEFAULT_MAX_MINUTES[target],
    signInGapMs: Number(opt('--sign-in-gap-ms')) || DEFAULT_SIGN_IN_GAP_MS[target],
    tenantName: valueOf('--tenant-name'), tenantSlug: valueOf('--tenant-slug'), reuseTenant: valueOf('--reuse-tenant') };
  // Reusar un negocio y pedir uno nuevo con nombre propio son dos cosas distintas: no se mezclan.
  if (out.reuseTenant && (out.tenantSlug || out.tenantName)) throw Error('REUSE_TENANT_EXCLUDES_A_NEW_TENANT_NAME');
  if (flag('--preflight')) { out.mode = 'preflight'; return out; }
  if (flag('--reconcile')) {
    if (!opt('--reconcile') || opt('--reconcile').startsWith('--')) throw Error('RECONCILE_NEEDS_AN_EVIDENCE_DIRECTORY');
    out.mode = 'reconcile';
    out.evidenceDir = opt('--reconcile');
    return out;
  }
  // Sin la confirmación explícita DEL DESTINO no se escribe nada en ninguno.
  if (opt('--confirm') !== CONFIRMATIONS[target]) {
    throw Error(Object.values(CONFIRMATIONS).includes(opt('--confirm')) ? 'CONFIRMATION_IS_FOR_ANOTHER_TARGET' : 'EXPLICIT_CONFIRMATION_REQUIRED');
  }
  out.mode = 'run';
  if (flag('--phases')) {
    const wanted = opt('--phases').split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = wanted.filter((id) => !PHASE_IDS.includes(id));
    if (!wanted.length || unknown.length) throw Error(`UNKNOWN_PHASES:${unknown.join(',') || '(none given)'}`);
    out.phases = PHASE_IDS.filter((id) => wanted.includes(id));
  }
  if (!(out.maxMinutes > 0 && out.maxMinutes <= 90)) throw Error('MAX_MINUTES_OUT_OF_RANGE');
  return out;
}

// ── Preflight: identidad del entorno, sin escrituras ─────────────────────────
async function preflight(ctx) {
  const P = 'preflight';
  const C = ctx.rec.check;
  const target = ctx.env.target;
  ctx.log(`preflight: destino ${target.label} (${target.kind}), corrida ${ctx.runId}, negocio «${ctx.identity.name}»`);
  const project = await ctx.env.observer.project();
  const db = (await ctx.env.observe(`select current_user as usr,
    (select count(*) from supabase_migrations.schema_migrations)::int as migrations,
    (select max(version) from supabase_migrations.schema_migrations) as head,
    (select json_agg(version || '_' || name order by version) from supabase_migrations.schema_migrations) as ledger,
    (select json_agg(json_build_object('job', jobname, 'active', active) order by jobname) from cron.job) as cron,
    (${CAPABILITY_SQL.replace(/ as capabilities$/, '')}) as capabilities`))[0];
  const repoLedger = readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => f.slice(0, -4));
  // Qué se afirma de la identidad del entorno lo dice el destino: en Staging, el proyecto, las claves, el rol
  // del observador y un libro de migraciones que el repo conoce; en local y en el stack, sus propios hechos.
  const { ledger, facts } = await target.assertIdentity({ check: (name, pass, observed, expected, options) => C(P, name, pass, observed, expected, options),
    skip: (name, reason) => ctx.rec.skipOnTarget(P, name, reason), project, db, repoLedger, keys: ctx.env.keys, observe: ctx.env.observe });
  ctx.caps = normalizeCapabilities(db.capabilities);
  ctx.environmentFacts = { ...(facts || {}), cron: db.cron };
  const snapshot = await readTenant(ctx);
  const tenant = snapshot.business;
  let detail = null;
  if (tenant) {
    detail = await readTenantDetail(ctx, tenant.id);
    // Un negocio con el slug de la corrida ya existe: o es el de esta misma corrida (una invocación que la
    // continúa), o alguien pidió reusarlo. Si no, no se toca.
    const ownRun = ctx.ledger.target.tenantId === tenant.id;
    C(P, 'TENANT_SLUG_IS_OF_THIS_RUN_OR_ITS_REUSE_WAS_ASKED', ownRun || Boolean(ctx.flags.reuseTenant), { slug: tenant.slug, ownRun, reuseAsked: Boolean(ctx.flags.reuseTenant) });
    C(P, 'TENANT_IS_THE_EXPECTED_QA_FIXTURE', tenant.qa_fixture === true && tenant.name === ctx.identity.name && !PROTECTED_BUSINESS_IDS.includes(tenant.id),
      { id: tenant.id, name: tenant.name, qa_fixture: tenant.qa_fixture, status: tenant.status });
    const strangers = tenantStrangers(ctx, tenant, detail);
    C(P, 'TENANT_HAS_ONLY_ROWS_CREATED_BY_THE_RUNNER', strangers.length === 0,
      { strangers, orders: detail.orders, foreignOrders: detail.foreign_orders, checkouts: detail.checkout_sessions, foreignCheckouts: detail.foreign_checkout_sessions,
        intents: detail.payment_intents, products: (detail.products || []).length, members: (detail.members || []).length });
  } else if (ctx.flags.reuseTenant) {
    C(P, 'TENANT_TO_REUSE_EXISTS', false, { slug: ctx.identity.slug }, 'el negocio pedido con --reuse-tenant');
  } else {
    C(P, 'TENANT_ABSENT_AND_SLUG_FREE', true, { slug: ctx.identity.slug, name: ctx.identity.name, note: 'se crea en esta corrida con --confirm' });
  }
  const environment = { runId: ctx.runId, at: nowIso(), environment: target.environment, target: target.label,
    project: { ref: target.project.ref, name: project?.name, region: project?.region, status: project?.status },
    apiUrl: target.apiUrl, database: { observer: db.usr, migrations: db.migrations, head: db.head, ...ledger, cron: db.cron },
    ...(facts ? { [target.kind]: facts } : {}),
    capabilities: ctx.caps, forbiddenRefs: FORBIDDEN_REFS, protectedBusinesses: PROTECTED_BUSINESS_IDS.map((id) => `${id.slice(0, 8)}…`),
    tenantIdentity: { slug: ctx.identity.slug, name: ctx.identity.name, reuseAsked: Boolean(ctx.flags.reuseTenant) },
    tenant: tenant ? { id: tenant.id, slug: tenant.slug, status: tenant.status, ordering_enabled: tenant.ordering_enabled, qa_window_until: tenant.qa_window_until,
      orders: detail.orders, openOrders: detail.open_orders, products: (detail.products || []).length, operators: snapshot.operators.length, runUsers: snapshot.runUsers } : null };
  return environment;
}

// ── Resumen ──────────────────────────────────────────────────────────────────
const clip = (value, n = 400) => { const t = typeof value === 'string' ? value : JSON.stringify(value); return t && t.length > n ? `${t.slice(0, n)}…` : t; };
// Dónde se rompió el runner: archivo y línea de los primeros marcos, sin la ruta de disco.
const whereIn = (error) => String(error?.stack || '').split('\n').slice(1, 5).map((line) => /([\w.-]+\.mjs):([0-9]+)/.exec(line)).filter(Boolean)
  .map((match) => `${match[1]}:${match[2]}`).join(' < ');

// Lo que dice una corrida, con TODO a la vista: cada check que falló, cada check salteado con su motivo y
// cada fase pedida que no llegó a correr. El código de salida sale de acá por una sola regla (`exitCodeFor`).
export function buildSummary(ctx, extra = {}) {
  const ids = [...SYSTEM_PHASES.slice(0, 2), ...PHASE_IDS, 'teardown'];
  const skipped = ctx.rec.skippedPhases();
  const phases = Object.fromEntries(ids.map((id) => [id, { verdict: ctx.rec.verdict(id), ...ctx.rec.counts(id), ...(skipped[id] ? { missing: skipped[id] } : {}) }]));
  const failures = ctx.rec.checks.filter((c) => c.result === VERDICTS.FAIL);
  const failed = failures.map((c) => `${c.phase}:${c.name}`);
  const skips = ctx.rec.checks.filter((c) => isSkip(c.result)).map((c) => ({ check: `${c.phase}:${c.name}`, verdict: c.result, reason: skipReason(c) }));
  // Una fase que esta corrida pidió y no llegó a empezar (se acabó el tiempo): la certificación no está completa.
  const asked = [...new Set((ctx.ledger.invocations || []).flatMap((i) => i.phases || []))];
  const notRun = asked.filter((id) => phases[id]?.verdict === VERDICTS.NOT_RUN);
  const target = ctx.env.target;
  const totals = ctx.rec.counts();
  const exitCode = exitCodeFor({ failed: totals.fail, fatal: extra.fatal, notRun: notRun.length });
  return { runId: ctx.runId, target: { kind: target.kind, label: target.label, project: target.project.name, ref: target.project.ref, tenantSlug: ctx.identity.slug,
    tenantName: ctx.identity.name, tenantId: ctx.tenant?.id || ctx.ledger?.target?.tenantId || null },
  startedAt: ctx.ledger.startedAt, finishedAt: nowIso(), invocations: ctx.ledger.invocations, capabilities: ctx.caps, phases,
  totals, failed, failures: failures.map((c) => ({ check: `${c.phase}:${c.name}`, expected: c.expected ?? null, observed: clip(c.observed, 600) })),
  skips, skippedPhases: Object.entries(skipped).map(([id, missing]) => ({ phase: id, verdict: VERDICTS.SKIPPED, reason: `contrato no desplegado: ${missing.join(', ')}` })),
  notRun, fatal: extra.fatal || null,
  performanceGate: ctx.benchmark?.gate?.verdict ?? ctx.previousPerformance?.gate?.verdict ?? null,
  requests: { total: ctx.requests.total, load: ctx.budget.used(), loadBudget: ctx.budget.max }, observer: ctx.env.observer.stats,
  anonymousSignIns: ctx.ledger.anonymousSignIns, serviceRoleUses: ctx.ledger.serviceRoleUses.length, databaseInterventions: ctx.ledger.databaseInterventions.length,
  implementedPhasesAllPassOrSkipped: exitCode === 0, exitCode };
}

const benchmarkTable = (steps = []) => ['| Operación | Paso | n | ok | errores | p50 | p95 | p99 | máx | req/s |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...steps.map((s) => `| ${s.operation} | ${s.step} | ${s.requests} | ${s.ok} | ${s.errors} | ${s.p50 ?? '—'} | ${s.p95 ?? '—'} | ${s.p99 ?? '—'} | ${s.max ?? '—'} | ${s.perSecond ?? '—'} |`)];

function buildReport(ctx, summary, performance, cleanup) {
  const lines = [];
  const target = ctx.env.target;
  const where = { staging: 'en Staging', local: 'LOCAL (no es Staging)', stack: 'en el STACK efímero (no es Staging)' }[target.kind];
  lines.push(`# Certificación e-commerce ${where} — ${summary.runId}`, '',
    `- target: ${target.label}`,
    `- Entorno: **${target.project.name}** (\`${target.project.ref}\`), negocio propio de la corrida \`${ctx.identity.slug}\` («${ctx.identity.name}»).`,
    ...(target.kind === 'local' ? ['- Destino LOCAL: el PostgREST real delante de un PostgreSQL local con las migraciones del repo. Sin GoTrue, sin Cloudflare, sin Edge Functions, '
      + 'sin planificador: lo que depende de esas piezas figura como SKIPPED_NOT_AVAILABLE_LOCALLY y esta corrida no lo prueba.'] : []),
    ...(target.kind === 'stack' ? ['- Destino STACK: el stack de `supabase start` en loopback, con GoTrue, la puerta de entrada, pg_cron y el runtime de Edge reales. '
      + 'Sin Cloudflare y sin despliegue alojado: lo que depende de eso figura como SKIPPED_NOT_AVAILABLE_ON_TARGET.'] : []),
    `- Inicio: ${summary.startedAt} · Fin: ${summary.finishedAt} · Invocaciones: ${summary.invocations.length}.`,
    `- Checks: ${summary.totals.checks} (PASS ${summary.totals.pass}, FAIL ${summary.totals.fail}, SKIPPED_NOT_DEPLOYED ${summary.totals.skipped}, `
      + `SKIPPED_NOT_AVAILABLE_LOCALLY ${summary.totals.notAvailableLocally}, SKIPPED_NOT_AVAILABLE_ON_TARGET ${summary.totals.notAvailableOnTarget}).`,
    `- Código de salida: ${summary.exitCode}${summary.notRun.length ? ` (fases pedidas que no corrieron: ${summary.notRun.join(', ')})` : ''}.`,
    `- Requests: ${summary.requests.total} (carga: ${summary.requests.load} de ${summary.requests.loadBudget}). Ingresos anónimos: ${summary.anonymousSignIns}.`,
    `- Usos de service_role: ${summary.serviceRoleUses}; intervenciones directas en la base: ${summary.databaseInterventions}. Detalle en \`service-role-uses.json\`.`, '',
    '## Fases', '', '| Fase | Veredicto | Checks | PASS | FAIL | NO DESPLEGADO | NO EN ESTE DESTINO |', '|---|---|---:|---:|---:|---:|---:|');
  for (const [id, p] of Object.entries(summary.phases)) {
    lines.push(`| ${id} | ${p.verdict}${p.missing ? ` (falta: ${p.missing.join(', ')})` : ''} | ${p.checks} | ${p.pass} | ${p.fail} | ${p.skipped} | ${p.notAvailableLocally + p.notAvailableOnTarget} |`);
  }
  lines.push('', '## Contratos detectados', '', ...Object.entries(summary.capabilities || {}).map(([name, present]) => `- ${name}: ${present ? 'desplegado' : 'NO desplegado'}`));
  const failures = ctx.rec.checks.filter((c) => c.result === VERDICTS.FAIL);
  lines.push('', `## Checks que fallaron (${failures.length})`, '');
  if (!failures.length) lines.push('Ninguno.');
  for (const c of failures) {
    lines.push(`### ${c.phase} · ${c.name}`, '', `- esperado: \`${clip(c.expected) ?? '—'}\``, `- observado: \`${clip(c.observed)}\``, `- hora: ${c.at}`, '');
  }
  lines.push('', `## Checks que no se probaron, con su motivo (${summary.skips.length})`, '');
  if (!summary.skips.length && !summary.skippedPhases.length) lines.push('Ninguno.');
  for (const s of summary.skippedPhases) lines.push(`- fase ${s.phase}: ${s.verdict} — ${s.reason}`);
  for (const s of summary.skips) lines.push(`- ${s.check}: ${s.verdict} — ${s.reason}`);
  const ops = Object.entries(performance?.operations || {});
  if (ops.length) {
    lines.push('', '## Latencia por tipo de llamada (toda la corrida, ms)', '', '| Operación | n | p50 | p95 | p99 | máx | media |', '|---|---:|---:|---:|---:|---:|---:|');
    for (const [name, s] of ops) lines.push(`| ${name} | ${s.n} | ${s.p50} | ${s.p95} | ${s.p99} | ${s.max} | ${s.mean} |`);
  }
  if (performance?.benchmark?.steps?.length) {
    lines.push('', `## Rendimiento medido (ms) — compuerta: ${performance.gate?.verdict ?? '—'}`, '', ...benchmarkTable(performance.benchmark.steps));
    if (performance.gate?.violations?.length) lines.push('', ...performance.gate.violations.map((v) => `- FUERA DE UMBRAL ${v.operation}:${v.step}: p95 ${v.p95} ms > ${v.ceiling} ms`));
  }
  if (ctx.tenant?.notes?.length) lines.push('', '## Notas del tenant', '', ...ctx.tenant.notes.map((n) => `- ${n}`));
  if (cleanup?.retainedByDesign) lines.push('', `## Lo que queda en ${{ staging: 'Staging', local: 'la base local', stack: 'el stack (hasta que se apaga)' }[target.kind]} a propósito`, '', ...cleanup.retainedByDesign.map((n) => `- ${n}`));
  lines.push('', '## Evidencia', '', '`checks.json`, `summary.json`, `performance.json`, `non-2xx-answers.json`, `created-resources.json`, `service-role-uses.json`, `environment.json`, `tenant.json`, `cleanup-result.json` y un `phase-<id>.json` por fase.', '');
  return lines.join('\n');
}

function writeOutputs(ctx, extra = {}) {
  const summary = buildSummary(ctx, extra);
  const previous = ctx.previousPerformance || { operations: {}, benchmark: null, gate: null };
  const performance = { runId: ctx.runId, at: nowIso(), target: ctx.env.target.kind, method: 'latencia medida en el cliente, por request (ms); percentil por rango más cercano',
    operations: { ...previous.operations, ...ctx.latency.all() },
    // Lo que midió la fase `performance`: la línea de base, cada nivel de concurrencia y la conservación de stock.
    benchmark: ctx.benchmark?.benchmark ?? previous.benchmark ?? null,
    gate: ctx.benchmark?.gate ?? previous.gate ?? null };
  ctx.evidence.write('checks.json', ctx.rec.checks);
  ctx.evidence.write('summary.json', summary);
  ctx.evidence.write('performance.json', performance);
  // Cada respuesta que no fue 2xx en esta invocación (las esperadas y las que no): operación, actor, estado HTTP y código.
  ctx.evidence.write('non-2xx-answers.json', { runId: ctx.runId, at: nowIso(), answers: ctx.journal });
  ctx.persist();
  ctx.evidence.writeText('final-report.md', buildReport(ctx, summary, performance, extra.cleanup));
  return summary;
}

// ── Contexto ─────────────────────────────────────────────────────────────────
async function createTarget(kind, log) {
  // Los destinos que no son Staging se cargan sólo cuando se piden: una corrida contra Staging no ejecuta una
  // línea suya. Y son lo PRIMERO que se arma, porque cierran la salida de la máquina antes de que nada intente conectarse.
  if (kind === 'local') return (await import('./local-target.mjs')).createLocalTarget({ log });
  if (kind === 'stack') return (await import('./stack-target.mjs')).createStackTarget({ log });
  return STAGING_TARGET;
}

async function buildContext(options) {
  const redactor = createRedactor();
  const log = createLogger(redactor, { local: 'LOCAL', stack: 'STACK' }[options.target] || '');
  const target = await createTarget(options.target, log);
  const previousDir = options.evidenceDir && existsSync(path.join(path.resolve(options.evidenceDir), 'created-resources.json')) ? path.resolve(options.evidenceDir) : null;
  let runId = newRunId(new Date(), target.runIdPrefix);
  let previous = null;
  let stored = null;
  if (previousDir) {
    previous = createEvidence(previousDir, redactor);
    stored = previous.read('created-resources.json');
    // El patrón es el del destino: la evidencia de una corrida de un destino no se continúa en otro.
    // Se mira ANTES de leer una credencial o de hacer una request: una carpeta de otro destino no llega a nada.
    if (!target.runIdPattern.test(String(stored?.runId || ''))) throw Error('EVIDENCE_DIRECTORY_HAS_NO_VALID_RUN');
    runId = stored.runId;
  }
  // Quién es el tenant. Una corrida que continúa usa el suyo (lo dice su ledger); una nueva crea uno con su
  // nombre, salvo que se pida reusar un negocio por su slug.
  const reuse = options.reuseTenant || null;
  const identity = stored?.target?.tenantSlug
    ? tenantIdentity({ kind: target.kind, runId, slug: stored.target.tenantSlug, name: stored.target.tenantName })
    : tenantIdentity({ kind: target.kind, runId, slug: reuse || options.tenantSlug || null, name: options.tenantName || null });
  target.bindRun(runId);
  const env = await loadEnvironment({ redactor, log, target });
  const rec = createRecorder({ log, targetKind: target.kind });
  const evidenceDir = previousDir || (options.evidenceDir ? path.resolve(options.evidenceDir)
    : options.evidenceRoot ? path.join(path.resolve(options.evidenceRoot), runId) : path.join(ROOT, 'artifacts', `taba-${runId}`));
  const evidence = createEvidence(evidenceDir, redactor);
  const { ledger, persist } = createLedger({ runId, evidence, target, identity });
  if (stored) {
    Object.assign(ledger, { startedAt: stored.startedAt, target: stored.target, invocations: stored.invocations || [], anonymousSignIns: stored.anonymousSignIns || 0,
      serviceRoleUses: stored.serviceRoleUses || [], databaseInterventions: stored.databaseInterventions || [], users: stored.users || [], sessions: stored.sessions || [],
      orders: stored.orders || [], checkouts: stored.checkouts || [], tenantChanges: stored.tenantChanges || [], businesses: stored.businesses || [] });
  }
  const ctx = { runId, runTag: runId.replace(/^ecom-cert-/, ''), identity, currentPhase: 'tenant',
    flags: { noAnonymous: options.noAnonymous, signInGapMs: options.signInGapMs, keepOpen: options.keepOpen, reuseTenant: Boolean(reuse) && !stored },
    env, redactor, log, rec, evidence, ledger, persist, caps: normalizeCapabilities({}), requests: { total: 0 }, latency: createLatency(),
    budget: createBudget(target.load.budget), benchmark: null, liveSessions: new Set(), timers: [], extraSessions: [], tenant: null, actors: null, previous, previousChecks: [], journal: [] };
  ctx.serviceRole = createServiceRole({ keys: env.keys, ledger, persist, target });
  // La llamada que en producción hace una Edge Function con su cliente de servicio: por el transporte propio
  // (mide y anota la respuesta) y contada en el ledger por fase y por función.
  const meter = ctx.serviceRole.meter('edge-function', () => ctx.currentPhase);
  ctx.edgeRpc = (fn, params, callOptions) => { meter(fn); return ctx.http.service(fn, params, callOptions); };
  // La misma llamada, con la respuesta perdida en el camino (fase lost-ack).
  ctx.lostEdgeRpc = (fn, params, processed, callOptions) => { meter(fn); return ctx.http.lostServiceResponse(fn, params, processed, callOptions); };
  return ctx;
}

function restorePreviousResults(ctx, phasesToRun) {
  if (!ctx.previous) return;
  const checks = ctx.previous.read('checks.json') || [];
  const summary = ctx.previous.read('summary.json');
  const rerun = new Set([...SYSTEM_PHASES, ...phasesToRun]);
  const skipped = Object.fromEntries(Object.entries(summary?.phases || {}).filter(([id, p]) => p.missing && !rerun.has(id)).map(([id, p]) => [id, p.missing]));
  ctx.rec.restore(checks.filter((c) => !rerun.has(c.phase)), skipped);
  // Lo que se probó una sola vez por corrida (límites de admisión) lo retoma quien lo necesite.
  ctx.previousChecks = checks;
  ctx.previousPerformance = ctx.previous.read('performance.json');
  ctx.journal.push(...(ctx.previous.read('non-2xx-answers.json')?.answers || []));
  ctx.budget = createBudget(ctx.env.target.load.budget, Number(summary?.requests?.load || 0));
}

// ── Modos ────────────────────────────────────────────────────────────────────
async function runPreflight(options) {
  const ctx = await buildContext({ ...options, evidenceDir: null });
  try {
    const environment = await preflight(ctx);
    const failed = ctx.rec.checks.filter((c) => c.result === VERDICTS.FAIL).map((c) => c.name);
    process.stdout.write(`${ctx.redactor.redact({ preflight: true, target: ctx.env.target.label, verdict: ctx.rec.verdict('preflight'), failed,
      failures: ctx.rec.checks.filter((c) => c.result === VERDICTS.FAIL).map((c) => ({ check: c.name, expected: c.expected, observed: c.observed })), environment })}\n`);
    return failed.length ? 1 : 0;
  } finally { await ctx.env.target.close(); }
}

async function runPhases(options) {
  const ctx = await buildContext(options);
  const selected = options.phases || PHASE_IDS;
  restorePreviousResults(ctx, selected);
  const started = Date.now();
  const invocation = { at: nowIso(), phases: selected, keepOpen: options.keepOpen, finishedAt: null };
  ctx.ledger.invocations.push(invocation);
  let fatal = null;
  let cleanup = null;
  try {
    const environment = await preflight(ctx);
    ctx.evidence.write('environment.json', environment);
    // Frena lo que dice que el entorno no es el que tiene que ser (identidad, claves, a quién se le escribe). Un
    // hecho de fidelidad que falla (declarado `blocking: false` por el destino) queda en FAIL y la corrida sigue.
    const blocking = ctx.rec.blockingFailures('preflight');
    if (blocking.length) throw Error(`${ctx.env.target.environment}_IDENTITY_NOT_VERIFIED:${blocking.map((c) => c.name).join(',').slice(0, 200)}`);
    const fidelity = ctx.rec.checks.filter((c) => c.phase === 'preflight' && c.result === VERDICTS.FAIL);
    if (fidelity.length) ctx.log(`preflight: ${fidelity.length} hecho(s) de fidelidad en FAIL (${fidelity.map((c) => c.name).join(', ')}); la corrida sigue y el código de salida no será 0`);
    ctx.persist();
    ctx.log(`tenant: se prepara el negocio «${ctx.identity.name}» (${ctx.identity.slug})`);
    await ensureTenant(ctx);
    ctx.orders = createOrders(ctx);
    ctx.payments = createPayments(ctx);
    const business = (await readTenant(ctx)).business;
    const fixtures = fixturesAtDeclaredState(fixtureRows(await readTenantDetail(ctx, ctx.tenant.id)));
    ctx.rec.check('tenant', 'TENANT_IS_A_BUSINESS_OF_THIS_RUN', ctx.tenant.created || ctx.ledger.target.tenantReused || ctx.ledger.businesses.some((b) => b.id === ctx.tenant.id),
      { slug: ctx.tenant.slug, name: ctx.tenant.name, created: ctx.tenant.created, reused: ctx.ledger.target.tenantReused },
      'el negocio lo creó esta corrida, o se pidió reusar uno de la herramienta');
    ctx.rec.check('tenant', 'TENANT_OPEN_VERIFIED_AND_ENABLED', business.status === 'open' && business.ordering_verified && business.ordering_enabled
      && business.qa_fixture && Date.parse(business.qa_window_until) > Date.now(), { status: business.status, verified: business.ordering_verified, enabled: business.ordering_enabled, window: business.qa_window_until });
    // Desde 20261001215000 la plataforma no verifica un comercio sin dueño, sin horario exigido o sin cobertura
    // exigida. El tenant tiene que haber pasado por ESA compuerta: si hizo falta escribir las columnas a mano,
    // la corrida no está probando un comercio que la plataforma habría habilitado.
    ctx.rec.check('tenant', 'TENANT_VERIFIED_THROUGH_THE_PLATFORM_GATE', ctx.tenant.opening.fallback === null
      && ['platform_verify_business_ordering', 'already_verified'].includes(ctx.tenant.opening.verification), ctx.tenant.opening);
    ctx.rec.check('tenant', 'TENANT_CONFIG_READY', business.currency_code === 'ARS' && business.operating_timezone === 'America/Argentina/Buenos_Aires' && business.hours_enforced
      && business.delivery_zone_enforced && business.delivery_enabled && business.pickup_enabled && Object.keys(ctx.tenant.zones).length === 2,
    { currency: business.currency_code, timezone: business.operating_timezone, zones: Object.keys(ctx.tenant.zones) });
    ctx.rec.check('tenant', 'OPERATORS_HAVE_REGISTERED_SESSIONS', ['owner', 'admin', 'staff', 'rider1', 'rider2'].every((label) => ctx.actors[label]?.sessionId)
      && ctx.actors.owner.sessionRole === 'owner' && ctx.actors.admin.sessionRole === 'admin' && ctx.actors.staff.sessionRole === 'staff'
      && ctx.actors.rider1.sessionRole === 'rider' && ctx.actors.rider2.sessionRole === 'rider',
    Object.fromEntries(Object.entries(ctx.actors).map(([label, a]) => [label, a.sessionRole])));
    ctx.rec.check('tenant', 'FIXTURE_PRODUCTS_AT_DECLARED_STATE', fixtures.every((f) => f.stockOk && f.priceOk && f.nameOk && f.stateOk), fixtures);
    // Dos reglas nuevas del backend que el tenant, por estar bien armado, nunca llega a tocar. Se prueban acá,
    // aparte y antes de la primera fase: que la plataforma se niega a verificar un comercio sin reglas, y que
    // los límites de admisión —que el tenant lleva amplios para que las fases entren— frenan.
    await certifyOpeningGate(ctx);
    await certifyIntakeLimits(ctx);
    writeOutputs(ctx);

    for (const phase of PHASES.filter((p) => selected.includes(p.id))) {
      if ((Date.now() - started) / 60000 > options.maxMinutes) {
        ctx.log(`sin tiempo para empezar ${phase.id}: queda NOT_RUN en esta invocación`);
        continue;
      }
      ctx.currentPhase = phase.id;
      ctx.log(`── fase ${phase.id}: ${phase.title}`);
      const t0 = Date.now();
      try {
        await runGatedPhase(phase, ctx);
      } catch (error) {
        if (isGuardStop(error)) throw error;
        ctx.rec.check(phase.id, 'PHASE_COMPLETED_WITHOUT_RUNNER_ERROR', false, { message: String(error.message).slice(0, 300), at: whereIn(error) });
      }
      // Entre fases el tenant vuelve a su forma canónica: lo que una fase dejó a medio hacer no contamina la siguiente.
      ctx.currentPhase = `${phase.id} (cierre)`;
      try {
        const business2 = (await readTenant(ctx)).business;
        if (business2.status === 'paused') await ctx.http.call(ctx.actors.owner, 'set_business_open_state', { p_business_id: ctx.tenant.id, p_status: 'open' });
        await restoreConfig(ctx);
        const settled = await ctx.orders.settle(`cierre de fase ${phase.id}`);
        if (settled.settled.failures.length) ctx.rec.check(phase.id, 'PHASE_LEFT_TENANT_RECOVERABLE', false, { failures: settled.settled.failures.slice(0, 8) });
      } catch (error) {
        if (isGuardStop(error)) throw error;
        ctx.rec.check(phase.id, 'PHASE_LEFT_TENANT_RECOVERABLE', false, { message: String(error.message).slice(0, 300) });
      }
      const counts = ctx.rec.counts(phase.id);
      ctx.log(`── fase ${phase.id}: ${ctx.rec.verdict(phase.id)} en ${Math.round((Date.now() - t0) / 1000)} s (${counts.pass} PASS, ${counts.fail} FAIL, ${counts.checks - counts.pass - counts.fail} sin probar)`);
      writeOutputs(ctx);
    }
  } catch (error) {
    fatal = error;
    ctx.log(`FATAL ${error.message}`);
    ctx.rec.check(isTenantStop(error) ? 'tenant' : 'preflight', isTenantStop(error) ? 'TENANT_IS_SAFE_TO_USE' : 'RUN_COMPLETED_WITHOUT_FATAL_ERROR', false,
      { message: String(error.message).slice(0, 300), phase: ctx.currentPhase });
  } finally {
    ctx.currentPhase = 'teardown';
    // Un tenant con filas que no creamos no se toca: tampoco se «limpia».
    if (ctx.tenant?.id && ctx.actors?.owner && !(fatal && isTenantStop(fatal))) {
      try {
        ctx.log('teardown: pedidos cerrados, configuración canónica, tenant cerrado, operadores suspendidos');
        cleanup = await teardown(ctx, { keepOpen: options.keepOpen });
        ctx.evidence.write('cleanup-result.json', { runId: ctx.runId, at: nowIso(), keepOpen: options.keepOpen, ...cleanup });
      } catch (error) {
        ctx.rec.check('teardown', 'CLEANUP_COMPLETED_WITHOUT_RUNNER_ERROR', false, { message: String(error.message).slice(0, 300) });
      }
    }
    // Lo último de todo, con la limpieza ya hecha: adónde fueron de verdad las requests de la corrida.
    ctx.env.target.assertContainment((name, pass, observed, expected) => ctx.rec.check('teardown', name, pass, observed, expected));
    await ctx.env.target.close();
    invocation.finishedAt = nowIso();
  }
  const summary = writeOutputs(ctx, { fatal: fatal ? String(fatal.message).slice(0, 300) : null, cleanup });
  process.stdout.write(`${ctx.redactor.redact({ runId: summary.runId, target: summary.target.label, tenant: summary.target.tenantName, evidence: path.basename(ctx.evidence.dir),
    phases: Object.fromEntries(Object.entries(summary.phases).map(([id, p]) => [id, `${p.verdict} ${p.pass}/${p.checks}`])),
    totals: summary.totals, failed: summary.failed, skipped: summary.skips.length, notRun: summary.notRun, performanceGate: summary.performanceGate, fatal: summary.fatal, exitCode: summary.exitCode })}\n`);
  return summary.exitCode;
}

async function runReconcile(options) {
  const dir = path.resolve(options.evidenceDir);
  if (!existsSync(path.join(dir, 'created-resources.json'))) throw Error('RECONCILE_LEDGER_NOT_FOUND');
  const ctx = await buildContext({ ...options, evidenceDir: dir });
  restorePreviousResults(ctx, []);
  ctx.ledger.invocations.push({ at: nowIso(), phases: [], reconcile: true });
  ctx.log(`reconcile ${ctx.runId}: ${ctx.ledger.users.filter((u) => !u.deleted).length} usuarios y ${ctx.ledger.orders.length} pedidos anotados`);
  let cleanup = null;
  let fatal = null;
  try {
    await preflight(ctx);
    if (ctx.rec.blockingFailures('preflight').length) throw Error(`${ctx.env.target.environment}_IDENTITY_NOT_VERIFIED`);
    const snapshot = await readTenant(ctx);
    if (!snapshot.business) {
      ctx.rec.check('teardown', 'NOTHING_TO_RECONCILE_TENANT_ABSENT', true, { slug: ctx.identity.slug });
    } else {
      // Los operadores vuelven a entrar (contraseña nueva) para cerrar por los caminos reales.
      await ensureTenant(ctx);
      ctx.orders = createOrders(ctx);
      ctx.payments = createPayments(ctx);
      ctx.currentPhase = 'reconcile';
      cleanup = await teardown(ctx, { keepOpen: false });
      ctx.evidence.write('reconcile-result.json', { runId: ctx.runId, at: nowIso(), ...cleanup });
    }
  } catch (error) {
    fatal = error;
    ctx.rec.check('teardown', 'RECONCILE_COMPLETED_WITHOUT_RUNNER_ERROR', false, { message: String(error.message).slice(0, 300) });
  } finally {
    ctx.env.target.assertContainment((name, pass, observed, expected) => ctx.rec.check('teardown', name, pass, observed, expected));
    await ctx.env.target.close();
  }
  const summary = writeOutputs(ctx, { fatal: fatal ? String(fatal.message).slice(0, 300) : null, cleanup });
  process.stdout.write(`${ctx.redactor.redact({ reconcile: ctx.runId, target: summary.target.label, verdict: summary.phases.teardown.verdict, failed: summary.failed.filter((f) => f.startsWith('teardown:')) })}\n`);
  return summary.phases.teardown.verdict === VERDICTS.PASS ? 0 : 1;
}

// ── Resumen de una corrida ya hecha ──────────────────────────────────────────
// Sólo lee los archivos de la evidencia: no carga un destino, no lee una clave y no abre una conexión. Es lo
// que imprime el job de CI al final, falle o no la corrida.
export function renderSummary({ summary, performance = null, directory = '' }) {
  if (!summary) return ['## Certificación e-commerce', '', `No hay \`summary.json\` en ${directory || 'la carpeta de evidencia'}: la corrida no llegó a escribir un resumen.`, ''].join('\n');
  const t = summary.totals || {};
  const skipped = (t.skipped || 0) + (t.notAvailableLocally || 0) + (t.notAvailableOnTarget || 0);
  const lines = [`## Certificación e-commerce — ${summary.runId} (${summary.target?.label ?? '?'})`, '',
    `- Negocio de la corrida: \`${summary.target?.tenantSlug ?? '?'}\``,
    `- Checks: **${t.checks ?? 0}** · PASS ${t.pass ?? 0} · FAIL ${t.fail ?? 0} · sin probar ${skipped}`,
    `- Código de salida: **${summary.exitCode}**${summary.fatal ? ` · FATAL: ${summary.fatal}` : ''}`,
    `- Compuerta de rendimiento: ${summary.performanceGate ?? 'no se midió'}`, '',
    '| Fase | Veredicto | Checks | PASS | FAIL | Sin probar |', '|---|---|---:|---:|---:|---:|'];
  for (const [id, p] of Object.entries(summary.phases || {})) {
    lines.push(`| ${id} | ${p.verdict} | ${p.checks} | ${p.pass} | ${p.fail} | ${(p.skipped || 0) + (p.notAvailableLocally || 0) + (p.notAvailableOnTarget || 0)} |`);
  }
  const failures = summary.failures || (summary.failed || []).map((check) => ({ check }));
  lines.push('', `### Checks que fallaron (${failures.length})`, '');
  if (!failures.length) lines.push('Ninguno.');
  for (const f of failures) lines.push(`- **${f.check}**${f.expected ? ` — esperado: ${clip(f.expected, 200)}` : ''}${f.observed ? ` — observado: ${clip(f.observed, 300)}` : ''}`);
  const skips = [...(summary.skippedPhases || []).map((s) => ({ check: `fase ${s.phase}`, verdict: s.verdict, reason: s.reason })), ...(summary.skips || [])];
  lines.push('', `### Checks que no se probaron (${skips.length})`, '');
  if (!skips.length) lines.push('Ninguno.');
  for (const s of skips) lines.push(`- ${s.check} — ${s.verdict} — ${s.reason}`);
  if ((summary.notRun || []).length) lines.push('', `### Fases pedidas que NO corrieron (${summary.notRun.length})`, '', ...summary.notRun.map((id) => `- ${id}`));
  if (performance?.benchmark?.steps?.length) {
    lines.push('', `### Rendimiento (ms) — compuerta: ${performance.gate?.verdict ?? '—'}`, '', ...benchmarkTable(performance.benchmark.steps));
    for (const v of performance.gate?.violations || []) lines.push(`- FUERA DE UMBRAL ${v.operation}:${v.step}: p95 ${v.p95} ms > ${v.ceiling} ms`);
    for (const c of (performance.benchmark.conservation || []).filter((entry) => !entry.exact)) lines.push(`- STOCK NO CONSERVADO después de ${c.after}: ${clip(c, 200)}`);
    if (performance.gate?.verdict === GATE.NO_GATE && performance.gate?.proposed) {
      lines.push('', `Umbrales propuestos para \`targets.${performance.target}\` de \`${performance.gate.thresholdsFile}\` (regla: p95 × ${performance.gate.proposed.rule?.multiplier}, `
        + `redondeado a ${performance.gate.proposed.rule?.round_up_to_ms} ms, piso ${performance.gate.proposed.rule?.floor_ms} ms, nunca por encima del tiempo límite del rol):`, '',
      '```json', JSON.stringify(performance.gate.proposed, null, 2), '```');
    }
  }
  lines.push('');
  return lines.join('\n');
}

function runSummarize(options) {
  const dir = path.resolve(options.evidenceDir);
  const read = (name) => (existsSync(path.join(dir, name)) ? JSON.parse(readFileSync(path.join(dir, name), 'utf8')) : null);
  process.stdout.write(`${renderSummary({ summary: read('summary.json'), performance: read('performance.json'), directory: path.basename(dir) })}\n`);
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.mode === 'summarize') return runSummarize(options);
  if (options.mode === 'preflight') return runPreflight(options);
  if (options.mode === 'reconcile') return runReconcile(options);
  return runPhases(options);
}

export { RUN_ID_PATTERNS, RUN_ID_PREFIXES, sqlText };
