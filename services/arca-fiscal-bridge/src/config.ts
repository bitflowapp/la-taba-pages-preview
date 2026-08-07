import fs from 'node:fs';
import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import path from 'node:path';
import type { ArcaConfig, ArcaEndpoints, ArcaEnvironment } from './types.js';
import { assertValidCuit } from './cuit.js';

export const OFFICIAL_ENDPOINTS: Readonly<Record<Exclude<ArcaEnvironment, 'disabled'>, ArcaEndpoints>> = Object.freeze({
  homologation: Object.freeze({
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  }),
  production: Object.freeze({
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  }),
});

const HOMOLOGATION_PHRASE = 'I_UNDERSTAND_THIS_USES_ARCA_HOMOLOGATION';
const PRODUCTION_PHRASE = 'I_UNDERSTAND_THIS_USES_ARCA_PRODUCTION';

export function loadArcaConfig(env: NodeJS.ProcessEnv = process.env): ArcaConfig {
  const environment = normalizeEnvironment(env.ARCA_ENVIRONMENT);
  const cuit = String(env.ARCA_CUIT || '').replace(/\D/g, '');
  const certificatePath = environment === 'disabled' ? optionalSecretPath(env.ARCA_CERTIFICATE_PATH) : absoluteSecretPath(env.ARCA_CERTIFICATE_PATH, 'ARCA_CERTIFICATE_PATH');
  const privateKeyPath = environment === 'disabled' ? optionalSecretPath(env.ARCA_PRIVATE_KEY_PATH) : absoluteSecretPath(env.ARCA_PRIVATE_KEY_PATH, 'ARCA_PRIVATE_KEY_PATH');
  if (environment !== 'disabled') assertValidCuit(cuit, 'ARCA_CUIT');
  const endpoints = environment === 'production' ? OFFICIAL_ENDPOINTS.production : OFFICIAL_ENDPOINTS.homologation;
  assertOfficialEndpoint(endpoints.wsaa);
  assertOfficialEndpoint(endpoints.wsfe);
  const healthPort = Number(env.FISCAL_HEALTH_PORT || 8787);
  if (!Number.isSafeInteger(healthPort) || healthPort < 1024 || healthPort > 65535) throw new Error('FISCAL_HEALTH_PORT inválido.');
  const workerId = String(env.FISCAL_WORKER_ID || 'taba-fiscal-worker').trim();
  if (!/^[A-Za-z0-9._-]{3,80}$/.test(workerId)) throw new Error('FISCAL_WORKER_ID inválido.');
  const businessId = String(env.FISCAL_BUSINESS_ID || '').trim();
  if (environment !== 'disabled' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId)) {
    throw new Error('FISCAL_BUSINESS_ID debe ser el UUID del negocio que el puente atiende.');
  }
  // El ticket de acceso sobrevive al reinicio del proceso. WSAA retiene el TA
  // vigente y rechaza pedidos repetidos dentro de una ventana (10 minutos en
  // homologación según el manual del desarrollador), así que perder la caché en
  // memoria dejaba al worker bloqueado hasta que venciera esa ventana.
  const ticketStatePath = environment === 'disabled'
    ? optionalSecretPath(env.ARCA_TICKET_STATE_PATH)
    : absoluteSecretPath(env.ARCA_TICKET_STATE_PATH, 'ARCA_TICKET_STATE_PATH');
  const maxClockSkewSeconds = Number(env.ARCA_MAX_CLOCK_SKEW_SECONDS || 300);
  if (!Number.isSafeInteger(maxClockSkewSeconds) || maxClockSkewSeconds < 30 || maxClockSkewSeconds > 3600) {
    throw new Error('ARCA_MAX_CLOCK_SKEW_SECONDS inválido.');
  }
  return Object.freeze({
    businessId,
    ticketStatePath,
    maxClockSkewSeconds,
    environment,
    cuit,
    certificatePath,
    privateKeyPath,
    workerId,
    healthPort,
    endpoints,
    homologationConsent: env.ARCA_HOMOLOGATION_CONSENT === HOMOLOGATION_PHRASE,
    productionEnabled: environment === 'production' && env.ARCA_PRODUCTION_ENABLE === PRODUCTION_PHRASE,
  });
}

export function assertRemoteExecutionAllowed(config: ArcaConfig): void {
  if (config.environment === 'disabled') {
    const error = new Error('ARCA_DISABLED');
    Object.assign(error, { code: 'ARCA_DISABLED' });
    throw error;
  }
  if (config.environment === 'homologation' && !config.homologationConsent) {
    const error = new Error('ARCA_HOMOLOGATION_BLOCKED');
    Object.assign(error, { code: 'ARCA_HOMOLOGATION_BLOCKED' });
    throw error;
  }
  if (config.environment === 'production' && !config.productionEnabled) {
    const error = new Error('ARCA_PRODUCTION_DISABLED_BY_DESIGN');
    Object.assign(error, { code: 'ARCA_PRODUCTION_DISABLED_BY_DESIGN' });
    throw error;
  }
}

export interface ValidatedCredentials {
  certificatePem: string;
  privateKeyPem: string;
  fingerprint256: string;
  expiresAt: string;
  daysRemaining: number;
  expiringSoon: boolean;
}

export function loadAndValidateCredentials(config: ArcaConfig, now = new Date()): ValidatedCredentials {
  const certificatePem = fs.readFileSync(config.certificatePath, 'utf8');
  const privateKeyPem = fs.readFileSync(config.privateKeyPath, 'utf8');
  const certificate = new X509Certificate(certificatePem);
  const validFrom = new Date(certificate.validFrom);
  const validTo = new Date(certificate.validTo);
  if (now < validFrom || now >= validTo) throw new Error('El certificado ARCA está vencido o aún no es válido.');
  const subjectDigits = certificate.subject.replace(/\D/g, '');
  if (!subjectDigits.includes(config.cuit)) throw new Error('El CUIT configurado no coincide con el certificado.');
  const certificateKey = certificate.publicKey.export({ type: 'spki', format: 'der' });
  const privatePublicKey = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'der' });
  if (!certificateKey.equals(privatePublicKey)) throw new Error('La clave privada no corresponde al certificado.');
  const daysRemaining = Math.floor((validTo.getTime() - now.getTime()) / 86_400_000);
  return {
    certificatePem,
    privateKeyPem,
    fingerprint256: certificate.fingerprint256,
    expiresAt: validTo.toISOString(),
    daysRemaining,
    expiringSoon: daysRemaining < 30,
  };
}

export function assertOfficialEndpoint(value: string): void {
  const allowed = new Set(Object.values(OFFICIAL_ENDPOINTS).flatMap((item) => [item.wsaa, item.wsfe]));
  if (!allowed.has(value)) throw new Error('Endpoint ARCA fuera de allowlist.');
}

function normalizeEnvironment(value: string | undefined): ArcaEnvironment {
  const normalized = String(value || 'disabled').trim().toLowerCase();
  if (normalized !== 'disabled' && normalized !== 'homologation' && normalized !== 'production') throw new Error('ARCA_ENVIRONMENT inválido.');
  return normalized;
}

function absoluteSecretPath(value: string | undefined, name: string): string {
  const candidate = String(value || '').trim();
  if (!candidate || /-----BEGIN/.test(candidate) || !path.isAbsolute(candidate)) {
    throw new Error(`${name} debe ser una ruta absoluta a un secreto montado.`);
  }
  return candidate;
}

function optionalSecretPath(value: string | undefined): string {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  return absoluteSecretPath(candidate, 'ruta de secreto');
}
