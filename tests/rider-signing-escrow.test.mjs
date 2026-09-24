import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { passwordFromRecovery, recoveryText, resolveVault } from '../scripts/e2e-staging/escrow-rider-signing-password.mjs';

test('signing password escrow round-trips and names the separate keystore', () => {
  const text = recoveryText('TEST_ONLY_password_value_1234', new Date('2026-09-24T00:00:00Z'));
  assert.equal(passwordFromRecovery(text), 'TEST_ONLY_password_value_1234');
  assert.match(text, /alias lataba-pilot-v1/);
  assert.throws(() => recoveryText('short'), /PASSWORD_INVALID/);
  assert.throws(() => passwordFromRecovery('nothing here'), /RECOVERY_FILE_HAS_NO_PASSWORD_LINE/);
});

test('escrow only accepts the unlocked Personal Vault, never the keystore folder', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'taba-onedrive-'));
  try {
    assert.throws(() => resolveVault(root), /PERSONAL_VAULT_LOCKED_OR_ABSENT/);
    const recovery = path.join(root, 'La-Taba', 'Recovery', 'Rider-Signing');
    mkdirSync(recovery, { recursive: true });
    assert.throws(() => resolveVault(root, recovery), /DESTINATION_IS_NOT_THE_PERSONAL_VAULT/);
    const vault = path.join(root, 'Almacén personal');
    mkdirSync(vault);
    assert.equal(resolveVault(root), vault);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
