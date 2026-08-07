/**
 * Puerta del canal de WhatsApp que no necesita base de datos.
 *
 * Corre las dos cosas que hay que correr en los DOS runtimes del canal:
 *  1. `deno check` sobre las funciones de borde, que es donde vive el canal en
 *     producción. Los módulos compartidos son JavaScript plano, así que un error
 *     de contrato entre ellos y el TypeScript de borde sólo aparece acá.
 *  2. Las suites de Node, que ejercitan esos mismos módulos.
 *
 * El E2E contra PostgreSQL es aparte: `npm run test:whatsapp:e2e`.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const steps = [
  ['npx', ['--yes', 'deno@2.6.1', 'check', '--node-modules-dir=auto',
    'supabase/functions/whatsapp-webhook/index.ts',
    'supabase/functions/whatsapp-dispatcher/index.ts']],
  ['node', ['--import', './tests/test-bootstrap.mjs', '--test', '--test-concurrency=1',
    'tests/whatsapp-signature.test.mjs',
    'tests/whatsapp-inbound.test.mjs',
    'tests/whatsapp-messages.test.mjs',
    'tests/whatsapp-graph.test.mjs',
    'tests/whatsapp-conversation.test.mjs',
    'tests/whatsapp-channel-contract.test.mjs']],
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
