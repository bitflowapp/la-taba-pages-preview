// ─────────────────────────────────────────────────────────────────────────────
// LA HOJA DE «ENVIAR A» — elegir dónde recibís sin salir de la góndola
//
// EL DEFECTO MEDIDO
// -----------------
// El chip del encabezado era `<button data-nav-view="profile">`. Tocar «Elegí tu
// dirección» cambiaba de vista: la persona perdía el listado que estaba mirando,
// el filtro, la búsqueda y el lugar del scroll, y llegaba a una pantalla de
// administración. Peor: `data-nav-view` a Perfil LIMPIA la marca de retorno
// (`clearProfileReturnTarget`), así que el botón «Volver al pedido» ni siquiera
// aparecía. La única vuelta era la navegación del navegador.
//
// Acá la pregunta se responde donde se hizo. La hoja se abre sobre la misma
// vista, se cierra y la vista sigue exactamente como estaba.
//
// POR QUÉ UN <dialog> NATIVO
// --------------------------
// `showModal()` da atrapado de foco, cierre con Escape, `::backdrop` y el resto
// del documento inerte sin escribir una línea de eso a mano. Es el mismo
// mecanismo que ya usa la invitación a instalar, así que el teléfono se comporta
// igual en las dos hojas.
//
// DE DÓNDE SALEN LAS DIRECCIONES
// ------------------------------
// Del checkout, que ya las carga y las reconcilia. Montar un segundo cargador
// sería montar una segunda verdad, y las dos superficies terminarían
// discrepando sobre cuál es la dirección activa —que es exactamente el defecto
// que el chip «ENVIAR A» ya tuvo una vez, cuando leía la copia local del perfil.
//
// ABRIR LA HOJA NO CREA IDENTIDAD
// -------------------------------
// No se pide sesión por mirar. El repositorio sólo crea la identidad anónima al
// GUARDAR (`saveProfile` → `ensureCustomerSession({createIfMissing:true})`), que
// es la decisión que ya estaba tomada y que este trabajo no cambia.
// ─────────────────────────────────────────────────────────────────────────────

import { createAddressCaptureController } from './address-capture-controller.js';
import {
  addressSummary,
  findNearbySavedAddress,
  normalizeCustomerAddress,
} from './core/customer-addresses.js';
import { hasConfirmedDeliveryLocation } from './core/delivery-location.js';
import {
  applyProfileFromSheet,
  applySavedAddressFromSheet,
  getDeliveryAddresses,
  getDeliveryProfile,
  getSelectedDeliveryAddressId,
  selectDeliveryAddressById,
} from './customer-delivery.js';
import { createCustomerGeolocationService } from './services/customer-geolocation.js';

const state = {
  bound: false,
  open: false,
  reason: '',
  status: '',
  statusTone: '',
  locating: false,
  scrollLocked: false,
};

let locationService = null;

const capture = createAddressCaptureController({
  scope: 'sheet',
  requestRender: () => render(),
  getAddresses: () => getDeliveryAddresses(),
  getProfile: () => getDeliveryProfile(),
  // El nombre y el teléfono los guarda el editor cuando faltan, y el checkout
  // es quien los tiene en memoria. Sin este puente, alguien que crea su primera
  // dirección desde el inicio volvía al carrito y encontraba «Completá tu
  // perfil» sobre un perfil que acababa de completar.
  onProfileSaved: (profile) => applyProfileFromSheet(profile),
  onSaved: (address, { reused = false } = {}) => {
    // La dirección recién guardada queda ELEGIDA. Guardar una dirección y
    // después tener que elegirla es pedir dos veces la misma decisión.
    applySavedAddressFromSheet(address);
    state.status = reused
      ? `Vamos a llevarlo a ${address.label}.`
      : 'Dirección guardada. Vamos a llevarlo ahí.';
    state.statusTone = 'success';
    closeSheet();
  },
});

