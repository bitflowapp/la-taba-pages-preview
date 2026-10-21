// Native PostgreSQL tools; plaintext dumps remain in process memory.
import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { withRecoveryProject } from './hosted-client.mjs';
import { leerSecreto, guardarSecreto } from '../e2e-production-sale/secretos-windows.mjs';

export const MAGIC = Buffer.from('TABA-BACKUP-1\n');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function encryptBackup(bytes, key, metadata) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const aad = Buffer.from(JSON.stringify(metadata));
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const header = Buffer.from(JSON.stringify({ metadata, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64') }));
  const size = Buffer.alloc(4); size.writeUInt32BE(header.length);
  return Buffer.concat([MAGIC, size, header, encrypted]);
}

export function decryptBackup(bytes, key, projectRef) {
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Invalid backup envelope');
  const length = bytes.readUInt32BE(MAGIC.length);
  if (length > 10000) throw new Error('Invalid backup metadata length');
  const headerEnd = MAGIC.length + 4 + length;
  const { metadata, nonce, tag } = JSON.parse(bytes.subarray(MAGIC.length + 4, headerEnd));
  if (metadata.projectRef !== projectRef) throw new Error('Backup project mismatch');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
  decipher.setAAD(Buffer.from(JSON.stringify(metadata)));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return { metadata, plaintext: Buffer.concat([decipher.update(bytes.subarray(headerEnd)), decipher.final()]) };
}

export function postgresEnvironment(target, ca, database = 'postgres') {
  const credential = leerSecreto('RECOVERY FREE DB PASSWORD');
  if (credential?.usuario !== target.projectRef) throw new Error('Database credential project mismatch');
  return { ...process.env, PGHOST: `db.${target.projectRef}.supabase.co`, PGPORT: '5432',
    PGUSER: 'postgres', PGDATABASE: database, PGPASSWORD: credential.secreto,
    PGSSLMODE: 'verify-full', PGSSLROOTCERT: path.resolve(ca), PGCONNECT_TIMEOUT: '10' };
}

export function nativeCommand(tools, name, args, options = {}) {
  const binary = path.join(tools, name + (process.platform === 'win32' ? '.exe' : ''));
  const result = spawnSync(binary, args, { maxBuffer: 128 * 1024 * 1024, timeout: 150000,
    windowsHide: true, ...options });
  if (result.status !== 0) {
    const secret = options.env?.PGPASSWORD || '';
    // Restore errors may echo COPY rows or SQL containing protected material.
    // Only the first diagnostic line is suitable for console/audit output.
    const stderr = String(result.stderr || result.error?.code || 'Native PostgreSQL operation failed').split(/\r?\n/)[0];
    throw new Error(`${name} failed: ${secret ? stderr.replaceAll(secret, '[redacted]') : stderr}`.slice(0, 700));
  }
  return result.stdout;
}

export function backupKey(target, create = false) {
  let credential = leerSecreto('RECOVERY BACKUP ENCRYPTION KEY');
  if (!credential && create) {
    guardarSecreto('RECOVERY BACKUP ENCRYPTION KEY', target.projectRef, randomBytes(32).toString('base64'));
    credential = leerSecreto('RECOVERY BACKUP ENCRYPTION KEY');
  }
  if (credential?.usuario !== target.projectRef) throw new Error('Backup key project mismatch');
  const key = Buffer.from(credential.secreto, 'base64');
  if (key.length !== 32) throw new Error('Invalid backup key');
  return key;
}

export async function createPostgresBackup({ target, tools, ca, out }) {
  if (process.platform === 'win32' && !/^D:[\\/]/i.test(path.resolve(out))) throw new Error('Use D: for backup files');
  if (fs.existsSync(out)) throw new Error('New backup directory required');
  return withRecoveryProject(target, async ({ query, request }) => {
    const metadata = { projectRef: target.projectRef, capturedAt: new Date().toISOString(), format: 'pg_dump-custom' };
    const environment = postgresEnvironment(target, ca);
    const version = nativeCommand(tools, 'pg_dump', ['--version'], { encoding: 'utf8' }).trim();
    const bytes = nativeCommand(tools, 'pg_dump', ['--no-password', '--format=custom', '--compress=6', '--lock-wait-timeout=10000'], { env: environment });
    if (bytes.subarray(0, 5).toString() !== 'PGDMP') throw new Error('Invalid custom archive');
    const key = backupKey(target, true), encrypted = encryptBackup(bytes, key, metadata);
    const restored = decryptBackup(encrypted, key, target.projectRef).plaintext;
    if (!restored.equals(bytes)) throw new Error('Backup encryption roundtrip failed');
    const baseline = await query(`select (select count(*) from auth.users)::int auth_users,
      (select count(*) from public.products)::int products, (select count(*) from public.orders)::int orders,
      (select count(*) from storage.objects)::int storage_objects,
      (select count(*) from private.la_taba_recovery_migrations)::int migration_versions,
      (select count(*) from private.la_taba_recovery_source_rows)::int recovered_source_rows`);
    const auth = await request('/config/auth');
    const safeAuthNames = ['site_url','uri_allow_list','disable_signup','jwt_exp','mailer_autoconfirm',
      'external_anonymous_users_enabled','external_email_enabled','refresh_token_rotation_enabled',
      'password_min_length','security_refresh_token_reuse_interval'];
    const authConfiguration = Object.fromEntries(safeAuthNames.map(name => [name, auth[name]]));
    fs.mkdirSync(out, { recursive: true });
    const archive = path.join(out, 'database.pgdump.aesgcm');
    fs.writeFileSync(archive, encrypted, { flag: 'wx' });
    const evidence = { ...metadata, version, databaseTls: 'verify-full', plaintextSha256: digest(bytes),
      encryptedSha256: digest(encrypted), plaintextBytes: bytes.length, encryptedBytes: encrypted.length,
      encryptionRoundtripVerified: true, archive, baseline, authConfiguration,
      storageObjectExportRequired: baseline[0].storage_objects > 0,
      includesDatabaseRoles: false, includesEdgeSecretValues: false,
      restoreTestCompleted: false, remoteBackupCreated: false };
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(evidence, null, 2) + '\n');
    bytes.fill(0); restored.fill(0); key.fill(0);
    return evidence;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const value = name => process.argv[process.argv.indexOf(name) + 1];
  if (!['--backup','--target','--tools','--ca','--out'].every(name => process.argv.includes(name))) throw new Error('Explicit backup arguments required');
  console.log(JSON.stringify(await createPostgresBackup({ target: JSON.parse(fs.readFileSync(value('--target'), 'utf8')),
    tools: value('--tools'), ca: value('--ca'), out: path.resolve(value('--out')) })));
}
