/*
 * El mapa completo de la góndola pública: qué SKU se puede comprar hoy y qué
 * está mostrando cada uno en la tarjeta.
 *
 * PARA QUÉ
 * --------
 * Antes de tocar una sola imagen hay que saber cuántas de las que ya están son
 * reales, cuántas son el recurso propio de TABA y —sobre todo— si alguna está
 * mostrando un producto que no es. Cambiar assets sin ese mapa es cambiar a
 * ciegas: se arregla lo que se ve y se rompe lo que no.
 *
 * SÓLO LEE. No abre la base, no escribe en catálogo y no toca ningún activo.
 * Trabaja contra la fotografía de producción versionada, que es el dato que se
 * puede reproducir y auditar.
 *
 * LAS CUATRO ETIQUETAS, Y QUÉ SIGNIFICA CADA UNA
 * ----------------------------------------------
 *   REAL        el SKU muestra una fotografía del producto exacto, con
 *               derechos publicables y la cadena de hashes completa.
 *   FALLBACK    no hay foto y el SKU muestra el recurso propio de TABA. Es un
 *               estado honesto, no una falla.
 *   INCORRECTA  el SKU tiene una foto asociada que NO corresponde a lo que se
 *               entrega: otra capacidad, otra variante, otro envase, u otra
 *               cantidad. Es el único estado que hay que reparar hoy.
 *   AUSENTE     el SKU declara una ruta de imagen que no existe en el árbol
 *               publicable. La tarjeta cae a fallback sola, pero el catálogo
 *               está mintiendo sobre lo que tiene.
 *
 * Y POR QUÉ ADEMÁS HAY UNA `clasificacion`
 * ----------------------------------------
 * Las cuatro etiquetas de arriba dicen QUÉ ve el cliente. No dicen POR QUÉ, y
 * para el trabajo comercial esa es la pregunta cara: «FALLBACK: 30» junta en un
 * solo número dos situaciones que no se parecen en nada —quince SKU cuya foto
 * exacta existe y está identificada pero no se puede publicar, y quince para
 * los que no hay ninguna fuente en el mundo alcanzable—. La primera se destraba
 * con un correo a la marca; la segunda, sólo con fotografía propia.
 *
 *   OFFICIAL_EXACT    foto del fabricante, embotellador o importador de la
 *                     marca, con identidad exacta y derechos.
 *   AUTHORIZED_EXACT  ídem pero la publica un distribuidor oficial: un escalón
 *                     por debajo, y por eso se cuenta aparte.
 *   BLOCKED_IDENTITY  la fuente oficial publica este producto, pero su imagen
 *                     no se puede usar sin mentir sobre lo que se entrega —el
 *                     caso vivo son los packshots con sello de pack sobre el
 *                     envase, medidos en catalog/sello-de-pack-medicion.json—.
 *   BLOCKED_RIGHTS    existe la imagen exacta, pero la autorización vigente no
 *                     cubre a quien la publica.
 *   FALLBACK          no hay fuente. El recurso propio de TABA es la respuesta
 *                     correcta y definitiva hasta que haya fotografía propia.
 *
 * Las tres últimas muestran lo mismo en la tarjeta —el recurso propio—: la
 * clasificación no cambia lo que ve nadie, explica por qué no hay foto. No
 * existe una etiqueta «SIMILAR», y no debe existir: una imagen parecida es una
 * imagen incorrecta.
 *
 *   node scripts/catalog-images/auditar-gondola-publica.mjs
 *   node scripts/catalog-images/auditar-gondola-publica.mjs --check
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { loadCatalogSkus } from './catalog-skus.mjs';
import { OBJETIVOS } from './lote-objetivo.mjs';
import { stableJson } from './lib.mjs';
import { auditProductImageRights } from '../lib/publishable-image-rights.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SALIDA_CSV = path.join(ROOT, 'docs/catalog/gondola-publica-imagenes.csv');
const SALIDA_JSON = path.join(ROOT, 'docs/catalog/gondola-publica-imagenes.json');
const MANIFIESTO = path.join(ROOT, 'docs/catalog/image-manifest.json');
const MEDICION_SELLO = path.join(ROOT, 'catalog/sello-de-pack-medicion.json');
const AUTORIZACIONES = path.join(ROOT, 'catalog/autorizaciones-comerciales.json');

/*
 * Los SKU cuya foto exacta EXISTE en la fuente oficial y aun así no se puede
 * publicar. Se leen de la evidencia versionada, no de una lista a mano: el día
 * que la fuente publique un packshot limpio, el relevamiento deja de medirlo y
 * este SKU sale solo de la categoría.
 */
const bloqueadosPorIdentidad = new Set(
  JSON.parse(fs.readFileSync(MEDICION_SELLO, 'utf8')).mediciones.map((fila) => fila.sku),
);
const bloqueadosPorDerechos = new Set(
  JSON.parse(fs.readFileSync(AUTORIZACIONES, 'utf8')).autorizaciones
    .flatMap((autorizacion) => autorizacion.fuera_de_alcance_detectado || [])
    .map((fila) => fila.sku),
);

