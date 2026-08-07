import type { ArcaConfig, ArcaResult, FiscalParameterSnapshot, FiscalParameterType, FiscalRequest, LoginTicket } from './types.js';
import { assertRemoteExecutionAllowed } from './config.js';
import { assertValidCuit } from './cuit.js';
import { asArray, escapeXml, findFirst, parseTrustedSoap, xmlText } from './xml.js';
import { postSoap } from './transport.js';

const NS = 'http://ar.gov.afip.dif.FEV1/';

export const PARAMETER_OPERATIONS: Readonly<Record<FiscalParameterType, string>> = Object.freeze({
  document_types: 'FEParamGetTiposCbte',
  recipient_document_types: 'FEParamGetTiposDoc',
  vat_types: 'FEParamGetTiposIva',
  currencies: 'FEParamGetTiposMonedas',
  concepts: 'FEParamGetTiposConcepto',
  points_of_sale: 'FEParamGetPtosVenta',
  vat_receptor_conditions: 'FEParamGetCondicionIvaReceptor',
});

// FEParamGetCondicionIvaReceptor es la única tabla que además de Auth lleva un
// filtro por clase de comprobante. Sin filtro devuelve la tabla completa, que es
// justo lo que se quiere persistir para validar contra ella.
const PARAMETER_EXTRA_BODY: Readonly<Partial<Record<FiscalParameterType, string>>> = Object.freeze({
  vat_receptor_conditions: '<ar:ClaseCmp/>',
});

