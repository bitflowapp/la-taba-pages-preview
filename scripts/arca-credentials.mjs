#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPrivateKey, createPublicKey, createSign, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(process.cwd());
const args = process.argv.slice(2);
const command = args.shift() || 'help';

try {
  const result = await run(command);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code || 'ARCA_TOOL_ERROR', message: String(error?.message || error).slice(0, 240) })}\n`);
  process.exitCode = 1;
}

async function run(name) {
  if (name === 'help') return { ok: true, commands: ['generate-key', 'generate-csr', 'inspect-cert', 'verify-pair', 'verify-cuit', 'verify-validity', 'verify-chain', 'check-clock', 'bundle', 'health'] };
  if (name === 'generate-key') return generateKey();
  if (name === 'generate-csr') return generateCsr();
  if (name === 'inspect-cert') return inspectCertificate(readPath('--cert', false));
  if (name === 'verify-pair') return verifyPair();
  if (name === 'verify-cuit') return verifyCuit();
  if (name === 'verify-validity') return verifyValidity();
  if (name === 'verify-chain') return verifyChain();
  if (name === 'check-clock') return checkClock();
  if (name === 'bundle') return bundleSecrets();
  if (name === 'health') return checkHealth();
  throw error('UNKNOWN_COMMAND', `Comando ARCA no reconocido: ${name}`);
}

function generateKey() {
  const output = writablePath('--out');
  const bits = Number(value('--bits') || 3072);
  if (!Number.isSafeInteger(bits) || bits < 2048) throw error('INVALID_RSA_BITS', 'La clave RSA debe tener al menos 2048 bits.');
  ensureNewFile(output);
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: bits,
    publicExponent: 0x10001,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  writeSecret(output, privateKey);
  return { ok: true, command: 'generate-key', bits, output: path.basename(output), privateKeyPrinted: false };
}

function generateCsr() {
  const key = secretPath('--key');
  const output = writablePath('--out');
  const subject = value('--subject');
  if (!subject || !/^\/[A-Za-z]+=.+/.test(subject)) throw error('INVALID_CSR_SUBJECT', 'Usá un subject OpenSSL, por ejemplo /C=AR/O=TABA/CN=TABA.');
  ensureNewFile(output);
  const privateKey = createPrivateKey(fs.readFileSync(key, 'utf8'));
  const certificationRequestInfo = derSequence([
    derInteger(0),
    subjectName(subject),
    createPublicKey(privateKey).export({ type: 'spki', format: 'der' }),
    Buffer.from([0xa0, 0x00]),
  ]);
  const signer = createSign('RSA-SHA256');
  signer.update(certificationRequestInfo);
  signer.end();
  const signature = signer.sign(privateKey);
  const csr = derSequence([
    certificationRequestInfo,
    derSequence([derOid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00])]),
    derBitString(signature),
  ]);
  fs.writeFileSync(output, toPem('CERTIFICATE REQUEST', csr), { encoding: 'utf8', flag: 'wx', mode: 0o644 });
  return { ok: true, command: 'generate-csr', subject, output: path.basename(output), privateKeyPrinted: false };
}

function verifyPair() {
  const certPath = secretPath('--cert');
  const keyPath = secretPath('--key');
  const cuit = digits(value('--cuit'));
  const info = inspectCertificate(certPath, false);
  const certificate = new X509Certificate(fs.readFileSync(certPath, 'utf8'));
  const privateKey = createPrivateKey(fs.readFileSync(keyPath, 'utf8'));
  const certificateKey = certificate.publicKey.export({ type: 'spki', format: 'der' });
  const privatePublicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const pairMatches = certificateKey.equals(privatePublicKey);
  const cuitMatches = /^\d{11}$/.test(cuit) && certificate.subject.replace(/\D/g, '').includes(cuit);
  if (!pairMatches) throw error('CERTIFICATE_KEY_MISMATCH', 'El certificado y la clave no coinciden.');
  if (!cuitMatches) throw error('CERTIFICATE_CUIT_MISMATCH', 'El CUIT esperado no coincide con el sujeto del certificado.');
  return { ok: true, command: 'verify-pair', cuitMatches, pairMatches, ...info };
}

function verifyCuit() {
  const certPath = secretPath('--cert');
  const cuit = digits(value('--cuit'));
  if (!/^\d{11}$/.test(cuit)) throw error('INVALID_CUIT', 'El CUIT debe tener 11 dígitos.');
  const certificate = new X509Certificate(fs.readFileSync(certPath, 'utf8'));
  const cuitMatches = certificate.subject.replace(/\D/g, '').includes(cuit);
  return { ok: cuitMatches, command: 'verify-cuit', cuitMatches, subject: certificate.subject };
}

function verifyValidity() {
  const certPath = secretPath('--cert');
  const info = inspectCertificate(certPath, false);
  if (info.expired) throw error('CERTIFICATE_EXPIRED', 'El certificado no está vigente.');
  return { ok: true, command: 'verify-validity', ...info };
}

function inspectCertificate(certPath, includeCommand = true) {
  const certificate = new X509Certificate(fs.readFileSync(certPath, 'utf8'));
  const now = Date.now();
  const validFrom = new Date(certificate.validFrom);
  const validTo = new Date(certificate.validTo);
  const daysRemaining = Math.floor((validTo.getTime() - now) / 86_400_000);
  return {
    ok: validFrom.getTime() <= now && now < validTo.getTime(),
    ...(includeCommand ? { command: 'inspect-cert' } : {}),
    subject: certificate.subject,
    issuer: certificate.issuer,
    fingerprint256: certificate.fingerprint256,
    validFrom: validFrom.toISOString(),
    validTo: validTo.toISOString(),
    daysRemaining,
    expired: now < validFrom.getTime() || now >= validTo.getTime(),
    expiringSoon: daysRemaining < 30,
    certificatePrinted: false,
  };
}

function verifyChain() {
  const cert = secretPath('--cert');
  const ca = secretPath('--ca');
  const result = spawnSync('openssl', ['verify', '-CAfile', ca, cert], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (result.error || result.status !== 0) throw error('CERTIFICATE_CHAIN_INVALID', 'La cadena del certificado no pudo validarse.');
  return { ok: true, command: 'verify-chain', chainVerified: true, certificatePrinted: false };
}

function checkClock() {
  const reference = value('--reference', false);
  const now = new Date();
  if (!reference) return { ok: true, command: 'check-clock', verified: false, systemTime: now.toISOString(), reference: 'not supplied' };
  const referenceDate = new Date(reference);
  if (Number.isNaN(referenceDate.getTime())) throw error('INVALID_CLOCK_REFERENCE', 'La referencia de reloj no es una fecha ISO válida.');
  const offsetMs = now.getTime() - referenceDate.getTime();
  return { ok: Math.abs(offsetMs) <= 300_000, command: 'check-clock', verified: true, systemTime: now.toISOString(), reference: referenceDate.toISOString(), offsetSeconds: Math.round(offsetMs / 1000), withinFiveMinutes: Math.abs(offsetMs) <= 300_000 };
}

function bundleSecrets() {
  const cert = secretPath('--cert');
  const key = secretPath('--key');
  const serviceRole = secretPath('--service-role');
  const output = writableDirectory('--out');
  const verification = verifyPairWithPaths(cert, key, value('--cuit'));
  fs.mkdirSync(output, { recursive: true });
  const files = { certificate: 'arca-certificate.pem', privateKey: 'arca-private-key.pem', serviceRole: 'supabase-service-role.txt' };
  fs.copyFileSync(cert, path.join(output, files.certificate), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(key, path.join(output, files.privateKey), fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(serviceRole, path.join(output, files.serviceRole), fs.constants.COPYFILE_EXCL);
  writeSecret(path.join(output, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), files, cuitMatches: verification.cuitMatches, pairMatches: verification.pairMatches, fingerprint256: verification.fingerprint256 }, null, 2));
  return { ok: true, command: 'bundle', output: path.basename(output), files, privateKeyPrinted: false, manifestContainsSecrets: false };
}

async function checkHealth() {
  const base = value('--url', false) || 'http://127.0.0.1:8787';
  const parsed = new URL(base);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) throw error('HEALTH_URL_NOT_PRIVATE', 'El health check sólo admite loopback.');
  const results = [];
  for (const endpoint of ['/health', '/ready']) {
    try {
      const response = await fetch(new URL(endpoint, base), { redirect: 'error' });
      const body = await response.json().catch(() => ({}));
      results.push({ endpoint, httpStatus: response.status, body });
    } catch (cause) {
      results.push({ endpoint, httpStatus: null, error: String(cause?.message || cause).slice(0, 160) });
    }
  }
  return { ok: results.some((item) => item.httpStatus === 200) && results.every((item) => item.endpoint !== '/ready' || item.httpStatus === 200), command: 'health', privateEndpointOnly: true, results };
}

function verifyPairWithPaths(certPath, keyPath, cuit) {
  const certificate = new X509Certificate(fs.readFileSync(certPath, 'utf8'));
  const privateKey = createPrivateKey(fs.readFileSync(keyPath, 'utf8'));
  const pairMatches = certificate.publicKey.export({ type: 'spki', format: 'der' }).equals(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }));
  const normalizedCuit = digits(cuit);
  const cuitMatches = /^\d{11}$/.test(normalizedCuit) && certificate.subject.replace(/\D/g, '').includes(normalizedCuit);
  if (!pairMatches || !cuitMatches) throw error('CREDENTIALS_INVALID', 'El bundle requiere certificado, clave y CUIT compatibles.');
  return { pairMatches, cuitMatches, fingerprint256: certificate.fingerprint256 };
}

function readPath(flag, required = true) { return required ? secretPath(flag) : secretPath(flag); }
function secretPath(flag) { const candidate = value(flag); const resolved = absolute(candidate); if (!fs.statSync(resolved).isFile()) throw error('NOT_A_FILE', `${flag} no apunta a un archivo.`); return resolved; }
function writablePath(flag) { const resolved = absolute(value(flag)); assertOutsideRepo(resolved); return resolved; }
function writableDirectory(flag) { const resolved = absolute(value(flag)); assertOutsideRepo(resolved); return resolved; }
function ensureNewFile(file) { if (fs.existsSync(file)) throw error('REFUSING_OVERWRITE', `El archivo ya existe: ${path.basename(file)}.`); fs.mkdirSync(path.dirname(file), { recursive: true }); }
function writeSecret(file, content) { fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); try { fs.chmodSync(file, 0o600); } catch (_) { /* Windows ACLs are managed by the secret store. */ } }
function absolute(valueToResolve) { if (!valueToResolve || !path.isAbsolute(valueToResolve)) throw error('ABSOLUTE_PATH_REQUIRED', 'Usá una ruta absoluta fuera del repositorio.'); return path.resolve(valueToResolve); }
function assertOutsideRepo(candidate) { const relative = path.relative(REPO_ROOT, candidate); if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw error('SECRET_PATH_IN_REPOSITORY', 'Por seguridad, los secretos y bundles deben quedar fuera del repositorio.'); }
function value(flag, required = true) { const index = args.indexOf(flag); const next = index >= 0 ? args[index + 1] : undefined; if (required && (!next || next.startsWith('--'))) throw error('MISSING_ARGUMENT', `Falta ${flag}.`); return next || ''; }
function digits(valueToNormalize) { return String(valueToNormalize || '').replace(/\D/g, ''); }
function error(code, message) { return Object.assign(new Error(message), { code }); }

function subjectName(subject) {
  const attributes = subject.split('/').filter(Boolean).map((part) => {
    const separator = part.indexOf('=');
    if (separator < 1) throw error('INVALID_CSR_SUBJECT', 'Cada atributo del subject debe tener formato CLAVE=VALOR.');
    const key = part.slice(0, separator).toUpperCase();
    const value = part.slice(separator + 1);
    const oid = { C: '2.5.4.6', ST: '2.5.4.8', L: '2.5.4.7', O: '2.5.4.10', OU: '2.5.4.11', CN: '2.5.4.3', EMAILADDRESS: '1.2.840.113549.1.9.1' }[key];
    if (!oid || !value || /[\r\n]/.test(value)) throw error('INVALID_CSR_SUBJECT', 'Atributo de subject no permitido o vacío.');
    return derSet([derSequence([derOid(oid), derUtf8(value)])]);
  });
  if (!attributes.length) throw error('INVALID_CSR_SUBJECT', 'El subject del CSR no puede estar vacío.');
  return derSequence(attributes);
}

function derSequence(parts) { return derTlv(0x30, Buffer.concat(parts.map(toBuffer))); }
function derSet(parts) { return derTlv(0x31, Buffer.concat(parts.map(toBuffer))); }
function derInteger(value) { return derTlv(0x02, Buffer.from([value])); }
function derUtf8(value) { return derTlv(0x0c, Buffer.from(value, 'utf8')); }
function derBitString(value) { return derTlv(0x03, Buffer.concat([Buffer.from([0]), toBuffer(value)])); }
function derOid(value) {
  const parts = value.split('.').map(Number);
  const first = 40 * parts[0] + parts[1];
  const encoded = [first, ...parts.slice(2).flatMap(encodeOidPart)];
  return derTlv(0x06, Buffer.from(encoded));
}
function encodeOidPart(value) {
  const bytes = [value & 0x7f];
  let remaining = Math.floor(value / 128);
  while (remaining > 0) { bytes.unshift((remaining & 0x7f) | 0x80); remaining = Math.floor(remaining / 128); }
  return bytes;
}
function derTlv(tag, body) { const length = encodeLength(body.length); return Buffer.concat([Buffer.from([tag]), length, body]); }
function encodeLength(length) { if (length < 128) return Buffer.from([length]); const bytes = []; let remaining = length; while (remaining > 0) { bytes.unshift(remaining & 0xff); remaining >>>= 8; } return Buffer.from([0x80 | bytes.length, ...bytes]); }
function toBuffer(valueToBuffer) { return Buffer.isBuffer(valueToBuffer) ? valueToBuffer : Buffer.from(valueToBuffer); }
function toPem(label, bytes) { const base64 = bytes.toString('base64').match(/.{1,64}/g)?.join('\n') || ''; return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`; }
