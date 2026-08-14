// Deriva las creatividades LIVIANAS del growth engine desde el lote curado.
// Ninguna imagen nueva: cada salida es la MISMA pieza vetada de
// assets/promos, recortada o reescalada al tamaño que su superficie usa de
// verdad (el mismo argumento del hero: scripts/build-hero-band.mjs).
//
//   · *-band.webp  → banda de hero contextual (10:3 alrededor del punto
//                    focal que declara la campaña, el mismo que usa el CSS).
//   · *-door.webp  → columna de puerta editorial (reescalado sin recorte).
//
// El manifiesto de procedencia (docs/catalog/promo-image-manifest.json) se
// actualiza a mano junto con este script: tests/image-sources.test.mjs exige
// que toda pieza declare su origen, y estas heredan el de su fuente.
//
// Uso: node scripts/build-growth-creatives.mjs
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { statSync } from 'node:fs';

let sharp;
try { ({ default: sharp } = await import('sharp')); } catch { throw new Error('sharp es obligatorio.'); }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROMOS = join(ROOT, 'assets', 'promos');

// focus = el background-position declarado por la campaña que la consume.
const HERO_BANDS = [
  { source: 'cervezas-heineken-botella.jpg', out: 'cervezas-heineken-botella-band.webp', focus: [0.5, 0.45] },
  { source: 'energizantes-red-bull.jpg', out: 'energizantes-red-bull-band.webp', focus: [0.48, 0.55] },
  { source: 'whisky-chivas.webp', out: 'whisky-chivas-band.webp', focus: [0.64, 0.55] },
  { source: 'mixers-schweppes.jpg', out: 'mixers-schweppes-band.webp', focus: [0.5, 0.5] },
];

const DOORS = [
  { source: 'cervezas-patagonia.jpg', out: 'cervezas-patagonia-door.webp' },
  { source: 'cervezas-heineken-botella.jpg', out: 'cervezas-heineken-botella-door.webp' },
  { source: 'whisky-chivas.webp', out: 'whisky-chivas-door.webp' },
  { source: 'gin-tanqueray.jpg', out: 'gin-tanqueray-door.webp' },
  { source: 'aperitivos-gancia.webp', out: 'aperitivos-gancia-door.webp' },
  { source: 'energizantes-red-bull.jpg', out: 'energizantes-red-bull-door.webp' },
  { source: 'mixers-schweppes.jpg', out: 'mixers-schweppes-door.webp' },
];

const BAND_RATIO = 10 / 3;
const BAND_MAX_WIDTH = 1400;
const DOOR_MAX_WIDTH = 900;

function kb(path) {
  return Math.round(statSync(path).size / 102.4) / 10;
}

async function buildBand({ source, out, focus }) {
  const input = join(PROMOS, source);
  const meta = await sharp(input).metadata();
  const width = Math.min(BAND_MAX_WIDTH, meta.width);
  const height = Math.round(width / BAND_RATIO);
  // Cubrir al alto de la banda y recortar la ventana alrededor del focal,
  // acotada a los bordes: exactamente lo que hace background-size:cover +
  // background-position en el CSS.
  const scale = Math.max(width / meta.width, height / meta.height);
  const scaledWidth = Math.round(meta.width * scale);
  const scaledHeight = Math.round(meta.height * scale);
  const left = Math.max(0, Math.min(scaledWidth - width, Math.round(scaledWidth * focus[0] - width / 2)));
  const top = Math.max(0, Math.min(scaledHeight - height, Math.round(scaledHeight * focus[1] - height / 2)));
  await sharp(input)
    .resize(scaledWidth, scaledHeight)
    .extract({ left, top, width, height })
    .webp({ quality: 72, effort: 6 })
    .toFile(join(PROMOS, out));
  console.log(`banda ${out}: ${width}x${height} · ${kb(join(PROMOS, out))} KB (fuente ${kb(input)} KB)`);
  return { out, width, height };
}

async function buildDoor({ source, out }) {
  const input = join(PROMOS, source);
  const meta = await sharp(input).metadata();
  const width = Math.min(DOOR_MAX_WIDTH, meta.width);
  const height = Math.round(meta.height * (width / meta.width));
  await sharp(input)
    .resize(width, height)
    .webp({ quality: 74, effort: 6 })
    .toFile(join(PROMOS, out));
  console.log(`puerta ${out}: ${width}x${height} · ${kb(join(PROMOS, out))} KB (fuente ${kb(input)} KB)`);
  return { out, width, height };
}

for (const band of HERO_BANDS) await buildBand(band);
for (const door of DOORS) await buildDoor(door);
console.log('Listo. Actualizá docs/catalog/promo-image-manifest.json con las dimensiones impresas.');
