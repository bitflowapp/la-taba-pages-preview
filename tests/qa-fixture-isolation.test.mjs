import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { products } from '../js/approved-beverage-demo-data.js';

const root = path.resolve(import.meta.dirname, '..');
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('QA fixtures are Node-test-only and cannot enter the browser demo bundle', () => {
  const dataSource = source('js/data.js');
  const appSource = source('js/app.js');
  const serviceWorker = source('sw.js');
  const documentSource = source('index.html');

  assert.match(dataSource, /approved-beverage-demo-data\.js/);
  assert.doesNotMatch(dataSource, /beverage-qa-data\.js|legacy-qa-catalog|\bqa-/);
  assert.doesNotMatch(appSource, /beverage-qa-data\.js|legacy-qa-catalog/);
  assert.doesNotMatch(documentSource, /beverage-qa-data\.js|legacy-qa-catalog/);
  assert.doesNotMatch(serviceWorker, /beverage-qa-data\.js|legacy-qa-catalog|tests\/fixtures/);
});

test('the visible demo catalog has only the 22 approved commercial SKUs', () => {
  assert.equal(products.length, 22);
  assert.equal(new Set(products.map((product) => product.sku)).size, 22);
  assert.ok(products.every((product) => !product.sku.startsWith('qa-')));
});
