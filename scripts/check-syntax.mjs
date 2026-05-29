import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ...collectJavaScriptFiles(path.join(root, 'js')).map((filePath) => path.relative(root, filePath)),
  'sw.js',
].sort();

function collectJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

for (const relativePath of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, relativePath)], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
