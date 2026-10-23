/*
 * LECTOR DE PLANILLAS DEL CATÁLOGO: .xlsx y .csv, sin dependencias.
 *
 * Por qué no una librería: el proyecto no tiene ninguna para planillas y no
 * entra una nueva. Leer una planilla de Excel es menos de lo que parece:
 *
 *   1. un .xlsx es un ZIP. Se lee el directorio central del final del archivo
 *      y cada parte se descomprime con `DecompressionStream('deflate-raw')`,
 *      que traen los navegadores actuales y Node 24;
 *   2. adentro hay XML: el libro (`xl/workbook.xml`) dice qué hojas hay, sus
 *      relaciones (`xl/_rels/workbook.xml.rels`) dicen en qué archivo está cada
 *      una, y los textos repetidos viven en `xl/sharedStrings.xml`;
 *   3. cada celda es `<c r="B7" t="s"><v>3</v></c>`: referencia, tipo y valor.
 *
 * El XML se recorre con un escáner chico y tolerante, no con `DOMParser`: Node
 * no lo tiene y para esto no hace falta un árbol, alcanza con la secuencia de
 * etiquetas y textos.
 *
 * Qué devuelve: filas con su NÚMERO de fila real (el que ve la persona en
 * Excel) y celdas con su tipo conservado —un número de Excel llega como
 * número, un texto como texto, un sí/no de Excel como booleano y una celda
 * vacía como `null`—. Interpretar qué significa cada columna NO es asunto de
 * este módulo: eso lo hace `catalog-sheet-import.js`.
 *
 * Límites, porque esto corre en el teléfono del mostrador: 2 MB de archivo,
 * 2000 filas de productos y una parte descomprimida no puede pasar de 16 MB
 * (un ZIP chico que se infla a gigas es un ataque conocido).
 */

export const MAX_SHEET_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_SHEET_ROWS = 2000;
/** Margen para títulos e instrucciones arriba del encabezado. */
export const MAX_SHEET_ROWS_WITH_HEADER = MAX_SHEET_ROWS + 50;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_COLUMNS = 256;
export const PREFERRED_SHEET_NAME = 'Productos';

const TOO_BIG = 'La planilla pesa más de 2 MB. Sacale las hojas o imágenes que no hagan falta, o dividila en partes.';
const TOO_MANY_ROWS = `La planilla tiene más de ${MAX_SHEET_ROWS} filas de productos. Dividila en partes de hasta ${MAX_SHEET_ROWS}.`;
const DAMAGED_XLSX = 'No pudimos abrir el archivo .xlsx: está incompleto o dañado. Volvé a guardarlo desde Excel y subilo de nuevo.';
const LEGACY_OR_LOCKED = 'Esta planilla está en un formato que no se puede leer acá: Excel antiguo (.xls) o protegida con contraseña. Guardala como .xlsx sin contraseña o como .csv.';

class SheetReadError extends Error {
  constructor(message) {
    super(message);
    this.userMessage = message;
  }
}

const fail = (message) => ({ ok: false, message });

/**
 * Lee un archivo elegido en el navegador (File o Blob con `name`).
 * Nunca tira: devuelve `{ ok: true, format, sheetName, rows }` o `{ ok: false, message }`.
 */
export async function readCatalogSheetFile(file, options = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') return fail('Elegí el archivo de la planilla (.xlsx o .csv).');
  const size = Number(file.size);
  if (Number.isFinite(size) && size > MAX_SHEET_FILE_BYTES) return fail(TOO_BIG);
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (_) {
    return fail('No se pudo abrir el archivo. Volvé a elegirlo.');
  }
  return readCatalogSheetBytes(bytes, { fileName: String(file.name || ''), ...options });
}

