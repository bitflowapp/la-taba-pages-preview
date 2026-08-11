import {
  addressSummary,
  findNearbySavedAddress,
  normalizeCustomerAddress,
} from './core/customer-addresses.js';
import {
  ADDRESS_HYDRATION_ACTION,
  ADDRESS_SOURCE,
  resolveAddressHydration,
} from './core/customer-delivery-address-hydration.js';
import {
  confirmedDeliveryLocationOf,
  hasConfirmedDeliveryLocation,
} from './core/delivery-location.js';
import { splitStreetAndNumber } from './core/address.js';
import { APP_MODE_PRODUCTION, getAppMode } from './core/app-mode.js';
import { supportsProfileCheckout } from './core/profile-checkout.js';
import { formatArgentinePhone, validateRequiredStreetNumber } from './core/validators.js';
import { getOrderRepository } from './repositories/repository_factory.js';
import { createCustomerGeolocationService } from './services/customer-geolocation.js';

const state = {
  initialized: false,
  loading: false,
  saving: false,
  profileHydrationVersion: 0,
  addressInteractionVersion: 0,
  profile: null,
  addresses: [],
  selectedAddressId: '',
  addressSource: ADDRESS_SOURCE.PROFILE_DEFAULT,
  addressFormDirty: false,
  editingAddressId: '',
  editorOpen: false,
  pendingDuplicate: null,
  pendingLocation: null,
  confirmedLocation: null,
  suggestion: null,
  suggestionDismissed: false,
  suggestionShown: false,
  blockedReason: '',
  addressListExpanded: false,
  // ¿Ya sabemos si esta persona tiene direcciones? Arranca en false porque las
  // direcciones llegan DESPUÉS del primer pintado. Mientras sea false, ninguna
  // pantalla puede afirmar «no tenés dirección»: todavía no lo sabe.
  addressesKnown: false,
};

// A partir de esta cantidad el listado se muestra compacto y expandible, para
// que 10 direcciones no empujen el resto del checkout fuera de pantalla.
export const ADDRESS_LIST_COMPACT_THRESHOLD = 4;
export const ADDRESS_LIST_COMPACT_VISIBLE = 3;

let locationService = null;

export async function initializeCustomerDeliveryCheckout() {
  if (state.initialized) return;
  state.initialized = true;
  bindCheckoutEvents();
  // El checkout por Perfil es el único checkout. Si el modo no declara una
  // autoridad de datos —preview o configuración productiva incompleta— no se
  // muestra ningún formulario alternativo: el pedido queda bloqueado.
  if (!supportsProfileCheckout()) {
    state.blockedReason = 'unsupported';
    // Sin autoridad de datos no va a llegar ninguna dirección nunca. Eso TAMBIÉN
    // es saber: el chip puede decir la verdad enseguida en vez de quedarse mudo.
    state.addressesKnown = true;
    render();
    notifyDeliveryAddressChanged();
    return;
  }
  await loadCustomerDeliveryProfile();
}

/*
 * ¿Se puede afirmar algo sobre las direcciones de esta persona?
 *
 * Las direcciones llegan del backend después del primer pintado. Hasta que
 * llegan —o hasta que se sabe que no van a llegar— el inicio no puede decir
 * «Elegí tu dirección», porque se lo diría también a quien tiene una
 * predeterminada confirmada. Eso es información falsa que invita a una acción
 * que no hace falta.
 */
export function deliveryAddressesKnown() {
  return state.addressesKnown === true;
}

export async function refreshCustomerDeliveryCheckout() {
  if (!supportsProfileCheckout()) return { ok: true, skipped: true };
  return loadCustomerDeliveryProfile();
}

/**
 * Dirección a la que iría el pedido AHORA: la elegida en el checkout o, si
 * todavía no se eligió ninguna, la predeterminada del Perfil. Sólo se devuelve
 * si tiene el punto confirmado: una dirección sin punto no es un destino al que
 * podamos llevar nada, y el checkout tampoco la deja elegir.
 *
 * La expone el checkout porque es quien ya carga y reconcilia el listado. El
 * chip «Enviar a» del encabezado la lee para dejar de contradecirlo: decía
 * «Elegí tu dirección» teniendo al lado una dirección predeterminada con su
 * punto confirmado, y en producción lo decía SIEMPRE, porque su única fuente
 * era la copia local del perfil, que producción no usa por diseño.
 */
export function getActiveDeliveryAddress() {
  const selected = findAddress(state.selectedAddressId) || defaultAddress();
  if (!selected) return null;
  const normalized = normalizeCustomerAddress(selected);
  return hasConfirmedDeliveryLocation(normalized) ? normalized : null;
}

// Se avisa sólo cuando el destino CAMBIA. `render()` corre en cada tecla del
// checkout y un evento por pulsación volvería a pintar la home sin motivo.
let notifiedDeliveryAddressKey = null;
function notifyDeliveryAddressChanged() {
  const address = getActiveDeliveryAddress();
  const key = address ? `${address.id}|${address.formattedAddress}` : '';
  if (key === notifiedDeliveryAddressKey) return;
  notifiedDeliveryAddressKey = key;
  try {
    window.dispatchEvent(new CustomEvent('taba:delivery-address-changed', { detail: { address } }));
  } catch (_) { /* sin CustomEvent el chip se queda como estaba: no rompe el checkout */ }
}

