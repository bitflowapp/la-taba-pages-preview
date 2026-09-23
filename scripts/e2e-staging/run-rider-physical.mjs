import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const mode=process.argv[2];
if(!['flow','resilience'].includes(mode))throw Error('USE_FLOW_OR_RESILIENCE');
const adb=(args,timeout=360000)=>spawnSync('adb',['-s','ZY32LHS6PS',...args],{encoding:'utf8',windowsHide:true,timeout});
if(mode==='flow'&&adb(['shell','run-as','com.lataba.rider.qa','test','-f','files/qa-input.json']).status!==0)throw Error('EXPLICIT_PRIVATE_QA_INPUT_REQUIRED');
const test=mode==='flow'?'PhysicalQaTest':'PhysicalResilienceTest';
if(mode==='resilience'){
 const stopped=adb(['shell','am','force-stop','com.lataba.rider.qa']);if(stopped.status!==0)throw Error('QA_FORCE_STOP_FAILED');
}
const result=adb(['shell','am','instrument','-w','-e','qaStaging','true','-e','class',`com.lataba.rider.${test}`,'com.lataba.rider.qa.test/androidx.test.runner.AndroidJUnitRunner']);
const passed=result.status===0&&/OK \(1 test\)/.test(result.stdout)&&!/(FAILURES|Error in|INSTRUMENTATION_FAILED|AssumptionViolated)/.test(result.stdout);
// Framework failures can contain form semantics. Persist a summary, never a raw UI dump.
const report={timestamp:new Date().toISOString(),device:'ZY32LHS6PS',packageId:'com.lataba.rider.qa',mode,result:passed?'PASS':'FAIL',automated:true,stagingOnly:true};
writeFileSync(`artifacts/rider-canonical-physical-${mode}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));if(!passed)process.exitCode=1;
