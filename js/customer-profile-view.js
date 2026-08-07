import {
  addressSummary,
  normalizeCustomerAddress,
} from './core/customer-addresses.js';
import {
  APP_MODE_DEMO,
  APP_MODE_PRODUCTION,
  getAppMode,
  isShowcaseMode,
} from './core/app-mode.js';
import {
  formatArgentinePhone,
  isValidArgentinePhone,
  normalizeArgentinePhone,
  validateCustomerName,
} from './core/validators.js';
import { getOrderRepository } from './repositories/repository_factory.js';
import { createCustomerGeolocationService } from './services/customer-geolocation.js';

const state = {
  initialized: false,
  loading: false,
  saving: false,
  loadVersion: 0,
  profile: null,
  addresses: [],
  editingPersonal: false,
  editorOpen: false,
  editingAddressId: '',
  pendingDuplicate: null,
  // Ubicación recibida del dispositivo y todavía sin confirmar por la persona.
  pendingLocation: null,
  // Ubicación que la persona confirmó para esta dirección; es la única que se
  // guarda. Sin confirmación explícita la dirección queda `manual`, como antes.
  confirmedLocation: null,
  locating: false,
  locationError: '',
  // Lo que la persona tiene escrito en el editor, para que un re-render no se
  // lo lleve puesto.
  addressDraft: null,
  status: '',
  statusTone: '',
  availability: 'ready',
  returnTo: '',
};

const geolocationService = createCustomerGeolocationService();

const PROFILE_RETURN_STORAGE_KEY = 'taba:profile-return';

// Iconografía del perfil. Van `aria-hidden`: el nombre accesible de cada control
// es su texto visible, que dice exactamente lo mismo (WCAG 2.5.3). Los glifos
// tipográficos que había antes (⌂, ▣) se veían distintos en cada equipo y en el
// Moto quedaban como un cuadrado.
const PIN_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true"><path d="M12 21.3s-6.4-6.1-6.4-10.8a6.4 6.4 0 0 1 12.8 0c0 4.7-6.4 10.8-6.4 10.8Z" fill="currentColor"/><circle cx="12" cy="10.2" r="2.4" fill="#fff"/></svg>';
const PERSON_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true"><circle cx="12" cy="7.8" r="3.9" stroke="currentColor" stroke-width="1.9"/><path d="M4.6 20.2a7.4 7.4 0 0 1 14.8 0" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
const PENCIL_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2m-7 0 .9 12h8.2L17 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="m5 12.6 4.6 4.6L19 7.8" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export async function initializeCustomerProfileView() {
  if (state.initialized) return;
  state.initialized = true;
  state.returnTo = resolveProfileReturnTarget();
  bindEvents();
  await loadCustomerProfileView();
}

export async function loadCustomerProfileView() {
  const mode = getAppMode();
  if (![APP_MODE_DEMO, APP_MODE_PRODUCTION].includes(mode)) {
    state.availability = 'preview';
    state.profile = null;
    state.addresses = [];
    render();
    return { ok: true, skipped: true };
  }

  const repository = profileRepository();
  if (!repository) {
    state.availability = 'unavailable';
    state.status = 'El perfil no está disponible por un problema de configuración.';
    state.statusTone = 'error';
    render();
    return { ok: false, code: 'unavailable' };
  }

  const loadVersion = ++state.loadVersion;
  state.loading = true;
  state.status = '';
  state.statusTone = '';
  render();
  const result = await repository.load();
  if (loadVersion !== state.loadVersion) return result;
  state.loading = false;
  if (!result.ok) {
    state.availability = result.code || 'error';
    state.status = result.message;
    state.statusTone = 'error';
    render();
    return result;
  }
  state.availability = 'ready';
  state.profile = result.profile;
  state.addresses = result.addresses;
  state.status = '';
  state.statusTone = '';
  render();
  return result;
}

export function resetCustomerProfileViewForTests() {
  Object.assign(state, {
    initialized: false,
    loading: false,
    saving: false,
    loadVersion: 0,
    profile: null,
    addresses: [],
    editingPersonal: false,
    editorOpen: false,
    editingAddressId: '',
    pendingDuplicate: null,
    status: '',
    statusTone: '',
    availability: 'ready',
    returnTo: '',
  });
}

