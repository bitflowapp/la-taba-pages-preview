import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import {
  catalogAssetBindingSha256,
  catalogAssetPath,
  catalogImageIdentitySha256,
  isSha256,
  normalizeSku,
  rawSourceFileName,
  sha256,
  stableJson,
} from './lib.mjs';

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('Falta sharp. Ejecutar npm install para restaurar las dependencias del proyecto.');
  process.exit(2);
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const RAW = path.join(ROOT, 'scripts/catalog-images/.raw');
const OUTPUTS = {
  master: path.join(ROOT, 'assets/catalog/products'),
  thumbnail: path.join(ROOT, 'assets/catalog/thumbnails'),
};
const RAW_MANIFEST = path.join(RAW, 'manifest.json');
const OUTPUT_MANIFEST = path.join(ROOT, 'docs/catalog/image-manifest.json');
const allowEmpty = process.argv.includes('--allow-empty');
const rawManifest = JSON.parse(await fs.readFile(RAW_MANIFEST, 'utf8')
  .catch(() => '{"schemaVersion":0,"sources":[]}'));
if (rawManifest.schemaVersion !== 1) throw new Error('Falta un manifiesto raw válido; ejecutar images:fetch.');
if (!Array.isArray(rawManifest.sources)) throw new Error('El manifiesto raw no contiene un array sources.');
if (!rawManifest.sources.length && !allowEmpty) {
  throw new Error('El manifiesto raw está vacío. Usá --allow-empty sólo para el template.');
}
await Promise.all(Object.values(OUTPUTS).map((directory) => fs.mkdir(directory, { recursive: true })));

const manifestSources = [];
for (const source of rawManifest.sources) {
  const expectedSafeSku = normalizeSku(source?.sku);
  if (!expectedSafeSku || source?.safeSku !== expectedSafeSku) {
    throw new Error(`${source?.sku || 'Fuente'}: safeSku raw inválido.`);
  }
  if (!isSha256(source?.sourceSha256)) {
    throw new Error(`${source.sku}: sourceSha256 raw inválido.`);
  }
  const expectedIdentitySha256 = catalogImageIdentitySha256(source);
  if (source.identitySha256 !== expectedIdentitySha256) {
    throw new Error(`${source.sku}: identitySha256 raw no coincide con producto y fuente.`);
  }
  const expectedRawFile = rawSourceFileName(source);
  if (source.rawFile !== expectedRawFile) {
    throw new Error(`${source.sku}: rawFile no coincide con el nombre content-addressed.`);
  }
  const input = path.resolve(RAW, source.rawFile);
  if (path.dirname(input) !== RAW) {
    throw new Error(`${source.sku}: rawFile escapa del directorio controlado.`);
  }
  const inputBytes = await fs.readFile(input);
  if (sha256(inputBytes) !== source.sourceSha256) {
    throw new Error(`${source.sku}: la fuente raw no coincide con el manifiesto.`);
  }

  const assets = {};
  for (const [kind, size] of [['master', 1000], ['thumbnail', 400]]) {
    const tempPath = path.join(RAW, `.normalize-${process.pid}-${source.safeSku}-${kind}.webp`);
    try {
      await sharp(input)
        .rotate()
        .resize(size, size, { fit: 'contain', background: '#ffffff' })
        .flatten({ background: '#ffffff' })
        .webp({ quality: 84, effort: 6 })
        .toFile(tempPath);
      const outputBytes = await fs.readFile(tempPath);
      const outputSha256 = sha256(outputBytes);
      const assetPath = catalogAssetPath(source, kind, outputSha256);
      const file = path.basename(assetPath);
      const outputPath = path.join(ROOT, assetPath);
      const existing = await fs.readFile(outputPath).catch(() => null);
      if (existing && sha256(existing) !== outputSha256) {
        throw new Error(`${file}: colisión de hash truncado.`);
      }
      if (!existing) {
        await fs.copyFile(tempPath, outputPath, fsConstants.COPYFILE_EXCL);
      }
      assets[kind] = {
        height: size,
        path: assetPath,
        sha256: outputSha256,
        width: size,
      };
      assets[kind].bindingSha256 = catalogAssetBindingSha256(source, kind, assets[kind]);
    } finally {
      await fs.rm(tempPath, { force: true });
    }
  }
  manifestSources.push({
    ...source,
    assets,
  });
  console.log(`${source.sku}: WebP master y thumbnail content-addressed generados.`);
}

await fs.writeFile(OUTPUT_MANIFEST, stableJson({
  encoder: {
    effort: 6,
    format: 'webp',
    name: 'sharp',
    quality: 84,
    version: sharp.versions.sharp,
  },
  schemaVersion: 1,
  sources: manifestSources,
}), 'utf8');
console.log(`Manifiesto final: ${path.relative(ROOT, OUTPUT_MANIFEST).replaceAll('\\', '/')}.`);
