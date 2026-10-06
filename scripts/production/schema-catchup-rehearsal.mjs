// PRODUCCIÓN (wwcpogltfgzgkrlilbcd) · ENSAYO DE LA PUESTA AL DÍA DEL ESQUEMA
//
// Producción quedó atrás de `main`: las migraciones pendientes son las del contrato de
// Caja Clara, del Rider con disponibilidad compartida, del cobro manual y de la operación
// del comercio. Antes de aplicarlas, este ensayo demuestra con datos reales:
//
//   1. RESPALDO: pg_dump de producción bajo UN snapshot exportado (esquemas de la app +
//      auth.users/identities), escrito en un directorio PRIVADO fuera del repo,
//      con manifiesto (bytes, sha256, ledger, huella del esquema y hash por tabla).
//   2. RESTAURACIÓN: un cluster desechable SIN RED (la misma imagen de Postgres que usa
//      la plataforma), con las piezas de plataforma que un volcado no trae, y la copia
//      comparada contra la base viva categoría por categoría y tabla por tabla.
//   3. ATOMICIDAD: el bloque entero más un error al final deja la huella y los datos
//      idénticos a los de antes (una falla a mitad de camino no aplica nada).
//   4. APLICACIÓN: el bloque en una sola transacción como `postgres` no superusuario
//      (igual que la API de management), con el ledger escrito en la misma transacción.
//   5. DATOS: qué tablas cambian y, en pedidos/productos/negocios, qué columnas.
//   6. pgTAP canónico sobre la copia migrada (los mismos archivos que corre el gate).
//   7. HUELLA: la copia migrada contra una base construida desde cero con las migraciones
//      de `main` (TABA_FRESH_FINGERPRINT_OUT de scripts/run-release-v5-db.mjs).
//
// NO escribe nada en producción: la conexión viva es `read only` y el cluster no tiene red.
// No imprime credenciales ni filas; el informe lleva conteos, hashes y nombres de objetos.
//
//   node scripts/production/schema-catchup-rehearsal.mjs --workdir <dir enlazado a producción> \
//     --out-dir <dir privado fuera del repo> [--fresh-fingerprint <json>] [--bundle-out <sql>] [--keep]
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PROD_REF = 'wwcpogltfgzgkrlilbcd';
const IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.166';
const POOLER = 'aws-0-sa-east-1.pooler.supabase.com';
const args = process.argv.slice(2);
const opt = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const WORKDIR = opt('--workdir');
const OUT_DIR = path.resolve(opt('--out-dir', '.'));
const linkedRef = path.join(WORKDIR, 'supabase', '.temp', 'project-ref');
assert.ok(WORKDIR && fs.existsSync(linkedRef), 'WORKDIR_NOT_LINKED');
assert.equal(fs.readFileSync(linkedRef, 'utf8').trim(), PROD_REF, 'WORKDIR_NOT_LINKED_TO_PRODUCTION');
assert.ok(opt('--out-dir') && !OUT_DIR.toLowerCase().startsWith(ROOT.toLowerCase()), 'OUT_DIR_MUST_BE_OUTSIDE_REPO');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(OUT_DIR, `prod-${stamp}`);
fs.mkdirSync(dir, { recursive: true });
const log = (m) => process.stderr.write(`[rehearsal ${new Date().toISOString().slice(11, 19)}] ${m}\n`);
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

const FINGERPRINT = fs.readFileSync(path.join(ROOT, 'scripts/controlled-production/schema-fingerprint.sql'), 'utf8');
const SEARCH_PATH = 'set search_path to "$user", public, extensions';
const APP_CATEGORIES = ['tables', 'columns', 'constraints', 'indexes', 'functions', 'policies', 'triggers',
  'table_grants', 'column_grants', 'function_grants'];
const PLATFORM_CATEGORIES = ['cron_jobs', 'realtime_publication', 'storage_buckets'];
const SESSION = `set timezone = 'UTC'; set datestyle = 'ISO, MDY'; set intervalstyle = 'postgres';
  set extra_float_digits = 1; set bytea_output = 'hex'`;
const TABLES_SQL = `select format('%I.%I', n.nspname, c.relname) as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and (n.nspname in ('public','private','catalog_admin','supabase_migrations')
    or (n.nspname = 'auth' and c.relname in ('users','identities'))) order by 1`;
