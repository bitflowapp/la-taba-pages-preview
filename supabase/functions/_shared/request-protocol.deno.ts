import { requestIsHttps } from './request-protocol.ts';

// What the Supabase edge runtime actually hands the function: TLS already
// terminated, so the internal URL is plaintext even for an HTTPS client.
const PROXIED_URL = 'http://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-webhook';
const DIRECT_HTTPS_URL = 'https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-webhook';
const DIRECT_HTTP_URL = 'http://localhost:54321/functions/v1/mercadopago-webhook';

function webhookRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: 'POST', headers });
}

Deno.test('proxy HTTPS: request.url llega en http y x-forwarded-proto manda', () => {
  if (!requestIsHttps(webhookRequest(PROXIED_URL, { 'x-forwarded-proto': 'https' }))) {
    throw new Error('regresión: se rechazó una notificación que el cliente envió por HTTPS');
  }
});

Deno.test('HTTP real detrás del proxy sigue rechazado', () => {
  if (requestIsHttps(webhookRequest(PROXIED_URL, { 'x-forwarded-proto': 'http' }))) {
    throw new Error('se aceptó tráfico en texto plano');
  }
});

Deno.test('cadena de proxies: decide el primer hop, no el último', () => {
  if (!requestIsHttps(webhookRequest(PROXIED_URL, { 'x-forwarded-proto': 'https, http' }))) {
    throw new Error('cliente HTTPS rechazado por un hop interno en texto plano');
  }
  if (requestIsHttps(webhookRequest(PROXIED_URL, { 'x-forwarded-proto': 'http, https' }))) {
    throw new Error('cliente en texto plano aceptado por un hop interno HTTPS');
  }
});

Deno.test('encabezado con mayúsculas y espacios se normaliza', () => {
  if (!requestIsHttps(webhookRequest(PROXIED_URL, { 'x-forwarded-proto': '  HTTPS  ' }))) {
    throw new Error('el encabezado no se normalizó');
  }
});

Deno.test('valor desconocido no se interpreta como HTTPS', () => {
  for (const value of ['ws', 'https-ish', 'httpss', 'HTTP/1.1']) {
    if (requestIsHttps(webhookRequest(PROXIED_URL, { 'x-forwarded-proto': value }))) {
      throw new Error(`se aceptó un protocolo desconocido: ${value}`);
    }
  }
});

Deno.test('sin encabezado se cae a request.url', () => {
  if (!requestIsHttps(webhookRequest(DIRECT_HTTPS_URL))) {
    throw new Error('fallback rechazó una URL https directa');
  }
  if (requestIsHttps(webhookRequest(DIRECT_HTTP_URL))) {
    throw new Error('fallback aceptó una URL http directa');
  }
});

Deno.test('encabezado vacío se cae a request.url en vez de rechazar', () => {
  if (!requestIsHttps(webhookRequest(DIRECT_HTTPS_URL, { 'x-forwarded-proto': '' }))) {
    throw new Error('un encabezado vacío anuló el fallback');
  }
  if (requestIsHttps(webhookRequest(DIRECT_HTTP_URL, { 'x-forwarded-proto': '' }))) {
    throw new Error('un encabezado vacío aceptó texto plano');
  }
});
