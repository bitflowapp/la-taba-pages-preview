// FASE 20 - Compara el retrato del shadow (construido desde cero con las
// migraciones autoritativas) contra el retrato de produccion. Cualquier
// diferencia estructural es drift y hay que explicarla.
//
//   node scripts/compare-production-drift.mjs

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'artifacts', 'production-supabase');

function load(name) {
  const file = path.join(dir, `SECURITY-PORTRAIT-${name}.json`);
  if (!fs.existsSync(file)) { console.error(`falta ${file}`); process.exit(2); }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const shadow = load('shadow');
const production = load('production');
const drift = [];
const explained = [];

// Diferencias esperadas y deseables. pgtap lo instala el arnes de shadow para
// correr las suites; que NO exista en produccion es el resultado correcto.
const EXPLAINED = [
  { area: 'extensions', item: 'pgtap', reason: 'extension de test: solo el shadow la instala, produccion no debe tenerla' },
];

// 1. Recuentos estructurales.
const a = shadow.counts?.[0] ?? {};
const b = production.counts?.[0] ?? {};
for (const key of Object.keys(a)) {
  if (String(a[key]) !== String(b[key])) {
    drift.push({ area: 'counts', item: key, shadow: a[key], production: b[key] });
  }
}

// 2. Conjuntos nombrados. Se comparan como conjuntos, no como listas ordenadas.
function compareSets(area, rows1, rows2, keyOf) {
  const s1 = new Set((rows1 || []).map(keyOf));
  const s2 = new Set((rows2 || []).map(keyOf));
  for (const k of s1) if (!s2.has(k)) drift.push({ area, item: k, shadow: 'presente', production: 'AUSENTE' });
  for (const k of s2) if (!s1.has(k)) drift.push({ area, item: k, shadow: 'AUSENTE', production: 'presente' });
}

compareSets('rls', shadow.rls, production.rls,
  (r) => `${r.table_name} rls=${r.rls_enabled} policies=${r.policies}`);
compareSets('security_definer', shadow.securityDefiner, production.securityDefiner,
  (f) => `${f.name}(${f.args}) config=${f.config} anon=${f.anon_execute} auth=${f.authenticated_execute}`);
compareSets('table_grants', shadow.tableGrants, production.tableGrants,
  (g) => `${g.grantee}:${g.table_name}:${g.privileges}`);
compareSets('column_grants', shadow.columnGrants, production.columnGrants,
  (g) => `${g.grantee}:${g.table_name}:${g.grants}`);
compareSets('anon_executable', shadow.anonExecutable, production.anonExecutable,
  (f) => f.name);
compareSets('buckets', shadow.buckets, production.buckets,
  (x) => `${x.id} public=${x.public} limit=${x.file_size_limit}`);
compareSets('storage_policies', shadow.storagePolicies, production.storagePolicies,
  (p) => `${p.table_name}:${p.policy}:${p.cmd}`);

// Las extensiones se comparan por nombre: la version la fija la plataforma y
// puede diferir legitimamente entre la imagen local y el proyecto hosteado.
compareSets('extensions', shadow.extensions, production.extensions, (e) => e.name);

// Se apartan las diferencias que ya estan justificadas de antemano.
for (let i = drift.length - 1; i >= 0; i -= 1) {
  const match = EXPLAINED.find((e) => e.area === drift[i].area && drift[i].item.startsWith(e.item));
  if (match) explained.push({ ...drift.splice(i, 1)[0], reason: match.reason });
}

const report = {
  schemaVersion: 1,
  comparedAt: new Date().toISOString(),
  shadow: { source: shadow.ref, capturedAt: shadow.capturedAt },
  production: { source: production.ref, capturedAt: production.capturedAt },
  unexplainedDriftCount: drift.length,
  drift,
  explainedDifferences: explained,
};

const out = path.join(dir, 'SCHEMA-DRIFT.json');
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

console.log('--- SCHEMA DRIFT: shadow (desde cero) vs production ---');
if (drift.length === 0) {
  console.log('  NO UNEXPLAINED DRIFT - los dos retratos son identicos en');
  console.log('  tablas, vistas, funciones, policies, indices, triggers, enums,');
  console.log('  constraints, RLS, SECURITY DEFINER, privilegios, extensiones y storage.');
} else {
  console.log(`  ${drift.length} diferencias NO explicadas:`);
  for (const d of drift) console.log(`    [${d.area}] ${d.item}  shadow=${d.shadow}  production=${d.production}`);
}
if (explained.length > 0) {
  console.log(`\n  diferencias explicadas (${explained.length}):`);
  for (const e of explained) console.log(`    [${e.area}] ${e.item} -> ${e.reason}`);
}
console.log(`\n  informe: ${out}`);
process.exit(drift.length === 0 ? 0 : 1);