export function initializeCustomerAddressSheet() {
  if (state.bound) return;
  const dialog = sheetElement();
  if (!dialog) return;
  state.bound = true;

  dialog.addEventListener('click', (event) => {
    // El área del backdrop es el propio `<dialog>`: sólo cuenta cuando el toque
    // cae fuera de la tarjeta.
    if (event.target === dialog) closeSheet();
  });
  dialog.addEventListener('close', () => {
    state.open = false;
    capture.reset();
    releaseScroll();
  });
  dialog.addEventListener('cancel', () => {
    // El cierre con Escape pasa por acá. No se previene: salir siempre se puede.
    state.open = false;
  });
  dialog.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const sheetAction = target.closest('[data-address-sheet-action]');
    if (sheetAction instanceof HTMLElement) {
      event.preventDefault();
      await handleSheetAction(
        sheetAction.dataset.addressSheetAction || '',
        sheetAction.dataset.addressId || '',
      );
      return;
    }
    const captureAction = target.closest('[data-profile-action]');
    if (captureAction instanceof HTMLElement) {
      event.preventDefault();
      await capture.handleAction(captureAction.dataset.profileAction || '', {
        nudge: captureAction.dataset.locationNudge || '',
      });
    }
  });
  dialog.addEventListener('change', (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest('[data-address-capture="sheet"]')) return;
    capture.reviewEdit();
  });
  // La hoja no tiene `<form>` propio que enviar, pero el editor sí: Enter no
  // puede quedar disparando el envío nativo del formulario de captura.
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (event.target instanceof HTMLTextAreaElement) return;
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest('[data-address-capture="sheet"]')) return;
    event.preventDefault();
  });
  window.addEventListener('taba:customer-profile-updated', () => {
    if (state.open && !capture.isOpen) render();
  });
}

export function openCustomerAddressSheet({ reason = 'home' } = {}) {
  const dialog = sheetElement();
  if (!dialog) return false;
  initializeCustomerAddressSheet();
  state.reason = reason;
  state.status = '';
  state.statusTone = '';
  state.locating = false;
  capture.reset();
  // Sin ninguna dirección guardada, el listado vacío sería una pantalla que sólo
  // sirve para tocar otro botón. Se abre directamente en el editor.
  if (!getDeliveryAddresses().length) capture.open({});
  render();
  if (!dialog.open) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  state.open = true;
  lockScroll();
  return true;
}

export function closeCustomerAddressSheet() {
  closeSheet();
}

export function resetCustomerAddressSheetForTests() {
  state.bound = false;
  state.open = false;
  state.reason = '';
  state.status = '';
  state.statusTone = '';
  state.locating = false;
  capture.reset();
  releaseScroll();
  locationService = null;
}

