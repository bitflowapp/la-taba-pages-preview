import assert from 'node:assert/strict';
import test from 'node:test';
import forge from 'node-forge';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertRemoteExecutionAllowed, loadArcaConfig, OFFICIAL_ENDPOINTS } from '../src/config.js';
import { buildTra, parseLoginTicketResponse, signTraCms, WsaaClient } from '../src/wsaa.js';
import { parseTrustedSoap } from '../src/xml.js';
import { FileTicketStore } from '../src/ticket-store.js';
import { createSimulatedArca } from '../src/simulated-arca.js';

const baseEnv = {
  ARCA_ENVIRONMENT: 'homologation',
  ARCA_CUIT: '20123456789',
  ARCA_CERTIFICATE_PATH: path.resolve('synthetic-secrets', 'certificate.pem'),
  ARCA_PRIVATE_KEY_PATH: path.resolve('synthetic-secrets', 'private-key.pem'),
  FISCAL_WORKER_ID: 'worker-01',
  FISCAL_HEALTH_PORT: '8787',
  FISCAL_BUSINESS_ID: '52000000-0000-4000-8000-000000000001',
  ARCA_TICKET_STATE_PATH: path.resolve('synthetic-secrets', 'ticket-state.json'),
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
  // El manual del desarrollador de WSAA muestra el formato con desplazamiento de
  // Argentina y advierte que el equipo debe estar en GMT-3: se emite así, no en UTC.
  assert.match(tra, /<generationTime>2026-08-02T08:50:00-03:00<\/generationTime>/);
  assert.match(tra, /<expirationTime>2026-08-02T09:10:00-03:00<\/expirationTime>/);
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

// ===== Ticket de acceso durable, retención y reloj =====

function syntheticCredentials(serial: string) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = serial;
  certificate.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  certificate.validity.notAfter = new Date('2027-01-01T00:00:00Z');
  certificate.setSubject([{ name: 'commonName', value: 'TABA TEST' }]);
  certificate.setIssuer(certificate.subject.attributes);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certificatePem: forge.pki.certificateToPem(certificate),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

function ticketStatePath(name: string): string {
  return path.join(os.tmpdir(), `taba-fiscal-${name}-${process.pid}.json`);
}

const consentEnv = { ...baseEnv, ARCA_HOMOLOGATION_CONSENT: 'I_UNDERSTAND_THIS_USES_ARCA_HOMOLOGATION' };
const NOW = new Date('2026-08-02T12:00:00Z');

test('el ticket de acceso sobrevive al reinicio del proceso', async () => {
  const file = ticketStatePath('durable');
  const credentials = syntheticCredentials('03');
  const config = loadArcaConfig({ ...consentEnv, ARCA_TICKET_STATE_PATH: file });
  const arca = createSimulatedArca({ now: () => NOW });
  try {
    const first = new WsaaClient(config, credentials, arca.fetch, new FileTicketStore(file));
    const ticket = await first.login('wsfe', NOW);
    assert.equal(arca.logins, 1);
    // Un proceso nuevo: caché en memoria vacía, mismo archivo de estado.
    const second = new WsaaClient(config, credentials, arca.fetch, new FileTicketStore(file));
    const reused = await second.login('wsfe', NOW);
    assert.equal(reused.token, ticket.token);
    assert.equal(arca.logins, 1, 'reiniciar el worker no vuelve a pedirle un TA a WSAA');
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('el archivo de estado del ticket no queda legible para terceros', () => {
  const file = ticketStatePath('perms');
  try {
    new FileTicketStore(file).write('k', { token: 't', sign: 's', generationTime: '', expirationTime: '2026-08-03T00:00:00Z', service: 'wsfe' });
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(file).mode & 0o077, 0, 'el ticket es un secreto: nadie mas puede leerlo');
    }
    assert.equal(new FileTicketStore(file).read('k')?.token, 't');
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('si WSAA retiene el TA vigente se reutiliza el guardado en vez de fallar', async () => {
  const file = ticketStatePath('retention');
  const credentials = syntheticCredentials('04');
  const config = loadArcaConfig({ ...consentEnv, ARCA_TICKET_STATE_PATH: file });
  let clock = NOW;
  const arca = createSimulatedArca({ now: () => clock });
  try {
    const store = new FileTicketStore(file);
    await new WsaaClient(config, credentials, arca.fetch, store).login('wsfe', NOW);
    arca.behaviour.ticketRetention = true;
    // Un proceso nuevo, ya vencido el margen de renovacion: WSAA rechaza el
    // pedido porque el TA anterior sigue vigente, y el puente usa ese.
    const later = new Date(NOW.getTime() + 11.9 * 60 * 60_000);
    clock = later;
    const reused = await new WsaaClient(config, credentials, arca.fetch, new FileTicketStore(file)).login('wsfe', later);
    assert.match(reused.token, /^simulated-token-/);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('sin ticket guardado, la retención de WSAA es un error reintentable y saneado', async () => {
  const file = ticketStatePath('retention-empty');
  const credentials = syntheticCredentials('05');
  const config = loadArcaConfig({ ...consentEnv, ARCA_TICKET_STATE_PATH: file });
  const arca = createSimulatedArca({ now: () => NOW });
  arca.behaviour.ticketRetention = true;
  try {
    await assert.rejects(
      () => new WsaaClient(config, credentials, arca.fetch, new FileTicketStore(file)).login('wsfe', NOW),
      (error: { code?: string; retryable?: boolean; message?: string }) => {
        assert.equal(error.code, 'WSAA_TICKET_RETENTION');
        assert.equal(error.retryable, true);
        assert.doesNotMatch(String(error.message), /token|sign/i);
        return true;
      },
    );
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('un reloj corrido frente a ARCA falla cerrado antes de firmar nada mas', async () => {
  const file = ticketStatePath('skew');
  const credentials = syntheticCredentials('06');
  const config = loadArcaConfig({ ...consentEnv, ARCA_TICKET_STATE_PATH: file, ARCA_MAX_CLOCK_SKEW_SECONDS: '120' });
  const arca = createSimulatedArca({ now: () => NOW });
  arca.behaviour.serverClockOffsetMs = 20 * 60_000;
  const observed: number[] = [];
  try {
    await assert.rejects(
      () => new WsaaClient(config, credentials, arca.fetch, new FileTicketStore(file), {
        onClockSkew: (detail) => observed.push(detail.skewSeconds),
      }).login('wsfe', NOW),
      /ARCA_CLOCK_SKEW|reloj local/,
    );
    assert.equal(observed.length, 1);
    assert.ok(Math.abs(observed[0]!) >= 1000);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('el TA vencido se renueva y el vigente se reutiliza', async () => {
  const file = ticketStatePath('renewal');
  const credentials = syntheticCredentials('07');
  const config = loadArcaConfig({ ...consentEnv, ARCA_TICKET_STATE_PATH: file });
  let clock = NOW;
  const arca = createSimulatedArca({ now: () => clock });
  arca.behaviour.ticketLifetimeMs = 30 * 60_000;
  try {
    const client = new WsaaClient(config, credentials, arca.fetch, new FileTicketStore(file));
    await client.login('wsfe', NOW);
    clock = new Date(NOW.getTime() + 10 * 60_000);
    await client.login('wsfe', clock);
    assert.equal(arca.logins, 1, 'un TA vigente no se renueva');
    clock = new Date(NOW.getTime() + 29 * 60_000);
    await client.login('wsfe', clock);
    assert.equal(arca.logins, 2, 'un TA por vencer se renueva dentro del margen');
  } finally {
    fs.rmSync(file, { force: true });
  }
});
