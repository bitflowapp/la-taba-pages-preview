/**
 * Minimal Mobbex REST client. No Deno globals: it receives `fetch` so it runs
 * unchanged in an Edge Function, in Node tests and in the sandbox probe.
 *
 * Endpoints (official documentation, https://mobbex.dev, verified against the
 * sandbox with scripts/mobbex/sandbox-contract-probe.mjs on 2026-11-03):
 *
 *   POST https://api.mobbex.com/p/checkout                 create a hosted checkout
 *   GET  https://api.mobbex.com/p/operations/{reference}   read operation(s) by OUR reference
 *   GET  https://api.mobbex.com/p/operations/{id}/refund   full refund / same-day cancellation
 *   POST https://api.mobbex.com/p/operations/{id}/refund   partial refund `{ total }`
 *
 * Facts measured on the real sandbox that shaped this file:
 *   - Looking up a reference with no operation answers HTTP 200 with
 *     `{ result: false, code: "GENERIC:EFCS", error: "Execution failed..." }`,
 *     NOT a 404. "No operation" and "Mobbex failed" are indistinguishable, so
 *     `found: false` here means only "no confirmation available": callers must
 *     never read it as paid and never as a final rejection.
 *   - A reference containing characters outside [A-Za-z0-9-] reaches a WAF and
 *     answers 403, hence the strict reference pattern below.
 *   - Credentials are the merchant's `x-api-key` + `x-access-token`; wrong ones answer 401.
 *
 * Secrets are never logged and never placed in an Error message.
 */

export const MOBBEX_API_BASE = 'https://api.mobbex.com';
export const MOBBEX_OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{6,80}$/;
export const MOBBEX_REFERENCE_PATTERN = /^taba2-mbx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class MobbexApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly kind: 'auth' | 'rejected' | 'server' | 'network' | 'malformed';
  constructor(kind: MobbexApiError['kind'], status: number, message: string) {
    super(message);
    this.kind = kind;
    this.status = status;
    // Only a request Mobbex provably refused is final. Anything that may have reached it is uncertain.
    this.retryable = kind !== 'rejected';
  }
}

export interface MobbexClientOptions {
  apiKey: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Tests only. Production code never overrides it; non-https bases are refused outside loopback. */
  baseUrl?: string;
}

export interface CreateCheckoutInput {
  /** Final amount decided by the server, in cents. The client sends it formatted as XXX.xx. */
  totalCents: number;
  reference: string;
  description: string;
  returnUrl: string;
  webhookUrl: string;
  /** Minutes the hosted checkout stays payable. Must not outlive the stock reservation. */
  timeoutMinutes: number;
  customer: { email: string; name: string };
  items: Array<{ description: string; quantity: number; totalCents: number }>;
  /** True for the sandbox. With production credentials this makes Mobbex run the operation in test mode. */
  test: boolean;
}

export interface CreatedCheckout {
  checkoutId: string;
  url: string;
  responseHash: string;
}

export type OperationLookup =
  | { found: false; code: string; responseHash: string }
  | { found: true; body: Record<string, unknown>; responseHash: string };

