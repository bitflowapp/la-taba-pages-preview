// Conciliación de pagos: lo que dice La Taba contra lo que dice Mercado Pago.
// SÓLO LECTURA. No corrige nada.
//
//   node scripts/payments/reconcile-payments.mjs --target staging|controlled-production --business-id <uuid>
//        [--from ISO --to ISO] [--environment test|production]
//        [--provider-export archivo.json | --provider-token-env NOMBRE | --local-only]
//        [--lag-minutes N] [--refund-stuck-minutes N] [--max-intents N] [--project-ref ref]
//        [--out informe.json] [--json]
//
// POR QUÉ EXISTE
// --------------
// El estado de un pago se arma con las notificaciones que llegaron. Las que no
// llegaron no dejan rastro: un reembolso hecho en el panel de Mercado Pago, un
// contracargo o un segundo cobro sobre la misma preferencia pueden quedar
// invisibles para siempre (auditoría PAY-04, PAY-06, PAY-07). Esta herramienta
// lee los dos lados y nombra cada diferencia.
//
// QUÉ GARANTIZA
// -------------
//   · no escribe: la única sentencia es un SELECT que pasa por una guarda de
//     lista blanca, va al endpoint de sólo lectura, y al proveedor sólo se le
//     hacen GET. No hay modo de corrección ni flag que lo habilite: la plata la
//     corrige una persona, mirando el hallazgo;
//   · no muestra datos personales: sólo estados, importes, fechas e ids;
//   · no da por conciliado lo que no comparó: cada pago sin comparar sale como
//     UNVERIFIED_AGAINST_PROVIDER y se cuenta aparte.
//
// Códigos de salida: 0 sin hallazgos críticos · 3 con hallazgos críticos ·
// 2 error de uso o de guarda (no se llegó a un veredicto).
//
// OJO: 0 NO quiere decir «conciliado». Sin fuente del proveedor, o con pagos
// que no se pudieron comparar, la salida también es 0. Quien automatice tiene
// que leer `coverage.provider_comparison` (none | partial | full) y
// `coverage.reconciled` contra `coverage.local_intents` en el informe.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_CODES, DEFAULT_LAG_MINUTES, DEFAULT_REFUND_STUCK_MINUTES, INTEGRATION_REFERENCE, classify,
  normalizeProviderPayment, referencesNeedingExplicitLookup,
} from './reconciliation/classify.mjs';
import {
  DEFAULT_MAX_INTENTS, ENVIRONMENTS, TARGET_REFS, assertInstant, assertTokenEnvName, assertUuid,
  createExportProvider, createManagementApiRunner, createMercadoPagoSearchProvider, loadLocalRows,
  loadLocalRowsByReference, mergeLocalRows, mergeProviderRows, readOnlyRunner, resolveTarget,
} from './reconciliation/sources.mjs';

export const EXIT = Object.freeze({ OK: 0, USAGE: 2, CRITICAL: 3 });
const REPORT_SCHEMA = 'taba.payment_reconciliation.report.v1';
const DEFAULT_WINDOW_DAYS = 7;
const VALUE_FLAGS = Object.freeze(['--target', '--business-id', '--from', '--to', '--environment', '--provider-export',
  '--provider-token-env', '--lag-minutes', '--refund-stuck-minutes', '--max-intents', '--project-ref', '--out']);
const SWITCH_FLAGS = Object.freeze(['--local-only', '--json']);
// Se nombran para rechazarlos con una explicación, no porque existan.
const WRITE_FLAGS = Object.freeze(['--fix', '--apply', '--write', '--repair', '--correct', '--force']);

function integerOption(values, flag, fallback, min, max) {
  if (!values.has(flag)) return fallback;
  const number = Number(values.get(flag));
  if (!Number.isInteger(number) || number < min || number > max) throw Error(`${flag} tiene que ser un entero de ${min} a ${max}`);
  return number;
}