// Confirmar un pedido nunca escribe el Perfil. La administración de datos vive
// exclusivamente en Perfil; esta función se conserva para no romper el contrato
// de llamada, pero es deliberadamente inerte.
export async function persistCustomerProfileAfterOrder() {
  return { ok: true, skipped: true };
}

export function resetCustomerDeliveryForTests() {
  Object.assign(state, {
    initialized: false,
    loading: false,
    saving: false,
    profileHydrationVersion: 0,
    addressInteractionVersion: 0,
    profile: null,
    addresses: [],
    selectedAddressId: '',
    addressSource: ADDRESS_SOURCE.PROFILE_DEFAULT,
    addressFormDirty: false,
    editingAddressId: '',
    editorOpen: false,
    pendingDuplicate: null,
    pendingLocation: null,
    confirmedLocation: null,
    suggestion: null,
    suggestionDismissed: false,
    suggestionShown: false,
  });
  locationService = null;
  notifiedDeliveryAddressKey = null;
}

async function loadCustomerDeliveryProfile() {
  const repository = profileRepository();
  if (!repository) return { ok: false };
  const hydrationVersion = ++state.profileHydrationVersion;
  const interactionVersionAtStart = state.addressInteractionVersion;
  state.loading = true;
  render();
  const result = await repository.load();
  if (hydrationVersion !== state.profileHydrationVersion) return result;
  state.loading = false;
  // Terminó de intentar: haya traído direcciones o haya fallado, a partir de acá
  // ya se sabe lo que se puede saber.
  state.addressesKnown = true;
  if (!result.ok) {
    render(result.message);
    notifyDeliveryAddressChanged();
    return result;
  }
  state.profile = result.profile;
  state.addresses = result.addresses;
  applyProfileToEmptyFields(result.profile);
  reconcileHydratedAddress({ interactionVersionAtStart });
  render();
  // Las direcciones llegan DESPUÉS del primer pintado, así que el chip «Enviar
  // a» del inicio ya se dibujó sin ellas y dice «Elegí tu dirección» aunque la
  // persona tenga una predeterminada confirmada. Hasta acá nadie le avisaba: el
  // aviso sólo salía desde el checkout, una pantalla más adelante. Se avisa
  // también al hidratar, que es cuando el dato realmente aparece.
  notifyDeliveryAddressChanged();
  return result;
}

function bindCheckoutEvents() {
  const form = checkoutForm();
  form?.addEventListener('input', (event) => {
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) return;
    if (['customerStreetAddress', 'customerNeighborhood', 'customerReference'].includes(event.target.name)) {
      markAddressFormEditedByUser();
    }
  });

  // El modo de entrega decide si el selector de domicilios tiene sentido.
  form?.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === 'deliveryMode') {
      render();
    }
  });

  document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const profileAction = target.closest('[data-profile-checkout-action]')?.dataset.profileCheckoutAction;
    if (profileAction && target.closest('[data-customer-addresses]')) {
      event.preventDefault();
      handleProfileCheckoutAction(profileAction);
      return;
    }

    if (!target.closest('[data-customer-addresses]')) return;
    const action = target.closest('[data-customer-address-action]')?.dataset.customerAddressAction;
    if (!action) return;
    event.preventDefault();
    await handleAction(action, target.closest('[data-customer-address-id]')?.dataset.customerAddressId || '');
  });
  window.addEventListener('taba:customer-profile-updated', (event) => {
    if (event.detail?.source !== 'profile') return;
    void loadCustomerDeliveryProfile();
  });
  window.addEventListener('taba:checkout-session-started', () => {
    void beginCheckoutSession();
  });
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#cart') void beginCheckoutSession();
  });
}

async function beginCheckoutSession() {
  if (!isProduction()) return { ok: true, skipped: true };
  state.addressInteractionVersion += 1;
  state.addressSource = ADDRESS_SOURCE.PROFILE_DEFAULT;
  state.addressFormDirty = false;
  const cachedDefault = defaultAddress();
  if (cachedDefault) {
    selectAddress(cachedDefault.id, {
      source: ADDRESS_SOURCE.PROFILE_DEFAULT,
      userInitiated: false,
      renderAfter: false,
    });
  } else {
    clearSelectedAddress({ renderAfter: false });
  }
  render();
  return loadCustomerDeliveryProfile();
}

