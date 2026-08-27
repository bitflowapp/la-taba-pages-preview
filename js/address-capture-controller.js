// ─────────────────────────────────────────────────────────────────────────────
// EL EDITOR DE DIRECCIÓN, DONDE HAGA FALTA
//
// EL DEFECTO QUE CIERRA
// ---------------------
// Escribir una dirección era posible en UN solo lugar: la vista Perfil. Todo lo
// demás mandaba ahí. Medido contra el sitio publicado:
//
//   · el chip «ENVIAR A · Elegí tu dirección» del inicio es un `data-nav-view`
//     a Perfil: tocarlo sacaba de la góndola a quien sólo quería declarar dónde
//     recibe;
//   · el checkout sin dirección mostraba «Agregar dirección en Perfil», así que
//     completar la compra exigía abandonar el checkout;
//   · la vuelta desde el inicio no existía —`data-nav-view` a Perfil LIMPIA la
//     marca de retorno—, y el botón «Volver al pedido» sólo aparece cuando el
//     que mandó fue el checkout.
//
// Este módulo es el editor, sin pantalla propia. Se monta dentro del checkout y
// dentro de la hoja del inicio, y las dos superficies comparten estas reglas en
// vez de tener cada una la suya.
//
// LO QUE NO REIMPLEMENTA
// ----------------------
// Nada del contrato. La normalización es `normalizeCustomerAddress`, la huella y
// la confirmación son el borrador de `core/delivery-location-draft.js`, el paso
// visual es `renderDeliveryLocationStep` —el MISMO que usa Perfil, con los
// mismos `data-profile-action`—, el mapa es `createLocationPickerMap`, el GPS es
// `createCustomerGeolocationService` y la escritura es el repositorio de
// perfiles. El armado del candidato vive en `core/address-capture.js`.
//
// POR QUÉ TAMBIÉN PIDE NOMBRE Y TELÉFONO
// --------------------------------------
// No es una decisión de diseño: es el contrato de la base.
// `upsert_current_customer_address` aborta con «guardá primero tu nombre y
// telefono» si no existe la fila del cliente. Un editor de direcciones que no
// pueda crear esa fila fallaría en la primera compra de cada persona nueva, que
// es exactamente el caso que este trabajo viene a destrabar. Los campos aparecen
// SÓLO cuando faltan; quien ya los tiene guardados no los vuelve a ver.
// ─────────────────────────────────────────────────────────────────────────────

import {
  buildAddressCandidate,
  resolveAddressArea,
  validateAddressCandidate,
} from './core/address-capture.js';
import { normalizeCustomerAddress } from './core/customer-addresses.js';
import {
  confirmDeliveryLocationDraft,
  draftAfterAddressEdit,
  draftFromSavedAddress,
  draftLocating,
  draftOpenedOnMap,
  draftWithLocationResult,
  draftWithMapPin,
  emptyDeliveryLocationDraft,
  isDeliveryLocationDraftConfirmed,
} from './core/delivery-location-draft.js';
import { DELIVERY_LOCATION_REQUIRED_MESSAGE } from './core/delivery-location.js';
import { BUSINESS_POINT, OPERATING_AREA } from './core/business-location.js';
import { getCommerceAvailability } from './core/commerce-availability-store.js';
import {
  formatArgentinePhone,
  isValidArgentinePhone,
  normalizeArgentinePhone,
  validateCustomerName,
} from './core/validators.js';
import { nudgePoint, renderDeliveryLocationStep } from './delivery-location-step.js';
import { createLocationPickerMap } from './map/location_picker_map.js';
import { getOrderRepository } from './repositories/repository_factory.js';
import { createCustomerGeolocationService } from './services/customer-geolocation.js';

// Los nombres van con prefijo porque en el checkout este formulario vive DENTRO
// de `[data-checkout-form]`: un campo llamado `customerStreetAddress` acá
// pisaría el oculto que alimenta el pedido. `getCheckoutFormValues` lee por
// nombre, así que con el prefijo estos campos son invisibles para el pedido y no
// pueden convertirse en una segunda fuente de verdad.
const FIELD = Object.freeze({
  label: 'captureAddressLabel',
  street: 'captureAddressStreet',
  streetNumber: 'captureAddressNumber',
  floor: 'captureAddressFloor',
  apartment: 'captureAddressApartment',
  reference: 'captureAddressReference',
  neighborhood: 'captureAddressNeighborhood',
  isDefault: 'captureAddressDefault',
  name: 'captureCustomerName',
  phone: 'captureCustomerPhone',
});

