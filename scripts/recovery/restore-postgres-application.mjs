// Scope: application + Auth/Storage data. Does not certify managed platform DR.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { withRecoveryProject } from './hosted-client.mjs';
import { backupKey, decryptBackup, postgresEnvironment, nativeCommand } from './postgres-backup.mjs';

export const RESTORE_SCHEMAS = ['public','private','catalog_admin','supabase_migrations','auth','storage'];
export function assertRestoreDatabase(name) {
  if (!/^taba_restore_\d{8}_[a-f0-9]{8}$/.test(name)) throw new Error('Isolated restore database required');
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
export function readArchive(target,manifestFile) {
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  const cipher=fs.readFileSync(path.join(path.dirname(manifestFile),'database.pgdump.aesgcm'));
  if(manifest.projectRef!==target.projectRef||createHash('sha256').update(cipher).digest('hex')!==manifest.encryptedSha256)throw Error('Backup receipt mismatch');
  const {plaintext}=decryptBackup(cipher,backupKey(target),target.projectRef);
  if(createHash('sha256').update(plaintext).digest('hex')!==manifest.plaintextSha256)throw Error('Archive hash mismatch');
  return plaintext;
}
export async function restoreApplication({target,manifestFile,tools,ca,out}) {
  if(process.platform==='win32'&&!/^D:[\\/]/i.test(path.resolve(out)))throw Error('Use D:');
  if(fs.existsSync(out))throw Error('New evidence directory required');
  return withRecoveryProject(target,async()=>{
    const archive=readArchive(target,manifestFile);
    const database='taba_restore_'+new Date().toISOString().slice(0,10).replaceAll('-','')+'_'+randomBytes(4).toString('hex');
    assertRestoreDatabase(database);
    const sourceEnv=postgresEnvironment(target,ca),env=postgresEnvironment(target,ca,database);
    const psql=(environment,sql)=>nativeCommand(tools,'psql',['-X','-w','--set','ON_ERROR_STOP=1','--command',sql],{env:environment});
    fs.mkdirSync(out);
    const receipt={projectRef:target.projectRef,database,purpose:'isolated_restore_test',createdAt:new Date().toISOString(),
      fullManagedPlatformRestorePassed:false,productionModified:false};
    const save=()=>fs.writeFileSync(path.join(out,'restore-result.json'),JSON.stringify(receipt,null,2)+'\n');
    save();
    try {
      psql(sourceEnv,`CREATE DATABASE "${database}" WITH TEMPLATE template0 CONNECTION LIMIT 3;`);
      receipt.databaseCreatedByThisRun=true;save();
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
      save();return receipt;
    }catch(error){receipt.error=error.message;save();throw error;}
    finally{archive.fill(0);}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
  const value=name=>process.argv[process.argv.indexOf(name)+1];
  if(!['--restore-application','--target','--manifest','--tools','--ca','--out'].every(n=>process.argv.includes(n)))throw Error('Explicit isolated restore arguments required');
  console.log(JSON.stringify(await restoreApplication({target:JSON.parse(fs.readFileSync(value('--target'),'utf8')),manifestFile:value('--manifest'),tools:value('--tools'),ca:value('--ca'),out:path.resolve(value('--out'))})));
}
