import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.env.TABA_SERVER_ROOT || process.cwd());
const port = Number(process.env.TABA_SERVER_PORT || 4173);
let runtime = process.env.TABA_RUNTIME_JSON ? JSON.parse(process.env.TABA_RUNTIME_JSON) : null;
if (!runtime) {
  const projectRef = process.env.TABA_PROJECT_REF;
  const keyOutput = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'supabase', 'projects', 'api-keys', '--project-ref', projectRef, '--output', 'json',
  ], { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
  const publicKey = JSON.parse(keyOutput).find((row) => row.type === 'publishable')?.api_key;
  runtime = {
    mode: 'production',
    repository: {
      provider: 'supabase',
      deploymentEnvironment: 'staging',
      supabaseUrl: process.env.TABA_SUPABASE_URL,
      publishableKey: publicKey,
      businessId: process.env.TABA_BUSINESS_ID,
      pollMs: 5000,
    },
  };
}
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function send(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const requestPath = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  if (requestPath === '/runtime-config.js') {
    send(
      res,
      200,
      `globalThis.__LA_TABA_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify(runtime)});`,
      'text/javascript; charset=utf-8',
    );
    return;
  }

  const relative = requestPath === '/' ? '/index.html' : requestPath;
  const candidate = path.resolve(root, `.${relative}`);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    send(res, 403, 'forbidden');
    return;
  }
  fs.stat(candidate, (error, stat) => {
    if (error || !stat.isFile()) {
      send(res, 404, 'not found');
      return;
    }
    res.writeHead(200, {
      'content-type': mime[path.extname(candidate).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(candidate).pipe(res);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ root, port, runtime: { mode: runtime.mode, provider: runtime.repository?.provider, supabaseUrl: runtime.repository?.supabaseUrl, businessId: runtime.repository?.businessId } }));
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
