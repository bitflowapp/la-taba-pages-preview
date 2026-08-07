/**
 * Drena la cola de avisos del canal de WhatsApp.
 *
 * Hoy la cola tiene un solo tipo de aviso: la confirmación del pedido cuando
 * Mercado Pago acredita el pago. Lo encola un disparador de la base en el
 * instante en que el checkout se convierte en pedido, así que el cliente que
 * compró por chat se entera por chat, sin tener que volver a escribir.
 *
 * Se autoriza igual que `mercadopago-payment-worker`: firma de worker, no JWT
 * de navegador. Se puede invocar desde pg_cron con el mismo patrón que el
 * planificador de pagos.
 */

import {
  createServiceClient,
  enforceRateLimit,
  jsonResponse,
  publicErrorResponse,
  requirePost,
  requireWorkerAuthorization,
} from '../_shared/payment-runtime.ts';
import { serviceRpc, whatsappConfig } from '../_shared/whatsapp-runtime.ts';
import { createGraphSender } from '../_shared/whatsapp/graph.js';
import { dispatchOutbound } from '../_shared/whatsapp/channel.js';

Deno.serve(async (request) => {
  try {
    requirePost(request);
    await requireWorkerAuthorization(request);
    const config = whatsappConfig();
    const service = createServiceClient();
    await enforceRateLimit(service, request, 'whatsapp_outbound', 60, 60, 'whatsapp-dispatcher');

    const result = await dispatchOutbound({
      rpc: serviceRpc(service),
      sender: createGraphSender({
        phoneNumberId: config.phoneNumberId,
        accessToken: config.accessToken,
        apiVersion: config.apiVersion,
      }),
      owner: `edge:${crypto.randomUUID()}`,
      limit: 20,
      leaseSeconds: 90,
    });

    return jsonResponse(request, { ok: true, ...result });
  } catch (error) {
    return publicErrorResponse(request, error);
  }
});
