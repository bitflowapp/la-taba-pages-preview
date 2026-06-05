import { buildDefaultBusinessConfig } from './business-config-store.js';
import { sanitizeText } from './validators.js';
import { updateBusinessConfig } from '../state.js';

const TEXT_LIMITS = Object.freeze({
  businessName: 80,
  subtitle: 80,
  address: 180,
  deliveryZone: 160,
  openingHoursLabel: 120,
});

function cleanText(value, maxLength) {
  return sanitizeText(value, { maxLength });
}

function moneyValue(value) {
  if (value === '' || value == null) return 0;
  return Number(value);
}

function hourValue(value) {
  if (value === '' || value == null) return NaN;
  return Number(value);
}

function whatsappDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function validateMoney(label, value, errors) {
  const numeric = moneyValue(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    errors.push(`${label} debe ser 0 o mayor.`);
  }
}

function validateHour(label, value, errors) {
  const numeric = hourValue(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 24) {
    errors.push(`${label} debe estar entre 0 y 24.`);
  }
}

export function validateBusinessSetup(values = {}) {
  const errors = [];
  const businessName = cleanText(values.businessName, TEXT_LIMITS.businessName);
  const whatsappNumber = cleanText(values.whatsappNumber, 40);
  const address = cleanText(values.address, TEXT_LIMITS.address);
  const orderPrefix = String(values.orderPrefix || '').trim().toUpperCase();
  const adminPin = String(values.adminPin || '').trim();

  if (!businessName) errors.push('El nombre del comercio es obligatorio.');
  if (!address) errors.push('La dirección es obligatoria.');

  if (!whatsappNumber) {
    errors.push('El WhatsApp es obligatorio.');
  } else if (!/^[+\d\s().-]+$/.test(whatsappNumber) || whatsappDigits(whatsappNumber).length < 8 || whatsappDigits(whatsappNumber).length > 20) {
    errors.push('El WhatsApp debe ser numérico y tener entre 8 y 20 dígitos.');
  }

  if (!/^[A-Z0-9]{2,6}$/.test(orderPrefix)) {
    errors.push('El prefijo de pedido debe ser alfanumérico y tener 2 a 6 caracteres.');
  }

  if (!/^\d{4,6}$/.test(adminPin)) {
    errors.push('El PIN del negocio debe tener 4 a 6 dígitos.');
  }

  validateMoney('El costo de envío', values.deliveryFee, errors);
  validateMoney('El pedido mínimo delivery', values.minDeliveryOrder, errors);
  validateHour('La hora de apertura', values.openHour, errors);
  validateHour('La hora de cierre', values.closeHour, errors);

  return {
    ok: errors.length === 0,
    errors,
    message: errors[0] || '',
  };
}

export function buildBusinessSetupPatch(values = {}) {
  const businessName = cleanText(values.businessName, TEXT_LIMITS.businessName);
  const openingHoursLabel = cleanText(values.openingHoursLabel, TEXT_LIMITS.openingHoursLabel);

  return {
    businessName,
    name: businessName,
    subtitle: cleanText(values.subtitle, TEXT_LIMITS.subtitle),
    orderPrefix: String(values.orderPrefix || '').trim().toUpperCase(),
    address: cleanText(values.address, TEXT_LIMITS.address),
    whatsappNumber: whatsappDigits(values.whatsappNumber),
    deliveryZone: cleanText(values.deliveryZone, TEXT_LIMITS.deliveryZone),
    openingHoursLabel,
    openingHours: openingHoursLabel,
    openHour: hourValue(values.openHour),
    closeHour: hourValue(values.closeHour),
    deliveryFee: moneyValue(values.deliveryFee),
    minDeliveryOrder: moneyValue(values.minDeliveryOrder),
    adminPin: String(values.adminPin || '').trim(),
  };
}

export function saveBusinessSetup(values = {}, updateConfig = updateBusinessConfig) {
  const validation = validateBusinessSetup(values);
  if (!validation.ok) {
    return { handled: true, ok: false, message: validation.message, errors: validation.errors };
  }

  const config = updateConfig(buildBusinessSetupPatch(values));
  return { handled: true, ok: true, message: 'Configuración guardada.', config };
}

export function restoreBusinessSetupDemo({ confirmed = false, updateConfig = updateBusinessConfig } = {}) {
  if (!confirmed) {
    return {
      handled: true,
      ok: false,
      needsConfirmation: true,
      message: 'Esto restaurara los datos demo del comercio. No borra pedidos, productos, carrito, historial de clientes ni cierres de caja.',
    };
  }

  const config = updateConfig(buildDefaultBusinessConfig());
  return { handled: true, ok: true, message: 'Configuración demo restaurada.', config };
}
