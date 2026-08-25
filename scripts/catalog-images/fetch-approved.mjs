import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from '../validate-product-catalog.mjs';
import {
  catalogImageIdentitySha256,
  hostOf,
  rawSourceFileName,
  recordsFromCsvRows,
  sha256,
  stableJson,
  validateImageSourceAudit,
} from './lib.mjs';

/**
 * Qué formato es, leído de la firma del archivo. `null` si no es ninguno de los
 * cinco raster admitidos —JPEG, PNG, WebP, AVIF, TIFF—.
 */
function formatoPorFirma(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (bytes.subarray(4, 8).toString('latin1') === 'ftyp' && /avif|avis/.test(bytes.subarray(8, 12).toString('latin1'))) return 'image/avif';
  const tiff = bytes.subarray(0, 4);
  if (tiff.equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || tiff.equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) return 'image/tiff';
  return null;
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const AUDIT = path.join(ROOT, 'docs/catalog/image-source-audit.csv');
const ALLOWLIST = path.join(ROOT, 'catalog/image-source-allowlist.json');
const RAW = path.join(ROOT, 'scripts/catalog-images/.raw');
const RAW_MANIFEST = path.join(RAW, 'manifest.json');
const allowEmpty = process.argv.includes('--allow-empty');

// La allowlist manda acá, no como sugerencia: sin ella no se descarga nada.
const allowlist = JSON.parse(await fs.readFile(ALLOWLIST, 'utf8'));
const allowedHosts = new Set(allowlist.groups.flatMap((group) => group.cdnHosts));

const rows = parseCsv(await fs.readFile(AUDIT, 'utf8'));
const { header, records } = recordsFromCsvRows(rows);
const { errors, approved } = validateImageSourceAudit(header, records, { allowedHosts });
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
  // La allowlist se vuelve a mirar DESPUÉS de seguir los redirects. Validar sólo
  // la URL escrita en la auditoría deja abierto que un 302 mande el descargador
  // a otro dominio y el archivo entre igual.
  const hostFinal = hostOf(response.url);
  if (!hostFinal || !allowedHosts.has(hostFinal)) {
    throw new Error(`${source.sku}: la descarga terminó en ${hostFinal || 'un host ilegible'}, que no está en la allowlist.`);
  }
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());
  /*
   * El formato lo dicen los BYTES, no la cabecera.
   *
   * El CDN de Monster sirve sus PNG como `application/octet-stream` y el
   * descargador los rechazaba: un packshot legítimo del fabricante quedaba
   * afuera por cómo su servidor rotula el archivo. Y al revés es peor: un
   * `Content-Type: image/png` sobre un HTML de error entraba sin chistar,
   * porque la cabecera es una afirmación del servidor y la firma es un hecho
   * del archivo. Ahora manda la firma, y la cabecera sólo se anota.
   */
  const formato = formatoPorFirma(bytes);
  if (!formato) {
    throw new Error(`${source.sku}: los bytes no son una imagen raster admitida (content-type declarado: ${type || 'ninguno'}).`);
  }
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
