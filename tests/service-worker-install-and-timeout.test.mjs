/*
 * El service worker por el lado que el P1 del retorno desde Mercado Pago no
 * había mirado: la ESCRITURA de la caché, y la red que no contesta.
 *
 * `b5ecfd5` cerró el camino de lectura —un 503, un 404 o la página de un portal
 * cautivo ya no llegan al documento si hay copia guardada—. Pero la copia
 * guardada la escribe `install`, y `cache.addAll` guarda cualquier respuesta con
 * estado 200: el portal cautivo de un bar contesta 200 con SU página, así que un
 * cliente que abre la tienda por primera vez sobre esa red guardaba esa página
 * como `styles.css` y como cada uno de los módulos del arranque. A partir de ahí la
 * defensa de lectura ya no defiende nada: la copia buena que iba a rescatar al
 * documento es la página del portal.
 *
 * Tres agujeros más, del mismo lado:
 *
 *   - `cache.addAll` es TODO O NADA. Un solo 404 —un despliegue a medio
 *     publicar, un asset que tardó— y el cliente se queda SIN precache entero.
 *   - `activate` borra la caché anterior sin mirar si la nueva quedó completa:
 *     un precache a medias que además tira la copia vieja deja al cliente peor
 *     que antes de actualizar.
 *   - `networkFirst` no tiene plazo. Una red que ni contesta ni rechaza —la
 *     radio del teléfono reenganchando al volver de Mercado Pago es el caso
 *     típico— deja al documento esperando para siempre con la copia buena al
 *     lado. El `catch` no corre: no hay error, hay silencio.
 *
 * Se prueba el comportamiento del worker de verdad: `sw.js` se evalúa dentro de
 * un alcance falso que implementa CacheStorage con la semántica que importa
 * —`addAll` rechaza si alguna respuesta no es 200, `caches.match` recorre TODAS
 * las cachés— y se le entregan eventos `install`, `activate` y `fetch`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEN = 'https://taba.test';
const FUENTE = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const NOMBRE_CACHE = FUENTE.match(/const CACHE_NAME = '([^']+)'/)[1];
const PREFIJO_CACHE = FUENTE.match(/const CACHE_PREFIX = '([^']+)'/)[1];

/** Los assets que el worker precachea, leídos del propio fuente. */
function assetsDeclarados() {
  const bloque = FUENTE.slice(FUENTE.indexOf('const ASSETS = ['), FUENTE.indexOf('];'));
  return [...bloque.matchAll(/'(\.\/[^']*)'/g)].map((m) => m[1]);
}

function absoluta(url) {
  return new URL(typeof url === 'string' ? url : url.url, `${ORIGEN}/`).href;
}

/**
 * CacheStorage con la semántica que decide estas pruebas:
 *   - `addAll` RECHAZA si alguna respuesta no tiene estado ok (es lo que hace el
 *     navegador) y guarda todo lo demás, mire o no el `content-type`.
 *   - `caches.match` recorre todas las cachés del origen, no sólo la actual.
 */
function crearCacheStorage() {
  const almacenes = new Map();

  const abrir = (nombre) => {
    if (!almacenes.has(nombre)) almacenes.set(nombre, new Map());
    const mapa = almacenes.get(nombre);
    const cache = {
      put: async (solicitud, respuesta) => { mapa.set(absoluta(solicitud), respuesta); },
      match: async (solicitud) => mapa.get(absoluta(solicitud)),
      keys: async () => [...mapa.keys()].map((url) => ({ url })),
      delete: async (solicitud) => mapa.delete(absoluta(solicitud)),
      addAll: async (solicitudes) => {
        const respuestas = await Promise.all(solicitudes.map((s) => fetchActual(s)));
        // El navegador rechaza el lote entero si alguna no está ok. No mira el
        // tipo: un 200 con HTML donde va CSS entra igual.
        if (respuestas.some((r) => !r || !r.ok)) throw new TypeError('Request failed');
        respuestas.forEach((r, i) => mapa.set(absoluta(solicitudes[i]), r));
      },
    };
    return cache;
  };

  let fetchActual = async () => { throw new TypeError('sin red'); };

  return {
    almacenes,
    fijarRed: (fn) => { fetchActual = fn; },
    api: {
      open: async (nombre) => abrir(nombre),
      match: async (solicitud) => {
        for (const mapa of almacenes.values()) {
          const encontrado = mapa.get(absoluta(solicitud));
          if (encontrado) return encontrado;
        }
        return undefined;
      },
      keys: async () => [...almacenes.keys()],
      delete: async (nombre) => almacenes.delete(nombre),
    },
  };
}

