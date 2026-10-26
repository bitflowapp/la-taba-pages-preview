// Archive only an explicit allowlist. Raw browser sessions and credentials never enter Git.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=path.resolve(process.argv[2]);
const destination=path.join(root,'docs/audit/codex-payment-20261026/evidence');
fs.mkdirSync(destination,{recursive:true});
const names=[
 'qa-preflight.json','qa-snapshot-before.json','qa-snapshot-after.json','qa-adversarial.json','qa-return-resilience.json','qa-closed-state.json','multi-provider-final.json',
 'qa-combo-ui.json','qa-combo-ui-after.json','qa-combo-ui-coherent.json','qa-counts-after.json',
 'combo-checkout.json','combo-fixture-before.json','combo-fixture-after.json','combo-provider-approved.json','combo-db-approved.json',
 'close-provider-approved.json','close-db-approved.json','multi-provider-rejected.json','multi-provider-later.json','multi-db-rejected.json','multi-db-expired.json',
 'duplicate-paid-after.json','ledger-provider-boundary.json','qa-actions.jsonl',
 'return-cart-before.tap','cart-overlap-before.tap','cart-return-final.tap','refund-resolution-before.tap',
 'refund-negative-resolution-before.tap','postgres-final-regressions.tap','postgres-otherflows-final.tap',
 'marketplace-baseline.tap','preference-dispatch-postgres.tap','preference-race-before.log','preference-refund-after.log',
 'permissions-before.log','permissions-after.log','ledger-before.tap','ledger-after.tap','node-all-final.tap',
 'node-all-after-fixes.tap','node-final-affected.tap','availability-session-final.tap','client-affected-final.tap',
 'combo-ui-before.log','combo-ui-final.log','browser-local-final.log','deno-final.log','check-final.log','secrets-scan.log',
 'bootstrap-baseline.json','bootstrap-fixed.json','migration-validation.log',
];
function clean(input){
 let output=input;
 for(const [dir,label] of [[root,'<AUDIT_WORKTREE>'],[source,'<PRIVATE_EVIDENCE>'],[process.env.USERPROFILE,'<USER_HOME>']]){
   if(!dir)continue;
   for(const variant of [dir,dir.replaceAll('\\','/'),dir.replaceAll('\\','\\\\')])output=output.split(variant).join(label);
 }
 return output.replace(/(?:sb_secret_|sbp_|APP_USR-|TEST-|eyJ)[A-Za-z0-9._-]{20,}/g,'[REDACTED]')
   .replace(/\r\n?/g,'\n').replace(/[ \t]+$/gm,'').trimEnd()+'\n';
}
function decode(buffer){return (buffer[0]===255&&buffer[1]===254?buffer.toString('utf16le'):buffer.toString('utf8')).replace(/^\uFEFF/,'');}
for(const name of names){
 const file=path.join(source,name);
 if(fs.existsSync(file))fs.writeFileSync(path.join(destination,name),clean(decode(fs.readFileSync(file))));
}
const events=[];
for(const dir of ['qa-codex-20261026','qa-codex-close-20261026']){
 const file=path.join(source,dir,'browser.jsonl');
 for(const line of fs.readFileSync(file,'utf8').trim().split('\n')){
   const event=JSON.parse(line);
   if(['ready','pay_submitted','close_before_return_armed','browser_closed_before_return'].includes(event.kind))events.push(event);
 }
}
fs.writeFileSync(path.join(destination,'browser-operation-events.json'),clean(JSON.stringify(events,null,2)));
const files=fs.readdirSync(destination).filter(f=>f!=='manifest.json').sort().map(name=>{
 const bytes=fs.readFileSync(path.join(destination,name));
 return {name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
});
fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify({generated_at:new Date().toISOString(),baseline:'30af95c14a470db6e567d589c2a7c8faac524bd0',files},null,2)+'\n');
console.log(JSON.stringify({archived:files.length,raw_browser_sessions_included:false}));
