// LA TABA — PREPARACIÓN DE APERTURA. El chequeo único antes de abrir. SÓLO LECTURA.
//
//   npm run opening:check                      # comercio real, mínimo 1 producto
//   npm run opening:check -- --min-products 5  # el canary pide 5
//   npm run opening:check -- --json --out docs/evidence/controlled-production/opening-check-AAAAMMDD.json
//
// Dos mitades:
//   · técnica (lo que el comercio no ve): la web responde con su versión, la
//     base contesta, lo anónimo sigue cerrado, existen el alta de pedidos, la
//     bandeja del repartidor y el registro de cobros manuales, y el pulso
//     operativo está sano;
//   · comercial: la preparación del Panel (`get_store_opening_readiness`), sin
//     recalcular ninguna regla.
//
// Termina con TECHNICAL_READY / COMMERCIAL_READY / CAN_OPEN. Sale con 0 si el
// chequeo pudo correr (los pendientes comerciales son un resultado, no un
// error); con --strict sale con 3 mientras no se pueda abrir.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REAL_BUSINESS_SLUG, connectControlledProduction, openingReportJson, parseMinProducts, presentFrom,
  readOpeningReadiness, readOption, renderOpeningLines, resolveBusiness, technicalChecks,
} from './opening-tools.mjs';

export function parseCheckArgs(args = []) {
  const known = ['--business', '--min-products', '--json', '--out', '--strict', '--no-pulse', '--verbose'];
  const unknown = args.filter((arg) => arg.startsWith('--') && !known.includes(arg));
  if (unknown.length) throw Error(`Flag desconocido: ${unknown[0]}`);
  return {
    business: readOption(args, '--business', REAL_BUSINESS_SLUG),
    minProducts: parseMinProducts(args, 1),
    json: args.includes('--json'),
    out: readOption(args, '--out', ''),
    strict: args.includes('--strict'),
    pulse: !args.includes('--no-pulse'),
    verbose: args.includes('--verbose'),
  };
}

export function verdictLines({ technicalReady, presented }) {
  return [
    `TECHNICAL_READY: ${technicalReady ? 'YES' : 'NO'}`,
    `COMMERCIAL_READY: ${presented.commercialReady ? 'YES' : 'NO'}`,
    `CAN_OPEN: ${presented.canOpen ? 'YES' : 'NO'}`,
  ];
}

async function main(args) {
  let options;
  try { options = parseCheckArgs(args); } catch (error) { console.error(`ERROR ${error.message}`); process.exitCode = 2; return; }
  const { admin, anon } = await connectControlledProduction();
  const business = await resolveBusiness(admin, options.business);
  const technical = await technicalChecks({ anon, admin, businessId: business.id, runPulse: options.pulse });
  const technicalReady = technical.checks.every((check) => check.ok);
  const payload = await readOpeningReadiness(admin, business.id, options.minProducts);
  const presented = presentFrom(payload);
  const report = openingReportJson(payload, presented, {
    target: 'controlled-production',
    technical_ready: technicalReady,
    technical: technical.checks,
    served: { commit: technical.version?.commit || null, runtime: technical.version?.runtime || null },
  });
  if (options.out) {
    mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${business.name.toUpperCase()} — PREPARACIÓN DE APERTURA`);
    console.log('');
    console.log('TÉCNICO');
    for (const check of technical.checks) console.log(`${check.ok ? '✓' : '✗'} ${check.label.padEnd(34)} ${check.detail}`);
    for (const line of renderOpeningLines(presented, { verbose: options.verbose })) console.log(line);
    console.log('');
    console.log(presented.headline);
    console.log('');
    for (const line of verdictLines({ technicalReady, presented })) console.log(line);
  }
  if (!technicalReady) process.exitCode = 1;
  else if (options.strict && !presented.canOpen) process.exitCode = 3;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => { console.error(`OPENING_CHECK_FAILED: ${error.message}`); process.exitCode = 2; });
}
