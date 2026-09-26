import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ArcaConfig, ArcaResult, FiscalParameterSnapshot, FiscalRequest, LoginTicket } from '../src/types.js';
import { caeRequestXml, parseCaeResponse, validateFiscalRequest, WsfeClient } from '../src/wsfe.js';
import { decideAfterAmbiguity, describeMismatch } from '../src/reconciliation.js';
import { FiscalWorker } from '../src/worker.js';
import { WsaaClient, parseLoginTicketResponse } from '../src/wsaa.js';
import type { FiscalJob, FiscalStore, LoadedFiscalDocument } from '../src/store.js';

// Dobles: prueban contratos, NO homologación. ARCA_HOMOLOGATION sigue pendiente de credenciales.

const config: ArcaConfig = {
  environment: 'homologation', cuit: '20123456789', certificatePath: 'synthetic-certificate-path', privateKeyPath: 'synthetic-private-key-path',
  workerId: 'worker-01', healthPort: 8787,
  endpoints: { wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms', wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx' },
  homologationConsent: true, productionEnabled: false,
};
const ticket: LoginTicket = { token: 'token', sign: 'sign', generationTime: '2026-09-26T10:00:00Z', expirationTime: '2099-09-26T22:00:00Z', service: 'wsfe' };
const request: FiscalRequest = {
  cuit: config.cuit, pointOfSale: 5, documentType: 11, concept: 1,
  recipientDocumentType: 99, recipientDocumentNumber: '0', recipientVatConditionId: 5, documentNumber: 42,
  issueDate: '20260926', totalAmount: 121, netAmount: 121, vatAmount: 0,
  exemptAmount: 0, nonTaxedAmount: 0, otherTaxesAmount: 0,
  currencyCode: 'PES', currencyRate: 1, vatItems: [],
};

const authorizedXml = (number = 42, cae = '12345678901234') => `<Envelope><Body><FECAESolicitarResponse><FECAESolicitarResult><FeDetResp><FECAEDetResponse><CbteDesde>${number}</CbteDesde><Resultado>A</Resultado><CAE>${cae}</CAE><CAEFchVto>20261006</CAEFchVto></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse></Body></Envelope>`;
const consultXml = (overrides: Record<string, string> = {}) => {
  const fields: Record<string, string> = {
    Concepto: '1', DocTipo: '99', DocNro: '0', CbteDesde: '42', CbteHasta: '42', CbteFch: '20260926', ImpTotal: '121',
    CondicionIVAReceptorId: '5', Resultado: 'A', CodAutorizacion: '12345678901234', FchVto: '20261006', PtoVta: '5', CbteTipo: '11', CbteNro: '42',
    ...overrides,
  };
  return `<Envelope><Body><FECompConsultarResponse><FECompConsultarResult><ResultGet>${Object.entries(fields).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</ResultGet></FECompConsultarResult></FECompConsultarResponse></Body></Envelope>`;
};

class MemoryStore implements FiscalStore {
  completed: Array<ArcaResult & Record<string, unknown>> = [];
  reserved: number[] = [];
  constructor(public loaded: LoadedFiscalDocument) {}
  async claim(): Promise<FiscalJob[]> { return [{ outboxId: 'outbox-1', fiscalDocumentId: 'document-1', attemptCount: 1 }]; }
  async load(): Promise<LoadedFiscalDocument> { return structuredClone(this.loaded); }
  async reserveNumber(_d: string, _w: string, expected: number): Promise<number> { this.reserved.push(expected); return expected; }
  async complete(_o: string, _w: string, result: ArcaResult & Record<string, unknown>): Promise<void> { this.completed.push(result); }
  async saveParameterSnapshot(_s: FiscalParameterSnapshot): Promise<void> {}
}

const quietLogger = { info() {}, warn() {} };

test('RG 5616: el pedido lleva CondicionIVAReceptorId en el orden del WSDL oficial', () => {
  const xml = caeRequestXml({ ...request, associatedDocument: { documentType: 11, pointOfSale: 5, documentNumber: 41 }, vatItems: [{ id: 5, baseAmount: 100, amount: 21 }], netAmount: 100, vatAmount: 21 });
  const order = ['Concepto', 'DocTipo', 'DocNro', 'CbteDesde', 'CbteHasta', 'CbteFch', 'ImpTotal', 'ImpTotConc', 'ImpNeto', 'ImpOpEx', 'ImpTrib', 'ImpIVA', 'MonId', 'MonCotiz', 'CondicionIVAReceptorId', 'CbtesAsoc', 'Iva']
    .map((name) => xml.indexOf(`<ar:${name}>`));
  assert.ok(order.every((index) => index >= 0), 'faltan elementos');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'fuera del orden de FEDetRequest');
  assert.match(xml, /<ar:CondicionIVAReceptorId>5<\/ar:CondicionIVAReceptorId>/);
});

