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
 * 3. Descarga ese candidato y mide el sello con `medir-sello-de-pack.mjs`.
 * 4. Escribe la evidencia: SHA-256, geometría del sello y cuánto envase tapa.
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

    const respuesta = await fetch(elegida.candidato.imageUrl, {
      headers: { 'user-agent': USER_AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    });
    if (!respuesta.ok) {
      sinCandidato.push(`${sku.sku} (la fuente respondió ${respuesta.status})`);
      continue;
    }
    const destino = path.join(temporal, `${sku.sku}.bin`);
    await fsp.writeFile(destino, Buffer.from(await respuesta.arrayBuffer()));
    const medicion = await medirSello(destino);
    delete medicion.archivo;

    mediciones.push({
      ...medicion,
      cantidadDelSku: sku.unitsPerPack,
      cantidadQueAnunciaLaFuente: elegida.packCountFuente,
      confianzaDelMatch: elegida.confianza,
      dudasDelMatch: elegida.reasons,
      fuenteTitulo: elegida.candidato.title,
      fuenteUrl: elegida.candidato.imageUrl,
      productoUrl: elegida.candidato.productUrl,
      sku: sku.sku,
      veredictoParaEsteSku: !medicion.selloDetectado
        ? 'SIN_SELLO_DETECTADO: mirar a mano antes de concluir nada'
        : medicion.pisaElEnvase
          ? 'FALLBACK: el sello anuncia otra cantidad y no se puede borrar sin repintar envase'
          : 'REVISAR_A_MANO: el sello no toca el envase; una persona tiene que decidir',
    });
    console.log(
      `${sku.sku}: «${elegida.candidato.title}» → `
      + (medicion.selloDetectado
        ? `sello x${elegida.packCountFuente} de ${medicion.sello.diametroPx}px, tapa ${medicion.solapamiento.productoTapado}px de envase`
        : 'sin sello detectado'),
    );
  }
} finally {
  await fsp.rm(temporal, { force: true, recursive: true });
}

const conSello = mediciones.filter((fila) => fila.selloDetectado);
const pisan = conSello.filter((fila) => fila.pisaElEnvase);

await fsp.writeFile(SALIDA, stableJson({
  conclusion: pisan.length === conSello.length && conSello.length > 0
    ? 'Todos los packshots oficiales que corresponderían a una unidad suelta traen un sello de '
      + 'cantidad que PISA el envase. No se pueden reutilizar para unidades, y no se pueden limpiar '
      + 'sin repintar producto. Las unidades siguen con el recurso propio de TABA.'
    : 'Hay al menos un packshot cuyo sello no toca el envase: requiere decisión humana.',
  doc: 'Medición del sello de cantidad en los packshots de la fuente oficial. Generado por '
    + 'scripts/catalog-images/relevar-sello-de-pack.mjs; es evidencia, no una aprobación.',
  medidoEl: new Date().toISOString().slice(0, 10),
  mediciones,
  resumen: {
    conSelloDetectado: conSello.length,
    elSelloPisaElEnvase: pisan.length,
    medidos: mediciones.length,
    sinCandidatoOficial: sinCandidato.length,
  },
  schemaVersion: 1,
  sinCandidatoOficial: sinCandidato.sort(),
}), 'utf8');

console.log('');
console.log(`Medidos: ${mediciones.length} · con sello: ${conSello.length} · el sello pisa el envase: ${pisan.length}`);
console.log(`Sin candidato oficial (ninguna fuente permitida publica ese producto): ${sinCandidato.length}`);
console.log(`Evidencia: ${path.relative(ROOT, SALIDA).replaceAll('\\', '/')}`);
