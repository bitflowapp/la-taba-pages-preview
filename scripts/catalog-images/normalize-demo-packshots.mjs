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

const { products } = await import('../../js/approved-beverage-demo-data.js');

const ROOT = path.resolve(import.meta.dirname, '../..');
const BACKUP_ROOT = 'C:/1212/artifacts/taba-packshots-promos-review/packshots-before-after';
const RESULT_JSON = 'C:/1212/artifacts/taba-packshots-promos-review/packshot-normalization-result.json';

// Recorte de packshots aprobados: no toca el pipeline comercial (normalize.mjs).
// Objetivo: reducir el margen blanco excesivo de los WebP ya publicados en
// assets/catalog/beverages y recentrar el producto, sin generative AI y sin
// reconstruir etiquetas. Trabaja siempre sobre el WebP actualmente servido
// (no existe un "original" crudo versionado en el repo para estos 22 SKU);
// por eso cada archivo se respalda en BACKUP_ROOT antes de sobrescribirse.
const TARGET_HEIGHT_PCT = 76;
const MAX_SAFE_WIDTH_PCT = 94;
const WHITE_THRESHOLD = 246;
const WHITE_TOLERANCE = 6;
const MASTER_SIZE = 1000;
const THUMB_SIZE = 400;

const apply = process.argv.includes('--apply');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// Detecta el bounding box del producto por flood-fill de fondo BLANCO
// conectado desde el borde del lienzo. A diferencia de un umbral de color
// global, esto no confunde tapas blancas, brillos especulares en latas
// plateadas ni reflejos de botellas transparentes con el margen, porque esos
// elementos quedan rodeados de píxeles no blancos y nunca se conectan al
// borde exterior.
async function findBBoxViaBorderFlood(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const isBg = (x, y) => {
    const idx = (y * width + x) * channels;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
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
  return { width, height, minX, minY, maxX, maxY };
}

async function buildMaster(sourceBytes, bbox) {
  const { width: srcW, height: srcH, minX, minY, maxX, maxY } = bbox;
  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;

  const pad = Math.max(4, Math.round(0.01 * Math.max(bboxW, bboxH)));
  const cropLeft = Math.max(0, minX - pad);
  const cropTop = Math.max(0, minY - pad);
  const cropRight = Math.min(srcW, maxX + 1 + pad);
  const cropBottom = Math.min(srcH, maxY + 1 + pad);
  const cropW = cropRight - cropLeft;
  const cropH = cropBottom - cropTop;

  const targetHeightPx = Math.round((TARGET_HEIGHT_PCT / 100) * MASTER_SIZE);
  let scale = targetHeightPx / cropH;
  const maxSafeWidthPx = Math.round((MAX_SAFE_WIDTH_PCT / 100) * MASTER_SIZE);
  let widthClamped = false;
  if (cropW * scale > maxSafeWidthPx) {
    scale = maxSafeWidthPx / cropW;
    widthClamped = true;
  }

  const newW = Math.max(1, Math.round(cropW * scale));
  const newH = Math.max(1, Math.round(cropH * scale));

  const resized = await sharp(sourceBytes)
    .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
    .resize(newW, newH, { fit: 'fill' })
    .toBuffer();

  const master = await sharp({
    create: { width: MASTER_SIZE, height: MASTER_SIZE, channels: 3, background: '#ffffff' },
  })
    .composite([{ input: resized, gravity: 'center' }])
    .flatten({ background: '#ffffff' })
    .webp({ quality: 84, effort: 6 })
    .toBuffer();

  const achievedHeightPct = (newH / MASTER_SIZE) * 100;
  const achievedWidthPct = (newW / MASTER_SIZE) * 100;
  return { master, achievedHeightPct, achievedWidthPct, widthClamped };
}

const results = [];
for (const product of products) {
  const productAbs = path.join(ROOT, product.image);
  const thumbAbs = path.join(ROOT, product.imageThumbnail);
  const beforeMasterBytes = await fs.readFile(productAbs);
  const beforeThumbBytes = await fs.readFile(thumbAbs);
  const beforeMasterHash = sha256(beforeMasterBytes);
  const beforeThumbHash = sha256(beforeThumbBytes);

  const bbox = await findBBoxViaBorderFlood(beforeMasterBytes);
  if (!bbox) {
    results.push({
      sku: product.sku,
      status: 'DEFERRED',
      reason: 'No se detectó un bounding box de producto (imagen sin margen blanco reconocible); se mantiene el asset original sin cambios.',
      before: { imageSha256: beforeMasterHash, imageThumbnailSha256: beforeThumbHash },
    });
    continue;
  }

  const beforeHeightPct = ((bbox.maxY - bbox.minY + 1) / bbox.height) * 100;
  const beforeWidthPct = ((bbox.maxX - bbox.minX + 1) / bbox.width) * 100;

  const { master: masterBytes, achievedHeightPct, achievedWidthPct, widthClamped } = await buildMaster(beforeMasterBytes, bbox);
  const thumbBytes = await sharp(masterBytes)
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .webp({ quality: 84, effort: 6 })
    .toBuffer();

  const afterMasterHash = sha256(masterBytes);
  const afterThumbHash = sha256(thumbBytes);
  const unchanged = afterMasterHash === beforeMasterHash;

  const backupDir = path.join(BACKUP_ROOT, product.sku);
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(path.join(backupDir, 'product-before.webp'), beforeMasterBytes);
  await fs.writeFile(path.join(backupDir, 'thumbnail-before.webp'), beforeThumbBytes);
  await fs.writeFile(path.join(backupDir, 'product-after.webp'), masterBytes);
  await fs.writeFile(path.join(backupDir, 'thumbnail-after.webp'), thumbBytes);

  if (apply) {
    await fs.writeFile(productAbs, masterBytes);
    await fs.writeFile(thumbAbs, thumbBytes);
  }

  results.push({
    sku: product.sku,
    status: unchanged ? 'ALREADY_COMPLIANT' : 'NORMALIZED',
    widthClamped,
    before: {
      imageSha256: beforeMasterHash,
      imageThumbnailSha256: beforeThumbHash,
      heightOccupationPct: Number(beforeHeightPct.toFixed(2)),
      widthOccupationPct: Number(beforeWidthPct.toFixed(2)),
    },
    after: {
      imageSha256: afterMasterHash,
      imageThumbnailSha256: afterThumbHash,
      imageWidth: MASTER_SIZE,
      imageHeight: MASTER_SIZE,
      thumbnailWidth: THUMB_SIZE,
      thumbnailHeight: THUMB_SIZE,
      heightOccupationPct: Number(achievedHeightPct.toFixed(2)),
      widthOccupationPct: Number(achievedWidthPct.toFixed(2)),
    },
  });
  console.log(`${product.sku}: ${unchanged ? 'sin cambios (ya cumplía el rango objetivo)' : 'normalizado'} — alto ${beforeHeightPct.toFixed(1)}% -> ${achievedHeightPct.toFixed(1)}%${widthClamped ? ' (clamp de seguridad por ancho)' : ''}`);
}

await fs.mkdir(path.dirname(RESULT_JSON), { recursive: true });
await fs.writeFile(RESULT_JSON, JSON.stringify({ generatedBy: 'scripts/catalog-images/normalize-demo-packshots.mjs', apply, results }, null, 2));
console.log(`\n${apply ? 'APLICADO' : 'DRY-RUN'}: ${results.length} SKU procesados. Resultado: ${RESULT_JSON}`);
