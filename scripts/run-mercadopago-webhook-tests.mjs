/*
 * Las pruebas de firma del webhook de Mercado Pago: las de Deno y las de Node.
 *
 * POR QUÉ `--node-modules-dir=none`
 * ---------------------------------
 * Porque decía `auto`, y con esa bandera Deno ve el `package.json` de la raíz,
 * lo trata como proyecto Node y MATERIALIZA `node_modules` resolviendo los
 * rangos de ese archivo contra el registro. El `package-lock.json` no lo lee.
 * `@playwright/test: ^1.60.0` resolvía a 1.62.1 y pisaba el 1.60.0 que `npm ci`
 * había instalado dos pasos antes:
 *
 *     Initialize playwright@1.62.1
 *     Initialize @playwright/test@1.62.1
 *     Initialize playwright-core@1.62.1
 *
 * El costo se cobraba en el paso siguiente. El E2E había descargado los
 * navegadores del Playwright fijado (chromium-headless-shell v1223, webkit
 * v2287) y el Playwright que quedó instalado pedía otros (1234 y 2336), así que
 * 460 de 462 pruebas murieron diciendo «Executable doesn't exist»: un mensaje
 * sobre navegadores que faltan, causado por un paso de webhooks, ocho minutos
 * antes, que había terminado en verde.
 *
 * Estas pruebas no necesitan nada de `node_modules`: lo único npm que importan
 * es `npm:mercadopago@3.2.1`, con la versión clavada en el propio especificador,
 * y Deno lo resuelve de su caché global. Con `none` corren las 22 igual y no
 * tocan un solo archivo del árbol de npm —comprobado—.
 *
 * La guardia que atrapa la reincidencia: `scripts/check-node-modules-pinned.mjs`,
 * que CI corre entre este paso y el E2E.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const steps = [
  ['npx', ['--yes', 'deno@2.6.1', 'test', '--node-modules-dir=none',
    'supabase/functions/_shared/mercadopago-webhook-signature.deno.ts',
    'supabase/functions/_shared/payment-worker-signature.deno.ts',
    'supabase/functions/_shared/request-protocol.deno.ts',
    'supabase/functions/_shared/webhook-notification.deno.ts']],
  /*
   * El importe va en su PROPIO paso porque es el único que necesita
   * `--allow-env`: `preferenceRequest()` lee el entorno del proveedor y la base
   * de las URLs de retorno, y estas pruebas los fijan para medir los dos modos.
   * Sumar esa capacidad al paso de arriba se la regalaría a cuatro suites que
   * no la necesitan.
   */
  ['npx', ['--yes', 'deno@2.6.1', 'test', '--node-modules-dir=none', '--allow-env',
    'supabase/functions/_shared/mercadopago-preference.deno.ts',
    'supabase/functions/_shared/seller-oauth-runtime.deno.ts',
    'supabase/functions/_shared/seller-webhook-runtime.deno.ts']],
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
