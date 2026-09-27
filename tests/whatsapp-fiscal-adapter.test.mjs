import test from 'node:test';
import assert from 'node:assert/strict';

import {
  verifyMetaWebhook,
  parseWhatsAppCommand,
  createWhatsAppFiscalAdapter,
} from '../js/whatsapp/whatsapp-fiscal-adapter.js';

test('WhatsApp Webhook Verification: handles Meta Cloud API challenge', () => {
  const verifyToken = 'test-token-1234';

  const valid = verifyMetaWebhook(
    {
      'hub.mode': 'subscribe',
      'hub.verify_token': verifyToken,
      'hub.challenge': '1158201244',
    },
    verifyToken
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.challenge, '1158201244');

  const invalidToken = verifyMetaWebhook(
    {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': '1158201244',
    },
    verifyToken
  );
  assert.equal(invalidToken.ok, false);
  assert.equal(invalidToken.error, 'VERIFICATION_FAILED');

  const invalidMode = verifyMetaWebhook(
    {
      'hub.mode': 'publish',
      'hub.verify_token': verifyToken,
      'hub.challenge': '1158201244',
    },
    verifyToken
  );
  assert.equal(invalidMode.ok, false);
});

test('WhatsApp Command Parsing: parses deterministic V1 commands', () => {
  assert.deepEqual(parseWhatsAppCommand('TAB-4B29F1'), {
    command: 'pairing_code',
    arg: 'TAB-4B29F1',
    raw: 'TAB-4B29F1',
  });

  assert.deepEqual(parseWhatsAppCommand('facturar 1842'), {
    command: 'facturar',
    arg: '1842',
    raw: 'facturar 1842',
  });

  assert.deepEqual(parseWhatsAppCommand('facturar #1842'), {
    command: 'facturar',
    arg: '1842',
    raw: 'facturar #1842',
  });

  assert.deepEqual(parseWhatsAppCommand('si'), {
    command: 'confirm',
    arg: '',
    raw: 'si',
  });

  assert.deepEqual(parseWhatsAppCommand('confirmar 1842'), {
    command: 'confirm',
    arg: '1842',
    raw: 'confirmar 1842',
  });

  assert.deepEqual(parseWhatsAppCommand('cancelar'), {
    command: 'cancel',
    arg: '',
    raw: 'cancelar',
  });

  assert.deepEqual(parseWhatsAppCommand('estado 1842'), {
    command: 'estado_pedido',
    arg: '1842',
    raw: 'estado 1842',
  });

  assert.deepEqual(parseWhatsAppCommand('pendientes'), {
    command: 'pendientes',
    arg: '',
    raw: 'pendientes',
  });

  assert.deepEqual(parseWhatsAppCommand('ventas hoy'), {
    command: 'ventas_hoy',
    arg: '',
    raw: 'ventas hoy',
  });

  assert.deepEqual(parseWhatsAppCommand('estado'), {
    command: 'estado_sistema',
    arg: '',
    raw: 'estado',
  });
});

test('WhatsApp Adapter: rejects unauthorized phone numbers without pairing', async () => {
  const sentMessages = [];
  const processedMessageIds = new Set();

  const mockDb = {
    async isMessageProcessed(id) {
      return processedMessageIds.has(id);
    },
    async recordIncomingMessage({ waMessageId }) {
      processedMessageIds.add(waMessageId);
    },
    async getActivePairing(waId) {
      return null; // Not paired
    },
    async redeemPairingCode(code, waId) {
      return { ok: false };
    },
  };

  const adapter = createWhatsAppFiscalAdapter({
    db: mockDb,
    sendWhatsAppMessage: async (to, text) => {
      sentMessages.push({ to, text });
    },
  });

  const res = await adapter.handleIncomingMessage({
    waMessageId: 'wamid.HBgLNTQ5MTE0NDAw',
    fromWaId: '5491144001122',
    body: 'facturar 1842',
  });

  assert.equal(res.ok, false);
  assert.equal(res.error, 'UNAUTHORIZED_PHONE');
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /Teléfono no autorizado/);
});

