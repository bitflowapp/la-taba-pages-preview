// Respaldo cifrado propio del proyecto de PRODUCCIÓN: el mismo sobre que QA (scripts/recovery/postgres-backup.mjs:
// pg_dump custom + roles sin contraseñas, AES-256-GCM, TLS verify-full, ida y vuelta verificada), con sus propias
// credenciales y detrás de la guardia de producción (registro, organización paga, región, marca de la base).
//
//   node scripts/production/backup.mjs --tools <bin de PostgreSQL 17> --ca <prod-ca-2021.crt> --out <directorio nuevo en D:>
//
// Credenciales (Administrador de credenciales de Windows, usuario = ref de producción; nunca en el repositorio):
//   TABA2 E2E:PRODUCTION DB PASSWORD           contraseña de la base (la carga una persona)
//   TABA2 E2E:PRODUCTION BACKUP ENCRYPTION KEY se crea en la primera corrida; GUARDAR UNA COPIA SEPARADA (custodio D4):
//                                              sin ella los respaldos no se pueden abrir
//
// Lo que este archivo NO contiene, y se repone aparte: bytes de Storage, secretos de las funciones, Vault, la
// configuración de Auth (sólo un subconjunto seguro va al manifiesto), el estado de los cron y la aplicación de
// Mercado Pago. Ver docs/audit/commercial-readiness-20261023/RESPALDOS-Y-RECUPERACION.md.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { productionTargetOrExit } from '../lib/environments.mjs';
import { guardarSecreto, leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { decryptBackup, encryptBackup, nativeCommand } from '../recovery/postgres-backup.mjs';
import { assertPrivateOutputDirectory } from '../recovery/private-output.mjs';
import { LEDGER_TABLE, withProductionProject } from './hosted.mjs';

export const DB_PASSWORD_NAME = 'PRODUCTION DB PASSWORD';
export const BACKUP_KEY_NAME = 'PRODUCTION BACKUP ENCRYPTION KEY';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function productionBackupKey(ref, { create = false, read = leerSecreto, save = guardarSecreto } = {}) {
  let credential = read(BACKUP_KEY_NAME);
  if (!credential && create) {
    save(BACKUP_KEY_NAME, ref, randomBytes(32).toString('base64'));
    credential = read(BACKUP_KEY_NAME);
  }
  if (credential?.usuario !== ref) throw new Error('La clave de respaldo no es de este proyecto');
  const key = Buffer.from(credential.secreto, 'base64');
  if (key.length !== 32) throw new Error('Clave de respaldo inválida');
  return key;
}

export function productionPostgresEnvironment(ref, ca, { read = leerSecreto } = {}) {
  const credential = read(DB_PASSWORD_NAME);
  if (credential?.usuario !== ref) throw new Error('La contraseña de la base no es de este proyecto');
  return { ...process.env, PGHOST: `db.${ref}.supabase.co`, PGPORT: '5432', PGUSER: 'postgres', PGDATABASE: 'postgres',
    PGPASSWORD: credential.secreto, PGSSLMODE: 'verify-full', PGSSLROOTCERT: path.resolve(ca), PGCONNECT_TIMEOUT: '10' };
}

export async function createProductionBackup({ tools, ca, out }) {
  assertPrivateOutputDirectory(out);
  if (process.platform === 'win32' && !/^D:[\\/]/i.test(path.resolve(out))) throw new Error('Use D: for backup files');
  if (fs.existsSync(out)) throw new Error('New backup directory required');
  return withProductionProject(async ({ target, query, request }) => {
    const metadata = { projectRef: target.ref, environment: 'production', capturedAt: new Date().toISOString(), format: 'pg_dump-custom' };
    const environment = productionPostgresEnvironment(target.ref, ca);
    const version = nativeCommand(tools, 'pg_dump', ['--version'], { encoding: 'utf8' }).trim();
    const bytes = nativeCommand(tools, 'pg_dump', ['--no-password', '--format=custom', '--compress=6', '--lock-wait-timeout=10000'], { env: environment, timeout: 600000 });
    const roles = nativeCommand(tools, 'pg_dumpall', ['--no-password', '--roles-only', '--no-role-passwords'], { env: environment });
    if (bytes.subarray(0, 5).toString() !== 'PGDMP') throw new Error('Invalid custom archive');
    const key = productionBackupKey(target.ref, { create: true });
    const encrypted = encryptBackup(bytes, key, metadata);
    const restored = decryptBackup(encrypted, key, target.ref).plaintext;
    if (!restored.equals(bytes)) throw new Error('Backup encryption roundtrip failed');
    const [baseline] = await query(`select (select count(*) from auth.users)::int auth_users,
      (select count(*) from public.products)::int products, (select count(*) from public.orders)::int orders,
      (select count(*) from public.payment_intents)::int payment_intents, (select count(*) from storage.objects)::int storage_objects,
      (select count(*) from ${LEDGER_TABLE})::int migration_versions`);
    const auth = await request('/config/auth');
    const safeAuthNames = ['site_url', 'uri_allow_list', 'disable_signup', 'jwt_exp', 'mailer_autoconfirm', 'external_anonymous_users_enabled',
      'external_email_enabled', 'refresh_token_rotation_enabled', 'password_min_length', 'security_refresh_token_reuse_interval'];
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, 'database.pgdump.aesgcm'), encrypted, { flag: 'wx' });
    const rolesMetadata = { ...metadata, format: 'pg_dumpall-roles-without-passwords' };
    const encryptedRoles = encryptBackup(roles, key, rolesMetadata);
    fs.writeFileSync(path.join(out, 'roles.sql.aesgcm'), encryptedRoles, { flag: 'wx' });
    const manifest = { ...metadata, version, databaseTls: 'verify-full', plaintextSha256: digest(bytes), encryptedSha256: digest(encrypted),
      plaintextBytes: bytes.length, encryptedBytes: encrypted.length, encryptionRoundtripVerified: true,
      baseline: [baseline], authConfiguration: Object.fromEntries(safeAuthNames.map((name) => [name, auth[name]])),
      storageObjectExportRequired: baseline.storage_objects > 0, includesDatabaseRoles: true, rolesPasswordsIncluded: false,
      rolesBackup: { ...rolesMetadata, encryptedSha256: digest(encryptedRoles), encryptedBytes: encryptedRoles.length, plaintextSha256: digest(roles) },
      includesEdgeSecretValues: false, restoreTestCompleted: false, remoteBackupCreated: false };
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    bytes.fill(0); roles.fill(0); restored.fill(0); key.fill(0);
    return manifest;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = (name) => process.argv[process.argv.indexOf(name) + 1];
  productionTargetOrExit({ allowProvisioned: true });
  if (!['--tools', '--ca', '--out'].every((name) => process.argv.includes(name))) {
    console.error('uso: backup.mjs --tools <bin> --ca <crt> --out <directorio nuevo en D:>');
    process.exit(2);
  }
  const manifest = await createProductionBackup({ tools: value('--tools'), ca: value('--ca'), out: path.resolve(value('--out')) });
  console.log(JSON.stringify({ projectRef: manifest.projectRef, capturedAt: manifest.capturedAt, encryptedSha256: manifest.encryptedSha256,
    encryptedBytes: manifest.encryptedBytes, baseline: manifest.baseline, storageObjectExportRequired: manifest.storageObjectExportRequired }));
}
