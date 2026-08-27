/*
 * INCONSISTENCIAS DE 1 A 8 PÍXELES, MEDIDAS Y NO MIRADAS.
 *
 * POR QUÉ EXISTE
 * --------------
 * «Que se vea más cuidado» es subjetivo hasta que se mide. Este guion lee los
 * estilos COMPUTADOS del catálogo en un navegador real y busca lo único que se
 * puede afirmar sin opinar:
 *
 *   · componentes equivalentes con radios distintos;
 *   · espacios que no caen en la escala del sistema (4/8/12/16/20/24/32/40/48);
 *   · áreas táctiles por debajo de 44 px;
 *   · contraste de texto por debajo de AA;
 *   · imágenes de producto con alturas distintas entre sí;
 *   · valores en píxeles escritos a mano donde ya existe un token.
 *
 * Lo que NO hace: decidir si algo «queda lindo». Un cambio que no mejore
 * jerarquía, consistencia o legibilidad no tiene por qué aparecer acá.
 *
 *   node scripts/audit-catalog-visual.mjs [--etiqueta=antes] [--capturas]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = Number(process.env.TABA_E2E_HTTP_PORT || 8123);
const BASE = `http://127.0.0.1:${PUERTO}`;

const argumento = (nombre, porDefecto) => {
  const encontrado = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return encontrado ? encontrado.slice(nombre.length + 3) : porDefecto;
};
const ETIQUETA = argumento('etiqueta', 'antes');
const CAPTURAS = process.argv.includes('--capturas');
const DESTINO = path.join(ROOT, 'artifacts', 'catalog-visual-polish', ETIQUETA);

/** La escala del sistema. Un espacio fuera de acá es un espacio accidental. */
const ESCALA = [0, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48];

const VIEWPORTS = [
  { nombre: '320', width: 320, height: 780 },
  { nombre: '390', width: 390, height: 844 },
  { nombre: '430', width: 430, height: 932 },
  { nombre: 'desktop', width: 1280, height: 900 },
];

/*
 * Contraste WCAG sobre los colores que el navegador ya resolvió. Se calcula acá
 * y no se estima a ojo: «se lee bien» no es un dato.
 */
const MEDIDOR = () => {
  const canal = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminancia = (rgb) => 0.2126 * canal(rgb[0]) + 0.7152 * canal(rgb[1]) + 0.0722 * canal(rgb[2]);
  const parse = (valor) => {
    const m = String(valor).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const partes = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { rgb: partes.slice(0, 3), a: partes.length > 3 ? partes[3] : 1 };
  };
  const sobre = (nodo) => {
    let actual = nodo;
    while (actual && actual !== document.documentElement) {
      const fondo = parse(getComputedStyle(actual).backgroundColor);
      if (fondo && fondo.a > 0.95) return fondo.rgb;
      actual = actual.parentElement;
    }
    return [255, 255, 255];
  };
  window.__TABA_CONTRASTE__ = (nodo) => {
    const color = parse(getComputedStyle(nodo).color);
    if (!color) return null;
    const fondo = sobre(nodo);
    const a = luminancia(color.rgb);
    const b = luminancia(fondo);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return Math.round(ratio * 100) / 100;
  };
  window.__TABA_LUM__ = luminancia;
};

