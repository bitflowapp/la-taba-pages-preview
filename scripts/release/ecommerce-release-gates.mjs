// Compuertas automáticas de release del e-commerce. SÓLO LECTURA.
//
//   node scripts/release/ecommerce-release-gates.mjs --target staging|controlled-production --business-id <uuid>
//     [--min-products N]                 mínimo de productos públicos (1 a 500, por defecto 1)
//     [--facts facts.json]               evalúa hechos guardados, sin red (ver «HECHOS GUARDADOS»)
//     [--max-facts-age-minutes N]        antigüedad máxima de los hechos guardados (1 a 1440, por defecto 30)
//     [--save-facts facts.json]          guarda los hechos recolectados
//     [--out report.json]                reporte completo (veredicto + compuertas + hechos)
//     [--markdown report.md]             el mismo reporte para leer
//     [--ci-conclusion success --ci-commit <sha>]   resultado del CI del commit que se publica
//     [--functions-reference staging|controlled-production]   modo estricto: bundles iguales a los de ese entorno
//     [--require-rider] [--require-images] [--json]
//
// Sale con 0 SÓLO si el veredicto es PRODUCTION_READY, con 3 si es NOT_READY y
// con 2 si el pedido está mal formado.
//
// CI_GREEN compara --ci-commit con el commit del árbol y exige que las entradas
// del veredicto (registro de hallazgos, certificación, supabase/, scripts/release)
// no tengan cambios sin commitear: el CI probó el commit, no las ediciones locales.
//
// POR QUÉ EXISTE
// --------------
// `opening:check` decía TECHNICAL_READY sin mirar paridad de migraciones, Edge
// Functions desplegadas, certificación de pagos ni hallazgos P0/P1 abiertos
// (auditoría, CAT-02). Este es el único lugar que emite PRODUCTION_READY, y lo
// emite sólo si TODAS las compuertas bloqueantes pasaron con hechos leídos de
// verdad: lo que no se pudo leer queda UNKNOWN y UNKNOWN es NOT_READY.
//
// HECHOS GUARDADOS (--facts)
// -------------------------
// Una foto del destino sirve un rato, no para siempre, y no dice nada del repo
// de hoy. Por eso, al evaluar un archivo de hechos:
//   - del archivo se toma SÓLO lo que se leyó del destino; el registro de
//     hallazgos, la certificación de pagos, las migraciones, las funciones y el
//     commit se releen del árbol actual;
//   - hechos más viejos que --max-facts-age-minutes, con fecha futura o sin
//     fecha, son NOT_READY (bloqueo FACTS_PROVENANCE);
//   - la tabla, el markdown y el JSON dicen que el veredicto salió de un archivo.
//
// MONEY_MOVEMENT_POSSIBLE
// -----------------------
// La tabla, el markdown y el JSON dicen siempre si en el destino se puede crear
// hoy un cobro con dinero real: YES, NO o UNKNOWN, con sus razones (compuerta
// REAL_MONEY_GATE). Sale de las huellas de los secretos del proyecto y de la
// base; UNKNOWN nunca es NO y nunca pasa la compuerta.
//
// QUÉ NO HACE
// -----------
// No escribe en ningún entorno: lee por el endpoint de sólo lectura de la
// Management API, lista funciones y lista los NOMBRES y las huellas de los
// secretos (la API no devuelve valores). Lo único que escribe son los archivos
// locales que se le piden (--out, --markdown, --save-facts). No imprime
// credenciales, valores ni huellas de secretos, correos ni identificadores de
// cuenta.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, collectRepoFacts, isRepoRelativePath } from './gates/collect.mjs';
import { DEFAULT_MAX_FACTS_AGE_MINUTES, MAX_FACTS_AGE_LIMIT_MINUTES, RELEASE_TARGETS, VERDICTS, evaluate } from './gates/evaluate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const EXIT = Object.freeze({ READY: 0, ERROR: 1, USAGE: 2, NOT_READY: 3 });
export class UsageError extends Error {}

