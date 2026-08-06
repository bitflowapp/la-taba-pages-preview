// Escenarios de la colisión de versión 20260804090000.
//
// Reproduce tres estados de base reales y verifica el comportamiento de
// supabase/migrations/20260806090000_reconcile_business_operations_panel_version_collision.sql
//
//   1) BASE NUEVA CANÓNICA   -> las 38 migraciones + reconciliación => no-op
//   2) SIMULACIÓN DE STAGING -> 26 coherentes + rider_map remoto ocupando
//                               20260804090000 + 11 pendientes + reconciliación
//   3) ESTADO PARCIAL        -> aborta con BUSINESS_PANEL_PARTIAL_SCHEMA_DETECTED
//
// FIXTURE DE CLÚSTER
// ------------------
// La migración 20260803120000 hace `create extension pg_cron` + `cron.schedule`.
// pg_cron sólo admite eso en la base indicada por el GUC `cron.database_name`
// (postmaster-level). En vez de modificar esa migración —que todavía no está
// desplegada en staging— este runner apunta el GUC del clúster local a la base
// de prueba, reinicia el contenedor y lo restaura al terminar. La migración
// corre EXACTAMENTE como está escrita, sin excepciones ni saltos.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

if (process.env.TABA_LOCAL_PAYMENT_DB !== '1') {
  console.error('Refusing to run database scenarios without TABA_LOCAL_PAYMENT_DB=1. Local only.');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const container = process.env.TABA_SUPABASE_DB_CONTAINER || 'supabase_db_la-taba-real-orders-staging';
const DB = 'taba2_collision_verify';
const dockerCmd = process.platform === 'win32' ? 'docker.exe' : 'docker';

const migrationsDir = path.join(root, 'supabase', 'migrations');
const allMigrations = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

const RECONCILE = '20260804093000_reconcile_business_operations_panel_version_collision.sql';
const PANEL = '20260804090000_business_operations_panel.sql';

// Versiones registradas en staging (27). 26 son archivos locales; 20260804090000
// corresponde a la migración sólo-remota rider_map_location_contracts.
const REMOTE_APPLIED = new Set([
  '20260531030000', '20260531040000', '20260601205707', '20260725030000', '20260725050000',
  '20260725060000', '20260725070000', '20260725080000', '20260725090000', '20260725100000',
  '20260725110000', '20260725120000', '20260725130000', '20260728090000', '20260729150000',
  '20260729190000', '20260729203000', '20260731230000', '20260731231000', '20260801020000',
  '20260801040000', '20260802100000', '20260802101000', '20260802102000', '20260802103000',
  '20260802104000', '20260804090000',
]);

function docker(args, input) {
  return execFileSync(dockerCmd, args, {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: input === undefined ? 'pipe' : ['pipe', 'pipe', 'pipe'], input,
  });
}
const psql = (sql, db = DB) =>
  docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q'], sql);
const psqlValue = (sql, db = DB) =>
  docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t'], sql).trim();

function tryPsql(sql, db = DB) {
  const r = spawnSync(dockerCmd, ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q'], {
    cwd: root, encoding: 'utf8', input: sql, maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
}

// ---------------------------------------------------------------- fixture ---
function waitHealthy(timeoutMs = 120000) {
  const started = Date.now();
  for (;;) {
    const r = spawnSync(dockerCmd, ['exec', container, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' });
    if (r.status === 0) return;
    if (Date.now() - started > timeoutMs) throw new Error('el contenedor de base no volvió a estar disponible');
  }
}

// `cron.database_name` es postmaster-level y el rol `postgres` de Supabase no es
// superusuario, así que ALTER SYSTEM no alcanza: se edita el conf.d del
// contenedor local como root y se reinicia. Sólo afecta a este clúster de
// pruebas; ninguna migración se modifica.
const CRON_CONF = '/etc/postgresql-custom/conf.d/pg_cron.conf';

function setClusterCronDatabase(name) {
  const value = name === null ? 'postgres' : name;
  docker(['exec', '-u', 'root', container, 'sh', '-c',
    `sed -i "s|^cron.database_name = .*|cron.database_name = '${value}'|" ${CRON_CONF}`]);
  execFileSync(dockerCmd, ['restart', container], { encoding: 'utf8', stdio: 'pipe' });
  waitHealthy();
  const active = docker(['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-A', '-t', '-c',
    'show cron.database_name;']).trim();
  if (active !== value) {
    throw new Error(`el fixture de clúster no tomó efecto: cron.database_name=${active} esperado=${value}`);
  }
}

function recreateDatabase() {
  spawnSync(dockerCmd, ['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', DB], { encoding: 'utf8' });
  docker(['exec', container, 'createdb', '-U', 'postgres', DB]);
  const platform = docker(['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only',
    '--schema=auth', '--schema=storage', '--no-owner', '--no-privileges']);
  psql(platform);
  // Bootstrap de plataforma: lo que Supabase provee de fábrica en cualquier
  // base suya y que una base recién creada no trae. No es parte de ninguna
  // migración del repositorio.
  psql(`
    create schema if not exists extensions;
    grant usage on schema extensions to anon, authenticated, service_role;
    create extension if not exists pgcrypto with schema extensions;
    create schema if not exists vault;
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations(
      version text primary key, name text, statements text[]);
  `);
}

const applyMigration = (file) => psql(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
const record = (file) => psql(
  `insert into supabase_migrations.schema_migrations(version, name) values ('${file.slice(0, 14)}', '${file.slice(15, -4)}') on conflict (version) do nothing;`,
);

// ------------------------------------------------------------- aserciones ---
let failures = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (esperado=${expected} obtenido=${actual})`}`);
  if (!ok) failures += 1;
  return ok;
}

const SENTINEL_SQL = `
  select
    (select count(*) from information_schema.columns
      where table_schema='public' and table_name='fiscal_profiles'
        and column_name in ('certificate_fingerprint_sha256','certificate_expires_at','certificate_subject_cuit',
          'credential_checked_at','delegation_status','delegation_verified_at','connection_ok_at',
          'artifact_verified_at','print_verified_at','homologation_authorized_at','homologation_authorized_by',
          'last_error_code','last_error_at'))
  + (select count(*) from information_schema.columns
      where table_schema='public' and table_name='products' and column_name='unit_cost')
  + (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('record_fiscal_credential_health','get_arca_activation_status',
        'record_fiscal_verification','get_mercadopago_activation_status','configure_mercadopago_settings',
        'get_business_opening_status','set_business_open_state','complete_scanned_product','get_scanned_product_readiness'))
  + (select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace
      where n.nspname='public' and c.conname in ('fiscal_profiles_delegation_status_check',
        'fiscal_profiles_certificate_fingerprint_check','fiscal_profiles_last_error_code_check',
        'fiscal_profiles_certificate_subject_cuit_check','fiscal_profiles_homologation_gate',
        'products_unit_cost_check'))
  + (select count(*) from pg_indexes where schemaname='public' and indexname='scanned_product_audit_business_idx')
  + (select count(*) from pg_policies where schemaname='public' and policyname='business reads scanned product audit')
  + (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='scanned_product_audit');
`;
const sentinels = () => psqlValue(SENTINEL_SQL);
const riderTriggerDef = () => psqlValue(
  `select coalesce((select pg_get_triggerdef(oid) from pg_trigger where tgname='rider_map_capture_order_location' and not tgisinternal limit 1),'');`,
);
const privateObjects = () => psqlValue(
  `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private';`,
);
const cronJobs = () => psqlValue(
  `select coalesce((select count(*) from cron.job where jobname='taba-payment-outbox-worker'),0);`,
);

// Huella de todo lo que define el contrato final, para comparar bases enteras.
const schemaFingerprint = () => psqlValue(`
  select md5(string_agg(x, '|' order by x)) from (
    select 'T:'||tablename as x from pg_tables where schemaname='public'
    union all select 'C:'||table_name||'.'||column_name from information_schema.columns where table_schema='public'
    union all select 'F:'||p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    union all select 'X:'||con.conname from pg_constraint con join pg_namespace n on n.oid=con.connamespace where n.nspname='public'
    union all select 'I:'||indexname from pg_indexes where schemaname='public'
    union all select 'P:'||policyname||'@'||tablename from pg_policies where schemaname='public'
    union all select 'G:'||tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
              join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
  ) s;
`);

const applyRiderRemote = () => psql(
  fs.readFileSync(path.join(root, 'supabase', 'tests', 'fixtures', 'rider_map_location_contracts.remote.sql'), 'utf8'),
);

// Migraciones que en staging quedan pendientes, en el orden en que db push las
// aplicaría. business_operations_panel NO está: su versión ya figura registrada.
const pendingForStaging = () => allMigrations.filter((f) => !REMOTE_APPLIED.has(f.slice(0, 14)));
const coherentForStaging = () => allMigrations.filter((f) => REMOTE_APPLIED.has(f.slice(0, 14)) && f !== PANEL);

let canonicalFingerprint = null;

// ------------------------------------------------------------- escenarios ---
function scenario1() {
  console.log('\n=== ESCENARIO 1 — BASE NUEVA CANÓNICA ===');
  recreateDatabase();

  // Se aplica todo en orden real. La reconciliación cae entre 20260804090000 y
  // 20260805120000, así que se mide justo antes y justo después de ella.
  for (const f of allMigrations) {
    if (f === RECONCILE) {
      const before = sentinels();
      const beforeCols = psqlValue(`select count(*) from information_schema.columns where table_schema='public';`);
      check('con el Panel ya aplicado, el contrato está completo (32 objetos)', before, 32);

      applyMigration(f); record(f);

      check('la reconciliación es no-op: mismos objetos del contrato', sentinels(), before);
      check('no duplicó columnas', psqlValue(`select count(*) from information_schema.columns where table_schema='public';`), beforeCols);
      check('no duplicó la policy', psqlValue(`select count(*) from pg_policies where schemaname='public' and policyname='business reads scanned product audit';`), 1);
      check('no duplicó el índice', psqlValue(`select count(*) from pg_indexes where schemaname='public' and indexname='scanned_product_audit_business_idx';`), 1);
      check('no dejó tabla temporal de estado', psqlValue(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relname='taba_reconcile_state';`), 0);
      check('cero filas creadas en scanned_product_audit', psqlValue(`select count(*) from public.scanned_product_audit;`), 0);
      continue;
    }
    applyMigration(f); record(f);
  }

  check('39 migraciones registradas', psqlValue(`select count(*) from supabase_migrations.schema_migrations;`), 39);
  check('el job de cron quedó programado (fixture de clúster activo)', cronJobs(), 1);
  check('20260805120000 retiró el gate como corresponde',
    psqlValue(`select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.conname='fiscal_profiles_homologation_gate';`), 0);
  check('y dejó el par autorizado',
    psqlValue(`select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.conname='fiscal_profiles_homologation_authorization_pairing';`), 1);
  check('esquema private ausente en base canónica', privateObjects(), 0);

  canonicalFingerprint = schemaFingerprint();
  console.log(`   huella canónica: ${canonicalFingerprint}`);
}

function scenario2() {
  console.log('\n=== ESCENARIO 2 — SIMULACIÓN EXACTA DE STAGING ===');
  recreateDatabase();

  const coherent = coherentForStaging();
  for (const f of coherent) { applyMigration(f); record(f); }
  check('26 migraciones coherentes aplicadas', coherent.length, 26);

  applyRiderRemote();
  const riderBefore = riderTriggerDef();
  const privateBefore = privateObjects();
  check('trigger rider_map instalado', riderBefore.includes('rider_map_capture_order_location'), true);
  check('version 20260804090000 ocupada por rider_map_location_contracts',
    psqlValue(`select name from supabase_migrations.schema_migrations where version='20260804090000';`),
    'rider_map_location_contracts');
  check('el contrato del Panel está completamente ausente', sentinels(), 0);

  const pending = pendingForStaging();
  check('12 migraciones pendientes (11 + la reconciliación)', pending.length, 12);
  check('business_operations_panel NO está entre las pendientes', pending.includes(PANEL), false);
  check('la reconciliación SÍ está entre las pendientes', pending.includes(RECONCILE), true);
  check('la reconciliación se aplica antes de 20260805120000',
    pending.indexOf(RECONCILE) < pending.indexOf('20260805120000_fiscal_homologation_authorization_split.sql'), true);

  for (const f of pending) { applyMigration(f); record(f); }

  check('el trigger rider_map quedó intacto', riderTriggerDef(), riderBefore);
  check('el esquema private quedó intacto', privateObjects(), privateBefore);
  check('sin versiones duplicadas en el historial',
    psqlValue(`select count(*) from (select version from supabase_migrations.schema_migrations group by version having count(*)>1) d;`), 0);
  // 26 locales coherentes + rider_map remoto = 27 previas; + 12 pendientes = 39.
  check('39 versiones registradas (27 previas + 12 pendientes)', psqlValue(`select count(*) from supabase_migrations.schema_migrations;`), 39);
  check('la versión 20260804090000 sigue siendo del rider map',
    psqlValue(`select name from supabase_migrations.schema_migrations where version='20260804090000';`),
    'rider_map_location_contracts');
  check('el job de cron quedó programado', cronJobs(), 1);

  // Lo que realmente importa: staging converge al MISMO esquema que la base
  // canónica, salvo el esquema private que sólo existe allá.
  psql('drop schema if exists private cascade;');
  check('el esquema converge exactamente al canónico', schemaFingerprint(), canonicalFingerprint);
}

function scenario3() {
  console.log('\n=== ESCENARIO 3 — ESTADO PARCIAL ===');
  recreateDatabase();

  for (const f of coherentForStaging()) { applyMigration(f); record(f); }
  applyRiderRemote();

  // Se avanza sólo hasta el punto en que la reconciliación debería correr. Más
  // allá no se puede: 20260805120000 usa columnas del Panel y aborta sin ellas
  // —el mismo defecto que esta reconciliación existe para resolver—.
  for (const f of pendingForStaging()) {
    if (f >= RECONCILE) break;
    applyMigration(f); record(f);
  }

  // Se crea deliberadamente sólo una parte del contrato.
  psql(`
    alter table public.products add column if not exists unit_cost numeric(12,2);
    alter table public.fiscal_profiles add column if not exists last_error_code text;
  `);
  const partial = Number(sentinels());
  check('estado deliberadamente parcial', partial > 0 && partial < 32, true);

  const riderBefore = riderTriggerDef();
  const before = psqlValue(`select count(*) from information_schema.columns where table_schema='public';`);
  const fingerprintBefore = schemaFingerprint();

  const r = tryPsql(fs.readFileSync(path.join(migrationsDir, RECONCILE), 'utf8'));
  check('la reconciliación aborta', r.ok, false);
  check('clasifica BUSINESS_PANEL_PARTIAL_SCHEMA_DETECTED', r.out.includes('BUSINESS_PANEL_PARTIAL_SCHEMA_DETECTED'), true);
  check('no aplicó ningún cambio adicional', psqlValue(`select count(*) from information_schema.columns where table_schema='public';`), before);
  check('el esquema quedó byte a byte igual', schemaFingerprint(), fingerprintBefore);
  check('el contrato sigue igual de parcial', sentinels(), String(partial));
  check('el trigger rider_map quedó intacto', riderTriggerDef(), riderBefore);
  check('no creó la tabla del Panel', psqlValue(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='scanned_product_audit';`), 0);
}

// ------------------------------------------------------------------ main ----
console.log(`Fixture de clúster: cron.database_name -> ${DB} (contenedor ${container})`);
setClusterCronDatabase(DB);
try {
  scenario1();
  scenario2();
  scenario3();
} finally {
  console.log('\nRestaurando el clúster: cron.database_name -> valor por defecto');
  try {
    spawnSync(dockerCmd, ['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', DB], { encoding: 'utf8' });
    setClusterCronDatabase(null);
  } catch (error) {
    console.error(`No se pudo restaurar el clúster: ${error.message}`);
  }
}

console.log(`\n${failures === 0 ? 'TODOS LOS ESCENARIOS PASARON' : `${failures} ASERCIONES FALLARON`}`);
process.exit(failures === 0 ? 0 : 1);
