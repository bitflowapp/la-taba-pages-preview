import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FiscalWorker } from '../src/worker.js';
import { WsfeClient } from '../src/wsfe.js';
import { createSimulatedArca } from '../src/simulated-arca.js';
import type { ArcaResult, FiscalParameterSnapshot, FiscalRequest, LoginTicket } from '../src/types.js';
import type { CredentialHealth, FiscalJob, FiscalScope, FiscalStore, LoadedFiscalDocument } from '../src/store.js';
import { readFiscalCase, sanitizeArcaResult } from '../src/homologation-certification.js';
import { buildCertificateSubject, createArcaCsr } from '../src/create-csr.js';
import { testConfig, testRequest, testTicket } from './fixtures.js';

// Réplica mínima del contrato de base: documentos con estado y número, y una
// outbox con un trabajo por documento. Alcanza para ejercitar el worker contra
// la ARCA simulada; el contrato real se verifica en pgTAP.
class CircuitStore implements FiscalStore {
  readonly documents = new Map<string, { request: FiscalRequest; state: string }>();
  readonly pending: FiscalJob[] = [];
  readonly completions: Array<ArcaResult & Record<string, unknown>> = [];
  readonly settled: string[] = [];
  readonly released: Array<{ outboxId: string; errorCode: string }> = [];
  reserved: number[] = [];
  lastScope: FiscalScope | undefined;

  add(documentId: string, request: FiscalRequest, state = 'queued'): void {
    this.documents.set(documentId, { request, state });
    this.pending.push({ outboxId: `outbox-${documentId}`, fiscalDocumentId: documentId, attemptCount: 0 });
  }

  async claim(_workerId: string, limit = 5, scope?: FiscalScope): Promise<FiscalJob[]> {
    this.lastScope = scope;
    return this.pending.splice(0, limit);
  }

  async load(documentId: string): Promise<LoadedFiscalDocument> {
    const record = this.documents.get(documentId);
    if (!record) throw Object.assign(new Error('no existe'), { code: 'NOT_FOUND' });
    return { request: structuredClone(record.request), state: record.state };
  }

  async reserveNumber(documentId: string, _workerId: string, expected: number): Promise<number> {
    const record = this.documents.get(documentId)!;
    // La unicidad ambiente/CUIT/punto/tipo/número la impone la base; acá se
    // reproduce para que un número repetido rompa igual que en producción.
    if (this.reserved.includes(expected)) throw Object.assign(new Error('numero fiscal ya reservado localmente'), { code: '40001' });
    this.reserved.push(expected);
    record.request.documentNumber = expected;
    record.state = 'authorizing';
    return expected;
  }

  async complete(outboxId: string, _workerId: string, result: ArcaResult & Record<string, unknown>): Promise<void> {
    this.completions.push(result);
    const documentId = outboxId.replace('outbox-', '');
    const record = this.documents.get(documentId);
    if (record && ['authorized', 'authorized_with_observations'].includes(result.classification)) record.state = 'authorized';
    if (record && result.classification === 'rejected') record.state = 'rejected';
    if (record && result.classification === 'ambiguous') record.state = 'ambiguous';
  }

  async settle(outboxId: string): Promise<void> { this.settled.push(outboxId); }
  async release(outboxId: string, _workerId: string, errorCode: string): Promise<void> {
    this.released.push({ outboxId, errorCode });
  }
  async promoteIntents(): Promise<{ claimed: number; promoted: number; manualReview: number; retry: number }> {
    return { claimed: 0, promoted: 0, manualReview: 0, retry: 0 };
  }
  async publishCredentialHealth(_health: CredentialHealth): Promise<void> {}
  async saveParameterSnapshot(_snapshot: FiscalParameterSnapshot): Promise<void> {}
}

const silentLogger = { info() {}, warn() {} };

function buildWorker(store: CircuitStore, arca: ReturnType<typeof createSimulatedArca>, ticket: LoginTicket = testTicket) {
  const config = testConfig();
  const wsfe = new WsfeClient(config, arca.fetch);
  return new FiscalWorker({ config, store, wsaa: { login: async () => ticket }, wsfe, logger: silentLogger });
}

test('el circuito feliz obtiene CAE y respeta el orden de campos del WSDL', async () => {
  const arca = createSimulatedArca();
  const store = new CircuitStore();
  store.add('doc-1', testRequest({ documentNumber: 0 }));
  await buildWorker(store, arca).runOnce();

  const completion = store.completions[0]!;
  assert.equal(completion.classification, 'authorized');
  assert.match(String(completion.cae), /^\d{14}$/);
  assert.equal(completion.documentNumber, 1, 'el número es el último autorizado más uno');
  assert.deepEqual(store.lastScope, { environment: 'homologation', cuit: '20123456789' });

  const solicitar = arca.calls.filter((call) => call === 'FECAESolicitar');
  assert.equal(solicitar.length, 1);
});

