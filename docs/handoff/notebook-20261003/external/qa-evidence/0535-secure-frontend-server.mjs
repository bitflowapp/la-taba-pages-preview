import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, resolve, sep } from 'node:path';

const [rootArg, runtimeArg, portArg = '4173'] = process.argv.slice(2);
if (!rootArg || !runtimeArg || !isAbsolute(rootArg) || !isAbsolute(runtimeArg)) {
  throw new Error('Usage: node secure-frontend-server.mjs <absolute-root> <absolute-runtime> [port]');
}

const root = resolve(rootArg);
const runtimePath = resolve(runtimeArg);
const port = Number(portArg);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Invalid port');
}
if (!existsSync(runtimePath)) {
  throw new Error('External runtime config is missing');
}

const blockedSegments = new Set([
  '.git',
  '.env',
  '.local-staging',
  'node_modules',
  'backend',
  'supabase',
]);
const blockedNames = new Set([
  'runtime-config.local.js',
  'device-test-access.txt',
  'session.json',
]);
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.ico', 'image/x-icon'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

function sendText(response, status, text) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(text);
}

function safePath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const normalized = decoded.replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..' || blockedSegments.has(segment.toLowerCase()))) {
    return null;
  }
  if (segments.some((segment) => blockedNames.has(segment.toLowerCase()))) {
    return null;
  }
  const relative = segments.length ? segments.join(sep) : 'index.html';
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${sep}`)) return null;
  return target;
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
  const pathname = requestUrl.pathname;
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    sendText(response, 405, 'Method not allowed');
    return;
  }

  let target;
  if (pathname === '/runtime-config.js') {
    target = runtimePath;
  } else {
    target = safePath(pathname);
  }
  if (!target || !existsSync(target)) {
    sendText(response, target ? 404 : 403, target ? 'Not found' : 'Forbidden');
    return;
  }

  const stats = statSync(target);
  if (!stats.isFile()) {
    sendText(response, 403, 'Directory listing disabled');
    return;
  }

  const contentType = pathname === '/runtime-config.js'
    ? 'text/javascript; charset=utf-8'
    : (mime.get(extname(target).toLowerCase()) || 'application/octet-stream');
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stats.size,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), geolocation=(self)',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(target).pipe(response);
});

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(port, '127.0.0.1', () => {
  const runtime = readFileSync(runtimePath, 'utf8');
  if (!runtime.includes('yakhtrkukqlgzvxuvhzs.supabase.co')) {
    server.close();
    throw new Error('Runtime project mismatch');
  }
  console.log(`TABA frontend ready on http://127.0.0.1:${port}`);
});
