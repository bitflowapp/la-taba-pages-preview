import {
  addressSummary,
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
import { APP_MODE_PRODUCTION, getAppMode } from './core/app-mode.js';
import { supportsProfileCheckout } from './core/profile-checkout.js';
import { getCustomerOrderHistory } from './core/customer-history.js';
import {
  formatArgentinePhone,
  isValidArgentinePhone,
  normalizeArgentinePhone,
  validateCustomerName,
} from './core/validators.js';
import { createAddressCaptureController } from './address-capture-controller.js';
import { getOrderRepository } from './repositories/repository_factory.js';

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
  confirmedLocation: null,
  blockedReason: '',
  addressListExpanded: false,
  // Resumen compacto del cliente que vuelve. Arranca plegado y sólo se despliega
  // si la persona toca "Cambiar": desplegarlo por su cuenta anularía el ahorro
  // de pasos que es toda la razón de que exista.
  checkoutSummaryExpanded: false,
  // Identidad capturada EN el checkout (nombre y WhatsApp), para que la primera
  // compra no tenga que pasar por la pantalla de Perfil.
  savingIdentity: false,
  identityError: '',
  // Lo tipeado vive sólo en el DOM y cada render lo reconstruye. Sin esta copia,
  // el propio mensaje de error borraba el nombre que la persona acababa de
  // escribir: se le pedía todo de nuevo justo cuando ya estaba por comprar.
  identityDraft: null,
  // La preferencia de pago se copia del último pedido UNA sola vez por sesión de
  // checkout. Repetirlo en cada render pisaría la elección que la persona acaba
  // de hacer, que es la forma más rápida de convertir una comodidad en un error
  // de cobro.
  paymentPreferenceApplied: false,
  // Un mensaje que sobrevive UN render: lo escribe el editor al guardar y lo
  // consume el próximo dibujo. Sin él, el «Dirección guardada» se perdía entre
  // el aviso del editor —que se cierra— y el re-dibujo del listado.
  pendingStatus: '',
  // La dirección que la hoja del encabezado declaró para la próxima compra. La
  // consume `beginCheckoutSession` una sola vez; después vuelve a regir la
  // predeterminada del Perfil.
  sheetIntentAddressId: '',
  // ¿Ya sabemos si esta persona tiene direcciones? Arranca en false porque las
  // direcciones llegan DESPUÉS del primer pintado. Mientras sea false, ninguna
  // pantalla puede afirmar «no tenés dirección»: todavía no lo sabe.
  addressesKnown: false,
};

// A partir de esta cantidad el listado se muestra compacto y expandible, para
// que 10 direcciones no empujen el resto del checkout fuera de pantalla.
export const ADDRESS_LIST_COMPACT_THRESHOLD = 4;
export const ADDRESS_LIST_COMPACT_VISIBLE = 3;

/*
 * EL EDITOR VIVE ACÁ ADENTRO, NO EN OTRA PANTALLA.
 *
 * Antes, cualquier persona sin dirección usable veía un botón que la sacaba del
 * checkout hacia Perfil —«Agregar dirección en Perfil»— con el carrito cargado.
 * Volver dependía de una marca en `sessionStorage` que sólo se escribe cuando el
 * que mandó fue el checkout; llegando desde el inicio no había retorno.
 *
 * El editor es exactamente el mismo componente que usa la hoja del encabezado, y
 * apoya en el mismo contrato que Perfil: mismo paso de confirmación, mismas
 * validaciones, misma RPC. Perfil no desaparece: sigue siendo la administración
 * completa, pero deja de ser un requisito para comprar.
 */
const capture = createAddressCaptureController({
  scope: 'checkout',
  requestRender: () => render(),
  getAddresses: () => state.addresses,
  getProfile: () => state.profile,
  onProfileSaved: (profile) => { state.profile = profile; },
  onSaved: (address, { reused = false } = {}) => {
    upsertLocalAddress(address);
    // La dirección recién guardada queda ELEGIDA. Guardarla y después tener que
    // elegirla sería pedir dos veces la misma decisión.
    selectAddress(address.id, {
      source: ADDRESS_SOURCE.SAVED_ADDRESS_SELECTED,
      renderAfter: false,
    });
    state.pendingStatus = reused
      ? `Vamos a llevarlo a ${address.label}.`
      : 'Dirección guardada. Vamos a llevarlo ahí.';
    notifyProfileUpdated();
  },
});

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
    confirmedLocation: null,
    // Estos cuatro faltaban y el hueco no era inocuo: `addressesKnown` es lo
    // que separa "todavía no sé" de "sé que no hay nada", así que dejarlo en
    // true después de un reset hacía imposible reproducir el arranque —una
    // prueba de la fase sin resolver medía siempre la fase ya resuelta—. Los
    // otros tres arrastraban decisiones de la corrida anterior.
    addressesKnown: false,
    blockedReason: '',
    addressListExpanded: false,
    checkoutSummaryExpanded: false,
    paymentPreferenceApplied: false,
    pendingStatus: '',
    sheetIntentAddressId: '',
    // Mismo motivo que los cuatro de arriba: arrastrar un error de identidad de
    // la corrida anterior haría que una prueba midiera un checkout ya en falla.
    savingIdentity: false,
    identityError: '',
    identityDraft: null,
  });
  capture.reset();
  notifiedDeliveryAddressKey = null;
}

