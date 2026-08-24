/*
 * Por qué las unidades sueltas siguen en fallback, medido y no argumentado.
 *
 * LA PREGUNTA
 * -----------
 * La tienda oficial del embotellador publica la foto correcta de casi todas
 * nuestras botellas: misma marca, misma variante, misma capacidad, mismo
 * envase. Lo único que no coincide es la cantidad: ella vende packs y nosotros
 * vendemos unidades. Si esa diferencia viviera sólo en el TÍTULO, la foto
 * serviría igual —el título es de la tienda, no del producto—. Este relevamiento
 * existe para contestar si además vive en la IMAGEN.
 *
 * QUÉ HACE
 * --------
 * 1. Toma los SKU que hoy se pueden comprar y todavía no tienen fotografía.
 * 2. Busca en la cosecha oficial el candidato que coincide en TODOS los ejes
 *    salvo la cantidad (mismo scorer del pipeline, con la cantidad neutralizada
 *    a propósito y dicho acá en voz alta).
 * 3. Descarga TODAS las imágenes que ese candidato publica —la principal y las
 *    alternativas— y mide el sello en cada una con `medir-sello-de-pack.mjs`.
 * 4. Escribe la evidencia: SHA-256, geometría del sello y cuánto envase tapa.
 *
 * POR QUÉ TAMBIÉN LAS ALTERNATIVAS
 * --------------------------------
 * La conclusión de este relevamiento es una negación universal: «ningún
 * packshot oficial sirve para una unidad». Medir sólo la imagen principal la
 * dejaba apoyada en una muestra de una por SKU, y la tienda publica productos
 * con hasta siete imágenes. Si una sola alternativa viniera limpia, la negación
 * sería falsa y nadie se habría enterado. Al 2026-08-24 hay un caso real —la
 * lata 354ml con seis alternativas de edición mundialista—: las siete traen
 * sello y las siete lo tienen encima del envase, pero eso ahora está medido en
 * vez de supuesto.
 *
 * No aprueba, no asocia y no deja los archivos: la descarga es temporal y lo
 * único que queda versionado es la medición.
 *
 * Necesita la cosecha de `discover` ya hecha (artifacts/…/harvest.json) y red
 * para bajar cada candidato.
 *
 *   node scripts/catalog-images/relevar-sello-de-pack.mjs
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { loadCatalogSkus } from './catalog-skus.mjs';
import { medirSello } from './medir-sello-de-pack.mjs';
import { parseSourceTitle, scoreCandidate, skuPresentation } from './presentation.mjs';
import { stableJson } from './lib.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const COSECHA = path.join(ROOT, 'artifacts/taba2-catalog-images/harvest.json');
const ALLOWLIST = path.join(ROOT, 'catalog/image-source-allowlist.json');
const SALIDA = path.join(ROOT, 'catalog/sello-de-pack-medicion.json');
const USER_AGENT = 'TABA-catalog-images/1 (+contacto comercial del negocio)';

const allowlist = JSON.parse(await fsp.readFile(ALLOWLIST, 'utf8'));
const cosecha = JSON.parse(await fsp.readFile(COSECHA, 'utf8'));
const { skus } = await loadCatalogSkus(ROOT);

const cdnPermitidos = new Set(allowlist.groups.flatMap((grupo) => grupo.cdnHosts));
const gruposPorMarca = new Map();
for (const grupo of allowlist.groups) {
  for (const marca of grupo.brands) {
    if (!gruposPorMarca.has(marca)) gruposPorMarca.set(marca, []);
    gruposPorMarca.get(marca).push(grupo);
  }
}

const hostDe = (url) => {
  try { return new URL(url).hostname; } catch { return null; }
};

/*
 * El scorer del pipeline con la cantidad puesta en el valor de la fuente. Es la
 * ÚNICA licencia que se toma este relevamiento, y se toma para poder demostrar
 * que la cantidad importa aunque el resto coincida. Ningún otro eje se afloja:
 * si la variante o la capacidad no cierran, el candidato no entra igual.
 */
