/**
 * Turns Mobbex's operation lookup (`GET /p/operations/REF:{reference}`) into the provider-neutral snapshot that the
 * ledger (`mobbex_record_provider_snapshot`) validates and applies.
 *
 * The documentation of the lookup contradicts itself (it shows `data.transaction.payment` but its code examples call
 * another endpoint), and the sandbox cannot be driven to an approved payment without a human (the hosted checkout sits
 * behind a Cloudflare challenge). So this parser is deliberately FAIL-CLOSED: if the answer does not have the expected
 * shape it says `shape_unrecognized` and the ledger records nothing; it never guesses a status, an amount or a payment id.
 * The first real approved operation read with scripts/mobbex/sandbox-pay-probe.mjs must be compared with the fixture in
 * tests/mobbex-core.test.mjs; until then the shape of an APPROVED answer is documented-only evidence.
 */

import { centsToDecimalString, decimalToCents, type OperationAttempt } from './client.ts';
import { classifyMobbexStatus, type MobbexStatusClass } from './status.ts';

export interface MobbexSnapshot {
  reference: string;
  status_code: string;
  status_class: MobbexStatusClass;
  provider_payment_id: string;
  /** Two-decimal string (`"2500.00"`), or null when the provider's number is not an exact amount. */
  amount: string | null;
  currency: string;
  provider_occurred_at: string | null;
  entity_uid: string | null;
  /** Operations of this reference the provider shows as paid: more than one means a double payment. */
  approved_operation_count: number;
  /** The provider marked the operation as a TEST operation (test cards), fail-closed. In production the ledger never counts it as money. */
  test: boolean;
  raw_response_hash: string;
}

export type SnapshotResult =
  | { ok: true; snapshot: MobbexSnapshot }
  | { ok: false; reason: 'shape_unrecognized' | 'reference_mismatch' | 'conflicting_operations' };

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 120): string {
  if (typeof value === 'string') return value.trim().slice(0, max);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, max);
  return '';
}

function isoOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  return null;
}

export function buildMobbexSnapshot(
  reference: string,
  body: Record<string, unknown>,
  responseHash: string,
  attempts?: OperationAttempt[] | null,
): SnapshotResult {
  const data = obj(body.data);
  const transaction = obj(data.transaction);
  const payment = Object.keys(obj(transaction.payment)).length ? obj(transaction.payment) : obj(data.payment);
  if (!Object.keys(payment).length) return { ok: false, reason: 'shape_unrecognized' };

  const statusNode = payment.status;
  const code = typeof statusNode === 'object' ? text(obj(statusNode).code, 16) : text(statusNode, 16);
  if (!code) return { ok: false, reason: 'shape_unrecognized' };

  const reportedReference = text(payment.reference, 160);
  if (reportedReference && reportedReference !== reference) return { ok: false, reason: 'reference_mismatch' };

  const status = classifyMobbexStatus(code);
  const cents = decimalToCents(payment.total);
  const currencyNode = payment.currency;
  const reportedCurrency = (typeof currencyNode === 'object' ? text(obj(currencyNode).code, 8) : text(currencyNode, 8)).toUpperCase();
  // Measured on the real sandbox (2026-11-04): a test-mode operation reports `currency.code: "TEST"` ("Test Money") and
  // carries NO boolean `test`. It denominates the ARS total TABA requested, so it is read as ARS AND marked as a test
  // operation: the sandbox can confirm it, production refuses it (test_operation_in_production).
  const testMoney = reportedCurrency === 'TEST';
  // Mobbex only accepts ARS (documentation, field `currency`); an answer that omits it is an ARS answer.
  const currency = testMoney ? 'ARS' : reportedCurrency || 'ARS';
  // The lookup answers only the NEWEST attempt and, in every real answer, an empty `data.transactions`; the listed attempts
  // (client `listAttempts`) are the evidence of earlier ones. Neither available -> headline only, as before.
  const embedded = Array.isArray(data.transactions) ? data.transactions : [];
  const transactions: unknown[] = embedded.length ? embedded : Array.isArray(attempts) ? attempts : [];
  const approvedFromList = transactions.filter((entry) => classifyMobbexStatus(obj(entry).status).statusClass === 'approved').length;
  const entity = obj(data.entity).uid ?? obj(transaction.entity).uid ?? obj(payment.entity).uid;

  // One reference can hold several attempts (a declined card, then an approved one). The headline `payment` is the only
  // operation this parser reads in detail, and the documentation does not say WHICH attempt it is. If the list shows a
  // paid operation while the headline says "not paid", reporting the headline would let the ledger release the stock of
  // a purchase that was paid. Refuse to decide: the job fails, retries, and ends in the operator alert, never in a guess.
  const headlineIsNotPaid = ['pending', 'authorized', 'rejected', 'expired', 'unknown'].includes(status.statusClass);
  if (approvedFromList > 0 && headlineIsNotPaid) return { ok: false, reason: 'conflicting_operations' };

  // The list was ATTEMPTED and failed (null; undefined = the caller never had one). The headline is only the newest attempt,
  // so an older paid attempt is invisible. The ledger releases the stock on a rejected (session over), expired or cancelled
  // headline: deciding it blind could release a paid purchase. Refuse and let the job retry until the list can be read.
  // Pending/authorized/unknown release nothing, and an approved headline is itself the evidence of payment.
  if (attempts === null && embedded.length === 0 && ['rejected', 'expired', 'cancelled'].includes(status.statusClass)) {
    return { ok: false, reason: 'conflicting_operations' };
  }

  return {
    ok: true,
    snapshot: {
      reference,
      status_code: status.code,
      status_class: status.statusClass,
      provider_payment_id: text(payment.id, 80),
      amount: cents === null ? null : centsToDecimalString(cents),
      currency,
      provider_occurred_at: isoOrNull(payment.updated) ?? isoOrNull(payment.created),
      entity_uid: text(entity, 80) || null,
      approved_operation_count: Math.max(approvedFromList, status.statusClass === 'approved' ? 1 : 0),
      // Fail closed: any test marker other than absent / false / "false" / 0 counts as a test operation; the ledger refuses
      // it as money in production (test_operation_in_production).
      test: testMoney || [payment.test, transaction.test, data.test].some((flag) => flag !== undefined && flag !== null && flag !== false && flag !== 'false' && flag !== 0 && flag !== '0'),
      raw_response_hash: responseHash,
    },
  };
}
