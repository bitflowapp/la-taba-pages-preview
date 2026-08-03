import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ArcaResult, FiscalParameterSnapshot, FiscalRequest } from './types.js';

export interface FiscalJob {
  outboxId: string;
  fiscalDocumentId: string;
  attemptCount: number;
}

export interface LoadedFiscalDocument {
  request: FiscalRequest;
  state: string;
}

export interface FiscalArtifactJob {
  outboxId: string;
  fiscalDocumentId: string;
  generationToken: string;
  attemptCount: number;
}

export interface FiscalArtifactItem {
  description: string;
  quantity: number;
  unitPrice: number;
  netAmount: number;
  taxAmount: number;
  exemptAmount: number;
  nonTaxedAmount: number;
  otherTaxesAmount: number;
  taxCode: number | null;
}

export interface LoadedFiscalArtifactDocument {
  fiscalDocumentId: string;
  businessId: string;
  state: string;
  documentIntent: 'invoice' | 'credit_note';
  documentType: number;
  pointOfSale: number;
  documentNumber: number;
  issueDate: string;
  currencyCode: string;
  currencyRate: number;
  totalAmount: number;
  netAmount: number;
  vatAmount: number;
  exemptAmount: number;
  nonTaxedAmount: number;
  otherTaxesAmount: number;
  cae: string;
  caeExpiration: string;
  issuer: { legalName: string; cuit: string; address: string; legends: string[] };
  recipient: { name: string; condition: string; documentType: number | null; documentNumber: string };
  associatedDocument?: { documentType: number; pointOfSale: number; documentNumber: number; issueDate?: string };
  items: FiscalArtifactItem[];
}

export interface FiscalArtifactCompletion {
  artifactType: 'authorized_pdf';
  storageProvider: 'supabase_storage';
  storagePath: string;
  mimeType: 'application/pdf';
  sizeBytes: number;
  sha256: string;
  generatedAt: string;
  generatedBy: string;
  generationVersion: string;
}

export interface FiscalStore {
  claim(workerId: string, limit?: number): Promise<FiscalJob[]>;
  load(documentId: string): Promise<LoadedFiscalDocument>;
  reserveNumber(documentId: string, workerId: string, expectedNumber: number): Promise<number>;
  complete(outboxId: string, workerId: string, result: ArcaResult & Record<string, unknown>): Promise<void>;
  saveParameterSnapshot(snapshot: FiscalParameterSnapshot): Promise<void>;
}

export interface FiscalArtifactStore {
  claimArtifacts(workerId: string, limit?: number): Promise<FiscalArtifactJob[]>;
  loadArtifactDocument(documentId: string): Promise<LoadedFiscalArtifactDocument>;
  completeArtifact(outboxId: string, workerId: string, artifact: FiscalArtifactCompletion): Promise<void>;
  failArtifact(outboxId: string, workerId: string, errorCode: string, errorMessage: string, retryable: boolean): Promise<void>;
}

export interface PrivateStoreConfig {
  url: string;
  serviceRole: string;
}

export function loadPrivateStoreConfig(env: NodeJS.ProcessEnv = process.env): PrivateStoreConfig {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const keyPath = String(env.SUPABASE_SERVICE_ROLE_PATH || '').trim();
  if (!/^https:\/\/[a-z0-9-]+[.]supabase[.]co$/i.test(url)) throw new Error('SUPABASE_URL privado invÃ¡lido.');
  if (!path.isAbsolute(keyPath) || /-----BEGIN/.test(keyPath)) throw new Error('SUPABASE_SERVICE_ROLE_PATH debe ser una ruta absoluta montada.');
  const serviceRole = fs.readFileSync(keyPath, 'utf8').trim();
  if (serviceRole.length < 32 || /\s/.test(serviceRole)) throw new Error('Service role invÃ¡lido.');
  return { url, serviceRole };
}

export class SupabaseFiscalStore implements FiscalStore, FiscalArtifactStore {
  readonly #url: string;
  readonly #serviceRole: string;
  readonly #fetchImpl: typeof fetch;

  constructor(config: PrivateStoreConfig, fetchImpl: typeof fetch = fetch) {
    this.#url = config.url;
    this.#serviceRole = config.serviceRole;
    this.#fetchImpl = fetchImpl;
  }

  async claim(workerId: string, limit = 5): Promise<FiscalJob[]> {
    const rows = await this.#rpc('claim_fiscal_outbox', { p_worker_id: workerId, p_limit: limit, p_lease_seconds: 90 });
    return asRows(rows).map((row) => ({
      outboxId: String(row.id), fiscalDocumentId: String(row.fiscal_document_id), attemptCount: Number(row.attempt_count || 0),
    }));
  }