function reconcileHydratedAddress({ interactionVersionAtStart }) {
  if (!state.addresses.length) {
    state.addressSource = ADDRESS_SOURCE.PROFILE_DEFAULT;
    state.addressFormDirty = false;
    clearSelectedAddress({ renderAfter: false });
    clearVisibleAddressFields();
    return;
  }
  const currentDefault = defaultAddress();
  const currentSelection = findAddress(state.selectedAddressId);
  const action = resolveAddressHydration({
    selectedAddressId: state.selectedAddressId,
    selectedAddressExists: Boolean(currentSelection),
    defaultAddressId: currentDefault?.id,
    addressSource: state.addressSource,
    addressFormDirty: state.addressFormDirty,
    userInteractedWhileLoading: state.addressInteractionVersion !== interactionVersionAtStart,
  });

  if (action === ADDRESS_HYDRATION_ACTION.APPLY_DEFAULT && currentDefault) {
    selectAddress(currentDefault.id, {
      source: ADDRESS_SOURCE.PROFILE_DEFAULT,
      userInitiated: false,
      renderAfter: false,
    });
  } else if (action === ADDRESS_HYDRATION_ACTION.MANUAL_ENTRY) {
    moveToManualEntry({ preserveVisibleValues: true });
  } else if (action === ADDRESS_HYDRATION_ACTION.REAPPLY_SELECTION && currentSelection) {
    applyAddressToForm(currentSelection);
  }
}

async function handleAction(action, addressId) {
  if (action === 'add') {
    state.editingAddressId = '';
    state.pendingDuplicate = null;
    state.editorOpen = true;
    render();
    focusEditorLabel();
    return;
  }
  if (action === 'close-editor') {
    state.editorOpen = false;
    state.editingAddressId = '';
    state.pendingDuplicate = null;
    render();
    return;
  }
  if (action === 'select') {
    selectAddress(addressId, { source: ADDRESS_SOURCE.SAVED_ADDRESS_SELECTED });
    return;
  }
  if (action === 'edit') {
    const address = findAddress(addressId);
    if (!address) return;
    state.editingAddressId = address.id;
    state.editorOpen = true;
    selectAddress(address.id, {
      source: ADDRESS_SOURCE.SAVED_ADDRESS_SELECTED,
      renderAfter: false,
    });
    render();
    focusEditorLabel();
    return;
  }
  if (action === 'make-default') {
    await updateDefault(addressId);
    return;
  }
  if (action === 'delete') {
    await archiveAddress(addressId);
    return;
  }
  if (action === 'save-address') {
    await saveAddress();
    return;
  }
  if (action === 'use-location') {
    await useCurrentLocation();
    return;
  }
  if (action === 'confirm-location') {
    confirmPendingLocation();
    return;
  }
  if (action === 'discard-location') {
    state.pendingLocation = null;
    state.confirmedLocation = null;
    clearLocationFields();
    render();
    return;
  }
  if (action === 'suggestion-use') {
    selectAddress(addressId, { source: ADDRESS_SOURCE.SAVED_ADDRESS_SELECTED });
    state.suggestion = null;
    state.pendingLocation = null;
    render();
    return;
  }
  if (action === 'suggestion-review') {
    state.suggestion = null;
    state.editorOpen = true;
    render();
    document.querySelector('[name="customerStreetAddress"]')?.focus({ preventScroll: false });
    return;
  }
  if (action === 'suggestion-dismiss') {
    state.suggestion = null;
    state.suggestionDismissed = true;
    render();
    return;
  }
  if (action === 'duplicate-use') {
    const duplicate = state.pendingDuplicate?.duplicate;
    state.pendingDuplicate = null;
    if (duplicate?.id) {
      selectAddress(duplicate.id, { source: ADDRESS_SOURCE.SAVED_ADDRESS_SELECTED });
    }
    return;
  }
  if (action === 'duplicate-save') {
    const candidate = state.pendingDuplicate?.candidate;
    state.pendingDuplicate = null;
    if (candidate) await persistAddress(candidate, { allowDuplicate: true });
    return;
  }
  if (action === 'duplicate-cancel') {
    state.pendingDuplicate = null;
    render();
  }
}

function selectAddress(addressId, {
  applyToForm = true,
  renderAfter = true,
  source = ADDRESS_SOURCE.SAVED_ADDRESS_SELECTED,
  userInitiated = true,
} = {}) {
  const address = findAddress(addressId);
  if (!address) return;
  // Defensa de fondo: el control ya viene deshabilitado, pero elegir por código
  // una dirección sin punto confirmado dejaría el pedido a merced del rechazo
  // del servidor.
  if (!hasConfirmedDeliveryLocation(normalizeCustomerAddress(address))) return;
  if (userInitiated) state.addressInteractionVersion += 1;
  state.selectedAddressId = address.id;
  state.addressSource = source;
  state.addressFormDirty = false;
  state.pendingLocation = null;
  state.confirmedLocation = null;
  if (applyToForm) applyAddressToForm(address);
  if (renderAfter) render();
}

