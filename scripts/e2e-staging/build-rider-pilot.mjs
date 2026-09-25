import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
const dir=path.join(process.env.USERPROFILE||'','.codex','secrets','la-taba-rider-pilot');
const keystore=path.join(dir,'pilot-v1.p12');
const targetFlag=process.argv.indexOf('--target');
const target=targetFlag<0?'':process.argv[targetFlag+1];
if(!['staging','pilot'].includes(target))throw Error('RIDER_TARGET_REQUIRED');
const refFlag=process.argv.indexOf('--project-ref');
const explicitRef=refFlag<0?'':process.argv[refFlag+1]||'';
if(target==='staging'&&explicitRef)throw Error('STAGING_REF_IS_FIXED');
const backendRef=target==='staging'?'ucbtjcurawxjwjdvvcvj':explicitRef;
if(!/^[a-z0-9]{20}$/.test(backendRef)||backendRef==='wwcpogltfgzgkrlilbcd'
  ||(target==='pilot'&&['ucbtjcurawxjwjdvvcvj','yakhtrkukqlgzvxuvhzs'].includes(backendRef)))
 throw Error('PILOT_BACKEND_REF_REQUIRED_AND_MUST_BE_ISOLATED');
const versionCodeFlag=process.argv.indexOf('--version-code');
const versionCode=versionCodeFlag<0?1:Number(process.argv[versionCodeFlag+1]);
if(!Number.isInteger(versionCode)||versionCode<1||versionCode>99999)
 throw Error('INVALID_PILOT_VERSION_CODE');
if(target==='pilot'&&versionCode<=3)throw Error('PILOT_VERSION_MUST_UPGRADE_STAGING_V3');
const versionNameFlag=process.argv.indexOf('--version-name');
const versionName=versionNameFlag<0?'0.1.0-canonical':process.argv[versionNameFlag+1];
if(!/^[0-9]+\.[0-9]+\.[0-9]+-canonical$/.test(versionName))
 throw Error('INVALID_PILOT_VERSION_NAME');
// Every signed build shares the package and certificate of the CONTROLLED_PRODUCTION
// Rider, so a signed build is an update candidate for riders in production:
// PILOT is pinned to the manifest's backend, and a signed Staging QA build must
// stay below every CP versionCode (Android refuses the downgrade).
const cpManifest=JSON.parse(readFileSync(path.resolve('deploy/controlled-production.json'),'utf8'));
if(target==='pilot'&&backendRef!==cpManifest.rider?.backendRef)
 throw Error('PILOT_REF_MUST_BE_CONTROLLED_PRODUCTION');
if(target==='staging'&&versionCode>3)
 throw Error('SIGNED_STAGING_MUST_STAY_BELOW_CONTROLLED_PRODUCTION');
const androidTest=process.argv.includes('--android-test');
const password=leerSecreto('RIDER PILOT SIGNING PASSWORD')?.secreto;
const backup=leerSecreto('RIDER PILOT KEYSTORE BACKUP')?.secreto;
const key=leerSecreto(target==='pilot'?'PILOT SUPABASE PUBLISHABLE KEY':'STAGING SUPABASE PUBLISHABLE KEY');
if(!existsSync(keystore)||!password||!backup||!readFileSync(keystore).equals(Buffer.from(backup,'base64')))
 throw Error('PILOT_SIGNING_MATERIAL_OR_BACKUP_MISSING');
if(key?.usuario!==backendRef||!key.secreto.startsWith('sb_publishable_'))
 throw Error('TARGET_PUBLIC_KEY_MUST_MATCH_PROJECT');