function cargarWorker({ red, cachesPrevias = {} } = {}) {
  const almacen = crearCacheStorage();
  almacen.fijarRed((solicitud) => red(solicitud));

  for (const [nombre, entradas] of Object.entries(cachesPrevias)) {
    const mapa = new Map();
    entradas.forEach(([url, respuesta]) => mapa.set(absoluta(url), respuesta));
    almacen.almacenes.set(nombre, mapa);
  }

  const oyentes = new Map();
  let reclamado = false;
  const self = {
    location: new URL(`${ORIGEN}/`),
    addEventListener: (tipo, oyente) => oyentes.set(tipo, oyente),
    clients: { claim: async () => { reclamado = true; } },
    skipWaiting: () => undefined,
  };

  // El `Request` de Node exige una URL absoluta; el de un worker resuelve contra
  // el alcance. Sin esto no se puede ejercer `install`, que es media prueba.
  class RequestDeWorker {
    constructor(entrada, opciones = {}) {
      this.url = absoluta(entrada);
      this.method = String(opciones.method || 'GET').toUpperCase();
      this.mode = opciones.mode || 'no-cors';
      this.destination = opciones.destination || '';
      this.cache = opciones.cache || 'default';
    }
  }

  // eslint-disable-next-line no-new-func
  const ejecutar = new Function('self', 'caches', 'fetch', 'Response', 'Request', 'URL', 'setTimeout', 'clearTimeout', 'TextDecoder', FUENTE);
  ejecutar(self, almacen.api, red, Response, RequestDeWorker, URL, setTimeout, clearTimeout, TextDecoder);

  const disparar = async (tipo) => {
    let esperado;
    await oyentes.get(tipo)({ waitUntil: (valor) => { esperado = valor; } });
    await esperado;
  };

  return {
    instalar: () => disparar('install'),
    activar: () => disparar('activate'),
    responder: async (solicitud) => {
      let prometida;
      oyentes.get('fetch')({ request: solicitud, respondWith: (valor) => { prometida = valor; } });
      return prometida;
    },
    entradas: (nombre = NOMBRE_CACHE) => [...(almacen.almacenes.get(nombre)?.keys() || [])],
    guardada: (url, nombre = NOMBRE_CACHE) => almacen.almacenes.get(nombre)?.get(absoluta(url)),
    nombresDeCache: () => [...almacen.almacenes.keys()],
    reclamado: () => reclamado,
  };
}

function pedido(url, { destination = '', mode = 'no-cors', method = 'GET' } = {}) {
  return { url: absoluta(url), destination, mode, method };
}

const css = (cuerpo = 'body{background:#090b0e}') => new Response(cuerpo, {
  status: 200,
  headers: { 'content-type': 'text/css; charset=utf-8' },
});
const js = (cuerpo = 'export const ok = 1;') => new Response(cuerpo, {
  status: 200,
  headers: { 'content-type': 'text/javascript; charset=utf-8' },
});
const html = (cuerpo = '<!doctype html><title>TABA2</title>') => new Response(cuerpo, {
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
});
const portalCautivo = () => new Response('<!doctype html><h1>Iniciá sesión en la red</h1>', {
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
});

