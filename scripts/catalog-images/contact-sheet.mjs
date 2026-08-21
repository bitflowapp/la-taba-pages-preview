/*
 * La hoja de contactos: los SKU del catálogo juntos, para mirarlos de una.
 *
 * Existe porque ninguna de las comprobaciones automáticas ve lo que se ve. El
 * matcher compara texto; el guard compara hashes y derechos. Que la botella de
 * la foto sea la del envase, que el recorte no corte la tapa, que dos productos
 * distintos no estén usando la misma imagen: eso se decide mirando, y para
 * mirar hace falta tenerlo todo en una pantalla.
 *
 * Además marca sola lo que puede marcar: faltantes, repetidas, casi repetidas,
 * y las que el descubrimiento dejó anotadas con reparos.
 *
 *   node scripts/catalog-images/contact-sheet.mjs
 *   node scripts/catalog-images/contact-sheet.mjs --propuesta-final
 *
 * El segundo modo suma el payload todavía NO aplicado y produce una lámina
 * comercial rotulada. Una propuesta sólo recibe foto si existe una entrada
 * exacta y aprobada para su externalId + SKU en el manifiesto final; el hecho
 * de que una fuente de precio tenga una foto nunca la vuelve publicable.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { loadCatalogSkus } from './catalog-skus.mjs';
import { findManifestSource, stableJson, validateFinalImageManifest } from './lib.mjs';

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('Falta sharp. Ejecutar npm install.');
  process.exit(2);
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const ARTIFACTS = path.join(ROOT, 'artifacts/taba2-catalog-images');
const MODO_PROPUESTA_FINAL = process.argv.includes('--propuesta-final');
const OUTPUT_DIR = process.env.TABA_CONTACT_SHEET_OUTPUT_DIR
  ? path.resolve(process.env.TABA_CONTACT_SHEET_OUTPUT_DIR)
  : ARTIFACTS;
const SUFIJO = MODO_PROPUESTA_FINAL ? '-propuesta-final' : '';
const MANIFIESTO_FUENTES = path.join(ARTIFACTS, 'SOURCE-MANIFEST.json');
const MANIFIESTO_IMAGENES = path.join(ROOT, 'docs/catalog/image-manifest.json');
const HTML = path.join(OUTPUT_DIR, `contact-sheet${SUFIJO}.html`);
const WEBP = path.join(OUTPUT_DIR, `contact-sheet${SUFIJO}.webp`);
const DUPLICADOS = path.join(OUTPUT_DIR, `DUPLICATE-ASSETS${MODO_PROPUESTA_FINAL ? '-PROPUESTA-FINAL' : ''}.md`);
const HUELLAS = path.join(OUTPUT_DIR, `perceptual-hashes${SUFIJO}.json`);
const EXPLICADOS = path.join(ROOT, 'catalog/duplicados-explicados.json');

const GRUPOS_PROPUESTA = Object.freeze([
  { id: 'gaseosas', titulo: 'GASEOSAS' },
  { id: 'cervezas', titulo: 'CERVEZAS' },
  { id: 'energeticas', titulo: 'ENERGÉTICAS' },
  { id: 'aguas', titulo: 'AGUAS' },
  { id: 'otros', titulo: 'OTROS' },
]);

function textoComparable(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function grupoComercial(categoria) {
  const normalizada = textoComparable(categoria);
  if (normalizada === 'gaseosas') return 'gaseosas';
  if (normalizada === 'cervezas') return 'cervezas';
  if (normalizada.includes('energ')) return 'energeticas';
  if (normalizada.startsWith('agua')) return 'aguas';
  return 'otros';
}

function capacidadLegible(valor, unidad) {
  const cantidad = Number(valor);
  const unidadNormalizada = String(unidad || '').toLowerCase();
  if (Number.isFinite(cantidad) && unidadNormalizada === 'ml' && cantidad >= 1000) {
    return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(cantidad / 1000)} L`;
  }
  return `${Number.isFinite(cantidad) ? new Intl.NumberFormat('es-AR').format(cantidad) : valor} ${unidad}`.trim();
}

function envaseLegible(valor) {
  const normalizado = String(valor || '').replaceAll('-', ' ').trim();
  return normalizado.replace(/\bpet\b/gi, 'PET').replace(/^./, (letra) => letra.toUpperCase());
}

function presentacionDe(producto) {
  const partes = [
    capacidadLegible(producto.capacityValue, producto.capacityUnit),
    envaseLegible(producto.packagingType),
    producto.soldAsPack ? `Pack x${producto.unitsPerPack}` : 'Unidad',
  ];
  return partes.filter(Boolean).join(' · ');
}

function precioLegible(precio) {
  const cantidad = Number(precio);
  if (!Number.isFinite(cantidad)) return 'PRECIO PENDIENTE';
  return `$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(cantidad)}`;
}

/**
 * Firma de color: la imagen reducida a 8x8 en RGB, 192 números.
 *
 * POR QUÉ NO UN dHash EN GRIS
 * ---------------------------
 * Se probó primero y da resultados falsos con este material. Un packshot es una
 * botella centrada sobre blanco: en escala de grises, la Coca-Cola Original y la
 * Coca-Cola Zero son la MISMA silueta con el mismo líquido oscuro, y el dHash de
 * las dos salía idéntico —distancia 0 sobre 64— aunque son fotos distintas, con
 * tapa roja una y negra la otra. Lo que separa a estos productos es el color y
 * la etiqueta, no el borde de luminancia. Un detector que grita «idéntica» sobre
 * dos imágenes correctas no es conservador: entrena a la persona que revisa a
 * ignorarlo, y el día que haya un duplicado de verdad va a pasar de largo.
 */
