// Genera la clave privada y el pedido de certificado (CSR) para WSASS.
//
//   node dist/src/create-csr.js --cuit 20123456786 --organization "La Taba SRL" \
//     --system taba-fiscal-homologacion --out /ruta/absoluta/fuera/del/repo
//
// El manual del usuario de WSASS documenta exactamente estos dos pasos:
//   openssl genrsa -out MiClavePrivada.key 2048
//   openssl req -new -key MiClavePrivada.key \
//     -subj "/C=AR/O=Empresa/CN=Sistema/serialNumber=CUIT nnnnnnnnnnn" -out MiPedidoCSR.csr
// Esta herramienta hace lo mismo sin depender de que OpenSSL esté instalado, y
// además impide los dos errores que arruinan el trámite: escribir la clave
// dentro del repositorio y equivocar el formato del serialNumber.
//
// La clave privada NO se imprime, no se copia y no sale de la carpeta indicada.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import forge from 'node-forge';
import { assertValidCuit } from './cuit.js';

export interface CsrRequest {
  cuit: string;
  organization: string;
  system: string;
  outputDirectory: string;
  keyBits?: number;
}

export interface CsrResult {
  privateKeyPath: string;
  csrPath: string;
  subject: string;
  csrPem: string;
}

export function buildCertificateSubject({ cuit, organization, system }: Pick<CsrRequest, 'cuit' | 'organization' | 'system'>): string {
  // Un CUIT mal tipeado acá se descubre recién con el certificado ya emitido
  // por ARCA para el CUIT equivocado, y ese viaje no se deshace.
  assertValidCuit(cuit, 'El CUIT del certificado');
  const trimmedOrganization = organization.trim();
  const trimmedSystem = system.trim();
  if (!trimmedOrganization) throw new Error('Falta el nombre de la empresa (O).');
  if (!/^[A-Za-z0-9._-]{3,60}$/.test(trimmedSystem)) throw new Error('El nombre del sistema (CN) admite letras, números, punto, guion y guion bajo.');
  // El formato del serialNumber es literal: "CUIT", un espacio, once dígitos.
  return `/C=AR/O=${trimmedOrganization}/CN=${trimmedSystem}/serialNumber=CUIT ${cuit}`;
}

export function createArcaCsr(request: CsrRequest, { repositoryRoot = process.cwd() } = {}): CsrResult {
  const subject = buildCertificateSubject(request);
  const directory = path.resolve(request.outputDirectory);
  if (!path.isAbsolute(request.outputDirectory)) throw new Error('La carpeta de salida debe ser una ruta absoluta.');
  const relative = path.relative(path.resolve(repositoryRoot), directory);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new Error('La clave privada no se guarda dentro del repositorio. Elegí una carpeta fuera del árbol de trabajo.');
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const privateKeyPath = path.join(directory, `${request.system}.key`);
  const csrPath = path.join(directory, `${request.system}.csr`);
  if (fs.existsSync(privateKeyPath)) {
    throw new Error('Ya existe una clave privada con ese nombre. No se pisa: un certificado emitido para otra clave deja de servir.');
  }

  const keys = forge.pki.rsa.generateKeyPair({ bits: request.keyBits || 2048 });
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([
    { shortName: 'C', value: 'AR' },
    { shortName: 'O', value: request.organization.trim() },
    { shortName: 'CN', value: request.system.trim() },
    { name: 'serialNumber', value: `CUIT ${request.cuit}` },
  ]);
  csr.sign(keys.privateKey, forge.md.sha256.create());

  fs.writeFileSync(privateKeyPath, forge.pki.privateKeyToPem(keys.privateKey), { encoding: 'utf8', mode: 0o600 });
  const csrPem = forge.pki.certificationRequestToPem(csr);
  fs.writeFileSync(csrPath, csrPem, { encoding: 'utf8', mode: 0o600 });
  return { privateKeyPath, csrPath, subject, csrPem };
}

function argumentValue(flag: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? String(process.argv[index + 1] || '') : '';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = createArcaCsr({
      cuit: argumentValue('--cuit').replace(/\D/g, ''),
      organization: argumentValue('--organization'),
      system: argumentValue('--system') || 'taba-fiscal-homologacion',
      outputDirectory: argumentValue('--out'),
    }, { repositoryRoot: path.resolve(path.dirname(process.argv[1]), '..', '..', '..') });
    process.stdout.write([
      `Subject: ${result.subject}`,
      `Clave privada: ${result.privateKeyPath}  (permisos 600, no la muevas ni la copies)`,
      `Pedido de certificado: ${result.csrPath}`,
      '',
      'Pegá el contenido del .csr en WSASS para obtener el certificado de homologación,',
      'y después autorizá ese certificado al servicio wsfe para el CUIT representado.',
      '',
      result.csrPem,
    ].join('\n'));
  } catch (error) {
    process.stderr.write(`${String((error as Error)?.message || error)}\n`);
    process.exitCode = 1;
  }
}
