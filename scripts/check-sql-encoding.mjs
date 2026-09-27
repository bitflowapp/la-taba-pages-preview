// Verifica la codificacion de todo lo que llega a PostgreSQL y de lo adoptado
// del core fiscal.
//
// POR QUE EXISTE
// --------------
// Las copias historicas de bitflowapp/taba-fiscal traen BOM UTF-8 y texto
// doblemente codificado (UTF-8 releido como CP437: "Impresi" + U+251C U+2502 + "n"
// en lugar de "Impresión"). Un BOM al principio de una migracion rompe el
// parser cuando el archivo pasa por un driver ("syntax error at or near
// ﻿"), y el mojibake termina en comentarios y mensajes de error de la
// base. La adopcion del core porta EFECTOS, no archivos: esto impide que un
// copiado a ciegas los vuelva a meter.
//
// Reglas, para cada archivo del alcance:
//   1. UTF-8 valido;
//   2. sin BOM, sin U+FEFF en el medio y sin U+FFFD (rastro de una decodificacion con perdida);
//   3. sin caracteres de control (tab, salto de linea y retorno de carro si);
//   4. sin las secuencias que deja UTF-8 releido como CP437/CP850 (consola de
//      Windows) o como Windows-1252/Latin-1.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ENCODING_SCOPES = [
  'supabase/migrations',
  'supabase/tests',
  'scripts/fiscal-core',
  'docs/fiscal-core',
  'docs/TABA-FISCAL-CORE-ADOPTION.md',
  'fiscal-core.json',
];
const TEXT_FILE = /\.(sql|md|json|mjs)$/;

// Byte de continuacion UTF-8 (0x80-0xBF) tal como lo muestran CP437 y CP850.
const OEM_CONTINUATION = 'ÇüéâäàåçêëèïîìÄÅ'
  + 'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ'
  + 'áíóúñÑªº¿⌐¬½¼¡«»'
  + '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐'
  + 'øØ×®ÁÂÀ©';
// Windows-1252 en 0x80-0x9F (Latin-1 los deja como controles C1, que la regla 3 no cubre: van aca).
const CP1252_HIGH = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ\u0080-\u009F';
const MOJIBAKE = new RegExp([
  // C2/C3 (latin y puntuacion: á é í ó ú ñ · « ») leidos como CP437/CP850: U+252C/U+251C + continuacion.
  `[┬├][${OEM_CONTINUATION}]`,
  // E2 (— → ─ ═ “ ”) leido como CP437 (U+0393) o CP850 (U+00D4) + dos continuaciones.
  `[ΓÔ][${OEM_CONTINUATION}]{2}`,
  // C3 leido como Windows-1252/Latin-1 (U+00C3) + continuacion; C2 (U+00C2) + A0-BF; E2 80/86 (U+00E2 + U+20AC/U+2020).
  `Ã[ -¿${CP1252_HIGH}]`,
  'Â[ -¿]',
  'â[€†]',
].join('|'), 'u');
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

export function findEncodingProblems(relativePath, bytes) {
  const problems = [];
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) problems.push({ file: relativePath, problem: 'bom' });
  let text;
  try {
    // Por defecto TextDecoder consume el BOM inicial: lo que quede de U+FEFF esta en el medio.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return [...problems, { file: relativePath, problem: 'invalid-utf8' }];
  }
  text.split('\n').forEach((line, index) => {
    const at = { file: relativePath, line: index + 1 };
    if (CONTROL.test(line)) problems.push({ ...at, problem: 'control-character' });
    if (line.includes('﻿')) problems.push({ ...at, problem: 'zero-width-no-break-space' });
    if (line.includes('�')) problems.push({ ...at, problem: 'replacement-character' });
    const mojibake = MOJIBAKE.exec(line);
    if (mojibake) problems.push({ ...at, problem: 'mojibake', sample: mojibake[0] });
  });
  return problems;
}

function filesUnder(root, relative) {
  const full = path.join(root, relative);
  if (!existsSync(full)) return [];
  if (!statSync(full).isDirectory()) return [relative];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const child = path.posix.join(relative, entry.name);
    return entry.isDirectory() ? filesUnder(root, child) : [child];
  });
}

export function auditEncoding(root = ROOT, scopes = ENCODING_SCOPES) {
  const files = scopes.flatMap((scope) => filesUnder(root, scope)).filter((file) => TEXT_FILE.test(file)).sort();
  return {
    files: files.length,
    problems: files.flatMap((file) => findEncodingProblems(file, readFileSync(path.join(root, file)))),
  };
}

function run() {
  const missing = ENCODING_SCOPES.filter((scope) => !existsSync(path.join(ROOT, scope)));
  const { files, problems } = auditEncoding();
  if (missing.length === 0 && problems.length === 0) {
    console.log(`ENCODING_CHECK: PASS (${files} archivos: UTF-8 valido, sin BOM, sin controles, sin mojibake)`);
    return;
  }
  for (const scope of missing) console.error(`ENCODING_CHECK: falta ${scope}`);
  for (const { file, line, problem, sample } of problems) {
    console.error(`ENCODING_CHECK: ${file}${line ? `:${line}` : ''} ${problem}${sample ? ` ${JSON.stringify(sample)}` : ''}`);
  }
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) run();
