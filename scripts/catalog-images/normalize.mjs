import fs from 'node:fs/promises';
import path from 'node:path';

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('Falta sharp. Instalarlo temporalmente con: npm install --no-save sharp');
  process.exit(2);
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const RAW = path.join(ROOT, 'scripts/catalog-images/.raw');
const OUTPUT = path.join(ROOT, 'assets/products');
const files = await fs.readdir(RAW).catch(() => []);
if (!files.length) {
  console.log('No hay fuentes descargadas para normalizar.');
  process.exit(0);
}
await fs.mkdir(OUTPUT, { recursive: true });

for (const file of files) {
  const sku = file.split('.')[0];
  const input = path.join(RAW, file);
  for (const [suffix, size] of [['', 1000], ['-thumb', 400]]) {
    await sharp(input)
      .rotate()
      .resize(size, size, { fit: 'contain', background: '#ffffff', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .webp({ quality: 84, effort: 6 })
      .toFile(path.join(OUTPUT, `${sku}${suffix}.webp`));
  }
  console.log(`${sku}: WebP 1000 y 400 generados.`);
}
