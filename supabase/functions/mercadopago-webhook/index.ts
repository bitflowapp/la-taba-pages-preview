import { oauthConfig, oauthMode } from '../_shared/seller-oauth.ts';
import { fetchPayment } from '../_shared/mercadopago.ts';
import { resolveSellerWebhookBusiness } from '../_shared/seller-webhook-routing.ts';
import {
  consumeRateLimit,
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
import { clientAddress, requestIsHttps } from '../_shared/request-protocol.ts';
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

    // Hasta acá no se escribió nada: la firma se decide ANTES de tocar la base.
    // Este endpoint no tiene otra autenticación, y cuando gastaba un cupo y
    // guardaba un recibo por cada pedido —firmado o no— cualquiera podía hacer
    // crecer dos tablas sin límite y agotarle el cupo a Mercado Pago.
    if (!eventType || !dataId || !signatureValid) {
      // Receipt persistence remains minimized: a malformed request can be
      // audited but cannot enter the durable processor.
      await recordRejectedNotification(service, request, {
        environment: providerEnvironment(),
        webhookEventId,
        eventType: eventType || 'invalid',
        resourceId: dataId || payloadHash.slice(0, 64),
        signatureValid: false,
        requestId,
        payloadHash,
      });
      return jsonResponse(request, { ok: false, code: 'INVALID_WEBHOOK' }, 401);
    }
    // Una notificación firmada gasta el cupo de SU dirección (la que informa
    // Cloudflare, no un encabezado que escribe el cliente). No hay cupo común:
    // nadie puede agotar desde otra dirección el de las notificaciones reales.
    await enforceRateLimit(service, request, 'webhook', 240, 60);
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

// Cuántos recibos `rejected_signature` se pueden dejar por hora. La respuesta
// es 401 SIEMPRE, se guarde o no el recibo.
//
// POR DIRECCIÓN, veinte. `list_webhook_signature_alerts` avisa con el primero,
// pero `get_ecommerce_health` recién marca `webhook_processing` degradado con
// CINCO en la hora (y ninguna notificación válida). Mercado Pago reintenta la
// misma notificación y cada reintento gasta cupo sin dejar fila nueva (misma
// clave: sólo suma `attempt_count`): con un tope igual al umbral, un secreto
// mal cargado en producción podía quedar debajo de lo que lo delata. Veinte
// dejan lugar para esos reintentos.
//
// ENTRE TODAS LAS DIRECCIONES, doscientos. El tope por dirección no acota a
// quien tiene muchas (un /48 de IPv6 son 65.536 redes /64, cada una con su cupo
// y sus recibos). Este cupo se gasta PRIMERO: agotado, un pedido sin firma no
// escribe nada más —ni el recibo ni el cupo de su dirección—. Que alguien lo
// agote a propósito no esconde nada: para agotarlo dejó sus propios recibos, y
// son esos mismos recibos los que disparan la alerta y la salud.
const REJECTED_RECEIPTS_PER_ADDRESS = 20;
const REJECTED_RECEIPTS_ALL_ADDRESSES = 200;
const REJECTED_RECEIPT_WINDOW_SECONDS = 3600;

async function recordRejectedNotification(
  service: ReturnType<typeof createServiceClient>,
  request: Request,
  input: Parameters<typeof persistReceipt>[1],
): Promise<void> {
  // Si un cupo no se pudo consultar tampoco se guarda: se cierra hacia «no
  // escribir», que es lo acotado.
  if (!await consumeRateLimit(
    service,
    'webhook_rejected',
    'all-addresses',
    REJECTED_RECEIPTS_ALL_ADDRESSES,
    REJECTED_RECEIPT_WINDOW_SECONDS,
  )) return;
  // Sin dirección conocida el tope es uno solo para todos esos pedidos: acá el
  // objetivo es acotar filas, y un cupo compartido lo cumple.
  const origin = clientAddress(request);
  const allowed = await consumeRateLimit(
    service,
    'webhook_rejected',
    origin ? `address\u0000${origin}` : 'address-unknown',
    REJECTED_RECEIPTS_PER_ADDRESS,
    REJECTED_RECEIPT_WINDOW_SECONDS,
  );
  if (!allowed) return;
  try {
    await persistReceipt(service, input);
  } catch (_) {
    // El recibo de un rechazo es una traza, no parte de la respuesta.
  }
}

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
