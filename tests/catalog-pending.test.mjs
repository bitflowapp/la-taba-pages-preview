// catalog-pending.csv es el contrato con Operaciones: dice qué NO se puede
// publicar y por qué. Un pendiente desactualizado es peor que no tenerlo,
// porque manda a resolver bloqueos que ya no existen y esconde los que sí.
//
// Este test no revisa la prosa: revisa que el archivo committeado sea
// exactamente el que el generador produce hoy, y que ninguna fila afirme un
// bloqueo sobre un producto que en realidad ya se puede comprar.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { products as rawCatalog } from '../js/approved-beverage-demo-data.js';
import { applyRetailCatalogModel, getCustomerCatalogProducts } from '../js/core/catalog-store.js';

const root = path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'catalog/catalog-pending.csv');

function parseCsv(text) {
  return text.trim().split(/\r?\n/).map((line) => {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted;
      } else if (char === ',' && !quoted) { cells.push(cell); cell = ''; } else cell += char;
    }
    cells.push(cell);
    return cells;
  });
}

const rows = parseCsv(readFileSync(file, 'utf8'));
const header = rows[0];
const body = rows.slice(1);

test('el archivo committeado es el que el generador produce hoy', () => {
  const before = readFileSync(file, 'utf8');
  execFileSync(process.execPath, ['scripts/build-catalog-pending.mjs'], { cwd: root, stdio: 'pipe' });
  const after = readFileSync(file, 'utf8');
  assert.equal(after, before, 'catalog-pending.csv quedó desactualizado: corré npm run catalog:pending');
});

test('cada pendiente declara campo bloqueado, motivo y próxima acción', () => {
  assert.deepEqual(header, [
    'sku', 'gondola', 'brand', 'name', 'presentation',
    'blocked_field', 'blocking_reason', 'evidence', 'next_action',
  ]);
  for (const row of body) {
    const [sku, gondola, , , , blocked, reason, , next] = row;
    assert.ok(sku, 'fila sin SKU');
    assert.ok(gondola, `${sku}: sin góndola`);
    assert.ok(blocked, `${sku}: sin campo bloqueado`);
    // Un motivo de menos de 40 caracteres no es un motivo preciso.
    assert.ok(reason.length >= 40, `${sku}: el motivo es demasiado vago ("${reason}")`);
    assert.ok(next.length >= 20, `${sku}: sin próxima acción concreta`);
  }
});

test('ningún producto comprable aparece como pendiente', () => {
  const comprables = new Set(
    getCustomerCatalogProducts(applyRetailCatalogModel(rawCatalog))
      .filter((product) => product.available && !product.pricePending && Number(product.price) > 0 && Number(product.stock) > 0)
      .map((product) => product.id),
  );
  for (const [sku] of body) {
    assert.ok(!comprables.has(sku), `${sku} se puede comprar y sin embargo figura como pendiente`);
  }
  assert.equal(comprables.size, 11, 'cambió la cantidad de productos comprables: revisá el pendiente');
});

test('los rubros declarados sin ningún SKU relevado están registrados', () => {
  const rubros = body.filter(([sku]) => sku.startsWith('(rubro) ')).map(([sku]) => sku.replace('(rubro) ', ''));
  assert.deepEqual(rubros.sort(), ['golosinas', 'snacks']);
});

test('los combos diseñados que no se pudieron armar quedaron con su motivo', () => {
  const combos = body.filter(([sku]) => sku.startsWith('combo-')).map(([sku]) => sku);
  assert.deepEqual(combos.sort(), [
    'combo-fernet-y-coca',
    'combo-gin-tonic',
    'combo-kit-de-tragos',
    'combo-mesa-familiar',
  ]);
});
