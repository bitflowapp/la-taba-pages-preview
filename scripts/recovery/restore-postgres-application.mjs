// Scope: application + Auth/Storage data. Does not certify managed platform DR.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { withRecoveryProject } from './hosted-client.mjs';
import { backupKey, decryptBackup, postgresEnvironment, nativeCommand } from './postgres-backup.mjs';
import { fingerprint, compareFingerprints } from './restore-fingerprints.mjs';
import { assertPrivateOutputDirectory } from './private-output.mjs';

export const RESTORE_SCHEMAS = ['public','private','catalog_admin','supabase_migrations','auth','storage'];
export function assertRestoreDatabase(name) {
  if (!/^taba_restore_\d{8}_[a-f0-9]{8}$/.test(name)) throw new Error('Isolated restore database required');
  if(name==='taba_restore_20261022_ad3d29a2') throw Error('Preserved restore database is excluded from automated recovery tools');
}
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=value=>/^[a-f0-9]{64}$/.test(value || '');
export function restoreMarker(receipt) {
  assertRestoreDatabase(receipt.database);
  if(receipt.projectRef!=='ixewllzzuzpqrkxzmfzx'||!hash(receipt.sourceArchive?.encryptedSha256)||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(receipt.restoreId || '')) throw Error('Restore identity missing');
  return `la-taba-restore:${receipt.restoreId}:${receipt.sourceArchive.encryptedSha256}`;
}
export function assertArchiveReceipt(target,receipt) {
  restoreMarker(receipt);
  if(target.projectRef!==receipt.projectRef||target.environment!=='test'||target.commercialPaymentsEnabled!==false||
    receipt.receiptVersion!==2||receipt.purpose!=='isolated_restore_test'||receipt.databaseCreatedByThisRun!==true||
    receipt.applicationObjectsRestored!==true||receipt.productionModified!==false||receipt.error!==undefined||
    !hash(receipt.sourceArchive.plaintextSha256)||!Number.isFinite(Date.parse(receipt.sourceArchive.capturedAt))||
    !['pre-data','data','post-data'].every(section=>receipt[section]==='passed'))
    throw Error('Archive-bound completed restore receipt required; legacy receipts need a new isolated restore');
}
export function encodeArchiveBaseline(target,receipt,fingerprints) {
  assertArchiveReceipt(target,receipt);
  if(!Object.values(compareFingerprints(fingerprints,fingerprints)).every(Boolean)) throw Error('Complete restore fingerprints required');
  return Buffer.from(JSON.stringify({receiptVersion:2,projectRef:receipt.projectRef,restoreId:receipt.restoreId,
    sourceArchive:receipt.sourceArchive,fingerprints},null,2)+'\n');
}
export function decodeArchiveBaseline(target,receipt,bytes) {
  assertArchiveReceipt(target,receipt);
  if(!hash(receipt.archiveFingerprintsSha256)||sha256(bytes)!==receipt.archiveFingerprintsSha256) throw Error('Archive fingerprint file hash mismatch');
  const baseline=JSON.parse(bytes.toString('utf8'));
  if(baseline.receiptVersion!==2||baseline.projectRef!==receipt.projectRef||baseline.restoreId!==receipt.restoreId||
    JSON.stringify(baseline.sourceArchive)!==JSON.stringify(receipt.sourceArchive)||
    !Object.values(compareFingerprints(baseline.fingerprints,baseline.fingerprints)).every(Boolean))
    throw Error('Archive fingerprint identity mismatch');
  return baseline.fingerprints;
}
export function selectApplicationAcl(toc) {
  return toc.split(/\r?\n/).filter(line =>
    / (?:DEFAULT )?ACL (public|private|catalog_admin|supabase_migrations) | ACL - SCHEMA (public|private|catalog_admin|supabase_migrations) /.test(line)
    && !(line.includes('DEFAULT ACL') && !line.endsWith(' postgres')));
}
export function executeDdlBatch(tools, env, source) {
  // pg_restore emits these psql-only archive security delimiters, not SQL.
  const sql = source.split('\n').filter(line => !/^\\(?:un)?restrict\b/.test(line)).join('\n');
  const outer='outer_'+randomBytes(12).toString('hex'), inner='inner_'+randomBytes(12).toString('hex');
  if(sql.includes(`$${outer}$`)||sql.includes(`$${inner}$`))throw Error('Delimiter conflict');
  return nativeCommand(tools,'psql',['-X','-w','--set','ON_ERROR_STOP=1','--single-transaction','--file','-'],
    {env,input:`DO $${outer}$ BEGIN EXECUTE $${inner}$${sql}$${inner}$; END $${outer}$;`,encoding:'utf8',timeout:300000});
}
export function restoreApplicationAcl({tools,env,archive,out}) {
  const toc=nativeCommand(tools,'pg_restore',['--list'],{input:archive,encoding:'utf8'});
  const selected=selectApplicationAcl(toc), list=path.join(out,'application-acl.toc');
  fs.writeFileSync(list,selected.join('\n')+'\n');
  executeDdlBatch(tools,env,nativeCommand(tools,'pg_restore',['--no-owner','--schema-only','--use-list',list,'--file=-'],{input:archive,encoding:'utf8'}));
  return {applicationAclRestored:true,aclEntries:selected.length,managedRoleDefaultPrivilegesRestored:false};
}
export function readArchiveWithIdentity(target,manifestFile) {
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  const cipher=fs.readFileSync(path.join(path.dirname(manifestFile),'database.pgdump.aesgcm'));
  if(manifest.projectRef!==target.projectRef||sha256(cipher)!==manifest.encryptedSha256)throw Error('Backup receipt mismatch');
  const key=backupKey(target);
  try {
    const {plaintext,metadata}=decryptBackup(cipher,key,target.projectRef);
    if(sha256(plaintext)!==manifest.plaintextSha256||!Number.isFinite(Date.parse(metadata.capturedAt))||
      plaintext.subarray(0,5).toString()!=='PGDMP') {
      plaintext.fill(0);throw Error('Archive hash, capture time or format mismatch');
    }
    return {plaintext,sourceArchive:{encryptedSha256:sha256(cipher),plaintextSha256:sha256(plaintext),capturedAt:metadata.capturedAt}};
  } finally {key.fill(0);}
}
export function readArchive(target,manifestFile) { return readArchiveWithIdentity(target,manifestFile).plaintext; }
export async function restoreApplication({target,manifestFile,tools,ca,out}) {
  assertPrivateOutputDirectory(out);
  if(process.platform==='win32'&&!/^D:[\\/]/i.test(path.resolve(out)))throw Error('Use D:');
  if(fs.existsSync(out))throw Error('New evidence directory required');
  return withRecoveryProject(target,async()=>{
    const {plaintext:archive,sourceArchive}=readArchiveWithIdentity(target,manifestFile);
    try {
    const database='taba_restore_'+new Date().toISOString().slice(0,10).replaceAll('-','')+'_'+randomBytes(4).toString('hex');
    assertRestoreDatabase(database);
    const sourceEnv=postgresEnvironment(target,ca),env=postgresEnvironment(target,ca,database);
    const psql=(environment,sql)=>nativeCommand(tools,'psql',['-X','-w','--set','ON_ERROR_STOP=1','--command',sql],{env:environment});
    fs.mkdirSync(out,{mode:0o700});
    const receipt={receiptVersion:2,restoreId:randomUUID(),sourceArchive,
      projectRef:target.projectRef,database,purpose:'isolated_restore_test',createdAt:new Date().toISOString(),
      fullManagedPlatformRestorePassed:false,productionModified:false};
    const save=()=>fs.writeFileSync(path.join(out,'restore-result.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
    save();
    try {
      psql(sourceEnv,`CREATE DATABASE "${database}" WITH TEMPLATE template0 CONNECTION LIMIT 3;`);
      receipt.databaseCreatedByThisRun=true;save();
      psql(sourceEnv,`COMMENT ON DATABASE "${database}" IS '${restoreMarker(receipt)}';`);
      psql(env,`revoke all on database "${database}" from public;
        ${[...RESTORE_SCHEMAS.filter(s=>s!=='public'),'extensions','vault'].map(s=>`create schema if not exists "${s}";`).join('\n')}
        create extension if not exists pgcrypto with schema extensions;
        create extension if not exists "uuid-ossp" with schema extensions;
        create extension if not exists supabase_vault with schema vault;
        create publication supabase_realtime;`);
      const args=['--no-owner','--no-privileges',...RESTORE_SCHEMAS.map(s=>'--schema='+s)];
      for(const section of ['pre-data','data','post-data']) {
        if(section==='data')nativeCommand(tools,'pg_restore',[...args,'--no-password','--exit-on-error','--single-transaction','--section=data','--dbname',database],{env,input:archive,timeout:300000});
        else executeDdlBatch(tools,env,nativeCommand(tools,'pg_restore',[...args,'--section='+section,'--file=-'],{input:archive,encoding:'utf8'}));
        receipt[section]='passed';save();
      }
      Object.assign(receipt,restoreApplicationAcl({tools,env,archive,out}),{applicationObjectsRestored:true,
        schemas:RESTORE_SCHEMAS,authStorageManagedOwnershipRestored:false,
        excludedManagedServices:['cron','realtime runtime','net','graphql','pgbouncer'],dataIntegrityVerified:false});
      const baseline=encodeArchiveBaseline(target,receipt,fingerprint(tools,env));
      fs.writeFileSync(path.join(out,'restored-archive-fingerprints.json'),baseline,{flag:'wx',mode:0o600});
      receipt.archiveFingerprintsSha256=sha256(baseline);
      save();return receipt;
    }catch(error){receipt.error=error.message;save();throw error;}
    } finally {archive.fill(0);}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
  const value=name=>process.argv[process.argv.indexOf(name)+1];
  if(!['--restore-application','--target','--manifest','--tools','--ca','--out'].every(n=>process.argv.includes(n)))throw Error('Explicit isolated restore arguments required');
  console.log(JSON.stringify(await restoreApplication({target:JSON.parse(fs.readFileSync(value('--target'),'utf8')),manifestFile:value('--manifest'),tools:value('--tools'),ca:value('--ca'),out:path.resolve(value('--out'))})));
}