const VALUE_FLAGS = ['--target', '--business-id', '--min-products', '--facts', '--max-facts-age-minutes', '--save-facts', '--out',
  '--markdown', '--ci-conclusion', '--ci-commit', '--functions-reference'];
const SWITCHES = ['--require-rider', '--require-images', '--json', '--help'];

export const USAGE = [
  'Uso: node scripts/release/ecommerce-release-gates.mjs --target staging|controlled-production --business-id <uuid>',
  '       [--min-products N] [--facts facts.json [--max-facts-age-minutes N]] [--save-facts facts.json]',
  '       [--out report.json] [--markdown report.md]',
  '       [--ci-conclusion success --ci-commit <sha>] [--functions-reference staging|controlled-production]',
  '       [--require-rider] [--require-images] [--json]',
  'Salida: 0 = PRODUCTION_READY · 3 = NOT_READY · 2 = uso incorrecto',
].join('\n');

/** Los argumentos, o un UsageError. Un flag sin valor es un error, no un vacío. */
export function parseArgs(argv = []) {
  const values = {};
  const switches = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (SWITCHES.includes(arg)) { switches.add(arg); continue; }
    if (!VALUE_FLAGS.includes(arg)) throw new UsageError(arg.startsWith('--') ? `Flag desconocido: ${arg}` : `Argumento inesperado: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} necesita un valor.`);
    if (Object.hasOwn(values, arg)) throw new UsageError(`${arg} está repetido.`);
    values[arg] = value;
    index += 1;
  }
  const options = {
    help: switches.has('--help'),
    target: values['--target'] ?? null,
    businessId: values['--business-id']?.toLowerCase() ?? null,
    minProducts: null,
    facts: values['--facts'] ?? null,
    maxFactsAgeMinutes: null,
    saveFacts: values['--save-facts'] ?? null,
    out: values['--out'] ?? null,
    markdown: values['--markdown'] ?? null,
    ciConclusion: values['--ci-conclusion'] ?? null,
    ciCommit: values['--ci-commit']?.toLowerCase() ?? null,
    functionsReference: values['--functions-reference'] ?? null,
    requireRider: switches.has('--require-rider'),
    requireImages: switches.has('--require-images'),
    json: switches.has('--json'),
  };
  if (options.help) return options;

  if (options.target !== null && !RELEASE_TARGETS.includes(options.target)) {
    throw new UsageError(`--target va con ${RELEASE_TARGETS.join(' o ')}.`);
  }
  if (options.businessId !== null && !UUID.test(options.businessId)) throw new UsageError('--business-id tiene que ser un UUID.');
  if (!options.facts && (!options.target || !options.businessId)) {
    throw new UsageError('Hacen falta --target y --business-id (o --facts con hechos guardados).');
  }
  if (values['--min-products'] !== undefined) {
    const min = Number(values['--min-products']);
    if (!Number.isInteger(min) || min < 1 || min > 500) throw new UsageError('--min-products va de 1 a 500.');
    options.minProducts = min;
  }
  if (options.ciConclusion !== null && !/^[a-z_]{2,40}$/.test(options.ciConclusion)) {
    throw new UsageError('--ci-conclusion es la conclusión del CI (success, failure, cancelled…).');
  }
  if (options.ciCommit !== null && !/^[0-9a-f]{7,64}$/.test(options.ciCommit)) throw new UsageError('--ci-commit es un SHA de 7 a 64 caracteres.');
  if (options.ciCommit !== null && options.ciConclusion === null) throw new UsageError('--ci-commit va junto con --ci-conclusion.');
  if (options.functionsReference !== null) {
    if (!RELEASE_TARGETS.includes(options.functionsReference)) throw new UsageError(`--functions-reference va con ${RELEASE_TARGETS.join(' o ')}.`);
    if (options.functionsReference === options.target) throw new UsageError('--functions-reference tiene que ser un entorno distinto del destino.');
    if (options.facts) throw new UsageError('--functions-reference necesita leer el entorno: no va con --facts.');
  }
  if (options.facts && options.saveFacts) throw new UsageError('--save-facts guarda lo recolectado: no va con --facts.');
  if (values['--max-facts-age-minutes'] !== undefined) {
    if (!options.facts) throw new UsageError('--max-facts-age-minutes va con --facts.');
    const max = Number(values['--max-facts-age-minutes']);
    if (!Number.isInteger(max) || max < 1 || max > MAX_FACTS_AGE_LIMIT_MINUTES) {
      throw new UsageError(`--max-facts-age-minutes va de 1 a ${MAX_FACTS_AGE_LIMIT_MINUTES}.`);
    }
    options.maxFactsAgeMinutes = max;
  }
  return options;
}

