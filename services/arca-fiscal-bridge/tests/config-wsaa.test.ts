import assert from 'node:assert/strict';
import test from 'node:test';
import forge from 'node-forge';
import path from 'node:path';
import { assertRemoteExecutionAllowed, loadArcaConfig, OFFICIAL_ENDPOINTS } from '../src/config.js';
import { buildTra, parseLoginTicketResponse, signTraCms, WsaaClient } from '../src/wsaa.js';
import { parseTrustedSoap } from '../src/xml.js';

const baseEnv = {
  ARCA_ENVIRONMENT: 'homologation',
  ARCA_CUIT: '20123456789',
  ARCA_CERTIFICATE_PATH: path.resolve('synthetic-secrets', 'certificate.pem'),
  ARCA_PRIVATE_KEY_PATH: path.resolve('synthetic-secrets', 'private-key.pem'),
  FISCAL_WORKER_ID: 'worker-01',
  FISCAL_HEALTH_PORT: '8787',
};

test('config usa allowlist oficial y bloquea homologación sin frase', () => {
  const config = loadArcaConfig(baseEnv);
  assert.deepEqual(config.endpoints, OFFICIAL_ENDPOINTS.homologation);
  assert.throws(() => assertRemoteExecutionAllowed(config), /ARCA_HOMOLOGATION_BLOCKED/);
  const enabled = loadArcaConfig({ ...baseEnv, ARCA_HOMOLOGATION_CONSENT: 'I_UNDERSTAND_THIS_USES_ARCA_HOMOLOGATION' });
  assert.doesNotThrow(() => assertRemoteExecutionAllowed(enabled));
});

test('producción necesita un gate independiente y explícito', () => {
  const config = loadArcaConfig({ ...baseEnv, ARCA_ENVIRONMENT: 'production' });
  assert.throws(() => assertRemoteExecutionAllowed(config), /ARCA_PRODUCTION_DISABLED_BY_DESIGN/);
});

test('el ambiente predeterminado queda deshabilitado sin cargar secretos', () => {
  const config = loadArcaConfig({});
  assert.equal(config.environment, 'disabled');
  assert.equal(config.certificatePath, '');
  assert.throws(() => assertRemoteExecutionAllowed(config), /ARCA_DISABLED/);
});

test('TRA tiene ventana acotada y servicio wsfe', () => {
  const tra = buildTra({ now: new Date('2026-08-02T12:00:00Z'), uniqueId: 123 });
  assert.match(tra, /<uniqueId>123<\/uniqueId>/);
  assert.match(tra, /<service>wsfe<\/service>/);
  assert.match(tra, /2026-08-02T11:50:00.000Z/);
  assert.match(tra, /2026-08-02T12:10:00.000Z/);
});

test('TRA se firma como CMS PKCS#7 con certificado', () => {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  certificate.validity.notAfter = new Date('2027-01-01T00:00:00Z');
  certificate.setSubject([{ name: 'commonName', value: 'TABA TEST' }]);
  certificate.setIssuer(certificate.subject.attributes);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  const cms = signTraCms('<loginTicketRequest/>', forge.pki.certificateToPem(certificate), forge.pki.privateKeyToPem(keys.privateKey));
  const asn1 = forge.asn1.fromDer(forge.util.decode64(cms));
  const message = forge.pkcs7.messageFromAsn1(asn1);
  assert.equal((message as { type?: string }).type, forge.pki.oids.signedData);
});

test('parser WSAA extrae ticket y rechaza XXE', () => {
  const ticketXml = '&lt;loginTicketResponse&gt;&lt;header&gt;&lt;generationTime&gt;2026-08-02T11:50:00Z&lt;/generationTime&gt;&lt;expirationTime&gt;2026-08-02T23:50:00Z&lt;/expirationTime&gt;&lt;/header&gt;&lt;credentials&gt;&lt;token&gt;token-test&lt;/token&gt;&lt;sign&gt;sign-test&lt;/sign&gt;&lt;/credentials&gt;&lt;service&gt;wsfe&lt;/service&gt;&lt;/loginTicketResponse&gt;';
  const soap = `<Envelope><Body><loginCmsResponse><loginCmsReturn>${ticketXml}</loginCmsReturn></loginCmsResponse></Body></Envelope>`;
  assert.equal(parseLoginTicketResponse(soap).service, 'wsfe');
  assert.throws(() => parseTrustedSoap('<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>'), /entidades XML/);
});

test('WSAA comparte una sola renovación concurrente por CUIT, servicio y ambiente', async () => {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = '02';
  certificate.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  certificate.validity.notAfter = new Date('2027-01-01T00:00:00Z');
  certificate.setSubject([{ name: 'commonName', value: 'TABA TEST' }]);
  certificate.setIssuer(certificate.subject.attributes);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const ticketXml = '&lt;loginTicketResponse&gt;&lt;header&gt;&lt;generationTime&gt;2026-08-02T11:50:00Z&lt;/generationTime&gt;&lt;expirationTime&gt;2026-08-02T23:50:00Z&lt;/expirationTime&gt;&lt;/header&gt;&lt;credentials&gt;&lt;token&gt;token-test&lt;/token&gt;&lt;sign&gt;sign-test&lt;/sign&gt;&lt;/credentials&gt;&lt;service&gt;wsfe&lt;/service&gt;&lt;/loginTicketResponse&gt;';
    return new Response(`<Envelope><Body><loginCmsReturn>${ticketXml}</loginCmsReturn></Body></Envelope>`, { status: 200 });
  };
  const config = loadArcaConfig({ ...baseEnv, ARCA_HOMOLOGATION_CONSENT: 'I_UNDERSTAND_THIS_USES_ARCA_HOMOLOGATION' });
  const client = new WsaaClient(config, { certificatePem: forge.pki.certificateToPem(certificate), privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey) }, fetchImpl as typeof fetch);
  const now = new Date('2026-08-02T12:00:00Z');
  const [first, second] = await Promise.all([client.login('wsfe', now), client.login('wsfe', now)]);
  assert.equal(calls, 1);
  assert.equal(first.token, second.token);
});
