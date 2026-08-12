import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelayAuthority, normalizeRelayRoom } from './realtime-relay-state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = readPort(process.argv[2] || process.env.PORT || '8080');
const MAX_BODY_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 25_000;
const authority = createRelayAuthority({ stateDir: process.env.TABA_RELAY_STATE_DIR || '' });
const clientsByRoom = new Map();

await authority.load();

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch(() => {
    if (!response.headersSent) sendJson(response, 500, { ok: false, error: 'internal_error' });
    else response.end();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const persistence = process.env.TABA_RELAY_STATE_DIR ? 'enabled' : 'disabled';
  console.log(`TABA relay listening on http://0.0.0.0:${PORT} (persistence ${persistence})`);
});

const heartbeat = setInterval(() => {
  for (const clients of clientsByRoom.values()) {
    for (const response of clients) {
      try { response.write(': heartbeat\n\n'); } catch (_) { /* disconnected */ }
    }
  }
}, HEARTBEAT_MS);
heartbeat.unref?.();

const expirySweep = setInterval(() => {
  authority.cleanupExpired().catch(() => undefined);
}, 60 * 60 * 1000);
expirySweep.unref?.();

async function handleRequest(request, response) {
  setCorsHeaders(response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/health' && request.method === 'GET') {
    sendJson(response, 200, {
      ok: true,
      rooms: authority.roomCount(),
      persistence: Boolean(process.env.TABA_RELAY_STATE_DIR),
    });
    return;
  }

  if (url.pathname === '/snapshot' && request.method === 'GET') {
    const result = authority.snapshot(url.searchParams.get('room'), url.searchParams.get('key'));
    if (!result.ok) return sendAuthorityError(response, result);
    sendJson(response, 200, publicRoom(result.record));
    return;
  }

  if (url.pathname === '/events' && request.method === 'GET') {
    openEventStream(request, response, url);
    return;
  }

  if (url.pathname === '/publish' && request.method === 'POST') {
    const room = normalizeRelayRoom(url.searchParams.get('room'));
    const key = url.searchParams.get('key');
    const authenticated = authority.snapshot(room, key);
    if (!authenticated.ok) return sendAuthorityError(response, authenticated);
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object') {
      sendJson(response, 400, { ok: false, error: 'invalid_json' });
      return;
    }

    if (body.kind === 'hello') {
      sendJson(response, 200, {
        ok: true,
        accepted: false,
        revision: authenticated.record.revision,
        delivered: 0,
      });
      return;
    }
    if (body.kind !== 'state') {
      sendJson(response, 400, { ok: false, error: 'invalid_kind' });
      return;
    }

    const incoming = body.snapshot && typeof body.snapshot === 'object' ? body.snapshot : body;
    const result = await authority.publish(room, key, incoming, body.sender);
    if (!result.ok) return sendAuthorityError(response, result);
    let delivered = 0;
    if (result.accepted) {
      delivered = broadcast(room, stateMessage(result.record));
    }
    sendJson(response, 200, {
      ok: true,
      accepted: result.accepted,
      revision: result.record.revision,
      updatedAt: result.record.updatedAt,
      delivered,
    });
    return;
  }

  if (url.pathname === '/reset' && request.method === 'POST') {
    const room = normalizeRelayRoom(url.searchParams.get('room'));
    const result = await authority.reset(room, url.searchParams.get('key'), 'reset');
    if (!result.ok) return sendAuthorityError(response, result);
    const delivered = broadcast(room, {
      kind: 'reset',
      room,
      revision: result.record.revision,
      updatedAt: result.record.updatedAt,
      snapshot: result.record.snapshot,
    });
    sendJson(response, 200, {
      ok: true,
      accepted: true,
      revision: result.record.revision,
      delivered,
    });
    return;
  }

  /*
   * Sólo para el gate: deja que una prueba degrade el borde como se degrada de
   * verdad. Hace falta porque el service worker es el que decide qué recibe el
   * documento, y los `fetch` de un worker NO pasan por `page.route()`: sin un
   * servidor que pueda contestar mal, el defecto del retorno desde Mercado Pago
   * no se puede reproducir de forma automática. Vive en el relay de pruebas, no
   * en el cliente ni en la lista de precache.
   */
  if (url.pathname === '/__edge-fault' && request.method === 'GET') {
    edgeFault = EDGE_FAULTS.has(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'off';
    // Un modo `hang` deja sockets abiertos a propósito. Al apagar la falla hay
    // que soltarlos, o la prueba siguiente arranca con el servidor tomado.
    if (edgeFault === 'off') soltarRespuestasColgadas();
    sendJson(response, 200, { ok: true, mode: edgeFault });
    return;
  }

  if (url.pathname.startsWith('/events')
    || url.pathname.startsWith('/publish')
    || url.pathname.startsWith('/snapshot')
    || url.pathname.startsWith('/reset')) {
    sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  serveStatic(response, url.pathname);
}

function openEventStream(request, response, url) {
  const room = normalizeRelayRoom(url.searchParams.get('room'));
  const result = authority.snapshot(room, url.searchParams.get('key'));
  if (!result.ok) return sendAuthorityError(response, result);

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });

  const clients = clientsByRoom.get(room) || new Set();
  clients.add(response);
  clientsByRoom.set(room, clients);
  writeEvent(response, 'ready', {
    room,
    revision: result.record.revision,
    updatedAt: result.record.updatedAt,
    connectedClients: clients.size,
  });
  writeEvent(response, 'message', stateMessage(result.record));

  request.on('close', () => {
    clients.delete(response);
    if (!clients.size) clientsByRoom.delete(room);
  });
}

