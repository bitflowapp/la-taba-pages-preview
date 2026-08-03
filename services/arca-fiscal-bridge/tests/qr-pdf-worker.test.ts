import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArcaConfig, ArcaResult, FiscalParameterSnapshot, FiscalRequest, LoginTicket } from '../src/types.js';
import { buildFiscalQrPayload, buildFiscalQrUrl } from '../src/qr.js';
import { createAuthorizedFiscalPdf, createReceiptPdf, sha256Pdf } from '../src/pdf.js';
import { FiscalWorker } from '../src/worker.js';
import { FiscalArtifactWorker, privateStoragePath } from '../src/artifact-worker.js';
import { SupabasePrivateArtifactStorage, type FiscalArtifactCompletion, type FiscalArtifactJob, type FiscalArtifactStore, type FiscalJob, type FiscalStore, type LoadedFiscalArtifactDocument, type LoadedFiscalDocument } from '../src/store.js';

const qr = {
  issueDate: '2026-08-02', cuit: '20123456789', pointOfSale: 5,
  documentType: 11, documentNumber: 42, totalAmount: 121,
  currencyCode: 'PES', currencyRate: 1, authorizationType: 'E' as const,
  authorizationCode: '12345678901234',
};

test('QR versión 1 es determinista y sólo existe con CAE válido', () => {
  assert.equal(buildFiscalQrPayload(qr).ver, 1);
  assert.equal(buildFiscalQrUrl(qr), buildFiscalQrUrl(qr));
  assert.throws(() => buildFiscalQrUrl({ ...qr, authorizationCode: '' }), /sin CAE/);
});

test('PDF distingue comprobante autorizado de interno pendiente', async () => {
  const base = { businessName: 'TABA', documentLabel: 'Factura C', issueDate: '2026-08-02', items: [{ description: 'Producto', quantity: 1, unitPrice: 121, amount: 121 }], totalAmount: 121 };
  const pending = await createReceiptPdf(base);
  const authorized = await createReceiptPdf({ ...base, cae: qr.authorizationCode, caeExpiration: '2026-08-12', qr });
  assert.ok(pending.byteLength > 700);
  assert.ok(authorized.byteLength > pending.byteLength);
});

test('PDF autorizado A4 es determinista, tiene CAE/QR y conserva referencia de nota', async () => {
  const input = {
    businessName: 'TABA', legalName: 'TABA S.R.L.', cuit: qr.cuit, address: 'Dirección sintética',
    recipientCondition: 'consumidor_final', recipientDocumentType: 99, recipientDocumentNumber: '0',
    documentLabel: 'Nota de crédito fiscal', pointOfSale: 5, documentNumber: 43, issueDate: '2026-08-02', currencyCode: 'PES',
    items: [{ description: 'Producto', quantity: 1, unitPrice: 121, amount: 121 }],
    netAmount: 100, vatAmount: 21, exemptAmount: 0, nonTaxedAmount: 0, otherTaxesAmount: 0, totalAmount: 121,
    cae: qr.authorizationCode, caeExpiration: '2026-08-12', qr: { ...qr, documentNumber: 43 },
    associatedDocument: { documentType: 11, pointOfSale: 5, documentNumber: 42, issueDate: '2026-08-02' },
    legends: ['Fixture sintético'],
  };
  const first = await createAuthorizedFiscalPdf(input);
  const second = await createAuthorizedFiscalPdf(input);
  assert.equal(sha256Pdf(first), sha256Pdf(second));
  await assert.rejects(() => createAuthorizedFiscalPdf({ ...input, cae: '' }), /sin CAE/);
});

class MemoryStore implements FiscalStore {
  completed: Array<ArcaResult & Record<string, unknown>> = [];
  reserveCalls = 0;
  constructor(readonly loaded: LoadedFiscalDocument) {}
  async claim(): Promise<FiscalJob[]> { return [{ outboxId: 'outbox-1', fiscalDocumentId: 'document-1', attemptCount: 1 }]; }
  async load(): Promise<LoadedFiscalDocument> { return structuredClone(this.loaded); }
  async reserveNumber(_documentId: string, _workerId: string, expected: number): Promise<number> { this.reserveCalls += 1; return expected; }
  async complete(_outboxId: string, _workerId: string, result: ArcaResult & Record<string, unknown>): Promise<void> { this.completed.push(result); }
  async saveParameterSnapshot(_snapshot: FiscalParameterSnapshot): Promise<void> {}
}

