// ============================================================================
//  Aplicación CONTROLADA del paquete de operación y cobertura a staging
// ============================================================================
//
//  POR QUÉ NO ES `supabase db push`
//  --------------------------------
//  El ledger remoto tiene dos migraciones —20260812090000 y 20260812100000— que
//  NO existen en ningún commit: quedaron como archivos sueltos en el worktree de
//  otra sesión, que las aplicó y no las versionó. El CLI se niega a correr
//  mientras haya versiones remotas sin archivo local, y lo único que ofrece es
//  `migration repair --status reverted`, que sería declarar revertidas dos
//  migraciones que están aplicadas. Eso es mentir en el ledger compartido.
//
//  Este script hace lo que `db push` haría, pero acotado a lo propio:
//    · aplica EXCLUSIVAMENTE los archivos que se le nombran acá abajo;
//    · escribe EXCLUSIVAMENTE sus propias filas en
//      supabase_migrations.schema_migrations, con la misma forma que las que ya
//      están (version, name, statements);
//    · no toca, no revierte y no reinterpreta ninguna fila ajena;
//    · cada migración va en su propia transacción junto con su fila de ledger:
//      o entran las dos, o no entra ninguna.
//
//  Es el mismo camino que usó la sesión de identidad para su propio paquete.
//
//  Uso:
//    TABA_APPLY_STAGING=1 node scripts/apply-business-operations-to-staging.mjs [--dry-run]
//
//  El token sale del Administrador de credenciales de Windows y NUNCA se imprime.
// ============================================================================
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { assertLedgerParity } from './check-migration-ledger-parity.mjs';

const PROJECT_REF = 'ukxqbgswjlibmnjemrzd';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

// El paquete, explícito y cerrado. Si un archivo no está en esta lista, no se
// aplica: no hay descubrimiento automático de «lo que falte».
const PACKAGE = [
  '20260812200000_business_operations_hours_and_delivery_zones.sql',
  '20260812210000_business_operations_resolution.sql',
  '20260812220000_business_operations_checkout_enforcement.sql',
  '20260812230000_business_operations_panel_rpcs.sql',
  '20260812240000_customer_address_declared_neighborhood.sql',
];

if (process.env.TABA_APPLY_STAGING !== '1' && !dryRun) {
  console.error('Refusing to mutate staging without TABA_APPLY_STAGING=1.');
  process.exit(2);
}

function token() {
  const value = execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(root, 'scripts', 'read-supabase-token.ps1'),
  ], { encoding: 'utf8' }).trim();
  if (!/^sbp_[A-Za-z0-9]+$/.test(value)) throw new Error('token del CLI ilegible');
  return value;
}

const bearer = token();

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await response.text();
  if (!response.ok) {
    // El mensaje del servidor se muestra; el token no aparece en ninguna parte.
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 600)}`);
  }
  try { return JSON.parse(text); } catch { return text; }
}

// COMPUERTA. Antes de mirar nada más: si el árbol local no es exactamente el
// ledger remoto, no se muta staging. Falla cerrado, y también falla cuando no
// puede comprobarlo.
await assertLedgerParity({ explain: true });

const ledgerBefore = await query(
  'select version from supabase_migrations.schema_migrations order by version',
);
const applied = new Set(ledgerBefore.map((row) => row.version));
console.log(`ledger antes: ${applied.size} aplicadas, última ${[...applied].pop()}`);

// Una versión del paquete que ya figure en el ledger significa colisión con algo
// ajeno —ya pasó una vez— y es motivo de parada, no de reintento.
for (const file of PACKAGE) {
  const version = file.slice(0, 14);
  if (applied.has(version)) {
    throw new Error(`la versión ${version} ya está en el ledger remoto: colisión, no se aplica nada`);
  }
}

const pendingForeign = PACKAGE.length;
console.log(`paquete: ${pendingForeign} migraciones, ninguna presente en el ledger remoto.`);

if (dryRun) {
  console.log('DRY RUN: no se aplicó nada.');
  process.exit(0);
}

for (const file of PACKAGE) {
  const version = file.slice(0, 14);
  const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', file), 'utf8');
  // La migración y su fila de ledger, en la misma transacción. `$mig$` delimita
  // el cuerpo sin tener que escapar comillas.
  const statement = [
    'begin;',
    sql,
    ';',
    'insert into supabase_migrations.schema_migrations (version, name, statements)',
    `values (${literal(version)}, ${literal(file)}, array[$mig$${sql}$mig$]);`,
    'commit;',
  ].join('\n');
  if (sql.includes('$mig$')) throw new Error(`el archivo ${file} contiene el delimitador reservado`);
  process.stdout.write(`aplicando ${file} … `);
  await query(statement);
  console.log('ok');
}

const ledgerAfter = await query(
  'select version, name from supabase_migrations.schema_migrations order by version',
);
console.log(`ledger después: ${ledgerAfter.length} aplicadas.`);
const added = ledgerAfter.filter((row) => !applied.has(row.version)).map((row) => row.version);
console.log(`filas agregadas: ${added.join(', ')}`);
if (added.length !== PACKAGE.length) {
  throw new Error(`se esperaban ${PACKAGE.length} filas nuevas y hay ${added.length}`);
}

function literal(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