test('RG 5616: sin condición IVA del receptor no se valida el pedido', () => {
  assert.throws(() => validateFiscalRequest({ ...request, recipientVatConditionId: 0 }, config.cuit), /condición frente al IVA/);
  assert.throws(() => validateFiscalRequest({ ...request, recipientVatConditionId: Number.NaN }, config.cuit), /condición frente al IVA/);
});

test('RG 5616: un comprobante sin condición IVA va a revisión SIN consumir número', async () => {
  const store = new MemoryStore({ request: { ...request, documentNumber: 0, recipientVatConditionId: 0 }, state: 'queued' });
  let lastCalls = 0;
  const worker = new FiscalWorker({ config, store, logger: quietLogger, wsaa: { login: async () => ticket },
    wsfe: { lastAuthorized: async () => { lastCalls++; return 41; }, authorize: async () => { throw new Error('no debe emitir'); }, consult: async () => null } });
  await worker.runOnce();
  assert.equal(store.reserved.length, 0);
  assert.equal(lastCalls, 0);
  assert.equal(store.completed[0]!.errorCode, 'REQUIRES_FISCAL_REVIEW');
});

test('éxito: último+1, CAE de 14 dígitos, un solo número reservado', async () => {
  const store = new MemoryStore({ request: { ...request, documentNumber: 0 }, state: 'queued' });
  const worker = new FiscalWorker({ config, store, logger: quietLogger, wsaa: { login: async () => ticket },
    wsfe: { lastAuthorized: async () => 41, authorize: async (_t, r) => parseCaeResponse(authorizedXml(r.documentNumber)), consult: async () => null } });
  await worker.runOnce();
  assert.deepEqual(store.reserved, [42]);
  assert.equal(store.completed[0]!.classification, 'authorized');
  assert.equal(store.completed[0]!.cae, '12345678901234');
});

test('rechazo 10246 (condición IVA inválida) queda rechazado con su código, sin CAE', () => {
  const xml = `<Envelope><Body><FECAESolicitarResult><FeDetResp><FECAEDetResponse><CbteDesde>42</CbteDesde><Resultado>R</Resultado><Observaciones><Obs><Code>10246</Code><Msg>Condicion IVA receptor invalida</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp></FECAESolicitarResult></Body></Envelope>`;
  const result = parseCaeResponse(xml, 'a', 'b', 42);
  assert.equal(result.classification, 'rejected');
  assert.equal(result.cae, undefined);
  assert.equal(result.observations[0]?.code, '10246');
});

test('punto de venta inválido: el error de ARCA no reserva número ni emite', async () => {
  const store = new MemoryStore({ request: { ...request, documentNumber: 0 }, state: 'queued' });
  const worker = new FiscalWorker({ config, store, logger: quietLogger, wsaa: { login: async () => ticket },
    wsfe: {
      lastAuthorized: async () => { throw Object.assign(new Error('602: Punto de venta no habilitado para web services'), { code: '602', retryable: false }); },
      authorize: async () => { throw new Error('no debe emitir'); }, consult: async () => null,
    } });
  await worker.runOnce();
  assert.equal(store.reserved.length, 0);
  assert.equal(store.completed[0]!.classification, 'service_error');
  assert.equal(store.completed[0]!.errorCode, '602');
});

test('timeout: justo después sólo se consulta; si ARCA no lo tiene, queda ambiguo (no reenvía)', async () => {
  const store = new MemoryStore({ request: { ...request, documentNumber: 0 }, state: 'queued' });
  let authorizeCalls = 0;
  const worker = new FiscalWorker({ config, store, logger: quietLogger, wsaa: { login: async () => ticket },
    wsfe: {
      lastAuthorized: async () => 41,
      authorize: async () => { authorizeCalls++; throw Object.assign(new Error('Timeout esperando respuesta de ARCA.'), { code: 'ARCA_TIMEOUT', ambiguous: true }); },
      consult: async () => null,
    } });
  await worker.runOnce();
  assert.equal(authorizeCalls, 1);
  assert.equal(store.completed[0]!.classification, 'ambiguous');
  assert.equal(store.completed[0]!.operation, 'FECompConsultar');
});

test('ya autorizado: después de un timeout la consulta recupera el CAE sin reenviar', async () => {
  const store = new MemoryStore({ request: { ...request }, state: 'ambiguous' });
  let authorizeCalls = 0;
  const client = new WsfeClient(config, (async () => new Response(consultXml(), { status: 200 })) as typeof fetch);
  const worker = new FiscalWorker({ config, store, logger: quietLogger, wsaa: { login: async () => ticket },
    wsfe: { lastAuthorized: async () => 42, authorize: async () => { authorizeCalls++; throw new Error('no'); }, consult: (t, r) => client.consult(t, r) } });
  await worker.runOnce();
  assert.equal(authorizeCalls, 0);
  assert.equal(store.reserved.length, 0);
  assert.equal(store.completed[0]!.classification, 'authorized');
  assert.equal(store.completed[0]!.cae, '12345678901234');
});

