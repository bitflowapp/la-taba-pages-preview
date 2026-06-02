// Relay realtime de demostración para La Taba — SIN dependencias externas.
// Solo usa módulos nativos de Node (http, fs, os, url).
//
// Sirve la app estática Y hace de puente realtime entre celulares en la misma
// red Wi-Fi usando Server-Sent Events (SSE):
//   - GET  /events?room=ROOM   -> stream SSE; cada dispositivo se suscribe a una sala.
//   - POST /publish?room=ROOM   -> reenvía el mensaje JSON a los demás de la sala.
//   - GET  /health              -> chequeo simple.
//
// Es una demo local: los mensajes viajan por la LAN, no se guardan en disco ni
// se mandan a ningún servicio externo. Para producción real se usaría
// Supabase Realtime / Firebase / WebSocket gestionado (ver README).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || Number(process.argv[2]) || 8787;
const HEARTBEAT_MS = 25_000;
const MAX_BODY_BYTES = 256 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

// rooms: Map<roomName, Set<ServerResponse>>
const rooms = new Map();
const lastRoomMessages = new Map();

function roomClients(room) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  return rooms.get(room);
}

function sanitizeRoom(value) {
  return String(value || 'demo').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'demo';
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function handleEvents(req, res, room) {
  setCors(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\n`);
  res.write(`event: ready\ndata: {"room":"${room}"}\n\n`);

  const clients = roomClients(room);
  clients.add(res);
  const lastMessage = lastRoomMessages.get(room);
  if (lastMessage) {
    try { res.write(`event: message\ndata: ${lastMessage.replace(/\n/g, ' ')}\n\n`); } catch (_) { /* ignore */ }
  }

  const heartbeat = setInterval(() => {
    try { res.write(`:ping\n\n`); } catch (_) { /* ignore */ }
  }, HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (clients.size === 0) rooms.delete(room);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}

function handlePublish(req, res, room) {
  setCors(res);
  let size = 0;
  const chunks = [];
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      res.writeHead(413).end('payload too large');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    // Validamos que sea JSON; si no, 400 (no rompemos el relay).
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"ok":false}');
      return;
    }
    if (parsed && parsed.kind === 'state') lastRoomMessages.set(room, raw);
    const clients = rooms.get(room);
    let delivered = 0;
    if (clients) {
      const payload = `event: message\ndata: ${raw.replace(/\n/g, ' ')}\n\n`;
      for (const client of clients) {
        try { client.write(payload); delivered += 1; } catch (_) { /* ignore */ }
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(`{"ok":true,"delivered":${delivered}}`);
  });
}

function handleRoomReset(res, room) {
  setCors(res);
  lastRoomMessages.delete(room);
  const clients = rooms.get(room);
  let delivered = 0;
  if (clients) {
    const raw = JSON.stringify({ kind: 'reset', sender: 'relay', room, ts: Date.now() });
    const payload = `event: message\ndata: ${raw}\n\n`;
    for (const client of clients) {
      try { client.write(payload); delivered += 1; } catch (_) { /* ignore */ }
    }
  }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(`{"ok":true,"room":"${room}","delivered":${delivered}}`);
}

function serveStatic(req, res, pathname) {
  // Normaliza y previene path traversal.
  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(ROOT, safePath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        // Fallback SPA: navegación desconocida -> index.html.
        fs.readFile(path.join(ROOT, 'index.html'), (fallbackErr, html) => {
          if (fallbackErr) { res.writeHead(404).end('not found'); return; }
          res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(html);
        });
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' }).end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const room = sanitizeRoom(url.searchParams.get('room'));

  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204).end();
    return;
  }
  if (url.pathname === '/health') {
    setCors(res);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    return;
  }
  if (url.pathname === '/events' && req.method === 'GET') {
    handleEvents(req, res, room);
    return;
  }
  if (url.pathname === '/publish' && req.method === 'POST') {
    handlePublish(req, res, room);
    return;
  }
  if (url.pathname === '/reset' && req.method === 'POST') {
    handleRoomReset(res, room);
    return;
  }
  if (req.method === 'GET') {
    serveStatic(req, res, url.pathname === '/' ? '/index.html' : url.pathname);
    return;
  }
  res.writeHead(405).end('method not allowed');
});

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  const room = 'demo-review';
  /* eslint-disable no-console */
  console.log(`\nLa Taba · relay realtime demo escuchando en puerto ${PORT}`);
  console.log('Simulación local por LAN. No se guarda nada en disco ni se envía a internet.\n');
  if (ips.length) {
    const ip = ips[0];
    console.log('Probar con dos celulares en la MISMA Wi-Fi:');
    console.log(`  Cliente: http://${ip}:${PORT}/?relay=http://${ip}:${PORT}&room=${room}`);
    console.log(`  Rider:   http://${ip}:${PORT}/?relay=http://${ip}:${PORT}&room=${room}#rider\n`);
  } else {
    console.log(`Local: http://localhost:${PORT}/?relay=http://localhost:${PORT}&room=${room}\n`);
  }
  /* eslint-enable no-console */
});
