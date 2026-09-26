import type { ArcaResult, FiscalRequest, LoginTicket } from './types.js';
import type { WsfeClient } from './wsfe.js';

/**
 * Qué hacer con un comprobante cuyo pedido de CAE pudo haber llegado a ARCA
 * (timeout, conexión cortada, respuesta perdida). Es la «Operatoria con errores
 * de comunicación» del manual WSFEv1: reenviar a ciegas un comprobante que ARCA
 * ya autorizó da error de correlatividad y deja la venta mal registrada.
 *
 *   recovered            ARCA ya autorizó ESTE comprobante (mismo tipo, punto de
 *                        venta, número, fecha, total, receptor): se toma su CAE.
 *   resend               ARCA no lo tiene y el número sigue libre (último
 *                        autorizado < reservado): se reenvía el MISMO pedido.
 *   needs_reconciliation lo que hay en ARCA no coincide, o el número ya se usó,
 *                        o el comprobante no tiene CAE válido: revisión humana.
 *                        Nunca se reemite.
 *   still_ambiguous      no se pudo consultar: se vuelve a intentar más tarde.
 */
export type ReconciliationDecision =
  | { kind: 'recovered'; result: ArcaResult }
  | { kind: 'resend' }
  | { kind: 'needs_reconciliation'; result: ArcaResult }
  | { kind: 'still_ambiguous'; result: ArcaResult };

export const RECONCILIATION_MISMATCH = 'ARCA_RECONCILIATION_MISMATCH';

export async function decideAfterAmbiguity({
  client,
  ticket,
  request,
  allowResend,
}: {
  client: Pick<WsfeClient, 'consult' | 'lastAuthorized'>;
  ticket: LoginTicket;
  request: FiscalRequest;
  /**
   * Justo después del timeout ARCA puede seguir procesando el pedido: ahí sólo
   * se consulta. El reenvío se permite en un intento posterior (la outbox espera
   * 60 s), cuando un «no está» ya significa «no llegó».
   */
  allowResend: boolean;
}): Promise<ReconciliationDecision> {
  let consulted: ArcaResult | null;
  try {
    consulted = await client.consult(ticket, request);
  } catch (error) {
    return { kind: 'still_ambiguous', result: ambiguous(request, 'CONSULT_FAILED', error) };
  }

  if (consulted) {
    const mismatch = describeMismatch(request, consulted);
    if (mismatch) {
      return { kind: 'needs_reconciliation', result: needsReview(request, consulted, 'ARCA_VOUCHER_MISMATCH', `La consulta no coincide con la intención fiscal local (${mismatch}).`) };
    }
    if (consulted.classification === 'authorized' && /^\d{14}$/.test(consulted.cae || '')) {
      return { kind: 'recovered', result: { ...consulted, documentNumber: request.documentNumber } };
    }
    return { kind: 'needs_reconciliation', result: needsReview(request, consulted, 'ARCA_VOUCHER_WITHOUT_VALID_CAE', 'ARCA tiene el comprobante pero sin CAE válido.') };
  }

  if (!allowResend) {
    return { kind: 'still_ambiguous', result: ambiguous(request, 'NOT_FOUND_AFTER_AMBIGUOUS') };
  }

  let last: number;
  try {
    last = await client.lastAuthorized(ticket, request.pointOfSale, request.documentType);
  } catch (error) {
    return { kind: 'still_ambiguous', result: ambiguous(request, 'LAST_AUTHORIZED_FAILED', error) };
  }

  if (last < request.documentNumber) {
    return { kind: 'resend' };
  }

  // No está en ARCA con este número y el último autorizado ya lo alcanzó:
  // alguien (otro sistema, otro proceso) usó la numeración. No se reemite.
  return {
    kind: 'needs_reconciliation',
    result: needsReview(request, null, 'ARCA_NUMBER_ALREADY_USED', `El número ${request.documentNumber} no está en ARCA y el último autorizado es ${last}.`),
  };
}

