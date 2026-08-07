// Sonda de conectividad contra la HOMOLOGACIÓN oficial de ARCA.
//
//   node dist/src/probe-homologation.js
//   node dist/src/probe-homologation.js --wsaa   (además intenta autenticar)
//
// `FEDummy` es el método que ARCA publica para verificar disponibilidad y, según
// el WSDL vigente, es el único de WSFEv1 que NO lleva `Auth`: se puede ejecutar
// antes de tener certificado. Sirve para separar dos problemas que se confunden
// todo el tiempo: "no llego a ARCA" y "ARCA no me autoriza".
//
// Con --wsaa se intenta además un `loginCms` con las credenciales configuradas.
// Si el certificado no es de ARCA, WSAA responde un SOAP Fault: eso es esperado
// y es justamente lo que valida que el puente distinga un fault de una caída.
//
// Esta sonda NO es la certificación fiscal. No emite comprobantes, no consulta
// padrones y no toca producción.

import { pathToFileURL } from 'node:url';
import { assertRemoteExecutionAllowed, loadAndValidateCredentials, loadArcaConfig } from './config.js';
import { WsfeClient } from './wsfe.js';
import { WsaaClient } from './wsaa.js';
import { MemoryTicketStore } from './ticket-store.js';
import type { ArcaConfig } from './types.js';

export interface ProbeResult {
  environment: string;
  endpoints: { wsaa: string; wsfe: string };
  checkedAt: string;
  dummy: { ok: boolean; appServer: string; dbServer: string; authServer: string } | { ok: false; code: string; message: string };
  wsaa?: { ok: boolean; code: string; message: string; clockSkewSeconds: number };
}

export async function probeHomologation({
  env = process.env,
  now = new Date(),
  fetchImpl = fetch,
  includeWsaa = false,
}: { env?: NodeJS.ProcessEnv; now?: Date; fetchImpl?: typeof fetch; includeWsaa?: boolean } = {}): Promise<ProbeResult> {
  const config: ArcaConfig = loadArcaConfig(env);
  if (config.environment !== 'homologation') {
    throw new Error('La sonda corre únicamente contra homologación.');
  }
  assertRemoteExecutionAllowed(config);

  const wsfe = new WsfeClient(config, fetchImpl);
  const result: ProbeResult = {
    environment: config.environment,
    endpoints: config.endpoints,
    checkedAt: now.toISOString(),
    dummy: { ok: false, code: 'NOT_RUN', message: '' },
  };
  try {
    const dummy = await wsfe.dummy();
    result.dummy = {
      ok: dummy.appServer === 'OK' && dummy.dbServer === 'OK' && dummy.authServer === 'OK',
      ...dummy,
    };
  } catch (error) {
    result.dummy = {
      ok: false,
      code: String((error as { code?: string })?.code || 'ARCA_UNREACHABLE'),
      message: String((error as Error)?.message || '').slice(0, 200),
    };
  }

  if (includeWsaa) {
    let clockSkewSeconds = 0;
    const wsaa = new WsaaClient(config, loadAndValidateCredentials(config, now), fetchImpl, new MemoryTicketStore(), {
      onClockSkew: (detail) => { clockSkewSeconds = detail.skewSeconds; },
    });
    try {
      const ticket = await wsaa.login('wsfe', now);
      // El token y la firma no se imprimen jamás, ni siquiera en una sonda.
      result.wsaa = { ok: Boolean(ticket.token), code: 'TA_GRANTED', message: `vence ${ticket.expirationTime}`, clockSkewSeconds };
    } catch (error) {
      result.wsaa = {
        ok: false,
        code: String((error as { code?: string })?.code || 'WSAA_ERROR'),
        message: String((error as Error)?.message || '').slice(0, 200),
        clockSkewSeconds,
      };
    }
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  probeHomologation({ includeWsaa: process.argv.includes('--wsaa') })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result.dummy.ok ? 0 : 1;
    })
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({ ok: false, code: (error as { code?: string })?.code || 'PROBE_FAILED', message: String((error as Error)?.message || '').slice(0, 200) })}\n`);
      process.exitCode = 1;
    });
}