const ROW_DIFF_TABLES = ['public.orders', 'public.order_items', 'public.products', 'public.businesses',
  'public.business_members', 'public.order_events', 'public.catalog_assets'];
// Lo que el circuito de punta a punta necesita del esquema (Caja Clara, Rider, cobro manual).
const REQUIRED_RPCS = ['pos_get_catalog_state', 'pos_apply_stock_movements', 'pos_apply_stock_count', 'pos_list_orders',
  'pos_get_store_overview', 'transition_order', 'cancel_order', 'confirm_manual_order_payment', 'offer_order_to_rider',
  'confirm_business_delivery_code', 'set_business_open_state', 'identity_register_session', 'identity_close_own_session',
  'get_rider_delivery_board', 'accept_rider_order_offer', 'reject_rider_order_offer', 'mark_delivery_picked_up',
  'start_rider_delivery', 'mark_rider_arrived', 'confirm_delivery_code', 'publish_rider_location_fanout',
  'set_rider_availability', 'heartbeat_rider_availability', 'list_business_rider_availability', 'create_order_with_items'];
const CANONICAL_TESTS = ['business_windows_scanner_fiscal_test.sql', 'mercadopago_seller_oauth.local.sql',
  'mercadopago_clean_business.local.sql', 'fiscal_document_closure_test.sql', 'production_operations_control_plane_test.sql',
  'durable_offline_packing_test.sql', 'public_tracking_gps_quality_test.sql', 'business_timezone_windows_test.sql',
  'horario_24x7_test.sql', 'alta_propuesta_comercial_test.sql', 'production_least_privilege_test.sql',
  'business_self_delivery_test.sql', 'controlled_production_qa_window_test.sql', 'anon_internal_product_columns_test.sql',
  'mercadopago_availability_requires_seller.local.sql', 'payment_method_isolation.local.sql',
  'mercadopago_seller_cannot_charge_alert.local.sql', 'mercadopago_operator_switch.local.sql',
  'local_print_agent_test.sql', 'catalog_image_storage_test.sql', 'store_opening_readiness_test.sql',
  'commercial_publish_merchant_intent_test.sql', 'identity_alcohol_null_safe_test.sql',
  'fiscal_core_contract_test.sql', 'fiscal_receiver_vat_condition_test.sql',
  'commercial_order_fiscal_test.sql', 'fiscal_disaster_recovery_test.sql', 'fiscal_secret_boundary_test.sql',
  'fiscal_refund_separation_test.sql', 'owner_handover_test.sql', 'caja_clara_pos_integration_test.sql'];