/** Red sana: contesta cada asset con el tipo que su extensión promete. */
function redSana(transformar = null) {
  return async (solicitud) => {
    const url = absoluta(solicitud);
    const ruta = url.split('?')[0];
    const personalizada = transformar?.(ruta, url);
    if (personalizada) return personalizada;
    if (ruta.endsWith('.css')) return css();
    if (ruta.endsWith('.js') || ruta.endsWith('.mjs')) return js();
    return html();
  };
}

const ESTILOS = './styles.css?v=50';

test('un manifiesto nuevo rota la caché y nunca instala un precache mezclado', async () => {
  const cacheAnterior = 'la-taba-runtime-v63-rc-final';
  assert.notEqual(
    NOMBRE_CACHE,
    cacheAnterior,
    'agregar assets con el mismo CACHE_NAME mezcla bytes de dos publicaciones',
  );
  const worker = cargarWorker({
    red: redSana((ruta) => (ruta.endsWith('/js/state.js')
      ? new Response('caído', { status: 503, headers: { 'content-type': 'text/plain' } })
      : null)),
    cachesPrevias: { [cacheAnterior]: [[ESTILOS, css('body{background:#anterior}')]] },
  });

  await assert.rejects(worker.instalar());
  assert.deepEqual(worker.nombresDeCache(), [cacheAnterior]);
  assert.match(await worker.guardada(ESTILOS, cacheAnterior).clone().text(), /anterior/);
});

/*
 * Tope de seguridad de la propia prueba. Contra un worker SIN plazo, esperar la
 * respuesta es esperar para siempre: la suite entera se colgaría en vez de
 * fallar. El tope tiene que ser holgadamente mayor que el plazo del worker.
 */
const SE_COLGO = Symbol('se-colgo');
function conTope(promesa, ms = 8_000) {
  let temporizador;
  const vencimiento = new Promise((resolve) => { temporizador = setTimeout(() => resolve(SE_COLGO), ms); });
  return Promise.race([promesa.finally(() => clearTimeout(temporizador)), vencimiento]);
}

// ---------------------------------------------------------------------------
// 1. El portal cautivo no puede entrar a la caché durante la instalación.
// ---------------------------------------------------------------------------

test('instalar sobre un portal cautivo NO guarda su página como hoja de estilos', async () => {
  const worker = cargarWorker({ red: async () => portalCautivo() });

  await assert.rejects(worker.instalar());

  assert.equal(
    worker.guardada(ESTILOS),
    undefined,
    'la página del portal cautivo quedó guardada como styles.css: a partir de acá la defensa de lectura devuelve basura',
  );
});

test('instalar sobre un portal cautivo tampoco guarda su página como módulo', async () => {
  const worker = cargarWorker({ red: async () => portalCautivo() });

  await assert.rejects(worker.instalar());

  assert.equal(worker.guardada('./js/app.js?v=41'), undefined);
  assert.equal(worker.guardada('./js/state.js'), undefined);
});

