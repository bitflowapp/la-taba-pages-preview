// Un comprobante de homologación lleva CAE y QR emitidos por ARCA de verdad,
// contra un ambiente que no factura nada. Si el PDF no lo dice, es
// indistinguible de una factura real para cualquiera que lo reciba.
//
// Esta suite lee el PDF generado —no el input— y verifica qué dice de sí mismo.
import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { createAuthorizedFiscalPdf, createReceiptPdf } from '../src/pdf.js';
import { FiscalArtifactWorker } from '../src/artifact-worker.js';
import type { FiscalArtifactCompletion, FiscalArtifactJob, FiscalArtifactStore, LoadedFiscalArtifactDocument } from '../src/store.js';

/** Texto realmente dibujado en el PDF, más los metadatos del documento. */
function pdfText(bytes: Uint8Array): string {
  const file = Buffer.from(bytes);
  const parts: string[] = [];
  let cursor = 0;
  while (true) {
    const start = file.indexOf('stream', cursor);
    if (start === -1) break;
    let begin = start + 6;
    if (file[begin] === 0x0d) begin += 1;
    if (file[begin] === 0x0a) begin += 1;
    const end = file.indexOf('endstream', begin);
    if (end === -1) break;
    cursor = end + 9;
    let body: string;
    try { body = inflateSync(file.subarray(begin, end)).toString('latin1'); } catch { continue; }
    for (const match of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      parts.push(Buffer.from(match[1]!, 'hex').toString('latin1'));
    }
  }
  // Title, Subject y Keywords viajan como UTF-16BE hexadecimal.
  for (const match of file.toString('latin1').matchAll(/<FEFF([0-9A-Fa-f]{4,})>/g)) {
    const hex = match[1]!;
    if (hex.length % 4 === 0) parts.push(Buffer.from(hex, 'hex').swap16().toString('utf16le'));
  }
  return parts.join('\n');
}

const qr = {
  issueDate: '2026-08-02', cuit: '20123456786', pointOfSale: 5, documentType: 6,
  documentNumber: 42, totalAmount: 210, currencyCode: 'PES', currencyRate: 1,
  authorizationType: 'E' as const, authorizationCode: '12345678901234',
};

function authorizedInput(overrides: Record<string, unknown> = {}) {
  return {
    environment: 'homologation' as const,
    documentState: 'authorized',
    documentTypeId: 6,
    businessName: 'TABA', legalName: 'TABA S.R.L.', cuit: qr.cuit, address: 'Calle sintética 1',
    recipientCondition: 'consumidor_final', recipientDocumentType: 99, recipientDocumentNumber: '0',
    documentLabel: 'Factura fiscal', pointOfSale: 5, documentNumber: 42,
    issueDate: '2026-08-02', currencyCode: 'PES',
    items: [{ description: 'Producto', quantity: 1, unitPrice: 210, amount: 210 }],
    netAmount: 100, vatAmount: 21, exemptAmount: 50, nonTaxedAmount: 30, otherTaxesAmount: 9,
    totalAmount: 210, cae: qr.authorizationCode, caeExpiration: '2026-08-12', qr,
    ...overrides,
  };
}

test('el comprobante de homologación lo dice en el aviso, en la marca de agua y en los metadatos', async () => {
  const text = pdfText(await createAuthorizedFiscalPdf(authorizedInput()));
  assert.match(text, /COMPROBANTE DE PRUEBA/, 'aviso al principio del comprobante');
  assert.match(text, /SIN VALIDEZ FISCAL/);
  assert.match(text, /HOMOLOGACIÓN ARCA/, 'nombra el ambiente de ARCA, no un ambiente propio');
  assert.match(text, /Ambiente: HOMOLOGATION/, 'y queda como dato del comprobante');
  assert.match(text, /\[HOMOLOGATION\] Factura fiscal/, 'el título del PDF también');
  assert.match(text, /NO_VALIDO_COMO_COMPROBANTE/, 'y las palabras clave del archivo');
});

test('el comprobante de producción no lleva ninguna de esas marcas', async () => {
  const text = pdfText(await createAuthorizedFiscalPdf(authorizedInput({ environment: 'production' })));
  assert.doesNotMatch(text, /HOMOLOGACI|SINTÉTICO|SIN VALIDEZ FISCAL|COMPROBANTE DE PRUEBA/);
  assert.match(text, /Ambiente: PRODUCTION/);
  assert.match(text, /CAE: 12345678901234/, 'sigue siendo un comprobante completo');
});

test('el comprobante sintético dice que ARCA nunca lo vio', async () => {
  const text = pdfText(await createAuthorizedFiscalPdf(authorizedInput({ environment: 'synthetic' })));
  assert.match(text, /NO EMITIDO POR ARCA/);
  assert.match(text, /SINTÉTICO/);
  assert.match(text, /Ambiente: SYNTHETIC/);
});

test('la marca de agua está en todas las páginas, no sólo en la primera', async () => {
  const many = Array.from({ length: 120 }, (_, index) => ({
    description: `Producto ${index + 1}`, quantity: 1, unitPrice: 1, amount: 1,
  }));
  const bytes = await createAuthorizedFiscalPdf(authorizedInput({ items: many }));
  const pages = (Buffer.from(bytes).toString('latin1').match(/\/Type \/Page[^s]/g) || []).length;
  const stamps = (pdfText(bytes).match(/^HOMOLOGACIÓN$/gm) || []).length;
  assert.ok(pages > 1, `el fixture tiene que ocupar más de una página (fueron ${pages})`);
  assert.equal(stamps, pages, 'una marca de agua por página');
});