/**
 * Inserta o reemplaza una dirección en la copia local. La usa el editor tras
 * guardar, para que el listado y el chip del encabezado reflejen el alta sin
 * esperar una relectura del servidor.
 */
function upsertLocalAddress(address) {
  if (!address?.id) return;
  const index = state.addresses.findIndex((entry) => entry.id === address.id);
  if (index >= 0) state.addresses.splice(index, 1, address);
  else state.addresses.unshift(address);
  if (address.isDefault || state.addresses.length === 1) {
    state.addresses = state.addresses.map((entry) => ({ ...entry, isDefault: entry.id === address.id }));
  }
  state.addressesKnown = true;
}

/* ============================================================================
   API que consume la hoja del encabezado
   ----------------------------------------------------------------------------
   El checkout ya carga, reconcilia y conoce las direcciones: la hoja del inicio
   las lee de acá en vez de montar un segundo cargador. Un segundo cargador sería
   una segunda verdad, y las dos superficies terminarían discrepando sobre cuál
   es la dirección activa —que es exactamente el defecto que el chip «ENVIAR A»
   ya tuvo una vez.
   ========================================================================== */
export function getDeliveryAddresses() {
  return state.addresses.map((address) => normalizeCustomerAddress(address));
}

export function getSelectedDeliveryAddressId() {
  return state.selectedAddressId || defaultAddress()?.id || '';
}

export function getDeliveryProfile() {
  return state.profile;
}

/**
 * Elige una dirección desde afuera del checkout. Pasa por el MISMO camino que el
 * selector del checkout —incluida la defensa que rechaza una dirección sin punto
 * confirmado—, así que no existe forma de elegir por acá algo que el checkout no
 * dejaría elegir.
 */
export function selectDeliveryAddressById(addressId) {
  selectAddress(addressId, { source: ADDRESS_SOURCE.SAVED_ADDRESS_SELECTED });
  // `selectAddress` se planta en silencio ante una dirección sin punto
  // confirmado, así que la única forma honesta de contestar «¿quedó elegida?» es
  // mirar el estado después.
  const elegida = Boolean(addressId) && state.selectedAddressId === addressId;
  if (elegida) state.sheetIntentAddressId = addressId;
  return elegida;
}

/**
 * El perfil que el editor de la hoja acaba de crear. El checkout es quien lo
 * tiene en memoria, y sin este puente alguien que completa nombre, teléfono y
 * primera dirección desde el inicio volvía al carrito y encontraba «Completá tu
 * perfil» sobre un perfil que acababa de completar. En producción se disimulaba
 * porque abrir el carrito relee del servidor; en la demo no hay relectura.
 */
export function applyProfileFromSheet(profile) {
  if (!profile) return;
  state.profile = profile;
  render();
}

export function applySavedAddressFromSheet(address) {
  upsertLocalAddress(address);
  selectAddress(address.id, { source: ADDRESS_SOURCE.SAVED_ADDRESS_SELECTED, renderAfter: false });
  if (state.selectedAddressId === address.id) state.sheetIntentAddressId = address.id;
  render();
  notifyProfileUpdated();
}

/*
 * PLAZO DE RESOLUCIÓN — la red puede fallar; también puede no contestar nunca.
 *
 * `customer_profile_repository.load()` traduce a `{ok:false}` la sesión vencida,
 * el error de RPC y la caída de red, así que esos tres casos resuelven solos.
 * Lo que NO resuelve es una petición COLGADA: `client.rpc` no tiene tiempo
 * límite propio, y una promesa que nunca se asienta dejaría el checkout
 * esperando para siempre.
 *
 * Esto no es una espera cosmética ni una pausa para tapar el problema: no
 * demora nada en el camino feliz —cuando el perfil llega, llega—, y sólo actúa
 * si a los 5 segundos todavía no hay respuesta, resolviendo hacia el estado
 * USABLE: el formulario completo, con el aviso de que los datos guardados no se
 * pudieron traer. La carga real sigue viva; si aterriza después, hidrata los
 * campos pero ya no vuelve a plegar el formulario (ver el pestillo de abajo).
 */
const PROFILE_RESOLUTION_DEADLINE_MS = 5000;

