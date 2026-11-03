/**
 * Mobbex flows as PURE functions over injected ports. No Deno, no Supabase client, no global fetch:
 * the Edge Functions (`supabase/functions/mobbex-*`) wire real ports, the tests wire fakes. That is what lets
 * duplicate / lost / out-of-order / concurrent / forged scenarios run in `npm test` without a network.
 *
 * Money never moves here. Every financial fact is decided by the database (`mobbex_record_provider_snapshot`);
 * this layer only (1) asks the provider, (2) hands the CONFIRMED answer over, (3) decides when to look again.
 */

import { MobbexApiError } from './client.ts';
import { MobbexConfigError, type MobbexConfig } from './config.ts';
import { buildMobbexSnapshot } from './snapshot.ts';
import {
  MOBBEX_WEBHOOK_MAX_BYTES,
  buildMobbexWebhookUrl,
  parseMobbexWebhook,
  verifyMobbexWebhookToken,
} from './webhook.ts';
import { decimalToCents, type CreatedCheckout, type OperationLookup } from './client.ts';

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

export class LedgerError extends Error {
  readonly sqlMessage: string;
  constructor(sqlMessage: string) {
    super('ledger error');
    this.sqlMessage = sqlMessage;
  }
}

export interface PreparedCheckout {
  claimed: boolean;
  reuse?: boolean;
  in_flight?: boolean;
  checkout_url?: string;
  checkout_session_id: string;
  intent_id?: string;
  reference?: string;
  environment?: string;
  expected_amount?: number | string;
  expires_at?: string;
  items?: Array<{ name: string; quantity: number; subtotal: number | string }>;
}

export interface ClaimedJob {
  job_id: string;
  payment_intent_id: string;
  reference: string;
  environment: string;
  reason: string;
  failures: number;
}

