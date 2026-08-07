/**
 * Orquestación de un mensaje entrante y de la cola de avisos.
 *
 * IDEMPOTENCIA, EN TRES CAPAS
 * ---------------------------
 * 1. Meta reintenta hasta recibir 200. `whatsapp_register_inbound_event` guarda
 *    el identificador del mensaje: un reintento de algo YA procesado no vuelve
 *    a entrar, así que no suma dos veces la misma lata.
 * 2. Si el proceso se cortó a mitad, el reintento sí entra —Meta reintenta
 *    porque no supo si salió— y cada respuesta se reserva por
 *    `reply:<mensaje>:<n>` antes de mandarse: las que ya salieron se saltean.
 * 3. El cobro tiene su propia idempotencia, la del backend: el mismo carrito
 *    devuelve la misma sesión de checkout y la misma preferencia.
 *
 * PII
 * ---
 * Del mensaje entrante se guarda su identificador y un hash del payload. El
 * texto no se persiste. Lo que sale a un log es `waIdHash`, nunca el número.
 */

import { createCommerceBackend } from './backend.js';
import { respond, resolveIntent } from './conversation.js';
import { hashIdentifier, sha256Hex } from './signature.js';
import { money, textMessage } from './messages.js';

/**
 * @param {object} input
 * @param {object} input.event mensaje normalizado por `inbound.js`
 * @param {object} input.deps
 * @returns {Promise<{status: string, [key: string]: unknown}>}
 */
export async function handleInboundMessage({ event, deps }) {
  const { rpc, businessId, hashSalt, ensureCustomer, createPaymentLink, sender } = deps;

  const payloadHash = await sha256Hex(JSON.stringify({
    id: event.messageId,
    from: event.waId,
    type: event.type,
    text: event.text,
    replyId: event.replyId,
    location: event.location,
  }));

  const registration = await rpc('whatsapp_register_inbound_event', {
    p_business_id: businessId,
    p_provider_message_id: event.messageId,
    p_event_type: event.type,
    p_payload_hash: payloadHash,
  });
  if (!registration?.process) {
    return { status: 'duplicate', eventId: registration?.event_id || null };
  }
  const eventId = registration.event_id;

  try {
    const waIdHash = await hashIdentifier(event.waId, 'whatsapp-contact', hashSalt);
    const contactRecord = await rpc('whatsapp_upsert_contact', {
      p_business_id: businessId,
      p_wa_id: event.waId,
      p_wa_id_hash: waIdHash,
      p_display_name: event.profileName || null,
      p_customer_id: null,
    });
    if (!contactRecord?.contact_id) throw new Error('contact_not_resolved');
    if (contactRecord.blocked === true) {
      await rpc('whatsapp_complete_inbound_event', {
        p_event_id: eventId,
        p_status: 'ignored',
        p_contact_id: contactRecord.contact_id,
        p_error_code: 'contact_blocked',
      });
      return { status: 'ignored', reason: 'contact_blocked' };
    }

    // El cliente del comercio se resuelve una sola vez por contacto. Si ese
    // teléfono ya compró por la web, es el MISMO cliente: no se abre otro.
    let customerId = contactRecord.customer_id;
    if (!customerId) {
      customerId = await rpc('whatsapp_find_customer_by_phone', { p_phone: event.waId });
      if (!customerId) {
        customerId = await ensureCustomer({ waId: event.waId, displayName: contactRecord.display_name || '' });
      }
      if (!customerId) throw new Error('customer_not_resolved');
      await rpc('whatsapp_link_customer', {
        p_contact_id: contactRecord.contact_id,
        p_customer_id: customerId,
      });
    }

    const conversation = contactRecord.conversation || {};
    const session = {
      state: conversation.state || 'idle',
      cart: conversation.cart || [],
      fulfillment_type: conversation.fulfillment_type || '',
      draft_address: conversation.draft_address || {},
      age_confirmed: Boolean(conversation.age_confirmed),
      last_shelf: conversation.last_shelf || null,
      checkout_session_id: conversation.checkout_session_id || null,
      revision: conversation.revision,
    };

    const backend = createCommerceBackend({
      rpc,
      businessId,
      waId: event.waId,
      waIdHash,
      customerId,
      contactId: contactRecord.contact_id,
      conversationId: conversation.id,
      createPaymentLink,
    });

    const intent = resolveIntent(event, session);
    const outcome = await respond({
      intent,
      session,
      contact: { waId: event.waId, displayName: contactRecord.display_name || event.profileName || '' },
      backend,
    });

    const saved = await rpc('whatsapp_save_conversation', {
      p_contact_id: contactRecord.contact_id,
      p_expected_revision: session.revision ?? null,
      p_state: outcome.session.state,
      p_cart: outcome.session.cart,
      p_fulfillment_type: outcome.session.fulfillment_type || null,
      p_draft_address: outcome.session.draft_address || {},
      p_age_confirmed: Boolean(outcome.session.age_confirmed),
      p_last_shelf: outcome.session.last_shelf || null,
      p_checkout_session_id: outcome.session.checkout_session_id || null,
    });
    if (saved?.ok === false) {
      // Dos mensajes del mismo cliente se cruzaron. El que perdió no contesta:
      // el otro ya está contestando con un carrito más nuevo.
      await rpc('whatsapp_complete_inbound_event', {
        p_event_id: eventId,
        p_status: 'processed',
        p_contact_id: contactRecord.contact_id,
        p_error_code: 'revision_conflict',
      });
      return { status: 'conflict' };
    }

    const sent = await sendReplies({
      rpc,
      sender,
      businessId,
      contactId: contactRecord.contact_id,
      conversationId: conversation.id,
      messageId: event.messageId,
      replies: outcome.replies,
    });

    await rpc('whatsapp_complete_inbound_event', {
      p_event_id: eventId,
      p_status: 'processed',
      p_contact_id: contactRecord.contact_id,
      p_error_code: null,
    });
    return { status: 'processed', intent: intent.kind, replies: sent, waIdHash };
  } catch (error) {
    await rpc('whatsapp_complete_inbound_event', {
      p_event_id: eventId,
      p_status: 'failed',
      p_contact_id: null,
      p_error_code: safeErrorCode(error),
    });
    throw error;
  }
}

