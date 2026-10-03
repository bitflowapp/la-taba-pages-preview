/*
 * Servidor estatico del repo con un interruptor de "publicacion nueva".
 * Con .local/PUBLICACION=v86 sirve:
 *   - sw.js con CACHE_NAME v86 y styles.css?v=54
 *   - index.html con styles.css?v=54
 *   - styles.css con una regla nueva (asset visual nuevo)
 * No escribe nada fuera de .local/.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || '.');
const FLAG = path.join(ROOT, '.local', 'PUBLICACION');
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
const roto = () => { try { return fs.existsSync(path.join(ROOT,'.local','ROTO')); } catch { return false; } };
const nueva = () => { try { return fs.readFileSync(FLAG, 'utf8').trim() === 'v86'; } catch { return false; } };

const CONTADOR = {n:0, bytes:0};
process.on('SIGTERM',()=>process.exit(0));
setInterval(()=>{ try{ fs.writeFileSync(path.join(ROOT,'.local','contador.json'), JSON.stringify(CONTADOR)); }catch{} },500).unref?.();
http.createServer((req, res) => {
  CONTADOR.n++;
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const abs = path.join(ROOT, rel);
  if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404');
  }
  if (roto() && rel === '/js/map/taba_map_theme.js') { res.writeHead(404,{'content-type':'text/plain'}); return res.end('no existe'); }
  let cuerpo = fs.readFileSync(abs);
  const ext = path.extname(abs);
  if (nueva()) {
    if (rel === '/sw.js') {
      cuerpo = Buffer.from(String(cuerpo)
        .replace('la-taba-runtime-v85-pildora-del-mapa', 'la-taba-runtime-v86-foto-nueva')
        .replaceAll('?v=53', '?v=54'));
    } else if (rel === '/index.html') {
      cuerpo = Buffer.from(String(cuerpo).replaceAll('?v=53', '?v=54'));
    } else if (rel === '/styles.css') {
      cuerpo = Buffer.concat([cuerpo, Buffer.from('\n/* PUBLICACION NUEVA */\n:root{--taba-marca-nueva:1}\n')]);
    }
  }
  res.writeHead(200, {
    'content-type': TIPOS[ext] || 'application/octet-stream',
    'cache-control': 'public, max-age=0, must-revalidate',
    'service-worker-allowed': '/',
  });
  CONTADOR.bytes += cuerpo.length;
  res.end(cuerpo);
}).listen(4599, () => console.log('sirviendo', ROOT, 'en http://127.0.0.1:4599'));
