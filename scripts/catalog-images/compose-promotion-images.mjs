import fs from 'node:fs/promises';
import path from 'node:path';

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('Falta sharp. Ejecutar npm install para restaurar las dependencias del proyecto.');
  process.exit(2);
}

const { PREVIEW_PROMOTION_SEED } = await import('../../js/preview-promotions-data.js');

// Compone imágenes de promoción a partir de los packshots reales ya
// publicados (post normalización). No agrega badges, precios ni texto sobre
// el producto: esas capas son de UI. Sólo procesa promociones con
// imagePath definido en data/preview-promotions.csv (candidatas con SKU
// reales, aún inactivas hasta aprobación comercial).

const ROOT = path.resolve(import.meta.dirname, '../..');
// Salida fuera del árbol del repo: mientras estas candidatas no tengan
// aprobación comercial y entrada en el manifiesto de imágenes, no deben
// convivir con los WebP servidos en assets/ (ver tests/image-sources.test.mjs,
// que exige que todo WebP bajo assets/ sea demo aprobado o esté manifestado).
const OUTPUT_ROOT = 'C:/1212/artifacts/taba-packshots-promos-review/promotions';
const BACKGROUND = '#faf6ef';
const SIZES = [
  { name: 'hero-1200x800', width: 1200, height: 800 },
  { name: 'square-1000x1000', width: 1000, height: 1000 },
  { name: 'thumb-400x400', width: 400, height: 400 },
];
const WHITE_THRESHOLD = 246;
const WHITE_TOLERANCE = 6;

async function trimToProduct(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const isBg = (x, y) => {
    const idx = (y * width + x) * channels;
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    const a = channels > 3 ? data[idx + 3] : 255;
    if (a < 10) return true;
    return r >= WHITE_THRESHOLD && g >= WHITE_THRESHOLD && b >= WHITE_THRESHOLD
      && Math.abs(r - g) <= WHITE_TOLERANCE && Math.abs(g - b) <= WHITE_TOLERANCE && Math.abs(r - b) <= WHITE_TOLERANCE;
  };
  const visited = new Uint8Array(width * height);
  const stack = [];
  const pushIfBg = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (visited[idx] || !isBg(x, y)) return;
    visited[idx] = 1;
    stack.push([x, y]);
  };
  for (let x = 0; x < width; x++) { pushIfBg(x, 0); pushIfBg(x, height - 1); }
  for (let y = 0; y < height; y++) { pushIfBg(0, y); pushIfBg(width - 1, y); }
  while (stack.length) {
    const [x, y] = stack.pop();
    pushIfBg(x + 1, y); pushIfBg(x - 1, y); pushIfBg(x, y + 1); pushIfBg(x, y - 1);
  }
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!visited[y * width + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 4;
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const cropWidth = Math.min(width, maxX + 1 + pad) - left;
  const cropHeight = Math.min(height, maxY + 1 + pad) - top;
  const cutout = await sharp(bytes).extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer();
  const meta = await sharp(cutout).metadata();
  return { buffer: cutout, width: meta.width, height: meta.height };
}

async function composeSize(cutouts, { width, height }) {
  const marginRatio = 0.08;
  const gapRatio = 0.05;
  const usableHeight = height * (1 - 2 * marginRatio);
  const usableWidth = width * (1 - 2 * marginRatio);
  const gap = width * gapRatio;

  const tallest = Math.max(...cutouts.map((c) => c.height));
  let scale = usableHeight / tallest;
  let scaledWidths = cutouts.map((c) => c.width * scale);
  let totalWidth = scaledWidths.reduce((sum, w) => sum + w, 0) + gap * (cutouts.length - 1);
  if (totalWidth > usableWidth) {
    scale *= usableWidth / totalWidth;
    scaledWidths = cutouts.map((c) => c.width * scale);
    totalWidth = scaledWidths.reduce((sum, w) => sum + w, 0) + gap * (cutouts.length - 1);
  }

  const composites = [];
  let cursorX = (width - totalWidth) / 2;
  const baselineY = height * (1 - marginRatio);
  for (let i = 0; i < cutouts.length; i++) {
    const cutout = cutouts[i];
    const drawWidth = Math.max(1, Math.round(cutout.width * scale));
    const drawHeight = Math.max(1, Math.round(cutout.height * scale));
    const resized = await sharp(cutout.buffer).resize(drawWidth, drawHeight, { fit: 'fill' }).toBuffer();
    composites.push({
      input: resized,
      left: Math.round(cursorX),
      top: Math.round(baselineY - drawHeight),
    });
    cursorX += drawWidth + gap;
  }

  return sharp({ create: { width, height, channels: 3, background: BACKGROUND } })
    .composite(composites)
    .flatten({ background: BACKGROUND })
    .webp({ quality: 84, effort: 6 })
    .toBuffer();
}

// Candidatas elegibles: combos reales de más de un SKU distinto (no las
// candidatas legacy de un solo SKU, que no requieren composición).
const targets = PREVIEW_PROMOTION_SEED.filter((promotion) => promotion.includedSkus.length >= 2);
const results = [];
for (const promotion of targets) {
  const cutouts = [];
  for (const sku of promotion.includedSkus) {
    const productPath = path.join(ROOT, 'assets/catalog/beverages', sku, 'product.webp');
    const bytes = await fs.readFile(productPath);
    const cutout = await trimToProduct(bytes);
    if (!cutout) throw new Error(`${sku}: no se pudo recortar el producto para la composición de ${promotion.promoId}.`);
    cutouts.push(cutout);
  }

  const outputDir = path.join(OUTPUT_ROOT, promotion.promoId);
  await fs.mkdir(outputDir, { recursive: true });
  const files = [];
  for (const size of SIZES) {
    const buffer = await composeSize(cutouts, size);
    const outputPath = path.join(outputDir, `${size.name}.webp`);
    await fs.writeFile(outputPath, buffer);
    files.push(outputPath.replaceAll('\\', '/'));
  }
  results.push({ promoId: promotion.promoId, skus: promotion.includedSkus, files });
  console.log(`${promotion.promoId}: ${files.length} imágenes generadas (${cutouts.length} producto(s)).`);
}

const RESULT_JSON = 'C:/1212/artifacts/taba-packshots-promos-review/promotion-image-result.json';
await fs.mkdir(path.dirname(RESULT_JSON), { recursive: true });
await fs.writeFile(RESULT_JSON, JSON.stringify({ generatedBy: 'scripts/catalog-images/compose-promotion-images.mjs', results }, null, 2));
console.log(`\n${results.length} promoción(es) procesadas. Resultado: ${RESULT_JSON}`);
