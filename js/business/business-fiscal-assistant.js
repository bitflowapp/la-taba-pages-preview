// Asistente de facturación ARCA para el panel del negocio.
// Reutiliza el puente fiscal existente: acá sólo se lee el estado publicado y se lo explica.
// Nunca se muestran ni se guardan la clave privada, el ticket de acceso ni el detalle técnico del intercambio.

import { humanizeFailure } from './business-operation-language.js';

export const ARCA_HOMOLOGATION_PHRASE = 'I_AUTHORIZE_ARCA_HOMOLOGATION';
export const ARCA_PRODUCTION_PHRASE = 'I_AUTHORIZE_ARCA_PRODUCTION';

export const ARCA_STEPS = Object.freeze([
  'tax-data', 'accountant', 'certificate', 'delegation', 'point-of-sale',
  'connection', 'invoice-test', 'credit-note-test', 'print-test', 'production-lock',
]);

const STEP_COPY = Object.freeze({
  'tax-data': {
    title: 'Datos fiscales del negocio',
    why: 'Son los datos que ARCA va a comparar en cada comprobante.',
    todo: 'Cargá razón social, CUIT, condición frente al IVA y domicilio comercial.',
    pending: 'Faltan datos fiscales por cargar.',
  },
  accountant: {
    title: 'Visto bueno del contador',
    why: 'Alguien tiene que hacerse cargo de cómo se factura.',
    todo: 'Pedile al contador que revise los datos y marcá su aprobación acá.',
    pending: 'El contador todavía no aprobó la configuración.',
  },
  certificate: {
    title: 'Certificado y clave',
    why: 'Es lo que le prueba a ARCA que sos vos.',
    todo: 'Generá el certificado en ARCA y entregáselo al soporte. La clave privada se queda en el servidor.',
    pending: 'Todavía no hay un certificado cargado y vigente.',
  },
  delegation: {
    title: 'Permiso para facturar',
    why: 'ARCA exige autorizar el servicio de facturación para este CUIT.',
    todo: 'En ARCA, autorizá el servicio de facturación electrónica al certificado que cargaste.',
    pending: 'La autorización en ARCA figura como pendiente.',
  },
  'point-of-sale': {
    title: 'Punto de venta',
    why: 'Cada comprobante se numera dentro de un punto de venta.',
    todo: 'Dá de alta el punto de venta en ARCA y anotá el mismo número acá.',
    pending: 'Falta definir el punto de venta.',
  },
  connection: {
    title: 'Probar la conexión',
    why: 'Antes de facturar hay que ver que ARCA responda.',
    todo: 'Ejecutá la prueba de conexión. Si falla, te decimos qué revisar.',
    pending: 'La conexión con ARCA todavía no se probó con éxito.',
  },
  'invoice-test': {
    title: 'Factura de prueba',
    why: 'Confirma que ARCA autoriza y devuelve el código de autorización.',
    todo: 'Emití una factura en el ambiente de prueba y verificá que vuelva autorizada.',
    pending: 'Todavía no hay una factura de prueba autorizada.',
  },
  'credit-note-test': {
    title: 'Nota de crédito de prueba',
    why: 'Vas a necesitarla el día que tengas que anular una venta.',
    todo: 'Emití una nota de crédito de prueba sobre la factura anterior.',
    pending: 'Todavía no hay una nota de crédito de prueba autorizada.',
  },
  'print-test': {
    title: 'QR, PDF e impresión',
    why: 'El cliente se lleva el papel: tiene que salir bien.',
    todo: 'Abrí el comprobante de prueba, revisá el QR y mandalo a imprimir.',
    pending: 'Falta verificar el PDF con QR y una impresión.',
  },
  'production-lock': {
    title: 'Facturación real: apagada',
    why: 'Mientras probás, nadie debería recibir una factura real por error.',
    todo: 'No hay nada que hacer. Este paso confirma que la facturación real sigue apagada.',
    pending: 'La facturación real quedó habilitada. Revisalo con el contador.',
  },
});

