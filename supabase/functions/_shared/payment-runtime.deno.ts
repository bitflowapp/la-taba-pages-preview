import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1.0.19';
import { requestClientIp, requestFingerprint } from './payment-runtime.ts';

// Lo que llega a la función detrás del borde: el cliente puede mandar el
// `x-forwarded-for` que quiera; los proxies sólo agregan al final.
function checkoutRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-create-checkout-session', {
    method: 'POST',
    headers,
  });
}

Deno.test('cf-connecting-ip manda sobre cualquier x-forwarded-for', () => {
  assertEquals(requestClientIp(checkoutRequest({
    'cf-connecting-ip': '203.0.113.7',
    'x-forwarded-for': '198.51.100.1, 203.0.113.7',
    'x-real-ip': '192.0.2.9',
  })), '203.0.113.7');
});

Deno.test('un primer salto inventado no cambia la identidad: decide el último', () => {
  const real = '203.0.113.7';
  const first = requestFingerprint(checkoutRequest({ 'x-forwarded-for': `10.0.0.1, ${real}` }), 'usuario');
  const forged = requestFingerprint(checkoutRequest({ 'x-forwarded-for': `10.9.9.9, ${real}` }), 'usuario');
  assertEquals(first, forged, 'rotar el primer valor no tiene que abrir un bucket nuevo');
  assertEquals(requestClientIp(checkoutRequest({ 'x-forwarded-for': ` 10.0.0.1 ,  ${real} ` })), real);
});

Deno.test('saltos vacíos se ignoran', () => {
  assertEquals(requestClientIp(checkoutRequest({ 'x-forwarded-for': '203.0.113.7, , ' })), '203.0.113.7');
});

Deno.test('sin cf-connecting-ip ni x-forwarded-for se usa x-real-ip', () => {
  assertEquals(requestClientIp(checkoutRequest({ 'x-real-ip': ' 192.0.2.9 ' })), '192.0.2.9');
});

Deno.test('sin ningún encabezado la identidad es unknown, no vacía', () => {
  assertEquals(requestClientIp(checkoutRequest()), 'unknown');
  assertEquals(requestFingerprint(checkoutRequest()), 'unknown\u0000');
});

Deno.test('el sujeto sigue separado de la IP por NUL', () => {
  const request = checkoutRequest({ 'cf-connecting-ip': '203.0.113.7' });
  assertEquals(requestFingerprint(request, 'usuario-1'), '203.0.113.7\u0000usuario-1');
  assertNotEquals(requestFingerprint(request, 'usuario-1'), requestFingerprint(request, 'usuario-2'));
});