async function loadCustomerDeliveryProfile() {
  const repository = profileRepository();
  if (!repository) return { ok: false };
  const hydrationVersion = ++state.profileHydrationVersion;
  const interactionVersionAtStart = state.addressInteractionVersion;
  state.loading = true;
  render();
  const deadline = armProfileResolutionDeadline(hydrationVersion);
  const result = await repository.load();
  clearTimeout(deadline);
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

/*
 * Vencido el plazo, el checkout pasa a ser el completo y SE QUEDA ahí. El
 * pestillo es el mismo que usa "Cambiar": una vez que la persona tiene delante
 * el formulario entero —y puede haber empezado a tocarlo— replegarlo porque el
 * perfil llegó tarde sería el salto que todo esto viene a evitar, sólo que peor,
 * porque ahora ocurre con el dedo apoyado.
 */
function armProfileResolutionDeadline(hydrationVersion) {
  return setTimeout(() => {
    if (hydrationVersion !== state.profileHydrationVersion) return;
    if (state.addressesKnown) return;
    state.addressesKnown = true;
    state.checkoutSummaryExpanded = true;
    render('No pudimos traer tus datos guardados. Podés completar el pedido acá.');
  }, PROFILE_RESOLUTION_DEADLINE_MS);
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

  // `change` y no `input`: se dispara al salir del campo, así que revisar la
  // confirmación no le pelea el foco a quien está escribiendo la calle.
  form?.addEventListener('change', (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest('[data-address-capture="checkout"]')) return;
    capture.reviewEdit();
  });

  /*
   * El editor vive DENTRO de `<form data-checkout-form>`, así que un Enter en
   * cualquiera de sus campos enviaría el pedido. Se corta acá: mientras la
   * captura está abierta, Enter no confirma la compra.
   */
  form?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (!(event.target instanceof Element)) return;
    if (event.target instanceof HTMLTextAreaElement) return;
    if (!event.target.closest('[data-address-capture="checkout"]')) return;
    event.preventDefault();
  });

  document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('[data-customer-addresses]')) return;

    const profileAction = target.closest('[data-profile-checkout-action]')?.dataset.profileCheckoutAction;
    if (profileAction) {
      event.preventDefault();
      handleProfileCheckoutAction(
        profileAction,
        target.closest('[data-customer-address-id]')?.dataset.customerAddressId || '',
      );
      return;
    }

    // Los `data-profile-action` son los del paso de confirmación y del editor:
    // el MISMO vocabulario que usa Perfil, porque es el mismo componente.
    const trigger = target.closest('[data-profile-action]');
    if (trigger instanceof HTMLElement) {
      event.preventDefault();
      await capture.handleAction(trigger.dataset.profileAction || '', {
        nudge: trigger.dataset.locationNudge || '',
        addressId: target.closest('[data-customer-address-id]')?.dataset.customerAddressId || '',
      });
      return;
    }

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
  /*
   * UNA elección hecha en la hoja del encabezado, y sólo una.
   *
   * Abrir el carrito empieza una sesión de checkout NUEVA, y una sesión nueva
   * arranca en la dirección predeterminada del Perfil: es una decisión tomada
   * —la sostiene `customer-delivery.spec` saliendo a Home y volviendo— y sirve
   * para que una selección vieja no se cuele en la compra siguiente.
   *
   * Lo que la hoja declara es otra cosa: «a esto que estoy por comprar,
   * llevámelo acá». Por eso viaja como una intención de UN SOLO uso: la consume
   * la primera sesión que empiece después, y a partir de ahí vuelve a regir la
   * predeterminada. Sin esto, elegir «Trabajo» en el inicio y abrir el carrito
   * cambiaba el destino en silencio justo en la pantalla donde se paga.
   */
  const intencion = state.sheetIntentAddressId;
  state.sheetIntentAddressId = '';
  if (intencion && findAddress(intencion)) {
    selectAddress(intencion, {
      source: ADDRESS_SOURCE.SAVED_ADDRESS_SELECTED,
      userInitiated: false,
      renderAfter: false,
    });
    render();
    return loadCustomerDeliveryProfile();
  }
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

/*
 * Lo único que el listado del checkout hace es ELEGIR.
 *
 * Acá vivían además `add`, `edit`, `close-editor`, `save-address`,
 * `use-location`, `confirm-location`, `discard-location`, las sugerencias y los
 * duplicados: un editor entero al que NINGÚN control llegaba —sus funciones de
 * dibujo estaban vivas y jamás se invocaban— y que además había quedado atrás
 * del contrato. `confirmPendingLocation` escribía latitud y longitud sin
 * `deliveryLocationSource` ni `deliveryLocationConfirmedAt`, o sea una
 * confirmación incompleta que `requireConfirmedDeliveryLocation` rechaza y que
 * el trigger `orders_require_confirmed_delivery_location` habría rebotado con
 * DELIVERY_LOCATION_REQUIRED. Se retiró en vez de dejarlo esperando que alguien
 * lo volviera a cablear: el editor que sí existe es el de arriba, que comparte
 * el paso de confirmación con Perfil.
 */
