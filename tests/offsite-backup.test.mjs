import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { encryptBackup } from '../scripts/recovery/postgres-backup.mjs';
import { prepareOffsiteBackup,verifyOffsitePackage } from '../scripts/recovery/prepare-offsite-backup.mjs';

test('offsite package copies only verified ciphertext, preserves honest restore status, and detects corruption',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'taba-offsite-')),snapshot=path.join(root,'snapshot'),out=path.join(root,'out');
  try {
    fs.mkdirSync(snapshot);
    const metadata={projectRef:'ixewllzzuzpqrkxzmfzx'},bytes=encryptBackup(Buffer.from('synthetic only'),Buffer.alloc(32,7),metadata);
    const sha=createHash('sha256').update(bytes).digest('hex');
    for(const file of ['database.pgdump.aesgcm','roles.sql.aesgcm']) fs.writeFileSync(path.join(snapshot,file),bytes);
    fs.writeFileSync(path.join(snapshot,'manifest.json'),JSON.stringify({...metadata,capturedAt:'2026-10-22T00:00:00Z',
      encryptionRoundtripVerified:true,encryptedSha256:sha,rolesBackup:{encryptedSha256:sha},restoreTestCompleted:false}));
    fs.writeFileSync(path.join(snapshot,'NEVER-EXPORT-plaintext.sql'),'synthetic forbidden plaintext');
    const result=prepareOffsiteBackup(snapshot,out);
    assert.equal(result.verified,true);assert.equal(result.keyIncluded,false);assert.equal(result.restoreTestCompleted,false);
    assert.equal(result.remoteBackupCreated,false);assert.equal(fs.readdirSync(out).length,3);
    assert.throws(()=>prepareOffsiteBackup(snapshot,out),/New output/);
    fs.appendFileSync(path.join(out,'database.pgdump.aesgcm'),'corrupt');
    assert.throws(()=>verifyOffsitePackage(out),/integrity mismatch/);
    fs.appendFileSync(path.join(snapshot,'roles.sql.aesgcm'),'corrupt');
    assert.throws(()=>prepareOffsiteBackup(snapshot,path.join(root,'bad')),/Source ciphertext integrity mismatch/);
    assert.equal(fs.existsSync(path.join(root,'bad')),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