/** Compatibilidad: sólo consulta (sin reenvío). Lo usa quien no tiene FECompUltimoAutorizado a mano. */
export async function reconcileAmbiguousAuthorization({
  client,
  ticket,
  request,
}: {
  client: Pick<WsfeClient, 'consult'>;
  ticket: LoginTicket;
  request: FiscalRequest;
}): Promise<ArcaResult> {
  const decision = await decideAfterAmbiguity({
    client: { consult: client.consult.bind(client), lastAuthorized: async () => { throw new Error('unused'); } },
    ticket,
    request,
    allowResend: false,
  });
  return decision.kind === 'resend' ? ambiguous(request, 'NOT_FOUND_AFTER_AMBIGUOUS') : decision.result;
}

export function describeMismatch(request: FiscalRequest, consulted: ArcaResult): string | null {
  const differences: string[] = [];
  if (consulted.documentNumber !== request.documentNumber) differences.push('número');
  if (consulted.issueDate && consulted.issueDate !== request.issueDate) differences.push('fecha');
  if (consulted.pointOfSale !== undefined && consulted.pointOfSale !== request.pointOfSale) differences.push('punto de venta');
  if (consulted.documentType !== undefined && consulted.documentType !== request.documentType) differences.push('tipo');
  if (consulted.totalAmount !== undefined && cents(consulted.totalAmount) !== cents(request.totalAmount)) differences.push('total');
  if (consulted.recipientDocumentType !== undefined && consulted.recipientDocumentType !== request.recipientDocumentType) differences.push('tipo de documento del receptor');
  if (consulted.recipientDocumentNumber !== undefined
    && Number(consulted.recipientDocumentNumber) !== Number(request.recipientDocumentNumber)) differences.push('documento del receptor');
  if (consulted.recipientVatConditionId !== undefined && consulted.recipientVatConditionId !== request.recipientVatConditionId) differences.push('condición IVA del receptor');
  return differences.length ? differences.join(', ') : null;
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

function ambiguous(request: FiscalRequest, code: string, error?: unknown): ArcaResult {
  const detail = (error as { code?: string; message?: string } | undefined);
  return {
    classification: 'ambiguous',
    documentNumber: request.documentNumber,
    observations: [],
    errors: [{ code: detail?.code ? `${code}:${String(detail.code).slice(0, 40)}` : code, message: 'ARCA todavía no confirma el comprobante; se consultará antes de reenviar.' }],
  };
}

function needsReview(request: FiscalRequest, consulted: ArcaResult | null, reason: string, message: string): ArcaResult {
  return {
    classification: 'service_error',
    documentNumber: request.documentNumber,
    observations: consulted?.observations ?? [],
    errors: [{ code: reason, message }],
    // El contrato de complete_fiscal_attempt manda este código a revisión (dead letter), sin reintentos.
    errorCode: RECONCILIATION_MISMATCH,
    errorMessage: message.slice(0, 300),
    ...(consulted?.requestHash ? { requestHash: consulted.requestHash } : {}),
    ...(consulted?.responseHash ? { responseHash: consulted.responseHash } : {}),
  };
}

export function classifyTransportFailure(error: unknown, documentNumber?: number): ArcaResult {
  const value = error as { code?: string; message?: string; ambiguous?: boolean; requestHash?: string };
  return {
    classification: value.ambiguous ? 'ambiguous' : 'service_error',
    ...(documentNumber ? { documentNumber } : {}),
    observations: [],
    errors: [{ code: String(value.code || 'ARCA_TRANSPORT_ERROR'), message: String(value.message || 'Falla de transporte ARCA.').slice(0, 300) }],
    ...(value.requestHash ? { requestHash: value.requestHash } : {}),
    errorCode: String(value.code || 'ARCA_TRANSPORT_ERROR'),
    errorMessage: String(value.message || '').slice(0, 300),
  };
}
