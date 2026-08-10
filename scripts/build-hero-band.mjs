/*
 * Derivada del hero comercial para la BANDA de teléfono.
 *
 * Por qué existe: la pieza original (`cervezas-heineken.jpg`, 249 KB) está
 * compuesta como AFICHE de 268 px de alto y ahí se justifica. Desde que la
 * banda subió al primer pantallazo, ese mismo archivo pasó a ser el elemento
 * más grande de la primera pantalla —el LCP— en un ancho de 320 a 432 px y
 * una altura de 84 a 112. Medido contra la base, con red móvil y CPU a 1/4:
 *   sin preload ...... LCP +1.052 ms
 *   con preload ...... LCP -476 ms, pero FCP +352 ms y primer producto
 *                      comprable +529 ms, porque 249 KB compiten con el CSS
 *                      y los módulos por el mismo ancho de banda.
 * O sea que el problema no era CUÁNDO se pide sino CUÁNTO pesa.
 *
 * Qué hace: recorta y reencoda la MISMA fotografía curada al tamaño que la
 * banda usa de verdad. No genera una imagen nueva ni retoca la escena: es la
 * misma pieza, servida al tamaño correcto.
 *
 *   node scripts/build-hero-band.mjs
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origen = path.join(root, 'assets/promos/cervezas-heineken.jpg');
const destino = path.join(root, 'assets/promos/cervezas-heineken-band.webp');

// 1000x300 y no el tamaño exacto de la banda: el ancho útil llega a 699px y la
// pantalla puede tener DPR 2, así que 1000 cubre el peor caso sin escalar
// hacia arriba. La relación 10:3 es la de la banda a 432px de ancho.
const ANCHO = 1000;
const ALTO = 300;

// El mismo punto focal que usa el CSS de la banda (`background-position:
// 72% 58%`): la escena tiene el vaso servido a la derecha y abajo.
const FOCO_X = 0.72;
const FOCO_Y = 0.58;

const entrada = sharp(origen);
const { width, height } = await entrada.metadata();
if (!width || !height) throw new Error(`No pude leer las dimensiones de ${origen}`);

// Escala para cubrir la caja destino, y recorte alrededor del punto focal.
const escala = Math.max(ANCHO / width, ALTO / height);
const escaladoAncho = Math.ceil(width * escala);
const escaladoAlto = Math.ceil(height * escala);
const izquierda = Math.min(
  Math.max(0, Math.round(escaladoAncho * FOCO_X - ANCHO / 2)),
  escaladoAncho - ANCHO,
);
const arriba = Math.min(
  Math.max(0, Math.round(escaladoAlto * FOCO_Y - ALTO / 2)),
  escaladoAlto - ALTO,
);

await entrada
  .resize(escaladoAncho, escaladoAlto)
  .extract({ left: izquierda, top: arriba, width: ANCHO, height: ALTO })
  .webp({ quality: 72, effort: 6 })
  .toFile(destino);

const antes = (await fs.stat(origen)).size;
const despues = (await fs.stat(destino)).size;
process.stdout.write(
  `${path.relative(root, origen)} ${Math.round(antes / 1024)} KB `
  + `-> ${path.relative(root, destino)} ${Math.round(despues / 1024)} KB `
  + `(${Math.round((1 - despues / antes) * 100)}% menos)\n`,
);
