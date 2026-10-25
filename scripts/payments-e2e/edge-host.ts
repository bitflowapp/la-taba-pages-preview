// Host de las funciones Edge del banco de cobros: el papel del gateway de Supabase (`/functions/v1/<función>`).
// Cada función corre en su propio Worker (isolate) con su `index.ts` real; ver edge-worker.ts.
//
//   deno run --node-modules-dir=none --allow-net --allow-env --allow-read scripts/payments-e2e/edge-host.ts
//
// Configuración por TABA_BENCH_HOST (JSON): { ref, restUrl, jwtSecret, providerUrl, functionsDir, functions[] }.
const config = JSON.parse(Deno.env.get('TABA_BENCH_HOST') || '{}');
if (!/^[a-z]{20}$/.test(config.ref || '') || !config.restUrl || !config.jwtSecret || !Array.isArray(config.functions)) {
  throw new Error('TABA_BENCH_HOST incompleto');
}

type Pending = { resolve: (response: Response) => void };
const workers = new Map<string, { worker: Worker; pending: Map<number, Pending> }>();
let sequence = 0;

for (const name of config.functions as string[]) {
  const worker = new Worker(new URL('./edge-worker.ts', import.meta.url).href, { type: 'module' });
  const pending = new Map<number, Pending>();
  const ready = new Promise<void>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'ready') resolve();
      else if (message.type === 'init_failed') reject(new Error(`${name}: ${message.error}`));
      else if (message.type === 'response') {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        entry?.resolve(new Response(message.status === 204 || message.status === 304 ? null : message.body,
          { status: message.status, headers: message.headers }));
      }
    };
    worker.onerror = (event) => { event.preventDefault(); reject(new Error(`${name}: ${event.message}`)); };
  });
  worker.postMessage({ type: 'init', name, config });
  await ready;
  workers.set(name, { worker, pending });
}

const server = Deno.serve({ hostname: '127.0.0.1', port: Number(config.port || 0), onListen: () => {} }, async (request) => {
  const url = new URL(request.url);
  if (url.pathname === '/__bench/health') return Response.json({ ok: true, functions: [...workers.keys()] });
  const match = /^\/functions\/v1\/([a-z0-9-]+)$/.exec(url.pathname);
  const target = match ? workers.get(match[1]) : undefined;
  if (!target) return new Response('not found', { status: 404 });
  const id = ++sequence;
  // La función ve la URL pública, como detrás del proxy de Supabase (que termina TLS y agrega x-forwarded-proto).
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-proto', 'https');
  headers.delete('host');
  const body = ['GET', 'HEAD'].includes(request.method) ? null : await request.arrayBuffer();
  const response = new Promise<Response>((resolve) => target.pending.set(id, { resolve }));
  target.worker.postMessage({ type: 'request', id, method: request.method,
    url: `https://${config.ref}.supabase.co${url.pathname}${url.search}`, headers: [...headers], body }, body ? [body] : []);
  return await response;
});

console.log(`BENCH_HOST_READY ${(server.addr as Deno.NetAddr).port}`);