async function firmaDeColor(file) {
  const { data } = await sharp(file)
    .flatten({ background: '#ffffff' })
    .resize(8, 8, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [...data];
}

/** Diferencia media por canal, de 0 (misma imagen) a 255. */
function distancia(a, b) {
  const total = a.reduce((suma, valor, i) => suma + Math.abs(valor - b[i]), 0);
  return Math.round((total / a.length) * 10) / 10;
}

const fuentes = JSON.parse(await fs.readFile(MANIFIESTO_FUENTES, 'utf8'));
const imagenes = JSON.parse(await fs.readFile(MANIFIESTO_IMAGENES, 'utf8'));
const { skus } = await loadCatalogSkus(ROOT);

const porSkuFuente = new Map(fuentes.decisiones.map((d) => [d.sku, d]));
const porSkuImagen = new Map(imagenes.sources.map((s) => [s.sku, s]));

const celdas = [];
for (const sku of skus) {
  const decision = porSkuFuente.get(sku.sku);
  const imagen = porSkuImagen.get(sku.sku);
  const master = imagen?.assets?.master?.path || null;
  const thumb = imagen?.assets?.thumbnail?.path || null;
  celdas.push({
    alcoholic: sku.alcoholic,
    capacidad: `${sku.capacityValue} ${sku.capacityUnit}`,
    categoria: sku.category,
    confianza: decision?.estado || 'SIN_DATO',
    derechos: imagen?.rightsStatus || null,
    disponible: sku.available === true,
    envase: sku.packagingType,
    fuente: decision?.elegido?.title || null,
    huella: master ? await firmaDeColor(path.join(ROOT, master)) : null,
    master,
    nombre: sku.name,
    packCount: sku.unitsPerPack,
    precio: precioLegible(sku.price),
    presentacion: presentacionDe(sku),
    reparos: decision?.candidatos?.[0]?.reasons || [],
    sku: sku.sku,
    soldAsPack: sku.soldAsPack,
    thumb,
    variante: sku.variant,
  });
}

// Repetidas y casi repetidas. Un duplicado legítimo existe —dos presentaciones
// con el mismo packaging— pero tiene que quedar explicado, no descubierto tarde.
const conImagen = celdas.filter((celda) => celda.huella);
// Umbral en unidades de diferencia media de color, sobre 255. Medido contra los
// cuatro packshots actuales: el par más parecido que NO es un duplicado queda en
// 7,2 (Coca-Cola contra Fanta) y el único que cae debajo es Coca-Cola Original
// contra Zero, en 0,6 — dos fotos distintas que ninguna firma separa, y que por
// eso están explicadas a mano en catalog/duplicados-explicados.json.
const UMBRAL = 6;
const parejas = [];
for (let i = 0; i < conImagen.length; i += 1) {
  for (let j = i + 1; j < conImagen.length; j += 1) {
    const d = distancia(conImagen[i].huella, conImagen[j].huella);
    const mismoArchivo = porSkuImagen.get(conImagen[i].sku)?.assets?.master?.sha256
      === porSkuImagen.get(conImagen[j].sku)?.assets?.master?.sha256;
    if (mismoArchivo || d <= UMBRAL) {
      parejas.push({
        distancia: d,
        exacta: mismoArchivo,
        skuA: conImagen[i].sku,
        skuB: conImagen[j].sku,
      });
    }
  }
}
parejas.sort((a, b) => a.distancia - b.distancia);

/*
 * Un parecido explicado es una decisión; un parecido sin explicar es un hallazgo
 * abierto. Que dos SKU compartan aire no se bloquea —dos presentaciones pueden
 * tener el mismo packaging—, pero tiene que estar escrito por alguien, con la
 * medición al lado. Si no, la hoja falla.
 */
const explicados = JSON.parse(await fs.readFile(EXPLICADOS, 'utf8'));
const claveDePar = (a, b) => [a, b].sort().join(' || ');
const explicadosPorClave = new Map(explicados.pares.map((par) => [claveDePar(par.skuA, par.skuB), par]));
const sinExplicar = parejas.filter((par) => !explicadosPorClave.has(claveDePar(par.skuA, par.skuB)));

for (const celda of celdas) {
  celda.alertas = [];
  if (!celda.master) celda.alertas.push('sin imagen · usa el recurso propio de TABA');
  if (celda.soldAsPack && celda.master && celda.packCount <= 1) celda.alertas.push('marcado como pack sin cantidad');
  const gemela = parejas.find((p) => p.skuA === celda.sku || p.skuB === celda.sku);
  if (gemela) {
    const otro = gemela.skuA === celda.sku ? gemela.skuB : gemela.skuA;
    celda.alertas.push(`imagen ${gemela.exacta ? 'IDÉNTICA' : `muy parecida (${gemela.distancia}/255)`} a ${otro}`);
  }
  if (celda.confianza === 'MANUAL_REVIEW') celda.alertas.push('candidato con reparos, sin asociar');
}

const escapar = (valor) => String(valor ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

const filas = celdas.map((celda) => `
    <figure class="celda ${celda.master ? 'con-foto' : 'sin-foto'}">
      <div class="marco">${celda.thumb
    ? `<img src="../../${escapar(celda.thumb)}" alt="" width="180" height="180" loading="lazy">`
    : '<span class="vacio">sin imagen</span>'}</div>
      <figcaption>
        <strong>${escapar(celda.nombre)}</strong>
        <code>${escapar(celda.sku)}</code>
        <span class="categoria">${escapar(celda.categoria)}</span>
        <span>${escapar(celda.presentacion)}</span>
        <span class="precio">${escapar(celda.precio)}</span>
        <span class="disponible disponible-${celda.disponible ? 'si' : 'no'}">${celda.disponible ? 'Disponible' : 'No disponible'}</span>
        <span class="estado estado-${escapar(celda.confianza)}">${escapar(celda.confianza)}</span>
        ${celda.derechos ? `<span class="derechos">${escapar(celda.derechos)}</span>` : ''}
        ${celda.fuente ? `<span class="fuente">${escapar(celda.fuente)}</span>` : ''}
        ${celda.alcoholic ? '<span class="alcohol">alcohol · compuerta de licencia</span>' : ''}
        ${celda.alertas.map((a) => `<span class="alerta">${escapar(a)}</span>`).join('')}
      </figcaption>
    </figure>`).join('');

const resumen = {};
for (const celda of celdas) resumen[celda.confianza] = (resumen[celda.confianza] || 0) + 1;

/*
 * Modo propuesta: suma el payload de altas todavía NO aplicado y lo rotula
 * sin ambigüedad. Una propuesta sólo recibe foto si `findManifestSource`
 * encuentra una entrada YA aprobada para su externalId + SKU exactos en el
 * manifiesto final; ninguna de las 12 altas la tiene todavía, así que todas
 * muestran el fallback propio de TABA, tal como exige el payload.
 */
let seccionPropuestaFinal = '';
let propuestaResumen = null;
if (MODO_PROPUESTA_FINAL) {
  const { errors: erroresManifiesto } = validateFinalImageManifest(imagenes, { allowEmpty: true });
  if (erroresManifiesto.length) {
    console.error('El manifiesto final de imágenes no es válido; la propuesta no puede confiar en él para decidir foto vs. fallback:');
    for (const error of erroresManifiesto) console.error(`  - ${error}`);
    process.exitCode = 1;
  }

  const { CATALOGO_ACTUAL, PRODUCTOS_PROPUESTOS, TOTAL_ESTIMADO } = await import(
    new URL(`file://${path.join(ROOT, 'catalog/gondola-retail-final-proposal.mjs').replaceAll('\\', '/')}`).href
  );

  const agrupar = (lista, categoriaDe) => {
    const porGrupo = new Map(GRUPOS_PROPUESTA.map((g) => [g.id, []]));
    for (const item of lista) porGrupo.get(grupoComercial(categoriaDe(item))).push(item);
    return porGrupo;
  };

  const propuestos = PRODUCTOS_PROPUESTOS.map((producto) => {
    const fuenteAprobada = findManifestSource(imagenes, producto.externalId, producto.sku);
    return {
      categoria: producto.category,
      disponible: producto.available === true,
      master: fuenteAprobada?.assets?.master?.path || null,
      nombre: producto.name,
      precio: precioLegible(producto.price),
      presentacion: presentacionDe(producto),
      sku: producto.sku,
      thumb: fuenteAprobada?.assets?.thumbnail?.path || null,
    };
  });

  const actualesPorGrupo = agrupar(celdas, (celda) => celda.categoria);
  const propuestosPorGrupo = agrupar(propuestos, (item) => item.categoria);

  const tarjetaActual = (celda) => `
    <figure class="celda mini ${celda.master ? 'con-foto' : 'sin-foto'}">
      <div class="marco">${celda.thumb
    ? `<img src="../../${escapar(celda.thumb)}" alt="" width="140" height="140" loading="lazy">`
    : '<span class="vacio">sin imagen</span>'}</div>
      <figcaption>
        <strong>${escapar(celda.nombre)}</strong>
        <code>${escapar(celda.sku)}</code>
        <span>${escapar(celda.presentacion)}</span>
        <span class="precio">${escapar(celda.precio)}</span>
        <span class="disponible disponible-${celda.disponible ? 'si' : 'no'}">${celda.disponible ? 'Disponible' : 'No disponible'}</span>
      </figcaption>
    </figure>`;

  const tarjetaPropuesta = (item) => `
    <figure class="celda mini propuesta ${item.master ? 'con-foto' : 'sin-foto'}">
      <div class="marco">${item.thumb
    ? `<img src="../../${escapar(item.thumb)}" alt="" width="140" height="140" loading="lazy">`
    : '<span class="vacio">FALLBACK TABA</span>'}</div>
      <figcaption>
        <span class="etiqueta-propuesta">ALTA PROPUESTA</span>
        <strong>${escapar(item.nombre)}</strong>
        <code>${escapar(item.sku)}</code>
        <span>${escapar(item.presentacion)}</span>
        <span class="precio">${escapar(item.precio)}</span>
        <span class="disponible disponible-no">No disponible · stock 0</span>
      </figcaption>
    </figure>`;

  const seccionGrupos = (porGrupo, tarjeta) => GRUPOS_PROPUESTA
    .filter((grupo) => porGrupo.get(grupo.id).length)
    .map((grupo) => `
    <h3>${escapar(grupo.titulo)} <span class="conteo">(${porGrupo.get(grupo.id).length})</span></h3>
    <div class="grilla grilla-compacta">${porGrupo.get(grupo.id).map(tarjeta).join('')}
    </div>`).join('');

  seccionPropuestaFinal = `
<section class="banner-propuesta">
  <p class="rotulo-propuesta">PROPUESTA — NO APLICADA</p>
  <p>Catálogo actual: ${CATALOGO_ACTUAL} SKU · altas propuestas: ${PRODUCTOS_PROPUESTOS.length} ·
  total estimado si se aplica: ${TOTAL_ESTIMADO} SKU. Ningún producto de esta sección fue insertado,
  publicado ni modificado en producción.</p>
</section>
<section>
  <h2>ACTUALES POR GRUPO COMERCIAL (${celdas.length})</h2>
  ${seccionGrupos(actualesPorGrupo, tarjetaActual)}
</section>
<section>
  <h2>PROPUESTOS — NO APLICADO (${propuestos.length})</h2>
  ${seccionGrupos(propuestosPorGrupo, tarjetaPropuesta)}
</section>`;

  propuestaResumen = {
    actual: CATALOGO_ACTUAL,
    conFotoAprobada: propuestos.filter((item) => item.master).length,
    propuestas: PRODUCTOS_PROPUESTOS.length,
    total: TOTAL_ESTIMADO,
  };
}

const tituloPagina = MODO_PROPUESTA_FINAL
  ? 'TABA · góndola comercial final — PROPUESTA NO APLICADA'
  : 'TABA · hoja de contactos del catálogo';

const html = `<!doctype html>
<html lang="es">
<meta charset="utf-8">
<title>${escapar(tituloPagina)}</title>
<style>
  :root { color-scheme: light dark; --linea: #d8d3cc; --fondo: #faf8f5; --tinta: #1c1a18; }
  @media (prefers-color-scheme: dark) { :root { --linea: #3a3632; --fondo: #16140f; --tinta: #f2ede4; } }
  body { margin: 0; padding: 24px; background: var(--fondo); color: var(--tinta);
         font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 26px 0 4px; }
  h3 { font-size: 13px; margin: 16px 0 8px; opacity: .85; }
  .conteo { opacity: .6; font-weight: 400; }
  .resumen { margin: 0 0 20px; opacity: .8; }
  .grilla { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 16px; }
  .grilla-compacta { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); margin: 0 0 6px; }
  .celda { margin: 0; border: 1px solid var(--linea); border-radius: 10px; padding: 10px; background: #fff; }
  @media (prefers-color-scheme: dark) { .celda { background: #201d18; } }
  .celda.mini .marco { height: 140px; }
  .celda.propuesta { border-style: dashed; border-color: #a4351f; }
  .marco { display: grid; place-items: center; height: 180px; background: #fff; border-radius: 6px; }
  .marco img { max-width: 100%; height: auto; }
  .vacio { color: #9a938a; font-size: 12px; }
  figcaption { display: grid; gap: 3px; margin-top: 8px; font-size: 12px; }
  code { font-size: 11px; opacity: .75; word-break: break-all; }
  .categoria { opacity: .65; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  .precio { font-weight: 600; }
  .disponible { font-size: 11px; }
  .disponible-si { color: #1f7a3d; }
  .disponible-no { color: #a4351f; }
  .estado { justify-self: start; padding: 1px 7px; border-radius: 999px; font-size: 11px; background: #eceae6; }
  .estado-HIGH { background: #1f7a3d; color: #fff; }
  .estado-MANUAL_REVIEW { background: #b8860b; color: #fff; }
  .derechos { color: #1f7a3d; font-size: 11px; }
  .fuente, .alcohol { opacity: .7; font-size: 11px; }
  .alerta { color: #a4351f; font-size: 11px; }
  .etiqueta-propuesta { justify-self: start; padding: 1px 7px; border-radius: 999px; font-size: 10px;
                         font-weight: 700; letter-spacing: .03em; background: #a4351f; color: #fff; }
  .banner-propuesta { border: 2px solid #a4351f; border-radius: 10px; padding: 14px 18px; margin: 0 0 24px;
                       background: #fdeceA; }
  @media (prefers-color-scheme: dark) { .banner-propuesta { background: #2a1712; } }
  .rotulo-propuesta { margin: 0 0 6px; font-size: 18px; font-weight: 700; letter-spacing: .04em; color: #a4351f; }
</style>
<h1>${escapar(tituloPagina)}</h1>
<p class="resumen">${celdas.length} SKU · ${celdas.filter((c) => c.master).length} con fotografía propia del catálogo ·
${Object.entries(resumen).map(([k, v]) => `${v} ${k}`).join(' · ')}</p>
${seccionPropuestaFinal}
<div class="grilla">${filas}
</div>
</html>
`;
await fs.writeFile(HTML, html, 'utf8');

// Versión imagen, para adjuntar en un informe sin depender de un navegador.
const COLUMNAS = 8;
const LADO = 180;
const filasGrilla = Math.ceil(celdas.length / COLUMNAS);
const capas = [];
for (const [indice, celda] of celdas.entries()) {
  const origen = celda.thumb ? path.join(ROOT, celda.thumb) : path.join(ROOT, 'assets/products/beverage-placeholder.svg');
  const buffer = await sharp(origen, { density: 200 })
    .resize(LADO, LADO, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .toBuffer();
  capas.push({
    input: buffer,
    left: (indice % COLUMNAS) * LADO,
    top: Math.floor(indice / COLUMNAS) * LADO,
  });
}
await sharp({
  create: {
    background: '#ffffff',
    channels: 3,
    height: filasGrilla * LADO,
    width: COLUMNAS * LADO,
  },
}).composite(capas).webp({ quality: 82 }).toFile(WEBP);

await fs.writeFile(HUELLAS, stableJson({
  doc: 'Firma de color 8x8 RGB por SKU con fotografía. Detecta la misma imagen reutilizada entre productos distintos. En gris no sirve: los packshots sobre blanco se confunden entre sí.',
  huellas: celdas.filter((c) => c.huella).map((c) => ({ huella: c.huella, master: c.master, sku: c.sku })),
  schemaVersion: 1,
}), 'utf8');

const explicacionDe = (par) => explicadosPorClave.get(claveDePar(par.skuA, par.skuB))?.explicacion;
const listaDuplicados = parejas.length
  ? parejas.map((p) => `- \`${p.skuA}\` y \`${p.skuB}\` — ${p.exacta ? '**imagen idéntica**' : `casi idéntica, diferencia media de color ${p.distancia}/255`}`).join('\n')
  : '_Ninguna. Ningún par de SKU comparte imagen ni se le parece por debajo del umbral._';

await fs.writeFile(DUPLICADOS, `# Imágenes repetidas entre SKU

Comparación por firma de color 8x8 RGB sobre el master de cada SKU con fotografía.
Idéntica = mismo SHA-256 del master. Parecida = diferencia media de color ≤ ${UMBRAL} sobre 255.

SKU con fotografía comparados: ${conImagen.length} de ${celdas.length}.

${listaDuplicados}

## Por qué se mira esto

Dos SKU con la misma imagen no siempre es un error —dos presentaciones pueden
compartir packaging—, pero nunca es una casualidad que se pueda dejar sin
explicar: es también la forma exacta que toma un binding mal hecho, donde una
foto se asocia al producto equivocado y nadie lo nota porque la foto, en sí,
está bien.
`, 'utf8');

console.log(`Hoja de contactos: ${path.relative(ROOT, HTML).replaceAll('\\', '/')}`);
console.log(`Imagen: ${path.relative(ROOT, WEBP).replaceAll('\\', '/')} (${COLUMNAS * LADO}x${filasGrilla * LADO})`);
console.log(`SKU con fotografía: ${conImagen.length} de ${celdas.length}`);
console.log(`Pares parecidos: ${parejas.length} (${parejas.length - sinExplicar.length} explicados)`);
if (propuestaResumen) {
  console.log(`PROPUESTA — NO APLICADA: ${propuestaResumen.actual} actuales + ${propuestaResumen.propuestas} `
    + `propuestos = ${propuestaResumen.total} estimado.`);
  console.log(`Altas propuestas con foto oficial ya aprobada: ${propuestaResumen.conFotoAprobada} de ${propuestaResumen.propuestas} `
    + '(se espera 0 hasta aprobar packshots).');
}
for (const par of sinExplicar) {
  console.error(`SIN EXPLICAR ${par.skuA} y ${par.skuB} — ${par.exacta ? 'misma imagen' : `diferencia ${par.distancia}/255`}`);
}
if (sinExplicar.length) {
  console.error('Agregar cada par a catalog/duplicados-explicados.json, con el motivo, o corregir la asociación.');
  process.exitCode = 1;
}
