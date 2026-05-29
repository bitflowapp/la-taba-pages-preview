import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'js/config.js',
  'js/data.js',
  'js/state.js',
  'js/cart.js',
  'js/orders.js',
  'js/business.js',
  'js/delivery.js',
  'js/ui.js',
  'js/app.js',
  'sw.js',
];

for (const relativePath of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, relativePath)], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
