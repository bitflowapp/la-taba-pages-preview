// El config productivo se DERIVA, y las clases prohibidas lo cierran.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// `runtime-config-sentinels.test.mjs` cubre el otro lado: que la plantilla sin
// editar no pase por válida. Lo que faltaba era el camino de ida —quién escribe
// el config productivo— y ése era, hasta ahora, una persona en el momento de
// publicar.
//
// `STAGING-V61-CERTIFICACION.md` deja anotado cómo se cobra ese hueco:
// `create-release-folder.mjs` copió la plantilla del repo sobre el paquete y el
// preflight tuvo que frenar la publicación. Un archivo escrito a mano en el
// momento de desplegar es exactamente donde entra un ref de staging.
//
// Estas pruebas corren el generador como lo corre un despliegue —proceso
// aparte, argumentos de verdad— y comprueban las dos mitades:
//
//   · que con los datos correctos emite un config que el resolutor del
//     navegador acepta como `production`
//   · que cada clase de credencial y cada objetivo equivocado lo CIERRAN, con
//     el motivo dicho, en vez de emitir un archivo que después falla en el aire
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readRuntimeFile } from '../scripts/check-runtime-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUION = path.join(root, 'scripts', 'build-production-runtime-config.mjs');

const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const STAGING_REF = 'ukxqbgswjlibmnjemrzd';
const CANONICAL_BUSINESS = '00000000-0000-4000-8000-000000000001';

// Una clave publicable con la FORMA correcta y sin valor real: alcanza para
// ejercitar el generador y no es una credencial de ningún proyecto.
const CLAVE_DE_PRUEBA = 'sb_publishable_0123456789abcdefghijklmn';

/**
 * Corre el generador y devuelve {code, stdout, stderr} sin tirar.
 *
 * `spawnSync` y no `execFileSync`: el generador escribe el diagnóstico por
 * stderr también cuando sale bien —el archivo va por stdout, la evidencia por
 * stderr— y `execFileSync` sólo devuelve stderr cuando el proceso falla.
 */
function correr(args, env = {}) {
  const r = spawnSync(process.execPath, [GUION, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TABA_PRODUCTION_PUBLISHABLE_KEY: '', ...env },
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('con los datos correctos emite un config que resuelve como production', () => {
  const r = correr(['--key', CLAVE_DE_PRUEBA]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /globalThis\.__LA_TABA_RUNTIME_CONFIG__/);
  assert.match(r.stdout, new RegExp(`supabaseUrl: 'https://${PRODUCTION_REF}\\.supabase\\.co'`));
  assert.match(r.stdout, new RegExp(`businessId: '${CANONICAL_BUSINESS}'`));
  assert.match(r.stdout, /deploymentEnvironment: 'production'/);
  // El resolutor tiene que haber dicho que sí, no el generador sobre sí mismo.
  assert.match(r.stderr, /entorno\s+: production/);
  assert.match(r.stderr, new RegExp(`host\\s+: ${PRODUCTION_REF}\\.supabase\\.co`));
});

test('la URL se deriva del ref: no hay forma de que digan cosas distintas', () => {
  const r = correr(['--key', CLAVE_DE_PRUEBA]);
  const url = r.stdout.match(/supabaseUrl: '([^']+)'/)?.[1];
  assert.equal(url, `https://${PRODUCTION_REF}.supabase.co`);
  // El generador no acepta una URL como argumento, así que no existe el estado
  // «ref productivo con URL de otra cosa» que el gate del Rider tuvo que agregar.
  assert.doesNotMatch(fs.readFileSync(GUION, 'utf8'), /arg\('(url|supabase-url)'\)/);
});

test('el ref de staging cierra la emisión', () => {
  const r = correr(['--key', CLAVE_DE_PRUEBA, '--ref', STAGING_REF]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /staging/i);
  assert.doesNotMatch(r.stdout, /__LA_TABA_RUNTIME_CONFIG__/, 'no puede emitir nada');
});

test('cualquier ref que no sea el productivo cierra la emisión', () => {
  const r = correr(['--key', CLAVE_DE_PRUEBA, '--ref', 'abcdefghijklmnopqrst']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, new RegExp(`el ref productivo es ${PRODUCTION_REF}`));
});

test('el uuid de ceros de la plantilla cierra la emisión', () => {
  const r = correr(['--key', CLAVE_DE_PRUEBA, '--business', '00000000-0000-4000-8000-000000000000']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /negocio canonico/);
});

test('otro negocio cualquiera cierra la emisión', () => {
  const r = correr(['--key', CLAVE_DE_PRUEBA, '--business', '11111111-1111-4111-8111-111111111111']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /negocio canonico/);
});

// --- las clases de credencial que no pueden viajar en un navegador ---
//
// Se construyen acá con la FORMA de cada clase y sin valor real. Lo que se
// prueba es que el generador las distingue por clase, no que reconozca una
// credencial concreta.
const CLAVES_PROHIBIDAS = [
  {
    nombre: 'clave secreta de proyecto',
    valor: `sb_secret_${'0123456789abcdef'}`,
    espera: /SECRETA de proyecto/,
  },
  {
    nombre: 'token de management',
    valor: `sbp_${'0'.repeat(40)}`,
    espera: /management\/acceso personal/,
  },
  {
    nombre: 'JWT heredado que se declara del rol de servicio',
    valor: [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ iss: 'supabase', ref: PRODUCTION_REF, role: 'service_role' })).toString('base64url'),
      'firma-que-no-importa',
    ].join('.'),
    espera: /rol de servicio/,
  },
  {
    nombre: 'JWT anónimo heredado (clase vieja, ya no se acepta en producción)',
    valor: [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ iss: 'supabase', ref: PRODUCTION_REF, role: 'anon' })).toString('base64url'),
      'firma-que-no-importa',
    ].join('.'),
    espera: /clase publicable/,
  },
  {
    nombre: 'cadena cualquiera',
    valor: 'no-soy-una-clave',
    espera: /clase publicable/,
  },
];

