import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from '../validate-product-catalog.mjs';
import {
  isSafeProductAssetPath,
  recordsFromCsvRows,
  sha256,
  validateFinalImageManifest,
  validateImageSourceAudit,
} from './lib.mjs';

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('Falta sharp. Ejecutar npm install para restaurar las dependencias del proyecto.');
  process.exit(2);
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const DIR = path.join(ROOT, 'assets/products');
const MANIFEST = path.join(ROOT, 'docs/catalog/image-manifest.json');
const AUDIT = path.join(ROOT, 'docs/catalog/image-source-audit.csv');
const allowEmpty = process.argv.includes('--allow-empty');
const errors = [];

const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8')
  .catch(() => '{"schemaVersion":0,"sources":[]}'));
const manifestReport = validateFinalImageManifest(manifest, { allowEmpty });
errors.push(...manifestReport.errors);
const manifestSources = manifestReport.sources;
if (
  manifest.encoder?.name !== 'sharp'
  || manifest.encoder?.version !== sharp.versions.sharp
  || manifest.encoder?.format !== 'webp'
  || manifest.encoder?.quality !== 84
  || manifest.encoder?.effort !== 6
) {
  errors.push('El encoder instalado no coincide con el contrato del manifiesto.');
}
if (!manifestSources.length && !allowEmpty) {
  errors.push('El manifiesto no contiene imágenes; --allow-empty es sólo para el template.');
}

const auditRows = parseCsv(await fs.readFile(AUDIT, 'utf8'));
const { header, records } = recordsFromCsvRows(auditRows);
const audit = validateImageSourceAudit(header, records);
errors.push(...audit.errors);
const approvedBySku = new Map(audit.approved.map((source) => [source.sku, source]));
if (manifestSources.length !== audit.approved.length) {
  errors.push('El manifiesto no coincide en cantidad con las fuentes APROBADAS.');
}

const expectedFiles = new Set();
for (const source of manifestSources) {
  const approved = approvedBySku.get(source.sku);
  if (!approved) {
    errors.push(`${source.sku}: no figura APROBADA en la auditoría vigente.`);
  } else {
    if (source.externalId !== approved.external_id) {
      errors.push(`${source.sku}: externalId distinto de la auditoría.`);
    }
    if (source.sourceSha256 !== approved.expected_sha256.toLowerCase()) {
      errors.push(`${source.sku}: hash de fuente distinto de la auditoría.`);
    }
    if (
      source.sourceUrl !== approved.source_url
      || source.sourceType !== approved.source_type
      || source.checkedAt !== approved.checked_at
      || source.rightsStatus !== approved.rights_status
      || source.rightsReference !== approved.rights_reference
    ) {
      errors.push(`${source.sku}: trazabilidad distinta de la auditoría vigente.`);
    }
  }

  for (const [kind, expected] of [['master', 1000], ['thumbnail', 400]]) {
    const asset = source.assets?.[kind];
    if (!asset || !isSafeProductAssetPath(asset.path)) {
      errors.push(`${source.sku}: asset ${kind} ausente o con ruta insegura.`);
      continue;
    }
    if (expectedFiles.has(asset.path)) errors.push(`${asset.path}: referencia duplicada.`);
    expectedFiles.add(asset.path);
    const absolutePath = path.join(ROOT, asset.path);
    const bytes = await fs.readFile(absolutePath).catch(() => null);
    if (!bytes) {
      errors.push(`${asset.path}: archivo ausente.`);
      continue;
    }
    if (sha256(bytes) !== asset.sha256) errors.push(`${asset.path}: SHA-256 inválido.`);
    const metadata = await sharp(absolutePath).metadata();
    if (
      metadata.format !== 'webp'
      || metadata.width !== expected
      || metadata.height !== expected
      || asset.width !== expected
      || asset.height !== expected
    ) {
      errors.push(`${asset.path}: esperado WebP ${expected}x${expected}.`);
    }
  }
}

const files = (await fs.readdir(DIR))
  .filter((file) => file.endsWith('.webp'))
  .map((file) => `assets/products/${file}`)
  .sort();
for (const file of files) {
  if (!expectedFiles.has(file)) errors.push(`${file}: WebP sin entrada en el manifiesto.`);
}
for (const file of expectedFiles) {
  if (!files.includes(file)) errors.push(`${file}: entrada de manifiesto sin archivo.`);
}

for (const error of errors) console.error(`ERROR ${error}`);
if (errors.length) process.exitCode = 1;
else console.log(`${files.length} imagen(es) WebP verificadas con fuente, derechos y SHA-256.`);
