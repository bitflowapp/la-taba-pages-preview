// Restore-test the independent Rider pilot PKCS#12 without printing or persisting its password.
// A local self-test does NOT certify an external backup; that requires a fresh
// download/copy from the approved external destination as --backup-file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const original = path.join(process.env.USERPROFILE || '', '.codex', 'secrets', 'la-taba-rider-pilot', 'pilot-v1.p12');
const index = process.argv.indexOf('--backup-file');
const selfTest = process.argv.includes('--self-test');
const oneDriveCloudOnly = process.argv.includes('--onedrive-cloud-only');
assert.ok(selfTest !== (index >= 0), 'Use exactly --self-test or --backup-file <path>');
assert.ok(!oneDriveCloudOnly || !selfTest, 'Cloud-only proof requires --backup-file');
const backupFile = index < 0 ? null : path.resolve(process.argv[index + 1] || '');
if (backupFile) {
  assert.notEqual(backupFile.toLowerCase(), path.resolve(original).toLowerCase(), 'Original is not a backup');
  assert.ok(!backupFile.toLowerCase().startsWith(root.toLowerCase() + path.sep), 'Backup cannot be in Git repo');
  assert.ok(existsSync(backupFile), 'Backup file unavailable');
}
// A normal path under a sync folder does not prove an off-device backup. This
// explicit mode requires OneDrive's cloud-only placeholder and provider ID
// *before* copyFileSync hydrates it. No account ID or secret is printed.
if (oneDriveCloudOnly) {
  const proof = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference='Stop'
$p=[IO.Path]::GetFullPath($env:RIDER_BACKUP_CANDIDATE)
$account=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\OneDrive\\Accounts\\Personal'
$root=[IO.Path]::GetFullPath($account.UserFolder).TrimEnd('\\')
$expected=Join-Path $root 'La-Taba\\Recovery\\Rider-Signing'
if (-not $p.StartsWith($expected+'\\',[StringComparison]::OrdinalIgnoreCase)) { exit 2 }
$shell=New-Object -ComObject Shell.Application
$folder=$shell.Namespace((Split-Path -Parent $p))
$item=$folder.ParseName((Split-Path -Leaf $p))
if (-not $item) { exit 3 }
$status=$item.ExtendedProperty('System.FilePlaceholderStatus')
$remoteId=$item.ExtendedProperty('System.StorageProviderFileIdentifier')
$shared=$item.ExtendedProperty('System.SharingStatus')
$sync=$item.ExtendedProperty('System.SyncTransferStatusFlags')
if ($status -eq 8 -and $remoteId -and $shared -eq 0 -and ($null -eq $sync -or $sync -eq 0)) { 'PASS'; exit 0 }
exit 4
`], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: { ...process.env, RIDER_BACKUP_CANDIDATE: backupFile },
  });
  assert.equal(proof.status, 0, 'OneDrive cloud-only provenance unavailable');
  assert.equal(proof.stdout.trim(), 'PASS', 'OneDrive cloud-only provenance unavailable');
}
const password = leerSecreto('RIDER PILOT SIGNING PASSWORD')?.secreto;
const localBackup = leerSecreto('RIDER PILOT KEYSTORE BACKUP')?.secreto;
assert.ok(password && localBackup && existsSync(original), 'Local pilot signing material unavailable');
const originalBytes = readFileSync(original);
assert.ok(originalBytes.equals(Buffer.from(localBackup, 'base64')), 'Local backup differs from signer');

const scope = path.resolve(tmpdir());
const temp = mkdtempSync(path.join(scope, 'taba-rider-restore-'));
assert.ok(path.resolve(temp).startsWith(scope + path.sep)
  && path.basename(temp).startsWith('taba-rider-restore-'), 'Unsafe temp directory');
const restored = path.join(temp, 'restored.p12');
const signedApk = path.join(temp, 'signed-test.apk');
const toolsDir = path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'build-tools', '36.0.0');
const apksigner = path.join(toolsDir, 'apksigner.bat');
const testInput = path.join(root, 'apps', 'rider-android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const currentRelease = path.join(root, 'apps', 'rider-android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const runSigner = (args, env = process.env) => spawnSync('cmd.exe', ['/d', '/c', apksigner, ...args], {
  encoding: 'utf8', windowsHide: true, env, timeout: 120_000,
});
const certificate = (apk) => {
  const result = runSigner(['verify', '--print-certs', apk]);
  assert.equal(result.status, 0, 'APK signature verification failed');
  const digests = [...result.stdout.matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([a-f0-9]{64})/gi)]
    .map((match) => match[1].toLowerCase());
  assert.equal(digests.length, 1, 'Exactly one APK signer required');
  return digests[0];
};
try {
  if (selfTest) writeFileSync(restored, Buffer.from(localBackup, 'base64'));
  else copyFileSync(backupFile, restored);
  const restoredBytes = readFileSync(restored);
  assert.equal(createHash('sha256').update(restoredBytes).digest('hex'),
    createHash('sha256').update(originalBytes).digest('hex'), 'Restored keystore differs');
  assert.ok(existsSync(testInput) && existsSync(currentRelease), 'APK inputs unavailable');
  const signed = runSigner(['sign', '--ks', restored, '--ks-type', 'PKCS12',
    '--ks-key-alias', 'lataba-pilot-v1', '--ks-pass', 'env:RIDER_PILOT_SIGNING_PASS',
    '--key-pass', 'env:RIDER_PILOT_SIGNING_PASS', '--out', signedApk, testInput],
  { ...process.env, RIDER_PILOT_SIGNING_PASS: password });
  assert.equal(signed.status, 0, `APK test signing failed (${signed.status})`);
  assert.equal(certificate(signedApk), certificate(currentRelease), 'Certificate mismatch');
  console.log(JSON.stringify({ restoreTest: 'PASS', certificateMatch: true,
    source: selfTest ? 'LOCAL_CREDENTIAL_MANAGER_ONLY'
      : oneDriveCloudOnly ? 'ONEDRIVE_CLOUD_ONLY_REHYDRATED' : 'EXTERNAL_FILE_ORIGIN_NOT_PROVEN',
    externalBackupVerified: oneDriveCloudOnly, passwordUnprinted: true }));
} finally {
  const target = path.resolve(temp);
  assert.ok(target.startsWith(scope + path.sep)
    && path.basename(target).startsWith('taba-rider-restore-'), 'Unsafe cleanup target');
  rmSync(target, { recursive: true, force: true });
}
