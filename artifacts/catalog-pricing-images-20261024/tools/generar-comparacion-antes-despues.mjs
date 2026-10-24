/*
 * Genera la página de comparación antes/después del trabajo de fotos reales.
 *
 *   entrada:  js/vitrina-neuquen-20261024.js + catalog/gondola-neuquen.mjs
 *             + artifacts/.../qa/qa-vitrina-neuquen-20261024.json
 *             + artifacts/.../qa/capturas-neuquen/*.png
 *   salida:   artifacts/catalog-pricing-images-20261024/preview/comparacion/antes-y-despues.html
 *
 * La página se abre como archivo local: TODAS las rutas son relativas al HTML
 * (fotos de la góndola real, capturas de QA, placeholder propio de TABA) y no
 * hay una sola URL externa, coherente con la regla de este artefacto: mostrar
 * sólo lo que el comercio tiene derecho a mostrar.
 *
 * Uso:  node artifacts/catalog-pricing-images-20261024/tools/generar-comparacion-antes-despues.mjs
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { precioDeVenta } from '../../../catalog/gondola-neuquen.mjs';
import { products as vitrina, VITRINA_META } from '../../../js/vitrina-neuquen-20261024.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_ART = path.resolve(AQUI, '..');
const RAIZ_REPO = path.resolve(RAIZ_ART, '..', '..');
const OUT_DIR = path.join(RAIZ_ART, 'preview', 'comparacion');
const OUT_FILE = path.join(OUT_DIR, 'antes-y-despues.html');
mkdirSync(OUT_DIR, { recursive: true });

// Rutas relativas desde el HTML de salida hacia el repositorio.
const RUTA_ASSETS = '../../../../assets/products';
const RUTA_CAPS = '../../qa/capturas-neuquen';
const PLACEHOLDER_RUTA = `${RUTA_ASSETS}/beverage-placeholder.svg`;

const dinero = (valor) => new Intl.NumberFormat('es-AR', {
  style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
}).format(Number(valor || 0));
const basename = (ruta) => String(ruta || '').split('/').pop();

/* Capturas de QA que la página cita; si falta alguna, se informa y se corta. */
const CAPTURAS = [
  'antes-movil-gondola.png',
  'despues-movil-gondola.png',
  'antes-desktop-gondola.png',
  'despues-desktop-gondola.png',
  'despues-movil-busqueda.png',
  'despues-movil-categoria-cervezas.png',
  'despues-movil-ficha.png',
  'despues-movil-carrito.png',
];
const faltantes = CAPTURAS.filter((nombre) => !existsSync(path.join(RAIZ_ART, 'qa', 'capturas-neuquen', nombre)));
if (faltantes.length) {
  console.error(`Faltan capturas de QA (correr antes qa-vitrina-neuquen-20261024.mjs): ${faltantes.join(', ')}`);
  process.exit(1);
}

/* Estado del QA para el sello superior. */
let qaEstado = 'QA: ver qa-vitrina-neuquen-20261024.json';
const qaArchivo = path.join(RAIZ_ART, 'qa', 'qa-vitrina-neuquen-20261024.json');
if (existsSync(qaArchivo)) {
  try {
    const qa = JSON.parse(readFileSync(qaArchivo, 'utf8'));
    const capturas = Array.isArray(qa.capturas) ? qa.capturas.filter((c) => /\.png$/.test(c)) : [];
    qaEstado = capturas.length
      ? `QA ${qa.ok}/${qa.total} afirmaciones OK (capturas de ${new Date(qa.generadoEl).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })})`
      : `QA ${qa.ok}/${qa.total} (estados de datos)`;
  } catch (_) { /* estado por defecto */ }
}

const AUDITADA_TAG = {
  AUDITADA: { texto: 'Auditada', clase: 'coverage audited' },
  MANIFIESTO_PREPARADO: { texto: 'Manifiesto verificado', clase: 'coverage manifest' },
};

const thumbUrl = (p) => `${RUTA_ASSETS}/${basename(p.imageThumbnail)}`;

function presentacionDe(producto) {
  const pack = producto.soldAsPack ? `Pack ×${producto.unitsPerPack}` : producto.unitLabel || 'Unidad';
  return `${pack} · ${producto.capacity}`;
}

