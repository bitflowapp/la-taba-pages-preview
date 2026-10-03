import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.env.TABA_FRONTEND_ROOT || process.cwd());
const host = process.env.TABA_FRONTEND_HOST || '127.0.0.1';
const port = Number(process.env.TABA_FRONTEND_PORT || 8084);
const projectRef = 'ukxqbgswjlibmnjemrzd';
const businessId = '00000000-0000-4000-8000-000000000001';
const publishableKey = String(process.env.TABA_STAGING_PUBLISHABLE_KEY || '').trim();

if (!/^sb_publishable_[A-Za-z0-9_\-]+$/.test(publishableKey) && publishableKey.split('.').length !== 3) {
  throw new Error('Missing safe staging publishable key.');
}

const runtimeSource = `globalThis.__LA_TABA_RUNTIME_CONFIG__ = Object.freeze({
  mode: 'production',
  repository: Object.freeze({
    provider: 'supabase',
    deploymentEnvironment: 'staging',
    supabaseUrl: 'https://${projectRef}.supabase.co',
    publishableKey: ${JSON.stringify(publishableKey)},
    businessId: '${businessId}',
    pollMs: 5000,
  }),
});\n`;

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
]);

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const candidate = path.resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  return candidate;
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${host}:${port}`);
    if (requestUrl.pathname === '/runtime-config.js') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/javascript; charset=utf-8',
        'x-taba-supabase-project': projectRef,
      });
      if (request.method !== 'HEAD') response.end(runtimeSource);
      else response.end();
      return;
    }

    const filePath = safePath(requestUrl.pathname);
    if (!filePath) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    const body = await fs.readFile(filePath);
    const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
    response.writeHead(200, { 'cache-control': 'no-cache', 'content-type': contentType });
    if (request.method !== 'HEAD') response.end(body);
    else response.end();
  } catch (error) {
    const status = error?.code === 'ENOENT' ? 404 : 500;
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(status === 404 ? 'Not found' : 'Internal server error');
  }
});

server.listen(port, host, () => {
  console.log(`La Taba staging frontend listening on http://${host}:${port}/ (pid=${process.pid})`);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
