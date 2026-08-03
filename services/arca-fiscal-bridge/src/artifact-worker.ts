import { createAuthorizedFiscalPdf, FISCAL_PDF_GENERATOR_VERSION, sha256Pdf } from './pdf.js';
import { type FiscalArtifactJob, type FiscalArtifactStore, type LoadedFiscalArtifactDocument, SupabasePrivateArtifactStorage } from './store.js';
import type { FiscalQrData } from './qr.js';

export interface FiscalArtifactLogger {
  info(event: string, detail: Record<string, unknown>): void;
  warn(event: string, detail: Record<string, unknown>): void;
}

export class FiscalArtifactWorker {
  readonly #workerId: string;
  readonly #store: FiscalArtifactStore;
  readonly #storage: Pick<SupabasePrivateArtifactStorage, 'putPdf'>;
  readonly #logger: FiscalArtifactLogger;

  constructor({
    workerId,
    store,
    storage,
    logger,
  }: {
    workerId: string;
    store: FiscalArtifactStore;
    storage: Pick<SupabasePrivateArtifactStorage, 'putPdf'>;
    logger: FiscalArtifactLogger;
  }) {
    this.#workerId = workerId;
    this.#store = store;
    this.#storage = storage;
    this.#logger = logger;
  }

  async runOnce(limit = 5): Promise<{ claimed: number; completed: number }> {
    const jobs = await this.#store.claimArtifacts(this.#workerId, limit);
    let completed = 0;
    for (const job of jobs) {
      await this.#process(job);
      completed += 1;
    }
    return { claimed: jobs.length, completed };
  }

  async #process(job: FiscalArtifactJob): Promise<void> {
    const startedAt = Date.now();
    try {
      const document = await this.#store.loadArtifactDocument(job.fiscalDocumentId);
      assertArtifactSource(document, job);
      const qr: FiscalQrData = {
        issueDate: document.issueDate,
        cuit: document.issuer.cuit,
        pointOfSale: document.pointOfSale,
        documentType: document.documentType,
        documentNumber: document.documentNumber,
        totalAmount: document.totalAmount,
        currencyCode: document.currencyCode,
        currencyRate: document.currencyRate,
        authorizationType: 'E',
        authorizationCode: document.cae,
        ...(document.recipient.documentType ? { recipientDocumentType: document.recipient.documentType } : {}),
        ...(document.recipient.documentNumber ? { recipientDocumentNumber: document.recipient.documentNumber } : {}),
      };
      const pdf = await createAuthorizedFiscalPdf({
        businessName: document.issuer.legalName,
        legalName: document.issuer.legalName,
        cuit: document.issuer.cuit,
        address: document.issuer.address,
        recipientCondition: document.recipient.condition,
        documentLabel: document.documentIntent === 'credit_note' ? 'Nota de crédito fiscal' : 'Factura fiscal',
        pointOfSale: document.pointOfSale,
        documentNumber: document.documentNumber,
        issueDate: document.issueDate,
        currencyCode: document.currencyCode,
        items: document.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.netAmount + item.taxAmount + item.exemptAmount + item.nonTaxedAmount + item.otherTaxesAmount,
          netAmount: item.netAmount,
          taxAmount: item.taxAmount,
          taxCode: item.taxCode,
        })),
        netAmount: document.netAmount,
        vatAmount: document.vatAmount,
        exemptAmount: document.exemptAmount,
        nonTaxedAmount: document.nonTaxedAmount,
        otherTaxesAmount: document.otherTaxesAmount,
        totalAmount: document.totalAmount,
        cae: document.cae,
        caeExpiration: document.caeExpiration,
        qr,
        ...(document.recipient.name ? { recipientName: document.recipient.name } : {}),
        ...(document.recipient.documentType ? { recipientDocumentType: document.recipient.documentType } : {}),
        ...(document.recipient.documentNumber ? { recipientDocumentNumber: document.recipient.documentNumber } : {}),
        ...(document.associatedDocument ? { associatedDocument: document.associatedDocument } : {}),
        legends: document.issuer.legends,
      });
      const sha256 = sha256Pdf(pdf);
      const storagePath = privateStoragePath(document.businessId, document.fiscalDocumentId, job.generationToken);
      await this.#storage.putPdf(storagePath, pdf, sha256);
      await this.#store.completeArtifact(job.outboxId, this.#workerId, {
        artifactType: 'authorized_pdf',
        storageProvider: 'supabase_storage',
        storagePath,
        mimeType: 'application/pdf',
        sizeBytes: pdf.byteLength,
        sha256,
        generatedAt: new Date().toISOString(),
        generatedBy: this.#workerId,
        generationVersion: FISCAL_PDF_GENERATOR_VERSION,
      });
      this.#logger.info('fiscal_artifact_completed', {
        fiscalDocumentId: job.fiscalDocumentId,
        artifactOutboxId: job.outboxId,
        sha256,
        sizeBytes: pdf.byteLength,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const failure = classifyArtifactFailure(error);
      await this.#store.failArtifact(job.outboxId, this.#workerId, failure.code, failure.message, failure.retryable);
      this.#logger.warn('fiscal_artifact_failed', {
        fiscalDocumentId: job.fiscalDocumentId,
        artifactOutboxId: job.outboxId,
        code: failure.code,
        retryable: failure.retryable,
        durationMs: Date.now() - startedAt,
      });
    }
  }
}

