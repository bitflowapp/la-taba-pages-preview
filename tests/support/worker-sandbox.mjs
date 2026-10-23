// Loads the REAL mercadopago-payment-worker (and the real _shared/mercadopago.ts adapter) inside a vm context.
// Only the platform boundaries are replaced: the Supabase client (backed by real PostgreSQL), the network
// (the ProviderSim) and the secrets/OAuth plumbing. Requires `node --experimental-vm-modules`.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ProcessKilled, virtualDate } from './virtual-clock.mjs';

// TABA_FUNCTIONS_DIR lets the same scenarios run against another revision of the Edge code (red/green evidence).
const FUNCTIONS = process.env.TABA_FUNCTIONS_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'functions');

// Wraps a service client so every database call is a counted boundary of the (virtual) process: it can be killed
// at a chosen call, and lease timestamps age by the virtual time that passed since the previous call.
function guardService(service, clock, onShift) {
  const shift = () => { const ms = clock.takeShift(); if (ms > 0 && onShift) onShift(ms); };
  return {
    async rpc(name, args) { clock.boundary('rpc:' + name); shift(); return service.rpc(name, args); },
    from(table) {
      const builder = service.from(table);
      const exec = builder._exec.bind(builder);
      builder._exec = () => { clock.boundary('from:' + table); shift(); return exec(); };
      return builder;
    },
  };
}

export async function loadWorker({ service: rawService, provider, businessId, environment = 'test', businessForIntent, clock = null, onShift = null, env = {} }) {
  const service = clock ? guardService(rawService, clock, onShift) : rawService;
  let handler;
  class PublicPaymentError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }
  const sha256Hex = async value => createHash('sha256').update(typeof value === 'string' ? value : Buffer.from(value)).digest('hex');
  const runtime = {
    PublicPaymentError,
    createServiceClient: () => service,
    enforceRateLimit: async () => {},
    jsonResponse: (_request, body, status = 200) => Response.json(body, { status }),
    publicErrorResponse: (_request, error) => Response.json({ error: String(error?.message || error) }, { status: 500 }),
    requirePost: () => {},
    requireWorkerAuthorization: async () => {},
    getRequiredEnv: () => 'synthetic-env',
    hashSensitive: async (value, namespace) => sha256Hex(namespace + ':' + value),
    providerEnvironment: () => environment,
    requireRealPaymentSmokeAuthorization: () => {},
    sha256Hex,
    webhookUrl: () => 'https://synthetic.invalid/webhook',
    checkoutReturnUrl: p => 'https://synthetic.invalid' + p,
  };
  const seller = {
    businessForIntent: businessForIntent || (async () => businessId),
    oauthMode: () => true,
    oauthConfig: () => ({ environment }),
    sellerAccessToken: async () => 'synthetic-token',
    assertOAuthPaymentEnvironment: () => {},
    audit: () => {},
    invalidateRejectedToken: async () => {},
  };
  const environmentValues = { MERCADOPAGO_ENVIRONMENT: environment, ...env };
  const context = vm.createContext({
    Request, Response, Headers, URL, URLSearchParams, TextEncoder, AbortController, setTimeout, clearTimeout,
    ...(clock ? { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout } : {}),
    crypto: globalThis.crypto, fetch: provider.fetch, console: { log() {}, error() {} },
    ...(clock ? { Date: virtualDate(clock) } : {}),
    Deno: { serve: fn => { handler = fn; }, env: { get: name => environmentValues[name] } },
  });
  const cache = new Map();
  const synthetic = (key, exports) => {
    const mod = new vm.SyntheticModule(Object.keys(exports), function () { for (const [k, v] of Object.entries(exports)) this.setExport(k, v); }, { context, identifier: key });
    cache.set(key, mod);
  };
  synthetic('payment-runtime.ts', runtime);
  synthetic('seller-oauth.ts', seller);
  async function load(url) {
    const key = url.pathname.split('/').at(-1);
    if (cache.has(key)) return cache.get(key);
    const code = stripTypeScriptTypes(fs.readFileSync(url, 'utf8'), { mode: 'transform' });
    const mod = new vm.SourceTextModule(code, { context, identifier: url.href });
    cache.set(key, mod);
    await mod.link((specifier, parent) => load(new URL(specifier, parent.identifier)));
    return mod;
  }
  const mod = await load(pathToFileURL(path.join(FUNCTIONS, 'mercadopago-payment-worker', 'index.ts')));
  await mod.evaluate();
  return {
    /** One invocation. With a clock, `killAfterMs` / `killAtCall` reproduce a platform kill ({ killed: true }). */
    async invoke({ killAfterMs = null, killAtCall = null } = {}) {
      clock?.begin({ killAfterMs, killAtCall });
      let response;
      try {
        response = await handler(new Request('https://synthetic.invalid/worker', { method: 'POST' }));
      } catch (error) {
        if (error instanceof ProcessKilled || clock?.killed) return { killed: true, calls: clock?.calls };
        throw error;
      }
      if (clock?.killed) return { killed: true, calls: clock.calls };
      return { status: response.status, body: await response.json(), calls: clock?.calls };
    },
  };
}