export const ADDRESS_CAPTURE_FIELD_NAMES = FIELD;

export function createAddressCaptureController({
  scope = 'capture',
  requestRender = () => {},
  getAddresses = () => [],
  getProfile = () => null,
  onSaved = () => {},
  onProfileSaved = () => {},
  geolocation = null,
} = {}) {
  const state = {
    open: false,
    editingAddressId: '',
    saving: false,
    status: '',
    statusTone: '',
    invalidField: '',
    draft: emptyDeliveryLocationDraft(),
    mapUnavailable: false,
    pointChosen: false,
    // Lo tipeado vive sólo en el DOM y cada render lo reconstruye. Sin esta
    // copia, pedir la ubicación —que sí re-renderiza— borraba lo escrito.
    values: null,
    pendingDuplicate: null,
    focusSelector: '',
  };

  let locationService = geolocation;
  let pickerMap = null;
  let root = null;

  function service() {
    if (!locationService) locationService = createCustomerGeolocationService();
    return locationService;
  }

  function repository() {
    return getOrderRepository()?.customerProfiles || null;
  }

  function savedAddress() {
    if (!state.editingAddressId) return {};
    const found = getAddresses().find((address) => address.id === state.editingAddressId);
    return found ? normalizeCustomerAddress(found) : {};
  }

  function profileNeedsIdentity() {
    const profile = getProfile() || {};
    return !String(profile.name || '').trim() || !isValidArgentinePhone(profile.phone);
  }

  /**
   * `location` es una medición del GPS que ya se hizo afuera —la hoja del inicio
   * la pide para buscar una dirección cercana—. Entra por el MISMO camino que
   * una medición pedida acá adentro (`draftWithLocationResult`), o sea que llega
   * como PENDIENTE: el aparato dice dónde está el teléfono, no dónde hay que
   * tocar el timbre, y confirmarlo sigue siendo un acto explícito.
   */
  function open({ addressId = '', location = null } = {}) {
    state.open = true;
    state.editingAddressId = String(addressId || '');
    state.pendingDuplicate = null;
    state.status = '';
    state.statusTone = '';
    state.invalidField = '';
    state.values = null;
    state.mapUnavailable = false;
    destroyMap();
    if (state.editingAddressId) {
      state.draft = draftFromSavedAddress(savedAddress());
      state.pointChosen = Boolean(state.draft.point);
    } else if (location) {
      state.draft = draftWithLocationResult(emptyDeliveryLocationDraft(), { ok: true, location });
      state.pointChosen = Boolean(state.draft.point);
    } else {
      state.draft = emptyDeliveryLocationDraft();
      state.pointChosen = false;
    }
    state.focusSelector = profileNeedsIdentity()
      ? `[name="${FIELD.name}"]`
      : `[name="${FIELD.street}"]`;
    requestRender();
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    state.editingAddressId = '';
    state.pendingDuplicate = null;
    state.values = null;
    state.draft = emptyDeliveryLocationDraft();
    state.pointChosen = false;
    state.mapUnavailable = false;
    state.status = '';
    state.statusTone = '';
    state.invalidField = '';
    destroyMap();
    requestRender();
  }

  function reset() {
    state.open = false;
    state.editingAddressId = '';
    state.saving = false;
    state.status = '';
    state.statusTone = '';
    state.invalidField = '';
    state.draft = emptyDeliveryLocationDraft();
    state.mapUnavailable = false;
    state.pointChosen = false;
    state.values = null;
    state.pendingDuplicate = null;
    state.focusSelector = '';
    destroyMap();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Lo escrito
  // ───────────────────────────────────────────────────────────────────────────

  /*
   * EL EDITOR NO ES UN `<form>`, Y NO PUEDE SERLO.
   *
   * En el checkout se monta dentro de `<form data-checkout-form>`, y HTML no
   * anida formularios: el parser DESCARTA la etiqueta interna y deja sus hijos
   * sueltos. Medido — el editor se dibujaba entero pero `[data-address-capture]`
   * no existía en el árbol, así que nada lo encontraba y ningún campo se leía.
   *
   * Por eso los campos se buscan por `[name]` dentro del contenedor y no por
   * `form.elements`, que necesitaría un formulario que acá no puede existir. Los
   * nombres van con prefijo `capture…` justamente porque, en el checkout, estos
   * campos SÍ terminan siendo parte del formulario del pedido.
   */
  function form() {
    return root?.querySelector(`[data-address-capture-form="${scope}"]`) || null;
  }

  function readField(name) {
    const field = form()?.querySelector(`[name="${name}"]`);
    if (!field) return null;
    return field.type === 'checkbox' ? Boolean(field.checked) : String(field.value ?? '');
  }

  function captureValues() {
    const current = form();
    if (!current) return;
    const saved = savedAddress();
    const written = {
      label: readField(FIELD.label) ?? '',
      street: readField(FIELD.street) ?? '',
      streetNumber: readField(FIELD.streetNumber) ?? '',
      floor: readField(FIELD.floor) ?? '',
      apartment: readField(FIELD.apartment) ?? '',
      reference: readField(FIELD.reference) ?? '',
      neighborhood: readField(FIELD.neighborhood) ?? (state.values?.neighborhood ?? saved.neighborhood ?? ''),
      isDefault: readField(FIELD.isDefault) === true,
      name: readField(FIELD.name) ?? (state.values?.name ?? ''),
      phone: readField(FIELD.phone) ?? (state.values?.phone ?? ''),
    };
    state.values = written;
  }

  /**
   * El texto que determina el punto, tal como está AHORA. La localidad no se
   * pregunta, así que se resuelve por el contrato del área de operación.
   */
  function currentAddressText() {
    const written = state.values || {};
    const saved = savedAddress();
    return {
      street: written.street ?? saved.street ?? '',
      streetNumber: written.streetNumber ?? saved.streetNumber ?? '',
      ...resolveAddressArea({ written, saved }),
    };
  }

  // Editar el texto de la dirección revisa la confirmación. La regla real —y no
  // la que parecería— vive en `draftAfterAddressEdit`: sólo se cae una
  // confirmación REUTILIZADA de una dirección guardada. Una confirmación fresca
  // no arrastra ninguna dirección anterior y sobrevive a que se siga escribiendo.
  function reviewEdit() {
    if (!state.open) return;
    captureValues();
    const next = draftAfterAddressEdit(state.draft, currentAddressText());
    if (next === state.draft) return;
    state.draft = next;
    requestRender();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Acciones
  // ───────────────────────────────────────────────────────────────────────────

  async function handleAction(action, { nudge = '', addressId = '' } = {}) {
    if (state.saving) return true;
    switch (action) {
      case 'capture-open':
        open({ addressId });
        return true;
      case 'capture-close':
        close();
        return true;
      case 'use-location':
        captureValues();
        await requestLocation();
        return true;
      case 'open-location-map': {
        captureValues();
        const hadPoint = Boolean(state.draft.point);
        state.mapUnavailable = false;
        state.draft = draftOpenedOnMap(state.draft, mapStartPoint());
        if (!hadPoint) state.pointChosen = false;
        requestRender();
        return true;
      }
      case 'nudge-location': {
        captureValues();
        const moved = nudgePoint(state.draft.point, nudge);
        if (moved) {
          state.draft = draftWithMapPin(state.draft, moved);
          state.pointChosen = true;
          requestRender();
        }
        return true;
      }
      case 'confirm-location': {
        if (!state.draft.point) return true;
        if (state.mapUnavailable && !state.pointChosen) {
          state.draft = {
            ...state.draft,
            error: 'Ajustá el punto antes de confirmar: el mapa no pudo mostrar la ubicación inicial.',
          };
          requestRender();
          return true;
        }
        captureValues();
        state.draft = confirmDeliveryLocationDraft(state.draft, { address: currentAddressText() });
        requestRender();
        return true;
      }
      case 'discard-location':
        captureValues();
        state.draft = emptyDeliveryLocationDraft();
        state.pointChosen = false;
        destroyMap();
        requestRender();
        return true;
      case 'save-address':
        await save({ allowDuplicate: false });
        return true;
      case 'duplicate-save':
        await save({ allowDuplicate: true, candidate: state.pendingDuplicate?.candidate });
        return true;
      case 'duplicate-use': {
        const duplicate = state.pendingDuplicate?.duplicate;
        state.pendingDuplicate = null;
        if (duplicate?.id) {
          // Se cierra a mano y NO con `close()`: `close()` re-dibuja antes de
          // avisar, así que quien escucha pintaría el estado viejo y recién en
          // el siguiente ciclo el nuevo. Acá el aviso va primero y el dibujo
          // después, una sola vez.
          state.open = false;
          state.editingAddressId = '';
          state.values = null;
          state.draft = emptyDeliveryLocationDraft();
          state.pointChosen = false;
          state.status = '';
          state.statusTone = '';
          destroyMap();
          onSaved(duplicate, { reused: true });
        }
        requestRender();
        return true;
      }
      default:
        return false;
    }
  }

  async function requestLocation() {
    if (state.draft.locating) return;
    state.draft = draftLocating(state.draft);
    requestRender();
    // El permiso se pide ACÁ, después de que la persona tocó el botón. Pedirlo
    // al abrir la pantalla es lo que hace que se rechace sin leerlo.
    const result = await service().requestCurrentLocation();
    state.draft = draftWithLocationResult(state.draft, result);
    if (result?.ok && state.draft.point) state.pointChosen = true;
    requestRender();
  }

  async function save({ allowDuplicate = false, candidate: precomputed = null } = {}) {
    const repo = repository();
    if (!repo) {
      setStatus('No pudimos guardar la dirección: esta tienda todavía no tiene pedidos online habilitados.', 'error');
      return;
    }
    captureValues();
    const written = state.values || {};

    // El nombre y el teléfono van PRIMERO porque la base los exige antes de
    // aceptar una dirección. Si faltan y esta pantalla no los pide, el guardado
    // rebota con un mensaje del servidor que la persona no puede resolver acá.
    let identity = null;
    if (profileNeedsIdentity()) {
      const nameCheck = validateCustomerName(written.name || '');
      if (!nameCheck.ok) {
        fail(FIELD.name, nameCheck.message);
        return;
      }
      const phone = normalizeArgentinePhone(written.phone || '');
      if (!isValidArgentinePhone(phone)) {
        fail(FIELD.phone, 'Ingresá un teléfono argentino válido, con código de área.');
        return;
      }
      identity = { name: nameCheck.name, phone };
    }

    let candidate = precomputed;
    if (!candidate) {
      const saved = savedAddress();
      const built = buildAddressCandidate({
        id: state.editingAddressId,
        label: written.label || saved.label || 'Casa',
        street: written.street ?? saved.street ?? '',
        streetNumber: written.streetNumber ?? saved.streetNumber ?? '',
        floor: written.floor ?? saved.floor ?? '',
        apartment: written.apartment ?? saved.apartment ?? '',
        reference: written.reference ?? saved.reference ?? '',
        neighborhood: written.neighborhood ?? saved.neighborhood ?? '',
        area: resolveAddressArea({ written, saved }),
        isDefault: written.isDefault === true,
        draft: state.draft,
      });
      candidate = built.candidate;
      if (built.draft) state.draft = built.draft;

      const validation = validateAddressCandidate(candidate);
      if (!validation.ok) {
        fail(validation.field === 'street' ? FIELD.street : FIELD.streetNumber, validation.message);
        return;
      }
      // Una dirección de entrega no se guarda sin punto confirmado. Guardarla
      // igual sería devolver una dirección que no sirve para pedir, y que el
      // servidor va a rechazar recién al confirmar la compra.
      if (!isDeliveryLocationDraftConfirmed(state.draft)) {
        setStatus(DELIVERY_LOCATION_REQUIRED_MESSAGE, 'warning');
        state.focusSelector = '[data-location-step]';
        requestRender();
        return;
      }
    }

    state.saving = true;
    state.status = 'Guardando…';
    state.statusTone = '';
    state.invalidField = '';
    requestRender();
    try {
      if (identity) {
        const profileResult = await repo.saveProfile(identity);
        if (!profileResult?.ok) {
          setStatus(profileResult?.message || 'No pudimos guardar tus datos.', 'error');
          return;
        }
        onProfileSaved(profileResult.profile);
      }
      const result = await repo.saveAddress(candidate, { allowDuplicate });
      if (result?.code === 'duplicate') {
        state.pendingDuplicate = { candidate, duplicate: result.duplicate };
        state.status = '';
        state.statusTone = '';
        return;
      }
      if (!result?.ok) {
        setStatus(result?.message || 'No pudimos guardar la dirección.', 'error', { render: false });
        return;
      }
      const saved = result.address;
      state.open = false;
      state.editingAddressId = '';
      state.pendingDuplicate = null;
      // El borrador no puede sobrevivir al guardado: si quedara, la próxima
      // dirección nueva heredaría la ubicación de la anterior.
      state.draft = emptyDeliveryLocationDraft();
      state.pointChosen = false;
      state.values = null;
      destroyMap();
      state.status = 'Dirección guardada.';
      state.statusTone = 'success';
      onSaved(saved, { reused: false });
    } catch (_) {
      setStatus(
        globalThis.navigator?.onLine === false
          ? 'Sin conexión. Tus cambios no se guardaron.'
          : 'No pudimos guardar los cambios. Volvé a intentar.',
        'error',
        { render: false },
      );
    } finally {
      state.saving = false;
      requestRender();
    }
  }

  function fail(fieldName, message) {
    state.invalidField = fieldName;
    state.status = message;
    state.statusTone = 'error';
    state.focusSelector = `[name="${fieldName}"]`;
    requestRender();
  }

  function setStatus(message, tone, { render = true } = {}) {
    state.status = message;
    state.statusTone = tone;
    if (render) requestRender();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Mapa
  // ───────────────────────────────────────────────────────────────────────────

  function mapStartPoint() {
    // Arranca sobre el local cuando todavía no hay pin. No es una afirmación
    // sobre dónde vive nadie: es el punto desde el cual mover.
    return { latitude: BUSINESS_POINT.lat, longitude: BUSINESS_POINT.lng };
  }

  function mapLibraryAvailable() {
    return Boolean(globalThis.maplibregl?.Map && globalThis.maplibregl?.Marker);
  }

  function syncMap() {
    const canvas = root?.querySelector('[data-location-map]');
    if (!canvas) {
      destroyMap();
      return;
    }
    const point = state.draft.point;
    if (!point) return;
    if (pickerMap?.mounted) {
      pickerMap.setPoint(point);
      pickerMap.resize();
      return;
    }
    pickerMap = createLocationPickerMap();
    const mounted = pickerMap.mount({
      container: canvas,
      point,
      onPick: (next) => {
        state.draft = draftWithMapPin(state.draft, next);
        state.pointChosen = true;
        requestRender();
      },
      onUnavailable: () => {
        destroyMap();
        state.mapUnavailable = true;
        requestRender();
      },
    });
    if (!mounted) {
      // Sin mapa el paso sigue en pie: quedan las coordenadas y los ajustes. Se
      // dice en pantalla en vez de mostrar un rectángulo vacío.
      canvas.dataset.locationMapUnavailable = pickerMap?.unavailableReason || 'unavailable';
      pickerMap = null;
      state.mapUnavailable = true;
      requestRender();
    }
  }

  function destroyMap() {
    pickerMap?.destroy?.();
    pickerMap = null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * `showHead` en false lo usa la hoja del encabezado, que ya tiene su propio
   * título y su ✕. Con los dos encabezados, en 320px quedaban dos filas de
   * cromo y dos botones de cerrar que hacían cosas distintas —uno volvía al
   * listado, el otro cerraba la hoja— a cuatro píxeles de distancia.
   */
  function html({ showHead = true } = {}) {
    if (!state.open) return '';
    const saved = savedAddress();
    const written = state.values || {};
    const value = (key) => (written[key] != null ? written[key] : (saved[key] ?? ''));
    const area = value('city') || saved.city || OPERATING_AREA.city;
    const editing = Boolean(state.editingAddressId);
    const isDefaultChecked = written.isDefault != null
      ? written.isDefault === true
      : (saved.isDefault === true || (!editing && getAddresses().length === 0));

    const encabezado = showHead
      ? `<div class="address-capture-head">
      <div>
        <span class="address-capture-kicker">${editing ? 'Editar dirección' : 'Nueva dirección'}</span>
        <h3 class="address-capture-title" id="address-capture-title-${escapeAttr(scope)}">${editing ? escapeHtml(saved.label || 'Dirección') : '¿Dónde te entregamos?'}</h3>
      </div>
      <button class="text-button" type="button" data-profile-action="capture-close" data-address-capture-close>Cerrar</button>
    </div>`
      : '';

    return `<div class="address-capture"${showHead ? ` role="group" aria-labelledby="address-capture-title-${escapeAttr(scope)}"` : ''} data-address-capture="${escapeAttr(scope)}" data-address-capture-form="${escapeAttr(scope)}">
    ${encabezado}
    ${renderIdentityFields(value)}
    <div class="address-capture-grid">
      <label class="address-capture-field"><span>Etiqueta</span><select name="${FIELD.label}">${['Casa', 'Trabajo', 'Otra']
    .map((option) => `<option value="${option}" ${(value('label') || 'Casa') === option ? 'selected' : ''}>${option}</option>`)
    .join('')}</select></label>
      <label class="address-capture-field is-wide"><span>Calle</span><input name="${FIELD.street}" maxlength="120" autocomplete="address-line1" enterkeyhint="next" value="${escapeAttr(value('street'))}" placeholder="Antártida Argentina" ${invalidAttr(FIELD.street)} /></label>
      <label class="address-capture-field"><span>Número</span><input name="${FIELD.streetNumber}" maxlength="24" inputmode="text" enterkeyhint="next" value="${escapeAttr(value('streetNumber'))}" placeholder="1234, 1234 A o S/N" ${invalidAttr(FIELD.streetNumber)} /></label>
      <label class="address-capture-field"><span>Piso <em>opcional</em></span><input name="${FIELD.floor}" maxlength="24" autocomplete="address-line2" enterkeyhint="next" value="${escapeAttr(value('floor'))}" /></label>
      <label class="address-capture-field"><span>Departamento <em>opcional</em></span><input name="${FIELD.apartment}" maxlength="24" autocomplete="address-line2" enterkeyhint="next" value="${escapeAttr(value('apartment'))}" /></label>
      ${renderNeighborhoodField(String(value('neighborhood') || ''))}
      <label class="address-capture-field is-full"><span>Referencias <em>opcional</em></span><textarea name="${FIELD.reference}" maxlength="180" rows="3" placeholder="Ej. Portón negro, tocar timbre 2">${escapeHtml(value('reference'))}</textarea></label>
      <p class="address-capture-area is-full">Guardamos la localidad como <strong>${escapeHtml(area)}</strong>. Lo que usa quien reparte es el punto que confirmás acá abajo.</p>
    </div>
    ${renderDeliveryLocationStep(state.draft, {
    saving: state.saving,
    mapAvailable: !state.mapUnavailable && mapLibraryAvailable(),
    confirmationBlocked: (state.mapUnavailable || !mapLibraryAvailable()) && !state.pointChosen,
  })}
    <label class="address-capture-default"><input name="${FIELD.isDefault}" type="checkbox" ${isDefaultChecked ? 'checked' : ''} /><span>Usar como dirección predeterminada</span></label>
    ${renderStatus()}
    ${renderDuplicate()}
    <div class="address-capture-actions">
      <button class="primary-button compact" type="button" data-profile-action="save-address" data-address-capture-save ${state.saving ? 'disabled aria-disabled="true"' : ''}>${state.saving ? 'Guardando…' : 'Guardar dirección'}</button>
      <button class="ghost-button compact" type="button" data-profile-action="capture-close">Cancelar</button>
    </div>
  </div>`;
  }

  function renderIdentityFields(value) {
    if (!profileNeedsIdentity()) return '';
    const profile = getProfile() || {};
    const name = value('name') || profile.name || '';
    const phone = value('phone') || formatArgentinePhone(profile.phone || '');
    return `<div class="address-capture-grid address-capture-identity" data-address-capture-identity>
      <p class="address-capture-area is-full">Necesitamos tu nombre y teléfono para que el local pueda entregarte el pedido.</p>
      <label class="address-capture-field is-wide"><span>Nombre y apellido</span><input name="${FIELD.name}" autocomplete="name" maxlength="80" enterkeyhint="next" value="${escapeAttr(name)}" placeholder="Tu nombre y apellido" ${invalidAttr(FIELD.name)} /></label>
      <label class="address-capture-field is-wide"><span>Teléfono</span><input name="${FIELD.phone}" autocomplete="tel" inputmode="tel" maxlength="24" enterkeyhint="next" value="${escapeAttr(phone)}" placeholder="Ej. 299 620 9136" ${invalidAttr(FIELD.phone)} /></label>
    </div>`;
  }

  // El barrio NO es texto libre: sale de la lista que publica el propio
  // comercio. Si el comercio todavía no exige cobertura la lista viene vacía y
  // el campo no aparece: no se le pide a nadie que elija de una lista que no
  // existe. Es la misma regla —y la misma fuente— que ya usaba el checkout.
  function renderNeighborhoodField(current) {
    const { areas } = getCommerceAvailability();
    if (!areas.length) return '';
    const known = areas.some((area) => area.name === current);
    const options = [
      '<option value="">Elegí tu barrio</option>',
      ...areas.map((area) => `<option value="${escapeAttr(area.name)}"${area.name === current ? ' selected' : ''}>${escapeHtml(area.name)}</option>`),
      ...(current && !known ? [`<option value="${escapeAttr(current)}" selected>${escapeHtml(current)} (fuera de cobertura)</option>`] : []),
    ].join('');
    return `<label class="address-capture-field is-wide"><span>Barrio</span><select name="${FIELD.neighborhood}">${options}</select></label>`;
  }

  function renderStatus() {
    if (!state.status) return '<p class="address-capture-status" role="alert" data-address-capture-status></p>';
    return `<p class="address-capture-status ${state.statusTone ? `is-${state.statusTone}` : ''}" role="alert" data-address-capture-status>${escapeHtml(state.status)}</p>`;
  }

  function renderDuplicate() {
    const duplicate = state.pendingDuplicate?.duplicate;
    if (!duplicate) return '';
    return `<aside class="address-capture-duplicate" role="alert" data-address-capture-duplicate>
      <strong>Ya tenés una dirección parecida guardada como ${escapeHtml(duplicate.label)}.</strong>
      <p>Podés usar la existente o guardar ambas si realmente son diferentes.</p>
      <div class="address-capture-actions">
        <button class="secondary-button compact" type="button" data-profile-action="duplicate-use">Usar ${escapeHtml(duplicate.label)}</button>
        <button class="ghost-button compact" type="button" data-profile-action="duplicate-save">Guardar igualmente</button>
      </div>
    </aside>`;
  }

  function invalidAttr(name) {
    return state.invalidField === name ? 'aria-invalid="true"' : '';
  }

  /**
   * Se llama DESPUÉS de escribir el HTML: antes no existe ni el contenedor del
   * mapa ni el campo al que hay que llevar el foco.
   */
  function afterRender(container) {
    root = container || null;
    if (!state.open) {
      destroyMap();
      return;
    }
    syncMap();
    if (state.focusSelector) {
      const selector = state.focusSelector;
      state.focusSelector = '';
      setTimeout(() => {
        const target = root?.querySelector(selector);
        if (target instanceof HTMLElement) target.focus({ preventScroll: false });
      }, 0);
    }
  }

  return {
    scope,
    open,
    close,
    reset,
    html,
    afterRender,
    handleAction,
    reviewEdit,
    captureValues,
    get isOpen() { return state.open; },
    get isSaving() { return state.saving; },
    get editingAddressId() { return state.editingAddressId; },
    get draft() { return state.draft; },
  };
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
