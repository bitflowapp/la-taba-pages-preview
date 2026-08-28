// Configuración operativa del comercio, del lado del Panel
// --------------------------------------------------------
// Horarios de atención, zonas de entrega, envío, mínimo y quién puede tocarlos.
//
// LO QUE ESTE MÓDULO NO ES
// ------------------------
// No es la autoridad. Todo lo que hay acá es presentación y validación
// TEMPRANA: sirve para que el operador vea un error antes de mandar, no para
// decidir nada. El servidor vuelve a validar lo mismo y es el único que
// autoriza. Si estas funciones se borraran, el Panel seguiría siendo seguro —
// sólo más molesto de usar.
//
// LO QUE SÍ HACE
// --------------
//  · normaliza la respuesta de `get_business_operations_config`;
//  · arma la grilla semanal que se muestra, con los tramos de cada día;
//  · valida la carga antes de mandarla (solapamientos, horas mal formadas);
//  · traduce la auditoría a frases que una persona entiende;
//  · dice qué controles van deshabilitados cuando el usuario no puede editar.

import {
  MINUTES_IN_DAY,
  isValidCloseTime,
  isValidOpenTime,
  minutesOfDay,
} from '../core/service-hours.js';

export const WEEKDAYS = Object.freeze([
  { value: 0, label: 'Domingo', short: 'Dom' },
  { value: 1, label: 'Lunes', short: 'Lun' },
  { value: 2, label: 'Martes', short: 'Mar' },
  { value: 3, label: 'Miércoles', short: 'Mié' },
  { value: 4, label: 'Jueves', short: 'Jue' },
  { value: 5, label: 'Viernes', short: 'Vie' },
  { value: 6, label: 'Sábado', short: 'Sáb' },
]);

export const MAX_SLOTS_PER_DAY = 4;
/*
 * El formato de las horas vive en `core/service-hours.js`, con el resto del
 * contrato de horarios. Acá se usa y no se reescribe: cuando la regla vivía en
 * dos archivos, uno de los dos se quedaba viejo.
 *
 * La apertura va en reloj de 24 —`00:00` a `23:59`—; el cierre admite además
 * `24:00`, que es como se escribe «hasta que termine el día». Siete de esas
 * filas son un canal abierto las 24 horas, y hasta esta versión no había forma
 * de expresarlo con la exigencia de horario encendida.
 */

function text(value, maxLength = 200) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function money(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric);
}

const minutes = minutesOfDay;

export function normalizeOperationsConfig(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const hours = Array.isArray(source.hours) ? source.hours : [];
  const zones = Array.isArray(source.zones) ? source.zones : [];
  return Object.freeze({
    businessId: text(source.business_id ?? source.businessId, 64),
    // Sin un `true` explícito, no se puede editar. La ausencia de permiso no es
    // permiso.
    canManage: (source.can_manage ?? source.canManage) === true,
    operatingTimezone: text(source.operating_timezone ?? source.operatingTimezone, 64),
    hoursEnforced: (source.hours_enforced ?? source.hoursEnforced) === true,
    coverageEnforced: (source.delivery_zone_enforced ?? source.coverageEnforced) === true,
    alcoholHoursEnforced: (source.alcohol_hours_enforced ?? source.alcoholHoursEnforced) === true,
    deliveryEnabled: (source.delivery_enabled ?? source.deliveryEnabled) === true,
    pickupEnabled: (source.pickup_enabled ?? source.pickupEnabled) === true,
    deliveryFee: money(source.delivery_fee ?? source.deliveryFee),
    minimumSubtotal: money(source.minimum_delivery_subtotal ?? source.minimumSubtotal),
    maxRadiusMeters: money(source.delivery_max_radius_meters ?? source.maxRadiusMeters),
    isOpenDelivery: (source.is_open_delivery ?? source.isOpenDelivery) === true,
    isOpenPickup: (source.is_open_pickup ?? source.isOpenPickup) === true,
    nextOpenAt: text(source.next_open_at ?? source.nextOpenAt, 40) || null,
    hours: Object.freeze(hours
      .filter((row) => row && typeof row === 'object')
      .map((row) => Object.freeze({
        id: text(row.id, 64),
        channel: text(row.channel, 16),
        weekday: Number(row.weekday),
        opensAt: text(row.opens_at ?? row.opensAt, 5),
        closesAt: text(row.closes_at ?? row.closesAt, 5),
      }))
      .filter((row) => Number.isInteger(row.weekday) && row.weekday >= 0 && row.weekday <= 6)),
    exceptions: Object.freeze((Array.isArray(source.exceptions) ? source.exceptions : [])
      .filter((row) => row && typeof row === 'object')
      .map((row) => Object.freeze({
        id: text(row.id, 64),
        channel: text(row.channel, 16),
        onDate: text(row.on_date ?? row.onDate, 10),
        isClosed: (row.is_closed ?? row.isClosed) !== false,
        opensAt: text(row.opens_at ?? row.opensAt, 5),
        closesAt: text(row.closes_at ?? row.closesAt, 5),
        note: text(row.note, 200),
      }))),
    zones: Object.freeze(zones
      .filter((row) => row && typeof row === 'object')
      .map((row) => Object.freeze({
        id: text(row.id, 64),
        name: text(row.name, 80),
        isActive: (row.is_active ?? row.isActive) === true,
        matchKind: text(row.match_kind ?? row.matchKind, 20) || 'declared_area',
        area: text(row.area, 100),
        boundaryPoints: Number(row.boundary_points ?? row.boundaryPoints) || 0,
        deliveryFee: money(row.delivery_fee ?? row.deliveryFee),
        minimumSubtotal: money(row.minimum_subtotal ?? row.minimumSubtotal),
        priority: Number(row.priority) || 100,
        notes: text(row.notes, 300),
      }))
      .filter((row) => row.name)),
    audit: Object.freeze((Array.isArray(source.audit) ? source.audit : [])
      .filter((row) => row && typeof row === 'object')
      .map((row) => Object.freeze({
        id: String(row.id ?? ''),
        scope: text(row.scope, 32),
        action: text(row.action, 32),
        actorKind: text(row.actor_kind ?? row.actorKind, 16) || 'user',
        actorId: text(row.actor_id ?? row.actorId, 64),
        createdAt: text(row.created_at ?? row.createdAt, 40),
        before: row.before ?? null,
        after: row.after ?? null,
      }))),
  });
}