function bindEvents() {
  const container = profileContainer();
  container?.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const action = target.closest('[data-profile-action]')?.dataset.profileAction;
    if (!action) return;
    event.preventDefault();
    const addressId = target.closest('[data-profile-address-id]')?.dataset.profileAddressId || '';
    await handleAction(action, addressId);
  });

  window.addEventListener('taba:customer-profile-updated', (event) => {
    if (event.detail?.source === 'profile') return;
    if (state.editingPersonal || state.editorOpen) {
      setStatus('Tus datos cambiaron en el checkout. Terminá o cancelá esta edición para recargar.', 'warning');
      return;
    }
    void loadCustomerProfileView();
  });
  window.addEventListener('taba:navigate-profile', () => {
    if (isEditableMode()) void loadCustomerProfileView();
  });
  window.addEventListener('online', () => {
    if (['offline', 'network', 'error'].includes(state.availability)) void loadCustomerProfileView();
  });
  window.addEventListener('offline', () => setStatus('Sin conexión. Conservamos esta pantalla; volvé a intentar cuando regreses online.', 'error'));
}

async function handleAction(action, addressId) {
  if (state.saving) return;
  if (action === 'retry') {
    await loadCustomerProfileView();
    return;
  }
  if (action === 'return-to-checkout') {
    const returnTo = state.returnTo || resolveProfileReturnTarget();
    state.returnTo = '';
    state.editingPersonal = false;
    state.editorOpen = false;
    state.status = returnTo ? '' : 'No encontramos a dónde retornar. Volviendo al inicio de tu carrito.';
    state.statusTone = returnTo ? '' : 'error';
    clearProfileReturnTarget();
    window.dispatchEvent(new CustomEvent('taba:profile-return', { detail: { returnTo } }));
    return;
  }
  if (action === 'edit-personal') {
    state.editingPersonal = true;
    setStatus('', '');
    queueFocus('[name="profileFullName"]');
    return;
  }
  if (action === 'cancel-personal') {
    state.editingPersonal = false;
    setStatus('', '');
    return;
  }
  if (action === 'save-personal') {
    await savePersonalData();
    return;
  }
  if (action === 'add-address') {
    if (!hasOperationalProfile()) {
      state.editingPersonal = true;
      setStatus('Guardá primero tu nombre y teléfono.', 'warning');
      queueFocus('[name="profileFullName"]');
      return;
    }
    state.editorOpen = true;
    state.editingAddressId = '';
    state.pendingDuplicate = null;
    resetLocationDraft();
    setStatus('', '');
    queueFocus('[name="profileAddressStreet"]');
    return;
  }
  if (action === 'edit-address') {
    if (!findAddress(addressId)) return;
    state.editorOpen = true;
    state.editingAddressId = addressId;
    state.pendingDuplicate = null;
    // Editar no puede perder la ubicación ya guardada: se rehidrata desde la
    // dirección, si no volvería a salir como `manual` al volver a guardar.
    hydrateLocationDraft(findAddress(addressId));
    setStatus('', '');
    queueFocus('[name="profileAddressStreet"]');
    return;
  }
  if (action === 'cancel-address') {
    state.editorOpen = false;
    state.editingAddressId = '';
    state.pendingDuplicate = null;
    resetLocationDraft();
    setStatus('', '');
    return;
  }
  if (action === 'use-location') {
    captureEditorDraft();
    await requestLocation();
    return;
  }
  if (action === 'confirm-location') {
    if (!state.pendingLocation) return;
    captureEditorDraft();
    state.confirmedLocation = state.pendingLocation;
    state.pendingLocation = null;
    state.locationError = '';
    render();
    return;
  }
  if (action === 'discard-location') {
    captureEditorDraft();
    state.pendingLocation = null;
    state.confirmedLocation = null;
    state.locationError = '';
    render();
    return;
  }
  if (action === 'save-address') {
    await saveAddress(false);
    return;
  }
  if (action === 'duplicate-save') {
    await persistAddress(state.pendingDuplicate?.candidate, true);
    return;
  }
  if (action === 'duplicate-use') {
    const duplicate = state.pendingDuplicate?.duplicate;
    state.pendingDuplicate = null;
    state.editorOpen = false;
    state.editingAddressId = '';
    if (duplicate?.id) await setDefaultAddress(duplicate.id);
    return;
  }
  if (action === 'make-default') {
    await setDefaultAddress(addressId);
    return;
  }
  if (action === 'delete-address') await deleteAddress(addressId);
}

