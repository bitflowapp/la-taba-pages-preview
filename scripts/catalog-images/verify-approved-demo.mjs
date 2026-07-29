import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { products } from '../../js/approved-beverage-demo-data.js';

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('Falta sharp. Ejecutar npm install para restaurar las dependencias del proyecto.');
  process.exit(2);
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const DEMO_ROOT = 'assets/catalog/beverages';
const EXPECTED_PRODUCTS = 22;
const errors = [];
const expectedFiles = new Set();

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function listWebps(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return listWebps(absolute);
    if (!entry.isFile() || !entry.name.endsWith('.webp')) return [];
    return [path.relative(ROOT, absolute).replaceAll('\\', '/')];
  }));
  return nested.flat();
}

if (products.length !== EXPECTED_PRODUCTS) {
  errors.push(`El catálogo demo debe contener exactamente ${EXPECTED_PRODUCTS} productos.`);
}

for (const product of products) {
  if (product.sku.startsWith('qa-')) errors.push(`${product.sku}: SKU de fixture no permitido.`);
  if (product.rightsStatus !== 'RETAILER_SOLO_REFERENCIA') {
    errors.push(`${product.sku}: falta la declaración explícita de derechos de demo.`);
  }

  for (const asset of [
    {
      kind: 'product',
      file: product.image,
      hash: product.imageSha256,
      width: product.imageWidth,
      height: product.imageHeight,
      expectedSize: 1000,
    },
    {
      kind: 'thumbnail',
      file: product.imageThumbnail,
      hash: product.imageThumbnailSha256,
      width: product.thumbnailWidth,
      height: product.thumbnailHeight,
      expectedSize: 400,
    },
  ]) {
    const expectedPath = `${DEMO_ROOT}/${product.sku}/${asset.kind}.webp`;
    if (asset.file !== expectedPath || asset.file.includes('/qa-')) {
      errors.push(`${product.sku}: ruta ${asset.kind} fuera del directorio demo aprobado.`);
      continue;
    }
    if (expectedFiles.has(asset.file)) errors.push(`${asset.file}: referencia duplicada.`);
    expectedFiles.add(asset.file);

    const absolute = path.join(ROOT, asset.file);
    const bytes = await fs.readFile(absolute).catch(() => null);
    if (!bytes) {
      errors.push(`${asset.file}: archivo ausente.`);
      continue;
    }
    if (sha256(bytes) !== asset.hash) errors.push(`${asset.file}: SHA-256 inválido.`);
    const metadata = await sharp(bytes).metadata();
    if (
      metadata.format !== 'webp'
      || metadata.width !== asset.expectedSize
      || metadata.height !== asset.expectedSize
      || asset.width !== asset.expectedSize
      || asset.height !== asset.expectedSize
    ) {
      errors.push(`${asset.file}: esperado WebP ${asset.expectedSize}x${asset.expectedSize}.`);
    }
  }
}

const publicDemoWebps = (await listWebps(path.join(ROOT, DEMO_ROOT))).sort();
const expectedDemoWebps = [...expectedFiles].sort();
if (publicDemoWebps.length !== EXPECTED_PRODUCTS * 2) {
  errors.push(`El demo debe publicar exactamente ${EXPECTED_PRODUCTS * 2} WebP.`);
}
for (const file of publicDemoWebps) {
  if (!expectedFiles.has(file)) errors.push(`${file}: WebP demo huérfano.`);
}
for (const file of expectedFiles) {
  if (!publicDemoWebps.includes(file)) errors.push(`${file}: referencia demo sin archivo.`);
}

for (const error of errors) console.error(`ERROR ${error}`);
if (errors.length) process.exitCode = 1;
else console.log(`${EXPECTED_PRODUCTS} productos y ${expectedDemoWebps.length} WebP demo aprobados verificados.`);
