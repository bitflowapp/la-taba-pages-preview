// Certificación contra la HOMOLOGACIÓN oficial de ARCA.
//
//   node dist/src/homologation-certification.js --case ./caso.json --out ./evidencia.json
//   node dist/src/homologation-certification.js --case ./caso.json --emit --out ./evidencia.json
//
// Sin --emit recorre sólo operaciones de lectura: FEDummy, las tablas oficiales
// y el último autorizado. Con --emit solicita un CAE real de homologación y lo
// vuelve a consultar por número.
//
// El caso fiscal se declara COMPLETO en un archivo JSON. Esta herramienta no
// tiene valores por omisión para tipo de comprobante, punto de venta, concepto,
// condición frente al IVA, alícuotas ni importes: si falta uno, se detiene. La
// evidencia que escribe está saneada: nunca token, sign, PEM ni XML crudo.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertRemoteExecutionAllowed, loadAndValidateCredentials, loadArcaConfig } from './config.js';
import { WsaaClient } from './wsaa.js';
import { WsfeClient } from './wsfe.js';
import { FileTicketStore, MemoryTicketStore } from './ticket-store.js';
import { REQUIRED_PARAMETER_TYPES } from './parameters.js';
import type { ArcaResult, FiscalRequest } from './types.js';

const REQUIRED_CASE_FIELDS = [
  'pointOfSale', 'documentType', 'concept', 'recipientDocumentType', 'recipientDocumentNumber',
  'recipientVatConditionId', 'issueDate', 'currencyCode', 'currencyRate',
  'totalAmount', 'netAmount', 'vatAmount', 'exemptAmount', 'nonTaxedAmount', 'otherTaxesAmount', 'vatItems',
] as const;

export interface CertificationStep {
  step: string;
  ok: boolean;
  detail: Record<string, unknown>;
}

export function readFiscalCase(file: string): Omit<FiscalRequest, 'cuit' | 'documentNumber'> {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('El caso fiscal debe ser un objeto JSON.');
  const value = parsed as Record<string, unknown>;
  const missing = REQUIRED_CASE_FIELDS.filter((field) => value[field] === undefined || value[field] === null);
  if (missing.length) {
    throw new Error(`El caso fiscal está incompleto y esta herramienta no inventa nada. Faltan: ${missing.join(', ')}.`);
  }
  if (!Array.isArray(value.vatItems)) throw new Error('vatItems debe ser una lista, aunque esté vacía.');
  return value as unknown as Omit<FiscalRequest, 'cuit' | 'documentNumber'>;
}

export function sanitizeArcaResult(result: ArcaResult): Record<string, unknown> {
  return {
    classification: result.classification,
    documentNumber: result.documentNumber,
    cae: result.cae,
    caeExpiration: result.caeExpiration,
    issueDate: result.issueDate,
    observations: result.observations.map((item) => ({ code: item.code, message: item.message.slice(0, 200) })),
    errors: result.errors.map((item) => ({ code: item.code, message: item.message.slice(0, 200) })),
    requestHash: result.requestHash,
    responseHash: result.responseHash,
  };
}

