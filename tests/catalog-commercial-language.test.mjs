import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const activeCatalogFiles = [
  'js/beverage-qa-data.js',
  'js/data.js',
  'data/catalog-template.csv',
  'templates/la-taba-products-template.csv',
  'docs/phase-2/real-product-catalog-plan.md',
  'docs/phase-2/photo-shot-list.md',
  'docs/demo-walter-checklist.md',
  'tests/business.test.mjs',
  'tests/product-readiness.test.mjs',
  'tests/delivery-proof.test.mjs',
];

test('active catalog fixtures and operating docs contain no inherited food-store model', () => {
  const forbidden = /\bp-asado\b|\bcarnes\b|\basado\b|\bmatambre\b|\bmilanesa\b|\bpizzería\b|\bcarnicería\b|\bparrilla\b|\bmercadito\b/i;
  for (const relativePath of activeCatalogFiles) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.doesNotMatch(source, forbidden, `legacy food-store language in ${relativePath}`);
  }
});