/** Lo mismo, a partir de los bytes. Es lo que prueban los tests. */
export async function readCatalogSheetBytes(input, { fileName = '', sheetName = PREFERRED_SHEET_NAME } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (!bytes.byteLength) return fail('El archivo está vacío.');
  if (bytes.byteLength > MAX_SHEET_FILE_BYTES) return fail(TOO_BIG);
  try {
    if (isZip(bytes)) return { ok: true, format: 'xlsx', ...(await readXlsx(bytes, sheetName)) };
    if (isOle2(bytes)) return fail(LEGACY_OR_LOCKED);
    if (/\.(?:xlsx|xlsm)$/i.test(fileName)) return fail(DAMAGED_XLSX);
    if (/\.(?:xls|ods|numbers)$/i.test(fileName)) {
      return fail('Ese formato de planilla no se puede leer acá. Guardala como .xlsx o como .csv.');
    }
    return { ok: true, format: 'csv', sheetName: '', rows: parseCsvBytes(bytes) };
  } catch (error) {
    if (error instanceof SheetReadError) return fail(error.userMessage);
    return fail('No pudimos leer la planilla. Revisá que sea un .xlsx o un .csv y volvé a intentar.');
  }
}

function isZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function isOle2(bytes) {
  return bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

// ── ZIP ─────────────────────────────────────────────────────────────────────

/** Directorio central: nombre → { método, tamaños, dónde empieza el encabezado local }. */
export function readZipDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowest = Math.max(0, bytes.length - 0xffff - 22);
  let end = -1;
  for (let at = bytes.length - 22; at >= lowest; at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new SheetReadError(DAMAGED_XLSX);
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) throw new SheetReadError(DAMAGED_XLSX);
  if (offset + size > end) throw new SheetReadError(DAMAGED_XLSX);
  const entries = new Map();
  let at = offset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw new SheetReadError(DAMAGED_XLSX);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)).replace(/\\/g, '/');
    entries.set(name, { flags, method, compressedSize, uncompressedSize, localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipEntry(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localOffset;
  if (at + 30 > bytes.length || view.getUint32(at, true) !== 0x04034b50) throw new SheetReadError(DAMAGED_XLSX);
  if (entry.flags & 0x1) throw new SheetReadError(LEGACY_OR_LOCKED);
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) throw new SheetReadError(TOO_BIG);
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const stop = start + entry.compressedSize;
  if (stop > bytes.length) throw new SheetReadError(DAMAGED_XLSX);
  const data = bytes.subarray(start, stop);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new SheetReadError('El archivo .xlsx usa una compresión que no se puede leer acá. Volvé a guardarlo desde Excel.');
}

async function inflateRaw(data) {
  if (typeof DecompressionStream !== 'function') {
    throw new SheetReadError('Este navegador no puede abrir archivos .xlsx. Actualizalo o subí la planilla como .csv.');
  }
  let stream;
  try {
    stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  } catch (_) {
    throw new SheetReadError('Este navegador no puede abrir archivos .xlsx. Actualizalo o subí la planilla como .csv.');
  }
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ENTRY_BYTES) {
        reader.cancel().catch(() => {});
        throw new SheetReadError(TOO_BIG);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SheetReadError) throw error;
    throw new SheetReadError(DAMAGED_XLSX);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

async function readZipText(bytes, entries, name) {
  const entry = entries.get(name);
  if (!entry) return null;
  const data = await readZipEntry(bytes, entry);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch (_) {
    throw new SheetReadError(DAMAGED_XLSX);
  }
}

// ── XML ─────────────────────────────────────────────────────────────────────

const XML_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });

