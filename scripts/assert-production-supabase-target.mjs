// Guardia de destino para toda operacion contra el Supabase PRODUCTIVO de TABA.
//
// Falla cerrado. Se niega a pasar si el destino esta vacio, si es staging, si no
// es el production esperado, si el host no corresponde al ref, o si el worktree
// esta vinculado a otro proyecto. No acepta default implicito: el ref hay que
// escribirlo.
//
//   node scripts/assert-production-supabase-target.mjs --ref <project-ref>
//   node scripts/assert-production-supabase-target.mjs --ref <ref> --category "db push"
//
// Salida 0 = seguir. Cualquier otra = ABORTAR.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Identidades conocidas. STAGING nunca puede ser destino de una mutacion.
const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const PRODUCTION_NAME = 'la-taba-production';
const FORBIDDEN = new Map([
  ['ukxqbgswjlibmnjemrzd', 'la-taba-staging'],
  ['yakhtrkukqlgzvxuvhzs', 'la-taba-demo'],
]);

const REF_SHAPE = /^[a-z]{20}$/;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const failures = [];
function check(id, condition, detail) {
  if (!condition) failures.push(`${id}: ${detail}`);
  return condition;
}

const requested = (arg('ref') || '').trim();
const category = (arg('category') || 'unspecified').trim();
const url = (arg('url') || '').trim();

console.log('--- TARGET GUARD ---');
console.log(`  TARGET NAME     : ${requested === PRODUCTION_REF ? PRODUCTION_NAME : '(desconocido)'}`);
console.log(`  TARGET REF      : ${requested || '(vacio)'}`);
console.log(`  TARGET HOST     : ${requested ? `db.${requested}.supabase.co` : '(vacio)'}`);
console.log(`  COMMAND CATEGORY: ${category}`);

// CHECK A - el ref pedido es exactamente el production nuevo.
check('A', requested.length > 0, 'no se indico --ref; no hay default implicito');
check('A', REF_SHAPE.test(requested), `el ref "${requested}" no tiene forma de project ref`);
check('A', requested === PRODUCTION_REF, `el ref pedido no es el production de TABA (${PRODUCTION_REF})`);

// CHECK B - no es staging ni ningun otro proyecto conocido.
if (FORBIDDEN.has(requested)) {
  failures.push(`B: ${requested} es ${FORBIDDEN.get(requested)} - PROHIBIDO COMO DESTINO`);
}
check('B', requested !== 'ukxqbgswjlibmnjemrzd', 'el destino es STAGING');

// CHECK C - el host declarado corresponde al ref.
if (url) {
  let host = '';
  try { host = new URL(url).host; } catch { host = ''; }
  check('C', host.length > 0, `--url "${url}" no es una URL valida`);
  check('C', host === `${requested}.supabase.co` || host === `db.${requested}.supabase.co`,
    `el host "${host}" no corresponde al ref ${requested}`);
}

// CHECK D - el worktree no puede estar vinculado a otro proyecto.
// Este es el accidente historico: un comando corrido desde un repo cuyo
// project_id no era el que se creia.
const linkedFile = path.join(root, 'supabase', '.temp', 'project-ref');
if (fs.existsSync(linkedFile)) {
  const linked = fs.readFileSync(linkedFile, 'utf8').trim();
  check('D', linked === requested,
    `el worktree esta vinculado a ${linked}, no a ${requested}`);
  console.log(`  LINKED REF      : ${linked}`);
} else {
  console.log('  LINKED REF      : (sin vincular)');
}

// CHECK E - staging y production no pueden ser el mismo ref.
check('E', PRODUCTION_REF !== 'ukxqbgswjlibmnjemrzd',
  'el ref de production coincide con el de staging');

if (failures.length > 0) {
  console.error('\n  ABORTADO - la guardia no dejo pasar:');
  for (const f of failures) console.error(`    ${f}`);
  process.exit(1);
}

console.log('  RESULTADO       : PASS (A, B, C, D, E)');
process.exit(0);
