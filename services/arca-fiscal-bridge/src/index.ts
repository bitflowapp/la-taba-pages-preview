import { pathToFileURL } from 'node:url';
import { loadAndValidateCredentials, loadArcaConfig } from './config.js';
import { loadPrivateStoreConfig, SupabaseFiscalStore, SupabasePrivateArtifactStorage } from './store.js';
import { FiscalArtifactWorker } from './artifact-worker.js';
import { WsaaClient } from './wsaa.js';
import { WsfeClient } from './wsfe.js';
import { FiscalWorker, structuredLogger } from './worker.js';
import { startHealthServer } from './health.js';
import { syncOfficialParameterTables } from './parameters.js';
import { FileTicketStore } from './ticket-store.js';

export * from './config.js';
export * from './create-csr.js';
export * from './artifact-worker.js';
export * from './health.js';
export * from './pdf.js';
export * from './homologation-certification.js';
export * from './parameters.js';
export * from './qr.js';
export * from './reconciliation.js';
export * from './simulated-arca.js';
export * from './store.js';
export * from './ticket-store.js';
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
  const privateStoreConfig = loadPrivateStoreConfig();
  const store = new SupabaseFiscalStore(privateStoreConfig);
  const artifactStorage = new SupabasePrivateArtifactStorage(privateStoreConfig);
  databaseReady = true;
  const ticketStore = new FileTicketStore(config.ticketStatePath);
  let clockSkewSeconds = 0;
  const wsaa = new WsaaClient(config, credentials, fetch, ticketStore, {
    onClockSkew: (detail) => {
      clockSkewSeconds = detail.skewSeconds;
      structuredLogger.warn('arca_clock_skew', detail);
    },
  });
  const wsfe = new WsfeClient(config);

  // El puente es el único que ve el certificado, así que es el único que puede
  // decirle al Panel si existe y hasta cuándo sirve. Sin esta publicación,
  // certificate_fingerprint_sha256 quedaba NULL y el botón "Habilitar pruebas
  // con ARCA" no podía habilitarse nunca. Nunca viaja la clave privada ni el PEM.
  const publishHealth = (connectionOk: boolean, errorCode: string | null) => store.publishCredentialHealth({
    businessId: config.businessId,
    fingerprint256: credentials.fingerprint256.replace(/:/g, '').toLowerCase(),
    expiresAt: credentials.expiresAt,
    subjectCuit: config.cuit,
    delegationStatus: connectionOk ? 'verified' : null,
    connectionOk,
    errorCode,
  }).catch((error) => structuredLogger.warn('fiscal_credential_health_failed', {
    code: (error as { code?: string })?.code || 'CREDENTIAL_HEALTH_ERROR',
  }));

  const syncParameters = () => syncOfficialParameterTables({
    login: () => wsaa.login('wsfe'),
    getParameters: (ticket, type) => wsfe.getParameters(ticket, type),
    save: (snapshot) => store.saveParameterSnapshot(snapshot),
  });
  await publishHealth(false, null);
  try {
    // FEDummy es la prueba de conectividad que ARCA publica para eso mismo: se
    // ejecuta antes de declarar la delegación verificada.
    await wsfe.dummy();
    await syncParameters();
    await publishHealth(true, null);
  } catch (error) {
    const code = String((error as { code?: string })?.code || 'ARCA_UNREACHABLE');
    await publishHealth(false, /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : 'ARCA_UNREACHABLE');
    throw error;
  }
  const worker = new FiscalWorker({
    config,
    store,
    wsaa,
    wsfe,
  });
  const artifactWorker = new FiscalArtifactWorker({
    workerId: config.workerId,
    store,
    storage: artifactStorage,
    logger: structuredLogger,
  });
  const metrics = { cycles: 0, promoted: 0, manualReview: 0, claimed: 0, completed: 0, settled: 0, artifactClaimed: 0, artifactCompleted: 0, errors: 0 };
  const server = startHealthServer(config, () => ({
    credentials: credentialsReady,
    database: databaseReady,
    clockSkewSeconds,
    metrics: { ...metrics },
  }));
  structuredLogger.info('fiscal_worker_started', { environment: config.environment, workerId: config.workerId, port: config.healthPort });
  const tick = async () => {
    metrics.cycles += 1;
    try {
      // Primero las intenciones: un pedido pagado hace un rato tiene que estar
      // encolado antes de que el ciclo hable con ARCA.
      const intents = await store.promoteIntents(config.workerId);
      metrics.promoted += intents.promoted;
      metrics.manualReview += intents.manualReview;
      const result = await worker.runOnce();
      metrics.claimed += result.claimed;
      metrics.completed += result.completed;
      metrics.settled += result.settled;
      const artifacts = await artifactWorker.runOnce();
      metrics.artifactClaimed += artifacts.claimed;
      metrics.artifactCompleted += artifacts.completed;
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