/** Argumentos → opciones validadas. Lanza con un mensaje para la persona. */
export function parseReconcileArgs(args = [], { now = new Date() } = {}) {
  const values = new Map();
  const switches = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const [flag, inline] = String(args[index]).split(/=(.*)/s, 2);
    if (WRITE_FLAGS.includes(flag)) throw Error(`READ_ONLY_TOOL: ${flag} no existe. Esta herramienta sólo lee; las correcciones las decide una persona.`);
    if (SWITCH_FLAGS.includes(flag)) {
      // `--local-only=false` se leía como «sólo local»: un interruptor no lleva valor.
      if (inline !== undefined) throw Error(`${flag} no lleva valor`);
      switches.add(flag);
      continue;
    }
    // Lo que no se reconoce no se repite tal cual: puede ser un token pegado.
    if (!VALUE_FLAGS.includes(flag)) throw Error(`Flag desconocido: ${/^--[a-z][a-z-]{0,40}$/.test(flag) ? flag : '(argumento no reconocido)'}`);
    const value = inline !== undefined ? inline : args[index += 1];
    if (value === undefined || value === '' || String(value).startsWith('--')) throw Error(`${flag} necesita un valor`);
    if (values.has(flag)) throw Error(`${flag} está repetido`);
    values.set(flag, String(value));
  }

  if (!values.has('--target')) throw Error(`Falta --target (${Object.keys(TARGET_REFS).join(' | ')})`);
  const target = resolveTarget(values.get('--target'), values.get('--project-ref') || '');
  if (!values.has('--business-id')) throw Error('Falta --business-id <uuid>');
  const businessId = assertUuid(values.get('--business-id'), 'business-id');

  if (values.has('--from') !== values.has('--to')) throw Error('--from y --to van juntos');
  const to = values.has('--to') ? assertInstant(values.get('--to'), 'to') : new Date(now).toISOString();
  const from = values.has('--from') ? assertInstant(values.get('--from'), 'from')
    : new Date(Date.parse(to) - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString();
  if (Date.parse(from) >= Date.parse(to)) throw Error('--from tiene que ser anterior a --to');

  const environment = values.get('--environment') || null;
  if (environment !== null && !ENVIRONMENTS.includes(environment)) throw Error(`--environment tiene que ser ${ENVIRONMENTS.join(' o ')}`);

  const chosen = [values.has('--provider-export'), values.has('--provider-token-env'), switches.has('--local-only')].filter(Boolean).length;
  if (chosen > 1) throw Error('--provider-export, --provider-token-env y --local-only son excluyentes');
  // Sin fuente del proveedor declarada no se llama a nadie: sólo coherencia local.
  let mode = 'local-only';
  if (values.has('--provider-export')) mode = 'provider-export';
  if (values.has('--provider-token-env')) mode = 'provider-api';
  const providerTokenEnv = mode === 'provider-api' ? assertTokenEnvName(values.get('--provider-token-env')) : null;

  const out = values.get('--out') || '';
  if (out && !out.toLowerCase().endsWith('.json')) throw Error('--out tiene que ser un archivo .json');

  return {
    target: target.name,
    projectRef: target.ref,
    businessId,
    from,
    to,
    windowDefaulted: !values.has('--to'),
    environment,
    mode,
    providerExport: values.get('--provider-export') || null,
    providerTokenEnv,
    lagMinutes: integerOption(values, '--lag-minutes', DEFAULT_LAG_MINUTES, 0, 10_080),
    refundStuckMinutes: integerOption(values, '--refund-stuck-minutes', DEFAULT_REFUND_STUCK_MINUTES, 0, 10_080),
    maxIntents: integerOption(values, '--max-intents', DEFAULT_MAX_INTENTS, 1, 20_000),
    out,
    json: switches.has('--json'),
  };
}

/**
 * La corrida completa, con las dos fuentes inyectadas.
 *
 * @param runReadOnlySql        ejecutor de sólo lectura (se envuelve en la guarda)
 * @param fetchProviderPayments `null` en modo local, o el adaptador del proveedor
 */