async function savePersonalData() {
  if (!isEditableMode()) return;
  const form = profileContainer()?.querySelector('[data-profile-personal-form]');
  const nameValidation = validateCustomerName(form?.elements?.profileFullName?.value || '');
  const phone = normalizeArgentinePhone(form?.elements?.profilePhone?.value || '');
  if (!nameValidation.ok) {
    markInvalid(form?.elements?.profileFullName, nameValidation.message);
    return;
  }
  if (!isValidArgentinePhone(phone)) {
    markInvalid(form?.elements?.profilePhone, 'Ingresá un teléfono argentino válido, con código de área.');
    return;
  }

  await runSaving(async () => {
    const result = await profileRepository()?.saveProfile({ name: nameValidation.name, phone });
    if (!result?.ok) return failOperation(result);
    state.profile = result.profile;
    state.editingPersonal = false;
    notifyUpdated();
    return { ok: true, message: 'Datos personales guardados.' };
  });
}

function resetLocationDraft() {
  state.pendingLocation = null;
  state.confirmedLocation = null;
  state.locationError = '';
  state.locating = false;
  state.addressDraft = null;
}

function hydrateLocationDraft(address) {
  resetLocationDraft();
  const normalized = address ? normalizeCustomerAddress(address) : null;
  if (normalized?.latitude == null || normalized?.longitude == null) return;
  state.confirmedLocation = {
    latitude: normalized.latitude,
    longitude: normalized.longitude,
    accuracy: normalized.geolocationAccuracy,
    source: normalized.source,
  };
}

async function requestLocation() {
  if (state.locating) return;
  state.locating = true;
  state.locationError = '';
  render();
  const result = await geolocationService.requestCurrentLocation();
  state.locating = false;
  if (!result?.ok) {
    // El mensaje del servicio ya distingue permiso, precisión y tiempo de
    // espera. No se reemplaza por uno genérico: dice qué hacer.
    state.locationError = result?.message || 'No pudimos obtener la ubicación.';
    state.pendingLocation = null;
    render();
    return;
  }
  state.pendingLocation = result.location;
  render();
}

// La ubicación es opcional y explícita: sin confirmar no viaja nada, y el aviso
// dice para qué se usa. Sin este bloque el editor no tenía forma de capturar
// coordenadas y toda dirección se guardaba `manual` con lat/lng nulas, que es
// justo lo que dejaba al Rider sin punto de entrega en el mapa.
function renderLocationCapture() {
  if (state.pendingLocation) {
    const accuracy = Number(state.pendingLocation.accuracy);
    return `<aside class="profile-location is-pending" data-profile-location aria-live="polite">
      <strong>Ubicación recibida</strong>
      <p>La usamos para que quien reparte encuentre la puerta. No se guarda hasta que la confirmes.${Number.isFinite(accuracy) ? ` Precisión aproximada: ${Math.round(accuracy)} m.` : ''}</p>
      <p class="profile-location-note">No hay un geocodificador configurado: revisá calle, número y localidad a mano.</p>
      <div class="profile-card-actions"><button class="secondary-button compact" type="button" data-profile-action="confirm-location">Confirmar ubicación</button><button class="ghost-button compact" type="button" data-profile-action="discard-location">Descartar</button></div>
    </aside>`;
  }
  if (state.confirmedLocation) {
    return `<aside class="profile-location is-confirmed" data-profile-location aria-live="polite">
      <strong>Ubicación confirmada para esta dirección</strong>
      <p>Se guarda junto con la dirección postal. Revisá igual calle y número.</p>
      <div class="profile-card-actions"><button class="ghost-button compact" type="button" data-profile-action="discard-location">Quitar ubicación</button></div>
    </aside>`;
  }
  return `<aside class="profile-location" data-profile-location>
    <div class="profile-card-actions"><button class="secondary-button compact" type="button" data-profile-action="use-location" ${state.locating ? 'disabled aria-disabled="true"' : ''}>${state.locating ? 'Buscando…' : 'Usar mi ubicación'}</button></div>
    <p>Opcional. Ayuda a que quien reparte llegue a la puerta correcta.</p>
    ${state.locationError ? `<p class="profile-location-error" role="alert">${escapeHtml(state.locationError)}</p>` : ''}
  </aside>`;
}

