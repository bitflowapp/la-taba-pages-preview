import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { recordsFromCsvRows } from '../scripts/catalog-images/lib.mjs';
import { parseCsv } from '../scripts/validate-product-catalog.mjs';
import { handleProductImageError, productThumb } from '../js/ui.js';
import { products } from '../js/beverage-qa-data.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const placeholder = 'assets/products/beverage-placeholder.svg';
const sourceAudit = fs.readFileSync(
  path.join(root, 'docs/catalog/image-source-audit.csv'),
  'utf8',
);
const sourceRows = parseCsv(sourceAudit);
const { records } = recordsFromCsvRows(sourceRows);
const auditBySku = new Map(
  records
    .filter((row) => String(row.status || '').trim() === 'APROBADA')
    .map((row) => [row.sku, row]),
);

test('all QA or unofficial products use the same neutral placeholder', () => {
  const qa = productThumb({
    name: 'Bebida QA',
    categoryId: 'cervezas',
    qaFixture: true,
    image: 'assets/products/other.webp',
  });
  const unofficial = productThumb({
    name: 'Producto sin aprobar',
    categoryId: 'vinos-y-espumantes',
    image: 'assets/products/unapproved.webp',
  });

  for (const html of [qa, unofficial]) {
    assert.match(html, /assets\/products\/beverage-placeholder\.svg/);
    assert.match(html, /uses-placeholder/);
    assert.match(html, /Producto sin imagen oficial/);
    assert.doesNotMatch(html, /<svg/);
    assert.doesNotMatch(html, /srcset=/);
  }
});

test('catalog products have valid image routes and approved source mapping when required', () => {
  for (const product of products) {
    assert.ok(product.image, `${product.id}: image missing`);
    const image = String(product.image || '');
    if (image === placeholder) continue;

    if (image.startsWith('http://') || image.startsWith('https://')) {
      assert.ok(
        auditBySku.has(product.id),
        `${product.id}: remote image without approved source audit entry`,
      );
      const approved = auditBySku.get(product.id);
      assert.ok(
        /^https:\/\//.test(approved.source_url),
        `${product.id}: approved source must keep HTTPS origin`,
      );
      assert.equal(approved.status, 'APROBADA');
      continue;
    }

    assert.ok(/^assets\/(?:products|catalog\/products)\//.test(image), `${product.id}: image path must be local product asset`);
    assert.ok(!image.includes('-thumb-'), `${product.id}: master image cannot be a thumbnail path`);
    const abs = path.join(root, image);
    assert.ok(fs.existsSync(abs), `${product.id}: image does not exist: ${image}`);
    const skuApproved = auditBySku.has(product.id);
    if (skuApproved) {
      const approved = auditBySku.get(product.id);
      assert.equal(approved.external_id, product.id);
    }
  }
});

test('approved products must provide responsive 400/1000 source pair', () => {
  const approvedProducts = products.filter((product) => auditBySku.has(product.id));
  for (const product of approvedProducts) {
    assert.ok(product.imageThumbnail, `${product.id}: missing imageThumbnail for approved product`);
    const html = productThumb(product);
    assert.match(html, / srcset="/);
    assert.match(html, new RegExp(`${product.imageThumbnail} 400w`));
    assert.match(html, new RegExp(`${product.image} 1000w`));
  }
});

test('approved product uses the 400 thumbnail and 1000 master responsively', () => {
  const html = productThumb({
    name: 'Producto aprobado',
    categoryId: 'aguas',
    image: 'assets/products/approved-master.webp',
    imageThumbnail: 'assets/products/approved-thumb.webp',
    imageSha256: 'a'.repeat(64),
    imageThumbnailSha256: 'b'.repeat(64),
    sourceImageSha256: 'c'.repeat(64),
  });
  assert.match(html, /has-photo/);
  assert.match(html, /src="assets\/products\/approved-thumb\.webp"/);
  assert.match(html, /approved-thumb\.webp 400w, assets\/products\/approved-master\.webp 1000w/);
});

test('broken approved image switches to the neutral accessible fallback', () => {
  const imageClasses = classList('thumb-img');
  const shellClasses = classList('thumb', 'has-photo');
  const attributes = new Map();
  const shell = {
    classList: shellClasses,
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
  const removed = [];
  const image = {
    classList: imageClasses,
    dataset: { productName: 'Producto aprobado' },
    src: 'assets/products/broken.webp',
    closest: () => shell,
    removeAttribute(name) {
      removed.push(name);
    },
  };

  assert.equal(handleProductImageError({ target: image }), true);
  assert.equal(image.src, 'assets/products/beverage-placeholder.svg');
  assert.deepEqual(removed, ['srcset', 'sizes']);
  assert.equal(shellClasses.contains('has-photo'), false);
  assert.equal(shellClasses.contains('uses-placeholder'), true);
  assert.equal(attributes.get('aria-label'), 'Producto sin imagen oficial: Producto aprobado');
});

function classList(...initial) {
  const values = new Set(initial);
  return {
    add(value) {
      values.add(value);
    },
    remove(value) {
      values.delete(value);
    },
    contains(value) {
      return values.has(value);
    },
  };
}
