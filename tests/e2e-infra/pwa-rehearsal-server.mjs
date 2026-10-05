// Ensayo físico de MIGRACIÓN de la PWA instalada, sin tocar producción.
//
// Sirve el sitio como Cloudflare Pages —`/index.html` responde 308 a `/`— desde UNO de dos
// árboles intercambiables en caliente: la publicación de producción (v97) o el candidato.
// Detrás de un túnel HTTPS (cloudflared) permite instalar un WebAPK REAL de v97, ver el
// `ERR_FAILED`, publicar el candidato y relanzar la app desde el ícono.
//
//   node tests/e2e-infra/pwa-rehearsal-server.mjs <árbol-v97> <árbol-candidato> [puerto=8765] [control=8766]
//   curl http://127.0.0.1:8766/switch?to=candidate        (el control sólo escucha en loopback)
//
// Sólo sirve el sitio público (lista cerrada de rutas): ni el repositorio, ni las pruebas.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const [v97Root, candidateRoot, portArg = '8765', controlArg = '8766'] = process.argv.slice(2);
if (!v97Root || !candidateRoot) throw new Error('uso: <árbol-v97> <árbol-candidato> [puerto] [control]');
const roots = { v97: path.resolve(v97Root), candidate: path.resolve(candidateRoot) };
let current = 'v97';
const hits = [];
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
// Lo que Pages publica: la raíz del sitio, sin el repositorio ni las pruebas.
const PUBLICO = /^(index\.html|sw\.js|manifest\.webmanifest|runtime-config\.js|styles\.css|robots\.txt|favicon\.ico|(js|styles|assets|catalog|pago|cuenta|agents\/public)\/.*)$/;

// La configuración PÚBLICA de producción (la clave es publicable y viaja en el navegador).
const productionConfig = await (await fetch('https://la-taba.pages.dev/runtime-config.js')).text();

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  hits.push(`${new Date().toISOString().slice(11, 19)} ${current} ${request.method} ${url.pathname}`);
  if (hits.length > 400) hits.shift();
  const headers = { 'cache-control': 'public, max-age=0, must-revalidate' };
  if (url.pathname === '/index.html') {
    response.writeHead(308, { ...headers, location: `/${url.search}` });
    response.end();
    return;
  }
  let relativa = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''));
  if (relativa.endsWith('/')) relativa += 'index.html';
  if (relativa === 'runtime-config.js') {
    response.writeHead(200, { ...headers, 'content-type': TIPOS['.js'] });
    response.end(productionConfig);
    return;
  }
  if (!PUBLICO.test(relativa) || relativa.includes('..')) { response.writeHead(404, headers); response.end('no'); return; }
  const destino = path.resolve(roots[current], relativa);
  fs.readFile(destino, (error, data) => {
    if (error) { response.writeHead(404, headers); response.end('no'); return; }
    response.writeHead(200, { ...headers, 'content-type': TIPOS[path.extname(destino).toLowerCase()] || 'application/octet-stream' });
    response.end(data);
  });
});
server.listen(Number(portArg), '127.0.0.1', () => console.log(`sitio en http://127.0.0.1:${portArg} sirviendo ${current}`));

http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/switch' && roots[url.searchParams.get('to')]) current = url.searchParams.get('to');
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ current, hits: url.pathname === '/hits' ? hits.slice(-60) : undefined }));
}).listen(Number(controlArg), '127.0.0.1', () => console.log(`control en http://127.0.0.1:${controlArg}`));
