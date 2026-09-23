import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { loadStagingKeys } from './qa-staging-keys.mjs';

const state=JSON.parse(leerSecreto('RIDER CANONICAL QA RUN 20260922')?.secreto||'{}');
if(!state.orderId||!state.publicCode)throw Error('QA_ORDER_REQUIRED');
const {secret}=await loadStagingKeys();
const admin=createClient('https://ucbtjcurawxjwjdvvcvj.supabase.co',secret,
 {auth:{persistSession:false,autoRefreshToken:false}});
const adb=(args)=>spawnSync('adb',['-s','ZY32LHS6PS',...args],{encoding:'utf8',windowsHide:true,timeout:20000});
const setting=name=>adb(['shell','settings','get','global',name]).stdout.trim();
const hasInternet=()=>adb(['shell','ping','-c','1','-W','3','1.1.1.1']).status===0;
const wifi=setting('wifi_on'),data=setting('mobile_data');
if(!['0','1'].includes(wifi)||!['0','1'].includes(data))throw Error('DEVICE_NETWORK_BASELINE_UNKNOWN');
if(!hasInternet())throw Error('DEVICE_INTERNET_BASELINE_REQUIRED');
const battery=()=>Number((adb(['shell','dumpsys','battery']).stdout.match(/\blevel:\s*(\d+)/)||[])[1]);
const batteryStart=battery();
const exitInfo=()=>adb(['shell','dumpsys','activity','exit-info','com.lataba.rider.qa']).stdout;
const countCrash=(text)=>(text.match(/reason=\d+ \(CRASH[^)]*\)/g)||[]).length;
const countAnr=(text)=>(text.match(/reason=\d+ \(ANR\)/g)||[]).length;
const exitsBefore=exitInfo();
const pidBefore=adb(['shell','pidof','com.lataba.rider.qa']).stdout.trim();
const report={startedAt:new Date().toISOString(),project:'ucbtjcurawxjwjdvvcvj',device:'ZY32LHS6PS',
 stagingOnly:true,realGpsOnly:true,gpsUpdates:0,failedQueries:0,maxGpsGapSeconds:0,
 maxGpsSilenceSeconds:0,gpsLiveSamples:0,
 batteryStart,networkCut:false,networkRestoreRequested:false,networkRestored:false,screenOff:false,screenWake:false,
 deviceProgress:null,orderFinal:null};
