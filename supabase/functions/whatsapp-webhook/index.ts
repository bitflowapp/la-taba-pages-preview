/**
 * Webhook oficial de WhatsApp Business Platform (Cloud API de Meta).
 *
 * GET  → verificación del webhook con `hub.verify_token`.
 * POST → notificaciones firmadas con `X-Hub-Signature-256`.
 *
 * Por qué se procesa ANTES de contestar 200: Meta reintenta hasta recibir 200.
 * Si contestáramos primero y falláramos después, el mensaje se perdería sin que
 * nadie se entere. Procesando primero, un fallo devuelve 500, Meta reintenta y
 * la deduplicación por identificador de mensaje evita el efecto doble.
 *
 * El cuerpo se lee UNA vez y se firma tal como llegó: reserializar el JSON
 * cambia bytes y la firma dejaría de validar.
 */

import {
  createServiceClient,
  enforceRateLimit,
  jsonResponse,
  publicErrorResponse,
} from '../_shared/payment-runtime.ts';
import { requestIsHttps } from '../_shared/request-protocol.ts';
import {
  createCustomerProvisioner,
  createPaymentLinkFactory,
  serviceRpc,
  whatsappConfig,
} from '../_shared/whatsapp-runtime.ts';
import { parseWebhookPayload } from '../_shared/whatsapp/inbound.js';
import { resolveVerificationChallenge, verifyMetaSignature } from '../_shared/whatsapp/signature.js';
import { createGraphSender } from '../_shared/whatsapp/graph.js';
import { handleInboundMessage } from '../_shared/whatsapp/channel.js';

const MAX_BODY_BYTES = 96_000;

Deno.serve(async (request) => {
  try {
    const config = whatsappConfig();

    if (request.method === 'GET') {
      const url = new URL(request.url);
      const challenge = resolveVerificationChallenge({
        mode: url.searchParams.get('hub.mode') || '',
        token: url.searchParams.get('hub.verify_token') || '',
        challenge: url.searchParams.get('hub.challenge') || '',
        verifyToken: config.verifyToken,
      });
      if (!challenge) return new Response('forbidden', { status: 403 });
      return new Response(challenge, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse(request, { ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
    }
    if (!requestIsHttps(request)) {
      return jsonResponse(request, { ok: false, code: 'HTTPS_REQUIRED' }, 400);
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return jsonResponse(request, { ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    }

    const valid = await verifyMetaSignature({
      rawBody,
      header: request.headers.get('x-hub-signature-256') || '',
      appSecret: config.appSecret,
    });
    if (!valid) {
      // Sin firma válida no se toca la base: un cuerpo no autenticado no puede
      // crear contactos, conversaciones ni recibos.
      return jsonResponse(request, { ok: false, code: 'INVALID_SIGNATURE' }, 401);
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch (_) {
      return jsonResponse(request, { ok: false, code: 'INVALID_JSON' }, 400);
    }

    const service = createServiceClient();
    await enforceRateLimit(service, request, 'whatsapp_inbound', 600, 60, 'whatsapp-webhook');

    const { messages, statuses, unsupported } = parseWebhookPayload(body);
    if (!messages.length) {
      return jsonResponse(request, { ok: true, messages: 0, statuses: statuses.length, unsupported: unsupported.length });
    }

    const sender = createGraphSender({
      phoneNumberId: config.phoneNumberId,
      accessToken: config.accessToken,
      apiVersion: config.apiVersion,
    });
    const deps = {
      rpc: serviceRpc(service),
      businessId: config.businessId,
      hashSalt: config.hashSalt,
      ensureCustomer: createCustomerProvisioner(service),
      createPaymentLink: createPaymentLinkFactory(service),
      sender,
    };

    const results: string[] = [];
    for (const event of messages) {
      // El doble tilde azul sale aunque la respuesta tarde. Si falla, no
      // interrumpe: es cortesía, no contrato.
      sender.markRead(event.messageId).catch(() => {});
      const outcome = await handleInboundMessage({ event, deps });
      results.push(String(outcome.status));
    }

    return jsonResponse(request, { ok: true, messages: messages.length, results });
  } catch (error) {
    // Devolver 500 es lo correcto: Meta reintenta y la deduplicación evita el
    // efecto doble. Contestar 200 acá perdería el mensaje en silencio.
    return publicErrorResponse(request, error);
  }
});