test('el timeout después de que ARCA autorizó no emite dos veces', async () => {
  const arca = createSimulatedArca();
  const store = new CircuitStore();
  store.add('doc-1', testRequest({ documentNumber: 0 }));
  // ARCA autoriza y el cliente nunca ve la respuesta.
  arca.behaviour.nextAuthorizeFailure = 'timeout';
  await buildWorker(store, arca).runOnce();
  assert.equal(store.completions[0]?.classification, 'authorized', 'la consulta posterior encuentra el CAE ya emitido');
  assert.equal(arca.calls.filter((call) => call === 'FECAESolicitar').length, 1, 'no se reenvía a ciegas');
  assert.equal(arca.calls.filter((call) => call === 'FECompConsultar').length, 1, 'se consulta antes de cualquier reenvío');
  assert.equal(arca.authorizations().length, 1, 'ARCA autorizó exactamente un comprobante');

  // El documento vuelve a la cola —lease vencido, worker reiniciado— y el
  // circuito tiene que reconocer que ya está resuelto sin volver a pedir CAE.
  store.pending.push({ outboxId: 'outbox-doc-1', fiscalDocumentId: 'doc-1', attemptCount: 1 });
  const second = await buildWorker(store, arca).runOnce();
  assert.deepEqual(second, { claimed: 1, completed: 0, settled: 1 });
  assert.equal(arca.calls.filter((call) => call === 'FECAESolicitar').length, 1);
  assert.deepEqual(store.settled, ['outbox-doc-1']);
});

test('un documento ambiguo consulta y reconoce el mismo comprobante', async () => {
  const arca = createSimulatedArca();
  const store = new CircuitStore();
  store.add('doc-1', testRequest({ documentNumber: 0 }));
  arca.behaviour.nextAuthorizeFailure = 'http500';
  await buildWorker(store, arca).runOnce();
  const authorized = arca.authorizations()[0]!;
  assert.equal(store.completions[0]?.cae, authorized.cae);
  assert.equal(store.completions[0]?.classification, 'authorized');
});

test('un rechazo de ARCA no inventa CAE ni consume otro número', async () => {
  const arca = createSimulatedArca();
  const store = new CircuitStore();
  store.add('doc-1', testRequest({ documentNumber: 0 }));
  arca.behaviour.rejectNextAuthorize = true;
  await buildWorker(store, arca).runOnce();
  assert.equal(store.completions[0]?.classification, 'rejected');
  assert.equal(store.completions[0]?.cae, undefined);
  assert.deepEqual(store.reserved, [1]);
  assert.equal(arca.authorizations().length, 0);
});

test('ARCA caída deja el intento reintentable y sin comprobante', async () => {
  const arca = createSimulatedArca();
  const store = new CircuitStore();
  store.add('doc-1', testRequest({ documentNumber: 0 }));
  arca.behaviour.serviceDown = true;
  await buildWorker(store, arca).runOnce();
  assert.equal(store.completions[0]?.classification, 'service_error');
  assert.equal(store.completions[0]?.errorCode, 'ARCA_UNAVAILABLE');
  assert.equal(arca.authorizations().length, 0);
});

test('la numeración es correlativa entre comprobantes sucesivos', async () => {
  const arca = createSimulatedArca();
  const store = new CircuitStore();
  store.add('doc-1', testRequest({ documentNumber: 0 }));
  await buildWorker(store, arca).runOnce();
  store.add('doc-2', testRequest({ documentNumber: 0 }));
  await buildWorker(store, arca).runOnce();
  assert.deepEqual(store.reserved, [1, 2]);
  assert.deepEqual(arca.authorizations().map((item) => item.documentNumber), [1, 2]);
});

test('dos workers en paralelo no piden CAE dos veces para el mismo documento', async () => {
  const arca = createSimulatedArca();
  const store = new CircuitStore();
  store.add('doc-1', testRequest({ documentNumber: 0 }));
  // claim() vacía la cola: el segundo worker no encuentra trabajo, igual que
  // con FOR UPDATE SKIP LOCKED en la base.
  const [first, second] = await Promise.all([
    buildWorker(store, arca).runOnce(),
    buildWorker(store, arca).runOnce(),
  ]);
  assert.equal(first.claimed + second.claimed, 1);
  assert.equal(arca.calls.filter((call) => call === 'FECAESolicitar').length, 1);
  assert.equal(arca.authorizations().length, 1);
});

