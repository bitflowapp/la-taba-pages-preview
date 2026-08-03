import type { ArcaConfig, ArcaResult, FiscalParameterSnapshot, FiscalParameterType, FiscalRequest, LoginTicket } from './types.js';
import { assertRemoteExecutionAllowed } from './config.js';
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
    const response = await this.#call(operation, `<ar:${operation}>${authXml(ticket, this.#config.cuit)}</ar:${operation}>`);
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

export function validateFiscalRequest(request: FiscalRequest, configuredCuit: string): void {
  validateCuit(request.cuit);
  if (request.cuit !== configuredCuit) throw new Error('El CUIT del documento no coincide con el perfil del worker.');
  assertPositiveInteger(request.pointOfSale, 'punto de venta');
  assertPositiveInteger(request.documentType, 'tipo de comprobante');
  assertPositiveInteger(request.documentNumber, 'número');
  if (![1, 2, 3].includes(request.concept)) throw new Error('Concepto fiscal no soportado.');
  if (!/^\d{8}$/.test(request.issueDate)) throw new Error('Fecha fiscal inválida.');
  if (!/^[A-Z]{3}$/.test(request.currencyCode) || !(request.currencyRate > 0)) throw new Error('Moneda o cotización inválida.');
  const amounts = [request.totalAmount, request.netAmount, request.vatAmount, request.exemptAmount, request.nonTaxedAmount, request.otherTaxesAmount];
  if (amounts.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Importe fiscal inválido.');
  const components = request.netAmount + request.vatAmount + request.exemptAmount + request.nonTaxedAmount + request.otherTaxesAmount;
  if (Math.abs(cents(components) - cents(request.totalAmount)) > 1) throw new Error('El total fiscal no coincide con sus componentes.');
  if (request.vatItems.some((item) => !Number.isSafeInteger(item.id) || item.baseAmount < 0 || item.amount < 0)) throw new Error('Detalle IVA inválido.');
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
  return `<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${request.pointOfSale}</ar:PtoVta><ar:CbteTipo>${request.documentType}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest><ar:Concepto>${request.concept}</ar:Concepto><ar:DocTipo>${request.recipientDocumentType}</ar:DocTipo><ar:DocNro>${escapeXml(request.recipientDocumentNumber)}</ar:DocNro><ar:CbteDesde>${request.documentNumber}</ar:CbteDesde><ar:CbteHasta>${request.documentNumber}</ar:CbteHasta><ar:CbteFch>${request.issueDate}</ar:CbteFch><ar:ImpTotal>${money(request.totalAmount)}</ar:ImpTotal><ar:ImpTotConc>${money(request.nonTaxedAmount)}</ar:ImpTotConc><ar:ImpNeto>${money(request.netAmount)}</ar:ImpNeto><ar:ImpOpEx>${money(request.exemptAmount)}</ar:ImpOpEx><ar:ImpIVA>${money(request.vatAmount)}</ar:ImpIVA><ar:ImpTrib>${money(request.otherTaxesAmount)}</ar:ImpTrib>${services}<ar:MonId>${escapeXml(request.currencyCode)}</ar:MonId><ar:MonCotiz>${request.currencyRate.toFixed(6)}</ar:MonCotiz>${associated}${vat}</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>`;
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
function validateCuit(value: string): void { if (!/^\d{11}$/.test(value)) throw new Error('CUIT inválido.'); }
function assertPositiveInteger(value: number, label: string): void { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} inválido.`); }
function cents(value: number): number { return Math.round((value + Number.EPSILON) * 100); }
function money(value: number): string { return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2); }
function numberOrUndefined(value: string): number | undefined { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