function applyAddressToForm(address) {
  const form = checkoutForm();
  if (!form) return;
  const normalized = normalizeCustomerAddress(address);
  setValue(form, 'customerStreetAddress', [normalized.street, normalized.streetNumber].filter(Boolean).join(' '));
  setValue(form, 'customerNeighborhood', normalized.city);
  setValue(form, 'customerReference', normalized.reference);
  setValue(form, 'customerAddressId', normalized.id);
  setValue(form, 'customerAddressLabel', normalized.label);
  setValue(form, 'deliveryStreet', normalized.street);
  setValue(form, 'deliveryStreetNumber', normalized.streetNumber);
  setValue(form, 'deliveryFloor', normalized.floor);
  setValue(form, 'deliveryApartment', normalized.apartment);
  setValue(form, 'deliveryCity', normalized.city);
  setValue(form, 'deliveryProvince', normalized.province);
  setValue(form, 'deliveryPostalCode', normalized.postalCode);
  // Sólo viaja al pedido un punto CONFIRMADO. Una dirección con coordenadas
  // viejas y sin confirmación se trata como lo que es: sin punto.
  const confirmed = confirmedDeliveryLocationOf(normalized);
  if (confirmed) {
    setValue(form, 'deliveryLatitude', confirmed.latitude);
    setValue(form, 'deliveryLongitude', confirmed.longitude);
    setValue(form, 'deliveryGeolocationAccuracy', confirmed.accuracyMeters ?? '');
    setValue(form, 'deliveryAddressSource', normalized.source);
    setValue(form, 'deliveryLocationSource', confirmed.locationSource);
    setValue(form, 'deliveryLocationConfirmedAt', confirmed.confirmedAt);
    state.confirmedLocation = confirmed;
  } else {
    clearLocationFields();
  }
}

function clearSelectedAddress({ renderAfter = true } = {}) {
  state.selectedAddressId = '';
  const form = checkoutForm();
  for (const name of [
    'customerAddressId',
    'customerAddressLabel',
    'deliveryStreet',
    'deliveryStreetNumber',
    'deliveryFloor',
    'deliveryApartment',
    'deliveryCity',
    'deliveryProvince',
    'deliveryPostalCode',
  ]) setValue(form, name, '');
  clearLocationFields();
  state.confirmedLocation = null;
  if (renderAfter) render();
}

function markAddressFormEditedByUser() {
  state.addressInteractionVersion += 1;
  state.addressFormDirty = true;
  state.addressSource = hasSavedProfileContext()
    ? ADDRESS_SOURCE.MANUAL_ENTRY
    : ADDRESS_SOURCE.GUEST_ENTRY;
  clearSelectedAddress();
}

function moveToManualEntry({ preserveVisibleValues = true } = {}) {
  state.addressSource = hasSavedProfileContext()
    ? ADDRESS_SOURCE.MANUAL_ENTRY
    : ADDRESS_SOURCE.GUEST_ENTRY;
  state.addressFormDirty = hasCheckoutAddressInput();
  clearSelectedAddress({ renderAfter: false });
  if (!preserveVisibleValues) clearVisibleAddressFields();
}

async function updateDefault(addressId) {
  if (state.saving) return;
  const repository = profileRepository();
  if (!repository) return;
  state.saving = true;
  let finalMessage = '';
  render('Guardando…');
  try {
    const result = await repository.setDefault(addressId);
    if (!result.ok) {
      finalMessage = result.message;
      return;
    }
    state.addresses = state.addresses.map((address) => ({ ...address, isDefault: address.id === addressId }));
    if (state.addressSource === ADDRESS_SOURCE.PROFILE_DEFAULT) {
      selectAddress(addressId, {
        source: ADDRESS_SOURCE.PROFILE_DEFAULT,
        userInitiated: false,
        renderAfter: false,
      });
    }
    notifyProfileUpdated();
  } finally {
    state.saving = false;
    render(finalMessage);
  }
}

async function archiveAddress(addressId) {
  if (state.saving) return;
  const address = findAddress(addressId);
  if (!address || !window.confirm(`¿Eliminar ${address.label}? Esta acción no modifica pedidos anteriores.`)) return;
  const repository = profileRepository();
  if (!repository) return;
  state.saving = true;
  let finalMessage = '';
  render('Eliminando…');
  try {
    const result = await repository.archive(addressId);
    if (!result.ok) {
      finalMessage = result.message;
      return;
    }
    const replacementId = String(result.result?.replacementId || '');
    state.addresses = state.addresses
      .filter((entry) => entry.id !== addressId)
      .map((entry) => ({ ...entry, isDefault: entry.id === replacementId }));
    if (state.selectedAddressId === addressId) {
      const replacement = defaultAddress();
      if (replacement) {
        selectAddress(replacement.id, {
          source: ADDRESS_SOURCE.PROFILE_DEFAULT,
          userInitiated: false,
          renderAfter: false,
        });
      } else {
        moveToManualEntry({ preserveVisibleValues: true });
      }
    }
    if (state.editingAddressId === addressId) state.editingAddressId = '';
    notifyProfileUpdated();
  } finally {
    state.saving = false;
    render(finalMessage);
  }
}