export async function reconcile({ options, runReadOnlySql, fetchProviderPayments = null, now = new Date() }) {
  const run = readOnlyRunner(runReadOnlySql);
  let local = await loadLocalRows(run, {
    businessId: options.businessId, from: options.from, to: options.to, environment: options.environment, maxIntents: options.maxIntents,
  });

  let provider = null;
  if (fetchProviderPayments) {
    const environments = [...new Set(local.intents.filter((intent) => intent.in_window !== false).map((intent) => intent.environment))];
    // Un token ve un solo ambiente. Con intents de los dos y sin decir cuál se
    // consulta, la mitad saldría como «falta en el proveedor» sin faltar.
    if (!options.environment && environments.length > 1) {
      throw Error(`MIXED_ENVIRONMENTS: la ventana tiene intents de ${environments.join(' y ')}; indicá --environment para el ambiente del proveedor consultado`);
    }
    const asked = referencesNeedingExplicitLookup(local, { from: options.from, to: options.to });
    provider = assertProviderRows(await fetchProviderPayments({ externalReferences: asked, from: options.from, to: options.to }));
    // Pagos del proveedor cuya referencia no está en la ventana: antes de decir
    // que faltan localmente, se los busca por referencia sin límite de fecha.
    const known = new Set(local.intents.map((intent) => intent.external_reference));
    const unknown = [...new Set((provider.payments || []).map((payment) => normalizeProviderPayment(payment).external_reference))]
      .filter((reference) => INTEGRATION_REFERENCE.test(reference) && !known.has(reference));
    local = mergeLocalRows(local, await loadLocalRowsByReference(run, {
      businessId: options.businessId, externalReferences: unknown, maxIntents: options.maxIntents,
    }));
    // Los intents que entraron recién ahora tampoco tienen su referencia
    // consultada, y el rango no cubre su preferencia (por eso no estaban en la
    // ventana): sin esta segunda pasada su grupo de pagos quedaría incompleto.
    const late = referencesNeedingExplicitLookup(local, { from: options.from, to: options.to }).filter((reference) => !asked.includes(reference));
    if (late.length) {
      provider = mergeProviderRows(provider, assertProviderRows(await fetchProviderPayments({
        externalReferences: late, from: options.from, to: options.to, referencesOnly: true,
      })));
    }
  }

  const classification = classify(local, provider, {
    businessId: options.businessId,
    // El reloj es el de la base: el de la máquina que corre esto puede estar corrido.
    now: local.server_time || new Date(now).toISOString(),
    lagMinutes: options.lagMinutes,
    refundStuckMinutes: options.refundStuckMinutes,
    environment: fetchProviderPayments ? options.environment : null,
  });
  return buildReport({ options, local, classification, generatedAt: new Date(now).toISOString(), providerSource: providerSourceFacts(provider) });
}

// Un adaptador que no devuelve pagos ni cobertura no es «cero pagos»: con eso
// la corrida saldría 0 sin haber comparado nada.
function assertProviderRows(rows) {
  if (!rows || typeof rows !== 'object' || !Array.isArray(rows.payments) || !rows.coverage || typeof rows.coverage !== 'object') {
    throw Error('PROVIDER_RESULT_SHAPE: el adaptador del proveedor no devolvió { payments, coverage }');
  }
  return rows;
}

// Del adaptador sólo salen contadores y banderas: nada de lo que trae un pago.
function providerSourceFacts(provider) {
  if (!provider) return null;
  const facts = {};
  for (const [key, value] of Object.entries(provider.coverage || {})) {
    if (typeof value === 'number' || typeof value === 'boolean') facts[key] = value;
  }
  return facts;
}

export function buildReport({ options, local, classification, generatedAt, providerSource = null }) {
  const critical = classification.totals.by_severity.critical;
  // Diferencia entre el reloj de esta máquina y el de la base. Importa cuando
  // la ventana se calculó sola («últimos 7 días» de un reloj corrido).
  const skew = local.server_time ? Math.round((Date.parse(generatedAt) - Date.parse(local.server_time)) / 60000) : null;
  return {
    schema: REPORT_SCHEMA,
    read_only: true,
    generated_at: generatedAt,
    database_time: local.server_time || null,
    target: { name: options.target, project_ref: options.projectRef },
    business_id: options.businessId,
    business_slug: local.business_slug || null,
    window: { from: options.from, to: options.to, defaulted: Boolean(options.windowDefaulted) },
    clock_skew_minutes: Number.isFinite(skew) ? skew : null,
    environment: options.environment,
    mode: options.mode,
    options: { lag_minutes: options.lagMinutes, refund_stuck_minutes: options.refundStuckMinutes, max_intents: options.maxIntents },
    result: critical > 0 ? 'CRITICAL_FINDINGS' : 'NO_CRITICAL_FINDINGS',
    exit_code: critical > 0 ? EXIT.CRITICAL : EXIT.OK,
    // El resultado habla de hallazgos; esto, de cuánto se pudo comparar.
    provider_comparison: classification.coverage.provider_comparison,
    provider_source: providerSource,
    totals: classification.totals,
    coverage: classification.coverage,
    findings: classification.findings,
  };
}

