// PreToolUse: impedir que una credencial de Mercado Pago llegue a un archivo.
//
// Port fiel del control que trae el plugin de Mercado Pago
// (`hooks/validate_mp_credentials.py`, Apache-2.0, (c) 2026 MercadoLibre S.R.L.).
//
// POR QUE EXISTE ESTA COPIA
//
// El plugin declara el hook como `python3 <script>.py`. En este host no hay
// `python3` —hay `python`, que es Python 3.11— y el hook fallaba en CADA
// llamada a Bash, Edit, Write, MultiEdit y Read:
//
//     PreToolUse:Read hook error
//     /usr/bin/bash: line 1: python3: command not found
//
// Un control que aborta antes de leer su entrada no protege nada: no bloquea,
// no avisa, y el ruido que deja se aprende a ignorar. Y el gate de relevancia
// de este repositorio da TRUE -package.json nombra mercadopago-, asi que el
// control no era decorativo: era el que impide que un access token quede
// escrito en un archivo del arbol.
//
// Se reescribe en Node, que es el runtime del repositorio y existe en todos los
// hosts donde se construye. Asi el control viaja con el RC y no depende de que
// una maquina tenga Python.
//
// CONTRATO (identico al original)
//
//   entrada  JSON por stdin: { tool_name, tool_input }
//   salida   0 = permitir
//            2 = bloquear, con el motivo en stderr
//
//   Cualquier otra cosa -stdin ilegible, proyecto sin relacion con Mercado
//   Pago, override del proyecto- permite. Un hook que se equivoca tiene que
//   equivocarse dejando pasar: bloquear por un fallo propio rompe la sesion
//   entera.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ---------- patrones de credencial ----------

