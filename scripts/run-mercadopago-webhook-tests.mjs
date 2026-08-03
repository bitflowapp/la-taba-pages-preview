import { spawnSync } from 'node:child_process';
import path from 'node:path';

const steps = [
  ['npx', ['--yes', 'deno@2.6.1', 'test', '--node-modules-dir=auto',
    'supabase/functions/_shared/mercadopago-webhook-signature.deno.ts',
    'supabase/functions/_shared/payment-worker-signature.deno.ts']],
  ['node', ['--import', './tests/test-bootstrap.mjs', '--test', '--test-concurrency=1',
    'tests/mercadopago-webhook.test.mjs',
    'tests/mercadopago-scheduler.test.mjs']],
];

for (const [command, args] of steps) {
  const npxCli = process.env.npm_execpath
    ? path.join(path.dirname(process.env.npm_execpath), 'npx-cli.js')
    : null;
  const executable = command === 'npx' && npxCli ? process.execPath : command;
  const executableArgs = command === 'npx' && npxCli ? [npxCli, ...args] : args;
  const result = spawnSync(executable, executableArgs, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
