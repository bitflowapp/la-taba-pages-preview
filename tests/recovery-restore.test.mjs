import assert from 'node:assert/strict';
import test from 'node:test';
import { assertRestoreDatabase, selectApplicationAcl } from '../scripts/recovery/restore-postgres-application.mjs';
import { compareFingerprints, FINGERPRINT_SQL } from '../scripts/recovery/verify-postgres-restore.mjs';

test('restore never accepts the source database or unrelated project names',()=>{
  assertRestoreDatabase('taba_restore_20261021_f3ffc75e');
  for(const name of ['postgres','template1','bitflow-production','estela-pilot','taba_restore_20261021_bad;drop database postgres']){
    assert.throws(()=>assertRestoreDatabase(name));
  }
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
