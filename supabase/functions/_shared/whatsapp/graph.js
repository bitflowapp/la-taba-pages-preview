/**
 * Cliente de la Cloud API de WhatsApp (Graph API de Meta).
 *
 * Sólo salida: mandar mensajes y marcar leído. El token es de servidor y entra
 * por argumento; este módulo no lee variables de entorno ni las registra.
 *
 * REINTENTOS
 * ----------
 * 429 y 5xx se reintentan con espera creciente y respetando `Retry-After`
 * cuando Meta lo manda. Un 4xx que no sea 429 NO se reintenta: reintentar un
 * mensaje mal formado sólo gasta cupo y suma ruido. El resultado siempre dice
 * si conviene reintentar (`retryable`), así el llamador decide si vuelve a
 * encolar o si lo manda a la carta muerta.
 *
 * NADA DE CUERPOS EN EL LOG
 * -------------------------
 * De un error se conserva el código de Meta y el HTTP. El texto del mensaje y
 * el teléfono no salen de acá.
 */

const DEFAULT_API_VERSION = 'v21.0';
const GRAPH_BASE = 'https://graph.facebook.com';
const TIMEOUT_MS = 10_000;

export function createGraphSender({
  phoneNumberId,
  accessToken,
  apiVersion = DEFAULT_API_VERSION,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxAttempts = 3,
  baseDelayMs = 400,
}) {
  if (!phoneNumberId || !accessToken) {
    throw new Error('Missing WhatsApp Cloud API credentials');
  }
  const endpoint = `${GRAPH_BASE}/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`;

  async function post(body) {
    let lastResult = { ok: false, status: 0, errorCode: 'network', retryable: true };
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const parsed = await readJson(response);
        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            providerMessageId: String(parsed?.messages?.[0]?.id || ''),
          };
        }
        const errorCode = String(parsed?.error?.code ?? response.status);
        const retryable = response.status === 429 || response.status >= 500;
        lastResult = {
          ok: false,
          status: response.status,
          errorCode,
          retryable,
          retryAfterSeconds: retryAfterSeconds(response),
        };
        if (!retryable) return lastResult;
      } catch (_) {
        // Un timeout o una caída de red son reintentables: no se sabe si el
        // mensaje salió, y por eso el llamador deduplica por idempotency_key.
        lastResult = { ok: false, status: 0, errorCode: 'network_or_timeout', retryable: true };
      } finally {
        clearTimeout(timer);
      }
      if (attempt < maxAttempts) {
        const wait = lastResult.retryAfterSeconds
          ? lastResult.retryAfterSeconds * 1000
          : baseDelayMs * (2 ** (attempt - 1));
        await sleep(Math.min(wait, 8_000));
      }
    }
    return lastResult;
  }

  return {
    send: (message) => post(message),
    markRead: (messageId) => post({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: String(messageId),
    }),
  };
}

function retryAfterSeconds(response) {
  const header = Number(response.headers?.get?.('retry-after'));
  return Number.isFinite(header) && header > 0 ? Math.min(header, 300) : 0;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (_) {
    return null;
  }
}