test('con la red sana el precache queda completo, como siempre', async () => {
  const worker = cargarWorker({ red: redSana() });

  await worker.instalar();

  assert.equal(worker.entradas().length, assetsDeclarados().length);
  assert.match(await worker.guardada(ESTILOS).clone().text(), /background:#090b0e/);
});

test('un asset que contesta mal aborta el worker nuevo sin dejar caché parcial', async () => {
  // Un despliegue a medio publicar: una hoja de la cadena todavía no está.
  const worker = cargarWorker({
    red: redSana((ruta) => (ruta.endsWith('/styles/tracking.css')
      ? new Response('<!doctype html><h1>404</h1>', { status: 404, headers: { 'content-type': 'text/html' } })
      : null)),
  });

  await assert.rejects(worker.instalar());

  assert.equal(worker.entradas().length, 0);
  assert.equal(worker.guardada(ESTILOS), undefined);
  assert.equal(worker.guardada('./styles/tracking.css?v=50'), undefined);
});

test('la instalación falla limpia cuando la red rechaza entera', async () => {
  const worker = cargarWorker({ red: async () => { throw new TypeError('Load failed'); } });

  await assert.rejects(worker.instalar());

  assert.equal(worker.entradas().length, 0);
});

// ---------------------------------------------------------------------------
// 2. `activate` no puede tirar la copia vieja si la nueva quedó a medias.
// ---------------------------------------------------------------------------

test('activate borra las cachés viejas cuando el precache nuevo quedó completo', async () => {
  const worker = cargarWorker({
    red: redSana(),
    cachesPrevias: { [`${PREFIJO_CACHE}v60-vieja`]: [[ESTILOS, css('body{background:#111}')]] },
  });

  await worker.instalar();
  await worker.activar();

  assert.deepEqual(worker.nombresDeCache(), [NOMBRE_CACHE]);
  assert.ok(worker.reclamado(), 'clients.claim() sigue siendo parte del contrato');
});

test('un precache incompleto no llega a activate y conserva la caché vieja', async () => {
  const vieja = `${PREFIJO_CACHE}v60-vieja`;
  const worker = cargarWorker({
    red: redSana((ruta) => (ruta.endsWith('.css')
      ? new Response('<!doctype html><h1>503</h1>', { status: 503, headers: { 'content-type': 'text/html' } })
      : null)),
    cachesPrevias: { [vieja]: [[ESTILOS, css('body{background:#111}')]] },
  });

  await assert.rejects(worker.instalar());

  assert.ok(
    worker.nombresDeCache().includes(vieja),
    'se borró la copia vieja teniendo un precache nuevo incompleto: el cliente queda peor que antes de actualizar',
  );

  assert.deepEqual(worker.nombresDeCache(), [vieja]);
});

// ---------------------------------------------------------------------------
// 3. Una caché envenenada por un worker anterior no se sirve.
// ---------------------------------------------------------------------------

test('una copia guardada que es HTML no se entrega donde va CSS, aunque esté en la caché', async () => {
  // Es el estado en el que quedó cualquier cliente que instaló la versión
  // anterior sobre una red con portal cautivo. Al no cambiar el nombre de la
  // caché, ese envenenamiento se hereda.
  const worker = cargarWorker({
    red: async () => new Response('<!doctype html><h1>503</h1>', { status: 503, headers: { 'content-type': 'text/html' } }),
    cachesPrevias: { [NOMBRE_CACHE]: [[ESTILOS, portalCautivo()]] },
  });

  const respuesta = await worker.responder(pedido(ESTILOS, { destination: 'style' }));

  assert.notEqual(
    (respuesta.headers.get('content-type') || '').includes('text/html') && respuesta.status === 200,
    true,
    'se entregó la página del portal cautivo desde la caché como hoja de estilos',
  );
  assert.equal(respuesta.status, 503, 'sin copia utilizable, el contrato es entregar lo que dio la red');
});

test('una copia guardada sana se sigue entregando igual', async () => {
  const worker = cargarWorker({
    red: async () => new Response('<!doctype html><h1>503</h1>', { status: 503, headers: { 'content-type': 'text/html' } }),
    cachesPrevias: { [NOMBRE_CACHE]: [[ESTILOS, css()]] },
  });

  const respuesta = await worker.responder(pedido(ESTILOS, { destination: 'style' }));
  assert.match(await respuesta.text(), /background:#090b0e/);
});

// ---------------------------------------------------------------------------
// 4. La red que no contesta ni rechaza.
// ---------------------------------------------------------------------------

test('una red que se cuelga entrega la copia guardada en vez de esperar para siempre', async () => {
  const worker = cargarWorker({
    red: () => new Promise(() => undefined), // nunca resuelve, nunca rechaza
    cachesPrevias: { [NOMBRE_CACHE]: [[ESTILOS, css()]] },
  });

  const respuesta = await conTope(worker.responder(pedido(ESTILOS, { destination: 'style' })));

  assert.notEqual(respuesta, SE_COLGO, 'el worker se quedó esperando a una red muda teniendo la copia buena al lado');
  assert.match(await respuesta.text(), /background:#090b0e/);
});

test('sin copia guardada, una red lenta se sigue esperando: no se inventa un error', async () => {
  let resolver;
  const worker = cargarWorker({
    red: () => new Promise((resolve) => { resolver = resolve; }),
  });

  const prometida = worker.responder(pedido(ESTILOS, { destination: 'style' }));
  // Bastante más que el plazo del worker: sin nada mejor que ofrecer, esperar
  // es lo correcto. Cortar acá sería romper una carga que iba a terminar bien.
  await new Promise((resolve) => { setTimeout(resolve, 5_500); });
  resolver(css('body{background:#abc}'));

  const respuesta = await prometida;
  assert.match(await respuesta.text(), /background:#abc/);
});

test('la red lenta que termina bien igual actualiza la caché', async () => {
  let resolver;
  const worker = cargarWorker({
    red: () => new Promise((resolve) => { resolver = resolve; }),
    cachesPrevias: { [NOMBRE_CACHE]: [[ESTILOS, css('body{background:#viejo}')]] },
  });

  const respuesta = await conTope(worker.responder(pedido(ESTILOS, { destination: 'style' })));
  assert.notEqual(respuesta, SE_COLGO, 'el worker se quedó esperando a una red muda teniendo la copia buena al lado');
  assert.match(await respuesta.text(), /viejo/, 'mientras la red no contesta gana la copia guardada');

  resolver(css('body{background:#nuevo}'));
  await new Promise((resolve) => { setTimeout(resolve, 50); });

  assert.match(
    await worker.guardada(ESTILOS).clone().text(),
    /nuevo/,
    'la respuesta que llegó tarde tenía que quedar guardada para la próxima',
  );
});

// ---------------------------------------------------------------------------
// 5. El borde que además miente en el content-type.
// ---------------------------------------------------------------------------

test('HTML servido con content-type de CSS ya no llega al documento si hay copia guardada', async () => {
  const worker = cargarWorker({
    red: async () => new Response('<!doctype html><h1>portal</h1>', {
      status: 200,
      headers: { 'content-type': 'text/css; charset=utf-8' },
    }),
    cachesPrevias: { [NOMBRE_CACHE]: [[ESTILOS, css()]] },
  });

  const respuesta = await worker.responder(pedido(ESTILOS, { destination: 'style' }));

  assert.match(
    await respuesta.text(),
    /background:#090b0e/,
    'el borde mintió en el tipo y la mentira llegó al documento: styles.css es la cadena entera de la tienda',
  );
});

test('HTML servido con content-type de CSS tampoco se guarda', async () => {
  const worker = cargarWorker({
    red: async () => new Response('<!doctype html><h1>portal</h1>', {
      status: 200,
      headers: { 'content-type': 'text/css; charset=utf-8' },
    }),
    cachesPrevias: { [NOMBRE_CACHE]: [[ESTILOS, css()]] },
  });

  await worker.responder(pedido(ESTILOS, { destination: 'style' }));
  await new Promise((resolve) => { setTimeout(resolve, 50); });

  assert.match(await worker.guardada(ESTILOS).clone().text(), /background:#090b0e/);
});

test('una hoja de estilos de verdad que empieza con un comentario pasa sin problema', async () => {
  // El control mira el arranque del cuerpo. Un CSS real puede empezar con
  // comentarios, con un `@charset` o con espacios: nada de eso puede confundirse
  // con una página HTML.
  for (const cuerpo of [
    '/* TABA2 */\n@import url("./styles/tokens.css");',
    '@charset "utf-8";\nbody{color:#fff}',
    '\n\n  body{color:#fff}',
    ':root{--brand:#e11}',
  ]) {
    const worker = cargarWorker({ red: async () => css(cuerpo) });
    const respuesta = await worker.responder(pedido(ESTILOS, { destination: 'style' }));
    assert.equal(respuesta.status, 200);
    assert.equal(await respuesta.text(), cuerpo);
  }
});

test('un módulo con el tipo mentido se desmiente CUANDO hay copia guardada', async () => {
  /*
   * `startup-recovery.js` —el que le da al cliente el cartel con el botón— es un
   * script clásico. Un borde que miente el `content-type` de los `.js` lo rompe
   * A ÉL también, así que el cliente no se queda con una tienda muerta: se queda
   * con una tienda muerta Y SIN SALIDA. Por eso, en el cliente que tiene algo
   * guardado, el módulo también se contrasta contra su cuerpo.
   */
  const modulo = './js/app.js?v=41';
  const worker = cargarWorker({
    red: async () => new Response('<!doctype html><h1>portal</h1>', {
      status: 200,
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
    }),
    cachesPrevias: { [NOMBRE_CACHE]: [[modulo, js('export const ok = 1;')]] },
  });

  const respuesta = await worker.responder(pedido(modulo, { destination: 'script' }));
  assert.match(await respuesta.text(), /export const ok/);
});

test('sin copia guardada, el módulo mentido NO se inspecciona: mirarlo no cambiaría nada y se paga en cada visita fría', async () => {
  /*
   * La otra mitad de la decisión, y tiene número: sin copia en la caché no hay
   * con qué reemplazar la respuesta, así que leer el cuerpo es puro costo. Se
   * midió con el worker activo: inspeccionar siempre llevaba la primera visita
   * de 167 a 182 pedidos y de 1993 a 2576 KB transferidos, justo en la visita
   * donde la inspección no puede servir para nada.
   */
  const modulo = './js/app.js?v=41';
  const worker = cargarWorker({
    red: async () => new Response('<!doctype html><h1>portal</h1>', {
      status: 200,
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
    }),
  });

  const respuesta = await worker.responder(pedido(modulo, { destination: 'script' }));
  assert.match(await respuesta.text(), /<h1>portal<\/h1>/);
});

test('instalar SÍ mira el cuerpo de los módulos y aborta el worker entero ante HTML', async () => {
  const worker = cargarWorker({
    red: async (solicitud) => {
      const ruta = absoluta(solicitud).split('?')[0];
      if (ruta.endsWith('.js') || ruta.endsWith('.mjs')) {
        return new Response('<!doctype html><h1>portal</h1>', {
          status: 200,
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
        });
      }
      return ruta.endsWith('.css') ? css() : html();
    },
  });

  await assert.rejects(worker.instalar());

  assert.equal(worker.guardada('./js/app.js?v=41'), undefined);
  assert.equal(worker.guardada('./js/state.js'), undefined);
  assert.equal(worker.guardada(ESTILOS), undefined);
});

// ---------------------------------------------------------------------------
// 6. Lo que no debía cambiar.
// ---------------------------------------------------------------------------

test('un 429 del borde tampoco reemplaza a la copia guardada', async () => {
  const worker = cargarWorker({
    red: async () => new Response('rate limited', { status: 429, headers: { 'content-type': 'text/plain' } }),
    cachesPrevias: { [NOMBRE_CACHE]: [[ESTILOS, css()]] },
  });

  const respuesta = await worker.responder(pedido(ESTILOS, { destination: 'style' }));
  assert.match(await respuesta.text(), /background:#090b0e/);
});

test('los pedidos que no son GET y los de otro origen siguen sin pasar por el worker', async () => {
  let pedidosALaRed = 0;
  const worker = cargarWorker({ red: async () => { pedidosALaRed += 1; return css(); } });

  assert.equal(await worker.responder(pedido(ESTILOS, { method: 'POST' })), undefined);
  assert.equal(await worker.responder(pedido('https://otro.example/x.css')), undefined);
  assert.equal(pedidosALaRed, 0);
});

test('una navegación sin red sigue recibiendo el shell guardado', async () => {
  const worker = cargarWorker({
    red: async () => { throw new TypeError('Load failed'); },
    cachesPrevias: { [NOMBRE_CACHE]: [['./index.html', html()]] },
  });

  const respuesta = await worker.responder(pedido('./', { mode: 'navigate', destination: 'document' }));
  assert.match(await respuesta.text(), /TABA2/);
});