export class WsfeClient {
  readonly #config: ArcaConfig;
  readonly #fetchImpl: typeof fetch;
  constructor(config: ArcaConfig, fetchImpl: typeof fetch = fetch) { this.#config = config; this.#fetchImpl = fetchImpl; }

  async dummy(): Promise<{ appServer: string; dbServer: string; authServer: string }> {
    const response = await this.#call('FEDummy', '<ar:FEDummy/>');
    const parsed = checkedSoap(response.body);
    return {
      appServer: xmlText(findFirst(parsed, 'AppServer')),
      dbServer: xmlText(findFirst(parsed, 'DbServer')),
      authServer: xmlText(findFirst(parsed, 'AuthServer')),
    };
  }

  async lastAuthorized(ticket: LoginTicket, pointOfSale: number, documentType: number): Promise<number> {
    assertPositiveInteger(pointOfSale, 'punto de venta');
    assertPositiveInteger(documentType, 'tipo de comprobante');
    const body = `<ar:FECompUltimoAutorizado>${authXml(ticket, this.#config.cuit)}<ar:PtoVta>${pointOfSale}</ar:PtoVta><ar:CbteTipo>${documentType}</ar:CbteTipo></ar:FECompUltimoAutorizado>`;
    const response = await this.#call('FECompUltimoAutorizado', body);
    const parsed = checkedSoap(response.body);
    const value = Number(xmlText(findFirst(parsed, 'CbteNro')));
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('WSFEv1 devolvió último comprobante inválido.');
    return value;
  }

  async authorize(ticket: LoginTicket, request: FiscalRequest): Promise<ArcaResult> {
    validateFiscalRequest(request, this.#config.cuit);
    const response = await this.#call('FECAESolicitar', `<ar:FECAESolicitar>${authXml(ticket, request.cuit)}${caeRequestXml(request)}</ar:FECAESolicitar>`);
    return parseCaeResponse(response.body, response.requestHash, response.responseHash, request.documentNumber);
  }

  async consult(ticket: LoginTicket, request: Pick<FiscalRequest, 'cuit' | 'pointOfSale' | 'documentType' | 'documentNumber'>): Promise<ArcaResult | null> {
    validateCuit(request.cuit);
    const body = `<ar:FECompConsultar>${authXml(ticket, request.cuit)}<ar:FeCompConsReq><ar:CbteTipo>${request.documentType}</ar:CbteTipo><ar:CbteNro>${request.documentNumber}</ar:CbteNro><ar:PtoVta>${request.pointOfSale}</ar:PtoVta></ar:FeCompConsReq></ar:FECompConsultar>`;
    const response = await this.#call('FECompConsultar', body);
    const parsed = checkedSoap(response.body);
    const result = findFirst(parsed, 'ResultGet');
    if (!result || !xmlText(findFirst(result, 'CbteNro'))) return null;
    const cae = xmlText(findFirst(result, 'CodAutorizacion'));
    const totalAmount = numberOrUndefined(xmlText(findFirst(result, 'ImpTotal')));
    const pointOfSale = numberOrUndefined(xmlText(findFirst(result, 'PtoVta')));
    const documentType = numberOrUndefined(xmlText(findFirst(result, 'CbteTipo')));
    return {
      classification: /^\d{14}$/.test(cae) ? 'authorized' : 'service_error',
      documentNumber: Number(xmlText(findFirst(result, 'CbteNro'))),
      ...(totalAmount !== undefined ? { totalAmount } : {}),
      ...(pointOfSale !== undefined ? { pointOfSale } : {}),
      ...(documentType !== undefined ? { documentType } : {}),
      ...(cae ? { cae } : {}),
      ...(xmlText(findFirst(result, 'FchVto')) ? { caeExpiration: xmlText(findFirst(result, 'FchVto')) } : {}),
      ...(xmlText(findFirst(result, 'CbteFch')) ? { issueDate: xmlText(findFirst(result, 'CbteFch')) } : {}),
      observations: extractMessages(findFirst(result, 'Observaciones'), 'Obs'),
      errors: extractMessages(findFirst(parsed, 'Errors'), 'Err'),
      requestHash: response.requestHash,
      responseHash: response.responseHash,
    };
  }

  async getParameters(ticket: LoginTicket, parameterType: FiscalParameterType, now = new Date()): Promise<FiscalParameterSnapshot> {
    const operation = PARAMETER_OPERATIONS[parameterType];
    if (!operation) throw new Error('Tipo de parámetro WSFEv1 no permitido.');
    if (this.#config.environment === 'disabled') throw new Error('ARCA_DISABLED');
    const response = await this.#call(operation, `<ar:${operation}>${authXml(ticket, this.#config.cuit)}${PARAMETER_EXTRA_BODY[parameterType] || ''}</ar:${operation}>`);
    const parsed = checkedSoap(response.body);
    const operationResult = findFirst(parsed, `${operation}Result`);
    const values = findFirst(operationResult, 'ResultGet');
    const errors = extractMessages(findFirst(operationResult, 'Errors'), 'Err');
    if (errors.length || values === undefined) {
      const error = new Error(errors.map(({ code, message }) => `${code}: ${message}`).join('; ') || 'WSFEv1 no devolvió la tabla solicitada.');
      Object.assign(error, { code: errors[0]?.code || 'MISSING_PARAMETER_RESULT', retryable: false });
      throw error;
    }
    return {
      environment: this.#config.environment,
      parameterType,
      operation,
      version: response.responseHash,
      synchronizedAt: now.toISOString(),
      values,
      requestHash: response.requestHash,
      responseHash: response.responseHash,
    };
  }

  async #call(operation: string, body: string) {
    assertRemoteExecutionAllowed(this.#config);
    return postSoap({
      endpoint: this.#config.endpoints.wsfe,
      action: `${NS}${operation}`,
      body: `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}"><soapenv:Header/><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`,
      fetchImpl: this.#fetchImpl,
    });
  }
}

// "11, 12, 13, 15, 211, 212, 213 para los clase C" (manual WSFEv1). ARCA valida
// los importes de un comprobante C con reglas propias, no con las generales.
export const CLASS_C_DOCUMENT_TYPES: ReadonlySet<number> = Object.freeze(new Set([11, 12, 13, 15, 211, 212, 213]));

// Notas de débito y crédito A/B/M: BaseImp e Importe "puede ser cero o no ser
// informado" (10020/10021). Para el resto, BaseImp debe ser mayor a cero.
const OPTIONAL_VAT_BASE_DOCUMENT_TYPES: ReadonlySet<number> = Object.freeze(new Set([2, 3, 7, 8, 52, 53]));

// El manual admite margen en todas las sumas: "Error relativo porcentual deberá
// ser <= 0.01% o el error absoluto <= ...". Se replica tal cual, para no
// rechazar de este lado un comprobante que ARCA habría aceptado.
function withinArcaMargin(actual: number, expected: number, absoluteTolerance: number): boolean {
  const difference = Math.abs(actual - expected);
  if (difference <= absoluteTolerance + 1e-9) return true;
  return expected !== 0 && (difference / Math.abs(expected)) * 100 <= 0.01;
}

export function validateFiscalRequest(request: FiscalRequest, configuredCuit: string): void {
  validateCuit(request.cuit);
  if (request.cuit !== configuredCuit) throw new Error('El CUIT del documento no coincide con el perfil del worker.');
  assertPositiveInteger(request.pointOfSale, 'punto de venta');
  assertPositiveInteger(request.documentType, 'tipo de comprobante');
  assertPositiveInteger(request.documentNumber, 'número');
  assertPositiveInteger(request.recipientVatConditionId, 'condición IVA del receptor');
  if (![1, 2, 3].includes(request.concept)) throw new Error('Concepto fiscal no soportado.');
  if (!/^\d{8}$/.test(request.issueDate)) throw new Error('Fecha fiscal inválida.');
  if (!/^[A-Z]{3}$/.test(request.currencyCode) || !(request.currencyRate > 0)) throw new Error('Moneda o cotización inválida.');
  const amounts = [request.totalAmount, request.netAmount, request.vatAmount, request.exemptAmount, request.nonTaxedAmount, request.otherTaxesAmount];
  if (amounts.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Importe fiscal inválido.');
  if (request.vatItems.some((item) => !Number.isSafeInteger(item.id) || item.id < 1 || item.baseAmount < 0 || item.amount < 0)) throw new Error('Detalle IVA inválido.');
  validateAmountsAgainstDocumentClass(request);
  if ((request.concept === 2 || request.concept === 3) && (!request.serviceFrom || !request.serviceTo || !request.paymentDueDate)) throw new Error('Servicios requieren período y vencimiento.');
  if (request.documentIntent === 'credit_note' && !request.associatedDocument) throw new Error('La nota de crédito requiere comprobante asociado.');
  if (request.associatedDocument) {
    assertPositiveInteger(request.associatedDocument.documentType, 'tipo asociado');
    assertPositiveInteger(request.associatedDocument.pointOfSale, 'punto de venta asociado');
    assertPositiveInteger(request.associatedDocument.documentNumber, 'número asociado');
    if (request.associatedDocument.cuit && !/^\d{11}$/.test(request.associatedDocument.cuit)) throw new Error('CUIT asociado inválido.');
    if (request.associatedDocument.issueDate && !/^\d{8}$/.test(request.associatedDocument.issueDate)) throw new Error('Fecha asociada inválida.');
  }
}

/**
 * Las validaciones de importes que ARCA aplica sobre FECAESolicitar, con el
 * código de error del manual en cada mensaje. Corren ANTES de reservar número:
 * un comprobante que no cierra no puede consumir el siguiente número de ARCA ni
 * quedar esperando un rechazo que ya se sabe seguro.
 */
function validateAmountsAgainstDocumentClass(request: FiscalRequest): void {
  if (CLASS_C_DOCUMENT_TYPES.has(request.documentType)) {
    if (cents(request.nonTaxedAmount) !== 0) throw new Error('Comprobante clase C: ImpTotConc debe ser cero (ARCA 1434).');
    if (cents(request.exemptAmount) !== 0) throw new Error('Comprobante clase C: ImpOpEx debe ser cero (ARCA 1435).');
    if (cents(request.vatAmount) !== 0) throw new Error('Comprobante clase C: ImpIVA debe ser cero (ARCA 1438).');
    if (request.vatItems.length) throw new Error('Comprobante clase C: el array de IVA no debe informarse (ARCA 1443).');
    if (!withinArcaMargin(request.netAmount + request.otherTaxesAmount, request.totalAmount, 0.01)) {
      throw new Error('Comprobante clase C: el total debe ser ImpNeto + ImpTrib (ARCA 1439).');
    }
    return;
  }

  const components = request.netAmount + request.vatAmount + request.exemptAmount + request.nonTaxedAmount + request.otherTaxesAmount;
  if (!withinArcaMargin(components, request.totalAmount, 0.01)) {
    throw new Error('El total fiscal no coincide con sus componentes (ARCA 10048).');
  }

  const ids = request.vatItems.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('El detalle IVA repite una alícuota; debe totalizarse por alícuota (ARCA 10022).');
  }
  if (cents(request.vatAmount) > 0 && !request.vatItems.length) {
    throw new Error('Con ImpIVA mayor a cero el detalle IVA es obligatorio (ARCA 10018).');
  }
  // Con ImpIVA en cero el detalle sólo puede llevar la alícuota 0% (Id 3).
  if (cents(request.vatAmount) === 0 && request.vatItems.some((item) => item.id !== 3)) {
    throw new Error('Con ImpIVA en cero sólo puede informarse la alícuota 0% (ARCA 10018).');
  }
  if (!OPTIONAL_VAT_BASE_DOCUMENT_TYPES.has(request.documentType) && request.vatItems.some((item) => !(item.baseAmount > 0))) {
    throw new Error('BaseImp del detalle IVA debe ser mayor a cero (ARCA 10020).');
  }
  if (request.vatItems.length) {
    const declared = request.vatItems.reduce((sum, item) => sum + item.amount, 0);
    // Margen propio de 10023: 0.01 por cada alícuota informada.
    if (!withinArcaMargin(declared, request.vatAmount, 0.01 * request.vatItems.length)) {
      throw new Error('La suma del detalle IVA no coincide con ImpIVA (ARCA 10023).');
    }
  }
}

export function parseCaeResponse(xml: string, requestHash = '', responseHash = '', expectedNumber?: number): ArcaResult {
  const parsed = checkedSoap(xml);
  const detail = findFirst(parsed, 'FECAEDetResponse');
  const errors = extractMessages(findFirst(parsed, 'Errors'), 'Err');
  if (!detail) return { classification: 'service_error', observations: [], errors, requestHash, responseHash, errorCode: 'MISSING_DETAIL', errorMessage: 'WSFEv1 no devolvió detalle.' };
  const result = xmlText(findFirst(detail, 'Resultado'));
  const cae = xmlText(findFirst(detail, 'CAE'));
  const number = Number(xmlText(findFirst(detail, 'CbteDesde')) || expectedNumber);
  const observations = extractMessages(findFirst(detail, 'Observaciones'), 'Obs');
  if (result === 'A' && /^\d{14}$/.test(cae)) {
    return {
      classification: observations.length ? 'authorized_with_observations' : 'authorized',
      documentNumber: number,
      cae,
      caeExpiration: xmlText(findFirst(detail, 'CAEFchVto')),
      observations,
      errors,
      requestHash,
      responseHash,
    };
  }
  return {
    classification: result === 'R' ? 'rejected' : 'service_error',
    documentNumber: number,
    observations,
    errors,
    requestHash,
    responseHash,
    ...(!result ? { errorCode: 'MISSING_RESULT', errorMessage: 'WSFEv1 no informó Resultado.' } : {}),
  };
}

function caeRequestXml(request: FiscalRequest): string {
  const services = request.concept === 1 ? '' : `<ar:FchServDesde>${request.serviceFrom}</ar:FchServDesde><ar:FchServHasta>${request.serviceTo}</ar:FchServHasta><ar:FchVtoPago>${request.paymentDueDate}</ar:FchVtoPago>`;
  const vat = request.vatItems.length ? `<ar:Iva>${request.vatItems.map((item) => `<ar:AlicIva><ar:Id>${item.id}</ar:Id><ar:BaseImp>${money(item.baseAmount)}</ar:BaseImp><ar:Importe>${money(item.amount)}</ar:Importe></ar:AlicIva>`).join('')}</ar:Iva>` : '';
  const associated = request.associatedDocument ? `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${request.associatedDocument.documentType}</ar:Tipo><ar:PtoVta>${request.associatedDocument.pointOfSale}</ar:PtoVta><ar:Nro>${request.associatedDocument.documentNumber}</ar:Nro>${request.associatedDocument.cuit ? `<ar:Cuit>${escapeXml(request.associatedDocument.cuit)}</ar:Cuit>` : ''}${request.associatedDocument.issueDate ? `<ar:CbteFch>${escapeXml(request.associatedDocument.issueDate)}</ar:CbteFch>` : ''}</ar:CbteAsoc></ar:CbtesAsoc>` : '';
  // El orden de los elementos es el del WSDL vigente (xsd:sequence): ImpTrib va
  // ANTES de ImpIVA, y CondicionIVAReceptorId entre MonCotiz y CbtesAsoc. Un
  // .asmx lee la secuencia en orden y descarta lo que llega fuera de lugar: con
  // ImpIVA e ImpTrib invertidos, ARCA recibía ceros y rechazaba por importes.
  return `<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${request.pointOfSale}</ar:PtoVta><ar:CbteTipo>${request.documentType}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest><ar:Concepto>${request.concept}</ar:Concepto><ar:DocTipo>${request.recipientDocumentType}</ar:DocTipo><ar:DocNro>${escapeXml(request.recipientDocumentNumber)}</ar:DocNro><ar:CbteDesde>${request.documentNumber}</ar:CbteDesde><ar:CbteHasta>${request.documentNumber}</ar:CbteHasta><ar:CbteFch>${request.issueDate}</ar:CbteFch><ar:ImpTotal>${money(request.totalAmount)}</ar:ImpTotal><ar:ImpTotConc>${money(request.nonTaxedAmount)}</ar:ImpTotConc><ar:ImpNeto>${money(request.netAmount)}</ar:ImpNeto><ar:ImpOpEx>${money(request.exemptAmount)}</ar:ImpOpEx><ar:ImpTrib>${money(request.otherTaxesAmount)}</ar:ImpTrib><ar:ImpIVA>${money(request.vatAmount)}</ar:ImpIVA>${services}<ar:MonId>${escapeXml(request.currencyCode)}</ar:MonId><ar:MonCotiz>${request.currencyRate.toFixed(6)}</ar:MonCotiz><ar:CondicionIVAReceptorId>${request.recipientVatConditionId}</ar:CondicionIVAReceptorId>${associated}${vat}</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>`;
}

function checkedSoap(xml: string): unknown {
  const parsed = parseTrustedSoap(xml);
  const fault = findFirst(parsed, 'Fault');
  if (fault) {
    const message = xmlText(findFirst(fault, 'faultstring')) || 'ARCA devolvió SOAP Fault.';
    const error = new Error(message);
    Object.assign(error, { code: xmlText(findFirst(fault, 'faultcode')) || 'SOAP_FAULT', retryable: false });
    throw error;
  }
  return parsed;
}

function extractMessages(container: unknown, itemKey: string): Array<{ code: string; message: string }> {
  const items = asArray(findFirst(container, itemKey));
  return items.map((item) => ({ code: xmlText(findFirst(item, 'Code')), message: xmlText(findFirst(item, 'Msg')) })).filter((item) => item.code || item.message);
}

function authXml(ticket: LoginTicket, cuit: string): string { return `<ar:Auth><ar:Token>${escapeXml(ticket.token)}</ar:Token><ar:Sign>${escapeXml(ticket.sign)}</ar:Sign><ar:Cuit>${escapeXml(cuit)}</ar:Cuit></ar:Auth>`; }
function validateCuit(value: string): void { assertValidCuit(value); }
function assertPositiveInteger(value: number, label: string): void { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} inválido.`); }
function cents(value: number): number { return Math.round((value + Number.EPSILON) * 100); }
function money(value: number): string { return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2); }
function numberOrUndefined(value: string): number | undefined { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
