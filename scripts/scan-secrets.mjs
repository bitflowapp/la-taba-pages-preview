import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['.git', '.temp', 'node_modules', 'coverage', 'playwright-report', 'test-results']);
const findings = [];
const patterns = [
  ['Mercado Pago access token', /\b(?:APP_USR|TEST)-[A-Za-z0-9_-]{20,}\b/],
  ['private key', /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['assigned Mercado Pago secret', /MERCADOPAGO_(?:ACCESS_TOKEN|WEBHOOK_SECRET)\s*[:=]\s*['"]?(?!\$\{|\{\{|<|your_|example|replace)[A-Za-z0-9._-]{16,}/i],
  // El escáner sólo conocía credenciales de pago y claves privadas: era CIEGO a
  // las que este stack maneja todos los días. Las de abajo son las que de verdad
  // pueden entrar en un commit distraído.
  //
  // Personal Access Token de Supabase: da acceso de management al proyecto.
  ['Supabase personal access token', /\bsbp_[A-Za-z0-9]{40,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  // Cloudflare no tiene prefijo propio, así que se detecta por ASIGNACIÓN: un
  // valor largo puesto en una variable que dice lo que es.
  [
    'assigned Cloudflare API token',
    /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_TOKEN)\s*[:=]\s*['"]?(?!\$\{|\{\{|<|your_|example|replace)[A-Za-z0-9._-]{30,}/i,
  ],
  [
    'assigned Supabase service role key',
    /SUPABASE_SERVICE_ROLE(?:_KEY)?\s*[:=]\s*['"]?(?!\$\{|\{\{|<|your_|example|replace)[A-Za-z0-9._-]{20,}/i,
  ],
];

/*
 * El `service_role` de Supabase es un JWT, y la clave PUBLICABLE (anon) también.
 *
 * Un patrón `eyJ…` a secas marcaría la clave pública, que es pública por diseño
 * y vive legítimamente en `runtime-config.js`. Un gate que grita por eso se
 * termina desactivando, y entonces no protege de nada.
 *
 * Por eso acá no se mira la forma sino el CONTENIDO: se decodifica el payload y
 * se denuncia sólo si el rol es de servicio.
 */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

export function isServiceRoleJwt(jwt) {
  const payload = String(jwt || '').split('.')[1];
  if (!payload) return false;
  try {
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json)?.role === 'service_role';
  } catch (_) {
    return false;
  }
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(candidate);
    else if (entry.isFile() && fs.statSync(candidate).size <= 2_000_000) inspect(candidate);
  }
}

function inspect(file) {
  const content = fs.readFileSync(file);
  if (content.includes(0)) return;
  const text = content.toString('utf8');
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) findings.push(`${path.relative(root, file)}: ${label}`);
  }
  for (const jwt of text.match(JWT_PATTERN) || []) {
    if (!isServiceRoleJwt(jwt)) continue;
    findings.push(`${path.relative(root, file)}: Supabase service_role key`);
    break;
  }
}

/** Las familias que el escáner reconoce, para poder probarlas una por una. */
export function scanText(text = '') {
  const encontrados = [];
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) encontrados.push(label);
  }
  for (const jwt of String(text).match(JWT_PATTERN) || []) {
    if (!isServiceRoleJwt(jwt)) continue;
    encontrados.push('Supabase service_role key');
    break;
  }
  return encontrados;
}

// El barrido corre sólo cuando se ejecuta el script, no al importarlo: si no,
// un test que quiera probar los patrones dispararía el escaneo entero del árbol
// —y su `process.exit`— como efecto de import.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  walk(root);
  if (findings.length) {
    console.error('Potential secret material found:');
    for (const finding of findings) console.error(`- ${finding}`);
    process.exit(1);
  }
  console.log('Secret scan passed: no assigned payment credentials or private keys found.');
}
