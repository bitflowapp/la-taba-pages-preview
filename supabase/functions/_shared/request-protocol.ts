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