export function privateStoragePath(businessId: string, documentId: string, generationToken: string): string {
  if (![businessId, documentId, generationToken].every(isUuid)) {
    throw Object.assign(new Error('Identificador de almacenamiento fiscal inválido.'), { code: 'ARTIFACT_SOURCE_INCOMPLETE', retryable: false });
  }
  return `fiscal/${businessId}/${documentId}/${generationToken}.pdf`;
}

function assertArtifactSource(document: LoadedFiscalArtifactDocument, job: FiscalArtifactJob): void {
  if (!['authorized', 'credited'].includes(document.state)
    || !/^\d{14}$/.test(document.cae)
    || document.documentType < 1
    || document.pointOfSale < 1
    || document.documentNumber < 1
    || !/^\d{4}-\d{2}-\d{2}$/.test(document.issueDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(document.caeExpiration)
    || !/^\d{11}$/.test(document.issuer.cuit)
    || !document.issuer.legalName
    || !document.issuer.address
    || !document.recipient.condition
    || !document.recipient.documentType
    || !document.recipient.documentNumber
    || !document.items.length
    || (document.documentIntent === 'credit_note' && !document.associatedDocument)
  ) {
    throw Object.assign(new Error('El comprobante autorizado no contiene todos los snapshots requeridos para PDF.'), { code: 'ARTIFACT_SOURCE_INCOMPLETE', retryable: false });
  }
  if (!isUuid(document.fiscalDocumentId) || !isUuid(document.businessId) || !isUuid(job.generationToken)) {
    throw Object.assign(new Error('Identificador fiscal inválido.'), { code: 'ARTIFACT_SOURCE_INCOMPLETE', retryable: false });
  }
}

function classifyArtifactFailure(error: unknown): { code: string; message: string; retryable: boolean } {
  const value = error as { code?: unknown; message?: unknown; retryable?: unknown };
  const rawCode = String(value?.code || 'ARTIFACT_GENERATION_FAILED').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const code = /^[A-Z0-9_]{3,80}$/.test(rawCode) ? rawCode : 'ARTIFACT_GENERATION_FAILED';
  const retryable = value?.retryable !== false && !['ARTIFACT_SOURCE_INCOMPLETE', 'ARTIFACT_PATH_INVALID', 'ARTIFACT_CONTENT_INVALID'].includes(code);
  return { code, message: String(value?.message || 'No se pudo generar el PDF fiscal.').slice(0, 300), retryable };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
