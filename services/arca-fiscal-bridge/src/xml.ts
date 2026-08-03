import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  htmlEntities: false,
  trimValues: true,
});

export function parseTrustedSoap(xml: string): unknown {
  if (Buffer.byteLength(xml, 'utf8') > 1_048_576) throw new Error('Respuesta XML excede el límite.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD y entidades XML no están permitidas.');
  return parser.parse(xml);
}

export function xmlText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object' && '#text' in value) return xmlText((value as Record<string, unknown>)['#text']);
  return '';
}

export function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function findFirst(root: unknown, key: string): unknown {
  if (!root || typeof root !== 'object') return undefined;
  const object = root as Record<string, unknown>;
  if (Object.hasOwn(object, key)) return object[key];
  for (const value of Object.values(object)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findFirst(item, key);
        if (found !== undefined) return found;
      }
    } else {
      const found = findFirst(value, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