/** Un distribuidor oficial vale para descubrir, pero se cuenta aparte del fabricante. */
const clasificar = (tipo, sku, sourceType) => {
  if (tipo === 'REAL') return sourceType === 'fabricante' ? 'OFFICIAL_EXACT' : 'AUTHORIZED_EXACT';
  if (tipo !== 'FALLBACK') return tipo;
  if (bloqueadosPorDerechos.has(sku)) return 'BLOCKED_RIGHTS';
  if (bloqueadosPorIdentidad.has(sku)) return 'BLOCKED_IDENTITY';
  return 'FALLBACK';
};

const soloVerificar = process.argv.includes('--check');

/** GTIN conocido de cada SKU, con la autoridad local que lo declara. */
async function gtinPorSku() {
  const [{ RETAIL_UNIDADES }, { BARCODES_EXISTENTES_PROPUESTOS, PRODUCTOS_PROPUESTOS }] = await Promise.all([
    import(new URL(`file://${path.join(ROOT, 'catalog/retail-unidades.mjs').replaceAll('\\', '/')}`).href),
    import(new URL(`file://${path.join(ROOT, 'catalog/gondola-retail-final-proposal.mjs').replaceAll('\\', '/')}`).href),
  ]);
  const mapa = new Map();
  const anotar = (filas, autoridad) => {
    for (const fila of filas) {
      if (!fila?.gtin || mapa.has(fila.sku)) continue;
      mapa.set(fila.sku, { autoridad, gtin: fila.gtin, tipo: fila.gtinType || 'EAN-13' });
    }
  };
  // `product_barcodes` no es legible con la clave publicable: el GTIN que se
  // reporta es el que declaran las autoridades locales, y se dice de cuál sale.
  anotar(RETAIL_UNIDADES, 'catalog/retail-unidades.mjs');
  anotar(PRODUCTOS_PROPUESTOS, 'catalog/gondola-retail-final-proposal.mjs');
  anotar(BARCODES_EXISTENTES_PROPUESTOS, 'catalog/gondola-retail-final-proposal.mjs (enriquecimiento propuesto)');
  return mapa;
}

/*
 * La capacidad tal como la escribe la tarjeta. Se emite como campo propio y no
 * sólo dentro de la presentación porque la verificación en vivo la necesita
 * suelta para reconocer cada tarjeta, y volver a partir la cadena con `split`
 * es justo la clase de acoplamiento que después se rompe callado.
 */
function capacidadLegible(sku) {
  const litros = sku.capacityValue >= 1000 && sku.capacityValue % 50 === 0;
  return litros
    ? `${String(sku.capacityValue / 1000).replace('.', ',')} L`
    : `${sku.capacityValue} ${sku.capacityUnit || 'ml'}`;
}

function envaseLegible(sku) {
  const tipo = String(sku.packagingType || '').toLowerCase();
  if (tipo.includes('lata')) return 'Lata';
  if (tipo.includes('sifon')) return 'Sifón';
  return 'Botella PET';
}

function presentacionLegible(sku) {
  const cantidad = sku.unitsPerPack > 1 ? `Pack x${sku.unitsPerPack}` : 'Unidad';
  return `${envaseLegible(sku)} · ${capacidadLegible(sku)} · ${cantidad}`;
}

const manifiesto = JSON.parse(await fsp.readFile(MANIFIESTO, 'utf8'));
const porSkuEnManifiesto = new Map((manifiesto.sources || []).map((fuente) => [fuente.sku, fuente]));
const derechosPorRuta = new Map(auditProductImageRights(ROOT).map((imagen) => [imagen.path, imagen]));
const gtines = await gtinPorSku();
const { skus, reconciliacion } = await loadCatalogSkus(ROOT);