test('el FECAESolicitar enviado cumple el orden y los campos del contrato vigente', async () => {
  const arca = createSimulatedArca();
  const bodies: string[] = [];
  const recordingFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body || ''));
    return arca.fetch(url as string, init);
  }) as unknown as typeof fetch;
  const config = testConfig();
  const worker = new FiscalWorker({
    config,
    store: (() => { const store = new CircuitStore(); store.add('doc-1', testRequest({ documentNumber: 0 })); return store; })(),
    wsaa: { login: async () => testTicket },
    wsfe: new WsfeClient(config, recordingFetch),
    logger: silentLogger,
  });
  await worker.runOnce();
  const request = bodies.find((body) => body.includes('FECAESolicitar'))!;
  assert.ok(request, 'se envió un FECAESolicitar');
  // xsd:sequence del WSDL vigente: ImpOpEx, ImpTrib, ImpIVA — en ese orden.
  assert.ok(request.indexOf('<ar:ImpTrib>') < request.indexOf('<ar:ImpIVA>'), 'ImpTrib va antes que ImpIVA');
  assert.ok(request.indexOf('<ar:ImpOpEx>') < request.indexOf('<ar:ImpTrib>'), 'ImpOpEx va antes que ImpTrib');
  assert.match(request, /<ar:CondicionIVAReceptorId>5<\/ar:CondicionIVAReceptorId>/);
  assert.ok(request.indexOf('<ar:MonCotiz>') < request.indexOf('<ar:CondicionIVAReceptorId>'), 'la condición IVA va después de MonCotiz');
  assert.ok(request.indexOf('<ar:CondicionIVAReceptorId>') < request.indexOf('<ar:Iva>'), 'la condición IVA va antes del detalle Iva');
});

// ===== Reinicio del worker: el estado que deja una caída, no un final limpio =====

test('un worker que muere después de enviar adopta el CAE en vez de pedir otro', async () => {
  const arca = createSimulatedArca();
  const store = new CircuitStore();
  store.add('doc-1', testRequest({ documentNumber: 0 }));
  await buildWorker(store, arca).runOnce();
  const authorized = arca.authorizations()[0]!;

  // Estado exacto que deja una caída del proceso justo después de que ARCA
  // autorizó: el número quedó reservado, el comprobante quedó en 'authorizing'
  // y la respuesta nunca llegó a persistirse. Del lado de ARCA el comprobante
  // existe; del lado de acá, nadie lo sabe.
  store.documents.get('doc-1')!.state = 'authorizing';
  store.completions.length = 0;
  store.pending.push({ outboxId: 'outbox-doc-1', fiscalDocumentId: 'doc-1', attemptCount: 1 });
  const callsBefore = arca.calls.length;

  // Otra instancia del worker: proceso nuevo, memoria vacía.
  await buildWorker(store, arca).runOnce();

  const afterRestart = arca.calls.slice(callsBefore);
  assert.ok(afterRestart.includes('FECompConsultar'), 'lo primero que hace es consultar');
  assert.ok(!afterRestart.includes('FECAESolicitar'), 'y no reenvía nunca');
  assert.equal(store.completions[0]?.cae, authorized.cae, 'adopta el CAE que ya existía');
  assert.equal(store.completions[0]?.documentNumber, authorized.documentNumber);
  assert.deepEqual(store.reserved, [1], 'no consume un segundo número');
  assert.equal(arca.authorizations().length, 1, 'ARCA sigue teniendo un solo comprobante');
});

test('si ARCA nunca recibió el comprobante, al reiniciar se conserva el mismo número', async () => {
  const arca = createSimulatedArca();
  const store = new CircuitStore();
  // El proceso reservó el número 7 y murió antes de que ARCA recibiera nada.
  store.add('doc-1', testRequest({ documentNumber: 7 }), 'authorizing');
  store.reserved.push(7);

  await buildWorker(store, arca).runOnce();

  assert.equal(arca.calls.filter((call) => call === 'FECompConsultar').length, 1);
  assert.equal(arca.calls.filter((call) => call === 'FECAESolicitar').length, 0, 'no se reenvía a ciegas');
  assert.equal(store.completions[0]?.classification, 'ambiguous');
  assert.equal(store.completions[0]?.documentNumber, 7, 'el número reservado se conserva');
  assert.deepEqual(store.reserved, [7], 'y no se quema otro');
  assert.equal(arca.authorizations().length, 0);
});

