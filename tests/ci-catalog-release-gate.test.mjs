import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * DÓNDE CORRE LA COMPUERTA DE CATÁLOGO DE RELEASE, Y QUÉ DICE CUANDO NO CORRE.
 *
 * La compuerta estricta falla cerrado sin catálogo, y eso es su diseño: está
 * documentado y `catalog-release-gates.test.mjs` lo exige. El defecto era que
 * CI la corría a secas, sin el archivo que ella existe para validar, así que el
 * paso no podía pasar nunca — en ninguna rama, porque el workflow vive en
 * `main`.
 *
 * Lo que se fija acá es la distinción entre tres cosas que CI confundía en una:
 * validar, estar mal configurado, y no tener nada que validar.
 */

function correr(env = {}, argumentos = []) {
  const resultado = spawnSync(process.execPath, ['scripts/ci-catalog-release-gate.mjs', ...argumentos], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, TABA_CATALOG_FILE: '', ...env },
  });
  return { salida: `${resultado.stdout}${resultado.stderr}`, status: resultado.status };
}

test('sin catálogo indicado el paso no falla, pero deja escrito que la compuerta no corrió', () => {
  const { status, salida } = correr();
  assert.equal(status, 0, 'un PR de código no puede quedar rojo por un artefacto de release que no le toca');
  assert.match(salida, /NO CORRIÓ/, 'un verde silencioso se leería como «el catálogo está validado»');
  assert.match(salida, /TABA_CATALOG_FILE/, 'tiene que decir cómo se indica el catálogo');
  assert.match(salida, /npm run verify|release:folder/, 'y dónde sí corre la compuerta');
  assert.doesNotMatch(salida, /aprobado:/, 'no puede afirmar que validó un catálogo que no vio');
});

test('una variable mal escrita falla: no se parece a «no había catálogo»', () => {
  /*
   * El modo de falla que un `|| true` habría escondido para siempre: alguien
   * configura `TABA_CATALOG_FILE` con una ruta equivocada y CI sigue en verde
   * sin validar nada, creyendo todo el mundo que sí.
   */
  const { status, salida } = correr({ TABA_CATALOG_FILE: 'data/este-archivo-no-existe.csv' });
  assert.equal(status, 1);
  assert.match(salida, /MAL INDICADA/);
  assert.match(salida, /este-archivo-no-existe\.csv/);
});

test('con catálogo indicado corre la compuerta estricta y deja pasar su veredicto', () => {
  // La plantilla tiene las 21 columnas y cero filas: es el caso más barato de
  // «hay archivo y no sirve», y tiene que rechazar.
  const { status, salida } = correr({ TABA_CATALOG_FILE: 'data/catalog-template.csv' });
  assert.equal(status, 1);
  assert.match(salida, /CORRIENDO sobre data\/catalog-template\.csv/);
  assert.match(salida, /no contiene productos/i, 'el veredicto de la compuerta estricta tiene que llegar al log');
});

test('la ruta también se puede pasar como argumento, no sólo por variable', () => {
  const { status, salida } = correr({}, ['data/catalog-template.csv']);
  assert.equal(status, 1);
  assert.match(salida, /CORRIENDO sobre/);
});

test('la compuerta estricta sigue intacta: sin catálogo, sigue fallando cerrado', () => {
  /*
   * Esta reparación NO afloja el release. Si alguien aflojara
   * `validate-release-catalog.mjs` para que pase sin catálogo, `npm run verify`
   * y `npm run release:folder` dejarían de proteger el empaquetado.
   */
  const resultado = spawnSync(process.execPath, ['scripts/validate-release-catalog.mjs'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, TABA_CATALOG_FILE: '' },
  });
  assert.equal(resultado.status, 1);
  assert.match(`${resultado.stdout}${resultado.stderr}`, /Falta el catálogo real/);
});

test('el release sigue encadenando la compuerta estricta, y CI el envoltorio', () => {
  const paquete = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(paquete.scripts.verify, /catalog:release:validate/, 'el release usa la estricta');
  assert.match(paquete.scripts['release:folder'], /npm run verify/);
  assert.equal(paquete.scripts['catalog:release:ci'], 'node scripts/ci-catalog-release-gate.mjs');

  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /npm run catalog:release:ci/, 'CI tiene que correr el envoltorio');
  assert.doesNotMatch(
    workflow,
    /run:\s*npm run catalog:release:validate\s*$/m,
    'CI no puede volver a correr la compuerta estricta a secas: no puede pasar nunca',
  );
  assert.match(workflow, /TABA_CATALOG_FILE:\s*\$\{\{\s*vars\.TABA_CATALOG_FILE\s*\}\}/,
    'el paso tiene que poder recibir el catálogo cuando exista');
  assert.doesNotMatch(workflow, /catalog:release[^\n]*\|\|\s*true/, 'nunca un `|| true`');
});

test('lo que CI sí valida siempre del catálogo sigue en su lugar', () => {
  // El envoltorio dice que la cadena de imágenes se verifica igual. Si ese paso
  // desapareciera, el mensaje pasaría a ser mentira.
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /catalog:images:verify/);
  assert.match(workflow, /migrations:validate/);
});
