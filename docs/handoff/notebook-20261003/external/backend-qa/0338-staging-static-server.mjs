import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.env.TABA_STATIC_ROOT || '.');
const port = Number(process.env.TABA_STATIC_PORT || 4173);
const supabaseUrl = String(process.env.TABA_SUPABASE_URL || '').replace(/\/+$/, '');
const publishableKey = String(process.env.TABA_PUBLISHABLE_KEY || '');
const businessId = String(process.env.TABA_BUSINESS_ID || '');

if (!/^https:\/\//i.test(supabaseUrl) || !publishableKey || !businessId) {
  throw new Error('Missing public staging runtime values.');
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const runtimeBody = `globalThis.__LA_TABA_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify({
  mode: 'production',
  repository: {
    provider: 'supabase',
    deploymentEnvironment: 'staging',
    supabaseUrl,
    publishableKey,
    businessId,
    pollMs: 5000,
  },
})});`;

function safeFile(urlPath) {
  const pathname = decodeURIComponent(urlPath.split('?')[0]);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  if (req.url?.split('?')[0] === '/runtime-config.js') {
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'x-content-type-options': 'nosniff',
    });
    res.end(runtimeBody);
    return;
  }

  const file = safeFile(req.url || '/');
  if (!file) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  fs.stat(file, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`TABA staging static server listening on http://127.0.0.1:${port}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