test('reiniciar sobre un comprobante ya resuelto cierra el trabajo sin tocar ARCA', async () => {
  const arca = createSimulatedArca();
  const store = new CircuitStore();
  store.add('doc-1', testRequest({ documentNumber: 0 }));
  await buildWorker(store, arca).runOnce();
  const callsBefore = arca.calls.length;

  store.pending.push({ outboxId: 'outbox-doc-1', fiscalDocumentId: 'doc-1', attemptCount: 1 });
  const result = await buildWorker(store, arca).runOnce();

  assert.deepEqual(result, { claimed: 1, completed: 0, settled: 1 });
  assert.equal(arca.calls.length, callsBefore, 'ni una llamada más');
  assert.deepEqual(store.settled, ['outbox-doc-1'], 'y el lease se cierra en vez de vencer');
});

// ===== Exento y no gravado, de punta a punta =====

test('un comprobante con exento y no gravado llega a ARCA con cada importe en su lugar', async () => {
  const arca = createSimulatedArca();
  const bodies: string[] = [];
  const recordingFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body || ''));
    return arca.fetch(url as string, init);
  }) as unknown as typeof fetch;
  const config = testConfig();
  const store = new CircuitStore();
  store.add('doc-1', testRequest({
    documentNumber: 0,
    netAmount: 100, vatAmount: 21, exemptAmount: 50, nonTaxedAmount: 30, otherTaxesAmount: 9,
    totalAmount: 210,
  }));
  await new FiscalWorker({
    config, store,
    wsaa: { login: async () => testTicket },
    wsfe: new WsfeClient(config, recordingFetch),
    logger: silentLogger,
  }).runOnce();

  const request = bodies.find((body) => body.includes('FECAESolicitar'))!;
  assert.match(request, /<ar:ImpTotal>210\.00<\/ar:ImpTotal>/);
  assert.match(request, /<ar:ImpTotConc>30\.00<\/ar:ImpTotConc>/, 'no gravado');
  assert.match(request, /<ar:ImpNeto>100\.00<\/ar:ImpNeto>/);
  assert.match(request, /<ar:ImpOpEx>50\.00<\/ar:ImpOpEx>/, 'exento');
  assert.match(request, /<ar:ImpTrib>9\.00<\/ar:ImpTrib>/);
  assert.match(request, /<ar:ImpIVA>21\.00<\/ar:ImpIVA>/);
  assert.equal(store.completions[0]?.classification, 'authorized');
  assert.equal(arca.authorizations()[0]?.totalAmount, 210);
});

test('sin condición IVA del receptor el documento no llega a ARCA', async () => {
  const arca = createSimulatedArca();
  const store = new CircuitStore();
  store.add('doc-1', testRequest({ documentNumber: 0, recipientVatConditionId: 0 }));
  await buildWorker(store, arca).runOnce();
  assert.equal(store.completions[0]?.errorCode, 'REQUIRES_FISCAL_REVIEW');
  assert.equal(arca.calls.filter((call) => call === 'FECAESolicitar').length, 0);
  assert.deepEqual(store.reserved, [], 'un documento incompleto no consume un número');
});

test('la auditoría del worker nunca contiene token, sign ni certificado', async () => {
  const arca = createSimulatedArca();
  const store = new CircuitStore();
  store.add('doc-1', testRequest({ documentNumber: 0 }));
  const logged: string[] = [];
  const config = testConfig();
  const worker = new FiscalWorker({
    config,
    store,
    wsaa: { login: async () => ({ ...testTicket, token: 'SUPER-SECRET-TOKEN', sign: 'SUPER-SECRET-SIGN' }) },
    wsfe: new WsfeClient(config, arca.fetch),
    logger: {
      info: (event, detail) => logged.push(JSON.stringify({ event, detail })),
      warn: (event, detail) => logged.push(JSON.stringify({ event, detail })),
    },
  });
  await worker.runOnce();
  const audit = logged.join('\n') + JSON.stringify(store.completions);
  assert.doesNotMatch(audit, /SUPER-SECRET-TOKEN|SUPER-SECRET-SIGN/);
  assert.doesNotMatch(audit, /BEGIN (?:RSA )?PRIVATE KEY/);
});

