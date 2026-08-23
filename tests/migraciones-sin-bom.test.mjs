import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { reviewMigrations } from '../scripts/validate-supabase-migrations.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIGRACIONES = path.join(root, 'supabase/migrations');
const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);

/*
 * NINGÚN ARCHIVO SQL EMPIEZA CON EL BOM DE UTF-8.
 *
 * Un editor de Windows lo pone solo, no se ve en ningún diff y no molesta a
 * nadie hasta que Postgres intenta ejecutar el archivo:
 *
 *     ERROR: syntax error at or near "﻿" (SQLSTATE 42601)
 *     At statement: 0
 *
 * El 2026-08-23 se aplicaron 112 migraciones y la 113 murió así. Costó el job
 * entero: ni las 162 aserciones pgTAP ni el simulacro de restauración llegaron
 * a correr. Y no se veía: estaba tapado detrás de otro defecto que impedía
 * arrancar el stack, así que llevaba días ahí sin que nadie lo supiera.
 */

/** Los bytes crudos: leer con `utf8` esconde el BOM como un carácter invisible. */
function empiezaConBom(archivo) {
  const descriptor = fs.openSync(archivo, 'r');
  const cabecera = Buffer.alloc(3);
  fs.readSync(descriptor, cabecera, 0, 3, 0);
  fs.closeSync(descriptor);
  return cabecera.equals(BOM);
}

test('ninguna migración empieza con BOM', () => {
  const conBom = fs.readdirSync(MIGRACIONES)
    .filter((nombre) => nombre.endsWith('.sql'))
    .filter((nombre) => empiezaConBom(path.join(MIGRACIONES, nombre)));
  assert.deepEqual(conBom, [], 'Postgres aborta la migración entera al toparse con el BOM');
});

test('ningún SQL del proyecto empieza con BOM, tampoco los de prueba', () => {
  // Los de `supabase/tests` los corre `supabase test db` y mueren igual.
  const raices = ['supabase/migrations', 'supabase/tests'];
  const conBom = [];
  for (const raiz of raices) {
    const directorio = path.join(root, raiz);
    if (!fs.existsSync(directorio)) continue;
    for (const nombre of fs.readdirSync(directorio)) {
      if (!nombre.endsWith('.sql')) continue;
      if (empiezaConBom(path.join(directorio, nombre))) conBom.push(`${raiz}/${nombre}`);
    }
  }
  assert.deepEqual(conBom, []);
});

test('el validador de migraciones lo rechaza, y dice qué hacer', () => {
  /*
   * La guardia con dientes: si esto no fallara, el BOM volvería a llegar a CI
   * y volvería a costar un job de quince minutos para decir «syntax error».
   */
  const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-bom-'));
  try {
    const archivo = path.join(temporal, '20260101000000_prueba.sql');
    fs.writeFileSync(archivo, Buffer.concat([BOM, Buffer.from('-- nada\n', 'utf8')]));

    const conBom = reviewMigrations(temporal);
    const errores = conBom.issues.filter((problema) => problema.severity === 'error');
    assert.equal(errores.length, 1, JSON.stringify(conBom.issues));
    assert.match(errores[0].message, /BOM/);
    assert.match(errores[0].message, /sin BOM/, 'el error tiene que decir cómo se arregla');

    fs.writeFileSync(archivo, Buffer.from('-- nada\n', 'utf8'));
    const sinBom = reviewMigrations(temporal);
    assert.deepEqual(sinBom.issues.filter((problema) => problema.severity === 'error'), []);
  } finally {
    fs.rmSync(temporal, { force: true, recursive: true });
  }
});
