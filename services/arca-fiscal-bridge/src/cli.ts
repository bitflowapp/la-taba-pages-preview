import { pathToFileURL } from 'node:url';
import { loadAndValidateCredentials, loadArcaConfig } from './config.js';
import { WsaaClient } from './wsaa.js';
import { WsfeClient } from './wsfe.js';
import type { ArcaConfig, FiscalParameterType, FiscalRequest } from './types.js';
import { PARAMETER_OPERATIONS } from './wsfe.js';

/**
 * Herramientas de HOMOLOGACIÓN de ARCA. Nunca producción: la herramienta lo
 * rechaza aunque el entorno lo permita. Emitir exige, además del consentimiento
 * del entorno, repetir la frase en `--confirm`. Nunca imprime token, sign,
 * certificado ni clave: sólo resultados y metadatos.
 *
 *   npm run arca -- verify-config
 *   npm run arca -- dummy
 *   npm run arca -- auth-test
 *   npm run arca -- params
 *   npm run arca -- last --pos 3 --type 11
 *   npm run arca -- query --pos 3 --type 11 --number 1
 *   npm run arca -- issue-test --pos 3 --type 11 --amount 100 --vat-condition 5 --confirm I_UNDERSTAND_THIS_USES_ARCA_HOMOLOGATION
 *   npm run arca -- credit-note-test --pos 3 --type 13 --associated-type 11 --associated-number 1 --amount 100 --vat-condition 5 --confirm I_UNDERSTAND_THIS_USES_ARCA_HOMOLOGATION
 */

export const CONFIRM_PHRASE = 'I_UNDERSTAND_THIS_USES_ARCA_HOMOLOGATION';
const COMMANDS = new Set(['verify-config', 'dummy', 'auth-test', 'params', 'last', 'query', 'issue-test', 'credit-note-test']);

export interface CliDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  loadCredentials?: (config: ArcaConfig) => { certificatePem: string; privateKeyPem: string; fingerprint256?: string; expiresAt?: string; daysRemaining?: number };
  out?: (line: Record<string, unknown>) => void;
  now?: () => Date;
}

export class CliRefusal extends Error {
  constructor(readonly code: string) { super(code); }
}

export function parseArgs(argv: ReadonlyArray<string>): { command: string; options: Record<string, string> } {
  const [command = '', ...rest] = argv;
  const options: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i]!;
    if (!key.startsWith('--')) throw new CliRefusal(`ARGUMENTO_INVALIDO:${key.slice(0, 20)}`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new CliRefusal(`FALTA_VALOR:${key}`);
    options[key.slice(2)] = value;
    i++;
  }
  return { command, options };
}

function positive(options: Record<string, string>, name: string): number {
  const value = Number(options[name]);
  if (!Number.isSafeInteger(value) || value < 1) throw new CliRefusal(`VALOR_INVALIDO:${name}`);
  return value;
}

function amount(options: Record<string, string>): number {
  const value = Number(options.amount);
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) throw new CliRefusal('VALOR_INVALIDO:amount');
  return Math.round(value * 100) / 100;
}