export function evaluateArcaActivation(snapshot = {}) {
  const status = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const environment = String(status.environment || 'disabled');
  const outcomes = {
    'tax-data': Boolean(status.legal_name && status.cuit_valid && status.tax_condition && status.business_address),
    accountant: String(status.accountant_review_status || 'pending') === 'approved',
    certificate: Boolean(status.certificate_loaded) && !isExpired(status.certificate_expires_at) && !status.certificate_cuit_mismatch,
    delegation: String(status.delegation_status || 'pending') === 'verified',
    'point-of-sale': Number.isSafeInteger(Number(status.point_of_sale)) && Number(status.point_of_sale) > 0,
    connection: Boolean(status.connection_ok_at),
    'invoice-test': Number(status.homologated_invoices || 0) > 0,
    'credit-note-test': Number(status.homologated_credit_notes || 0) > 0,
    'print-test': Boolean(status.artifact_verified_at) && Boolean(status.print_verified_at),
    'production-lock': environment !== 'production',
  };

  const steps = [];
  let firstPending = null;
  for (const id of ARCA_STEPS) {
    const done = outcomes[id] === true;
    if (id === 'production-lock') {
      steps.push(buildStep(id, done ? 'done' : 'blocked', status));
      continue;
    }
    const state = done ? 'done' : firstPending === null ? 'current' : 'waiting';
    if (!done && firstPending === null) firstPending = id;
    steps.push(buildStep(id, state, status));
  }

  const readyToHomologate = ['tax-data', 'accountant', 'certificate', 'delegation', 'point-of-sale']
    .every((id) => outcomes[id] === true);
  const homologationComplete = ARCA_STEPS.every((id) => outcomes[id] === true);

  return Object.freeze({
    steps: Object.freeze(steps),
    currentStep: firstPending || 'production-lock',
    readyToHomologate,
    homologationComplete,
    homologationAuthorized: Boolean(status.homologation_authorized_at),
    productionEnabled: environment === 'production',
    headline: headlineFor({ environment, readyToHomologate, homologationComplete }),
    board: buildStatusBoard(status),
    blockers: Object.freeze(buildBlockers(status, outcomes)),
  });
}

