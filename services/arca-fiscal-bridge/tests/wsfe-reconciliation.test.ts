import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArcaConfig, FiscalRequest, LoginTicket } from '../src/types.js';
import { parseCaeResponse, validateFiscalRequest, WsfeClient } from '../src/wsfe.js';
import { reconcileAmbiguousAuthorization } from '../src/reconciliation.js';
import { syncOfficialParameterTables } from '../src/parameters.js';

const config: ArcaConfig = {
  environment: 'homologation', cuit: '20123456789', certificatePath: 'synthetic-certificate-path', privateKeyPath: 'synthetic-private-key-path', workerId: 'worker-01', healthPort: 8787,
  endpoints: { wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms', wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx' },
  homologationConsent: true, productionEnabled: false,
};
const ticket: LoginTicket = { token: 'token', sign: 'sign', generationTime: '2026-08-02T10:00:00Z', expirationTime: '2026-08-02T22:00:00Z', service: 'wsfe' };
const request: FiscalRequest = {
  cuit: config.cuit, pointOfSale: 5, documentType: 11, concept: 1,
  recipientDocumentType: 99, recipientDocumentNumber: '0', documentNumber: 42,
  issueDate: '20260802', totalAmount: 121, netAmount: 100, vatAmount: 21,
  exemptAmount: 0, nonTaxedAmount: 0, otherTaxesAmount: 0,
  currencyCode: 'PES', currencyRate: 1, vatItems: [{ id: 5, baseAmount: 100, amount: 21 }],
};

test('validación fiscal detecta CUIT, totales y casos incompletos', () => {
  assert.doesNotThrow(() => validateFiscalRequest(request, config.cuit));
  assert.throws(() => validateFiscalRequest({ ...request, totalAmount: 1 }, config.cuit), /no coincide/);
  assert.throws(() => validateFiscalRequest({ ...request, cuit: '20999999999' }, config.cuit), /no coincide/);
});

test('respuesta A necesita CAE y conserva observaciones', () => {
  const xml = `<Envelope><Body><FECAESolicitarResponse><FECAESolicitarResult><FeDetResp><FECAEDetResponse><CbteDesde>42</CbteDesde><Resultado>A</Resultado><CAE>12345678901234</CAE><CAEFchVto>20260812</CAEFchVto><Observaciones><Obs><Code>10017</Code><Msg>Aprobado con observación</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse></Body></Envelope>`;
  const result = parseCaeResponse(xml, 'a', 'b', 42);
  assert.equal(result.classification, 'authorized_with_observations');
  assert.equal(result.cae, '12345678901234');
  assert.equal(result.observations[0]?.code, '10017');
});

test('respuesta rechazada nunca inventa CAE', () => {
  const xml = `<Envelope><Body><FECAESolicitarResult><FeDetResp><FECAEDetResponse><CbteDesde>42</CbteDesde><Resultado>R</Resultado><Observaciones><Obs><Code>100</Code><Msg>Rechazado</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp></FECAESolicitarResult></Body></Envelope>`;
  const result = parseCaeResponse(xml);
  assert.equal(result.classification, 'rejected');
  assert.equal(result.cae, undefined);
});

test('cliente usa FEDummy y último autorizado en endpoint homologado', async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body || '') });
    const body = calls.length === 1
      ? '<Envelope><Body><FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult></Body></Envelope>'
      : '<Envelope><Body><FECompUltimoAutorizadoResult><CbteNro>41</CbteNro></FECompUltimoAutorizadoResult></Body></Envelope>';
    return new Response(body, { status: 200 });
  };
  const client = new WsfeClient(config, fetchImpl as typeof fetch);
  assert.equal((await client.dummy()).appServer, 'OK');
  assert.equal(await client.lastAuthorized(ticket, 5, 11), 41);
  assert.ok(calls.every((call) => call.url === config.endpoints.wsfe));
  assert.match(calls[1]!.body, /<ar:Token>token<\/ar:Token>/);
});

test('timeout ambiguo consulta antes de cualquier reenvío', async () => {
  let consulted = 0;
  const result = await reconcileAmbiguousAuthorization({
    client: { consult: async () => { consulted += 1; return { classification: 'authorized', documentNumber: 42, cae: '12345678901234', issueDate: '20260802', observations: [], errors: [] }; } },
    ticket,
    request,
  });
  assert.equal(consulted, 1);
  assert.equal(result.classification, 'authorized');
});

test('sincroniza tablas oficiales versionadas sin hardcodear sus valores', async () => {
  const calls: string[] = [];
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    const operation = /SOAPAction":\s*"[^"]*\/([^"/]+)"/.exec(JSON.stringify(init?.headers))?.[1]
      || /<ar:(FEParamGet[^ >]+)/.exec(String(init?.body || ''))?.[1]
      || 'FEParamGetTiposCbte';
    calls.push(operation);
    return new Response(`<Envelope><Body><${operation}Response><${operation}Result><ResultGet><Item><Id>1</Id><Desc>Fixture</Desc></Item></ResultGet></${operation}Result></${operation}Response></Body></Envelope>`, { status: 200 });
  };
  const client = new WsfeClient(config, fetchImpl as typeof fetch);
  const saved: string[] = [];
  const snapshots = await syncOfficialParameterTables({
    login: async () => ticket,
    getParameters: (currentTicket, type) => client.getParameters(currentTicket, type, new Date('2026-08-02T12:00:00Z')),
    save: async (snapshot) => { saved.push(snapshot.parameterType); },
  });
  assert.equal(snapshots.length, 6);
  assert.equal(saved.length, 6);
  assert.equal(new Set(calls).size, 6);
  assert.ok(snapshots.every((snapshot) => snapshot.version.length === 64));
});
