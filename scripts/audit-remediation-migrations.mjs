// Manifiesto de la remediacion forward-only de produccion.
//
//   node scripts/audit-remediation-migrations.mjs
//
// Parte el ledger local en dos y conserva LOS DOS digests:
//
//   BASE        las primeras 100, que son historia inmutable. Su digest tiene
//               que seguir siendo exactamente el que certifico el provisioning.
//               Si cambia, algo toco una migracion historica y hay que frenar.
//   REMEDIATION las migraciones 101+, cada una con su hash propio.
//
// El digest historico NO se reemplaza por uno nuevo: se verifica y se publica
// junto al digest del conjunto completo.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'supabase', 'migrations');
const outDir = path.join(root, 'artifacts', 'production-remediation');

// Certificado por el provisioning sobre las primeras 100 migraciones.
const HISTORICAL_DIGEST =
  'e45f69cdb9c939e29620278450984cd2f4e42ad52cf79295470437c35f5cf2a9';
const BASE_COUNT = 100;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Mismo algoritmo que audit-production-migrations.mjs: sha256 sobre la
// concatenacion de `<filename>:<sha256 del archivo>\n` en orden de nombre.
function digestOf(entries) {
  const h = crypto.createHash('sha256');
  for (const e of entries) h.update(`${e.filename}:${e.sha256}\n`);
  return h.digest('hex');
}

const files = fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort();
const entries = files.map((filename) => {
  const raw = fs.readFileSync(path.join(dir, filename));
  return {
    version: filename.slice(0, 14),
    filename,
    sha256: sha256(raw),
    bytes: raw.length,
  };
});

const base = entries.slice(0, BASE_COUNT);
const remediation = entries.slice(BASE_COUNT);

const baseDigest = digestOf(base);
const fullDigest = digestOf(entries);
const intact = baseDigest === HISTORICAL_DIGEST;

const baseManifest = {
  schemaVersion: 1,
  scope: 'base',
  description: 'Las 100 migraciones historicas. Inmutables.',
  migrationCount: base.length,
  expectedDigest: HISTORICAL_DIGEST,
  migrationDigest: baseDigest,
  digestMatchesProvisioning: intact,
  first: base[0]?.filename ?? null,
  last: base[base.length - 1]?.filename ?? null,
  migrations: base,
};

const remediationManifest = {
  schemaVersion: 1,
  scope: 'remediation',
  description: 'Migraciones forward-only 101+ de la remediacion de produccion.',
  baseCount: base.length,
  baseDigest,
  baseDigestMatchesProvisioning: intact,
  newMigrationCount: remediation.length,
  totalMigrationCount: entries.length,
  fullLedgerDigest: fullDigest,
  migrations: remediation.map((e, i) => ({ ordinal: BASE_COUNT + i + 1, ...e })),
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'BASE-100-MIGRATIONS.json'),
  `${JSON.stringify(baseManifest, null, 2)}\n`,
);
fs.writeFileSync(
  path.join(outDir, 'REMEDIATION-MIGRATIONS.json'),
  `${JSON.stringify(remediationManifest, null, 2)}\n`,
);

console.log('--- REMEDIATION MIGRATION MANIFEST ---');
console.log(`  base count        : ${base.length}`);
console.log(`  base digest       : ${baseDigest}`);
console.log(`  expected (prov.)  : ${HISTORICAL_DIGEST}`);
console.log(`  HISTORY INTACT    : ${intact ? 'YES' : 'NO'}`);
console.log(`  new migrations    : ${remediation.length}`);
for (const [i, e] of remediation.entries()) {
  console.log(`    ${BASE_COUNT + i + 1}. ${e.filename}`);
  console.log(`       sha256 ${e.sha256}`);
}
console.log(`  total ledger      : ${entries.length}`);
console.log(`  full digest       : ${fullDigest}`);

if (!intact) {
  console.error('\n  ABORTADO: el digest historico cambio. Se toco una migracion inmutable.');
  process.exit(1);
}