async function sendReplies({ rpc, sender, businessId, contactId, conversationId, messageId, replies }) {
  let sent = 0;
  for (let index = 0; index < replies.length; index += 1) {
    const key = `reply:${messageId}:${index}`;
    const reservation = await rpc('whatsapp_enqueue_outbound', {
      p_business_id: businessId,
      p_contact_id: contactId,
      p_idempotency_key: key,
      p_kind: 'conversation_reply',
      // Deliberadamente vacío: la cola sirve para no mandar dos veces lo mismo,
      // no para archivar lo que se dijo.
      p_payload: {},
      p_conversation_id: conversationId || null,
    });
    if (reservation?.duplicate && reservation?.status === 'sent') continue;

    const result = await sender.send(replies[index]);
    // Una respuesta de conversación se resuelve acá o no se resuelve: como su
    // contenido no se guarda, nadie más puede reintentarla. `graph.js` ya
    // reintentó lo reintentable; lo que llega hasta acá se cierra y se registra.
    await rpc('whatsapp_settle_outbound', {
      p_message_id: reservation.message_id,
      p_owner: null,
      p_status: result.ok ? 'sent' : 'failed',
      p_provider_message_id: result.providerMessageId || null,
      p_error_code: result.ok ? null : String(result.errorCode || 'send_failed'),
      p_retry_after_seconds: null,
    });
    if (result.ok) sent += 1;
  }
  return sent;
}

/* ========================================================================== */
/*  Cola de avisos                                                            */
/* ========================================================================== */

/**
 * Drena los avisos que NO nacen de un mensaje del cliente: hoy, la confirmación
 * del pedido cuando Mercado Pago acredita el pago. El disparador de la base
 * encola identificadores; el texto se arma acá.
 */
export async function dispatchOutbound({ rpc, sender, owner, limit = 10, leaseSeconds = 60 }) {
  const claimed = await rpc('whatsapp_claim_outbound', {
    p_owner: owner,
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });
  const jobs = Array.isArray(claimed) ? claimed : [];
  let sent = 0;
  let retried = 0;

  for (const job of jobs) {
    const message = renderNotification(job);
    if (!message) {
      await rpc('whatsapp_settle_outbound', {
        p_message_id: job.message_id,
        p_owner: owner,
        p_status: 'failed',
        p_provider_message_id: null,
        p_error_code: 'unsupported_kind',
        p_retry_after_seconds: null,
      });
      continue;
    }
    const result = await sender.send(message);
    await rpc('whatsapp_settle_outbound', {
      p_message_id: job.message_id,
      p_owner: owner,
      p_status: result.ok ? 'sent' : (result.retryable ? 'retry' : 'failed'),
      p_provider_message_id: result.providerMessageId || null,
      p_error_code: result.ok ? null : String(result.errorCode || 'send_failed'),
      p_retry_after_seconds: result.retryAfterSeconds || null,
    });
    if (result.ok) sent += 1;
    else if (result.retryable) retried += 1;
  }

  return { claimed: jobs.length, sent, retried };
}

export function renderNotification(job) {
  const payload = job?.payload || {};
  if (job?.kind === 'order_confirmed') {
    const code = String(payload.order_public_code || '').trim();
    if (!code) return null;
    return textMessage(job.wa_id, [
      '¡Listo! Mercado Pago confirmó tu pago ✅',
      `Tu pedido es *${code}* por ${money(payload.total)}.`,
      payload.fulfillment_type === 'delivery'
        ? 'Ya entró a preparación. Cuando salga el reparto te avisamos.'
        : 'Ya entró a preparación. Te avisamos cuando esté listo para retirar.',
    ].join('\n'));
  }
  if (job?.kind === 'conversation_reply') {
    // Una respuesta de conversación no se re-renderiza: si quedó pendiente es
    // porque su envío falló, y su contenido no se guardó a propósito.
    return null;
  }
  return null;
}

function safeErrorCode(error) {
  return String(error?.message || 'whatsapp_channel_failed')
    .replace(/[^a-z0-9_.-]/gi, '_')
    .slice(0, 120);
}
