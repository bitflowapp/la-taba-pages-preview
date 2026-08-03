import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { buildFiscalQrUrl, type FiscalQrData } from './qr.js';

export const FISCAL_PDF_GENERATOR_VERSION = 'taba-fiscal-pdf-2026.08.02.1';
const A4: [number, number] = [595.28, 841.89];
const PDF_EPOCH = new Date('2000-01-01T00:00:00.000Z');

export interface ReceiptPdfItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  netAmount?: number;
  taxAmount?: number;
  taxCode?: number | null;
}

export interface ReceiptPdfInput {
  businessName: string;
  legalName?: string;
  cuit?: string;
  address?: string;
  recipientName?: string;
  recipientCondition?: string;
  recipientDocumentType?: number;
  recipientDocumentNumber?: string;
  documentLabel: string;
  pointOfSale?: number;
  documentNumber?: number;
  issueDate: string;
  currencyCode?: string;
  items: ReadonlyArray<ReceiptPdfItem>;
  netAmount?: number;
  vatAmount?: number;
  exemptAmount?: number;
  nonTaxedAmount?: number;
  otherTaxesAmount?: number;
  totalAmount: number;
  cae?: string;
  caeExpiration?: string;
  qr?: FiscalQrData;
  associatedDocument?: {
    documentType: number;
    pointOfSale: number;
    documentNumber: number;
    issueDate?: string;
  };
  legends?: ReadonlyArray<string>;
}

export interface AuthorizedReceiptPdfInput extends ReceiptPdfInput {
  cae: string;
  caeExpiration: string;
  qr: FiscalQrData;
}

/**
 * Generates a stable A4 layout. The pending variant deliberately omits QR/CAE
 * and exists only for internal diagnostics; the artifact worker uses the strict
 * authorized entry point below.
 */
export async function createReceiptPdf(input: ReceiptPdfInput): Promise<Uint8Array> {
  return renderReceipt(input, false);
}

export async function createAuthorizedFiscalPdf(input: AuthorizedReceiptPdfInput): Promise<Uint8Array> {
  if (!/^\d{14}$/.test(input.cae)) throw new Error('No se genera PDF fiscal autorizado sin CAE válido.');
  if (!input.qr || input.qr.authorizationCode !== input.cae) throw new Error('El QR debe corresponder al CAE autorizado.');
  if (!input.documentNumber || input.documentNumber < 1) throw new Error('El PDF fiscal requiere número de comprobante.');
  return renderReceipt(input, true);
}

