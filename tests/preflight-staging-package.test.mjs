/*
 * El preflight del paquete, medido a sí mismo.
 *
 * Este guion es la última compuerta antes de publicar, y tiene una propiedad
 * incómoda: sus expectativas son literales escritos a mano. Dos veces ya se
 * pagó caro.
 *
 *  1. `ESPERADO` exigía `app.js?v=42` y, doce líneas más abajo, una lista
 *     independiente de versiones permitidas seguía diciendo `41`. El mismo
 *     guion exigía una versión y la prohibía: el control de "index carga
 *     app.js?v=42" daba verde y el de "sin mezcla de versiones" detenía el
 *     paquete por ese mismo 42. Detenía también al candidato certificado.
 *  2. `ESPERADO.cache` quedaba clavado en el `CACHE_NAME` del candidato
 *     ANTERIOR. Como rotar `CACHE_NAME` es obligatorio cada vez que cambia el
 *     grafo de precache, el preflight detiene por diseño a toda candidata nueva
 *     hasta que alguien se acuerda de actualizar el literal a mano.
 *
 * Las dos son fallas del tooling que se leen como fallas del paquete, que es la
 * peor clase: hacen dudar de un artefacto sano. Acá quedan fijadas contra las
 * fuentes reales, no contra una copia de los valores.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const leer = (relativo) => readFileSync(path.join(RAIZ, relativo), 'utf8');
const FUENTE = leer('scripts/preflight-staging-package.mjs');

/*
 * Se evalúan las declaraciones REALES del guion, no una transcripción. El
 * preflight tiene efectos de lado en el nivel superior —lee `dist_release` y
 * termina el proceso—, así que no se puede importar; extraer y ejecutar sus
 * declaraciones en un contexto aislado es lo más cerca de la fuente que se
 * puede estar sin ejecutarlo.
 */
function declaracionesDelPreflight() {
  const bloques = [
    /const ESPERADO = \{[\s\S]*?\};/,
    /const VERSIONES_EXTRA = \[[\s\S]*?\];/,
    /const permitidas = new Set\(\[[\s\S]*?\]\);/,
  ].map((patron) => {
    const encontrado = patron.exec(FUENTE);
    assert.ok(encontrado, `el preflight ya no declara ${patron}`);
    return encontrado[0];
  });

  const sandbox = {};
  // `var` y no `const`: en un contexto de `vm` sólo `var` queda como propiedad
  // del objeto sandbox, que es la única forma de leer los valores desde afuera.
  vm.runInNewContext(
    `${bloques.join('\n')}\nvar salida = { ESPERADO, permitidas: [...permitidas] };`,
    sandbox,
    { timeout: 1000 },
  );
  return sandbox.salida;
}

test('el preflight no puede exigir una versión y prohibirla al mismo tiempo', () => {
  const { ESPERADO, permitidas } = declaracionesDelPreflight();

  const exigidas = Object.values(ESPERADO)
    .flatMap((valor) => [...String(valor).matchAll(/\?v=(\d+)/g)].map((m) => m[1]));

  assert.ok(exigidas.length > 0, 'ESPERADO dejó de exigir alguna versión: el control quedó vacío');
  for (const version of exigidas) {
    assert.ok(
      permitidas.includes(version),
      `el preflight exige ?v=${version} y no lo tiene entre las permitidas: `
      + `volvería a detener un paquete correcto (permitidas: ${permitidas.join(', ')})`,
    );
  }
});

test('las versiones permitidas se derivan de ESPERADO, no se copian a mano', () => {
  // La propiedad de arriba se puede satisfacer por casualidad manteniendo dos
  // listas sincronizadas. Lo que la vuelve imposible de romper es que una salga
  // de la otra, y eso es lo que se fija acá.
  const declaracion = /const permitidas = new Set\(\[[\s\S]*?\]\);/.exec(FUENTE)[0];
  assert.match(
    declaracion,
    /Object\.values\(ESPERADO\)/,
    'permitidas volvió a ser una lista suelta: la contradicción puede reaparecer',
  );
});

test('el CACHE_NAME que el preflight exige es el que sw.js declara de verdad', () => {
  const { ESPERADO } = declaracionesDelPreflight();
  const declarado = /const CACHE_NAME = '([^']+)'/.exec(leer('sw.js'))?.[1];

  assert.ok(declarado, 'sw.js dejó de declarar CACHE_NAME');
  assert.equal(
    ESPERADO.cache,
    declarado,
    'el preflight quedó clavado en el CACHE_NAME de otra candidata. Rotarlo es '
    + 'obligatorio cada vez que cambia el grafo de precache, así que este literal '
    + 'tiene que viajar con sw.js o el preflight detiene por diseño a toda '
    + 'candidata nueva.',
  );
});

test('la identidad firmada y el CACHE_NAME del worker son el mismo nombre', () => {
  // Tres archivos nombran la misma identidad. Si divergen, el preflight puede
  // dar verde sobre un paquete cuya identidad firmada es de otra corrida.
  const enWorker = /const CACHE_NAME = '([^']+)'/.exec(leer('sw.js'))[1];
  const firmada = JSON.parse(leer('release-identity.json')).cacheName;
  assert.equal(firmada, enWorker);
});

/*
 * EL PREFLIGHT YA ESTABA CLAVADO EN UNA VERSIÓN VIEJA, Y NADIE SE ENTERABA.
 *
 * Al preparar el lanzamiento del 2026-08-25 se encontró `ESPERADO.app =
 * '?v=46'` mientras `index.html` cargaba `js/app.js?v=47` desde el commit
 * eb1f33d — el que está en producción. O sea que el guion que decide si una
 * candidata se puede publicar habría rechazado el paquete de la versión VIVA.
 * El CACHE_NAME tenía su prueba desde hace tiempo; las otras tres agujas del
 * mismo tablero, no. Ahora las cuatro salen del archivo que las manda.
 */
test('las versiones que el preflight exige son las que index.html carga de verdad', () => {
  const { ESPERADO } = declaracionesDelPreflight();
  const index = leer('index.html');
  const pares = [
    ['app', `js/app.js${ESPERADO.app}`],
    ['recovery', `js/startup-recovery.js${ESPERADO.recovery}`],
    ['css', `styles.css${ESPERADO.css}`],
  ];
  for (const [nombre, referencia] of pares) {
    assert.ok(
      index.includes(referencia),
      `el preflight exige «${referencia}» y index.html no lo carga: `
      + `ESPERADO.${nombre} quedó atrás y el gate rechazaría la candidata publicable`,
    );
  }
});
