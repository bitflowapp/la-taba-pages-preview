import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import {
  buildDeliveryProof,
  compressDeliveryProofImage,
  MAX_DELIVERY_PROOF_DATA_URL_BYTES,
  normalizeDeliveryProof,
} from '../js/core/delivery-proof.js';
import { buildBusinessReport } from '../js/core/business-reports.js';
import { restoreBusinessSetupDemo } from '../js/core/business-setup.js';
import { confirmCatalogReset } from '../js/business.js';
import {
  attachDeliveryProof,
  removeDeliveryProof,
  updateOrderStatus,
} from '../js/orders.js';
import {
  getState,
  hydrateState,
  setState,
} from '../js/state.js';
import { resetState } from './helpers.mjs';

const VALID_PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==';
const CAPTURED_AT = '2026-06-06T12:00:00.000Z';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalCreateImageBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');

beforeEach(() => {
  globalThis.localStorage = memoryStorage();
  globalThis.sessionStorage = memoryStorage();
  resetState({ orders: [], cart: [] });
});

afterEach(() => {
  restoreGlobal('document', originalDocument);
  restoreGlobal('createImageBitmap', originalCreateImageBitmap);
});

test('delivery proof: pedido viejo sin deliveryProof hidrata sin romper', () => {
  const hydrated = hydrateState({
    orders: [makeOrder({ id: 'LT-OLD', status: 'received' })],
  });

  assert.equal(hydrated.orders[0].id, 'LT-OLD');
  assert.equal('deliveryProof' in hydrated.orders[0], false);
});

test('delivery proof: proof valido se conserva al hidratar', () => {
  const proof = buildDeliveryProof(VALID_PHOTO, { capturedAt: CAPTURED_AT, source: 'camera' });
  const hydrated = hydrateState({
    orders: [makeOrder({ id: 'LT-PROOF', deliveryProof: proof })],
  });

  assert.deepEqual(hydrated.orders[0].deliveryProof, proof);
});

test('delivery proof: proof invalido se descarta sin romper el pedido', () => {
  const hydrated = hydrateState({
    orders: [makeOrder({
      id: 'LT-BAD-PROOF',
      deliveryProof: { photoDataUrl: 'javascript:alert(1)', capturedAt: CAPTURED_AT, source: 'camera' },
    })],
  });

  assert.equal(hydrated.orders[0].id, 'LT-BAD-PROOF');
  assert.equal('deliveryProof' in hydrated.orders[0], false);
});

test('delivery proof: compresion devuelve dataUrl JPEG', async () => {
  installCanvasStub({ sourceWidth: 640, sourceHeight: 480 });

  const result = await compressDeliveryProofImage(makeImageFile({ size: 320_000 }));

  assert.equal(result.ok, true);
  assert.equal(result.dataUrl.startsWith('data:image/jpeg;base64,'), true);
  assert.equal(result.width, 640);
  assert.equal(result.height, 480);
  assert.equal(result.byteSize <= MAX_DELIVERY_PROOF_DATA_URL_BYTES, true);
});

test('delivery proof: foto enorme se escala a 1024px maximo', async () => {
  const canvas = installCanvasStub({ sourceWidth: 4000, sourceHeight: 2400 });

  const result = await compressDeliveryProofImage(makeImageFile({ size: 8_000_000 }));

  assert.equal(result.ok, true);
  assert.equal(result.width, 1024);
  assert.equal(result.height, 614);
  assert.equal(canvas.width, 1024);
  assert.equal(canvas.height, 614);
  assert.equal(canvas.type, 'image/jpeg');
  assert.equal(canvas.quality, 0.7);
});

test('delivery proof: foto grande se recomprime hasta quedar debajo del limite', async () => {
  const canvas = installCanvasStub({
    sourceWidth: 4000,
    sourceHeight: 2400,
    toDataURL: ({ call }) => (call === 1 ? makeDataUrl(MAX_DELIVERY_PROOF_DATA_URL_BYTES + 50_000) : VALID_PHOTO),
  });

  const result = await compressDeliveryProofImage(makeImageFile({ size: 8_000_000 }));

  assert.equal(result.ok, true);
  assert.equal(canvas.calls, 2);
  assert.equal(result.width, 900);
  assert.equal(result.height, 540);
  assert.equal(result.byteSize <= MAX_DELIVERY_PROOF_DATA_URL_BYTES, true);
});

