import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const path = 'scripts/e2e-staging/verify-rider-pilot-backup.mjs';
const source = readFileSync(path, 'utf8');

test('backup verifier requires an explicit restore source before opening signing material', () => {
  const result = spawnSync(process.execPath, [path], {
    encoding: 'utf8', windowsHide: true, timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Use exactly --self-test or --backup-file/);
});

test('backup verifier never passes the signing password in command arguments', () => {
  assert.match(source, /--ks-pass', 'env:RIDER_PILOT_SIGNING_PASS'/);
  assert.match(source, /--key-pass', 'env:RIDER_PILOT_SIGNING_PASS'/);
  assert.doesNotMatch(source, /--ks-pass', 'pass:/);
  assert.match(source, /externalBackupVerified: oneDriveCloudOnly/);
  assert.match(source, /FilePlaceholderStatus/);
  assert.match(source, /StorageProviderFileIdentifier/);
  assert.match(source, /rmSync\(target, \{ recursive: true, force: true \}\)/);
});

test('cloud provenance cannot be claimed by local self-test', () => {
  const result = spawnSync(process.execPath, [path, '--self-test', '--onedrive-cloud-only'], {
    encoding: 'utf8', windowsHide: true, timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cloud-only proof requires --backup-file/);
});