async function handleAction(action, addressId) {
  if (action === 'select') {
    selectAddress(addressId, { source: ADDRESS_SOURCE.SAVED_ADDRESS_SELECTED });
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
  // El barrio declarado va por su propio campo. Es lo que el backend usa para
  // resolver la cobertura, así que no puede salir de la localidad.
  setValue(form, 'deliveryNeighborhood', normalized.neighborhood);
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
  const flash = state.pendingStatus;
  state.pendingStatus = '';
  const status = message || flash || (state.loading ? 'Cargando tus datos guardados…' : '');
  // Antes de resolver el resumen: el renglón "Pago" tiene que leer el valor ya
  // preseleccionado, y el formulario extendido también se beneficia de tenerlo.
  applyRememberedPaymentPreference();
  const fase = checkoutProfilePhase();
  const compact = fase === 'compact' ? compactCheckoutSummary() : null;
  applyCheckoutSummaryMode(fase);
  container.innerHTML = `
    <section class="profile-checkout" data-profile-checkout aria-labelledby="profile-checkout-title" data-checkout-phase="${fase}"${compact ? ' data-checkout-summary="compact"' : ''}>
      <h4 class="profile-checkout-title" id="profile-checkout-title">${CHECKOUT_PHASE_TITLE[fase]}</h4>
      <div class="saved-address-status" aria-live="polite">${escapeHtml(status)}</div>
      ${renderCheckoutPhase(fase, compact)}
    </section>`;
  // DESPUÉS de escribir el HTML: antes no existe el contenedor del mapa ni el
  // campo al que hay que llevar el foco.
  capture.afterRender(container);
}

/* ============================================================================
   TRES FASES, NO DOS — el checkout no adivina mientras no sabe
   ----------------------------------------------------------------------------
   El defecto: `compactCheckoutSummary()` devolvía null mientras el perfil
   cargaba, y "null" significaba "formulario completo". O sea que a un cliente
   recurrente se le pintaba el formulario entero —siete campos, 1272 px— y
   cuando el perfil llegaba se derrumbaba al resumen de 788. En demo no se veía
   porque el perfil sale de localStorage; contra Supabase es un viaje de red.

   La causa real es que "todavía no sé" y "sé que no hay nada" estaban
   representados con el MISMO valor. Son estados distintos y ahora se llaman
   distinto:

     blocked     · esta tienda no puede tomar pedidos
     unresolved  · hay indicios de cliente recurrente y el perfil no llegó
     compact     · hay perfil reutilizable: resumen
     full        · no hay nada que recordar: formulario completo

   `unresolved` NO se le muestra a cualquiera: sólo a quien tiene un pedido en
   el historial LOCAL, que se lee sin red y de forma sincrónica. Para todos los
   demás la respuesta ya se conoce en el primer pintado —no hay nada que
   recordar— y el formulario completo aparece de una, sin esperar nada. Esa es
   la razón de que esto no agregue ni un milisegundo de espera al usuario nuevo,
   que es el caso más frecuente.
   ========================================================================== */
const CHECKOUT_PHASE_TITLE = Object.freeze({
  blocked: 'Tus datos',
  unresolved: 'Tus datos',
  compact: 'Revisá y confirmá',
  full: 'Tus datos',
});

function checkoutProfilePhase() {
  if (state.blockedReason) return 'blocked';
  if (!state.addressesKnown && hasLocalOrderHistory()) return 'unresolved';
  return compactCheckoutSummary() ? 'compact' : 'full';
}

function renderCheckoutPhase(fase, compact) {
  if (fase === 'unresolved') return renderCheckoutSummaryPlaceholder();
  if (fase === 'compact') return renderCompactCheckoutSummary(compact);
  return `${renderProfileSummary()}
      ${renderDeliveryAddressBlock()}`;
}

/*
 * Señal sincrónica y local de que esta persona ya compró acá. Es la MISMA que
 * abre el resumen compacto (ver `compactCheckoutSummary`), leída sin red: por
 * eso se puede consultar en el primer pintado, antes de que exista respuesta
 * del servidor. No prueba que el perfil vaya a estar completo —eso lo decide la
 * fase `compact` cuando llega—, prueba que vale la pena esperarlo.
 */
function hasLocalOrderHistory() {
  return getCustomerOrderHistory().length > 0;
}

/*
 * Geometría reservada, no un spinner. Ocupa exactamente el alto del resumen que
 * viene —tres renglones sobre la misma superficie y con los mismos hairlines—,
 * así que cuando el perfil llega lo único que cambia es el contenido de las
 * filas: cero desplazamiento.
 * `aria-hidden` porque no hay nada que anunciar acá: el estado se dice UNA vez
 * en la región viva de arriba ("Cargando tus datos guardados…"), y anunciar
 * además una estructura vacía sería describir un formulario que no existe.
 * Sin animación: una superficie quieta no necesita excepción de movimiento
 * reducido y no gasta compositor mientras se espera la red.
 */
function renderCheckoutSummaryPlaceholder() {
  // Las barras usan LAS MISMAS etiquetas y clases que el resumen real, con la
  // tinta en transparente y un `&nbsp;` adentro. Así el alto de cada renglón lo
  // decide la tipografía —no un `height` inventado que hay que mantener a mano
  // cada vez que alguien toca un `font-size`— y las dos cajas miden igual por
  // construcción. Las dos primeras filas llevan detalle y la tercera no,
  // exactamente como Entrega, Contacto y Pago.
  const fila = (conDetalle) => `
      <div class="checkout-summary-row">
        <div class="checkout-summary-copy">
          <span class="checkout-summary-kicker is-ghost is-ghost-kicker">&nbsp;</span>
          <strong class="is-ghost is-ghost-title">&nbsp;</strong>
          ${conDetalle ? '<span class="is-ghost is-ghost-detail">&nbsp;</span>' : ''}
        </div>
        <span class="checkout-summary-change is-ghost is-ghost-action">&nbsp;</span>
      </div>`;
  return `
    <div class="checkout-summary is-unresolved" data-checkout-summary-placeholder aria-hidden="true">${fila(true)}${fila(true)}${fila(false)}
    </div>`;
}

/* ============================================================================
   EL CLIENTE QUE VUELVE — resumen en vez de formulario
   ----------------------------------------------------------------------------
   Quien ya compró acá vio este mismo formulario entero la vez anterior y no
   cambió nada: eligió la misma dirección, con el mismo teléfono y el mismo
   medio de pago. Volvérselo a pedir campo por campo no agrega ninguna decisión;
   agrega scroll. Acá esos datos se muestran resumidos, con una salida a
   "Cambiar" en cada renglón, y el formulario completo sigue existiendo intacto
   detrás de ese botón.

   LA COMPUERTA ES UN PEDIDO ANTERIOR, NO UN PERFIL GUARDADO. La diferencia no
   es cosmética: tener una dirección guardada sólo prueba que alguien la
   escribió; tener un pedido en el historial prueba que ya se completó una
   compra con estos datos. Un perfil a medio llenar no es un cliente recurrente,
   y presentarle un resumen sería esconderle justamente los campos que todavía
   no llenó.

   LO QUE EL RESUMEN NO HACE: no confirma nada. Recordar un dato no autoriza a
   usarlo — la dirección, el stock, el precio, la zona y el horario los
   revalida el envío del pedido, exactamente igual que para alguien que compra
   por primera vez. El resumen ahorra tipeo, no controles.
   ========================================================================== */
function compactCheckoutSummary() {
  if (state.checkoutSummaryExpanded) return null;
  if (state.blockedReason) return null;
  // Sigue sin resumir mientras carga, pero eso YA NO significa "formulario
  // completo": `checkoutProfilePhase` decide antes si corresponde esperar.
  if (state.loading) return null;
  const profile = state.profile || {};
  const name = String(profile.name || '').trim();
  const phone = String(profile.phone || '').trim();
  if (!name || !phone) return null;
  // Sin un pedido anterior no hay nada que "recordar": es la primera compra.
  if (!getCustomerOrderHistory().length) return null;

  const pickup = currentDeliveryModeIsPickup();
  let address = null;
  if (!pickup) {
    const active = getActiveDeliveryAddress();
    // La dirección tiene que seguir siendo entregable HOY. Una dirección
    // guardada sin punto confirmado no se puede resumir como si estuviera
    // lista: el backend la rechazaría igual, después de cobrar.
    if (!active) return null;
    address = active;
  }

  return { pickup, address, name, phone, payment: currentPaymentChoice() };
}

function renderCompactCheckoutSummary(summary) {
  const entrega = summary.pickup
    ? { titulo: 'Retirás en el local', detalle: 'Te esperamos en el mostrador' }
    : {
      titulo: summary.address.label || 'Dirección de entrega',
      detalle: addressSummary(summary.address),
    };
  return `
    <div class="checkout-summary" data-checkout-summary-rows>
      ${summaryRow('Entrega', entrega.titulo, entrega.detalle, 'delivery')}
      ${summaryRow('Contacto', summary.name, maskPhone(summary.phone), 'contact')}
      ${summaryRow('Pago', summary.payment.label, '', 'payment')}
    </div>`;
}

function summaryRow(kicker, titulo, detalle, target) {
  return `
    <div class="checkout-summary-row" data-checkout-summary-row="${escapeHtml(target)}">
      <div class="checkout-summary-copy">
        <span class="checkout-summary-kicker">${escapeHtml(kicker)}</span>
        <strong>${escapeHtml(titulo)}</strong>
        ${detalle ? `<span>${escapeHtml(detalle)}</span>` : ''}
      </div>
      <button
        class="text-button checkout-summary-change"
        type="button"
        data-profile-checkout-action="expand-summary"
        aria-label="Cambiar ${escapeHtml(kicker.toLowerCase())}"
      >Cambiar</button>
    </div>`;
}

/*
 * El teléfono es el de esta persona en su propio teléfono, así que ocultarlo no
 * la protege de nadie: lo que hace es que el renglón se lea de un vistazo y que
 * una captura de pantalla del checkout no lleve el número entero. Se conservan
 * los últimos tres dígitos, que son los que alcanzan para reconocer cuál de los
 * números propios es.
 */
function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length <= 3) return digits;
  return `•••${digits.slice(-3)}`;
}

