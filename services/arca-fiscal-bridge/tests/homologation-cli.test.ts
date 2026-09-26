import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import forge from 'node-forge';
import { CONFIRM_PHRASE, CliRefusal, parseArgs, runArcaCli } from '../src/cli.js';

const homologationEnv = {
  ARCA_ENVIRONMENT: 'homologation',
  ARCA_CUIT: '20123456789',
  // Absolutas en cualquier sistema; nunca se leen (las credenciales vienen del doble).
  ARCA_CERTIFICATE_PATH: path.resolve('/run/secrets/cert.pem'),
  ARCA_PRIVATE_KEY_PATH: path.resolve('/run/secrets/key.pem'),
  ARCA_HOMOLOGATION_CONSENT: 'I_UNDERSTAND_THIS_USES_ARCA_HOMOLOGATION',
};
// Certificado sintético autofirmado (sólo para firmar el TRA contra el doble de WSAA).
const syntheticKeys = forge.pki.rsa.generateKeyPair(1024);
const syntheticCertificate = forge.pki.createCertificate();
syntheticCertificate.publicKey = syntheticKeys.publicKey;
syntheticCertificate.serialNumber = '01';
syntheticCertificate.validity.notBefore = new Date('2026-01-01T00:00:00Z');
syntheticCertificate.validity.notAfter = new Date('2027-01-01T00:00:00Z');
syntheticCertificate.setSubject([{ name: 'commonName', value: 'taba-cli-test' }, { name: 'serialNumber', value: 'CUIT 20123456789' }]);
syntheticCertificate.setIssuer([{ name: 'commonName', value: 'taba-cli-test' }]);
syntheticCertificate.sign(syntheticKeys.privateKey, forge.md.sha256.create());
const fakeCredentials = () => ({
  certificatePem: forge.pki.certificateToPem(syntheticCertificate),
  privateKeyPem: forge.pki.privateKeyToPem(syntheticKeys.privateKey),
  fingerprint256: 'AA:BB', expiresAt: '2027-01-01T00:00:00.000Z', daysRemaining: 97,
});
const loginXml = `<soapenv:Envelope><soapenv:Body><loginCmsResponse><loginCmsReturn>&lt;loginTicketResponse&gt;&lt;header&gt;&lt;expirationTime&gt;2099-01-01T00:00:00Z&lt;/expirationTime&gt;&lt;/header&gt;&lt;credentials&gt;&lt;token&gt;TOKEN-SECRETO&lt;/token&gt;&lt;sign&gt;SIGN-SECRETO&lt;/sign&gt;&lt;/credentials&gt;&lt;/loginTicketResponse&gt;</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`;

function fakeArca(bodies: Record<string, string>) {
  const seen: string[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body || '');
    const operation = /<ar:(FE[A-Za-z]+)/.exec(body)?.[1] || (/loginCms/.test(body) ? 'loginCms' : 'unknown');
    seen.push(operation);
    return new Response(bodies[operation] ?? '<Envelope><Body/></Envelope>', { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

test('los argumentos se leen estrictos', () => {
  assert.deepEqual(parseArgs(['last', '--pos', '3', '--type', '11']), { command: 'last', options: { pos: '3', type: '11' } });
  assert.throws(() => parseArgs(['last', 'pos', '3']), CliRefusal);
  assert.throws(() => parseArgs(['last', '--pos']), CliRefusal);
});

test('producción se rechaza siempre, aunque esté habilitada', async () => {
  await assert.rejects(() => runArcaCli(['dummy'], {
    env: { ...homologationEnv, ARCA_ENVIRONMENT: 'production', ARCA_PRODUCTION_ENABLE: 'I_UNDERSTAND_THIS_USES_ARCA_PRODUCTION' },
    loadCredentials: fakeCredentials, out: () => {},
  }), (error: Error) => error.message === 'PRODUCCION_RECHAZADA_POR_LA_HERRAMIENTA');
  await assert.rejects(() => runArcaCli(['dummy'], { env: { ARCA_ENVIRONMENT: 'disabled' }, out: () => {} }), /ARCA_DISABLED/);
});

test('emitir exige la frase de confirmación además del consentimiento del entorno', async () => {
  const { fetchImpl, seen } = fakeArca({ loginCms: loginXml });
  await assert.rejects(() => runArcaCli(['issue-test', '--pos', '3', '--type', '11', '--amount', '100', '--vat-condition', '5'], {
    env: homologationEnv, loadCredentials: fakeCredentials, fetchImpl, out: () => {},
  }), /FALTA_CONFIRMACION_DE_HOMOLOGACION/);
  assert.ok(!seen.includes('FECAESolicitar'));
});

test('auth-test informa vencimiento y largos, nunca el token ni el sign', async () => {
  const { fetchImpl } = fakeArca({ loginCms: loginXml });
  const lines: Array<Record<string, unknown>> = [];
  await runArcaCli(['auth-test'], { env: homologationEnv, loadCredentials: fakeCredentials, fetchImpl, out: (line) => lines.push(line) });
  const printed = JSON.stringify(lines);
  assert.doesNotMatch(printed, /TOKEN-SECRETO|SIGN-SECRETO/);
  assert.equal(lines[0]!.tokenLength, 'TOKEN-SECRETO'.length);
});

test('issue-test emite en homologación con último+1 y la condición IVA del receptor', async () => {
  const { fetchImpl, seen } = fakeArca({
    loginCms: loginXml,
    FECompUltimoAutorizado: '<Envelope><Body><FECompUltimoAutorizadoResult><CbteNro>7</CbteNro></FECompUltimoAutorizadoResult></Body></Envelope>',
    FECAESolicitar: '<Envelope><Body><FECAESolicitarResult><FeDetResp><FECAEDetResponse><CbteDesde>8</CbteDesde><Resultado>A</Resultado><CAE>12345678901234</CAE><CAEFchVto>20261006</CAEFchVto></FECAEDetResponse></FeDetResp></FECAESolicitarResult></Body></Envelope>',
  });
  const lines: Array<Record<string, unknown>> = [];
  const code = await runArcaCli(['issue-test', '--pos', '3', '--type', '11', '--amount', '100', '--vat-condition', '5', '--confirm', CONFIRM_PHRASE], {
    env: homologationEnv, loadCredentials: fakeCredentials, fetchImpl, out: (line) => lines.push(line), now: () => new Date('2026-09-26T15:00:00Z'),
  });
  assert.equal(code, 0);
  assert.deepEqual(seen, ['loginCms', 'FECompUltimoAutorizado', 'FECAESolicitar']);
  assert.equal(lines[0]!.documentNumber, 8);
  assert.equal(lines[0]!.cae, '12345678901234');
});
