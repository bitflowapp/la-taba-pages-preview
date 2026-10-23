// Real pg_dump/pg_restore on two disposable loopback databases, synthetic data
// only. No hosted request, managed service, credential store or restore_* DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { BIN, HOST, PORT, psqlRaw } from '../../scripts/local-db/lib.mjs';
import { nativeCommand, encryptBackup } from '../../scripts/recovery/postgres-backup.mjs';
import { fingerprint } from '../../scripts/recovery/restore-fingerprints.mjs';
import { encodeArchiveBaseline, decodeArchiveBaseline } from '../../scripts/recovery/restore-postgres-application.mjs';
import { compareRestoreEvidence } from '../../scripts/recovery/verify-postgres-restore.mjs';
import { drillRun, fixtureSql } from '../../scripts/recovery/qa-drill-fixture.mjs';

test('native archive replay preserves its proof when live data advances and rejects later restore modification',()=>{
  const source=`taba_local_archive_src_${process.pid}`,destination=`taba_local_archive_dst_${process.pid}`;
  const template=process.env.TABA_LOCAL_DB || 'taba_local_base';
  if(!/^taba_local_[a-z0-9_]+$/.test(template)) throw Error('Disposable local template required');
  const environment=db=>({...process.env,PGHOST:HOST,PGPORT:String(PORT),PGUSER:'postgres',PGDATABASE:db,
    PGPASSWORD:'',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'});
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  let archive,replacementArchive;
  try {
    psqlRaw('postgres',`create database ${source} template ${template}; create database ${destination};`);
    const run=drillRun('recovery');psqlRaw(source,fixtureSql(run));
    const original=fingerprint(BIN,environment(source));
    archive=nativeCommand(BIN,'pg_dump',['--no-password','--format=custom','--no-owner'],{env:environment(source)});
    assert.equal(archive.subarray(0,5).toString(),'PGDMP');
    nativeCommand(BIN,'pg_restore',['--no-password','--no-owner','--exit-on-error','--single-transaction','--dbname',destination],
      {env:environment(destination),input:archive});
    const restored=fingerprint(BIN,environment(destination));
    assert.deepEqual(restored,original,'native replay retains every table, policy, ACL, function and publication');
    const target={projectRef:'ixewllzzuzpqrkxzmfzx',environment:'test',commercialPaymentsEnabled:false};
    const capturedAt=new Date().toISOString();
    const ciphertext=encryptBackup(archive,Buffer.alloc(32,7),{projectRef:target.projectRef,capturedAt});
    const receipt={receiptVersion:2,restoreId:randomUUID(),projectRef:target.projectRef,
      // Synthetic receipt identity only; every actual database uses taba_local_*.
      database:'taba_restore_20261022_1234abcd',purpose:'isolated_restore_test',productionModified:false,
      databaseCreatedByThisRun:true,applicationObjectsRestored:true,'pre-data':'passed',data:'passed','post-data':'passed',
      sourceArchive:{encryptedSha256:sha(ciphertext),plaintextSha256:sha(archive),capturedAt}};
    const bytes=encodeArchiveBaseline(target,receipt,restored);receipt.archiveFingerprintsSha256=sha(bytes);
    const baseline=decodeArchiveBaseline(target,receipt,bytes);
    psqlRaw(source,`update public.products set stock=stock+1 where id='${run.ids.product}';`);
    const live=fingerprint(BIN,environment(source));
    let result=compareRestoreEvidence(baseline,fingerprint(BIN,environment(destination)),live);
    assert.equal(result.allApplicationChecksPassed,true,'backup still restored faithfully');
    assert.equal(result.liveSourceMatchesRestored,false,'newer live facts remain a separate comparison');
    // Replacing the tested restore with a newer dump makes every row (including
    // trigger timestamps) match live. It still must not certify the old archive.
    replacementArchive=nativeCommand(BIN,'pg_dump',['--no-password','--format=custom','--no-owner'],{env:environment(source)});
    psqlRaw('postgres',`drop database ${destination}; create database ${destination};`);
    nativeCommand(BIN,'pg_restore',['--no-password','--no-owner','--exit-on-error','--single-transaction','--dbname',destination],
      {env:environment(destination),input:replacementArchive});
    result=compareRestoreEvidence(baseline,fingerprint(BIN,environment(destination)),live);
    assert.equal(result.liveSourceMatchesRestored,true,'both databases now contain the same newer data');
    assert.equal(result.allApplicationChecksPassed,false,'matching live data cannot certify the original archive');
  } finally {
    archive?.fill(0);
    replacementArchive?.fill(0);
    for(const database of [source,destination]) psqlRaw('postgres',`drop database if exists ${database} with (force);`);
  }
});
