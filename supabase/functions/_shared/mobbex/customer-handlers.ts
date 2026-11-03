/**
 * The three authenticated, user-facing Mobbex operations, as pure functions over ports (see handlers.ts):
 * availability (what the storefront may offer), checkout status (what the return page may READ) and refund.
 *
 * None of them can mark a payment as paid. The return page only reads; the refund only asks Mobbex to give money back.
 */

import { MobbexApiError } from './client.ts';
import { MobbexConfigError, type MobbexConfig } from './config.ts';
import {
  reconcileMobbexPayment,
  type HttpResult,
  type LedgerPort,
  type MobbexOperationsPort,
} from './handlers.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MOBBEX_REFUND_CONFIRMATION = 'I_UNDERSTAND_THIS_REQUESTS_A_MOBBEX_REFUND';

// ── availability ─────────────────────────────────────────────────────────────────────────────────────────────

export interface AvailabilityDeps {
  resolveConfig: () => MobbexConfig;
  /** Executed with the CALLER's session: production availability depends on who is asking. */
  databaseAvailability: (businessId: string) => Promise<{ available: boolean; environment?: string }>;
}

/** Mobbex is offered only when the deployment switch, the credentials, the business flag and the gate all agree. */
export async function mobbexAvailability(deps: AvailabilityDeps, businessId: string): Promise<HttpResult> {
  const no = { status: 200, body: { ok: true, available: false } };
  if (!UUID.test(businessId)) return no;
  let config: MobbexConfig;
  try { config = deps.resolveConfig(); } catch (error) {
    if (error instanceof MobbexConfigError) return no;
    throw error;
  }
  const database = await deps.databaseAvailability(businessId).catch(() => ({ available: false }));
  const available = database.available === true && (database as { environment?: string }).environment === config.environment;
  return { status: 200, body: { ok: true, available } };
}

// ── checkout status (the browser return) ─────────────────────────────────────────────────────────────────────

export interface StatusDeps {
  ledger: LedgerPort;
  operations: MobbexOperationsPort;
  resolveConfig: () => MobbexConfig;
  /** User-scoped: only the owner of the checkout gets a row. */
  requestReconcile: (sessionId: string) => Promise<{ queued?: boolean; intent_id?: string; reference?: string }>;
  readStatus: (sessionId: string) => Promise<Record<string, unknown> | null>;
  inlineBudgetMs?: number;
}

export async function mobbexCheckoutStatus(deps: StatusDeps, sessionId: string): Promise<HttpResult> {
  if (!UUID.test(sessionId)) return { status: 400, body: { ok: false, code: 'INVALID_REQUEST' } };
  try {
    const queued = await deps.requestReconcile(sessionId);
    if (queued.queued && queued.intent_id && queued.reference) {
      try {
        deps.resolveConfig();
        await Promise.race([
          reconcileMobbexPayment({ ledger: deps.ledger, operations: deps.operations }, { intentId: queued.intent_id, reference: queued.reference }, 'browser_return'),
          new Promise((resolve) => setTimeout(resolve, deps.inlineBudgetMs ?? 6000)),
        ]);
      } catch (error) {
        // Disabled or provider down: the job is queued, the worker will confirm. The page just keeps waiting.
        if (!(error instanceof MobbexConfigError) && !(error instanceof MobbexApiError)) throw error;
      }
    }
  } catch (_) { /* not the owner / unknown session: handled by readStatus returning null */ }
  const checkout = await deps.readStatus(sessionId);
  if (!checkout) return { status: 404, body: { ok: false, code: 'CHECKOUT_NOT_FOUND', message: 'No encontramos este pago.' } };
  return { status: 200, body: { ok: true, checkout } };
}

