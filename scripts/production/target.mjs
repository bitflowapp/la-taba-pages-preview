// El destino de producción, leído de deploy/environments.json, para guiones de PowerShell y flujos de GitHub.
//
//   node scripts/production/target.mjs                 JSON del destino (sale 2 si producción no tiene proyecto)
//   node scripts/production/target.mjs --field ref     sólo un campo (ref, supabaseUrl, origin, businessId, ...)
//   node scripts/production/target.mjs --status        not_provisioned | provisioned | active (sale 0 siempre)
//
// Por defecto acepta un proyecto `provisioned` (creado y todavía sin abrir); `--require-active` exige `active`.
import process from 'node:process';

import { productionTargetOrExit, readEnvironments } from '../lib/environments.mjs';

const args = process.argv.slice(2);
if (args.includes('--status')) {
  console.log(readEnvironments().environments.production.status);
  process.exit(0);
}
const target = productionTargetOrExit({ allowProvisioned: !args.includes('--require-active') });
const field = args.includes('--field') ? args[args.indexOf('--field') + 1] : null;
if (field) {
  if (!Object.hasOwn(target, field)) {
    console.error(`campo desconocido: ${field}`);
    process.exit(2);
  }
  console.log(String(target[field]));
} else {
  console.log(JSON.stringify(target, null, 2));
}
