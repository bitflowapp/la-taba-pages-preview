// Representación fiscal SINTÉTICA, para mirarla con los ojos.
//
//   npm run fiscal:sample -- --out <ruta.pdf>
//
// Produce el mismo PDF que genera el worker de artefactos, con el mismo
// generador y el mismo layout, pero con datos de fixture y ambiente
// 'synthetic': nunca habló con ARCA y el CAE es inventado.
//
// Existe para que una persona pueda verificar la marca antes de que exista un
// comprobante de homologación de verdad. No acepta un caso fiscal real ni un
// CAE de afuera a propósito: esta herramienta no puede fabricar algo que se
// parezca a un comprobante emitido.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAuthorizedFiscalPdf, FISCAL_PDF_GENERATOR_VERSION, sha256Pdf } from './pdf.js';

/** CUIT de fixture: su dígito verificador cierra y no pertenece a nadie real. */
const SAMPLE_CUIT = '20123456786';
const SAMPLE_CAE = '99999999999999';

export function buildSampleDocument() {
  return {
    environment: 'synthetic' as const,
    documentState: 'authorized',
    documentTypeId: 6,
    businessName: 'Negocio de ejemplo',
    legalName: 'NEGOCIO DE EJEMPLO S.R.L.',
    cuit: SAMPLE_CUIT,
    address: 'Calle de ejemplo 123',
    recipientCondition: 'Consumidor Final',
    recipientDocumentType: 99,
    recipientDocumentNumber: '0',
    documentLabel: 'Factura fiscal',
    pointOfSale: 3,
    documentNumber: 1,
    issueDate: '20260807',
    currencyCode: 'PES',
    items: [
      { description: 'Producto de ejemplo A', quantity: 2, unitPrice: 1210, amount: 2420, netAmount: 2000, taxAmount: 420, taxCode: 5 },
      { description: 'Producto de ejemplo B', quantity: 1, unitPrice: 605, amount: 605, netAmount: 500, taxAmount: 105, taxCode: 5 },
      { description: 'Envío', quantity: 1, unitPrice: 484, amount: 484, netAmount: 400, taxAmount: 84, taxCode: 5 },
    ],
    netAmount: 2900,
    vatAmount: 609,
    exemptAmount: 0,
    nonTaxedAmount: 0,
    otherTaxesAmount: 0,
    totalAmount: 3509,
    cae: SAMPLE_CAE,
    caeExpiration: '20260817',
    qr: {
      issueDate: '2026-08-07', cuit: SAMPLE_CUIT, pointOfSale: 3, documentType: 6,
      documentNumber: 1, totalAmount: 3509, currencyCode: 'PES', currencyRate: 1,
      authorizationType: 'E' as const, authorizationCode: SAMPLE_CAE,
      recipientDocumentType: 99, recipientDocumentNumber: '0',
    },
    legends: ['Documento sintético generado para revisar el formato. No corresponde a ninguna operación.'],
  };
}

export async function writeSampleDocument(outPath: string): Promise<{ path: string; sha256: string; bytes: number }> {
  if (!path.isAbsolute(outPath)) throw new Error('La ruta de salida tiene que ser absoluta.');
  if (!outPath.toLowerCase().endsWith('.pdf')) throw new Error('La salida es un PDF.');
  const pdf = await createAuthorizedFiscalPdf(buildSampleDocument());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, pdf);
  return { path: outPath, sha256: sha256Pdf(pdf), bytes: pdf.byteLength };
}

async function main(argv: string[]): Promise<void> {
  const index = argv.indexOf('--out');
  const target = index >= 0 ? argv[index + 1] : undefined;
  if (!target) {
    process.stderr.write('Uso: npm run fiscal:sample -- --out <ruta absoluta .pdf>\n');
    process.exitCode = 2;
    return;
  }
  const result = await writeSampleDocument(path.resolve(target));
  process.stdout.write(`${JSON.stringify({
    ...result, environment: 'synthetic', generator: FISCAL_PDF_GENERATOR_VERSION,
    warning: 'Documento sintetico. No es un comprobante y su CAE es inventado.',
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