test('el comprobante muestra todo lo que lo identifica', async () => {
  const text = pdfText(await createAuthorizedFiscalPdf(authorizedInput()));
  assert.match(text, /Tipo de comprobante ARCA: 006/, 'tipo');
  assert.match(text, /Comprobante: 00005-00000042/, 'punto de venta y número');
  assert.match(text, /Fecha de emisión: 02\/08\/2026/, 'fecha');
  assert.match(text, /Estado: authorized/, 'estado');
  assert.match(text, /CAE: 12345678901234/, 'CAE');
  assert.match(text, /Vencimiento CAE: 12\/08\/2026/, 'vencimiento del CAE');
  const amounts: ReadonlyArray<readonly [string, string]> = [
    ['Neto', '100.00'], ['IVA', '21.00'], ['Exento', '50.00'],
    ['No gravado', '30.00'], ['Otros tributos', '9.00'], ['TOTAL', '210.00'],
  ];
  for (const [label, amount] of amounts) {
    assert.match(text, new RegExp(`${label}: ${amount.replace('.', '\\.')}`), `importe ${label}`);
  }
});

test('un comprobante sin ambiente declarado no se genera', async () => {
  await assert.rejects(
    () => createReceiptPdf({ ...authorizedInput(), environment: undefined } as never),
    /debe declarar su ambiente/,
  );
  await assert.rejects(
    () => createAuthorizedFiscalPdf({ ...authorizedInput(), environment: 'testing' } as never),
    /debe declarar su ambiente/,
  );
});

// ===== El mismo recorrido, pero por el worker que lo persiste de verdad =====

class ArtifactMemoryStore implements FiscalArtifactStore {
  completed: FiscalArtifactCompletion[] = [];
  failures: Array<{ code: string; message: string }> = [];
  constructor(readonly document: LoadedFiscalArtifactDocument) {}
  async claimArtifacts(): Promise<FiscalArtifactJob[]> {
    return [{ outboxId: 'outbox-1', fiscalDocumentId: this.document.fiscalDocumentId, generationToken: '00000000-0000-4000-8000-000000000004', attemptCount: 1 }];
  }
  async loadArtifactDocument(): Promise<LoadedFiscalArtifactDocument> { return structuredClone(this.document); }
  async completeArtifact(_outboxId: string, _workerId: string, artifact: FiscalArtifactCompletion): Promise<void> { this.completed.push(artifact); }
  async failArtifact(_outboxId: string, _workerId: string, errorCode: string, message: string): Promise<void> { this.failures.push({ code: errorCode, message }); }
}

function artifactDocument(overrides: Partial<LoadedFiscalArtifactDocument> = {}): LoadedFiscalArtifactDocument {
  return {
    fiscalDocumentId: '00000000-0000-4000-8000-000000000002',
    businessId: '00000000-0000-4000-8000-000000000003',
    environment: 'homologation', state: 'authorized', documentIntent: 'invoice',
    documentType: 6, pointOfSale: 5, documentNumber: 42, issueDate: '2026-08-02',
    currencyCode: 'PES', currencyRate: 1,
    totalAmount: 121, netAmount: 100, vatAmount: 21, exemptAmount: 0, nonTaxedAmount: 0, otherTaxesAmount: 0,
    cae: qr.authorizationCode, caeExpiration: '2026-08-12',
    issuer: { legalName: 'TABA S.R.L.', cuit: qr.cuit, address: 'Calle sintética 1', legends: [] },
    recipient: { name: '', condition: 'consumidor_final', documentType: 99, documentNumber: '0' },
    items: [{ description: 'Producto', quantity: 1, unitPrice: 121, netAmount: 100, taxAmount: 21, exemptAmount: 0, nonTaxedAmount: 0, otherTaxesAmount: 0, taxCode: 5 }],
    ...overrides,
  };
}

test('el PDF que persiste el worker sale marcado según el ambiente del comprobante', async () => {
  const store = new ArtifactMemoryStore(artifactDocument());
  const uploaded: Uint8Array[] = [];
  const worker = new FiscalArtifactWorker({
    workerId: 'worker-01',
    store,
    storage: { putPdf: async (_path: string, contents: Uint8Array) => { uploaded.push(contents); } },
    logger: { info() {}, warn() {} },
  });

  await worker.runOnce();

  assert.equal(store.failures.length, 0);
  assert.equal(uploaded.length, 1);
  const text = pdfText(uploaded[0]!);
  assert.match(text, /Ambiente: HOMOLOGATION/);
  assert.match(text, /SIN VALIDEZ FISCAL/);
  assert.match(text, /Estado: authorized/);
  assert.match(text, /Tipo de comprobante ARCA: 006/);
});

test('un comprobante que no declara ambiente no produce PDF, produce revisión', async () => {
  const store = new ArtifactMemoryStore(artifactDocument({ environment: '' }));
  const uploaded: Uint8Array[] = [];
  const worker = new FiscalArtifactWorker({
    workerId: 'worker-01',
    store,
    storage: { putPdf: async (_path: string, contents: Uint8Array) => { uploaded.push(contents); } },
    logger: { info() {}, warn() {} },
  });

  await worker.runOnce();

  assert.equal(uploaded.length, 0, 'no se sube nada');
  assert.equal(store.completed.length, 0);
  assert.equal(store.failures[0]?.code, 'ARTIFACT_SOURCE_INCOMPLETE');
  assert.match(String(store.failures[0]?.message), /no declara su ambiente/);
});
