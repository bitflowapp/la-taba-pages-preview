import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkoutPayload } from '../supabase/functions/_shared/whatsapp/backend.js';
import { dispatchOutbound, handleInboundMessage, renderNotification } from '../supabase/functions/_shared/whatsapp/channel.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const migration = read('supabase/migrations/20260807170000_whatsapp_commerce_channel.sql');

const BUSINESS = '21000000-0000-4000-8000-000000000001';
const COCA = '31000000-0000-4000-8000-000000000004';

/* ===== El bot no puede cobrar por su cuenta ============================== */

test('el payload de checkout del chat es el mismo que manda el navegador', async () => {
  const payload = await checkoutPayload({
    businessId: BUSINESS,
    conversationId: 'conv-1',
    cart: [{ combo_id: 'combo-noche-larga', quantity: 1 }, { product_id: COCA, quantity: 2 }],
    fulfillmentType: 'delivery',
    address: { street: 'San Martín', street_number: '1234', city: 'Neuquén', source: 'gps', latitude: -38.9539, longitude: -68.0596 },
    ageConfirmed: true,
    contactName: 'Vale QA',
    phone: '5492995550101',
  });

  assert.deepEqual(Object.keys(payload).sort(), [
    'address', 'age_confirmed', 'business_id', 'client_request_id',
    'contact', 'fulfillment_type', 'items', 'payment_method',
  ]);
  assert.deepEqual(payload.items, [
    { combo_id: 'combo-noche-larga', quantity: 1 },
    { product_id: COCA, quantity: 2 },
  ]);
  assert.equal(payload.payment_method, 'mercadopago');
  // La misma prohibición que verifica la suite del checkout web: nada de plata
  // ni de estado de pago sale del cliente.
  assert.doesNotMatch(
    JSON.stringify(payload),
    /"(?:price|unit_price|subtotal|discount|discount_total|total|currency|stock|preference_id|payment_id|init_point)"/i,
  );
});

test('el identificador de intención es estable por carrito y cambia con el pedido', async () => {
  const base = {
    businessId: BUSINESS,
    conversationId: 'conv-1',
    cart: [{ product_id: COCA, quantity: 2 }],
    fulfillmentType: 'delivery',
    address: { street: 'San Martín', street_number: '1234', city: 'Neuquén' },
    ageConfirmed: false,
    contactName: 'Vale QA',
    phone: '5492995550101',
  };
  const first = await checkoutPayload(base);
  const again = await checkoutPayload(base);
  assert.equal(first.client_request_id, again.client_request_id);
  assert.match(first.client_request_id, /^[A-Za-z0-9_-]{8,128}$/);

  const otherCart = await checkoutPayload({ ...base, cart: [{ product_id: COCA, quantity: 3 }] });
  const otherMode = await checkoutPayload({ ...base, fulfillmentType: 'pickup' });
  const otherAddress = await checkoutPayload({ ...base, address: { ...base.address, street_number: '1235' } });
  const otherConversation = await checkoutPayload({ ...base, conversationId: 'conv-2' });
  const identifiers = new Set([
    first.client_request_id, otherCart.client_request_id, otherMode.client_request_id,
    otherAddress.client_request_id, otherConversation.client_request_id,
  ]);
  assert.equal(identifiers.size, 5);
});

test('el mismo carrito en distinto orden es el mismo pedido', async () => {
  const base = {
    businessId: BUSINESS,
    conversationId: 'conv-1',
    fulfillmentType: 'pickup',
    address: {},
    ageConfirmed: true,
    contactName: 'Vale QA',
    phone: '5492995550101',
  };
  const left = await checkoutPayload({ ...base, cart: [{ product_id: COCA, quantity: 1 }, { combo_id: 'x-combo', quantity: 1 }] });
  const right = await checkoutPayload({ ...base, cart: [{ combo_id: 'x-combo', quantity: 1 }, { product_id: COCA, quantity: 1 }] });
  assert.equal(left.client_request_id, right.client_request_id);
});

