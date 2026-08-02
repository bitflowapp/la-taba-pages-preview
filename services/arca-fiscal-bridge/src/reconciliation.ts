import type { ArcaResult, FiscalRequest, LoginTicket } from './types.js';
import type { WsfeClient } from './wsfe.js';

export async function reconcileAmbiguousAuthorization({
  client,
  ticket,
  request,
}: {
  client: Pick<WsfeClient, 'consult'>;
  ticket: LoginTicket;
  request: FiscalRequest;
}): Promise<ArcaResult> {
  const result = await client.consult(ticket, request);
  if (!result) {
    return {
      classification: 'ambiguous',
      documentNumber: request.documentNumber,
      observations: [],
      errors: [{ code: 'NOT_FOUND_AFTER_AMBIGUOUS', message: 'ARCA aún no devuelve el comprobante consultado.' }],
    };
  }
  if (result.documentNumber !== request.documentNumber || (result.issueDate && result.issueDate !== request.issueDate)) {
    return {
      classification: 'service_error',
      documentNumber: request.documentNumber,
      observations: result.observations,
      errors: [{ code: 'ARCA_RECONCILIATION_MISMATCH', message: 'La consulta no coincide con la intención fiscal local.' }],
      ...(result.requestHash ? { requestHash: result.requestHash } : {}),
      ...(result.responseHash ? { responseHash: result.responseHash } : {}),
    };
  }
  return result;
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