const pad = (value, width) => String(value).padEnd(width);
const padLeft = (value, width) => String(value).padStart(width);

/** La tabla resumen, como líneas de texto. */
export function renderSummary(report, { maxListed = 40 } = {}) {
  const lines = [];
  const coverage = report.coverage;
  lines.push(`PAYMENT RECONCILIATION · ${report.target.name} (${report.target.project_ref}) · business ${report.business_slug || report.business_id}`);
  lines.push(`window ${report.window.from} → ${report.window.to} · mode ${report.mode}${report.environment ? ` · environment ${report.environment}` : ''} · READ ONLY`);
  if (report.window.defaulted && Math.abs(report.clock_skew_minutes ?? 0) > 5) {
    lines.push(`WARNING: el reloj de esta máquina difiere ${report.clock_skew_minutes} min del de la base y la ventana se calculó con él: pasá --from y --to explícitos.`);
  }
  lines.push('');
  lines.push(`${pad('code', 30)}${padLeft('critical', 9)}${padLeft('warning', 9)}${padLeft('info', 7)}`);
  for (const code of ALL_CODES) {
    const count = (severity) => report.findings.filter((finding) => finding.code === code && finding.severity === severity).length;
    lines.push(`${pad(code, 30)}${padLeft(count('critical'), 9)}${padLeft(count('warning'), 9)}${padLeft(count('info'), 7)}`);
  }
  lines.push('');
  lines.push(`local: ${report.totals.local_intents} intents · ${report.totals.local_orders} orders · ${report.totals.local_refunds} refunds`
    + ` | provider: ${report.totals.provider_payments} payments (${report.totals.provider_payments_in_scope} in scope)`);
  lines.push(`coverage: ${coverage.compared_against_provider} compared · ${coverage.no_provider_payment_expected} no payment expected`
    + ` · ${coverage.missing_at_provider} missing at provider · ${coverage.unverified_against_provider} UNVERIFIED`
    + ` · ${coverage.lag_tolerated} within lag · reconciled ${coverage.reconciled} of ${coverage.local_intents}`);
  if (!coverage.provider_supplied) lines.push('coverage: NO provider data — nothing was compared against Mercado Pago; only internal consistency was checked.');
  else if (coverage.unverified_against_provider > 0) {
    lines.push(`coverage: PARTIAL — ${coverage.partially_compared} partially compared — ${JSON.stringify(coverage.unverified_reasons)}`);
  }
  if (coverage.provider_mode === 'export' && !coverage.provider_range) {
    // Sin la consulta declarada no se sabe qué rango cubre el export ni si se filtró.
    lines.push('coverage: the export declares no "query" (begin_date/end_date) — no payment can be called missing and no intent can be called reconciled.');
  }
  if (report.provider_source?.filtered) lines.push('coverage: the export declares a FILTERED query — it is treated as incomplete.');
  if (report.provider_source?.reference_lookups_skipped > 0) {
    lines.push(`coverage: ${report.provider_source.reference_lookups_skipped} reference lookups were skipped (per-run cap) — shorten the window.`);
  }
  if (coverage.provider_payments_collector_mismatch > 0) {
    lines.push(`WARNING: ${coverage.provider_payments_collector_mismatch} provider payments belong to a collector other than the one configured for this business.`);
  }
  lines.push('');
  const listed = report.findings.filter((finding) => finding.severity !== 'info');
  for (const finding of listed.slice(0, maxListed)) {
    const subject = [finding.order_public_code ? `order ${finding.order_public_code}` : '',
      finding.payment_intent_id ? `intent ${finding.payment_intent_id}` : '',
      finding.provider_payment_id ? `payment ${finding.provider_payment_id}` : ''].filter(Boolean).join(' · ');
    lines.push(`${pad(finding.severity.toUpperCase(), 9)}${finding.code}/${finding.reason} · ${subject}`);
    lines.push(`         ${finding.explanation}`);
  }
  if (listed.length > maxListed) lines.push(`… ${listed.length - maxListed} más en el informe JSON`);
  if (listed.length) lines.push('');
  // Va antes del resultado a propósito: «sin hallazgos críticos» con
  // comparación NONE o PARTIAL no es un «todo coincide».
  lines.push(`PROVIDER COMPARISON: ${String(coverage.provider_comparison).toUpperCase()} — reconciled ${coverage.reconciled} of ${coverage.local_intents} intents`);
  lines.push(`RESULT: ${report.result} (exit ${report.exit_code})`);
  return lines;
}