test('en retiro por el local la dirección no viaja', async () => {
  const payload = await checkoutPayload({
    businessId: BUSINESS,
    conversationId: 'conv-1',
    cart: [{ product_id: COCA, quantity: 1 }],
    fulfillmentType: 'pickup',
    address: { street: 'San Martín', street_number: '1234', city: 'Neuquén' },
    ageConfirmed: false,
    contactName: 'Vale QA',
    phone: '5492995550101',
  });
  assert.deepEqual(payload.address, {});
});

/* ===== Idempotencia del canal ============================================ */

function recordingRpc(script = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push([name, args]);
      if (typeof script[name] === 'function') return script[name](args, calls);
      return script[name] ?? null;
    },
  };
}

test('un mensaje ya procesado no vuelve a entrar a la conversación', async () => {
  const recorder = recordingRpc({
    whatsapp_register_inbound_event: { event_id: 'evt-1', duplicate: true, process: false },
  });
  const result = await handleInboundMessage({
    event: { messageId: 'wamid.1', waId: '5492995550101', type: 'text', text: 'HOLA' },
    deps: {
      rpc: recorder.rpc,
      businessId: BUSINESS,
      hashSalt: 'sal',
      ensureCustomer: async () => { throw new Error('no debería provisionar'); },
      createPaymentLink: async () => { throw new Error('no debería cobrar'); },
      sender: { send: async () => { throw new Error('no debería contestar'); } },
    },
  });
  assert.equal(result.status, 'duplicate');
  assert.deepEqual(recorder.calls.map(([name]) => name), ['whatsapp_register_inbound_event']);
});

test('el recibo del mensaje entrante nunca guarda el texto', async () => {
  const recorder = recordingRpc({
    whatsapp_register_inbound_event: { event_id: 'evt-1', duplicate: false, process: true },
    whatsapp_upsert_contact: { contact_id: 'contact-1', customer_id: 'customer-1', display_name: 'Vale', conversation: { id: 'conv-1', state: 'idle', cart: [], revision: 1 } },
    whatsapp_catalog_shelves: [{ shelf_id: 'combos', title: 'Combos', kind: 'combos', count: 1 }],
    whatsapp_save_conversation: { ok: true },
    whatsapp_enqueue_outbound: { message_id: 'out-1', duplicate: false, status: 'pending' },
    whatsapp_settle_outbound: true,
    whatsapp_complete_inbound_event: true,
  });
  await handleInboundMessage({
    event: { messageId: 'wamid.2', waId: '5492995550101', type: 'text', text: 'quiero un fernet con coca', profileName: 'Vale' },
    deps: {
      rpc: recorder.rpc,
      businessId: BUSINESS,
      hashSalt: 'sal',
      ensureCustomer: async () => 'customer-1',
      createPaymentLink: async () => ({ initPoint: '' }),
      sender: { send: async () => ({ ok: true, providerMessageId: 'wamid.out.1' }) },
    },
  });

  const registration = recorder.calls.find(([name]) => name === 'whatsapp_register_inbound_event')[1];
  assert.match(registration.p_payload_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(registration).includes('fernet'), false);

  const enqueued = recorder.calls.find(([name]) => name === 'whatsapp_enqueue_outbound')[1];
  assert.deepEqual(enqueued.p_payload, {});
  assert.match(enqueued.p_idempotency_key, /^reply:wamid\.2:0$/);
});

test('una respuesta ya enviada no se manda de nuevo al reprocesar', async () => {
  let sends = 0;
  const recorder = recordingRpc({
    whatsapp_register_inbound_event: { event_id: 'evt-1', duplicate: true, process: true },
    whatsapp_upsert_contact: { contact_id: 'contact-1', customer_id: 'customer-1', display_name: 'Vale', conversation: { id: 'conv-1', state: 'idle', cart: [], revision: 1 } },
    whatsapp_catalog_shelves: [{ shelf_id: 'combos', title: 'Combos', kind: 'combos', count: 1 }],
    whatsapp_save_conversation: { ok: true },
    whatsapp_enqueue_outbound: { message_id: 'out-1', duplicate: true, status: 'sent' },
    whatsapp_complete_inbound_event: true,
  });
  await handleInboundMessage({
    event: { messageId: 'wamid.3', waId: '5492995550101', type: 'text', text: 'HOLA' },
    deps: {
      rpc: recorder.rpc,
      businessId: BUSINESS,
      hashSalt: 'sal',
      ensureCustomer: async () => 'customer-1',
      createPaymentLink: async () => ({ initPoint: '' }),
      sender: { send: async () => { sends += 1; return { ok: true }; } },
    },
  });
  assert.equal(sends, 0);
});

