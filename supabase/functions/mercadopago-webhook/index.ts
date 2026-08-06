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
      secret: getRequiredEnv('MERCADOPAGO_WEBHOOK_SECRET'),
    });

    if (!eventType || !dataId) {
      // Receipt persistence remains minimized: a malformed request can be
      // audited but cannot enter the durable processor.
      const safeEventType = eventType || 'invalid';
      const safeResource = dataId || payloadHash.slice(0, 64);
      await persistReceipt(service, {
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

    const receipt = await persistReceipt(service, {
      environment: providerEnvironment(),
      webhookEventId,
      eventType,
      resourceId: dataId,
      signatureValid,
      requestId,
      payloadHash,
    });
    if (!signatureValid) {
      return jsonResponse(request, { ok: false, code: 'INVALID_WEBHOOK' }, 401);
    }
    // The durable outbox does the provider API read and order finalization.
    // 201 tells Mercado Pago that the receipt has been persisted in under 22s.
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
    environment: 'test' | 'production';
    webhookEventId: string;
    eventType: string;
    resourceId: string;
    signatureValid: boolean;
    requestId: string;
    payloadHash: string;
  },
): Promise<Record<string, unknown>> {
  const { data, error } = await service.rpc('record_mercadopago_webhook_receipt', {
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
