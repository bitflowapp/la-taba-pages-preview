import {
  addressSummary,
  findNearbySavedAddress,
  normalizeCustomerAddress,
} from './core/customer-addresses.js';
import { APP_MODE_PRODUCTION, getAppMode } from './core/app-mode.js';
import { getOrderRepository } from './repositories/repository_factory.js';
import { createCustomerGeolocationService } from './services/customer-geolocation.js';

const state = {
  initialized: false,
  loading: false,
  profile: null,
  addresses: [],
  selectedAddressId: '',
  editingAddressId: '',
  editorOpen: false,
  pendingDuplicate: null,
  pendingLocation: null,
  confirmedLocation: null,
  suggestion: null,
  suggestionDismissed: false,
  suggestionShown: false,
};

let locationService = null;

export async function initializeCustomerDeliveryCheckout() {
  if (state.initialized) return;
  state.initialized = true;
  bindCheckoutEvents();
  if (!isProduction()) {
    setContainerVisibility(false);
    return;
  }
  await loadCustomerDeliveryProfile();
}

export async function persistCustomerProfileAfterOrder(values = {}) {
  if (!isProduction() || !values.rememberCustomer) return { ok: true, skipped: true };
  const repository = profileRepository();
  if (!repository) return { ok: false, message: 'No pudimos guardar tus datos para próximos pedidos.' };
  const result = await repository.saveProfile({ name: values.customerName, phone: values.customerPhone });
  if (result.ok) state.profile = result.profile;
  return result;
}

