import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CLEARED_PROMO_PHOTOS,
  isEditorialPromoPath,
  promoPhotoCleared,
} from '../js/core/promo-rights.js';

// La fotografía editorial (assets/promos/) sale de portfolios y sitios de terceros:
// el manifiesto acredita su ORIGEN, no un permiso. En producción sólo se publica
// lo que el registro declara con autorización comercial DOCUMENTADA.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('docs/catalog/promo-image-manifest.json'));
const register = JSON.parse(read('docs/catalog/promo-rights.json'));

test('el registro de derechos cubre cada pieza del manifiesto, sin sobrantes', () => {
  const declared = manifest.piezas.map((piece) => piece.path).sort();
  const registered = register.piezas.map((piece) => piece.path).sort();
  assert.deepEqual(registered, declared);
});

test('sólo DOCUMENTADOS se publica, y exige quién cede y una referencia', () => {
  const documented = register.piezas.filter((piece) => piece.estado === 'DOCUMENTADOS');
  for (const piece of documented) {
    assert.ok(piece.cede && String(piece.cede).trim(), `${piece.path}: falta quién cede la autorización`);
    assert.ok(piece.referencia && String(piece.referencia).trim(), `${piece.path}: falta la referencia`);
  }
  assert.deepEqual([...CLEARED_PROMO_PHOTOS].sort(), documented.map((piece) => piece.path).sort(),
    'CLEARED_PROMO_PHOTOS y el registro tienen que decir lo mismo');
  for (const piece of register.piezas) {
    assert.ok(['DOCUMENTADOS', 'NO_DOCUMENTADOS', 'RETIRADA'].includes(piece.estado), `${piece.path}: estado desconocido`);
  }
});

test('en producción ninguna pieza sin autorización documentada se pinta; en demo sí', () => {
  for (const piece of register.piezas) {
    const cleared = piece.estado === 'DOCUMENTADOS';
    assert.equal(promoPhotoCleared(piece.path, { production: true }), cleared, piece.path);
    assert.equal(promoPhotoCleared(piece.path, { production: false }), true, `${piece.path} en demo`);
  }
});

test('la compuerta sólo gobierna assets/promos/ y tolera rutas con ./ y query', () => {
  assert.equal(promoPhotoCleared('assets/products/andes-origen-rubia-lata-473ml-x-thumb-y.webp', { production: true }), true);
  assert.equal(promoPhotoCleared('./assets/promos/mixers-schweppes.jpg?v=3', { production: true }), false);
  assert.equal(promoPhotoCleared('/assets/promos/cervezas-heineken-band.webp#x', { production: true }), false);
  assert.equal(isEditorialPromoPath('assets/promos/x.jpg'), true);
  assert.equal(isEditorialPromoPath('assets/products/x.webp'), false);
  assert.equal(promoPhotoCleared('', { production: true }), true);
});

test('el código y las hojas sólo referencian piezas editoriales registradas', () => {
  const registered = new Set(register.piezas.map((piece) => piece.path));
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (entry.name !== 'vendor') walk(relative); continue; }
      if (/\.(js|css)$/.test(entry.name)) files.push(relative);
    }
  };
  walk('js');
  walk('styles');
  files.push('index.html');
  const refs = [];
  for (const file of files) {
    for (const match of read(file).matchAll(/assets\/promos\/[A-Za-z0-9._-]+\.(?:webp|jpe?g|png|svg)/g)) refs.push({ file, ref: match[0] });
  }
  assert.ok(refs.length > 0, 'se esperaba encontrar referencias a assets/promos/');
  for (const { file, ref } of refs) {
    assert.ok(registered.has(ref), `${file} referencia ${ref}, que no está en docs/catalog/promo-rights.json`);
  }
});
