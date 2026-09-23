import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardarSecreto, generarContrasena, leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
const userProfile=path.resolve(process.env.USERPROFILE||'');
if(!process.env.USERPROFILE||!path.isAbsolute(userProfile))throw Error('HOST_PROFILE_REQUIRED');
const dir=path.join(userProfile,'.codex','secrets','la-taba-rider-pilot');
const target=path.join(dir,'pilot-v1.p12');
const repo=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
if(dir.toLowerCase().startsWith(repo.toLowerCase()+path.sep))throw Error('KEYSTORE_MUST_BE_OUTSIDE_REPO');
const passwordName='RIDER PILOT SIGNING PASSWORD',backupName='RIDER PILOT KEYSTORE BACKUP';
const keytool=path.join(process.env.JAVA_HOME||'C:/dev/tools/jdk-17','bin','keytool.exe');
if(!existsSync(keytool))throw Error('JDK17_KEYTOOL_REQUIRED');
const owner=`${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
const acl=(name)=>{
 const result=spawnSync('icacls.exe',[name,'/inheritance:r','/grant:r',`${owner}:F`],{encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw Error('KEYSTORE_ACL_FAILED');
};
mkdirSync(dir,{recursive:true});acl(dir);
let password=leerSecreto(passwordName)?.secreto;
if(!existsSync(target)){
 if(password||leerSecreto(backupName))throw Error('PARTIAL_SIGNING_STATE_REQUIRES_RECOVERY');
 password=generarContrasena(48);
 const args=['-genkeypair','-alias','lataba-pilot-v1','-keyalg','EC','-groupname','secp256r1',
  '-validity','3650','-dname','CN=La Taba Rider Piloto, OU=Pilot, O=La Taba, C=AR',
  '-keystore',target,'-storetype','PKCS12','-storepass:env','RIDER_PILOT_SIGNING_PASS',
  '-keypass:env','RIDER_PILOT_SIGNING_PASS','-noprompt'];
 const created=spawnSync(keytool,args,{encoding:'utf8',windowsHide:true,
  env:{...process.env,RIDER_PILOT_SIGNING_PASS:password}});
 if(created.status!==0)throw Error(`KEYTOOL_CREATE_FAILED:${created.status}`);
 acl(target);
 const encoded=readFileSync(target).toString('base64');
 if(encoded.length>4800)throw Error('KEYSTORE_TOO_LARGE_FOR_SECURE_BACKUP');
 guardarSecreto(passwordName,'pilot',password);
 guardarSecreto(backupName,'pilot',encoded);
}
if(!password)throw Error('PILOT_SIGNING_PASSWORD_MISSING');
const original=readFileSync(target),stored=leerSecreto(backupName)?.secreto;
if(!stored||!original.equals(Buffer.from(stored,'base64')))throw Error('PILOT_KEYSTORE_BACKUP_MISMATCH');
const listed=spawnSync(keytool,['-list','-v','-alias','lataba-pilot-v1','-keystore',target,
 '-storetype','PKCS12','-storepass:env','RIDER_PILOT_SIGNING_PASS'],{
 encoding:'utf8',windowsHide:true,env:{...process.env,RIDER_PILOT_SIGNING_PASS:password}});
if(listed.status!==0)throw Error('PILOT_CERT_READ_FAILED');
const fingerprint=listed.stdout.match(/SHA256:\s*([A-Fa-f0-9:]{95})/)?.[1];
if(!fingerprint)throw Error('PILOT_CERT_FINGERPRINT_MISSING');
console.log(JSON.stringify({keystoreOutsideRepo:true,aclRestricted:true,credentialManagerBackupMatches:true,
 certificateSha256:fingerprint,packageId:'com.lataba.rider.pilot',historicalV146SigningUnchanged:true}));