export function decodeXmlText(text) {
  return String(text).replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, entity) => {
    if (entity[0] !== '#') return XML_ENTITIES[entity];
    const code = entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Excel escapa los caracteres de control como `_x000D_` (y un guion bajo literal como `_x005F_`). */
export function unescapeOoxmlText(text) {
  return String(text).replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function localName(name) {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

const ATTRIBUTE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttributes(source) {
  const attributes = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    attributes[match[1]] = decodeXmlText(match[2] ?? match[3] ?? '');
  }
  return attributes;
}

/**
 * Escáner de XML: etiquetas que abren, que cierran, y textos. Los prefijos de
 * espacio de nombres se ignoran en los nombres de elemento (`x:c` es `c`).
 * Saltea comentarios, instrucciones de proceso y declaraciones; no expande
 * entidades propias (un .xlsx no las usa y expandirlas es otro ataque conocido).
 */
export function* scanXml(xml) {
  const source = String(xml);
  const length = source.length;
  let at = 0;
  while (at < length) {
    const open = source.indexOf('<', at);
    if (open === -1) {
      yield { type: 'text', value: source.slice(at) };
      return;
    }
    if (open > at) yield { type: 'text', value: source.slice(at, open) };
    if (source.startsWith('<!--', open)) {
      const close = source.indexOf('-->', open + 4);
      at = close === -1 ? length : close + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const close = source.indexOf(']]>', open + 9);
      yield { type: 'cdata', value: source.slice(open + 9, close === -1 ? length : close) };
      at = close === -1 ? length : close + 3;
      continue;
    }
    if (source.startsWith('<?', open) || source.startsWith('<!', open)) {
      const close = source.indexOf('>', open + 2);
      at = close === -1 ? length : close + 1;
      continue;
    }
    let cursor = open + 1;
    let quote = '';
    while (cursor < length) {
      const char = source[cursor];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
      cursor += 1;
    }
    const body = source.slice(open + 1, cursor);
    at = cursor + 1;
    if (body.startsWith('/')) {
      yield { type: 'close', name: localName(body.slice(1).trim()) };
      continue;
    }
    const selfClosing = body.endsWith('/');
    const inner = selfClosing ? body.slice(0, -1) : body;
    const nameEnd = inner.search(/[\s/]/);
    const rawName = nameEnd === -1 ? inner : inner.slice(0, nameEnd);
    yield {
      type: 'open',
      name: localName(rawName),
      attributes: parseAttributes(nameEnd === -1 ? '' : inner.slice(nameEnd)),
      selfClosing,
    };
  }
}

function textOf(token) {
  return token.type === 'cdata' ? token.value : decodeXmlText(token.value);
}

function parseRelationships(xml) {
  const relationships = new Map();
  if (!xml) return relationships;
  for (const token of scanXml(xml)) {
    if (token.type === 'open' && token.name === 'Relationship' && token.attributes.Id) {
      relationships.set(token.attributes.Id, {
        target: String(token.attributes.Target || ''),
        type: String(token.attributes.Type || ''),
        external: /^external$/i.test(String(token.attributes.TargetMode || '')),
      });
    }
  }
  return relationships;
}

function parseWorkbookSheets(xml) {
  const sheets = [];
  for (const token of scanXml(xml)) {
    if (token.type !== 'open' || token.name !== 'sheet') continue;
    const attributes = token.attributes;
    const relationKey = Object.keys(attributes).find((key) => /:id$/i.test(key));
    sheets.push({
      name: String(attributes.name || ''),
      relationId: relationKey ? attributes[relationKey] : String(attributes.id || ''),
      hidden: /hidden/i.test(String(attributes.state || '')),
    });
  }
  return sheets;
}

export function parseSharedStrings(xml) {
  const strings = [];
  if (!xml) return strings;
  let current = null;
  let phonetic = 0;
  let capture = false;
  for (const token of scanXml(xml)) {
    if (token.type === 'open') {
      if (token.name === 'si') {
        if (token.selfClosing) strings.push('');
        else current = '';
      } else if (token.name === 'rPh' && !token.selfClosing) phonetic += 1;
      else if (token.name === 't' && current !== null && phonetic === 0 && !token.selfClosing) capture = true;
    } else if (token.type === 'close') {
      if (token.name === 'si') { strings.push(unescapeOoxmlText(current ?? '')); current = null; capture = false; }
      else if (token.name === 'rPh') phonetic = Math.max(0, phonetic - 1);
      else if (token.name === 't') capture = false;
    } else if (capture && current !== null) {
      current += textOf(token);
    }
  }
  return strings;
}

/** «AB12» → 27 (columna, desde cero). `null` si no es una referencia de celda. */
export function columnIndexFromReference(reference) {
  const match = /^\$?([A-Za-z]{1,3})\$?\d*$/.exec(String(reference || '').trim());
  if (!match) return null;
  let index = 0;
  for (const letter of match[1].toUpperCase()) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function rowNumberFrom(value) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(number) && number > 0 && number <= 1048576 ? number : null;
}

function cellValue(cell, sharedStrings) {
  const raw = cell.value;
  let value;
  switch (cell.type) {
    case 's': {
      const index = Number.parseInt(raw.trim(), 10);
      value = Number.isInteger(index) && index >= 0 && index < sharedStrings.length ? sharedStrings[index] : null;
      break;
    }
    case 'inlineStr':
      value = unescapeOoxmlText(cell.inline);
      break;
    case 'str':
      value = unescapeOoxmlText(raw);
      break;
    case 'b':
      value = cell.hasValue ? ['1', 'true'].includes(raw.trim().toLowerCase()) : null;
      break;
    case 'e':
      value = { error: raw.trim() || '#ERROR' };
      break;
    case 'd':
      value = raw.trim();
      break;
    default: {
      const text = raw.trim();
      if (!cell.hasValue || text === '') {
        value = cell.hasInline ? unescapeOoxmlText(cell.inline) : null;
      } else {
        const number = Number(text);
        value = Number.isFinite(number) ? number : text;
      }
    }
  }
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
}

/** Hoja → filas no vacías, con su número de fila de Excel. */
export function parseWorksheet(xml, sharedStrings = []) {
  const rows = [];
  let inSheetData = false;
  let rowNumber = 0;
  let cells = null;
  let lastColumn = -1;
  let cell = null;
  let capture = '';
  let phonetic = 0;

  const finishCell = () => {
    if (!cell || !cells) { cell = null; return; }
    if (cell.column < MAX_COLUMNS) {
      const value = cellValue(cell, sharedStrings);
      if (value !== null) {
        while (cells.length < cell.column) cells.push(null);
        cells[cell.column] = value;
      }
    }
    cell = null;
    capture = '';
    phonetic = 0;
  };
  const finishRow = () => {
    if (cell) finishCell();
    if (cells && cells.some((value) => value !== null && value !== undefined)) {
      rows.push({ number: rowNumber, cells: Array.from(cells, (value) => (value === undefined ? null : value)) });
      if (rows.length > MAX_SHEET_ROWS_WITH_HEADER) throw new SheetReadError(TOO_MANY_ROWS);
    }
    cells = null;
  };

  for (const token of scanXml(xml)) {
    if (token.type === 'open') {
      switch (token.name) {
        case 'sheetData':
          inSheetData = !token.selfClosing;
          break;
        case 'row':
          if (!inSheetData) break;
          rowNumber = rowNumberFrom(token.attributes.r) ?? rowNumber + 1;
          cells = [];
          lastColumn = -1;
          if (token.selfClosing) finishRow();
          break;
        case 'c': {
          if (!cells) break;
          const column = columnIndexFromReference(token.attributes.r) ?? lastColumn + 1;
          lastColumn = column;
          cell = { column, type: String(token.attributes.t || 'n'), value: '', hasValue: false, inline: '', hasInline: false };
          if (token.selfClosing) finishCell();
          break;
        }
        case 'v':
          if (cell && !token.selfClosing) { capture = 'v'; cell.hasValue = true; }
          break;
        case 'is':
          if (cell) cell.hasInline = true;
          break;
        case 'rPh':
          if (cell && !token.selfClosing) phonetic += 1;
          break;
        case 't':
          if (cell && cell.hasInline && phonetic === 0 && !token.selfClosing) capture = 't';
          break;
        default:
          break;
      }
    } else if (token.type === 'close') {
      switch (token.name) {
        case 'v':
        case 't':
          capture = '';
          break;
        case 'rPh':
          phonetic = Math.max(0, phonetic - 1);
          break;
        case 'c':
          finishCell();
          break;
        case 'row':
          finishRow();
          break;
        case 'sheetData':
          inSheetData = false;
          break;
        default:
          break;
      }
    } else if (cell && capture) {
      if (capture === 'v') cell.value += textOf(token);
      else cell.inline += textOf(token);
    }
  }
  return rows;
}

function resolvePartPath(base, target) {
  const clean = String(target || '').replace(/\\/g, '/');
  if (clean.startsWith('/')) return clean.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const segment of clean.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

function relationshipsPathFor(part) {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

export function normalizeSheetName(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

async function readXlsx(bytes, preferredSheet) {
  const entries = readZipDirectory(bytes);
  const rootRelationships = parseRelationships(await readZipText(bytes, entries, '_rels/.rels'));
  const office = [...rootRelationships.values()].find((relation) => /\/officeDocument$/.test(relation.type));
  const workbookPath = office ? resolvePartPath('', office.target) : 'xl/workbook.xml';
  const workbookXml = await readZipText(bytes, entries, workbookPath);
  if (!workbookXml) throw new SheetReadError('El archivo no parece una planilla de Excel. Subí un .xlsx o un .csv.');
  const sheets = parseWorkbookSheets(workbookXml);
  if (!sheets.length) throw new SheetReadError('La planilla no tiene hojas.');
  const relationships = parseRelationships(await readZipText(bytes, entries, relationshipsPathFor(workbookPath)));
  const wanted = normalizeSheetName(preferredSheet);
  const sheet = sheets.find((candidate) => normalizeSheetName(candidate.name) === wanted)
    || sheets.find((candidate) => !candidate.hidden)
    || sheets[0];
  const relation = relationships.get(sheet.relationId);
  const sheetPath = relation && !relation.external
    ? resolvePartPath(workbookPath, relation.target)
    : `xl/worksheets/sheet${sheets.indexOf(sheet) + 1}.xml`;
  const sheetXml = await readZipText(bytes, entries, sheetPath);
  if (sheetXml === null) throw new SheetReadError(DAMAGED_XLSX);
  const sharedRelation = [...relationships.values()].find((candidate) => /\/sharedStrings$/.test(candidate.type));
  const sharedPath = sharedRelation ? resolvePartPath(workbookPath, sharedRelation.target) : resolvePartPath(workbookPath, 'sharedStrings.xml');
  const sharedStrings = parseSharedStrings(await readZipText(bytes, entries, sharedPath));
  return { sheetName: sheet.name, rows: parseWorksheet(sheetXml, sharedStrings) };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function parseCsvBytes(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (_) {
    throw new SheetReadError('La planilla .csv no está guardada en UTF-8. En Excel elegí «CSV UTF-8 (delimitado por comas)» y volvé a subirla.');
  }
  return parseCsvText(text);
}

/** El separador sale de la fila del encabezado («SKU;…» o «SKU,…»); si no la encuentra, de la primera línea. */
export function detectCsvDelimiter(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r\n|\n|\r/).filter((line) => line.trim());
  for (const line of lines.slice(0, 60)) {
    const match = /^\s*"?\s*sku\s*"?\s*([;,])/i.exec(line);
    if (match) return match[1];
  }
  const first = lines[0] || '';
  const outside = first.replace(/"[^"]*"/g, '');
  return (outside.match(/;/g) || []).length > (outside.match(/,/g) || []).length ? ';' : ',';
}

/** CSV con comillas (las comillas dobles adentro se escriben ""), separado por coma o punto y coma. */
export function parseCsvText(input) {
  const text = String(input ?? '').replace(/^﻿/, '');
  const delimiter = detectCsvDelimiter(text);
  const rows = [];
  let record = [];
  let field = '';
  let quoted = false;
  let fieldWasQuoted = false;
  let number = 1;
  let quoteStartedAt = 0;

  const pushField = () => {
    record.push(field === '' && !fieldWasQuoted ? null : (field.trim() === '' ? null : field));
    field = '';
    fieldWasQuoted = false;
  };
  const pushRecord = () => {
    pushField();
    if (record.some((value) => value !== null)) {
      rows.push({ number, cells: record });
      if (rows.length > MAX_SHEET_ROWS_WITH_HEADER) throw new SheetReadError(TOO_MANY_ROWS);
    }
    record = [];
    number += 1;
  };

  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (quoted) {
      if (char === '"') {
        if (text[at + 1] === '"') { field += '"'; at += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field.trim() === '') {
      quoted = true;
      fieldWasQuoted = true;
      field = '';
      quoteStartedAt = number;
    } else if (char === delimiter) pushField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[at + 1] === '\n') at += 1;
      pushRecord();
    } else field += char;
  }
  if (quoted) throw new SheetReadError(`Hay una comilla sin cerrar en la fila ${quoteStartedAt} de la planilla.`);
  if (field !== '' || fieldWasQuoted || record.length) pushRecord();
  return rows;
}
