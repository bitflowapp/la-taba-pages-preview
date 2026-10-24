// Ensayo de restauración LOCAL y cronometrado de un respaldo cifrado (postgres-backup.mjs).
//
// Responde a dos preguntas que el ensayo alojado no contesta:
//   1. ¿El archivo se puede recuperar SIN el proyecto de Supabase? (si el proyecto se pierde, no hay «restore en
//      el mismo clúster»: hay un archivo cifrado, una clave y una base vacía)
//   2. ¿Cuánto tarda la capa de datos? Descifrar + restaurar + verificar, medido. Es la cota inferior del RTO: la
//      plataforma (Auth, Storage, funciones, secretos, cron) se repone aparte y suma su propio tiempo.
//
//   node scripts/recovery/local-restore-drill.mjs --manifest <snapshot>/manifest.json --out <directorio nuevo>
//        [--target deploy/recovery-free-hosted.json] [--expect-counts '{"orders":7}']
//
// Sólo toca el clúster local descartable (127.0.0.1, bases taba_local_*). La base restaurada QUEDA creada para
// inspección y se informa su nombre: borrarla es una decisión aparte. La salida no contiene filas, sólo conteos,
// hashes y tiempos.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { BIN, HOST, PORT, ROOT, psqlRaw } from '../local-db/lib.mjs';
import { nativeCommand } from './postgres-backup.mjs';
import { RESTORE_SCHEMAS, executeDdlBatch, readArchiveWithIdentity, restoreApplicationAcl } from './restore-postgres-application.mjs';
import { fingerprint } from './restore-fingerprints.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const seconds = ms => Math.round(ms / 100) / 10;

/** Los sustitutos locales de pg_cron, pg_net y Vault, SIN las tablas de Storage: ésas vienen en el respaldo. */
export function localPrelude(stubs) {
  // Sentencias enteras (algunas ocupan varias líneas), no líneas sueltas.
  const kept = stubs.replace(/^create table storage\.[\s\S]*?\);[ \t]*\r?\n/gm, '').replace(/^alter table storage\.[^\n]*\n/gm, '');
  if (/storage\.(buckets|objects)/.test(kept)) throw Error('stubs.sql changed: storage tables must come from the archive');
  return kept;
}

