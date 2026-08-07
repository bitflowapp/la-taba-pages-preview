// ARCA simulada: un `fetch` determinista que habla WSAA y WSFEv1 igual que los
// endpoints oficiales, para ejercitar el circuito completo sin red.
//
// No reemplaza la homologación oficial y no lo pretende: existe para poder
// probar lo que homologación NO deja provocar a voluntad —un timeout justo
// después de que ARCA autorizó, una caída, un TA vencido, una ventana de
// retención— y para que esos caminos tengan una prueba automática que corra en
// cada cambio. La certificación final usa los endpoints reales.

import { escapeXml } from './xml.js';

export interface SimulatedArcaBehaviour {
  /** Desfase del header Date respecto del reloj local, en milisegundos. */
  serverClockOffsetMs: number;
  /** WSAA responde que el CEE ya tiene un TA vigente. */
  ticketRetention: boolean;
  /** Vida del TA emitido, en milisegundos. */
  ticketLifetimeMs: number;
  /** Corta la próxima autorización: 'timeout' autoriza igual del lado de ARCA. */
  nextAuthorizeFailure: 'timeout' | 'http500' | null;
  /** La próxima autorización se rechaza con Resultado R. */
  rejectNextAuthorize: boolean;
  /** Observaciones a devolver junto con una autorización aprobada. */
  observations: ReadonlyArray<{ code: string; message: string }>;
  /** Todo el servicio responde 503. */
  serviceDown: boolean;
}

export interface SimulatedArcaAuthorization {
  pointOfSale: number;
  documentType: number;
  documentNumber: number;
  cae: string;
  caeExpiration: string;
  issueDate: string;
  totalAmount: number;
}

export interface SimulatedArca {
  fetch: typeof fetch;
  behaviour: SimulatedArcaBehaviour;
  readonly calls: ReadonlyArray<string>;
  readonly logins: number;
  authorizations(): ReadonlyArray<SimulatedArcaAuthorization>;
  lastAuthorizedNumber(pointOfSale: number, documentType: number): number;
}

