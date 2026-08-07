import assert from 'node:assert/strict';
import test from 'node:test';

import { parseWebhookPayload } from '../supabase/functions/_shared/whatsapp/inbound.js';

function envelope(value) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'entry-1', changes: [{ field: 'messages', value }] }],
  };
}

function messagesValue(messages, contacts = [{ profile: { name: 'Vale' }, wa_id: '5492995550101' }]) {
  return {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '5492990000000', phone_number_id: '900000000000000' },
    contacts,
    messages,
  };
}

test('un mensaje de texto se normaliza con su identidad y su cuerpo', () => {
  const { messages } = parseWebhookPayload(envelope(messagesValue([{
    from: '5492995550101', id: 'wamid.1', timestamp: '1780000000', type: 'text', text: { body: 'HOLA' },
  }])));
  assert.equal(messages.length, 1);
  assert.deepEqual(
    { ...messages[0] },
    {
      messageId: 'wamid.1',
      waId: '5492995550101',
      phoneNumberId: '900000000000000',
      profileName: 'Vale',
      type: 'text',
      timestamp: 1780000000,
      text: 'HOLA',
      replyId: '',
      replyTitle: '',
      location: null,
    },
  );
});

test('una respuesta de lista y una de botón llegan por el mismo campo', () => {
  const { messages } = parseWebhookPayload(envelope(messagesValue([
    {
      from: '5492995550101', id: 'wamid.2', type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id: 'shelf:combos', title: 'Combos' } },
    },
    {
      from: '5492995550101', id: 'wamid.3', type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'act:pay', title: 'Pagar' } },
    },
    {
      from: '5492995550101', id: 'wamid.4', type: 'button',
      button: { payload: 'act:menu', text: 'Menú' },
    },
  ])));
  assert.deepEqual(messages.map((message) => message.replyId), ['shelf:combos', 'act:pay', 'act:menu']);
});

test('la ubicación llega con su punto y se acota la referencia', () => {
  const { messages } = parseWebhookPayload(envelope(messagesValue([{
    from: '5492995550101', id: 'wamid.5', type: 'location',
    location: { latitude: -38.9539, longitude: -68.0596, name: 'Casa', address: 'x'.repeat(400) },
  }])));
  assert.deepEqual(messages[0].location, { latitude: -38.9539, longitude: -68.0596, reference: 'Casa' });
});

test('una ubicación fuera de rango o sin números no viaja como punto', () => {
  const { messages } = parseWebhookPayload(envelope(messagesValue([
    { from: '5492995550101', id: 'wamid.6', type: 'location', location: { latitude: 999, longitude: 0 } },
    { from: '5492995550101', id: 'wamid.7', type: 'location', location: { latitude: 'x', longitude: 'y' } },
  ])));
  assert.deepEqual(messages.map((message) => message.location), [null, null]);
});

test('los acuses de entrega no entran a la conversación', () => {
  const parsed = parseWebhookPayload(envelope({
    ...messagesValue([]),
    statuses: [{ id: 'wamid.1', status: 'delivered', recipient_id: '5492995550101' }],
  }));
  assert.equal(parsed.messages.length, 0);
  assert.equal(parsed.statuses.length, 1);
});

test('un tipo no soportado se reconoce pero no llega a la conversación', () => {
  const parsed = parseWebhookPayload(envelope(messagesValue([
    { from: '5492995550101', id: 'wamid.8', type: 'sticker', sticker: { id: 's1' } },
  ])));
  assert.equal(parsed.messages.length, 0);
  assert.equal(parsed.unsupported.length, 1);
});

test('un payload de otro producto o de otro objeto se ignora entero', () => {
  assert.equal(parseWebhookPayload({ object: 'page', entry: [] }).messages.length, 0);
  assert.equal(parseWebhookPayload(envelope({ messaging_product: 'sms', messages: [] })).messages.length, 0);
  assert.equal(parseWebhookPayload(null).messages.length, 0);
  assert.equal(parseWebhookPayload({ object: 'whatsapp_business_account' }).messages.length, 0);
});

test('un mensaje sin identificador o sin remitente no se procesa', () => {
  const parsed = parseWebhookPayload(envelope(messagesValue([
    { id: '', from: '5492995550101', type: 'text', text: { body: 'x' } },
    { id: 'wamid.9', from: '', type: 'text', text: { body: 'x' } },
  ])));
  assert.equal(parsed.messages.length, 0);
});

test('varias entradas y varios cambios se aplanan en orden', () => {
  const parsed = parseWebhookPayload({
    object: 'whatsapp_business_account',
    entry: [
      { changes: [{ field: 'messages', value: messagesValue([{ from: '5492995550101', id: 'a', type: 'text', text: { body: '1' } }]) }] },
      { changes: [{ field: 'messages', value: messagesValue([{ from: '5492995550101', id: 'b', type: 'text', text: { body: '2' } }]) }] },
    ],
  });
  assert.deepEqual(parsed.messages.map((message) => message.messageId), ['a', 'b']);
});
