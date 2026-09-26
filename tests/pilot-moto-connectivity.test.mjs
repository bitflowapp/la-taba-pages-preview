import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parseAdbDevices } from '../scripts/deploy/check-moto-g15.mjs';

test('ADB parser distinguishes connected, unauthorized and missing device', () => {
  assert.deepEqual(parseAdbDevices('List of devices attached\nZY32LHS6PS device usb:1-1\n'),
    [{ serial: 'ZY32LHS6PS', state: 'device' }]);
  assert.deepEqual(parseAdbDevices('List of devices attached\nZY32LHS6PS unauthorized\n'),
    [{ serial: 'ZY32LHS6PS', state: 'unauthorized' }]);
  assert.deepEqual(parseAdbDevices('List of devices attached\n'), []);
});

test('current disconnected Moto never produces a false PASS', () => {
  const result = spawnSync(process.execPath, ['scripts/deploy/check-moto-g15.mjs'], {
    encoding: 'utf8', windowsHide: true, timeout: 20_000,
  });
  if (result.status !== 0) assert.match(result.stderr, /MOTO_CONNECTIVITY_BLOCKED/);
  else assert.match(result.stdout, /"adb":"PASS"/);
});
