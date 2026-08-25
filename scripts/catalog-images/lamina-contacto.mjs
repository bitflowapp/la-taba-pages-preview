/*
 * La lámina de contacto: las piezas de TABA puestas una al lado de la otra,
 * como se ven en la góndola, para poder MIRARLAS. Un SVG que valida no es un
 * dibujo que funciona.
 *
 *   node scripts/catalog-images/lamina-contacto.mjs [--salida artifacts/x.png]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const SALIDA = path.resolve(ROOT, arg('--salida', 'artifacts/taba-premium-catalog/lamina-contacto.png'));
const FONDO = arg('--fondo', 'claro');

const spec = JSON.parse(await fs.readFile(path.join(ROOT, 'catalog/lamina-taba/especificacion.json'), 'utf8'));
const { LAMINAS_TABA } = await import(pathToFileURL(path.join(ROOT, 'js/core/taba-packshot-manifest.js')).href);
const nombres = new Map(spec.productos.map((p) => [p.sku, p.sku]));

const celdas = await Promise.all(
  [...Object.entries(LAMINAS_TABA)].map(async ([sku, ruta]) => ({
    sku,
    nombre: nombres.get(sku) || sku,
    svg: await fs.readFile(path.join(ROOT, ruta), 'utf8'),
  })),
);

const oscuro = FONDO !== 'claro';
const html = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:${oscuro ? '#0e1116' : '#f4f5f7'};font:600 13px/1.3 system-ui,sans-serif;color:${oscuro ? '#e8eaed' : '#14181d'};padding:24px}
  .g{display:grid;grid-template-columns:repeat(6,1fr);gap:16px}
  .c{background:${oscuro ? '#171b21' : '#fff'};border-radius:16px;padding:10px;box-shadow:0 1px 3px rgba(0,0,0,.18)}
  .m{background:#fff;border-radius:12px;aspect-ratio:1;display:grid;place-items:center;overflow:hidden}
  .m svg{width:100%;height:100%;display:block}
  .n{margin-top:8px;font-size:11px;opacity:.85;word-break:break-word}
</style><div class="g">${celdas
  .map((c) => `<div class="c"><div class="m">${c.svg.replace(/<\?xml[^>]*>/, '')}</div><div class="n">${c.nombre}</div></div>`)
  .join('')}</div>`;

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1.5 });
await pagina.setContent(html, { waitUntil: 'load' });
await fs.mkdir(path.dirname(SALIDA), { recursive: true });
await pagina.screenshot({ path: SALIDA, fullPage: true });
await navegador.close();
console.log(`${celdas.length} láminas · ${path.relative(ROOT, SALIDA)}`);
