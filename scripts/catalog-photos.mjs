import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

let sharp;
try { ({ default: sharp } = await import('sharp')); } catch { throw new Error('sharp es obligatorio.'); }

const ROOT = path.resolve(import.meta.dirname, '..');
const configuredIntake = process.env.TABA_CATALOG_PHOTO_INTAKE_DIR?.trim();
const INTAKE = configuredIntake
  ? path.resolve(configuredIntake)
  : path.join(ROOT, 'catalog/photo-intake');
const CATALOG = path.join(ROOT, 'catalog');
const productsFile = path.join(CATALOG, 'products.json');
const validationFile = path.join(INTAKE, 'validation.json');
const command = process.argv[2] || 'validate';
const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp']);

await fs.mkdir(INTAKE, { recursive: true });
const products = JSON.parse(await fs.readFile(productsFile, 'utf8'));
const bySku = new Map(products.map((product) => [product.sku, product]));

if (command === 'prepare') {
  await fs.writeFile(path.join(INTAKE, 'README.md'), '# Entrada de fotos propias\n\nConvención: <sku>__front.ext, <sku>__pack.ext o <sku>__alternate.ext.\n');
  await fs.writeFile(validationFile, `${JSON.stringify({ generated_at: new Date().toISOString(), files: [], valid: [], invalid: [] }, null, 2)}\n`);
  console.log('Entrada preparada: catalog/photo-intake');
  process.exit(0);
}

const ignoredIntakeFiles = new Set(['README.md', 'validation.json', 'review.json', 'ingest-report.json']);
const entries = (await fs.readdir(INTAKE, { withFileTypes: true })).filter((entry) => entry.isFile() && !ignoredIntakeFiles.has(entry.name));
const results = [];
for (const entry of entries) {
  const file = path.join(INTAKE, entry.name); const ext = path.extname(entry.name).toLowerCase();
  const stem = path.basename(entry.name, ext); const match = /^(?<sku>[a-z0-9-]+)__(?<view>front|pack|alternate)$/i.exec(stem);
  const row = { file: entry.name, path: file, extension: ext, sku: match?.groups?.sku || '', view: match?.groups?.view || '', valid: false, reasons: [] };
  if (!ALLOWED.has(ext)) row.reasons.push('extensión no permitida');
  if (!match) row.reasons.push('nombre inválido; use <sku>__front|pack|alternate.ext');
  if (match && !bySku.has(match.groups.sku)) row.reasons.push('SKU no existe en catalog/products.json');
  if (!row.reasons.length) {
    try {
      const bytes = await fs.readFile(file); const meta = await sharp(bytes).metadata(); row.width = meta.width; row.height = meta.height; row.format = meta.format; row.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      if (!meta.width || !meta.height || meta.width < 1200 || meta.height < 1200) row.reasons.push('resolución menor a 1200x1200');
      const { data, info } = await sharp(bytes).resize(100, 100, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true }); let border = 0; let nonWhite = 0;
      for (let y = 0; y < 100; y += 1) for (let x = 0; x < 100; x += 1) if (x < 5 || x >= 95 || y < 5 || y >= 95) { border += 1; const i = (y * 100 + x) * info.channels; if (Math.min(data[i], data[i + 1], data[i + 2]) < 245) nonWhite += 1; }
      row.border_nonwhite_percent = Math.round(nonWhite / border * 100); if (row.border_nonwhite_percent > 15) row.reasons.push('borde no blanco; revisión de fondo manual requerida');
    } catch (error) { row.reasons.push(`lectura inválida: ${error.message}`); }
  }
  row.valid = row.reasons.length === 0; results.push(row);
}
const report = { generated_at: new Date().toISOString(), files: results.length, valid: results.filter((row) => row.valid), invalid: results.filter((row) => !row.valid) };
await fs.writeFile(validationFile, `${JSON.stringify(report, null, 2)}\n`);

if (command === 'validate') { console.log(JSON.stringify({ files: report.files, valid: report.valid.length, invalid: report.invalid.length }, null, 2)); process.exit(0); }
if (command === 'review') { await fs.writeFile(path.join(INTAKE, 'review.json'), `${JSON.stringify(report, null, 2)}\n`); console.log(`Revisión preparada: ${report.valid.length} foto(s) válidas, ${report.invalid.length} pendiente(s).`); process.exit(0); }
if (command !== 'ingest') throw new Error(`Comando desconocido: ${command}`);

for (const row of report.valid) {
  const product = bySku.get(row.sku); const bytes = await fs.readFile(row.path); const base = `assets/catalog/products/${product.category_id}/${product.sku}`; const masterPath = `${base}-master.webp`; const thumbPath = `${base}-thumb.webp`;
  await fs.mkdir(path.dirname(path.join(ROOT, masterPath)), { recursive: true }); await sharp(bytes).rotate().flatten({ background:'#ffffff' }).resize(1000, 1000, { fit:'contain' }).webp({ quality:92 }).toFile(path.join(ROOT, masterPath)); await sharp(bytes).rotate().flatten({ background:'#ffffff' }).resize(400, 400, { fit:'contain' }).webp({ quality:92 }).toFile(path.join(ROOT, thumbPath));
  const master = await fs.readFile(path.join(ROOT, masterPath)); const thumb = await fs.readFile(path.join(ROOT, thumbPath)); const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
  product.image_master = masterPath; product.image_thumbnail = thumbPath; product.image_sha256 = digest(master); product.image_thumbnail_sha256 = digest(thumb); product.image_status = 'verified'; product.rights_status = 'approved'; product.identity_status = 'verified'; product.publication_status = product.price_status === 'confirmed' ? 'ready' : 'blocked'; product.image_source = { source_url: `business-owned://${row.sku}`, image_source_url: '', source_domain: 'business-owned', source_type: 'business_owned_photo', retrieved_at: new Date().toISOString(), source_sha256: row.sha256, source_file: path.resolve(row.path), original_width: row.width, original_height: row.height, rights_evidence_type: 'business_owned_photo', rights_evidence_file: path.resolve(row.path), rights_scope: 'TABA2 e-commerce catalog', verified_by: 'catalog-photos-ingest', verified_at: new Date().toISOString() };
}
await fs.writeFile(productsFile, `${JSON.stringify(products, null, 2)}\n`); await fs.writeFile(path.join(INTAKE, 'ingest-report.json'), `${JSON.stringify({ ingested: report.valid.map((row) => row.sku), rejected: report.invalid }, null, 2)}\n`);
console.log(JSON.stringify({ ingested: report.valid.length, rejected: report.invalid.length }, null, 2));
