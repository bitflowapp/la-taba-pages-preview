import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('payment credentials in environment variants are ignored; examples remain reviewable', () => {
  const privateFiles = ['.env', '.env.local', '.env.production', '.env.test',
    'services/checkout/.env', 'services/checkout/.env.production.local'];
  const examples = ['.env.example', '.env.test.example', 'services/checkout/.env.example'];
  const ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
    input: [...privateFiles, ...examples].join('\n') + '\n', encoding: 'utf8',
  }).trim().split(/\r?\n/);
  assert.deepEqual(ignored, privateFiles);
});
