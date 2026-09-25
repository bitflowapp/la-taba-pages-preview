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
};

// user_id is only a lookup hint: HMAC does not authenticate arbitrary body fields.
// Only a provider payment read with that seller's OAuth token can confirm routing.
export async function resolveSellerWebhookBusiness(input: Input, dependencies: Dependencies): Promise<string> {
  if (!input.signatureValid || input.eventType !== 'payment' || !/^\d+$/.test(input.resourceId)) {
    throw new Error('Invalid signed payment notification');
  }
  const sellerId = typeof input.sellerId === 'string' ||
      (typeof input.sellerId === 'number' && Number.isSafeInteger(input.sellerId))
    ? String(input.sellerId) : '';
  if (!/^\d+$/.test(sellerId)) throw new Error('Missing seller routing hint');
  const connection = await dependencies.connectionForSeller(sellerId);
  if (!connection || connection.status !== 'connected' || connection.seller_id !== sellerId ||
      connection.environment !== input.environment || connection.application_id !== input.applicationId) {
    throw new Error('Seller connection unavailable');
  }
  const payment = await dependencies.paymentForBusiness(input.resourceId, connection.business_id);
  // Same live_mode contract as record_mercadopago_payment_snapshot: production
  // demands live_mode === true. In test, Checkout Pro payments collected by a
  // test user report live_mode = true, so demanding false there dropped every
  // such notification; the collector check still pins them to the connected
  // seller, and a test connection only accepts a test_user seller.
  const liveModeValid = input.environment === 'production'
    ? payment.live_mode === true
    : payment.live_mode === undefined || typeof payment.live_mode === 'boolean';
  if (String(payment.id) !== input.resourceId || String(payment.collector_id) !== connection.seller_id ||
      !liveModeValid ||
      typeof payment.external_reference !== 'string' || !payment.external_reference) {
    throw new Error('Provider payment routing mismatch');
  }
  const intent = await dependencies.intentForReference(payment.external_reference);
  if (!intent || intent.environment !== input.environment || intent.business_id !== connection.business_id) {
    throw new Error('Payment intent routing mismatch');
  }
  return intent.business_id;
}
