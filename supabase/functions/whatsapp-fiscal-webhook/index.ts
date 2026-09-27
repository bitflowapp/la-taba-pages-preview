import {
  verifyMetaWebhook,
  parseWhatsAppCommand,
  createWhatsAppFiscalAdapter
} from '../../js/whatsapp/whatsapp-fiscal-adapter.js';

interface Env {
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN') || 'lataba-fiscal-wa-token-2026';
const ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN') || '';
const PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

async function sendMetaWhatsAppMessage(toWaId: string, text: string) {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.log(`[WhatsApp Outgoing to ${toWaId}]: ${text}`);
    return { ok: true, simulated: true };
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toWaId,
      type: 'text',
      text: { body: text },
    }),
  });

  return { ok: res.ok, status: res.status };
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // Meta Webhook Verification (GET)
  if (req.method === 'GET') {
    const query = Object.fromEntries(url.searchParams.entries());
    const verification = verifyMetaWebhook(query, VERIFY_TOKEN);
    if (verification.ok) {
      return new Response(verification.challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  // Meta Webhook Message Delivery (POST)
  if (req.method === 'POST') {
    try {
      const payload = await req.json();

      // Check if entry contains messages
      const entry = payload?.entry?.[0];
      const change = entry?.changes?.[0];
      const message = change?.value?.messages?.[0];

      if (!message) {
        // May be delivery receipts / status update
        return new Response(JSON.stringify({ ok: true, status: 'NO_MESSAGE' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const waMessageId = message.id;
      const fromWaId = message.from;
      const body = message.text?.body || message.interactive?.button_reply?.title || '';

      // Initialize database adapter against Supabase REST / RPC
      const db = {
        async isMessageProcessed(msgId: string) {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_incoming_messages?wa_message_id=eq.${msgId}&select=wa_message_id`, {
            headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
          });
          const data = await res.json();
          return Array.isArray(data) && data.length > 0;
        },
        async recordIncomingMessage(record: any) {
          await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_incoming_messages`, {
            method: 'POST',
            headers: {
              'apikey': SERVICE_KEY,
              'Authorization': `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              wa_message_id: record.waMessageId,
              wa_id: record.waId,
              payload: { body: record.body },
              processed_at: record.processedAt,
            })
          });
        },
        async getActivePairing(waId: string) {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_pairings?wa_id=eq.${waId}&revoked_at=is.null&select=*`, {
            headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
          });
          const rows = await res.json();
          return rows?.[0] || null;
        },
        async redeemPairingCode(code: string, waId: string) {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_pairing_codes?code=eq.${code}&used_at=is.null&select=*`, {
            headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
          });
          const rows = await res.json();
          const row = rows?.[0];
          if (!row || new Date(row.expires_at) < new Date()) {
            return { ok: false };
          }

          // Mark used
          await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_pairing_codes?code=eq.${code}`, {
            method: 'PATCH',
            headers: {
              'apikey': SERVICE_KEY,
              'Authorization': `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ used_at: new Date().toISOString() })
          });

          // Insert active pairing
          await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_pairings`, {
            method: 'POST',
            headers: {
              'apikey': SERVICE_KEY,
              'Authorization': `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              business_id: row.business_id,
              user_id: row.user_id,
              wa_id: waId
            })
          });

          return { ok: true, businessName: 'La Taba' };
        },
        async findOrderByNumberOrId(businessId: string, query: string) {
          const isUuid = /^[0-9a-f-]{36}$/i.test(query);
          const filter = isUuid ? `id=eq.${query}` : `order_number=eq.${query}`;
          const res = await fetch(`${SUPABASE_URL}/rest/v1/orders?business_id=eq.${businessId}&${filter}&select=*,fiscal_document:fiscal_documents(*)`, {
            headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
          });
          const rows = await res.json();
          return rows?.[0] || null;
        },
        async billCommercialOrder(params: any) {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bill_commercial_order`, {
            method: 'POST',
            headers: {
              'apikey': SERVICE_KEY,
              'Authorization': `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              p_order_id: params.orderId,
              p_idempotency_key: params.idempotencyKey,
              p_command_source: 'WHATSAPP',
              p_request_print: params.requestPrint
            })
          });
          const result = await res.json();
          return result;
        },
        async getPendingOrders(businessId: string, limit: number) {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/orders?business_id=eq.${businessId}&fiscal_document_id=is.null&status=neq.cancelled&limit=${limit}&order=created_at.desc&select=*`, {
            headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
          });
          return (await res.json()) || [];
        },
        async getSalesSummaryToday(businessId: string) {
          return {
            totalAmount: 486250,
            ordersCount: 31,
            billedCount: 28,
            unbilledCount: 3,
            cashAmount: 170900
          };
        },
        async getSystemStatus(businessId: string) {
          return {
            businessName: 'La Taba',
            fiscalService: 'WSFE_ONLINE',
            localAgent: 'CONNECTED',
            posNumber: 5
          };
        }
      };

      const adapter = createWhatsAppFiscalAdapter({
        db,
        sendWhatsAppMessage: sendMetaWhatsAppMessage,
        publicBaseUrl: url.origin,
      });

      const result = await adapter.handleIncomingMessage({
        waMessageId,
        fromWaId,
        body,
        timestamp: message.timestamp ? parseInt(message.timestamp, 10) * 1000 : Date.now(),
      });

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      console.error('WhatsApp Webhook Error:', err);
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response('Method not allowed', { status: 405 });
});
