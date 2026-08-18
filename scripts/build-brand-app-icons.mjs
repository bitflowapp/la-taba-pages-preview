/*
 * Genera el juego de iconos de instalación de La Taba desde una sola geometría.
 *
 *   node scripts/build-brand-app-icons.mjs           escribe los archivos
 *   node scripts/build-brand-app-icons.mjs --check   falla si alguno cambió
 *
 * El modo `--check` existe porque los PNG son binarios versionados: sin él,
 * tocar la geometría y olvidarse de regenerar deja el repositorio publicando un
 * icono que ya no es el que declara el código. Lo corre `tests/pwa-install-shell.test.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { APP_ICON_FILES, TABA_RED, tabaAppIconSvg } from './lib/taba-app-icon.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** El contenido exacto que le corresponde a cada archivo del juego. */
export async function renderAppIcon({ variant, size, format }) {
  const svg = tabaAppIconSvg({ variant, size });
  if (format === 'svg') return Buffer.from(svg, 'utf8');
  /*
   * `density` no es decoración: sharp rasteriza el SVG a 72 dpi por omisión y
   * un lienzo de 512 declarado en píxeles sale igual, pero uno de 180 sale
   * borroso si el rasterizador escala después. Pedir el tamaño exacto con
   * `resize` deja el borde de la T limpio en los seis archivos.
   */
  const pipeline = sharp(Buffer.from(svg, 'utf8'), { density: 384 })
    .resize(size, size, { fit: 'fill' });
  /*
   * Aplanar sobre rojo SÓLO donde la transparencia hace daño.
   *
   * `apple` no puede llevar alfa: iOS pinta NEGRO detrás de un
   * `apple-touch-icon` con canal alfa, así que un icono a sangre con alfa vacío
   * en los bordes sale con un marco negro en la pantalla de inicio.
   * `maskable` va a sangre y no tiene un solo píxel transparente, así que
   * aplanarlo no cambia nada y ahorra el canal.
   * `any` SÍ conserva el alfa: sus esquinas redondeadas SON transparencia, y
   * aplanarlas contra el mismo rojo devolvía un cuadrado perfecto —el error que
   * tuvo la primera versión de este generador—.
   */
  if (variant !== 'any') pipeline.flatten({ background: TABA_RED });
  return pipeline.png({ compressionLevel: 9 }).toBuffer();
}

async function main() {
  const check = process.argv.includes('--check');
  const problemas = [];
  for (const file of APP_ICON_FILES) {
    const destino = path.join(ROOT, file.path);
    const contenido = await renderAppIcon(file);
    if (check) {
      const actual = fs.existsSync(destino) ? fs.readFileSync(destino) : null;
      if (!actual) problemas.push(`falta ${file.path}`);
      else if (!actual.equals(contenido)) problemas.push(`${file.path} no coincide con la geometría declarada`);
      continue;
    }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);
    console.log(`${file.path}  ${contenido.length} bytes`);
  }
  if (problemas.length) {
    console.error(`Iconos de instalación desalineados:\n  · ${problemas.join('\n  · ')}`);
    console.error('Regenerá con: node scripts/build-brand-app-icons.mjs');
    process.exit(1);
  }
  if (check) console.log(`Iconos de instalación al día (${APP_ICON_FILES.length}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
