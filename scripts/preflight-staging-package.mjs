/*
 * Preflight cerrado del paquete de preview staging/preprod.
 *
 * El paquete tiene dos identidades distintas:
 *
 *   1. código: sw.js + todos los archivos del precache salvo runtime-config.js;
 *   2. runtime: runtime-config.js materializado al preparar el deployment.
 *
 * El runtime sigue en el precache, pero no puede cambiar la firma del código
 * cuando se reemplaza la plantilla por la configuración aprobada del entorno.
 *
 * Uso:
 *   node scripts/preflight-staging-package.mjs <dir> <runtime-config-vivo> [--report <path>]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  calcularIdentidad,
  RUNTIME_CONFIG_PATH,
} from './check-release-identity.mjs';
import {
  checkRuntimeConfig,
  readRuntimeFile,
} from './check-runtime-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(ROOT, 'release-identity.json');
const PROHIBIDAS = [
  'catalog',
  'data',
  'docs',
  'tests',
  'scripts',
  'supabase',
  'package.json',
  'package-lock.json',
  'README.md',
  '.env',
  'node_modules',
];
export const EXPECTED = Object.freeze({
  app: '?v=42',
  css: '?v=50',
  pwa: '?v=3',
  recovery: '?v=2',
  cache: 'la-taba-runtime-v66-production-blockers',
  environment: 'staging',
  supabaseRef: 'ukxqbgswjlibmnjemrzd',
});
export const PERMITTED_VERSIONS = new Set(['50', '42', '3', '2']);

const sha = (filePath) => crypto
  .createHash('sha256')
  .update(fs.readFileSync(filePath))
  .digest('hex');

const read = (filePath) => fs.readFileSync(filePath, 'utf8');

function sourceHead(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

function runtimeSecurityErrors(value, label) {
  const errors = [];
  const visit = (candidate, trail = '$') => {
    if (!candidate || typeof candidate !== 'object') return;

    for (const [key, child] of Object.entries(candidate)) {
      const normalizedKey = key.toLowerCase();
      const childTrail = trail + '.' + key;

      if (
        typeof child === 'string'
        && /(?:access.?token|service.?role|webhook.?secret|private.?key|secret)/i.test(normalizedKey)
        && child.trim()
      ) {
        errors.push(label + ': no debe contener secretos en ' + childTrail);
      }

      if (
        /(?:demo|showcase)/i.test(normalizedKey)
        && (child === true || ['demo', 'showcase'].includes(String(child).toLowerCase()))
      ) {
        errors.push(label + ': demo/showcase no puede quedar habilitado en runtime');
      }

      if (/(?:mercado.?pago|mercadopago)/i.test(normalizedKey)) {
        const text = typeof child === 'string' ? child.toLowerCase() : '';
        if (child === true || /^(?:prod|production|live)$/.test(text)) {
          errors.push(label + ': Mercado Pago PROD no puede estar habilitado');
        }
        if (child && typeof child === 'object') {
          const serialized = JSON.stringify(child).toLowerCase();
          if (/(?:prod|production|live|api\.mercadopago\.com)/.test(serialized)) {
            errors.push(label + ': Mercado Pago PROD no puede estar habilitado');
          }
        }
      }

      visit(child, childTrail);
    }
  };

  visit(value);
  return errors;
}

async function validateRuntime(filePath, label) {
  const errors = [];
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      ok: false,
      errors: [label + ': archivo ausente; el preview preflight falla cerrado'],
    };
  }

  let report;
  let raw;
  try {
    report = await checkRuntimeConfig(filePath);
    raw = readRuntimeFile(filePath);
  } catch (error) {
    return {
      ok: false,
      errors: [label + ': sintaxis/configuración inválida (' + error.message + ')'],
    };
  }

  if (!report.ok) errors.push(label + ': config:check rechazó el runtime');
  if (report.environment !== EXPECTED.environment) {
    errors.push(label + ': environment debe ser staging');
  }
  if (report.supabaseHost !== EXPECTED.supabaseRef + '.supabase.co') {
    errors.push(label + ': Supabase ref inesperada');
  }
  errors.push(...runtimeSecurityErrors(raw, label));

  return {
    ok: errors.length === 0,
    errors,
    sha256: sha(filePath),
    bytes: fs.statSync(filePath).size,
    environment: report.environment,
    supabaseRef: report.supabaseHost?.replace(/\.supabase\.co$/, '') || null,
  };
}

function versionSet(sources) {
  const versions = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/\?v=(\d+)/g)) versions.add(match[1]);
  }
  return versions;
}

function addFileCheck(errors, filePath, description) {
  if (!fs.existsSync(filePath)) {
    errors.push(description + ': falta ' + path.basename(filePath));
    return null;
  }
  return read(filePath);
}

export async function validatePreviewPackage({
  dir,
  vivo,
  root = ROOT,
} = {}) {
  const packageDir = path.resolve(dir || 'dist_release');
  const livePath = vivo ? path.resolve(vivo) : '';
  const errors = [];
  const ok = [];

  if (!fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
    return {
      ok: false,
      okLines: [],
      errors: ['no existe el directorio de paquete: ' + packageDir],
    };
  }

  const colados = PROHIBIDAS.filter((entry) => fs.existsSync(path.join(packageDir, entry)));
  if (colados.length) errors.push('se colaron rutas que el sitio no publica: ' + colados.join(', '));
  else ok.push('sin rutas prohibidas (' + PROHIBIDAS.length + ' comprobadas)');

  const packageRuntimePath = path.join(packageDir, RUNTIME_CONFIG_PATH);
  const liveRuntime = await validateRuntime(livePath, 'runtime vivo');
  const packageRuntime = await validateRuntime(packageRuntimePath, 'runtime del paquete');
  errors.push(...liveRuntime.errors, ...packageRuntime.errors);

  if (liveRuntime.ok && packageRuntime.ok) {
    if (liveRuntime.sha256 !== packageRuntime.sha256) {
      errors.push(
        'runtime-config.js NO es el vivo (paquete '
        + packageRuntime.sha256.slice(0, 16)
        + '… vs vivo '
        + liveRuntime.sha256.slice(0, 16)
        + '…)',
      );
    } else {
      ok.push(
        'runtime staging aprobado: '
        + packageRuntime.bytes
        + ' B, sha256 '
        + packageRuntime.sha256.slice(0, 16)
        + '…',
      );
    }
  }

  const workerPath = path.join(packageDir, 'sw.js');
  const worker = addFileCheck(errors, workerPath, 'worker');
  const precache = worker
    ? [...worker.matchAll(/'\.\/([^']+)'/g)].map((match) => match[1])
    : [];
  const missing = precache
    .map((entry) => entry.split('?')[0])
    .filter((relative) => relative && !fs.existsSync(path.join(packageDir, relative)));
  if (missing.length) {
    errors.push(
      'el worker precachea '
      + missing.length
      + ' archivo(s) que no están en el paquete: '
      + missing.slice(0, 6).join(', '),
    );
  } else if (worker) {
    ok.push('precache completo: ' + precache.length + ' entradas, todas presentes');
  }

  const index = addFileCheck(errors, path.join(packageDir, 'index.html'), 'index');
  const hoja = addFileCheck(errors, path.join(packageDir, 'styles.css'), 'css');
  const paymentPages = ['resultado', 'pendiente', 'error'].map((state) => ({
    state,
    path: path.join(packageDir, 'pago', state, 'index.html'),
  }));
  const paymentSources = [];
  for (const page of paymentPages) {
    const source = addFileCheck(errors, page.path, 'pago/' + page.state);
    if (!source) continue;
    paymentSources.push(source);
    if (!source.includes('../../styles.css' + EXPECTED.css)) {
      errors.push('pago/' + page.state + ': retorno no carga styles.css' + EXPECTED.css);
    }
    if (!source.includes('../../js/payments/mercadopago-return.js')) {
      errors.push('pago/' + page.state + ': falta mercadopago-return.js');
    }
  }

  if (index) {
    if (!index.includes('js/app.js' + EXPECTED.app)) {
      errors.push('index/app: index.html no carga app.js' + EXPECTED.app);
    }
    if (!index.includes('js/startup-recovery.js' + EXPECTED.recovery)) {
      errors.push('index/recovery: index.html no carga startup-recovery.js' + EXPECTED.recovery);
    }
    if (!index.includes('js/pwa-update.js' + EXPECTED.pwa)) {
      errors.push('index/pwa: index.html no carga pwa-update.js' + EXPECTED.pwa);
    }
    if (!index.includes('styles.css' + EXPECTED.css)) {
      errors.push('index/css: index.html no carga styles.css' + EXPECTED.css);
    }
  }
  if (worker && !worker.includes(EXPECTED.cache)) {
    errors.push('sw/cache: sw.js no declara ' + EXPECTED.cache);
  }

  const versions = versionSet([
    index || '',
    hoja || '',
    worker || '',
    ...paymentSources,
  ]);
  const intrusas = [...versions].filter((version) => !PERMITTED_VERSIONS.has(version));
  if (intrusas.length) {
    errors.push(
      'mezcla de versiones: aparecen ?v='
      + intrusas.join(', ?v=')
      + ' además de las del candidato',
    );
  } else if (index || hoja || worker) {
    ok.push(
      'sin mezcla de versiones: sólo '
      + [...versions].sort().map((version) => '?v=' + version).join(' '),
    );
  }

  let artifactIdentity = null;
  let signedIdentity = null;
  try {
    signedIdentity = JSON.parse(read(path.join(root, 'release-identity.json')));
    artifactIdentity = calcularIdentidad(packageDir);
    errors.push(...artifactIdentity.fallas);
    if (signedIdentity.codeIdentityVersion !== 2 || signedIdentity.runtimeConfigExcluded !== true) {
      errors.push('release-identity.json no declara el contrato separado de runtime');
    }
    if (artifactIdentity.identidad.cacheName !== signedIdentity.cacheName) {
      errors.push('identidad: CACHE_NAME del paquete no coincide con la firma');
    }
    if (artifactIdentity.identidad.assetCount !== signedIdentity.assetCount) {
      errors.push('identidad: cantidad de precache no coincide con la firma');
    }
    if (artifactIdentity.identidad.codeAssetCount !== signedIdentity.codeAssetCount) {
      errors.push('identidad: cantidad de código no coincide con la firma');
    }
    if (artifactIdentity.identidad.codeAssetsDigest !== signedIdentity.codeAssetsDigest) {
      errors.push('identidad: el código del paquete no corresponde al digest firmado');
    } else {
      ok.push(
        'identidad de código PASS: '
        + artifactIdentity.identidad.codeAssetCount
        + ' archivos, digest '
        + artifactIdentity.identidad.codeAssetsDigest.slice(0, 16)
        + '…',
      );
    }
  } catch (error) {
    errors.push('identidad: no se pudo verificar el paquete (' + error.message + ')');
  }

  const total = fs.readdirSync(packageDir, { recursive: true })
    .filter((relative) => fs.statSync(path.join(packageDir, relative)).isFile())
    .length;
  ok.push(total + ' archivos en el paquete');

  const report = artifactIdentity && packageRuntime.ok
    ? {
      schemaVersion: 1,
      sourceHead: sourceHead(root),
      codeReleaseIdentity: {
        version: signedIdentity?.codeIdentityVersion ?? null,
        cacheName: artifactIdentity.identidad.cacheName,
        precacheAssetCount: artifactIdentity.identidad.assetCount,
        codeAssetCount: artifactIdentity.identidad.codeAssetCount,
        digest: artifactIdentity.identidad.codeAssetsDigest,
      },
      runtime: {
        path: RUNTIME_CONFIG_PATH,
        sha256: packageRuntime.sha256,
        bytes: packageRuntime.bytes,
        environment: packageRuntime.environment,
        supabaseRef: packageRuntime.supabaseRef,
      },
      deploymentId: process.env.TABA_PREVIEW_DEPLOYMENT_ID || null,
      generatedAt: new Date().toISOString(),
    }
    : null;

  return {
    ok: errors.length === 0,
    okLines: ok,
    errors,
    report,
    packageDir,
    livePath,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const reportIndex = args.indexOf('--report');
  const dir = positional[0] || 'dist_release';
  const vivo = positional[1] || 'artifacts/ci/staging-v61/preserva/runtime-config.live.js';
  const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : null;
  const result = await validatePreviewPackage({ dir, vivo });

  console.log(result.okLines.map((line) => '  ok · ' + line).join('\n'));
  if (!result.ok) {
    console.error('\nPREFLIGHT DETENIDO (' + result.errors.length + '):');
    result.errors.forEach((line) => console.error('  ✗ ' + line));
    process.exitCode = 1;
    return;
  }

  if (reportPath) {
    if (!result.report) {
      console.error('PREFLIGHT DETENIDO: no se pudo generar release manifest');
      process.exitCode = 1;
      return;
    }
    fs.writeFileSync(
      path.resolve(reportPath),
      JSON.stringify(result.report, null, 2) + '\n',
      'utf8',
    );
    console.log('release manifest: ' + path.resolve(reportPath));
  }
  console.log('\npreflight en verde: el paquete se puede publicar.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