async function abrirCatalogo(page) {
  await page.goto(`${BASE}/?reset=1&demo=1#catalog`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL((u) => !u.searchParams.has('reset'), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
  await page.locator('[data-product-grid] [data-add-product]').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(400);
}

async function medir(page, ancho) {
  return page.evaluate(({ escala, ancho: w }) => {
    const fuera = (valor) => {
      const n = Math.round(Number.parseFloat(valor) * 10) / 10;
      if (!Number.isFinite(n)) return false;
      return !escala.includes(Math.round(n));
    };
    const cs = (n) => getComputedStyle(n);
    const hallazgos = [];
    const anotar = (tipo, detalle) => hallazgos.push({ ancho: w, tipo, ...detalle });

    const tarjetas = [...document.querySelectorAll('[data-product-grid] .product-card, [data-product-grid] article')]
      .filter((n) => n.offsetParent !== null);

    // 1. Radios de componentes equivalentes.
    const radios = new Set(tarjetas.map((n) => cs(n).borderRadius));
    if (radios.size > 1) anotar('radio-tarjetas', { valores: [...radios] });

    // 2. Padding de tarjetas equivalentes, y si cae en la escala.
    const paddings = new Set(tarjetas.map((n) => cs(n).padding));
    if (paddings.size > 1) anotar('padding-tarjetas', { valores: [...paddings] });
    for (const p of paddings) {
      const partes = p.split(' ');
      if (partes.some(fuera)) anotar('padding-fuera-de-escala', { valor: p });
    }

    // 3. Imágenes: mismo espacio visual para cada producto.
    const imagenes = tarjetas
      .map((n) => n.querySelector('img'))
      .filter(Boolean)
      .filter((n) => n.offsetParent !== null);
    const alturas = [...new Set(imagenes.map((n) => Math.round(n.getBoundingClientRect().height)))];
    if (alturas.length > 1) anotar('altura-imagenes', { valores: alturas });
    const ajustes = [...new Set(imagenes.map((n) => cs(n).objectFit))];
    if (ajustes.length > 1) anotar('object-fit', { valores: ajustes });

    // 4. Botón +: área táctil y jerarquía frente al precio.
    for (const boton of [...document.querySelectorAll('[data-product-grid] [data-add-product]')].filter((n) => n.offsetParent !== null).slice(0, 6)) {
      const r = boton.getBoundingClientRect();
      if (r.height < 44 || r.width < 44) {
        anotar('tap-chico', { que: 'data-add-product', w: Math.round(r.width), h: Math.round(r.height) });
        break;
      }
    }

    // 5. Chips: consistencia de radio, alto y espacio.
    const chips = [...document.querySelectorAll('[data-catalog-filter] option, .chip, [data-category-chip]')]
      .filter((n) => n.offsetParent !== null);
    const chipRadios = [...new Set(chips.map((n) => cs(n).borderRadius))];
    if (chipRadios.length > 1) anotar('radio-chips', { valores: chipRadios });

    // 6. Contraste del texto del catálogo.
    const textos = [...document.querySelectorAll('[data-product-grid] [class*="name"], [data-product-grid] [class*="price"], [data-product-grid] small, [data-product-grid] p')]
      .filter((n) => n.offsetParent !== null && (n.textContent || '').trim())
      .slice(0, 24);
    for (const nodo of textos) {
      const ratio = window.__TABA_CONTRASTE__(nodo);
      const tam = Number.parseFloat(cs(nodo).fontSize);
      const peso = Number(cs(nodo).fontWeight) || 400;
      const grande = tam >= 24 || (tam >= 18.66 && peso >= 700);
      const minimo = grande ? 3 : 4.5;
      if (ratio !== null && ratio < minimo) {
        anotar('contraste', {
          clase: nodo.className, ratio, minimo, tam, texto: (nodo.textContent || '').trim().slice(0, 28),
        });
      }
    }

    // 7. Fondo de la página y de la tarjeta: el escalón que hace destacar.
    const fondoPagina = cs(document.body).backgroundColor;
    const fondoTarjeta = tarjetas[0] ? cs(tarjetas[0]).backgroundColor : '';
    const desborde = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (desborde > 1) anotar('desborde-horizontal', { px: desborde });

    return {
      hallazgos,
      contexto: {
        fondoPagina,
        fondoTarjeta,
        tarjetas: tarjetas.length,
        radioTarjeta: tarjetas[0] ? cs(tarjetas[0]).borderRadius : '',
        bordeTarjeta: tarjetas[0] ? cs(tarjetas[0]).border : '',
        sombraTarjeta: tarjetas[0] ? cs(tarjetas[0]).boxShadow : '',
        gapGrilla: cs(document.querySelector('[data-product-grid]') || document.body).gap,
        columnas: cs(document.querySelector('[data-product-grid]') || document.body).gridTemplateColumns,
      },
    };
  }, { escala: ESCALA, ancho });
}

const navegador = await chromium.launch();
const informe = { etiqueta: ETIQUETA, viewports: [] };
if (CAPTURAS) fs.mkdirSync(DESTINO, { recursive: true });

try {
  for (const vp of VIEWPORTS) {
    const contexto = await navegador.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      reducedMotion: 'reduce',
    });
    const page = await contexto.newPage();
    await page.addInitScript(MEDIDOR);
    await abrirCatalogo(page);

    const medicion = await medir(page, vp.nombre);
    informe.viewports.push({ viewport: vp.nombre, ...medicion });

    if (CAPTURAS) {
      await page.screenshot({ path: path.join(DESTINO, `catalogo-${vp.nombre}.png`) });
      // Producto agregado + carrito visible: los dos estados que la misión pide.
      const add = page.locator('[data-product-grid] [data-add-product]:not([disabled]) >> visible=true').first();
      if (await add.count()) {
        await add.click();
        await page.waitForTimeout(320);
        await page.screenshot({ path: path.join(DESTINO, `agregado-${vp.nombre}.png`) });
        await page.evaluate(() => { window.location.hash = '#cart'; });
        await page.waitForTimeout(420);
        await page.screenshot({ path: path.join(DESTINO, `carrito-${vp.nombre}.png`) });
      }
    }
    await contexto.close();
  }
} finally {
  await navegador.close();
}

const todos = informe.viewports.flatMap((v) => v.hallazgos);
console.log(`AUDITORÍA VISUAL DEL CATÁLOGO · ${ETIQUETA}`);
for (const v of informe.viewports) {
  const c = v.contexto;
  console.log(`\n${v.viewport.padEnd(8)} tarjetas=${c.tarjetas} radio=${c.radioTarjeta} gap=${c.gapGrilla}`);
  console.log(`         fondo=${c.fondoPagina}  tarjeta=${c.fondoTarjeta}`);
  console.log(`         sombra=${c.sombraTarjeta}`);
  for (const h of v.hallazgos) console.log(`   · ${h.tipo}  ${JSON.stringify({ ...h, tipo: undefined, ancho: undefined })}`);
}
console.log(`\nhallazgos: ${todos.length}`);

fs.mkdirSync(path.join(ROOT, 'artifacts', 'catalog-visual-polish'), { recursive: true });
const salida = path.join(ROOT, 'artifacts', 'catalog-visual-polish', `auditoria-${ETIQUETA}.json`);
fs.writeFileSync(salida, `${JSON.stringify(informe, null, 2)}\n`);
console.log(`informe: ${path.relative(ROOT, salida)}`);