test('no llegó a ARCA y el número sigue libre: se reenvía el MISMO número, sin reservar otro', async () => {
  const store = new MemoryStore({ request: { ...request }, state: 'ambiguous' });
  const sent: number[] = [];
  const worker = new FiscalWorker({ config, store, logger: quietLogger, wsaa: { login: async () => ticket },
    wsfe: { lastAuthorized: async () => 41, authorize: async (_t, r) => { sent.push(r.documentNumber); return parseCaeResponse(authorizedXml(r.documentNumber)); }, consult: async () => null } });
  await worker.runOnce();
  assert.deepEqual(sent, [42]);
  assert.equal(store.reserved.length, 0);
  assert.equal(store.completed[0]!.classification, 'authorized');
});

test('el número ya se usó y ARCA no tiene este comprobante: revisión humana, nunca reemisión', async () => {
  const decision = await decideAfterAmbiguity({ client: { consult: async () => null, lastAuthorized: async () => 42 }, ticket, request, allowResend: true });
  assert.equal(decision.kind, 'needs_reconciliation');
  assert.equal(decision.kind === 'needs_reconciliation' && decision.result.errorCode, 'ARCA_RECONCILIATION_MISMATCH');
  assert.equal(decision.kind === 'needs_reconciliation' && decision.result.errors[0]?.code, 'ARCA_NUMBER_ALREADY_USED');
});

test('duplicado: lo que ARCA tiene con ese número no coincide (otro total o receptor) → revisión', async () => {
  const client = new WsfeClient(config, (async () => new Response(consultXml({ ImpTotal: '999', CondicionIVAReceptorId: '1' }), { status: 200 })) as typeof fetch);
  const consulted = await client.consult(ticket, request);
  assert.match(describeMismatch(request, consulted!) || '', /total/);
  assert.match(describeMismatch(request, consulted!) || '', /condición IVA/);
  const decision = await decideAfterAmbiguity({ client: { consult: async () => consulted, lastAuthorized: async () => 42 }, ticket, request, allowResend: true });
  assert.equal(decision.kind, 'needs_reconciliation');
});

test('si ni siquiera se puede consultar, sigue ambiguo y no se reenvía', async () => {
  let lastCalls = 0;
  const decision = await decideAfterAmbiguity({
    client: { consult: async () => { throw Object.assign(new Error('timeout'), { code: 'ARCA_TIMEOUT', ambiguous: true }); }, lastAuthorized: async () => { lastCalls++; return 0; } },
    ticket, request, allowResend: true,
  });
  assert.equal(decision.kind, 'still_ambiguous');
  assert.equal(lastCalls, 0);
});

test('un comprobante consultado con resultado distinto de A no se toma como autorizado', async () => {
  const client = new WsfeClient(config, (async () => new Response(consultXml({ Resultado: 'R' }), { status: 200 })) as typeof fetch);
  const consulted = await client.consult(ticket, request);
  assert.equal(consulted!.classification, 'service_error');
});

test('WSAA: el TA se persiste y un reinicio lo reutiliza en vez de pedir otro', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arca-ta-'));
  const file = path.join(directory, 'ta.json');
  const loginResponse = `<soapenv:Envelope><soapenv:Body><loginCmsResponse><loginCmsReturn>${escapeXml(`<loginTicketResponse><header><generationTime>2026-09-26T10:00:00Z</generationTime><expirationTime>2099-09-26T22:00:00Z</expirationTime></header><credentials><token>TOKEN-SINTETICO</token><sign>SIGN-SINTETICO</sign></credentials></loginTicketResponse>`)}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`;
  const parsed = parseLoginTicketResponse(loginResponse);
  assert.equal(parsed.token, 'TOKEN-SINTETICO');
  try {
    fs.writeFileSync(file, JSON.stringify({ [`homologation:${config.cuit}:wsfe`]: parsed }), { mode: 0o600 });
    let calls = 0;
    const client = new WsaaClient({ ...config, ticketCachePath: file }, { certificatePem: '', privateKeyPem: '' },
      (async () => { calls++; return new Response('', { status: 500 }); }) as typeof fetch);
    const ticketAfterRestart = await client.login('wsfe', new Date('2026-09-26T12:00:00Z'));
    assert.equal(ticketAfterRestart.token, 'TOKEN-SINTETICO');
    assert.equal(calls, 0, 'no pidió un TA nuevo');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('WSAA: coe.alreadyAuthenticated se reintenta más tarde (no es un error fatal ni ambiguo)', async () => {
  const fault = '<soapenv:Envelope><soapenv:Body><soapenv:Fault><faultcode>ns1:coe.alreadyAuthenticated</faultcode><faultstring>El CEE ya posee un TA valido para el acceso al WSN solicitado</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>';
  assert.throws(() => parseLoginTicketResponse(fault), (error: Error & { code?: string; retryable?: boolean }) => error.code === 'WSAA_ALREADY_AUTHENTICATED' && error.retryable === true);
});

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
