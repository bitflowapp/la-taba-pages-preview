import http, { type Server } from 'node:http';
import type { ArcaConfig } from './types.js';

export interface HealthSnapshot {
  database: boolean;
  credentials: boolean;
  metrics?: { cycles: number; claimed: number; completed: number; errors: number };
}

export function startHealthServer(config: ArcaConfig, readiness: () => HealthSnapshot): Server {
  let requestWindow = Date.now();
  let requestCount = 0;
  return http.createServer((request, response) => {
    if (Date.now() - requestWindow >= 60_000) { requestWindow = Date.now(); requestCount = 0; }
    requestCount += 1;
    if (requestCount > 120) {
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
      response.end(JSON.stringify({ error: 'rate_limited' }));
      return;
    }
    if (request.method !== 'GET' || !['/health', '/ready'].includes(request.url || '')) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    const ready = readiness();
    const remoteExecutionEnabled = config.environment === 'homologation'
      ? config.homologationConsent
      : config.environment === 'production' && config.productionEnabled;
    const isReady = ready.database && ready.credentials && remoteExecutionEnabled;
    const body = {
      service: 'taba-arca-fiscal-bridge',
      version: '0.1.0',
      environment: config.environment,
      status: request.url === '/health' ? 'up' : isReady ? 'ready' : 'blocked',
      database: ready.database,
      credentials: ready.credentials,
      remoteExecutionEnabled,
      ...(ready.metrics ? { metrics: ready.metrics } : {}),
    };
    response.writeHead(request.url === '/ready' && !isReady ? 503 : 200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(JSON.stringify(body));
  }).listen(config.healthPort, '127.0.0.1');
}
