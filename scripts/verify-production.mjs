// Un solo comando que dice si el candidato productivo se sostiene.
//
//   npm run production:verify
//
// NO CONSTRUYE, NO DESPLIEGA, NO ESCRIBE EN LA BASE. Sólo lee: el árbol, los
// manifiestos que otras herramientas ya dejaron, el paquete si existe, y —si hay
// token— la base de producción en modo lectura.
//
// Un paso que no se puede correr se declara OMITIDO con el motivo. No se
// silencia y no se cuenta como verde: un verde que incluye lo que no se miró es
// peor que un rojo, porque se cree.
//
// Salida 0 = todo lo que se pudo mirar está bien. 1 = hay algo. 2 = no se pudo.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const CANONICAL_BUSINESS = '00000000-0000-4000-8000-000000000001';

const skipSlow = process.argv.includes('--fast');
const results = [];

function run(label, cmd, args, { optional = false, skipIf = null } = {}) {
  if (skipIf) {
    results.push({ label, status: 'OMITIDO', detail: skipIf });
    return;
  }
  const started = Date.now();
  const out = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = out.status === 0;
  results.push({
    label,
    status: ok ? 'OK' : (optional ? 'AVISO' : 'FALLA'),
    detail: ok ? `${seconds}s` : `salida ${out.status} · ${seconds}s`,
    output: ok ? null : `${out.stdout ?? ''}${out.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n'),
  });
}

// 1 · El árbol tiene que estar limpio: un candidato con cambios sin commitear no
//     es reproducible, y su hash no describe nada.
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim();
results.push(dirty
  ? { label: 'árbol limpio', status: 'FALLA', detail: `${dirty.split('\n').length} archivo(s) sin commitear`, output: dirty.split('\n').slice(0, 10).join('\n') }
  : { label: 'árbol limpio', status: 'OK', detail: 'sin cambios' });

// 2 · Los gates estáticos del repositorio.
run('gates estáticos (npm run check)', 'npm', ['run', 'check']);

// 3 · El contrato de las migraciones: la historia no se puede haber movido.
run('ledger de migraciones', 'node', ['scripts/audit-remediation-migrations.mjs']);

// 4 · La guardia de destino, con el ref escrito a mano.
run('guardia de destino', 'node', [
  'scripts/assert-production-supabase-target.mjs',
  '--ref', PRODUCTION_REF,
  '--url', `https://${PRODUCTION_REF}.supabase.co`,
  '--category', 'verify',
]);

// 5 · El paquete, si está construido. No se construye acá: construir es mutar.
const dist = path.join(root, 'dist_release');
run('escaneo del paquete web', 'node', [
  'scripts/scan-production-artifacts.mjs', 'dist_release',
  ...(fs.existsSync(path.join(root, 'dist-desktop')) ? ['dist-desktop'] : []),
  '--business-id', CANONICAL_BUSINESS,
], {
  skipIf: fs.existsSync(dist)
    ? null
    : 'no hay dist_release; correr `npm run vendor:build && node scripts/create-release-folder.mjs`',
});

// 6 · La base, en modo lectura. Sin token no se inventa un resultado.
run('salud de producción', 'node', ['scripts/production-health-check.mjs', '--ref', PRODUCTION_REF], {
  skipIf: process.env.SUPABASE_ACCESS_TOKEN
    ? null
    : 'falta SUPABASE_ACCESS_TOKEN; la sonda no se puede correr',
});

// 7 · Las pruebas. Lo más lento, y por eso al final.
run('pruebas unitarias', 'npm', ['test'], {
  skipIf: skipSlow ? 'pedido --fast' : null,
});

// ---------- informe ----------

const ancho = Math.max(...results.map((r) => r.label.length));
console.log('\n--- VERIFICACIÓN DEL CANDIDATO PRODUCTIVO ---\n');
for (const r of results) {
  console.log(`  ${r.label.padEnd(ancho)}  ${r.status.padEnd(8)} ${r.detail}`);
}

const fallas = results.filter((r) => r.status === 'FALLA');
const omitidos = results.filter((r) => r.status === 'OMITIDO');

if (fallas.length) {
  console.log('\n  QUÉ FALLÓ:\n');
  for (const f of fallas) {
    console.log(`  · ${f.label}`);
    if (f.output) console.log(f.output.split('\n').map((l) => `      ${l}`).join('\n'));
  }
}
if (omitidos.length) {
  console.log('\n  NO SE PUDO MIRAR:\n');
  for (const o of omitidos) console.log(`  · ${o.label}: ${o.detail}`);
}

console.log(
  `\n  ${results.length - fallas.length - omitidos.length} verde(s) · `
  + `${fallas.length} falla(s) · ${omitidos.length} omitido(s)\n`,
);
process.exit(fallas.length ? 1 : 0);
