// Mirar adentro del paquete web que se va a publicar, no del arbol de fuentes.
//
// El equivalente de tool/package_scan.dart del Rider, para el dist del Customer
// y del Panel. Un gate sobre `git ls-files` no dice nada del artefacto: el
// paquete es una copia de un subconjunto del arbol mas lo que el deploy inyecta,
// y es ese conjunto -no el repositorio- el que llega al navegador.
//
//   node scripts/scan-production-artifacts.mjs dist_release [dist-desktop ...]
//     [--business-id <uuid>] [--expect-host <host>] [--report <archivo.json>]
//
//   exit 0  limpio
//   exit 1  hallazgos
//   exit 2  no se pudo mirar
//
// Los hallazgos NUNCA imprimen el valor que coincidio: se dice la regla, el
// archivo y cuantas veces. Imprimirlo escribiria la credencial en el log de la
// corrida, que es lo que el escaneo viene a evitar. Las unicas excepciones son
// los hosts y los business id, que son identidad del artefacto y no secreto.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const STAGING_REF = 'ukxqbgswjlibmnjemrzd';
const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const TEMPLATE_BUSINESS = '00000000-0000-4000-8000-000000000000';

// Binarios: se leen igual, pero en latin-1, para no romper una coincidencia por
// un byte que no es UTF-8 valido.
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.pdf', '.zip']);

/**
 * Reglas.
 *
 * P0 = no puede viajar, es una credencial de servidor.
 * P1 = no deberia viajar: apunta al entorno equivocado o a una superficie de
 *      prueba. No es un secreto, pero convierte el artefacto en otro.
 *
 * Las reglas de credencial matchean la FORMA del valor, no la mencion del
 * nombre. `service_role` aparece como palabra en la lista de jerga que el Panel
 * usa para no escribirla en pantalla, y en el detector de formato de claves del
 * SDK de Supabase: prohibir la palabra convierte el gate en uno que grita
 * siempre, y un gate que grita siempre se apaga.
 */
