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

export function sanitizeFiscalErrorMessage(raw = '') {
  const str = String(raw || '');
  if (!str) return '';
  if (/<[^>]+>|soap:|xmlns/i.test(str)) {
    return 'ARCA devolvió un error que requiere revisión de configuración.';
  }
  if (/connection refused|econnrefused|etimedout|socket hang up/i.test(str)) {
    return 'Sin conexión con el servicio fiscal. Se reintentará automáticamente.';
  }
  return str.slice(0, 160);
}

export function presentOrderFiscalStatus({ document = null, printJob = null, agentOnline = true } = {}) {
  if (!document || !document.state) {
    return Object.freeze({
      code: 'UNBILLED',
      label: 'Sin facturar',
      tone: 'neutral',
      canBill: true,
      canPrint: false,
      canReprint: false,
      description: 'El pedido no fue enviado a facturar todavía.',
    });
  }

  const docState = String(document.state || '');

  if (docState === 'queued') {
    return Object.freeze({
      code: 'ISSUING',
      label: 'Emitiendo…',
      tone: 'info',
      canBill: false,
      canPrint: false,
      canReprint: false,
      description: 'Generando la solicitud fiscal para ARCA.',
    });
  }

  if (['leased', 'claiming', 'authenticating', 'authorizing', 'retry_wait', 'ambiguous'].includes(docState)) {
    return Object.freeze({
      code: 'VERIFYING',
      label: 'Verificando con ARCA…',
      tone: 'warning',
      canBill: false,
      canPrint: false,
      canReprint: false,
      description: 'Consultando autorización y CAE ante ARCA.',
    });
  }

  if (docState === 'authorized' && /^\d{14}$/.test(String(document.cae || ''))) {
    if (printJob && printJob.status) {
      const pStatus = String(printJob.status);
      if (['queued', 'claimed'].includes(pStatus)) {
        if (!agentOnline) {
          return Object.freeze({
            code: 'PC_DISCONNECTED',
            label: 'PC desconectada.',
            tone: 'warning',
            canBill: false,
            canPrint: true,
            canReprint: true,
            cae: document.cae,
            documentNumber: document.document_number,
            description: 'Factura autorizada. La PC de mostrador está apagada o sin agente.',
          });
        }
        return Object.freeze({
          code: 'PRINT_PENDING',
          label: 'Impresión pendiente.',
          tone: 'info',
          canBill: false,
          canPrint: true,
          canReprint: true,
          cae: document.cae,
          documentNumber: document.document_number,
          description: 'Factura autorizada. Esperando salida en impresora.',
        });
      }
      if (['printing', 'printed'].includes(pStatus)) {
        return Object.freeze({
          code: 'PRINT_SENT',
          label: 'Enviado a impresora.',
          tone: 'success',
          canBill: false,
          canPrint: true,
          canReprint: true,
          cae: document.cae,
          documentNumber: document.document_number,
          description: 'Ticket enviado a la cola de impresión local.',
        });
      }
      if (['failed', 'needs_review'].includes(pStatus)) {
        return Object.freeze({
          code: 'REVIEW_REQUIRED',
          label: 'Requiere revisión.',
          tone: 'warning',
          canBill: false,
          canPrint: true,
          canReprint: true,
          cae: document.cae,
          documentNumber: document.document_number,
          description: 'Factura autorizada, pero falló el envío a la impresora física.',
        });
      }
    }

    return Object.freeze({
      code: 'AUTHORIZED',
      label: 'Factura emitida.',
      tone: 'success',
      canBill: false,
      canPrint: true,
      canReprint: true,
      cae: document.cae,
      documentNumber: document.document_number,
      description: `Comprobante autorizado con CAE ${document.cae}.`,
    });
  }

  return Object.freeze({
    code: 'REVIEW_REQUIRED',
    label: 'Requiere revisión.',
    tone: 'danger',
    canBill: false,
    canPrint: false,
    canReprint: false,
    description: sanitizeFiscalErrorMessage(document.artifact_error_message || document.errors || 'Requiere revisión contable.'),
  });
}

