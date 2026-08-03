export type ArcaEnvironment = 'disabled' | 'homologation' | 'production';

export interface ArcaEndpoints {
  wsaa: string;
  wsfe: string;
}

export interface ArcaConfig {
  environment: ArcaEnvironment;
  cuit: string;
  certificatePath: string;
  privateKeyPath: string;
  workerId: string;
  healthPort: number;
  endpoints: ArcaEndpoints;
  homologationConsent: boolean;
  productionEnabled: boolean;
}

export interface LoginTicket {
  token: string;
  sign: string;
  generationTime: string;
  expirationTime: string;
  service: string;
}

export interface FiscalRequest {
  cuit: string;
  pointOfSale: number;
  documentType: number;
  concept: 1 | 2 | 3;
  recipientDocumentType: number;
  recipientDocumentNumber: string;
  documentNumber: number;
  issueDate: string;
  totalAmount: number;
  netAmount: number;
  vatAmount: number;
  exemptAmount: number;
  nonTaxedAmount: number;
  otherTaxesAmount: number;
  serviceFrom?: string;
  serviceTo?: string;
  paymentDueDate?: string;
  currencyCode: string;
  currencyRate: number;
  vatItems: ReadonlyArray<{ id: number; baseAmount: number; amount: number }>;
  documentIntent?: 'invoice' | 'credit_note';
  associatedDocument?: { documentType: number; pointOfSale: number; documentNumber: number; cuit?: string; issueDate?: string };
}

export type ArcaClassification =
  | 'authorized'
  | 'authorized_with_observations'
  | 'rejected'
  | 'ambiguous'
  | 'service_error';

export interface ArcaResult {
  classification: ArcaClassification;
  documentNumber?: number;
  cae?: string;
  caeExpiration?: string;
  issueDate?: string;
  totalAmount?: number;
  pointOfSale?: number;
  documentType?: number;
  observations: ReadonlyArray<{ code: string; message: string }>;
  errors: ReadonlyArray<{ code: string; message: string }>;
  requestHash?: string;
  responseHash?: string;
  errorCode?: string;
  errorMessage?: string;
}

export type FiscalParameterType =
  | 'document_types'
  | 'recipient_document_types'
  | 'vat_types'
  | 'currencies'
  | 'concepts'
  | 'points_of_sale';

export interface FiscalParameterSnapshot {
  environment: Exclude<ArcaEnvironment, 'disabled'>;
  parameterType: FiscalParameterType;
  operation: string;
  version: string;
  synchronizedAt: string;
  values: unknown;
  requestHash: string;
  responseHash: string;
}
