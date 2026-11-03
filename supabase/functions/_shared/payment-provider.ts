/**
 * The seam between TABA's checkout and a payment provider.
 *
 * Two providers exist and BOTH stay:
 *
 *   mercadopago  `delegated`  — its flow lives in the existing `mercadopago-*` Edge Functions and the
 *                               payment_intents/payment_outbox tables. This module only DESCRIBES it so the
 *                               storefront and the operator panel can treat providers uniformly; nothing in the
 *                               Mercado Pago path is rewritten or routed through here.
 *   mobbex       `native`     — implemented against this interface (see ./mobbex/provider.ts).
 *
 * Adding a third provider means implementing `PaymentProvider` and registering it; it must bring its own ledger
 * tables if its states are not Mercado Pago's (see the header of 20261103010000_mobbex_checkout_foundation.sql
 * for why providers do not share `payment_intents`).
 *
 * Rules every implementation must keep (they are the contract tests/payment-provider-contract.test.mjs enforces on
 * Mobbex and that a new provider must also satisfy):
 *   1. The amount comes from the server's own checkout session. `createCheckout` has no way to receive a client total.
 *   2. `fetchPaymentState` is an authenticated server-to-server read. A webhook or a browser return is only a hint.
 *   3. No credentials in any value that leaves the implementation (logs, errors, responses).
 *   4. Disabled by default: `availability` is false until configuration says otherwise.
 */

export type PaymentProviderId = 'mercadopago' | 'mobbex';

export type ProviderImplementation = 'native' | 'delegated-edge-functions';

export interface CheckoutRequest {
  checkoutSessionId: string;
  businessId: string;
  /** Unique external reference of this purchase, minted by the server. */
  reference: string;
  /** Final amount in cents, read from the server's checkout session. */
  totalCents: number;
  description: string;
  customer: { email: string; name: string };
  items: Array<{ description: string; quantity: number; totalCents: number }>;
  /** Minutes the hosted checkout may stay payable (never longer than the stock reservation). */
  timeoutMinutes: number;
  returnUrl: string;
  webhookUrl: string;
}

export interface CreatedProviderCheckout {
  redirectUrl: string;
  externalId: string;
  responseHash: string;
}

export type ProviderStatusClass =
  | 'approved' | 'authorized' | 'pending' | 'rejected' | 'expired' | 'cancelled' | 'reversing'
  | 'refunded' | 'partially_refunded' | 'unknown';

export interface ProviderPaymentState {
  /** `null` = the provider has no confirmation (this is NOT "unpaid" and NOT "rejected"). */
  confirmed: boolean;
  snapshot: Record<string, unknown> | null;
  statusClass: ProviderStatusClass | null;
  reason?: string;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  readonly implementation: ProviderImplementation;
  /** Safe to log and to show an operator: no credentials, only booleans and names. */
  describe(): Record<string, unknown>;
  createCheckout(request: CheckoutRequest): Promise<CreatedProviderCheckout>;
  fetchPaymentState(reference: string): Promise<ProviderPaymentState>;
  refund(externalPaymentId: string, amountCents: number | null): Promise<{ approved: boolean; responseHash: string }>;
}

export class UnsupportedProviderOperation extends Error {
  readonly code = 'UNSUPPORTED_PROVIDER_OPERATION';
}

/** Mercado Pago, described but not re-implemented: its Edge Functions remain the only path. */
export const mercadoPagoProviderDescriptor: PaymentProvider = {
  id: 'mercadopago',
  implementation: 'delegated-edge-functions',
  describe: () => ({
    id: 'mercadopago',
    implementation: 'delegated-edge-functions',
    functions: ['mercadopago-create-checkout-session', 'mercadopago-create-preference', 'mercadopago-webhook',
      'mercadopago-payment-worker', 'mercadopago-refund', 'mercadopago-cancel-payment', 'mercadopago-checkout-status'],
  }),
  createCheckout: () => Promise.reject(new UnsupportedProviderOperation('Mercado Pago runs through its own mercadopago-* Edge Functions')),
  fetchPaymentState: () => Promise.reject(new UnsupportedProviderOperation('Mercado Pago runs through its own mercadopago-* Edge Functions')),
  refund: () => Promise.reject(new UnsupportedProviderOperation('Mercado Pago runs through its own mercadopago-* Edge Functions')),
};

export class PaymentProviderRegistry {
  private readonly providers = new Map<PaymentProviderId, PaymentProvider>();

  register(provider: PaymentProvider): this {
    if (this.providers.has(provider.id)) throw new Error(`payment provider already registered: ${provider.id}`);
    this.providers.set(provider.id, provider);
    return this;
  }

  get(id: string): PaymentProvider {
    const provider = this.providers.get(id as PaymentProviderId);
    if (!provider) throw new Error(`unknown payment provider: ${id}`);
    return provider;
  }

  list(): PaymentProvider[] {
    return [...this.providers.values()];
  }
}
