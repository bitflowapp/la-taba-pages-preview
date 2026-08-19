import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { products } from '../js/approved-beverage-demo-data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsPath = path.join(root, 'docs/image-sources.md');
const placeholderPath = path.join(root, 'assets/products/beverage-placeholder.svg');
const assetAuditPath = path.join(root, 'docs/final-commercial-release/catalog-asset-audit.csv');

test('preview uses one neutral documented placeholder with a matching SHA-256', () => {
  assert.equal(fs.existsSync(docsPath), true);
  assert.equal(fs.existsSync(placeholderPath), true);
  assert.ok(fs.statSync(placeholderPath).size < 20 * 1024);

  const docs = fs.readFileSync(docsPath, 'utf8');
  assert.match(docs, /beverage-placeholder\.svg/);
  assert.match(docs, /Preview privado únicamente/);
  assert.doesNotMatch(docs, /pizzería|carnicería|pizza|parrilla|carne/i);

  const digest = crypto.createHash('sha256')
    .update(fs.readFileSync(placeholderPath))
    .digest('hex');
  const audit = fs.readFileSync(assetAuditPath, 'utf8');
  assert.match(audit, new RegExp(digest));
  assert.match(audit, /APPROVED_PREVIEW_ONLY/);
});

function listWebps(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return listWebps(absolute);
    return entry.isFile() && entry.name.endsWith('.webp')
      ? [path.relative(root, absolute).replaceAll('\\', '/')]
      : [];
  });
}

test('tracked storefront WebP are approved demo assets or commercial manifest entries', () => {
  const webps = listWebps(path.join(root, 'assets')).sort();
  for (const file of webps) {
    assert.doesNotMatch(file, /pizza|parrilla|carne|milanesa|chorizo|horno|combo-familiar|promo-dia|bebida-cola/i);
    assert.doesNotMatch(file, /(?:^|\/)qa-[^/]*\.webp$/i);
  }

  const manifest = JSON.parse(fs.readFileSync(
    path.join(root, 'docs/catalog/image-manifest.json'),
    'utf8',
  ));
  const manifested = manifest.sources.flatMap((source) => [
    source.assets?.master?.path,
    source.assets?.thumbnail?.path,
  ]).filter(Boolean).sort();
  const approvedDemo = products.flatMap((product) => [
    product.image,
    product.imageThumbnail,
  ]).sort();
  // Arte editorial de categoría (banners de la home). No es producto, así que no
  // vive en el manifest de catálogo, pero se le exige exactamente la misma
  // trazabilidad: cada pieza declara su origen en el lote curado y su página
  // fuente. La regla que importa se mantiene intacta: ninguna imagen puede estar
  // en assets/ sin procedencia declarada.
  const promoManifest = JSON.parse(fs.readFileSync(
    path.join(root, 'docs/catalog/promo-image-manifest.json'),
    'utf8',
  ));
  const promoArt = promoManifest.piezas.map((piece) => piece.path);
  for (const piece of promoManifest.piezas) {
    assert.ok(piece.url_fuente, `${piece.path} sin url_fuente`);
    assert.ok(piece.origen, `${piece.path} sin origen en el lote curado`);
    assert.ok(fs.existsSync(path.join(root, piece.path)), `${piece.path} declarado pero ausente`);
  }
  assert.deepEqual(webps, [...approvedDemo, ...manifested, ...promoArt.filter((p) => p.endsWith('.webp'))].sort());
});

test('commercial image audit and manifest are explicit and traceable', () => {
  const audit = fs.readFileSync(
    path.join(root, 'docs/catalog/image-source-audit.csv'),
    'utf8',
  );
  for (const field of [
    'rights_reference',
    'expected_sha256',
    'variant_verified',
    'capacity_verified',
    'package_verified',
    'pack_verified',
  ]) {
    assert.match(audit, new RegExp(`\\b${field}\\b`));
  }

  const manifest = JSON.parse(fs.readFileSync(
    path.join(root, 'docs/catalog/image-manifest.json'),
    'utf8',
  ));
  assert.equal(manifest.schemaVersion, 1);

  // Esto exigía `sources.length === 0`. Era el estado del repositorio el día que
  // se escribió, no una garantía: la primera imagen comercial lo ponía rojo sin
  // que nada se hubiera roto. Lo que sí es una garantía —y lo que este test
  // quería decir— es que cada entrada sea rastreable hasta su origen.
  for (const source of manifest.sources) {
    for (const field of ['sourceUrl', 'sourceSha256', 'rightsStatus', 'rightsReference', 'checkedAt']) {
      assert.ok(String(source[field] || '').trim(), `${source.sku}: ${field} vacío en el manifiesto`);
    }
    assert.match(source.sourceUrl, /^https:\/\//, `${source.sku}: la fuente tiene que ser HTTPS`);
  }
});
