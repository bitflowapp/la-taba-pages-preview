// Build firmada del Rider de PRODUCCIÓN (la-taba.pages.dev → wwcpogltfgzgkrlilbcd).
//
// - El destino no se elige: es producción, y el build de Gradle se niega a nombrar otro backend.
// - La clave publicable se lee del runtime-config.js que la tienda ya publica (es pública) y se
//   exige que sea de ese mismo proyecto; nunca una clave secreta ni de servicio.
// - Firma con la clave de producción (scripts/production/create-rider-production-signing-key.mjs),
//   nunca con la del piloto.
// - Verifica el APK resultante: firma, paquete, versión, y que el dex lleve la URL de producción y
//   la de ningún otro entorno. Deja un recibo en deploy/production.rider-receipt.json.
//
//   node scripts/production/build-rider-production.mjs --version-code <n> --version-name <x.y.z-canonical>
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { PRODUCTION_BACKUP_NAME, PRODUCTION_PASSWORD_NAME, productionKeystorePath } from './create-rider-production-signing-key.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const STORE = 'https://la-taba.pages.dev';
const OTHER_REFS = ['ucbtjcurawxjwjdvvcvj', 'tkanbadcglszlcyfjvpv', 'yakhtrkukqlgzvxuvhzs', 'ukxqbgswjlibmnjemrzd'];
const arg = (name, fallback = '') => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const versionCode = Number(arg('--version-code'));
const versionName = arg('--version-name');
if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 99999) throw Error('INVALID_VERSION_CODE');
if (!/^[0-9]+\.[0-9]+\.[0-9]+-canonical$/.test(versionName)) throw Error('INVALID_VERSION_NAME');

const configText = await (await fetch(`${STORE}/runtime-config.js`, { cache: 'no-store' })).text();
const publicKey = configText.match(/publishableKey:\s*'([^']+)'/)?.[1] || '';
const supabaseUrl = configText.match(/supabaseUrl:\s*'([^']+)'/)?.[1] || '';
if (supabaseUrl !== `https://${PRODUCTION_REF}.supabase.co` || !/deploymentEnvironment:\s*'production'/.test(configText))
  throw Error('STORE_IS_NOT_PRODUCTION');
if (!publicKey.startsWith('sb_publishable_')) throw Error('STORE_KEY_IS_NOT_PUBLISHABLE');

const keystore = productionKeystorePath();
const password = leerSecreto(PRODUCTION_PASSWORD_NAME)?.secreto;
const backup = leerSecreto(PRODUCTION_BACKUP_NAME)?.secreto;
if (!existsSync(keystore) || !password || !backup || !readFileSync(keystore).equals(Buffer.from(backup, 'base64')))
  throw Error('PRODUCTION_SIGNING_MATERIAL_OR_BACKUP_MISSING');

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk');
const project = path.join(ROOT, 'apps', 'rider-android');
// Non-incremental Kotlin: an incremental compile can keep another target's inlined BuildConfig
// constants when only BuildConfig changed. The dex check below is the final guarantee.
const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, RIDER_TARGET_MODE: 'production',
  RIDER_BACKEND_REF: PRODUCTION_REF, RIDER_PUBLIC_KEY: publicKey,
  RIDER_PRODUCTION_KEYSTORE_PATH: keystore, RIDER_PRODUCTION_SIGNING_PASS: password };
delete env.RIDER_PILOT_KEYSTORE_PATH; delete env.RIDER_PILOT_SIGNING_PASS;
const built = spawnSync('cmd.exe', ['/d', '/c', '.\\gradlew.bat', '-Pkotlin.incremental=false', ':app:assembleRelease',
  `-PriderPilotVersionCode=${versionCode}`, `-PriderPilotVersionName=${versionName}`, '--console=plain'],
{ cwd: project, stdio: 'inherit', windowsHide: true, env });
if (built.status !== 0) throw Error('PRODUCTION_BUILD_FAILED');

const apk = path.join(project, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!existsSync(apk)) throw Error('SIGNED_PRODUCTION_APK_MISSING');
const toolsDir = path.join(sdk, 'build-tools', '36.0.0');
const verify = spawnSync('cmd.exe', ['/d', '/c', path.join(toolsDir, 'apksigner.bat'), 'verify', '--print-certs', apk], { encoding: 'utf8', windowsHide: true });
if (verify.status !== 0) throw Error(`PRODUCTION_APK_SIGNATURE_INVALID:${verify.status}`);
const signer = verify.stdout.match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9]{64})/i)?.[1];
if (!signer) throw Error('PRODUCTION_CERTIFICATE_DIGEST_MISSING');
const aapt = spawnSync(path.join(toolsDir, 'aapt.exe'), ['dump', 'badging', apk], { encoding: 'utf8', windowsHide: true });
const packageId = aapt.stdout.match(/package: name='([^']+)'/)?.[1];
const actualVersionCode = Number(aapt.stdout.match(/versionCode='(\d+)'/)?.[1]);
const actualVersionName = aapt.stdout.match(/versionName='([^']+)'/)?.[1];
const label = aapt.stdout.match(/application-label:'([^']+)'/)?.[1];
if (aapt.status !== 0 || packageId !== 'com.lataba.rider.production' || actualVersionCode !== versionCode
  || actualVersionName !== `${versionName}-production` || label !== 'La Taba Rider')
  throw Error('PRODUCTION_PACKAGE_IDENTITY_MISMATCH');
if (/application-debuggable/.test(aapt.stdout)) throw Error('PRODUCTION_APK_IS_DEBUGGABLE');
// Windows bsdtar reads zip (an APK); a GNU tar earlier in PATH (Git Bash) does not.
const bsdtar = path.join(process.env.SystemRoot || process.env.windir || '', 'System32', 'tar.exe');
const dexNames = (spawnSync(bsdtar, ['-tf', apk], { encoding: 'utf8', windowsHide: true }).stdout || '').split(/\r?\n/).filter((n) => /^classes\d*\.dex$/.test(n));
if (!dexNames.length) throw Error('PRODUCTION_APK_DEX_UNREADABLE');
const dex = Buffer.concat(dexNames.map((n) => spawnSync(bsdtar, ['-xOf', apk, n], { windowsHide: true, maxBuffer: 256 * 1024 * 1024 }).stdout || Buffer.alloc(0)));
const embedsUrl = (ref) => dex.includes(Buffer.from(`https://${ref}.supabase.co`));
if (!embedsUrl(PRODUCTION_REF) || OTHER_REFS.some(embedsUrl)) throw Error('PRODUCTION_APK_BACKEND_MISMATCH');

const sourceSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const dirty = spawnSync('git', ['status', '--porcelain', '--', 'apps/rider-android'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const receipt = { target: 'production', store: STORE, backend: PRODUCTION_REF, packageId, versionCode, versionName: actualVersionName,
  certificateSha256: signer, apkSha256: createHash('sha256').update(readFileSync(apk)).digest('hex'),
  embeddedBackendUrl: `https://${PRODUCTION_REF}.supabase.co`, sourceCommit: sourceSha, sourceTreeClean: dirty === '',
  apkFile: 'apps/rider-android/app/build/outputs/apk/release/app-release.apk', builtAt: new Date().toISOString() };
writeFileSync(path.join(ROOT, 'deploy', 'production.rider-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(receipt));
