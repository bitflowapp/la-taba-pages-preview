// Real Rider environment matrix, on the operator machine that holds the signing
// material. Every signed Rider shares the package and certificate of the
// CONTROLLED_PRODUCTION app, so what decides where a rider ends up is the
// target and the backend ref, never the versionCode alone.
//
//   1. builder gate  scripts/e2e-staging/build-rider-pilot.mjs: every blocked
//                    case must stop before secrets and Gradle.
//   2. Gradle gate   `:app:help` (configuration only) with the environment a
//                    signed build carries: the same verdicts without the node
//                    builder, for whoever runs Gradle directly. No secret used.
//   3. --build-allowed: the allowed cases are built and signed for real; the APK
//                    must carry the expected package, versionCode, backend URL
//                    and certificate, and no other environment's URL.
//
//   node scripts/controlled-production/rider-env-matrix.mjs [--build-allowed] [--out file]
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const REFS = { staging: 'ucbtjcurawxjwjdvvcvj', cp: JSON.parse(readFileSync('deploy/controlled-production.json', 'utf8')).rider.backendRef,
  production: 'wwcpogltfgzgkrlilbcd', demo: 'yakhtrkukqlgzvxuvhzs', wrong: 'abcdefghijklmnopqrst' };
const CP_CERT = '2dcc9b0a0cf022ebf59c500331103ee31cec9e9142d5431553131877948ec1aa';
const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : `artifacts/controlled-production/rider-env-matrix-${Date.now()}.json`;
const KEYSTORE = path.join(homedir(), '.codex', 'secrets', 'la-taba-rider-pilot', 'pilot-v1.p12');
const PROJECT = path.resolve('apps/rider-android');
const TOOLS = path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'build-tools', '36.0.0');
// Windows bsdtar reads zip (an APK); a GNU tar earlier in PATH (Git Bash) does not.
const BSDTAR = path.join(process.env.SystemRoot || process.env.windir || '', 'System32', 'tar.exe');

// [case, target, ref, versionCode, versionName, expected ('ALLOWED' or the gate that must answer)]
const MATRIX = [
  ['STAGING_V3', 'staging', null, 3, '0.1.2-canonical', 'ALLOWED'],
  ['STAGING_GT_V3', 'staging', null, 4, '0.1.3-canonical', { builder: /SIGNED_STAGING_MUST_STAY_BELOW_CONTROLLED_PRODUCTION/, gradle: /Signed Staging Rider must stay below every CONTROLLED_PRODUCTION versionCode/ }],
  ['PILOT_CP_V4_CORRECT_REF', 'pilot', REFS.cp, 4, '0.1.3-canonical', 'ALLOWED'],
  ['PILOT_WRONG_REF', 'pilot', REFS.wrong, 4, '0.1.3-canonical', { builder: /PILOT_REF_MUST_BE_CONTROLLED_PRODUCTION/, gradle: /Signed PILOT Rider must target CONTROLLED_PRODUCTION/ }],
  ['GENERAL_PRODUCTION_REF', 'pilot', REFS.production, 4, '0.1.3-canonical', { builder: /PILOT_BACKEND_REF_REQUIRED_AND_MUST_BE_ISOLATED/, gradle: /Rider backend must be a non-Production Supabase project/ }],
  ['STAGING_REF_AS_PILOT', 'pilot', REFS.staging, 4, '0.1.3-canonical', { builder: /PILOT_BACKEND_REF_REQUIRED_AND_MUST_BE_ISOLATED/, gradle: /Staging and PILOT Rider builds require distinct backends/ }],
  ['DEMO_REF', 'pilot', REFS.demo, 4, '0.1.3-canonical', { builder: /PILOT_BACKEND_REF_REQUIRED_AND_MUST_BE_ISOLATED/, gradle: /Rider backend must be a non-Production Supabase project/ }],
  ['MISSING_TARGET', null, null, 4, '0.1.3-canonical', { builder: /RIDER_TARGET_REQUIRED/, gradle: /Signed Rider needs an explicit RIDER_TARGET_MODE and RIDER_BACKEND_REF/ }],
];

const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('RIDER_')));
const builderArgs = ([, target, ref, vc, vn]) => [...(target ? ['--target', target] : []), ...(ref ? ['--project-ref', ref] : []),
  '--version-code', String(vc), '--version-name', vn];

function builderGate(row) {
  const r = spawnSync(process.execPath, ['scripts/e2e-staging/build-rider-pilot.mjs', ...builderArgs(row)],
    { encoding: 'utf8', windowsHide: true, timeout: 20_000, env: cleanEnv() });
  return { status: r.status, gate: (r.stderr.match(/Error: ([A-Z_]+)/) || [])[1] || null };
}

function gradleGate([, target, ref, vc]) {
  const env = { ...cleanEnv(), ANDROID_HOME: path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'),
    // Path and password travel together in a signed build; configuration never opens
    // the keystore, so a placeholder password is enough and no secret is read.
    RIDER_PILOT_KEYSTORE_PATH: KEYSTORE, RIDER_PILOT_SIGNING_PASS: 'env-matrix-placeholder',
    RIDER_PUBLIC_KEY: 'sb_publishable_env_matrix_placeholder' };
  if (target) env.RIDER_TARGET_MODE = target;
  if (target) env.RIDER_BACKEND_REF = ref || (target === 'staging' ? REFS.staging : '');
  const r = spawnSync('cmd.exe', ['/d', '/c', '.\\gradlew.bat', ':app:help', '--console=plain', '-q', `-PriderPilotVersionCode=${vc}`],
    { cwd: PROJECT, encoding: 'utf8', windowsHide: true, timeout: 600_000, env });
  const text = `${r.stdout}\n${r.stderr}`;
  const reason = (text.match(/What went wrong:\s*\r?\n([^\r\n]+)/) || [])[1] || null;
  return { status: r.status, reason: reason && reason.trim().slice(0, 160), text };
}

