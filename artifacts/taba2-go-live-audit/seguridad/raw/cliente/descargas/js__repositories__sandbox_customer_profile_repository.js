import { normalizeCustomerAddress } from '../core/customer-addresses.js';
import { DEMO_CUSTOMER_DESTINATION } from '../core/business-location.js';
import {
  PROFILE_CHECKOUT_DEFAULT_ADDRESS_COUNT,
  profileCheckoutAddressScenario,
  profileCheckoutFixtureProfile,
} from '../core/profile-checkout.js';
import {
  isValidArgentinePhone,
  normalizeArgentinePhone,
  normalizeCustomerName,
  sanitizeText,
  validateCustomerName,
  validateRequiredStreetNumber,
} from '../core/validators.js';

// Repositorio de Perfil para demo y showcase. Implementa exactamente la misma
// interfaz que el repositorio Supabase (`load`, `saveProfile`, `saveAddress`,
// `setDefault`, `archive`) para que el checkout comparta un único componente,
// pero jamás sale a la red: todo vive en `localStorage` bajo un namespace
// propio, con datos sintéticos declarados acá.
//
// Nunca debe alcanzarse desde producción: la fábrica de repositorios sólo lo
// engancha al repositorio sandbox, y una configuración productiva incompleta
// resuelve a `unavailable`, que no expone `customerProfiles`.

const STORAGE_PREFIX = 'la-taba-sandbox-profile';

const SYNTHETIC_PROFILE = Object.freeze({
  demo: { id: 'demo-customer-0001', name: 'Cliente Demo', phone: '2990000001' },
  showcase: { id: 'showcase-customer-0001', name: 'Camila Ríos', phone: '2995550100' },
});

// Direcciones sintéticas de Neuquén capital. Son ficticias y no corresponden a
// ninguna persona real: sirven para ejercitar 1, 4 y 10 direcciones.
const SYNTHETIC_ADDRESSES = Object.freeze([
  { label: 'Casa', street: 'Avenida Argentina', streetNumber: '450', city: 'Neuquén Capital', reference: 'Portón negro, timbre 2' },
  { label: 'Trabajo', street: 'Julio Argentino Roca', streetNumber: '1220', city: 'Neuquén Capital', reference: 'Oficina 4B' },
  { label: 'Casa de mamá', street: 'Diagonal 9 de Julio', streetNumber: '87', city: 'Neuquén Capital', reference: '' },
  { label: 'Depto centro', street: 'General Manuel Belgrano', streetNumber: '333', city: 'Neuquén Capital', floor: '3', apartment: 'B' },
  { label: 'Quinta', street: 'Antártida Argentina', streetNumber: '2140', city: 'Neuquén Capital', reference: 'Casa del fondo' },
  { label: 'Estudio', street: 'Avenida Olascoaga', streetNumber: '755', city: 'Neuquén Capital', reference: '' },
  { label: 'Cabaña', street: 'Río Limay', streetNumber: '64', city: 'Neuquén Capital', reference: 'Portón de madera' },
  { label: 'Depósito', street: 'Doctor Ramón', streetNumber: '1890', city: 'Neuquén Capital', reference: 'Entrada por el lateral' },
  { label: 'Casa de Ana', street: 'Independencia', streetNumber: '512', city: 'Neuquén Capital', reference: '' },
  { label: 'Consultorio', street: 'Santa Fe', streetNumber: '145', city: 'Neuquén Capital', floor: '1', apartment: 'A' },
]);

// Punto sintético y estable por posición en la lista. Separarlos ~110 m evita
// que el detector de duplicados los tome por la misma puerta.
const SYNTHETIC_POINT_STEP = 0.001;
const SYNTHETIC_CONFIRMED_AT = '2026-08-08T18:00:00.000Z';

function syntheticConfirmedPoint(index) {
  return {
    latitude: Number((DEMO_CUSTOMER_DESTINATION.lat + index * SYNTHETIC_POINT_STEP).toFixed(6)),
    longitude: Number((DEMO_CUSTOMER_DESTINATION.lng - index * SYNTHETIC_POINT_STEP).toFixed(6)),
    geolocationAccuracy: 18,
    locationSource: 'map_pin',
    locationConfirmedAt: SYNTHETIC_CONFIRMED_AT,
  };
}

