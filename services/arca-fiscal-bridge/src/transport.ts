import { createHash } from 'node:crypto';
import { assertOfficialEndpoint } from './config.js';

export interface SoapResponse {
  body: string;
  status: number;
  requestHash: string;
  responseHash: string;
  // Hora declarada por el servidor de ARCA. Es la única referencia externa
  // disponible para detectar que el reloj local se corrió, que es la causa
  // documentada de los rechazos de TRA por generationTime/expirationTime.
  serverDate?: string;
}

export async function postSoap({
  endpoint,
  action,
  body,
  timeoutMs = 20_000,
  fetchImpl = fetch,
}: {
  endpoint: string;
  action: string;
  body: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<SoapResponse> {
  assertOfficialEndpoint(endpoint);
  if (!/^https:\/\//.test(endpoint)) throw new Error('SOAP requiere TLS.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'text/xml; charset=utf-8',
        soapaction: `"${action}"`,
        'user-agent': 'TABA-ARCA-Bridge/0.1',
      },
      body,
      signal: controller.signal,
      redirect: 'error',
    });
    const text = await response.text();
    const serverDate = response.headers?.get?.('date') || undefined;
    const result: SoapResponse = {
      body: text,
      status: response.status,
      requestHash: hash(body),
      responseHash: hash(text),
      ...(serverDate ? { serverDate } : {}),
    };
    // SOAP 1.1 manda los Fault con HTTP 500. Tratarlos como "ARCA caída" hacía
    // dos daños: reintentaba a ciegas fallas permanentes (certificado invalido,
    // ambiente equivocado) y escondía el único mensaje que WSAA da cuando el TA
    // anterior sigue vigente. El cuerpo se devuelve para que lo lea el parser
    // SOAP, que sí sabe distinguir.
    if (!response.ok && !isSoapFault(text)) {
      const error = new Error(`ARCA respondió HTTP ${response.status}.`);
      Object.assign(error, { code: response.status >= 500 ? 'ARCA_UNAVAILABLE' : 'ARCA_HTTP_ERROR', retryable: response.status >= 500, ...result });
      throw error;
    }
    return result;
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      const timeoutError = new Error('Timeout esperando respuesta de ARCA.');
      Object.assign(timeoutError, { code: 'ARCA_TIMEOUT', retryable: true, ambiguous: true, requestHash: hash(body) });
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function isSoapFault(body: string): boolean {
  return /<(?:[A-Za-z0-9_.-]+:)?Fault[\s>]/.test(body);
}