async function saveAddress() {
  if (state.saving) return;
  const form = checkoutForm();
  if (!form) return;
  const label = String(form.elements?.customerAddressLabel?.value || '').trim();
  const streetParts = splitStreetAndNumber(form.elements?.customerStreetAddress?.value || '');
  const candidate = normalizeCustomerAddress({
    id: state.editingAddressId,
    label,
    street: streetParts.street,
    streetNumber: streetParts.streetNumber,
    city: form.elements?.customerNeighborhood?.value || '',
    reference: form.elements?.customerReference?.value || '',
    floor: form.elements?.customerAddressFloor?.value || '',
    apartment: form.elements?.customerAddressApartment?.value || '',
    province: form.elements?.customerAddressProvince?.value || '',
    postalCode: form.elements?.customerAddressPostalCode?.value || '',
    latitude: state.confirmedLocation?.latitude,
    longitude: state.confirmedLocation?.longitude,
    geolocationAccuracy: state.confirmedLocation?.accuracy,
    source: state.confirmedLocation?.source || 'manual',
    isDefault: Boolean(form.elements?.customerAddressDefault?.checked),
  });
  const streetNumberValidation = validateRequiredStreetNumber(candidate.streetNumber);
  if (!label || !candidate.street || !streetNumberValidation.ok || !candidate.city) {
    render('Completá etiqueta, calle, número y localidad antes de guardar la dirección.');
    return;
  }
  await persistAddress(candidate);
}

async function persistAddress(candidate, { allowDuplicate = false } = {}) {
  if (state.saving) return;
  const repository = profileRepository();
  if (!repository) return;
  const form = checkoutForm();
  state.saving = true;
  let finalMessage = '';
  render('Guardando…');
  try {
    const profileResult = await repository.saveProfile({
      name: form?.elements?.customerName?.value || '',
      phone: form?.elements?.customerPhone?.value || '',
    });
    if (!profileResult.ok) {
      finalMessage = profileResult.message;
      return;
    }
    state.profile = profileResult.profile;
    const result = await repository.saveAddress(candidate, { allowDuplicate });
    if (result.code === 'duplicate') {
      state.pendingDuplicate = { candidate, duplicate: result.duplicate };
      render();
      return;
    }
    if (!result.ok) {
      finalMessage = result.message;
      return;
    }
    const index = state.addresses.findIndex((address) => address.id === result.address.id);
    if (index >= 0) state.addresses.splice(index, 1, result.address);
    else state.addresses.unshift(result.address);
    if (result.address.isDefault) {
      state.addresses = state.addresses.map((address) => ({ ...address, isDefault: address.id === result.address.id }));
    }
    state.editorOpen = false;
    state.editingAddressId = '';
    state.pendingDuplicate = null;
    selectAddress(result.address.id, {
      source: ADDRESS_SOURCE.SAVED_ADDRESS_SELECTED,
      renderAfter: false,
    });
    notifyProfileUpdated();
    finalMessage = 'Dirección guardada.';
  } finally {
    state.saving = false;
    render(finalMessage);
  }
}

async function useCurrentLocation() {
  if (!locationService) locationService = createCustomerGeolocationService();
  render('Buscando tu ubicación…');
  const result = await locationService.requestCurrentLocation();
  if (!result.ok) {
    render(result.message);
    return;
  }
  state.addressInteractionVersion += 1;
  state.addressFormDirty = true;
  state.addressSource = hasSavedProfileContext()
    ? ADDRESS_SOURCE.MANUAL_ENTRY
    : ADDRESS_SOURCE.GUEST_ENTRY;
  clearSelectedAddress({ renderAfter: false });
  state.pendingLocation = result.location;
  state.confirmedLocation = null;
  clearLocationFields();
  if (!state.suggestionDismissed && !state.suggestionShown) {
    const nearby = findNearbySavedAddress(result.location, state.addresses);
    state.suggestionShown = true;
    state.suggestion = nearby
      ? { kind: 'nearby', address: nearby.address }
      : { kind: 'new' };
  }
  render();
}

function confirmPendingLocation() {
  if (!state.pendingLocation) return;
  state.confirmedLocation = state.pendingLocation;
  state.pendingLocation = null;
  setValue(checkoutForm(), 'deliveryLatitude', state.confirmedLocation.latitude);
  setValue(checkoutForm(), 'deliveryLongitude', state.confirmedLocation.longitude);
  setValue(checkoutForm(), 'deliveryGeolocationAccuracy', state.confirmedLocation.accuracy);
  setValue(checkoutForm(), 'deliveryAddressSource', state.confirmedLocation.source);
  render('Ubicación confirmada para esta entrega. Revisá la dirección antes de continuar.');
}

function applyProfileToEmptyFields(profile) {
  const form = checkoutForm();
  if (!form || !profile) return;
  // Nombre y teléfono tienen una única autoridad: Perfil. El checkout no los
  // edita, por lo que nunca debe conservar valores ocultos de otro snapshot.
  setValue(form, 'customerName', profile.name);
  setValue(form, 'customerPhone', formatArgentinePhone(profile.phone));
}

function hasCheckoutAddressInput() {
  const form = checkoutForm();
  return [
    'customerStreetAddress',
    'customerNeighborhood',
    'customerReference',
  ].some((name) => String(form?.elements?.[name]?.value || '').trim());
}

function clearLocationFields() {
  const form = checkoutForm();
  setValue(form, 'deliveryLatitude', '');
  setValue(form, 'deliveryLongitude', '');
  setValue(form, 'deliveryGeolocationAccuracy', '');
  setValue(form, 'deliveryAddressSource', 'manual');
  setValue(form, 'deliveryLocationSource', '');
  setValue(form, 'deliveryLocationConfirmedAt', '');
}

