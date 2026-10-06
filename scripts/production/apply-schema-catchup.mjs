// PRODUCCIÓN (wwcpogltfgzgkrlilbcd) · APLICAR LA PUESTA AL DÍA DEL ESQUEMA
//
// Aplica el MISMO bloque que ensayó scripts/production/schema-catchup-rehearsal.mjs y sólo si:
//   - el informe del ensayo tiene todas las compuertas en PASS (la huella contra la base desde
//     cero puede quedar en REVIEW: sus diferencias están explicadas en el informe de la misión);
//   - el ledger vivo es exactamente el que se ensayó (nadie migró en el medio);
//   - el bloque que se va a ejecutar tiene el mismo sha256 que el ensayado.
// Corre en UNA transacción como `postgres` (igual que la API de management) y, ANTES del commit,
// verifica adentro de la misma transacción: ledger = repositorio, RPC del circuito presentes,
// columnas internas de productos fuera de anon/authenticated y los valores existentes de
// pedidos, productos, negocios, miembros, eventos e imágenes idénticos a los de antes (por las
// columnas que ya existían). Si algo no cuadra: rollback, y producción queda como estaba.
//
//   TABA_PRODUCTION_SCHEMA_CATCHUP=I_AUTHORIZE_PRODUCTION_SCHEMA_CATCHUP \
//   node scripts/production/apply-schema-catchup.mjs --workdir <dir enlazado a producción> \
//     --rehearsal <rehearsal-report.json> --bundle <catchup-bundle.sql> --out <informe.json> [--dry-run]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PROD_REF = 'wwcpogltfgzgkrlilbcd';
const POOLER = 'aws-0-sa-east-1.pooler.supabase.com';
const args = process.argv.slice(2);
const opt = (name, fallback = '') => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const DRY_RUN = args.includes('--dry-run');
if (!DRY_RUN) assert.equal(process.env.TABA_PRODUCTION_SCHEMA_CATCHUP, 'I_AUTHORIZE_PRODUCTION_SCHEMA_CATCHUP', 'AUTHORIZATION_REQUIRED');
const WORKDIR = opt('--workdir');
assert.equal(fs.readFileSync(path.join(WORKDIR, 'supabase', '.temp', 'project-ref'), 'utf8').trim(), PROD_REF, 'WORKDIR_NOT_LINKED_TO_PRODUCTION');
const rehearsal = JSON.parse(fs.readFileSync(opt('--rehearsal'), 'utf8'));
const bundle = fs.readFileSync(opt('--bundle'), 'utf8');
const OUT = path.resolve(opt('--out'));
assert.ok(!OUT.toLowerCase().startsWith(ROOT.toLowerCase()) || OUT.includes(`${path.sep}docs${path.sep}evidence${path.sep}`), 'OUT_OUTSIDE_EVIDENCE');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const log = (m) => process.stderr.write(`[apply ${new Date().toISOString().slice(11, 19)}] ${m}\n`);

// ---------- compuertas del ensayo ----------
const REQUIRED_PASS = ['PROD_BACKUP', 'RESTORE_TEST', 'ATOMIC_APPLY', 'APPLY', 'REQUIRED_RPCS_PRESENT',
  'PRIVATE_PRODUCT_COLUMNS_STAY_PRIVATE', 'PGTAP_ON_MIGRATED_PRODUCTION_COPY'];
for (const gate of REQUIRED_PASS) assert.equal(rehearsal.checks?.[gate], 'PASS', `REHEARSAL_GATE_NOT_PASS:${gate}`);
assert.equal(rehearsal.ref, PROD_REF, 'REHEARSAL_FOR_ANOTHER_PROJECT');
assert.equal(sha(bundle), rehearsal.apply.bundle.sha256, 'BUNDLE_IS_NOT_THE_REHEARSED_ONE');
const repoVersions = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /^\d{14}_.+\.sql$/.test(f)).map((f) => f.slice(0, 14)).sort();
assert.deepEqual(rehearsal.pending.files.map((f) => f.slice(0, 14)), repoVersions.slice(-rehearsal.pending.count), 'REHEARSED_PENDING_IS_NOT_REPO_SUFFIX');
const body = bundle.replace(/^begin;\nset local lock_timeout = '10s';\n/, '').replace(/\ncommit;\n$/, '\n');
assert.ok(body.length < bundle.length - 20, 'BUNDLE_SHAPE_UNEXPECTED');

