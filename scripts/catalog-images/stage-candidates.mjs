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
 * El alcance, leído del registro y no de la memoria de nadie.
 *
 * ESTO ANTES ERA UNA COPIA A MANO, Y LA COPIA SE ATRASÓ. La lista decía
 * `['marca','fabricante','propio']` —el alcance BASE, correcto el 2026-08-18—
 * y el 2026-08-25 el titular amplió el marco a `distribuidor_oficial` nombrando
 * justamente el packshot de Trapiche como el caso que la redacción anterior
 * había dejado afuera. El guion no se enteró: siguió estampando FUERA DE
 * ALCANCE sobre la única fuente que ya tenía permiso, ocho días. Por eso ahora
 * el alcance se DERIVA del registro —base más la unión de las ampliaciones— y
 * ampliar el marco es editar un archivo, no dos.
 *
 * Lo que no cambia: una autorización declara un MARCO y no reetiqueta nada. Que
 * un tipo de fuente esté en alcance sólo habilita a ANOTARLO con derechos; la
 * foto sigue necesitando que alguien la mire y la firme.
 */
const TIPOS_CUBIERTOS = new Set([
  ...(autoridad.habilita_source_types || []),
  ...(autoridad.ampliaciones || []).flatMap((a) => a.habilita_source_types || []),
]);
if (!TIPOS_CUBIERTOS.size) {
  throw new Error(
    `${autoridad.id} no declara ningún habilita_source_types. Sin alcance legible no se anota nada con derechos.`,
  );
}

await fs.mkdir(REVISION, { recursive: true });

/*
 * LA AUDITORÍA QUE YA EXISTE, LEÍDA ANTES DE ESCRIBIR NADA.
 *
 * Sin esto, correr el descubrimiento de nuevo DESAPROBABA trabajo firmado. El
 * pie de este archivo dice —y decía— que «el trabajo de revisión de otro no se
 * pisa por correr el descubrimiento de nuevo», y era falso para todo SKU que el
 * descubrimiento volviera a proponer: la fila nueva reemplazaba a la vieja con
 * `status: REVISAR_IMAGEN`, con los mismos bytes y la misma fuente. Medido el
 * 2026-08-26: una corrida rutinaria bajó a REVISAR_IMAGEN los cuatro packs
 * oficiales aprobados el 2026-08-18, y el efecto sólo se vio dos pasos después,
 * cuando `verify` encontró ocho WebP publicados sin entrada en el manifiesto.
 *
 * La regla correcta es la de siempre en este pipeline: lo que hace falta mirar
 * de nuevo es la IMAGEN, y la imagen es sus bytes. Si el SHA-256 no se movió, la
 * revisión firmada sigue valiendo. Si se movió, la aprobación cae, que es
 * exactamente lo que tiene que pasar.
 */
const auditoriaPrevia = new Map(
  recordsFromCsvRows(parseCsv(await fs.readFile(AUDIT, 'utf8')))
    .records.filter((fila) => fila.sku)
    .map((fila) => [fila.sku, fila]),
);

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

  /*
   * Una revisión firmada sobre ESTOS MISMOS bytes se respeta entera. No se
   * reescribe el `checked_at` ni la nota: quien la firmó dijo qué miró y
   * cuándo, y esta corrida no miró nada.
   */
  const previa = auditoriaPrevia.get(decision.sku);
  if (cubierta && previa?.status === 'APROBADA' && previa.expected_sha256 === digest) {
    filas.push({ ...previa, source_url: elegido.imageUrl });
    console.log(`${decision.sku}: sin cambios (sha256 idéntico) · se conserva la aprobación del ${previa.checked_at}`);
    continue;
  }
  if (previa?.status === 'APROBADA' && previa.expected_sha256 !== digest) {
    console.log(`${decision.sku}: LA FUENTE CAMBIÓ DE BYTES · cae la aprobación del ${previa.checked_at} y vuelve a revisión`);
  }

  filas.push({
    capacity_verified: 'true',
    checked_at: HOY,
    external_id: decision.externalId,
    expected_sha256: digest,
    notes: cubierta
      ? `${elegido.title} · ${elegido.productUrl || ''} · descubierto por allowlist ${elegido.grupo}`
      : `${elegido.title} · FUERA DEL ALCANCE de ${autoridad.id}: la fuente es ${elegido.sourceType} y la autorización cubre ${[...TIPOS_CUBIERTOS].join(', ')}. Ampliar el marco antes de publicar.`,
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
