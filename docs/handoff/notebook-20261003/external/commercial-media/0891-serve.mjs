/*
 * Servidor estático de captura.
 *
 * Sirve el worktree de TABA2 tal cual, y además monta la carpeta `overlay/`
 * de esta sesión bajo `/__demo/`. El truco es que el compositor del video y
 * la app queden en el MISMO origen: así el <iframe> no sale a un proceso
 * aparte y la grabación de Playwright captura un solo surface compuesto.
 *
 * Uso: node serve.mjs --root D:\1212\la-taba2-... --port 8480
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const ROOT = path.resolve(args.get('root') || '.');
const OVERLAY = path.join(HERE, 'overlay');
const PORT = Number(args.get('port') || 8480);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
};

http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { pathname = '/'; }
  const overlayed = pathname.startsWith('/__demo/');
  const base = overlayed ? OVERLAY : ROOT;
  const rel = overlayed ? pathname.slice('/__demo/'.length) : pathname.slice(1);
  let file = path.resolve(base, rel || 'index.html');
  if (!file.startsWith(base)) { res.writeHead(403).end('no'); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('404 ' + pathname); return; }
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}).listen(PORT, '127.0.0.1', () => console.log(`serve ${ROOT} + /__demo -> :${PORT}`));
