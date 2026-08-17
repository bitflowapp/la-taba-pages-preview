// Manifiesto forward-only del alta autogestionada.
//
//   node scripts/audit-registration-migrations.mjs
//
// Parte el ledger local en dos y conserva LOS DOS digests, igual que hizo la
// remediacion antes:
//
//   BASE 103    lo que ya esta aplicado en produccion. Inmutable. Su digest
//               tiene que seguir siendo exactamente el que publico la
//               remediacion; si cambia, alguien toco historia y hay que frenar.
//   REGISTRATION las migraciones 104+, cada una con su hash propio.
//
// El digest de las 100 originales se verifica ADEMAS por separado. Podria
// parecer redundante —si las 103 estan intactas, las 100 tambien— pero es la
// forma de que el mensaje de una falla diga que se rompio: la historia
// original, o el tramo que agrego la remediacion.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'supabase', 'migrations');
const outDir = path.join(root, 'artifacts', 'taba2-registration-identity');

// Certificado por el provisioning sobre las primeras 100 migraciones.
const HISTORICAL_DIGEST =
  'e45f69cdb9c939e29620278450984cd2f4e42ad52cf79295470437c35f5cf2a9';
// Publicado por la remediacion de produccion sobre el ledger de 103.
const APPLIED_DIGEST =
  'b2af10478c4effc5451f26b5a38b1242a519b1b34248ad5a883444673a4eab76';
const HISTORICAL_COUNT = 100;
const APPLIED_COUNT = 103;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Mismo algoritmo que los dos manifiestos anteriores, para que los digests sean
// comparables entre misiones: sha256 sobre la concatenacion de
// `<filename>:<sha256 del archivo>\n` en orden de nombre.
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

const historical = entries.slice(0, HISTORICAL_COUNT);
const applied = entries.slice(0, APPLIED_COUNT);
const registration = entries.slice(APPLIED_COUNT);

const historicalDigest = digestOf(historical);
const appliedDigest = digestOf(applied);
const fullDigest = digestOf(entries);
const historyIntact = historicalDigest === HISTORICAL_DIGEST;
const appliedIntact = appliedDigest === APPLIED_DIGEST;

const manifest = {
  schemaVersion: 1,
  scope: 'registration-identity',
  description: 'Migraciones forward-only 104+ del alta autogestionada.',
  historicalCount: historical.length,
  historicalDigest,
  historicalDigestMatchesProvisioning: historyIntact,
  appliedCount: applied.length,
  appliedDigest,
  appliedDigestMatchesRemediation: appliedIntact,
  newMigrationCount: registration.length,
  totalMigrationCount: entries.length,
  fullLedgerDigest: fullDigest,
  migrations: registration.map((e, i) => ({ ordinal: APPLIED_COUNT + i + 1, ...e })),
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'REGISTRATION-MIGRATIONS.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log('--- REGISTRATION MIGRATION MANIFEST ---');
console.log(`  historical count  : ${historical.length}`);
console.log(`  historical digest : ${historicalDigest}`);
console.log(`  expected (prov.)  : ${HISTORICAL_DIGEST}`);
console.log(`  HISTORY INTACT    : ${historyIntact ? 'YES' : 'NO'}`);
console.log(`  applied count     : ${applied.length}`);
console.log(`  applied digest    : ${appliedDigest}`);
console.log(`  expected (remed.) : ${APPLIED_DIGEST}`);
console.log(`  APPLIED INTACT    : ${appliedIntact ? 'YES' : 'NO'}`);
console.log(`  new migrations    : ${registration.length}`);
for (const [i, e] of registration.entries()) {
  console.log(`    ${APPLIED_COUNT + i + 1}. ${e.filename}`);
  console.log(`       sha256 ${e.sha256}`);
}
console.log(`  total ledger      : ${entries.length}`);
console.log(`  full digest       : ${fullDigest}`);

if (!historyIntact) {
  console.error('\n  ABORTADO: cambio el digest de las 100 historicas.');
  process.exit(1);
}
if (!appliedIntact) {
  console.error('\n  ABORTADO: cambio el digest de las 103 ya aplicadas en produccion.');
  process.exit(1);
}
if (registration.length === 0) {
  console.error('\n  ABORTADO: no hay migraciones nuevas que publicar.');
  process.exit(1);
}