/** 0 sólo para PRODUCTION_READY. Cualquier otra cosa, incluido un veredicto que no se entiende, es 3. */
export function exitCodeFor(verdict) {
  return verdict === VERDICTS.READY ? EXIT.READY : EXIT.NOT_READY;
}

// ── Lectura del repo ─────────────────────────────────────────────────────────
// Los errores llevan un código y la ruta RELATIVA: el motivo termina en reportes
// que se commitean, y ahí no va la ruta de disco de quien corrió la herramienta.

export function createRepoIo(root = ROOT) {
  const resolve = (relativePath) => {
    if (!isRepoRelativePath(relativePath)) throw Error(`REPO_PATH_INVALID:${String(relativePath).slice(0, 80)}`);
    return path.join(root, ...String(relativePath).split('/'));
  };
  const gitRead = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024 };
  return {
    async readRepoFile(relativePath) {
      try {
        return readFileSync(resolve(relativePath), 'utf8');
      } catch (error) {
        if (String(error.message).startsWith('REPO_PATH_INVALID')) throw error;
        throw Error(`REPO_FILE_UNREADABLE:${relativePath}:${error.code || 'ERROR'}`);
      }
    },
    async listRepoDir(relativePath) {
      try {
        return readdirSync(resolve(relativePath), { withFileTypes: true })
          .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
      } catch (error) {
        if (String(error.message).startsWith('REPO_PATH_INVALID')) throw error;
        throw Error(`REPO_DIR_UNREADABLE:${relativePath}:${error.code || 'ERROR'}`);
      }
    },
    // El commit del árbol que se evalúa: el CI que se declare tiene que ser de éste.
    async repoHead() {
      try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch (_) {
        throw Error('REPO_HEAD_UNREADABLE');
      }
    },
    // Qué tiene cambios sin commitear (o sin versionar) entre esas rutas. Con
    // --no-optional-locks git no refresca el índice: sigue siendo una lectura.
    async repoUncommitted(relativePaths) {
      const paths = relativePaths.map((relativePath) => { resolve(relativePath); return String(relativePath); });
      try {
        return execFileSync('git', ['--no-optional-locks', 'status', '--porcelain', '--', ...paths], gitRead)
          .split('\n').map((line) => line.trimEnd()).filter(Boolean);
      } catch (_) {
        throw Error('REPO_STATUS_UNREADABLE');
      }
    },
    // Si git versiona algo bajo la ruta. Que exista en el disco no alcanza:
    // hay carpetas de artifacts/ ignoradas, que no viajan con el repo.
    async repoTracked(relativePath) {
      resolve(relativePath);
      try {
        return execFileSync('git', ['ls-files', '--', String(relativePath)], gitRead).trim().length > 0;
      } catch (_) {
        throw Error('REPO_TRACKING_UNREADABLE');
      }
    },
    // Cuándo se commiteó por última vez alguna de esas rutas, en milisegundos; null
    // si git no las conoce. Es la fecha del commit, no la del archivo en el disco.
    async repoLastCommitTime(relativePaths) {
      const paths = relativePaths.map((relativePath) => { resolve(relativePath); return String(relativePath); });
      if (!paths.length) return null;
      try {
        const seconds = execFileSync('git', ['log', '-1', '--format=%ct', '--', ...paths], gitRead).trim();
        return /^\d+$/.test(seconds) ? Number(seconds) * 1000 : null;
      } catch (_) {
        throw Error('REPO_LOG_UNREADABLE');
      }
    },
  };
}