export interface LedgerPort {
  availability(businessId: string): Promise<{ available: boolean; environment?: string }>;
  createSession(userId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  prepareCheckout(sessionId: string, userId: string): Promise<PreparedCheckout>;
  recordCheckoutCreated(intentId: string, checkoutId: string, url: string, responseHash: string): Promise<void>;
  recordCheckoutFailed(intentId: string, code: string, responseHash: string): Promise<void>;
  recordCheckoutUncertain(intentId: string, code: string): Promise<void>;
  recordWebhookReceipt(input: { environment: string; reference: string; payloadHash: string; hintStatusCode: string; hintPaymentId: string }): Promise<{ unknown_reference?: boolean; duplicate?: boolean; intent_id?: string }>;
  recordSnapshot(intentId: string, snapshot: Record<string, unknown>, source: string): Promise<Record<string, unknown>>;
  recordNoOperation(intentId: string, code: string): Promise<{ closed: boolean; retry_after_seconds: number }>;
  claimJobs(owner: string, limit: number, leaseSeconds: number): Promise<ClaimedJob[]>;
  finishJob(jobId: string, owner: string, outcome: 'done' | 'again' | 'failed', delaySeconds: number, error: string | null): Promise<string>;
  sweep(): Promise<Record<string, unknown>>;
}

export interface MobbexOperationsPort {
  createCheckout(input: Parameters<import('./client.ts').MobbexClient['createCheckout']>[0]): Promise<CreatedCheckout>;
  getOperationByReference(reference: string): Promise<OperationLookup>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Messages raised by the database that are safe and useful to show; everything else is a generic refusal. */
const SAFE_SQL_CODES: Array<[RegExp, string, string, number]> = [
  [/BUSINESS_CLOSED/, 'BUSINESS_CLOSED', 'El comercio está cerrado en este momento.', 409],
  [/ALCOHOL_WINDOW_CLOSED/, 'ALCOHOL_WINDOW_CLOSED', 'La venta de alcohol no está disponible en este horario.', 409],
  [/OUT_OF_DELIVERY_ZONE/, 'OUT_OF_DELIVERY_ZONE', 'La dirección está fuera de la zona de entrega.', 409],
  [/DELIVERY_LOCATION_REQUIRED/, 'DELIVERY_LOCATION_REQUIRED', 'Confirmá la ubicación de entrega en el mapa.', 409],
  [/stock insuficiente/i, 'OUT_OF_STOCK', 'Ya no queda stock suficiente de algún producto.', 409],
  [/producto no disponible/i, 'PRODUCT_UNAVAILABLE', 'Algún producto ya no está disponible.', 409],
  [/MOBBEX_LIVE_|Mobbex no esta configurado/, 'PAYMENTS_NOT_ENABLED', 'Mobbex no está disponible para este comercio en este momento.', 409],
];

export function publicErrorForLedger(error: unknown): HttpResult {
  const message = error instanceof LedgerError ? error.sqlMessage : '';
  for (const [pattern, code, text, status] of SAFE_SQL_CODES) {
    if (pattern.test(message)) return { status, body: { ok: false, code, message: text } };
  }
  return { status: 409, body: { ok: false, code: 'CHECKOUT_NOT_AVAILABLE', message: 'No podemos preparar este pago. Revisá el carrito y volvé a intentar.' } };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Create the hosted checkout
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CreateCheckoutDeps {
  ledger: LedgerPort;
  resolveConfig: () => MobbexConfig;
  operations: (config: MobbexConfig) => MobbexOperationsPort;
  supabaseUrl: string;
  /** Absolute URL on the storefront the browser comes back to. It never marks anything as paid. */
  returnUrl: string;
  now: () => number;
}

export async function createMobbexCheckout(
  deps: CreateCheckoutDeps,
  input: { userId: string; userEmail: string; payload: Record<string, unknown> },
): Promise<HttpResult> {
  const notEnabled: HttpResult = { status: 409, body: { ok: false, code: 'PAYMENTS_NOT_ENABLED', message: 'Mobbex no está disponible para este comercio en este momento.' } };
  let config: MobbexConfig;
  try { config = deps.resolveConfig(); } catch (error) {
    if (error instanceof MobbexConfigError) return notEnabled;
    throw error;
  }
  const payload = input.payload;
  const businessId = String(payload.business_id ?? '').trim();
  // Resuming an existing session never reserves stock again; a new one reserves it, so the gates run first.
  const resumeId = typeof payload.checkout_session_id === 'string' ? payload.checkout_session_id.trim() : '';
  if (!resumeId) {
    if (!UUID.test(businessId)) return { status: 400, body: { ok: false, code: 'INVALID_REQUEST', message: 'Solicitud inválida.' } };
    const availability = await deps.ledger.availability(businessId).catch(() => ({ available: false }));
    if (availability.available !== true || (availability as { environment?: string }).environment !== config.environment) return notEnabled;
  }

  let sessionId = resumeId;
  if (!sessionId) {
    // The whitelist lives in the database; this layer forwards the payload untouched and adds nothing the browser could forge.
    const { checkout_session_id: _ignored, ...forwarded } = payload;
    try {
      const session = await deps.ledger.createSession(input.userId, { ...forwarded, payment_method: 'mobbex' });
      sessionId = String(session.checkout_session_id ?? '');
    } catch (error) {
      return publicErrorForLedger(error);
    }
  }
  if (!UUID.test(sessionId)) return publicErrorForLedger(null);

  let prepared: PreparedCheckout;
  try { prepared = await deps.ledger.prepareCheckout(sessionId, input.userId); } catch (error) { return publicErrorForLedger(error); }
  if (prepared.reuse && prepared.checkout_url) {
    return { status: 200, body: { ok: true, redirect_url: prepared.checkout_url, checkout_session_id: sessionId, expires_at: prepared.expires_at ?? null, status: 'redirect_ready' } };
  }
  if (!prepared.claimed || !prepared.intent_id || !prepared.reference) {
    return { status: 202, body: { ok: false, code: 'CHECKOUT_RECONCILING', status: 'reconciling', message: 'Estamos preparando tu pago. No vuelvas a pagar todavía.' } };
  }

  // The amount is the one the database stored for this session. Nothing in `payload` can reach it.
  const totalCents = decimalToCents(String(prepared.expected_amount));
  if (totalCents === null || totalCents <= 0) return publicErrorForLedger(null);
  const expiresAt = Date.parse(String(prepared.expires_at));
  const minutesLeft = Math.floor((expiresAt - deps.now()) / 60_000);
  const timeoutMinutes = Math.max(5, Math.min(60, Number.isFinite(minutesLeft) ? minutesLeft : 15));
  const webhookUrl = await buildMobbexWebhookUrl(deps.supabaseUrl, config.webhookTokenSecret, config.environment, prepared.reference);

  try {
    const created = await deps.operations(config).createCheckout({
      totalCents,
      reference: prepared.reference,
      description: 'Pedido TABA2',
      returnUrl: deps.returnUrl,
      webhookUrl,
      timeoutMinutes,
      customer: { email: input.userEmail, name: String((payload.contact as Record<string, unknown> | undefined)?.name ?? 'Cliente') },
      items: (prepared.items ?? []).map((item) => ({
        description: item.name,
        quantity: item.quantity,
        totalCents: decimalToCents(String(item.subtotal)) ?? 0,
      })),
      test: config.environment === 'test',
    });
    await deps.ledger.recordCheckoutCreated(prepared.intent_id, created.checkoutId, created.url, created.responseHash);
    return { status: 200, body: { ok: true, redirect_url: created.url, checkout_session_id: sessionId, expires_at: prepared.expires_at ?? null, status: 'redirect_ready' } };
  } catch (error) {
    if (error instanceof MobbexApiError && error.kind === 'rejected') {
      await deps.ledger.recordCheckoutFailed(prepared.intent_id, String(error.status), '0'.repeat(64)).catch(() => undefined);
      return { status: 409, body: { ok: false, code: 'PAYMENT_SETUP_REJECTED', message: 'No pudimos preparar Mobbex. Conservamos tu carrito para que vuelvas a intentar.' } };
    }
    // Anything that may have reached Mobbex is uncertain, never "failed": nobody saw a URL, so nobody can pay it.
    await deps.ledger.recordCheckoutUncertain(prepared.intent_id, error instanceof MobbexApiError ? `${error.kind}:${error.status}` : 'unexpected').catch(() => undefined);
    return { status: 202, body: { ok: false, code: 'CHECKOUT_RECONCILING', status: 'reconciling', message: 'Estamos verificando la preparación de tu pago. No vuelvas a pagar todavía.' } };
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Reconcile one payment against the provider (used by the worker, the webhook fast path and the return page)
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ReconcileOutcome =
  | { outcome: 'done'; internalStatus?: string }
  | { outcome: 'again'; delaySeconds: number; internalStatus?: string }
  | { outcome: 'failed'; error: string };

const TERMINAL = new Set(['completed', 'refunded', 'expired', 'cancelled', 'failed', 'security_review_required']);

export async function reconcileMobbexPayment(
  deps: { ledger: LedgerPort; operations: MobbexOperationsPort },
  target: { intentId: string; reference: string },
  source: string,
): Promise<ReconcileOutcome> {
  let lookup: OperationLookup;
  try {
    lookup = await deps.operations.getOperationByReference(target.reference);
  } catch (error) {
    // Auth failures, 5xx, timeouts: nothing was learned. Never a payment, never a rejection: retry with backoff.
    return { outcome: 'failed', error: error instanceof MobbexApiError ? `${error.kind}:${error.status}` : 'unexpected' };
  }
  if (!lookup.found) {
    const miss = await deps.ledger.recordNoOperation(target.intentId, lookup.code);
    return miss.closed ? { outcome: 'done', internalStatus: 'expired' } : { outcome: 'again', delaySeconds: miss.retry_after_seconds };
  }
  const built = buildMobbexSnapshot(target.reference, lookup.body, lookup.responseHash);
  if (!built.ok) return { outcome: 'failed', error: built.reason };
  const result = await deps.ledger.recordSnapshot(target.intentId, built.snapshot as unknown as Record<string, unknown>, source);
  const status = typeof result.internal_status === 'string' ? result.internal_status : undefined;
  if (result.manual_review_required === true || (status && TERMINAL.has(status))) return { outcome: 'done', internalStatus: status };
  // Still open (pending, rejected card that may retry, approved but not yet an order): look again soon.
  const delaySeconds = status === 'approved_order_pending' ? 20 : status === 'rejected' ? 300 : 90;
  return { outcome: 'again', delaySeconds, internalStatus: status };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Webhook
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface WebhookDeps {
  ledger: LedgerPort;
  operations: MobbexOperationsPort;
  resolveConfig: () => MobbexConfig;
  sha256Hex: (text: string) => Promise<string>;
  /** Time budget for the optional inline confirmation. The durable job always exists whatever happens here. */
  inlineBudgetMs?: number;
}

export async function handleMobbexWebhook(
  deps: WebhookDeps,
  input: { url: URL; rawBody: string; https: boolean },
): Promise<HttpResult> {
  if (!input.https) return { status: 400, body: { ok: false, code: 'HTTPS_REQUIRED' } };
  if (new TextEncoder().encode(input.rawBody).byteLength > MOBBEX_WEBHOOK_MAX_BYTES) return { status: 413, body: { ok: false, code: 'PAYLOAD_TOO_LARGE' } };
  let config: MobbexConfig;
  try { config = deps.resolveConfig(); } catch (error) {
    // Switched off: there are no live checkouts to notify about. Answer 200 so the sender does not retry forever.
    if (error instanceof MobbexConfigError) return { status: 200, body: { ok: true, ignored: 'disabled' } };
    throw error;
  }
  const parsed = parseMobbexWebhook(input.url, input.rawBody);
  if (!parsed.ok) return { status: 401, body: { ok: false, code: 'INVALID_WEBHOOK' } };
  // TABA's own capability token (Mobbex documents no signature). Forged traffic stops here and writes nothing.
  const authentic = await verifyMobbexWebhookToken(config.webhookTokenSecret, config.environment, parsed.webhook.reference, parsed.webhook.presentedToken);
  if (!authentic) return { status: 401, body: { ok: false, code: 'INVALID_WEBHOOK' } };

  const receipt = await deps.ledger.recordWebhookReceipt({
    environment: config.environment,
    reference: parsed.webhook.reference,
    payloadHash: await deps.sha256Hex(input.rawBody),
    hintStatusCode: parsed.webhook.hintStatusCode,
    hintPaymentId: parsed.webhook.hintPaymentId,
  });
  if (receipt.unknown_reference || !receipt.intent_id) return { status: 200, body: { ok: true, ignored: 'unknown_reference' } };

  // Fast path: confirm now so the customer sees the order in seconds. Whatever happens, the durable job already exists.
  let confirmed: ReconcileOutcome | null = null;
  try {
    confirmed = await Promise.race([
      reconcileMobbexPayment({ ledger: deps.ledger, operations: deps.operations }, { intentId: receipt.intent_id, reference: parsed.webhook.reference }, 'webhook'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), deps.inlineBudgetMs ?? 8000)),
    ]);
  } catch (_) { confirmed = null; }
  return { status: 200, body: { ok: true, duplicate: receipt.duplicate === true, queued: true, confirmed: confirmed?.outcome === 'done' } };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Worker (scheduled): sweep, claim, reconcile, finish
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function runMobbexWorker(
  deps: { ledger: LedgerPort; operations: MobbexOperationsPort; now: () => number },
  options: { owner: string; budgetMs: number; batch?: number },
): Promise<Record<string, unknown>> {
  const started = deps.now();
  const sweep = await deps.ledger.sweep();
  const stats = { claimed: 0, done: 0, again: 0, failed: 0, lost_lease: 0, dead_letter: 0 };
  while (deps.now() - started < options.budgetMs) {
    const jobs = await deps.ledger.claimJobs(options.owner, options.batch ?? 10, 90);
    if (!jobs.length) break;
    for (const job of jobs) {
      stats.claimed += 1;
      let outcome: ReconcileOutcome;
      try {
        outcome = await reconcileMobbexPayment(deps, { intentId: job.payment_intent_id, reference: job.reference }, 'reconciliation');
      } catch (error) {
        outcome = { outcome: 'failed', error: error instanceof LedgerError ? 'ledger_error' : 'unexpected' };
      }
      const finished = await deps.ledger.finishJob(
        job.job_id, options.owner, outcome.outcome,
        outcome.outcome === 'again' ? outcome.delaySeconds : 0,
        outcome.outcome === 'failed' ? outcome.error : null,
      );
      if (finished === 'lost_lease') stats.lost_lease += 1;
      else if (finished === 'dead_letter') stats.dead_letter += 1;
      else stats[outcome.outcome] += 1;
      if (deps.now() - started >= options.budgetMs) break;
    }
  }
  return { ok: true, sweep, ...stats };
}
