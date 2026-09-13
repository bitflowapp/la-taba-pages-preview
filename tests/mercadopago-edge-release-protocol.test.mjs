import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { argumentsFor, main } from '../scripts/release-edge-production.mjs';
import { PROJECT, FUNCTIONS, EMPTY_TABLES, ROOT, assertInert, remoteFunction, inventory, verifyRelease, cliDeployArgs } from '../scripts/release-v5/model.mjs';
import { buildSources, markedSource } from '../scripts/release-v5/identity.mjs';
import { databaseConfiguration } from '../scripts/release-v5/session.mjs';
import { baselineFunctions, platformFixture } from './fixtures/release-v5-platform.mjs';
import { validateReleaseEvidence } from '../scripts/a1-a4-contract-v3.mjs';
import { packCompatibility, compatibilityAt } from '../scripts/release-v5/compatibility.mjs';

const releaseId = '00000000-0000-4000-8000-000000000123';
const before = baselineFunctions();
const staged = before.filter(v=>FUNCTIONS.includes(v.slug)).map(v=>({ ...v, version:10, ezbr_sha256:'a'.repeat(64), verify_jwt:v.slug==='mercadopago-refund', updated_at:v.updated_at+1000 }));
const after = before.map(v=>staged.find(s=>s.slug===v.slug)||v);
const inert = () => ({ schema_ok:true, paused:true, drained:true, counts:Object.fromEntries([...EMPTY_TABLES,'settings','sellers','oauth_states','pg_net_pending','scheduler_active','dispatcher_active'].map(k=>[k,0])) });

for (const project of ['',undefined,'ukxqbgswjlibmnjemrzd','yakhtrkukqlgzvxuvhzs','wrong',PROJECT+' ']) test(`reject project ${String(project)}`,()=>{
  assert.throws(()=>argumentsFor(project===undefined?[]:['--project-ref',project,'--dry-run']));
});
for (const flag of ['--skip-db','--mock-financial','--release-evidence','--prune','--force','--dry-run=false']) test(`reject bypass argument ${flag}`,()=>{
  assert.throws(()=>argumentsFor(['--project-ref',PROJECT,flag]));
});
for (const mode of ['expand','quiesce','release','recover','verify','attest','contract','resume','abort']) test(`${mode} needs explicit project confirmation`,()=>{
  assert.throws(()=>argumentsFor(['--project-ref',PROJECT,'--mode',mode,'--release-id',releaseId]));
});
test('exact pinned equivalent uses supported jobs+API and exact function set',()=>{
  assert.deepEqual(cliDeployArgs(PROJECT),['functions','deploy',...FUNCTIONS,'--project-ref',PROJECT,'--use-api','--jobs','3']);
});

for (const host of ['localhost','127.0.0.1','db.ukxqbgswjlibmnjemrzd.supabase.co','db.wwcpogltfgzgkrlilbcd.supabase.co.evil.invalid']) test(`reject wrong database ${host}`,()=>{
  assert.throws(()=>databaseConfiguration(`postgresql://postgres:fixture@${host}:5432/postgres`));
});
for (const suffix of [':6543/postgres',':5432/other',':5432/postgres?sslmode=disable',':5432/postgres?host=evil']) test(`reject database override ${suffix}`,()=>{
  assert.throws(()=>databaseConfiguration(`postgresql://postgres:fixture@db.${PROJECT}.supabase.co${suffix}`));
});
test('direct target requires TLS verification and explicit password',()=>{
  const result=databaseConfiguration(`postgresql://postgres:fixture@db.${PROJECT}.supabase.co/postgres`);
  assert.equal(result.ssl.rejectUnauthorized,true); assert.equal(result.port,5432);
  assert.throws(()=>databaseConfiguration(`postgresql://postgres@db.${PROJECT}.supabase.co/postgres`));
});
test('session pooler requires project-qualified user',()=>{
  assert.doesNotThrow(()=>databaseConfiguration(`postgresql://postgres.${PROJECT}:fixture@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`));
  assert.throws(()=>databaseConfiguration('postgresql://postgres.wrong:fixture@aws-0-sa-east-1.pooler.supabase.com:5432/postgres'));
});
for (const key of Object.keys(inert().counts)) test(`inertness rejects ${key}`,()=>{
  const v=inert();v.counts[key]=1;assert.throws(()=>assertInert(v),new RegExp(key));
});
for (const bad of [null,{},'0','0garbage',-1,NaN,0.5]) test(`counts fail closed: ${String(bad)}`,()=>{
  const v=inert();v.counts.payment_intents=bad;assert.throws(()=>assertInert(v));
});
for (const key of ['schema_ok','paused','drained']) test(`inertness requires ${key}`,()=>{
  const v=inert();v[key]=false;assert.throws(()=>assertInert(v));
});
test('incomplete/unknown schema snapshot fails closed',()=>{
  const v=inert();delete v.counts.payment_cancellations;assert.throws(()=>assertInert(v));
  v.counts.unknown_provider_work=0;assert.throws(()=>assertInert(v));
});