function closeSheet() {
  const dialog = sheetElement();
  state.open = false;
  capture.reset();
  releaseScroll();
  if (!dialog) return;
  if (dialog.open && typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

async function handleSheetAction(action, addressId) {
  if (action === 'close') {
    closeSheet();
    return;
  }
  if (action === 'select') {
    if (selectDeliveryAddressById(addressId)) {
      closeSheet();
      return;
    }
    state.status = 'Esa dirección todavía no tiene confirmado el punto de entrega.';
    state.statusTone = 'warning';
    render();
    return;
  }
  if (action === 'edit') {
    capture.open({ addressId });
    render();
    return;
  }
  if (action === 'new') {
    capture.open({});
    render();
    return;
  }
  if (action === 'use-location') await useCurrentLocation();
}

/**
 * «Usar mi ubicación» reutiliza lo que ya existe y no inventa un geocodificador:
 * se mide una sola vez, se busca entre las direcciones guardadas una que caiga
 * dentro de la tolerancia de `findNearbySavedAddress` —la misma que usa el
 * detector de duplicados— y si no hay ninguna, la medición pasa al editor como
 * punto PENDIENTE. Nunca se confirma sola: el aparato dice dónde está el
 * teléfono, no a qué puerta hay que tocar.
 */
async function useCurrentLocation() {
  if (state.locating) return;
  if (!locationService) locationService = createCustomerGeolocationService();
  state.locating = true;
  state.status = 'Buscando tu ubicación…';
  state.statusTone = '';
  render();
  const result = await locationService.requestCurrentLocation();
  state.locating = false;
  if (!result?.ok) {
    state.status = result?.message || 'No pudimos obtener tu ubicación.';
    state.statusTone = 'error';
    render();
    return;
  }
  const addresses = getDeliveryAddresses().filter((address) => hasConfirmedDeliveryLocation(address));
  const nearby = findNearbySavedAddress(result.location, addresses);
  if (nearby?.address?.id && selectDeliveryAddressById(nearby.address.id)) {
    state.status = '';
    state.statusTone = '';
    closeSheet();
    return;
  }
  state.status = 'No encontramos una dirección guardada en ese punto. Completá los datos y confirmá el pin.';
  state.statusTone = '';
  capture.open({ location: result.location });
  render();
}

function render() {
  const body = sheetElement()?.querySelector('[data-address-sheet-body]');
  if (!body) return;
  body.innerHTML = capture.isOpen ? renderCapture() : renderChooser();
  capture.afterRender(body);
}

// El aviso de la hoja se dibuja TAMBIÉN sobre el editor. Sin esto, «no
// encontramos una dirección guardada en ese punto» se escribía justo antes de
// abrir el editor y el propio editor se lo llevaba puesto: la persona veía
// aparecer un formulario con un pin ya marcado y sin ninguna explicación de por
// qué.
function renderCapture() {
  const titulo = capture.editingAddressId ? 'Editá tu dirección' : 'Agregá tu dirección';
  return `${renderHead(titulo)}${renderStatus()}${capture.html({ showHead: false })}`;
}

function renderChooser() {
  const addresses = getDeliveryAddresses();
  const selectedId = getSelectedDeliveryAddressId();
  return `${renderHead('¿Dónde te entregamos?')}
    ${renderStatus()}
    ${addresses.length
    ? `<div class="address-sheet-list" role="list" data-address-sheet-list>
      ${addresses.map((address) => renderOption(address, address.id === selectedId)).join('')}
    </div>`
    : '<p class="address-sheet-hint" data-address-sheet-empty>Todavía no tenés direcciones guardadas. Agregá una y queda lista para las próximas compras.</p>'}
    <div class="address-sheet-actions">
      <button class="secondary-button compact" type="button" data-address-sheet-action="use-location" ${state.locating ? 'disabled aria-disabled="true"' : ''}>${state.locating ? 'Buscando tu ubicación…' : 'Usar mi ubicación'}</button>
      <button class="primary-button compact" type="button" data-address-sheet-action="new" data-address-sheet-new>+ Agregar nueva dirección</button>
    </div>
    <p class="address-sheet-hint">Te pedimos permiso de ubicación sólo si tocás «Usar mi ubicación».</p>`;
}

function renderHead(title) {
  return `<div class="address-sheet-head">
    <h2 class="address-sheet-title" id="address-sheet-title">${escapeHtml(title)}</h2>
    <button class="address-sheet-close" type="button" data-address-sheet-action="close" aria-label="Cerrar">✕</button>
  </div>`;
}

function renderStatus() {
  if (!state.status) return '<p class="address-sheet-status" role="status" aria-live="polite" data-address-sheet-status></p>';
  return `<p class="address-sheet-status ${state.statusTone ? `is-${state.statusTone}` : ''}" role="status" aria-live="polite" data-address-sheet-status>${escapeHtml(state.status)}</p>`;
}

function renderOption(rawAddress, selected) {
  const address = normalizeCustomerAddress(rawAddress);
  const confirmed = hasConfirmedDeliveryLocation(address);
  // Una dirección sin punto confirmado no se puede elegir para delivery —el
  // backend la rechazaría igual—, así que en vez de ofrecerla como opción muerta
  // se ofrece lo único que la vuelve usable: confirmar el punto.
  const action = confirmed
    ? `data-address-sheet-action="select" data-address-id="${escapeAttr(address.id)}"`
    : `data-address-sheet-action="edit" data-address-id="${escapeAttr(address.id)}"`;
  return `<button class="address-sheet-option ${selected ? 'is-selected' : ''} ${confirmed ? '' : 'needs-location'}" type="button" role="listitem" ${action} data-address-location="${confirmed ? 'confirmed' : 'missing'}" ${selected ? 'aria-current="true"' : ''}>
    <span class="address-sheet-option-copy">
      <span class="address-sheet-option-head"><strong>${escapeHtml(address.label)}</strong>${address.isDefault ? '<span class="address-sheet-badge">Principal</span>' : ''}</span>
      <span class="address-sheet-option-line">${escapeHtml(addressSummary(address))}</span>
      ${confirmed
    ? ''
    : '<span class="address-sheet-option-missing">Falta confirmar dónde te entregamos</span>'}
    </span>
    <span class="address-sheet-option-mark" aria-hidden="true">${confirmed ? (selected ? '✓' : '›') : '›'}</span>
  </button>`;
}

function sheetElement() {
  const node = document.querySelector('[data-address-sheet]');
  return node instanceof HTMLElement ? node : null;
}

/*
 * `showModal()` deja el resto del documento inerte pero NO impide que el fondo
 * siga desplazándose bajo el dedo: en el teléfono eso se ve como una góndola que
 * se mueve sola detrás de la hoja. Se bloquea mientras la hoja está abierta y se
 * repone exactamente el valor que había, para no pisar otra decisión de estilo.
 */
let previousOverflow = null;

function lockScroll() {
  if (state.scrollLocked) return;
  const body = document.body;
  if (!body) return;
  previousOverflow = body.style.overflow;
  body.style.overflow = 'hidden';
  state.scrollLocked = true;
}

function releaseScroll() {
  if (!state.scrollLocked) return;
  const body = document.body;
  state.scrollLocked = false;
  if (!body) return;
  body.style.overflow = previousOverflow || '';
  previousOverflow = null;
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
