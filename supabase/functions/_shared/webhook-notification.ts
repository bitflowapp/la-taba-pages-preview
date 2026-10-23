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

/**
 * The legacy IPN feed that Checkout Pro also sends to a preference's
 * `notification_url`: `?topic=<t>&id=<n>` with a `{resource, topic}` body.
 * Mercado Pago documents it as carrying an `x-Signature` that cannot be
 * validated with the secret key, and retries it every 15 minutes until it is
 * answered 200/201 («Notificaciones IPN»). Narrow on purpose: any webhook
 * marker (`data.id` or `type` in the query; `id`, `data`, `type` or `action` in
 * the body) makes it a webhook, whose signature alone decides.
 */
export function isLegacyIpnNotification(url: URL, body: Record<string, unknown>): boolean {
  if (url.searchParams.has('data.id') || url.searchParams.has('type')) return false;
  if (!url.searchParams.get('topic')?.trim() || !url.searchParams.get('id')?.trim()) return false;
  return !['id', 'data', 'type', 'action'].some((key) => key in body);
}

export function webhookEventType(url: URL, body: Record<string, unknown>): string {
  const fromBody = String(body.type ?? body.topic ?? '').trim();
  if (fromBody) return fromBody.toLowerCase();
  return (url.searchParams.get('topic')?.trim() || '').toLowerCase();
}
