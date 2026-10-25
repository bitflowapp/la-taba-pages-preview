// Hojas de contacto de la vitrina: foto + nombre + contenido + envase de cada SKU, para revisar
// A OJO que la imagen corresponde al producto (sabor, tamaño, lata/botella, pack/suelto).
//   node artifacts/catalog-transformation-20261024/tools/hoja-de-contacto.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { products } from '../../../js/vitrina-neuquen-20261024.js';

const out = path.resolve('artifacts/catalog-transformation-20261024/catalogo');
fs.mkdirSync(out, { recursive: true });
const COLS = 6;
const ROWS = 3;
const W = 232;
const IMG = 232;
const LABEL = 74;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function celda(p, index) {
  const ruta = p.imageThumbnail || 'assets/products/beverage-placeholder.svg';
  const base = await sharp(fs.readFileSync(path.resolve(ruta)), { density: 96 })
    .resize(IMG, IMG, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).png().toBuffer();
  const pack = p.soldAsPack ? ` · pack x${p.unitsPerPack}` : '';
  const l1 = `${index + 1}. ${p.brand === p.name.slice(0, p.brand.length) ? p.name : `${p.brand} ${p.name}`}`.slice(0, 34);
  const l2 = `${p.variant} · ${p.capacity}`.slice(0, 36);
  const l3 = `${p.packageType}${pack}${p.image ? '' : ' · SIN FOTO'}`.slice(0, 36);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${LABEL}">
    <rect width="${W}" height="${LABEL}" fill="${p.image ? '#14181f' : '#3a1418'}"/>
    <text x="8" y="19" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#fff">${esc(l1)}</text>
    <text x="8" y="39" font-family="Arial, sans-serif" font-size="13" fill="#d8dce3">${esc(l2)}</text>
    <text x="8" y="58" font-family="Arial, sans-serif" font-size="13" fill="${p.image ? '#9fe3b0' : '#ffb4b4'}">${esc(l3)}</text></svg>`);
  return { input: await sharp({ create: { width: W, height: IMG + LABEL, channels: 3, background: '#000' } })
    .composite([{ input: base, left: 0, top: 0 }, { input: svg, left: 0, top: IMG }]).png().toBuffer() };
}

const PER = COLS * ROWS;
const hojas = Math.ceil(products.length / PER);
for (let h = 0; h < hojas; h += 1) {
  const slice = products.slice(h * PER, (h + 1) * PER);
  const celdas = await Promise.all(slice.map((p, i) => celda(p, h * PER + i)));
  const comps = celdas.map((c, i) => ({ input: c.input, left: (i % COLS) * (W + 4), top: Math.floor(i / COLS) * (IMG + LABEL + 4) }));
  const file = path.join(out, `hoja-de-contacto-${h + 1}.webp`);
  await sharp({ create: { width: COLS * (W + 4), height: ROWS * (IMG + LABEL + 4), channels: 3, background: '#222' } }).composite(comps).webp({ quality: 82 }).toFile(file);
  console.log(file);
}