async function saveAddress(allowDuplicate) {
  if (!isEditableMode()) return;
  const form = profileContainer()?.querySelector('[data-profile-address-form]');
  if (!form) return;
  const location = state.confirmedLocation;
  const candidate = normalizeCustomerAddress({
    id: state.editingAddressId,
    label: form.elements?.profileAddressLabel?.value || 'Casa',
    street: form.elements?.profileAddressStreet?.value || '',
    streetNumber: form.elements?.profileAddressNumber?.value || '',
    floor: form.elements?.profileAddressFloor?.value || '',
    apartment: form.elements?.profileAddressApartment?.value || '',
    city: form.elements?.profileAddressCity?.value || '',
    province: form.elements?.profileAddressProvince?.value || '',
    postalCode: form.elements?.profileAddressPostalCode?.value || '',
    reference: form.elements?.profileAddressReference?.value || '',
    isDefault: Boolean(form.elements?.profileAddressDefault?.checked),
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    geolocationAccuracy: location?.accuracy ?? null,
    source: location?.source || 'manual',
  });
  const required = [
    ['profileAddressStreet', candidate.street, 'Ingresá la calle.'],
    ['profileAddressNumber', candidate.streetNumber, 'Ingresá el número.'],
    ['profileAddressCity', candidate.city, 'Ingresá la ciudad.'],
    ['profileAddressProvince', candidate.province, 'Ingresá la provincia.'],
  ];
  const invalid = required.find(([, value]) => !value);
  if (invalid) {
    markInvalid(form.elements?.[invalid[0]], invalid[2]);
    return;
  }
  await persistAddress(candidate, allowDuplicate);
}

async function persistAddress(candidate, allowDuplicate) {
  if (!candidate) return;
  await runSaving(async () => {
    const result = await profileRepository()?.saveAddress(candidate, { allowDuplicate });
    if (result?.code === 'duplicate') {
      state.pendingDuplicate = { candidate, duplicate: result.duplicate };
      return { ok: false, preserveStatus: true };
    }
    if (!result?.ok) return failOperation(result);
    const savedAddress = result.address;

    const index = state.addresses.findIndex((address) => address.id === savedAddress.id);
    if (index >= 0) state.addresses.splice(index, 1, savedAddress);
    else state.addresses.unshift(savedAddress);
    if (savedAddress.isDefault || state.addresses.length === 1) {
      state.addresses = state.addresses.map((address) => ({
        ...address,
        isDefault: address.id === savedAddress.id,
      }));
    }
    state.editorOpen = false;
    state.editingAddressId = '';
    state.pendingDuplicate = null;
    // El borrador no puede sobrevivir al guardado: si quedara, la próxima
    // dirección nueva heredaría la ubicación de la anterior.
    resetLocationDraft();
    notifyUpdated();
    return { ok: true, message: 'Dirección guardada.' };
  });
}

async function setDefaultAddress(addressId) {
  const address = findAddress(addressId);
  if (!address || !isEditableMode()) return;
  await runSaving(async () => {
    const result = await profileRepository()?.setDefault(addressId);
    if (!result?.ok) return failOperation(result);
    state.addresses = state.addresses.map((entry) => ({
      ...entry,
      isDefault: entry.id === addressId,
    }));
    notifyUpdated();
    return { ok: true, message: `${address.label} ahora es tu dirección predeterminada.` };
  });
}

async function deleteAddress(addressId) {
  const address = findAddress(addressId);
  if (!address || !isEditableMode()) return;
  if (!window.confirm(`¿Eliminar ${address.label}? Los pedidos anteriores conservarán su dirección.`)) return;
  await runSaving(async () => {
    const result = await profileRepository()?.archive(addressId);
    if (!result?.ok) return failOperation(result);
    let replacementId = String(result.result?.replacementId || '');
    state.addresses = state.addresses.filter((entry) => entry.id !== addressId);
    if (address.isDefault && state.addresses.length) {
      replacementId ||= state.addresses[0].id;
    }
    state.addresses = state.addresses.map((entry) => ({
      ...entry,
      isDefault: entry.id === replacementId,
    }));
    notifyUpdated();
    return { ok: true, message: 'Dirección eliminada del perfil. Los pedidos anteriores no cambiaron.' };
  });
}

