/*
 * El service worker frente a un borde que contesta MAL sin dejar de contestar.
 *
 * El defecto que fija esta suite es el P1 del retorno desde Mercado Pago: la
 * tienda volvía sin estilos —fondo blanco, iconos gigantes, la barra inferior
 * despegada— con el HTML entero y el carrito intacto detrás. La causa no estaba
 * en el CSS ni en el router: el respaldo en caché del worker vivía dentro de un
 * `catch`, y un `catch` sólo corre cuando la red RECHAZA. Un 503 del borde, un
 * 404 de un despliegue a medio publicar y la página de un portal cautivo son
 * promesas RESUELTAS: el worker las entregaba tal cual, con la copia buena
 * guardada al lado.
 *
 * Se prueba el handler de verdad, no la forma del fuente: `sw.js` se evalúa
 * dentro de un alcance de worker falso y se le entregan eventos `fetch`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEN = 'https://taba.test';

/**
 * Los pedidos son objetos planos a propósito: el handler sólo lee `method`,
 * `url`, `mode` y `destination`, y `destination` no se puede fijar sobre un
 * `Request` real.
 */
function pedido(url, { destination = '', mode = 'no-cors', method = 'GET' } = {}) {
  return { url: new URL(url, ORIGEN).href, destination, mode, method };
}

function cargarWorker({ red, enCache = [] }) {
  const oyentes = new Map();
  const almacenes = new Map();

  const clave = (solicitud) => (typeof solicitud === 'string'
    ? new URL(solicitud, ORIGEN).href
    : solicitud.url);

  const abrir = (nombre) => {
    if (!almacenes.has(nombre)) almacenes.set(nombre, new Map());
    const mapa = almacenes.get(nombre);
    return {
      put: async (solicitud, respuesta) => { mapa.set(clave(solicitud), respuesta); },
      match: async (solicitud) => mapa.get(clave(solicitud)),
      keys: async () => [...mapa.keys()],
      addAll: async () => undefined,
    };
  };

  const caches = {
    open: async (nombre) => abrir(nombre),
    match: async (solicitud) => {
      for (const mapa of almacenes.values()) {
        const encontrado = mapa.get(clave(solicitud));
        if (encontrado) return encontrado;
      }
      return undefined;
    },
    keys: async () => [...almacenes.keys()],
    delete: async (nombre) => almacenes.delete(nombre),
  };

  const self = {
    location: new URL(`${ORIGEN}/`),
    addEventListener: (tipo, oyente) => oyentes.set(tipo, oyente),
    clients: { claim: async () => undefined },
    skipWaiting: () => undefined,
  };

  const fuente = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  // eslint-disable-next-line no-new-func
  const ejecutar = new Function('self', 'caches', 'fetch', 'Response', 'URL', fuente);
  ejecutar(self, caches, red, Response, URL);

  const nombreCache = fuente.match(/const CACHE_NAME = '([^']+)'/)[1];
  const cache = abrir(nombreCache);
  enCache.forEach(([url, respuesta]) => { almacenes.get(nombreCache).set(new URL(url, ORIGEN).href, respuesta); });

  return {
    responder: async (solicitud) => {
      let prometida;
      oyentes.get('fetch')({ request: solicitud, respondWith: (valor) => { prometida = valor; } });
      return prometida;
    },
    cache,
    almacenes,
    nombreCache,
  };
}

const hojaBuena = () => new Response('body{background:#090b0e}', {
  status: 200,
  headers: { 'content-type': 'text/css; charset=utf-8' },
});
const errorDelBorde = (status) => new Response(`<!doctype html><h1>${status}</h1>`, {
  status,
  headers: { 'content-type': 'text/html; charset=utf-8' },
});
const portalCautivo = () => new Response('<!doctype html><h1>Iniciá sesión en la red</h1>', {
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
});

const ESTILOS = `${ORIGEN}/styles.css?v=50`;