function currentPaymentChoice() {
  const select = checkoutForm()?.elements?.paymentMethod;
  const value = String(select?.value || '');
  const label = select?.selectedOptions?.[0]?.textContent?.trim();
  return { value, label: label || 'A coordinar con el local' };
}

/*
 * La preferencia de pago del último pedido, revalidada contra lo que el
 * checkout ofrece HOY. Un método que ya no está en la lista —porque el comercio
 * lo dio de baja o porque el CHECK de la base nunca lo aceptó— se descarta en
 * silencio y queda el valor por defecto del formulario.
 *
 * Prellenar NO es saltear: el medio elegido se muestra en el resumen, con su
 * propio "Cambiar". `taba-reorder-retention` prohíbe saltear la elección del
 * medio de pago, no proponer el que se usó la vez anterior a la vista de todos.
 */
function applyRememberedPaymentPreference() {
  if (state.paymentPreferenceApplied) return;
  if (state.blockedReason) return;
  const select = checkoutForm()?.elements?.paymentMethod;
  if (!select) return;
  state.paymentPreferenceApplied = true;
  const remembered = String(getCustomerOrderHistory()[0]?.paymentMethodCode || '');
  if (!remembered || remembered === select.value) return;
  const offered = [...select.options].some((option) => option.value === remembered);
  if (!offered) return;
  select.value = remembered;
}