// ── Presentación ─────────────────────────────────────────────────────────────

/** FAIL en una compuerta que no bloquea se muestra como aviso; el JSON conserva FAIL. */
const shownStatus = (gate) => (gate.status === 'FAIL' && !gate.blocking ? 'WARNING' : gate.status);
const detailOf = (gate) => (gate.missing.length ? gate.missing.join(', ') : String(gate.evidence?.reason ?? ''));

/** De dónde salió el veredicto, en una línea: quien lee la tabla tiene que saber si mira una foto. */
function sourceLine(provenance) {
  if (provenance?.source === 'live') return 'source: live read (Management API, read-only)';
  if (provenance?.source === 'saved') {
    const repo = provenance.repo_sections === 'REREAD_FROM_CURRENT_TREE' ? 'repo sections re-read from the current tree' : 'repo sections NOT re-read';
    return `source: SAVED FACTS (${provenance.facts_file ?? 'file'}) — target sections from the file, ${repo}`;
  }
  return 'source: UNSPECIFIED (facts age not checked)';
}

function ageLine(result) {
  const provenance = result.provenance ?? {};
  const age = provenance.age_minutes === null || provenance.age_minutes === undefined
    ? '' : ` · age ${provenance.age_minutes} min (max ${provenance.max_age_minutes})`;
  return `facts collected: ${result.collectedAt ?? '(unknown)'}${age} · ${provenance.freshness ?? 'NOT_CHECKED'}`;
}

/** «¿Puede moverse dinero real en este destino?»: YES, NO o UNKNOWN, con sus razones. Nunca un valor ni una huella. */
function moneyLine(result) {
  const money = result.moneyMovementPossible;
  const value = ['YES', 'NO', 'UNKNOWN'].includes(money?.value) ? money.value : 'UNKNOWN';
  const reasons = Array.isArray(money?.reasons) ? money.reasons.map(String) : [];
  return `MONEY_MOVEMENT_POSSIBLE: ${value}${reasons.length ? ` (${reasons.join(', ')})` : ''}`;
}

function headerLines(result, facts) {
  const business = facts?.business?.ok === true ? facts.business : null;
  const observer = facts?.observer?.ok === true ? facts.observer : null;
  return [
    `target: ${result.target ?? '(unknown)'}${facts?.projectRef ? ` (project ${facts.projectRef})` : ''}`,
    `business: ${result.businessId ?? '(unknown)'}${business?.slug ? ` (${business.slug})` : ''}`,
    sourceLine(result.provenance),
    ageLine(result),
    `observer: ${observer ? `${observer.current_user} · transaction_read_only=${observer.transaction_read_only}` : 'UNKNOWN'}`,
    `min products: ${facts?.options?.minProducts ?? 1}`,
    moneyLine(result),
  ];
}

export function renderTable(result, facts = null) {
  const width = Math.max(...result.gates.map((gate) => gate.id.length), 4);
  const row = (id, blocking, status, detail) => `${id.padEnd(width)}  ${blocking.padEnd(8)}  ${status.padEnd(7)}  ${detail}`.trimEnd();
  const lines = ['E-COMMERCE RELEASE GATES', ...headerLines(result, facts), '', row('GATE', 'BLOCKING', 'STATUS', 'MISSING'),
    '-'.repeat(width + 30)];
  for (const gate of result.gates) lines.push(row(gate.id, gate.blocking ? 'yes' : 'no', shownStatus(gate), detailOf(gate)));
  lines.push('', `VERDICT: ${result.verdict}`);
  lines.push(`BLOCKERS (${result.blockers.length})`);
  for (const blocker of result.blockers) lines.push(`  ${blocker.gate} [${blocker.status}] ${blocker.missing.join(', ')}`);
  if (result.warnings.length) {
    lines.push(`WARNINGS (${result.warnings.length})`);
    for (const warning of result.warnings) lines.push(`  ${warning.gate} [${warning.status}] ${warning.missing.join(', ')}`);
  }
  if (result.publicLaunchBlockers.length) {
    lines.push(`PUBLIC LAUNCH BLOCKERS — external gates (${result.publicLaunchBlockers.length})`);
    for (const item of result.publicLaunchBlockers) lines.push(`  ${item.id} [${item.severity}] ${item.title}`);
  }
  return lines.join('\n');
}

