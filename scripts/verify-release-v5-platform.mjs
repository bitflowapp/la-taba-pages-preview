// Actual pinned CLI parser/wire protocol and actual Edge Runtime ESZip build.
// The CLI talks ONLY to a loopback profile with synthetic credentials. Docker
// bundling has network=none and sees only this process's temporary directory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { cliDeployArgs, PROJECT, FUNCTIONS, CLI_VERSION, sha256 } from './release-v5/model.mjs';
import { buildSources, markedSource } from './release-v5/identity.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'taba-v5-platform-'));
const calls=[];
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1');calls.push({method:req.method,path:url.pathname});
    assert.equal(req.headers.authorization,'Bearer '+'sbp_'+'0'.repeat(40));
    assert.ok(url.pathname.startsWith(`/v1/projects/${PROJECT}/`));
    res.setHeader('content-type','application/json');
    if(req.method==='POST'&&url.pathname.endsWith('/functions/deploy')){
      assert.equal(url.searchParams.get('bundleOnly'),'true');
      const form=await new Request(url,{method:'POST',headers:req.headers,body:Readable.toWeb(req),duplex:'half'}).formData();
      const meta=JSON.parse(form.get('metadata')),slug=url.searchParams.get('slug');
      assert.equal(meta.name,slug);assert.ok(FUNCTIONS.includes(slug));assert.equal(form.getAll('file').length,1);
      res.writeHead(201);res.end(JSON.stringify({id:`00000000-0000-4000-8000-${String(FUNCTIONS.indexOf(slug)+1).padStart(12,'0')}`,
        name:slug,slug,status:'ACTIVE',version:10,created_at:1787870408066,updated_at:1788852540895,
        verify_jwt:meta.verify_jwt,entrypoint_path:meta.entrypoint_path,ezbr_sha256:'a'.repeat(64)}));return;
    }
    assert.equal(req.method,'PUT');assert.equal(url.pathname,`/v1/projects/${PROJECT}/functions`);
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks));
    assert.deepEqual(body.map(v=>v.slug).sort(),[...FUNCTIONS].sort());assert.ok(body.every(v=>v.version===10));
    res.end(JSON.stringify({functions:body}));
  } catch(error){res.writeHead(400);res.end(JSON.stringify({message:String(error.message)}));}
});
const npxCli=process.env.npm_execpath?path.join(path.dirname(process.env.npm_execpath),'npx-cli.js')
  :process.platform==='win32'?path.join(path.dirname(process.execPath),'node_modules/npm/bin/npx-cli.js'):null;
