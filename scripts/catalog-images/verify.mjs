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
const dir = path.join(ROOT, 'assets/products');
const files = (await fs.readdir(dir)).filter((file) => file.endsWith('.webp'));
const errors = [];
for (const file of files) {
  const metadata = await sharp(path.join(dir, file)).metadata();
  const expected = file.endsWith('-thumb.webp') ? 400 : 1000;
  if (metadata.format !== 'webp' || metadata.width !== expected || metadata.height !== expected) {
    errors.push(`${file}: esperado WebP ${expected}x${expected}.`);
  }
}
for (const error of errors) console.error(`ERROR ${error}`);
if (errors.length) process.exitCode = 1;
else console.log(`${files.length} imagen(es) verificadas.`);