  async load(documentId: string): Promise<LoadedFiscalDocument> {
    const row = await this.#loadDocumentRow(documentId);
    const associated = await this.#loadAssociated(row);
    return { request: rowToRequest(row, associated), state: String(row.state || '') };
  }

  async reserveNumber(documentId: string, workerId: string, expectedNumber: number): Promise<number> {
    const row = await this.#rpc('reserve_fiscal_document_number', {
      p_document_id: documentId, p_worker_id: workerId, p_expected_number: expectedNumber,
    });
    const result = Array.isArray(row) ? row[0] : row;
    const value = Number((result as Record<string, unknown> | undefined)?.document_number);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('La reserva fiscal no devolviÃ³ un nÃºmero vÃ¡lido.');
    return value;
  }

  async complete(outboxId: string, workerId: string, result: ArcaResult & Record<string, unknown>): Promise<void> {
    await this.#rpc('complete_fiscal_attempt', {
      p_outbox_id: outboxId, p_worker_id: workerId, p_result: toDatabaseResult(result),
    });
  }

  async saveParameterSnapshot(snapshot: FiscalParameterSnapshot): Promise<void> {
    await this.#rpc('save_fiscal_parameter_snapshot', {
      p_environment: snapshot.environment,
      p_parameter_type: snapshot.parameterType,
      p_version: snapshot.version,
      p_values_json: { operation: snapshot.operation, values: snapshot.values, requestHash: snapshot.requestHash, responseHash: snapshot.responseHash },
      p_synchronized_at: snapshot.synchronizedAt,
    });
  }

  async claimArtifacts(workerId: string, limit = 5): Promise<FiscalArtifactJob[]> {
    const rows = await this.#rpc('claim_fiscal_artifact_outbox', { p_worker_id: workerId, p_limit: limit, p_lease_seconds: 120 });
    return asRows(rows).map((row) => ({
      outboxId: String(row.id),
      fiscalDocumentId: String(row.fiscal_document_id),
      generationToken: String(row.generation_token),
      attemptCount: Number(row.attempt_count || 0),
    }));
  }

  async loadArtifactDocument(documentId: string): Promise<LoadedFiscalArtifactDocument> {
    const row = await this.#loadDocumentRow(documentId);
    const issuer = asObject(row.issuer_snapshot);
    const recipient = asObject(row.recipient_snapshot);
    const associatedSnapshot = asObject(row.associated_document_snapshot);
    const associated = await this.#loadAssociated(row);
    const documentIntent = String(row.document_intent) === 'credit_note' ? 'credit_note' : 'invoice';
    const items = asRows(row.fiscal_document_items).map((item) => ({
      description: String(item.description || ''),
      quantity: numberValue(item.quantity),
      unitPrice: numberValue(item.unit_price),
      netAmount: numberValue(item.net_amount),
      taxAmount: numberValue(item.tax_amount),
      exemptAmount: numberValue(item.exempt_amount),
      nonTaxedAmount: numberValue(item.non_taxed_amount),
      otherTaxesAmount: numberValue(item.other_taxes_amount),
      taxCode: numberOrNull(item.tax_code),
    }));
    const associatedDocument = associated || associatedFromSnapshot(associatedSnapshot);
    return {
      fiscalDocumentId: String(row.id),
      businessId: String(row.business_id),
      state: String(row.state || ''),
      documentIntent,
      documentType: numberValue(row.document_type),
      pointOfSale: numberValue(row.point_of_sale),
      documentNumber: numberValue(row.document_number),
      issueDate: normalizeDate(row.issue_date),
      currencyCode: String(row.currency || 'PES'),
      currencyRate: numberValue(row.currency_rate, 1),
      totalAmount: numberValue(row.total_amount),
      netAmount: numberValue(row.net_amount),
      vatAmount: numberValue(row.tax_amount),
      exemptAmount: numberValue(row.exempt_amount),
      nonTaxedAmount: numberValue(row.non_taxed_amount),
      otherTaxesAmount: numberValue(row.other_taxes_amount),
      cae: String(row.cae || ''),
      caeExpiration: normalizeDate(row.cae_expiration),
      issuer: {
        legalName: String(issuer.legal_name || issuer.legalName || ''),
        cuit: String(issuer.cuit || row.cuit || ''),
        address: String(issuer.address || issuer.business_address || ''),
        legends: stringArray(issuer.legends),
      },
      recipient: {
        name: String(recipient.name || recipient.legal_name || ''),
        condition: String(recipient.condition || row.recipient_type || ''),
        documentType: numberOrNull(recipient.document_type ?? row.recipient_document_type),
        documentNumber: String(recipient.document_number || row.recipient_document_number || ''),
      },
      ...(associatedDocument ? { associatedDocument } : {}),
      items,
    };
  }

  async completeArtifact(outboxId: string, workerId: string, artifact: FiscalArtifactCompletion): Promise<void> {
    await this.#rpc('complete_fiscal_artifact', {
      p_artifact_outbox_id: outboxId,
      p_worker_id: workerId,
      p_artifact: {
        artifact_type: artifact.artifactType,
        storage_provider: artifact.storageProvider,
        storage_path: artifact.storagePath,
        mime_type: artifact.mimeType,
        size_bytes: artifact.sizeBytes,
        sha256: artifact.sha256,
        generated_at: artifact.generatedAt,
        generated_by: artifact.generatedBy,
        generation_version: artifact.generationVersion,
      },
    });
  }

  async failArtifact(outboxId: string, workerId: string, errorCode: string, errorMessage: string, retryable: boolean): Promise<void> {
    await this.#rpc('fail_fiscal_artifact', {
      p_artifact_outbox_id: outboxId,
      p_worker_id: workerId,
      p_error_code: errorCode,
      p_error_message: errorMessage.slice(0, 300),
      p_retryable: retryable,
    });
  }

  async #loadDocumentRow(documentId: string): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({ select: '*,fiscal_document_items(*)', id: `eq.${documentId}` });
    const rows = await this.#request(`/rest/v1/fiscal_documents?${query}`);
    const row = asRows(rows)[0];
    if (!row) throw Object.assign(new Error('Documento fiscal inexistente.'), { code: 'NOT_FOUND', retryable: false });
    return row;
  }

  async #loadAssociated(row: Record<string, unknown>): Promise<{ documentType: number; pointOfSale: number; documentNumber: number; issueDate?: string } | undefined> {
    const associatedId = String(row.associated_document_id || '');
    if (!isUuid(associatedId)) return undefined;
    const query = new URLSearchParams({ select: 'document_type,point_of_sale,document_number,issue_date', id: `eq.${associatedId}` });
    const associated = asRows(await this.#request(`/rest/v1/fiscal_documents?${query}`))[0];
    return associated ? associatedFromRow(associated) : undefined;
  }

  async #rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    return this.#request(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
  }

  async #request(route: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.#fetchImpl(`${this.#url}${route}`, {
      ...init,
      headers: {
        apikey: this.#serviceRole,
        authorization: `Bearer ${this.#serviceRole}`,
        'content-type': 'application/json',
        accept: 'application/json',
        ...(init.headers || {}),
      },
      redirect: 'error',
    });
    const text = await response.text();
    if (!response.ok) {
      let message = `PostgreSQL respondiÃ³ ${response.status}.`;
      try { message = String((JSON.parse(text) as { message?: string }).message || message); } catch { /* sanitized fallback */ }
      throw Object.assign(new Error(message.slice(0, 300)), { code: response.status >= 500 ? 'DATABASE_UNAVAILABLE' : 'DATABASE_ERROR', retryable: response.status >= 500 });
    }
    return text ? JSON.parse(text) : null;
  }
}

