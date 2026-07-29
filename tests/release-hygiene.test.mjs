import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditReleaseHygiene,
  findPrivateIdentifiers,
} from '../scripts/check-release-hygiene.mjs';

test('release hygiene rejects a real device identifier without exposing its value', () => {
  const key = ['ser', 'ial'].join('');
  const source = JSON.stringify({ device: { [key]: ['phy', 'sical-device-123'].join('') } });
  const findings = findPrivateIdentifiers('evidence.json', source);

  assert.deepEqual(findings, [{
    file: 'evidence.json',
    location: '$.device.serial',
    category: 'private-device-identifier',
  }]);
  assert.doesNotMatch(JSON.stringify(findings), /physical-device-123/);
});

test('release hygiene accepts omitted and explicitly redacted identifiers', () => {
  assert.deepEqual(findPrivateIdentifiers('evidence.json', JSON.stringify({ device: {} })), []);
  assert.deepEqual(
    findPrivateIdentifiers('evidence.json', JSON.stringify({ device: { serial: '<redacted>' } })),
    [],
  );
});

test('tracked release files contain no private device identifiers', () => {
  assert.deepEqual(auditReleaseHygiene(), []);
});
