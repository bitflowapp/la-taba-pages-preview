import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { handleProductImageError, productThumb } from '../js/ui.js';
import { products } from '../js/approved-beverage-demo-data.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('un producto sin foto publicable dibuja la lámina propia de TABA', () => {
  const qa = productThumb({ name: 'Bebida QA', categoryId: 'cervezas', qaFixture: true, image: 'assets/products/other.webp' });
  const unofficial = productThumb({ name: 'Producto sin aprobar', categoryId: 'cervezas', image: 'assets/products/unapproved.webp' });
  for (const html of [qa, unofficial]) {
    // Ya no es el mismo dibujo gris para todos: es la lámina de ESE producto,
    // obra propia del comercio, generada desde una especificación versionada.
    // Estos dos son inventados y no tienen lámina propia, así que caen a la
    // genérica, que vive en la misma carpeta y es igual de propia.
    assert.match(html, /assets\/products\/taba\//);
    assert.match(html, /uses-lamina/);
    assert.match(html, /Ilustración de/);
    assert.doesNotMatch(html, /<svg/);
    assert.doesNotMatch(html, /srcset=/);
  }
});

test('approved catalog products use existing local product and thumbnail routes', () => {
  for (const product of products) {
    assert.match(product.image, /^assets\/catalog\/(?:beverages\/[^/]+\/product|products\/[^/]+\/[^/]+-master)\.webp$/);
    assert.match(product.imageThumbnail, /^assets\/catalog\/(?:beverages\/[^/]+\/thumbnail|products\/[^/]+\/[^/]+-thumb)\.webp$/);
    assert.ok(fs.existsSync(path.join(root, product.image)), `${product.id}: product image does not exist`);
    assert.ok(fs.existsSync(path.join(root, product.imageThumbnail)), `${product.id}: thumbnail does not exist`);
  }
});

test('el par responsive aparece cuando, y sólo cuando, hay derechos para publicar', () => {
  // Esta prueba antes recorría los 82 productos de demostración y exigía que
  // TODOS se dibujaran con su fotografía. Esa expectativa era el defecto: los 82
  // declaran `PENDING_REVIEW` o `RETAILER_SOLO_REFERENCIA`, es decir, conseguimos
  // la imagen pero no el permiso para mostrarla. Tener el archivo y los hashes no
  // es tener el derecho.
  for (const product of products) {
    const html = productThumb(product);
    assert.doesNotMatch(
      html,
      / srcset="/,
      `${product.id} declara ${product.rightsStatus}: no se publica su foto`,
    );
    assert.match(html, /assets\/products\/taba\//);
  }

  // Y cuando el permiso está, el par responsive vuelve intacto.
  const conDerechos = { ...products[0], rightsStatus: 'LICENCIA_COMERCIAL' };
  const html = productThumb(conDerechos);
  assert.match(html, / srcset="/);
  assert.match(html, new RegExp(`${conDerechos.imageThumbnail} 400w`));
  assert.match(html, new RegExp(`${conDerechos.image} 1000w`));
});

test('broken approved image switches to the neutral accessible fallback', () => {
  const imageClasses = classList('thumb-img');
  const shellClasses = classList('thumb', 'has-photo');
  const attributes = new Map();
  const shell = { classList: shellClasses, setAttribute(name, value) { attributes.set(name, value); } };
  const removed = [];
  const image = { classList: imageClasses, dataset: { productName: 'Producto aprobado' }, src: 'assets/products/broken.webp', closest: () => shell, removeAttribute(name) { removed.push(name); } };
  assert.equal(handleProductImageError({ target: image }), true);
  // Sin `data-taba-lamina` en el nodo —el caso de una foto oficial que se rompe—
  // el respaldo es la lámina genérica: acá no hay producto, hay un <img> que falló.
  assert.match(image.src, /assets\/products\/taba\/generica-/);
  assert.deepEqual(removed, ['srcset', 'sizes']);
  assert.equal(shellClasses.contains('has-photo'), false);
  assert.equal(shellClasses.contains('uses-placeholder'), true);
  assert.equal(attributes.get('aria-label'), 'Producto sin imagen oficial: Producto aprobado');
});

function classList(...initial) {
  const values = new Set(initial);
  return { add(value) { values.add(value); }, remove(value) { values.delete(value); }, contains(value) { return values.has(value); } };
}