// La CLI de Supabase crea un rol de acceso temporal (`cli_login_postgres`, miembro NOINHERIT de
// `postgres`, vence a los pocos minutos) sin pedir la contraseña de la base. Se toma de su
// script de volcado en seco y nunca se imprime.
function cliLogin() {
  const out = execFileSync('supabase.exe', ['db', 'dump', '--linked', '--workdir', WORKDIR, '--dry-run'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const get = (k) => (out.match(new RegExp(`export ${k}="([^"]*)"`)) || [])[1];
  const host = get('PGHOST'); const user = get('PGUSER'); const password = get('PGPASSWORD');
  assert.ok(host && user && password, 'CLI_LOGIN_UNAVAILABLE');
  assert.equal(host, `db.${PROD_REF}.supabase.co`, 'CLI_LOGIN_FOR_ANOTHER_PROJECT');
  return { user: `${user}.${PROD_REF}`, password };
}

const migrationFiles = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
const report = { at: new Date().toISOString(), ref: PROD_REF, image: IMAGE, backup: {}, restore: {}, pending: {}, atomicity: {},
  apply: {}, data: {}, pgtap: {}, compare: {}, checks: {} };

async function tableHashes(query) {
  await query(SESSION);
  const out = {};
  for (const { t } of await query(TABLES_SQL)) {
    const [row] = await query(`select count(*)::int as n, coalesce(md5(string_agg(h, ',' order by h)), '') as h
      from (select md5(x::text) as h from ${t} x) s`);
    out[t] = row;
  }
  return out;
}
async function fingerprint(query) {
  await query(SEARCH_PATH);
  return Object.fromEntries((await query(FINGERPRINT)).map((r) => [r.cat, { n: Number(r.n), hash: r.hash, items: r.items }]));
}
function diffCategory(a = { items: {} }, b = { items: {} }) {
  const ia = a.items || {}; const ib = b.items || {};
  return { onlyA: Object.keys(ia).filter((k) => !(k in ib)), onlyB: Object.keys(ib).filter((k) => !(k in ia)),
    changed: Object.keys(ia).filter((k) => k in ib && ia[k] !== ib[k]) };
}
function compareFingerprints(a, b, categories, limit = 40) {
  const out = {};
  for (const cat of categories) {
    const d = diffCategory(a[cat], b[cat]);
    const identical = !d.onlyA.length && !d.onlyB.length && !d.changed.length;
    out[cat] = { a: Object.keys(a[cat]?.items || {}).length, b: Object.keys(b[cat]?.items || {}).length, identical,
      ...(identical ? {} : { onlyA: d.onlyA.slice(0, limit), onlyB: d.onlyB.slice(0, limit), changed: d.changed.slice(0, limit),
        counts: { onlyA: d.onlyA.length, onlyB: d.onlyB.length, changed: d.changed.length } }) };
  }
  return out;
}

// ---------- cluster desechable SIN RED ----------
const container = `taba-prod-rehearsal-${process.pid}-${randomUUID().slice(0, 8)}`;
let started = false;
const docker = (dockerArgs, input) => execFileSync('docker', dockerArgs, { input, encoding: input === undefined || typeof input === 'string' ? 'utf8' : undefined,
  maxBuffer: 1024 * 1024 * 1024, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
function psql(sql, { user = 'postgres', allowError = false } = {}) {
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-h', '/tmp', '-U', user, '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0 && !allowError) throw Error(`PSQL_FAILED(${user}): ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
// Una consulta que devuelve filas, como JSON, a través de psql.
const labQuery = (user) => async (sql) => {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (/^(set|reset)\b/i.test(trimmed)) { labQuery.prefix = `${trimmed};\n`; return []; }
  const out = psql(`${labQuery.prefix || ''}select coalesce(json_agg(q), '[]'::json) from (${trimmed}) q;`, { user }).stdout.trim();
  return JSON.parse(out);
};
function restore(buffer, sections) {
  const r = spawnSync('docker', ['exec', '-i', container, 'pg_restore', '-h', '/tmp', '-U', 'supabase_admin', '-d', 'postgres',
    ...sections.map((s) => `--section=${s}`)], { input: buffer, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  const errors = (r.stderr || '').split(/\r?\n/).filter((l) => /error:/i.test(l));
  return { sections, status: r.status, errorCount: errors.length, errors: errors.slice(0, 20) };
}

const live = { client: null };
try {
  // ---------- 1. respaldo bajo un snapshot ----------
  const login = cliLogin();
  live.client = new pg.Client({ host: POOLER, port: 5432, user: login.user, password: login.password, database: 'postgres',
    ssl: { rejectUnauthorized: false }, statement_timeout: 120_000, connectionTimeoutMillis: 30_000 });
  await live.client.connect();
  await live.client.query('set role postgres');
  await live.client.query('begin isolation level repeatable read read only');
  const liveQuery = async (sql) => (await live.client.query(sql)).rows;
  const [snap] = await liveQuery(`select pg_export_snapshot() as s, now() as at, current_setting('server_version') as v,
    exists(select 1 from pg_namespace where nspname = 'catalog_admin') as has_catalog_admin`);
  report.backup.snapshotAt = snap.at; report.backup.serverVersion = snap.v;
  const pgDump = (file, selection) => {
    const r = spawnSync('docker', ['run', '--rm', '-e', 'PGPASSWORD', '-e', 'PGSSLMODE=require', '-e', 'PGCONNECT_TIMEOUT=30',
      '--entrypoint', 'pg_dump', IMAGE, '-h', POOLER, '-p', '5432', '-U', login.user, '-d', 'postgres', '--role=postgres',
      `--snapshot=${snap.s}`, '-Fc', '-Z', '6', ...selection],
    { env: { ...process.env, PGPASSWORD: login.password }, maxBuffer: 2 ** 31 - 1, windowsHide: true, timeout: 900_000 });
    if (r.status !== 0) throw Error(`PG_DUMP_FAILED:${file}:${String(r.stderr).split('\n').find((l) => /error/i.test(l)) || r.status}`);
    fs.writeFileSync(path.join(dir, file), r.stdout);
    return { file, bytes: r.stdout.length, sha256: sha(r.stdout), buffer: r.stdout };
  };
  const appSchemas = ['public', 'private', 'supabase_migrations', ...(snap.has_catalog_admin ? ['catalog_admin'] : [])];
  const appDump = pgDump('app.dump', appSchemas.flatMap((s) => ['-n', s]));
  const authDump = pgDump('auth.dump', ['-t', 'auth.users', '-t', 'auth.identities']);
  report.backup.files = [appDump, authDump].map(({ buffer, ...rest }) => rest);
  log(`dumps: app ${appDump.bytes} B, auth ${authDump.bytes} B`);
  const liveFp = await fingerprint(liveQuery);
  const liveData = await tableHashes(liveQuery);
  const liveLedger = (await liveQuery('select version from supabase_migrations.schema_migrations order by version')).map((r) => r.version);
  const platform = {
    cronJobs: await liveQuery('select jobname, schedule, command, active from cron.job order by jobname'),
    buckets: await liveQuery('select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by id'),
    storagePolicies: await liveQuery(`select policyname, tablename, cmd, permissive, roles::text[] as roles, qual, with_check
      from pg_policies where schemaname = 'storage' order by policyname`),
    publication: (await liveQuery(`select schemaname || '.' || tablename as t from pg_publication_tables
      where pubname = 'supabase_realtime' order by 1`)).map((r) => r.t),
    extensions: await liveQuery('select extname, extversion from pg_extension order by 1'),
  };
  const liveChecks = Object.fromEntries((await liveQuery(`select n.nspname || '.' || c.relname || '.' || co.conname as k,
      pg_get_constraintdef(co.oid) as def from pg_constraint co join pg_class c on c.oid = co.conrelid
      join pg_namespace n on n.oid = c.relnamespace where co.contype = 'c' and n.nspname in ('public','private','catalog_admin')`))
    .map((r) => [r.k, r.def]));
  await live.client.query('commit');
  await live.client.end(); live.client = null;
  report.backup.ledger = { count: liveLedger.length, head: liveLedger.at(-1) };
  report.backup.tables = Object.keys(liveData).length;
  report.backup.rows = Object.values(liveData).reduce((a, t) => a + t.n, 0);
  report.backup.platform = { cronJobs: platform.cronJobs.map((j) => j.jobname), buckets: platform.buckets.map((b) => b.id),
    storagePolicies: platform.storagePolicies.map((p) => p.policyname), publication: platform.publication, extensions: platform.extensions };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ref: PROD_REF, ...report.backup,
    fingerprint: Object.fromEntries(Object.entries(liveFp).map(([k, v]) => [k, { n: v.n, hash: v.hash }])), tables: liveData }, null, 2));
  report.backup.directory = dir;

  // Pendientes: tienen que ser un SUFIJO del historial del repo (sin huecos en el medio).
  const repoVersions = migrationFiles.map((f) => f.slice(0, 14));
  const unknown = liveLedger.filter((v) => !repoVersions.includes(v));
  const pending = migrationFiles.filter((f) => !liveLedger.includes(f.slice(0, 14)));
  assert.deepEqual(unknown, [], 'LIVE_LEDGER_HAS_VERSIONS_NOT_IN_REPO');
  assert.ok(pending.every((f) => f.slice(0, 14) > liveLedger.at(-1)), 'PENDING_MIGRATIONS_ARE_NOT_A_SUFFIX');
  report.pending = { count: pending.length, first: pending[0], last: pending.at(-1), files: pending };

  // ---------- 2. restauración en un cluster sin red ----------
  docker(['run', '-d', '--name', container, '--network', 'none', '--user', 'postgres',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=2048m,uid=100,gid=101', '--tmpfs', '/tmp:rw,size=256m',
    '--tmpfs', '/etc/postgresql-custom:rw,size=1m,uid=100,gid=101', '--entrypoint', '/bin/sh', IMAGE, '-c',
    'initdb -D /var/lib/postgresql/data/db -U supabase_admin -A trust >/tmp/init.log && postgres -D /var/lib/postgresql/data/db -k /tmp -c listen_addresses= -c shared_preload_libraries=pg_cron,pg_net,supabase_vault -c vault.getkey_script=/usr/lib/postgresql/bin/pgsodium_getkey.sh -c cron.database_name=postgres -c cron.launch_active_jobs=off']);
  started = true;
  for (let attempt = 0; ; attempt++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-h', '/tmp', '-U', 'supabase_admin'], { windowsHide: true }).status === 0) break;
    assert.ok(attempt < 300, 'LAB_POSTGRES_DID_NOT_START');
    await new Promise((r) => setTimeout(r, 200));
  }
  const inspected = JSON.parse(docker(['inspect', container]))[0];
  assert.equal(inspected.HostConfig.NetworkMode, 'none', 'LAB_MUST_HAVE_NO_NETWORK');
  // Piezas de plataforma que el volcado no trae (roles, extensiones, Auth, Storage, Realtime).
  psql(`create role postgres login superuser createdb createrole bypassrls;
    create extension pg_cron with schema pg_catalog;
    grant usage on schema cron to postgres; grant all on all tables in schema cron to postgres;
    grant execute on all functions in schema cron to postgres;`, { user: 'supabase_admin' });
  psql(`do $roles$ declare r text; begin
      foreach r in array array['anon','authenticated','service_role','authenticator','supabase_auth_admin',
        'supabase_storage_admin','supabase_functions_admin','supabase_realtime_admin','supabase_replication_admin',
        'supabase_read_only_user','dashboard_user','pgbouncer','supabase_etl_admin'] loop
        if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
      end loop; end $roles$;
    alter role service_role bypassrls;
    create schema extensions;
    create extension pgcrypto with schema extensions; create extension "uuid-ossp" with schema extensions;
    create extension pg_stat_statements with schema extensions; create extension pg_net with schema extensions;
    create extension supabase_vault;
    grant usage on schema extensions to anon, authenticated, service_role;`);
  psql(fs.readFileSync(path.join(ROOT, 'supabase/tests/fixtures/a1-platform-auth.sql'), 'utf8'));
  // En la plataforma `supabase_auth_admin` (dueño de auth.users) usa el esquema `auth`: sin eso
  // falla cada chequeo de FK hacia auth.users, que corre con los permisos del dueño de esa tabla.
  psql(`drop table auth.users cascade;
    grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
    create schema storage;
    create table storage.buckets(id text primary key, name text not null, owner uuid, created_at timestamptz default now(),
      updated_at timestamptz default now(), public boolean default false, avif_autodetection boolean default false,
      file_size_limit bigint, allowed_mime_types text[], owner_id text);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
      name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
      last_accessed_at timestamptz default now(), metadata jsonb, version text, owner_id text, user_metadata jsonb);
    alter table storage.buckets enable row level security; alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant all on all tables in schema storage to service_role;
    create publication supabase_realtime;
    drop schema public cascade;`);
  const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replaceAll("'", "''")}'`);
  report.restore.steps = [
    restore(authDump.buffer, ['pre-data', 'data']),
    restore(appDump.buffer, ['pre-data', 'data']),
    restore(authDump.buffer, ['post-data']),
    restore(appDump.buffer, ['post-data']),
  ];
  report.restore.errors = report.restore.steps.reduce((a, s) => a + s.errorCount, 0);
  // Lo de plataforma, con los valores de producción.
  psql([
    ...platform.buckets.map((b) => `insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types) values (${lit(b.id)}, ${lit(b.name)}, ${b.public}, ${b.file_size_limit ?? 'null'}, ${b.allowed_mime_types ? `array[${b.allowed_mime_types.map(lit).join(',')}]::text[]` : 'null'});`),
    ...platform.storagePolicies.map((p) => `create policy "${p.policyname.replaceAll('"', '""')}" on storage.${p.tablename} as ${p.permissive.toLowerCase()} for ${p.cmd.toLowerCase()} to ${p.roles.join(', ')}${p.qual ? ` using (${p.qual})` : ''}${p.with_check ? ` with check (${p.with_check})` : ''};`),
    ...platform.publication.map((t) => `alter publication supabase_realtime add table ${t};`),
    ...platform.cronJobs.map((j) => `select cron.schedule(${lit(j.jobname)}, ${lit(j.schedule)}, ${lit(j.command)});`),
    // auth.sessions es del fixture (las suites la usan): vuelve a apuntar a los usuarios restaurados.
    'alter table auth.sessions add foreign key (user_id) references auth.users(id) on delete cascade;',
  ].join('\n'));
  log(`restored with ${report.restore.errors} errors`);
  const asSupabaseAdmin = labQuery('supabase_admin');
  const restoredFp = await fingerprint(asSupabaseAdmin);
  const restoredData = await tableHashes(asSupabaseAdmin);
  const restoredLedger = (await asSupabaseAdmin('select version from supabase_migrations.schema_migrations order by version')).map((r) => r.version);
  report.restore.compare = compareFingerprints(liveFp, restoredFp, APP_CATEGORIES);
  // pg_dump escribe un CHECK como texto y la restauración lo vuelve a parsear: un BETWEEN (que se
  // guarda como un AND anidado) vuelve con otros paréntesis. Un CHECK distinto cuenta como idéntico
  // sólo si recrear la definición VIVA sobre la copia da exactamente la definición restaurada.
  const restoredConstraints = report.restore.compare.constraints;
  if (!restoredConstraints.identical && !restoredConstraints.counts.onlyA && !restoredConstraints.counts.onlyB) {
    const strip = (d) => d.replace(/\s+NOT VALID$/, '');
    const roundTrip = [];
    for (const k of restoredConstraints.changed) {
      const [schema, table] = k.split('.');
      const [restoredDef] = await asSupabaseAdmin(`select pg_get_constraintdef(co.oid) as def from pg_constraint co
        join pg_class c on c.oid = co.conrelid join pg_namespace n on n.oid = c.relnamespace
        where co.contype = 'c' and n.nspname || '.' || c.relname || '.' || co.conname = ${lit(k)}`);
      if (!liveChecks[k] || !restoredDef) { roundTrip.push({ k, equivalent: false }); continue; }
      const again = psql(`begin; create temp table rt_probe (like "${schema}"."${table}");
        alter table rt_probe add constraint rt_probe_check ${strip(liveChecks[k])} not valid;
        select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'rt_probe'::regclass and conname = 'rt_probe_check';
        rollback;`, { user: 'supabase_admin' }).stdout.trim().split('\n').filter(Boolean).pop();
      roundTrip.push({ k, equivalent: strip(again) === strip(restoredDef.def) });
    }
    restoredConstraints.roundTrip = roundTrip;
    if (roundTrip.every((x) => x.equivalent)) {
      restoredConstraints.identical = true;
      restoredConstraints.note = `${roundTrip.length} CHECK difieren sólo en los paréntesis con que pg_dump re-parsea un BETWEEN; cada uno es igual a la definición viva recreada sobre la copia`;
    }
  }
  report.restore.platform = compareFingerprints(liveFp, restoredFp, PLATFORM_CATEGORIES);
  const dataMismatch = Object.keys(liveData).filter((t) => !restoredData[t] || restoredData[t].n !== liveData[t].n || restoredData[t].h !== liveData[t].h);
  report.restore.data = { tables: Object.keys(liveData).length, rows: report.backup.rows, mismatches: dataMismatch };
  report.restore.ledgerIdentical = JSON.stringify(liveLedger) === JSON.stringify(restoredLedger);
  report.checks.PROD_BACKUP = report.backup.files.every((f) => f.bytes > 0) ? 'PASS' : 'FAIL';
  report.checks.RESTORE_TEST = report.restore.errors === 0 && !dataMismatch.length && report.restore.ledgerIdentical
    && APP_CATEGORIES.every((c) => report.restore.compare[c].identical) ? 'PASS' : 'FAIL';

  // La plataforma gestionada: `postgres` NO es superusuario.
  psql(`alter database postgres owner to postgres;
    alter table cron.job owner to supabase_admin; revoke all on cron.job from postgres; grant select on cron.job to postgres;
    alter function cron.alter_job(bigint,text,text,text,text,boolean) owner to supabase_admin;
    grant execute on function cron.alter_job(bigint,text,text,text,text,boolean) to postgres;
    alter table net.http_request_queue owner to supabase_admin; alter table net._http_response owner to supabase_admin;
    grant set on parameter session_replication_role to postgres;
    grant anon, authenticated, service_role to postgres with admin option;
    alter role postgres nosuperuser bypassrls createdb createrole;`, { user: 'supabase_admin' });

  // ---------- 3. el bloque, y la atomicidad ----------
  const tag = `mig_${randomBytes(6).toString('hex')}`;
  const ledgerRow = (f) => `insert into supabase_migrations.schema_migrations(version, name, statements) values ('${f.slice(0, 14)}', '${f.slice(15, -4)}', array[$${tag}$${fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8')}$${tag}$]);`;
  const body = pending.map((f) => {
    const text = fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8');
    assert.ok(!text.includes(`$${tag}$`), 'DOLLAR_TAG_COLLISION');
    return `-- >>> ${f}\n${text}\n;\n${ledgerRow(f)}\n`;
  }).join('\n');
  const bundle = `begin;\nset local lock_timeout = '10s';\n${body}\ncommit;\n`;
  report.apply.bundle = { bytes: Buffer.byteLength(bundle), sha256: sha(bundle), migrations: pending.length };
  if (opt('--bundle-out')) fs.writeFileSync(path.resolve(opt('--bundle-out')), bundle);
  const preFp = await fingerprint(asSupabaseAdmin);
  const preData = await tableHashes(asSupabaseAdmin);
  psql(`create schema drill_before; ${ROW_DIFF_TABLES.map((t) => `create table drill_before.${t.split('.')[1]} as select * from ${t};`).join(' ')}`, { user: 'supabase_admin' });
  const failing = psql(`begin;\n${body}\nselect 1/0;\ncommit;\n`, { allowError: true });
  const afterFailFp = await fingerprint(asSupabaseAdmin);
  const afterFailData = await tableHashes(asSupabaseAdmin);
  report.atomicity = { failedAsExpected: failing.status !== 0 && /division by zero/.test(failing.stderr),
    schemaUnchanged: compareFingerprints(preFp, afterFailFp, [...APP_CATEGORIES, ...PLATFORM_CATEGORIES]),
    dataUnchanged: Object.keys(preData).every((t) => afterFailData[t]?.h === preData[t].h && afterFailData[t]?.n === preData[t].n) };
  report.checks.ATOMIC_APPLY = report.atomicity.failedAsExpected && report.atomicity.dataUnchanged
    && Object.values(report.atomicity.schemaUnchanged).every((c) => c.identical) ? 'PASS' : 'FAIL';

  // ---------- 4. aplicación real, como `postgres` no superusuario ----------
  const t0 = Date.now();
  const applied = psql(bundle, { allowError: true });
  report.apply.durationMs = Date.now() - t0;
  report.apply.status = applied.status;
  report.apply.error = applied.status === 0 ? null : (applied.stderr || '').trim().split('\n').slice(-6);
  report.apply.notices = (applied.stderr || '').split('\n').filter((l) => /WARNING|NOTICE/.test(l)).slice(0, 40);
  assert.equal(applied.status, 0, `APPLY_FAILED: ${report.apply.error}`);
  const postFp = await fingerprint(asSupabaseAdmin);
  const postData = await tableHashes(asSupabaseAdmin);
  const postLedger = (await asSupabaseAdmin('select version from supabase_migrations.schema_migrations order by version')).map((r) => r.version);
  report.apply.ledger = { count: postLedger.length, head: postLedger.at(-1), matchesRepo: JSON.stringify(postLedger) === JSON.stringify(repoVersions) };
  report.checks.APPLY = report.apply.ledger.matchesRepo ? 'PASS' : 'FAIL';

  // ---------- 5. qué datos tocó ----------
  report.data.changedTables = Object.keys(postData).filter((t) => preData[t] && (preData[t].h !== postData[t].h || preData[t].n !== postData[t].n))
    .map((t) => ({ table: t, before: preData[t].n, after: postData[t].n }));
  report.data.newTables = Object.keys(postData).filter((t) => !preData[t]).map((t) => ({ table: t, rows: postData[t].n }));
  report.data.columnChanges = {};
  for (const t of ROW_DIFF_TABLES) {
    const name = t.split('.')[1];
    const [cols] = await asSupabaseAdmin(`select coalesce(array_agg(a.attname::text order by a.attnum), '{}') as c from pg_attribute a
      where a.attrelid = 'drill_before.${name}'::regclass and a.attnum > 0 and not a.attisdropped
        and exists (select 1 from pg_attribute b where b.attrelid = '${t}'::regclass and b.attname = a.attname and not b.attisdropped)`);
    const changed = {};
    for (const c of cols.c) {
      if (c === 'id') continue;
      const [r] = await asSupabaseAdmin(`select count(*)::int as n from drill_before.${name} b join ${t} a using (id)
        where a.${JSON.stringify(c)}::text is distinct from b.${JSON.stringify(c)}::text`);
      if (r.n) changed[c] = r.n;
    }
    const [counts] = await asSupabaseAdmin(`select (select count(*)::int from drill_before.${name}) as before, (select count(*)::int from ${t}) as after`);
    report.data.columnChanges[t] = { ...counts, changedColumns: changed };
  }
  psql('drop schema drill_before cascade;', { user: 'supabase_admin' });

  // Lo que necesita el circuito, y las columnas internas de productos fuera del público.
  const [probe] = await asSupabaseAdmin(`select
      (select coalesce(array_agg(f order by f), '{}') from unnest(array[${REQUIRED_RPCS.map(lit).join(',')}]) f
        where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f)) as missing_rpcs,
      has_column_privilege('anon', 'public.products', 'unit_cost', 'select') as anon_unit_cost,
      has_column_privilege('anon', 'public.products', 'verified_by', 'select') as anon_verified_by,
      has_column_privilege('authenticated', 'public.products', 'unit_cost', 'select') as auth_unit_cost,
      has_column_privilege('authenticated', 'public.products', 'verified_by', 'select') as auth_verified_by`);
  report.apply.probe = probe;
  report.checks.REQUIRED_RPCS_PRESENT = probe.missing_rpcs.length === 0 ? 'PASS' : 'FAIL';
  report.checks.PRIVATE_PRODUCT_COLUMNS_STAY_PRIVATE = !probe.anon_unit_cost && !probe.anon_verified_by
    && !probe.auth_unit_cost && !probe.auth_verified_by ? 'PASS' : 'FAIL';

  // ---------- 6. pgTAP canónico sobre la copia migrada ----------
  report.pgtap.files = {};
  let assertions = 0; let failures = 0;
  for (const name of CANONICAL_TESTS) {
    const r = psql(`set search_path=public,extensions;\n${fs.readFileSync(path.join(ROOT, 'supabase/tests', name), 'utf8')}`, { allowError: true });
    const plan = /^1\.\.([0-9]+)$/m.exec(r.stdout);
    const notOk = r.stdout.split('\n').filter((l) => /^not ok\b/.test(l));
    const entry = { status: r.status, plan: plan ? Number(plan[1]) : null, notOk: notOk.slice(0, 10),
      error: r.status === 0 ? null : (r.stderr || '').trim().split('\n').slice(-3) };
    report.pgtap.files[name] = entry;
    assertions += entry.plan || 0;
    if (r.status !== 0 || !plan || notOk.length) failures++;
  }
  report.pgtap.assertions = assertions; report.pgtap.failedFiles = failures;
  report.checks.PGTAP_ON_MIGRATED_PRODUCTION_COPY = failures === 0 ? 'PASS' : 'FAIL';

  // ---------- 7. huella contra la base construida desde cero ----------
  report.compare.liveToMigrated = compareFingerprints(liveFp, postFp, APP_CATEGORIES, 15);
  const freshFile = opt('--fresh-fingerprint');
  if (freshFile && fs.existsSync(freshFile)) {
    const fresh = JSON.parse(fs.readFileSync(freshFile, 'utf8'));
    report.compare.freshMigrations = fresh.migrations;
    report.compare.migratedVsFresh = compareFingerprints(postFp, fresh.fingerprint, APP_CATEGORIES, 60);
    report.checks.MIGRATED_EQUALS_FRESH = APP_CATEGORIES.every((c) => report.compare.migratedVsFresh[c].identical) ? 'PASS' : 'REVIEW';
  } else {
    report.checks.MIGRATED_EQUALS_FRESH = 'NOT_RUN';
  }
} catch (error) {
  report.error = error.message;
  if (live.client) await live.client.query('rollback').catch(() => {});
} finally {
  if (live.client) await live.client.end().catch(() => {});
  if (started && !args.includes('--keep')) {
    const inspected = JSON.parse(docker(['inspect', container]))[0];
    assert.equal(inspected.HostConfig.NetworkMode, 'none');
    docker(['rm', '-f', container]);
  }
}
report.container = args.includes('--keep') ? container : null;
const out = path.join(dir, 'rehearsal-report.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out, error: report.error || null, checks: report.checks, pending: report.pending.count,
  restoreErrors: report.restore.errors, changedTables: report.data.changedTables?.length, pgtap: report.pgtap.assertions }, null, 2));
process.exit(report.error ? 1 : 0);