for (const status of [503, 404, 500, 403]) {
  test(`un ${status} del borde no reemplaza a la hoja de estilos guardada`, async () => {
    const worker = cargarWorker({
      red: async () => errorDelBorde(status),
      enCache: [[ESTILOS, hojaBuena()]],
    });

    const respuesta = await worker.responder(pedido(ESTILOS, { destination: 'style' }));

    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.match(await respuesta.text(), /background:#090b0e/);
  });
}

test('un 200 con HTML donde se pidió CSS tampoco pasa: es un portal cautivo', async () => {
  const worker = cargarWorker({
    red: async () => portalCautivo(),
    enCache: [[ESTILOS, hojaBuena()]],
  });

  const respuesta = await worker.responder(pedido(ESTILOS, { destination: 'style' }));

  assert.equal(respuesta.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.match(await respuesta.text(), /background:#090b0e/);
});

test('la página del portal cautivo NO se guarda: envenenaría la caché hasta la próxima publicación', async () => {
  const worker = cargarWorker({
    red: async () => portalCautivo(),
    enCache: [[ESTILOS, hojaBuena()]],
  });

  await worker.responder(pedido(ESTILOS, { destination: 'style' }));
  await new Promise((resolve) => setImmediate(resolve));

  const guardada = await worker.cache.match(ESTILOS);
  assert.match(await guardada.text(), /background:#090b0e/);
});

test('un módulo servido como HTML tampoco pasa', async () => {
  const modulo = `${ORIGEN}/js/app.js?v=41`;
  const worker = cargarWorker({
    red: async () => portalCautivo(),
    enCache: [[modulo, new Response('export const ok = 1;', {
      status: 200,
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
    })]],
  });

  const respuesta = await worker.responder(pedido(modulo, { destination: 'script' }));

  assert.match(await respuesta.text(), /export const ok/);
});

test('una red que RECHAZA sigue cayendo a la caché, como antes', async () => {
  const worker = cargarWorker({
    red: async () => { throw new TypeError('Load failed'); },
    enCache: [[ESTILOS, hojaBuena()]],
  });

  const respuesta = await worker.responder(pedido(ESTILOS, { destination: 'style' }));
  assert.match(await respuesta.text(), /background:#090b0e/);
});

test('una respuesta sana gana y se guarda: la publicación nueva se sigue viendo sin trucos', async () => {
  const worker = cargarWorker({
    red: async () => new Response('body{background:#000}', {
      status: 200,
      headers: { 'content-type': 'text/css; charset=utf-8' },
    }),
    enCache: [[ESTILOS, hojaBuena()]],
  });

  const respuesta = await worker.responder(pedido(ESTILOS, { destination: 'style' }));
  assert.match(await respuesta.text(), /background:#000/);

  await new Promise((resolve) => setImmediate(resolve));
  const guardada = await worker.cache.match(ESTILOS);
  assert.match(await guardada.text(), /background:#000/);
});

for (const status of [404, 503]) {
  test(`sin copia guardada, el ${status} se entrega tal cual y no se guarda nada`, async () => {
    const worker = cargarWorker({ red: async () => errorDelBorde(status) });

    const respuesta = await worker.responder(pedido(ESTILOS, { destination: 'style' }));
    assert.equal(respuesta.status, status);

    // La otra mitad del contrato: no tener respaldo NO es excusa para guardar
    // basura. Nunca se devuelve algo peor que antes, y tampoco se empeora
    // lo que venga después.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(await worker.cache.match(ESTILOS), undefined);
  });
}

test('sin copia guardada, el portal cautivo se entrega pero NO envenena la caché', async () => {
  const worker = cargarWorker({ red: async () => portalCautivo() });

  const respuesta = await worker.responder(pedido(ESTILOS, { destination: 'style' }));
  assert.equal(respuesta.status, 200);

  // Este es el caso que `response.ok` solo no cubre: la respuesta dice 200 y
  // sin el control de tipo se habría guardado. Guardarla dejaba al cliente con
  // la página del portal como hoja de estilos hasta la próxima publicación.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await worker.cache.match(ESTILOS), undefined);
});

test('el control de tipo es sólo para estilos y módulos: una imagen o un fetch de la app no se filtran', async () => {
  const imagen = `${ORIGEN}/assets/icon.svg`;
  const worker = cargarWorker({
    red: async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', {
      status: 200,
      headers: { 'content-type': 'image/svg+xml' },
    }),
  });

  // `destination` vacío es lo que trae un `fetch()` del propio cliente. Ahí no
  // hay nada que contrastar y el contrato sigue siendo el de siempre: un 200
  // pasa y se guarda.
  const respuesta = await worker.responder(pedido(imagen, { destination: '' }));
  assert.equal(respuesta.status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(await worker.cache.match(imagen));
});

/*
 * Este era el límite conocido, y quedó dado vuelta a propósito.
 *
 * Decía: el worker contrasta el tipo DECLARADO, no el cuerpo, así que un borde
 * que además MIENTE en el `content-type` —HTML servido como `text/css`— pasa. El
 * test existía para que nadie supusiera una cobertura que no existía, con la
 * nota de que si alguna vez aparecía un borde así, había que darlo vuelta.
 *
 * Se cierra sólo para `style`, y por una razón asimétrica: una hoja que llega
 * como HTML no avisa a NADIE —cero reglas, la tienda apagada, que es exactamente
 * la pantalla reportada— mientras que un módulo que llega como HTML falla fuerte
 * y `startup-recovery.js` ya le da salida al cliente. El detalle de costo está
 * en `sw.js`: se lee el primer trozo de un clon y se cancela, no se buferea.
 * La contracara —que un módulo mentido sigue pasando— está fijada en
 * `service-worker-install-and-timeout.test.mjs`.
 */
test('HTML con content-type de CSS ya NO pasa: el arranque del cuerpo lo desmiente', async () => {
  const worker = cargarWorker({
    red: async () => new Response('<!doctype html><h1>portal</h1>', {
      status: 200,
      headers: { 'content-type': 'text/css; charset=utf-8' },
    }),
    enCache: [[ESTILOS, hojaBuena()]],
  });

  const respuesta = await worker.responder(pedido(ESTILOS, { destination: 'style' }));
  assert.match(await respuesta.text(), /background:#090b0e/);
});

test('una navegación sin red recibe el shell guardado', async () => {
  const worker = cargarWorker({
    red: async () => { throw new TypeError('Load failed'); },
    enCache: [[`${ORIGEN}/index.html`, new Response('<!doctype html><title>TABA2</title>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })]],
  });

  const respuesta = await worker.responder(pedido(`${ORIGEN}/`, { mode: 'navigate', destination: 'document' }));
  assert.match(await respuesta.text(), /TABA2/);
});

test('una vuelta de pago sin red recibe su página dedicada, no el shell bajo /pago', async () => {
  const worker = cargarWorker({
    red: async () => { throw new TypeError('Load failed'); },
    enCache: [
      [`${ORIGEN}/index.html`, new Response('<!doctype html><title>TABA2</title>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })],
      [`${ORIGEN}/pago/pendiente/index.html`, new Response('<!doctype html><title>Pago pendiente</title>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })],
    ],
  });

  const respuesta = await worker.responder(pedido(`${ORIGEN}/pago/pendiente`, {
    mode: 'navigate',
    destination: 'document',
  }));
  assert.match(await respuesta.text(), /Pago pendiente/);
});

test('el worker no guarda identificadores de retorno de pago en claves de CacheStorage', async () => {
  const url = `${ORIGEN}/pago/resultado?payment_id=provider-123&collection_id=456`;
  const worker = cargarWorker({
    red: async () => new Response('<!doctype html><title>Pago</title>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  });

  const respuesta = await worker.responder(pedido(url, {
    mode: 'navigate',
    destination: 'document',
  }));
  assert.equal(respuesta.status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await worker.cache.match(url), undefined);
});

test('un subrecurso que no está en la caché NUNCA recibe el shell disfrazado', async () => {
  const worker = cargarWorker({
    red: async () => errorDelBorde(503),
    enCache: [[`${ORIGEN}/index.html`, new Response('<!doctype html><title>TABA2</title>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })]],
  });

  // Con la red rechazando y sin copia propia, el contrato es `Response.error()`:
  // un módulo que recibe el shell de la tienda falla de una manera mucho más
  // difícil de leer que un módulo que directamente no carga.
  const worker2 = cargarWorker({
    red: async () => { throw new TypeError('Load failed'); },
    enCache: [[`${ORIGEN}/index.html`, new Response('<!doctype html><title>TABA2</title>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })]],
  });
  const caida = await worker2.responder(pedido(`${ORIGEN}/js/core/domain.js`, { destination: 'script' }));
  assert.equal(caida.type, 'error');

  // Y con el borde contestando 503, lo que se entrega es ese 503 —no el shell.
  const respuesta = await worker.responder(pedido(`${ORIGEN}/js/core/domain.js`, { destination: 'script' }));
  assert.equal(respuesta.status, 503);
  assert.doesNotMatch(await respuesta.text(), /TABA2/);
});

test('los pedidos que no son GET y los de otro origen siguen sin pasar por el worker', async () => {
  let pedidosALaRed = 0;
  const worker = cargarWorker({ red: async () => { pedidosALaRed += 1; return hojaBuena(); } });

  assert.equal(await worker.responder(pedido(ESTILOS, { method: 'POST' })), undefined);
  assert.equal(await worker.responder(pedido('https://otro.example/x.css')), undefined);
  assert.equal(pedidosALaRed, 0);
});
