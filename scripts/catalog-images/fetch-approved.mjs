import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseCsv } from '../validate-product-catalog.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const AUDIT = path.join(ROOT, 'docs/catalog/image-source-audit.csv');
const RAW = path.join(ROOT, 'scripts/catalog-images/.raw');

const rows = parseCsv(await fs.readFile(AUDIT, 'utf8'));
const [header = [], ...records] = rows;
const sources = records.map((values) => Object.fromEntries(
  header.map((column, index) => [column, (values[index] || '').trim()]),
));
const approved = sources.filter((source) => source.status === 'APROBADA');
if (!approved.length) {
  console.log('Sin fuentes APROBADAS; no se descargó ninguna imagen.');
  process.exit(0);
}

await fs.mkdir(RAW, { recursive: true });
for (const source of approved) {
  if (!/^https:\/\//i.test(source.source_url)) throw new Error(`Fuente insegura para ${source.sku}.`);
  if (![source.variant_verified, source.capacity_verified, source.package_verified, source.pack_verified]
    .every((value) => value === 'true')) {
    throw new Error(`${source.sku}: marcar REVISAR; identidad de producto no confirmada.`);
  }
  const response = await fetch(source.source_url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${source.sku}: descarga HTTP ${response.status}.`);
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error(`${source.sku}: la fuente no devolvió una imagen.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 15_000_000) throw new Error(`${source.sku}: imagen mayor a 15 MB.`);
  const safeSku = source.sku.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(path.join(RAW, `${safeSku}.${digest.slice(0, 12)}.source`), bytes, { flag: 'wx' });
  console.log(`${source.sku}: descargada y registrada sha256=${digest.slice(0, 12)}…`);
}
