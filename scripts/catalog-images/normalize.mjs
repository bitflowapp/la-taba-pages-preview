import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import {
  catalogAssetBindingSha256,
  catalogAssetPath,
  catalogImageIdentitySha256,
  isSha256,
  normalizeSku,
  rawSourceFileName,
  sha256,
  stableJson,
} from './lib.mjs';

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('Falta sharp. Ejecutar npm install para restaurar las dependencias del proyecto.');
  process.exit(2);
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const RAW = path.join(ROOT, 'scripts/catalog-images/.raw');
const OUTPUTS = {
  master: path.join(ROOT, 'assets/products'),
  thumbnail: path.join(ROOT, 'assets/products'),
};
const RAW_MANIFEST = path.join(RAW, 'manifest.json');
const OUTPUT_MANIFEST = path.join(ROOT, 'docs/catalog/image-manifest.json');
const RECORTES = path.join(ROOT, 'catalog/recortes-declarados.json');

/*
 * RECORTES DECLARADOS.
 *
 * Un recorte no fabrica una imagen: los píxeles del producto quedan intactos.
 * Existe para una sola cosa —sacar la banda de marketing que el embotellador
 * estampa al costado de su packshot— y NO puede convertirse en «recortar el
 * producto», porque antes de aplicarse se verifica que el corte pase por un
 * canal de blanco puro. Si tocara un píxel del envase, esto se planta y no
 * escribe nada.
 *
 * Lo que NO habilita: retocar, repintar, ni sacar un sello estampado ENCIMA del
 * envase. Ése sigue siendo motivo de rechazo, porque quitarlo exigiría inventar
 * los píxeles que tapa. Ver catalog/recortes-declarados.json.
 */
const recortesPorSku = new Map(
  (JSON.parse(await fs.readFile(RECORTES, 'utf8').catch(() => '{"recortes":[]}')).recortes || [])
    .map((recorte) => [recorte.sku, recorte]),
);

/** Cuántas columnas/filas de blanco puro tiene que haber a cada lado del corte. */
const CANAL_BLANCO = 24;

/**
 * ¿El corte cae en blanco, sin tocar el producto?
 *
 * La primera versión de esta comprobación exigía que todo lo descartado fuera
 * blanco, y estaba mal: lo que se descarta ES la banda, que por definición no
 * es blanca. Lo que hay que probar es otra cosa, y es la que importa: que el
 * corte pase por un CANAL de blanco puro, y que el producto quede entero del
 * lado que se conserva.
 *
 * Con eso, «recortar» no puede convertirse en «recortar el producto»: si el
 * rectángulo se acercara al envase, el canal desaparece y esto se planta.
 */
async function verificarQueElCorteCaeEnBlanco(input, recorte, sku) {
  const { data, info } = await sharp(input).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const { left, top } = recorte;
  const right = left + recorte.width;
  const bottom = top + recorte.height;
  if (right > width || bottom > height || left < 0 || top < 0) {
    throw new Error(`${sku}: el recorte declarado (${recorte.width}x${recorte.height}+${left}+${top}) no entra en la imagen ${width}x${height}.`);
  }

  const blanco = (x, y) => {
    const i = (y * width + x) * channels;
    return data[i] >= 245 && data[i + 1] >= 245 && data[i + 2] >= 245;
  };
  const columnaBlanca = (x) => {
    for (let y = 0; y < height; y += 1) if (!blanco(x, y)) return false;
    return true;
  };
  const filaBlanca = (y) => {
    for (let x = left; x < right; x += 1) if (!blanco(x, y)) return false;
    return true;
  };

  for (const [borde, x] of [['izquierdo', left - 1], ['derecho', right]]) {
    if (x < 0 || x >= width) continue;
    for (let d = 0; d < CANAL_BLANCO; d += 1) {
      const columna = borde === 'izquierdo' ? x - d : x + d;
      if (columna < 0 || columna >= width) break;
      if (!columnaBlanca(columna)) {
        throw new Error(
          `${sku}: el corte ${borde} no cae en un canal de blanco: la columna ${columna} tiene contenido. `
          + 'Un recorte sólo puede pasar por blanco puro: revisar catalog/recortes-declarados.json.',
        );
      }
    }
  }
  for (const [borde, y] of [['superior', top - 1], ['inferior', bottom]]) {
    if (y < 0 || y >= height) continue;
    for (let d = 0; d < CANAL_BLANCO; d += 1) {
      const fila = borde === 'superior' ? y - d : y + d;
      if (fila < 0 || fila >= height) break;
      if (!filaBlanca(fila)) {
        throw new Error(`${sku}: el corte ${borde} no cae en un canal de blanco: la fila ${fila} tiene contenido.`);
      }
    }
  }

  // Y el producto tiene que quedar ENTERO adentro, sin tocar los bordes.
  let hayContenido = false;
  for (let y = top; y < bottom && !hayContenido; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (!blanco(x, y)) { hayContenido = true; break; }
    }
  }
  if (!hayContenido) throw new Error(`${sku}: el recorte declarado deja una imagen vacía.`);
}