const project=path.resolve('apps/rider-android');
// Explicit .\ path: cmd may be told not to search the current directory
// (NoDefaultCurrentDirectoryInExePath), and then a bare gradlew.bat fails.
// Kotlin compiled non-incrementally: incremental compilation may keep another
// target's inlined BuildConfig constants when only BuildConfig changed. (`clean`
// and `--rerun-tasks` are not options on Windows: the Gradle and Kotlin daemons
// keep files under app/build open.) The dex check below is the final guarantee.
const built=spawnSync('cmd.exe',['/d','/c','.\\gradlew.bat','-Pkotlin.incremental=false',androidTest?':app:assembleReleaseAndroidTest':':app:assembleRelease',`-PriderPilotVersionCode=${versionCode}`,`-PriderPilotVersionName=${versionName}`,
 ...(androidTest?['-PriderPilotInstrumentation=true']:[]),'--console=plain'],{
 cwd:project,stdio:'inherit',windowsHide:true,env:{...process.env,
  ANDROID_HOME:path.join(process.env.LOCALAPPDATA,'Android','Sdk'),
  RIDER_TARGET_MODE:target,RIDER_BACKEND_REF:backendRef,RIDER_PUBLIC_KEY:key.secreto,
  RIDER_PILOT_KEYSTORE_PATH:keystore,
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
// The backend a rider talks to lives in the dex, not in the manifest: an APK with
// the right package and versionCode can still carry another environment's URL.
// It must contain its own backend URL and no other known environment's.
const knownRefs=['ucbtjcurawxjwjdvvcvj',cpManifest.rider?.backendRef,'wwcpogltfgzgkrlilbcd','yakhtrkukqlgzvxuvhzs'].filter(Boolean);
// Windows bsdtar reads zip (an APK); a GNU tar earlier in PATH (Git Bash) does not.
const bsdtar=path.join(process.env.SystemRoot||process.env.windir||'','System32','tar.exe');
const dexNames=(spawnSync(bsdtar,['-tf',apk],{encoding:'utf8',windowsHide:true}).stdout||'').split(/\r?\n/).filter((n)=>/^classes\d*\.dex$/.test(n));
if(!dexNames.length)throw Error('PILOT_APK_DEX_UNREADABLE');
const dex=Buffer.concat(dexNames.map((n)=>spawnSync(bsdtar,['-xOf',apk,n],{windowsHide:true,maxBuffer:256*1024*1024}).stdout||Buffer.alloc(0)));
const embedsUrl=(ref)=>dex.includes(Buffer.from(`https://${ref}.supabase.co`));
if(!embedsUrl(backendRef)||knownRefs.some((ref)=>ref!==backendRef&&embedsUrl(ref)))
 throw Error('PILOT_APK_BACKEND_MISMATCH');
if(androidTest){
 const testApk=path.join(project,'app','build','outputs','apk','androidTest','release','app-release-androidTest.apk');
 if(!existsSync(testApk))throw Error('PILOT_ANDROID_TEST_APK_MISSING');
 const testBadging=spawnSync(path.join(toolsDir,'aapt.exe'),['dump','badging',testApk],{encoding:'utf8',windowsHide:true});
 if(testBadging.status!==0||testBadging.stdout.match(/package: name='([^']+)'/)?.[1]!=='com.lataba.rider.pilot.test')
  throw Error('PILOT_ANDROID_TEST_IDENTITY_MISMATCH');
 const testSignature=spawnSync('cmd.exe',['/d','/c',path.join(toolsDir,'apksigner.bat'),
  'verify','--print-certs',testApk],{encoding:'utf8',windowsHide:true});
 if(testSignature.status!==0||testSignature.stdout.match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9]{64})/i)?.[1]!==signer)
  throw Error('PILOT_ANDROID_TEST_SIGNER_MISMATCH');
}
if(target==='pilot'){
 const receipt={target,backend:backendRef,packageId,versionCode,
  versionName:actualVersionName,certificateSha256:signer,
  apkFile:'apps/rider-android/app/build/outputs/apk/release/app-release.apk',
  embeddedBackendUrl:`https://${backendRef}.supabase.co`,
  apkSha256:createHash('sha256').update(readFileSync(apk)).digest('hex'),
  builtAt:new Date().toISOString()};
 writeFileSync(path.join(project,'app','build','outputs','pilot-build-receipt.json'),
  JSON.stringify(receipt,null,2)+'\n','utf8');
}
console.log(JSON.stringify({signed:true,packageId,versionCode,versionName:actualVersionName,certificateSha256:signer,
 backend:backendRef,embeddedBackendVerified:true,target,historicalV146Unaffected:true,androidTestBuilt:androidTest}));