const config: ArcaConfig = { environment: 'homologation', cuit: '20123456789', certificatePath: 'synthetic-certificate-path', privateKeyPath: 'synthetic-private-key-path', workerId: 'worker-01', healthPort: 8787, endpoints: { wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms', wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx' }, homologationConsent: true, productionEnabled: false };
const ticket: LoginTicket = { token: 't', sign: 's', generationTime: '', expirationTime: '2026-08-03T00:00:00Z', service: 'wsfe' };
const fiscalRequest: FiscalRequest = { cuit: config.cuit, pointOfSale: 5, documentType: 11, concept: 1, recipientDocumentType: 99, recipientDocumentNumber: '0', documentNumber: 0, issueDate: '20260802', totalAmount: 121, netAmount: 100, vatAmount: 21, exemptAmount: 0, nonTaxedAmount: 0, otherTaxesAmount: 0, currencyCode: 'PES', currencyRate: 1, vatItems: [{ id: 5, baseAmount: 100, amount: 21 }] };

test('worker reserva último+1 y completa autorización exactly-once local', async () => {
  const store = new MemoryStore({ request: fiscalRequest, state: 'queued' });
  let requestedNumber = 0;
  const worker = new FiscalWorker({
    config, store,
    wsaa: { login: async () => ticket },
    wsfe: {
      lastAuthorized: async () => 41,
      authorize: async (_ticket, request) => { requestedNumber = request.documentNumber; return { classification: 'authorized', documentNumber: 42, cae: qr.authorizationCode, caeExpiration: '20260812', observations: [], errors: [] }; },
      consult: async () => null,
    },
    logger: { info() {}, warn() {} },
  });
  assert.deepEqual(await worker.runOnce(), { claimed: 1, completed: 1 });
  assert.equal(requestedNumber, 42);
  assert.equal(store.completed[0]?.classification, 'authorized');
  assert.equal(typeof store.completed[0]?.request_id, 'string');
});

test('worker bloquea tipo fiscal no revisado sin llamar ARCA', async () => {
  const store = new MemoryStore({ request: { ...fiscalRequest, documentType: 0 }, state: 'queued' });
  let called = false;
  const worker = new FiscalWorker({ config, store, wsaa: { login: async () => { called = true; return ticket; } }, wsfe: { lastAuthorized: async () => 0, authorize: async () => ({ classification: 'service_error', observations: [], errors: [] }), consult: async () => null }, logger: { info() {}, warn() {} } });
  await worker.runOnce();
  assert.equal(called, false);
  assert.equal(store.completed[0]?.errorCode, 'REQUIRES_FISCAL_REVIEW');
});

test('snapshot fiscal inválido no reserva número ni llama ARCA', async () => {
  const store = new MemoryStore({ request: { ...fiscalRequest, totalAmount: 999 }, state: 'queued' });
  let loginCalls = 0;
  let lastCalls = 0;
  const worker = new FiscalWorker({
    config, store,
    wsaa: { login: async () => { loginCalls += 1; return ticket; } },
    wsfe: {
      lastAuthorized: async () => { lastCalls += 1; return 0; },
      authorize: async () => ({ classification: 'service_error', observations: [], errors: [] }),
      consult: async () => null,
    },
    logger: { info() {}, warn() {} },
  });
  await worker.runOnce();
  assert.equal(loginCalls, 0);
  assert.equal(lastCalls, 0);
  assert.equal(store.reserveCalls, 0);
  assert.equal(store.completed[0]?.errorCode, 'REQUIRES_FISCAL_REVIEW');
});

test('documento ambiguo consulta antes de cualquier nuevo FECAESolicitar', async () => {
  const store = new MemoryStore({ request: { ...fiscalRequest, documentNumber: 42 }, state: 'ambiguous' });
  let authorized = 0;
  let consulted = 0;
  const worker = new FiscalWorker({
    config, store,
    wsaa: { login: async () => ticket },
    wsfe: {
      lastAuthorized: async () => 42,
      authorize: async () => { authorized += 1; return { classification: 'service_error', observations: [], errors: [] }; },
      consult: async () => { consulted += 1; return { classification: 'authorized', documentNumber: 42, cae: qr.authorizationCode, caeExpiration: '20260812', issueDate: '20260802', totalAmount: 121, pointOfSale: 5, documentType: 11, observations: [], errors: [] }; },
    },
    logger: { info() {}, warn() {} },
  });
  await worker.runOnce();
  assert.equal(consulted, 1);
  assert.equal(authorized, 0);
  assert.equal(store.completed[0]?.operation, 'FECompConsultar');
});

