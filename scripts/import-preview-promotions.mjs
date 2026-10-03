import fs from 'node:fs/promises';
import path from 'node:path';

// Regenera js/preview-promotions-data.js a partir de data/preview-promotions.csv.
// El CSV es la única fuente de registro comercial: cada fila queda reflejada
// tal cual en el seed, sin agregar ni inferir precios que no estén en el
// archivo. Las columnas de precio vacías se traducen a null; ninguna entrada
// puede activarse desde este seed (ver tests/promotions.test.mjs).
// included_skus admite '|', ',' o espacios como separador entre SKU.

const ROOT = path.resolve(import.meta.dirname, '..');
const CSV_PATH = path.join(ROOT, 'data/preview-promotions.csv');
const OUTPUT = path.join(ROOT, 'js/preview-promotions-data.js');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') { inQuotes = true; continue; }
    if (char === ',') { pushField(); continue; }
    if (char === '\r') continue;
    if (char === '\n') { pushRow(); continue; }
    field += char;
  }
  if (field.length || row.length) pushRow();
  return rows.filter((cells) => cells.some((cell) => cell !== ''));
}

function toNullableNumber(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function toSkuList(value) {
  return String(value ?? '')
    .split(/[|,\s]+/)
    .map((sku) => sku.trim())
    .filter(Boolean);
}

const csvText = await fs.readFile(CSV_PATH, 'utf8');
const [header, ...rows] = parseCsv(csvText);
const columnIndex = Object.fromEntries(header.map((name, index) => [name, index]));
const cell = (row, name) => row[columnIndex[name]] ?? '';

const promotions = rows.map((row) => ({
  promoId: cell(row, 'promo_id').trim(),
  title: cell(row, 'title').trim(),
  subtitle: cell(row, 'subtitle').trim(),
  includedSkus: toSkuList(cell(row, 'included_skus')),
  promotionType: cell(row, 'promotion_type').trim(),
  regularPrice: toNullableNumber(cell(row, 'regular_price')),
  promotionalPrice: toNullableNumber(cell(row, 'promotional_price')),
  discountPercentage: toNullableNumber(cell(row, 'discount_percentage')),
  requiredQuantity: toNullableNumber(cell(row, 'required_quantity')) ?? 1,
  maximumUnits: toNullableNumber(cell(row, 'maximum_units')),
  validFrom: cell(row, 'valid_from').trim(),
  validUntil: cell(row, 'valid_until').trim(),
  active: cell(row, 'active').trim().toLowerCase() === 'true',
  priority: toNullableNumber(cell(row, 'priority')) ?? 0,
  imagePath: cell(row, 'image_path').trim(),
  terms: cell(row, 'terms').trim(),
  previewOnly: cell(row, 'preview_only').trim().toLowerCase() === 'true',
  approvalStatus: cell(row, 'approval_status').trim(),
  approvalReference: cell(row, 'approval_reference').trim(),
  sourceEvidence: cell(row, 'source_evidence').trim(),
}));

const entriesSource = promotions.map((promotion) => (
  `  Object.freeze(${JSON.stringify(promotion, null, 2).replaceAll('\n', '\n  ')}),`
)).join('\n');

const fileBody = [
  '// Generado por scripts/import-preview-promotions.mjs. No editar manualmente.',
  '// Derivado de data/preview-promotions.csv. Ninguna entrada inicial es visible',
  '// ni aplicable en checkout: todas quedan con active=false hasta que Negocio',
  '// registre una aprobación real (approvalStatus=APROBADA + approvalReference).',
  "export const PREVIEW_PROMOTION_SEED = Object.freeze([",
  entriesSource,
  ']);',
  '',
].join('\n');

await fs.writeFile(OUTPUT, fileBody, 'utf8');
console.log(`${path.relative(ROOT, OUTPUT).replaceAll('\\', '/')}: ${promotions.length} candidatas regeneradas desde ${path.relative(ROOT, CSV_PATH).replaceAll('\\', '/')}.`);
