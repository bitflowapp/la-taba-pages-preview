import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * El hero comercial de la home es el elemento más grande de la primera
 * pantalla, o sea el LCP. Su fotografía la inyecta el JS como
 * `background-image`, así que sin un preload el navegador no sabe que existe
 * hasta después de arrancar los módulos. Medido en el A/B contra la base:
 * 1.052 ms de LCP.
 *
 * El preload vive en el shell y la ruta vive en `HOME_HERO_PROMO`. Son dos
 * lugares, así que hace falta algo que impida que se separen: cambiar la foto
 * en uno y no en el otro no puede degradar la carga en silencio.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const hoja = fs.readFileSync(path.join(root, 'styles/brand-home.css'), 'utf8');

const escapar = (valor) => valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('el shell precarga EXACTAMENTE la derivada que usa la banda del teléfono', async () => {
  const { HOME_HERO_PROMO } = await import('../js/ui.js');
  const preloads = [...shell.matchAll(/<link[^>]+rel="preload"[^>]*>/g)].map(([tag]) => tag);
  const imagen = preloads.filter((tag) => /as="image"/.test(tag));

  assert.equal(imagen.length, 1, 'hay exactamente un preload de imagen en el shell');
  assert.match(imagen[0], new RegExp(`href="${escapar(HOME_HERO_PROMO.bandImage)}"`));
  // Sólo en teléfono: en escritorio el hero cae fuera del primer pantallazo y
  // precargarlo sería bajar bytes que nadie va a ver todavía.
  assert.match(imagen[0], /media="\(max-width: 699px\)"/);
  // Y nunca el afiche: son 249 KB contra 35.
  assert.doesNotMatch(imagen[0], new RegExp(`href="${escapar(HOME_HERO_PROMO.image)}"`));
});

/*
 * Un `url()` dentro de una custom property se resuelve relativo a la HOJA que
 * la consume, no al documento, así que las rutas del hero no pueden viajar
 * desde el JS: viven en la hoja, con su `../`. Esto fija que sean las mismas
 * que declara el manifiesto —el 404 que apareció al intentarlo pedía
 * `/styles/assets/promos/...`— y que la banda no se sirva el afiche.
 */
test('la hoja de la vidriera pinta las mismas dos fotografías que declara el manifiesto', async () => {
  const { HOME_HERO_PROMO } = await import('../js/ui.js');
  assert.ok(
    hoja.includes(`url("../${HOME_HERO_PROMO.bandImage}")`),
    'la banda de teléfono tiene que pintar la derivada',
  );
  assert.ok(
    hoja.includes(`url("../${HOME_HERO_PROMO.image}")`),
    'el afiche de escritorio tiene que pintar la pieza completa',
  );
});

test('las dos fotografías del hero existen en el repositorio', async () => {
  const { HOME_HERO_PROMO } = await import('../js/ui.js');
  for (const ruta of [HOME_HERO_PROMO.image, HOME_HERO_PROMO.bandImage]) {
    assert.equal(fs.existsSync(path.join(root, ruta)), true, `falta ${ruta}`);
  }
});

// La derivada existe para pesar poco. Si alguien la regenera con otra calidad
// y se va a 200 KB, el preload vuelve a ser el problema que vino a resolver.
test('la derivada de la banda pesa mucho menos que el afiche', async () => {
  const { HOME_HERO_PROMO } = await import('../js/ui.js');
  const banda = fs.statSync(path.join(root, HOME_HERO_PROMO.bandImage)).size;
  const afiche = fs.statSync(path.join(root, HOME_HERO_PROMO.image)).size;
  assert.ok(banda < afiche / 3, `la banda pesa ${Math.round(banda / 1024)} KB y el afiche ${Math.round(afiche / 1024)} KB`);
  assert.ok(banda < 80 * 1024, `la banda no puede pasar de 80 KB: pesa ${Math.round(banda / 1024)} KB`);
});