// Tablero de estado: lo que el prompt exige mostrar, ya traducido y sin secretos.
export function buildStatusBoard(snapshot = {}) {
  const status = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const expires = status.certificate_expires_at ? new Date(status.certificate_expires_at) : null;
  const daysLeft = expires && !Number.isNaN(expires.getTime())
    ? Math.floor((expires.getTime() - Date.now()) / 86_400_000)
    : null;
  return Object.freeze([
    Object.freeze({
      key: 'certificate',
      label: 'Certificado',
      value: !status.certificate_loaded
        ? 'Sin cargar'
        : isExpired(status.certificate_expires_at)
          ? 'Vencido'
          : 'Vigente',
      detail: expires && !Number.isNaN(expires.getTime())
        ? `Vence el ${formatDate(expires)}${daysLeft !== null && daysLeft >= 0 ? ` · quedan ${daysLeft} día${daysLeft === 1 ? '' : 's'}` : ''}`
        : 'Sin fecha de vencimiento conocida',
      tone: !status.certificate_loaded || isExpired(status.certificate_expires_at)
        ? 'danger'
        : daysLeft !== null && daysLeft <= 30 ? 'warning' : 'success',
    }),
    Object.freeze({
      key: 'cuit',
      label: 'CUIT',
      value: formatCuit(status.cuit),
      detail: status.certificate_cuit_mismatch
        ? 'El CUIT del certificado no coincide con el del negocio'
        : status.cuit_valid ? 'Coincide con el certificado' : 'Sin verificar',
      tone: status.certificate_cuit_mismatch ? 'danger' : status.cuit_valid ? 'success' : 'warning',
    }),
    Object.freeze({
      key: 'point-of-sale',
      label: 'Punto de venta',
      value: Number(status.point_of_sale) > 0 ? String(status.point_of_sale) : 'Sin definir',
      detail: Number(status.point_of_sale) > 0 ? 'Se usa para numerar los comprobantes' : 'Dalo de alta en ARCA primero',
      tone: Number(status.point_of_sale) > 0 ? 'success' : 'warning',
    }),
    Object.freeze({
      key: 'delegation',
      label: 'Permiso para facturar',
      value: String(status.delegation_status || 'pending') === 'verified' ? 'Verificado' : 'Pendiente',
      detail: String(status.delegation_status || 'pending') === 'verified'
        ? 'ARCA reconoce el certificado para facturar'
        : 'Falta autorizar el servicio en ARCA',
      tone: String(status.delegation_status || 'pending') === 'verified' ? 'success' : 'warning',
    }),
    Object.freeze({
      key: 'last-document',
      label: 'Último comprobante',
      value: status.last_document_label ? String(status.last_document_label) : 'Todavía ninguno',
      detail: status.last_document_at ? `Emitido el ${formatDate(new Date(status.last_document_at))}` : 'Cuando emitas uno, aparece acá',
      tone: status.last_document_failed ? 'warning' : 'info',
    }),
    Object.freeze({
      key: 'queue',
      label: 'Comprobantes en espera',
      value: String(Math.max(0, Number(status.pending_documents || 0))),
      detail: Number(status.stalled_documents || 0) > 0
        ? `${Number(status.stalled_documents)} llevan demasiado tiempo esperando`
        : 'Se procesan solos a medida que ARCA responde',
      tone: Number(status.stalled_documents || 0) > 0 ? 'danger' : Number(status.pending_documents || 0) > 0 ? 'warning' : 'success',
    }),
    Object.freeze({
      key: 'last-error',
      label: 'Último problema',
      value: status.last_error_code ? translateFiscalError(status.last_error_code) : 'Sin problemas registrados',
      detail: status.last_error_at ? `Ocurrió el ${formatDate(new Date(status.last_error_at))}` : '',
      tone: status.last_error_code ? 'warning' : 'success',
    }),
    Object.freeze({
      key: 'environment',
      label: 'Modo de facturación',
      value: environmentLabel(status.environment),
      detail: String(status.environment || 'disabled') === 'production'
        ? 'Los comprobantes que emitas son reales'
        : 'Las pruebas no generan comprobantes reales',
      tone: String(status.environment || 'disabled') === 'production' ? 'warning' : 'success',
    }),
  ]);
}

export function validateHomologationAuthorization(phrase) {
  if (String(phrase || '').trim() !== ARCA_HOMOLOGATION_PHRASE) {
    return Object.freeze({
      ok: false,
      message: `Para habilitar las pruebas con ARCA, escribí exactamente ${ARCA_HOMOLOGATION_PHRASE}.`,
    });
  }
  return Object.freeze({ ok: true, message: '' });
}

export function validateProductionAuthorization(phrase) {
  if (String(phrase || '').trim() !== ARCA_PRODUCTION_PHRASE) {
    return Object.freeze({
      ok: false,
      message: `Habilitar la facturación real necesita una autorización distinta: escribí exactamente ${ARCA_PRODUCTION_PHRASE}.`,
    });
  }
  return Object.freeze({ ok: true, message: '' });
}

// Los códigos que devuelve ARCA no le dicen nada a nadie en el mostrador.
const FISCAL_ERROR_COPY = Object.freeze({
  CERTIFICATE_EXPIRED: 'El certificado venció. Hay que generar uno nuevo en ARCA.',
  CERTIFICATE_MISSING: 'Falta cargar el certificado en el servidor.',
  CERTIFICATE_CUIT_MISMATCH: 'El certificado es de otro CUIT.',
  DELEGATION_MISSING: 'Falta autorizar el servicio de facturación en ARCA.',
  POINT_OF_SALE_UNKNOWN: 'ARCA no reconoce ese punto de venta.',
  AUTH_FAILED: 'ARCA no aceptó las credenciales.',
  SERVICE_UNAVAILABLE: 'ARCA no está respondiendo. Suele ser temporal.',
  NETWORK_UNREACHABLE: 'No hay conexión con ARCA desde el servidor.',
  DUPLICATE_DOCUMENT: 'Ese comprobante ya estaba emitido.',
  INVALID_TAX_TOTALS: 'Los importes del comprobante no cierran.',
  RATE_LIMITED: 'ARCA pidió esperar antes del próximo intento.',
});

