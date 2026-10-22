import { assertOAuthPaymentEnvironment, audit, invalidateRejectedToken, oauthMode, sellerAccessToken } from './seller-oauth.ts';
import type { PaymentEnvironment } from './payment-runtime.ts';
import {
  checkoutReturnUrl,
  getRequiredEnv,
  hashSensitive,
  providerEnvironment,
  PublicPaymentError,
  requireRealPaymentSmokeAuthorization,
  sha256Hex,
  webhookUrl,
} from './payment-runtime.ts';
import { WorkerDeadlineExceeded } from './worker-deadline.ts';
import type { Deadline } from './worker-deadline.ts';

const MERCADOPAGO_API_BASE = 'https://api.mercadopago.com';
const PROVIDER_CALL_TIMEOUT_MS = 12_000;

/**
 * Optional execution context of a provider read made by the payment worker: the invocation's time budget (a call
 * never outlives it) and a heartbeat the caller uses to keep its job lease alive between calls.
 */
export type ProviderReadContext = { deadline?: Deadline; beat?: () => Promise<void> };

export type PreferencePreparation = {
  checkout_session_id: string;
  payment_intent_id: string;
  payment_attempt_id: string;
  attempt_status: string;
  attempt_number: number;
  idempotency_key: string;
  preference_id: string | null;
  init_point: string | null;
  sandbox_init_point: string | null;
  external_reference: string;
  environment: PaymentEnvironment;
  currency: 'ARS';
  total: number;
  expires_at: string;
  items: Array<{
    id: string;
    title: string;
    description?: string | null;
    quantity: number;
    currency_id: 'ARS';
    unit_price: number;
  }>;
  allow_offline_payment_methods: boolean;
  installments_limit: number | null;
};

export type MercadoPagoApiResult = {
  response: Response;
  body: Record<string, unknown> | null;
  rawText: string;
  requestId: string;
};

export function assertPreparationEnvironment(preparation: PreferencePreparation): void {
  const environment = providerEnvironment();
  if (preparation.environment !== environment) {
    throw new Error('Mercado Pago environment does not match payment settings');
  }
  requireRealPaymentSmokeAuthorization(environment);
  if (preparation.currency !== 'ARS' || !Number.isFinite(Number(preparation.total)) || Number(preparation.total) <= 0) {
    throw new Error('Invalid server-side preference snapshot');
  }
}

export function preferenceRequest(preparation: PreferencePreparation, _businessId?: string): Record<string, unknown> {
  assertPreparationEnvironment(preparation);
  const expiresAt = new Date(preparation.expires_at);
  if (Number.isNaN(expiresAt.valueOf()) || expiresAt.valueOf() <= Date.now()) {
    throw new Error('Checkout session has expired');
  }
  const paymentMethods: Record<string, unknown> = {};
  if (!preparation.allow_offline_payment_methods) {
    paymentMethods.excluded_payment_types = [{ id: 'ticket' }];
  }
  if (Number.isInteger(preparation.installments_limit) && Number(preparation.installments_limit) > 0) {
    paymentMethods.installments = preparation.installments_limit;
  }
  const items = preparation.items.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description || undefined,
    quantity: item.quantity,
    currency_id: 'ARS' as const,
    unit_price: Number(item.unit_price),
  }));
  // `items` carries only the products, so a delivery fee would never reach
  // Mercado Pago: the payer was charged the subtotal while the intent expected
  // the full total, which both undercharges the order and fails the
  // amount_mismatch assertion when the payment comes back.
  const itemsTotal = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  const surcharge = Number((Number(preparation.total) - itemsTotal).toFixed(2));
  if (surcharge > 0) {
    items.push({
      id: 'taba-delivery-fee',
      title: 'Envío a domicilio',
      description: undefined,
      quantity: 1,
      currency_id: 'ARS' as const,
      unit_price: surcharge,
    });
  } else if (surcharge < 0) {
    throw new Error('Preference items exceed the server-side checkout total');
  }
  return {
    items,
    external_reference: preparation.external_reference,
    notification_url: webhookUrl(),
    back_urls: {
      success: checkoutReturnUrl('/pago/resultado'),
      pending: checkoutReturnUrl('/pago/pendiente'),
      failure: checkoutReturnUrl('/pago/error'),
    },
    auto_return: 'approved',
    expires: true,
    expiration_date_from: new Date().toISOString(),
    expiration_date_to: expiresAt.toISOString(),
    payment_methods: Object.keys(paymentMethods).length ? paymentMethods : undefined,
    metadata: {
      checkout_session_id: preparation.checkout_session_id,
      payment_attempt_id: preparation.payment_attempt_id,
      provider: 'mercadopago',
    },
  };
}