export function resetCustomerDeliveryForTests() {
  Object.assign(state, {
    initialized: false,
    loading: false,
    profile: null,
    addresses: [],
    selectedAddressId: '',
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
}

async function loadCustomerDeliveryProfile() {
  const repository = profileRepository();
  if (!repository) return;
  state.loading = true;
  render();
  const result = await repository.load();
  state.loading = false;
  if (!result.ok) {
    render(result.message);
    return;
  }
  state.profile = result.profile;
  state.addresses = result.addresses;
  applyProfileToEmptyFields(result.profile);
  const defaultAddress = state.addresses.find((address) => address.isDefault) || state.addresses[0] || null;
  if (defaultAddress && checkoutAddressFieldsEmpty()) selectAddress(defaultAddress.id, { applyToForm: true, renderAfter: false });
  render();
}

function bindCheckoutEvents() {
  const form = checkoutForm();
  form?.addEventListener('input', (event) => {
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) return;
    if (['customerStreetAddress', 'customerNeighborhood', 'customerReference'].includes(event.target.name)) {
      clearSelectedAddress();
    }
  });

  document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('[data-customer-addresses]')) return;
    const action = target.closest('[data-customer-address-action]')?.dataset.customerAddressAction;
    if (!action) return;
    event.preventDefault();
    await handleAction(action, target.closest('[data-customer-address-id]')?.dataset.customerAddressId || '');
  });
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
    selectAddress(addressId);
    return;
  }
  if (action === 'edit') {
    const address = findAddress(addressId);
    if (!address) return;
    state.editingAddressId = address.id;
    state.editorOpen = true;
    applyAddressToForm(address);
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
    selectAddress(addressId);
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
    if (duplicate?.id) selectAddress(duplicate.id);
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

function selectAddress(addressId, { applyToForm = true, renderAfter = true } = {}) {
  const address = findAddress(addressId);
  if (!address) return;
  state.selectedAddressId = address.id;
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
  if (normalized.latitude != null && normalized.longitude != null) {
    setValue(form, 'deliveryLatitude', normalized.latitude);
    setValue(form, 'deliveryLongitude', normalized.longitude);
    setValue(form, 'deliveryGeolocationAccuracy', normalized.geolocationAccuracy || '');
    setValue(form, 'deliveryAddressSource', normalized.source);
    state.confirmedLocation = {
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      accuracy: normalized.geolocationAccuracy,
      source: normalized.source,
    };
  } else {
    clearLocationFields();
  }
}

function clearSelectedAddress() {
  if (!state.selectedAddressId) return;
  state.selectedAddressId = '';
  setValue(checkoutForm(), 'customerAddressId', '');
  render();
}

async function updateDefault(addressId) {
  const repository = profileRepository();
  if (!repository) return;
  const result = await repository.setDefault(addressId);
  if (!result.ok) {
    render(result.message);
    return;
  }
  state.addresses = state.addresses.map((address) => ({ ...address, isDefault: address.id === addressId }));
  render();
}

async function archiveAddress(addressId) {
  const address = findAddress(addressId);
  if (!address || !window.confirm(`¿Eliminar ${address.label}? Esta acción no modifica pedidos anteriores.`)) return;
  const repository = profileRepository();
  if (!repository) return;
  const result = await repository.archive(addressId);
  if (!result.ok) {
    render(result.message);
    return;
  }
  state.addresses = state.addresses.filter((entry) => entry.id !== addressId);
  if (state.selectedAddressId === addressId) clearSelectedAddress();
  if (state.editingAddressId === addressId) state.editingAddressId = '';
  render();
}

async function saveAddress() {
  const form = checkoutForm();
  if (!form) return;
  const label = String(form.elements?.customerAddressLabel?.value || '').trim();
  const candidate = normalizeCustomerAddress({
    id: state.editingAddressId,
    label,
    street: form.elements?.customerStreetAddress?.value || '',
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
  if (!label || !candidate.street || !candidate.city) {
    render('Completá etiqueta, calle y localidad antes de guardar la dirección.');
    return;
  }
  await persistAddress(candidate);
}

async function persistAddress(candidate, { allowDuplicate = false } = {}) {
  const repository = profileRepository();
  if (!repository) return;
  const form = checkoutForm();
  const profileResult = await repository.saveProfile({
    name: form?.elements?.customerName?.value || '',
    phone: form?.elements?.customerPhone?.value || '',
  });
  if (!profileResult.ok) {
    render(profileResult.message);
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
    render(result.message);
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
  selectAddress(result.address.id, { renderAfter: false });
  render('Dirección guardada.');
}

async function useCurrentLocation() {
  if (!locationService) locationService = createCustomerGeolocationService();
  render('Buscando tu ubicación…');
  const result = await locationService.requestCurrentLocation();
  if (!result.ok) {
    render(result.message);
    return;
  }
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
  if (!form.elements?.customerName?.value) setValue(form, 'customerName', profile.name);
  if (!form.elements?.customerPhone?.value) setValue(form, 'customerPhone', profile.phone);
}

function checkoutAddressFieldsEmpty() {
  const form = checkoutForm();
  return !String(form?.elements?.customerStreetAddress?.value || '').trim()
    && !String(form?.elements?.customerNeighborhood?.value || '').trim()
    && !String(form?.elements?.customerReference?.value || '').trim();
}

function clearLocationFields() {
  const form = checkoutForm();
  setValue(form, 'deliveryLatitude', '');
  setValue(form, 'deliveryLongitude', '');
  setValue(form, 'deliveryGeolocationAccuracy', '');
  setValue(form, 'deliveryAddressSource', 'manual');
}

function findAddress(addressId) {
  return state.addresses.find((address) => address.id === addressId) || null;
}

function render(message = '') {
  if (!isProduction()) return;
  const container = document.querySelector('[data-customer-addresses]');
  if (!container) return;
  container.hidden = false;
  const editing = findAddress(state.editingAddressId);
  const status = message || (state.loading ? 'Cargando tus datos guardados…' : '');
  container.innerHTML = `
    <section class="saved-addresses-panel" aria-labelledby="saved-addresses-title">
      <div class="saved-addresses-heading">
        <div>
          <span class="field-label" id="saved-addresses-title">Direcciones guardadas</span>
          <small>${state.addresses.length ? 'Elegí una dirección o administrá tu libreta.' : 'Podés guardar una dirección cuando quieras, sin frenar el pedido.'}</small>
        </div>
        <button class="secondary-button compact" type="button" data-customer-address-action="add">Agregar dirección</button>
      </div>
      <div class="saved-address-status" aria-live="polite">${escapeHtml(status)}</div>
      ${renderAddressList()}
      ${renderLocationPanel()}
      ${renderSuggestion()}
      ${renderDuplicatePanel()}
      ${renderAddressEditor(editing)}
    </section>`;
}

function renderAddressList() {
  if (!state.addresses.length) return '<p class="saved-address-empty">Todavía no tenés direcciones guardadas.</p>';
  return `<div class="saved-address-list" role="radiogroup" aria-label="Direcciones guardadas">
    ${state.addresses.map((address) => {
      const selected = address.id === state.selectedAddressId;
      const reference = address.reference ? `<small>${escapeHtml(address.reference)}</small>` : '';
      return `<article class="saved-address-card ${selected ? 'is-selected' : ''}" data-customer-address-id="${escapeAttr(address.id)}">
        <label class="saved-address-select">
          <input type="radio" name="savedCustomerAddress" ${selected ? 'checked' : ''} aria-label="Usar ${escapeAttr(address.label)}" data-customer-address-action="select" />
          <span><strong>${escapeHtml(address.label)}${address.isDefault ? ' · Principal' : ''}</strong><span>${escapeHtml(addressSummary(address))}</span>${reference}</span>
        </label>
        <div class="saved-address-actions">
          <button class="text-button" type="button" data-customer-address-action="select">Usar</button>
          <button class="text-button" type="button" data-customer-address-action="edit">Editar</button>
          ${address.isDefault ? '' : '<button class="text-button" type="button" data-customer-address-action="make-default">Principal</button>'}
          <button class="text-button danger" type="button" data-customer-address-action="delete">Eliminar</button>
        </div>
      </article>`;
    }).join('')}
  </div>`;
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
    <div class="saved-address-actions"><button class="secondary-button compact" type="button" data-customer-address-action="save-address">${editing ? 'Guardar cambios' : 'Guardar dirección'}</button></div>
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
