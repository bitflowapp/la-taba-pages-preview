import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import forge from 'node-forge';
import { runHomologationCertification } from '../src/homologation-certification.js';
import { createSimulatedArca } from '../src/simulated-arca.js';

// La herramienta que va a correr contra la homologación oficial se prueba antes
// contra la ARCA simulada, de punta a punta. Si tiene un error, se descubre acá
// y no con una persona esperando frente a la Clave Fiscal.

const CUIT = '20123456786';
const NOW = new Date('2026-08-07T12:00:00Z');

function writeSyntheticCredentials(directory: string): { certificatePath: string; privateKeyPath: string } {
  fs.mkdirSync(directory, { recursive: true });
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = '0a';
  certificate.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  certificate.validity.notAfter = new Date('2027-01-01T00:00:00Z');
  const subject = [
    { shortName: 'C', value: 'AR' },
    { shortName: 'O', value: 'La Taba' },
    { shortName: 'CN', value: 'taba-fiscal-homologacion' },
    { name: 'serialNumber', value: `CUIT ${CUIT}` },
  ];
  certificate.setSubject(subject);
  certificate.setIssuer(subject);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  const certificatePath = path.join(directory, 'certificate.pem');
  const privateKeyPath = path.join(directory, 'private-key.pem');
  fs.writeFileSync(certificatePath, forge.pki.certificateToPem(certificate), { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(privateKeyPath, forge.pki.privateKeyToPem(keys.privateKey), { encoding: 'utf8', mode: 0o600 });
  return { certificatePath, privateKeyPath };
}

function writeCase(directory: string): string {
  const file = path.join(directory, 'caso.json');
  fs.writeFileSync(file, JSON.stringify({
    pointOfSale: 3, documentType: 6, concept: 1,
    recipientDocumentType: 99, recipientDocumentNumber: '0', recipientVatConditionId: 5,
    issueDate: '20260807', currencyCode: 'PES', currencyRate: 1,
    totalAmount: 3025, netAmount: 2500, vatAmount: 525,
    exemptAmount: 0, nonTaxedAmount: 0, otherTaxesAmount: 0,
    vatItems: [{ id: 5, baseAmount: 2500, amount: 525 }],
  }), 'utf8');
  return file;
}

function environment(directory: string, credentials: { certificatePath: string; privateKeyPath: string }, extra: Record<string, string> = {}) {
  return {
    ARCA_ENVIRONMENT: 'homologation',
    ARCA_CUIT: CUIT,
    ARCA_CERTIFICATE_PATH: credentials.certificatePath,
    ARCA_PRIVATE_KEY_PATH: credentials.privateKeyPath,
    ARCA_TICKET_STATE_PATH: path.join(directory, 'ticket-state.json'),
    ARCA_HOMOLOGATION_CONSENT: 'I_UNDERSTAND_THIS_USES_ARCA_HOMOLOGATION',
    FISCAL_BUSINESS_ID: '52000000-0000-4000-8000-000000000001',
    FISCAL_WORKER_ID: 'taba-certificacion',
    FISCAL_HEALTH_PORT: '8787',
    ...extra,
  };
}

test('la certificación recorre lectura, emisión y consulta, y la evidencia no lleva secretos', async () => {
  const directory = path.join(os.tmpdir(), `taba-cert-${process.pid}`);
  try {
    const credentials = writeSyntheticCredentials(directory);
    const casePath = writeCase(directory);
    const arca = createSimulatedArca({ now: () => NOW });
    const result = await runHomologationCertification({
      casePath, emit: true, now: NOW, env: environment(directory, credentials), fetchImpl: arca.fetch,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.steps.map((step) => step.step), [
      'credenciales', 'FEDummy', 'WSAA', 'tablas oficiales', 'FECompUltimoAutorizado', 'FECAESolicitar', 'FECompConsultar',
    ]);
    const evidence = result.evidence as Record<string, any>;
    assert.equal(evidence.environment, 'homologation');
    assert.equal(evidence.endpoints.wsfe, 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx');
    assert.equal(evidence.lastAuthorizedBefore, 0);
    assert.match(String(evidence.authorization.cae), /^\d{14}$/);
    // La consulta por número es lo que prueba que el comprobante existe del lado
    // de ARCA, y no sólo en la respuesta que recibimos.
    assert.equal(evidence.consultation.cae, evidence.authorization.cae);
    assert.equal(evidence.authorization.documentNumber, 1);
    assert.equal(Object.keys(evidence.parameterVersions).length, 7);

    const serialized = JSON.stringify(evidence);
    assert.doesNotMatch(serialized, /simulated-token|simulated-sign/, 'el token de acceso nunca entra en la evidencia');
    assert.doesNotMatch(serialized, /PRIVATE KEY|BEGIN CERTIFICATE/, 'el material criptográfico nunca entra en la evidencia');
    assert.doesNotMatch(serialized, /soapenv:Envelope/, 'el XML crudo nunca entra en la evidencia');
    assert.match(serialized, /no tiene validez fiscal/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('sin la frase de consentimiento la certificación no toca ARCA', async () => {
  const directory = path.join(os.tmpdir(), `taba-cert-blocked-${process.pid}`);
  try {
    const credentials = writeSyntheticCredentials(directory);
    const casePath = writeCase(directory);
    const arca = createSimulatedArca({ now: () => NOW });
    const env: Record<string, string> = environment(directory, credentials);
    delete env.ARCA_HOMOLOGATION_CONSENT;
    await assert.rejects(
      () => runHomologationCertification({ casePath, emit: true, now: NOW, env, fetchImpl: arca.fetch }),
      /ARCA_HOMOLOGATION_BLOCKED/,
    );
    assert.equal(arca.calls.length, 0);
    assert.equal(arca.authorizations().length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('la certificación se niega a correr contra producción', async () => {
  const directory = path.join(os.tmpdir(), `taba-cert-prod-${process.pid}`);
  try {
    const credentials = writeSyntheticCredentials(directory);
    const casePath = writeCase(directory);
    const arca = createSimulatedArca({ now: () => NOW });
    await assert.rejects(
      () => runHomologationCertification({
        casePath, emit: true, now: NOW,
        env: environment(directory, credentials, { ARCA_ENVIRONMENT: 'production' }),
        fetchImpl: arca.fetch,
      }),
      /únicamente contra homologación/,
    );
    assert.equal(arca.calls.length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('un rechazo de ARCA no se declara certificación exitosa', async () => {
  const directory = path.join(os.tmpdir(), `taba-cert-reject-${process.pid}`);
  try {
    const credentials = writeSyntheticCredentials(directory);
    const casePath = writeCase(directory);
    const arca = createSimulatedArca({ now: () => NOW });
    arca.behaviour.rejectNextAuthorize = true;
    const result = await runHomologationCertification({
      casePath, emit: true, now: NOW, env: environment(directory, credentials), fetchImpl: arca.fetch,
    });
    assert.equal(result.ok, false);
    const authorization = result.steps.find((step) => step.step === 'FECAESolicitar');
    assert.equal(authorization?.ok, false);
    assert.equal((result.evidence as Record<string, any>).authorization.cae, undefined);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
