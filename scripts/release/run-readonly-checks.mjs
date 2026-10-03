/*
 * Correr un archivo de consultas de verificación contra Staging o CONTROLLED
 * PRODUCTION, en modo de SÓLO LECTURA.
 *
 * POR QUÉ EXISTE
 * --------------
 * El plan de promoción pide correr la verificación previa de las migraciones
 * (`docs/migrations/checks/*.sql`) antes y después de aplicarlas, en cada
 * entorno, y guardar las dos salidas. Hasta acá eso se hacía con una
 * herramienta de la máquina de quien operaba. Ésta queda en el repositorio para
 * que el paso sea el mismo para cualquiera.
 *
 * QUÉ GARANTIZA
 * -------------
 *   · cada sentencia va al endpoint de sólo lectura de la Management API
 *     (`database/query/read-only`): la base la ejecuta en una transacción de
 *     sólo lectura, con un rol que no puede escribir;
 *   · además, del lado de acá, una sentencia que no empieza con SELECT o WITH
 *     se rechaza antes de mandarla;
 *   · el destino se nombra siempre (`--target`) y sólo puede ser uno de los dos
 *     proyectos de abajo; cualquier otro, y en especial producción, se rechaza;
 *   · el token se lee de donde lo guarda el CLI (o, para CONTROLLED PRODUCTION,
 *     de su credencial propia), nunca se imprime ni se escribe.
 *
 *   node scripts/release/run-readonly-checks.mjs --target staging|controlled-production \
 *     --file docs/migrations/checks/20261001_ecommerce_hardening_preflight.sql [--out reporte.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGETS = Object.freeze({
  staging: 'ucbtjcurawxjwjdvvcvj',
  'controlled-production': 'tkanbadcglszlcyfjvpv',
});

/** Separa el archivo en sentencias: una por consulta, sin las líneas de comentario. */
export function splitStatements(sql) {
  return String(sql).replace(/\r\n/g, '\n').split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(/;\s*\n/)
    .map((statement) => statement.trim().replace(/;$/, '').trim())
    .filter(Boolean);
}

/** El nombre de la verificación: la columna `finding` que cada consulta devuelve. */
export function findingName(statement) {
  return /select\s+'([a-z0-9_]+)'\s+as\s+finding/i.exec(statement)?.[1] ?? null;
}

export function assertReadOnlyStatement(statement) {
  if (!/^(select|with)\b/i.test(statement.trim())) {
    throw new Error(`NOT_A_READ_ONLY_STATEMENT: ${statement.trim().slice(0, 60)}`);
  }
  return statement;
}

export function parseArgs(args = []) {
  const value = (flag) => {
    const index = args.indexOf(flag);
    if (index < 0) return '';
    const next = args[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`${flag} requiere un valor.`);
    return next;
  };
  const target = value('--target');
  if (!Object.hasOwn(TARGETS, target)) {
    throw new Error(`--target tiene que ser ${Object.keys(TARGETS).join(' o ')}; llegó «${target || '(vacío)'}».`);
  }
  const file = value('--file');
  if (!file) throw new Error('--file es obligatorio.');
  return { target, ref: TARGETS[target], file, out: value('--out') || null };
}

export async function runChecks({ ref, statements, query, log = console.log }) {
  const report = { ref, checks: [] };
  for (const statement of statements) {
    const name = findingName(statement) ?? '(sin nombre)';
    assertReadOnlyStatement(statement);
    try {
      const rows = await query(ref, statement);
      report.checks.push({ finding: name, rows: rows.length, sample: rows.slice(0, 8) });
      log(`${name.padEnd(46)} rows=${rows.length}`);
    } catch (error) {
      report.checks.push({ finding: name, error: String(error?.message || error).slice(0, 240) });
      log(`${name.padEnd(46)} ERROR ${String(error?.message || error).slice(0, 160)}`);
    }
  }
  return report;
}

async function managementQuery(token) {
  return async (ref, statement) => {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query/read-only`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: statement }),
      signal: AbortSignal.timeout(120000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP_${response.status} ${text.slice(0, 200)}`);
    const body = JSON.parse(text);
    if (!Array.isArray(body)) throw new Error('UNEXPECTED_RESPONSE_SHAPE');
    return body;
  };
}

async function main(args) {
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    process.exitCode = 2;
    return;
  }
  const statements = splitStatements(fs.readFileSync(path.resolve(options.file), 'utf8'));
  let token = null;
  if (options.target === 'controlled-production') {
    const { leerSecreto } = await import('../e2e-production-sale/secretos-windows.mjs');
    token = leerSecreto('CP SUPABASE ACCESS TOKEN')?.secreto || null;
  }
  if (!token) {
    const { leerTokenDelCli } = await import('../lib/supabase-cli-token.mjs');
    token = leerTokenDelCli();
  }
  console.error(`Proyecto ${options.ref} (${options.target}) · ${statements.length} consultas · sólo lectura`);
  const report = await runChecks({ ref: options.ref, statements, query: await managementQuery(token) });
  report.target = options.target;
  report.file = options.file;
  report.at = new Date().toISOString();
  if (options.out) fs.writeFileSync(options.out, `${JSON.stringify(report, null, 1)}\n`);
  if (report.checks.some((check) => check.error)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2));
}
