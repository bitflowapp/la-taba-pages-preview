import type { ArcaConfig, ArcaResult, FiscalParameterSnapshot, FiscalRequest, LoginTicket } from '../src/types.js';
import type { CredentialHealth, FiscalJob, FiscalScope, FiscalStore, LoadedFiscalDocument } from '../src/store.js';

export function testConfig(overrides: Partial<ArcaConfig> = {}): ArcaConfig {
  return {
    environment: 'homologation',
    cuit: '20123456789',
    certificatePath: 'synthetic-certificate-path',
    privateKeyPath: 'synthetic-private-key-path',
    workerId: 'worker-01',
    healthPort: 8787,
    endpoints: { wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms', wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx' },
    homologationConsent: true,
    productionEnabled: false,
    businessId: '52000000-0000-4000-8000-000000000001',
    ticketStatePath: '/tmp/taba-fiscal-ticket-state.json',
    maxClockSkewSeconds: 300,
    ...overrides,
  };
}

export const testTicket: LoginTicket = Object.freeze({
  token: 'token', sign: 'sign',
  generationTime: '2026-08-02T10:00:00Z',
  expirationTime: '2026-08-02T22:00:00Z',
  service: 'wsfe',
});

// Factura B (tipo 6) con IVA discriminado al 21%: el mismo caso que declara la
// política contable del fixture pgTAP. Antes era tipo 11 —Factura C— con IVA
// distinto de cero y array de IVA informado, que ARCA rechaza por 1438 y 1443.
export function testRequest(overrides: Partial<FiscalRequest> = {}): FiscalRequest {
  return {
    cuit: '20123456789', pointOfSale: 5, documentType: 6, concept: 1,
    recipientDocumentType: 99, recipientDocumentNumber: '0', recipientVatConditionId: 5,
    documentNumber: 42, issueDate: '20260802',
    totalAmount: 121, netAmount: 100, vatAmount: 21,
    exemptAmount: 0, nonTaxedAmount: 0, otherTaxesAmount: 0,
    currencyCode: 'PES', currencyRate: 1,
    vatItems: [{ id: 5, baseAmount: 100, amount: 21 }],
    ...overrides,
  };
}

export class MemoryFiscalStore implements FiscalStore {
  completed: Array<ArcaResult & Record<string, unknown>> = [];
  reserveCalls = 0;
  settled: string[] = [];
  released: Array<{ outboxId: string; errorCode: string }> = [];
  health: CredentialHealth[] = [];
  scopes: Array<FiscalScope | undefined> = [];
  jobs: FiscalJob[] = [{ outboxId: 'outbox-1', fiscalDocumentId: 'document-1', attemptCount: 1 }];

  constructor(readonly loaded: LoadedFiscalDocument) {}

  async claim(_workerId: string, _limit: number | undefined, scope?: FiscalScope): Promise<FiscalJob[]> {
    this.scopes.push(scope);
    return this.jobs;
  }

  async load(): Promise<LoadedFiscalDocument> { return structuredClone(this.loaded); }

  async reserveNumber(_documentId: string, _workerId: string, expected: number): Promise<number> {
    this.reserveCalls += 1;
    return expected;
  }

  async complete(_outboxId: string, _workerId: string, result: ArcaResult & Record<string, unknown>): Promise<void> {
    this.completed.push(result);
  }

  async settle(outboxId: string): Promise<void> { this.settled.push(outboxId); }

  async release(outboxId: string, _workerId: string, errorCode: string): Promise<void> {
    this.released.push({ outboxId, errorCode });
  }

  async promoteIntents(): Promise<{ claimed: number; promoted: number; manualReview: number; retry: number }> {
    return { claimed: 0, promoted: 0, manualReview: 0, retry: 0 };
  }

  async publishCredentialHealth(health: CredentialHealth): Promise<void> { this.health.push(health); }

  async saveParameterSnapshot(_snapshot: FiscalParameterSnapshot): Promise<void> {}
}
