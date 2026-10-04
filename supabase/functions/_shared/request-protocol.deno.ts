import { clientAddress, requestIsHttps } from './request-protocol.ts';

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

// ── Dirección del cliente para los cupos por origen ─────────────────────────
// Lo que la plataforma entrega dentro de una Edge Function (medido en staging,
// 2026-10-01): `cf-connecting-ip` es de Cloudflare, `x-forwarded-for` llega
// reescrito, `sb-forwarded-for` es del cliente.

function expectAddress(headers: Record<string, string>, expected: string, why: string): void {
  const actual = clientAddress(webhookRequest(PROXIED_URL, headers));
  if (actual !== expected) throw new Error(`${why}: se esperaba «${expected}» y salió «${actual}»`);
}

Deno.test('dirección del cliente: manda cf-connecting-ip aunque x-forwarded-for diga otra cosa', () => {
  expectAddress(
    { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.9, 10.0.0.1, 10.0.0.2' },
    '203.0.113.7',
    'un x-forwarded-for distinto cambió la dirección',
  );
});

Deno.test('dirección del cliente: sb-forwarded-for no se lee nunca', () => {
  expectAddress({ 'sb-forwarded-for': '198.51.100.9' }, '', 'se usó un encabezado que controla el cliente');
  expectAddress(
    { 'cf-connecting-ip': '203.0.113.7', 'sb-forwarded-for': '198.51.100.9' },
    '203.0.113.7',
    'sb-forwarded-for pisó la dirección real',
  );
});

Deno.test('dirección del cliente: sin cf-connecting-ip se usa el primer salto de x-forwarded-for', () => {
  expectAddress({ 'x-forwarded-for': ' 198.51.100.9 , 10.0.0.1' }, '198.51.100.9', 'no se tomó el primer salto');
});

Deno.test('dirección del cliente: un cf-connecting-ip ilegible es «no se conoce», no el otro encabezado', () => {
  expectAddress(
    { 'cf-connecting-ip': 'no-es-una-ip', 'x-forwarded-for': '198.51.100.9' },
    '',
    'un cf-connecting-ip inválido cayó al encabezado de respaldo',
  );
  expectAddress({ 'cf-connecting-ip': '999.1.1.1' }, '', 'se aceptó un octeto fuera de rango');
});

Deno.test('dirección del cliente: sin ningún encabezado no se inventa un valor común', () => {
  expectAddress({}, '', 'se devolvió un valor compartido para clientes sin dirección');
  expectAddress({ 'x-real-ip': '198.51.100.9' }, '', 'se leyó un encabezado que nadie midió');
});

Deno.test('dirección del cliente: una IPv6 se reduce a su /64', () => {
  expectAddress({ 'cf-connecting-ip': '2001:db8:12:3400:aaaa:bbbb:cccc:dddd' }, '2001:db8:12:3400::/64', 'IPv6 completa');
  expectAddress({ 'cf-connecting-ip': '2001:0DB8:0012:3400::1' }, '2001:db8:12:3400::/64', 'IPv6 comprimida, con ceros y mayúsculas');
  expectAddress({ 'cf-connecting-ip': '2001:db8::1' }, '2001:db8:0:0::/64', 'IPv6 con el prefijo comprimido');
  expectAddress({ 'cf-connecting-ip': '::ffff:203.0.113.7' }, '203.0.113.7', 'IPv4 escrita como IPv6');
  expectAddress({ 'cf-connecting-ip': '2001:db8:::1' }, '', 'IPv6 mal formada');
  expectAddress({ 'cf-connecting-ip': '1:2:3:4:5:6:7:8:9' }, '', 'IPv6 con grupos de más');
});
