// Qué falta para abrir el comercio real de CONTROLLED_PRODUCTION. SÓLO LECTURA.
//
//   node scripts/controlled-production/opening-readiness.mjs [--business la-taba-cp] [--min-products 1] [--json] [--out report.json]
//
// La respuesta es la de `get_store_opening_readiness`: la misma lista que ve el
// dueño en Panel › Preparar apertura. Este script no recalcula ninguna regla.
// Imprime READY o BLOCKED y, por cada bloqueo, code, título, motivo, acción y
// dónde se arregla.
//
// La verificación de plataforma ya NO se escribe desde acá: es
// `npm run opening:approve` (RPC con compuertas, confirmación y auditoría).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REAL_BUSINESS_SLUG, connectControlledProduction, openingReportJson, parseMinProducts, presentFrom,
  readOpeningReadiness, readOption, renderOpeningLines, resolveBusiness,
} from './opening-tools.mjs';

export function parseReadinessArgs(args = []) {
  if (args.includes('--verify-ordering')) {
    throw Error('La verificación de plataforma se hace con: npm run opening:approve -- --verifier-email <operador>');
  }
  const known = ['--business', '--min-products', '--json', '--out', '--verbose'];
  const unknown = args.filter((arg) => arg.startsWith('--') && !known.includes(arg));
  if (unknown.length) throw Error(`Flag desconocido: ${unknown[0]}`);
  return {
    business: readOption(args, '--business', REAL_BUSINESS_SLUG),
    minProducts: parseMinProducts(args, 1),
    json: args.includes('--json'),
    verbose: args.includes('--verbose'),
    out: readOption(args, '--out', ''),
  };
}

async function main(args) {
  let options;
  try { options = parseReadinessArgs(args); } catch (error) { console.error(`ERROR ${error.message}`); process.exitCode = 2; return; }
  const { admin } = await connectControlledProduction();
  const business = await resolveBusiness(admin, options.business);
  const payload = await readOpeningReadiness(admin, business.id, options.minProducts);
  const presented = presentFrom(payload);
  const report = openingReportJson(payload, presented, { target: 'controlled-production' });
  if (options.out) {
    mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.json) { console.log(JSON.stringify(report, null, 2)); return; }

  console.log(`${business.name} (${business.slug}) — ${presented.headline}`);
  for (const line of renderOpeningLines(presented, { verbose: options.verbose })) console.log(line);
  console.log('');
  console.log(report.verdict);
  for (const blocker of report.blockers) {
    console.log(`  ${blocker.code} · ${blocker.title}: ${blocker.reason}${blocker.where_to_fix ? ` → ${blocker.where_to_fix}` : ''}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => { console.error(`OPENING_READINESS_FAILED: ${error.message}`); process.exitCode = 2; });
}
