// Un isolate por función, como en Supabase Edge Runtime: el `index.ts` REAL de la función se importa acá después de
// instalar el ruteo de fetch, y su `Deno.serve` se captura en lugar de abrir un puerto.
//
// El ruteo es la única diferencia con producción y falla cerrado:
//   https://<ref>.supabase.co/rest/v1/*   → PostgREST del banco (roles, RLS y grants reales)
//   https://<ref>.supabase.co/auth/v1/user → verificación local del JWT (el banco no levanta GoTrue)
//   https://api.mercadopago.com/*          → emulador (o el Mercado Pago real en el modo sandbox)
//   cualquier otro destino                 → error
type Config = {
  ref: string;
  restUrl: string;
  jwtSecret: string;
  providerUrl: string | null; // null: el Mercado Pago real (sólo modo sandbox)
  functionsDir: string;
};

type Inbound = { id: number; method: string; url: string; headers: [string, string][]; body: ArrayBuffer | null };

let handler: ((request: Request) => Response | Promise<Response>) | null = null;
const realFetch = globalThis.fetch.bind(globalThis);

function base64urlDecode(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, base64urlDecode(signature) as unknown as BufferSource,
    new TextEncoder().encode(`${header}.${payload}`));
  if (!valid) return null;
  const claims = JSON.parse(new TextDecoder().decode(base64urlDecode(payload)));
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null;
  return claims;
}

function install(config: Config) {
  const supabase = `https://${config.ref}.supabase.co`;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const forward = (target: string) => realFetch(target, {
      method: request.method, headers: request.headers, redirect: 'manual', signal: request.signal,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      // @ts-ignore: Deno acepta duplex para cuerpos en stream
      duplex: 'half',
    });
    if (url.origin === supabase && url.pathname.startsWith('/rest/v1/')) {
      const response = await forward(`${config.restUrl}${url.pathname.slice('/rest/v1'.length)}${url.search}`);
      // Evidencia para el informe: qué rechazó la base (código y mensaje de PostgREST, nunca datos de la fila).
      if (response.status >= 400) {
        const detail = await response.clone().json().catch(() => ({}));
        console.error(JSON.stringify({ bench: 'rest_error', path: url.pathname.slice('/rest/v1'.length), status: response.status,
          code: detail.code ?? null, message: String(detail.message ?? '').slice(0, 240), hint: String(detail.hint ?? '').slice(0, 120) }));
      }
      return response;
    }
    if (url.origin === supabase && url.pathname === '/auth/v1/user' && request.method === 'GET') {
      const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';
      const claims = token ? await verifyJwt(token, config.jwtSecret) : null;
      if (!claims || claims.role !== 'authenticated' || typeof claims.sub !== 'string') {
        return Response.json({ code: 403, error_code: 'bad_jwt', msg: 'invalid JWT' }, { status: 403 });
      }
      return Response.json({ id: claims.sub, aud: 'authenticated', role: 'authenticated', email: claims.email ?? '',
        app_metadata: { provider: 'email' }, user_metadata: {}, is_anonymous: false, created_at: new Date(0).toISOString() });
    }
    if (url.origin === 'https://api.mercadopago.com') {
      return config.providerUrl ? forward(`${config.providerUrl}${url.pathname}${url.search}`) : forward(url.toString());
    }
    throw new Error(`BENCH_FETCH_REFUSED ${request.method} ${url.origin}${url.pathname}`);
  }) as typeof fetch;
}

self.onmessage = async (event: MessageEvent) => {
  const message = event.data;
  if (message.type === 'init') {
    try {
      install(message.config as Config);
      const serve = Deno.serve;
      Deno.serve = ((first: unknown, second?: unknown) => {
        handler = (typeof first === 'function' ? first : second) as typeof handler;
        return { finished: Promise.resolve(), shutdown: async () => {}, ref() {}, unref() {}, addr: { hostname: '127.0.0.1', port: 0, transport: 'tcp' } };
      }) as unknown as typeof Deno.serve;
      try {
        await import(`${message.config.functionsDir}/${message.name}/index.ts`);
      } finally {
        Deno.serve = serve;
      }
      if (!handler) throw new Error('la función no llamó a Deno.serve');
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({ type: 'init_failed', error: String((error as Error)?.stack || error) });
    }
    return;
  }
  if (message.type === 'request') {
    const inbound = message as Inbound & { type: string };
    try {
      const response = await handler!(new Request(inbound.url, {
        method: inbound.method, headers: inbound.headers,
        body: inbound.body && !['GET', 'HEAD'].includes(inbound.method) ? inbound.body : undefined,
      }));
      const body = await response.arrayBuffer();
      self.postMessage({ type: 'response', id: inbound.id, status: response.status, headers: [...response.headers], body }, [body]);
    } catch (error) {
      self.postMessage({ type: 'response', id: inbound.id, status: 599, headers: [['content-type', 'text/plain']],
        body: new TextEncoder().encode(`BENCH_HANDLER_THREW ${String((error as Error)?.message || error)}`).buffer });
    }
  }
};
