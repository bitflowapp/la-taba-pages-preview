import { spawnSync } from 'node:child_process';
import { existsSync,readFileSync } from 'node:fs';
import path from 'node:path';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
const dir=path.join(process.env.USERPROFILE||'','.codex','secrets','la-taba-rider-pilot');
const keystore=path.join(dir,'pilot-v1.p12');
const password=leerSecreto('RIDER PILOT SIGNING PASSWORD')?.secreto;
const backup=leerSecreto('RIDER PILOT KEYSTORE BACKUP')?.secreto;
const key=leerSecreto('STAGING SUPABASE PUBLISHABLE KEY');
const versionCodeFlag=process.argv.indexOf('--version-code');
const versionCode=versionCodeFlag<0?1:Number(process.argv[versionCodeFlag+1]);
if(!Number.isInteger(versionCode)||versionCode<1||versionCode>99999)
 throw Error('INVALID_PILOT_VERSION_CODE');
const versionNameFlag=process.argv.indexOf('--version-name');
const versionName=versionNameFlag<0?'0.1.0-canonical':process.argv[versionNameFlag+1];
if(!/^[0-9]+\.[0-9]+\.[0-9]+-canonical$/.test(versionName))
 throw Error('INVALID_PILOT_VERSION_NAME');
if(!existsSync(keystore)||!password||!backup||!readFileSync(keystore).equals(Buffer.from(backup,'base64')))
 throw Error('PILOT_SIGNING_MATERIAL_OR_BACKUP_MISSING');
if(key?.usuario!=='ucbtjcurawxjwjdvvcvj'||!key.secreto.startsWith('sb_publishable_'))
 throw Error('STAGING_PUBLIC_KEY_REQUIRED');
const project=path.resolve('apps/rider-android');
const built=spawnSync('cmd.exe',['/d','/c','gradlew.bat',':app:assembleRelease',`-PriderPilotVersionCode=${versionCode}`,`-PriderPilotVersionName=${versionName}`,'--console=plain'],{
 cwd:project,stdio:'inherit',windowsHide:true,env:{...process.env,
  ANDROID_HOME:path.join(process.env.LOCALAPPDATA,'Android','Sdk'),
  RIDER_STAGING_PUBLIC_KEY:key.secreto,RIDER_PILOT_KEYSTORE_PATH:keystore,
  RIDER_PILOT_SIGNING_PASS:password}});
if(built.status!==0)throw Error('PILOT_BUILD_FAILED');
const apk=path.join(project,'app','build','outputs','apk','release','app-release.apk');
if(!existsSync(apk))throw Error('SIGNED_PILOT_APK_MISSING');
const toolsDir=path.join(process.env.LOCALAPPDATA,'Android','Sdk','build-tools','36.0.0');
const verify=spawnSync('cmd.exe',['/d','/c',path.join(toolsDir,'apksigner.bat'),'verify','--print-certs',apk],{
 encoding:'utf8',windowsHide:true});
if(verify.status!==0)throw Error(`PILOT_APK_SIGNATURE_INVALID:${verify.error?.code||verify.status}`);
const signer=verify.stdout.match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9]{64})/i)?.[1];
if(!signer)throw Error('PILOT_CERTIFICATE_DIGEST_MISSING');
const aapt=spawnSync(path.join(toolsDir,'aapt.exe'),['dump','badging',apk],{encoding:'utf8',windowsHide:true});
const packageId=aapt.stdout.match(/package: name='([^']+)'/)?.[1];
const actualVersionCode=Number(aapt.stdout.match(/versionCode='(\d+)'/)?.[1]);
const actualVersionName=aapt.stdout.match(/versionName='([^']+)'/)?.[1];
if(aapt.status!==0||packageId!=='com.lataba.rider.pilot'||actualVersionCode!==versionCode||actualVersionName!==`${versionName}-pilot`)
 throw Error('PILOT_PACKAGE_IDENTITY_MISMATCH');
console.log(JSON.stringify({signed:true,packageId,versionCode,versionName:actualVersionName,certificateSha256:signer,
 backend:'ucbtjcurawxjwjdvvcvj',historicalV146Unaffected:true}));