const cell = (value) => String(value ?? '').replaceAll('|', '\\|').replace(/\s+/g, ' ');

export function renderMarkdown(result, facts = null) {
  const lines = ['# E-commerce release gates', '', `**VERDICT: ${result.verdict}**`, '',
    ...headerLines(result, facts).map((line) => `- ${line}`), '',
    '| Gate | Blocking | Status | Missing |', '|---|---|---|---|'];
  for (const gate of result.gates) {
    lines.push(`| ${gate.id} | ${gate.blocking ? 'yes' : 'no'} | ${shownStatus(gate)} | ${cell(detailOf(gate))} |`);
  }
  lines.push('', `## Blockers (${result.blockers.length})`, '');
  if (!result.blockers.length) lines.push('None.');
  for (const blocker of result.blockers) lines.push(`- \`${blocker.gate}\` — ${blocker.status}: ${cell(blocker.missing.join(', '))}`);
  if (result.warnings.length) {
    lines.push('', `## Warnings (${result.warnings.length})`, '');
    for (const warning of result.warnings) lines.push(`- \`${warning.gate}\` — ${cell(warning.missing.join(', '))}`);
  }
  if (result.publicLaunchBlockers.length) {
    lines.push('', `## Public launch blockers — external gates (${result.publicLaunchBlockers.length})`, '');
    for (const item of result.publicLaunchBlockers) lines.push(`- \`${item.id}\` (${item.severity}) ${cell(item.title)}${item.notes ? ` — ${cell(item.notes)}` : ''}`);
  }
  lines.push('', '## Evidence', '');
  for (const gate of result.gates) lines.push(`- \`${gate.id}\`: \`${cell(JSON.stringify(gate.evidence))}\``);
  return `${lines.join('\n')}\n`;
}

