import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const root=path.resolve('artifacts/la-taba-final-integration-20261007');fs.mkdirSync(root,{recursive:true});
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const refs={main:git('rev-parse','origin/main'),pr142:git('rev-parse','origin/feat/frontend-premium-liquid-glass-20261007'),pr143:git('rev-parse','origin/feat/tracking-premium-map-20261007'),pr144:git('rev-parse','origin/fix/tracking-rider-helmet-visual-20261007')};
const ancestor=(a,b)=>spawnSync('git',['merge-base','--is-ancestor',a,b]).status===0;
const normalize=text=>text.replaceAll('\r\n','\n');
const hash=text=>crypto.createHash('sha256').update(normalize(text)).digest('hex');
const versionResponse=await fetch('https://la-taba.pages.dev/version.json',{headers:{'Cache-Control':'no-cache'}});
if(!versionResponse.ok)throw new Error(`Production version HTTP ${versionResponse.status}`);
const version=await versionResponse.json();
const productionFiles={};
for(const file of ['styles.css','sw.js']){
  const response=await fetch(`https://la-taba.pages.dev/${file}`,{headers:{'Cache-Control':'no-cache'}});
  if(!response.ok)throw new Error(`Production ${file} HTTP ${response.status}`);
  const text=await response.text(),source=execFileSync('git',['show',`${refs.main}:${file}`],{encoding:'utf8'});
  productionFiles[file]={sha256:hash(text),mainSha256:hash(source),matchesMain:hash(text)===hash(source),
    premiumStorefront:text.includes('premium-storefront.css'),premiumTracking:text.includes('tracking-premium.css')};
}
const files=git('diff','--name-only',refs.main,'HEAD').split('\n');
const preserveGroups={pr142:['js/category-glass.js','js/motion.js','styles/premium-storefront.css','assets/brand/ambient-grain.png'],
  pr144:['js/ui.js','js/map/map_view.js','js/map/maplibre_tracking_map.js','js/map/location_picker_map.js','js/map/touch_intent.js','js/map/rider_motion.js','js/map/rider_marker.js','styles/tracking-premium.css']};
const preserved=Object.fromEntries(Object.entries(preserveGroups).map(([key,paths])=>[key,paths.map(file=>{
  const current=fs.readFileSync(file),original=execFileSync('git',['show',`${refs[key]}:${file}`]);
  const hashBytes=b=>crypto.createHash('sha256').update(b.toString('utf8').replaceAll('\r\n','\n')).digest('hex');
  return{file,matchesOriginal:hashBytes(current)===hashBytes(original)};
})]));
const report={checkedAt:new Date().toISOString(),refs,production:{url:'https://la-taba.pages.dev',version,etag:versionResponse.headers.get('etag'),files:productionFiles},
  included:Object.fromEntries(['pr142','pr143','pr144'].map(key=>[key,ancestor(refs[key],'HEAD')])),
  alreadyInMain:Object.fromEntries(['pr142','pr143','pr144'].map(key=>[key,ancestor(refs[key],refs.main)])),
  pr143AncestorOf144:ancestor(refs.pr143,refs.pr144),
  originalFeatureSourcesPreserved:preserved,
  protectedSourceChanges:files.filter(file=>/^(supabase\/|js\/(?:repositories|payments|services|core)\/|js\/(?:orders|state|checkout)\.js|runtime-config\.js|package(?:-lock)?\.json)/.test(file)),
  strategy:'Merge #142, then #144 (which contains #143). Both share the verified current main ancestor. Preserve original commits, combine CSS/precache intentionally.',
  release:JSON.parse(fs.readFileSync('release-identity.json','utf8'))};
fs.writeFileSync(path.join(root,'source-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({refs,included:report.included,production:version,productionFiles,protectedSourceChanges:report.protectedSourceChanges},null,2));
