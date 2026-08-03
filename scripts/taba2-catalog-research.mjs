import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const result = spawnSync(process.execPath, ['scripts/taba2-catalog-authority.mjs', '--report-only'], {
  cwd: ROOT,
  encoding: 'utf8',
});
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.status !== 0) process.exit(result.status || 1);