export class SupabasePrivateArtifactStorage {
  readonly #url: string;
  readonly #serviceRole: string;
  readonly #fetchImpl: typeof fetch;

  constructor(config: PrivateStoreConfig, fetchImpl: typeof fetch = fetch) {
    this.#url = config.url;
    this.#serviceRole = config.serviceRole;
    this.#fetchImpl = fetchImpl;
  }

  async putPdf(storagePath: string, contents: Uint8Array, expectedSha256: string): Promise<void> {
    if (!/^fiscal\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}[.]pdf$/.test(storagePath)) {
      throw Object.assign(new Error('Ruta privada de artefacto invÃ¡lida.'), { code: 'ARTIFACT_PATH_INVALID', retryable: false });
    }
    if (contents.byteLength < 1 || contents.byteLength > 16_777_216 || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
      throw Object.assign(new Error('Contenido de artefacto invÃ¡lido.'), { code: 'ARTIFACT_CONTENT_INVALID', retryable: false });
    }
    const response = await this.#fetchImpl(`${this.#url}/storage/v1/object/fiscal-documents/${encodeStoragePath(storagePath)}`, {
      method: 'POST',
      headers: this.#headers({ 'content-type': 'application/pdf', 'cache-control': 'no-store', 'x-upsert': 'false' }),
      body: Buffer.from(contents),
      redirect: 'error',
    });
    if (response.ok) return;
    if (response.status === 409 && await this.#matchesExistingObject(storagePath, expectedSha256)) return;
    throw Object.assign(new Error('No se pudo persistir el PDF fiscal privado.'), {
      code: response.status >= 500 ? 'ARTIFACT_STORAGE_UNAVAILABLE' : 'ARTIFACT_STORAGE_REJECTED',
      retryable: response.status >= 500 || response.status === 429,
    });
  }

  async #matchesExistingObject(storagePath: string, expectedSha256: string): Promise<boolean> {
    const response = await this.#fetchImpl(`${this.#url}/storage/v1/object/fiscal-documents/${encodeStoragePath(storagePath)}`, {
      method: 'GET', headers: this.#headers(), redirect: 'error',
    });
    if (!response.ok) return false;
    const contents = new Uint8Array(await response.arrayBuffer());
    return createHash('sha256').update(contents).digest('hex') === expectedSha256;
  }

  #headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.#serviceRole, authorization: `Bearer ${this.#serviceRole}`, ...extra };
  }
}