function stateMessage(record) {
  return {
    kind: 'state',
    room: record.room,
    revision: record.revision,
    updatedAt: record.updatedAt,
    publisher: record.lastPublisher || null,
    snapshot: record.snapshot,
    orders: record.snapshot.orders,
    lastOrderId: record.snapshot.lastOrderId,
    simulation: record.snapshot.simulation,
  };
}

function publicRoom(record) {
  return {
    ok: true,
    room: record.room,
    revision: record.revision,
    snapshot: record.snapshot,
    updatedAt: record.updatedAt,
    publisher: record.lastPublisher || null,
    connectedClients: clientsByRoom.get(record.room)?.size || 0,
  };
}

function broadcast(room, payload) {
  const clients = clientsByRoom.get(room);
  if (!clients) return 0;
  let delivered = 0;
  for (const response of clients) {
    try {
      writeEvent(response, 'message', payload);
      delivered += 1;
    } catch (_) {
      clients.delete(response);
    }
  }
  if (!clients.size) clientsByRoom.delete(room);
  return delivered;
}

function writeEvent(response, event, data) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch (_) {
    return null;
  }
}

function sendAuthorityError(response, result) {
  sendJson(response, result.status || 400, { ok: false, error: result.code || 'request_rejected' });
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/*
 * Las formas en que un borde contesta MAL sin dejar de contestar. Ninguna
 * rechaza la promesa de `fetch`, que es justamente lo que las hacía invisibles:
 * el respaldo del worker vivía en un `catch` y un `catch` sólo corre cuando la
 * red RECHAZA.
 *
 *   *-503 / *-404 / *-429   el borde contesta un error
 *   *-captive               200 con la página del portal cautivo (HTML)
 *   *-mime-lie              200 con HTML pero DECLARANDO el tipo correcto
 *   css-truncated           200, tipo correcto, y el cuerpo se corta a la mitad
 *   *-hang                  ni contesta ni corta: el caso sin `catch` ni estado
 *
 * Vive en el relay de pruebas, no en el cliente ni en la lista de precache. Hace
 * falta acá porque los `fetch` de un service worker NO pasan por `page.route()`.
 */
const EDGE_FAULTS = new Set([
  'off',
  'css-503', 'css-404', 'css-429', 'css-captive', 'css-mime-lie', 'css-truncated', 'css-hang',
  'js-503', 'js-404', 'js-captive', 'js-mime-lie', 'js-hang',
  'all-503', 'all-hang',
]);
let edgeFault = 'off';
const respuestasColgadas = new Set();

function soltarRespuestasColgadas() {
  respuestasColgadas.forEach((response) => { try { response.destroy(); } catch (_) { /* ya cerrada */ } });
  respuestasColgadas.clear();
}

function fallaAplicable(fault, extension) {
  if (fault === 'off') return null;
  const esCss = extension === '.css';
  const esJs = extension === '.js' || extension === '.mjs';
  if (fault.startsWith('all-')) return fault.slice(4);
  if (fault.startsWith('css-') && esCss) return fault.slice(4);
  if (fault.startsWith('js-') && esJs) return fault.slice(3);
  return null;
}

function responderDegradado(response, modo, tipoReal) {
  if (modo === 'hang') {
    // Ni cabecera ni cierre. El socket queda abierto y el cliente esperando.
    respuestasColgadas.add(response);
    response.on('close', () => respuestasColgadas.delete(response));
    return;
  }
  if (modo === 'captive') {
    // Un portal cautivo contesta 200 con SU página. El estado dice que salió
    // bien; el cuerpo es HTML donde se esperaba CSS o un módulo.
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Red</title><h1>Iniciá sesión en la red</h1>');
    return;
  }
  if (modo === 'mime-lie') {
    // El borde miente dos veces: cuerpo de HTML y tipo declarado correcto. Es el
    // único caso que el contraste de `content-type` no puede ver.
    response.writeHead(200, { 'Content-Type': tipoReal });
    response.end('<!doctype html><title>Red</title><h1>Iniciá sesión en la red</h1>');
    return;
  }
  if (modo === 'truncated') {
    // Estado, tipo y longitud correctos; el cuerpo se corta a la mitad. El
    // `fetch` RESUELVE y el error aparece recién al leer el cuerpo.
    const cuerpo = 'body{background:#090b0e}.brand{width:90px}';
    response.writeHead(200, { 'Content-Type': tipoReal, 'Content-Length': String(cuerpo.length * 4) });
    response.write(cuerpo.slice(0, 12));
    setTimeout(() => { try { response.destroy(); } catch (_) { /* ya cerrada */ } }, 30);
    return;
  }
  const status = Number(modo) || 503;
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><title>${status}</title><h1>${status}</h1>`);
}

function serveStatic(response, rawPathname) {
  let pathname = '/';
  try { pathname = decodeURIComponent(rawPathname || '/'); } catch (_) { /* invalid path */ }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');

  const extension = path.extname(relative).toLowerCase();
  const modo = fallaAplicable(edgeFault, extension);
  if (modo) {
    responderDegradado(response, modo, contentType(relative));
    return;
  }

  let target = path.resolve(ROOT, relative);
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== ROOT) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  } catch (_) {
    if (!path.extname(relative)) target = path.join(ROOT, 'index.html');
  }

  fs.readFile(target, (error, data) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentType(target),
      'Cache-Control': 'no-cache',
    });
    response.end(data);
  });
}

function contentType(file) {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.woff2': 'font/woff2',
  })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function readPort(value) {
  const port = Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Port must be between 1024 and 65535.');
  }
  return port;
}
