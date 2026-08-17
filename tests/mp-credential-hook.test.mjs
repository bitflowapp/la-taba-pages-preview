// El control anti-fuga de credenciales de Mercado Pago, ejercitado.
//
// El hook del plugin nunca se habia probado en este repositorio porque nunca
// llego a correr: invocaba `python3`, que en este host no existe. Estas pruebas
// ejercitan el port de Node que si corre, y lo hacen en las dos direcciones —
// que bloquee lo que tiene que bloquear, y que NO bloquee lo demas.
//
// Los tokens sinteticos se arman con `join('-')` a proposito. Escritos de
// corrido serian una cadena que el propio control -y el escaner de secretos del
// repositorio, y el grep de CI- detectan como credencial: la prueba de la
// alarma no puede disparar la alarma.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PATTERNS,
  decide,
  extractText,
  isEnvFile,
  isMercadoPagoProject,
  scan,
} from '../scripts/hooks/validate-mp-credentials.mjs';

const REPO = path.resolve(import.meta.dirname, '..');

/** Token con la forma exacta que el patron declara, sin escribirlo de corrido. */
const ACCESS_TOKEN = ['TEST', '123456789012', '010101', 'a'.repeat(32), 'U1'].join('-');
/** El mismo, con 31 hex en vez de 32: no es la forma, no se bloquea. */
const NEAR_MISS = ['TEST', '123456789012', '010101', 'a'.repeat(31), 'U1'].join('-');

/** Un directorio sin relacion con Mercado Pago, con borde de repositorio. */
function ajenoAMercadoPago() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-hook-'));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

test('el control ve algo: los patrones detectan la forma declarada', () => {
  // Un patron que no coincide con nada pasa siempre. Sin este caso, romper una
  // expresion regular convierte el control en un no-op silencioso.
  assert.equal(Object.keys(PATTERNS).length, 4);
  assert.ok(scan(ACCESS_TOKEN).length > 0, 'el token sintetico tendria que coincidir');
});

test('este repositorio esta dentro del alcance del control', () => {
  // package.json nombra mercadopago. Si dejara de nombrarlo, el hook se
  // volveria inerte y nadie se enteraria: por eso se afirma.
  assert.equal(isMercadoPagoProject(REPO), true);
});

test('un proyecto ajeno queda fuera, aun con una credencial en la mano', () => {
  const dir = ajenoAMercadoPago();
  try {
    const verdict = decide({ tool_name: 'Bash', tool_input: { command: `curl -H "x: ${ACCESS_TOKEN}"` } }, dir);
    assert.equal(verdict.block, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('el borde del repositorio tambien lo marca un worktree', () => {
  // En un git worktree `.git` es un ARCHIVO. El original comprobaba isdir, asi
  // que la caminata se escapaba del proyecto y seguia subiendo por el disco.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-hook-wt-'));
  try {
    fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /algun/lado\n');
    assert.equal(isMercadoPagoProject(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BLOQUEA un access token en un comando de Bash', () => {
  const verdict = decide({ tool_name: 'Bash', tool_input: { command: `export MP=${ACCESS_TOKEN}` } }, REPO);
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, /MP Access Token/);
});

test('BLOQUEA un client_secret en una edicion', () => {
  const nuevo = `{ "client_secret": "${'b'.repeat(32)}" }`;
  const verdict = decide({ tool_name: 'Edit', tool_input: { file_path: 'js/pago.js', new_string: nuevo } }, REPO);
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, /Client Secret/);
});

test('BLOQUEA un Bearer con token de Mercado Pago', () => {
  const verdict = decide({
    tool_name: 'Write',
    tool_input: { file_path: 'js/x.js', content: `headers: { Authorization: "Bearer ${ACCESS_TOKEN}" }` },
  }, REPO);
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, /Bearer Token/);
});

test('BLOQUEA un webhook secret asignado', () => {
  const contenido = `const cfg = { "webhook_secret": "${'c'.repeat(24)}" };`;
  const verdict = decide({ tool_name: 'Write', tool_input: { file_path: 'js/y.js', content: contenido } }, REPO);
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, /Webhook Secret/);
});

test('BLOQUEA cada edicion de un MultiEdit, no solo la primera', () => {
  const verdict = decide({
    tool_name: 'MultiEdit',
    tool_input: { file_path: 'js/z.js', edits: [{ new_string: 'inocuo' }, { new_string: ACCESS_TOKEN }] },
  }, REPO);
  assert.equal(verdict.block, true);
});

test('el motivo NUNCA incluye el valor que coincidio', () => {
  // Imprimir la credencial en stderr la escribe en el log de la sesion, que es
  // exactamente lo que el control viene a evitar.
  const verdict = decide({ tool_name: 'Bash', tool_input: { command: ACCESS_TOKEN } }, REPO);
  assert.equal(verdict.block, true);
  assert.ok(!verdict.reason.includes(ACCESS_TOKEN));
  assert.ok(!verdict.reason.includes('a'.repeat(32)));
});

test('BLOQUEA leer un .env, y PERMITE leer el .env.example', () => {
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: path.join(REPO, '.env') } }, REPO).block, true);
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: path.join(REPO, '.env.example') } }, REPO).block, false);
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: path.join(REPO, 'package.json') } }, REPO).block, false);
});

test('un .env de otro arbol no cuenta como .env de este proyecto', () => {
  // Sin el ancla a la raiz, cualquier ruta terminada en .env quedaba bloqueada,
  // incluida una de un proyecto que no es este.
  assert.equal(isEnvFile(path.join(os.tmpdir(), '.env'), REPO), false);
  assert.equal(isEnvFile(path.join(REPO, '.env'), REPO), true);
});

test('PERMITE escribir la credencial en el .env, que es donde va', () => {
  const verdict = decide({
    tool_name: 'Write',
    tool_input: { file_path: path.join(REPO, '.env'), content: `MP_ACCESS_TOKEN=${ACCESS_TOKEN}` },
  }, REPO);
  assert.equal(verdict.block, false);
});

test('PERMITE lo que se parece pero no es la forma declarada', () => {
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: NEAR_MISS } }, REPO).block, false);
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'npm run check' } }, REPO).block, false);
  assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: 'README.md', content: 'MP_ACCESS_TOKEN=...' } }, REPO).block, false);
});

test('PERMITE cuando el proyecto apago el control a proposito', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-hook-off-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'mercadopago.local.md'), '---\nenabled: false\n---\n');
    fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /algun/lado\n');
    const verdict = decide({ tool_name: 'Bash', tool_input: { command: ACCESS_TOKEN } }, dir);
    assert.equal(verdict.block, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('una herramienta sin texto que mirar no bloquea', () => {
  assert.equal(extractText('Glob', { pattern: '**/*' }), '');
  assert.equal(decide({ tool_name: 'Glob', tool_input: { pattern: '**/*' } }, REPO).block, false);
  assert.equal(decide({}, REPO).block, false);
});
