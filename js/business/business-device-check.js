// "Probar dispositivos": lector, impresora térmica, A4, QR y cola de impresión.
// Regla: nunca decimos "impreso" porque Windows aceptó el trabajo. Sólo decimos lo que podemos comprobar.

export const DEVICE_STATES = Object.freeze([
  'connected', 'no-response', 'no-paper', 'job-sent', 'not-verifiable', 'error', 'untested',
]);

const STATE_COPY = Object.freeze({
  connected: { label: 'Conectado', tone: 'success', meaning: 'El dispositivo respondió y está listo.' },
  'no-response': { label: 'Sin respuesta', tone: 'danger', meaning: 'No contestó. Revisá el cable, el encendido o el emparejamiento.' },
  'no-paper': { label: 'Sin papel', tone: 'warning', meaning: 'Está conectada pero se quedó sin papel.' },
  'job-sent': { label: 'Trabajo enviado', tone: 'info', meaning: 'Windows aceptó el trabajo. Todavía no sabemos si salió el papel.' },
  'not-verifiable': { label: 'Impresión no verificable', tone: 'warning', meaning: 'No podemos confirmar si salió. Mirá la impresora antes de repetir.' },
  error: { label: 'Error', tone: 'danger', meaning: 'El dispositivo rechazó la prueba.' },
  untested: { label: 'Sin probar', tone: 'muted', meaning: 'Todavía no se hizo esta prueba.' },
});

export const DEVICE_CHECKS = Object.freeze([
  Object.freeze({
    id: 'scanner',
    label: 'Lector de códigos',
    proves: 'Que el lector escribe el código completo y termina con Enter.',
    howTo: 'Escaneá cualquier producto con el lector apuntando al recuadro.',
    needsNative: false,
  }),
  Object.freeze({
    id: 'thermal',
    label: 'Impresora térmica',
    // Nombre corto para la confirmación manual: la única prueba de que salió el papel.
    paperName: 'la térmica',
    proves: 'Que sale el ticket del mostrador.',
    howTo: 'Enviamos un ticket de prueba y después mirás si salió el papel.',
    needsNative: true,
  }),
  Object.freeze({
    id: 'a4',
    label: 'Impresora A4',
    paperName: 'la A4',
    proves: 'Que se puede imprimir un comprobante en hoja.',
    howTo: 'Enviamos una hoja de prueba a la impresora que elijas.',
    needsNative: true,
  }),
  Object.freeze({
    // Se prueba el QR real del comprobante, no uno de adorno: es el único que le sirve al cliente.
    id: 'qr',
    label: 'QR del comprobante',
    proves: 'Que el QR del comprobante se ve y se puede leer con el celular.',
    howTo: 'Abrí la vista previa de un comprobante y escaneá su QR con la cámara del celular.',
    needsNative: false,
  }),
  Object.freeze({
    id: 'spooler',
    label: 'Cola de impresión',
    proves: 'Que Windows tiene impresoras disponibles y acepta trabajos.',
    howTo: 'Consultamos las impresoras instaladas.',
    needsNative: true,
  }),
]);

export function describeDeviceState(state) {
  const key = DEVICE_STATES.includes(String(state)) ? String(state) : 'untested';
  return Object.freeze({ state: key, ...STATE_COPY[key] });
}

// El lector se considera conectado sólo si mandó un código completo y válido.
export function classifyScannerCheck(event) {
  if (!event) return buildResult('scanner', 'untested', 'Escaneá un código para probar el lector.');
  if (event.isValid) {
    return buildResult('scanner', 'connected', `Leyó ${event.format} y cerró la lectura solo.`, {
      sample: String(event.normalizedValue || ''),
    });
  }
  if (String(event.reason || '') === 'DUPLICATE_SCAN') {
    return buildResult('scanner', 'connected', 'Leyó el mismo código dos veces seguidas; el lector responde.');
  }
  const reason = ({
    INVALID_CHECK_DIGIT: 'Leyó el código pero el dígito verificador no cierra. Puede ser una etiqueta dañada.',
    NON_NUMERIC_GTIN: 'Leyó letras donde debería haber números. Revisá la configuración del lector.',
    UNSUPPORTED_FORMAT: 'El código no tiene un largo conocido. Puede ser un código interno del proveedor.',
    FORMAT_NOT_ALLOWED: 'Ese tipo de código no está habilitado para esta operación.',
  })[String(event.reason || '')] || 'La lectura llegó incompleta.';
  return buildResult('scanner', 'error', reason);
}