function findAddress(addressId) {
  return state.addresses.find((address) => address.id === addressId) || null;
}

function defaultAddress() {
  return state.addresses.find((address) => address.isDefault) || null;
}

function hasSavedProfileContext() {
  return Boolean(state.profile?.id || state.addresses.length);
}

function clearVisibleAddressFields() {
  const form = checkoutForm();
  for (const name of [
    'customerStreetAddress',
    'customerNeighborhood',
    'customerReference',
  ]) setValue(form, name, '');
}

// El checkout sólo lee. Muestra quién recibe, deja elegir entre las direcciones
// guardadas y, si falta algo, bloquea con un camino claro hacia Perfil. Nunca
// crea, edita ni elimina datos del cliente.
function render(message = '') {
  syncAddressContractToForm();
  // Antes del contenedor: el destino cambió aunque esta vista no esté montada,
  // y el encabezado sí lo está.
  notifyDeliveryAddressChanged();
  const container = document.querySelector('[data-customer-addresses]');
  if (!container) return;
  container.hidden = false;
  const status = message || (state.loading ? 'Cargando tus datos guardados…' : '');
  container.innerHTML = `
    <section class="profile-checkout" data-profile-checkout aria-labelledby="profile-checkout-title">
      <h4 class="profile-checkout-title" id="profile-checkout-title">Tus datos</h4>
      <div class="saved-address-status" aria-live="polite">${escapeHtml(status)}</div>
      ${renderProfileSummary()}
      ${renderDeliveryAddressBlock()}
    </section>`;
}

function renderProfileSummary() {
  if (state.blockedReason === 'unsupported') {
    // "Esta vista no tiene una sesión de cliente disponible" describía el
    // motivo TÉCNICO —el despliegue no declara autoridad de datos— a alguien
    // que sólo quiere comprar. El hecho comercial es el mismo y se puede decir
    // sin jerga; el detalle técnico vive en la consola y en el diagnóstico del
    // repositorio, donde sirve.
    return `<div class="profile-checkout-block" data-profile-block="unsupported" role="status">
      <strong>Todavía no podemos tomar pedidos online</strong>
      <span>Esta tienda aún no tiene habilitados los pedidos por la app. Podés seguir mirando el catálogo.</span>
    </div>`;
  }
  const profile = state.profile || {};
  const missing = !String(profile.name || '').trim() || !String(profile.phone || '').trim();
  if (missing) {
    return `<div class="profile-checkout-block" data-profile-block="incomplete" role="status">
      <strong>Completá tu perfil para continuar</strong>
      <span>Necesitamos tu nombre y teléfono para que el local pueda entregarte el pedido.</span>
      <button class="primary-button compact" type="button" data-profile-checkout-action="edit-profile">Completar Perfil</button>
    </div>`;
  }
  return `<div class="profile-checkout-summary" data-profile-summary>
    <div class="profile-checkout-identity">
      <strong data-profile-name>${escapeHtml(profile.name)}</strong>
      <span data-profile-phone>${escapeHtml(formatArgentinePhone(profile.phone))}</span>
    </div>
    <button class="text-button" type="button" data-profile-checkout-action="edit-profile">Editar en Perfil</button>
  </div>`;
}

function renderDeliveryAddressBlock() {
  if (state.blockedReason === 'unsupported') return '';
  if (currentDeliveryModeIsPickup()) {
    return `<div class="profile-checkout-pickup" data-profile-pickup>
      <strong>Retirás en el local</strong>
      <span>No hace falta una dirección: te esperamos en el mostrador.</span>
    </div>`;
  }
  if (!state.addresses.length) {
    return `<div class="profile-checkout-block" data-profile-block="no-address" role="status">
      <strong>Agregá una dirección para recibir el pedido</strong>
      <span>Guardás la dirección una vez en tu Perfil y después la elegís en cada compra.</span>
      <button class="primary-button compact" type="button" data-profile-checkout-action="add-address">Agregar dirección en Perfil</button>
    </div>`;
  }
  // Tener direcciones no alcanza: para delivery hace falta al menos una con el
  // punto confirmado. Si ninguna lo tiene, se dice acá y no al apretar pagar.
  if (!state.addresses.some((address) => hasConfirmedDeliveryLocation(normalizeCustomerAddress(address)))) {
    return `<div class="profile-checkout-block" data-profile-block="no-confirmed-location" role="status">
      <strong>Confirmá dónde te entregamos</strong>
      <span>Ninguna de tus direcciones tiene todavía el punto de entrega confirmado. Sin ese punto, quien reparte no sabe a qué puerta tocar.</span>
      <button class="primary-button compact" type="button" data-profile-checkout-action="manage-addresses">Confirmar ubicación en Perfil</button>
    </div>`;
  }
  return `<div class="profile-checkout-addresses">
    <div class="profile-checkout-addresses-head">
      <span class="field-label" id="profile-addresses-title">¿Dónde lo llevamos?</span>
      <button class="text-button" type="button" data-profile-checkout-action="manage-addresses">Administrar en Perfil</button>
    </div>
    ${renderAddressList()}
  </div>`;
}

