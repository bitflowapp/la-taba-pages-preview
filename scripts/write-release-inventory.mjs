import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const outputPath = 'docs/final-commercial-release/modified-files.txt';
const baseRef = process.argv[2] || 'HEAD';
const staged = execFileSync(
  'git',
  ['diff', '--cached', baseRef, '--name-only', '--diff-filter=ACDMRTUXB', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .map((value) => value.trim())
  .filter(Boolean);

const files = [...new Set([...staged, outputPath])].sort((a, b) => a.localeCompare(b, 'en'));
writeFileSync(path.resolve(outputPath), `${files.join('\n')}\n`, 'utf8');
console.log(`Inventario de release desde ${baseRef}: ${files.length} archivos en ${outputPath}`);