// Traduce lo que Windows informa de la impresora. Cualquier bandera desconocida no se inventa.
export function classifyPrinterProbe(probe) {
  if (!probe || typeof probe !== 'object') {
    return buildResult('printer', 'no-response', 'Windows no devolvió información de la impresora.');
  }
  if (probe.reachable === false) {
    return buildResult('printer', 'no-response', 'La impresora figura instalada pero no contesta.');
  }
  if (probe.outOfPaper === true) {
    return buildResult('printer', 'no-paper', 'Cargá papel y volvé a probar.');
  }
  if (probe.error === true) {
    return buildResult('printer', 'error', 'La impresora informó un problema. Revisá tapa, atasco y tóner.');
  }
  if (probe.reachable === true) {
    const queued = Number(probe.queuedJobs || 0);
    return buildResult('printer', 'connected', queued > 0
      ? `Responde y tiene ${queued} trabajo(s) esperando.`
      : 'Responde y no tiene trabajos pendientes.');
  }
  return buildResult('printer', 'not-verifiable', 'Windows no informa el estado de esta impresora.');
}

// Un envío al spooler NO es una impresión. Este mapeo es el que impide mentir.
export function classifyPrintSubmission(outcome) {
  const status = String(outcome?.status || '');
  switch (status) {
    case 'queued':
      return buildResult('print', 'job-sent', 'Quedó en la cola local. Sale cuando la impresora esté lista.');
    case 'sent_to_spooler':
      return buildResult('print', 'job-sent', 'Windows lo aceptó. Mirá la impresora para confirmar que salió.');
    case 'completed_when_verifiable':
      return buildResult('print', 'connected', 'La impresora confirmó que el trabajo terminó.');
    case 'unknown':
      return buildResult('print', 'not-verifiable', 'No se puede saber si salió. Revisá el papel antes de repetir.');
    case 'failed':
      return buildResult('print', 'error', 'El trabajo no se pudo entregar a la impresora.');
    default:
      return buildResult('print', 'not-verifiable', 'No llegó una respuesta clara de la impresora.');
  }
}

export function classifySpoolerCheck(printers) {
  if (!Array.isArray(printers)) {
    return buildResult('spooler', 'no-response', 'Windows no respondió al pedido de impresoras.');
  }
  if (!printers.length) {
    return buildResult('spooler', 'error', 'No hay ninguna impresora instalada en esta computadora.');
  }
  const names = printers.map((printer) => String(printer?.name || '')).filter(Boolean);
  return buildResult('spooler', 'connected', `${names.length} impresora(s) disponible(s).`, { printers: names });
}

export function classifyQrCheck(rendered) {
  if (rendered === true) {
    return buildResult('qr', 'connected', 'El comprobante se abrió con su QR. Escanealo con el celular para confirmar que se lee.');
  }
  if (rendered === false) {
    return buildResult('qr', 'error', 'No hay ningún comprobante autorizado con QR para revisar todavía.');
  }
  return buildResult('qr', 'untested', 'Abrí un comprobante para revisar su QR.');
}

export function summarizeDeviceChecks(results = {}) {
  const rows = DEVICE_CHECKS.map((check) => {
    const result = results[check.id];
    const state = result?.state && DEVICE_STATES.includes(result.state) ? result.state : 'untested';
    const described = describeDeviceState(state);
    return Object.freeze({
      id: check.id,
      label: check.label,
      proves: check.proves,
      howTo: check.howTo,
      needsNative: check.needsNative,
      state: described.state,
      stateLabel: described.label,
      meaning: described.meaning,
      tone: described.tone,
      detail: String(result?.detail || ''),
    });
  });
  const blocking = rows.filter((row) => ['no-response', 'error'].includes(row.state));
  const warning = rows.filter((row) => ['no-paper', 'not-verifiable'].includes(row.state));
  return Object.freeze({
    rows: Object.freeze(rows),
    headline: blocking.length
      ? `${blocking.length} dispositivo(s) no están funcionando`
      : warning.length
        ? 'Los dispositivos responden, pero hay algo para mirar'
        : rows.every((row) => row.state === 'untested')
          ? 'Todavía no probaste los dispositivos'
          : 'Los dispositivos probados responden',
    tone: blocking.length ? 'critical' : warning.length ? 'attention' : 'calm',
  });
}

function buildResult(device, state, detail, extra = {}) {
  return Object.freeze({ device, state, detail: String(detail || ''), ...extra });
}