test('delivery proof: payload que sigue excediendo el limite se rechaza', async () => {
  const canvas = installCanvasStub({
    sourceWidth: 4000,
    sourceHeight: 2400,
    toDataURL: () => makeDataUrl(MAX_DELIVERY_PROOF_DATA_URL_BYTES + 100_000),
  });

  const result = await compressDeliveryProofImage(makeImageFile({ size: 8_000_000 }));

  assert.equal(result.ok, false);
  assert.equal(canvas.calls, 4);
  assert.match(result.message, /demasiado grande/i);
});

test('delivery proof: marcar entregado conserva el comprobante', () => {
  const proof = buildDeliveryProof(VALID_PHOTO, { capturedAt: CAPTURED_AT, source: 'camera' });
  setState({ orders: [makeOrder({ id: 'LT-DONE', status: 'arriving', deliveryProof: proof })] });

  const delivered = updateOrderStatus('LT-DONE', 'delivered');

  assert.equal(delivered.ok, true);
  const order = getState().orders.find((candidate) => candidate.id === 'LT-DONE');
  assert.equal(order.status, 'delivered');
  assert.deepEqual(order.deliveryProof, proof);
});

test('delivery proof: marcar entregado sin proof no rompe y no inventa comprobante', () => {
  setState({ orders: [makeOrder({ id: 'LT-DONE-NO-PROOF', status: 'arriving' })] });

  const delivered = updateOrderStatus('LT-DONE-NO-PROOF', 'delivered');

  assert.equal(delivered.ok, true);
  const order = getState().orders.find((candidate) => candidate.id === 'LT-DONE-NO-PROOF');
  assert.equal(order.status, 'delivered');
  assert.equal('deliveryProof' in order, false);
});

test('delivery proof: caja y reportes ignoran deliveryProof', () => {
  const proof = buildDeliveryProof(VALID_PHOTO, { capturedAt: CAPTURED_AT, source: 'camera' });
  const report = buildBusinessReport([
    makeOrder({ id: 'LT-SALE', status: 'delivered', total: 2300, subtotal: 2300, deliveryProof: proof }),
    makeOrder({ id: 'LT-CANCEL', status: 'cancelled', total: 9000, subtotal: 9000, deliveryProof: proof }),
  ], { period: 'all', now: new Date('2026-06-06T13:00:00.000Z') });

  assert.equal(report.deliveredOrders, 1);
  assert.equal(report.cancelledOrders, 1);
  assert.equal(report.netSales, 2300);
  assert.equal(report.grossSales, 2300);
});

test('delivery proof: restaurar configuracion demo no borra proofs', () => {
  const proof = buildDeliveryProof(VALID_PHOTO, { capturedAt: CAPTURED_AT, source: 'camera' });
  setState({ orders: [makeOrder({ id: 'LT-CONFIG-RESTORE', deliveryProof: proof })] });

  const restored = restoreBusinessSetupDemo({ confirmed: true });

  assert.equal(restored.ok, true);
  assert.deepEqual(getState().orders[0].deliveryProof, proof);
});

test('delivery proof: restaurar catalogo demo no borra snapshots ni proofs de pedidos existentes', () => {
  const proof = buildDeliveryProof(VALID_PHOTO, { capturedAt: CAPTURED_AT, source: 'camera' });
  setState({
    orders: [makeOrder({
      id: 'LT-CATALOG-RESTORE',
      deliveryProof: proof,
      items: [{ productId: 'p-custom', name: 'Snapshot custom', quantity: 1, unitPrice: 1500, unit: 'unidad' }],
      subtotal: 1500,
      total: 1500,
    })],
    products: [{ id: 'p-custom', name: 'Producto custom', price: 1500, stock: 3, available: true, categoryId: 'carnes' }],
  });

  const restored = confirmCatalogReset();

  assert.equal(restored.ok, true);
  const order = getState().orders.find((candidate) => candidate.id === 'LT-CATALOG-RESTORE');
  assert.equal(order.items[0].name, 'Snapshot custom');
  assert.deepEqual(order.deliveryProof, proof);
});

test('delivery proof: attachDeliveryProof normaliza, reemplaza y persiste el comprobante', () => {
  setState({ orders: [makeOrder({ id: 'LT-ATTACH', status: 'arriving' })] });
  const proofA = normalizeDeliveryProof({
    photoDataUrl: VALID_PHOTO,
    capturedAt: CAPTURED_AT,
    source: 'unknown',
  });
  const proofB = buildDeliveryProof(`data:image/jpeg;base64,${'B'.repeat(16)}`, {
    capturedAt: '2026-06-06T12:05:00.000Z',
    source: 'file',
  });

  const first = attachDeliveryProof('LT-ATTACH', proofA);
  const second = attachDeliveryProof('LT-ATTACH', proofB);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(getState().orders[0].deliveryProof, proofB);
});

