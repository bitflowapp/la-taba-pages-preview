import type { PaymentEnvironment } from './payment-runtime.ts';
import {
  checkoutReturnUrl,
  getRequiredEnv,
  hashSensitive,
  providerEnvironment,
  requireRealPaymentSmokeAuthorization,
  sha256Hex,
  webhookUrl,
} from './payment-runtime.ts';

const MERCADOPAGO_API_BASE = 'https://api.mercadopago.com';

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

export function preferenceRequest(preparation: PreferencePreparation): Record<string, unknown> {
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
  return {
    items: preparation.items.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description || undefined,
      quantity: item.quantity,
      currency_id: 'ARS',
      unit_price: Number(item.unit_price),
    })),
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
      provider: 'mercadopago',
    },
  };
}

export async function mercadoPagoRequest(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<MercadoPagoApiResult> {
  // Every provider call, including webhook reconciliation and refunds, checks
  // the environment review before the backend-only access token is read.
  providerEnvironment();
  const accessToken = getRequiredEnv('MERCADOPAGO_ACCESS_TOKEN');
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (init.idempotencyKey) headers.set('X-Idempotency-Key', init.idempotencyKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${MERCADOPAGO_API_BASE}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const rawText = await response.text();
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
  } finally {
    clearTimeout(timeout);
  }
}

export async function createPreference(preparation: PreferencePreparation): Promise<{
  preferenceId: string;
  initPoint: string;
  sandboxInitPoint: string;
  responseHash: string;
  requestId: string;
}> {
  const request = preferenceRequest(preparation);
  const result = await mercadoPagoRequest('/checkout/preferences', {
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
  return { preferenceId, initPoint, sandboxInitPoint, responseHash, requestId: result.requestId };
}

export async function fetchPayment(paymentId: string): Promise<Record<string, unknown>> {
  const result = await mercadoPagoRequest(`/v1/payments/${encodeURIComponent(paymentId)}`);
  if (!result.response.ok || !result.body) throw new MercadoPagoApiError(result.response.status, await sha256Hex(result.rawText), result.requestId);
  return result.body;
}

export async function findPreferenceByExternalReference(externalReference: string): Promise<Record<string, unknown> | null> {
  const query = new URLSearchParams({
    external_reference: externalReference,
    limit: '10',
  });
  const result = await mercadoPagoRequest(`/checkout/preferences/search?${query.toString()}`);
  if (!result.response.ok || !result.body) {
    throw new MercadoPagoApiError(result.response.status, await sha256Hex(result.rawText), result.requestId);
  }
  const elements = Array.isArray(result.body.elements) ? result.body.elements : [];
  const candidate = elements.find((item) => object(item).external_reference === externalReference);
  if (!candidate) return null;
  const preferenceId = text(object(candidate).id);
  if (!preferenceId) return null;
  const preference = await mercadoPagoRequest(`/checkout/preferences/${encodeURIComponent(preferenceId)}`);
  if (!preference.response.ok || !preference.body) {
    throw new MercadoPagoApiError(preference.response.status, await sha256Hex(preference.rawText), preference.requestId);
  }
  return preference.body;
}

export async function fetchChargeback(chargebackId: string): Promise<Record<string, unknown>> {
  const result = await mercadoPagoRequest(`/v1/chargebacks/${encodeURIComponent(chargebackId)}`);
  if (!result.response.ok || !result.body) throw new MercadoPagoApiError(result.response.status, await sha256Hex(result.rawText), result.requestId);
  return result.body;
}

export async function fetchClaim(claimId: string): Promise<Record<string, unknown>> {
  const result = await mercadoPagoRequest(`/post-purchase/v1/claims/${encodeURIComponent(claimId)}`);
  if (!result.response.ok || !result.body) throw new MercadoPagoApiError(result.response.status, await sha256Hex(result.rawText), result.requestId);
  return result.body;
}

export async function paymentSnapshot(payment: Record<string, unknown>): Promise<Record<string, unknown>> {
  const payer = object(payment.payer);
  const refunds = Array.isArray(payment.refunds) ? payment.refunds : [];
  const refundedAmount = refunds.reduce((total, refund) => total + number(object(refund).amount), 0);
  const rawResponseHash = await sha256Hex(JSON.stringify(payment));
  const email = text(payer.email).toLowerCase();
  return {
    provider_payment_id: text(payment.id),
    external_reference: text(payment.external_reference),
    preference_id: text(payment.preference_id),
    merchant_order_id: text(object(payment.order).id),
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
