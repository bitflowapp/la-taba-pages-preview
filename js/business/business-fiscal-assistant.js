// Asistente de facturación ARCA para el panel del negocio.
// Reutiliza el puente fiscal existente: acá sólo se lee el estado publicado y se lo explica.
// Nunca se muestran ni se guardan la clave privada, el ticket de acceso ni el detalle técnico del intercambio.

import { humanizeFailure } from './business-operation-language.js';

export const ARCA_HOMOLOGATION_PHRASE = 'I_AUTHORIZE_ARCA_HOMOLOGATION';
export const ARCA_PRODUCTION_PHRASE = 'I_AUTHORIZE_ARCA_PRODUCTION';

export const ARCA_STEPS = Object.freeze([
  'tax-data', 'accountant', 'certificate', 'delegation', 'point-of-sale',
  'connection', 'accounting-policy', 'invoice-test', 'credit-note-test', 'print-test', 'production-lock',
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
    todo: 'Pedile al contador que revise los datos fiscales y registrá su aprobación con la frase exacta. Queda asentado quién la aprobó y cuándo.',
    pending: 'El contador todavía no aprobó los datos fiscales.',
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
    todo: 'En ARCA, autorizá el servicio de facturación electrónica al certificado que cargaste. El servidor registra la verificación; sin ese registro el paso sigue pendiente.',
    pending: 'La autorización en ARCA figura como pendiente (la verifica el servidor de facturación).',
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
    todo: 'La prueba la corre el servidor de facturación; cuando ARCA responde bien, este paso se marca solo. Desde esta pantalla no se dispara.',
    pending: 'El servidor de facturación todavía no registró una conexión exitosa con ARCA.',
  },
  'accounting-policy': {
    title: 'Política contable aprobada',
    why: 'Es donde se declara qué comprobante se emite, con qué alícuota y a qué condición frente al IVA. El sistema no lo deduce.',
    todo: 'Declará la política con el contador y aprobala. Cada identificador se valida contra las tablas oficiales que el servidor baja de ARCA.',
    pending: 'Falta una política contable aprobada (o las tablas oficiales están desactualizadas).',
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
    'accounting-policy': status.accounting_policy_ready === true,
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
  // Autorizar homologación no alcanza para emitir: sin política aprobada y sin
  // tablas oficiales frescas, el circuito se detiene en la primera solicitud.
  const readyToEmit = readyToHomologate
    && outcomes.connection === true
    && outcomes['accounting-policy'] === true;
  const homologationComplete = ARCA_STEPS.every((id) => outcomes[id] === true);

  return Object.freeze({
    steps: Object.freeze(steps),
    currentStep: firstPending || 'production-lock',
    readyToHomologate,
    readyToEmit,
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

// ===== Onboarding en seis pasos =====
//
// El asistente de arriba tiene once pasos porque sigue el circuito técnico de
// ARCA. Walter no necesita once: necesita seis, y saber cuál le toca. Esto es
// una proyección sobre lo mismo —no otra fuente de verdad— más el paso que el
// circuito técnico no tenía: encender la facturación automática.
//
// Los códigos vienen del backend (fiscal_automation_blockers). Se traducen acá
// una sola vez, y no hay camino por el que un mensaje crudo de ARCA llegue a
// esta pantalla: la bandeja y el tablero devuelven códigos, nunca texto.

export const FISCAL_ONBOARDING_STEPS = Object.freeze([
  'business-data', 'tax-situation', 'point-of-sale', 'certificate', 'verification', 'automation',
]);

const ONBOARDING_COPY = Object.freeze({
  'business-data': {
    title: 'Datos del negocio',
    purpose: 'Son los datos que van impresos en cada comprobante.',
    todo: 'Cargá razón social, CUIT y domicilio comercial en Datos fiscales.',
  },
  'tax-situation': {
    title: 'Situación fiscal',
    purpose: 'Define qué comprobante se emite y con qué IVA. El sistema no lo adivina.',
    todo: 'Con el contador: condición frente al IVA, alícuota y tipo de comprobante. Después el contador lo aprueba.',
  },
  'point-of-sale': {
    title: 'Punto de venta',
    purpose: 'Cada comprobante se numera dentro de un punto de venta.',
    todo: 'Dá de alta el punto de venta en ARCA y anotá el mismo número acá.',
  },
  certificate: {
    title: 'Certificado ARCA',
    purpose: 'Es lo que le prueba a ARCA que sos vos.',
    todo: 'Sacá el certificado en ARCA y entregáselo a soporte. La clave privada nunca sale del servidor.',
  },
  verification: {
    title: 'Verificación',
    purpose: 'Antes de facturar solo, hay que ver que ARCA responda.',
    todo: 'La verificación la corre el servidor. Cuando ARCA contesta bien, este paso se marca solo.',
  },
  automation: {
    title: 'Facturación automática',
    purpose: 'Cuando está encendida, cada venta cobrada se factura sola.',
    todo: 'Encendela cuando los cinco pasos anteriores estén completos.',
  },
});

// A qué paso pertenece cada código que devuelve el backend.
const BLOCKER_STEP = Object.freeze({
  PROFILE_MISSING: 'business-data',
  PROFILE_NOT_ENABLED: 'business-data',
  ENVIRONMENT_DISABLED: 'business-data',
  LEGAL_NAME_MISSING: 'business-data',
  CUIT_INVALID: 'business-data',
  ADDRESS_MISSING: 'business-data',
  TAX_CONDITION_MISSING: 'tax-situation',
  RECIPIENT_CONDITION_MISSING: 'tax-situation',
  CONCEPT_MISSING: 'tax-situation',
  ACCOUNTANT_REVIEW_PENDING: 'tax-situation',
  ACCOUNTING_POLICY_NOT_APPROVED: 'tax-situation',
  POINT_OF_SALE_MISSING: 'point-of-sale',
  CERTIFICATE_MISSING: 'certificate',
  CERTIFICATE_EXPIRED: 'certificate',
  CERTIFICATE_CUIT_MISMATCH: 'certificate',
  DELEGATION_PENDING: 'certificate',
  CONNECTION_NOT_VERIFIED: 'verification',
  HOMOLOGATION_NOT_AUTHORIZED: 'verification',
  PRODUCTION_GATE_BLOCKED: 'verification',
  OFFICIAL_TABLES_STALE: 'verification',
});

// "Falta cargarlo" y "está mal" no son lo mismo para quien tiene que arreglarlo.
const BLOCKER_IS_ERROR = Object.freeze(new Set([
  'CUIT_INVALID', 'CERTIFICATE_EXPIRED', 'CERTIFICATE_CUIT_MISMATCH', 'PROFILE_NOT_ENABLED',
]));

const BLOCKER_COPY = Object.freeze({
  PROFILE_MISSING: ['Todavía no hay datos fiscales cargados.', 'Completá el paso 1.'],
  PROFILE_NOT_ENABLED: ['La facturación está apagada en los datos fiscales.', 'Marcá el negocio como habilitado para facturar.'],
  ENVIRONMENT_DISABLED: ['No está elegido el modo de facturación.', 'Elegí el modo de pruebas en Datos fiscales.'],
  LEGAL_NAME_MISSING: ['Falta la razón social.', 'Cargala en Datos fiscales.'],
  CUIT_INVALID: ['El CUIT no es válido.', 'Revisá los once dígitos: el verificador no cierra.'],
  ADDRESS_MISSING: ['Falta el domicilio comercial.', 'Cargalo en Datos fiscales.'],
  TAX_CONDITION_MISSING: ['Falta la condición frente al IVA del negocio.', 'La define el contador.'],
  RECIPIENT_CONDITION_MISSING: ['Falta la condición frente al IVA del cliente.', 'La define el contador.'],
  CONCEPT_MISSING: ['Falta declarar qué se vende: productos, servicios o ambos.', 'Elegilo en Datos fiscales.'],
  ACCOUNTANT_REVIEW_PENDING: ['El contador todavía no aprobó los datos fiscales.', 'Pedile que los revise y los apruebe.'],
  ACCOUNTING_POLICY_NOT_APPROVED: ['Falta una política contable aprobada.', 'Declarala con el contador y que la apruebe.'],
  POINT_OF_SALE_MISSING: ['Falta el punto de venta.', 'Dalo de alta en ARCA y anotá el número acá.'],
  CERTIFICATE_MISSING: ['Falta el certificado de ARCA.', 'Sacalo en ARCA y entregáselo a soporte.'],
  CERTIFICATE_EXPIRED: ['El certificado venció.', 'Sacá uno nuevo en ARCA: hasta entonces no se factura nada.'],
  CERTIFICATE_CUIT_MISMATCH: ['El certificado es de otro CUIT.', 'Pedí el certificado del CUIT de este negocio.'],
  DELEGATION_PENDING: ['Falta autorizar el servicio de facturación en ARCA.', 'Autorizalo para el certificado que cargaste.'],
  CONNECTION_NOT_VERIFIED: ['El servidor todavía no pudo hablar con ARCA.', 'Se reintenta solo; si sigue así, avisá a soporte.'],
  HOMOLOGATION_NOT_AUTHORIZED: ['Faltan habilitar las pruebas con ARCA.', 'Autorizalas con la frase exacta más abajo.'],
  PRODUCTION_GATE_BLOCKED: ['La facturación real no está habilitada.', 'Se habilita aparte, con el contador.'],
  OFFICIAL_TABLES_STALE: ['Las tablas oficiales de ARCA están desactualizadas.', 'Las baja el servidor solo; esperá unos minutos.'],
});

export function describeFiscalBlocker(code) {
  const key = String(code || '').toUpperCase();
  const copy = BLOCKER_COPY[key];
  return Object.freeze({
    code: key,
    reason: copy ? copy[0] : 'Falta un dato fiscal.',
    action: copy ? copy[1] : 'Revisalo con el contador o avisá a soporte.',
    severity: BLOCKER_IS_ERROR.has(key) ? 'error' : 'pending',
  });
}

/**
 * Los seis pasos, con COMPLETO / PENDIENTE / ERROR y qué hacer en cada uno.
 * `overview` es lo que devuelve get_fiscal_automation_overview.
 */
export function buildFiscalOnboarding(overview = {}) {
  const data = overview && typeof overview === 'object' ? overview : {};
  const blockers = Array.isArray(data.blockers) ? data.blockers.map((code) => describeFiscalBlocker(code)) : [];
  const automationActive = data.automation_active === true;
  const ready = data.ready === true;

  const steps = FISCAL_ONBOARDING_STEPS.map((id, index) => {
    const own = id === 'automation' ? [] : blockers.filter((blocker) => BLOCKER_STEP[blocker.code] === id);
    const status = id === 'automation'
      ? (automationActive ? 'complete' : 'pending')
      : own.some((blocker) => blocker.severity === 'error')
        ? 'error'
        : own.length ? 'pending' : 'complete';
    return Object.freeze({
      id,
      number: index + 1,
      title: ONBOARDING_COPY[id].title,
      purpose: ONBOARDING_COPY[id].purpose,
      todo: ONBOARDING_COPY[id].todo,
      status,
      statusLabel: ({ complete: 'COMPLETO', pending: 'PENDIENTE', error: 'ERROR' })[status],
      blockers: Object.freeze(own),
    });
  });

  // El paso 6 no se puede tocar hasta que los cinco anteriores estén completos:
  // encender la automatización antes sólo llena la bandeja de excepciones.
  const firstPending = steps.find((step) => step.status !== 'complete');

  return Object.freeze({
    steps: Object.freeze(steps),
    currentStep: firstPending ? firstPending.id : 'automation',
    ready,
    automationActive,
    automationMode: String(data.automation_mode || 'manual'),
    canActivate: ready && !automationActive,
    suspended: Boolean(data.automation_suspended_at),
    suspendedReason: data.automation_suspended_reason ? describeSuspension(data.automation_suspended_reason) : '',
    headline: automationActive
      ? 'La facturación automática está encendida'
      : ready
        ? 'Todo listo: falta encender la facturación automática'
        : 'Falta configurar la facturación',
    blockers: Object.freeze(blockers),
  });
}

const SUSPENSION_COPY = Object.freeze({
  PROFILE_CHANGED: 'Se apagó sola porque cambiaron los datos fiscales. Revisalos y volvé a encenderla.',
  ACCOUNTING_POLICY_CHANGED: 'Se apagó sola porque cambió la política contable. Que el contador la apruebe y volvé a encenderla.',
  READINESS_LOST: 'Se apagó sola porque dejó de estar todo en condiciones. Mirá qué falta más arriba.',
  CONFIGURATION_CHANGED: 'Se apagó sola porque cambió la configuración fiscal.',
});

export function describeSuspension(reason) {
  return SUSPENSION_COPY[String(reason || '').toUpperCase()] || SUSPENSION_COPY.CONFIGURATION_CHANGED;
}

// ===== Bandeja de excepciones =====

const EXCEPTION_COPY = Object.freeze({
  configuration: ['Falta configuración para poder facturar', 'Completá el paso que quedó pendiente.'],
  certificate: ['Problema con el certificado de ARCA', 'Sin certificado vigente no se emite ningún comprobante.'],
  rejected: ['ARCA rechazó el comprobante', 'Revisalo con el contador: hay que corregir y volver a emitir.'],
  amount_mismatch: ['Los importes del comprobante no cierran', 'La venta está cobrada. Revisá el detalle con el contador.'],
  ambiguous: ['No se sabe si ARCA lo autorizó', 'El sistema lo está consultando solo. No lo emitas de nuevo.'],
  missing_fiscal_data: ['Falta un dato fiscal de esta venta', 'Completalo y el comprobante sigue solo.'],
  unrecoverable: ['El comprobante no pudo emitirse', 'Avisá a soporte con el número de venta.'],
});

/**
 * Traduce una fila de list_fiscal_exceptions. La fila trae códigos, nunca texto
 * de ARCA, así que acá no hay nada crudo que filtrar: no puede haberlo.
 */
export function describeFiscalException(row = {}) {
  const entry = row && typeof row === 'object' ? row : {};
  const kind = String(entry.kind || 'unrecoverable');
  const copy = EXCEPTION_COPY[kind] || EXCEPTION_COPY.unrecoverable;
  const blocker = kind === 'configuration' || kind === 'certificate' ? describeFiscalBlocker(entry.code) : null;
  return Object.freeze({
    id: String(entry.exception_id || ''),
    kind,
    title: copy[0],
    // Para configuración y certificado el código dice exactamente qué falta.
    reason: blocker ? blocker.reason : copy[0],
    action: blocker ? blocker.action : copy[1],
    severity: String(entry.severity || 'blocking') === 'action_required' ? 'warning' : 'danger',
    reference: entry.document_label ? String(entry.document_label) : '',
    amount: Number.isFinite(Number(entry.total_amount)) && Number(entry.total_amount) > 0 ? Number(entry.total_amount) : null,
    environment: String(entry.environment || 'disabled'),
    occurredAt: entry.occurred_at || null,
  });
}

/** Los números del día, ya con la palabra que le corresponde a cada uno. */
export function buildFiscalDashboard(overview = {}) {
  const source = overview && typeof overview === 'object' ? overview : {};
  const today = source.today || {};
  const totals = source.totals_by_environment || {};
  const number = (value) => Math.max(0, Number(value || 0));
  return Object.freeze({
    date: today.date || null,
    tiles: Object.freeze([
      Object.freeze({ key: 'eligible', label: 'Ventas del día', value: number(today.eligible), tone: 'info' }),
      Object.freeze({ key: 'automatic', label: 'Facturadas solas', value: number(today.automatic), tone: 'success' }),
      Object.freeze({ key: 'pending', label: 'En camino', value: number(today.pending), tone: number(today.pending) ? 'warning' : 'success' }),
      Object.freeze({ key: 'rejected', label: 'Rechazadas', value: number(today.rejected), tone: number(today.rejected) ? 'danger' : 'success' }),
      Object.freeze({ key: 'attention', label: 'Requieren atención', value: number(today.attention), tone: number(today.attention) ? 'danger' : 'success' }),
    ]),
    // Las pruebas de homologación no son ventas del negocio y no se suman con ellas.
    homologation: Object.freeze({ ...(totals.homologation || {}) }),
    production: Object.freeze({ ...(totals.production || {}) }),
  });
}
