// Moves the Mercado Pago TEST webhook signature from the Windows clipboard straight into the hosted recovery
// project's Edge Function secrets (MERCADOPAGO_OAUTH_WEBHOOK_SECRET) through the official Management API, then
// clears the clipboard. The value is never printed, logged, written to disk or passed on a command line:
// it lives only in this process' memory between the clipboard read and the HTTPS request.
//   node scripts/recovery/store-webhook-secret-from-clipboard.mjs [--target deploy/recovery-free-hosted.json]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { withRecoveryProject } from './hosted-client.mjs';

const NAME = 'MERCADOPAGO_OAUTH_WEBHOOK_SECRET';
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const target = JSON.parse(fs.readFileSync(arg('--target') || 'deploy/recovery-free-hosted.json', 'utf8'));
// Only the TEST application of the Free recovery project, never a commercial one.
assert.equal(target.environment, 'test');
assert.equal(target.mercadoPagoApplicationId, '2691240967769590');
assert.equal(target.commercialPaymentsEnabled, false);

const powershell = (script, input) => execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
  { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'ignore'] });
const clearClipboard = () => {
  try {
    powershell('Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()');
    return true;
  } catch { return false; }
};

let value = '';
try {
  value = powershell('[Console]::Out.Write((Get-Clipboard -Raw))').trim();
  const shape = { length: value.length, hex: /^[0-9a-f]+$/i.test(value) };
  // Mercado Pago signatures are 64 hexadecimal characters; anything else is not what was copied.
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    console.log(JSON.stringify({ stored: false, reason: 'clipboard does not hold a 64-hex webhook signature', shape }));
    process.exitCode = 1;
  } else {
    await withRecoveryProject(target, async ({ request }) => {
      await request('/secrets', { method: 'POST', body: JSON.stringify([{ name: NAME, value }]) });
    });
    console.log(JSON.stringify({ stored: true, name: NAME, projectRef: target.projectRef, shape }));
  }
} finally {
  value = '';
  console.log(JSON.stringify({ clipboardCleared: clearClipboard() }));
}