function inspectApk(apk) {
  const badging = spawnSync(path.join(TOOLS, 'aapt.exe'), ['dump', 'badging', apk], { encoding: 'utf8', windowsHide: true });
  const certs = spawnSync('cmd.exe', ['/d', '/c', path.join(TOOLS, 'apksigner.bat'), 'verify', '--print-certs', apk], { encoding: 'utf8', windowsHide: true });
  const list = spawnSync(BSDTAR, ['-tf', apk], { encoding: 'utf8', windowsHide: true });
  const dexNames = (list.stdout || '').split(/\r?\n/).filter((n) => /^classes\d*\.dex$/.test(n));
  let dex = Buffer.alloc(0);
  for (const name of dexNames) {
    const out = spawnSync(BSDTAR, ['-xOf', apk, name], { windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
    dex = Buffer.concat([dex, out.stdout]);
  }
  const has = (ref) => dex.includes(Buffer.from(`https://${ref}.supabase.co`));
  return {
    packageId: badging.stdout.match(/package: name='([^']+)'/)?.[1],
    versionCode: Number(badging.stdout.match(/versionCode='(\d+)'/)?.[1]),
    versionName: badging.stdout.match(/versionName='([^']+)'/)?.[1],
    certificate: certs.stdout.match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9]{64})/i)?.[1],
    backendUrls: Object.fromEntries(Object.entries(REFS).map(([name, ref]) => [name, has(ref)])),
  };
}

const report = { at: new Date().toISOString(), refs: REFS, cases: {} };
for (const row of MATRIX) {
  const [name, target, , vc, , expected] = row;
  const allowed = expected === 'ALLOWED';
  // Never run the builder for an allowed case here: it would start a real signed Gradle
  // build that outlives the timeout and races the next one in the same project.
  const b = allowed ? null : builderGate(row);
  // An allowed case passes the builder gate and then builds; without --build-allowed the
  // builder is not run for it (it would sign an APK) and layer 2/3 decide.
  const builderVerdict = allowed ? 'NOT_RUN_ALLOWED' : (b.status !== 0 && expected.builder.test(b.gate || '') ? 'BLOCKED' : 'NOT_BLOCKED');
  const g = gradleGate(row);
  const gradleVerdict = g.status === 0 ? 'ALLOWED' : 'BLOCKED';
  const entry = { target, versionCode: vc, expected: allowed ? 'ALLOWED' : 'BLOCKED', builder: allowed ? 'n/a' : b.gate,
    builderVerdict, gradleVerdict, gradleReason: g.status === 0 ? null : g.reason };
  if (allowed && args.includes('--build-allowed')) {
    const built = spawnSync(process.execPath, ['scripts/e2e-staging/build-rider-pilot.mjs', ...builderArgs(row)],
      { encoding: 'utf8', windowsHide: true, timeout: 1_800_000, env: cleanEnv(), maxBuffer: 64 * 1024 * 1024 });
    const apk = path.join(PROJECT, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
    entry.build = { status: built.status, gate: (built.stderr.match(/Error: ([A-Z_]+)/) || [])[1] || null };
    if (built.status === 0 && existsSync(apk)) {
      const keep = path.join('.local', `rider-matrix-${name.toLowerCase()}.apk`);
      mkdirSync('.local', { recursive: true });
      copyFileSync(apk, keep);
      entry.apk = inspectApk(keep);
      const want = target === 'pilot' ? 'cp' : 'staging';
      entry.apkVerdict = entry.apk.packageId === 'com.lataba.rider.pilot' && entry.apk.versionCode === vc
        && entry.apk.certificate === CP_CERT && entry.apk.backendUrls[want]
        && Object.entries(entry.apk.backendUrls).every(([k, v]) => k === want || !v) ? 'PASS' : 'FAIL';
    }
  }
  entry.verdict = allowed
    ? (gradleVerdict === 'ALLOWED' && (!entry.build || entry.apkVerdict === 'PASS') ? 'ALLOWED' : 'FAIL')
    : (builderVerdict === 'BLOCKED' && gradleVerdict === 'BLOCKED' && expected.gradle.test(g.text) ? 'BLOCKED' : 'FAIL');
  report.cases[name] = entry;
  process.stderr.write(`${name}: ${entry.verdict} (builder ${entry.builder ?? '-'} · gradle ${gradleVerdict}${entry.apkVerdict ? ` · apk ${entry.apkVerdict}` : ''})\n`);
}
report.RIDER_ENVIRONMENT_ISOLATION = Object.values(report.cases).every((c) => c.verdict === c.expected) ? 'PASS' : 'FAIL';
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out: OUT, RIDER_ENVIRONMENT_ISOLATION: report.RIDER_ENVIRONMENT_ISOLATION,
  cases: Object.fromEntries(Object.entries(report.cases).map(([k, v]) => [k, v.verdict])) }));
process.exit(report.RIDER_ENVIRONMENT_ISOLATION === 'PASS' ? 0 : 1);