export async function runHomologationCertification({
  casePath,
  emit = false,
  now = new Date(),
  env = process.env,
  // Inyectable sólo para que la propia herramienta tenga prueba automática
  // contra la ARCA simulada. En la corrida real es el fetch del proceso, y los
  // endpoints siguen restringidos por la allowlist oficial compilada.
  fetchImpl = fetch,
}: { casePath: string; emit?: boolean; now?: Date; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch }): Promise<{ ok: boolean; steps: CertificationStep[]; evidence: Record<string, unknown> }> {
  const steps: CertificationStep[] = [];
  const record = (step: string, ok: boolean, detail: Record<string, unknown> = {}) => {
    steps.push({ step, ok, detail });
    return ok;
  };

  const config = loadArcaConfig(env);
  if (config.environment !== 'homologation') {
    throw new Error('Esta certificación corre únicamente contra homologación. Producción tiene su propio expediente.');
  }
  // Falla cerrado si falta la frase de consentimiento: la autorización humana no
  // se deduce de haber configurado el ambiente.
  assertRemoteExecutionAllowed(config);
  const credentials = loadAndValidateCredentials(config, now);
  record('credenciales', true, {
    fingerprint256: credentials.fingerprint256,
    expiresAt: credentials.expiresAt,
    daysRemaining: credentials.daysRemaining,
    expiringSoon: credentials.expiringSoon,
  });

  const fiscalCase = readFiscalCase(casePath);
  const ticketStore = config.ticketStatePath ? new FileTicketStore(config.ticketStatePath) : new MemoryTicketStore();
  let clockSkewSeconds = 0;
  const wsaa = new WsaaClient(config, credentials, fetchImpl, ticketStore, {
    onClockSkew: (detail) => { clockSkewSeconds = detail.skewSeconds; },
  });
  const wsfe = new WsfeClient(config, fetchImpl);

  const dummy = await wsfe.dummy();
  record('FEDummy', dummy.appServer === 'OK' && dummy.dbServer === 'OK' && dummy.authServer === 'OK', { ...dummy });

  const ticket = await wsaa.login('wsfe', now);
  record('WSAA', Boolean(ticket.token && ticket.sign), {
    // Ni el token ni la firma se escriben nunca: sólo su vigencia.
    expirationTime: ticket.expirationTime,
    service: ticket.service,
    clockSkewSeconds,
  });

  const parameters: Record<string, string> = {};
  for (const parameterType of REQUIRED_PARAMETER_TYPES) {
    const snapshot = await wsfe.getParameters(ticket, parameterType, now);
    parameters[parameterType] = snapshot.responseHash;
  }
  record('tablas oficiales', Object.keys(parameters).length === REQUIRED_PARAMETER_TYPES.length, { versions: parameters });

  const lastAuthorized = await wsfe.lastAuthorized(ticket, fiscalCase.pointOfSale, fiscalCase.documentType);
  record('FECompUltimoAutorizado', true, {
    pointOfSale: fiscalCase.pointOfSale,
    documentType: fiscalCase.documentType,
    lastAuthorized,
  });

  let authorization: Record<string, unknown> | null = null;
  let consultation: Record<string, unknown> | null = null;
  if (emit) {
    const request: FiscalRequest = { ...fiscalCase, cuit: config.cuit, documentNumber: lastAuthorized + 1 };
    const result = await wsfe.authorize(ticket, request);
    authorization = sanitizeArcaResult(result);
    record('FECAESolicitar', ['authorized', 'authorized_with_observations'].includes(result.classification), authorization);
    // Consultar el comprobante recién emitido es la prueba de que existe del
    // lado de ARCA y no sólo en la respuesta que recibimos.
    const consulted = await wsfe.consult(ticket, {
      cuit: config.cuit,
      pointOfSale: request.pointOfSale,
      documentType: request.documentType,
      documentNumber: request.documentNumber,
    });
    consultation = consulted ? sanitizeArcaResult(consulted) : { classification: 'not_found' };
    record('FECompConsultar', Boolean(consulted && consulted.cae && consulted.cae === result.cae), consultation);
  }

  const evidence = {
    declaration: 'TABA2_ARCA_HOMOLOGATION_EVIDENCE',
    environment: config.environment,
    endpoints: config.endpoints,
    cuit: config.cuit,
    generatedAt: now.toISOString(),
    emitted: emit,
    clockSkewSeconds,
    certificate: { fingerprint256: credentials.fingerprint256, expiresAt: credentials.expiresAt },
    parameterVersions: parameters,
    lastAuthorizedBefore: lastAuthorized,
    authorization,
    consultation,
    steps,
    note: 'Homologación no tiene validez fiscal. Ningún comprobante de este archivo es real.',
  };
  return { ok: steps.every((item) => item.ok), steps, evidence };
}

function argumentValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const casePath = argumentValue('--case');
  const outPath = argumentValue('--out');
  if (!casePath) {
    process.stderr.write('Falta --case con el archivo del caso fiscal declarado.\n');
    process.exitCode = 2;
  } else {
    runHomologationCertification({ casePath: path.resolve(casePath), emit: process.argv.includes('--emit') })
      .then((result) => {
        const serialized = `${JSON.stringify(result.evidence, null, 2)}\n`;
        if (outPath) fs.writeFileSync(path.resolve(outPath), serialized, { encoding: 'utf8', mode: 0o600 });
        process.stdout.write(serialized);
        process.exitCode = result.ok ? 0 : 1;
      })
      .catch((error) => {
        process.stderr.write(`${JSON.stringify({ ok: false, code: (error as { code?: string })?.code || 'CERTIFICATION_FAILED', message: String((error as Error)?.message || '').slice(0, 300) })}\n`);
        process.exitCode = 1;
      });
  }
}
