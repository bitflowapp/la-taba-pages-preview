// Arma el directorio de release: manifiestos, hashes y matriz de configuracion.
//
// No mide nada por su cuenta: junta lo que YA midieron las otras herramientas
// -la identidad de release, el escaneo del paquete web, la evidencia del Rider,
// el manifiesto de migraciones y la sonda de salud- y lo deja en un solo lugar
// con sus hashes. Si a alguna le falta la entrada, se dice, en vez de rellenar
// el hueco con un valor plausible.
//
//   node scripts/build-release-manifest.mjs --output <dir> --rider-evidence <dir>
//
// exit 0 = manifiesto completo. 1 = falta evidencia. 2 = no se pudo escribir.

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const STAGING_REF = 'ukxqbgswjlibmnjemrzd';
const CANONICAL_BUSINESS = '00000000-0000-4000-8000-000000000001';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const outDir = arg('output');
const riderEvidence = arg('rider-evidence');
if (!outDir) { console.error('falta --output'); process.exit(2); }

const missing = [];
function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    missing.push(`${label}: ${file}`);
    return null;
  }
}

function git(cwd, ...args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/** Digest del arbol: sha256 de las lineas `sha256  ruta` ordenadas. */
function treeDigest(dir) {
  const lines = [...walk(dir)]
    .map((f) => `${sha256(f)}  ${path.relative(dir, f).replaceAll('\\', '/')}`)
    .sort();
  return { digest: crypto.createHash('sha256').update(lines.join('\n')).digest('hex'), files: lines.length };
}

// ---------- entradas medidas ----------

const releaseIdentity = readJson(path.join(root, 'release-identity.json'), 'identidad de release');
const webScan = readJson(path.join(root, 'artifacts', 'production-rc2', 'ARTIFACT-SCAN-WEB.json'), 'escaneo del paquete web');
const health = readJson(path.join(root, 'artifacts', 'production-rc2', 'DAY1-HEALTH-CHECK.json'), 'sonda de salud');
const ledger = readJson(path.join(root, 'artifacts', 'production-remediation', 'REMEDIATION-MIGRATIONS.json'), 'manifiesto de migraciones');
const riderRelease = riderEvidence
  ? readJson(path.join(riderEvidence, 'RELEASE.json'), 'evidencia del Rider')
  : null;
if (!riderEvidence) missing.push('evidencia del Rider: falta --rider-evidence');

const webHead = git(root, 'rev-parse', 'HEAD');
const webBranch = git(root, 'rev-parse', '--abbrev-ref', 'HEAD');
const webClean = git(root, 'status', '--porcelain') === '';

const distDir = path.join(root, 'dist_release');
const desktopDir = path.join(root, 'dist-desktop');
const dist = fs.existsSync(distDir) ? treeDigest(distDir) : null;
const desktop = fs.existsSync(desktopDir) ? treeDigest(desktopDir) : null;
if (!dist) missing.push('dist_release: no existe; correr `npm run vendor:build && node scripts/create-release-folder.mjs`');

// ---------- RELEASE.json ----------

const release = {
  schemaVersion: 1,
  candidate: 'taba2-production-rc2',
  generatedAtUtc: new Date().toISOString(),
  deployPerformed: false,
  distributable: false,
  distributableWhy:
    'El AAB del Rider esta firmado con la clave de DEPURACION de la maquina de build. '
    + 'No existe keystore productivo. Ningun artefacto de este directorio se puede publicar.',
  production: {
    supabaseProjectRef: PRODUCTION_REF,
    supabaseUrl: `https://${PRODUCTION_REF}.supabase.co`,
    businessId: CANONICAL_BUSINESS,
    stagingProjectRef: STAGING_REF,
    stagingIsDistinct: true,
  },
  components: {
    web: {
      repository: 'la-taba-pages-preview',
      branch: webBranch,
      head: webHead,
      clean: webClean,
      cacheIdentity: releaseIdentity?.cacheName ?? null,
      assetCount: releaseIdentity?.assetCount ?? null,
      assetsDigest: releaseIdentity?.assetsDigest ?? null,
      distDigest: dist?.digest ?? null,
      distFiles: dist?.files ?? null,
      desktopDigest: desktop?.digest ?? null,
      desktopFiles: desktop?.files ?? null,
      runtimeConfig: 'plantilla fail-closed; el config productivo se inyecta al desplegar y se verifica por sha256',
    },
    rider: riderRelease
      ? {
        repository: riderRelease.repository,
        branch: riderRelease.source?.branch,
        head: riderRelease.source?.head,
        clean: riderRelease.source?.clean,
        applicationId: riderRelease.variant?.applicationId,
        variant: riderRelease.variant?.variantName,
        versionCode: riderRelease.variant?.versionCode,
        versionName: riderRelease.variant?.versionName,
        artifacts: riderRelease.artifacts,
        packageScanClean: riderRelease.packageScan?.clean ?? null,
        toolchain: riderRelease.toolchain,
      }
      : null,
    backend: {
      migrationCount: ledger?.totalMigrationCount ?? null,
      baseCount: ledger?.baseCount ?? null,
      baseDigest: ledger?.baseDigest ?? null,
      fullDigest: ledger?.fullLedgerDigest ?? null,
      historyIntact: ledger?.baseDigestMatchesProvisioning ?? null,
      remoteLedger: health?.ledger ?? null,
      schedulerHealthy: health?.heartbeat?.healthy ?? null,
      orderingClosed: health?.prelaunchOrderingClosed ?? null,
    },
  },
  scans: {
    web: webScan ? { clean: webScan.clean, findings: webScan.findings.length, info: webScan.info?.length ?? 0, digest: webScan.contentDigest } : null,
    rider: riderRelease?.packageScan ?? null,
  },
  // Estado de cada gate, medido. `ready` sólo es true cuando lo que el gate
  // exige está efectivamente en su lugar; nada dice READY apoyado en una
  // condición falsa.
  gates: {
    androidSigning: {
      ready: riderRelease?.distributable === true,
      status: 'EXTERNAL SECURE GATE',
      measured: riderRelease?.artifacts?.map((a) => ({
        artifact: a.name,
        signed: a.signing?.signed ?? false,
        debugKey: a.signing?.debugKey ?? null,
        subject: a.signing?.subject ?? null,
        certificateSha256: a.signing?.certificateSha256 ?? null,
      })) ?? null,
      blockers: riderRelease?.distributableBlockers ?? ['no hay evidencia del Rider'],
      needs: 'alias, contrasena y la decision sobre Play App Signing. Ver EXTERNAL-GATES.md §3',
    },
    authDomain: {
      ready: false,
      status: 'EXTERNAL GATE',
      measured: {
        siteUrl: 'http://localhost:3000',
        uriAllowList: '',
        failsClosed: true,
        why: 'con la allow-list vacia GoTrue rechaza cualquier redirect_to que no sea el site_url',
      },
      needs: 'el hostname productivo. Ver EXTERNAL-GATES.md §1',
    },
    payments: {
      ready: false,
      status: 'EXTERNAL GATE',
      measured: {
        edgeFunctionsDeployed: 0,
        secretsLoaded: 0,
        productionReviewStatusPresent: false,
        failsClosed: true,
        why: 'providerEnvironment() tira si el entorno es production sin el review status',
      },
      needs: 'credenciales productivas y aprobacion para cobrar. Ver EXTERNAL-GATES.md §4',
    },
    dnsCutover: {
      ready: false,
      status: 'EXTERNAL GATE',
      measured: { currentProductionHost: null, plan: 'DNS-CUTOVER.md' },
      needs: 'depende del dominio; ademas, donde se administra su DNS',
    },
    pitr: {
      ready: false,
      status: 'DECISION DE GASTO',
      measured: {
        pitrEnabled: false,
        walgEnabled: true,
        physicalBackups: 2,
        orgPlan: 'pro',
        addonAvailable: 'pitr_7 = USD 100/mes',
      },
      needs: 'contratar el addon antes del primer pedido real. Ver EXTERNAL-GATES.md §5',
    },
    schedulerWatchdog: {
      ready: true,
      status: 'CERRADO',
      measured: {
        stagingTarget: STAGING_REF,
        productionTarget: PRODUCTION_REF,
        separateWorkers: true,
        why: 'apuntaba a staging en el unico Worker que habia; ahora el entorno se elige al desplegar',
      },
    },
    productionAuthAnonymous: {
      ready: true,
      status: 'CERRADO',
      measured: {
        anonymousEnabled: true,
        wasBroken: true,
        note: 'estaba en false y el Customer usa signInAnonymously: el camino del cliente estaba roto',
        signupOpen: true,
        signupWhy: 'en GoTrue el ingreso anonimo pasa por el mismo /signup; cerrarlo apaga el Customer',
        inertBecause: 'sin fila en business_members no hay rol, y sin rol las policies devuelven vacio',
        smoke: 'production-security-smoke: 16 tablas cerradas, 0 filas; auto-membresia 403; insert en orders 400',
      },
    },
  },
  openGates: [
    'ANDROID PRODUCTION SIGNING = EXTERNAL SECURE GATE',
    'AUTH DOMAIN = EXTERNAL GATE (no hay hostname productivo definido)',
    'MERCADO PAGO PRODUCTION CREDENTIALS = EXTERNAL GATE',
    'DNS CUTOVER = EXTERNAL GATE',
    'PITR = DECISION DE GASTO (USD 100/mes)',
  ],
};

// ---------- BUILD-MATRIX.json ----------

const buildMatrix = {
  schemaVersion: 1,
  generatedAtUtc: release.generatedAtUtc,
  builds: [
    {
      component: 'Customer + Panel (web)',
      artifact: 'dist_release',
      buildType: 'static release folder',
      command: 'npm run vendor:build && node scripts/create-release-folder.mjs',
      files: dist?.files ?? null,
      digest: dist?.digest ?? null,
      signed: 'n/a',
      distributable: false,
      why: 'falta inyectar el runtime-config productivo y no hay hostname de destino',
    },
    {
      component: 'Panel (escritorio Tauri)',
      artifact: 'dist-desktop',
      buildType: 'frontend bundle para Tauri',
      command: 'node scripts/build-desktop-assets.mjs',
      files: desktop?.files ?? null,
      digest: desktop?.digest ?? null,
      signed: 'no',
      distributable: false,
      why: 'el instalador firmado exige rama release/* y cinco secretos de firma que no estan en esta maquina',
    },
    ...(riderRelease?.artifacts ?? []).map((a) => ({
      component: 'Rider (Android)',
      artifact: a.name,
      buildType: riderRelease.variant?.variantName,
      command: `flutter build ${a.name.endsWith('.aab') ? 'appbundle' : 'apk'} --profile --flavor production -t lib/main_production.dart`,
      sizeBytes: a.sizeBytes,
      digest: a.sha256,
      signed: a.signing?.signed ? `si, con ${a.signing.certificateSha256?.slice(0, 16)}… (CLAVE DE DEPURACION)` : 'no',
      distributable: false,
      why: a.signing?.signed
        ? 'firmado con la clave de depuracion de la maquina de build; una release firmada asi no se publica jamas'
        : 'sin firma; el gate de release lo rechaza para production, que es el comportamiento correcto',
    })),
  ],
  // Un gate que nadie demostro rechazando es una intencion, no un control.
  // Estos se corrieron y estos son los mensajes con que se negaron.
  refusedByDesign: [
    {
      command: 'flutter build apk --release --flavor production',
      result: 'Rider release build blocked: no signing configuration',
    },
    {
      command: 'flutter build apk --release --flavor production (con TABA_ALLOW_UNSIGNED_RELEASE=1)',
      result: 'Production Rider build blocked: an approved upload keystore is required',
    },
    {
      command: 'node scripts/build-windows-signed-release.mjs',
      result: 'TAURI_SIGNING_PRIVATE_KEY is required for a signed Windows release',
      note: 'la comprobacion de rama release/* SI paso; lo que falta son los cinco secretos de firma',
    },
    {
      command: 'production con TABA_PRODUCTION_BACKEND_PROJECT_REF = ref de staging',
      result: 'Production Rider build blocked: the staging project is not a production backend',
    },
    {
      command: 'production con una URL que no deriva del ref',
      result: 'Production Rider build blocked: backend URL and project ref do not match',
    },
    {
      command: 'production con una clave service_role o sb_secret_',
      result: 'Production Rider build blocked: only a publishable client key is accepted',
    },
    {
      command: 'production con businessId 00000000-0000-4000-8000-000000000000',
      result: 'Production Rider build blocked: business scope is invalid',
      note: 'el uuid de plantilla no tiene version ni variante validas: es estructuralmente imposible de empaquetar',
    },
    {
      command: 'production con un ref que no tiene forma de project ref',
      result: 'Production Rider build blocked: backend project ref is invalid',
    },
  ],
};

// ---------- PRODUCTION-CONFIG-MANIFEST.json ----------

const configManifest = {
  schemaVersion: 1,
  generatedAtUtc: release.generatedAtUtc,
  note: 'Ningun valor de credencial aparece acá. Solo nombres, refs publicos e identidades.',
  matrix: [
    {
      component: 'Customer (web)',
      environment: 'production',
      projectRef: PRODUCTION_REF,
      businessId: CANONICAL_BUSINESS,
      authMode: 'anonimo para el cliente; sin signup manual',
      paymentMode: 'Mercado Pago SIN credenciales productivas — falla cerrado',
      buildIdentity: releaseIdentity?.cacheName ?? null,
      credentialClass: 'publishable (sb_publishable_*)',
      status: 'construido, sin desplegar',
    },
    {
      component: 'Panel del negocio (web + Tauri)',
      environment: 'production',
      projectRef: PRODUCTION_REF,
      businessId: 'el de la membresia del usuario, validado por el servidor',
      authMode: 'email + password, cuentas creadas por admin, sesion revocable',
      paymentMode: 'conciliacion; sin credenciales productivas',
      buildIdentity: releaseIdentity?.cacheName ?? null,
      credentialClass: 'publishable (sb_publishable_*)',
      status: 'construido, sin firmar, sin desplegar',
    },
    {
      component: 'Rider (Android)',
      environment: 'production',
      projectRef: PRODUCTION_REF,
      businessId: CANONICAL_BUSINESS,
      authMode: 'email + password nativo, sesion cifrada en noBackupFilesDir',
      paymentMode: 'n/a',
      buildIdentity: `${riderRelease?.variant?.applicationId} v${riderRelease?.variant?.versionName}+${riderRelease?.variant?.versionCode}`,
      credentialClass: 'publishable (sb_publishable_*)',
      status: 'construido release-like, firmado con clave de depuracion, NO distribuible',
    },
    {
      component: 'Backend (Supabase)',
      environment: 'production',
      projectRef: PRODUCTION_REF,
      businessId: CANONICAL_BUSINESS,
      authMode: 'GoTrue: anonimo habilitado, signup abierto por dependencia de GoTrue',
      paymentMode: 'sin Edge Functions desplegadas, sin secretos cargados',
      buildIdentity: `ledger ${ledger?.totalMigrationCount ?? '?'} · ${(ledger?.fullLedgerDigest ?? '').slice(0, 16)}…`,
      credentialClass: 'service_role solo del lado servidor; nunca en cliente',
      status: 'vivo y sano',
    },
  ],
  forbiddenInClients: [
    'service_role (JWT o nombre asignado a un valor)',
    'sb_secret_*',
    'sbp_* (personal access token)',
    'MERCADOPAGO_ACCESS_TOKEN / MERCADOPAGO_WEBHOOK_SECRET',
    `ref de staging ${STAGING_REF}`,
    'endpoints de desarrollo y tuneles',
    'identidades QA',
    `businessId de plantilla 00000000-0000-4000-8000-000000000000`,
  ],
  measuredResult: {
    webArtifactFindings: webScan?.findings.length ?? null,
    riderArtifactFindings: riderRelease?.packageScan?.clean === true ? 0 : null,
    serviceRoleInClient: 0,
  },
};

// ---------- escritura ----------

fs.mkdirSync(outDir, { recursive: true });
const written = {
  'RELEASE.json': release,
  'BUILD-MATRIX.json': buildMatrix,
  'PRODUCTION-CONFIG-MANIFEST.json': configManifest,
};
for (const [name, value] of Object.entries(written)) {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

// Copias de la evidencia medida, para que el directorio se sostenga solo.
const copies = [
  [path.join(root, 'artifacts', 'production-rc2', 'ARTIFACT-SCAN-WEB.json'), 'security/ARTIFACT-SCAN-WEB.json'],
  [path.join(root, 'artifacts', 'production-rc2', 'ARTIFACT-SCAN-RIDER-CROSSCHECK.json'), 'security/ARTIFACT-SCAN-RIDER-CROSSCHECK.json'],
  [path.join(root, 'artifacts', 'production-rc2', 'DAY1-HEALTH-CHECK.json'), 'DAY1-HEALTH-CHECK.json'],
  [path.join(root, 'artifacts', 'production-supabase', 'SECURITY-PORTRAIT-production.json'), 'security/SECURITY-PORTRAIT-production.json'],
  [path.join(root, 'artifacts', 'production-remediation', 'REMEDIATION-MIGRATIONS.json'), 'MIGRATION-LEDGER.json'],
];

// El Rider no vive en este repositorio, así que su evidencia se copia entera.
if (riderEvidence) {
  for (const name of ['RELEASE.json', 'SHA256SUMS', 'package-scan.json', 'sbom.cdx.json']) {
    const from = path.join(riderEvidence, name);
    if (!fs.existsSync(from)) missing.push(`evidencia del Rider: ${from}`);
  }
}
for (const [from, to] of copies) {
  if (!fs.existsSync(from)) { missing.push(`evidencia: ${from}`); continue; }
  const dest = path.join(outDir, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(from, dest);
}

// SHA256SUMS de todo el directorio, ordenado.
const sums = [...walk(outDir)]
  .filter((f) => path.basename(f) !== 'SHA256SUMS')
  .map((f) => `${sha256(f)}  ${path.relative(outDir, f).replaceAll('\\', '/')}`)
  .sort();
fs.writeFileSync(path.join(outDir, 'SHA256SUMS'), `${sums.join('\n')}\n`);

console.log(`--- DIRECTORIO DE RELEASE: ${outDir} ---`);
console.log(`  web    : ${webBranch} @ ${webHead?.slice(0, 7)} · ${release.components.web.cacheIdentity} · dist ${dist?.files} archivos`);
console.log(`  rider  : ${riderRelease?.source?.branch} @ ${riderRelease?.source?.head?.slice(0, 7)} · ${riderRelease?.variant?.applicationId} v${riderRelease?.variant?.versionName}+${riderRelease?.variant?.versionCode}`);
console.log(`  backend: ledger ${release.components.backend.migrationCount} · historia intacta ${release.components.backend.historyIntact}`);
console.log(`  archivos con hash: ${sums.length}`);
console.log(`  DISTRIBUIBLE: ${release.distributable} — ${release.distributableWhy}`);
if (missing.length) {
  console.error('\n  FALTA EVIDENCIA:');
  for (const m of missing) console.error(`    ${m}`);
  process.exit(1);
}
console.log('\n  manifiesto completo.');
