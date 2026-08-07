import { FISCAL_DOCUMENT_STATES } from '../core/fiscal-domain.js';

// Presenta cada estado REAL del documento fiscal (FISCAL_DOCUMENT_STATES).
// Antes, `failed` y `credited` caían al default "Sin solicitud fiscal": un
// comprobante muerto en dead-letter se mostraba como si nunca se hubiera
// pedido, que es la peor mentira posible en una pantalla de facturación.
export function presentFiscalStatus(document = {}) {
  const status = String(document.state || document.status || document.fiscal_status || 'not_requested');
  if (status === 'authorized' && /^\d{14}$/.test(String(document.cae || ''))) {
    return Object.freeze({ tone: 'success', label: 'Factura autorizada', canPrintFiscal: true });
  }
  if (status === 'authorized') {
    // authorized sin CAE de 14 dígitos no existe como autorización real.
    return Object.freeze({ tone: 'danger', label: 'Autorización inconsistente (sin CAE)', canPrintFiscal: false });
  }
  if (status === 'credited') {
    return Object.freeze({ tone: 'info', label: 'Acreditada con nota de crédito', canPrintFiscal: false });
  }
  if (status === 'observed') {
    return Object.freeze({ tone: 'warning', label: 'Autorizada con observaciones de ARCA', canPrintFiscal: false });
  }
  if (['draft', 'queued', 'claiming', 'authenticating', 'authorizing', 'retry_wait', 'ambiguous', 'pending', 'processing'].includes(status)) {
    return Object.freeze({ tone: 'warning', label: 'Comprobante fiscal pendiente', canPrintFiscal: false });
  }
  if (['blocked', 'dead_letter', 'manual_review'].includes(status)) {
    return Object.freeze({ tone: 'danger', label: 'Requiere revisión fiscal', canPrintFiscal: false });
  }
  if (status === 'failed') {
    return Object.freeze({ tone: 'danger', label: 'Emisión fallida: requiere soporte', canPrintFiscal: false });
  }
  if (status === 'rejected') {
    return Object.freeze({ tone: 'danger', label: 'Rechazado por ARCA', canPrintFiscal: false });
  }
  if (FISCAL_DOCUMENT_STATES.includes(status)) {
    return Object.freeze({ tone: 'warning', label: `Estado fiscal ${status}: requiere revisión`, canPrintFiscal: false });
  }
  return Object.freeze({ tone: 'neutral', label: 'Sin solicitud fiscal', canPrintFiscal: false });
}
