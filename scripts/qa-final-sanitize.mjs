import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root=path.resolve('artifacts/la-taba-final-integration-20261007');
const roots=[process.cwd(),path.resolve('../la-taba-final-baseline-20261007')];
const variants=roots.flatMap(p=>[p,p.replaceAll('\\','/'),JSON.stringify(p).slice(1,-1),pathToFileURL(p+path.sep).href.slice(0,-1)]);
function sanitize(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);if(entry.isDirectory()){sanitize(file);continue;}
  if(!/\.(?:json|log|md|html|txt)$/.test(entry.name))continue;
  let text=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').replaceAll('\r\n','\n');
  for(const prefix of variants)text=text.split(prefix).join('<repo>');
  text=text.replace(/(?<![A-Za-z0-9_.-])[A-Za-z]:[\\/][^\s`"'<>|]+|(?<![A-Za-z0-9_.:/-])\/(?:home|Users)\/[^/\s]+(?:\/[^\s`"'<>|]*)*/g,'<local-path>');
  text=text.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
  text=text.split('\n').map(line=>line.trimEnd()).join('\n');
  try{fs.writeFileSync(file,text);}catch(error){
    if(['EBUSY','EPERM'].includes(error.code)){console.warn(`Deferred active evidence file: ${path.relative(root,file)}`);continue;}
    throw error;
  }
}}
sanitize(root);console.log('Integration text evidence sanitized; native screenshots and videos untouched.');
