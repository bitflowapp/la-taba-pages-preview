export const DELIVERY_PIN_LENGTH = 4;

const DELIVERY_PIN_PATTERN = /^\d{4}$/;
const DELIVERY_STATUSES = new Set(['delivered']);
const DELIVERY_PIN_STATUS_CONFIRMED = 'confirmed';
const DELIVERY_PIN_STATUS_PENDING = 'pending';

export function normalizeDeliveryPin(value) {
  const raw = isPlainObject(value)
    ? value.code ?? value.pin ?? value.value ?? value.deliveryPin
    : value;
  const digits = String(raw ?? '').replace(/\D/g, '');
  return DELIVERY_PIN_PATTERN.test(digits) ? digits : '';
}

export function normalizeDeliveryPinStatus(value) {
  return String(value || '').trim() === DELIVERY_PIN_STATUS_CONFIRMED
    ? DELIVERY_PIN_STATUS_CONFIRMED
    : DELIVERY_PIN_STATUS_PENDING;
}

export function formatDeliveryPin(value) {
  const pin = normalizeDeliveryPin(value);
  return pin ? `${pin.slice(0, 2)} ${pin.slice(2)}` : '';
}

export function createDeliveryPin() {
  return String(randomInt(10 ** DELIVERY_PIN_LENGTH)).padStart(DELIVERY_PIN_LENGTH, '0');
}

export function createDeliveryPinState(code = createDeliveryPin(), status = DELIVERY_PIN_STATUS_PENDING, confirmedAt = '', attempts = 0) {
  const pin = normalizeDeliveryPin(code) || createDeliveryPin();
  const normalizedStatus = normalizeDeliveryPinStatus(status);
  const normalizedConfirmedAt = normalizeTimestamp(confirmedAt);
  const normalizedAttempts = normalizeAttempts(attempts);
  return {
    code: pin,
    status: normalizedStatus,
    attempts: normalizedAttempts,
    ...(normalizedStatus === DELIVERY_PIN_STATUS_CONFIRMED && normalizedConfirmedAt
      ? { confirmedAt: normalizedConfirmedAt }
      : {}),
  };
}

export function normalizeDeliveryPinState(value, {
  fallbackCode = '',
  status = '',
  confirmedAt = '',
  attempts = 0,
} = {}) {
  const code = normalizeDeliveryPin(value) || normalizeDeliveryPin(fallbackCode);
  if (!code) return '';
  const rawStatus = isPlainObject(value) ? value.status : status;
  const rawConfirmedAt = isPlainObject(value)
    ? value.confirmedAt ?? value.confirmed_at ?? confirmedAt
    : confirmedAt;
  const rawAttempts = isPlainObject(value) ? value.attempts ?? attempts : attempts;
  return createDeliveryPinState(code, rawStatus || status, rawConfirmedAt, rawAttempts);
}

export function confirmDeliveryPin(value, confirmedAt = new Date().toISOString()) {
  const current = normalizeDeliveryPinState(value);
  return current ? createDeliveryPinState(current.code, DELIVERY_PIN_STATUS_CONFIRMED, confirmedAt, current.attempts) : '';
}

export function incrementDeliveryPinAttempts(value) {
  const current = normalizeDeliveryPinState(value);
  return current ? createDeliveryPinState(current.code, current.status, current.confirmedAt, current.attempts + 1) : '';
}

export function deliveryPinIsConfirmed(order = {}) {
  return normalizeDeliveryPinStatus(
    order.deliveryPin?.status
      ?? order.delivery_pin_status
      ?? order.delivery?.deliveryPin?.status
      ?? order.delivery?.pinStatus
      ?? (order.deliveryPin?.confirmedAt || order.delivery?.deliveryPin?.confirmedAt || order.delivery?.pinConfirmedAt || order.deliveryPinConfirmedAt
        ? DELIVERY_PIN_STATUS_CONFIRMED
        : ''),
  ) === DELIVERY_PIN_STATUS_CONFIRMED;
}

export function resolveDeliveryPin(order = {}) {
  const direct = normalizeDeliveryPin(
    order.deliveryPin
      ?? order.delivery_pin
      ?? order.delivery?.pin
      ?? order.delivery?.deliveryPin
      ?? order.delivery?.delivery_pin,
  );
  if (direct) return direct;
  if (!isDeliveryOrder(order)) return '';
  return deriveDeliveryPin(order);
}

export function verifyDeliveryPinForOrder(order, value) {
  const expected = resolveDeliveryPin(order);
  const submitted = normalizeDeliveryPin(value);
  return Boolean(expected && submitted && expected === submitted);
}

export function validateDeliveryPinForCompletion(order, nextStatus, value, options = {}) {
  if (!deliveryPinRequiredForCompletion(order, nextStatus, options)) {
    return { ok: true, pin: normalizeDeliveryPin(value) };
  }

  if (!normalizeDeliveryPin(value)) {
    return { ok: false, reason: 'missing', message: 'Pedile al cliente el PIN de entrega.' };
  }

  if (!verifyDeliveryPinForOrder(order, value)) {
    return { ok: false, reason: 'mismatch', message: 'PIN de entrega incorrecto.' };
  }

  return { ok: true, pin: normalizeDeliveryPin(value) };
}

export function deliveryPinRequiredForCompletion(order, nextStatus, options = {}) {
  return Boolean(
    options.requireDeliveryPin
      && isDeliveryOrder(order)
      && DELIVERY_STATUSES.has(normalizeStatus(nextStatus)),
  );
}

function isDeliveryOrder(order = {}) {
  const mode = String(order.deliveryMode || order.delivery_mode || order.fulfillmentType || order.fulfillment_type || 'delivery');
  return mode !== 'pickup';
}

function normalizeStatus(status) {
  const raw = String(status || '').trim();
  if (raw === 'arrived') return 'arriving';
  if (raw === 'canceled') return 'cancelled';
  return raw;
}

function deriveDeliveryPin(order = {}) {
  const seed = [
    order.id,
    order.code,
    order.public_code,
    order.createdAt,
    order.created_at,
    order.customerPhone,
    order.customer_phone,
  ].filter(Boolean).join('|') || 'la-taba-delivery';

  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return String((hash >>> 0) % (10 ** DELIVERY_PIN_LENGTH)).padStart(DELIVERY_PIN_LENGTH, '0');
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function normalizeAttempts(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function randomInt(maxExclusive) {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const bucket = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    do {
      cryptoApi.getRandomValues(bucket);
    } while (bucket[0] >= limit);
    return bucket[0] % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}
