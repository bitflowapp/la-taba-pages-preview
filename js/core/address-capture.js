// ─────────────────────────────────────────────────────────────────────────────
// CAPTURA DE UNA DIRECCIÓN DE ENTREGA — las reglas, sin pantalla
//
// POR QUÉ EXISTE
// --------------
// Hasta ahora la única forma de escribir una dirección era el editor de Perfil,
// y las reglas de armado —qué localidad se guarda, cómo se sella la huella del
// pin, qué campos son obligatorios— vivían dentro de esa vista. En cuanto la
// misma captura tiene que ocurrir en otras dos superficies (la hoja del inicio y
// el checkout), copiarlas sería garantizar que se separen: bastaría corregir una
// para que las otras dos sigan mal.
//
// Acá viven una sola vez y sin DOM, así que las tres superficies arman
// exactamente el mismo candidato y el servidor recibe siempre lo mismo.
//
// LO QUE ESTE MÓDULO NO HACE
// --------------------------
// No normaliza (lo hace `normalizeCustomerAddress`), no calcula la huella (lo
// hace `deliveryLocationAddressFingerprint`), no decide si un punto está
// confirmado (lo hace el borrador) y no habla con la base. Sólo ordena esas
// piezas en el orden que impone el contrato.
// ─────────────────────────────────────────────────────────────────────────────

import { OPERATING_AREA } from './business-location.js';
import { normalizeCustomerAddress } from './customer-addresses.js';
import { draftAfterAddressEdit, draftToAddressFields } from './delivery-location-draft.js';
import { validateRequiredStreetNumber } from './validators.js';

export const ADDRESS_CAPTURE_FIELD = Object.freeze({
  STREET: 'street',
  STREET_NUMBER: 'streetNumber',
});

/**
 * Ciudad, provincia y código postal no se preguntan en pantalla: La Taba reparte
 * en Neuquén Capital y eran dos campos obligatorios cuya única respuesta posible
 * ya la sabíamos. El dato NO desaparece —el pedido, el Panel, el Rider y el
 * payer de Mercado Pago lo siguen recibiendo—; lo que se quitó es la pregunta.
 *
 * Se resuelve en este orden, y el orden importa:
 *   1. lo que la persona tiene escrito en esta captura;
 *   2. lo que dice la dirección guardada que se está editando, para que una
 *      dirección vieja que declare otra localidad no se reescriba sola;
 *   3. el área de operación declarada en el contrato del negocio.
 *
 * El código postal no tiene valor canónico: si nadie lo cargó queda vacío.
 * Inventarle uno sería afirmar algo que no sabemos, y la entrega se guía por el
 * punto confirmado, no por el CP.
 */
export function resolveAddressArea({ written = {}, saved = {} } = {}) {
  const pick = (key, canonical) => {
    const value = written?.[key];
    if (typeof value === 'string' && value !== '') return value;
    if (value != null && value !== '') return String(value);
    return saved?.[key] || canonical;
  };
  return {
    city: pick('city', OPERATING_AREA.city),
    province: pick('province', OPERATING_AREA.province),
    postalCode: pick('postalCode', ''),
  };
}

/**
 * Arma el candidato que va a la base y devuelve el borrador ya revisado.
 *
 * El orden NO es intercambiable:
 *   1. se revisa la confirmación contra el texto que realmente se va a guardar
 *      (`draftAfterAddressEdit`), porque un pin confirmado para «Mendoza 850» no
 *      puede viajar callado como destino de «Rivadavia 200»;
 *   2. la huella se sella con ESE texto (`draftToAddressFields`), no con el que
 *      había cuando se tocó «Confirmar ubicación».
 *
 * Devuelve el borrador junto al candidato porque el paso 1 puede degradarlo a
 * `pending`: quien llame tiene que quedarse con el borrador revisado, no con el
 * que traía.
 */
export function buildAddressCandidate({
  id = '',
  label = '',
  street = '',
  streetNumber = '',
  floor = '',
  apartment = '',
  reference = '',
  neighborhood = '',
  area = {},
  isDefault = false,
  draft = null,
} = {}) {
  const written = {
    street,
    streetNumber,
    city: area.city || '',
    province: area.province || '',
    postalCode: area.postalCode || '',
  };
  const reviewedDraft = draft ? draftAfterAddressEdit(draft, written) : null;
  const candidate = normalizeCustomerAddress({
    id,
    label: label || 'Casa',
    ...written,
    floor,
    apartment,
    reference,
    neighborhood,
    isDefault: Boolean(isDefault),
    ...(reviewedDraft ? draftToAddressFields(reviewedDraft, written) : {}),
  });
  return { candidate, draft: reviewedDraft };
}

/**
 * Lo que la pantalla pide y por lo tanto puede exigir. Ciudad y provincia salen
 * del área de operación y no pueden faltar, así que reclamarlas acá sería marcar
 * un error sobre un campo que no existe: la persona vería «Ingresá la ciudad»
 * sin ninguna ciudad para ingresar.
 */
export function validateAddressCandidate(candidate = {}) {
  if (!String(candidate.street || '').trim()) {
    return { ok: false, field: ADDRESS_CAPTURE_FIELD.STREET, message: 'Ingresá la calle.' };
  }
  const streetNumber = validateRequiredStreetNumber(candidate.streetNumber);
  if (!streetNumber.ok) {
    return { ok: false, field: ADDRESS_CAPTURE_FIELD.STREET_NUMBER, message: streetNumber.message };
  }
  return { ok: true };
}
