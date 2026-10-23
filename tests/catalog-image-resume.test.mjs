import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

// Execute the real retry function without loading Deno.serve or credentials.
const source=fs.readFileSync('supabase/functions/catalog-image-manager/index.ts','utf8');
const fn=source.slice(source.indexOf('async function resumeApprovedUpload'),source.indexOf('async function publishApprovedObjects'));
const js=transformSync(fn,{loader:'ts',format:'cjs'}).code;
function resume(){return vm.runInNewContext(js+'\nresumeApprovedUpload',{
  fail:(code,status)=>{throw Object.assign(Error(code),{status});},
  publishApprovedObjects:()=>{throw Error('unexpected publication');},
});}
test('retry cannot certify an approved image with no asset identity, even if cleanup says complete',async()=>{
  await assert.rejects(resume()({row:{id:'upload',status:'approved',cleanup_status:'complete',catalog_asset_id:null},
    admin:{from:()=>{throw Error('unexpected database request');}}}),/IMAGE_ASSOCIATION_CHANGED/);
});
test('a completed upload with its asset identity is returned without repeating publication',async()=>{
  const result=await resume()({row:{id:'upload',status:'approved',cleanup_status:'complete',catalog_asset_id:'asset'},admin:{}});
  assert.equal(result.ok,true);assert.equal(result.catalog_asset_id,'asset');assert.equal(result.cleanup_status,'complete');
});
