// Type-check every existing Edge entry point with the same pinned Deno as the
// webhook suite. Never materialize node_modules or silently rewrite deno.lock.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const names=fs.readdirSync('supabase/functions',{withFileTypes:true})
  .filter(entry=>entry.isDirectory()&&!entry.name.startsWith('_')).map(entry=>entry.name).sort();
if(!names.length||names.some(name=>!/^[a-z0-9-]+$/.test(name))) throw Error('Invalid Edge entry inventory');
const args=['--yes','deno@2.6.1','check','--node-modules-dir=none','--frozen','--lock=deno.lock',
  ...names.map(name=>`supabase/functions/${name}/index.ts`)];
const result=spawnSync(process.platform==='win32'?'npx.cmd':'npx',args,
  {stdio:'inherit',shell:process.platform==='win32',windowsHide:true});
if(result.error) throw result.error;
process.exit(result.status??1);