for (const { nombre, valor, espera } of CLAVES_PROHIBIDAS) {
  test(`la ${nombre} cierra la emisión`, () => {
    const r = correr(['--key', valor]);
    assert.equal(r.code, 1, `debía cerrarse y salió ${r.code}`);
    assert.match(r.stderr, espera);
    assert.doesNotMatch(r.stdout, /__LA_TABA_RUNTIME_CONFIG__/, 'no puede emitir nada');
  });
}

test('sin clave no emite y lo dice como falta de dato, no como rechazo', () => {
  const r = correr([]);
  assert.equal(r.code, 2, 'un dato que falta no es lo mismo que una configuración rechazada');
  assert.match(r.stderr, /falta la clave publicable/);
});

test('un pollMs fuera de rango cierra la emisión', () => {
  assert.equal(correr(['--key', CLAVE_DE_PRUEBA, '--poll-ms', '10']).code, 1);
  assert.equal(correr(['--key', CLAVE_DE_PRUEBA, '--poll-ms', '600000']).code, 1);
  assert.equal(correr(['--key', CLAVE_DE_PRUEBA, '--poll-ms', '5000']).code, 0);
});

test('con --out escribe el archivo y no deja candidatos temporales atrás', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-runtime-'));
  const destino = path.join(dir, 'runtime-config.js');
  try {
    const r = correr(['--key', CLAVE_DE_PRUEBA, '--out', destino]);
    assert.equal(r.code, 0, r.stderr);
    const escrito = fs.readFileSync(destino, 'utf8');
    assert.match(escrito, /deploymentEnvironment: 'production'/);
    // El candidato temporal vive en la raíz del repo mientras se valida; si
    // quedara, el árbol dejaría de estar limpio y el manifiesto de release lo
    // registraría como sucio.
    const residuos = fs.readdirSync(root).filter((f) => f.startsWith('.runtime-config.candidato.'));
    assert.deepEqual(residuos, [], 'no puede quedar un candidato sin borrar');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('el archivo emitido no es el que el repositorio versiona', () => {
  // La plantilla fail-closed del repo tiene que seguir siendo la que se versiona:
  // si el generador escribiera sobre ella, cualquier artefacto de
  // previsualización empezaría a hablar con la base real.
  //
  // Se comprueba EJECUTÁNDOLA, no leyendo el texto: la plantilla trae el objeto
  // de ejemplo escrito dentro de un comentario, así que buscar la cadena marca
  // en falso. Lo que importa es que evaluarla no defina nada.
  assert.equal(readRuntimeFile(path.join(root, 'runtime-config.js')), null);
  assert.doesNotMatch(fs.readFileSync(GUION, 'utf8'), /join\(root, 'runtime-config\.js'\)/);
});