function coincideSalvoCantidad(sku, candidato) {
  const parsed = parseSourceTitle(candidato.title, {
    packagingConvention: candidato.envasePorDefecto ? { default: candidato.envasePorDefecto } : null,
  });
  if (parsed.packCount === null) return null;
  if (parsed.packCount === sku.unitsPerPack) return null;
  const presentacion = { ...skuPresentation(sku), packCount: parsed.packCount };
  const { confidence, reasons } = scoreCandidate(presentacion, parsed, {
    brandDeclared: candidato.brandDeclared,
  });
  if (confidence === 'REJECT') return null;
  return { candidato, confianza: confidence, packCountFuente: parsed.packCount, parsed, reasons };
}

const temporal = await fsp.mkdtemp(path.join(os.tmpdir(), 'taba-sello-'));
const mediciones = [];
const sinCandidato = [];

try {
  for (const sku of skus.filter((fila) => fila.available && !fila.imageUrl)) {
    const grupos = gruposPorMarca.get(sku.brand) || [];
    if (!grupos.length) continue;
    const idsDeGrupo = new Set(grupos.map((grupo) => grupo.id));

    const coincidencias = [];
    for (const candidato of cosecha.candidatos) {
      if (!idsDeGrupo.has(candidato.groupId)) continue;
      const host = hostDe(candidato.imageUrl);
      if (!host || !cdnPermitidos.has(host)) continue;
      const coincidencia = coincideSalvoCantidad(sku, candidato);
      if (coincidencia) coincidencias.push(coincidencia);
    }
    if (!coincidencias.length) {
      sinCandidato.push(sku.sku);
      continue;
    }
    /*
     * Primero los HIGH, y entre ellos el de menor cantidad: es el candidato MÁS
     * favorable a reutilizar la foto. Si ni ése sirve, ninguno sirve. Los MEDIUM
     * entran igual —y quedan marcados como tales— porque el punto del
     * relevamiento es medir el mejor candidato que la fuente ofrece, no
     * aprobarlo: uno que además necesitaría revisión humana no mejora el caso.
     */
    coincidencias.sort((a, b) => (
      a.confianza === b.confianza
        ? a.packCountFuente - b.packCountFuente
        : (a.confianza === 'HIGH' ? -1 : 1)
    ));
    const [elegida] = coincidencias;

    /*
     * Todas las imágenes que publica el candidato, no sólo la portada: la
     * principal primero y después las alternativas, en el orden de la fuente.
     */
    const urls = [elegida.candidato.imageUrl, ...(elegida.candidato.alternateImages || [])];
    const medidas = [];
    let fallo = null;
    for (const [indice, url] of urls.entries()) {
      const respuesta = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(60_000),
      });
      if (!respuesta.ok) {
        fallo = `${sku.sku} (la fuente respondió ${respuesta.status} en la imagen ${indice + 1} de ${urls.length})`;
        break;
      }
      const destino = path.join(temporal, `${sku.sku}-${indice}.bin`);
      await fsp.writeFile(destino, Buffer.from(await respuesta.arrayBuffer()));
      const medida = await medirSello(destino);
      delete medida.archivo;
      medidas.push({ ...medida, esPortada: indice === 0, fuenteUrl: url });
    }
    if (fallo) {
      sinCandidato.push(fallo);
      continue;
    }

    const [portada] = medidas;
    const alternativas = medidas.slice(1);
    /*
     * El veredicto mira TODAS las imágenes: alcanza con que una sola venga sin
     * sello, o con el sello apoyado en blanco limpio, para que la decisión de
     * dejar este SKU en respaldo haya que rehacerla a mano.
     */
    const limpias = medidas.filter((medida) => !medida.selloDetectado || !medida.pisaElEnvase);

    mediciones.push({
      ...portada,
      alternativas,
      cantidadDelSku: sku.unitsPerPack,
      cantidadQueAnunciaLaFuente: elegida.packCountFuente,
      confianzaDelMatch: elegida.confianza,
      dudasDelMatch: elegida.reasons,
      fuenteTitulo: elegida.candidato.title,
      fuenteUrl: elegida.candidato.imageUrl,
      imagenesPublicadas: urls.length,
      productoUrl: elegida.candidato.productUrl,
      sku: sku.sku,
      veredictoParaEsteSku: limpias.length
        ? 'REVISAR_A_MANO: alguna de las imágenes del candidato no queda descartada por el sello'
        : 'FALLBACK: el sello anuncia otra cantidad, está en todas las imágenes y no se puede borrar sin repintar envase',
    });
    const detallePortada = portada.selloDetectado
      ? `sello x${elegida.packCountFuente} de ${portada.sello.diametroPx}px, tapa ${portada.solapamiento.productoTapado}px de envase`
      : 'sin sello detectado';
    const detalleAlternativas = alternativas.length
      ? ` · ${alternativas.length} alternativa(s): ${alternativas.filter((m) => m.selloDetectado && m.pisaElEnvase).length} con sello encima del envase`
      : '';
    console.log(`${sku.sku}: «${elegida.candidato.title}» → ${detallePortada}${detalleAlternativas}`);
  }
} finally {
  await fsp.rm(temporal, { force: true, recursive: true });
}

