/*
 * EL INTERRUPTOR DE DINERO REAL (EDGE-03): dónde puede vivir y qué valor abre.
 *
 * Decisión del dueño: «REAL_MONEY_ENABLED debe venir de secreto/configuración
 * de backend. NO frontend. NO base pública. NO código hardcodeado».
 *
 * El comportamiento lo prueban las suites de Deno (`npm run test:webhook`:
 * real-money-gate.deno.ts, checkout-session-availability.deno.ts,
 * current-payment-authority.deno.ts, mercadopago-preference.deno.ts) y la
 * compuerta de release (tests/ecommerce-release-gates.test.mjs). Esto fija lo
 * que un refactor no puede mover de lugar.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const SWITCH = 'MERCADOPAGO_REAL_MONEY_ENABLED';
const LEGACY = 'MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION';
const LEGACY_PHRASE = 'I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE';

/** Los archivos del árbol que viajan con el repo: versionados y nuevos no ignorados. */
function repoFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\n').map((line) => line.trim()).filter(Boolean)
    .filter((file) => fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).isFile());
}

const TEXT_FILE = /\.(?:m?js|cjs|ts|tsx|json|jsonc|toml|ya?ml|sql|html|css|md|txt|env|example|ps1|sh)$/i;
const filesMentioning = (needle) => repoFiles()
  .filter((file) => TEXT_FILE.test(file) && fs.statSync(path.join(root, file)).size <= 4_000_000)
  .filter((file) => read(file).includes(needle));

test('el interruptor vive sólo en el backend, en las herramientas y en la documentación: nunca en el frontend ni en la base', () => {
  const mentions = filesMentioning(SWITCH);
  assert.ok(mentions.length > 0, 'nadie nombra el interruptor: el lector se rompió');
  const allowed = (file) => file.startsWith('supabase/functions/') || file.startsWith('scripts/') || file.startsWith('tests/')
    || file.startsWith('docs/') || /^[A-Za-z0-9_.-]+\.md$/.test(file)
    // La evidencia de sólo lectura (salidas de la compuerta de release, que informan si el interruptor está o no) es
    // documentación: no es código que lo lea ni lo cargue.
    || file.startsWith('artifacts/');
  assert.deepEqual(mentions.filter((file) => !allowed(file)), [], 'el interruptor apareció fuera del backend, las herramientas o la documentación');
  // Explícitamente: ni la web, ni una migración, ni una prueba de la base, ni el CI.
  for (const forbidden of ['js/', 'supabase/migrations/', 'supabase/tests/', '.github/', 'deploy/', 'src-tauri/']) {
    assert.deepEqual(mentions.filter((file) => file.startsWith(forbidden)), [], forbidden);
  }
  // En el código de las funciones (sin sus pruebas) el nombre como literal está UNA vez: la constante de
  // real-money-gate.ts. Los demás lo leen por esa constante (los comentarios pueden nombrarlo).
  const literal = `['"]${SWITCH}['"]`;
  const runtime = mentions.filter((file) => file.startsWith('supabase/functions/') && !/\.(?:deno|test)\.ts$/.test(file))
    .filter((file) => new RegExp(literal).test(read(file)));
  assert.deepEqual(runtime, ['supabase/functions/_shared/real-money-gate.ts']);
  assert.equal(read(runtime[0]).match(new RegExp(literal, 'g')).length, 1);
});

test('el valor que abre sale del secreto del proyecto, comparado tal cual, y nada lo trae puesto', () => {
  const gate = read('supabase/functions/_shared/real-money-gate.ts');
  const runtime = read('supabase/functions/_shared/payment-runtime.ts');
  assert.match(gate, /export const REAL_MONEY_SWITCH_OPEN_VALUE = 'enabled';/);
  // Exacto: sin recortar ni pasar a minúsculas la variable antes de comparar.
  const comparison = gate.split('\n').find((line) => line.includes('const real_money_switch ='));
  assert.equal(comparison.trim(), 'const real_money_switch = input.realMoneySwitch === REAL_MONEY_SWITCH_OPEN_VALUE;');
  assert.doesNotMatch(gate, /realMoneySwitch\s*\?\?|realMoneySwitch\s*\|\||realMoneySwitch\)?\.(?:trim|toLowerCase)/);
  // Leída del entorno del proyecto, cruda; ningún valor por defecto.
  assert.match(runtime, /realMoneySwitch: Deno\.env\.get\(REAL_MONEY_SWITCH\),/);
  for (const file of repoFiles().filter((name) => name.startsWith('supabase/functions/') && /\.ts$/.test(name) && !/\.deno\.ts$/.test(name))) {
    assert.doesNotMatch(read(file), /Deno\.env\.set\(/, `${file} escribe el entorno`);
  }
  // La pura no lee nada por su cuenta.
  assert.doesNotMatch(gate, /Deno\.env|fetch\(|import /);
});

test('la variable vieja de humo no la lee ninguna función', () => {
  const runtimeFiles = repoFiles().filter((file) => file.startsWith('supabase/functions/') && /\.ts$/.test(file) && !/\.(?:deno|test)\.ts$/.test(file));
  for (const file of runtimeFiles) {
    const source = read(file);
    assert.doesNotMatch(source, new RegExp(LEGACY_PHRASE), file);
    // Sólo real-money-gate.ts la nombra, como constante documentada para las herramientas.
    if (file !== 'supabase/functions/_shared/real-money-gate.ts') assert.doesNotMatch(source, new RegExp(LEGACY), file);
  }
  assert.doesNotMatch(read('supabase/functions/_shared/real-money-gate.ts'), /Deno\.env\.get\(LEGACY_SMOKE_CONFIRMATION\)/);
});

const RUNBOOKS = [
  'docs/MERCADOPAGO_PRODUCCION_CP.md',
  'docs/payments/mercadopago/PRODUCTION_CHECKLIST.md',
  'docs/payments/mercadopago/CREDENTIALS.md',
  'MERCADOPAGO-PRODUCTION-ACTIVATION.md',
  'RUNBOOK-PRIMER-PEDIDO-REAL.md',
  'docs/REAL-PAYMENT-CANARY-RUNBOOK.md',
];

test('los runbooks hablan del interruptor, sólo le dan el valor enabled y ya no mandan a poner la frase vieja', () => {
  for (const file of RUNBOOKS) {
    const text = read(file);
    assert.ok(text.includes(SWITCH), `${file} no nombra el interruptor`);
    // Cada asignación del interruptor en un runbook es exactamente `enabled`.
    for (const [, value] of text.matchAll(/MERCADOPAGO_REAL_MONEY_ENABLED\s*[:=]\s*`?([^\s`|,;)]+)/g)) {
      assert.equal(value, 'enabled', `${file} le asigna otro valor al interruptor`);
    }
    // La frase vieja ya no se escribe en ningún runbook: ni como instrucción ni como valor.
    assert.ok(!text.includes(LEGACY_PHRASE), `${file} todavía trae la frase vieja de humo`);
    assert.doesNotMatch(text, new RegExp(`${LEGACY}\\s*=`), `${file} todavía manda a poner la variable vieja`);
  }
  // Cómo se apaga en un paso, y que la plata que vuelve sigue: lo dice el runbook de CP.
  const cp = read('docs/MERCADOPAGO_PRODUCCION_CP.md');
  assert.match(cp, /borrar el secreto `MERCADOPAGO_REAL_MONEY_ENABLED`/);
  assert.match(cp, /reembolsos/i);
});
