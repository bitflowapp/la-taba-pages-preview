import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateGtinCheckDigit, normalizeBarcode } from '../js/catalog/barcode-normalizer.js';
import { createBarcodeScannerService, SCANNER_MODES } from '../js/catalog/barcode-scanner-service.js';

const valid = (body) => `${body}${calculateGtinCheckDigit(body)}`;

test('scanner valida EAN-8, UPC-A, EAN-13 y GTIN-14 preservando ceros', () => {
  const fixtures = [
    [valid('9638507'), 'EAN-8'],
    [valid('03600029145'), 'UPC-A'],
    [valid('400638133393'), 'EAN-13'],
    [valid('0001234560001'), 'GTIN-14'],
  ];
  for (const [code, format] of fixtures) {
    const result = normalizeBarcode(code);
    assert.equal(result.isValid, true);
    assert.equal(result.format, format);
    assert.equal(result.normalizedValue, code);
  }
  assert.match(fixtures[3][0], /^00/);
});

test('scanner rechaza d\u00edgito verificador, caracteres y largos no soportados', () => {
  assert.equal(normalizeBarcode('4006381333932').reason, 'INVALID_CHECK_DIGIT');
  assert.equal(normalizeBarcode('40063813339A1').reason, 'NON_NUMERIC_GTIN');
  assert.equal(normalizeBarcode('12345').reason, 'UNSUPPORTED_FORMAT');
});

test('c\u00f3digos internos son opt-in y nunca se presentan como GTIN', () => {
  assert.equal(normalizeBarcode('TABA-001').isValid, false);
  const internal = normalizeBarcode('TABA-001', { allowInternalCodes: true });
  assert.equal(internal.isValid, true);
  assert.equal(internal.format, 'INTERNAL');
  assert.equal(internal.checkDigitValid, null);
});

test('servicio soporta todos los modos y desmonta el listener', () => {
  const target = fakeTarget();
  const scanner = createBarcodeScannerService({ target });
  for (const mode of SCANNER_MODES) {
    scanner.start(mode);
    assert.equal(scanner.getMode(), mode);
    scanner.stop();
  }
  assert.equal(target.added, SCANNER_MODES.length);
  assert.equal(target.removed, SCANNER_MODES.length);
});

test('Enter y Tab completan lecturas r\u00e1pidas desde input dedicado', () => {
  let clock = 1_000;
  const target = fakeTarget();
  const scanner = createBarcodeScannerService({ target, now: () => clock, setTimer: () => 1, clearTimer() {} });
  const events = [];
  scanner.subscribe((event) => events.push(event));
  scanner.start('pos_sale');
  for (const suffix of ['Enter', 'Tab']) {
    for (const key of valid('9638507')) { target.emit(key, dedicatedTarget()); clock += 10; }
    const terminal = target.emit(suffix, dedicatedTarget());
    assert.equal(terminal.prevented, true);
    clock += 700;
  }
  assert.equal(events.length, 2);
  assert.equal(events.every((event) => event.isValid), true);
  assert.equal(events.every((event) => event.mode === 'pos_sale'), true);
});

test('escritura humana y controles editables no son capturados globalmente', () => {
  let clock = 0;
  const target = fakeTarget();
  const scanner = createBarcodeScannerService({ target, now: () => clock, setTimer: () => 1, clearTimer() {} });
  const events = [];
  scanner.subscribe((event) => events.push(event));
  scanner.configure({ captureGlobal: true });
  scanner.start('product_lookup');
  const editable = editableTarget();
  for (const key of valid('9638507')) { target.emit(key, editable); clock += 100; }
  target.emit('Enter', editable);
  assert.equal(events.length, 0);
});

test('timeout entre teclas limpia buffer y no publica una lectura humana', () => {
  let clock = 0;
  const target = fakeTarget();
  const scanner = createBarcodeScannerService({ target, now: () => clock, setTimer: () => 1, clearTimer() {} });
  const events = [];
  scanner.subscribe((event) => events.push(event));
  scanner.start('inventory_receive');
  for (const key of valid('9638507')) { target.emit(key, dedicatedTarget()); clock += 90; }
  target.emit('Enter', dedicatedTarget());
  assert.equal(events.length, 0);
});

test('doble escaneo se informa y no se acepta dos veces', () => {
  let clock = 10_000;
  const scanner = createBarcodeScannerService({ target: fakeTarget(), now: () => clock });
  scanner.start('stock_count');
  const first = scanner.test(valid('9638507'));
  clock += 100;
  const second = scanner.test(valid('9638507'));
  assert.equal(first.isValid, true);
  assert.equal(second.isValid, false);
  assert.equal(second.reason, 'DUPLICATE_SCAN');
});

test('prefijo configurado se quita y un prefijo ausente falla cerrado', () => {
  const scanner = createBarcodeScannerService({ target: fakeTarget(), now: () => 10_000 });
  scanner.configure({ prefix: 'SC:' });
  scanner.start('product_create');
  assert.equal(scanner.test(`SC:${valid('9638507')}`).isValid, true);
  assert.equal(scanner.test(valid('9638507')).isValid, false);
});

function fakeTarget() {
  let listener = null;
  return {
    added: 0, removed: 0,
    addEventListener(_name, next) { listener = next; this.added += 1; },
    removeEventListener(_name, next) { if (listener === next) listener = null; this.removed += 1; },
    emit(key, eventTarget) {
      const event = { key, target: eventTarget, defaultPrevented: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault() { this.defaultPrevented = true; } };
      listener?.(event);
      return { prevented: event.defaultPrevented };
    },
  };
}

function dedicatedTarget() { return { closest: (selector) => selector === '[data-barcode-input]' ? {} : null, matches: () => false }; }
function editableTarget() { return { closest: (selector) => selector.includes('input:not') ? {} : null, matches: (selector) => selector.includes('input:not') }; }