function currentDeliveryModeIsPickup() {
  const form = checkoutForm();
  return String(form?.elements?.deliveryMode?.value || '') === 'pickup';
}

// Navegar a Perfil no puede costar el carrito ni la selección ya hecha: se deja
// una marca de retorno y el estado del checkout permanece intacto en memoria.
function handleProfileCheckoutAction(action) {
  if (action === 'toggle-addresses') {
    state.addressListExpanded = !state.addressListExpanded;
    render();
    return;
  }
  if (['edit-profile', 'add-address', 'manage-addresses'].includes(action)) {
    try {
      globalThis.sessionStorage?.setItem?.('taba:profile-return', 'cart');
    } catch (_) { /* sin sessionStorage el retorno se hace con la navegación normal */ }
    window.dispatchEvent(new CustomEvent('taba:navigate-profile', {
      detail: { reason: action, returnTo: 'cart' },
    }));
  }
}

export function consumeProfileReturnTarget() {
  try {
    const value = globalThis.sessionStorage?.getItem?.('taba:profile-return') || '';
    if (value) globalThis.sessionStorage?.removeItem?.('taba:profile-return');
    return value;
  } catch (_) {
    return '';
  }
}

function syncAddressContractToForm() {
  const form = checkoutForm();
  if (!form) return;
  form.dataset.addressSource = state.addressSource;
  form.dataset.addressFormDirty = String(state.addressFormDirty);
  form.dataset.profileHydrationVersion = String(state.profileHydrationVersion);
}

// Sólo selección: administrar direcciones es responsabilidad de Perfil. Con
// pocas direcciones se listan todas; a partir del umbral el listado se muestra
// compacto y expandible para no desbordar el checkout.
function renderAddressList() {
  const total = state.addresses.length;
  const compact = total >= ADDRESS_LIST_COMPACT_THRESHOLD && !state.addressListExpanded;
  const selectedIndex = state.addresses.findIndex((address) => address.id === state.selectedAddressId);
  const visible = compact
    ? dedupeById([
      ...(selectedIndex >= 0 ? [state.addresses[selectedIndex]] : []),
      ...state.addresses.slice(0, ADDRESS_LIST_COMPACT_VISIBLE),
    ]).slice(0, ADDRESS_LIST_COMPACT_VISIBLE)
    : state.addresses;
  const hidden = total - visible.length;

  const cards = visible.map((address) => {
    const selected = address.id === state.selectedAddressId;
    const reference = address.reference ? `<small>${escapeHtml(address.reference)}</small>` : '';
    // Una dirección sin punto confirmado no se puede elegir para delivery: el
    // backend la rechazaría igual, y el rechazo llegaría después del pago.
    const confirmed = hasConfirmedDeliveryLocation(normalizeCustomerAddress(address));
    return `<label class="profile-address-card ${selected ? 'is-selected' : ''} ${confirmed ? '' : 'needs-location'}" data-customer-address-id="${escapeAttr(address.id)}" data-address-location="${confirmed ? 'confirmed' : 'missing'}">
      <input
        type="radio"
        name="savedCustomerAddress"
        value="${escapeAttr(address.id)}"
        ${selected ? 'checked' : ''}
        ${confirmed ? '' : 'disabled aria-disabled="true"'}
        data-customer-address-action="select"
      />
      <span class="profile-address-copy">
        <span class="profile-address-head">
          <strong>${escapeHtml(address.label)}</strong>
          ${address.isDefault ? '<span class="profile-address-badge">Principal</span>' : ''}
        </span>
        <span class="profile-address-line">${escapeHtml(addressSummary(address))}</span>
        ${reference}
        ${confirmed
    ? '<span class="profile-address-location is-confirmed">Ubicación confirmada</span>'
    : '<span class="profile-address-location is-missing">Falta confirmar dónde te entregamos</span>'}
      </span>
    </label>`;
  }).join('');

  const toggle = total >= ADDRESS_LIST_COMPACT_THRESHOLD
    ? `<button class="text-button profile-address-toggle" type="button" data-profile-checkout-action="toggle-addresses" aria-expanded="${state.addressListExpanded ? 'true' : 'false'}">${
      state.addressListExpanded
        ? 'Ver menos direcciones'
        : `Ver las ${total} direcciones${hidden > 0 ? ` (${hidden} más)` : ''}`
    }</button>`
    : '';

  return `<div class="profile-address-list ${state.addressListExpanded ? 'is-expanded' : ''}" role="radiogroup" aria-labelledby="profile-addresses-title" data-address-total="${total}">
    ${cards}
  </div>${toggle}`;
}

