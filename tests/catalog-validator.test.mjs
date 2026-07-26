import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { REQUIRED_COLUMNS, validateCatalog } from '../scripts/validate-product-catalog.mjs';

const template = fs.readFileSync(new URL('../data/catalog-template.csv', import.meta.url), 'utf8');
const masterTemplate = fs.readFileSync(new URL('../templates/la-taba-products-template.csv', import.meta.url), 'utf8');

test('catalog template has every required column and intentionally no commercial rows', () => {
  for (const candidate of [template, masterTemplate]) {
    const report = validateCatalog(candidate, { allowEmpty: true });
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.products, []);
    for (const column of REQUIRED_COLUMNS) assert.match(candidate, new RegExp(`\\b${column}\\b`));
  }
  assert.equal(masterTemplate.trim(), template.trim());
});

test('catalog validator rejects duplicates, alcohol without age and unsafe image path', () => {
  const header = template.trim();
  const row = [
    'id-1', 'SKU-1', 'Marca QA', 'Producto QA', 'Variante', 'Cervezas', 'QA',
    '473', 'ml', 'lata', '1', '1000', '1', 'true', 'true', '', 'true', 'false',
    '1', '../secret.webp', 'qa',
  ].join(',');
  const report = validateCatalog(`${header}\n${row}\n${row}\n`, {
    fileExists: () => true,
  });
  assert.ok(report.errors.some((error) => /external_id duplicado/.test(error)));
  assert.ok(report.errors.some((error) => /SKU duplicado/.test(error)));
  assert.ok(report.errors.some((error) => /alcohol sin edad/.test(error)));
  assert.ok(report.errors.some((error) => /ruta de imagen insegura/.test(error)));
});
