// Inventario y auditoria de riesgo del conjunto autoritativo de migraciones,
// y manifiesto reproducible de lo que recibio produccion.
//
//   node scripts/audit-production-migrations.mjs
//   node scripts/audit-production-migrations.mjs --remote-ledger <archivo.txt>
//
// El archivo de ledger remoto es la salida cruda de
// `supabase migration list --linked`; si se pasa, cada migracion queda marcada
// como applied/missing y se compara conjunto contra conjunto.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'supabase', 'migrations');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

// Operaciones que merecen una mirada humana antes de tocar una base productiva.
// En una base nueva muchas son legitimas (una migracion vieja crea y una nueva
// reescribe), pero tienen que quedar contadas y nombradas.
const RISK = [
  ['drop_table', /\bdrop\s+table\b/gi],
  ['drop_column', /\bdrop\s+column\b/gi],
  ['drop_function', /\bdrop\s+function\b/gi],
  ['drop_policy', /\bdrop\s+policy\b/gi],
  ['truncate', /\btruncate\b/gi],
  ['delete_from', /\bdelete\s+from\b/gi],
  ['disable_rls', /\bdisable\s+row\s+level\s+security\b/gi],
  ['enable_rls', /\benable\s+row\s+level\s+security\b/gi],
  ['security_definer', /\bsecurity\s+definer\b/gi],
  ['grant', /\bgrant\b/gi],
  ['revoke', /\brevoke\b/gi],
  ['create_policy', /\bcreate\s+policy\b/gi],
  ['create_extension', /\bcreate\s+extension\b/gi],
  ['alter_owner', /\bowner\s+to\b/gi],
  ['set_search_path', /\bset\s+search_path\b/gi],
];

const files = fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort();
const digest = crypto.createHash('sha256');
const totals = Object.fromEntries(RISK.map(([k]) => [k, 0]));
const entries = [];
const anomalies = [];

for (const filename of files) {
  const raw = fs.readFileSync(path.join(dir, filename));
  const sha = crypto.createHash('sha256').update(raw).digest('hex');
  digest.update(`${filename}:${sha}\n`);
  const text = raw.toString('utf8');
  // Las lineas de comentario no cuentan como operacion.
  const code = text.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');

  const risks = {};
  for (const [key, pattern] of RISK) {
    const n = (code.match(pattern) || []).length;
    if (n > 0) { risks[key] = n; totals[key] += n; }
  }

  // SECURITY DEFINER sin search_path fijado es la anomalia que importa.
  const definerCount = risks.security_definer || 0;
  const searchPathCount = (code.match(/\bset\s+search_path\b/gi) || []).length;
  if (definerCount > searchPathCount) {
    anomalies.push({
      filename,
      kind: 'security_definer_sin_search_path',
      detail: `${definerCount} SECURITY DEFINER y ${searchPathCount} set search_path`,
    });
  }
  if (risks.disable_rls) {
    anomalies.push({ filename, kind: 'disable_rls', detail: `${risks.disable_rls} ocurrencias` });
  }
  if (risks.truncate) {
    anomalies.push({ filename, kind: 'truncate', detail: `${risks.truncate} ocurrencias` });
  }

  entries.push({
    version: filename.slice(0, 14),
    filename,
    sha256: sha,
    bytes: raw.length,
    risks,
    applied: null,
  });
}

const manifest = {
  schemaVersion: 1,
  generatedFrom: 'supabase/migrations',
  migrationCount: entries.length,
  migrationDigest: digest.digest('hex'),
  first: entries[0]?.filename ?? null,
  last: entries[entries.length - 1]?.filename ?? null,
  riskTotals: totals,
  anomalies,
  migrations: entries,
};

// --- comparacion contra el ledger remoto -------------------------------------
const ledgerFile = arg('remote-ledger');
if (ledgerFile) {
  const ledgerText = fs.readFileSync(path.resolve(ledgerFile), 'utf8');
  // Se acepta la salida cruda de `supabase migration list --linked` (tabla con
  // pipes, columna REMOTE) o un volcado del ledger con una version por linea.
  // Lo segundo es lo que devuelve la Management API, y es lo que se usa como
  // fuente: es el contenido real de supabase_migrations.schema_migrations.
  const remote = new Set();
  for (const line of ledgerText.split(/\r?\n/)) {
    const bare = line.trim();
    if (/^\d{14}$/.test(bare)) { remote.add(bare); continue; }
    if (!line.includes('|')) continue;
    const cols = line.split('|').map((c) => c.trim());
    if (cols.length >= 2 && /^\d{14}$/.test(cols[1])) remote.add(cols[1]);
  }
  const local = new Set(entries.map((e) => e.version));
  for (const entry of entries) entry.applied = remote.has(entry.version);

  manifest.remoteLedger = {
    count: remote.size,
    missingInRemote: [...local].filter((v) => !remote.has(v)).sort(),
    extraInRemote: [...remote].filter((v) => !local.has(v)).sort(),
    exactMatch: false,
  };
  manifest.remoteLedger.exactMatch =
    manifest.remoteLedger.missingInRemote.length === 0
    && manifest.remoteLedger.extraInRemote.length === 0
    && remote.size === local.size;
}

const out = path.join(root, 'artifacts', 'production-supabase', 'PRODUCTION-MIGRATIONS.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);

console.log('--- MIGRATION AUDIT ---');
console.log(`  count  : ${manifest.migrationCount}`);
console.log(`  first  : ${manifest.first}`);
console.log(`  last   : ${manifest.last}`);
console.log(`  digest : ${manifest.migrationDigest}`);
console.log('\n  operaciones de riesgo (totales sobre el conjunto):');
for (const [k, v] of Object.entries(totals)) {
  if (v > 0) console.log(`    ${k.padEnd(18)} ${v}`);
}
console.log(`\n  anomalias: ${anomalies.length}`);
for (const a of anomalies) console.log(`    ${a.kind.padEnd(34)} ${a.filename} (${a.detail})`);
if (manifest.remoteLedger) {
  console.log('\n  ledger remoto:');
  console.log(`    remoto      : ${manifest.remoteLedger.count}`);
  console.log(`    local       : ${manifest.migrationCount}`);
  console.log(`    faltan      : ${manifest.remoteLedger.missingInRemote.length}`);
  console.log(`    sobran      : ${manifest.remoteLedger.extraInRemote.length}`);
  console.log(`    exact match : ${manifest.remoteLedger.exactMatch}`);
  for (const v of manifest.remoteLedger.missingInRemote) console.log(`      FALTA  ${v}`);
  for (const v of manifest.remoteLedger.extraInRemote) console.log(`      SOBRA  ${v}`);
}
console.log(`\n  manifiesto: ${out}`);

if (manifest.remoteLedger && !manifest.remoteLedger.exactMatch) process.exit(1);