for (const count of [0,1,2]) test(`${count}/3 cannot verify a release`,()=>{
  const partial=before.map(v=>staged.slice(0,count).find(s=>s.slug===v.slug)||v);
  assert.throws(()=>verifyRelease(before,staged,partial));
});
test('3/3 newly reserved versions are required and accepted',()=>assert.deepEqual(verifyRelease(before,staged,after),inventory(after)));
test('optional staging metadata is not invented; complete live metadata remains mandatory',()=>{
  const minimal=staged.map(({ezbr_sha256:hash,entrypoint_path:entry,created_at:created,updated_at:updated,...rest})=>rest);
  assert.doesNotThrow(()=>verifyRelease(before,minimal,after));
  assert.throws(()=>verifyRelease(before,minimal,after.map(v=>({...v,ezbr_sha256:undefined}))));
});
test('unchanged V9 cannot be its own new release',()=>assert.throws(()=>verifyRelease(before,before.filter(v=>FUNCTIONS.includes(v.slug)),before)));
for (const field of ['id','slug','name','version','ezbr_sha256','verify_jwt','entrypoint_path','updated_at','created_at','status']) test(`remote verification binds ${field}`,()=>{
  const wrong=structuredClone(after),row=wrong.find(v=>v.slug===FUNCTIONS[0]);
  row[field]=field==='version'?44:field==='updated_at'?1:field==='verify_jwt'?true:'wrong';
  assert.throws(()=>verifyRelease(before,staged,wrong));
});
for (const value of [[],null,{},[...after,after[0]],after.slice(1)]) test('remote cardinality/duplicates are rejected',()=>assert.throws(()=>inventory(value)));
test('unrelated function change aborts release',()=>{
  const wrong=structuredClone(after);wrong.find(v=>!FUNCTIONS.includes(v.slug)).version++;assert.throws(()=>verifyRelease(before,staged,wrong));
});
test('wrong third function and missing stage response fail',()=>{
  assert.throws(()=>verifyRelease(before,staged.slice(0,2),after));
  assert.throws(()=>verifyRelease(before,[...staged.slice(0,2),before.find(v=>v.slug==='mercadopago-webhook')],after));
});
test('number-like strings are not trusted remote versions',()=>assert.throws(()=>remoteFunction({...before[0],version:'9'})));
test('DB/project challenge cannot accept a missing or unrelated backend',async()=>{
  const {platform}=platformFixture();await assert.rejects(platform.bindSession({pid:1,applicationName:'nonce'},true));
});
test('wrong remote project rejected',async()=>{
  const {platform,state}=platformFixture();state.wrongProject='other';await assert.rejects(platform.project());
});
test('forged V4 JSON is never CONTRACT proof',()=>{
  assert.throws(()=>validateReleaseEvidence({result:'SUCCESS',project_ref:PROJECT,edge_functions:FUNCTIONS,release_identity:'a',partial_release:false,dry_run:false}));
});
test('compact schema oracle reconstructs every ordered stage and retirement without mutating its base',()=>{
  const stages=Array.from({length:5},(_,i)=>({major:17,functions:{common:'stable',[`phase_${i}`]:String(i)},tables:{ledger:String(i)}}));
  const contract={major:17,functions:{common:'stable',retired:'closed'},tables:{ledger:'4'}};
  const specification=packCompatibility(stages,contract),original=structuredClone(specification);
  for(let i=0;i<5;i++)assert.deepEqual(compatibilityAt(specification,i),stages[i]);
  assert.deepEqual(compatibilityAt(specification,4,true),contract);
  assert.deepEqual(specification,original);
});

