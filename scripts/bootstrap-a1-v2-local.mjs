import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
// Fresh disposable cluster only; no reset/drop and no migration to a hosted DB.
const c=process.argv[2];
if(process.env.TABA_LOCAL_PAYMENT_DB!=='1'||!/^taba-a1-a4-local-[\w-]+$/.test(c||''))throw Error('Explicit disposable local DB required');
const info=JSON.parse(execFileSync('docker',['inspect',c],{encoding:'utf8'}))[0];
if(info.HostConfig.NetworkMode!=='none'||info.Mounts.some(m=>m.Type==='bind'))throw Error('Unsafe DB');
const sql=s=>execFileSync('docker',['exec','-i',c,'psql','-h','/tmp','-U','postgres','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'],{input:'set search_path=public,extensions;\n'+s,encoding:'utf8',stdio:['pipe','pipe','pipe']});
for(let i=0;;i++) {
 try {execFileSync('docker',['exec',c,'pg_isready','-h','/tmp','-U','postgres'],{stdio:'ignore'});break;}
 catch(e){if(i===100)throw e;await new Promise(r=>setTimeout(r,200));}
}
try {
sql(`create role anon; create role authenticated; create role service_role bypassrls;
 create role supabase_auth_admin; create role supabase_storage_admin;
 create schema extensions; create extension pgcrypto with schema extensions;
 grant usage on schema extensions to anon,authenticated,service_role;
 create schema vault;`);
// Repository-owned fixture; never borrow another project's schema or cluster.
sql(fs.readFileSync('supabase/tests/fixtures/a1-platform-auth.sql','utf8'));
sql(`create schema if not exists storage;
 create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table if not exists storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;`);
sql(`grant usage on schema auth,storage to anon,authenticated,service_role;
 grant all on all tables in schema auth,storage to service_role;
 alter default privileges in schema public grant all on tables to service_role;
 alter default privileges in schema public grant all on sequences to service_role;`);
let count=0;
for(const p of fs.readdirSync('supabase/migrations').filter(p=>p.endsWith('.sql')).sort()) {
 if(p>='20260908164550')break;
 console.log(p); sql(fs.readFileSync('supabase/migrations/'+p,'utf8')); count++;
}
console.log('OLD_DB_MIGRATIONS='+count);
}catch(e){console.error(e.stderr?.toString()||e);process.exitCode=1;}
