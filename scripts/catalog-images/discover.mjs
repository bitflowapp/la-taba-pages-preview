/*
 * Descubrimiento: qué fuente oficial publica la foto de cada uno de nuestros SKU.
 *
 * CÓMO DECIDE
 * -----------
 * 1. La allowlist dice qué grupo cubre cada marca. Una marca sin grupo no
 *    descubre: queda en fallback y aparece en la lista de trabajo.
 * 2. Del grupo se cosecha el catálogo entero de la tienda oficial.
 * 3. Cada candidato se compara contra el SKU en cinco ejes (presentation.mjs).
 * 4. Sólo ALTA se puede asociar sola. MEDIA va a revisión humana. RECHAZO no
 *    se descarga.
 *
 * LO QUE NO HACE
 * --------------
 * No descarga imágenes ni toca la base. Escribe dos papeles —el manifiesto de
 * fuentes y la matriz— y ahí termina. Descargar es el paso siguiente y explícito.
 *
 *   node scripts/catalog-images/discover.mjs
 *   node scripts/catalog-images/discover.mjs --sin-red   (usa la cosecha guardada)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { harvestGroup } from './sources/vtex.mjs';
import { parseSourceTitle, scoreCandidate, skuPresentation } from './presentation.mjs';
import { loadCatalogSkus } from './catalog-skus.mjs';
import { stableJson } from './lib.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ARTIFACTS = path.join(ROOT, 'artifacts/taba2-catalog-images');
const ALLOWLIST = path.join(ROOT, 'catalog/image-source-allowlist.json');
const COSECHA = path.join(ARTIFACTS, 'harvest.json');
const MANIFIESTO = path.join(ARTIFACTS, 'SOURCE-MANIFEST.json');
const MATRIZ = path.join(ARTIFACTS, 'SKU-IMAGE-MATRIX.csv');
const sinRed = process.argv.includes('--sin-red');

const ADAPTADORES = { vtex: harvestGroup };

const allowlist = JSON.parse(await fs.readFile(ALLOWLIST, 'utf8'));
const { skus, reconciliacion } = await loadCatalogSkus(ROOT);
await fs.mkdir(ARTIFACTS, { recursive: true });

/** Marca -> grupos de la allowlist que la cubren. */
const gruposPorMarca = new Map();
for (const grupo of allowlist.groups) {
  for (const marca of grupo.brands) {
    if (!gruposPorMarca.has(marca)) gruposPorMarca.set(marca, []);
    gruposPorMarca.get(marca).push(grupo);
  }
}

let cosecha;
if (sinRed) {
  cosecha = JSON.parse(await fs.readFile(COSECHA, 'utf8'));
  console.log(`Cosecha guardada: ${cosecha.candidatos.length} candidatos de ${cosecha.grupos.length} grupos.`);
} else {
  const candidatos = [];
  const grupos = [];
  for (const grupo of allowlist.groups) {
    /*
     * `sin-catalogo` es un grupo que aporta HOSTS pero no se puede recorrer: el
     * fabricante publica el packshot en una ficha suelta o en un CDN por id
     * opaco, sin índice ni API. La foto entra igual —a mano, mirada y firmada
     * en la auditoría— y la allowlist sigue siendo la que decide si ese host
     * puede descargarse. Sin esto había que elegir entre inventar un adaptador
     * para un catálogo que no existe, o dejar la fuente afuera.
     */
    if (grupo.adapter === 'sin-catalogo') {
      grupos.push({ categorias: [], id: grupo.id, storeHost: grupo.storeHost, traidos: 0 });
      console.log(`  ${grupo.id}: sin catálogo recorrible; sus fuentes entran a mano por la auditoría`);
      continue;
    }
    const adaptador = ADAPTADORES[grupo.adapter];
    if (!adaptador) throw new Error(`Adaptador desconocido: ${grupo.adapter}`);
    const categorias = [];
    const traidos = await adaptador(grupo, {
      onCategory: (detalle) => {
        categorias.push(detalle);
        const nota = detalle.error ? `ERROR ${detalle.error}` : `${detalle.cantidad} productos`;
        console.log(`  ${grupo.id} · ${detalle.path}: ${nota}`);
      },
    });
    grupos.push({ categorias, id: grupo.id, storeHost: grupo.storeHost, traidos: traidos.length });
    candidatos.push(...traidos);
  }
  cosecha = { candidatos, cosechadoEl: new Date().toISOString().slice(0, 10), grupos };
  await fs.writeFile(COSECHA, stableJson(cosecha), 'utf8');
  console.log(`Cosecha: ${candidatos.length} candidatos con imagen.`);
}

// Un candidato cuya imagen no viva en un CDN permitido no se considera, por más
// que el título calce. La fuente es parte de la identidad del activo.
const cdnPermitidos = new Set(allowlist.groups.flatMap((grupo) => grupo.cdnHosts));
const hostsRechazados = new Set(allowlist.rejectedHosts.hosts);

