import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const PLACEHOLDER = 'assets/products/beverage-placeholder.svg';

/*
 * QUE UNA FOTO NUEVA LLEGUE A UN TELÉFONO QUE YA TIENE LA TIENDA INSTALADA.
 *
 * Es la pregunta que decide si publicar un packshot sirve para algo. Una PWA
 * instalada trae su propia caché, y una foto que se queda pegada ahí es peor
 * que no haberla publicado: el cliente ve lo de antes y nadie se entera. Pedirle
 * a la gente que borre Safari o reinstale no es una respuesta.
 *
 * Acá se fija la cadena que lo garantiza, que son tres cosas y no una:
 *
 *   1. el nombre del archivo lleva el hash de su contenido, así que una foto
 *      distinta es una URL distinta y NO PUEDE haber acierto de caché viejo;
 *   2. el worker sirve red primero, así que hasta una misma URL se refresca;
 *   3. al activarse, el worker borra toda caché que no sea la suya, y su nombre
 *      está versionado.
 *
 * Con las tres, la actualización normal de la PWA adopta los assets nuevos.
 */

test('el nombre de cada packshot publicado lleva el hash de su contenido', () => {
  const manifiesto = JSON.parse(
    fs.readFileSync(path.join(root, 'catalog/PUBLIC-PRODUCT-ASSETS.json'), 'utf8'),
  );
  const fotos = manifiesto.publicables.filter((entrada) => entrada.ruta.endsWith('.webp'));
  assert.ok(fotos.length > 0, 'si no hay ninguna foto publicable, esta prueba dejó de mirar algo');

  for (const entrada of fotos) {
    const bytes = fs.readFileSync(path.join(root, entrada.ruta));
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha, entrada.sha256, `${entrada.ruta}: el archivo no es el que el manifiesto declara`);
    assert.ok(
      path.basename(entrada.ruta, '.webp').endsWith(sha.slice(0, 16)),
      `${entrada.ruta}: el nombre no termina en el hash de su contenido, así que una foto nueva `
      + 'podría reusar la URL de la vieja y quedarse pegada en la caché de una PWA instalada',
    );
  }
});

test('cambiar el contenido de una foto obliga a cambiar su URL', () => {
  /*
   * La demostración del punto anterior, hecha al revés: dos contenidos distintos
   * no pueden compartir nombre. Si alguien cambiara el esquema de nombres a algo
   * estable —`coca-cola.webp`— esta prueba sigue en verde y hay que mirarla; por
   * eso la de arriba fija el hash EN el nombre y ésta fija que sean únicos.
   */
  const manifiesto = JSON.parse(
    fs.readFileSync(path.join(root, 'catalog/PUBLIC-PRODUCT-ASSETS.json'), 'utf8'),
  );
  const porNombre = new Map();
  for (const entrada of manifiesto.publicables) {
    const previo = porNombre.get(path.basename(entrada.ruta));
    assert.equal(previo, undefined, `dos activos comparten nombre: ${entrada.ruta}`);
    porNombre.set(path.basename(entrada.ruta), entrada.sha256);
  }
  const hashes = new Set(manifiesto.publicables.map((entrada) => entrada.sha256));
  assert.equal(hashes.size, manifiesto.publicables.length, 'dos activos publicables tienen el mismo contenido');
});

test('el worker sirve red primero, así que una versión recién publicada se ve sin borrar nada', () => {
  assert.match(sw, /networkFirst\(request\)/, 'el fetch no delega en la estrategia de red primero');
  assert.match(sw, /const red = fetch\(request\)/, 'networkFirst no empieza por la red');
  // El respaldo de caché existe, y existe DESPUÉS de la red: si estuviera antes,
  // sería caché primero y una foto nueva podría no verse nunca.
  const indiceRed = sw.indexOf('const red = fetch(request)');
  const indiceRespaldo = sw.indexOf('cachedFallback(request)', indiceRed);
  assert.ok(indiceRed > 0 && indiceRespaldo > indiceRed, 'el respaldo de caché no está después de la red');
});

test('al activarse, el worker se queda sólo con su caché versionada', () => {
  assert.match(sw, /const CACHE_NAME = 'la-taba-runtime-v\d+/, 'el nombre de la caché no está versionado');
  assert.match(sw, /addEventListener\('activate'/);
  assert.match(sw, /limpiarCachesViejas\(\)\.then\(\(\) => self\.clients\.claim\(\)\)/);
  assert.match(
    sw,
    /\.filter\(\(key\) => key\.startsWith\(CACHE_PREFIX\) && key !== CACHE_NAME\)/,
    'la limpieza no borra las cachés de versiones anteriores',
  );
});

test('el respaldo propio viaja en el precache: sin red, la tarjeta sin foto igual se dibuja', () => {
  assert.ok(
    sw.includes(`./${PLACEHOLDER}`),
    'el recurso propio de TABA no está precacheado: sin red la tarjeta quedaría con el ícono roto',
  );
  assert.ok(fs.existsSync(path.join(root, PLACEHOLDER)));
});

test('el precache no lleva ningún packshot: las fotos se piden a la red y se guardan al pasar', () => {
  /*
   * A propósito. Precachear los packshots haría que la PRIMERA visita descargue
   * fotos que quizá no mire, y obligaría a tocar `sw.js` —y a bumpear la
   * versión de la caché— cada vez que se publica una. Como los nombres llevan
   * el hash, la red primero y el guardado al pasar alcanzan: una foto nueva
   * llega en la visita siguiente y nunca choca con una vieja.
   */
  const precacheadas = [...sw.matchAll(/'\.\/(assets\/products\/[^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(precacheadas, [PLACEHOLDER]);
  assert.match(sw, /guardarSiSirve\(request, response\)/, 'las respuestas buenas no se guardan para la próxima');
});
