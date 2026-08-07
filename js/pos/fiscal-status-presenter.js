import {
  FISCAL_PUBLIC_STATE_LABELS,
  fiscalPublicState,
  fiscalPublicStateTone,
} from '../core/fiscal-domain.js';

// La pantalla dice exactamente una de cinco cosas: pendiente, procesando,
// autorizado, rechazado o requiere atención. El detalle explica el porqué sin
// contradecir la etiqueta, y jamás afirma que algo se emitió sin CAE.
const DETAILS = Object.freeze({
  not_requested: 'No se pidió comprobante para esta operación.',
  draft: 'El comprobante todavía no se encoló.',
  queued: 'En cola para pedirle el CAE a ARCA.',
  claiming: 'Un worker tomó el trabajo.',
  authenticating: 'Autenticando contra ARCA.',
  authorizing: 'Esperando la respuesta de ARCA.',
  retry_wait: 'Falla transitoria: se reintenta solo.',
  ambiguous: 'No sabemos si ARCA autorizó: se consulta antes de reenviar.',
  rejected: 'ARCA rechazó el comprobante.',
  failed: 'La emisión se detuvo y necesita intervención.',
  manual_review: 'Falta una decisión fiscal: revisá la configuración.',
  credited: 'Acreditado con nota de crédito.',
  observed: 'ARCA autorizó con observaciones.',
});

export function presentFiscalStatus(document = {}) {
  const rawState = String(document.state || document.status || document.fiscal_status || 'not_requested');
  const cae = String(document.cae || '');
  if (rawState === 'not_requested') {
    return Object.freeze({
      publicState: 'pending',
      label: FISCAL_PUBLIC_STATE_LABELS.pending,
      detail: DETAILS.not_requested,
      tone: 'neutral',
      canPrintFiscal: false,
      rawState,
    });
  }
  const publicState = fiscalPublicState(rawState, cae);
  const inconsistent = ['authorized', 'credited', 'observed'].includes(rawState) && publicState === 'attention';
  return Object.freeze({
    publicState,
    label: FISCAL_PUBLIC_STATE_LABELS[publicState],
    detail: inconsistent
      ? 'El backend marcó autorización sin un CAE de catorce dígitos: no se imprime nada.'
      : DETAILS[rawState] || 'Estado fiscal desconocido: se trata como problema, no como éxito.',
    tone: fiscalPublicStateTone(publicState),
    // Sólo se imprime un comprobante fiscal con CAE válido. Nunca por estado.
    canPrintFiscal: publicState === 'authorized' && rawState !== 'credited',
    rawState,
  });
}
