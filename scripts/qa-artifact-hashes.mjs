import { createHash } from 'node:crypto';
import {
  lstatSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const root = path.resolve('docs/final-commercial-release');
const output = path.join(root, 'artifact-hashes.sha256');
const excluded = new Set([path.basename(output)]);

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      const stats = lstatSync(absolute);
      if (stats.isSymbolicLink()) {
        throw new Error(`No se permiten enlaces simbólicos en la evidencia: ${absolute}`);
      }
      if (stats.isDirectory()) return collectFiles(absolute);
      if (!stats.isFile() || excluded.has(entry.name)) return [];
      return [absolute];
    });
}

const lines = collectFiles(root).map((absolute) => {
  const digest = createHash('sha256').update(readFileSync(absolute)).digest('hex');
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  return `${digest}  ${relative}`;
});

writeFileSync(output, `${lines.join('\n')}\n`, 'utf8');
console.log(`Hashes SHA-256: ${lines.length} artefactos en ${path.relative('.', output)}`);