export async function mercadoPagoRequest(
  path: string,
  init: RequestInit & { idempotencyKey?: string; businessId?: string; authorityAccessToken?: string; deadline?: Deadline } = {},
): Promise<MercadoPagoApiResult> {
  // A worker that is out of time must not start a provider call it cannot finish and persist.
  init.deadline?.assertTime(1_500);
  // Every provider call, including webhook reconciliation and refunds, checks
  // the environment review before the backend-only access token is read.
  providerEnvironment();
  if (oauthMode()) assertOAuthPaymentEnvironment();
  if (oauthMode() && !init.businessId) throw new Error('Seller context required');
  const accessToken = oauthMode() ? (init.authorityAccessToken ?? await sellerAccessToken(init.businessId!)) : getRequiredEnv('MERCADOPAGO_ACCESS_TOKEN');
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (init.idempotencyKey) headers.set('X-Idempotency-Key', init.idempotencyKey);

  const controller = new AbortController();
  // Never longer than the usual cap and never past the end of the invocation's budget.
  const timeoutMs = init.deadline ? init.deadline.callTimeoutMs(PROVIDER_CALL_TIMEOUT_MS) : PROVIDER_CALL_TIMEOUT_MS;
  const clampedByDeadline = timeoutMs < PROVIDER_CALL_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { deadline: _deadline, ...fetchInit } = init;
    const response = await fetch(`${MERCADOPAGO_API_BASE}${path}`, {
      ...fetchInit,
      headers,
      signal: controller.signal,
    });
    const rawText = await response.text();
    if (response.status === 401 && oauthMode() && init.businessId) {
      await invalidateRejectedToken(init.businessId, accessToken);
    }
    let body: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch (_) {
      // A non-JSON provider error is represented only by its HTTP result and a
      // digest; never persist or log its raw body.
    }
    return {
      response,
      body,
      rawText,
      requestId: response.headers.get('x-request-id') || response.headers.get('x-correlation-id') || '',
    };
  } catch (error) {
    // The timer that fired was the end of the invocation's budget, not the provider failing: the caller must hand
    // its work back (resumable), not count a failure.
    if (clampedByDeadline && (error as { name?: string } | null)?.name === 'AbortError') throw new WorkerDeadlineExceeded();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createPreference(preparation: PreferencePreparation, businessId?: string, authorityAccessToken?: string): Promise<{
  preferenceId: string;
  initPoint: string;
  sandboxInitPoint: string;
  responseHash: string;
  requestId: string;
}> {
  const request = preferenceRequest(preparation, businessId);
  const result = await mercadoPagoRequest('/checkout/preferences', {
    businessId,
    authorityAccessToken,
    method: 'POST',
    body: JSON.stringify(request),
    idempotencyKey: preparation.idempotency_key,
  });
  const responseHash = await sha256Hex(result.rawText);
  if (!result.response.ok || !result.body) {
    throw new MercadoPagoApiError(result.response.status, responseHash, result.requestId);
  }
  const preferenceId = text(result.body.id);
  const initPoint = text(result.body.init_point);
  const sandboxInitPoint = text(result.body.sandbox_init_point);
  if (!preferenceId || !initPoint) {
    throw new MercadoPagoApiError(result.response.status || 502, responseHash, result.requestId);
  }
  if (businessId) audit('preference_created', businessId, result.requestId || crypto.randomUUID());
  return { preferenceId, initPoint, sandboxInitPoint, responseHash, requestId: result.requestId };
}

export async function fetchPayment(paymentId: string, businessId?: string, deadline?: Deadline): Promise<Record<string, unknown>> {
  const result = await mercadoPagoRequest(`/v1/payments/${encodeURIComponent(paymentId)}`, { businessId, deadline });
  if (!result.response.ok || !result.body) throw new MercadoPagoApiError(result.response.status, await sha256Hex(result.rawText), result.requestId);
  return result.body;
}

// A known refund is read by its own resource identity, never rediscovered in a
// payment's partial/reordered refunds summary.
export async function fetchRefund(paymentId: string, refundId: string, businessId: string, deadline?: Deadline): Promise<Record<string, unknown>> {
  const result = await mercadoPagoRequest(`/v1/payments/${encodeURIComponent(paymentId)}/refunds/${encodeURIComponent(refundId)}`, { businessId, deadline });
  if (!result.response.ok || !result.body) throw new MercadoPagoApiError(result.response.status, await sha256Hex(result.rawText), result.requestId);
  return result.body;
}

// Reconciliation entry point. Mercado Pago only delivers Checkout Pro test
// notifications through the preference's notification_url, signed with the
// auto-provisioned test application's key, which the panel never exposes — so
// those notifications can be received but never validated. Reading the payment
// back from the provider with the backend-only access token is a stronger
// check than the HMAC: nothing here is taken from the caller.
//
// ALL payments of a reference are returned, every page of the result. A
// checkout may hold several attempts (a rejected card, then an approved one,
// or two approvals): picking "the first" or reading only page one hides money.
export const PAYMENT_SEARCH_PAGE_SIZE = 50;
export const PAYMENT_SEARCH_MAX_PAGES = 20;

export async function findPaymentsByExternalReference(externalReference: string, businessId?: string, context: ProviderReadContext = {}): Promise<Record<string, unknown>[]> {
  const ids: string[] = [];
  let offset = 0;
  for (let page = 0; page < PAYMENT_SEARCH_MAX_PAGES; page += 1) {
    await context.beat?.();
    const query = new URLSearchParams({
      external_reference: externalReference,
      sort: 'date_created',
      criteria: 'asc',
      limit: String(PAYMENT_SEARCH_PAGE_SIZE),
      offset: String(offset),
    });
    const result = await mercadoPagoRequest(`/v1/payments/search?${query.toString()}`, { businessId, deadline: context.deadline });
    if (!result.response.ok || !result.body) {
      throw new MercadoPagoApiError(result.response.status, await sha256Hex(result.rawText), result.requestId);
    }
    const results = Array.isArray(result.body.results) ? result.body.results : [];
    for (const item of results) {
      const row = object(item);
      const id = text(row.id);
      if (id && text(row.external_reference) === externalReference && !ids.includes(id)) ids.push(id);
    }
    const total = pagingTotal(result.body);
    if (total === null) throw incompleteSearch();
    offset += results.length;
    if (offset >= total) {
      // The search payload is a summary; the durable snapshot always comes
      // from the full payment resource, exactly like the webhook worker.
      const payments: Record<string, unknown>[] = [];
      for (const id of ids) {
        await context.beat?.();
        payments.push(await fetchPayment(id, businessId, context.deadline));
      }
      return payments;
    }
    if (!results.length) throw incompleteSearch();
  }
  // More pages than the budget: never conclude anything from a partial list.
  throw incompleteSearch();
}

// Kept for callers that only need one payment: approved first, then newest.
export async function findPaymentByExternalReference(externalReference: string, businessId?: string): Promise<Record<string, unknown> | null> {
  const payments = await findPaymentsByExternalReference(externalReference, businessId);
  return payments.find((payment) => text(payment.status).toLowerCase() === 'approved') || payments.at(-1) || null;
}

export type LedgerPage = { results: Record<string, unknown>[]; total: number; offset: number };

// One page of the seller's payment ledger by LAST UPDATE. Searching by creation date (the previous behavior) can
// never show a refund, a chargeback or a late approval of an old payment. Dates use the provider's documented format
// (ISO-8601, milliseconds); `offset` is only ever the number of rows already handled at one exact timestamp, so it
// stays far below the provider's ceiling (10 000). The caller owns the cursor; a page that cannot be read is an
// error, never "empty".
export async function searchPaymentsByLastUpdate(
  businessId: string, beginIso: string, endIso: string, offset: number, limit = PAYMENT_SEARCH_PAGE_SIZE, deadline?: Deadline,
): Promise<LedgerPage> {
  const query = new URLSearchParams({
    sort: 'date_last_updated',
    criteria: 'asc',
    range: 'date_last_updated',
    begin_date: new Date(Date.parse(beginIso)).toISOString(),
    end_date: new Date(Date.parse(endIso)).toISOString(),
    limit: String(Math.min(limit, PAYMENT_SEARCH_PAGE_SIZE)),
    offset: String(Math.max(0, offset)),
  });
  const result = await mercadoPagoRequest(`/v1/payments/search?${query.toString()}`, { businessId, deadline });
  if (!result.response.ok || !result.body) {
    throw new MercadoPagoApiError(result.response.status, await sha256Hex(result.rawText), result.requestId);
  }
  const results = (Array.isArray(result.body.results) ? result.body.results : []).map(object);
  const total = pagingTotal(result.body);
  if (total === null) throw incompleteSearch();
  return { results, total, offset };
}

// Read-only evidence for an operator: what the provider lists as refunds of a payment.
export async function listPaymentRefunds(paymentId: string, businessId: string, deadline?: Deadline): Promise<Record<string, unknown>[]> {
  const result = await mercadoPagoRequest(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`, { businessId, deadline });
  if (!result.response.ok) throw new MercadoPagoApiError(result.response.status, await sha256Hex(result.rawText), result.requestId);
  let parsed: unknown = result.body;
  if (!parsed) { try { parsed = JSON.parse(result.rawText); } catch (_) { parsed = null; } }
  return Array.isArray(parsed) ? parsed.map(object) : [];
}

function pagingTotal(body: Record<string, unknown>): number | null {
  const paging = object(body.paging);
  const total = typeof paging.total === 'number' ? paging.total : typeof body.total === 'number' ? body.total : Number.NaN;
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

function incompleteSearch(): PublicPaymentError {
  return new PublicPaymentError(503, 'PROVIDER_SEARCH_INCOMPLETE', 'La búsqueda del proveedor no devolvió un resultado completo.');
}

export async function findPreferenceByExternalReference(externalReference: string, businessId?: string, authorityAccessToken?: string, paymentAttemptId?: string, sellerId?: string): Promise<Record<string, unknown> | null> {
  const query = new URLSearchParams({
    external_reference: externalReference,
    limit: '10',
  });
  const result = await mercadoPagoRequest(`/checkout/preferences/search?${query.toString()}`, { businessId, authorityAccessToken });
  if (!result.response.ok || !result.body) {
    throw new MercadoPagoApiError(result.response.status, await sha256Hex(result.rawText), result.requestId);
  }
  const elements = completePreferenceSearchElements(result.body);
  const ambiguous = () => preferenceReconciliationRequired();
  let matched: Record<string, unknown> | null = null;
  for (const candidate of elements.filter((item) => object(item).external_reference === externalReference)) {
    const preferenceId = text(object(candidate).id);
    if (!preferenceId) throw ambiguous();
    const preference = await mercadoPagoRequest(`/checkout/preferences/${encodeURIComponent(preferenceId)}`, { businessId, authorityAccessToken });
    if (!preference.response.ok || !preference.body) {
      throw new MercadoPagoApiError(preference.response.status, await sha256Hex(preference.rawText), preference.requestId);
    }
    if (String(preference.body.id) !== preferenceId || preference.body.external_reference !== externalReference ||
      (sellerId && String(preference.body.collector_id) !== sellerId)) throw ambiguous();
    if (paymentAttemptId) {
      const associatedAttempt = object(preference.body.metadata).payment_attempt_id;
      if (!associatedAttempt) throw ambiguous();
      if (associatedAttempt !== paymentAttemptId) continue;
    }
    if (matched) throw ambiguous();
    matched = preference.body;
  }
  return matched;
}

export function completePreferenceSearchElements(body: Record<string, unknown>): unknown[] {
  const elements = Array.isArray(body.elements) ? body.elements : [];
  // Search recovery is allowed only from a demonstrably complete result set.
  // Missing/malformed pagination used to fall back to elements.length, which
  // could turn a truncated response into a blind second POST.
  //
  // GET /checkout/preferences/search answers `{ elements, next_offset, total }`
  // with `total` at the top level (measured 2026-09-25, x-request-id
  // e3af2b6c-b2db-45ea-a647-c5c7241b9c67). Reading only `paging.total` made
  // every real answer look truncated, so no preference could ever be created.
  // `paging.total` stays accepted for the older fixtures' shape.
  const paging = object(body.paging);
  const total = typeof body.total === 'number'
    ? body.total
    : typeof paging.total === 'number' ? paging.total : Number.NaN;
  if (!Number.isSafeInteger(total) || total < 0 || total !== elements.length) {
    throw preferenceReconciliationRequired();
  }
  return elements;
}

function preferenceReconciliationRequired(): PublicPaymentError {
  return new PublicPaymentError(409, 'PREFERENCE_RECONCILING', 'La preferencia requiere conciliación antes de otro intento.');
}

// Adopt an already-persisted legacy URL only from its specific provider resource.
// Never stamp today's seller onto an old URL based solely on local association.
export async function verifyStoredPreference(
  preparation: PreferencePreparation, businessId: string, authorityAccessToken: string, sellerId: string,
): Promise<Record<string, unknown> | null> {
  if (!preparation.preference_id || !preparation.init_point) return null;
  const result = await mercadoPagoRequest(`/checkout/preferences/${encodeURIComponent(preparation.preference_id)}`, {
    businessId, authorityAccessToken,
  });
  const body = result.body;
  if (!result.response.ok || !body || String(body.id) !== preparation.preference_id ||
    String(body.collector_id) !== sellerId || body.init_point !== preparation.init_point ||
    body.external_reference !== preparation.external_reference ||
    object(body.metadata).checkout_session_id !== preparation.checkout_session_id ||
    (object(body.metadata).payment_attempt_id !== undefined &&
      object(body.metadata).payment_attempt_id !== preparation.payment_attempt_id)) return null;
  return body;
}

// A Checkout Pro payment does not carry `preference_id`: it is only reachable
// through its merchant order. Without this hop the stored snapshot has an empty
// preference and the intent assertion can never match.
export async function fetchMerchantOrder(merchantOrderId: string, businessId?: string, deadline?: Deadline): Promise<Record<string, unknown> | null> {
  const result = await mercadoPagoRequest(`/merchant_orders/${encodeURIComponent(merchantOrderId)}`, { businessId, deadline });
  // Only a definitive "does not exist" is null. A 5xx, a timeout or throttling says nothing about the order: it is
  // an error, so the caller retries instead of building a snapshot with an empty preference (finding F07).
  if (result.response.status === 404) return null;
  if (!result.response.ok || !result.body) {
    throw new MercadoPagoApiError(result.response.status, await sha256Hex(result.rawText), result.requestId);
  }
  return result.body;
}

export async function fetchChargeback(chargebackId: string, businessId?: string, deadline?: Deadline): Promise<Record<string, unknown>> {
  const result = await mercadoPagoRequest(`/v1/chargebacks/${encodeURIComponent(chargebackId)}`, { businessId, deadline });
  if (!result.response.ok || !result.body) throw new MercadoPagoApiError(result.response.status, await sha256Hex(result.rawText), result.requestId);
  return result.body;
}

export async function fetchClaim(claimId: string, businessId?: string, deadline?: Deadline): Promise<Record<string, unknown>> {
  const result = await mercadoPagoRequest(`/post-purchase/v1/claims/${encodeURIComponent(claimId)}`, { businessId, deadline });
  if (!result.response.ok || !result.body) throw new MercadoPagoApiError(result.response.status, await sha256Hex(result.rawText), result.requestId);
  return result.body;
}

export async function paymentSnapshot(payment: Record<string, unknown>, businessId?: string, deadline?: Deadline): Promise<Record<string, unknown>> {
  const payer = object(payment.payer);
  const refunds = Array.isArray(payment.refunds) ? payment.refunds : [];
  const refundedAmount = refunds.reduce((total, refund) => total + number(object(refund).amount), 0);
  // Identities, not only a sum: the database keeps one row per provider refund so that a refund made from the
  // provider panel and one made here are both counted, once.
  const refundList = refunds
    .map((refund) => object(refund))
    .filter((refund) => text(refund.id) !== '')
    .map((refund) => ({ id: text(refund.id), amount: number(refund.amount).toFixed(2), status: text(refund.status).toLowerCase() || 'approved' }));
  const rawResponseHash = await sha256Hex(JSON.stringify(payment));
  const email = text(payer.email).toLowerCase();
  const merchantOrderId = text(object(payment.order).id);
  let preferenceId = text(payment.preference_id);
  if (!preferenceId && merchantOrderId) {
    const merchantOrder = await fetchMerchantOrder(merchantOrderId, businessId, deadline);
    preferenceId = text(object(merchantOrder).preference_id);
  }
  return {
    provider_payment_id: text(payment.id),
    external_reference: text(payment.external_reference),
    preference_id: preferenceId,
    merchant_order_id: merchantOrderId,
    collector_id: text(payment.collector_id),
    application_id: text(payment.application_id),
    currency: text(payment.currency_id).toUpperCase(),
    transaction_amount: number(payment.transaction_amount).toFixed(2),
    status: text(payment.status).toLowerCase(),
    status_detail: text(payment.status_detail).toLowerCase(),
    payment_method: text(payment.payment_method_id),
    live_mode: Boolean(payment.live_mode),
    provider_occurred_at: text(payment.date_last_updated) || text(payment.date_approved) || text(payment.date_created),
    refunded_amount: refundedAmount.toFixed(2),
    refunds: refundList,
    payer_email_hash: email ? await hashSensitive(email, 'mercadopago-payer-email') : '',
    raw_response_hash: rawResponseHash,
  };
}

export async function disputeSnapshot(
  dispute: Record<string, unknown>,
  paymentId: string,
): Promise<Record<string, unknown>> {
  const rawResponseHash = await sha256Hex(JSON.stringify(dispute));
  return {
    provider_dispute_id: text(dispute.id),
    provider_payment_id: paymentId,
    status: text(dispute.status).toLowerCase(),
    coverage_eligible: Boolean(dispute.coverage_eligible),
    documentation_required: Boolean(dispute.documentation_required),
    documentation_status: text(dispute.documentation_status),
    opened_at: text(dispute.date_created) || text(dispute.date_opened),
    resolved_at: text(dispute.date_closed) || text(dispute.date_resolved),
    raw_response_hash: rawResponseHash,
  };
}

/**
 * Whether a 4xx from Mercado Pago is the provider's final answer about the
 * operation. Throttling (429), timeouts (408), too-early (425) and conflicts
 * (409, e.g. the same idempotency key still in flight) say nothing about it:
 * recording them as a rejection would write a financial state the provider
 * never decided. Those go through reconciliation, like a 5xx.
 */
export function isFinalProviderRejection(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
}

export class MercadoPagoApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseHash: string,
    public readonly requestId: string,
  ) {
    super('Mercado Pago API request failed');
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
