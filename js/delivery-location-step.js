// Paso «Confirmá dónde te entregamos», tal como se ve.
//
// La lógica vive en js/core/delivery-location-draft.js; acá sólo se dibuja el
// estado y se ofrecen los dos caminos que pide el contrato:
//
//   1. USAR MI UBICACIÓN — pide permiso SÓLO después de que la persona toque el
//      botón. Nunca al abrir la pantalla: un permiso pedido de la nada se
//      rechaza, y con razón.
//   2. ELEGIR EN EL MAPA — sin compartir GPS. Se pone un pin y se mueve hasta la
//      puerta.
//
// Y un único acto final: CONFIRMAR UBICACIÓN.

import {
  DELIVERY_LOCATION_STATUS,
  isDeliveryLocationDraftConfirmed,
} from './core/delivery-location-draft.js';
import { deliveryLocationAccuracyLabel } from './core/delivery-location.js';

// Cuánto mueve cada toque de ajuste fino. Quince metros es el ancho de una casa:
// alcanza para corregir «es la puerta de al lado» sin volverse interminable.
export const LOCATION_NUDGE_METERS = 15;

const METERS_PER_DEGREE_LATITUDE = 111320;

export function renderDeliveryLocationStep(draft, {
  mapAvailable = true,
  saving = false,
  confirmationBlocked = false,
} = {}) {
  const confirmed = isDeliveryLocationDraftConfirmed(draft);
  const status = confirmed
    ? 'confirmed'
    : draft?.status === DELIVERY_LOCATION_STATUS.PENDING ? 'pending' : 'empty';

  return `<section class="location-step is-${status}" data-location-step data-location-status="${status}" aria-labelledby="location-step-title">
    <div class="location-step-head">
      <h3 id="location-step-title">Confirmá dónde te entregamos</h3>
      <p>${confirmed
        ? 'Guardamos este punto con tu dirección. Podés cambiarlo cuando quieras.'
        : 'Sin un punto confirmado no podemos llevarte el pedido: el texto de la dirección no le alcanza a quien reparte.'}</p>
    </div>
    ${confirmed ? renderConfirmed(draft) : renderChoices(draft, {
    mapAvailable,
    saving,
    confirmationBlocked,
  })}
  </section>`;
}

function renderChoices(draft, { mapAvailable, saving, confirmationBlocked }) {
  const pending = draft?.status === DELIVERY_LOCATION_STATUS.PENDING && draft?.point;
  return `
    <div class="location-step-options">
      <button class="secondary-button compact" type="button" data-profile-action="use-location" ${draft?.locating || saving ? 'disabled aria-disabled="true"' : ''}>
        ${draft?.locating ? 'Buscando tu ubicación…' : 'Usar mi ubicación'}
      </button>
      <button class="ghost-button compact" type="button" data-profile-action="open-location-map" ${saving ? 'disabled aria-disabled="true"' : ''}>
        Elegir en el mapa
      </button>
    </div>
    <p class="location-step-hint">Te pedimos permiso de ubicación sólo si tocás «Usar mi ubicación». Con «Elegir en el mapa» no compartís GPS.</p>
    ${draft?.error ? `<p class="location-step-error" role="alert" data-location-error>${escapeHtml(draft.error)}</p>` : ''}
    ${draft?.notice ? `<p class="location-step-notice" role="status" data-location-notice>${escapeHtml(draft.notice)}</p>` : ''}
    ${draft?.mapOpen || pending ? renderCanvas(draft, { mapAvailable, confirmationBlocked }) : ''}
    ${pending ? `<div class="location-step-actions">
      <button class="primary-button compact" type="button" data-profile-action="confirm-location" ${saving || confirmationBlocked ? 'disabled aria-disabled="true"' : ''}>Confirmar ubicación</button>
      <button class="ghost-button compact" type="button" data-profile-action="discard-location">Descartar</button>
    </div>` : ''}`;
}

function renderConfirmed(draft) {
  const accuracy = deliveryLocationAccuracyLabel({ accuracyMeters: draft.point?.accuracyMeters });
  return `
    <div class="location-step-confirmed" data-location-confirmed>
      <strong class="location-step-badge">Ubicación confirmada</strong>
      <p class="location-step-coords" data-location-coords>${escapeHtml(formatCoordinatePair(draft.point))}</p>
      <p class="location-step-meta">${escapeHtml([methodLabel(draft.method), accuracy].filter(Boolean).join(' · '))}</p>
    </div>
    <div class="location-step-actions">
      <button class="ghost-button compact" type="button" data-profile-action="open-location-map">Cambiar ubicación</button>
      <button class="ghost-button compact" type="button" data-profile-action="discard-location">Quitar</button>
    </div>`;
}

function renderCanvas(draft, { mapAvailable, confirmationBlocked }) {
  const point = draft?.point;
  const accuracy = deliveryLocationAccuracyLabel({ accuracyMeters: point?.accuracyMeters });
  return `
    <div class="location-step-canvas">
      ${mapAvailable
    ? '<div class="location-step-map" data-location-map role="application" aria-label="Mapa para ubicar el punto de entrega"></div>'
    : `<p class="location-step-nomap" data-location-nomap role="status">${confirmationBlocked
      ? 'No pudimos abrir el mapa. Ajustá el punto con los controles antes de confirmarlo.'
      : 'No pudimos abrir el mapa en este dispositivo. Podés seguir ajustando el punto con los controles.'}</p>`}
      <p class="location-step-coords" data-location-coords>${escapeHtml(formatCoordinatePair(point))}</p>
      ${accuracy ? `<p class="location-step-meta" data-location-accuracy>${escapeHtml(accuracy)}</p>` : ''}
      <div class="location-step-nudge" role="group" aria-label="Ajustar el punto">
        <span>Ajustar</span>
        ${['norte', 'sur', 'oeste', 'este'].map((direction) => `<button class="ghost-button compact" type="button" data-profile-action="nudge-location" data-location-nudge="${direction}" aria-label="Mover el punto ${LOCATION_NUDGE_METERS} metros al ${direction}">${direction}</button>`).join('')}
      </div>
      ${mapAvailable ? '<p class="location-step-hint">Tocá el mapa o arrastrá el pin hasta tu puerta.</p>' : ''}
    </div>`;
}

/**
 * Desplaza el punto una distancia fija. La conversión a grados usa el coseno de
 * la latitud para el eje este-oeste: sin eso, en Neuquén un «paso» hacia el este
 * mediría bastante menos de lo que dice el botón.
 */
export function nudgePoint(point, direction, meters = LOCATION_NUDGE_METERS) {
  const latitude = Number(point?.latitude);
  const longitude = Number(point?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const latitudeStep = meters / METERS_PER_DEGREE_LATITUDE;
  const longitudeStep = meters / (METERS_PER_DEGREE_LATITUDE * Math.max(0.05, Math.cos(latitude * Math.PI / 180)));
  const moves = {
    norte: { latitude: latitude + latitudeStep, longitude },
    sur: { latitude: latitude - latitudeStep, longitude },
    este: { latitude, longitude: longitude + longitudeStep },
    oeste: { latitude, longitude: longitude - longitudeStep },
  };
  return moves[String(direction || '').toLowerCase()] || null;
}

export function formatCoordinatePair(point) {
  const latitude = Number(point?.latitude);
  const longitude = Number(point?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return 'Sin punto todavía';
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function methodLabel(method) {
  return {
    gps: 'Tomada del dispositivo',
    map_pin: 'Marcada en el mapa',
    geocoded_confirmed: 'Dirección geocodificada y confirmada',
  }[String(method || '')] || '';
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