test('runtime graph includes omitted dependencies and excludes tests',async()=>{
  const built=await buildSources();
  const inputs=Object.values(built.outputs).flatMap(v=>v.inputs);
  assert.ok(inputs.includes('supabase/functions/_shared/payment-worker-signature.ts'));
  assert.ok(inputs.includes('supabase/functions/_shared/seller-oauth-crypto.ts'));
  assert.ok(inputs.some(v=>v.includes('node_modules/@supabase/supabase-js')));
  assert.ok(!inputs.some(v=>/\.deno\.ts$|tests\//.test(v)));
  assert.notEqual(markedSource(built,FUNCTIONS[0],releaseId),markedSource(built,FUNCTIONS[0],releaseId.replace(/123$/,'124')));
});
test('shared runtime edit changes identity; test-only edit does not',async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'taba-v5-identity-'));
  try {
    fs.cpSync(path.join(ROOT,'supabase/functions'),path.join(tmp,'supabase/functions'),{recursive:true});
    fs.copyFileSync(path.join(ROOT,'supabase/config.toml'),path.join(tmp,'supabase/config.toml'));
    fs.copyFileSync(path.join(ROOT,'package-lock.json'),path.join(tmp,'package-lock.json'));
    const original=await buildSources();
    const packages=new Set(Object.values(original.outputs).flatMap(v=>v.inputs).filter(v=>v.startsWith('node_modules/')).map(v=>v.match(/^(node_modules\/(?:@[^/]+\/)?[^/]+)/)[1]));
    for(const pkg of packages) fs.cpSync(path.join(ROOT,pkg),path.join(tmp,pkg),{recursive:true});
    const a=await buildSources(tmp);
    fs.appendFileSync(path.join(tmp,'supabase/functions/_shared/refund-runtime.deno.ts'),'\n// a test-only edit\n');
    assert.equal((await buildSources(tmp)).sourceIdentity,a.sourceIdentity);
    fs.appendFileSync(path.join(tmp,'supabase/functions/_shared/seller-oauth-crypto.ts'),'\nconsole.info("runtime change");\n');
    const b=await buildSources(tmp);assert.notEqual(b.sourceIdentity,a.sourceIdentity);
    fs.appendFileSync(path.join(tmp,'supabase/functions/mercadopago-payment-worker/index.ts'),'\nconsole.info("entrypoint change");\n');
    assert.notEqual((await buildSources(tmp)).sourceIdentity,b.sourceIdentity);
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
});
test('dry-run cannot reach fetch, DB, deploy, or evidence writers',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=()=>{throw new Error('EXTERNAL_IO_FORBIDDEN');};
  const status=execFileSync('git',['status','--porcelain=v1'],{cwd:ROOT,encoding:'utf8'});
  const log=console.log;console.log=()=>{};
  try { const result=await main(['--project-ref',PROJECT,'--dry-run']);assert.equal(result.mutations,0);assert.equal(result.production_checks,'NOT_EXECUTED'); }
  finally { globalThis.fetch=previous;console.log=log; }
  assert.equal(execFileSync('git',['status','--porcelain=v1'],{cwd:ROOT,encoding:'utf8'}),status);
  assert.equal(fs.existsSync(path.join(ROOT,'artifacts/codex/A1_A4_EDGE_RELEASE_EVIDENCE.json')),false);
});
test('financial CI is explicit, rejects fork/retry and never cancels an active release',()=>{
  const financial=fs.readFileSync(path.join(ROOT,'.github/workflows/release-edge-production.yml'),'utf8');
  const trigger=financial.slice(financial.indexOf('\non:'),financial.indexOf('\npermissions:'));
  assert.match(trigger,/workflow_dispatch:/);assert.doesNotMatch(trigger,/workflow_run:|push:|pull_request:|schedule:/);
  assert.match(financial,/github.repository == 'bitflowapp\/la-taba-pages-preview'/);
  assert.match(financial,/github.run_attempt == 1/);assert.match(financial,/cancel-in-progress: false/);
  assert.match(financial,/project_confirmation:/);assert.match(financial,/\$PROJECT_CONFIRMATION.*wwcpogltfgzgkrlilbcd/);
  for(const file of ['ci.yml','deploy-production.yml','preview-pages.yml']){
    const body=fs.readFileSync(path.join(ROOT,'.github/workflows',file),'utf8');
    assert.doesNotMatch(body,/release-edge-production\.mjs|functions deploy|a1-a4-contract-v3\.mjs|ci-entry\.mjs/);
  }
});

test('later unapplied application migrations do not shift reviewed financial stages', async () => {
  const { EXPAND, reviewedMigrationStage } = await import('../scripts/release-v5/model.mjs');
  const old = ['20260101000000'];
  const expand = EXPAND.map(name => name.slice(0, 14));
  const local = [...old, ...expand, '20260913011340'];
  for (let stage = 0; stage <= 4; stage++) assert.equal(reviewedMigrationStage(local, [...old, ...expand.slice(0, stage)]), stage);
  assert.throws(() => reviewedMigrationStage(local, local), /reviewed V5/);
  assert.throws(() => reviewedMigrationStage(local, [old[0], expand[1]]), /history/);
  assert.throws(() => reviewedMigrationStage([old[0], expand[1], expand[0], ...expand.slice(2)], old), /order/);
});