export function centsToDecimalString(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError('amount must be a non-negative integer number of cents');
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

/** Exact conversion of a decimal amount to cents; null when it is not representable with two decimals. */
export function decimalToCents(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class MobbexClient {
  private readonly apiKey: string;
  private readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(options: MobbexClientOptions) {
    if (!options.apiKey || !options.accessToken) throw new Error('Mobbex credentials are required');
    this.apiKey = options.apiKey;
    this.accessToken = options.accessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    const base = (options.baseUrl ?? MOBBEX_API_BASE).replace(/\/$/, '');
    const parsed = new URL(base);
    const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
    if (base !== MOBBEX_API_BASE && !(loopback && parsed.protocol === 'http:')) {
      throw new Error('Mobbex base URL may only be overridden with a loopback address (tests)');
    }
    this.baseUrl = base;
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | null; hash: string }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'x-api-key': this.apiKey,
          'x-access-token': this.accessToken,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (_) {
      // Timeout, DNS, TLS, reset: the request may or may not have been processed.
      throw new MobbexApiError('network', 0, 'Mobbex request failed before a response arrived');
    }
    const text = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(text);
      json = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch (_) { /* non-JSON bodies (WAF pages) stay null */ }
    return { status: response.status, json, hash: await sha256Hex(text) };
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreatedCheckout> {
    if (!MOBBEX_REFERENCE_PATTERN.test(input.reference)) throw new RangeError('invalid Mobbex reference');
    if (!Number.isInteger(input.timeoutMinutes) || input.timeoutMinutes < 5 || input.timeoutMinutes > 60) {
      throw new RangeError('timeoutMinutes must be between 5 and 60');
    }
    const payload = {
      total: Number(centsToDecimalString(input.totalCents)),
      currency: 'ARS',
      description: input.description.slice(0, 120),
      reference: input.reference,
      test: input.test,
      timeout: input.timeoutMinutes,
      return_url: input.returnUrl,
      webhook: input.webhookUrl,
      customer: { email: input.customer.email, name: input.customer.name.slice(0, 80) },
      items: input.items.slice(0, 50).map((item) => ({
        description: item.description.slice(0, 80),
        quantity: item.quantity,
        total: Number(centsToDecimalString(item.totalCents)),
      })),
    };
    const { status, json, hash } = await this.request('POST', '/p/checkout', payload);
    if (status === 401 || status === 403) throw new MobbexApiError('auth', status, 'Mobbex rejected the credentials');
    if (status >= 500 || status === 429 || status === 408) throw new MobbexApiError('server', status, 'Mobbex is unavailable');
    if (status >= 400) throw new MobbexApiError('rejected', status, 'Mobbex refused the checkout');
    const data = json?.data as Record<string, unknown> | undefined;
    const id = typeof data?.id === 'string' ? data.id : '';
    const url = typeof data?.url === 'string' ? data.url : '';
    if (json?.result !== true || !id || !url) throw new MobbexApiError('malformed', status, 'Mobbex checkout response is incomplete');
    let parsedUrl: URL;
    try { parsedUrl = new URL(url); } catch (_) { throw new MobbexApiError('malformed', status, 'Mobbex checkout URL is invalid'); }
    if (parsedUrl.protocol !== 'https:' || !/(^|\.)mobbex\.com$/.test(parsedUrl.hostname)) {
      // The customer is redirected to this URL: it must be Mobbex's, never an attacker-influenced host.
      throw new MobbexApiError('malformed', status, 'Mobbex checkout URL is not a Mobbex host');
    }
    return { checkoutId: id, url: parsedUrl.toString(), responseHash: hash };
  }

  async getOperationByReference(reference: string): Promise<OperationLookup> {
    if (!MOBBEX_REFERENCE_PATTERN.test(reference)) throw new RangeError('invalid Mobbex reference');
    const { status, json, hash } = await this.request('GET', `/p/operations/${encodeURIComponent(reference)}`);
    if (status === 401 || status === 403) throw new MobbexApiError('auth', status, 'Mobbex rejected the credentials');
    if (status >= 500 || status === 429 || status === 408) throw new MobbexApiError('server', status, 'Mobbex is unavailable');
    if (status === 404) return { found: false, code: 'HTTP_404', responseHash: hash };
    if (status >= 400) throw new MobbexApiError('malformed', status, 'Unexpected Mobbex response');
    if (!json) throw new MobbexApiError('malformed', status, 'Mobbex operation response is not JSON');
    if (json.result !== true) {
      return { found: false, code: typeof json.code === 'string' ? json.code.slice(0, 64) : 'RESULT_FALSE', responseHash: hash };
    }
    return { found: true, body: json, responseHash: hash };
  }

  /**
   * `amountCents` null = full refund / same-day cancellation (GET); a number is a partial refund (POST).
   * Partial refunds cannot be made on the day of the payment (official docs): Mobbex answers an error.
   */
  async refundOperation(operationId: string, amountCents: number | null): Promise<{ approved: boolean; responseHash: string }> {
    if (!MOBBEX_OPERATION_ID_PATTERN.test(operationId)) throw new RangeError('invalid Mobbex operation id');
    const path = `/p/operations/${encodeURIComponent(operationId)}/refund`;
    const { status, json, hash } = amountCents === null
      ? await this.request('GET', path)
      : await this.request('POST', path, { total: Number(centsToDecimalString(amountCents)) });
    if (status === 401 || status === 403) throw new MobbexApiError('auth', status, 'Mobbex rejected the credentials');
    if (status >= 500 || status === 429 || status === 408) throw new MobbexApiError('server', status, 'Mobbex is unavailable');
    if (status >= 400) throw new MobbexApiError('rejected', status, 'Mobbex refused the refund');
    if (!json) throw new MobbexApiError('malformed', status, 'Mobbex refund response is not JSON');
    // HTTP 200 with result:false is a refusal from Mobbex's own business rules, not a transport failure.
    return { approved: json.result === true, responseHash: hash };
  }
}