class ArtifactMemoryStore implements FiscalArtifactStore {
  completed: FiscalArtifactCompletion[] = [];
  failures: Array<{ code: string; retryable: boolean }> = [];
  constructor(readonly document: LoadedFiscalArtifactDocument) {}
  async claimArtifacts(): Promise<FiscalArtifactJob[]> { return [{ outboxId: 'outbox-1', fiscalDocumentId: this.document.fiscalDocumentId, generationToken: '00000000-0000-4000-8000-000000000004', attemptCount: 1 }]; }
  async loadArtifactDocument(): Promise<LoadedFiscalArtifactDocument> { return structuredClone(this.document); }
  async completeArtifact(_outboxId: string, _workerId: string, artifact: FiscalArtifactCompletion): Promise<void> { this.completed.push(artifact); }
  async failArtifact(_outboxId: string, _workerId: string, errorCode: string, _message: string, retryable: boolean): Promise<void> { this.failures.push({ code: errorCode, retryable }); }
}

test('worker de artefactos persiste un PDF con path privado, hash y versión', async () => {
  const document: LoadedFiscalArtifactDocument = {
    fiscalDocumentId: '00000000-0000-4000-8000-000000000002', businessId: '00000000-0000-4000-8000-000000000003', state: 'authorized', documentIntent: 'credit_note',
    documentType: 13, pointOfSale: 5, documentNumber: 43, issueDate: '2026-08-02', currencyCode: 'PES', currencyRate: 1,
    totalAmount: 121, netAmount: 100, vatAmount: 21, exemptAmount: 0, nonTaxedAmount: 0, otherTaxesAmount: 0,
    cae: qr.authorizationCode, caeExpiration: '2026-08-12', issuer: { legalName: 'TABA S.R.L.', cuit: qr.cuit, address: 'Dirección sintética', legends: [] },
    recipient: { name: '', condition: 'consumidor_final', documentType: 99, documentNumber: '0' },
    associatedDocument: { documentType: 11, pointOfSale: 5, documentNumber: 42, issueDate: '2026-08-02' },
    items: [{ description: 'Producto', quantity: 1, unitPrice: 121, netAmount: 100, taxAmount: 21, exemptAmount: 0, nonTaxedAmount: 0, otherTaxesAmount: 0, taxCode: 5 }],
  };
  const store = new ArtifactMemoryStore(document);
  const uploads: Array<{ path: string; sha256: string; size: number }> = [];
  const worker = new FiscalArtifactWorker({
    workerId: 'worker-01', store,
    storage: { putPdf: async (path, bytes, sha256) => { uploads.push({ path, sha256, size: bytes.byteLength }); } },
    logger: { info() {}, warn() {} },
  });
  await worker.runOnce();
  assert.equal(store.failures.length, 0);
  assert.equal(store.completed.length, 1);
  assert.equal(uploads[0]?.path, privateStoragePath(document.businessId, document.fiscalDocumentId, '00000000-0000-4000-8000-000000000004'));
  assert.match(store.completed[0]?.sha256 || '', /^[0-9a-f]{64}$/);
  assert.equal(store.completed[0]?.storageProvider, 'supabase_storage');
});

test('storage privado no sobrescribe y acepta sólo el replay con mismo hash', async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  const hash = sha256Pdf(bytes);
  const calls: Array<{ method: string | undefined; upsert: string | null }> = [];
  const storage = new SupabasePrivateArtifactStorage(
    { url: 'https://fixture.supabase.co', serviceRole: 's'.repeat(32) },
    async (_input, init) => {
      calls.push({ method: init?.method, upsert: new Headers(init?.headers).get('x-upsert') });
      return calls.length === 1 ? new Response('', { status: 409 }) : new Response(bytes, { status: 200 });
    },
  );
  await storage.putPdf('fiscal/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000003.pdf', bytes, hash);
  assert.deepEqual(calls, [{ method: 'POST', upsert: 'false' }, { method: 'GET', upsert: null }]);
});
