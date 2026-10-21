import fs from 'node:fs';import {withRecoveryProject} from './hosted-client.mjs';
import {ROOT} from './plan.mjs';
import path from 'node:path';
const value=name=>process.argv[process.argv.indexOf(name)+1];
if(!['--target','--evidence-directory','--run-tests'].every(a=>process.argv.includes(a)))throw Error('Requires --run-tests --target --evidence-directory');
const dir=path.resolve(value('--evidence-directory'));fs.mkdirSync(dir,{recursive:true});const target=JSON.parse(fs.readFileSync(value('--target')));
await withRecoveryProject(target,async({query,request})=>{
const proof={at:new Date().toISOString(),projectRef:target.projectRef,tests:[]};
// --files a.sql,b.sql runs only those suites (every suite rolls back its fixtures).
const defaults=['mercadopago_checkout_pro.local.sql','mercadopago_seller_oauth.local.sql','mercadopago_availability_requires_seller.local.sql','mercadopago_operator_switch.local.sql','mercadopago_seller_cannot_charge_alert.local.sql','mercadopago_safe_disconnect.local.sql'];
const files=process.argv.includes('--files')?value('--files').split(',').map(f=>f.trim()).filter(f=>/^[a-z0-9_]+(\.local)?\.sql$/.test(f)):defaults;
for(const file of files){let sql=fs.readFileSync(path.join(ROOT,'supabase/tests',file),'utf8');let expected=null;
if(sql.includes('select plan(')){
expected=Number(/select plan\((\d+)\)/.exec(sql)[1]);
sql=sql.replace('begin;',"begin; set local search_path=public,extensions; create temp table recovery_tap(line text);");
sql=sql.replace(/^select ((?:ok|is|isnt|like|unlike|throws_ok|lives_ok|cmp_ok)\([\s\S]*?);/gm,'insert into recovery_tap(line) select $1;');
sql=sql.replace(/select \* from finish\(\);/,"do $tap_assert$ begin if (select count(*) from recovery_tap) <> "+expected+" or exists(select 1 from recovery_tap where line like 'not ok%') then raise exception 'HOSTED_TAP_FAILED: %',(select jsonb_agg(line) from recovery_tap);end if;end $tap_assert$;");
}
try{await query(sql);proof.tests.push({file,passed:true,assertions:expected,provider:'simulated SQL inputs; hosted PostgreSQL',transaction:'rolled_back'});}
catch(e){proof.tests.push({file,passed:false,error:e.message});}
fs.writeFileSync(dir+'/hosted-sql-tests.json',JSON.stringify(proof,null,2));console.log(proof.tests.at(-1));
}
const checks={
ledger:'select count(*)::int as migrations from private.la_taba_recovery_migrations',
source:'select source_table,count(*)::int rows from private.la_taba_recovery_source_rows group by source_table order by source_table',
publicCounts:'select (select count(*) from auth.users)::int users,(select count(*) from public.products)::int products,(select count(*) from public.orders)::int orders,(select count(*) from public.payment_intents)::int payment_intents',
rls: `select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','catalog_admin') and c.relkind='r' and not c.relrowsecurity`,
views: `select schemaname,viewname from pg_views v where v.schemaname='public' and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=v.schemaname and c.relname=v.viewname and not(coalesce(c.reloptions,'{}') @> array['security_invoker=true']))`,
storage:'select id,public,file_size_limit,allowed_mime_types from storage.buckets order by id',
realtime: `select pubname,schemaname,tablename from pg_publication_tables where pubname='supabase_realtime' order by schemaname,tablename`,
commerce:'select id,status,ordering_enabled,ordering_verified from public.businesses',
settings:'select enabled,environment from public.business_payment_settings',
cron: `select jobname,active from cron.job where jobname like 'taba-%'`,
sourceGrants: `select has_table_privilege('anon','private.la_taba_recovery_source_rows','select') anon_select,has_table_privilege('authenticated','private.la_taba_recovery_source_rows','select') authenticated_select`
};proof.checks={};for(const [key,sql]of Object.entries(checks)){try{proof.checks[key]=await query(sql)}catch(e){proof.checks[key]={error:e.message}}}
const security=await request('/advisors/security?lint_type=sql');fs.writeFileSync(dir+'/hosted-security-advisors.json',JSON.stringify(security,null,2));proof.advisors={errors:security.lints.filter(l=>l.level==='ERROR').length,warnings:security.lints.filter(l=>l.level==='WARN').length,info:security.lints.filter(l=>l.level==='INFO').length};
fs.writeFileSync(dir+'/hosted-sql-tests.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof.checks));console.log(proof.advisors);if(proof.tests.some(t=>!t.passed))process.exitCode=1;
});