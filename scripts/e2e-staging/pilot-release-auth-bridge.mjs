import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import net from 'node:net';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const serial = 'ZY32LHS6PS';
let credentials = leerSecreto('STAGING RIDER QA 20260920');
if (!credentials?.usuario || !credentials?.secreto) throw Error('QA_RIDER_CREDENTIAL_UNAVAILABLE');
const delivery = process.argv.includes('--delivery');
const run = delivery ? JSON.parse(leerSecreto('RIDER CANONICAL QA RUN 20260922')?.secreto || '{}') : null;
if (delivery && (!run?.orderId || !run.publicCode || !/^\d{4}$/.test(run.deliveryCode || '')))
  throw Error('QA_DELIVERY_RUN_REQUIRED');
const adb = (args) => spawnSync('adb', ['-s', serial, ...args], {
  encoding: 'utf8', windowsHide: true, timeout: 10_000,
});
if (adb(['get-state']).status !== 0) throw Error('MOTO_ADB_REQUIRED');

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
  } catch {
    next.close();
  }
}
if (!server || !port) throw Error('QA_BRIDGE_LOCAL_PORT_UNAVAILABLE');

let consumed = false;
let closed = false;
const cleanup = () => {
  if (closed) return;
  closed = true;
  adb(['reverse', '--remove', `tcp:${port}`]);
  server.close();
  credentials = null;
};
server.on('connection', (socket) => {
  if (consumed) { socket.destroy(); return; }
  consumed = true;
  socket.end(JSON.stringify({ email: credentials.usuario, password: credentials.secreto,
    ...(delivery ? { publicCode: run.publicCode, deliveryCode: run.deliveryCode } : {}) }) + '\n');
  setTimeout(() => {
    cleanup();
    console.log('QA_BRIDGE_CONSUMED_AND_REMOVED');
  }, 250);
});
if (adb(['reverse', `tcp:${port}`, `tcp:${port}`]).status !== 0) {
  cleanup();
  throw Error('QA_BRIDGE_ADB_REVERSE_FAILED');
}
const expiry = setTimeout(() => {
  if (!consumed) {
    cleanup();
    console.error('QA_BRIDGE_EXPIRED_UNCONSUMED');
    process.exitCode = 1;
  }
}, 120_000);
server.on('close', () => clearTimeout(expiry));
process.on('SIGINT', () => { cleanup(); process.exitCode = 1; });
console.log(JSON.stringify({ bridgePort: port, lifetimeSeconds: 120,
  boundToLoopback: true, oneTime: true, stagingOnly: true, delivery,
  credentialsUnprinted: true }));
