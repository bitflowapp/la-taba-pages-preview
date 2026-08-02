import { pathToFileURL } from 'node:url';
import { loadAndValidateCredentials, loadArcaConfig } from './config.js';
import { loadPrivateStoreConfig, SupabaseFiscalStore } from './store.js';
import { WsaaClient } from './wsaa.js';
import { WsfeClient } from './wsfe.js';
import { FiscalWorker, structuredLogger } from './worker.js';
import { startHealthServer } from './health.js';
import { syncOfficialParameterTables } from './parameters.js';

export * from './config.js';
export * from './health.js';
export * from './pdf.js';
export * from './parameters.js';
export * from './qr.js';
export * from './reconciliation.js';
export * from './store.js';
export * from './types.js';
export * from './worker.js';
export * from './wsaa.js';
export * from './wsfe.js';

export async function startFiscalBridge(): Promise<void> {
  const config = loadArcaConfig();
  let credentialsReady = false;
  let databaseReady = false;
  if (config.environment === 'disabled') {
    const server = startHealthServer(config, () => ({ credentials: false, database: false }));
    installShutdown(server);
    structuredLogger.info('fiscal_worker_disabled', { environment: config.environment, workerId: config.workerId, port: config.healthPort });
    return;
  }
  const credentials = loadAndValidateCredentials(config);
  credentialsReady = true;
  if (credentials.expiringSoon) structuredLogger.warn('arca_certificate_expiring', { expiresAt: credentials.expiresAt, daysRemaining: credentials.daysRemaining });
  const store = new SupabaseFiscalStore(loadPrivateStoreConfig());
  databaseReady = true;
  const wsaa = new WsaaClient(config, credentials);
  const wsfe = new WsfeClient(config);
  const syncParameters = () => syncOfficialParameterTables({
    login: () => wsaa.login('wsfe'),
    getParameters: (ticket, type) => wsfe.getParameters(ticket, type),
    save: (snapshot) => store.saveParameterSnapshot(snapshot),
  });
  await syncParameters();
  const worker = new FiscalWorker({
    config,
    store,
    wsaa,
    wsfe,
  });
  const metrics = { cycles: 0, claimed: 0, completed: 0, errors: 0 };
  const server = startHealthServer(config, () => ({ credentials: credentialsReady, database: databaseReady, metrics: { ...metrics } }));
  structuredLogger.info('fiscal_worker_started', { environment: config.environment, workerId: config.workerId, port: config.healthPort });
  const tick = async () => {
    metrics.cycles += 1;
    try {
      const result = await worker.runOnce();
      metrics.claimed += result.claimed;
      metrics.completed += result.completed;
    }
    catch (error) {
      metrics.errors += 1;
      structuredLogger.warn('fiscal_worker_cycle_failed', { code: (error as { code?: string }).code || 'WORKER_ERROR', message: (error as Error).message });
    }
  };
  await tick();
  const timer = setInterval(() => { void tick(); }, 5_000);
  const parameterTimer = setInterval(() => {
    void syncParameters().catch((error) => structuredLogger.warn('fiscal_parameter_sync_failed', { code: error?.code || 'PARAMETER_SYNC_ERROR', message: error?.message || 'No se pudieron sincronizar parámetros.' }));
  }, 6 * 60 * 60_000);
  installShutdown(server, [timer, parameterTimer]);
}

function installShutdown(server: import('node:http').Server, timers: NodeJS.Timeout[] = []): void {
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    for (const timer of timers) clearInterval(timer);
    server.close(() => { process.exitCode = 0; });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFiscalBridge().catch((error) => {
    structuredLogger.warn('fiscal_worker_start_failed', { code: error?.code || 'START_FAILED', message: error?.message || 'No se pudo iniciar.' });
    process.exitCode = 1;
  });
}
