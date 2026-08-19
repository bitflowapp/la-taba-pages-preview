/*
 * Baja los candidatos que el descubrimiento marcó ALTA y los deja anotados en
 * la auditoría de fuentes, EN REVISIÓN.
 *
 * POR QUÉ NO LOS APRUEBA
 * ----------------------
 * Que cinco ejes de texto cierren no dice nada sobre lo que se ve en la foto.
 * Un packshot puede estar recortado, tener el sello de otra promoción o ser
 * directamente de otro envase con el mismo nombre. Aprobar es mirar, y mirar es
 * humano. Este guion prepara el material y calcula el SHA-256 que después la
 * descarga verificada exige; aprobar es un paso aparte y explícito.
 *
 * DERECHOS
 * --------
 * El estado de derechos NO se inventa: sale de `catalog/autorizaciones-comerciales.json`
 * y sólo se aplica a las fuentes cuyo tipo entra en el alcance declarado. Un
 * distribuidor no es «la marca o su embotellador/importador», así que su
 * material queda anotado sin derechos hasta que el titular amplíe el marco.
 *
 *   node scripts/catalog-images/stage-candidates.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseCsv } from '../validate-product-catalog.mjs';
import { hostOf, recordsFromCsvRows, sha256, IMAGE_AUDIT_COLUMNS } from './lib.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ARTIFACTS = path.join(ROOT, 'artifacts/taba2-catalog-images');
const MANIFIESTO = path.join(ARTIFACTS, 'SOURCE-MANIFEST.json');
const ALLOWLIST = path.join(ROOT, 'catalog/image-source-allowlist.json');
const AUTORIZACIONES = path.join(ROOT, 'catalog/autorizaciones-comerciales.json');
const AUDIT = path.join(ROOT, 'docs/catalog/image-source-audit.csv');
const REVISION = path.join(ARTIFACTS, 'revision');
const HOY = new Date().toISOString().slice(0, 10);

const manifiesto = JSON.parse(await fs.readFile(MANIFIESTO, 'utf8'));
const allowlist = JSON.parse(await fs.readFile(ALLOWLIST, 'utf8'));
const autorizaciones = JSON.parse(await fs.readFile(AUTORIZACIONES, 'utf8'));
const allowedHosts = new Set(allowlist.groups.flatMap((group) => group.cdnHosts));

const autoridad = autorizaciones.autorizaciones.find((a) => a.id === allowlist.rightsAuthority);
if (!autoridad) throw new Error(`La allowlist cita ${allowlist.rightsAuthority} y ese id no está registrado.`);

/*
 * El alcance, leído del registro y no de la memoria de nadie: la autorización
 * cubre packshots «provistos por la marca o su embotellador/importador». En el
 * vocabulario de fuentes del pipeline eso es `marca` y `fabricante`.
 * `distribuidor_oficial` NO está en esa frase, y el registro es explícito en que
 * una autorización declarada no reetiqueta nada.
 */
const TIPOS_CUBIERTOS = new Set(['marca', 'fabricante', 'propio']);

await fs.mkdir(REVISION, { recursive: true });

const altas = manifiesto.decisiones.filter((decision) => decision.estado === 'HIGH');
if (!altas.length) {
  console.log('No hay candidatos ALTA. Nada que bajar.');
  process.exit(0);
}

const filas = [];
for (const decision of altas) {
  const { elegido } = decision;
  const host = hostOf(elegido.imageUrl);
  if (!host || !allowedHosts.has(host)) {
    console.error(`SALTEADO ${decision.sku}: ${host || 'host ilegible'} no está en la allowlist.`);
    continue;
  }

  const response = await fetch(elegido.imageUrl, {
    headers: { 'user-agent': 'TABA-catalog-images/1' },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    console.error(`SALTEADO ${decision.sku}: la fuente respondió ${response.status}.`);
    continue;
  }
  const hostFinal = hostOf(response.url);
  if (!hostFinal || !allowedHosts.has(hostFinal)) {
    console.error(`SALTEADO ${decision.sku}: la descarga terminó en ${hostFinal}, fuera de la allowlist.`);
    continue;
  }
  const tipo = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256(bytes);

  // Copia para mirar. No entra en el paquete y no se versiona: es material de
  // revisión, y su lugar es el informe, no la web.
  const extension = tipo === 'image/png' ? 'png' : tipo === 'image/webp' ? 'webp' : 'jpg';
  await fs.writeFile(path.join(REVISION, `${decision.sku}.${extension}`), bytes);

  const cubierta = TIPOS_CUBIERTOS.has(elegido.sourceType);
  filas.push({
    capacity_verified: 'true',
    checked_at: HOY,
    external_id: decision.externalId,
    expected_sha256: digest,
    notes: cubierta
      ? `${elegido.title} · ${elegido.productUrl || ''} · descubierto por allowlist ${elegido.grupo}`
      : `${elegido.title} · FUERA DEL ALCANCE de ${autoridad.id}: la fuente es ${elegido.sourceType} y la autorización cubre marca/embotellador/importador. Ampliar el marco antes de publicar.`,
    package_verified: 'true',
    pack_verified: 'true',
    rights_reference: cubierta ? autoridad.id : '',
    rights_status: cubierta ? autoridad.habilita_rights_status : '',
    sku: decision.sku,
    source_type: elegido.sourceType,
    source_url: elegido.imageUrl,
    // Nadie miró la foto todavía. Ese es exactamente el estado.
    status: cubierta ? 'REVISAR_IMAGEN' : 'PENDIENTE_DERECHOS',
    variant_verified: 'true',
  });
  console.log(`${decision.sku}: ${bytes.length} bytes · sha256=${digest.slice(0, 16)}… · ${cubierta ? 'derechos en alcance' : 'DERECHOS FUERA DE ALCANCE'}`);
}

// Se conservan las filas que ya estaban: esta auditoría es acumulativa y el
// trabajo de revisión de otro no se pisa por correr el descubrimiento de nuevo.
const previas = recordsFromCsvRows(parseCsv(await fs.readFile(AUDIT, 'utf8'))).records
  .filter((fila) => fila.sku && !filas.some((nueva) => nueva.sku === fila.sku));

const escapar = (valor) => {
  const texto = String(valor ?? '');
  return /[",\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
};
const todas = [...previas, ...filas].sort((a, b) => (a.sku < b.sku ? -1 : 1));
const csv = [
  IMAGE_AUDIT_COLUMNS.join(','),
  ...todas.map((fila) => IMAGE_AUDIT_COLUMNS.map((columna) => escapar(fila[columna])).join(',')),
].join('\n');
await fs.writeFile(AUDIT, `${csv}\n`, 'utf8');

console.log('');
console.log(`Auditoría: ${path.relative(ROOT, AUDIT).replaceAll('\\', '/')} · ${todas.length} filas`);
console.log(`Para revisar: ${path.relative(ROOT, REVISION).replaceAll('\\', '/')}`);
console.log('Ninguna quedó APROBADA. Aprobar es mirar la foto, y eso lo hace una persona.');
