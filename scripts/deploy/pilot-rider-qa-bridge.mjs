// One-time localhost-only credential/code bridge to the signed Rider pilot
// instrumentation test on the physical Moto. No secrets are printed or saved.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import net from 'node:net';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { assertPilotIdentity } from '../import-pilot-catalog.mjs';

const SERIAL = 'ZY32LHS6PS';
const run = JSON.parse(leerSecreto('PILOT COMMERCIAL E2E ACTIVE')?.secreto || '{}');
const rider = leerSecreto('PILOT RIDER QA');
assertPilotIdentity(run.projectRef, run.businessId);
assert.ok(run.orderId && run.publicCode && /^\d{4}$/.test(run.deliveryCode || ''),
  'PILOT_ORDER_AND_CODE_REQUIRED');
assert.ok(rider?.usuario && rider?.secreto, 'PILOT_RIDER_QA_ACCOUNT_REQUIRED');
const adb = (args) => spawnSync('adb', ['-s', SERIAL, ...args], {
  encoding: 'utf8', windowsHide: true, timeout: 10_000,
});
assert.equal(adb(['get-state']).status, 0, 'MOTO_G15_REQUIRED');

let server;
let port;
for (let attempt = 0; attempt < 8; attempt += 1) {
  const candidate = randomInt(40_000, 60_001);
  const next = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      next.once('error', reject);
      next.listen(candidate, '127.0.0.1', resolve);
    });
    server = next;
    port = candidate;
    break;
  } catch { next.close(); }
}
assert.ok(server && port, 'PILOT_BRIDGE_PORT_UNAVAILABLE');
let consumed = false;
let closed = false;
const cleanup = () => {
  if (closed) return;
  closed = true;
  adb(['reverse', '--remove', `tcp:${port}`]);
  server.close();
};
server.on('connection', (socket) => {
  if (consumed) { socket.destroy(); return; }
  consumed = true;
  socket.end(JSON.stringify({ email: rider.usuario, password: rider.secreto,
    businessId: run.businessId, publicCode: run.publicCode,
    deliveryCode: run.deliveryCode }) + '\n');
  setTimeout(cleanup, 250);
});
if (adb(['reverse', `tcp:${port}`, `tcp:${port}`]).status !== 0) {
  cleanup();
  throw Error('PILOT_ADB_REVERSE_FAILED');
}
const expiry = setTimeout(() => {
  if (!consumed) { cleanup(); process.exitCode = 1; }
}, 120_000);
server.on('close', () => clearTimeout(expiry));
process.on('SIGINT', () => { cleanup(); process.exitCode = 1; });
console.log(JSON.stringify({ bridgePort: port, lifetimeSeconds: 120,
  boundToLoopback: true, oneTime: true, pilotOnly: true, credentialsUnprinted: true }));
