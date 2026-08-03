import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

export function selectWindowsArtifacts(releaseRoot, files = walk(releaseRoot)) {
  const normalizedRoot = path.resolve(releaseRoot);
  return files.filter((file) => {
    const absolute = path.resolve(file);
    if (absolute === path.join(normalizedRoot, 'taba-negocio.exe')) return true;
    const relative = path.relative(normalizedRoot, absolute).replaceAll('\\', '/');
    return /^bundle\/(?:msi\/[^/]+\.msi|nsis\/[^/]+-setup\.exe)$/i.test(relative)
      || /^bundle\/(?:msi|nsis)\/[^/]+\.sig$/i.test(relative);
  }).sort();
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function hashWindowsArtifacts(releaseRoot, gitHead) {
  return selectWindowsArtifacts(releaseRoot).map((file) => ({
    path: path.relative(releaseRoot, file).replaceAll('\\', '/'),
    sizeBytes: fs.statSync(file).size,
    sha256: sha256(file),
    gitHead,
  }));
}

function run() {
  const rootIndex = process.argv.indexOf('--root');
  const outputIndex = process.argv.indexOf('--output');
  if (rootIndex < 0 || outputIndex < 0 || !process.argv[rootIndex + 1] || !process.argv[outputIndex + 1]) {
    throw new Error('Usage: node scripts/hash-windows-artifacts.mjs --root <release-dir> --output <hashes.json>');
  }
  const releaseRoot = path.resolve(process.argv[rootIndex + 1]);
  const output = path.resolve(process.argv[outputIndex + 1]);
  if (!fs.statSync(releaseRoot).isDirectory()) throw new Error('Windows release root is not a directory.');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const artifacts = hashWindowsArtifacts(releaseRoot, head);
  const types = new Set(artifacts.map((artifact) => {
    if (artifact.path === 'taba-negocio.exe') return 'app-exe';
    if (artifact.path.toLowerCase().endsWith('.msi')) return 'msi';
    if (artifact.path.toLowerCase().endsWith('-setup.exe')) return 'nsis';
    return 'updater-signature';
  }));
  if (!types.has('app-exe') || !types.has('msi') || !types.has('nsis')) {
    throw new Error('Windows build is incomplete: EXE, MSI, and NSIS are required.');
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, head, artifacts }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(`Hashed ${artifacts.length} Windows artifacts for ${head}.`);
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try { run(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'Windows artifact hashing failed.');
    process.exitCode = 1;
  }
}