/** La grilla que se dibuja: un día por fila, con sus tramos ordenados. */
export function weeklyGrid(config, channel = 'delivery') {
  const rows = config.hours.filter((row) => row.channel === channel);
  return WEEKDAYS.map((day) => ({
    ...day,
    slots: rows
      .filter((row) => row.weekday === day.value)
      .map((row) => ({ opensAt: row.opensAt, closesAt: row.closesAt }))
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt)),
  }));
}

/**
 * Valida la grilla antes de mandarla. Mismas reglas que el servidor: horas bien
 * formadas, tramos distintos, hasta cuatro por día y sin solapamiento —incluido
 * el de una franja que cruza la medianoche, que hay que partir en dos antes de
 * comparar o parecería no tocar a nadie—.
 */
export function validateWeeklyHours(slots = []) {
  const errors = [];
  if (!Array.isArray(slots)) return { ok: false, errors: ['La grilla de horarios no es válida.'] };

  const clean = [];
  for (const slot of slots) {
    const weekday = Number(slot?.weekday);
    const opensAt = text(slot?.opensAt, 5);
    const closesAt = text(slot?.closesAt, 5);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      errors.push('Hay un tramo con un día de la semana inválido.');
      continue;
    }
    const dayLabel = WEEKDAYS[weekday].label;
    if (!isValidOpenTime(opensAt) || !isValidCloseTime(closesAt)) {
      errors.push(`${dayLabel}: las horas se escriben como HH:MM (el cierre admite 24:00 para el día completo).`);
      continue;
    }
    if (opensAt === closesAt) {
      errors.push(`${dayLabel}: apertura y cierre no pueden ser la misma hora.`);
      continue;
    }
    clean.push({ weekday, opensAt, closesAt });
  }

  for (const day of WEEKDAYS) {
    const daySlots = clean.filter((slot) => slot.weekday === day.value);
    if (daySlots.length > MAX_SLOTS_PER_DAY) {
      errors.push(`${day.label}: hasta ${MAX_SLOTS_PER_DAY} tramos por día.`);
    }
    const spans = [];
    for (const slot of daySlots) {
      const from = minutes(slot.opensAt);
      const to = minutes(slot.closesAt);
      if (from < to) spans.push([from, to]);
      else {
        spans.push([from, MINUTES_IN_DAY]);
        if (to > 0) spans.push([0, to]);
      }
    }
    const overlapping = spans.some((a, index) => spans
      .slice(index + 1)
      .some((b) => a[0] < b[1] && b[0] < a[1]));
    if (overlapping) errors.push(`${day.label}: hay tramos superpuestos.`);
  }

  return { ok: errors.length === 0, errors, slots: clean };
}

