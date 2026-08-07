/**
 * Lectura de una notificación de la Cloud API de Meta.
 *
 * Una notificación trae un lote: varias entradas, varios cambios por entrada y
 * varios mensajes por cambio. Se normaliza a una lista plana de eventos con lo
 * único que este canal necesita, y se descarta el resto SIN guardarlo.
 *
 * Los `statuses` (entregado, leído) se reconocen para poder responder 200 y no
 * provocar reintentos, pero no entran a la conversación: no son del cliente.
 */

const SUPPORTED_MESSAGE_TYPES = new Set(['text', 'interactive', 'button', 'location', 'order']);

/**
 * @typedef {object} WhatsAppInboundMessage
 * @property {string} messageId identificador que asigna Meta; es la clave de deduplicación
 * @property {string} waId teléfono del cliente en formato internacional sin '+'
 * @property {string} phoneNumberId número del comercio que recibió el mensaje
 * @property {string} profileName nombre de perfil, tal como lo publica el cliente
 * @property {string} type
 * @property {number} timestamp
 * @property {string} text
 * @property {string} replyId identificador de la fila o el botón que se tocó
 * @property {string} replyTitle
 * @property {{ latitude: number, longitude: number, reference: string }|null} location
 */

/**
 * @param {unknown} body cuerpo JSON ya parseado
 * @returns {{
 *   messages: WhatsAppInboundMessage[],
 *   statuses: Array<{ messageId: string, status: string, recipientId: string }>,
 *   unsupported: WhatsAppInboundMessage[]
 * }}
 */
export function parseWebhookPayload(body) {
  const result = { messages: [], statuses: [], unsupported: [] };
  const payload = asObject(body);
  if (payload.object !== 'whatsapp_business_account') return result;

  for (const entry of asArray(payload.entry)) {
    for (const change of asArray(asObject(entry).changes)) {
      const changed = asObject(change);
      if (changed.field !== 'messages') continue;
      const value = asObject(changed.value);
      if (value.messaging_product !== 'whatsapp') continue;
      const metadata = asObject(value.metadata);
      const phoneNumberId = text(metadata.phone_number_id);
      const profiles = new Map(
        asArray(value.contacts).map((contact) => {
          const record = asObject(contact);
          return [text(record.wa_id), text(asObject(record.profile).name)];
        }),
      );

      for (const status of asArray(value.statuses)) {
        const record = asObject(status);
        result.statuses.push({
          messageId: text(record.id),
          status: text(record.status),
          recipientId: text(record.recipient_id),
        });
      }

      for (const message of asArray(value.messages)) {
        const record = asObject(message);
        const normalized = normalizeMessage(record, { phoneNumberId, profiles });
        if (!normalized) continue;
        if (!SUPPORTED_MESSAGE_TYPES.has(normalized.type)) {
          result.unsupported.push(normalized);
          continue;
        }
        result.messages.push(normalized);
      }
    }
  }

  return result;
}

function normalizeMessage(record, { phoneNumberId, profiles }) {
  const messageId = text(record.id);
  const waId = digits(record.from);
  if (!messageId || !waId) return null;

  const type = text(record.type) || 'unknown';
  const normalized = {
    messageId,
    waId,
    phoneNumberId,
    profileName: profiles.get(waId) || '',
    type,
    timestamp: Number(record.timestamp) || 0,
    text: '',
    replyId: '',
    replyTitle: '',
    location: null,
  };

  if (type === 'text') {
    normalized.text = text(asObject(record.text).body).slice(0, 1024);
    return normalized;
  }
  if (type === 'button') {
    // Botón de plantilla: llega con `payload`, no como `interactive`.
    const button = asObject(record.button);
    normalized.replyId = text(button.payload).slice(0, 256);
    normalized.replyTitle = text(button.text).slice(0, 256);
    return normalized;
  }
  if (type === 'interactive') {
    const interactive = asObject(record.interactive);
    const reply = asObject(interactive.list_reply).id
      ? asObject(interactive.list_reply)
      : asObject(interactive.button_reply);
    normalized.replyId = text(reply.id).slice(0, 256);
    normalized.replyTitle = text(reply.title).slice(0, 256);
    return normalized;
  }
  if (type === 'location') {
    const location = asObject(record.location);
    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return normalized;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return normalized;
    normalized.location = {
      latitude,
      longitude,
      // `address` y `name` los escribe la persona o Google; se acotan y se usan
      // sólo como referencia visible, nunca como dirección estructurada.
      reference: text(location.name || location.address).slice(0, 180),
    };
    return normalized;
  }
  return normalized;
}

export function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? '').trim();
}

function digits(value) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}