const allowEmpty = process.argv.includes('--allow-empty');
const rawManifest = JSON.parse(await fs.readFile(RAW_MANIFEST, 'utf8')
  .catch(() => '{"schemaVersion":0,"sources":[]}'));
if (rawManifest.schemaVersion !== 1) throw new Error('Falta un manifiesto raw válido; ejecutar images:fetch.');
if (!Array.isArray(rawManifest.sources)) throw new Error('El manifiesto raw no contiene un array sources.');
if (!rawManifest.sources.length && !allowEmpty) {
  throw new Error('El manifiesto raw está vacío. Usá --allow-empty sólo para el template.');
}
await Promise.all(Object.values(OUTPUTS).map((directory) => fs.mkdir(directory, { recursive: true })));

const manifestSources = [];
for (const source of rawManifest.sources) {
  const expectedSafeSku = normalizeSku(source?.sku);
  if (!expectedSafeSku || source?.safeSku !== expectedSafeSku) {
    throw new Error(`${source?.sku || 'Fuente'}: safeSku raw inválido.`);
  }
  if (!isSha256(source?.sourceSha256)) {
    throw new Error(`${source.sku}: sourceSha256 raw inválido.`);
  }
  const expectedIdentitySha256 = catalogImageIdentitySha256(source);
  if (source.identitySha256 !== expectedIdentitySha256) {
    throw new Error(`${source.sku}: identitySha256 raw no coincide con producto y fuente.`);
  }
  const expectedRawFile = rawSourceFileName(source);
  if (source.rawFile !== expectedRawFile) {
    throw new Error(`${source.sku}: rawFile no coincide con el nombre content-addressed.`);
  }
  const input = path.resolve(RAW, source.rawFile);
  if (path.dirname(input) !== RAW) {
    throw new Error(`${source.sku}: rawFile escapa del directorio controlado.`);
  }
  const inputBytes = await fs.readFile(input);
  if (sha256(inputBytes) !== source.sourceSha256) {
    throw new Error(`${source.sku}: la fuente raw no coincide con el manifiesto.`);
  }

  const recorte = recortesPorSku.get(source.sku);
  if (recorte) await verificarQueElCorteCaeEnBlanco(input, recorte, source.sku);

  const assets = {};
  for (const [kind, size] of [['master', 1000], ['thumbnail', 400]]) {
    const tempPath = path.join(RAW, `.normalize-${process.pid}-${source.safeSku}-${kind}.webp`);
    try {
      const base = sharp(input).rotate();
      if (recorte) {
        base.extract({
          left: recorte.left, top: recorte.top, width: recorte.width, height: recorte.height,
        });
      }
      await base
        .resize(size, size, { fit: 'contain', background: '#ffffff' })
        .flatten({ background: '#ffffff' })
        .webp({ quality: 84, effort: 6 })
        .toFile(tempPath);
      const outputBytes = await fs.readFile(tempPath);
      const outputSha256 = sha256(outputBytes);
      const assetPath = catalogAssetPath(source, kind, outputSha256);
      const file = path.basename(assetPath);
      const outputPath = path.join(ROOT, assetPath);
      const existing = await fs.readFile(outputPath).catch(() => null);
      if (existing && sha256(existing) !== outputSha256) {
        throw new Error(`${file}: colisión de hash truncado.`);
      }
      if (!existing) {
        await fs.copyFile(tempPath, outputPath, fsConstants.COPYFILE_EXCL);
      }
      assets[kind] = {
        height: size,
        path: assetPath,
        sha256: outputSha256,
        width: size,
      };
      assets[kind].bindingSha256 = catalogAssetBindingSha256(source, kind, assets[kind]);
    } finally {
      await fs.rm(tempPath, { force: true });
    }
  }
  manifestSources.push({
    ...source,
    assets,
  });
  console.log(`${source.sku}: WebP master y thumbnail content-addressed generados.`);
}

await fs.writeFile(OUTPUT_MANIFEST, stableJson({
  encoder: {
    effort: 6,
    format: 'webp',
    name: 'sharp',
    quality: 84,
    version: sharp.versions.sharp,
  },
  schemaVersion: 1,
  sources: manifestSources,
}), 'utf8');
console.log(`Manifiesto final: ${path.relative(ROOT, OUTPUT_MANIFEST).replaceAll('\\', '/')}.`);
