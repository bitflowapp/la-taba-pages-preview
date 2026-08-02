import forge from 'node-forge';
import type { ArcaConfig, LoginTicket } from './types.js';
import { assertRemoteExecutionAllowed } from './config.js';
import { decodeXmlText, escapeXml, findFirst, parseTrustedSoap, xmlText } from './xml.js';
import { postSoap } from './transport.js';

export function buildTra({ service = 'wsfe', now = new Date(), uniqueId = Math.floor(now.getTime() / 1000) } = {}): string {
  const generation = new Date(now.getTime() - 10 * 60_000).toISOString();
  const expiration = new Date(now.getTime() + 10 * 60_000).toISOString();
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

export class WsaaClient {
  readonly #config: ArcaConfig;
  readonly #credentials: { certificatePem: string; privateKeyPem: string };
  readonly #fetchImpl: typeof fetch;
  #cache = new Map<string, LoginTicket>();
  #inflight = new Map<string, Promise<LoginTicket>>();

  constructor(config: ArcaConfig, credentials: { certificatePem: string; privateKeyPem: string }, fetchImpl: typeof fetch = fetch) {
    this.#config = config;
    this.#credentials = credentials;
    this.#fetchImpl = fetchImpl;
  }

  async login(service = 'wsfe', now = new Date()): Promise<LoginTicket> {
    const cacheKey = `${this.#config.environment}:${this.#config.cuit}:${service}`;
    const cached = this.#cache.get(cacheKey);
    if (cached && Date.parse(cached.expirationTime) - now.getTime() > 5 * 60_000) return cached;
    const pending = this.#inflight.get(cacheKey);
    if (pending) return pending;
    const request = this.#loginFresh(service, now, cacheKey);
    this.#inflight.set(cacheKey, request);
    try { return await request; }
    finally { this.#inflight.delete(cacheKey); }
  }

  async #loginFresh(service: string, now: Date, cacheKey: string): Promise<LoginTicket> {
    assertRemoteExecutionAllowed(this.#config);
    const cms = signTraCms(buildTra({ service, now }), this.#credentials.certificatePem, this.#credentials.privateKeyPem);
    const envelope = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><ser:loginCms><ser:in0>${escapeXml(cms)}</ser:in0></ser:loginCms></soapenv:Body></soapenv:Envelope>`;
    const response = await postSoap({ endpoint: this.#config.endpoints.wsaa, action: '', body: envelope, fetchImpl: this.#fetchImpl });
    const ticket = parseLoginTicketResponse(response.body);
    this.#cache.set(cacheKey, ticket);
    return ticket;
  }

  clear(): void { this.#cache.clear(); this.#inflight.clear(); }
}

function soapFault(value: unknown): Error {
  const code = xmlText(findFirst(value, 'faultcode')) || 'WSAA_FAULT';
  const message = xmlText(findFirst(value, 'faultstring')) || 'WSAA rechazó la autenticación.';
  const error = new Error(message);
  Object.assign(error, { code, retryable: false });
  return error;
}