test('delivery proof: removeDeliveryProof quita el comprobante sin romper el pedido', () => {
  const proof = buildDeliveryProof(VALID_PHOTO, { capturedAt: CAPTURED_AT, source: 'file' });
  setState({ orders: [makeOrder({ id: 'LT-REMOVE', status: 'arriving', deliveryProof: proof })] });

  const result = removeDeliveryProof('LT-REMOVE');

  assert.equal(result.ok, true);
  assert.equal('deliveryProof' in getState().orders[0], false);
});

test('delivery proof: source nuevo es honesto y fallback invalido normaliza a file', () => {
  const proof = buildDeliveryProof(VALID_PHOTO, { capturedAt: CAPTURED_AT });

  assert.equal(proof.source, 'file');
  assert.deepEqual(normalizeDeliveryProof({
    photoDataUrl: VALID_PHOTO,
    capturedAt: CAPTURED_AT,
    source: 'camera-or-file',
  }), {
    photoDataUrl: VALID_PHOTO,
    capturedAt: CAPTURED_AT,
    source: 'file',
  });
});

test('delivery proof: persistencia fallida revierte el proof y avisa error', () => {
  setState({ orders: [makeOrder({ id: 'LT-QUOTA', status: 'arriving' })] });
  globalThis.localStorage = throwingStorage();

  const proof = buildDeliveryProof(VALID_PHOTO, { capturedAt: CAPTURED_AT, source: 'file' });
  const result = attachDeliveryProof('LT-QUOTA', proof);

  assert.equal(result.ok, false);
  assert.match(result.message, /liberá espacio|guardar la foto/i);
  assert.equal('deliveryProof' in getState().orders[0], false);
});

function makeOrder(overrides = {}) {
  const item = overrides.items?.[0] || {
    productId: 'p-muzzarella',
    name: 'Vacio snapshot',
    quantity: 1,
    unitPrice: overrides.subtotal ?? overrides.total ?? 1000,
    unit: 'kg',
  };
  const subtotal = overrides.subtotal ?? item.quantity * item.unitPrice;
  const total = overrides.total ?? subtotal;
  return {
    id: overrides.id || 'LT-PROOF',
    customerName: 'Cliente Proof',
    customerPhone: '2995550000',
    address: 'Roca 123, Centro',
    deliveryMode: 'delivery',
    paymentMethod: 'Efectivo',
    paymentMethodCode: 'cash',
    notes: 'Sin notas',
    createdAt: '2026-06-06T11:00:00.000Z',
    status: overrides.status || 'received',
    items: overrides.items || [item],
    subtotal,
    deliveryFee: overrides.deliveryFee ?? 0,
    discountTotal: overrides.discountTotal ?? 0,
    total,
    statusHistory: overrides.statusHistory || [{ status: 'received', at: '2026-06-06T11:00:00.000Z' }],
    delivery: {
      driverName: 'Sin asignar',
      driverPhone: '',
      estimatedMinutes: 0,
      currentLocationLabel: 'Pedido recibido por el local',
      ...overrides.delivery,
    },
    ...overrides,
  };
}

function makeImageFile({ type = 'image/png', size = 1000 } = {}) {
  return { type, size };
}

function installCanvasStub({ sourceWidth, sourceHeight, toDataURL } = {}) {
  const canvasState = { width: 0, height: 0, type: '', quality: 0, calls: 0 };
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => ({
      width: sourceWidth,
      height: sourceHeight,
      close() {},
    }),
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        return {
          set width(value) { canvasState.width = value; },
          get width() { return canvasState.width; },
          set height(value) { canvasState.height = value; },
          get height() { return canvasState.height; },
          getContext(contextType) {
            assert.equal(contextType, '2d');
            return { drawImage() {} };
          },
          toDataURL(type, quality) {
            canvasState.type = type;
            canvasState.quality = quality;
            canvasState.calls += 1;
            return toDataURL ? toDataURL({ call: canvasState.calls, type, quality, width: canvasState.width, height: canvasState.height }) : VALID_PHOTO;
          },
        };
      },
    },
  });
  return canvasState;
}

function makeDataUrl(targetBytes) {
  const encodedLength = Math.max(4, Math.ceil((targetBytes * 4) / 3));
  return `data:image/jpeg;base64,${'A'.repeat(encodedLength)}`;
}

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
  };
}

function throwingStorage() {
  return {
    getItem() { return null; },
    setItem() { throw new Error('quota exceeded'); },
    removeItem() {},
    clear() {},
  };
}
