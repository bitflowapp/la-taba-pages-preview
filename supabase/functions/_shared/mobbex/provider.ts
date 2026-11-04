import {
  type CheckoutRequest,
  type CreatedProviderCheckout,
  type PaymentProvider,
  type ProviderPaymentState,
} from '../payment-provider.ts';
import { MobbexClient } from './client.ts';
import type { MobbexConfig } from './config.ts';
import { buildMobbexSnapshot } from './snapshot.ts';

/**
 * Mobbex hosted-checkout provider, single merchant: the money lands in the account whose credentials are loaded,
 * which is the commerce's own (Walter's), never LUNA's. There is no OAuth, no marketplace and no split.
 */
export class MobbexCheckoutProvider implements PaymentProvider {
  readonly id = 'mobbex' as const;
  readonly implementation = 'native' as const;
  private readonly client: MobbexClient;
  private readonly config: MobbexConfig;

  constructor(config: MobbexConfig, client?: MobbexClient) {
    this.config = config;
    this.client = client ?? new MobbexClient({ apiKey: config.apiKey, accessToken: config.accessToken, testOperations: config.environment === 'test' });
  }

  describe(): Record<string, unknown> {
    return { id: this.id, implementation: this.implementation, environment: this.config.environment, single_merchant: true, split: false };
  }

  async createCheckout(request: CheckoutRequest): Promise<CreatedProviderCheckout> {
    const created = await this.client.createCheckout({
      totalCents: request.totalCents,
      reference: request.reference,
      description: request.description,
      returnUrl: request.returnUrl,
      webhookUrl: request.webhookUrl,
      timeoutMinutes: request.timeoutMinutes,
      customer: request.customer,
      items: request.items,
      // Sandbox flag: in `test` the operation never moves money, even with a merchant's production credentials.
      test: this.config.environment === 'test',
    });
    return { redirectUrl: created.url, externalId: created.checkoutId, responseHash: created.responseHash };
  }

  async fetchPaymentState(reference: string): Promise<ProviderPaymentState> {
    const lookup = await this.client.getOperationByReference(reference);
    if (!lookup.found) return { confirmed: false, snapshot: null, statusClass: null, reason: lookup.code };
    const built = buildMobbexSnapshot(reference, lookup.body, lookup.responseHash, lookup.attempts);
    if (!built.ok) return { confirmed: false, snapshot: null, statusClass: null, reason: built.reason };
    return { confirmed: true, snapshot: built.snapshot as unknown as Record<string, unknown>, statusClass: built.snapshot.status_class };
  }

  refund(externalPaymentId: string, amountCents: number | null) {
    return this.client.refundOperation(externalPaymentId, amountCents);
  }
}