async function runSaving(operation) {
  state.saving = true;
  state.status = 'Guardando…';
  state.statusTone = '';
  render();
  let outcome;
  try {
    outcome = await operation();
  } catch (_) {
    outcome = { ok: false, message: navigator.onLine === false
      ? 'Sin conexión. Tus cambios no se guardaron.'
      : 'No pudimos guardar los cambios. Volvé a intentar.' };
  } finally {
    state.saving = false;
  }
  if (outcome?.preserveStatus) {
    state.status = '';
    state.statusTone = '';
  } else {
    state.status = outcome?.message || '';
    state.statusTone = outcome?.ok ? 'success' : 'error';
  }
  render();
}

function failOperation(result) {
  state.availability = result?.code || state.availability;
  return { ok: false, message: result?.message || 'No pudimos guardar los cambios.' };
}

function render() {
  state.returnTo = resolveProfileReturnTarget() || state.returnTo;
  const container = profileContainer();
  if (!container) return;
  container.dataset.customerProfileState = state.loading
    ? 'loading'
    : state.saving
      ? 'saving'
      : state.availability;
  if (state.loading) {
    container.innerHTML = renderSkeleton();
    return;
  }
  if (state.availability === 'preview') {
    container.innerHTML = renderPreviewState();
    return;
  }
  if (state.availability === 'unavailable') {
    container.innerHTML = renderUnavailableState();
    return;
  }
  container.innerHTML = `
    ${renderStatus()}
    <div class="customer-profile-grid">
      ${renderPersonalCard()}
      ${renderAddressesCard()}
    </div>
    <aside class="profile-privacy-card">
      <span aria-hidden="true">${CHECK_ICON}</span>
      <div>
        <strong>TABA no necesita tu DNI.</strong>
        <p>Solo guardamos los datos necesarios para identificar al destinatario y entregar tus pedidos.</p>
      </div>
    </aside>`;
}

function renderSkeleton() {
  return `<div class="profile-loading" role="status" aria-live="polite">
    <span class="profile-spinner" aria-hidden="true"></span>
    <strong>Cargando tu perfil…</strong>
    <p>Estamos recuperando tus datos guardados.</p>
  </div>`;
}

function renderPreviewState() {
  return `<div class="profile-empty-state">
    <span class="profile-empty-icon" aria-hidden="true">◯</span>
    <h2>Perfil de cliente</h2>
    <p>Estará disponible cuando el local habilite los pedidos online. No necesitás cargar DNI ni otros datos innecesarios.</p>
  </div>
  <aside class="profile-privacy-card"><span aria-hidden="true">${CHECK_ICON}</span><div><strong>TABA no necesita tu DNI.</strong><p>Solo usamos nombre, teléfono y dirección para preparar y entregar pedidos.</p></div></aside>`;
}

function renderUnavailableState() {
  return `<div class="profile-empty-state" role="alert">
    <span class="profile-empty-icon" aria-hidden="true">!</span>
    <h2>No pudimos abrir tu perfil</h2>
    <p>${escapeHtml(state.status || 'Volvé a intentar en unos instantes.')}</p>
    <button class="secondary-button" type="button" data-profile-action="retry">Reintentar</button>
  </div>`;
}

function renderStatus() {
  if (!state.status) return '<p class="profile-status" aria-live="polite"></p>';
  return `<p class="profile-status ${state.statusTone ? `is-${state.statusTone}` : ''}" aria-live="polite">${escapeHtml(state.status)}</p>`;
}

