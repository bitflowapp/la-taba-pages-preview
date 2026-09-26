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
  /**
   * Ruta absoluta (volumen privado del worker) donde se guarda el Ticket de
   * Acceso vigente. WSAA no emite otro mientras el anterior vale (12 h,
   * `coe.alreadyAuthenticated`): sin esto, un reinicio deja al worker sin TA.
   */
  ticketCachePath?: string;
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
  /**
   * Condición frente al IVA del receptor (`CondicionIVAReceptorId`, RG 5616,
   * manual WSFEv1 4.0+). Sale de la política contable aprobada y se valida
   * contra `FEParamGetCondicionIvaReceptor`; ARCA rechaza con 10246 si falta.
   */
  recipientVatConditionId: number;
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
  /** Datos que devuelve FECompConsultar para conciliar (no se usan al emitir). */
  recipientDocumentType?: number;
  recipientDocumentNumber?: string;
  recipientVatConditionId?: number;
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
  | 'points_of_sale'
  | 'recipient_vat_conditions';

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
