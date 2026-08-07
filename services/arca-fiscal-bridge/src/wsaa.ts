import forge from 'node-forge';
import type { ArcaConfig, LoginTicket } from './types.js';
import { assertRemoteExecutionAllowed } from './config.js';
import { decodeXmlText, escapeXml, findFirst, parseTrustedSoap, xmlText } from './xml.js';
import { postSoap } from './transport.js';
import { MemoryTicketStore, ticketIsUsable, type TicketStore } from './ticket-store.js';

// Margen con el que se renueva antes de que el TA venza de verdad.
const RENEWAL_MARGIN_MS = 5 * 60_000;
// Margen mínimo para aceptar un TA que WSAA nos obliga a reutilizar porque
// todavía está dentro de su ventana de retención.
const REUSE_MARGIN_MS = 30_000;

// El manual del desarrollador de WSAA es explícito con los relojes:
// generationTime no puede estar en el futuro ni tener más de 24 horas, y
// recomienda restarle algunos minutos a la hora del sistema para absorber
// desincronizaciones. El ejemplo de formato válido lleva el desplazamiento de
// Argentina (GMT-3), que es lo que se emite acá en vez de un UTC con Z.
export function argentinaTimestamp(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}-03:00`;
}

export function buildTra({ service = 'wsfe', now = new Date(), uniqueId = Math.floor(now.getTime() / 1000) } = {}): string {
  const generation = argentinaTimestamp(new Date(now.getTime() - 10 * 60_000));
  const expiration = argentinaTimestamp(new Date(now.getTime() + 10 * 60_000));
  return `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${uniqueId}</uniqueId><generationTime>${generation}</generationTime><expirationTime>${expiration}</expirationTime></header><service>${escapeXml(service)}</service></loginTicketRequest>`;
}

export function signTraCms(tra: string, certificatePem: string, privateKeyPem: string): string {
  const message = forge.pkcs7.createSignedData();
  message.content = forge.util.createBuffer(tra, 'utf8');
  const certificate = forge.pki.certificateFromPem(certificatePem);
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  message.addCertificate(certificate);
  message.addSigner({
    key: privateKey,
    certificate,
    digestAlgorithm: forge.pki.oids.sha256!,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType!, value: forge.pki.oids.data! },
      { type: forge.pki.oids.messageDigest! },
    ],
  });
  message.sign();
  return forge.util.encode64(forge.asn1.toDer(message.toAsn1()).getBytes());
}

export function parseLoginTicketResponse(soapXml: string): LoginTicket {
  const parsed = parseTrustedSoap(soapXml);
  const fault = findFirst(parsed, 'Fault');
  if (fault) throw soapFault(fault);
  const resultXml = decodeXmlText(xmlText(findFirst(parsed, 'loginCmsReturn')) || xmlText(findFirst(parsed, 'loginCmsResult')));
  if (!resultXml) throw new Error('WSAA no devolvió loginCmsReturn.');
  const ticketXml = parseTrustedSoap(resultXml);
  const token = xmlText(findFirst(ticketXml, 'token'));
  const sign = xmlText(findFirst(ticketXml, 'sign'));
  const generationTime = xmlText(findFirst(ticketXml, 'generationTime'));
  const expirationTime = xmlText(findFirst(ticketXml, 'expirationTime'));
  const service = xmlText(findFirst(ticketXml, 'service'));
  if (!token || !sign || !Number.isFinite(Date.parse(expirationTime))) throw new Error('Login ticket WSAA incompleto.');
  return Object.freeze({ token, sign, generationTime, expirationTime, service });
}

// WSAA no devuelve un código: la única señal de que el TA anterior sigue vigente
// es el texto del fault. Se reconoce por forma, no por igualdad exacta, porque
// el mensaje ha cambiado de redacción entre publicaciones.
export function isTicketRetentionFault(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  return /ya posee un ta valido|ya posee un ta válido|alreadyauthenticated/.test(normalized);
}

export interface WsaaObserver {
  onClockSkew?(detail: { skewSeconds: number; limitSeconds: number }): void;
  onTicketReused?(detail: { service: string; source: 'memory' | 'durable' | 'retention' }): void;
}

export class WsaaClient {
  readonly #config: ArcaConfig;
  readonly #credentials: { certificatePem: string; privateKeyPem: string };
  readonly #fetchImpl: typeof fetch;
  readonly #store: TicketStore;
  readonly #observer: WsaaObserver;
  #memory = new Map<string, LoginTicket>();
  #inflight = new Map<string, Promise<LoginTicket>>();
  #lastUniqueId = 0;

  constructor(
    config: ArcaConfig,
    credentials: { certificatePem: string; privateKeyPem: string },
    fetchImpl: typeof fetch = fetch,
    store: TicketStore = new MemoryTicketStore(),
    observer: WsaaObserver = {},
  ) {
    this.#config = config;
    this.#credentials = credentials;
    this.#fetchImpl = fetchImpl;
    this.#store = store;
    this.#observer = observer;
  }

  async login(service = 'wsfe', now = new Date()): Promise<LoginTicket> {
    const cacheKey = `${this.#config.environment}:${this.#config.cuit}:${service}`;
    const cached = this.#memory.get(cacheKey);
    if (ticketIsUsable(cached || null, now, RENEWAL_MARGIN_MS)) {
      this.#observer.onTicketReused?.({ service, source: 'memory' });
      return cached!;
    }
    const persisted = this.#store.read(cacheKey);
    if (ticketIsUsable(persisted, now, RENEWAL_MARGIN_MS)) {
      this.#memory.set(cacheKey, persisted!);
      this.#observer.onTicketReused?.({ service, source: 'durable' });
      return persisted!;
    }
    const pending = this.#inflight.get(cacheKey);
    if (pending) return pending;
    const request = this.#loginFresh(service, now, cacheKey);
    this.#inflight.set(cacheKey, request);
    try { return await request; }
    finally { this.#inflight.delete(cacheKey); }
  }

  async #loginFresh(service: string, now: Date, cacheKey: string): Promise<LoginTicket> {
    assertRemoteExecutionAllowed(this.#config);
    // uniqueId estrictamente creciente incluso si dos pedidos caen en el mismo
    // segundo: WSAA lo usa para distinguir solicitudes.
    const uniqueId = Math.max(Math.floor(now.getTime() / 1000), this.#lastUniqueId + 1);
    this.#lastUniqueId = uniqueId;
    const cms = signTraCms(buildTra({ service, now, uniqueId }), this.#credentials.certificatePem, this.#credentials.privateKeyPem);
    const envelope = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><ser:loginCms><ser:in0>${escapeXml(cms)}</ser:in0></ser:loginCms></soapenv:Body></soapenv:Envelope>`;
    try {
      const response = await postSoap({ endpoint: this.#config.endpoints.wsaa, action: '', body: envelope, fetchImpl: this.#fetchImpl });
      this.#checkClockSkew(response.serverDate, now);
      const ticket = parseLoginTicketResponse(response.body);
      this.#memory.set(cacheKey, ticket);
      this.#store.write(cacheKey, ticket);
      return ticket;
    } catch (error) {
      // Si WSAA contesta que el CEE ya tiene un TA vigente, lo correcto no es
      // reventar: es usar el que ya se tenía. Si el proceso lo perdió, se
      // espera a que la ventana de retención venza, sin reintentar a ciegas.
      if (!isTicketRetentionFault(String((error as Error)?.message || ''))) throw error;
      const persisted = this.#store.read(cacheKey);
      if (ticketIsUsable(persisted, now, REUSE_MARGIN_MS)) {
        this.#memory.set(cacheKey, persisted!);
        this.#observer.onTicketReused?.({ service: persisted!.service || 'wsfe', source: 'retention' });
        return persisted!;
      }
      throw Object.assign(new Error('WSAA retiene un ticket de acceso vigente que este proceso no conserva.'), {
        code: 'WSAA_TICKET_RETENTION',
        retryable: true,
      });
    }
  }

  #checkClockSkew(serverDate: string | undefined, now: Date): void {
    const serverTime = serverDate ? Date.parse(serverDate) : Number.NaN;
    if (!Number.isFinite(serverTime)) return;
    const skewSeconds = Math.round((serverTime - now.getTime()) / 1000);
    if (Math.abs(skewSeconds) <= this.#config.maxClockSkewSeconds) return;
    this.#observer.onClockSkew?.({ skewSeconds, limitSeconds: this.#config.maxClockSkewSeconds });
    throw Object.assign(new Error('El reloj local difiere del de ARCA más allá de lo tolerado.'), {
      code: 'ARCA_CLOCK_SKEW',
      retryable: false,
    });
  }

  clear(): void { this.#memory.clear(); this.#inflight.clear(); }
}

function soapFault(value: unknown): Error {
  const code = xmlText(findFirst(value, 'faultcode')) || 'WSAA_FAULT';
  const message = xmlText(findFirst(value, 'faultstring')) || 'WSAA rechazó la autenticación.';
  const error = new Error(message);
  Object.assign(error, { code, retryable: false });
  return error;
}
