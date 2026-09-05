import { oauthConfig, oauthMode } from '../_shared/seller-oauth.ts';
import { fetchPayment } from '../_shared/mercadopago.ts';
import { resolveSellerWebhookBusiness } from '../_shared/seller-webhook-routing.ts';
import {
  createServiceClient,
  enforceRateLimit,
  getRequiredEnv,
  jsonResponse,
  providerEnvironment,
  publicErrorResponse,
  readJsonObject,
  requirePost,
  sha256Hex,
} from '../_shared/payment-runtime.ts';
import { validateMercadoPagoWebhookSignature } from '../_shared/mercadopago-webhook-signature.ts';
import { requestIsHttps } from '../_shared/request-protocol.ts';
import { webhookEventType, webhookResourceId } from '../_shared/webhook-notification.ts';

const WEBHOOK_MAX_BYTES = 16_000;

Deno.serve(async (request) => {
  try {
    requirePost(request);
    if (!requestIsHttps(request)) {
      return jsonResponse(request, { ok: false, code: 'HTTPS_REQUIRED' }, 400);
    }

    const rawBody = await request.clone().text();
    if (new TextEncoder().encode(rawBody).byteLength > WEBHOOK_MAX_BYTES) {
      return jsonResponse(request, { ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    }
    const body = await readJsonObject(request, WEBHOOK_MAX_BYTES);
    const service = createServiceClient();
    await enforceRateLimit(service, request, 'webhook', 240, 60, 'mercadopago-webhook');

    const url = new URL(request.url);
    let businessId: string | undefined;
    // Mercado Pago's current official SDK recipe signs the `data.id` query
    // parameter, not a reconstructed event object. Do not substitute a
    // body-derived identifier in the validator.
    const dataId = webhookResourceId(url);
    const bodyDataId = object(body.data).id === undefined ? '' : String(object(body.data).id).trim();
    const signature = request.headers.get('x-signature')?.trim() || '';
    const requestId = request.headers.get('x-request-id')?.trim() || '';
    const eventType = webhookEventType(url, body);
    const payloadHash = await sha256Hex(rawBody);
    const webhookEventId = String(body.id || requestId || payloadHash).trim();

    const signatureValid = validateMercadoPagoWebhookSignature({
      signature,
      requestId,
      dataId,
      bodyDataId,
      secret: oauthMode() ? getRequiredEnv('MERCADOPAGO_OAUTH_WEBHOOK_SECRET') : getRequiredEnv('MERCADOPAGO_WEBHOOK_SECRET'),
    });

    if (!eventType || !dataId) {
      // Receipt persistence remains minimized: a malformed request can be
      // audited but cannot enter the durable processor.
      const safeEventType = eventType || 'invalid';
      const safeResource = dataId || payloadHash.slice(0, 64);
      await persistReceipt(service, {
        businessId,
        environment: providerEnvironment(),
        webhookEventId,
        eventType: safeEventType,
        resourceId: safeResource,
        signatureValid: false,
        requestId,
        payloadHash,
      });
      return jsonResponse(request, { ok: false, code: 'INVALID_WEBHOOK' }, 401);
    }

    if (!signatureValid) {
      await persistReceipt(service, {
        environment: providerEnvironment(), webhookEventId, eventType, resourceId: dataId,
        signatureValid: false, requestId, payloadHash,
      });
      return jsonResponse(request, { ok: false, code: 'INVALID_WEBHOOK' }, 401);
    }
    if (oauthMode()) {
      // Only Payments is subscribed for seller OAuth. Historical topics remain
      // handled by legacy mode; they cannot enter OAuth routing as payment IDs.
      if (eventType !== 'payment') return jsonResponse(request, { ok: true, ignored: true });
      const config = oauthConfig();
      businessId = await resolveSellerWebhookBusiness({
        signatureValid, eventType, resourceId: dataId, sellerId: body.user_id,
        applicationId: config.clientId, environment: config.environment,
      }, {
        connectionForSeller: async sellerId => {
          const { data, error } = await service.from('mp_seller_connections')
            .select('business_id,seller_id,application_id,environment,status')
            .eq('seller_id', sellerId).eq('environment', config.environment)
            .eq('application_id', config.clientId).eq('status', 'connected').maybeSingle();
          if (error) throw new Error('Seller routing lookup unavailable');
          return data;
        },
        paymentForBusiness: fetchPayment,
        intentForReference: async reference => {
          const { data, error } = await service.from('payment_intents')
            .select('business_id,environment').eq('provider', 'mercadopago')
            .eq('environment', config.environment).eq('external_reference', reference).maybeSingle();
          if (error) throw new Error('Payment routing lookup unavailable');
          return data;
        },
      });
    }
    const receipt = await persistReceipt(service, {
      businessId,
        environment: providerEnvironment(),
      webhookEventId,
      eventType,
      resourceId: dataId,
      signatureValid,
      requestId,
      payloadHash,
    });
    // Acknowledge only after durable persistence. The outbox reads the provider
    // again before financial validation and order finalization.
    return jsonResponse(request, {
      ok: true,
      receipt_id: receipt.receipt_id,
      duplicate: receipt.duplicate === true,
      queued: receipt.queued === true,
    }, 201);
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});

async function persistReceipt(
  service: ReturnType<typeof createServiceClient>,
  input: {
    businessId?: string;
    environment: 'test' | 'production';
    webhookEventId: string;
    eventType: string;
    resourceId: string;
    signatureValid: boolean;
    requestId: string;
    payloadHash: string;
  },
): Promise<Record<string, unknown>> {
  const { data, error } = await service.rpc(input.businessId ? 'mp_record_seller_webhook' : 'record_mercadopago_webhook_receipt', {
    ...(input.businessId ? {p_business_id:input.businessId} : {}),
    p_environment: input.environment,
    p_webhook_event_id: input.webhookEventId,
    p_event_type: input.eventType,
    p_resource_id: input.resourceId,
    p_signature_valid: input.signatureValid,
    p_request_id: input.requestId || null,
    p_payload_hash: input.payloadHash,
  });
  if (error || !data || typeof data !== 'object') {
    throw new Error('Unable to persist Mercado Pago webhook receipt');
  }
  return data as Record<string, unknown>;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
