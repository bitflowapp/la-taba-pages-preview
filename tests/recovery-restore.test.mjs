import assert from 'node:assert/strict';
import test from 'node:test';
import { assertRestoreDatabase, selectApplicationAcl, assertArchiveReceipt, encodeArchiveBaseline, decodeArchiveBaseline, restoreMarker } from '../scripts/recovery/restore-postgres-application.mjs';
import { createHash } from 'node:crypto';
import { compareFingerprints, compareRestoreEvidence, FINGERPRINT_SQL } from '../scripts/recovery/verify-postgres-restore.mjs';

test('restore never accepts the source database or unrelated project names',()=>{
  assertRestoreDatabase('taba_restore_20261021_f3ffc75e');
  for(const name of ['postgres','template1','bitflow-production','estela-pilot','taba_restore_20261022_ad3d29a2','taba_restore_20261021_bad;drop database postgres']){
    assert.throws(()=>assertRestoreDatabase(name));
  }
});

const target={projectRef:'ixewllzzuzpqrkxzmfzx',environment:'test',commercialPaymentsEnabled:false};
const receipt=()=>({receiptVersion:2,restoreId:'d3815e9f-c7c7-4c44-8d63-622a0b5f25ae',
  projectRef:target.projectRef,database:'taba_restore_20261022_1234abcd',purpose:'isolated_restore_test',
  productionModified:false,databaseCreatedByThisRun:true,applicationObjectsRestored:true,
  'pre-data':'passed',data:'passed','post-data':'passed',
  sourceArchive:{encryptedSha256:'a'.repeat(64),plaintextSha256:'b'.repeat(64),capturedAt:'2026-10-22T00:00:00Z'}});
test('restore baseline is bound to the exact run and archive, and tampering or another receipt is rejected',()=>{
  const r=receipt(),baseline=proof('c'.repeat(64));
  const bytes=encodeArchiveBaseline(target,r,baseline);
  r.archiveFingerprintsSha256=createHash('sha256').update(bytes).digest('hex');
  assert.deepEqual(decodeArchiveBaseline(target,r,bytes),baseline);
  assert.ok(restoreMarker(r).includes(r.sourceArchive.encryptedSha256));
  assert.throws(()=>decodeArchiveBaseline(target,r,Buffer.concat([bytes,Buffer.from('changed')])),/hash mismatch/);
  assert.throws(()=>decodeArchiveBaseline(target,{...r,restoreId:'d3815e9f-c7c7-4c44-8d63-622a0b5f25af'},bytes),/identity mismatch/);
  assert.throws(()=>decodeArchiveBaseline(target,{...r,sourceArchive:{...r.sourceArchive,encryptedSha256:'d'.repeat(64)}},bytes),/identity mismatch/);
});
test('legacy, failed, incomplete and cross-project restore receipts cannot establish archive verification',()=>{
  for(const change of [{receiptVersion:undefined},{applicationObjectsRestored:false},{databaseCreatedByThisRun:false},
    {data:'failed'},{error:'restore failed'},{sourceArchive:undefined},{projectRef:'abcdefghijklmnopqrst'}])
    assert.throws(()=>assertArchiveReceipt(target,{...receipt(),...change}));
  assert.throws(()=>assertArchiveReceipt({...target,environment:'production'},receipt()));
  assert.throws(()=>encodeArchiveBaseline(target,receipt(),{}),/Complete restore fingerprints/);
});

const proof=sha=>({tables:[{schema_name:'public',table_name:'orders',row_count:1,sha256:sha}],rls:[],policies:[],table_acl:[],functions:[],publication:[]});
test('live data matching a changed restore cannot certify the original backup',()=>{
  const r=compareRestoreEvidence(proof('archive'),proof('changed'),proof('changed'));
  assert.equal(r.allApplicationChecksPassed,false);
});
test('a faithful archive restore remains valid when the live source has advanced',()=>{
  const r=compareRestoreEvidence(proof('archive'),proof('archive'),proof('new-live-data'));
  assert.equal(r.allApplicationChecksPassed,true);
  assert.equal(r.liveSourceMatchesRestored,false);
});
test('application ACL restore excludes defaults owned by managed roles',()=>{
  const lines=['1; 0 0 ACL public TABLE orders postgres',
    '2; 0 0 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES postgres',
    '3; 0 0 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES supabase_admin',
    '4; 0 0 ACL auth TABLE users supabase_auth_admin'];
  assert.deepEqual(selectApplicationAcl(lines.join('\n')),lines.slice(0,2));
});
test('restore verification checks data, RLS, policy definitions, effective ACLs, function definitions and publication',()=>{
  const source={tables:[{sha256:'fixture'}],rls:[],policies:[],table_acl:[],functions:[],publication:[]};
  assert.ok(Object.values(compareFingerprints(source,structuredClone(source))).every(Boolean));
  const altered=structuredClone(source);altered.tables[0].sha256='different';
  assert.equal(compareFingerprints(source,altered).tables,false);
  assert.ok(FINGERPRINT_SQL.includes('acldefault'));
  assert.ok(FINGERPRINT_SQL.includes('extensions.digest'));
});

test('missing or malformed fingerprint sections cannot pass restoration verification',()=>{
  assert.ok(Object.values(compareFingerprints({},{})).every(value=>value===false));
  const valid={tables:[{sha256:'x'}],rls:[],policies:[],table_acl:[],functions:[],publication:[]};
  const partial={...valid};delete partial.functions;
  assert.equal(compareFingerprints(partial,partial).functions,false);
  assert.equal(compareFingerprints({...valid,tables:[]},{...valid,tables:[]}).tables,false);
  assert.equal(compareFingerprints({...valid,policies:{}},{...valid,policies:{}}).policies,false);
});