// `scope`
//
//   raw    se busca en el archivo entero, comentarios incluidos. Es lo que
//          corresponde a una CREDENCIAL: escrita en un comentario viaja al
//          navegador igual, y sigue siendo la credencial.
//
//   code   se busca en el archivo SIN comentarios. Es lo que corresponde a un
//          valor de CONFIGURACION: un ref, un puerto o un uuid dentro de un
//          comentario documenta la forma, no configura nada. La ocurrencia se
//          reporta igual, como `info`, para que quede a la vista sin detener
//          la publicacion.
//
// La regla de fondo: un secreto lo es donde sea; un valor de configuracion solo
// configura si es codigo.
export const RULES = [
  { id: 'supabase-service-role-jwt', severity: 'P0', scope: 'raw', kind: 'jwt-role', role: 'service_role' },
  { id: 'supabase-secret-key', severity: 'P0', scope: 'raw', re: /sb_secret_[A-Za-z0-9_-]{10,}/g },
  { id: 'supabase-access-token', severity: 'P0', scope: 'raw', re: /sbp_[A-Za-z0-9]{40,}/g },
  { id: 'mercadopago-token', severity: 'P0', scope: 'raw', re: /(APP_USR|TEST)-\d{6,}-\d{6}-[0-9a-f]{32}-\d{6,}/g },
  { id: 'mercadopago-secret-assigned', severity: 'P0', scope: 'raw', re: /MERCADOPAGO_(ACCESS_TOKEN|WEBHOOK_SECRET)\s*[:=]\s*['"]?[A-Za-z0-9_-]{20,}/g },
  { id: 'service-role-key-assigned', severity: 'P0', scope: 'raw', re: /SUPABASE_SERVICE_ROLE(_KEY)?\s*[:=]\s*['"]?[A-Za-z0-9._-]{20,}/g },
  { id: 'private-key-material', severity: 'P0', scope: 'raw', re: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY/g },
  { id: 'aws-access-key', severity: 'P0', scope: 'raw', re: /AKIA[0-9A-Z]{16}/g },

  { id: 'staging-backend-reference', severity: 'P1', scope: 'code', re: new RegExp(STAGING_REF, 'g') },
  { id: 'tunnel-endpoint', severity: 'P1', scope: 'code', re: /https?:\/\/[^\s'"]*(trycloudflare\.com|ngrok(-free)?\.(io|app|dev)|loca\.lt|serveo\.net)/g },
  { id: 'developer-endpoint', severity: 'P1', scope: 'code', vendorIsInfo: true, re: /\b(localhost|127\.0\.0\.1|10\.0\.2\.2|0\.0\.0\.0):\d{2,5}/g },
  { id: 'template-business-id', severity: 'P1', scope: 'code', re: new RegExp(TEMPLATE_BUSINESS, 'g') },
  { id: 'qa-fixture-identity', severity: 'P1', scope: 'code', re: /[A-Za-z0-9._%+-]+@(example|test|qa|mailinator|yopmail|10minutemail)\.[a-z]{2,}/g },
];

/**
 * Código de terceros que el repositorio empaqueta sin escribirlo.
 *
 * Un SDK trae su propia URL por omisión —el de Supabase declara
 * `http://localhost:9999` para GoTrue— y el cliente que construimos la
 * reemplaza con `supabaseUrl`. Prohibirla ahí no hace más seguro al artefacto:
 * lo que decide a qué backend habla es `endpoint-identity`, que exige que el
 * host esperado esté y que ningún otro proyecto de Supabase aparezca.
 *
 * Sólo baja de severidad `developer-endpoint`. Una credencial dentro de una
 * dependencia sigue siendo P0: no importa quién la escribió.
 */
const VENDOR_PREFIXES = ['js/vendor/'];

const HOST_RE = /[a-z0-9]{20}\.supabase\.co/g;
// Sólo la familia canónica del negocio. Un barrido de todos los uuid recoge
// los que viven dentro de PNG y fuentes leídos como texto, y ensucia el informe
// con identidades que no son identidades.
const BUSINESS_UUID_RE = /00000000-0000-4000-8000-[0-9a-f]{12}/gi;
const ASSIGNED_BUSINESS_RE = /businessId\s*[:=]\s*['"]([0-9a-f-]{36})['"]/gi;

/** Texto sin comentarios de línea ni de bloque, conservando el largo por líneas. */
export function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const isVendor = (rel) => VENDOR_PREFIXES.some((p) => rel.includes(p));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

// Sólo corre como comando. Importado desde una prueba expone RULES y
// stripComments y no toca process: un módulo que se ejecuta al importarse no se
// puede probar sin que el proceso de prueba muera con él.
function runCli() {
const targets = process.argv.slice(2).filter((a) => !a.startsWith('--')
  && process.argv[process.argv.indexOf(a) - 1]?.startsWith('--') !== true);
if (targets.length === 0) {
  console.error('uso: node scripts/scan-production-artifacts.mjs <dir> [dir...] [--business-id <uuid>] [--expect-host <host>] [--report <f>]');
  process.exit(2);
}

const expectedBusiness = (arg('business-id') || '').toLowerCase();
const expectedHost = (arg('expect-host') || '').toLowerCase();
const reportPath = arg('report');

function* walk(root) {
  const stat = fs.statSync(root);
  if (stat.isFile()) { yield root; return; }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/** Payload de un JWT de tres partes, o null. */
function jwtRole(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

const findings = [];
const info = [];
const hosts = new Set();
const businessIds = new Map();
let files = 0;
let bytes = 0;

for (const target of targets) {
  if (!fs.existsSync(target)) {
    console.error(`no existe: ${target}`);
    process.exit(2);
  }
  for (const file of walk(target)) {
    const buf = fs.readFileSync(file);
    files += 1;
    bytes += buf.length;
    const ext = path.extname(file).toLowerCase();
    const text = buf.toString(BINARY_EXT.has(ext) ? 'latin1' : 'utf8');
    const rel = path.relative(process.cwd(), file).replaceAll('\\', '/');

    const code = BINARY_EXT.has(ext) ? text : stripComments(text);

    for (const rule of RULES) {
      if (rule.kind === 'jwt-role') {
        JWT_RE.lastIndex = 0;
        let hits = 0;
        let m = JWT_RE.exec(text);
        while (m) { if (jwtRole(m[0]) === rule.role) hits += 1; m = JWT_RE.exec(text); }
        if (hits) findings.push({ rule: rule.id, severity: rule.severity, entry: rel, hits });
        continue;
      }
      rule.re.lastIndex = 0;
      const rawHits = (text.match(rule.re) || []).length;
      if (!rawHits) continue;

      if (rule.scope === 'raw') {
        findings.push({ rule: rule.id, severity: rule.severity, entry: rel, hits: rawHits });
        continue;
      }
      rule.re.lastIndex = 0;
      const codeHits = (code.match(rule.re) || []).length;
      if (codeHits === 0) {
        info.push({ rule: rule.id, entry: rel, hits: rawHits, why: 'solo en comentarios: documenta la forma, no configura' });
      } else if (rule.vendorIsInfo && isVendor(rel)) {
        info.push({ rule: rule.id, entry: rel, hits: codeHits, why: 'dependencia de terceros: su valor por omision lo reemplaza el cliente; el destino lo fija endpoint-identity' });
      } else {
        findings.push({ rule: rule.id, severity: rule.severity, entry: rel, hits: codeHits });
      }
    }

    HOST_RE.lastIndex = 0;
    for (const host of text.match(HOST_RE) || []) hosts.add(host.toLowerCase());
    if (!BINARY_EXT.has(ext)) {
      BUSINESS_UUID_RE.lastIndex = 0;
      for (const id of code.match(BUSINESS_UUID_RE) || []) {
        const key = id.toLowerCase();
        businessIds.set(key, (businessIds.get(key) || 0) + 1);
      }
      ASSIGNED_BUSINESS_RE.lastIndex = 0;
      let assigned = ASSIGNED_BUSINESS_RE.exec(code);
      while (assigned) {
        const key = assigned[1].toLowerCase();
        businessIds.set(key, (businessIds.get(key) || 0) + 1);
        assigned = ASSIGNED_BUSINESS_RE.exec(code);
      }
    }
  }
}

// Identidad de endpoint: el host que se espera tiene que estar, y ningun otro
// proyecto de Supabase puede aparecer.
if (expectedHost) {
  if (!hosts.has(expectedHost)) {
    findings.push({ rule: 'endpoint-identity', severity: 'P1', entry: '(artefacto)', detail: `falta el host esperado ${expectedHost}` });
  }
  for (const host of hosts) {
    if (host !== expectedHost) {
      findings.push({ rule: 'endpoint-identity', severity: 'P1', entry: '(artefacto)', detail: `host inesperado ${host}` });
    }
  }
}

// Identidad de negocio: si se declara cual es, el de la plantilla no puede
// estar y el declarado tiene que estar.
if (expectedBusiness) {
  if (!businessIds.has(expectedBusiness)) {
    findings.push({ rule: 'business-identity', severity: 'P1', entry: '(artefacto)', detail: `falta el businessId esperado ${expectedBusiness}` });
  }
  if (businessIds.has(TEMPLATE_BUSINESS)) {
    findings.push({ rule: 'business-identity', severity: 'P1', entry: '(artefacto)', detail: `presente el businessId de plantilla ${TEMPLATE_BUSINESS}` });
  }
}

const digest = crypto.createHash('sha256');
for (const target of targets) {
  for (const file of walk(target)) digest.update(fs.readFileSync(file));
}

const report = {
  schemaVersion: 1,
  targets,
  files,
  bytesScanned: bytes,
  contentDigest: digest.digest('hex'),
  backendHosts: [...hosts].sort(),
  businessIds: Object.fromEntries([...businessIds.entries()].sort()),
  expectedHost: expectedHost || null,
  expectedBusinessId: expectedBusiness || null,
  findings,
  info,
  clean: findings.length === 0,
};

console.log(`artifact-scan: ${targets.join(' ')}`);
console.log(`  archivos     : ${files}`);
console.log(`  bytes        : ${bytes}`);
console.log(`  digest       : ${report.contentDigest.slice(0, 16)}…`);
console.log(`  hosts        : ${report.backendHosts.length ? report.backendHosts.join(' ') : '(ninguno)'}`);
console.log(`  business ids : ${Object.keys(report.businessIds).length ? Object.keys(report.businessIds).join(' ') : '(ninguno)'}`);
for (const f of findings) {
  console.log(`  ${f.severity} ${f.rule}: ${f.detail ?? `${f.hits} coincidencia(s)`} en ${f.entry}`);
}
for (const i of info) {
  console.log(`  info ${i.rule}: ${i.hits} en ${i.entry} — ${i.why}`);
}
console.log(findings.length ? 'artifact-scan FALLA' : 'artifact-scan OK');

if (reportPath) {
  fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

process.exit(findings.length ? 1 : 0);
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]).endsWith(`${path.sep}scan-production-artifacts.mjs`);
if (invokedDirectly) runCli();