export function translateFiscalError(code) {
  const key = String(code || '').toUpperCase();
  return FISCAL_ERROR_COPY[key] || 'ARCA devolvió un problema que soporte tiene que revisar.';
}

// Corta cualquier resto de intercambio técnico antes de mostrarlo.
export function sanitizeFiscalDetail(value) {
  const raw = String(value || '');
  if (/<[^>]+>/.test(raw)) return '';
  if (/-----BEGIN|PRIVATE KEY|CERTIFICATE|Bearer\s|token/i.test(raw)) return '';
  return humanizeFailure(raw, '');
}

function buildStep(id, state, status) {
  const copy = STEP_COPY[id];
  return Object.freeze({
    id,
    index: ARCA_STEPS.indexOf(id) + 1,
    title: copy.title,
    why: copy.why,
    todo: copy.todo,
    state,
    detail: state === 'done' ? doneDetail(id, status) : state === 'blocked' ? copy.pending : copy.pending,
  });
}

function doneDetail(id, status) {
  switch (id) {
    case 'tax-data': return `${status.legal_name || 'Negocio'} · CUIT ${formatCuit(status.cuit)}`;
    case 'accountant': return 'El contador dio el visto bueno.';
    case 'certificate': return `Vigente hasta el ${formatDate(new Date(status.certificate_expires_at))}.`;
    case 'delegation': return 'ARCA reconoce el certificado para facturar.';
    case 'point-of-sale': return `Punto de venta ${status.point_of_sale}.`;
    case 'connection': return `Última prueba exitosa el ${formatDate(new Date(status.connection_ok_at))}.`;
    case 'invoice-test': return `${Number(status.homologated_invoices || 0)} factura(s) de prueba autorizadas.`;
    case 'credit-note-test': return `${Number(status.homologated_credit_notes || 0)} nota(s) de crédito de prueba autorizadas.`;
    case 'print-test': return 'El PDF con QR se abrió y se imprimió.';
    case 'production-lock': return 'La facturación real sigue apagada, como corresponde mientras probás.';
    default: return '';
  }
}

function buildBlockers(status, outcomes) {
  const blockers = [];
  if (status.certificate_loaded && isExpired(status.certificate_expires_at)) {
    blockers.push('El certificado está vencido: ARCA va a rechazar todo hasta que lo renueves.');
  }
  if (status.certificate_cuit_mismatch) {
    blockers.push('El certificado pertenece a otro CUIT. No lo uses para este negocio.');
  }
  if (Number(status.stalled_documents || 0) > 0) {
    blockers.push('Hay comprobantes que llevan demasiado tiempo esperando. Revisá la conexión antes de emitir más.');
  }
  if (!outcomes.accountant && outcomes['tax-data']) {
    blockers.push('Los datos están cargados pero falta la aprobación del contador.');
  }
  return blockers;
}

function headlineFor({ environment, readyToHomologate, homologationComplete }) {
  if (environment === 'production') return 'La facturación real está habilitada';
  if (homologationComplete) return 'Las pruebas con ARCA están completas';
  if (readyToHomologate) return 'Todo listo para empezar a probar con ARCA';
  return 'Falta configurar la facturación';
}

function environmentLabel(value) {
  return ({ disabled: 'Apagada', homologation: 'Pruebas', production: 'Real' })[String(value || 'disabled')] || 'Apagada';
}

function isExpired(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() <= Date.now();
}

function formatCuit(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 11) return 'Sin cargar';
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'fecha desconocida';
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