export async function localRestoreDrill({ target, manifestFile, out, expectCounts = null }) {
  if (!BIN) throw Error('Set TABA_PG_BIN to the folder that contains psql/pg_restore');
  if (fs.existsSync(out)) throw Error('New evidence directory required');
  if (process.platform === 'win32' && !/^D:[\\/]/i.test(path.resolve(out))) throw Error('Use D: for drill evidence');
  const relative = path.relative(ROOT, path.resolve(out));
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw Error('Drill evidence must live outside the repository');
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const database = `taba_local_restore_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}_${randomBytes(4).toString('hex')}`;
  const env = { ...process.env, PGHOST: HOST, PGPORT: String(PORT), PGUSER: 'postgres', PGDATABASE: database, PGPASSWORD: '', PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '5' };
  const timings = {};
  const started = Date.now();
  let mark = started;
  const lap = name => { const now = Date.now(); timings[name] = seconds(now - mark); mark = now; };

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const { plaintext: archive, sourceArchive } = readArchiveWithIdentity(target, manifestFile);
  lap('decryptAndVerifyHashes');
  const receipt = { drillVersion: 1, purpose: 'local_restore_drill', projectRef: target.projectRef, database, sourceArchive,
    managedPlatformRestored: false, productionTouched: false, hostedProjectTouched: false };
  try {
    psqlRaw('postgres', `create database ${database};`);
    psqlRaw(database, localPrelude(fs.readFileSync(path.join(ROOT, 'scripts/local-db/stubs.sql'), 'utf8')));
    psqlRaw(database, RESTORE_SCHEMAS.filter(s => s !== 'public').map(s => `create schema if not exists "${s}";`).join('\n'));
    lap('createDatabase');
    const args = ['--no-owner', '--no-privileges', ...RESTORE_SCHEMAS.map(s => '--schema=' + s)];
    for (const section of ['pre-data', 'data', 'post-data']) {
      if (section === 'data') {
        nativeCommand(BIN, 'pg_restore', [...args, '--no-password', '--exit-on-error', '--single-transaction', '--section=data', '--dbname', database], { env, input: archive, timeout: 600000 });
      } else {
        executeDdlBatch(BIN, env, nativeCommand(BIN, 'pg_restore', [...args, '--section=' + section, '--file=-'], { input: archive, encoding: 'utf8' }));
      }
      lap(`restore_${section}`);
    }
    Object.assign(receipt, restoreApplicationAcl({ tools: BIN, env, archive, out }));
    lap('restoreApplicationAcl');

    const counts = JSON.parse(psqlRaw(database, `select json_build_object(
      'auth_users', (select count(*) from auth.users), 'products', (select count(*) from public.products),
      'orders', (select count(*) from public.orders), 'storage_objects', (select count(*) from storage.objects),
      'migration_versions', (select count(*) from supabase_migrations.schema_migrations),
      'payment_intents', (select count(*) from public.payment_intents),
      'operational_alerts', (select count(*) from public.operational_alerts))`, { tuples: true }).stdout.trim());
    const expected = expectCounts || (manifest.baseline?.[0] ? Object.fromEntries(Object.entries(manifest.baseline[0])
      .filter(([key]) => ['auth_users', 'products', 'orders', 'storage_objects', 'migration_versions'].includes(key))) : {});
    const mismatches = Object.entries(expected).filter(([key, value]) => counts[key] !== value).map(([key, value]) => `${key}: ${counts[key]} != ${value}`);
    // Funciones vivas, no sólo filas: las compuertas de dinero y la reconciliación de alertas ejecutan sobre lo restaurado.
    const functional = JSON.parse(psqlRaw(database, `select json_build_object(
      'rls_tables', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity),
      'policies', (select count(*) from pg_policies where schemaname in ('public', 'private', 'storage')),
      'functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')),
      'reversed_orders', (select count(*) from public.orders o where public.order_payment_is_financially_reversed(o.id)),
      'paid_without_order', (select count(*) from public.payment_intents pi where pi.order_id is null and pi.internal_status in ('approved', 'approved_order_pending')),
      'negative_stock', (select count(*) from public.products where stock < 0))`, { tuples: true }).stdout.trim());
    const prints = fingerprint(BIN, env);
    lap('verify');
    Object.assign(receipt, {
      counts, expectedCounts: expected, countsMatchManifest: mismatches.length === 0, mismatches, functional,
      fingerprint: { tables: prints.tables?.length ?? null, sha256: sha256(Buffer.from(JSON.stringify(prints))) },
      timingsSeconds: timings, dataLayerRecoverySeconds: seconds(Date.now() - started),
      archiveBytes: manifest.encryptedBytes, completedAt: new Date().toISOString(),
    });
    fs.writeFileSync(path.join(out, 'local-restore-drill.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return receipt;
  } catch (error) {
    receipt.error = String(error.message || error).slice(0, 2000);
    receipt.timingsSeconds = timings;
    fs.writeFileSync(path.join(out, 'local-restore-drill.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    throw error;
  } finally {
    archive.fill(0);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const value = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
  if (!value('--manifest') || !value('--out')) throw Error('--manifest and --out are required');
  const target = JSON.parse(fs.readFileSync(value('--target') || path.join(ROOT, 'deploy/recovery-free-hosted.json'), 'utf8'));
  const result = await localRestoreDrill({ target, manifestFile: path.resolve(value('--manifest')), out: path.resolve(value('--out')),
    expectCounts: value('--expect-counts') ? JSON.parse(value('--expect-counts')) : null });
  console.log(JSON.stringify({ database: result.database, countsMatchManifest: result.countsMatchManifest, mismatches: result.mismatches,
    functional: result.functional, timingsSeconds: result.timingsSeconds, dataLayerRecoverySeconds: result.dataLayerRecoverySeconds }));
  if (!result.countsMatchManifest) process.exitCode = 1;
}