async function cli(args){
  const command=npxCli?process.execPath:'npx',prefix=npxCli?[npxCli]:[];
  const child=spawn(command,[...prefix,'--yes',`supabase@${CLI_VERSION}`,...args],{cwd:tmp,windowsHide:true,
    env:{...process.env,SUPABASE_ACCESS_TOKEN:'sbp_'+'0'.repeat(40),DO_NOT_TRACK:'1',SUPABASE_TELEMETRY_DISABLED:'1'}});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  return {code,output};
}
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,profile=path.join(tmp,'profile.toml');
  fs.writeFileSync(profile,`name = "taba-loopback"\napi_url = "http://127.0.0.1:${port}"\ndashboard_url = "http://127.0.0.1:${port}"\nproject_host = "fixture.invalid"\n`);
  fs.mkdirSync(path.join(tmp,'supabase'),{recursive:true});
  fs.writeFileSync(path.join(tmp,'supabase/config.toml'),'project_id = "taba-astra-platform-test"\n');
  for(const slug of FUNCTIONS){
    const dir=path.join(tmp,'supabase/functions',slug);fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'index.ts'),'Deno.serve(() => new Response("isolated platform fixture"));\n');
  }
  assert.equal((await cli(['--version'])).output.trim(),CLI_VERSION);
  const invalid=await cli([...cliDeployArgs(PROJECT).filter(v=>v!=='--use-api'),'--profile',profile]);
  assert.notEqual(invalid.code,0);assert.match(invalid.output,/--jobs must be used together with --use-api/);
  assert.ok(calls.every(v=>v.method==='GET'),JSON.stringify(calls));calls.length=0;
  const valid=await cli([...cliDeployArgs(PROJECT),'--profile',profile]);
  assert.equal(valid.code,0,valid.output+'\n'+JSON.stringify(calls));
  assert.deepEqual(calls.filter(v=>v.method!=='GET').map(v=>v.method).sort(),['POST','POST','POST','PUT']);
  console.log('REAL_SUPABASE_2_101_0_COMMAND_AND_TWO_PHASE_WIRE_PROTOCOL: PASS');
  const built=await buildSources();
  const denoFixture=path.join(tmp,'runtime-probe-check.mjs');
  fs.writeFileSync(denoFixture,`let handler; Deno.serve = fn => {handler=fn;};
globalThis.fetch = () => {throw new Error('PROVIDER_IO_FORBIDDEN');};
Deno.env.set('DENO_DEPLOYMENT_ID','fixture-deployment');
await import(Deno.args[0]);
const nonce='00000000-0000-4000-8000-000000000321';
const result=await handler(new Request('https://fixture.invalid/__taba_release_v5?nonce='+nonce));
const body=await result.json();
if(result.status!==200 || body.nonce!==nonce || body.deployment_id!=='fixture-deployment' || !body.source_identity) throw new Error('runtime proof failed');
if(!result.headers.get('cache-control').includes('no-store')) throw new Error('unsafe cache');
const missing=await handler(new Request('https://fixture.invalid/__taba_release_v5'));
if(missing.status!==400)throw new Error('unbounded nonce');
console.log('REAL_DENO_NON_MUTATING_RUNTIME_PROBE: PASS');\n`);
  const image='public.ecr.aws/supabase/edge-runtime:v1.74.3';
  const mount=`type=bind,source=${tmp},target=/work`;
  const userArgs=typeof process.getuid==='function'&&typeof process.getgid==='function'?['--user',`${process.getuid()}:${process.getgid()}`]:[];
  for(const slug of FUNCTIONS){
    const source=markedSource(built,slug,'00000000-0000-4000-8000-000000000123');
    const dir=path.join(tmp,'runtime',slug);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'index.js'),source);
    const dockerArgs=['run','--rm','--network','none',...userArgs,'--mount',mount,image];
    execFileSync('docker',[...dockerArgs,'bundle','--entrypoint',`/work/runtime/${slug}/index.js`,'--output',`/work/${slug}.eszip`],{stdio:'pipe',windowsHide:true});
    execFileSync('docker',[...dockerArgs,'unbundle','--eszip',`/work/${slug}.eszip`,'--output',`/work/unbundled-${slug}`],{stdio:'pipe',windowsHide:true});
    const files=fs.readdirSync(path.join(tmp,`unbundled-${slug}`),{recursive:true}).filter(v=>v.endsWith('index.js'));
    assert.equal(files.length,1);assert.equal(sha256(fs.readFileSync(path.join(tmp,`unbundled-${slug}`,files[0]))),sha256(source));
    const denoArgs=[...(npxCli?[npxCli]:[]),'--yes','deno@2.6.1','run','--no-config','--no-lock','--allow-env',`--allow-read=${tmp}`,'--deny-net',denoFixture,pathToFileURL(path.join(dir,'index.js')).href];
    execFileSync(npxCli?process.execPath:'npx',denoArgs,{encoding:'utf8',windowsHide:true,stdio:'pipe'});
    console.log(`REAL_DENO_NON_MUTATING_RUNTIME_PROBE: PASS ${slug}`);
    console.log(`REAL_ESZIP_OFFLINE_BUILD_AND_EXACT_SOURCE_ROUNDTRIP: PASS ${slug}`);
  }
} finally { await new Promise(resolve=>server.close(resolve));fs.rmSync(tmp,{recursive:true,force:true}); }