const seen=new Set();let lastGpsAt=null,start=null,cutAt=null,screenAt=null;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeProgress=()=>{
 const r=adb(['shell','run-as','com.lataba.rider.qa','cat','files/qa-soak-progress.json']);
 return r.status===0?JSON.parse(r.stdout):null;
};
try{
 const gate=Date.now()+180000;
 while(Date.now()<gate){
  const progress=safeProgress();if(progress?.started){start=Date.now();report.deviceProgress=progress;break}
  await pause(5000);
 }
 if(!start)throw Error('PHYSICAL_SOAK_DID_NOT_START');
 while(Date.now()-start<3900000){
  const elapsed=Date.now()-start;
  const progress=safeProgress();if(progress)report.deviceProgress=progress;
  const updatesBefore=seen.size;
  try{
   const {data:locations,error}=await admin.from('rider_locations')
    .select('id,receipt_sequence,captured_at,source').eq('order_id',state.orderId);
   if(error)throw error;
   for(const fix of locations||[]){
    if(fix.source!=='gps'||seen.has(fix.id))continue;
    seen.add(fix.id);const at=Date.parse(fix.captured_at);
    if(Number.isFinite(at)&&lastGpsAt)report.maxGpsGapSeconds=Math.max(report.maxGpsGapSeconds,Math.round((at-lastGpsAt)/1000));
    if(Number.isFinite(at))lastGpsAt=at;
   }
   report.gpsUpdates=seen.size;
   if(seen.size>updatesBefore)report.gpsLiveSamples++;
   if(lastGpsAt)report.maxGpsSilenceSeconds=Math.max(report.maxGpsSilenceSeconds,
     Math.max(0,Math.round((Date.now()-lastGpsAt)/1000)));
   const order=await admin.from('orders').select('status').eq('id',state.orderId).single();
   if(order.error)throw order.error;
   report.orderFinal=order.data.status;
  }catch{report.failedQueries++}
  if(elapsed>=15*60000&&!cutAt){
   adb(['shell','svc','wifi','disable']);adb(['shell','svc','data','disable']);
   cutAt=Date.now();report.networkCut=true;
  }
  if(cutAt&&!report.networkRestoreRequested&&Date.now()-cutAt>=90000){
   adb(['shell','svc','wifi',wifi==='1'?'enable':'disable']);
   adb(['shell','svc','data',data==='1'?'enable':'disable']);report.networkRestoreRequested=true;
  }
  if(report.networkRestoreRequested&&!report.networkRestored)report.networkRestored=hasInternet();
  if(elapsed>=25*60000&&!screenAt){adb(['shell','input','keyevent','26']);screenAt=Date.now();report.screenOff=true}
  if(screenAt&&!report.screenWake&&Date.now()-screenAt>=10*60000){adb(['shell','input','keyevent','224']);report.screenWake=true}
  writeFileSync('artifacts/rider-pilot-soak.json',JSON.stringify(report,null,2));
  if(progress?.completed)break;
  if(Math.floor(elapsed/60000)%5===0)console.log(JSON.stringify({elapsedMinutes:Math.floor(elapsed/60000),gpsUpdates:report.gpsUpdates,failedQueries:report.failedQueries,networkRestored:report.networkRestored,screenWake:report.screenWake}));
  await pause(30000);
 }
}finally{
 adb(['shell','svc','wifi',wifi==='1'?'enable':'disable']);
 adb(['shell','svc','data',data==='1'?'enable':'disable']);
 report.batteryEnd=battery();report.batteryDelta=Number.isFinite(report.batteryEnd)?report.batteryEnd-batteryStart:null;
 const exitsAfter=exitInfo();
 report.crashes=Math.max(0,countCrash(exitsAfter)-countCrash(exitsBefore));
 report.anr=Math.max(0,countAnr(exitsAfter)-countAnr(exitsBefore));
 report.processChanged=Boolean(pidBefore&&adb(['shell','pidof','com.lataba.rider.qa']).stdout.trim()!==pidBefore);
 report.endedAt=new Date().toISOString();
 report.networkSwitchesRestored=setting('wifi_on')===wifi&&setting('mobile_data')===data;
 report.networkRestored=report.networkSwitchesRestored&&hasInternet();
 writeFileSync('artifacts/rider-pilot-soak.json',JSON.stringify(report,null,2));
}
const completed=report.deviceProgress?.completed===true&&report.deviceProgress.elapsed_minutes>=60;
const passed=completed&&report.networkRestored&&report.gpsUpdates>=60
  &&report.maxGpsSilenceSeconds<=180&&report.gpsLiveSamples>=50
  &&report.deviceProgress.offline_minutes<=3&&report.crashes===0&&report.anr===0;
console.log(JSON.stringify({soak:passed?'PASS':'FAIL',gpsUpdates:report.gpsUpdates,
 failedQueries:report.failedQueries,maxGpsGapSeconds:report.maxGpsGapSeconds,
 maxGpsSilenceSeconds:report.maxGpsSilenceSeconds,gpsLiveSamples:report.gpsLiveSamples,
 batteryDelta:report.batteryDelta,networkRestored:report.networkRestored,
 crashes:report.crashes,anr:report.anr,processChanged:report.processChanged,
 screenOff:report.screenOff,screenWake:report.screenWake,
 deviceProgress:report.deviceProgress,orderFinal:report.orderFinal}));
if(!passed)process.exitCode=1;
