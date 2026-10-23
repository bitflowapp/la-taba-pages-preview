import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { encryptBackup } from '../scripts/recovery/postgres-backup.mjs';
import { evaluateFreshness, newestBackup } from '../scripts/recovery/backup-freshness.mjs';

const PROJECT='ixewllzzuzpqrkxzmfzx';
const roots=[];
test.after(()=>{for(const root of roots)fs.rmSync(root,{recursive:true,force:true});});
function folder(files, {ciphertext=true}={}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-bf-'));
  roots.push(root);
  for (const [name, sourceManifest] of Object.entries(files)) {
    let manifest=sourceManifest;
    fs.mkdirSync(path.join(root, name), { recursive: true });
    if(ciphertext) {
      const bytes=encryptBackup(Buffer.from('synthetic backup only'),Buffer.alloc(32,7),{projectRef:manifest.projectRef || PROJECT});
      const digest=createHash('sha256').update(bytes).digest('hex');
      manifest={...manifest,encryptedSha256:digest,rolesBackup:{encryptedSha256:digest}};
      for(const file of ['database.pgdump.aesgcm','roles.sql.aesgcm']) fs.writeFileSync(path.join(root,name,file),bytes);
    }
    fs.writeFileSync(path.join(root, name, 'manifest.json'), JSON.stringify(manifest));
  }
  return root;
}
const verified = (capturedAt, extra = {}) => ({ projectRef:PROJECT,capturedAt,encryptedSha256:'a'.repeat(64),encryptionRoundtripVerified:true,...extra });

test('the newest verified manifest wins and a fresh one passes', () => {
  const root = folder({ old: verified('2026-10-01T00:00:00Z'), fresh: verified('2026-10-22T00:00:00Z') });
  const newest = newestBackup(root);
  assert.equal(path.basename(path.dirname(newest.file)), 'fresh');
  assert.equal(evaluateFreshness(newest, { maxHours: 26, now: Date.parse('2026-10-22T10:00:00Z') }).ok, true);
});

test('an old backup, no backup, an unverified manifest and a missing restore test all fail loudly', () => {
  const root = folder({ stale: verified('2026-10-01T00:00:00Z'), unverified: { capturedAt: '2026-10-22T00:00:00Z' } });
  const newest = newestBackup(root);
  assert.match(evaluateFreshness(newest, { maxHours: 26, now: Date.parse('2026-10-22T10:00:00Z') }).reason, /old/);
  assert.equal(evaluateFreshness(null, { maxHours: 26 }).ok, false);
  const fresh = newestBackup(folder({ one: verified('2026-10-22T00:00:00Z') }));
  assert.match(evaluateFreshness(fresh, { maxHours: 26, requireRestoreTest: true, now: Date.parse('2026-10-22T01:00:00Z') }).reason, /restore-tested/);
});

test('a manifest without its ciphertext cannot certify a usable fresh backup',()=>{
  const root=folder({missing:verified('2026-10-22T00:00:00Z')},{ciphertext:false});
  try {
    assert.equal(evaluateFreshness(newestBackup(root),{maxHours:26,now:Date.parse('2026-10-22T01:00:00Z')}).ok,false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('a corrupted latest copy raises an alert instead of hiding behind an older intact copy',()=>{
  const root=folder({old:verified('2026-10-21T00:00:00Z'),latest:verified('2026-10-22T00:00:00Z')});
  fs.appendFileSync(path.join(root,'latest','database.pgdump.aesgcm'),'corrupt');
  const candidate=newestBackup(root);
  assert.equal(path.basename(path.dirname(candidate.file)),'latest');
  assert.equal(candidate.integrityVerified,false);
  assert.equal(evaluateFreshness(candidate,{maxHours:48,now:Date.parse('2026-10-22T01:00:00Z')}).ok,false);
});

test('the latest backup of another project cannot hide a missing or stale project backup',()=>{
  const root=folder({qa:verified('2026-10-01T00:00:00Z'),other:verified('2026-10-22T00:00:00Z',{projectRef:'abcdefghijklmnopqrst'})});
  const candidate=newestBackup(root,{projectRef:PROJECT});
  assert.equal(candidate.projectRef,PROJECT);
  assert.equal(evaluateFreshness(candidate,{maxHours:26,now:Date.parse('2026-10-22T01:00:00Z')}).ok,false);
  assert.equal(newestBackup(root,{projectRef:'zzzzzzzzzzzzzzzzzzzz'}),null);
  assert.throws(()=>newestBackup(root,{projectRef:'wrong'}),/Invalid backup project/);
});

test('loss of the roles ciphertext also fails backup integrity',()=>{
  const root=folder({latest:verified('2026-10-22T00:00:00Z')});
  fs.unlinkSync(path.join(root,'latest','roles.sql.aesgcm'));
  assert.equal(newestBackup(root).integrityVerified,false);
});

test('a mismatched project inside the ciphertext envelope is rejected even with a matching file hash',()=>{
  const root=folder({latest:verified('2026-10-22T00:00:00Z')});
  const dir=path.join(root,'latest'),file=path.join(dir,'roles.sql.aesgcm');
  const wrong=encryptBackup(Buffer.from('synthetic roles'),Buffer.alloc(32,7),{projectRef:'abcdefghijklmnopqrst'});
  fs.writeFileSync(file,wrong);
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  manifest.rolesBackup.encryptedSha256=createHash('sha256').update(wrong).digest('hex');
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest));
  assert.equal(newestBackup(root,{projectRef:PROJECT}).integrityVerified,false);
});

test('future dates and invalid freshness limits cannot suppress a backup alert',()=>{
  const candidate={capturedAt:Date.parse('2027-10-22T00:00:00Z'),restoreTestCompleted:true,integrityVerified:true};
  const now=Date.parse('2026-10-22T00:00:00Z');
  assert.equal(evaluateFreshness(candidate,{maxHours:26,now}).ok,false);
  for(const maxHours of [NaN,Infinity,0,-1])
    assert.equal(evaluateFreshness({...candidate,capturedAt:now},{maxHours,now}).ok,false);
});