test('dos mensajes cruzados no se pisan el carrito', async () => {
  const recorder = recordingRpc({
    whatsapp_register_inbound_event: { event_id: 'evt-1', duplicate: false, process: true },
    whatsapp_upsert_contact: { contact_id: 'contact-1', customer_id: 'customer-1', display_name: 'Vale', conversation: { id: 'conv-1', state: 'idle', cart: [], revision: 4 } },
    whatsapp_catalog_shelves: [{ shelf_id: 'combos', title: 'Combos', kind: 'combos', count: 1 }],
    whatsapp_save_conversation: { ok: false, code: 'REVISION_CONFLICT', revision: 5 },
    whatsapp_complete_inbound_event: true,
  });
  const result = await handleInboundMessage({
    event: { messageId: 'wamid.4', waId: '5492995550101', type: 'text', text: 'HOLA' },
    deps: {
      rpc: recorder.rpc,
      businessId: BUSINESS,
      hashSalt: 'sal',
      ensureCustomer: async () => 'customer-1',
      createPaymentLink: async () => ({ initPoint: '' }),
      sender: { send: async () => { throw new Error('no debería contestar con un carrito viejo'); } },
    },
  });
  assert.equal(result.status, 'conflict');
});

test('un contacto bloqueado no llega al comercio', async () => {
  const recorder = recordingRpc({
    whatsapp_register_inbound_event: { event_id: 'evt-1', duplicate: false, process: true },
    whatsapp_upsert_contact: { contact_id: 'contact-1', blocked: true, conversation: {} },
    whatsapp_complete_inbound_event: true,
  });
  const result = await handleInboundMessage({
    event: { messageId: 'wamid.5', waId: '5492995550101', type: 'text', text: 'HOLA' },
    deps: {
      rpc: recorder.rpc,
      businessId: BUSINESS,
      hashSalt: 'sal',
      ensureCustomer: async () => { throw new Error('no'); },
      createPaymentLink: async () => ({ initPoint: '' }),
      sender: { send: async () => { throw new Error('no'); } },
    },
  });
  assert.equal(result.status, 'ignored');
});

/* ===== Avisos ============================================================= */

test('la confirmación de pedido se arma con identificadores, no con texto guardado', () => {
  const message = renderNotification({
    kind: 'order_confirmed',
    wa_id: '5492995550101',
    payload: { order_public_code: 'LT-0101', total: 19800, fulfillment_type: 'delivery' },
  });
  assert.match(message.text.body, /LT-0101/);
  assert.match(message.text.body, /\$ 19\.800/);
  assert.equal(renderNotification({ kind: 'order_confirmed', payload: {} }), null);
  assert.equal(renderNotification({ kind: 'conversation_reply', payload: {} }), null);
});

test('un aviso que falla se devuelve a la cola en vez de perderse', async () => {
  const settled = [];
  const recorder = recordingRpc({
    whatsapp_claim_outbound: [{ message_id: 'out-1', kind: 'order_confirmed', wa_id: '549', payload: { order_public_code: 'LT-1', total: 1 } }],
    whatsapp_settle_outbound: (args) => { settled.push(args); return true; },
  });
  const result = await dispatchOutbound({
    rpc: recorder.rpc,
    sender: { send: async () => ({ ok: false, retryable: true, errorCode: '503', retryAfterSeconds: 7 }) },
    owner: 'test',
  });
  assert.equal(result.retried, 1);
  assert.equal(settled[0].p_status, 'retry');
  assert.equal(settled[0].p_retry_after_seconds, 7);
});

/* ===== La migración sostiene las reglas ================================== */