// ── refund ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface RefundDeps {
  resolveConfig: () => MobbexConfig;
  /** User-scoped RPC `mobbex_prepare_refund`: only an owner/admin of the business passes. */
  prepareRefund: (input: { intentId: string; amount: number | null; idempotencyKey: string; reason: string }) => Promise<Record<string, unknown>>;
  markRefundSent: (refundId: string) => Promise<void>;
  recordRefundResult: (refundId: string, outcome: 'approved' | 'rejected' | 'ambiguous', responseHash: string) => Promise<void>;
  refundOperation: (operationId: string, amountCents: number | null) => Promise<{ approved: boolean; responseHash: string }>;
}

export async function refundMobbexPayment(
  deps: RefundDeps,
  body: Record<string, unknown>,
): Promise<HttpResult> {
  if (body.confirmation !== MOBBEX_REFUND_CONFIRMATION) {
    return { status: 409, body: { ok: false, code: 'EXPLICIT_REFUND_CONFIRMATION_REQUIRED', message: 'Confirmá explícitamente el reembolso antes de enviarlo a Mobbex.' } };
  }
  const intentId = String(body.payment_intent_id ?? '');
  const idempotencyKey = String(body.idempotency_key ?? '');
  if (!UUID.test(intentId) || !UUID.test(idempotencyKey)) return { status: 400, body: { ok: false, code: 'INVALID_REQUEST' } };
  let amount: number | null = null;
  if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
    const text = typeof body.amount === 'number' ? String(body.amount) : String(body.amount).trim();
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(text) || Number(text) <= 0) return { status: 400, body: { ok: false, code: 'INVALID_AMOUNT', message: 'Importe inválido.' } };
    amount = Number(text);
  }
  try { deps.resolveConfig(); } catch (error) {
    if (error instanceof MobbexConfigError) return { status: 409, body: { ok: false, code: 'PAYMENTS_NOT_ENABLED', message: 'Mobbex no está habilitado en este entorno.' } };
    throw error;
  }
  let prepared: Record<string, unknown>;
  try {
    prepared = await deps.prepareRefund({ intentId, amount, idempotencyKey, reason: String(body.reason ?? '').trim().slice(0, 300) });
  } catch (_) {
    return { status: 409, body: { ok: false, code: 'REFUND_NOT_AVAILABLE', message: 'No podemos reembolsar este pago en su estado actual.' } };
  }
  if (prepared.reconciliation_required === true || prepared.idempotent === true) {
    // A request that already left TABA is NEVER sent twice: the next reconciliation reads Mobbex's own state.
    return { status: 202, body: { ok: false, code: 'REFUND_RECONCILING', status: 'reconciling', message: 'Estamos verificando el reembolso con Mobbex. No lo repitas.' } };
  }
  const refundId = String(prepared.refund_id ?? '');
  const operationId = String(prepared.provider_payment_id ?? '');
  const cents = prepared.full === true || prepared.amount === null || prepared.amount === undefined
    ? null
    : Math.round(Number(prepared.amount) * 100);
  // Marked as sent BEFORE the request: a crash after sending leaves `processing`, which is reconciled and never resent.
  await deps.markRefundSent(refundId);
  try {
    const result = await deps.refundOperation(operationId, cents);
    await deps.recordRefundResult(refundId, result.approved ? 'approved' : 'rejected', result.responseHash);
    return result.approved
      ? { status: 200, body: { ok: true, status: 'approved' } }
      : { status: 409, body: { ok: false, code: 'REFUND_REJECTED', message: 'Mobbex rechazó el reembolso (por ejemplo, un parcial el mismo día del pago).' } };
  } catch (error) {
    if (error instanceof MobbexApiError && error.kind === 'rejected') {
      await deps.recordRefundResult(refundId, 'rejected', '0'.repeat(64));
      return { status: 409, body: { ok: false, code: 'REFUND_REJECTED', message: 'Mobbex rechazó el reembolso.' } };
    }
    await deps.recordRefundResult(refundId, 'ambiguous', '0'.repeat(64));
    return { status: 202, body: { ok: false, code: 'REFUND_RECONCILING', status: 'reconciling', message: 'Estamos verificando el reembolso con Mobbex. No lo repitas.' } };
  }
}