test('la certificación de homologación se niega a completar un caso fiscal incompleto', () => {
  const file = path.join(os.tmpdir(), `taba-caso-${process.pid}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify({ pointOfSale: 3, documentType: 6 }), 'utf8');
    assert.throws(() => readFiscalCase(file), (error: Error) => {
      assert.match(error.message, /no inventa nada/);
      assert.match(error.message, /recipientVatConditionId/);
      return true;
    });
    fs.writeFileSync(file, JSON.stringify({
      pointOfSale: 3, documentType: 6, concept: 1, recipientDocumentType: 99, recipientDocumentNumber: '0',
      recipientVatConditionId: 5, issueDate: '20260807', currencyCode: 'PES', currencyRate: 1,
      totalAmount: 121, netAmount: 100, vatAmount: 21, exemptAmount: 0, nonTaxedAmount: 0, otherTaxesAmount: 0,
      vatItems: [{ id: 5, baseAmount: 100, amount: 21 }],
    }), 'utf8');
    assert.equal(readFiscalCase(file).recipientVatConditionId, 5);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('la evidencia de homologación no puede arrastrar secretos', () => {
  const sanitized = sanitizeArcaResult({
    classification: 'authorized',
    documentNumber: 1,
    cae: '75123456789012',
    caeExpiration: '20260817',
    observations: [],
    errors: [],
    requestHash: 'a'.repeat(64),
    responseHash: 'b'.repeat(64),
  });
  assert.deepEqual(Object.keys(sanitized).sort(), [
    'cae', 'caeExpiration', 'classification', 'documentNumber', 'errors', 'issueDate', 'observations', 'requestHash', 'responseHash',
  ]);
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /token|sign|BEGIN|Envelope/i);
});

test('el pedido de certificado usa el subject exacto que documenta WSASS', () => {
  assert.equal(
    buildCertificateSubject({ cuit: '20123456789', organization: 'MiEmpresa', system: 'TestSystem' }),
    '/C=AR/O=MiEmpresa/CN=TestSystem/serialNumber=CUIT 20123456789',
  );
  assert.throws(() => buildCertificateSubject({ cuit: '20-12345678-9', organization: 'X', system: 'S1' }), /once dígitos/);
  assert.throws(() => buildCertificateSubject({ cuit: '20123456789', organization: '  ', system: 'S1' }), /empresa/);
});

test('la clave privada nunca se genera dentro del repositorio', () => {
  const repositoryRoot = path.join(os.tmpdir(), `taba-repo-${process.pid}`);
  fs.mkdirSync(repositoryRoot, { recursive: true });
  try {
    assert.throws(
      () => createArcaCsr({ cuit: '20123456789', organization: 'X', system: 'sistema', outputDirectory: path.join(repositoryRoot, 'secrets') }, { repositoryRoot }),
      /dentro del repositorio/,
    );
  } finally {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('el CSR generado es válido, la clave queda a 600 y no se pisa', () => {
  const repositoryRoot = path.join(os.tmpdir(), `taba-repo-b-${process.pid}`);
  const outputDirectory = path.join(os.tmpdir(), `taba-secrets-${process.pid}`);
  fs.mkdirSync(repositoryRoot, { recursive: true });
  try {
    const result = createArcaCsr(
      { cuit: '20123456789', organization: 'La Taba', system: 'taba-homologacion', outputDirectory, keyBits: 1024 },
      { repositoryRoot },
    );
    assert.match(result.csrPem, /BEGIN CERTIFICATE REQUEST/);
    assert.doesNotMatch(result.csrPem, /PRIVATE KEY/);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(result.privateKeyPath).mode & 0o077, 0);
    }
    assert.throws(
      () => createArcaCsr({ cuit: '20123456789', organization: 'La Taba', system: 'taba-homologacion', outputDirectory, keyBits: 1024 }, { repositoryRoot }),
      /No se pisa/,
    );
  } finally {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test('un worker mal configurado suelta el trabajo en vez de matar el comprobante', async () => {
  const arca = createSimulatedArca();
  const store = new CircuitStore();
  store.add('doc-1', testRequest({ documentNumber: 0 }));
  const config = testConfig({ homologationConsent: false });
  const worker = new FiscalWorker({
    config,
    store,
    // Sin la frase de consentimiento, WSAA ni se intenta.
    wsaa: { login: async () => { throw Object.assign(new Error('ARCA_HOMOLOGATION_BLOCKED'), { code: 'ARCA_HOMOLOGATION_BLOCKED' }); } },
    wsfe: new WsfeClient(config, arca.fetch),
    logger: silentLogger,
  });
  await worker.runOnce();
  assert.deepEqual(store.released, [{ outboxId: 'outbox-doc-1', errorCode: 'ARCA_HOMOLOGATION_BLOCKED' }]);
  assert.equal(store.completions.length, 0, 'no se escribe un intento contra ARCA que nunca ocurrió');
  assert.deepEqual(store.reserved, [], 'no se consume un número fiscal');
  assert.equal(arca.calls.length, 0);
});
