import fs from 'node:fs';
import path from 'node:path';
import { withRecoveryProject } from './hosted-client.mjs';
import { nativeCommand, postgresEnvironment } from './postgres-backup.mjs';
import { assertArchiveReceipt, decodeArchiveBaseline, restoreMarker } from './restore-postgres-application.mjs';
import { assertPrivateOutputDirectory } from './private-output.mjs';

import { fingerprint, compareFingerprints } from './restore-fingerprints.mjs';
export { FINGERPRINT_SQL, fingerprint, compareFingerprints } from './restore-fingerprints.mjs';

export function compareRestoreEvidence(archive,restored,liveSource) {
  const comparison=compareFingerprints(archive,restored),liveComparison=compareFingerprints(liveSource,restored);
  return {comparison,liveComparison,allApplicationChecksPassed:Object.values(comparison).every(Boolean),
    liveSourceMatchesRestored:Object.values(liveComparison).every(Boolean)};
}

export async function verifyRestore({target,receipt,baselineFile,tools,ca,out}) {
  assertPrivateOutputDirectory(out);
  assertArchiveReceipt(target,receipt);
  if(!baselineFile) throw Error('Archive-derived fingerprint file required');
  const archived=decodeArchiveBaseline(target,receipt,fs.readFileSync(baselineFile));
  if(process.platform==='win32'&&!/^D:[\\/]/i.test(path.resolve(out)))throw Error('Use D: for evidence');
  if(fs.existsSync(out))throw Error('New verification evidence directory required');
  return withRecoveryProject(target,async()=>{
    const env=postgresEnvironment(target,ca,receipt.database);
    const marker=nativeCommand(tools,'psql',['-X','-w','-At','--set','ON_ERROR_STOP=1','--command',
      "select shobj_description(oid,'pg_database') from pg_database where datname=current_database()"],{env,encoding:'utf8'}).trim();
    if(marker!==restoreMarker(receipt)) throw Error('Restore database ownership/archive marker mismatch');
    const source=fingerprint(tools,postgresEnvironment(target,ca));
    const restored=fingerprint(tools,env);
    fs.mkdirSync(out,{mode:0o700});
    fs.writeFileSync(path.join(out,'source-fingerprints.json'),JSON.stringify(source,null,2),{flag:'wx',mode:0o600});
    fs.writeFileSync(path.join(out,'restored-fingerprints.json'),JSON.stringify(restored,null,2),{flag:'wx',mode:0o600});
    const evidence=compareRestoreEvidence(archived,restored,source);
    const result={at:new Date().toISOString(),projectRef:target.projectRef,database:receipt.database,
      restoreId:receipt.restoreId,sourceArchive:receipt.sourceArchive,archiveFingerprintsSha256:receipt.archiveFingerprintsSha256,
      ...evidence,tablesChecked:(restored.tables || []).length,policiesChecked:(restored.policies || []).length,
      functionsChecked:(restored.functions || []).length,
      fullManagedPlatformRestorePassed:false,commercialPaymentsVerified:false,
      comparisonReference:'Archive-derived baseline captured immediately after this isolated restore; live source drift is reported separately'};
    fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result;
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
  const value=name=>process.argv[process.argv.indexOf(name)+1];
  if(!['--verify','--target','--receipt','--tools','--ca','--out'].every(n=>process.argv.includes(n)))throw Error('Explicit verification arguments required');
  const receiptFile=path.resolve(value('--receipt'));
  const result=await verifyRestore({target:JSON.parse(fs.readFileSync(value('--target'),'utf8')),receipt:JSON.parse(fs.readFileSync(receiptFile,'utf8')),
    baselineFile:path.join(path.dirname(receiptFile),'restored-archive-fingerprints.json'),tools:value('--tools'),ca:value('--ca'),out:path.resolve(value('--out'))});
  console.log(JSON.stringify(result));if(!result.allApplicationChecksPassed)process.exitCode=1;
}