/*
 * Los controles que el resumen reemplaza NO viven en este contenedor: la
 * modalidad y el medio de pago son hermanos del formulario, escritos en el
 * HTML. Se los pliega con un atributo en el `<form>` y una regla de CSS, no
 * quitándolos del árbol: quitarlos perdería el valor elegido y volvería a
 * pedirlo, que es exactamente lo contrario de lo que esto hace.
 */
function applyCheckoutSummaryMode(fase) {
  const form = checkoutForm();
  if (!form) return;
  // La modalidad y el medio de pago se pliegan en las dos fases donde la
  // decisión todavía no le corresponde a la persona: cuando el resumen los
  // reemplaza, y cuando no se sabe si van a hacer falta. Desplegarlos mientras
  // se espera sería pintar justamente el formulario que se quiere evitar.
  if (fase === 'compact' || fase === 'unresolved') form.dataset.checkoutSummary = 'compact';
  else delete form.dataset.checkoutSummary;
  const heading = form.querySelector('.checkout-heading > span');
  if (heading) {
    // "Finalizá en pocos pasos" es una promesa sobre la longitud del
    // formulario, y en la primera compra el formulario NO es corto. El renglón
    // pasa a decir para qué sirve lo que viene, que es verificable. Mientras no
    // se sabe, no se promete ninguna de las dos cosas.
    heading.textContent = fase === 'compact'
      ? 'Ya tenemos tus datos'
      : fase === 'unresolved' ? 'Buscando tus datos' : 'Para entregarte el pedido';
  }
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
    /*
     * ACÁ, NO EN PERFIL.
     *
     * Esto era una tarjeta con un botón que mandaba a `#profile`: quien compraba
     * por primera vez tenía que SALIR del pedido, completar otra pantalla y
     * volver. Con retiro en local ése era todo el trámite —no hace falta ninguna
     * dirección— y aun así costaba dos navegaciones y perder el hilo.
     *
     * El cliente no está creando un perfil: está haciendo un pedido. Los dos
     * datos que el local necesita se piden acá, en línea, y se guardan por la
     * MISMA capa que ya usa el editor de direcciones (`repo.saveProfile`). No
     * hay una segunda lógica de perfil.
     *
     * `data-profile-block="incomplete"` se conserva A PROPÓSITO: es lo que lee
     * `bloqueoDePerfilEnCheckout` para reemplazar un rechazo del servidor por un
     * mensaje accionable, y sostiene el defecto medido el 2026-08-25 —«Ingresá
     * un nombre de al menos 2 caracteres» sobre una pantalla sin ningún campo de
     * nombre—. Lo que cambia es que ahora el campo SÍ está, a un dedo de ahí.
     */
    const identityError = state.identityError
      ? `<p class="profile-checkout-identity-error" role="alert">${escapeHtml(state.identityError)}</p>`
      : '';
    // El borrador gana sobre el perfil: es lo último que escribió la persona.
    const borrador = {
      name: String(state.identityDraft?.name ?? profile.name ?? ''),
      phone: String(state.identityDraft?.phone ?? profile.phone ?? ''),
    };
    return `<div class="profile-checkout-block profile-checkout-identity-form" data-profile-block="incomplete" data-profile-identity-form>
      <strong>${currentDeliveryModeIsPickup() ? '¿A nombre de quién retiramos?' : '¿A nombre de quién?'}</strong>
      <span>${currentDeliveryModeIsPickup()
        ? 'Con esto el local sabe quién pasa a buscarlo y cómo avisarte.'
        : 'Para que el local pueda entregarte el pedido y avisarte.'}</span>
      <label class="profile-checkout-identity-field">
        <span>Nombre y apellido</span>
        <input name="checkoutIdentityName" autocomplete="name" maxlength="80" enterkeyhint="next"
               placeholder="Tu nombre y apellido" value="${escapeHtml(borrador.name)}" />
      </label>
      <label class="profile-checkout-identity-field">
        <span>WhatsApp</span>
        <input name="checkoutIdentityPhone" autocomplete="tel" inputmode="tel" maxlength="24" enterkeyhint="done"
               placeholder="Ej. 299 620 9136" value="${escapeHtml(borrador.phone)}" />
      </label>
      ${identityError}
      <button class="primary-button compact" type="button" data-profile-checkout-action="save-identity" ${state.savingIdentity ? 'disabled' : ''}>
        ${state.savingIdentity ? 'Guardando…' : 'Guardar y continuar'}
      </button>
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
    // Retiro en local no exige nada geográfico: el punto de encuentro es el
    // mostrador. La captura, si estaba abierta, no estorba acá.
    return `<div class="profile-checkout-pickup" data-profile-pickup>
      <strong>Retirás en el local</strong>
      <span>No hace falta una dirección: te esperamos en el mostrador.</span>
    </div>`;
  }
  // El editor abierto ocupa el bloque entero: es la tarea que la persona está
  // haciendo, y dejar el listado debajo compitiendo con él sería ofrecerle dos
  // formas de responder la misma pregunta.
  // NO lleva `data-profile-block`: un editor abierto no es un bloqueo. Quien ya
  // tiene una dirección elegida puede abrirlo para agregar otra, y marcarlo como
  // bloqueo haría que un rechazo del pedido por stock terminara diciendo
  // «completá tus datos de entrega», que sería falso.
  if (capture.isOpen) {
    return `<div class="profile-checkout-addresses" data-profile-capture="inline">${capture.html()}</div>`;
  }
  const usable = state.addresses.filter((address) => hasConfirmedDeliveryLocation(normalizeCustomerAddress(address)));
  if (!state.addresses.length) {
    return `<div class="profile-checkout-block" data-profile-block="no-address" role="status">
      <strong>Agregá una dirección para recibir el pedido</strong>
      <span>Se completa acá mismo, sin salir del pedido. Después queda guardada para las próximas compras.</span>
      <button class="primary-button compact" type="button" data-profile-checkout-action="new-address">Agregar dirección</button>
    </div>`;
  }
  // Tener direcciones no alcanza: para delivery hace falta al menos una con el
  // punto confirmado. Si ninguna lo tiene, se dice acá y no al apretar pagar, y
  // se resuelve acá y no en otra pantalla.
  if (!usable.length) {
    return `<div class="profile-checkout-block" data-profile-block="no-confirmed-location" role="status">
      <strong>Confirmá dónde te entregamos</strong>
      <span>Ninguna de tus direcciones tiene todavía el punto de entrega confirmado. Sin ese punto, quien reparte no sabe a qué puerta tocar.</span>
      <div class="profile-checkout-block-actions">
        <button class="primary-button compact" type="button" data-profile-checkout-action="confirm-address" data-customer-address-id="${escapeAttr(state.addresses[0].id)}">Confirmar ubicación</button>
        <button class="text-button" type="button" data-profile-checkout-action="new-address">Usar otra dirección</button>
      </div>
    </div>`;
  }
  return `<div class="profile-checkout-addresses">
    <div class="profile-checkout-addresses-head">
      <span class="field-label" id="profile-addresses-title">¿Dónde lo llevamos?</span>
      <button class="text-button" type="button" data-profile-checkout-action="manage-addresses">Administrar en Perfil</button>
    </div>
    ${renderAddressList()}
    <div class="profile-checkout-addresses-foot">
      <button class="ghost-button compact" type="button" data-profile-checkout-action="new-address" data-checkout-new-address>+ Nueva dirección</button>
    </div>
  </div>`;
}

function currentDeliveryModeIsPickup() {
  const form = checkoutForm();
  return String(form?.elements?.deliveryMode?.value || '') === 'pickup';
}

// Navegar a Perfil no puede costar el carrito ni la selección ya hecha: se deja
// una marca de retorno y el estado del checkout permanece intacto en memoria.
// Con el editor en línea, esa navegación dejó de ser el camino para comprar y
// pasó a ser lo que dice el botón: administrar.
function handleProfileCheckoutAction(action, addressId = '') {
  if (action === 'save-identity') {
    guardarIdentidadEnLinea();
    return;
  }
  if (action === 'new-address') {
    capture.open({ addressId: '' });
    return;
  }
  if (action === 'confirm-address') {
    capture.open({ addressId });
    return;
  }
  if (action === 'expand-summary') {
    // Se despliega el checkout ENTERO, no el renglón que se tocó. Un resumen
    // que se abre por partes deja a la persona sin saber qué queda plegado, y
    // en un formulario de compra eso se paga confirmando algo que no se vio.
    state.checkoutSummaryExpanded = true;
    render();
    return;
  }
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

/*
 * Guarda nombre y teléfono sin salir del pedido.
 *
 * Usa las MISMAS validaciones que el editor de direcciones —`validateCustomerName`
 * y el teléfono argentino normalizado— y la misma RPC (`repo.saveProfile`). Si
 * acá se escribiera otra regla, un dato aceptado por un camino sería rechazado
 * por el otro y la persona no tendría forma de saber cuál vale.
 */
async function guardarIdentidadEnLinea() {
  if (state.savingIdentity) return;
  const form = checkoutForm();
  const nombreCrudo = String(form?.querySelector('[name="checkoutIdentityName"]')?.value || '');
  const telefonoCrudo = String(form?.querySelector('[name="checkoutIdentityPhone"]')?.value || '');
  // Se guarda ANTES de validar: cualquier salida de acá vuelve a dibujar el
  // bloque, y sin esto el render lo repinta desde el perfil vacío.
  state.identityDraft = { name: nombreCrudo, phone: telefonoCrudo };

  const nombre = validateCustomerName(nombreCrudo);
  if (!nombre.ok) {
    state.identityError = nombre.message;
    render();
    enfocarCampoDeIdentidad('checkoutIdentityName');
    return;
  }
  const telefono = normalizeArgentinePhone(telefonoCrudo);
  if (!isValidArgentinePhone(telefono)) {
    state.identityError = 'Ingresá un teléfono argentino válido, con código de área.';
    render();
    enfocarCampoDeIdentidad('checkoutIdentityPhone');
    return;
  }

  state.savingIdentity = true;
  state.identityError = '';
  render();
  try {
    // El MISMO repositorio que usa el editor de direcciones: `customerProfiles`,
    // no el de pedidos. Guardar por otra puerta sería la segunda lógica de
    // perfil que este cambio viene justamente a no crear.
    const repo = getOrderRepository()?.customerProfiles;
    if (!repo?.saveProfile) {
      state.identityError = 'Esta tienda todavía no puede guardar tus datos.';
      return;
    }
    const resultado = await repo.saveProfile({ name: nombre.name, phone: telefono });
    if (!resultado?.ok) {
      // El texto lo escribió la persona y no se pierde: `render()` lo vuelve a
      // pintar desde el perfil, y si el guardado falló los valores siguen en el
      // DOM hasta que se resuelva.
      state.identityError = resultado?.message || 'No pudimos guardar tus datos. Probá de nuevo.';
      return;
    }
    state.profile = resultado.profile || { ...(state.profile || {}), name: nombre.name, phone: telefono };
    state.identityError = '';
    state.identityDraft = null;
  } catch (_) {
    state.identityError = 'No pudimos guardar tus datos. Probá de nuevo.';
  } finally {
    state.savingIdentity = false;
    render();
  }
}

function enfocarCampoDeIdentidad(nombreCampo) {
  const campo = checkoutForm()?.querySelector(`[name="${nombreCampo}"]`);
  if (campo instanceof HTMLElement) campo.focus({ preventScroll: false });
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

function isProduction() {
  return getAppMode() === APP_MODE_PRODUCTION;
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
