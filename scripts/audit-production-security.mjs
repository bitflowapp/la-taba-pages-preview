// Retrato de seguridad de una base de TABA: RLS, policies, SECURITY DEFINER,
// privilegios, extensiones, storage y recuento de datos reales.
//
// Corre contra dos destinos con el mismo cuestionario, para que el drift se
// pueda medir comparando dos retratos:
//
//   node scripts/audit-production-security.mjs --target shadow
//   node scripts/audit-production-security.mjs --target production
//
// Contra produccion usa el endpoint oficial de consulta de la Management API y
// exige SUPABASE_ACCESS_TOKEN en el entorno. Todas las consultas son de lectura.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const STAGING_REF = 'ukxqbgswjlibmnjemrzd';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const target = arg('target') || 'shadow';
if (!['shadow', 'production'].includes(target)) {
  console.error('--target debe ser shadow o production'); process.exit(2);
}

const ref = arg('ref') || PRODUCTION_REF;
if (target === 'production') {
  if (ref === STAGING_REF) { console.error('ABORTADO: el destino es STAGING'); process.exit(2); }
  if (ref !== PRODUCTION_REF) { console.error(`ABORTADO: ${ref} no es el production de TABA`); process.exit(2); }
}

const container = process.env.TABA_SHADOW_CONTAINER || 'taba2-prod-shadow';
const dockerBin = process.platform === 'win32' ? 'docker.exe' : 'docker';

// Toda consulta devuelve una sola celda de texto con un JSON array.
function wrap(sql) {
  return `select coalesce(json_agg(t), '[]'::json)::text as payload from (${sql}) t;`;
}

async function ask(sql) {
  const wrapped = wrap(sql);
  if (target === 'shadow') {
    const out = execFileSync(dockerBin,
      ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
      { input: wrapped, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(out.trim() || '[]');
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) { console.error('falta SUPABASE_ACCESS_TOKEN'); process.exit(2); }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: wrapped }),
  });
  if (!res.ok) { console.error(`HTTP ${res.status}: ${await res.text()}`); process.exit(3); }
  const rows = await res.json();
  return JSON.parse(rows[0]?.payload ?? '[]');
}

const Q = {
  counts: `
    select
      (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')) as tables,
      (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m')) as views,
      (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') as functions,
      (select count(*) from pg_policies where schemaname='public') as policies,
      (select count(*) from pg_indexes where schemaname='public') as indexes,
      (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal) as triggers,
      (select count(distinct t.oid) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e') as enums,
      (select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public') as constraints
  `,

  // FASE 21 - RLS por tabla.
  rls: `
    select c.relname as table_name,
           c.relrowsecurity as rls_enabled,
           c.relforcerowsecurity as rls_forced,
           (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind in ('r','p')
     order by c.relname
  `,

  // FASE 24 - privilegios de tabla para los roles que llegan desde el navegador.
  tableGrants: `
    select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
      from information_schema.role_table_grants
     where table_schema='public' and grantee in ('anon','authenticated','PUBLIC')
     group by table_name, grantee
     order by grantee, table_name
  `,

  // Privilegios POR COLUMNA. Sin esto la foto miente: `businesses` no tiene
  // grant de tabla para anon y sin embargo anon lee 12 columnas de vitrina.
  // Un `count(*)` pasa con una sola columna concedida, asi que medir a nivel
  // tabla da un falso "sin acceso".
  columnGrants: `
    select grantee, table_name,
           string_agg(column_name || ':' || privilege_type, ',' order by column_name, privilege_type) as grants
      from information_schema.role_column_grants g
     where table_schema='public' and grantee in ('anon','authenticated','PUBLIC')
       and not exists (
         select 1 from information_schema.role_table_grants t
          where t.table_schema='public' and t.table_name=g.table_name
            and t.grantee=g.grantee and t.privilege_type=g.privilege_type)
     group by grantee, table_name
     order by grantee, table_name
  `,

  // FASE 23 - funciones SECURITY DEFINER y su search_path.
  securityDefiner: `
    select p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args,
           r.rolname as owner,
           coalesce(array_to_string(p.proconfig, ' | '), '(sin search_path fijado)') as config,
           has_function_privilege('anon', p.oid, 'execute') as anon_execute,
           has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute
      from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      join pg_roles r on r.oid=p.proowner
     where n.nspname='public' and p.prosecdef
     order by p.proname
  `,

  // FASE 22 - superficie invocable sin autenticar.
  anonExecutable: `
    select p.proname as name, p.prosecdef as security_definer
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute')
     order by p.proname
  `,

  schemaGrants: `
    select n.nspname as schema_name, r.rolname as grantee,
           has_schema_privilege(r.rolname, n.nspname, 'USAGE') as usage,
           has_schema_privilege(r.rolname, n.nspname, 'CREATE') as create_priv
      from pg_namespace n
      cross join (select unnest(array['anon','authenticated','service_role','public']) as rolname) r
     where n.nspname in ('public','extensions','storage','auth','vault')
     order by n.nspname, r.rolname
  `,

  extensions: `
    select e.extname as name, n.nspname as schema_name, e.extversion as version
      from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by e.extname
  `,

  // FASE 28 - storage.
  buckets: `
    select id, name, public, file_size_limit,
           coalesce(array_to_string(allowed_mime_types, ','), '') as mime_types
      from storage.buckets order by id
  `,

  storagePolicies: `
    select tablename as table_name, policyname as policy, roles::text as roles, cmd
      from pg_policies where schemaname='storage' order by tablename, policyname
  `,
};

