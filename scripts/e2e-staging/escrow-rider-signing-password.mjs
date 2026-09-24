// Escrow of the Rider PILOT signing password into the owner's OneDrive
// Personal Vault (encrypted, identity-verified on every unlock), so signing
// survives the loss of this PC. The keystore backup lives elsewhere
// (La-Taba\Recovery\Rider-Signing); the two never share a folder.
//
// The vault must be unlocked by its owner first (Windows Hello / 2FA). This
// script never prints the password and refuses any non-vault destination.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const RECOVERY_FILE = 'la-taba-rider-signing-recovery.txt';
export const PASSWORD_PREFIX = 'Password (store and key): ';
const VAULT_NAMES = ['Almacén personal', 'Personal Vault', 'Cofre pessoal'];

export function recoveryText(password, now = new Date()) {
  assert.ok(typeof password === 'string' && password.length >= 16 && !/[\r\n]/.test(password), 'PASSWORD_INVALID');
  return ['La Taba · Rider PILOT signing recovery (pilot-v1)',
    'Keystore: OneDrive\\La-Taba\\Recovery\\Rider-Signing\\pilot-v1-20260924.p12 (PKCS#12, alias lataba-pilot-v1)',
    'Certificate SHA-256: 2dcc9b0a0cf022ebf59c500331103ee31cec9e9142d5431553131877948ec1aa',
    `${PASSWORD_PREFIX}${password}`,
    `Escrowed: ${now.toISOString()}`, ''].join('\n');
}

export function passwordFromRecovery(text) {
  const line = String(text).split(/\r?\n/).find((row) => row.startsWith(PASSWORD_PREFIX));
  assert.ok(line, 'RECOVERY_FILE_HAS_NO_PASSWORD_LINE');
  return line.slice(PASSWORD_PREFIX.length);
}

export function resolveVault(oneDriveRoot, explicit) {
  const candidates = explicit ? [explicit] : VAULT_NAMES.map((name) => path.join(oneDriveRoot, name));
  const vault = candidates.find((dir) => existsSync(dir) && statSync(dir).isDirectory());
  assert.ok(vault, 'PERSONAL_VAULT_LOCKED_OR_ABSENT');
  const full = path.resolve(vault).toLowerCase();
  assert.ok(full.startsWith(path.resolve(oneDriveRoot).toLowerCase() + path.sep), 'VAULT_MUST_BE_INSIDE_ONEDRIVE');
  assert.ok(VAULT_NAMES.map((n) => n.toLowerCase()).includes(path.basename(full)), 'DESTINATION_IS_NOT_THE_PERSONAL_VAULT');
  assert.ok(!full.includes(`${path.sep}la-taba${path.sep}recovery`), 'VAULT_CANNOT_SHARE_KEYSTORE_FOLDER');
  assert.ok(!full.startsWith(ROOT.toLowerCase()), 'VAULT_CANNOT_BE_IN_REPO');
  return vault;
}

function main() {
  const oneDrive = process.env.OneDriveConsumer || process.env.OneDrive;
  assert.ok(oneDrive, 'ONEDRIVE_PERSONAL_NOT_CONFIGURED');
  const at = process.argv.indexOf('--vault');
  const vault = resolveVault(oneDrive, at < 0 ? null : process.argv[at + 1]);
  const password = leerSecreto('RIDER PILOT SIGNING PASSWORD')?.secreto;
  assert.ok(password, 'SIGNING_PASSWORD_NOT_IN_CREDENTIAL_MANAGER');
  const file = path.join(vault, RECOVERY_FILE);
  writeFileSync(file, recoveryText(password), { encoding: 'utf8', flag: 'w' });
  const readBack = passwordFromRecovery(readFileSync(file, 'utf8'));
  const same = createHash('sha256').update(readBack).digest('hex') === createHash('sha256').update(password).digest('hex');
  assert.ok(same, 'ESCROW_READBACK_MISMATCH');
  console.log(JSON.stringify({ escrow: 'PASS', destination: 'ONEDRIVE_PERSONAL_VAULT', file: RECOVERY_FILE,
    passwordPrinted: false, sharesKeystoreFolder: false }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try { main(); } catch (error) { console.error(`SIGNING_ESCROW_BLOCKED:${error.message}`); process.exitCode = 1; }
}
