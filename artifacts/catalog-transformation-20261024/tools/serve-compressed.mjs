// Servidor estático de MEDICIÓN: imita lo que hace Cloudflare Pages con este sitio
// (compresión brotli/gzip de texto, ETag + 304, `Cache-Control: max-age=0, must-revalidate`
// y las cabeceras de `_headers`) para que los bytes y tiempos medidos se parezcan a
// producción. No es el servidor de las pruebas (ese es scripts/realtime-relay.mjs, sin
// tocar) y NO implementa el relay en vivo: sólo sirve archivos estáticos.
//
//   node artifacts/catalog-transformation-20261024/tools/serve-compressed.mjs 8262 [raiz]
import http from 'node:http';
import http2 from 'node:http2';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const PORT = Number(process.argv[2] || 8262);
const ROOT = path.resolve(process.argv[3] || '.');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const COMPRESIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.webmanifest', '.txt', '.ico']);
const cache = new Map();
// GIT_BASE_FILES=js/a.js,index.html sirve esos archivos como estaban en HEAD (comparación A/B sin
// tocar el árbol de trabajo): así «antes» y «después» salen del mismo servidor y la misma red.
const DESDE_HEAD = new Set((process.env.GIT_BASE_FILES || '').split(',').filter(Boolean));
const DESDE_REF = process.env.GIT_BASE_REF || 'HEAD';

function entry(file, stat) {
  const key = `${file}:${stat.mtimeMs}:${stat.size}`;
  if (cache.has(key)) return cache.get(key);
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const raw = DESDE_HEAD.has(rel)
    ? execFileSync('git', ['show', `${DESDE_REF}:${rel}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    : fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const item = { raw, ext, etag: `"${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 20)}"`, br: null, gz: null };
  if (COMPRESIBLE.has(ext) && raw.length > 512) {
    item.br = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
    item.gz = zlib.gzipSync(raw, { level: 6 });
  }
  cache.set(key, item);
  return item;
}

const handler = (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    const item = entry(file, fs.statSync(file));
    const headers = {
      'content-type': TYPES[item.ext] || 'application/octet-stream',
      etag: item.etag,
      'cache-control': rel === '/runtime-config.js' ? 'no-store' : rel === '/manifest.webmanifest' ? 'no-cache' : 'public, max-age=0, must-revalidate',
      'x-content-type-options': 'nosniff',
      vary: 'Accept-Encoding',
    };
    if (req.headers['if-none-match'] === item.etag) { res.writeHead(304, headers).end(); return; }
    const accept = String(req.headers['accept-encoding'] || '');
    let body = item.raw;
    if (item.br && /\bbr\b/.test(accept)) { body = item.br; headers['content-encoding'] = 'br'; }
    else if (item.gz && /\bgzip\b/.test(accept)) { body = item.gz; headers['content-encoding'] = 'gzip'; }
    headers['content-length'] = body.length;
    res.writeHead(200, headers).end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
};

// H2_CERT/H2_KEY: sirve por HTTP/2 sobre TLS (como Cloudflare Pages). Es lo que permite
// medir la cascada de módulos sin el límite de 6 conexiones de HTTP/1.1.
const h2 = process.env.H2_CERT && process.env.H2_KEY;
const server = h2
  ? http2.createSecureServer({ key: fs.readFileSync(process.env.H2_KEY), cert: fs.readFileSync(process.env.H2_CERT), allowHTTP1: true }, handler)
  : http.createServer(handler);
server.listen(PORT, '0.0.0.0', () => console.log(`estático comprimido en ${h2 ? 'https (h2)' : 'http'}://0.0.0.0:${PORT} raíz ${ROOT}`));