function tarjetasConFoto() {
  return vitrina
    .filter((p) => p.imageThumbnail)
    .map((p) => {
      const tag = AUDITADA_TAG[p.vitrinaCobertura] || { texto: p.vitrinaCobertura, clase: 'coverage' };
      return `
      <li class="shot-card">
        <figure><img loading="lazy" src="${thumbUrl(p)}" alt="Foto verificada de ${p.brand} ${p.name}"></figure>
        <div class="shot-copy">
          <span class="${tag.clase}">${tag.texto}</span>
          <strong>${p.brand} · ${p.name}${p.variant && p.variant !== 'Original' ? ` ${p.variant}` : ''}</strong>
          <small>${presentacionDe(p)}</small>
          <b>${dinero(precioDeVenta(p))}</b>
        </div>
      </li>`;
    })
    .join('\n');
}

function tarjetasSinFoto() {
  return vitrina
    .filter((p) => !p.imageThumbnail)
    .map((p) => `
      <li class="shot-card sin-foto">
        <figure><img src="${PLACEHOLDER_RUTA}" alt="Sin foto publicable: ${p.brand} ${p.name}"></figure>
        <div class="shot-copy">
          <span class="coverage pending">Pendiente de su propia foto</span>
          <strong>${p.brand} · ${p.name}${p.variant && p.variant !== 'Original' ? ` ${p.variant}` : ''}</strong>
          <small>${presentacionDe(p)}</small>
          <b>${dinero(precioDeVenta(p))}</b>
          <p class="motivo">Sin fuente auditada para este SKU: no se publica una imagen parecida. Lane: foto propia del comercio o aprobación por activo.</p>
        </div>
      </li>`)
    .join('\n');
}

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vitrina Neuquén 2026-10-24 · antes y después de las fotos reales</title>
<style>
  :root {
    color-scheme: light;
    --tinta: #1a1611;
    --crema: #faf6ee;
    --rojo: #a01220;
    --borde: #ddd3c2;
    --verde: #146c43;
    --ambar: #8a5a00;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--crema); color: var(--tinta); font: 16px/1.5 system-ui, 'Segoe UI', sans-serif; }
  header { background: var(--tinta); color: var(--crema); padding: 28px 5vw 22px; }
  header h1 { margin: 0 0 6px; font-size: clamp(20px, 3.4vw, 30px); letter-spacing: .2px; }
  header p { margin: 0; opacity: .85; max-width: 90ch; }
  .status-pill { display: inline-block; margin-top: 12px; padding: 4px 12px; border-radius: 999px;
    background: #2e9e5b; color: #fff; font-size: 13px; font-weight: 600; }
  main { padding: 26px 5vw 60px; max-width: 1500px; margin: 0 auto; }
  section { margin-bottom: 44px; }
  h2 { font-size: 20px; border-bottom: 3px solid var(--rojo); display: inline-block; padding-bottom: 4px; margin: 0 0 6px; }
  .sub { color: #6b6155; margin: 0 0 16px; max-width: 95ch; }
  .live-box { background: #fff; border: 1px solid var(--borde); border-radius: 12px; padding: 16px 20px; }
  .live-box code { display: block; padding: 6px 10px; margin: 6px 0; background: #f1ece2; border-radius: 8px;
    font-size: 14px; overflow-wrap: anywhere; }
  .duo { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 22px; }
  .panel { background: #fff; border: 1px solid var(--borde); border-radius: 14px; overflow: hidden; }
  .panel .head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--borde); }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .dot.antes { background: var(--ambar); }
  .dot.despues { background: var(--verde); }
  .panel img { display: block; width: 100%; height: auto; }
  .panel p.caption { padding: 10px 16px 14px; margin: 0; font-size: 14px; color: #5d5548; }
  .interacciones { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
  .interacciones figure { margin: 0; background: #fff; border: 1px solid var(--borde); border-radius: 12px; overflow: hidden; }
  .interacciones figcaption { padding: 10px 12px; font-size: 13.5px; color: #5d5548; }
  .interacciones b { display: block; color: var(--tinta); margin-bottom: 3px; font-size: 14.5px; }
  ul.fotos { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
  .shot-card { background: #fff; border: 1px solid var(--borde); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
  .shot-card figure { margin: 0; aspect-ratio: 1/1; background: #ece5d8; }
  .shot-card img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .shot-card.sin-foto { border: 1.5px dashed #c4925a; }
  .shot-card.sin-foto .motivo { font-size: 12px; color: #8a5a00; background: #fdf3df; border-radius: 8px; padding: 8px 10px; margin: 8px 0 0; }
  .shot-copy { padding: 10px 12px 14px; display: flex; flex-direction: column; gap: 4px; }
  .coverage { align-self: flex-start; font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
    padding: 2px 8px; border-radius: 999px; }
  .coverage.audited { background: #e2f1e6; color: var(--verde); }
  .coverage.manifest { background: #e3edf9; color: #1d4ed8; }
  .coverage.pending { background: #fdf3df; color: var(--ambar); }
  .shot-copy strong { font-size: 14.5px; line-height: 1.3; }
  .shot-copy small { color: #6b6155; }
  .shot-copy b { color: var(--rojo); }
  footer { border-top: 1px solid var(--borde); padding: 20px 5vw 40px; color: #5d5548; font-size: 14px; }
  footer code { background: #f1ece2; padding: 2px 6px; border-radius: 6px; overflow-wrap: anywhere; }
  @media (max-width: 700px) { header, main, footer { padding-left: 6vw; padding-right: 6vw; } }
</style>
</head>
<body>
<header>
  <h1>Vitrina Neuquén · antes y después de las fotos reales</h1>
  <p>Góndola autoridad ${VITRINA_META.skus} SKU · fotos verificadas en ${VITRINA_META.conFoto} productos (${VITRINA_META.conFotoAuditada} del mapa auditado + 13 con manifiesto y sha256 verificado) · fallas honestas en ${VITRINA_META.sinFoto.length}. Derechos: ${VITRINA_META.derechos}.</p>
  <p>Los precios de TODA esta página son los <b>vigentes</b> del criterio publicado —la propuesta comercial sigue pendiente de aprobación y no entró a la vitrina.</p>
  <span class="status-pill">${qaEstado}</span>
</header>
<main>

  <section>
    <h2>Cómo verlo vivo (local, sin publicar nada)</h2>
    <p class="sub">El storefront demo arranca con la vitrina Neuquén y sus fotos; el modo "antes" es la MISMA sesión forzando el placeholder en toda la góndola. Todo corre en <code>localhost</code>: esta comparación no publica nada ni toca producción.</p>
    <div class="live-box">
      <strong>Después — la vitrina con fotos reales por SKU</strong>
      <code>http://localhost:8231/?reset=1&demo=1&vitrina=neuquen20261024</code>
      <strong>Antes — la misma góndola sin fotos (comparación honesta)</strong>
      <code>http://localhost:8231/?reset=1&demo=1&vitrina=neuquen20261024&fotos=antes</code>
      <strong>Catálogo demo de siempre, sin cambios</strong>
      <code>http://localhost:8231/?reset=1&demo=1</code>
    </div>
  </section>

  <section>
    <h2>La góndola completa, móvil (390×844)</h2>
    <p class="sub">Mismo scroll inicial en las dos capturas: a la izquierda cómo se veía sin el trabajo de fotos (placeholder genérico en cada SKU); a la derecha, la foto correcta de cada producto con su marca, envase y presentación.</p>
    <div class="duo">
      <div class="panel">
        <div class="head"><span class="dot antes"></span><strong>ANTES · placeholder en toda la góndola</strong></div>
        <img src="${RUTA_CAPS}/antes-movil-gondola.png" alt="Góndola móvil en modo antes: todos los SKU con placeholder">
        <p class="caption">?demo=1&vitrina=neuquen20261024<b>&fotos=antes</b> — los 10 SKUs sin fuente auditada venían así también.</p>
      </div>
      <div class="panel">
        <div class="head"><span class="dot despues"></span><strong>DESPUÉS · foto real verificada por SKU</strong></div>
        <img src="${RUTA_CAPS}/despues-movil-gondola.png" alt="Góndola móvil con las fotos reales por SKU">
        <p class="caption">42 tarjetas con la miniatura declarada para ese SKU; 10 honestas con placeholder y su precio vigente.</p>
      </div>
    </div>
  </section>

  <section>
    <h2>Interacciones verificadas por QA automatizado</h2>
    <p class="sub">La vitrina no es una imagen: el QA (Playwright) buscó, filtró por categoría, abrió fichas, sumó al carrito y comprobó precios y etiqueta +18 sin pageerrors ni respuestas fallidas.</p>
    <div class="interacciones">
      <figure><img src="${RUTA_CAPS}/despues-movil-busqueda.png" alt="Búsqueda en la góndola"><figcaption><b>Búsqueda</b>«coca» deja sólo los SKUs de la familia, con foto y precio.</figcaption></figure>
      <figure><img src="${RUTA_CAPS}/despues-movil-categoria-cervezas.png" alt="Categoría Cervezas"><figcaption><b>Categorías</b>el chip Cervezas muestra exactamente su rubro; «Todas» vuelve.</figcaption></figure>
      <figure><img src="${RUTA_CAPS}/despues-movil-ficha.png" alt="Ficha de producto con foto real"><figcaption><b>Ficha +18</b>foto de Gancia Lima Limón, precio vigente y aviso de venta a mayores de 18.</figcaption></figure>
      <figure><img src="${RUTA_CAPS}/despues-movil-carrito.png" alt="Carrito con un ítem"><figcaption><b>Carrito</b>alta de Coca-Cola 2,25 L: 1 línea, subtotal igual al vigente.</figcaption></figure>
    </div>
  </section>

  <section>
    <h2>La misma comparación, escritorio (1280px, góndola completa)</h2>
    <p class="sub">Capturas de página completa: en "antes" absolutamente todo es placeholder; en "después" cada SKU muestra su foto verificada. Sin overflow horizontal en ninguno de los dos.</p>
    <div class="duo">
      <div class="panel">
        <div class="head"><span class="dot antes"></span><strong>ANTES · escritorio</strong></div>
        <img src="${RUTA_CAPS}/antes-desktop-gondola.png" alt="Góndola de escritorio completa en modo antes">
      </div>
      <div class="panel">
        <div class="head"><span class="dot despues"></span><strong>DESPUÉS · escritorio</strong></div>
        <img src="${RUTA_CAPS}/despues-desktop-gondola.png" alt="Góndola de escritorio completa con fotos reales">
      </div>
    </div>
  </section>

  <section>
    <h2>Las 42 fotos publicadas — cada una con derecho comercial verificado</h2>
    <p class="sub">29 del mapa auditado <code>gondola-publica-imagenes.json</code> y 13 con cadena sha256 completa en <code>image-manifest.json</code>. Marca, envase, capacidad y variante comprobados por SKU.</p>
    <ul class="fotos">
      ${tarjetasConFoto()}
    </ul>
  </section>

  <section>
    <h2>L Wireframe las 10 sin foto — el lane es honesto, no un error</h2>
    <p class="sub">No hay imagen auditada ni con manifiesto para estos SKUs, y NO se publican parecidos. Mientras tanto se muestran con el placeholder propio de TABA y su precio vigente, como cualquier producto recién cargado.</p>
    <ul class="fotos">
      ${tarjetasSinFoto()}
    </ul>
  </section>

</main>
<footer>
  <p>Artefacto local generado por <code>artifacts/catalog-pricing-images-20261024/tools/generar-comparacion-antes-despues.mjs</code> con datos de <code>js/vitrina-neuquen-20261024.js</code> y la autoridad de precios <code>catalog/gondola-neuquen.mjs</code>. Evidencia: <code>artifacts/…/vitrina-imagenes-verificadas.json</code>, <code>docs/catalog/image-manifest.json</code>, <code>docs/catalog/gondola-publica-imagenes.json</code>.</p>
  <p>La propuesta de precios (32 vigentes a mantener, 14 con conflicto de margen, 5+1 pendientes) vive en <code>artifacts/…/propuesta-precios.{csv,json}</code> y <code>qa/ficha/ficha-propuesta.html</code> esperando la decisión de Walter; en la vitrina no se tocó un precio.</p>
</footer>
</body>
</html>
`;

writeFileSync(OUT_FILE, html, 'utf8');
console.log(`Comparación generada: ${path.relative(process.cwd(), OUT_FILE)} (${(html.length / 1024).toFixed(0)} KB)`);
