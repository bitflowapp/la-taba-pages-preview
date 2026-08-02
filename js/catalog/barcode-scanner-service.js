import { normalizeBarcode, SUPPORTED_GTIN_FORMATS } from './barcode-normalizer.js';

export const SCANNER_MODES = Object.freeze([
  'product_lookup',
  'product_create',
  'inventory_receive',
  'inventory_adjust',
  'stock_count',
  'pos_sale',
  'order_packing',
]);

export const DEFAULT_SCANNER_CONFIG = Object.freeze({
  suffixes: Object.freeze(['Enter', 'Tab']),
  prefix: '',
  maxInterKeyMs: 55,
  bufferTimeoutMs: 180,
  minimumLength: 8,
  duplicateWindowMs: 650,
  allowedFormats: SUPPORTED_GTIN_FORMATS,
  allowInternalCodes: false,
  captureGlobal: false,
  acceptSound: true,
  rejectSound: true,
});

const EDITABLE_SELECTOR = 'input:not([data-barcode-input]), textarea, select, [contenteditable="true"], [role="textbox"]';

export function createBarcodeScannerService({
  target = typeof document === 'undefined' ? null : document,
  now = () => Date.now(),
  setTimer = globalThis.setTimeout?.bind(globalThis),
  clearTimer = globalThis.clearTimeout?.bind(globalThis),
  normalizer = normalizeBarcode,
} = {}) {
  let config = { ...DEFAULT_SCANNER_CONFIG };
  let mode = null;
  let active = false;
  let buffer = '';
  let lastKeyAt = 0;
  let clearHandle = null;
  let lastScan = { value: '', at: 0 };
  const listeners = new Set();

  function configure(patch = {}) {
    config = sanitizeScannerConfig({ ...config, ...patch });
    return getConfig();
  }

  function getConfig() {
    return Object.freeze({ ...config, suffixes: [...config.suffixes], allowedFormats: [...config.allowedFormats] });
  }

  function start(nextMode) {
    if (!SCANNER_MODES.includes(nextMode)) throw new Error(`Modo de scanner no soportado: ${nextMode}.`);
    mode = nextMode;
    if (!active) target?.addEventListener?.('keydown', onKeyDown, true);
    active = true;
    resetBuffer();
    return true;
  }

  function stop() {
    if (active) target?.removeEventListener?.('keydown', onKeyDown, true);
    active = false;
    mode = null;
    resetBuffer();
    return true;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('El listener del scanner debe ser una funci\u00f3n.');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function test(code, source = 'simulator') {
    if (!mode) throw new Error('Inici\u00e1 el scanner antes de probar un c\u00f3digo.');
    return publish(code, source);
  }

  function onKeyDown(event) {
    if (!active || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
    const dedicated = Boolean(event.target?.closest?.('[data-barcode-input]'));
    if (!dedicated && (!config.captureGlobal || isEditableTarget(event.target))) return;

    const key = String(event.key || '');
    if (config.suffixes.includes(key)) {
      if (buffer.length >= config.minimumLength) {
        event.preventDefault?.();
        publish(buffer, dedicated ? 'dedicated_input' : 'hid_keyboard');
      }
      resetBuffer();
      return;
    }
    if (key.length !== 1) return;

    const timestamp = now();
    if (lastKeyAt && timestamp - lastKeyAt > config.maxInterKeyMs) buffer = '';
    lastKeyAt = timestamp;
    buffer += key;
    scheduleBufferReset();
  }

  function publish(rawValue, source) {
    let candidate = String(rawValue ?? '');
    if (config.prefix) {
      if (!candidate.startsWith(config.prefix)) candidate = '';
      else candidate = candidate.slice(config.prefix.length);
    }
    const normalized = normalizer(candidate, config);
    const timestamp = now();
    const duplicate = normalized.normalizedValue
      && lastScan.value === normalized.normalizedValue
      && timestamp - lastScan.at < config.duplicateWindowMs;
    const event = Object.freeze({
      ...normalized,
      isValid: normalized.isValid && !duplicate,
      reason: duplicate ? 'DUPLICATE_SCAN' : normalized.reason,
      timestamp: new Date(timestamp).toISOString(),
      source,
      mode,
    });
    if (!duplicate && normalized.normalizedValue) lastScan = { value: normalized.normalizedValue, at: timestamp };
    for (const listener of [...listeners]) listener(event);
    return event;
  }

  function scheduleBufferReset() {
    if (clearHandle !== null && clearTimer) clearTimer(clearHandle);
    clearHandle = setTimer?.(() => resetBuffer(), config.bufferTimeoutMs) ?? null;
  }

  function resetBuffer() {
    buffer = '';
    lastKeyAt = 0;
    if (clearHandle !== null && clearTimer) clearTimer(clearHandle);
    clearHandle = null;
  }

  return Object.freeze({ start, stop, subscribe, test, configure, getConfig, isActive: () => active, getMode: () => mode });
}

function isEditableTarget(target) {
  return Boolean(target?.matches?.(EDITABLE_SELECTOR) || target?.closest?.(EDITABLE_SELECTOR));
}

function sanitizeScannerConfig(value) {
  return {
    suffixes: [...new Set((Array.isArray(value.suffixes) ? value.suffixes : ['Enter', 'Tab'])
      .map(String).filter(Boolean))],
    prefix: String(value.prefix || '').slice(0, 8),
    maxInterKeyMs: clampInteger(value.maxInterKeyMs, 20, 250, 55),
    bufferTimeoutMs: clampInteger(value.bufferTimeoutMs, 60, 2000, 180),
    minimumLength: clampInteger(value.minimumLength, 3, 64, 8),
    duplicateWindowMs: clampInteger(value.duplicateWindowMs, 0, 5000, 650),
    allowedFormats: (Array.isArray(value.allowedFormats) ? value.allowedFormats : SUPPORTED_GTIN_FORMATS)
      .filter((format) => SUPPORTED_GTIN_FORMATS.includes(format)),
    allowInternalCodes: value.allowInternalCodes === true,
    captureGlobal: value.captureGlobal === true,
    acceptSound: value.acceptSound !== false,
    rejectSound: value.rejectSound !== false,
  };
}

function clampInteger(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback;
}
