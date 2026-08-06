/**
 * Mercado Pago delivers notifications in two shapes on the same endpoint.
 *
 * The modern webhook carries `?data.id=<n>&type=<topic>` and is what the
 * official signature recipe signs. Merchant orders and the other legacy topics
 * arrive as `?topic=<t>&id=<n>` instead; reading only `data.id` left the
 * resource unidentified, so those receipts were stored against a payload hash
 * and could never match a signature.
 *
 * Resolution is deliberately narrow: the legacy `id` is honoured only when a
 * `topic` query parameter is present, so a bare `?id=` cannot smuggle in a
 * resource. Authenticity is still decided by the HMAC signature alone.
 */
export function webhookResourceId(url: URL): string {
  const modern = url.searchParams.get('data.id')?.trim() || '';
  if (modern) return modern;
  const topic = url.searchParams.get('topic')?.trim() || '';
  if (!topic) return '';
  return url.searchParams.get('id')?.trim() || '';
}

export function webhookEventType(url: URL, body: Record<string, unknown>): string {
  const fromBody = String(body.type ?? body.topic ?? '').trim();
  if (fromBody) return fromBody.toLowerCase();
  return (url.searchParams.get('topic')?.trim() || '').toLowerCase();
}
