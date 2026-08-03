import { randomUUID } from 'node:crypto';
import type { ArcaConfig, ArcaResult } from './types.js';
import type { FiscalJob, FiscalStore } from './store.js';
import type { WsaaClient } from './wsaa.js';
import type { WsfeClient } from './wsfe.js';
import { validateFiscalRequest } from './wsfe.js';
import { classifyTransportFailure, reconcileAmbiguousAuthorization } from './reconciliation.js';

export interface FiscalLogger {
  info(event: string, detail: Record<string, unknown>): void;
  warn(event: string, detail: Record<string, unknown>): void;
}

export class FiscalWorker {
  readonly #config: ArcaConfig;
  readonly #store: FiscalStore;
  readonly #wsaa: Pick<WsaaClient, 'login'>;
  readonly #wsfe: Pick<WsfeClient, 'lastAuthorized' | 'authorize' | 'consult'>;
  readonly #logger: FiscalLogger;
  constructor({ config, store, wsaa, wsfe, logger = structuredLogger }: { config: ArcaConfig; store: FiscalStore; wsaa: Pick<WsaaClient, 'login'>; wsfe: Pick<WsfeClient, 'lastAuthorized' | 'authorize' | 'consult'>; logger?: FiscalLogger }) {
    this.#config = config;
    this.#store = store;
    this.#wsaa = wsaa;
    this.#wsfe = wsfe;
    this.#logger = logger;
  }

  async runOnce(limit = 5): Promise<{ claimed: number; completed: number }> {
    const jobs = await this.#store.claim(this.#config.workerId, limit);
    let completed = 0;
    for (const job of jobs) {
      await this.#process(job);
      completed += 1;
    }
    return { claimed: jobs.length, completed };
  }

  async #process(job: FiscalJob): Promise<void> {
    const requestId = randomUUID();
    const startedAt = Date.now();
    let result: ArcaResult;
    let reconciled = false;
    try {
      const loaded = await this.#store.load(job.fiscalDocumentId);
      if (loaded.state === 'authorized' || loaded.state === 'credited') return;
      if (loaded.request.documentType < 1 || loaded.request.recipientDocumentType < 1) {
        throw Object.assign(new Error('Requiere datos fiscales o revisión.'), { code: 'REQUIRES_FISCAL_REVIEW', retryable: false });
      }
      try {
        // Validate every immutable component before reserving a number. A bad
        // local snapshot must dead-letter for review, never consume the next
        // ARCA number and block a later valid document.
        validateFiscalRequest({ ...loaded.request, documentNumber: Math.max(1, loaded.request.documentNumber) }, this.#config.cuit);
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error('Requiere datos fiscales o revisión.'), {
          code: 'REQUIRES_FISCAL_REVIEW', retryable: false,
        });
      }
      const ticket = await this.#wsaa.login('wsfe');
      if (loaded.state === 'ambiguous' || loaded.request.documentNumber > 0) {
        // A persisted number means a previous process may have reached ARCA. Consult
        // first even if the local process died before saving a response.
        reconciled = true;
        result = await reconcileAmbiguousAuthorization({ client: this.#wsfe, ticket, request: loaded.request });
      } else {
        const last = await this.#wsfe.lastAuthorized(ticket, loaded.request.pointOfSale, loaded.request.documentType);
        loaded.request.documentNumber = await this.#store.reserveNumber(job.fiscalDocumentId, this.#config.workerId, last + 1);
        validateFiscalRequest(loaded.request, this.#config.cuit);
        try {
          result = await this.#wsfe.authorize(ticket, loaded.request);
        } catch (error) {
          result = classifyTransportFailure(error, loaded.request.documentNumber);
          if (result.classification === 'ambiguous') {
            reconciled = true;
            result = await reconcileAmbiguousAuthorization({ client: this.#wsfe, ticket, request: loaded.request });
          }
        }
      }
      if (['authorized', 'authorized_with_observations'].includes(result.classification) && !result.issueDate) {
        result = { ...result, issueDate: loaded.request.issueDate };
      }
    } catch (error) {
      result = classifyTransportFailure(error);
    }
    const enriched = {
      ...result,
      request_id: requestId,
      operation: reconciled ? 'FECompConsultar' : 'FECAESolicitar',
      duration_ms: Date.now() - startedAt,
    };
    await this.#store.complete(job.outboxId, this.#config.workerId, enriched);
    const log = { requestId, outboxId: job.outboxId, fiscalDocumentId: job.fiscalDocumentId, classification: result.classification, durationMs: enriched.duration_ms };
    if (['authorized', 'authorized_with_observations'].includes(result.classification)) this.#logger.info('fiscal_attempt_completed', log);
    else this.#logger.warn('fiscal_attempt_completed', log);
  }
}

export const structuredLogger: FiscalLogger = Object.freeze({
  info(event: string, detail: Record<string, unknown>) { process.stdout.write(`${JSON.stringify({ level: 'info', event, ...sanitize(detail), at: new Date().toISOString() })}\n`); },
  warn(event: string, detail: Record<string, unknown>) { process.stderr.write(`${JSON.stringify({ level: 'warn', event, ...sanitize(detail), at: new Date().toISOString() })}\n`); },
});

function sanitize(detail: Record<string, unknown>): Record<string, unknown> {
  const blocked = /token|sign|secret|password|certificate|private.?key|service.?role|recipient/i;
  return Object.fromEntries(Object.entries(detail).filter(([key]) => !blocked.test(key)).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 160) : value]));
}