function rowToRequest(row: Record<string, unknown>, associated?: { documentType: number; pointOfSale: number; documentNumber: number; issueDate?: string }): FiscalRequest {
  const items = asRows(row.fiscal_document_items);
  const issueDate = String(row.issue_date || dateInArgentina(new Date())).replace(/-/g, '');
  const documentIntent = String(row.document_intent) === 'credit_note' ? 'credit_note' : 'invoice';
  const request: FiscalRequest = {
    cuit: String(row.cuit || ''),
    pointOfSale: numberValue(row.point_of_sale),
    documentType: numberValue(row.document_type),
    concept: numberValue(row.concept, 1) as 1 | 2 | 3,
    recipientDocumentType: numberValue(row.recipient_document_type),
    recipientDocumentNumber: String(row.recipient_document_number || ''),
    documentNumber: numberValue(row.document_number),
    issueDate,
    totalAmount: numberValue(row.total_amount),
    netAmount: numberValue(row.net_amount),
    vatAmount: numberValue(row.tax_amount),
    exemptAmount: numberValue(row.exempt_amount),
    nonTaxedAmount: numberValue(row.non_taxed_amount),
    otherTaxesAmount: numberValue(row.other_taxes_amount),
    currencyCode: String(row.currency || 'PES'),
    currencyRate: numberValue(row.currency_rate, 1),
    vatItems: items.filter((item) => item.tax_code != null).map((item) => ({
      id: numberValue(item.tax_code), baseAmount: numberValue(item.net_amount), amount: numberValue(item.tax_amount),
    })),
    documentIntent,
    ...(associated ? { associatedDocument: { ...associated, ...(associated.issueDate ? { issueDate: associated.issueDate.replace(/-/g, '') } : {}) } } : {}),
  };
  return request;
}

function toDatabaseResult(result: ArcaResult & Record<string, unknown>): Record<string, unknown> {
  return {
    classification: result.classification,
    document_number: result.documentNumber,
    cae: result.cae,
    cae_expiration: result.caeExpiration,
    issue_date: databaseDate(result.issueDate),
    observations: result.observations,
    errors: result.errors,
    request_hash: result.requestHash,
    response_hash: result.responseHash,
    error_code: result.errorCode,
    error_message: result.errorMessage,
    request_id: result.request_id,
    operation: result.operation,
    duration_ms: result.duration_ms,
  };
}

function databaseDate(value: unknown): string | undefined {
  const compact = String(value || '');
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(compact);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : compact || undefined;
}

function associatedFromRow(row: Record<string, unknown>): { documentType: number; pointOfSale: number; documentNumber: number; issueDate?: string } | undefined {
  const documentType = numberValue(row.document_type);
  const pointOfSale = numberValue(row.point_of_sale);
  const documentNumber = numberValue(row.document_number);
  if (documentType < 1 || pointOfSale < 1 || documentNumber < 1) return undefined;
  const issueDate = normalizeDate(row.issue_date);
  return { documentType, pointOfSale, documentNumber, ...(issueDate ? { issueDate } : {}) };
}

function associatedFromSnapshot(value: Record<string, unknown>): { documentType: number; pointOfSale: number; documentNumber: number; issueDate?: string } | undefined {
  return associatedFromRow({
    document_type: value.document_type,
    point_of_sale: value.point_of_sale,
    document_number: value.document_number,
    issue_date: value.issue_date,
  });
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  return value && typeof value === 'object' ? [value as Record<string, unknown>] : [];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown, fallback = 0): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function numberOrNull(value: unknown): number | null {
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

function normalizeDate(value: unknown): string {
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 300)) : [];
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function encodeStoragePath(value: string): string {
  return value.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function dateInArgentina(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
