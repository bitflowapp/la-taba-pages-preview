import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArcaConfig, ArcaResult, FiscalParameterSnapshot, FiscalRequest, LoginTicket } from '../src/types.js';
import { buildFiscalQrPayload, buildFiscalQrUrl } from '../src/qr.js';
import { createReceiptPdf } from '../src/pdf.js';
import { FiscalWorker } from '../src/worker.js';
import type { FiscalJob, FiscalStore, LoadedFiscalDocument } from '../src/store.js';

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

class MemoryStore implements FiscalStore {
  completed: Array<ArcaResult & Record<string, unknown>> = [];
  constructor(readonly loaded: LoadedFiscalDocument) {}
  async claim(): Promise<FiscalJob[]> { return [{ outboxId: 'outbox-1', fiscalDocumentId: 'document-1', attemptCount: 1 }]; }
  async load(): Promise<LoadedFiscalDocument> { return structuredClone(this.loaded); }
  async reserveNumber(_documentId: string, _workerId: string, expected: number): Promise<number> { return expected; }
  async complete(_outboxId: string, _workerId: string, result: ArcaResult & Record<string, unknown>): Promise<void> { this.completed.push(result); }
  async saveParameterSnapshot(_snapshot: FiscalParameterSnapshot): Promise<void> {}
}

const config: ArcaConfig = { environment: 'homologation', cuit: '20123456789', certificatePath: 'C:\\secure\\cert.pem', privateKeyPath: 'C:\\secure\\key.pem', workerId: 'worker-01', healthPort: 8787, endpoints: { wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms', wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx' }, homologationConsent: true, productionEnabled: false };
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