// `--out` sólo pisa un informe anterior de esta misma herramienta. Un
// `--out package.json` por error no puede costar un archivo del repositorio.
function assertOutWritable(out) {
  if (!out || !existsSync(out)) return;
  let previous = null;
  try { previous = JSON.parse(readFileSync(out, 'utf8')); } catch { previous = null; }
  if (previous?.schema !== REPORT_SCHEMA) throw Error('OUT_FILE_EXISTS: --out apunta a un archivo que no es un informe de esta herramienta y no se pisa');
}

function providerSourceFor(options, env) {
  if (options.mode === 'provider-export') return createExportProvider({ filePath: options.providerExport });
  if (options.mode === 'provider-api') {
    // Se comprueba antes de leer credenciales o abrir una conexión.
    if (!env[options.providerTokenEnv]) throw Error(`PROVIDER_TOKEN_ENV_EMPTY:${options.providerTokenEnv}`);
    return createMercadoPagoSearchProvider({ tokenEnv: options.providerTokenEnv, env });
  }
  return null;
}

async function managementRunner(options) {
  // El token del CLI se lee recién acá y queda dentro del ejecutor: no pasa
  // por argumentos, no se imprime y no se escribe.
  const { leerTokenDelCli } = await import('../lib/supabase-cli-token.mjs');
  return createManagementApiRunner({ projectRef: options.projectRef, token: leerTokenDelCli() });
}

/**
 * La línea de comandos entera, devolviendo el código de salida. Las fuentes se
 * pueden inyectar (`runReadOnlySql`, `fetchProviderPayments`): así se prueba
 * sin red; sin inyectar, usa la Management API y el adaptador que pidan los flags.
 */
export async function runCli(args, deps = {}) {
  const print = deps.print || console.log;
  const printError = deps.printError || console.error;
  let options;
  try { options = parseReconcileArgs(args, { now: deps.now }); } catch (error) { printError(`ERROR ${error.message}`); return EXIT.USAGE; }
  try {
    // Antes de leer credenciales o abrir una conexión.
    assertOutWritable(options.out);
    const fetchProviderPayments = options.mode === 'local-only' ? null
      : deps.fetchProviderPayments || providerSourceFor(options, deps.env || process.env);
    const runReadOnlySql = deps.runReadOnlySql || await managementRunner(options);
    const report = await reconcile({ options, runReadOnlySql, fetchProviderPayments, now: deps.now });
    if (options.out) {
      mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
      writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
    }
    if (options.json) print(JSON.stringify(report, null, 2));
    else for (const line of renderSummary(report)) print(line);
    return report.exit_code;
  } catch (error) {
    // Sin veredicto: ni 0 ni 3. Quien automatice esto no puede leer un error como «sin hallazgos».
    // Los errores propios (`Error` con su código) se muestran; uno del motor
    // (TypeError, SyntaxError…) puede citar un pedazo del dato que lo causó,
    // así que de ésos sólo sale el tipo.
    printError(`PAYMENT_RECONCILIATION_FAILED: ${error?.name === 'Error' ? error.message : `UNEXPECTED_${error?.name || 'ERROR'}`}`);
    return EXIT.USAGE;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await runCli(process.argv.slice(2));
}
