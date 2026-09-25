// One-command read-only connectivity gate for the known Moto G15.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERIAL = 'ZY32LHS6PS';
export function parseAdbDevices(output) {
  return String(output || '').split(/\r?\n/).slice(1)
    .map((line) => line.trim()).filter(Boolean)
    .map((line) => { const [serial, state] = line.split(/\s+/); return { serial, state }; });
}

function adb(args, timeout = 15_000) {
  const result = spawnSync('adb', args, { encoding: 'utf8', windowsHide: true, timeout });
  if (result.status !== 0) throw Error(`ADB_COMMAND_FAILED:${args[0]}`);
  return result.stdout.trim();
}

function main() {
  adb(['start-server']);
  const device = parseAdbDevices(adb(['devices', '-l'])).find((entry) => entry.serial === SERIAL);
  if (!device || device.state !== 'device') throw Error(`MOTO_G15_NOT_AUTHORIZED_OR_DISCONNECTED:${device?.state || 'absent'}`);
  const model = adb(['-s', SERIAL, 'shell', 'getprop', 'ro.product.model']);
  if (!/moto g15/i.test(model)) throw Error('ADB_SERIAL_IS_NOT_MOTO_G15');
  const packagePath = adb(['-s', SERIAL, 'shell', 'pm', 'path', 'com.lataba.rider.pilot']);
  console.log(JSON.stringify({ adb: 'PASS', device: SERIAL, model,
    pilotPackageInstalled: packagePath.includes('package:'), readOnly: true }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try { main(); }
  catch (error) { console.error(`MOTO_CONNECTIVITY_BLOCKED:${error.message}`); process.exitCode = 1; }
}