const conSello = mediciones.filter((fila) => fila.selloDetectado);
const pisan = conSello.filter((fila) => fila.pisaElEnvase);
/* Cada archivo descargado cuenta por separado: la portada y cada alternativa. */
const todasLasImagenes = mediciones.flatMap((fila) => [fila, ...fila.alternativas]);
const imagenesConSello = todasLasImagenes.filter((fila) => fila.selloDetectado);
const imagenesQuePisan = imagenesConSello.filter((fila) => fila.pisaElEnvase);
const todasDescartadas = imagenesQuePisan.length === todasLasImagenes.length && todasLasImagenes.length > 0;

await fsp.writeFile(SALIDA, stableJson({
  conclusion: todasDescartadas
    ? 'Todos los packshots oficiales que corresponderían a una unidad suelta —cada imagen que '
      + 'publica cada candidato, portada y alternativas— traen un sello de cantidad que PISA el '
      + 'envase. No se pueden reutilizar para unidades, y no se pueden limpiar sin repintar '
      + 'producto. Las unidades siguen con el recurso propio de TABA.'
    : 'Hay al menos una imagen oficial que el sello no descarta: requiere decisión humana.',
  doc: 'Medición del sello de cantidad en los packshots de la fuente oficial. Generado por '
    + 'scripts/catalog-images/relevar-sello-de-pack.mjs; es evidencia, no una aprobación. Mide '
    + 'TODAS las imágenes de cada candidato, porque una sola alternativa limpia bastaría para '
    + 'invalidar la conclusión.',
  medidoEl: new Date().toISOString().slice(0, 10),
  mediciones,
  resumen: {
    conSelloDetectado: conSello.length,
    elSelloPisaElEnvase: pisan.length,
    imagenesConSelloQuePisa: imagenesQuePisan.length,
    imagenesMedidas: todasLasImagenes.length,
    medidos: mediciones.length,
    sinCandidatoOficial: sinCandidato.length,
  },
  schemaVersion: 2,
  sinCandidatoOficial: sinCandidato.sort(),
}), 'utf8');

console.log('');
console.log(`Medidos: ${mediciones.length} SKU · ${todasLasImagenes.length} imágenes · con sello que pisa el envase: ${imagenesQuePisan.length}`);
console.log(`Sin candidato oficial (ninguna fuente permitida publica ese producto): ${sinCandidato.length}`);
console.log(`Evidencia: ${path.relative(ROOT, SALIDA).replaceAll('\\', '/')}`);
