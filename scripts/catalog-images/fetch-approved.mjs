import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from '../validate-product-catalog.mjs';
import {
  catalogImageIdentitySha256,
  rawSourceFileName,
  recordsFromCsvRows,
  sha256,
  stableJson,
  validateImageSourceAudit,
} from './lib.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const AUDIT = path.join(ROOT, 'docs/catalog/image-source-audit.csv');
const RAW = path.join(ROOT, 'scripts/catalog-images/.raw');
const RAW_MANIFEST = path.join(RAW, 'manifest.json');
const allowEmpty = process.argv.includes('--allow-empty');

const rows = parseCsv(await fs.readFile(AUDIT, 'utf8'));
const { header, records } = recordsFromCsvRows(rows);
const { errors, approved } = validateImageSourceAudit(header, records);
for (const error of errors) console.error(`ERROR ${error}`);
if (errors.length) process.exit(1);
if (!approved.length) {
  if (!allowEmpty) {
    console.error('ERROR Sin fuentes APROBADAS. Usá --allow-empty sólo para validar el template.');
    process.exit(1);
  }
  await fs.mkdir(RAW, { recursive: true });
  await fs.writeFile(RAW_MANIFEST, stableJson({ schemaVersion: 1, sources: [] }), 'utf8');
  console.log('Template válido: sin fuentes APROBADAS y sin descargas.');
  process.exit(0);
}

await fs.mkdir(RAW, { recursive: true });
const manifestSources = [];
for (const source of approved) {
  const response = await fetch(source.source_url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${source.sku}: descarga HTTP ${response.status}.`);
  if (!/^https:\/\//i.test(response.url)) throw new Error(`${source.sku}: redirección final insegura.`);
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff'].includes(type)) {
    throw new Error(`${source.sku}: formato fuente no permitido (${type || 'sin content-type'}).`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 15_000_000) throw new Error(`${source.sku}: imagen mayor a 15 MB.`);
  const digest = sha256(bytes);
  if (digest.toLowerCase() !== source.expected_sha256.toLowerCase()) {
    throw new Error(`${source.sku}: SHA-256 distinto del aprobado; volver a REVISAR la fuente.`);
  }

  const identitySha256 = catalogImageIdentitySha256({
    externalId: source.external_id,
    sku: source.sku,
    sourceSha256: digest,
  });
  const rawFile = rawSourceFileName({
    externalId: source.external_id,
    sku: source.sku,
    sourceSha256: digest,
  });
  const rawPath = path.join(RAW, rawFile);
  const existing = await fs.readFile(rawPath).catch(() => null);
  if (existing && sha256(existing) !== digest) {
    throw new Error(`${source.sku}: el archivo raw existente no coincide con su nombre content-addressed.`);
  }
  if (!existing) await fs.writeFile(rawPath, bytes, { flag: 'wx' });

  manifestSources.push({
    checkedAt: source.checked_at,
    externalId: source.external_id,
    identitySha256,
    rawFile,
    rightsReference: source.rights_reference,
    rightsStatus: source.rights_status,
    safeSku: source.safeSku,
    sku: source.sku,
    sourceSha256: digest,
    sourceType: source.source_type,
    sourceUrl: source.source_url,
  });
  console.log(`${source.sku}: fuente verificada sha256=${digest}.`);
}

await fs.writeFile(RAW_MANIFEST, stableJson({
  schemaVersion: 1,
  sources: manifestSources,
}), 'utf8');
console.log(`Manifiesto raw: ${path.relative(ROOT, RAW_MANIFEST).replaceAll('\\', '/')}.`);
