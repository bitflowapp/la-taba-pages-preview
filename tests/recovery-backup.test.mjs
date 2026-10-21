import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptBackup, decryptBackup } from '../scripts/recovery/postgres-backup.mjs';

const key = Buffer.alloc(32, 7);
const projectRef = 'abcdefghijklmnopqrst';
const metadata = { projectRef, capturedAt: '2026-10-21T00:00:00Z', format: 'pg_dump-custom' };

test('backup envelope preserves native dump bytes and authenticated project metadata', () => {
  const bytes = Buffer.from('PGDMP\0fixture-only');
  const encrypted = encryptBackup(bytes, key, metadata);
  assert.ok(!encrypted.includes(Buffer.from('fixture-only')));
  const restored = decryptBackup(encrypted, key, projectRef);
  assert.deepEqual(restored.plaintext, bytes);
  assert.deepEqual(restored.metadata, metadata);
});

test('backup refuses wrong project, wrong key and altered ciphertext', () => {
  const encrypted = encryptBackup(Buffer.from('fixture'), key, metadata);
  assert.throws(() => decryptBackup(encrypted, key, 'anotherproject'));
  assert.throws(() => decryptBackup(encrypted, Buffer.alloc(32, 8), projectRef));
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() => decryptBackup(encrypted, key, projectRef));
});

test('each backup uses a fresh nonce and rejects malformed envelopes', () => {
  const bytes = Buffer.from('fixture');
  assert.notDeepEqual(encryptBackup(bytes, key, metadata), encryptBackup(bytes, key, metadata));
  assert.throws(() => decryptBackup(Buffer.from('bad'), key, projectRef));
});