function writeLocal(file, content) {
  const absolute = path.resolve(file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

// ── Hechos ───────────────────────────────────────────────────────────────────

/**
 * Hechos guardados: un archivo de hechos, o un reporte (--out) que los trae
 * adentro. Esto sólo los carga; `run()` les reemplaza las secciones del repo
 * por las del árbol actual y exige que sean recientes.
 */
export function loadSavedFacts(file, options) {
  let document;
  try {
    document = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
  } catch (error) {
    throw new UsageError(`No se pudo leer --facts (${error.code || 'JSON inválido'}).`);
  }
  const facts = document?.facts && typeof document.facts === 'object' ? document.facts : document;
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) throw new UsageError('--facts no contiene hechos.');
  if (options.target && facts.target !== options.target) throw new UsageError(`Los hechos son de «${facts.target}», no de «${options.target}».`);
  if (options.businessId && String(facts.businessId).toLowerCase() !== options.businessId) {
    throw new UsageError('Los hechos son de otro comercio.');
  }
  // Lo que se pide en la línea de comandos manda sobre lo guardado. Unas
  // opciones guardadas que no son un objeto se dejan como están: copiarlas a uno
  // nuevo las volvería «legibles», y la evaluación tiene que verlas y rechazarlas.
  const savedOptions = facts.options;
  if (savedOptions !== undefined && (savedOptions === null || typeof savedOptions !== 'object' || Array.isArray(savedOptions))) return { ...facts };
  const merged = { ...facts, options: { ...(savedOptions || {}) } };
  if (options.minProducts !== null) merged.options.minProducts = options.minProducts;
  if (options.requireRider) merged.options.requireRider = true;
  if (options.requireImages) merged.options.requireImages = true;
  if (options.ciConclusion !== null) merged.ci = { conclusion: options.ciConclusion, commit: options.ciCommit };
  return merged;
}

async function collectLive(options, repoIo) {
  // El cableado de red se carga sólo acá: evaluar hechos guardados no toca credenciales.
  const { createLiveIo } = await import('./gates/live-io.mjs');
  const live = createLiveIo(options.target);
  const io = {
    ...repoIo, projectRef: live.ref, runReadOnlySql: live.runReadOnlySql, listFunctions: live.listFunctions,
    listSecrets: live.listSecrets,
  };
  if (options.functionsReference) io.listReferenceFunctions = createLiveIo(options.functionsReference).listFunctions;
  if (options.ciConclusion !== null) io.ciConclusion = async () => ({ conclusion: options.ciConclusion, commit: options.ciCommit });
  return collect(options.target, options.businessId, io, {
    minProducts: options.minProducts ?? 1,
    requireRider: options.requireRider,
    requireImages: options.requireImages,
    functionsReference: options.functionsReference,
  });
}

/**
 * `now` y `repoIo` se pueden inyectar para probar sin reloj y sin el árbol
 * real; desde la línea de comandos son siempre el reloj y el repo de verdad.
 */
export async function run(argv, { log = console.log, error = console.error, now = () => new Date(), repoIo = createRepoIo(ROOT) } = {}) {
  let options;
  let saved = null;
  try {
    options = parseArgs(argv);
    if (options.help) { log(USAGE); return EXIT.USAGE; }
    if (options.facts) saved = loadSavedFacts(options.facts, options);
  } catch (failure) {
    if (!(failure instanceof UsageError)) throw failure;
    error(`ERROR ${failure.message}`);
    error(USAGE);
    return EXIT.USAGE;
  }

  let facts;
  let context;
  if (saved) {
    // Del archivo, sólo lo que se leyó del destino. Lo del repo se relee: un P1
    // reabierto o una migración agregada después de la foto tienen que verse.
    facts = { ...saved, ...(await collectRepoFacts(repoIo)) };
    context = {
      source: 'saved', repoSections: 'reread', factsFile: path.basename(options.facts),
      snapshotRepoHead: saved.repo?.ok === true ? saved.repo.head : null,
      maxFactsAgeMinutes: options.maxFactsAgeMinutes ?? DEFAULT_MAX_FACTS_AGE_MINUTES,
    };
  } else {
    facts = await collectLive(options, repoIo);
    context = { source: 'live', maxFactsAgeMinutes: DEFAULT_MAX_FACTS_AGE_MINUTES };
  }
  // La hora se toma después de recolectar: la antigüedad se mide contra el momento del veredicto.
  context.now = now().toISOString();

  const result = evaluate(facts, context);
  const report = { tool: 'ecommerce-release-gates', schema: 1, evaluatedAt: context.now, source: result.provenance.source, ...result, facts };
  if (options.saveFacts) writeLocal(options.saveFacts, `${JSON.stringify(facts, null, 2)}\n`);
  if (options.out) writeLocal(options.out, `${JSON.stringify(report, null, 2)}\n`);
  if (options.markdown) writeLocal(options.markdown, renderMarkdown(result, facts));
  log(options.json ? JSON.stringify(report, null, 2) : renderTable(result, facts));
  return exitCodeFor(result.verdict);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((failure) => {
    // Un fallo inesperado nunca sale con 0: no es PRODUCTION_READY.
    console.error(`RELEASE_GATES_FAILED: ${String(failure?.message ?? failure).slice(0, 300)}`);
    process.exitCode = EXIT.ERROR;
  });
}