test('las tablas del canal tienen RLS y no se otorgan al navegador', () => {
  for (const table of [
    'whatsapp_channel_contacts', 'whatsapp_conversations',
    'whatsapp_inbound_events', 'whatsapp_outbound_messages', 'whatsapp_catalog_shelves',
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all privileges on table public\\.${table} from public, anon, authenticated`));
  }
});

test('la restricción del carrito impide guardar un precio en la conversación', () => {
  assert.match(migration, /constraint whatsapp_conversations_cart_check\s*\n?\s*check \(public\.whatsapp_cart_is_valid\(cart\)\)/);
  assert.match(migration, /where keys\.key not in \('product_id', 'combo_id', 'quantity'\)/);
});

test('la deduplicación de entrada y de salida es del motor, no del bot', () => {
  assert.match(migration, /unique \(business_id, provider_message_id\)/);
  assert.match(migration, /unique \(business_id, idempotency_key\)/);
  assert.match(migration, /on conflict \(business_id, provider_message_id\) do nothing/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /dead_letter/);
});

test('el canal no define un segundo camino al pedido', () => {
  // Ni la migración ni el canal crean, cobran o finalizan un pedido por su
  // cuenta: sólo leen catálogo y delegan en las funciones que ya existían.
  assert.doesNotMatch(migration, /insert\s+into\s+public\.orders\b/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.checkout_sessions\b/i);
  assert.doesNotMatch(migration, /update\s+public\.products\s+set\s+stock/i);

  const backend = read('supabase/functions/_shared/whatsapp/backend.js');
  assert.match(backend, /create_checkout_session/);
  assert.doesNotMatch(backend, /unit_price|discount_percentage|\* *quantity/);

  const conversation = read('supabase/functions/_shared/whatsapp/conversation.js');
  // La conversación formatea plata, pero jamás la calcula.
  assert.doesNotMatch(conversation, /price\s*\*|\*\s*quantity|subtotal\s*[+-]=/);
});

test('los secretos del canal se leen sólo del runtime del servidor', () => {
  const runtime = read('supabase/functions/_shared/whatsapp-runtime.ts');
  assert.match(runtime, /WHATSAPP_APP_SECRET/);
  assert.match(runtime, /WHATSAPP_VERIFY_TOKEN/);
  assert.match(runtime, /WHATSAPP_ACCESS_TOKEN/);
  for (const file of ['signature.js', 'inbound.js', 'messages.js', 'conversation.js', 'backend.js', 'graph.js', 'channel.js']) {
    const source = read('supabase/functions/_shared/whatsapp', file);
    assert.doesNotMatch(source, /Deno\.env|process\.env/, file);
  }
});

test('el webhook valida la firma antes de tocar la base y responde 500 si algo falla', () => {
  const webhook = read('supabase/functions/whatsapp-webhook/index.ts');
  const signatureAt = webhook.indexOf('verifyMetaSignature');
  const clientAt = webhook.indexOf('createServiceClient()');
  assert.ok(signatureAt > 0 && clientAt > signatureAt, 'la firma se valida antes de abrir el cliente de servicio');
  assert.match(webhook, /INVALID_SIGNATURE'? \}, 401\)/);
  assert.match(webhook, /resolveVerificationChallenge/);
  assert.match(webhook, /requestIsHttps/);
  assert.match(webhook, /MAX_BODY_BYTES/);
  // El cuerpo se firma tal como llegó.
  assert.match(webhook, /const rawBody = await request\.text\(\)/);
});

test('el canal reutiliza el limitador de los pagos en vez de fabricar otro', () => {
  assert.match(migration, /whatsapp_inbound/);
  assert.match(migration, /whatsapp_outbound/);
  assert.match(read('supabase/functions/whatsapp-webhook/index.ts'), /enforceRateLimit\(service, request, 'whatsapp_inbound'/);
  assert.match(read('supabase/functions/whatsapp-dispatcher/index.ts'), /requireWorkerAuthorization/);
});

test('el enlace de pago sale del mismo módulo que usa el checkout web', () => {
  const runtime = read('supabase/functions/_shared/whatsapp-runtime.ts');
  assert.match(runtime, /from '\.\/mercadopago\.ts'/);
  assert.match(runtime, /createPreference/);
  assert.match(runtime, /findPreferenceByExternalReference/);
  assert.match(runtime, /prepare_mercadopago_preference/);
  assert.doesNotMatch(runtime, /api\.mercadopago\.com/);
});
