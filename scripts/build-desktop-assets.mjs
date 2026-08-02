import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'dist-desktop');
const entries = [
  'index.html', 'styles.css', 'manifest.webmanifest', 'runtime-config.js',
  'sw.js', 'assets', 'styles', 'js',
];

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
for (const entry of entries) {
  const source = path.join(root, entry);
  if (!fs.existsSync(source)) throw new Error(`Falta el asset desktop requerido: ${entry}`);
  fs.cpSync(source, path.join(destination, entry), { recursive: true });
}
console.log(`Desktop assets prepared: ${entries.length} entries.`);
