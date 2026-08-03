export interface FiscalQrData {
  issueDate: string;
  cuit: string;
  pointOfSale: number;
  documentType: number;
  documentNumber: number;
  totalAmount: number;
  currencyCode: string;
  currencyRate: number;
  recipientDocumentType?: number;
  recipientDocumentNumber?: string;
  authorizationType: 'E' | 'A';
  authorizationCode: string;
}

export function buildFiscalQrPayload(data: FiscalQrData): Record<string, string | number> {
  if (!/^\d{14}$/.test(data.authorizationCode)) throw new Error('No se genera QR fiscal sin CAE/CAEA válido.');
  if (!/^\d{11}$/.test(data.cuit) || !/^\d{4}-\d{2}-\d{2}$/.test(data.issueDate)) throw new Error('Datos fiscales inválidos para QR.');
  const payload: Record<string, string | number> = {
    ver: 1,
    fecha: data.issueDate,
    cuit: Number(data.cuit),
    ptoVta: data.pointOfSale,
    tipoCmp: data.documentType,
    nroCmp: data.documentNumber,
    importe: roundMoney(data.totalAmount),
    moneda: data.currencyCode,
    ctz: data.currencyRate,
  };
  if (data.recipientDocumentType != null && data.recipientDocumentNumber) {
    payload.tipoDocRec = data.recipientDocumentType;
    payload.nroDocRec = Number(data.recipientDocumentNumber);
  }
  payload.tipoCodAut = data.authorizationType;
  payload.codAut = Number(data.authorizationCode);
  return Object.freeze(payload);
}

export function buildFiscalQrUrl(data: FiscalQrData): string {
  const json = JSON.stringify(buildFiscalQrPayload(data));
  const encoded = Buffer.from(json, 'utf8').toString('base64');
  return `https://www.arca.gob.ar/fe/qr/?p=${encodeURIComponent(encoded)}`;
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('Importe QR inválido.');
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