function hostDe(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

const decisiones = [];
for (const sku of skus) {
  const presentacion = skuPresentation(sku);
  const grupos = gruposPorMarca.get(sku.brand) || [];
  const evaluados = [];

  for (const grupo of grupos) {
    for (const candidato of cosecha.candidatos) {
      if (candidato.groupId !== grupo.id) continue;
      const host = hostDe(candidato.imageUrl);
      if (!host || !cdnPermitidos.has(host) || hostsRechazados.has(host)) continue;
      const parsed = parseSourceTitle(candidato.title, {
        packagingConvention: candidato.envasePorDefecto ? { default: candidato.envasePorDefecto } : null,
      });
      const { confidence, reasons } = scoreCandidate(presentacion, parsed, {
        brandDeclared: candidato.brandDeclared,
      });
      if (confidence === 'REJECT') continue;
      evaluados.push({
        candidato,
        confidence,
        grupo: grupo.id,
        parsed: {
          capacityMl: parsed.capacityMl,
          envase: parsed.packaging.envase,
          envaseDeclarado: parsed.packaging.stated,
          packCount: parsed.packCount,
        },
        reasons,
        sourceType: grupo.sourceType,
      });
    }
  }

  evaluados.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'HIGH' ? -1 : 1));
  const altas = evaluados.filter((e) => e.confidence === 'HIGH');

  let estado;
  let elegido = null;
  if (altas.length === 1) {
    estado = 'HIGH';
    [elegido] = altas;
  } else if (altas.length > 1) {
    // Dos fuentes oficiales que dicen ser el mismo producto no es una suerte:
    // es una ambigüedad, y elegir una al azar es exactamente el error que este
    // pipeline existe para no cometer.
    estado = 'MANUAL_REVIEW';
  } else if (evaluados.length) {
    estado = 'MANUAL_REVIEW';
  } else if (!grupos.length) {
    estado = 'SIN_FUENTE';
  } else {
    estado = 'SIN_CANDIDATO';
  }

  decisiones.push({
    alcoholic: sku.alcoholic,
    brand: sku.brand,
    candidatos: evaluados.map((e) => ({
      confidence: e.confidence,
      grupo: e.grupo,
      imageUrl: e.candidato.imageUrl,
      parsed: e.parsed,
      productUrl: e.candidato.productUrl,
      reasons: e.reasons,
      sourceType: e.sourceType,
      title: e.candidato.title,
    })),
    elegido: elegido
      ? {
        grupo: elegido.grupo,
        imageUrl: elegido.candidato.imageUrl,
        productUrl: elegido.candidato.productUrl,
        sourceType: elegido.sourceType,
        title: elegido.candidato.title,
      }
      : null,
    estado,
    externalId: sku.externalId,
    origen: sku.origen,
    presentacion,
    sku: sku.sku,
  });
}

const resumen = {};
for (const decision of decisiones) resumen[decision.estado] = (resumen[decision.estado] || 0) + 1;

await fs.writeFile(MANIFIESTO, stableJson({
  allowlistActualizadaEl: allowlist.updatedAt,
  cosechadoEl: cosecha.cosechadoEl,
  decisiones,
  reconciliacion,
  resumen,
  schemaVersion: 1,
  totalSku: decisiones.length,
}), 'utf8');

const COLUMNAS = [
  'sku', 'external_id', 'origen', 'marca', 'producto', 'variante', 'capacidad_ml',
  'envase', 'units_per_pack', 'sold_as_pack', 'alcohol', 'disponible', 'precio',
  'image_status', 'source_status', 'confidence', 'fuente_tipo', 'fuente_titulo', 'fuente_url',
];
const escapar = (valor) => {
  const texto = String(valor ?? '');
  return /[",\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
};
/*
 * El estado de la imagen tiene tres valores, no dos, y la diferencia importa:
 * un SKU puede tener su master y su thumbnail listos en el repositorio y aun así
 * no mostrarlos, porque asociarlos exige escribir en `products` con un owner
 * autenticado. Decir «SIN_IMAGEN» en ese caso escondería trabajo terminado
 * detrás de un paso que no es técnico.
 */
const manifiestoImagenes = JSON.parse(
  await fs.readFile(path.join(ROOT, 'docs/catalog/image-manifest.json'), 'utf8'),
).sources ?? [];
const conMaster = new Set(manifiestoImagenes.map((fuente) => fuente.sku));
const estadoDeImagen = (sku) => {
  if (sku.imageUrl) return 'PUBLICADA';
  if (conMaster.has(sku.sku)) return 'MASTER_LISTO_SIN_ASOCIAR';
  return 'SIN_IMAGEN';
};

const porSku = new Map(skus.map((sku) => [sku.sku, sku]));
const filas = decisiones.map((decision) => {
  const sku = porSku.get(decision.sku);
  return [
    decision.sku,
    decision.externalId,
    decision.origen,
    decision.brand,
    sku.name,
    sku.variant,
    decision.presentacion.capacityMl,
    decision.presentacion.envase,
    decision.presentacion.packCount,
    sku.soldAsPack,
    sku.alcoholic,
    sku.available,
    sku.price,
    estadoDeImagen(sku),
    decision.estado,
    decision.elegido ? 'HIGH' : (decision.candidatos[0]?.confidence || ''),
    decision.elegido?.sourceType || '',
    decision.elegido?.title || '',
    decision.elegido?.productUrl || '',
  ].map(escapar).join(',');
});
await fs.writeFile(MATRIZ, `${[COLUMNAS.join(','), ...filas].join('\n')}\n`, 'utf8');

console.log('');
console.log(`Matriz: ${path.relative(ROOT, MATRIZ).replaceAll('\\', '/')}`);
console.log(`Manifiesto: ${path.relative(ROOT, MANIFIESTO).replaceAll('\\', '/')}`);
console.log(`SKU: ${decisiones.length}`);
for (const [estado, cuantos] of Object.entries(resumen).sort()) {
  console.log(`  ${estado}: ${cuantos}`);
}
