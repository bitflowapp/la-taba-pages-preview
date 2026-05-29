import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'dist_release');

const entries = [
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'sw.js',
  '.nojekyll',
  'assets',
  'js',
  'README.md',
  'docs/presentacion-walter.md',
  'docs/checklist-demo-walter.md',
  'docs/proximas-fases.md',
];

await fs.rm(releaseDir, { recursive: true, force: true });
await fs.mkdir(releaseDir, { recursive: true });

for (const entry of entries) {
  const source = path.join(root, entry);
  const target = path.join(releaseDir, entry);
  const stat = await fs.stat(source);

  await fs.mkdir(path.dirname(target), { recursive: true });

  if (stat.isDirectory()) {
    await fs.cp(source, target, { recursive: true });
  } else {
    await fs.copyFile(source, target);
  }
}

console.log(`Release folder created: ${releaseDir}`);