export function sha256Pdf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function renderReceipt(input: ReceiptPdfInput, requireAuthorization: boolean): Promise<Uint8Array> {
  const authorized = /^\d{14}$/.test(String(input.cae || '')) && Boolean(input.qr);
  if (requireAuthorization && !authorized) throw new Error('Autorización fiscal ausente.');
  if (input.items.length > 200) throw new Error('El comprobante excede el máximo de ítems permitido.');
  const document = await PDFDocument.create();
  document.setTitle(safePdfText(`${input.documentLabel} ${input.pointOfSale || 0}-${input.documentNumber || 0}`, 120));
  document.setAuthor(safePdfText(input.legalName || input.businessName, 120));
  document.setCreator('TABA Negocio');
  document.setProducer('TABA Negocio Fiscal PDF');
  document.setCreationDate(PDF_EPOCH);
  document.setModificationDate(PDF_EPOCH);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const renderer = new ReceiptRenderer(document, regular, bold);

  renderer.text(input.businessName, 18, true);
  if (input.legalName && input.legalName !== input.businessName) renderer.text(`Razón social: ${input.legalName}`);
  if (input.cuit) renderer.text(`CUIT: ${input.cuit}`);
  if (input.address) renderer.text(`Domicilio: ${input.address}`);
  renderer.gap(5);
  renderer.text(input.documentLabel, 14, true);
  renderer.text(`Fecha de emisión: ${formatIssueDate(input.issueDate)}`);
  renderer.text(`Comprobante: ${formatNumber(input.pointOfSale)}-${formatNumber(input.documentNumber, 8)}`);
  renderer.text(`Moneda: ${safePdfText(input.currencyCode || 'PES', 10)}`);
  renderer.gap(4);

  if (input.recipientName || input.recipientCondition || input.recipientDocumentType) {
    renderer.text('Receptor', 11, true);
    if (input.recipientName) renderer.text(`Nombre: ${input.recipientName}`);
    if (input.recipientCondition) renderer.text(`Condición: ${input.recipientCondition}`);
    if (input.recipientDocumentType && input.recipientDocumentNumber) renderer.text(`Documento: ${input.recipientDocumentType} ${input.recipientDocumentNumber}`);
    renderer.gap(4);
  }

  renderer.text('Detalle', 11, true);
  for (const item of input.items) {
    const components = [
      `PU ${money(item.unitPrice)}`,
      item.netAmount !== undefined ? `Neto ${money(item.netAmount)}` : '',
      item.taxAmount !== undefined ? `IVA ${money(item.taxAmount)}` : '',
      `Total ${money(item.amount)}`,
    ].filter(Boolean).join(' · ');
    const line = `${money(item.quantity)} × ${safePdfText(item.description, 180)} · ${components}`;
    renderer.text(line, 9);
  }
  renderer.gap(4);
  renderer.text(`Neto: ${money(input.netAmount || 0)}`);
  renderer.text(`IVA: ${money(input.vatAmount || 0)}`);
  renderer.text(`Exento: ${money(input.exemptAmount || 0)}`);
  renderer.text(`No gravado: ${money(input.nonTaxedAmount || 0)}`);
  renderer.text(`Otros tributos: ${money(input.otherTaxesAmount || 0)}`);
  renderer.text(`TOTAL: ${money(input.totalAmount)}`, 14, true);

  if (input.associatedDocument) {
    renderer.gap(5);
    renderer.text('Comprobante asociado', 11, true);
    renderer.text(`Tipo ${input.associatedDocument.documentType} · ${formatNumber(input.associatedDocument.pointOfSale)}-${formatNumber(input.associatedDocument.documentNumber, 8)}${input.associatedDocument.issueDate ? ` · ${formatIssueDate(input.associatedDocument.issueDate)}` : ''}`);
  }

  if (authorized) {
    renderer.gap(8);
    renderer.text(`CAE: ${input.cae}`, 11, true);
    renderer.text(`Vencimiento CAE: ${formatIssueDate(input.caeExpiration || '')}`);
    const qrUrl = buildFiscalQrUrl(input.qr!);
    const dataUrl = await QRCode.toDataURL(qrUrl, {
      errorCorrectionLevel: 'M', margin: 1, width: 220, color: { dark: '#000000', light: '#FFFFFF' },
    });
    const image = await document.embedPng(Buffer.from(dataUrl.split(',')[1] || '', 'base64'));
    renderer.image(image, 142);
  } else {
    renderer.gap(8);
    renderer.text('Comprobante interno no fiscal — autorización pendiente', 12, true);
    renderer.text('No contiene CAE ni QR fiscal. No acredita autorización de ARCA.');
  }

  for (const legend of input.legends || []) {
    const value = safePdfText(legend, 300);
    if (value) renderer.text(value, 8);
  }
  renderer.text(`Generador: ${FISCAL_PDF_GENERATOR_VERSION}`, 7);
  const bytes = await document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  if (bytes.byteLength > 16_777_216) throw new Error('El PDF fiscal excede el límite de almacenamiento.');
  return bytes;
}

class ReceiptRenderer {
  #page: PDFPage;
  #y = 795;
  readonly #document: PDFDocument;
  readonly #regular: PDFFont;
  readonly #bold: PDFFont;

  constructor(document: PDFDocument, regular: PDFFont, bold: PDFFont) {
    this.#document = document;
    this.#regular = regular;
    this.#bold = bold;
    this.#page = document.addPage(A4);
  }

  text(value: string, size = 10, isBold = false): void {
    const lines = wrap(this.#regular, safePdfText(value, 300), size, 505);
    const required = lines.length * (size + 4) + 3;
    this.ensure(required);
    for (const line of lines) {
      this.#page.drawText(line, { x: 45, y: this.#y, size, font: isBold ? this.#bold : this.#regular, color: rgb(0.12, 0.13, 0.15) });
      this.#y -= size + 4;
    }
    this.#y -= 3;
  }

  gap(points: number): void {
    this.ensure(points + 5);
    this.#y -= points;
  }

  image(image: Awaited<ReturnType<PDFDocument['embedPng']>>, size: number): void {
    this.ensure(size + 15);
    this.#page.drawImage(image, { x: 45, y: this.#y - size, width: size, height: size });
    this.#y -= size + 12;
  }

  ensure(required: number): void {
    if (this.#y - required >= 45) return;
    this.#page = this.#document.addPage(A4);
    this.#y = 795;
  }
}

function wrap(font: PDFFont, value: string, size: number, width: number): string[] {
  if (!value) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of value.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function safePdfText(value: string, limit: number): string {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function money(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;
  return amount.toFixed(2);
}

function formatNumber(value: number | undefined, digits = 5): string {
  return Number.isSafeInteger(value) && Number(value) > 0 ? String(value).padStart(digits, '0') : '—';
}

function formatIssueDate(value: string): string {
  const compact = String(value || '').replace(/-/g, '');
  return /^\d{8}$/.test(compact) ? `${compact.slice(6, 8)}/${compact.slice(4, 6)}/${compact.slice(0, 4)}` : safePdfText(String(value || '—'), 20);
}
