// Secret scan of the CONTROLLED_PRODUCTION Rider APK, in memory. The APK must
// carry the CP publishable key and nothing private: no Supabase secret key
// (CP or Staging), signing password or keystore bytes, QA passwords, or any
// PEM private key / sb_secret_ pattern. Prints booleans and hashes only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

function* entries(zip) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end -= 1;
  assert.ok(end >= 0, 'INVALID_APK_ZIP');
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i += 1) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50, 'INVALID_CENTRAL_DIRECTORY');
    const method = zip.readUInt16LE(cursor + 10);
    const size = zip.readUInt32LE(cursor + 20);
    const offset = zip.readUInt32LE(cursor + 42);
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) yield data;
    else if (method === 8) yield inflateRawSync(data);
    else throw Error('UNSUPPORTED_APK_COMPRESSION');
    cursor += 46 + zip.readUInt16LE(cursor + 28) + zip.readUInt16LE(cursor + 30) + zip.readUInt16LE(cursor + 32);
  }
}

const file = process.argv[2] || 'apps/rider-android/app/build/outputs/apk/release/app-release.apk';
const publishable = leerSecreto('CONTROLLED PROD SUPABASE PUBLISHABLE KEY')?.secreto;
assert.ok(publishable, 'CP_PUBLISHABLE_KEY_REQUIRED');
const forbidden = ['CONTROLLED PROD SUPABASE SECRET KEY', 'CONTROLLED PROD DB PASSWORD', 'STAGING SUPABASE SECRET KEY',
  'RIDER PILOT SIGNING PASSWORD', 'RIDER PILOT KEYSTORE BACKUP', 'CP SUPABASE ACCESS TOKEN', 'CP QA OWNER', 'CP QA STAFF',
  'CP QA RIDER 1', 'CP QA RIDER 2', 'CP QA RIDER 3', 'CP QA B OWNER', 'CP QA B STAFF']
  .map((name) => leerSecreto(name)?.secreto).filter(Boolean);
assert.ok(forbidden.length >= 8, 'SCAN_INPUTS_MISSING');
const bytes = readFileSync(file);
let publicKeyPresent = false; let leaks = 0; let patterns = 0;
for (const value of entries(bytes)) {
  publicKeyPresent ||= value.includes(Buffer.from(publishable));
  leaks += forbidden.filter((secret) => value.includes(Buffer.from(secret))).length;
  if (/sb_secret_[A-Za-z0-9_-]{20,}|sbp_[A-Za-z0-9]{20,}|-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/.test(value.toString('latin1'))) patterns += 1;
}
const report = { file, sha256: createHash('sha256').update(bytes).digest('hex'), publicKeyPresent,
  forbiddenValuesChecked: forbidden.length, leaks, privatePatterns: patterns,
  secretScan: publicKeyPresent && leaks === 0 && patterns === 0 ? 'PASS' : 'FAIL' };
console.log(JSON.stringify(report));
if (report.secretScan !== 'PASS') process.exitCode = 1;
