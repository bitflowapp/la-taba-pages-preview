import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {leerSecreto} from '../e2e-production-sale/secretos-windows.mjs';
// Inspect our newly built APK's ZIP entries in memory. Never inspect/decompile the historical APK.
const publicKey=leerSecreto('STAGING SUPABASE PUBLISHABLE KEY')?.secreto;
const secrets=['STAGING SUPABASE SECRET KEY','STAGING RIDER QA 20260920','STAGING CUSTOMER QA 20260920','STAGING BUSINESS QA 20260920','STAGING RIDER B CANONICAL QA 20260922','RIDER PILOT SIGNING PASSWORD','RIDER PILOT KEYSTORE BACKUP'].map(n=>leerSecreto(n)?.secreto).filter(Boolean);
if(!publicKey||secrets.length<4)throw Error('SCAN_INPUT_MISSING');
function* entries(zip){
 let end=zip.length-22;
 while(end>=0&&zip.readUInt32LE(end)!==0x06054b50)end--;
 if(end<0)throw Error('INVALID_APK_ZIP');
 const count=zip.readUInt16LE(end+10);let cursor=zip.readUInt32LE(end+16);
 for(let i=0;i<count;i++){
  if(zip.readUInt32LE(cursor)!==0x02014b50)throw Error('INVALID_CENTRAL_DIRECTORY');
  const method=zip.readUInt16LE(cursor+10),size=zip.readUInt32LE(cursor+20),offset=zip.readUInt32LE(cursor+42);
  const start=offset+30+zip.readUInt16LE(offset+26)+zip.readUInt16LE(offset+28);
  const compressed=zip.subarray(start,start+size);
  if(method===0)yield compressed;else if(method===8)yield inflateRawSync(compressed);else throw Error('UNSUPPORTED_APK_COMPRESSION');
  cursor+=46+zip.readUInt16LE(cursor+28)+zip.readUInt16LE(cursor+30)+zip.readUInt16LE(cursor+32);
 }
}
const report={timestamp:new Date().toISOString(),historicalApkInspected:false,artifacts:[]};
const releaseBase='apps/rider-android/app/build/outputs/apk/release/';
const release=existsSync(`${releaseBase}app-release.apk`)?`${releaseBase}app-release.apk`:`${releaseBase}app-release-unsigned.apk`;
for(const file of ['apps/rider-android/app/build/outputs/apk/debug/app-debug.apk',release]){
 const bytes=readFileSync(file);let containsPublic=false,leaks=0;
 for(const value of entries(bytes)){
  containsPublic ||= value.includes(Buffer.from(publicKey));
  leaks+=secrets.filter(s=>value.includes(Buffer.from(s))).length;
  if(/sb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/.test(value.toString('latin1')))leaks++;
 }
 report.artifacts.push({file,sha256:createHash('sha256').update(bytes).digest('hex'),publicKeyPresent:containsPublic,secretScan:leaks===0&&containsPublic?'PASS':'FAIL'});
}
writeFileSync('artifacts/rider-canonical-apk-scan.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(report.artifacts.some(a=>a.secretScan!=='PASS'))process.exitCode=1;
