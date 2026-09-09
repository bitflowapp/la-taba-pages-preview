// Production inspection ONLY. Every database query is inside READ ONLY; no
// financial RPC, Edge invocation, scheduler change, or deployment is exposed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { conToken } from './lib/supabase-cli-token.mjs';
import { Platform } from './release-v5/platform.mjs';
import { compatibilitySnapshot, compatibilityAt } from './release-v5/compatibility.mjs';
import { PROJECT, ROOT, EMPTY_TABLES } from './release-v5/model.mjs';

await conToken(async token=>{
  const platform=new Platform(token);await platform.project();
  const query=async(sql,params=[])=>{
    if(params.length){
      assert.equal(params.length,1);assert.ok(params[0].every(v=>/^[a-z_]+$/.test(v)));
      sql=sql.replace('$1::text[]',`array[${params[0].map(v=>`'${v}'`).join(',')}]::text[]`);
    }
    const rows=await platform.request(`projects/${PROJECT}/database/query`,{method:'POST',status:201,
      body:{query:`begin read only; set local search_path=pg_catalog,public,extensions; ${sql}; commit;`}});
    assert.equal(rows.length,1);return Object.values(rows[0])[0];
  };
  const actual=await compatibilitySnapshot({value:query});
  const expected=compatibilityAt(JSON.parse(fs.readFileSync(path.join(ROOT,'scripts/release-v5/compatibility.json'),'utf8')),0);
  const difference={};
  for(const category of ['functions','tables'])difference[category]=[...new Set([...Object.keys(expected[category]),...Object.keys(actual[category])])]
    .filter(key=>expected[category][key]!==actual[category][key]);
  const counts=await query(`select jsonb_build_object(${EMPTY_TABLES.map(table=>`'${table}',(select count(*) from public.${table})`).join(',')},
    'settings_enabled',(select count(*) from public.business_payment_settings where enabled),
    'connected_or_reauthorization_sellers',(select count(*) from public.mp_seller_connections where status<>'disconnected'),
    'seller_token_material',(select count(*) from public.mp_seller_connections where protected_tokens is not null or refresh_owner is not null or refresh_started_at is not null),
    'oauth_usable',(select count(*) from public.mp_oauth_states where expires_at>clock_timestamp()),
    'oauth_expired',(select count(*) from public.mp_oauth_states where expires_at<=clock_timestamp()),
    'pg_net_pending',(select count(*) from net.http_request_queue),
    'pg_net_recent_responses',(select count(*) from net._http_response where created>clock_timestamp()-interval '430 seconds'),
    'migration_count',(select count(*) from supabase_migrations.schema_migrations),
    'last_migration',(select max(version) from supabase_migrations.schema_migrations),
    'v3_absent',to_regclass('private.deployment_drain_attestations') is null,
    'v5_absent',to_regclass('private.a1_a4_releases_v5') is null)`);
  console.log(JSON.stringify({project:PROJECT,read_only:true,observed_at:new Date().toISOString(),old_schema_difference:difference,counts,
    functions:(await platform.inventory()).map(v=>({slug:v.slug,id:v.id,version:v.version,updated_at:v.updated_at,ezbr_sha256:v.ezbr_sha256}))},null,2));
  assert.equal(actual.major,expected.major);assert.deepEqual(difference,{functions:[],tables:[]},'production OLD schema differs from reviewed base');
  for(const key of [...EMPTY_TABLES,'settings_enabled','connected_or_reauthorization_sellers','seller_token_material','oauth_usable','pg_net_pending','pg_net_recent_responses'])assert.equal(counts[key],0,`production is not inert: ${key}`);
  assert.equal(counts.migration_count,122);assert.equal(counts.last_migration,'20260908070341');
  assert.equal(counts.v3_absent,true);assert.equal(counts.v5_absent,true);
});
