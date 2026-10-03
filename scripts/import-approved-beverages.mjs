import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('Falta sharp. Ejecutar npm install para restaurar las dependencias del proyecto.');
  process.exit(2);
}

// Regenera js/approved-beverage-demo-data.js a partir de los WebP realmente
// publicados en assets/catalog/beverages. No inventa ni reordena metadata
// comercial (precio, stock, alcohol, etc.): esos campos se preservan tal
// cual del módulo actual. Sólo recalcula lo derivado de los archivos de
// imagen (hash y dimensiones), para que nunca queden desincronizados de lo
// que el catálogo demo sirve. sourceImageSha256 no se toca: referencia el
// origen upstream de cada foto, no el WebP servido.

const ROOT = path.resolve(import.meta.dirname, '..');
const OUTPUT = path.join(ROOT, 'js/approved-beverage-demo-data.js');
const CATALOG_VERSION = 'approved-beverages-2026-07-31-packshots-v2';

const { categories, products: currentProducts } = await import('../js/approved-beverage-demo-data.js');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const products = [];
for (const product of currentProducts) {
  const imageBytes = await fs.readFile(path.join(ROOT, product.image));
  const thumbnailBytes = await fs.readFile(path.join(ROOT, product.imageThumbnail));
  const imageMeta = await sharp(imageBytes).metadata();
  const thumbnailMeta = await sharp(thumbnailBytes).metadata();
  products.push({
    ...product,
    imageSha256: sha256(imageBytes),
    imageThumbnailSha256: sha256(thumbnailBytes),
    imageWidth: imageMeta.width,
    imageHeight: imageMeta.height,
    thumbnailWidth: thumbnailMeta.width,
    thumbnailHeight: thumbnailMeta.height,
  });
}

const fileBody = [
  '// Generado por scripts/import-approved-beverages.mjs. No editar manualmente.',
  '// Fuente autorizada: catalog-demo.json + approved-demo/. Sólo se carga con ?demo=1.',
  `export const PREVIEW_CATALOG_VERSION = '${CATALOG_VERSION}';`,
  '',
  `export const categories = ${JSON.stringify(categories, null, 2)};`,
  '',
  `export const products = ${JSON.stringify(products, null, 2)};`,
  '',
].join('\n');

await fs.writeFile(OUTPUT, fileBody, 'utf8');
console.log(`${path.relative(ROOT, OUTPUT).replaceAll('\\', '/')}: ${products.length} productos regenerados desde los WebP publicados.`);
