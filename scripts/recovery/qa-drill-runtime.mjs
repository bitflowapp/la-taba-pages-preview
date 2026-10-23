import fs from 'node:fs';
import { Client } from 'pg';
import { withRecoveryProject } from './hosted-client.mjs';
import { drillRun, saveRun, validateRun, cleanupSql, withDrillFixture } from './qa-drill-fixture.mjs';
import { psqlRaw, PORT } from '../local-db/lib.mjs';

const arg = name => { const i=process.argv.indexOf(name); return i<0?null:process.argv[i+1]; };
export async function runDrill(kind, action) {
  const file=arg('--run-file'), local=process.argv.includes('--local');
  const cleanup=process.argv.includes('--cleanup-only');
  if(!file) throw Error('--run-file <new receipt outside repo> is required; reuse it with --cleanup-only after interruption');
  const run=cleanup?validateRun(JSON.parse(fs.readFileSync(file,'utf8'))):drillRun(kind);
  if(run.kind!==kind) throw Error('Wrong drill kind');
  if(!cleanup) saveRun(file,run);
  const execute=async query=>{
    if(cleanup) return query(cleanupSql(run));
    return withDrillFixture(query,run,()=>action({query,run,local,
      // Isolated mode advances the SQL scheduler explicitly; hosted mode waits
      // for actual cron + Edge, and never claims that a local stub proves them.
      tick:async sql=>{ if(local) await query(sql); },
      sleep:ms=>local?Promise.resolve():new Promise(resolve=>setTimeout(resolve,ms)) }));
  };
  console.log(JSON.stringify({phase:'drill-run',runId:run.runId,mode:local?'isolated PostgreSQL, simulated scheduler/provider':'hosted QA, simulated provider',receipt:file}));
  if(local) {
    const database=`taba_local_drill_${run.tag}`;
    const marker=`qa-drill:${run.runId}`;
    const existing=psqlRaw('postgres',`select coalesce(shobj_description(oid,'pg_database'),'') from pg_database where datname='${database}'`,{tuples:true}).stdout.trim();
    if(cleanup) {
      if(existing && existing!==marker) throw Error('Refusing database cleanup without this run marker');
      // Refuse an unmarked database too, even if its name happens to match.
      const count=psqlRaw('postgres',`select count(*) from pg_database where datname='${database}'`,{tuples:true}).stdout.trim();
      if(count==='1' && existing!==marker) throw Error('Unmarked database requires manual review');
      if(count==='1') psqlRaw('postgres',`drop database ${database} with (force);`);
      return;
    }
    const template=process.env.TABA_LOCAL_DB || 'taba_local_base';
    if(!/^taba_local_[a-z0-9_]+$/.test(template)) throw Error('Local disposable template required');
    psqlRaw('postgres',`create database ${database} template ${template}; comment on database ${database} is '${marker}';`);
    const client=new Client({host:'127.0.0.1',port:PORT,user:'postgres',database,password:'',ssl:false,connectionTimeoutMillis:5000});
    try { await client.connect(); await execute(async sql=>(await client.query(sql)).rows); }
    finally { await client.end(); psqlRaw('postgres',`drop database ${database} with (force);`); }
  } else {
    const target=JSON.parse(fs.readFileSync(arg('--target') || 'deploy/recovery-free-hosted.json','utf8'));
    if(target.projectRef!=='ixewllzzuzpqrkxzmfzx'||target.environment!=='test'||target.commercialPaymentsEnabled!==false) throw Error('Exact QA project only');
    await withRecoveryProject(target,({query})=>execute(query));
  }
  console.log(JSON.stringify({phase:'drill-closed',runId:run.runId,syntheticRowsRemoved:true}));
}