function renderPersonalCard() {
  const profile = state.profile || {};
  const hasProfile = hasOperationalProfile();
  const returnAction = renderReturnToCheckoutAction();
  if (state.editingPersonal) {
    return `<section class="profile-card personal-card" aria-labelledby="personal-data-title">
      <div class="profile-card-heading"><div><span class="profile-card-kicker">Datos personales</span><h2 id="personal-data-title">${hasProfile ? 'Editá tus datos' : 'Completá tus datos'}</h2></div>${returnAction}</div>
      <form data-profile-personal-form novalidate>
        <label><span>Nombre y apellido</span><input name="profileFullName" autocomplete="name" minlength="2" maxlength="80" required value="${escapeAttr(profile.name || '')}" placeholder="Tu nombre y apellido" /></label>
        <label><span>Teléfono</span><input name="profilePhone" autocomplete="tel" inputmode="tel" maxlength="24" required value="${escapeAttr(formatArgentinePhone(profile.phone || ''))}" placeholder="Ej. 299 620 9136" /></label>
        <p class="profile-field-error" data-profile-field-error role="alert"></p>
        <div class="profile-card-actions">
          <button class="primary-button compact" type="button" data-profile-action="save-personal" ${disabledAttr()}>${state.saving ? 'Guardando…' : 'Guardar'}</button>
          ${hasProfile ? '<button class="ghost-button compact" type="button" data-profile-action="cancel-personal">Cancelar</button>' : ''}
        </div>
      </form>
    </section>`;
  }
  return `<section class="profile-card personal-card ${hasProfile ? '' : 'is-empty'}" aria-labelledby="personal-data-title">
    <div class="profile-card-heading">
      <span class="profile-card-ico" aria-hidden="true">${PERSON_ICON}</span>
      <div><h2 id="personal-data-title">Datos personales</h2><small>${hasProfile ? 'Quién recibe el pedido' : 'Todavía no cargaste tus datos'}</small></div>
      ${returnAction}
      ${hasProfile ? '<button class="text-button" type="button" data-profile-action="edit-personal">Editar</button>' : ''}
    </div>
    ${hasProfile ? `<dl class="personal-data-list">
      <div><dt>Nombre y apellido</dt><dd>${escapeHtml(profile.name)}</dd></div>
      <div><dt>Teléfono</dt><dd>${escapeHtml(formatArgentinePhone(profile.phone))}</dd></div>
    </dl>` : `<p class="profile-empty-copy">Guardá solo lo necesario para no escribirlo de nuevo en cada compra.</p>
      <button class="primary-button compact" type="button" data-profile-action="edit-personal">Completar datos</button>`}
  </section>`;
}
// El bloque de direcciones NO es una tarjeta: su título vive directamente sobre
// el shell oscuro y cada dirección flota como su propia superficie clara, que es
// la composición de la referencia aprobada.
//
// Una sola acción principal. Antes había un "Agregar dirección" en el
// encabezado; con el botón grande del final eran dos entradas al mismo
// formulario compitiendo en la misma pantalla. Queda el de abajo, que es el que
// se alcanza con el pulgar después de leer la lista.
function renderAddressesCard() {
  return `<section class="profile-card addresses-card" aria-labelledby="profile-addresses-title">
    <div class="profile-card-heading">
      <div><h2 id="profile-addresses-title">Tus direcciones</h2><small>Elegí a dónde llevamos tu pedido</small></div>
    </div>
    ${state.addresses.length ? `<div class="profile-address-list">${state.addresses.map(renderAddressCard).join('')}</div>` : renderNoAddresses()}
    ${renderDuplicate()}
    ${renderAddressEditor()}
    ${state.editorOpen ? '' : `<button class="primary-button profile-add-address" type="button" data-profile-action="add-address" ${disabledAttr()}>
      <span class="profile-add-address-plus" aria-hidden="true">+</span>Agregar nueva dirección
    </button>`}
  </section>`;
}

function renderNoAddresses() {
  return `<div class="profile-no-addresses">
    <span aria-hidden="true">${PIN_ICON}</span>
    <strong>Todavía no tenés direcciones guardadas</strong>
    <p>Podés agregarlas ahora o completar una dirección manualmente durante el checkout.</p>
  </div>`;
}