export function createSandboxCustomerProfileRepository({
  namespace = 'demo',
  storage = defaultStorage(),
  fixtureProfile = profileCheckoutFixtureProfile(),
  addressCount = profileCheckoutAddressScenario(),
} = {}) {
  const storageKey = `${STORAGE_PREFIX}:${namespace}`;

  function seed() {
    const base = SYNTHETIC_PROFILE[fixtureProfile] || SYNTHETIC_PROFILE.demo;
    const requested = Number.isFinite(addressCount)
      ? addressCount
      : PROFILE_CHECKOUT_DEFAULT_ADDRESS_COUNT;
    const total = Math.max(0, Math.min(requested, SYNTHETIC_ADDRESSES.length));
    const addresses = SYNTHETIC_ADDRESSES.slice(0, total).map((address, index) => normalizeCustomerAddress({
      ...address,
      id: `${namespace}-address-${String(index + 1).padStart(2, '0')}`,
      isDefault: index === 0,
      // Una dirección de entrega necesita punto confirmado, también en la
      // demostración: sin él el checkout la bloquea, que es justamente el
      // comportamiento que hay que poder mostrar funcionando. Los puntos son
      // sintéticos y derivan del destino demo —una plaza, un espacio público—,
      // así que la demo nunca señala dónde vive nadie.
      ...syntheticConfirmedPoint(index),
    }));
    return { profile: { ...base }, addresses };
  }

  function read() {
    const raw = safeGet(storage, storageKey);
    if (!raw) return persist(seed());
    try {
      const parsed = JSON.parse(raw);
      const addresses = Array.isArray(parsed?.addresses)
        ? parsed.addresses.map(normalizeCustomerAddress)
        : [];
      const profile = parsed?.profile && typeof parsed.profile === 'object' ? parsed.profile : {};
      return {
        profile: {
          id: sanitizeText(profile.id, { fallback: '', maxLength: 80 }),
          name: normalizeCustomerName(profile.name),
          phone: normalizeArgentinePhone(profile.phone),
          updatedAt: sanitizeText(profile.updatedAt, { fallback: '', maxLength: 40 }),
        },
        addresses,
      };
    } catch (_) {
      return persist(seed());
    }
  }

  function persist(snapshot) {
    safeSet(storage, storageKey, JSON.stringify(snapshot));
    return snapshot;
  }

  async function load() {
    const snapshot = read();
    return { ok: true, profile: { ...snapshot.profile }, addresses: snapshot.addresses.map((a) => ({ ...a })) };
  }

  async function saveProfile({ name, phone } = {}) {
    const nameValidation = validateCustomerName(name);
    if (!nameValidation.ok) return failure(nameValidation.message, 'validation');
    const normalizedPhone = normalizeArgentinePhone(phone);
    if (!isValidArgentinePhone(normalizedPhone)) {
      return failure('Ingresá un teléfono argentino válido, con código de área.', 'validation');
    }
    const snapshot = read();
    snapshot.profile = {
      ...snapshot.profile,
      name: nameValidation.name,
      phone: normalizedPhone,
      updatedAt: new Date().toISOString(),
    };
    persist(snapshot);
    return { ok: true, profile: { ...snapshot.profile } };
  }

  async function saveAddress(address, { allowDuplicate = false } = {}) {
    const { lastUsedAt, ...normalized } = normalizeCustomerAddress(address);
    const streetNumberValidation = validateRequiredStreetNumber(normalized.streetNumber);
    if (!streetNumberValidation.ok) return failure(streetNumberValidation.message, 'validation');

    const snapshot = read();
    const existingIndex = normalized.id
      ? snapshot.addresses.findIndex((candidate) => candidate.id === normalized.id)
      : -1;

    if (existingIndex < 0 && !allowDuplicate) {
      const duplicate = snapshot.addresses.find((candidate) => (
        candidate.street.toLowerCase() === normalized.street.toLowerCase()
        && candidate.streetNumber === normalized.streetNumber
      ));
      if (duplicate) {
        return {
          ok: false,
          code: 'duplicate',
          duplicate: { ...duplicate },
          message: 'Ya tenés una dirección parecida guardada.',
        };
      }
    }

    const saved = {
      ...normalized,
      id: normalized.id || `${namespace}-address-${Date.now().toString(36)}`,
    };
    if (existingIndex >= 0) snapshot.addresses[existingIndex] = saved;
    else snapshot.addresses.push(saved);
    if (saved.isDefault) {
      snapshot.addresses = snapshot.addresses.map((candidate) => ({
        ...candidate,
        isDefault: candidate.id === saved.id,
      }));
    } else if (!snapshot.addresses.some((candidate) => candidate.isDefault)) {
      snapshot.addresses[0] = { ...snapshot.addresses[0], isDefault: true };
    }
    persist(snapshot);
    return { ok: true, address: { ...saved } };
  }

  async function setDefault(addressId) {
    const id = sanitizeText(addressId, { fallback: '', maxLength: 80 });
    const snapshot = read();
    if (!snapshot.addresses.some((candidate) => candidate.id === id)) {
      return failure('Dirección no encontrada.');
    }
    snapshot.addresses = snapshot.addresses.map((candidate) => ({
      ...candidate,
      isDefault: candidate.id === id,
    }));
    persist(snapshot);
    return { ok: true, result: { id } };
  }

  async function archive(addressId) {
    const id = sanitizeText(addressId, { fallback: '', maxLength: 80 });
    const snapshot = read();
    const remaining = snapshot.addresses.filter((candidate) => candidate.id !== id);
    if (remaining.length === snapshot.addresses.length) return failure('Dirección no encontrada.');
    if (remaining.length && !remaining.some((candidate) => candidate.isDefault)) {
      remaining[0] = { ...remaining[0], isDefault: true };
    }
    snapshot.addresses = remaining;
    persist(snapshot);
    return { ok: true, result: { id } };
  }

  function resetSandboxProfile(nextCount = addressCount) {
    addressCount = nextCount;
    return persist(seed());
  }

  return { load, saveProfile, saveAddress, setDefault, archive, resetSandboxProfile };
}

function failure(message, code = 'unknown') {
  return { ok: false, code, message };
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch (_) {
    return null;
  }
}

function safeGet(storage, key) {
  try {
    return storage?.getItem?.(key) ?? '';
  } catch (_) {
    return '';
  }
}

function safeSet(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
  } catch (_) {
    /* almacenamiento no disponible: el escenario sigue funcionando en memoria */
  }
}
