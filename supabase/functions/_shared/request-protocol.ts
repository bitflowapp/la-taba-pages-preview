/**
 * Supabase's edge proxy terminates TLS before the function runs, so
 * `request.url` arrives carrying the internal `http:` scheme even for a request
 * the client made over HTTPS. Reading `request.url` alone therefore rejects
 * every real Mercado Pago notification.
 *
 * The original client protocol survives in `x-forwarded-proto`. When a proxy
 * set it we trust its first hop; otherwise we fall back to `request.url`, which
 * is what a direct call sees (`supabase functions serve`, or any deployment
 * without a proxy in front).
 *
 * This guard is defence in depth: the authenticity of a webhook is decided by
 * the HMAC signature, never by this header.
 */
export function requestIsHttps(request: Request): boolean {
  const forwardedProtocol = firstForwardedProtocol(request.headers.get('x-forwarded-proto'));
  if (forwardedProtocol) return forwardedProtocol === 'https';
  try {
    return new URL(request.url).protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function firstForwardedProtocol(header: string | null): string {
  if (!header) return '';
  // A proxy chain appends hops; the left-most entry is the original client.
  return header.split(',')[0]?.trim().toLowerCase() ?? '';
}

/**
 * Dirección del cliente para los cupos por origen. Devuelve '' cuando no se
 * conoce: quien llama decide qué hacer sin dirección, y nunca se inventa un
 * valor común («unknown») que metería a todos los clientes en el mismo cupo.
 *
 * Medido en staging el 2026-10-01 con funciones sonda, dentro de una Edge
 * Function:
 *   - `cf-connecting-ip` lo escribe Cloudflare y no se puede falsificar (un
 *     pedido que lo trae puesto por el cliente es rechazado antes de llegar);
 *   - `x-forwarded-for` llega con tres saltos que reescribe la plataforma: el
 *     que mandó el cliente no sobrevive;
 *   - `sb-forwarded-for` lo controla el cliente. No se lee nunca.
 *
 * Por eso manda `cf-connecting-ip`, y el primer salto de `x-forwarded-for`
 * queda sólo para cuando ese encabezado no existe (`supabase functions serve`).
 * Un `cf-connecting-ip` presente pero ilegible no se reemplaza por el otro:
 * es «no se conoce».
 *
 * Una dirección IPv6 se reduce a su /64: es lo que un proveedor le asigna a un
 * solo cliente, que si no tendría 2^64 direcciones para estrenar un cupo cada
 * vez.
 */
export function clientAddress(request: Request): string {
  const connecting = request.headers.get('cf-connecting-ip');
  if (connecting !== null && connecting.trim() !== '') return normalizedAddress(connecting);
  return normalizedAddress(request.headers.get('x-forwarded-for')?.split(',')[0] ?? '');
}

function normalizedAddress(value: string): string {
  const candidate = value.trim().toLowerCase();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(candidate)) {
    return candidate.split('.').every((part) => Number(part) <= 255)
      ? candidate.split('.').map((part) => String(Number(part))).join('.')
      : '';
  }
  if (!/^[0-9a-f:.]{2,45}$/.test(candidate) || !candidate.includes(':')) return '';
  // `::ffff:203.0.113.7` es una IPv4 escrita como IPv6: el cupo es el de la IPv4.
  const mapped = /^(?:0{0,4}:){0,5}:?ffff:((?:\d{1,3}\.){3}\d{1,3})$/.exec(candidate);
  if (mapped) return normalizedAddress(mapped[1]);
  if (candidate.includes('.')) return '';
  const halves = candidate.split('::');
  if (halves.length > 2) return '';
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return '';
  const groups = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => '0'), ...tail];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return '';
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