function dedupeById(list) {
  const seen = new Set();
  return list.filter((item) => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function renderLocationPanel() {
  if (state.pendingLocation) {
    return `<aside class="location-review" aria-live="polite">
      <strong>Ubicación aproximada recibida</strong>
      <span>Usamos tu ubicación solo para ayudarte a completar la dirección. No la usamos ni guardamos hasta que la confirmes.</span>
      <small>No hay un geocodificador configurado: revisá calle, número y localidad manualmente.</small>
      <div class="saved-address-actions"><button class="secondary-button compact" type="button" data-customer-address-action="confirm-location">Confirmar ubicación</button><button class="text-button" type="button" data-customer-address-action="discard-location">Descartar</button></div>
    </aside>`;
  }
  if (state.confirmedLocation) {
    return `<aside class="location-review is-confirmed" aria-live="polite">
      <strong>Ubicación confirmada para esta entrega</strong>
      <span>Revisá la dirección postal antes de continuar.</span>
      <button class="text-button" type="button" data-customer-address-action="discard-location">Quitar ubicación</button>
    </aside>`;
  }
  return `<div class="location-helper"><button class="secondary-button compact" type="button" data-customer-address-action="use-location">Usar mi ubicación</button><small>Usamos tu ubicación solo para ayudarte a completar la dirección.</small></div>`;
}

function renderSuggestion() {
  if (!state.suggestion) return '';
  if (state.suggestion.kind === 'nearby') {
    const address = state.suggestion.address;
    return `<aside class="address-suggestion" aria-live="polite"><span>Parece que estás cerca de ${escapeHtml(address.label)}. ¿Usar esta dirección?</span><div><button class="text-button" type="button" data-customer-address-action="suggestion-use" data-customer-address-id="${escapeAttr(address.id)}">Usar ${escapeHtml(address.label)}</button><button class="text-button" type="button" data-customer-address-action="suggestion-dismiss">Ahora no</button></div></aside>`;
  }
  return `<aside class="address-suggestion" aria-live="polite"><span>¿Querés revisar esta ubicación antes de usarla?</span><div><button class="text-button" type="button" data-customer-address-action="suggestion-review">Revisar dirección</button><button class="text-button" type="button" data-customer-address-action="suggestion-dismiss">Ahora no</button></div></aside>`;
}

function renderDuplicatePanel() {
  if (!state.pendingDuplicate?.duplicate) return '';
  const duplicate = state.pendingDuplicate.duplicate;
  return `<aside class="address-duplicate" aria-live="assertive"><strong>Ya tenés una dirección parecida guardada como ${escapeHtml(duplicate.label)}.</strong><div><button class="text-button" type="button" data-customer-address-action="duplicate-use">Usar ${escapeHtml(duplicate.label)}</button><button class="text-button" type="button" data-customer-address-action="duplicate-save">Guardar igualmente</button><button class="text-button" type="button" data-customer-address-action="duplicate-cancel">Cancelar</button></div></aside>`;
}

function renderAddressEditor(editing) {
  if (!state.editorOpen) return '';
  const address = editing || {};
  return `<div class="address-editor" data-address-editor>
    <div class="saved-addresses-heading"><strong>${editing ? 'Editar dirección' : 'Nueva dirección'}</strong><button class="text-button" type="button" data-customer-address-action="close-editor">Cerrar</button></div>
    <label>Etiqueta<input name="customerAddressLabel" maxlength="60" value="${escapeAttr(address.label || 'Casa')}" placeholder="Casa, Trabajo u Otro" /></label>
    <div class="field-grid compact-grid">
      <label>Piso<input name="customerAddressFloor" maxlength="24" value="${escapeAttr(address.floor || '')}" autocomplete="address-line2" /></label>
      <label>Departamento<input name="customerAddressApartment" maxlength="24" value="${escapeAttr(address.apartment || '')}" autocomplete="address-line2" /></label>
      <label>Provincia<input name="customerAddressProvince" maxlength="100" value="${escapeAttr(address.province || '')}" autocomplete="address-level1" /></label>
      <label>Código postal<input name="customerAddressPostalCode" maxlength="20" value="${escapeAttr(address.postalCode || '')}" autocomplete="postal-code" /></label>
    </div>
    <label class="address-default-toggle"><input name="customerAddressDefault" type="checkbox" ${editing?.isDefault || (!editing && !state.addresses.length) ? 'checked' : ''} /> Marcar como dirección principal</label>
    <div class="saved-address-actions"><button class="secondary-button compact" type="button" data-customer-address-action="save-address" ${disabledAttr()}>${state.saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar dirección'}</button></div>
  </div>`;
}

function setContainerVisibility(visible) {
  const container = document.querySelector('[data-customer-addresses]');
  if (container) container.hidden = !visible;
}

function profileRepository() {
  return getOrderRepository()?.customerProfiles || null;
}

function checkoutForm() {
  return document.querySelector('[data-checkout-form]');
}

function setValue(form, name, value) {
  const field = form?.elements?.[name];
  if (field) field.value = value == null ? '' : String(value);
}

function focusEditorLabel() {
  setTimeout(() => document.querySelector('[name="customerAddressLabel"]')?.focus(), 0);
}

function isProduction() {
  return getAppMode() === APP_MODE_PRODUCTION;
}

function disabledAttr() {
  return state.saving ? 'disabled aria-disabled="true"' : '';
}

function notifyProfileUpdated() {
  window.dispatchEvent(new CustomEvent('taba:customer-profile-updated', {
    detail: { source: 'checkout' },
  }));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
