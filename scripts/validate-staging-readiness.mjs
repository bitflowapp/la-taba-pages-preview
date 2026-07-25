import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkRuntimeConfig } from './check-runtime-config.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const checks = [];

function run(label, command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', shell: false });
  checks.push({ label, ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim() });
}

for (const file of [
  '.env.example',
  'runtime-config.example.js',
  'docs/implementation/taba-staging-setup.md',
  'scripts/check-runtime-config.mjs',
  'scripts/validate-supabase-migrations.mjs',
  'data/catalog-template.csv',
]) {
  checks.push({ label: `archivo ${file}`, ok: fs.existsSync(path.join(ROOT, file)), output: '' });
}

run('migraciones estáticas', process.execPath, ['scripts/validate-supabase-migrations.mjs']);
run('plantilla de catálogo', process.execPath, [
  'scripts/validate-product-catalog.mjs',
  'data/catalog-template.csv',
  '--template',
]);

const runtimePath = process.argv[2];
if (runtimePath) {
  const runtime = await checkRuntimeConfig(runtimePath);
  checks.push({
    label: 'runtime de staging',
    ok: runtime.ok && runtime.environment === 'staging',
    output: runtime.errors.join('; '),
  });
} else {
  checks.push({
    label: 'runtime de staging real',
    ok: true,
    output: 'PREPARADO, NO EJECUTADO: pasar la ruta como primer argumento.',
  });
}

for (const check of checks) {
  console.log(`${check.ok ? 'OK' : 'ERROR'} ${check.label}${check.output ? ` — ${check.output}` : ''}`);
}
if (checks.some((check) => !check.ok)) process.exitCode = 1;