export function createSimulatedArca(options: { now?: () => Date; cuit?: string } = {}): SimulatedArca {
  const now = options.now || (() => new Date());
  const behaviour: SimulatedArcaBehaviour = {
    serverClockOffsetMs: 0,
    ticketRetention: false,
    ticketLifetimeMs: 12 * 60 * 60_000,
    nextAuthorizeFailure: null,
    rejectNextAuthorize: false,
    observations: [],
    serviceDown: false,
  };
  const calls: string[] = [];
  const authorized = new Map<string, SimulatedArcaAuthorization>();
  let logins = 0;

  const simulated: SimulatedArca = {
    behaviour,
    calls,
    get logins() { return logins; },
    authorizations: () => Object.freeze([...authorized.values()]),
    lastAuthorizedNumber: (pointOfSale, documentType) => [...authorized.values()]
      .filter((item) => item.pointOfSale === pointOfSale && item.documentType === documentType)
      .reduce((maximum, item) => Math.max(maximum, item.documentNumber), 0),
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const endpoint = String(url);
      const body = String(init?.body || '');
      const headers = { date: new Date(now().getTime() + behaviour.serverClockOffsetMs).toUTCString() };
      if (behaviour.serviceDown) return new Response('<html>503</html>', { status: 503, headers });

      if (/LoginCms/.test(endpoint)) {
        calls.push('loginCms');
        logins += 1;
        if (behaviour.ticketRetention) {
          return new Response(soapFault('ns1:coe.alreadyAuthenticated', 'El CEE ya posee un TA valido para el acceso al WSN solicitado'), { status: 500, headers });
        }
        const generation = new Date(now().getTime() - 60_000).toISOString();
        const expiration = new Date(now().getTime() + behaviour.ticketLifetimeMs).toISOString();
        const ticketXml = `<?xml version="1.0"?><loginTicketResponse version="1.0"><header><expirationTime>${expiration}</expirationTime><generationTime>${generation}</generationTime></header><credentials><token>simulated-token-${logins}</token><sign>simulated-sign-${logins}</sign></credentials></loginTicketResponse>`;
        return new Response(
          `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><loginCmsResponse><loginCmsReturn>${escapeXml(ticketXml)}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`,
          { status: 200, headers },
        );
      }

      const operation = /<ar:(FE[A-Za-z]+)/.exec(body)?.[1] || 'unknown';
      calls.push(operation);

      if (operation === 'FEDummy') {
        return soapOk('<FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult>', headers);
      }
      if (operation.startsWith('FEParamGet')) {
        return soapOk(`<${operation}Result><ResultGet><Item><Id>5</Id><Desc>Simulado</Desc></Item><Item><Id>6</Id><Desc>Simulado</Desc></Item><Item><Id>8</Id><Desc>Simulado</Desc></Item><Item><Id>99</Id><Desc>Simulado</Desc></Item></ResultGet></${operation}Result>`, headers);
      }
      if (operation === 'FECompUltimoAutorizado') {
        const pointOfSale = numberFrom(body, 'PtoVta');
        const documentType = numberFrom(body, 'CbteTipo');
        return soapOk(`<FECompUltimoAutorizadoResult><PtoVta>${pointOfSale}</PtoVta><CbteTipo>${documentType}</CbteTipo><CbteNro>${simulated.lastAuthorizedNumber(pointOfSale, documentType)}</CbteNro></FECompUltimoAutorizadoResult>`, headers);
      }
      if (operation === 'FECompConsultar') {
        const record = authorized.get(consultKey(body));
        if (!record) {
          return soapOk('<FECompConsultarResult><Errors><Err><Code>602</Code><Msg>No existe el comprobante consultado</Msg></Err></Errors></FECompConsultarResult>', headers);
        }
        return soapOk(`<FECompConsultarResult><ResultGet><CbteDesde>${record.documentNumber}</CbteDesde><CbteNro>${record.documentNumber}</CbteNro><PtoVta>${record.pointOfSale}</PtoVta><CbteTipo>${record.documentType}</CbteTipo><CbteFch>${record.issueDate}</CbteFch><ImpTotal>${record.totalAmount.toFixed(2)}</ImpTotal><CodAutorizacion>${record.cae}</CodAutorizacion><FchVto>${record.caeExpiration}</FchVto></ResultGet></FECompConsultarResult>`, headers);
      }
      if (operation === 'FECAESolicitar') {
        const pointOfSale = numberFrom(body, 'PtoVta');
        const documentType = numberFrom(body, 'CbteTipo');
        const documentNumber = numberFrom(body, 'CbteDesde');
        const issueDate = textFrom(body, 'CbteFch');
        const totalAmount = Number(textFrom(body, 'ImpTotal') || '0');
        if (behaviour.rejectNextAuthorize) {
          behaviour.rejectNextAuthorize = false;
          return soapOk(`<FECAESolicitarResult><FeDetResp><FECAEDetResponse><CbteDesde>${documentNumber}</CbteDesde><Resultado>R</Resultado><Observaciones><Obs><Code>10015</Code><Msg>Comprobante rechazado en la simulacion</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp></FECAESolicitarResult>`, headers);
        }
        const record: SimulatedArcaAuthorization = {
          pointOfSale, documentType, documentNumber,
          cae: buildCae(pointOfSale, documentType, documentNumber),
          caeExpiration: shiftCompactDate(issueDate, 10),
          issueDate,
          totalAmount,
        };
        const failure = behaviour.nextAuthorizeFailure;
        if (failure) {
          behaviour.nextAuthorizeFailure = null;
          // Este es el caso peligroso de verdad: ARCA autorizó y el cliente
          // nunca vio la respuesta. Se registra igual, para que la consulta
          // posterior encuentre el comprobante y nadie lo emita dos veces.
          authorized.set(key(pointOfSale, documentType, documentNumber), record);
          if (failure === 'timeout') throw Object.assign(new Error('simulated abort'), { name: 'AbortError' });
          return new Response('<html>500</html>', { status: 500, headers });
        }
        authorized.set(key(pointOfSale, documentType, documentNumber), record);
        const observations = behaviour.observations.length
          ? `<Observaciones>${behaviour.observations.map((item) => `<Obs><Code>${item.code}</Code><Msg>${escapeXml(item.message)}</Msg></Obs>`).join('')}</Observaciones>`
          : '';
        return soapOk(`<FECAESolicitarResult><FeDetResp><FECAEDetResponse><CbteDesde>${documentNumber}</CbteDesde><CbteHasta>${documentNumber}</CbteHasta><CbteFch>${issueDate}</CbteFch><Resultado>A</Resultado><CAE>${record.cae}</CAE><CAEFchVto>${record.caeExpiration}</CAEFchVto>${observations}</FECAEDetResponse></FeDetResp></FECAESolicitarResult>`, headers);
      }
      return soapOk('<UnknownResult/>', headers);
    }) as unknown as typeof fetch,
  };
  return simulated;
}

function soapOk(inner: string, headers: Record<string, string>): Response {
  return new Response(
    `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${inner}</soap:Body></soap:Envelope>`,
    { status: 200, headers },
  );
}

function soapFault(code: string, message: string): string {
  return `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode>${escapeXml(code)}</faultcode><faultstring>${escapeXml(message)}</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`;
}

function key(pointOfSale: number, documentType: number, documentNumber: number): string {
  return `${pointOfSale}:${documentType}:${documentNumber}`;
}

function consultKey(body: string): string {
  return key(numberFrom(body, 'PtoVta'), numberFrom(body, 'CbteTipo'), numberFrom(body, 'CbteNro'));
}

function textFrom(body: string, tag: string): string {
  return new RegExp(`<ar:${tag}>([^<]*)</ar:${tag}>`).exec(body)?.[1] || '';
}

function numberFrom(body: string, tag: string): number {
  return Number(textFrom(body, tag) || 0);
}

// CAE determinista de 14 dígitos: la misma solicitud produce siempre el mismo
// código, así que un test puede afirmar sobre él sin congelar el reloj.
function buildCae(pointOfSale: number, documentType: number, documentNumber: number): string {
  const seed = `${pointOfSale}${documentType}${documentNumber}`;
  let digits = '7';
  for (let index = 0; digits.length < 14; index += 1) {
    digits += String((Number(seed[index % seed.length]) * 7 + index * 3 + seed.length) % 10);
  }
  return digits.slice(0, 14);
}

function shiftCompactDate(compact: string, days: number): string {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(compact);
  if (!match) return compact;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}
