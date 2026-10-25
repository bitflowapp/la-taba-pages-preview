// Montajes de la franja superior de TODAS las capturas crudas del Moto (donde aparecen las
// notificaciones emergentes) para revisarlas antes de conservar o compartir ninguna.
//   node artifacts/catalog-transformation-20261024/tools/revisar-privacidad.mjs [carpeta de salida]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const raiz = path.resolve('artifacts/catalog-transformation-20261024/capturas');
const archivos = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.png$/i.test(e.name)) archivos.push(p);
  }
};
walk(raiz);
archivos.sort();
const COLS = 4;
const ANCHO = 300;
const ALTO = 190;
const ETQ = 20;
const POR_HOJA = 16;
const salida = process.argv[2] || path.join(process.env.TMP || '.', 'privacidad');
fs.mkdirSync(salida, { recursive: true });

for (let h = 0; h * POR_HOJA < archivos.length; h += 1) {
  const lote = archivos.slice(h * POR_HOJA, (h + 1) * POR_HOJA);
  const celdas = await Promise.all(lote.map(async (f, i) => {
    const franja = await sharp(f).extract({ left: 0, top: 0, width: 1080, height: 680 }).resize(ANCHO, ALTO, { fit: 'fill' }).png().toBuffer();
    const nombre = path.relative(raiz, f).split(path.sep).join('/').replace('/moto-real', '').slice(-44);
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ETQ}"><rect width="100%" height="100%" fill="#000"/><text x="3" y="14" font-family="Arial" font-size="11" fill="#9f9">${nombre.replace(/&/g, '&amp;')}</text></svg>`);
    const celda = await sharp({ create: { width: ANCHO, height: ALTO + ETQ, channels: 3, background: '#000' } })
      .composite([{ input: franja, top: 0, left: 0 }, { input: svg, top: ALTO, left: 0 }]).png().toBuffer();
    return { input: celda, left: (i % COLS) * (ANCHO + 4), top: Math.floor(i / COLS) * (ALTO + ETQ + 4) };
  }));
  const filas = Math.ceil(lote.length / COLS);
  await sharp({ create: { width: COLS * (ANCHO + 4), height: filas * (ALTO + ETQ + 4), channels: 3, background: '#222' } })
    .composite(celdas).png().toFile(path.join(salida, `hoja-${h + 1}.png`));
}
console.log(archivos.length, 'capturas en', Math.ceil(archivos.length / POR_HOJA), 'hojas →', salida);