// `addressSummary` ya incorpora piso y departamento, así que la tarjeta no los
// repite: antes mostraba "Piso 3 · Dpto. B" dos veces, una en la línea de la
// dirección y otra debajo.
function renderAddressCard(rawAddress) {
  const address = normalizeCustomerAddress(rawAddress);
  // La dirección activa DECLARA su estado ("En uso") en vez de ofrecer otra vez
  // la acción que ya está aplicada: un botón "Usar esta" sobre la dirección que
  // ya se está usando es una acción sin efecto, y el cliente no puede saber si
  // la tocó bien.
  const useAction = address.isDefault
    ? `<span class="profile-address-inuse">${CHECK_ICON}En uso</span>`
    : `<button class="text-button" type="button" data-profile-action="make-default" ${disabledAttr()}>${CHECK_ICON}Usar esta</button>`;
  return `<article class="profile-address ${address.isDefault ? 'is-default' : ''}" data-profile-address-id="${escapeAttr(address.id)}">
    <div class="profile-address-main">
      <div class="profile-address-icon" aria-hidden="true">${PIN_ICON}</div>
      <div>
        <div class="profile-address-title"><strong>${escapeHtml(address.label)}</strong>${address.isDefault ? '<span>Predeterminada</span>' : ''}</div>
        <p>${escapeHtml(addressSummary(address))}</p>
        ${address.reference ? `<small>${escapeHtml(address.reference)}</small>` : ''}
      </div>
    </div>
    <div class="profile-address-actions">
      <button class="text-button" type="button" data-profile-action="edit-address" ${disabledAttr()}>${PENCIL_ICON}Editar</button>
      <button class="text-button danger" type="button" data-profile-action="delete-address" ${disabledAttr()}>${TRASH_ICON}Eliminar</button>
      ${useAction}
    </div>
  </article>`;
}

// Lo tipeado vive sólo en el DOM: cada `render()` reconstruye el formulario y
// se lo lleva puesto. Mientras el editor estuvo abierto sin re-renders eso no
// se notaba, pero pedir la ubicación sí re-renderiza, y sin esto la persona
// perdía ciudad y provincia justo después de confirmar dónde vive.
function captureEditorDraft() {
  const form = profileContainer()?.querySelector('[data-profile-address-form]');
  if (!form) return;
  state.addressDraft = {
    label: form.elements?.profileAddressLabel?.value || '',
    street: form.elements?.profileAddressStreet?.value || '',
    streetNumber: form.elements?.profileAddressNumber?.value || '',
    floor: form.elements?.profileAddressFloor?.value || '',
    apartment: form.elements?.profileAddressApartment?.value || '',
    city: form.elements?.profileAddressCity?.value || '',
    province: form.elements?.profileAddressProvince?.value || '',
    postalCode: form.elements?.profileAddressPostalCode?.value || '',
    reference: form.elements?.profileAddressReference?.value || '',
    isDefault: Boolean(form.elements?.profileAddressDefault?.checked),
  };
}

