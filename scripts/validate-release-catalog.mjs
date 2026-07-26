import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateCatalog } from './validate-product-catalog.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const requestedPath = process.argv[2] || process.env.TABA_CATALOG_FILE || '';
const errors = [];

if (!requestedPath) {
  errors.push('Falta el catálogo real. Indicá TABA_CATALOG_FILE o pasá su ruta como argumento.');
}

const catalogPath = requestedPath ? path.resolve(requestedPath) : '';
let catalogText = '';
let imageManifest;
if (catalogPath) {
  try {
    catalogText = fs.readFileSync(catalogPath, 'utf8');
  } catch (error) {
    errors.push(`No se pudo leer el catálogo real: ${error.message}`);
  }
}
try {
  imageManifest = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'docs/catalog/image-manifest.json'),
    'utf8',
  ));
} catch (error) {
  errors.push(`No se pudo leer el manifiesto final de imágenes: ${error.message}`);
}

if (catalogText && imageManifest) {
  const report = validateCatalog(catalogText, {
    imageManifest,
    fileExists: (candidate) => fs.existsSync(path.join(ROOT, candidate)),
  });
  errors.push(...report.errors);
  if (!report.products.length) errors.push('El catálogo real no contiene productos.');
}

if (!errors.length) {
  const images = spawnSync(process.execPath, ['scripts/catalog-images/verify.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  });
  if (images.status !== 0) {
    errors.push(`${images.stdout}${images.stderr}`.trim() || 'Falló la verificación de imágenes.');
  }
}

for (const error of errors) console.error(`ERROR ${error}`);
if (errors.length) {
  process.exitCode = 1;
} else {
  console.log(`Catálogo comercial aprobado: ${catalogPath}.`);
}
