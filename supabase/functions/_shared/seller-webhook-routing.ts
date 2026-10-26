type Connection = {
  business_id: string;
  seller_id: string;
  application_id: string;
  environment: string;
  status: string;
};
type Intent = { business_id: string; environment: string };
type Input = {
  signatureValid: boolean;
  eventType: string;
  resourceId: string;
  sellerId: unknown;
  applicationId: string;
  environment: 'test' | 'production';
};
type Dependencies = {
  connectionForSeller: (sellerId: string) => Promise<Connection | null>;
  paymentForBusiness: (paymentId: string, businessId: string) => Promise<Record<string, unknown>>;
  intentForReference: (reference: string) => Promise<Intent | null>;
  // The application's connected sellers (bounded by the caller), for a notice whose hint is not one of them.
  connectedSellers?: () => Promise<Connection[]>;
};

/** How many connected sellers a notice whose hint does not resolve may be tried against (one provider read each). */
export const WEBHOOK_ROUTING_CANDIDATES = 25;
/** Mercado Pago waits 22 s for the answer: the search stops starting reads after this much time and asks for a retry. */
export const WEBHOOK_ROUTING_BUDGET_MS = 10_000;

// user_id is only a lookup hint: HMAC does not authenticate arbitrary body fields.
// Only a provider payment read with that seller's OAuth token can confirm routing.
//
// Mercado Pago documents `user_id` as the seller («Seller identifier»), and that is the first and usual route. QA could
// never show what a marketplace payment really carries, because there the seller IS the owner of the integrator
// application (R-MKT-1). If a notice brings any other id (the integrator's owner, an unknown account) or the hinted
// seller cannot read that payment, the payment is looked up with the token of each connected seller of the
// application instead: the one whose token reads it AS ITS COLLECTOR is the seller. Nothing of the body is trusted on
// either route; without a match the notice is refused as before and the provider-truth sweeps still find the money.
export async function resolveSellerWebhookBusiness(
  input: Input, dependencies: Dependencies, clock: () => number = () => Date.now(),
): Promise<string> {
  const started = clock();
  if (!input.signatureValid || input.eventType !== 'payment' || !/^\d+$/.test(input.resourceId)) {
    throw new Error('Invalid signed payment notification');
  }
  const sellerId = typeof input.sellerId === 'string' ||
      (typeof input.sellerId === 'number' && Number.isSafeInteger(input.sellerId))
    ? String(input.sellerId) : '';
  const usable = (connection: Connection | null | undefined): connection is Connection => Boolean(connection &&
    connection.status === 'connected' && /^\d+$/.test(String(connection.seller_id)) &&
    connection.environment === input.environment && connection.application_id === input.applicationId);
  const tried = new Set<string>();
  const hinted = /^\d+$/.test(sellerId) ? await dependencies.connectionForSeller(sellerId) : null;
  if (usable(hinted) && hinted.seller_id === sellerId) {
    tried.add(hinted.business_id);
    const routed = await routeThrough(hinted, input, dependencies);
    if (routed) return routed;
  }
  if (dependencies.connectedSellers) {
    const candidates = (await dependencies.connectedSellers()).slice(0, WEBHOOK_ROUTING_CANDIDATES);
    for (const candidate of candidates) {
      if (!usable(candidate) || tried.has(candidate.business_id)) continue;
      if (clock() - started > WEBHOOK_ROUTING_BUDGET_MS) throw new Error('Seller routing time budget exhausted');
      tried.add(candidate.business_id);
      const routed = await routeThrough(candidate, input, dependencies);
      if (routed) return routed;
    }
  }
  throw new Error(tried.size ? 'Provider payment routing mismatch' : 'Seller connection unavailable');
}

// The business of `connection` when its seller collected this payment; null when the payment is not that seller's
// (the provider does not show it to that token, or someone else collected it). A provider that cannot answer right now
// is an error: the notice is retried, never routed by guesswork.
async function routeThrough(connection: Connection, input: Input, dependencies: Dependencies): Promise<string | null> {
  let payment: Record<string, unknown>;
  try {
    payment = await dependencies.paymentForBusiness(input.resourceId, connection.business_id);
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (status === 404 || status === 403) return null;
    throw error;
  }
  // Same live_mode contract as record_mercadopago_payment_snapshot: production
  // demands live_mode === true. In test, Checkout Pro payments collected by a
  // test user report live_mode = true, so demanding false there dropped every
  // such notification; the collector check still pins them to the connected
  // seller, and a test connection only accepts a test_user seller.
  const liveModeValid = input.environment === 'production'
    ? payment.live_mode === true
    : payment.live_mode === undefined || typeof payment.live_mode === 'boolean';
  if (String(payment.id) !== input.resourceId || String(payment.collector_id) !== connection.seller_id) return null;
  if (!liveModeValid || typeof payment.external_reference !== 'string' || !payment.external_reference) {
    throw new Error('Provider payment routing mismatch');
  }
  const intent = await dependencies.intentForReference(payment.external_reference);
  if (!intent || intent.environment !== input.environment || intent.business_id !== connection.business_id) {
    throw new Error('Payment intent routing mismatch');
  }
  return intent.business_id;
}
