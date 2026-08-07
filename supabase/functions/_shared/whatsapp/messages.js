/**
 * Constructores de mensajes salientes de la Cloud API.
 *
 * Los límites de acá NO son estilo: son los de la API. Un título de fila de 25
 * caracteres o una lista de 11 filas devuelven 400 y el cliente se queda sin
 * respuesta. Se recortan en origen, con elipsis, para que un nombre de producto
 * largo degrade a un nombre corto y no a un mensaje que nunca llega.
 *
 * Referencia de límites aplicada: cuerpo 1024 en interactivos y 4096 en texto,
 * encabezado 60, pie 60, botón de lista 20, 10 filas en total repartidas en
 * hasta 10 secciones, título de fila 24, descripción de fila 72, hasta 3 botones
 * de respuesta con título de 20.
 */

export const LIMITS = Object.freeze({
  TEXT_BODY: 4096,
  INTERACTIVE_BODY: 1024,
  HEADER: 60,
  FOOTER: 60,
  LIST_BUTTON: 20,
  LIST_SECTIONS: 10,
  LIST_ROWS: 10,
  ROW_TITLE: 24,
  ROW_DESCRIPTION: 72,
  ROW_ID: 200,
  REPLY_BUTTONS: 3,
  BUTTON_TITLE: 20,
  BUTTON_ID: 256,
});

export function textMessage(waId, body) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(waId),
    type: 'text',
    text: { preview_url: false, body: clamp(body, LIMITS.TEXT_BODY) },
  };
}

/**
 * Lista interactiva. `sections` es [{ title, rows: [{ id, title, description }] }].
 * Se recorta a 10 filas en total repartidas en orden: una góndola de 40 SKU se
 * pagina, no se manda entera y se rompe.
 */
export function listMessage(waId, { header, body, footer, button, sections }) {
  const trimmed = [];
  let remaining = LIMITS.LIST_ROWS;
  for (const section of Array.isArray(sections) ? sections : []) {
    if (remaining <= 0 || trimmed.length >= LIMITS.LIST_SECTIONS) break;
    const rows = (Array.isArray(section?.rows) ? section.rows : [])
      .slice(0, remaining)
      .map((row) => {
        const built = {
          id: clamp(row?.id, LIMITS.ROW_ID),
          title: clamp(row?.title, LIMITS.ROW_TITLE),
        };
        const description = clamp(row?.description, LIMITS.ROW_DESCRIPTION);
        if (description) built.description = description;
        return built;
      })
      .filter((row) => row.id && row.title);
    if (!rows.length) continue;
    remaining -= rows.length;
    trimmed.push({ title: clamp(section?.title, LIMITS.ROW_TITLE), rows });
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(waId),
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(header ? { header: { type: 'text', text: clamp(header, LIMITS.HEADER) } } : {}),
      body: { text: clamp(body, LIMITS.INTERACTIVE_BODY) },
      ...(footer ? { footer: { text: clamp(footer, LIMITS.FOOTER) } } : {}),
      action: {
        button: clamp(button || 'Ver opciones', LIMITS.LIST_BUTTON),
        sections: trimmed,
      },
    },
  };
}

/** Botones de respuesta rápida. Hasta tres; el cuarto se descarta acá y no en Meta. */
export function buttonsMessage(waId, { header, body, footer, buttons }) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(waId),
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(header ? { header: { type: 'text', text: clamp(header, LIMITS.HEADER) } } : {}),
      body: { text: clamp(body, LIMITS.INTERACTIVE_BODY) },
      ...(footer ? { footer: { text: clamp(footer, LIMITS.FOOTER) } } : {}),
      action: {
        buttons: (Array.isArray(buttons) ? buttons : [])
          .slice(0, LIMITS.REPLY_BUTTONS)
          .map((button) => ({
            type: 'reply',
            reply: {
              id: clamp(button?.id, LIMITS.BUTTON_ID),
              title: clamp(button?.title, LIMITS.BUTTON_TITLE),
            },
          }))
          .filter((button) => button.reply.id && button.reply.title),
      },
    },
  };
}

/** Marca el mensaje entrante como leído: el doble tilde azul es parte del canal. */
export function readReceipt(messageId) {
  return { messaging_product: 'whatsapp', status: 'read', message_id: String(messageId) };
}

/**
 * Pesos argentinos como los escribe el resto de TABA2: separador de miles con
 * punto y sin decimales cuando no los hay.
 */
export function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '$ 0';
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  return `$ ${amount.toLocaleString('es-AR', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function clamp(value, maxLength) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 1) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