const filas = [];
for (const sku of skus.filter((fila) => fila.available)) {
  const ruta = sku.imageUrl || '';
  const fuente = porSkuEnManifiesto.get(sku.sku) || null;
  const derechos = ruta ? derechosPorRuta.get(ruta) : null;
  const existeEnDisco = Boolean(ruta) && fs.existsSync(path.join(ROOT, ruta));
  const declarado = OBJETIVOS.get(sku.sku) || null;

  let tipo;
  const motivos = [];
  if (!ruta) {
    tipo = 'FALLBACK';
    motivos.push('el SKU no declara imagen; la tarjeta muestra el recurso propio de TABA');
  } else if (!existeEnDisco) {
    tipo = 'AUSENTE';
    motivos.push(`la ruta declarada no existe en el árbol publicable: ${ruta}`);
  } else if (!derechos?.publishable) {
    tipo = 'INCORRECTA';
    motivos.push(`la imagen asociada no tiene derechos publicables (${derechos?.rights || 'sin declarar'})`);
  } else if (declarado && declarado.unitsPerPack !== sku.unitsPerPack) {
    // El sello del packshot anuncia una cantidad. Si el producto dejó de traer
    // esa cantidad, la foto pasó a mentir sin que nadie tocara el archivo.
    tipo = 'INCORRECTA';
    motivos.push(
      `el packshot anuncia x${declarado.unitsPerPack} y el SKU trae x${sku.unitsPerPack}`,
    );
  } else if (!declarado && sku.unitsPerPack === 1) {
    tipo = 'INCORRECTA';
    motivos.push('una unidad suelta con foto asociada que ningún lote declaró');
  } else {
    tipo = 'REAL';
  }

  filas.push({
    autoridadGtin: gtines.get(sku.sku)?.autoridad || '',
    capacidad: capacidadLegible(sku),
    categoria: sku.category,
    clasificacion: clasificar(tipo, sku.sku, fuente?.sourceType),
    derechos: derechos?.rights || (ruta ? 'sin declarar' : ''),
    gtin: gtines.get(sku.sku)?.gtin || '',
    imageUrl: ruta,
    motivo: motivos.join(' · '),
    nombre: sku.name,
    origenImagen: fuente
      ? `${fuente.sourceType} · ${new URL(fuente.sourceUrl).hostname}`
      : (ruta ? 'sin manifiesto' : 'FALLBACK_PROPIO_TABA'),
    presentacion: presentacionLegible(sku),
    referenciaDerechos: fuente?.rightsReference || '',
    sku: sku.sku,
    tipo,
    unitsPerPack: sku.unitsPerPack,
  });
}

filas.sort((a, b) => a.sku.localeCompare(b.sku));

const resumen = filas.reduce((acumulado, fila) => {
  acumulado[fila.tipo] = (acumulado[fila.tipo] || 0) + 1;
  return acumulado;
}, {});

const porClasificacion = filas.reduce((acumulado, fila) => {
  acumulado[fila.clasificacion] = (acumulado[fila.clasificacion] || 0) + 1;
  return acumulado;
}, {});

const COLUMNAS = [
  'sku', 'gtin', 'autoridad_gtin', 'nombre', 'presentacion', 'capacidad', 'categoria',
  'units_per_pack', 'image_url', 'origen_imagen', 'derechos',
  'referencia_derechos', 'tipo', 'clasificacion', 'motivo',
];
const escapar = (valor) => {
  const texto = String(valor ?? '');
  return /[",\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
};
const csv = `${[
  COLUMNAS.join(','),
  ...filas.map((fila) => [
    fila.sku, fila.gtin, fila.autoridadGtin, fila.nombre, fila.presentacion, fila.capacidad, fila.categoria,
    fila.unitsPerPack, fila.imageUrl, fila.origenImagen, fila.derechos,
    fila.referenciaDerechos, fila.tipo, fila.clasificacion, fila.motivo,
  ].map(escapar).join(',')),
].join('\n')}\n`;

const json = stableJson({
  doc: 'Mapa SKU → imagen de la góndola pública. Sólo lectura; generado por scripts/catalog-images/auditar-gondola-publica.mjs.',
  filas,
  porClasificacion,
  reconciliacion,
  resumen,
  schemaVersion: 2,
  totalVisibles: filas.length,
});

if (soloVerificar) {
  const csvEnDisco = fs.existsSync(SALIDA_CSV) ? await fsp.readFile(SALIDA_CSV, 'utf8') : '';
  const jsonEnDisco = fs.existsSync(SALIDA_JSON) ? await fsp.readFile(SALIDA_JSON, 'utf8') : '';
  if (csvEnDisco !== csv || jsonEnDisco !== json) {
    console.error('La auditoría versionada no coincide con el catálogo de hoy.');
    console.error('Correr: npm run catalog:images:audit');
    process.exit(1);
  }
  console.log(`Auditoría al día: ${filas.length} SKU visibles.`);
  process.exit(0);
}

await fsp.mkdir(path.dirname(SALIDA_CSV), { recursive: true });
await fsp.writeFile(SALIDA_CSV, csv, 'utf8');
await fsp.writeFile(SALIDA_JSON, json, 'utf8');

console.log(`SKU visibles y comprables: ${filas.length}`);
for (const [tipo, cuantos] of Object.entries(resumen).sort()) console.log(`  ${tipo}: ${cuantos}`);
console.log('Por qué, no sólo qué:');
for (const [clase, cuantos] of Object.entries(porClasificacion).sort()) console.log(`  ${clase}: ${cuantos}`);
console.log(`CSV:  ${path.relative(ROOT, SALIDA_CSV).replaceAll('\\', '/')}`);
console.log(`JSON: ${path.relative(ROOT, SALIDA_JSON).replaceAll('\\', '/')}`);
