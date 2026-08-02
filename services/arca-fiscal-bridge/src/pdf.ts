import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import { buildFiscalQrUrl, type FiscalQrData } from './qr.js';

export interface ReceiptPdfInput {
  businessName: string;
  legalName?: string;
  cuit?: string;
  address?: string;
  documentLabel: string;
  pointOfSale?: number;
  documentNumber?: number;
  issueDate: string;
  items: ReadonlyArray<{ description: string; quantity: number; unitPrice: number; amount: number }>;
  totalAmount: number;
  cae?: string;
  caeExpiration?: string;
  qr?: FiscalQrData;
}

export async function createReceiptPdf(input: ReceiptPdfInput): Promise<Uint8Array> {
  const authorized = /^\d{14}$/.test(String(input.cae || '')) && input.qr;
  const document = await PDFDocument.create();
  const page = document.addPage([595.28, 841.89]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let y = 795;
  const draw = (text: string, size = 10, isBold = false) => {
    page.drawText(safePdfText(text), { x: 45, y, size, font: isBold ? bold : regular, color: rgb(0.12, 0.13, 0.15), maxWidth: 505 });
    y -= size + 7;
  };
  draw(input.businessName, 18, true);
  if (input.legalName) draw(input.legalName, 10);
  if (input.cuit) draw(`CUIT: ${input.cuit}`);
  if (input.address) draw(input.address);
  y -= 8;
  draw(input.documentLabel, 14, true);
  draw(`Fecha: ${input.issueDate}`);
  if (input.pointOfSale && input.documentNumber) draw(`Comprobante: ${String(input.pointOfSale).padStart(5, '0')}-${String(input.documentNumber).padStart(8, '0')}`);
  y -= 8;
  for (const item of input.items) draw(`${item.quantity} × ${item.description} — $ ${item.amount.toFixed(2)}`);
  y -= 5;
  draw(`TOTAL: $ ${input.totalAmount.toFixed(2)}`, 14, true);
  y -= 10;
  if (authorized) {
    draw(`CAE: ${input.cae}`, 11, true);
    if (input.caeExpiration) draw(`Vencimiento CAE: ${input.caeExpiration}`);
    const qrUrl = buildFiscalQrUrl(input.qr!);
    const dataUrl = await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
    const image = await document.embedPng(Buffer.from(dataUrl.split(',')[1]!, 'base64'));
    page.drawImage(image, { x: 45, y: Math.max(55, y - 150), width: 145, height: 145 });
  } else {
    draw('Comprobante interno no fiscal — autorización pendiente', 12, true);
    draw('No contiene CAE ni QR fiscal. No acredita autorización de ARCA.');
  }
  document.setTitle(`${input.documentLabel} - ${input.businessName}`);
  document.setProducer('TABA Negocio');
  return document.save({ useObjectStreams: false });
}

function safePdfText(value: string): string {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').slice(0, 300);
}
