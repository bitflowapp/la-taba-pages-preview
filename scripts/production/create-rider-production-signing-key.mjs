// Clave de firma del Rider de PRODUCCIÓN (com.lataba.rider.production).
//
// Es otra clave que la del PILOTO (com.lataba.rider.pilot, CP) a propósito: una instalación de
// producción sólo puede actualizarse con otra build de producción. EC P-256 para que el keystore
// entero quepa como copia en el Credential Manager (límite de 2560 bytes por secreto). Vive fuera
// del repositorio, con ACL sólo para el usuario; la contraseña y la copia viven en el Credential
// Manager. Nada secreto se imprime: sólo la huella del certificado.
//
//   node scripts/production/create-rider-production-signing-key.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardarSecreto, generarContrasena, leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

export const PRODUCTION_KEY_ALIAS = 'lataba-rider-production-v1';
export const PRODUCTION_PASSWORD_NAME = 'RIDER PRODUCTION SIGNING PASSWORD';
export const PRODUCTION_BACKUP_NAME = 'RIDER PRODUCTION KEYSTORE BACKUP';
export function productionKeystorePath() {
  const userProfile = path.resolve(process.env.USERPROFILE || '');
  if (!process.env.USERPROFILE || !path.isAbsolute(userProfile)) throw Error('HOST_PROFILE_REQUIRED');
  return path.join(userProfile, '.codex', 'secrets', 'la-taba-rider-production', 'production-v1.p12');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = productionKeystorePath();
  const dir = path.dirname(target);
  const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  if (dir.toLowerCase().startsWith(repo.toLowerCase() + path.sep)) throw Error('KEYSTORE_MUST_BE_OUTSIDE_REPO');
  if (!process.env.JAVA_HOME) throw Error('JAVA_HOME_REQUIRED');
  const keytool = path.join(process.env.JAVA_HOME, 'bin', 'keytool.exe');
  if (!existsSync(keytool)) throw Error('JDK17_KEYTOOL_REQUIRED');
  const owner = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  const acl = (name) => {
    const result = spawnSync('icacls.exe', [name, '/inheritance:r', '/grant:r', `${owner}:F`], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw Error('KEYSTORE_ACL_FAILED');
  };
  mkdirSync(dir, { recursive: true }); acl(dir);
  let password = leerSecreto(PRODUCTION_PASSWORD_NAME)?.secreto;
  if (!existsSync(target)) {
    if (password || leerSecreto(PRODUCTION_BACKUP_NAME)) throw Error('PARTIAL_SIGNING_STATE_REQUIRES_RECOVERY');
    password = generarContrasena(48);
    const created = spawnSync(keytool, ['-genkeypair', '-alias', PRODUCTION_KEY_ALIAS, '-keyalg', 'EC', '-groupname', 'secp256r1',
      '-validity', '9125', '-dname', 'CN=La Taba Rider, OU=Production, O=La Taba, C=AR',
      '-keystore', target, '-storetype', 'PKCS12', '-storepass:env', 'RIDER_PRODUCTION_SIGNING_PASS',
      '-keypass:env', 'RIDER_PRODUCTION_SIGNING_PASS', '-noprompt'],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, RIDER_PRODUCTION_SIGNING_PASS: password } });
    if (created.status !== 0) throw Error(`KEYTOOL_CREATE_FAILED:${created.status}`);
    acl(target);
    const encoded = readFileSync(target).toString('base64');
    if (encoded.length > 2400) throw Error('KEYSTORE_TOO_LARGE_FOR_SECURE_BACKUP');
    guardarSecreto(PRODUCTION_PASSWORD_NAME, PRODUCTION_KEY_ALIAS, password);
    guardarSecreto(PRODUCTION_BACKUP_NAME, PRODUCTION_KEY_ALIAS, encoded);
  }
  if (!password) throw Error('PRODUCTION_SIGNING_PASSWORD_MISSING');
  const stored = leerSecreto(PRODUCTION_BACKUP_NAME)?.secreto;
  if (!stored || !readFileSync(target).equals(Buffer.from(stored, 'base64'))) throw Error('PRODUCTION_KEYSTORE_BACKUP_MISMATCH');
  const listed = spawnSync(keytool, ['-list', '-v', '-alias', PRODUCTION_KEY_ALIAS, '-keystore', target, '-storetype', 'PKCS12',
    '-storepass:env', 'RIDER_PRODUCTION_SIGNING_PASS'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, RIDER_PRODUCTION_SIGNING_PASS: password } });
  if (listed.status !== 0) throw Error('PRODUCTION_CERT_READ_FAILED');
  const fingerprint = listed.stdout.match(/SHA256:\s*([A-Fa-f0-9:]{95})/)?.[1];
  if (!fingerprint) throw Error('PRODUCTION_CERT_FINGERPRINT_MISSING');
  console.log(JSON.stringify({ keystoreOutsideRepo: true, aclRestricted: true, credentialManagerBackupMatches: true,
    certificateSha256: fingerprint.replaceAll(':', '').toLowerCase(), packageId: 'com.lataba.rider.production', alias: PRODUCTION_KEY_ALIAS }));
}