test('WhatsApp Adapter: pairs phone with valid TAB code', async () => {
  const sentMessages = [];
  const processedMessageIds = new Set();
  const pairings = new Map();

  const mockDb = {
    async isMessageProcessed(id) {
      return processedMessageIds.has(id);
    },
    async recordIncomingMessage({ waMessageId }) {
      processedMessageIds.add(waMessageId);
    },
    async getActivePairing(waId) {
      return pairings.get(waId) || null;
    },
    async redeemPairingCode(code, waId) {
      if (code === 'TAB-77A912') {
        pairings.set(waId, { business_id: 'biz-123', user_id: 'walter-usr', wa_id: waId });
        return { ok: true, operatorName: 'Walter', businessName: 'La Taba' };
      }
      return { ok: false };
    },
  };

  const adapter = createWhatsAppFiscalAdapter({
    db: mockDb,
    sendWhatsAppMessage: async (to, text) => {
      sentMessages.push({ to, text });
    },
  });

  // Attempt with valid pairing code
  const res = await adapter.handleIncomingMessage({
    waMessageId: 'wamid.pairing123',
    fromWaId: '5491144001122',
    body: 'TAB-77A912',
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, 'PAIRED');
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /Teléfono vinculado con éxito/);
  assert.match(sentMessages[0].text, /Walter/);
});

test('WhatsApp Adapter: deduplicates re-delivered messages by wa_message_id', async () => {
  const sentMessages = [];
  const processedMessageIds = new Set();
  let billInvocations = 0;

  const mockDb = {
    async isMessageProcessed(id) {
      return processedMessageIds.has(id);
    },
    async recordIncomingMessage({ waMessageId }) {
      processedMessageIds.add(waMessageId);
    },
    async getActivePairing() {
      return { business_id: 'biz-123', user_id: 'walter-usr' };
    },
    async findOrderByNumberOrId() {
      return { id: 'ord-1842', order_number: '1842', total: 15000, customer_name: 'Juan Perez' };
    },
    async billCommercialOrder() {
      billInvocations++;
      return { ok: true, cae: '74238491029384', document_number: 1042, pos_number: 5 };
    },
  };

  const adapter = createWhatsAppFiscalAdapter({
    db: mockDb,
    sendWhatsAppMessage: async (to, text) => {
      sentMessages.push({ to, text });
    },
  });

  // First delivery
  const res1 = await adapter.handleIncomingMessage({
    waMessageId: 'wamid.duplicate_check_001',
    fromWaId: '5491144001122',
    body: 'facturar 1842',
  });
  assert.equal(res1.ok, true);
  assert.equal(res1.status, 'AWAITING_CONFIRMATION');

  // Redelivery of exact same wa_message_id
  const res2 = await adapter.handleIncomingMessage({
    waMessageId: 'wamid.duplicate_check_001',
    fromWaId: '5491144001122',
    body: 'facturar 1842',
  });
  assert.equal(res2.ok, true);
  assert.equal(res2.status, 'DEDUPLICATED');
  assert.equal(billInvocations, 0); // No extra side-effects executed
});