const REQUIRED_RPCS = ['pos_get_catalog_state', 'pos_apply_stock_movements', 'pos_apply_stock_count', 'pos_list_orders',
  'pos_get_store_overview', 'transition_order', 'cancel_order', 'confirm_manual_order_payment', 'offer_order_to_rider',
  'confirm_business_delivery_code', 'set_business_open_state', 'identity_register_session', 'identity_close_own_session',
  'get_rider_delivery_board', 'accept_rider_order_offer', 'reject_rider_order_offer', 'mark_delivery_picked_up',
  'start_rider_delivery', 'mark_rider_arrived', 'confirm_delivery_code', 'publish_rider_location_fanout',
  'set_rider_availability', 'heartbeat_rider_availability', 'list_business_rider_availability', 'create_order_with_items'];
const VALUE_TABLES = ['public.orders', 'public.order_items', 'public.products', 'public.businesses', 'public.business_members',
  'public.order_events', 'public.catalog_assets', 'public.inventory_movements', 'auth.users'];
const SESSION = `set local timezone = 'UTC'; set local datestyle = 'ISO, MDY'; set local intervalstyle = 'postgres';
  set local extra_float_digits = 1; set local bytea_output = 'hex'`;

function cliLogin() {
  const out = execFileSync('supabase.exe', ['db', 'dump', '--linked', '--workdir', WORKDIR, '--dry-run'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const get = (k) => (out.match(new RegExp(`export ${k}="([^"]*)"`)) || [])[1];
  assert.equal(get('PGHOST'), `db.${PROD_REF}.supabase.co`, 'CLI_LOGIN_FOR_ANOTHER_PROJECT');
  return { user: `${get('PGUSER')}.${PROD_REF}`, password: get('PGPASSWORD') };
}
// Hash de los valores de las columnas que existen AHORA (antes del bloque), tabla por tabla.
async function valueHashes(client, columns) {
  const out = {};
  for (const t of VALUE_TABLES) {
    const cols = columns[t].map((c) => `x.${JSON.stringify(c)}`).join(', ');
    const { rows } = await client.query(`select count(*)::int as n, coalesce(md5(string_agg(h, ',' order by h)), '') as h
      from (select md5(row(${cols})::text) as h from ${t} x) s`);
    out[t] = rows[0];
  }
  return out;
}

const report = { at: new Date().toISOString(), ref: PROD_REF, dryRun: DRY_RUN, bundleSha256: sha(bundle),
  migrations: rehearsal.pending.count, rehearsal: { dir: path.dirname(opt('--rehearsal')), checks: rehearsal.checks }, before: {}, inTransaction: {}, after: {} };
const login = cliLogin();
const client = new pg.Client({ host: POOLER, port: 5432, user: login.user, password: login.password, database: 'postgres',
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
let committed = false;
try {
  await client.connect();
  await client.query('set role postgres');
  const [{ who }] = (await client.query(`select current_user as who`)).rows;
  assert.equal(who, 'postgres', 'MUST_RUN_AS_POSTGRES');
  const ledger = (await client.query('select version from supabase_migrations.schema_migrations order by version')).rows.map((r) => r.version);
  report.before.ledger = { count: ledger.length, head: ledger.at(-1) };
  assert.equal(ledger.length, rehearsal.backup.ledger.count, 'LIVE_LEDGER_CHANGED_SINCE_REHEARSAL');
  assert.equal(ledger.at(-1), rehearsal.backup.ledger.head, 'LIVE_LEDGER_CHANGED_SINCE_REHEARSAL');
  assert.deepEqual([...ledger, ...rehearsal.pending.files.map((f) => f.slice(0, 14))], repoVersions, 'LEDGER_PLUS_BLOCK_IS_NOT_REPO');
  const columns = {};
  for (const t of VALUE_TABLES) {
    columns[t] = (await client.query(`select attname from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum`, [t])).rows.map((r) => r.attname);
  }

  await client.query('begin');
  await client.query("set local lock_timeout = '10s'");
  await client.query("set local statement_timeout = '180s'");
  await client.query(SESSION);
  const before = await valueHashes(client, columns);
  report.before.values = Object.fromEntries(Object.entries(before).map(([t, v]) => [t, v.n]));
  const t0 = Date.now();
  await client.query(body);
  report.inTransaction.applyMs = Date.now() - t0;
  log(`block applied in ${report.inTransaction.applyMs} ms (not committed)`);

  // ---------- verificación ANTES del commit ----------
  await client.query(SESSION);
  const after = await valueHashes(client, columns);
  const changed = VALUE_TABLES.filter((t) => after[t].n !== before[t].n || after[t].h !== before[t].h);
  const newLedger = (await client.query('select version from supabase_migrations.schema_migrations order by version')).rows.map((r) => r.version);
  const { rows: [probe] } = await client.query(`select
      (select coalesce(array_agg(f order by f), '{}') from unnest($1::text[]) f
        where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f)) as missing_rpcs,
      has_column_privilege('anon', 'public.products', 'unit_cost', 'select') as anon_unit_cost,
      has_column_privilege('anon', 'public.products', 'verified_by', 'select') as anon_verified_by,
      has_column_privilege('authenticated', 'public.products', 'unit_cost', 'select') as auth_unit_cost,
      has_column_privilege('authenticated', 'public.products', 'verified_by', 'select') as auth_verified_by`, [REQUIRED_RPCS]);
  report.inTransaction = { ...report.inTransaction, valuesChanged: changed, ledger: { count: newLedger.length, head: newLedger.at(-1),
    matchesRepo: JSON.stringify(newLedger) === JSON.stringify(repoVersions) }, probe };
  const ok = !changed.length && report.inTransaction.ledger.matchesRepo && !probe.missing_rpcs.length
    && !probe.anon_unit_cost && !probe.anon_verified_by && !probe.auth_unit_cost && !probe.auth_verified_by;
  report.inTransaction.verdict = ok ? 'PASS' : 'FAIL';
  if (!ok || DRY_RUN) {
    await client.query('rollback');
    report.outcome = DRY_RUN ? (ok ? 'DRY_RUN_PASS_ROLLED_BACK' : 'DRY_RUN_FAIL_ROLLED_BACK') : 'VERIFICATION_FAILED_ROLLED_BACK';
  } else {
    await client.query('commit');
    committed = true;
    report.outcome = 'COMMITTED';
    report.committedAt = new Date().toISOString();
  }
  log(report.outcome);
} catch (error) {
  report.error = error.message;
  if (!committed) { await client.query('rollback').catch(() => {}); report.outcome = report.outcome || 'ERROR_ROLLED_BACK'; }
} finally {
  await client.end().catch(() => {});
}

// ---------- después: una conexión nueva, sólo lectura ----------
if (committed) {
  const again = cliLogin();
  const check = new pg.Client({ host: POOLER, port: 5432, user: again.user, password: again.password, database: 'postgres', ssl: { rejectUnauthorized: false } });
  await check.connect();
  await check.query('set role postgres');
  await check.query('begin transaction read only');
  const ledger = (await check.query('select version from supabase_migrations.schema_migrations order by version')).rows.map((r) => r.version);
  report.after.ledger = { count: ledger.length, head: ledger.at(-1), matchesRepo: JSON.stringify(ledger) === JSON.stringify(repoVersions) };
  report.after.cronJobs = (await check.query('select jobname, schedule, active from cron.job order by jobname')).rows;
  report.after.business = (await check.query(`select status, ordering_enabled, ordering_verified, is_active, rider_presence_required,
    delivery_enabled, pickup_enabled from public.businesses`)).rows;
  await check.query('rollback');
  await check.end();
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out: OUT, outcome: report.outcome, error: report.error || null, inTransaction: report.inTransaction, after: report.after }, null, 2));
process.exit(report.outcome === 'COMMITTED' || report.outcome === 'DRY_RUN_PASS_ROLLED_BACK' ? 0 : 1);