function today(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}${get('month')}${get('day')}`;
}

export async function runArcaCli(argv: ReadonlyArray<string>, deps: CliDeps = {}): Promise<number> {
  const out = deps.out ?? ((line) => process.stdout.write(`${JSON.stringify(line)}\n`));
  const now = deps.now ?? (() => new Date());
  const { command, options } = parseArgs(argv);
  if (!COMMANDS.has(command)) throw new CliRefusal('COMANDO_INVALIDO');
  const config = loadArcaConfig(deps.env ?? process.env);
  if (config.environment !== 'homologation') {
    // Producción no se toca con estas herramientas, esté habilitada o no.
    throw new CliRefusal(config.environment === 'production' ? 'PRODUCCION_RECHAZADA_POR_LA_HERRAMIENTA' : 'ARCA_DISABLED');
  }
  const credentials = (deps.loadCredentials ?? loadAndValidateCredentials)(config);
  if (command === 'verify-config') {
    out({ ok: true, command, environment: config.environment, cuit: config.cuit, certificateMatchesCuitAndKey: true,
      fingerprint256: credentials.fingerprint256, expiresAt: credentials.expiresAt, daysRemaining: credentials.daysRemaining,
      ticketCache: Boolean(config.ticketCachePath) });
    return 0;
  }

  const wsfe = new WsfeClient(config, deps.fetchImpl);
  if (command === 'dummy') {
    out({ ok: true, command, ...(await wsfe.dummy()) });
    return 0;
  }

  const wsaa = new WsaaClient(config, credentials, deps.fetchImpl);
  const ticket = await wsaa.login('wsfe', now());
  if (command === 'auth-test') {
    out({ ok: true, command, expiresAt: ticket.expirationTime, tokenLength: ticket.token.length, signLength: ticket.sign.length });
    return 0;
  }
  if (command === 'params') {
    const tables: Record<string, number | string> = {};
    for (const type of Object.keys(PARAMETER_OPERATIONS) as FiscalParameterType[]) {
      const snapshot = await wsfe.getParameters(ticket, type, now());
      tables[type] = JSON.stringify(snapshot.values).match(/"Id"/g)?.length ?? 0;
    }
    out({ ok: true, command, tables });
    return 0;
  }
  if (command === 'last') {
    const last = await wsfe.lastAuthorized(ticket, positive(options, 'pos'), positive(options, 'type'));
    out({ ok: true, command, pointOfSale: Number(options.pos), documentType: Number(options.type), lastAuthorized: last });
    return 0;
  }
  if (command === 'query') {
    const result = await wsfe.consult(ticket, { cuit: config.cuit, pointOfSale: positive(options, 'pos'), documentType: positive(options, 'type'), documentNumber: positive(options, 'number') });
    out({ ok: true, command, found: Boolean(result), ...(result ? { classification: result.classification, documentNumber: result.documentNumber, cae: result.cae,
      caeExpiration: result.caeExpiration, issueDate: result.issueDate, totalAmount: result.totalAmount, recipientVatConditionId: result.recipientVatConditionId } : {}) });
    return 0;
  }

  // issue-test / credit-note-test: emiten comprobantes de PRUEBA en homologación.
  if (options.confirm !== CONFIRM_PHRASE) throw new CliRefusal('FALTA_CONFIRMACION_DE_HOMOLOGACION');
  const pointOfSale = positive(options, 'pos');
  const documentType = positive(options, 'type');
  const total = amount(options);
  const last = await wsfe.lastAuthorized(ticket, pointOfSale, documentType);
  const request: FiscalRequest = {
    cuit: config.cuit, pointOfSale, documentType, concept: 1,
    recipientDocumentType: Number(options['doc-type'] ?? 99), recipientDocumentNumber: String(options['doc-number'] ?? '0'),
    recipientVatConditionId: positive(options, 'vat-condition'),
    documentNumber: last + 1, issueDate: today(now()),
    // Comprobante C (monotributo): sin IVA discriminado. Para A/B, la política contable define alícuotas.
    totalAmount: total, netAmount: total, vatAmount: 0, exemptAmount: 0, nonTaxedAmount: 0, otherTaxesAmount: 0,
    currencyCode: 'PES', currencyRate: 1, vatItems: [],
    documentIntent: command === 'credit-note-test' ? 'credit_note' : 'invoice',
    ...(command === 'credit-note-test' ? { associatedDocument: { documentType: positive(options, 'associated-type'), pointOfSale, documentNumber: positive(options, 'associated-number'), cuit: config.cuit } } : {}),
  };
  const result = await wsfe.authorize(ticket, request);
  out({ ok: ['authorized', 'authorized_with_observations'].includes(result.classification), command, documentNumber: request.documentNumber,
    classification: result.classification, cae: result.cae, caeExpiration: result.caeExpiration,
    observations: result.observations, errors: result.errors });
  return ['authorized', 'authorized_with_observations'].includes(result.classification) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runArcaCli(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: (error as { code?: string }).code || (error as Error).message })}\n`);
    process.exitCode = 1;
  });
}