/** Valida una zona antes de mandarla. El servidor vuelve a validar lo mismo. */
export function validateZoneDraft(draft = {}) {
  const errors = [];
  const name = text(draft.name, 80);
  const matchKind = draft.matchKind === 'polygon' ? 'polygon' : 'declared_area';
  if (name.length < 2) errors.push('La zona necesita un nombre de al menos dos caracteres.');
  const fee = draft.deliveryFee === '' || draft.deliveryFee === null || draft.deliveryFee === undefined
    ? null : money(draft.deliveryFee);
  if (draft.deliveryFee !== '' && draft.deliveryFee !== null && draft.deliveryFee !== undefined && fee === null) {
    errors.push('El costo de envío tiene que ser un número de 0 o más.');
  }
  const minimum = draft.minimumSubtotal === '' || draft.minimumSubtotal === null || draft.minimumSubtotal === undefined
    ? null : money(draft.minimumSubtotal);
  if (draft.minimumSubtotal !== '' && draft.minimumSubtotal !== null && draft.minimumSubtotal !== undefined && minimum === null) {
    errors.push('El pedido mínimo tiene que ser un número de 0 o más.');
  }
  if (matchKind === 'polygon' && (!Array.isArray(draft.boundary) || draft.boundary.length < 3)) {
    errors.push('Una zona por polígono necesita al menos tres vértices.');
  }
  return {
    ok: errors.length === 0,
    errors,
    zone: {
      ...(draft.id ? { id: String(draft.id) } : {}),
      name,
      match_kind: matchKind,
      ...(matchKind === 'declared_area' ? { area: text(draft.area, 100) || name } : { boundary: draft.boundary }),
      ...(fee === null ? {} : { delivery_fee: String(fee) }),
      ...(minimum === null ? {} : { minimum_subtotal: String(minimum) }),
      ...(draft.priority === undefined ? {} : { priority: Number(draft.priority) || 100 }),
      ...(draft.notes ? { notes: text(draft.notes, 300) } : {}),
      is_active: draft.isActive !== false,
    },
  };
}

/**
 * Por qué NO se puede encender una exigencia todavía. El servidor se niega igual
 * —y con el mismo criterio—; esto existe para poder decirlo antes de intentarlo.
 */
export function enforcementBlockers(config) {
  const blockers = [];
  if (!config.operatingTimezone) blockers.push('Falta declarar el huso horario para poder exigir horarios.');
  if (!config.hours.some((row) => row.channel === 'delivery' || row.channel === 'pickup')) {
    blockers.push('No hay horarios cargados: exigirlos dejaría el comercio cerrado.');
  }
  if (!config.zones.some((zone) => zone.isActive)) {
    blockers.push('No hay zonas activas: exigir cobertura cancelaría todos los envíos.');
  }
  return blockers;
}

const SCOPE_LABEL = Object.freeze({
  hours: 'Horarios',
  exception: 'Día especial',
  zone: 'Zona de entrega',
  delivery_pricing: 'Envío y mínimo',
  enforcement: 'Exigencia',
  permission: 'Permiso',
});

const ACTION_LABEL = Object.freeze({
  created: 'creó',
  updated: 'editó',
  deleted: 'borró',
  enabled: 'activó',
  disabled: 'desactivó',
  replaced: 'reemplazó',
});

/** La auditoría, en frases. Un cambio hecho por el servidor lo dice. */
export function auditLines(config) {
  return config.audit.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    text: `${row.actorKind === 'user' ? 'Alguien del equipo' : 'El servidor'} ${ACTION_LABEL[row.action] || row.action} ${(SCOPE_LABEL[row.scope] || row.scope).toLowerCase()}`,
    detail: describeChange(row),
  }));
}

function describeChange(row) {
  if (row.scope === 'delivery_pricing') {
    const before = row.before || {};
    const after = row.after || {};
    const parts = [];
    if (before.delivery_fee !== after.delivery_fee) parts.push(`envío ${before.delivery_fee ?? '—'} → ${after.delivery_fee ?? '—'}`);
    if (before.minimum_delivery_subtotal !== after.minimum_delivery_subtotal) {
      parts.push(`mínimo ${before.minimum_delivery_subtotal ?? '—'} → ${after.minimum_delivery_subtotal ?? '—'}`);
    }
    return parts.join(' · ');
  }
  if (row.scope === 'zone') return text(row.after?.name ?? row.before?.name, 80);
  if (row.scope === 'hours') return text(row.after?.channel ?? '', 16);
  if (row.scope === 'exception') return text(row.after?.on_date ?? row.before?.on_date ?? '', 10);
  return '';
}
