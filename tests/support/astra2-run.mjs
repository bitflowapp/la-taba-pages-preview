// Runs one astra2 scenario in a child node (the vm-modules flag is needed) and returns its parsed result.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function scenario(name, arg) {
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', path.join(ROOT, 'tests/support/astra2-scenarios.mjs'), name, ...(arg === undefined ? [] : [String(arg)])], {
    encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024, env: process.env,
  });
  const line = r.stdout.split('\n').find(l => l.startsWith('RESULT_JSON '));
  if (!line) throw new Error(`scenario ${name} failed:\n${r.stderr.slice(0, 3000)}\n${r.stdout.slice(0, 1000)}`);
  return JSON.parse(line.slice('RESULT_JSON '.length));
}