function renderAddressEditor() {
  if (!state.editorOpen) return '';
  const saved = findAddress(state.editingAddressId) || {};
  // El borrador manda sobre lo guardado: es lo que la persona tiene escrito.
  const address = state.addressDraft ? { ...saved, ...state.addressDraft } : saved;
  const province = address.province || (getAppMode() === APP_MODE_DEMO ? 'Neuquén' : '');
  const city = address.city || (getAppMode() === APP_MODE_DEMO ? 'Neuquén' : '');
  return `<form class="profile-address-editor" data-profile-address-form novalidate>
    <div class="profile-card-heading"><div><span class="profile-card-kicker">${address.id ? 'Editar' : 'Nueva dirección'}</span><h3>${address.id ? address.label : 'Datos de entrega'}</h3></div><button class="text-button" type="button" data-profile-action="cancel-address">Cerrar</button></div>
    <div class="profile-form-grid">
      <label><span>Etiqueta</span><select name="profileAddressLabel">${['Casa', 'Trabajo', 'Otra'].map((label) => `<option value="${label}" ${(address.label || 'Casa') === label ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="is-wide"><span>Calle</span><input name="profileAddressStreet" maxlength="120" autocomplete="address-line1" required value="${escapeAttr(address.street || '')}" placeholder="Antártida Argentina" /></label>
      <label><span>Número</span><input name="profileAddressNumber" maxlength="24" inputmode="text" required value="${escapeAttr(address.streetNumber || '')}" placeholder="1234, 1234 A o S/N" /></label>
      <label><span>Piso <em>opcional</em></span><input name="profileAddressFloor" maxlength="24" autocomplete="address-line2" value="${escapeAttr(address.floor || '')}" /></label>
      <label><span>Departamento <em>opcional</em></span><input name="profileAddressApartment" maxlength="24" autocomplete="address-line2" value="${escapeAttr(address.apartment || '')}" /></label>
      <label><span>Ciudad</span><input name="profileAddressCity" maxlength="100" autocomplete="address-level2" required value="${escapeAttr(city)}" /></label>
      <label><span>Provincia</span><input name="profileAddressProvince" maxlength="100" autocomplete="address-level1" required value="${escapeAttr(province)}" /></label>
      <label><span>Código postal <em>opcional</em></span><input name="profileAddressPostalCode" maxlength="20" autocomplete="postal-code" value="${escapeAttr(address.postalCode || '')}" /></label>
      <label class="is-full"><span>Referencias <em>opcional</em></span><textarea name="profileAddressReference" maxlength="180" rows="3" placeholder="Ej. Portón negro, tocar timbre 2">${escapeHtml(address.reference || '')}</textarea></label>
    </div>
    ${renderLocationCapture()}
    <label class="profile-default-check"><input name="profileAddressDefault" type="checkbox" ${address.isDefault || (!address.id && !state.addresses.length) ? 'checked' : ''} /><span>Usar como dirección predeterminada</span></label>
    <p class="profile-field-error" data-profile-field-error role="alert"></p>
    <div class="profile-card-actions"><button class="primary-button compact" type="button" data-profile-action="save-address" ${disabledAttr()}>${state.saving ? 'Guardando…' : 'Guardar dirección'}</button><button class="ghost-button compact" type="button" data-profile-action="cancel-address">Cancelar</button></div>
  </form>`;
}

function renderDuplicate() {
  const duplicate = state.pendingDuplicate?.duplicate;
  if (!duplicate) return '';
  return `<aside class="profile-duplicate" role="alert">
    <strong>Ya tenés una dirección parecida guardada como ${escapeHtml(duplicate.label)}.</strong>
    <p>Podés usar la existente o guardar ambas si realmente son diferentes.</p>
    <div class="profile-card-actions"><button class="secondary-button compact" type="button" data-profile-action="duplicate-use">Usar ${escapeHtml(duplicate.label)}</button><button class="ghost-button compact" type="button" data-profile-action="duplicate-save">Guardar igualmente</button></div>
  </aside>`;
}

function setStatus(message, tone) {
  state.status = message;
  state.statusTone = tone;
  render();
}

function markInvalid(field, message) {
  field?.setAttribute('aria-invalid', 'true');
  const error = field?.closest('form')?.querySelector('[data-profile-field-error]')
    || profileContainer()?.querySelector('[data-profile-field-error]');
  if (error) error.textContent = message;
  field?.focus();
}

function queueFocus(selector) {
  render();
  setTimeout(() => profileContainer()?.querySelector(selector)?.focus(), 0);
}

function hasOperationalProfile() {
  return Boolean(state.profile?.name && isValidArgentinePhone(state.profile?.phone));
}

function findAddress(addressId) {
  return state.addresses.find((address) => address.id === addressId) || null;
}

function profileRepository() {
  return getOrderRepository()?.customerProfiles || null;
}

function profileContainer() {
  return document.querySelector('[data-customer-profile]');
}

function isEditableMode() {
  return [APP_MODE_DEMO, APP_MODE_PRODUCTION].includes(getAppMode());
}

function disabledAttr() {
  return state.saving ? 'disabled aria-disabled="true"' : '';
}

function notifyUpdated() {
  window.dispatchEvent(new CustomEvent('taba:customer-profile-updated', {
    detail: { source: 'profile' },
  }));
}

function resolveProfileReturnTarget() {
  try {
    return window.sessionStorage?.getItem?.(PROFILE_RETURN_STORAGE_KEY) || '';
  } catch (_) {
    return '';
  }
}

function clearProfileReturnTarget() {
  try {
    window.sessionStorage?.removeItem?.(PROFILE_RETURN_STORAGE_KEY);
  } catch (_) {
    // Sin sessionStorage no hay retorno pendiente para limpiar.
  }
}

function renderReturnToCheckoutAction() {
  const target = resolveProfileReturnTarget() || state.returnTo;
  if (!target) return '';
  return '<button class="text-button" type="button" data-profile-action="return-to-checkout">Volver al pedido</button>';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
