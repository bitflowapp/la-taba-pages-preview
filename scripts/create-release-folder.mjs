import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'dist_release');

const entries = [
  'index.html',
  'styles.css',
  'styles',
  'manifest.webmanifest',
  'runtime-config.js',
  'sw.js',
  '.nojekyll',
  'assets',
  'js',
];

const sources = await Promise.all(entries.map(async (entry) => {
  const source = path.join(root, entry);
  return { entry, source, stat: await fs.stat(source) };
}));
const temporaryDir = await fs.mkdtemp(path.join(root, '.dist_release-'));
const previousDir = `${releaseDir}.previous-${process.pid}-${Date.now()}`;
let previousMoved = false;

try {
  for (const { entry, source, stat } of sources) {
    const target = path.join(temporaryDir, entry);
    await fs.mkdir(path.dirname(target), { recursive: true });

    if (stat.isDirectory()) {
      await fs.cp(source, target, { recursive: true });
    } else {
      await fs.copyFile(source, target);
    }
  }

  try {
    await fs.rename(releaseDir, previousDir);
    previousMoved = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  try {
    await fs.rename(temporaryDir, releaseDir);
  } catch (error) {
    if (previousMoved) await fs.rename(previousDir, releaseDir);
    throw error;
  }

  if (previousMoved) {
    await fs.rm(previousDir, { recursive: true, force: true });
  }
} catch (error) {
  await fs.rm(temporaryDir, { recursive: true, force: true }).catch(() => undefined);
  throw error;
}

console.log(`Release folder created: ${releaseDir}`);