export const PATTERNS = {
  'MP Access Token': /(TEST|APP_USR)-\d{12,}-\d{6}-[a-f0-9]{32}-U\d+/g,
  'Client Secret': /['"]client_secret['"]\s*[:=]\s*['"][a-f0-9]{32,}['"]/g,
  'Bearer Token': /Bearer\s+(TEST|APP_USR)-[^\s'"]+/g,
  'Webhook Secret': /['"]?(x-signature|webhook.?secret)['"]?\s*[:=]\s*['"][a-zA-Z0-9+/]{20,}['"]/gi,
};

// ---------- gate de relevancia ----------

// Manifiestos de dependencias donde se busca una mencion a "mercadopago". Los
// lock files quedan afuera a proposito: son grandes y esto corre en cada
// llamada de herramienta.
const MANIFEST_FILES = [
  'package.json', 'composer.json', 'requirements.txt', 'Pipfile',
  'pyproject.toml', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'go.mod',
];

function mentionsMercadoPago(file) {
  try {
    return fs.readFileSync(file, 'utf8').toLowerCase().includes('mercadopago');
  } catch {
    return false;
  }
}

/**
 * ¿Este proyecto integra Mercado Pago?
 *
 * Sube desde `startDir` hasta el borde del repositorio buscando la config del
 * plugin o un manifiesto que lo nombre. Conservador a proposito: solo tiene que
 * alcanzar para que el hook sea inerte donde no corresponde.
 *
 * El original corta cuando encuentra un `.git` que es DIRECTORIO. En un git
 * worktree `.git` es un ARCHIVO, y con esa comprobacion la caminata se escapaba
 * del proyecto y seguia subiendo por el disco. Acá el borde es `.git`, sea lo
 * que sea: un worktree es tan raiz de trabajo como un clon.
 */
export function isMercadoPagoProject(startDir) {
  let current = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 32; i += 1) {
    if (fs.existsSync(path.join(current, '.claude', 'mercadopago.local.md'))) return true;
    for (const name of MANIFEST_FILES) {
      const candidate = path.join(current, name);
      if (fs.existsSync(candidate) && mentionsMercadoPago(candidate)) return true;
    }
    const atRepoRoot = fs.existsSync(path.join(current, '.git'));
    const parent = path.dirname(current);
    if (atRepoRoot || parent === current) break;
    current = parent;
  }
  return false;
}

// ---------- auxiliares ----------

/** Frontmatter de .claude/mercadopago.local.md, si existe. */
export function readSettings(cwd = process.cwd()) {
  const file = path.join(cwd, '.claude', 'mercadopago.local.md');
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('---', 3);
  if (end === -1) return {};
  const result = {};
  for (const line of content.slice(3, end).trim().split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    result[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return result;
}

export function extractText(toolName, toolInput = {}) {
  if (toolName === 'Bash') return toolInput.command || '';
  if (toolName === 'Write') return toolInput.content || '';
  if (toolName === 'Edit') return toolInput.new_string || '';
  if (toolName === 'MultiEdit') {
    return (toolInput.edits || []).map((e) => e?.new_string || '').join('\n');
  }
  return '';
}

export function getFilePath(toolName, toolInput = {}) {
  if (['Write', 'Edit', 'MultiEdit', 'Read'].includes(toolName)) {
    return toolInput.file_path || '';
  }
  return '';
}

/** Devuelve [nombreDelPatron, textoQueCoincidio] por cada coincidencia. */
export function scan(text) {
  const matches = [];
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      matches.push([name, match[0]]);
      match = pattern.exec(text);
    }
  }
  return matches;
}

/** `.env` sí, `.env.example` no, y sólo dentro del proyecto. */
export function isEnvFile(target, cwd = process.cwd()) {
  if (!target) return false;
  const base = path.basename(target);
  if (base === '.env.example' || base.endsWith('.env.example')) return false;
  if (!(base === '.env' || base.startsWith('.env.'))) return false;
  try {
    const abs = fs.realpathSync.native(path.resolve(target));
    const root = fs.realpathSync.native(path.resolve(cwd));
    return abs === root || abs.startsWith(root + path.sep);
  } catch {
    // El archivo puede no existir todavia (un Write que lo crea). Se compara
    // la ruta resuelta sin tocar el disco antes de descartarlo.
    const abs = path.resolve(target);
    const root = path.resolve(cwd);
    return abs === root || abs.startsWith(root + path.sep);
  }
}

/**
 * El veredicto, sin tocar process. Es lo que las pruebas ejercitan.
 *
 * @returns {{block: boolean, reason?: string}}
 */
export function decide(payload, cwd = process.cwd()) {
  if (!isMercadoPagoProject(cwd)) return { block: false };

  const toolName = payload?.tool_name || '';
  const toolInput = payload?.tool_input || {};

  if (String(readSettings(cwd).enabled ?? 'true').toLowerCase() === 'false') {
    return { block: false };
  }

  const filePath = getFilePath(toolName, toolInput);

  if (toolName === 'Read') {
    if (filePath && isEnvFile(filePath, cwd)) {
      return {
        block: true,
        reason: 'BLOCKED: Reading .env files is not allowed to prevent credential exposure.\n'
          + 'If you need to see the expected variables, read .env.example instead.',
      };
    }
    return { block: false };
  }

  // Las credenciales viven en .env: escribirlas ahi no es la fuga.
  if (filePath && isEnvFile(filePath, cwd)) return { block: false };

  const text = extractText(toolName, toolInput);
  if (!text) return { block: false };

  const matches = scan(text);
  if (matches.length === 0) return { block: false };

  const names = [...new Set(matches.map(([name]) => name))].sort();
  return {
    block: true,
    // El valor que coincidio NO se imprime: seria escribir la credencial en el
    // log de la sesion, que es justo lo que el control viene a evitar.
    reason: `BLOCKED: Detected hardcoded Mercado Pago credential(s): ${names.join(', ')}.\n`
      + 'Use environment variables instead:\n'
      + '  - MP_ACCESS_TOKEN for access tokens\n'
      + '  - MP_CLIENT_SECRET for client secrets\n'
      + '  - MP_WEBHOOK_SECRET for webhook signing secrets\n'
      + 'See: https://www.mercadopago.com.ar/developers/en/docs/your-integrations/credentials',
  };
}

// ---------- entrada ----------

async function main() {
  let raw = '';
  try {
    for await (const chunk of process.stdin) raw += chunk;
  } catch {
    process.exit(0);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // entrada ilegible: permitir
  }

  let verdict;
  try {
    verdict = decide(payload, process.cwd());
  } catch {
    process.exit(0); // fallo del propio control: permitir
  }

  if (verdict.block) {
    process.stderr.write(`${verdict.reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

// Sólo corre como comando. Importado desde una prueba no hace nada.
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]).endsWith(`${path.sep}validate-mp-credentials.mjs`);
if (invokedDirectly) await main();
