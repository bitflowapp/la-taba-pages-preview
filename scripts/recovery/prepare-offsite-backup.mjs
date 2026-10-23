// Offline packaging only. Copies authenticated ciphertext, never dumps, keys,
// credential-store exports or service configuration. Does not upload or bill.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MAGIC } from './postgres-backup.mjs';
import { assertPrivateOutputDirectory } from './private-output.mjs';
const ROOT=path.resolve(import.meta.dirname,'../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const FILES=['database.pgdump.aesgcm','roles.sql.aesgcm'];
function outsideRepo(p) {
  const relative=path.relative(fs.realpathSync(ROOT),p);
  if(!relative.startsWith('..')&&!path.isAbsolute(relative)) throw Error('Backup package must stay outside the repository');
}
export function verifyOffsitePackage(dir) {
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'offsite-manifest.json'),'utf8'));
  if(manifest.version!==1||manifest.projectRef!=='ixewllzzuzpqrkxzmfzx'||manifest.keyIncluded!==false||
    JSON.stringify(manifest.files?.map(f=>f.name))!==JSON.stringify(FILES)) throw Error('Invalid offsite package manifest');
  if(JSON.stringify(fs.readdirSync(dir).sort())!==JSON.stringify([...FILES,'offsite-manifest.json'].sort())) throw Error('Unexpected file in ciphertext-only package');
  for(const entry of manifest.files) {
    const file=path.join(dir,entry.name);
    if(!fs.lstatSync(file).isFile()) throw Error('Ciphertext must be a regular file');
    const bytes=fs.readFileSync(file);
    if(!bytes.subarray(0,MAGIC.length).equals(MAGIC)||hash(bytes)!==entry.sha256||bytes.length!==entry.bytes) throw Error('Ciphertext integrity mismatch');
  }
  return {verified:true,projectRef:manifest.projectRef,files:manifest.files.length,keyIncluded:false,
    remoteBackupCreated:false,restoreTestCompleted:manifest.restoreTestCompleted};
}
export function prepareOffsiteBackup(snapshot,out) {
  assertPrivateOutputDirectory(out);
  snapshot=fs.realpathSync(snapshot);outsideRepo(snapshot);
  out=path.resolve(out);outsideRepo(path.join(fs.realpathSync(path.dirname(out)),path.basename(out)));
  if(fs.existsSync(out)) throw Error('New output directory required');
  const source=JSON.parse(fs.readFileSync(path.join(snapshot,'manifest.json'),'utf8'));
  if(source.projectRef!=='ixewllzzuzpqrkxzmfzx'||source.encryptionRoundtripVerified!==true) throw Error('Verified QA snapshot required');
  const payloads=FILES.map((name,i)=>{
    const file=path.join(snapshot,name);
    if(!fs.lstatSync(file).isFile()) throw Error('Ciphertext must be a regular file');
    const bytes=fs.readFileSync(file),expected=i===0?source.encryptedSha256:source.rolesBackup?.encryptedSha256;
    if(!bytes.subarray(0,MAGIC.length).equals(MAGIC)||hash(bytes)!==expected) throw Error('Source ciphertext integrity mismatch');
    return {name,bytes,sha256:expected};
  });
  fs.mkdirSync(out,{mode:0o700});
  for(const item of payloads) fs.writeFileSync(path.join(out,item.name),item.bytes,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(out,'offsite-manifest.json'),JSON.stringify({version:1,projectRef:source.projectRef,
    capturedAt:source.capturedAt,preparedAt:new Date().toISOString(),keyIncluded:false,
    encryptionRoundtripVerified:true,restoreTestCompleted:source.restoreTestCompleted===true,remoteBackupCreated:false,
    files:payloads.map(p=>({name:p.name,sha256:p.sha256,bytes:p.bytes.length})),
    recoveryStillRequired:['separate encryption key custody','Storage object bytes','Vault/Edge encryption keys and secrets',
      'Auth/OAuth/SMTP configuration and signing keys','cron/net/Realtimes managed runtime','Cloudflare secrets, DNS and deployment configuration']},null,2)+'\n',{flag:'wx',mode:0o600});
  return verifyOffsitePackage(out);
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)) {
  const value=name=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error(`${name} required`);return process.argv[i+1];};
  console.log(JSON.stringify(process.argv.includes('--verify')?verifyOffsitePackage(value('--out')):
    prepareOffsiteBackup(value('--snapshot'),value('--out'))));
}
