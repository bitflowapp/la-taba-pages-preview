export function presentFiscalStatus(document = {}) {
  const status = String(document.state || document.status || document.fiscal_status || 'not_requested');
  if (status === 'authorized' && /^\d{14}$/.test(String(document.cae || ''))) {
    return Object.freeze({ tone: 'success', label: 'Factura autorizada', canPrintFiscal: true });
  }
  if (['pending', 'queued', 'processing', 'retry_wait', 'ambiguous'].includes(status)) {
    return Object.freeze({ tone: 'warning', label: 'Comprobante fiscal pendiente', canPrintFiscal: false });
  }
  if (['rejected', 'blocked', 'dead_letter', 'manual_review'].includes(status)) {
    return Object.freeze({ tone: 'danger', label: 'Requiere revisión fiscal', canPrintFiscal: false });
  }
  return Object.freeze({ tone: 'neutral', label: 'Sin solicitud fiscal', canPrintFiscal: false });
}
