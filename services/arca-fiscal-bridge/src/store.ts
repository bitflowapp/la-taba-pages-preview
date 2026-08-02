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

export interface FiscalStore {
  claim(workerId: string, limit?: number): Promise<FiscalJob[]>;
  load(documentId: string): Promise<LoadedFiscalDocument>;
  reserveNumber(documentId: string, workerId: string, expectedNumber: number): Promise<number>;
  complete(outboxId: string, workerId: string, result: ArcaResult & Record<string, unknown>): Promise<void>;
  saveParameterSnapshot(snapshot: FiscalParameterSnapshot): Promise<void>;
}

export function loadPrivateStoreConfig(env: NodeJS.ProcessEnv = process.env): { url: string; serviceRole: string } {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const keyPath = String(env.SUPABASE_SERVICE_ROLE_PATH || '').trim();
  if (!/^https:\/\/[a-z0-9-]+[.]supabase[.]co$/i.test(url)) throw new Error('SUPABASE_URL privado inválido.');
  if (!path.isAbsolute(keyPath) || /-----BEGIN/.test(keyPath)) throw new Error('SUPABASE_SERVICE_ROLE_PATH debe ser una ruta absoluta montada.');
  const serviceRole = fs.readFileSync(keyPath, 'utf8').trim();
  if (serviceRole.length < 32 || /\s/.test(serviceRole)) throw new Error('Service role inválido.');
  return { url, serviceRole };
}

export class SupabaseFiscalStore implements FiscalStore {
  readonly #url: string;
  readonly #serviceRole: string;
  readonly #fetchImpl: typeof fetch;
  constructor(config: { url: string; serviceRole: string }, fetchImpl: typeof fetch = fetch) {
    this.#url = config.url;
    this.#serviceRole = config.serviceRole;
    this.#fetchImpl = fetchImpl;
  }

  async claim(workerId: string, limit = 5): Promise<FiscalJob[]> {
    const rows = await this.#rpc('claim_fiscal_outbox', { p_worker_id: workerId, p_limit: limit, p_lease_seconds: 90 });
    return asRows(rows).map((row) => ({
      outboxId: String(row.id),
      fiscalDocumentId: String(row.fiscal_document_id),
      attemptCount: Number(row.attempt_count || 0),
    }));
  }

  async load(documentId: string): Promise<LoadedFiscalDocument> {
    const query = new URLSearchParams({ select: '*,fiscal_document_items(*)', id: `eq.${documentId}` });
    const rows = await this.#request(`/rest/v1/fiscal_documents?${query}`);
    const row = asRows(rows)[0];
    if (!row) throw Object.assign(new Error('Documento fiscal inexistente.'), { code: 'NOT_FOUND' });
    const request = rowToRequest(row);
    return { request, state: String(row.state || '') };
  }

  async reserveNumber(documentId: string, workerId: string, expectedNumber: number): Promise<number> {
    const row = await this.#rpc('reserve_fiscal_document_number', {
      p_document_id: documentId,
      p_worker_id: workerId,
      p_expected_number: expectedNumber,
    });
    const result = Array.isArray(row) ? row[0] : row;
    const value = Number((result as Record<string, unknown> | undefined)?.document_number);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('La reserva fiscal no devolvió un número válido.');
    return value;
  }

  async complete(outboxId: string, workerId: string, result: ArcaResult & Record<string, unknown>): Promise<void> {
    await this.#rpc('complete_fiscal_attempt', {
      p_outbox_id: outboxId,
      p_worker_id: workerId,
      p_result: toDatabaseResult(result),
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
      },
      redirect: 'error',
    });
    const text = await response.text();
    if (!response.ok) {
      let message = `PostgreSQL respondió ${response.status}.`;
      try { message = String((JSON.parse(text) as { message?: string }).message || message); } catch { /* sanitized fallback */ }
      throw Object.assign(new Error(message.slice(0, 300)), { code: response.status >= 500 ? 'DATABASE_UNAVAILABLE' : 'DATABASE_ERROR', retryable: response.status >= 500 });
    }
    return text ? JSON.parse(text) : null;
  }
}

function rowToRequest(row: Record<string, unknown>): FiscalRequest {
  const items = asRows(row.fiscal_document_items);
  const issueDate = String(row.issue_date || dateInArgentina(new Date())).replace(/-/g, '');
  const request: FiscalRequest = {
    cuit: String(row.cuit || ''),
    pointOfSale: Number(row.point_of_sale || 0),
    documentType: Number(row.document_type || 0),
    concept: Number(row.concept || 1) as 1 | 2 | 3,
    recipientDocumentType: Number(row.recipient_document_type || 0),
    recipientDocumentNumber: String(row.recipient_document_number || '0'),
    documentNumber: Number(row.document_number || 0),
    issueDate,
    totalAmount: Number(row.total_amount || 0),
    netAmount: Number(row.net_amount || 0),
    vatAmount: Number(row.tax_amount || 0),
    exemptAmount: Number(row.exempt_amount || 0),
    nonTaxedAmount: Number(row.non_taxed_amount || 0),
    otherTaxesAmount: Number(row.other_taxes_amount || 0),
    currencyCode: String(row.currency || 'PES'),
    currencyRate: Number(row.currency_rate || 1),
    vatItems: items.filter((item) => item.tax_code != null).map((item) => ({
      id: Number(item.tax_code),
      baseAmount: Number(item.net_amount || 0),
      amount: Number(item.tax_amount || 0),
    })),
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

function asRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  return value && typeof value === 'object' ? [value as Record<string, unknown>] : [];
}

function dateInArgentina(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
