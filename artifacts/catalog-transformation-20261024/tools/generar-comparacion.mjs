// Pares antes/después de capturas REALES del Moto G15 → WebP livianos + página HTML.
//   node artifacts/catalog-transformation-20261024/tools/generar-comparacion.mjs
// Las PNG crudas (1080×2400) no se versionan por peso; se regeneran con moto-audit.mjs y moto-nav.mjs.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const base = path.resolve('artifacts/catalog-transformation-20261024');
const out = path.join(base, 'comparacion');
fs.mkdirSync(out, { recursive: true });

const PARES = [
  { id: '01-catalogo-lista', titulo: 'Catálogo: 2 productos por pantalla → vista Lista con 4 completos', nota: 'Moto G15 físico, 432×815. Antes sólo grilla (tarjeta de 334 px); después, el botón del buscador ofrece la lista (renglón de 110 px).', antes: 'antes/moto-real/07-catalogo-arriba.png', despues: 'despues/moto-real/lista-1-lista.png' },
  { id: '02-sin-foto', titulo: 'Producto sin foto: placeholder propio, legible y honesto', nota: 'Quilmes Clásica no tiene foto autorizada. Antes: «Imagen pendiente» a 8 px sobre rectángulos anidados. Después: siluetas y «Foto próximamente».', antes: 'antes/moto-real/grilla-cervezas-arriba.png', despues: 'despues/moto-real/grilla-cervezas-arriba.png' },
  { id: '03-busqueda-alcance', titulo: 'Buscar dentro de un rubro: ahora lo dice y da la salida', nota: 'Antes, con «Cervezas» activa, buscar «coca» daba «0 productos en Cervezas» con «Todas» fuera de pantalla. Después, con resultados, «Mostrando resultados de Cervezas · Buscar en todo».', antes: 'antes/moto-real/11-busqueda-coca-teclado.png', despues: 'despues/moto-real/busqueda-alcance-cervezas-quilmes.png' },
  { id: '04-home-productiva', titulo: 'Home del camino productivo: sin fotografía editorial sin derechos', nota: 'Catálogo de Supabase simulado. Antes: hero con foto de otaphotography.com y banners con fotos de terceros. Después: hero con fondo de marca y su puerta a la categoría; cero peticiones a assets/promos/.', antes: 'antes/moto-real/prod-home-arriba.png', despues: 'despues/moto-real/prod-home-arriba.png' },
  { id: '05-lista-cervezas', titulo: 'Vista lista con rubro activo', nota: 'Cervezas en lista: foto de 88 px, nombre, presentación, precio y «Agregar» a la vista; los sin foto muestran el placeholder nuevo.', antes: 'antes/moto-real/grilla-cervezas-arriba.png', despues: 'despues/moto-real/lista-cervezas-arriba.png' },
];

const W = 540;
const html = [];
for (const par of PARES) {
  const tiles = [];
  for (const lado of ['antes', 'despues']) {
    const origen = path.join(base, 'capturas', par[lado]);
    if (!fs.existsSync(origen)) { console.warn('falta', origen); continue; }
    // Se recorta la barra de estado del teléfono (hora, íconos de apps, notificaciones): es un
    // teléfono PERSONAL y lo versionado no debe llevar nada que no sea de la tienda.
    const { width: ancho, height: alto } = await sharp(origen).metadata();
    const BARRA_DE_ESTADO = Math.round(ancho * 0.09);
    const buf = await sharp(origen).extract({ left: 0, top: BARRA_DE_ESTADO, width: ancho, height: alto - BARRA_DE_ESTADO }).resize({ width: W }).webp({ quality: 80 }).toBuffer();
    tiles.push({ lado, buf });
  }
  if (tiles.length !== 2) continue;
  const meta = await sharp(tiles[0].buf).metadata();
  const hojas = await sharp({ create: { width: W * 2 + 12, height: meta.height, channels: 3, background: '#111' } })
    .composite(tiles.map((t, i) => ({ input: t.buf, left: i * (W + 12), top: 0 }))).webp({ quality: 78 }).toBuffer();
  const file = `${par.id}.webp`;
  fs.writeFileSync(path.join(out, file), hojas);
  html.push(`<section><h2>${par.titulo}</h2><p>${par.nota}</p><p class="lados"><span>ANTES</span><span>DESPUÉS</span></p><img src="${file}" alt="${par.titulo}" loading="lazy"></section>`);
  console.log(file, Math.round(hojas.length / 1024), 'KB');
}
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Antes y después — Moto G15 real</title>
<style>body{margin:0;background:#0d0f13;color:#eee;font:16px/1.45 system-ui,sans-serif;padding:24px}h1{font-size:22px}section{margin:0 0 40px;max-width:1120px}h2{font-size:18px;margin:0 0 4px}p{margin:4px 0;color:#b8bec9}.lados{display:flex;gap:12px;font-weight:700;color:#fff}.lados span{flex:1;text-align:center;background:#1c2028;border-radius:8px;padding:4px}img{max-width:100%;border-radius:12px}</style>
<h1>La Taba · antes y después en un Moto G15 físico</h1><p>Capturas reales con <code>adb screencap</code> (1080×2400, viewport CSS 432×815). Generadas por <code>tools/generar-comparacion.mjs</code>.</p>${html.join('\n')}</html>`);