const portrait = { target, ref: target === 'production' ? ref : container, capturedAt: new Date().toISOString() };

for (const [key, sql] of Object.entries(Q)) {
  try {
    portrait[key] = await ask(sql);
  } catch (error) {
    portrait[key] = { error: String(error.message || error).slice(0, 300) };
  }
}

// FASE 33 - recuento de datos reales. Se cuenta cada tabla de negocio que exista.
const businessTables = ['businesses', 'customers', 'customer_profiles', 'orders', 'order_items',
  'riders', 'rider_assignments', 'rider_order_offers', 'payments', 'payment_intents',
  'rider_locations', 'products', 'catalog_assets', 'business_members', 'identities'];
const existing = (portrait.rls || []).map((r) => r.table_name);
const countable = businessTables.filter((t) => existing.includes(t));
if (countable.length > 0) {
  const union = countable.map((t) => `select '${t}' as table_name, count(*)::bigint as rows from public.${t}`).join(' union all ');
  portrait.dataCounts = await ask(`${union} order by table_name`);
}

// Toda tabla de public con filas, sea o no de la lista anterior.
portrait.nonEmptyTables = await ask(`
  select relname as table_name, n_live_tup as approx_rows
    from pg_stat_user_tables where schemaname='public' and n_live_tup > 0
   order by n_live_tup desc
`);

const out = path.join(root, 'artifacts', 'production-supabase', `SECURITY-PORTRAIT-${target}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(portrait, null, 2)}\n`);

// --- resumen legible ----------------------------------------------------------
const c = portrait.counts?.[0] ?? {};
const rlsOff = (portrait.rls || []).filter((r) => !r.rls_enabled);
const noPolicy = (portrait.rls || []).filter((r) => r.rls_enabled && Number(r.policies) === 0);
const definerNoPath = (portrait.securityDefiner || []).filter((f) => !String(f.config).includes('search_path'));
const anonWrite = (portrait.tableGrants || []).filter((g) => g.grantee === 'anon' && /INSERT|UPDATE|DELETE|TRUNCATE/.test(g.privileges));
const publicGrants = (portrait.tableGrants || []).filter((g) => g.grantee === 'PUBLIC');
const publicCreate = (portrait.schemaGrants || []).filter((g) => g.schema_name === 'public' && g.create_priv && g.grantee !== 'service_role');

console.log(`--- RETRATO: ${target} (${portrait.ref}) ---`);
console.log(`  tablas ${c.tables}  vistas ${c.views}  funciones ${c.functions}  policies ${c.policies}`);
console.log(`  indices ${c.indexes}  triggers ${c.triggers}  enums ${c.enums}  constraints ${c.constraints}`);
console.log(`\n  RLS`);
console.log(`    tablas sin RLS            : ${rlsOff.length}${rlsOff.length ? ' -> ' + rlsOff.map((r) => r.table_name).join(', ') : ''}`);
console.log(`    con RLS y sin policy      : ${noPolicy.length}${noPolicy.length ? ' -> ' + noPolicy.map((r) => r.table_name).join(', ') : ''}`);
console.log(`\n  SECURITY DEFINER`);
console.log(`    total                     : ${(portrait.securityDefiner || []).length}`);
console.log(`    sin search_path fijado    : ${definerNoPath.length}${definerNoPath.length ? ' -> ' + definerNoPath.map((f) => f.name).join(', ') : ''}`);
console.log(`    ejecutables por anon      : ${(portrait.securityDefiner || []).filter((f) => f.anon_execute).length}`);
console.log(`\n  PRIVILEGIOS`);
console.log(`    anon con escritura        : ${anonWrite.length}${anonWrite.length ? ' -> ' + anonWrite.map((g) => `${g.table_name}(${g.privileges})`).join(', ') : ''}`);
for (const g of portrait.columnGrants || []) {
  const cols = g.grants.split(',').length;
  console.log(`    por columna               : ${g.grantee} -> ${g.table_name} (${cols} grants de columna)`);
}
console.log(`    grants a PUBLIC           : ${publicGrants.length}`);
console.log(`    CREATE en schema public   : ${publicCreate.length ? publicCreate.map((g) => g.grantee).join(', ') : 'ninguno'}`);
console.log(`\n  STORAGE`);
console.log(`    buckets                   : ${(portrait.buckets || []).length}${(portrait.buckets || []).map((b) => ` [${b.id} public=${b.public}]`).join('')}`);
console.log(`    policies en storage       : ${(portrait.storagePolicies || []).length}`);
console.log(`\n  DATOS`);
console.log(`    tablas con filas          : ${(portrait.nonEmptyTables || []).length}`);
for (const t of portrait.nonEmptyTables || []) console.log(`      ${t.table_name}: ${t.approx_rows}`);
console.log(`\n  retrato: ${out}`);