test('WhatsApp Adapter: full interactive billing flow with human UX and convergence', async () => {
  const sentMessages = [];
  const processedMessageIds = new Set();
  let backendBillCallCount = 0;

  const orders = new Map([
    [
      '1842',
      {
        id: 'ord-1842',
        order_number: '1842',
        total: 18500,
        customer_name: 'Walter Martinez',
        payment_method: 'Efectivo',
        fiscal_document: null,
      },
    ],
  ]);

  const mockDb = {
    async isMessageProcessed(id) {
      return processedMessageIds.has(id);
    },
    async recordIncomingMessage({ waMessageId }) {
      processedMessageIds.add(waMessageId);
    },
    async getActivePairing(waId) {
      return { business_id: 'biz-123', user_id: 'walter-usr', wa_id: waId };
    },
    async findOrderByNumberOrId(businessId, num) {
      return orders.get(num) || null;
    },
    async billCommercialOrder({ orderId, commandSource }) {
      backendBillCallCount++;
      assert.equal(commandSource, 'WHATSAPP');
      const order = orders.get('1842');
      order.fiscal_document = {
        id: 'fdoc-1842',
        document_type: 'FACTURA_B',
        pos_number: 5,
        document_number: 1042,
        cae: '74239849201948',
        cae_expiration_date: '2026-10-06',
        state: 'authorized',
      };
      return {
        ok: true,
        document: order.fiscal_document,
        idempotent_replay: backendBillCallCount > 1,
      };
    },
  };

  const adapter = createWhatsAppFiscalAdapter({
    db: mockDb,
    sendWhatsAppMessage: async (to, text) => {
      sentMessages.push({ to, text });
    },
    publicBaseUrl: 'https://lataba.ar',
  });

  const waId = '5491144001122';

  // 1. Walter requests: "facturar 1842"
  const step1 = await adapter.handleIncomingMessage({
    waMessageId: 'wamid.step1',
    fromWaId: waId,
    body: 'facturar 1842',
  });
  assert.equal(step1.ok, true);
  assert.equal(step1.status, 'AWAITING_CONFIRMATION');
  assert.match(sentMessages.at(-1).text, /Confirmación de Facturación Fiscal/);
  assert.match(sentMessages.at(-1).text, /\*Pedido:\* #1842/);
  assert.match(sentMessages.at(-1).text, /\$18\.500/);

  // 2. Walter confirms: "si"
  const step2 = await adapter.handleIncomingMessage({
    waMessageId: 'wamid.step2',
    fromWaId: waId,
    body: 'si',
  });
  assert.equal(step2.ok, true);
  assert.equal(step2.status, 'BILLED');
  assert.equal(step2.cae, '74239849201948');
  assert.equal(step2.documentNumber, 1042);
  assert.equal(backendBillCallCount, 1);

  // Message contains CAE and PDF link with friendly human UX
  const finalMsg = sentMessages.at(-1).text;
  assert.match(finalMsg, /Factura B 0005-00001042 emitida con éxito/);
  assert.match(finalMsg, /\*CAE:\* 74239849201948/);
  assert.match(finalMsg, /\*Vto CAE:\* 2026-10-06/);
  assert.match(finalMsg, /Ticket enviado a la impresora del local/);
  assert.match(finalMsg, /https:\/\/lataba\.ar\/fiscal-pdf\/order-ord-1842/);

  // 3. Walter or someone else tries to bill again: "facturar 1842"
  const step3 = await adapter.handleIncomingMessage({
    waMessageId: 'wamid.step3',
    fromWaId: waId,
    body: 'facturar 1842',
  });
  assert.equal(step3.ok, true);
  assert.equal(step3.status, 'ALREADY_BILLED');
  assert.match(sentMessages.at(-1).text, /El pedido ya fue facturado previamente/);
  assert.match(sentMessages.at(-1).text, /\*CAE:\* 74239849201948/);
  assert.equal(backendBillCallCount, 1); // Not called again!
});

test('WhatsApp Adapter: state and summary commands (pendientes, ventas hoy, estado)', async () => {
  const sentMessages = [];
  const processedMessageIds = new Set();

  const mockDb = {
    async isMessageProcessed(id) {
      return processedMessageIds.has(id);
    },
    async recordIncomingMessage({ waMessageId }) {
      processedMessageIds.add(waMessageId);
    },
    async getActivePairing(waId) {
      return { business_id: 'biz-123', user_id: 'walter-usr', wa_id: waId };
    },
    async getPendingOrders() {
      return [
        { id: '1', order_number: '1843', customer_name: 'Ana Soler', total: 6400 },
        { id: '2', order_number: '1844', customer_name: 'Carlos Ruiz', total: 11200 },
      ];
    },
    async getSalesSummaryToday() {
      return {
        totalAmount: 486250,
        ordersCount: 31,
        billedCount: 29,
        unbilledCount: 2,
        cashAmount: 170900,
      };
    },
    async getSystemStatus() {
      return {
        businessName: 'La Taba',
        fiscalService: 'WSFE_ONLINE',
        localAgent: 'CONNECTED',
      };
    },
  };

  const adapter = createWhatsAppFiscalAdapter({
    db: mockDb,
    sendWhatsAppMessage: async (to, text) => {
      sentMessages.push({ to, text });
    },
  });

  const waId = '5491144001122';

  // pendientes
  await adapter.handleIncomingMessage({
    waMessageId: 'wamid.pendientes',
    fromWaId: waId,
    body: 'pendientes',
  });
  assert.match(sentMessages.at(-1).text, /Pedidos de hoy pendientes de facturar \(2\)/);
  assert.match(sentMessages.at(-1).text, /#1843/);
  assert.match(sentMessages.at(-1).text, /#1844/);

  // ventas hoy
  await adapter.handleIncomingMessage({
    waMessageId: 'wamid.ventas',
    fromWaId: waId,
    body: 'ventas hoy',
  });
  assert.match(sentMessages.at(-1).text, /Resumen de Ventas de Hoy/);
  assert.match(sentMessages.at(-1).text, /\$486\.250/);
  assert.match(sentMessages.at(-1).text, /\*Facturados en ARCA:\* 29/);

  // estado
  await adapter.handleIncomingMessage({
    waMessageId: 'wamid.estado',
    fromWaId: waId,
    body: 'estado',
  });
  assert.match(sentMessages.at(-1).text, /Estado del Ecosistema La Taba Fiscal/);
  assert.match(sentMessages.at(-1).text, /WSFE v1 Operativo/);
});
